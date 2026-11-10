import * as THREE from 'three';
import { Physics, RAPIER, PHYSICS_DT } from '../core/Physics';
import { Unit, type BattleContext, type BattleEvent } from '../units/Unit';
import type { ProjectileDef, UnitDef } from '../units/types';
import { getUnit } from '../units/registry';
import { think } from '../ai/Brain';
import type { PartName } from '../units/Ragdoll';
import { buildMapPhysics, type MapData } from '../world/MapData';

/** sandbox = physics runs but nobody wins (used by the Unit Creator preview). */
export type Phase = 'placement' | 'battle' | 'over' | 'sandbox';
export const TEAM_NAMES = ['Red', 'Blue'];

export interface Placement { unitId: string; team: number; x: number; z: number }

export interface Projectile {
  body: RAPIER.RigidBody;
  def: ProjectileDef;
  owner: Unit;
  team: number;
  life: number;
  dead: boolean;
  view?: { sync(alpha?: number): void; capture(): void; dispose(): void };
}

export interface BattleHooks {
  onUnitCreated?(u: Unit): void;
  onProjectileCreated?(p: Projectile): void;
  onEvent?(e: BattleEvent): void;
  /** Called before every physics step (views snapshot poses here for interpolation). */
  onBeforeStep?(): void;
}

/**
 * The simulation: physics world, units, projectiles and win detection.
 * Has no DOM or renderer dependency, so it runs headless (see scripts/sim.ts).
 */
export class Battle implements BattleContext {
  physics!: Physics;
  units: Unit[] = [];
  projectiles: Projectile[] = [];
  phase: Phase = 'placement';
  winner: number | null = null;
  /** Simulated battle time in seconds. */
  time = 0;
  timeScale = 1;
  private acc = 0;
  private placements: Placement[] = [];
  private readonly pendingExplosions: Projectile[] = [];

  constructor(readonly map: MapData, readonly hooks: BattleHooks = {}) {
    this.resetWorld();
  }

  private resetWorld(): void {
    for (const u of this.units) u.view?.dispose();
    for (const p of this.projectiles) p.view?.dispose();
    this.physics?.dispose();
    this.units = [];
    this.projectiles = [];
    this.physics = new Physics();
    buildMapPhysics(this.physics, this.map);
    this.physics.onCollision((a, b, ca, cb) => {
      this.handleContact(a, b, ca, cb);
      this.handleContact(b, a, cb, ca);
    });
  }

  emit(e: BattleEvent): void {
    this.hooks.onEvent?.(e);
  }

  // ---------------------------------------------------------------- placement
  addUnit(def: UnitDef | string, team: number, x: number, z: number, record = true): Unit | null {
    const d = typeof def === 'string' ? getUnit(def) : def;
    if (!d) return null;
    const y = this.map.heightAt(x, z);
    const yaw = team === 0 ? Math.PI / 2 : -Math.PI / 2; // face the enemy side
    const u = new Unit(this, d, team, new THREE.Vector3(x, y + 0.02, z), yaw);
    this.units.push(u);
    if (record) this.placements.push({ unitId: d.id, team, x, z });
    this.hooks.onUnitCreated?.(u);
    this.emit({ type: 'spawn', pos: new THREE.Vector3(x, y, z) });
    return u;
  }

  removeUnit(u: Unit): void {
    const i = this.units.indexOf(u);
    if (i < 0) return;
    this.units.splice(i, 1);
    const p = u.ragdoll.pos();
    let best = -1;
    let bestD = Infinity;
    this.placements.forEach((pl, j) => {
      if (pl.team !== u.team || pl.unitId !== u.def.id) return;
      const d = (pl.x - p.x) ** 2 + (pl.z - p.z) ** 2;
      if (d < bestD) { bestD = d; best = j; }
    });
    if (best >= 0) this.placements.splice(best, 1);
    u.dispose();
  }

  clearTeam(team: number | null): void {
    for (const u of [...this.units]) if (team === null || u.team === team) this.removeUnit(u);
  }

  teamCost(team: number): number {
    return this.units.filter((u) => u.team === team).reduce((s, u) => s + u.def.cost, 0);
  }

  getPlacements(): Placement[] {
    return this.placements.map((p) => ({ ...p }));
  }

  /** Rebuild everything from a placement list (used by Reset and by saved layouts). */
  load(placements: Placement[]): void {
    this.resetWorld();
    this.phase = 'placement';
    this.winner = null;
    this.time = 0;
    this.placements = [];
    for (const p of placements) this.addUnit(p.unitId, p.team, p.x, p.z);
  }

  startSandbox(): void {
    this.phase = 'sandbox';
    this.acc = 0;
  }

  start(): void {
    if (this.phase !== 'placement') return;
    this.phase = 'battle';
    this.time = 0;
    this.acc = 0;
  }

  // ---------------------------------------------------------------- simulation
  /** Advance by real time dt (seconds); runs fixed physics steps scaled by timeScale. */
  update(dt: number, maxSteps = 4): void {
    if (this.phase === 'placement') return;
    this.acc += Math.min(dt, 0.1) * this.timeScale;
    let n = 0;
    while (this.acc >= PHYSICS_DT && n < maxSteps) {
      this.stepOnce();
      this.acc -= PHYSICS_DT;
      n++;
    }
    if (n === maxSteps) this.acc = 0;
  }

  /** Fraction (0..1) of the way between the last physics step and the next one, for render interpolation. */
  get alpha(): number {
    return Math.min(1, this.acc / PHYSICS_DT);
  }

  stepOnce(): void {
    this.hooks.onBeforeStep?.();
    const over = this.phase === 'over';
    // Units only pick fights once the battle is on (sandbox units idle unless an enemy exists).
    for (const u of this.units) think(u, this.units, over);
    for (const u of this.units) u.step();
    this.physics.step();
    this.time += PHYSICS_DT;

    for (const p of this.projectiles) {
      p.life -= PHYSICS_DT;
      if (p.life <= 0 || p.body.translation().y < -5) this.explode(p);
    }
    for (const p of this.pendingExplosions.splice(0)) this.explode(p);
    this.projectiles = this.projectiles.filter((p) => !p.dead);

    if (this.phase === 'battle') {
      const alive = [0, 1].map((t) => this.units.some((u) => u.alive && u.team === t));
      if (!alive[0] || !alive[1]) {
        this.phase = 'over';
        this.winner = alive[0] ? 0 : alive[1] ? 1 : null;
      }
    }
  }

  // ---------------------------------------------------------------- combat
  spawnProjectile(from: Unit, pos: THREE.Vector3, vel: THREE.Vector3, def: ProjectileDef): void {
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinvel(vel.x, vel.y, vel.z)
        .setGravityScale(def.gravityScale).setCcdEnabled(true),
    );
    const col = this.physics.world.createCollider(
      RAPIER.ColliderDesc.ball(def.radius).setMass(0.5).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    const p: Projectile = { body, def, owner: from, team: from.team, life: 4, dead: false };
    this.physics.tag(col, { kind: 'projectile', unitId: from.id, team: from.team, ref: p });
    this.projectiles.push(p);
    this.hooks.onProjectileCreated?.(p);
  }

  private explode(p: Projectile): void {
    if (p.dead) return;
    p.dead = true;
    const t = p.body.translation();
    const c = new THREE.Vector3(t.x, t.y, t.z);
    const R = p.def.blastRadius;
    for (const u of this.units) {
      let closest = Infinity;
      for (const part of u.ragdoll.list) {
        const bt = part.body.translation();
        const d = Math.hypot(bt.x - c.x, bt.y - c.y, bt.z - c.z);
        closest = Math.min(closest, d);
        if (d > R || u.team === p.team) continue;
        const f = 1 - d / R;
        const dir = new THREE.Vector3(bt.x - c.x, bt.y - c.y + 0.6, bt.z - c.z).normalize();
        part.body.applyImpulse(dir.multiplyScalar(part.mass * p.def.blastImpulse * f / 6), true);
      }
      if (u.team !== p.team && closest < R) {
        u.takeHit('torso', p.def.damage * (1 - (closest / R) * 0.6), new THREE.Vector3());
      }
    }
    this.emit({ type: 'explode', pos: c, radius: R });
    p.view?.dispose();
    this.physics.removeBody(p.body);
  }

  private handleContact(a: ReturnType<Physics['getTag']>, b: ReturnType<Physics['getTag']>, _ca: RAPIER.Collider, _cb: RAPIER.Collider): void {
    if (!a || !b) return;
    if (a.kind === 'projectile') {
      const p = a.ref as Projectile;
      if (!p.dead && b.unitId !== p.owner.id) this.pendingExplosions.push(p);
      return;
    }
    if (a.kind !== 'weapon') return;
    const attacker = (a.ref as { owner: Unit }).owner;
    if (b.kind === 'weapon') {
      const other = (b.ref as { owner: Unit }).owner;
      if (attacker.id < other.id) {
        const s = attacker.tipSpeed().length() + other.tipSpeed().length();
        if (s > 3) this.emit({ type: 'clang', pos: attacker.tipWorld(), power: Math.min(1, s / 15) });
      }
      return;
    }
    if (b.kind !== 'body' || b.team === attacker.team) return;
    const { owner: victim, part } = b.ref as { owner: Unit; part: PartName };
    const vel = attacker.tipSpeed();
    const speed = vel.length();
    const striking = attacker.isStriking();
    if (!attacker.alive || (!striking && speed < 5)) return;
    if (!attacker.registerStrike(victim.id)) return;
    const w = attacker.weapon;
    // Faster swings hurt more; strength mostly adds knockback.
    const mult = THREE.MathUtils.clamp(speed / 7, 0.5, 1.4) * (striking ? 1 : 0.5) * (0.75 + 0.25 * attacker.def.stats.strength);
    const dir = vel.lengthSq() > 0.01 ? vel.clone().normalize() : victim.pos.sub(attacker.pos).normalize();
    dir.y += 0.35;
    const impulse = dir.normalize().multiplyScalar(w.knockback * mult * attacker.def.stats.strength);
    const wasAlive = victim.alive;
    victim.takeHit(part, w.damage * mult * (part === 'head' ? 1.4 : 1), impulse);
    if (wasAlive) this.emit({ type: 'hit', pos: attacker.tipWorld(), power: Math.min(1, mult / 1.5), weapon: w.shape });
  }

  aliveCount(team: number): number {
    return this.units.filter((u) => u.alive && u.team === team).length;
  }

  dispose(): void {
    for (const u of this.units) u.view?.dispose();
    for (const p of this.projectiles) p.view?.dispose();
    this.physics.dispose();
    this.units = [];
  }
}
