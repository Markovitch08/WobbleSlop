import * as THREE from 'three';
import { RAPIER, type Physics, PHYSICS_DT, GRAVITY } from '../core/Physics';
import { Ragdoll, ARM_REST, type ArmPose, type PartName } from './Ragdoll';
import type { UnitDef, WeaponDef, AttackStyle, ProjectileDef } from './types';
import { getWeapon } from './weapons';
import { weaponPieces } from './weaponShapes';

export type BattleEvent =
  | { type: 'hit'; pos: THREE.Vector3; power: number; weapon: string }
  | { type: 'clang'; pos: THREE.Vector3; power: number }
  | { type: 'swing'; pos: THREE.Vector3; weapon: string }
  | { type: 'cast'; pos: THREE.Vector3 }
  | { type: 'explode'; pos: THREE.Vector3; radius: number }
  | { type: 'death'; pos: THREE.Vector3; unit: Unit }
  | { type: 'spawn'; pos: THREE.Vector3 };

/** What a unit needs from the battle it lives in. */
export interface BattleContext {
  physics: Physics;
  units: Unit[];
  spawnProjectile(from: Unit, pos: THREE.Vector3, vel: THREE.Vector3, def: ProjectileDef): void;
  emit(e: BattleEvent): void;
}

type AttackState = 'ready' | 'windup' | 'strike' | 'recover';

interface StylePoses { guard: ArmPose; windup: ArmPose; strike: ArmPose; twist: [number, number]; lean: [number, number] }

const POSES: Record<AttackStyle, StylePoses> = {
  slash: {
    guard: { pitch: -0.5, roll: -0.25, yaw: 0, bend: -1.3, stiffness: 1 },
    windup: { pitch: -2.5, roll: -0.7, yaw: 0.3, bend: -1.6, stiffness: 1.3 },
    strike: { pitch: -0.25, roll: 0.35, yaw: -0.3, bend: -0.2, stiffness: 2.6 },
    twist: [-0.5, 0.45], lean: [-0.1, 0.3],
  },
  overhead: {
    guard: { pitch: -0.6, roll: -0.2, yaw: 0, bend: -1.1, stiffness: 1 },
    windup: { pitch: -3.0, roll: -0.25, yaw: 0, bend: -1.7, stiffness: 1.4 },
    strike: { pitch: -0.45, roll: 0.05, yaw: 0, bend: -0.1, stiffness: 3 },
    twist: [-0.25, 0.2], lean: [-0.25, 0.45],
  },
  cast: {
    guard: { pitch: -0.3, roll: -0.25, yaw: 0, bend: -1.35, stiffness: 0.9 },
    windup: { pitch: -1.0, roll: -0.4, yaw: 0, bend: -1.0, stiffness: 1.1 },
    strike: { pitch: -1.7, roll: -0.1, yaw: 0, bend: -0.4, stiffness: 1.6 },
    twist: [-0.3, 0.2], lean: [-0.05, 0.15],
  },
};

const CHEER: ArmPose = { pitch: -2.9, roll: -0.35, yaw: 0, bend: -0.3, stiffness: 0.9 };
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

let nextId = 1;

export class Unit {
  readonly id = nextId++;
  readonly def: UnitDef;
  readonly team: number;
  readonly weapon: WeaponDef;
  readonly ragdoll: Ragdoll;
  readonly weaponBody: RAPIER.RigidBody;
  private weaponJoint: RAPIER.ImpulseJoint | null;
  private readonly tipLocal: THREE.Vector3;
  private readonly ctx: BattleContext;

  health: number;
  readonly maxHealth: number;
  alive = true;
  /** Seconds since death (for corpse cleanup). */
  deadTime = 0;
  /** Seconds since last hit (for view flash). */
  hitFlash = 0;

  // AI-facing state
  target: Unit | null = null;
  aiTimer = 0;
  cheering = false;
  attackState: AttackState = 'ready';
  private attackT = 0;
  private cooldown = 0;
  private fired = false;
  private readonly struck = new Set<number>();
  private attackTarget: Unit | null = null;

  /** Optional render hook set by the view layer. */
  view?: { sync(): void; dispose(): void; flash(): void };

  constructor(ctx: BattleContext, def: UnitDef, team: number, position: THREE.Vector3, yaw: number) {
    this.ctx = ctx;
    this.def = def;
    this.team = team;
    this.weapon = getWeapon(def.weapon);
    this.maxHealth = this.health = def.stats.health;
    this.ragdoll = new Ragdoll({ physics: ctx.physics, body: def.body, position, yaw, unitId: this.id, team, ref: this });
    this.ragdoll.balance = def.stats.balance;
    this.ragdoll.strength = def.stats.strength;
    this.ragdoll.armR = { ...POSES[this.weapon.style].guard };

    // Weapon: a separate body welded to the right hand, so it can be dropped on death.
    const { pieces, tip } = weaponPieces(this.weapon);
    this.tipLocal = tip;
    const hand = this.ragdoll.handWorld(true);
    const rot = this.ragdoll.parts.lArmR.body.rotation();
    const wb = ctx.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(hand.x, hand.y, hand.z).setRotation(rot)
        .setCcdEnabled(true).setAngularDamping(0.4).setCanSleep(false),
    );
    const toZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    for (const p of pieces) {
      let cd: RAPIER.ColliderDesc;
      if (p.kind === 'capsuleZ') cd = RAPIER.ColliderDesc.capsule(p.half, p.r).setRotation(toZ);
      else if (p.kind === 'box') cd = RAPIER.ColliderDesc.cuboid(p.hx, p.hy, p.hz);
      else cd = RAPIER.ColliderDesc.ball(p.r);
      cd.setTranslation(p.at.x, p.at.y, p.at.z).setMass(p.mass).setFriction(0.5)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const c = ctx.physics.world.createCollider(cd, wb);
      ctx.physics.tag(c, { kind: 'weapon', unitId: this.id, team, ref: { owner: this } });
    }
    this.weaponBody = wb;
    const jd = RAPIER.JointData.fixed(this.ragdoll.handLocal(true), { x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    this.weaponJoint = ctx.physics.world.createImpulseJoint(jd, this.ragdoll.parts.lArmR.body, wb, true);
    this.weaponJoint.setContactsEnabled(false);
    this.ragdoll.handLoadR = this.weapon.mass / 2.5;
  }

  get pos(): THREE.Vector3 {
    return this.ragdoll.pos('pelvis');
  }

  /** Attack reach measured pelvis to pelvis. */
  get range(): number {
    return this.weapon.range * this.def.body.size;
  }

  get isRanged(): boolean {
    return !!this.weapon.projectile;
  }

  canAttack(): boolean {
    return this.alive && this.attackState === 'ready' && this.cooldown <= 0 && this.ragdoll.uprightness() > 0.55;
  }

  startAttack(target: Unit): void {
    if (!this.canAttack()) return;
    this.attackState = 'windup';
    this.attackT = 0;
    this.fired = false;
    this.struck.clear();
    this.attackTarget = target;
  }

  tipWorld(out = new THREE.Vector3()): THREE.Vector3 {
    const t = this.weaponBody.translation();
    const r = this.weaponBody.rotation();
    return out.copy(this.tipLocal).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).add(_v2.set(t.x, t.y, t.z));
  }

  /** Velocity of the weapon tip — used for damage. */
  tipSpeed(): THREE.Vector3 {
    const tip = this.tipWorld(new THREE.Vector3());
    const t = this.weaponBody.translation();
    const lv = this.weaponBody.linvel();
    const av = this.weaponBody.angvel();
    const r = new THREE.Vector3(tip.x - t.x, tip.y - t.y, tip.z - t.z);
    return new THREE.Vector3(av.x, av.y, av.z).cross(r).add(_v.set(lv.x, lv.y, lv.z));
  }

  /** True if contacts from this weapon right now should count as an attack. */
  isStriking(): boolean {
    return this.alive && (this.attackState === 'strike' || this.attackState === 'recover');
  }

  registerStrike(victimId: number): boolean {
    if (this.struck.has(victimId)) return false;
    this.struck.add(victimId);
    return true;
  }

  /** Per physics step: muscles + attack timeline. */
  step(): void {
    const dt = PHYSICS_DT;
    if (!this.alive) {
      this.deadTime += dt;
      return;
    }
    if (this.pos.y < -15) {
      this.kill();
      return;
    }
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.updateAttack(dt);
    this.ragdoll.control();
  }

  private updateAttack(dt: number): void {
    const w = this.weapon;
    const poses = POSES[w.style];
    const rd = this.ragdoll;
    this.cooldown -= dt;
    this.attackT += dt;
    switch (this.attackState) {
      case 'ready':
        rd.armR = this.cheering ? { ...CHEER } : { ...poses.guard };
        rd.armL = this.cheering ? { ...CHEER } : { ...ARM_REST };
        rd.torsoTwist = 0;
        rd.torsoLean = 0;
        break;
      case 'windup':
        rd.armR = { ...poses.windup };
        rd.torsoTwist = poses.twist[0];
        rd.torsoLean = poses.lean[0];
        if (this.attackT >= w.windup) {
          this.attackState = 'strike';
          this.attackT = 0;
          this.ctx.emit({ type: w.projectile ? 'cast' : 'swing', pos: this.tipWorld(), weapon: w.shape });
          if (w.projectile) this.fireProjectile(w.projectile);
        }
        break;
      case 'strike': {
        rd.armR = { ...poses.strike };
        rd.torsoTwist = poses.twist[1];
        rd.torsoLean = poses.lean[1];
        // TABS-style "pull the weapon toward the target" so swings actually connect.
        const tgt = this.attackTarget;
        if (tgt && tgt.alive && !w.projectile) {
          const tip = this.tipWorld();
          const aim = tgt.ragdoll.pos('torso').sub(tip);
          const dist = aim.length();
          if (dist > 0.05 && dist < 3) {
            aim.multiplyScalar(1 / dist);
            const k = w.mass * 40 * this.def.stats.strength * dt;
            this.weaponBody.applyImpulseAtPoint({ x: aim.x * k, y: aim.y * k, z: aim.z * k }, tip, true);
          }
        }
        if (this.attackT >= w.strike) {
          this.attackState = 'recover';
          this.attackT = 0;
        }
        break;
      }
      case 'recover':
        rd.armR = { ...poses.guard, stiffness: 0.8 };
        rd.torsoTwist *= 0.9;
        rd.torsoLean *= 0.9;
        if (this.attackT >= 0.18) {
          this.attackState = 'ready';
          this.cooldown = w.cooldown;
        }
        break;
    }
  }

  private fireProjectile(p: ProjectileDef): void {
    const tgt = this.attackTarget;
    if (!tgt || !tgt.alive || this.fired) return;
    this.fired = true;
    const from = this.tipWorld();
    from.y += 0.15;
    // Lead the target a little and compensate for the projectile's reduced gravity.
    const aim = tgt.ragdoll.pos('torso');
    const tv = tgt.ragdoll.vel();
    const t = from.distanceTo(aim) / p.speed;
    aim.addScaledVector(tv, t * 0.6);
    const vel = aim.sub(from).setLength(p.speed);
    vel.y += 0.5 * GRAVITY * p.gravityScale * t;
    this.ctx.spawnProjectile(this, from, vel, p);
  }

  takeHit(part: PartName, damage: number, impulse: THREE.Vector3): void {
    if (impulse.lengthSq() > 0) {
      this.ragdoll.applyImpulseTo(part, impulse);
      this.ragdoll.applyImpulseTo('torso', impulse.clone().multiplyScalar(0.4));
    }
    if (!this.alive) return;
    this.health -= damage;
    this.hitFlash = 0.15;
    this.view?.flash();
    this.ragdoll.stagger = Math.min(1, this.ragdoll.stagger + damage / 70);
    if (this.health <= 0) this.kill();
  }

  kill(): void {
    if (!this.alive) return;
    this.alive = false;
    this.health = 0;
    this.attackState = 'ready';
    this.ragdoll.goLimp();
    if (this.weaponJoint) {
      this.ctx.physics.world.removeImpulseJoint(this.weaponJoint, true);
      this.weaponJoint = null;
    }
    this.ctx.emit({ type: 'death', pos: this.ragdoll.pos('head'), unit: this });
  }

  dispose(): void {
    this.view?.dispose();
    if (this.weaponJoint) this.ctx.physics.world.removeImpulseJoint(this.weaponJoint, false);
    this.weaponJoint = null;
    this.ragdoll.dispose();
    this.ctx.physics.removeBody(this.weaponBody);
  }
}
