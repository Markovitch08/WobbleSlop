import * as THREE from 'three';
import { RAPIER, type Physics, PHYSICS_DT, GRAVITY } from '../core/Physics';
import type { BodyParams } from './types';

/**
 * Active ragdoll, in the spirit of TABS:
 *  - every limb is a real rigid body connected by spherical joints;
 *  - a "standing handler" raycasts to the ground and holds the pelvis/torso up like
 *    marionette strings, plus a head-up / feet-down force pair that rights the body;
 *  - PD controllers torque each limb toward a procedurally animated target pose
 *    (walk cycle on the legs, weapon poses on the arms);
 *  - turning the controller off (death) leaves a limp ragdoll.
 * Low balance/strength values (or stagger from hits) weaken the controllers,
 * which is where the wobble comes from.
 */

export type PartName =
  | 'pelvis' | 'torso' | 'head'
  | 'uArmL' | 'lArmL' | 'uArmR' | 'lArmR'
  | 'thighL' | 'shinL' | 'thighR' | 'shinR';

export const PART_NAMES: PartName[] = [
  'pelvis', 'torso', 'head', 'uArmL', 'lArmL', 'uArmR', 'lArmR', 'thighL', 'shinL', 'thighR', 'shinR',
];

export type PartShape =
  | { type: 'box'; hx: number; hy: number; hz: number }
  | { type: 'capsule'; radius: number; halfHeight: number }
  | { type: 'ball'; radius: number };

export interface Part {
  name: PartName;
  body: RAPIER.RigidBody;
  shape: PartShape;
  mass: number;
  /** Inertia about the joint pivot (approx), used to scale PD torques. */
  inertia: number;
  parent?: Part;
}

/** Target pose for one arm: upper arm relative to torso, forearm bend relative to upper arm. */
export interface ArmPose {
  pitch: number; // negative = raise forward
  roll: number; // negative = outward (for the right arm; mirrored for left)
  yaw: number;
  bend: number; // elbow, negative = bend forward
  stiffness: number; // multiplier
}

export const ARM_REST: ArmPose = { pitch: 0.05, roll: -0.12, yaw: 0, bend: -0.25, stiffness: 0.6 };

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _e = new THREE.Vector3();
const _w = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

function quatOf(r: { x: number; y: number; z: number; w: number }, out: THREE.Quaternion) {
  return out.set(r.x, r.y, r.z, r.w);
}

/** Layout in the unit's local frame: facing +Z, +X is the unit's left, origin on the ground. */
export interface RagdollLayout {
  centers: Record<PartName, THREE.Vector3>;
  shapes: Record<PartName, PartShape>;
  masses: Record<PartName, number>;
  lengths: Record<PartName, number>;
  joints: { parent: PartName; child: PartName; anchor: THREE.Vector3 }[];
  /** Grip point on the right forearm, in the unit frame. */
  handR: THREE.Vector3;
  handL: THREE.Vector3;
  footSize: THREE.Vector3;
  standHeight: number; // pelvis centre height when standing
  height: number;
}

export function computeLayout(b: BodyParams): RagdollLayout {
  const s = b.size;
  const thighLen = 0.42 * b.legLength * s;
  const shinLen = 0.42 * b.legLength * s;
  const footH = 0.08 * s;
  const legR = 0.075 * b.limbThickness * s;
  const armR = 0.062 * b.limbThickness * s;
  const hipY = footH + shinLen + thighLen;
  const pelvisH = 0.09 * s;
  const pelvisHx = 0.17 * b.torsoWidth * s;
  const pelvisY = hipY + 0.04 * s;
  const pelvisTop = pelvisY + pelvisH;
  const torsoR = 0.17 * b.torsoWidth * s;
  const torsoHalf = 0.15 * s;
  const torsoY = pelvisTop + torsoR + torsoHalf - 0.04 * s;
  const torsoTop = torsoY + torsoHalf + torsoR;
  const headR = 0.16 * b.headSize * s;
  const headY = torsoTop + headR * 0.85;
  const shoulderX = torsoR + armR * 0.9;
  const shoulderY = torsoTop - 0.13 * s;
  const uArm = 0.29 * b.armLength * s;
  const lArm = 0.3 * b.armLength * s;
  const hipX = 0.1 * b.torsoWidth * s;
  const m = b.mass;

  const cap = (len: number, r: number): PartShape => ({ type: 'capsule', radius: r, halfHeight: Math.max(0.01, len / 2 - r) });
  const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

  const centers: Record<PartName, THREE.Vector3> = {
    pelvis: v(0, pelvisY),
    torso: v(0, torsoY),
    head: v(0, headY),
    uArmL: v(shoulderX, shoulderY - uArm / 2),
    lArmL: v(shoulderX, shoulderY - uArm - lArm / 2),
    uArmR: v(-shoulderX, shoulderY - uArm / 2),
    lArmR: v(-shoulderX, shoulderY - uArm - lArm / 2),
    thighL: v(hipX, hipY - thighLen / 2),
    shinL: v(hipX, hipY - thighLen - shinLen / 2),
    thighR: v(-hipX, hipY - thighLen / 2),
    shinR: v(-hipX, hipY - thighLen - shinLen / 2),
  };
  const shapes: Record<PartName, PartShape> = {
    pelvis: { type: 'box', hx: pelvisHx, hy: pelvisH, hz: 0.11 * b.torsoWidth * s },
    torso: { type: 'capsule', radius: torsoR, halfHeight: torsoHalf },
    head: { type: 'ball', radius: headR },
    uArmL: cap(uArm, armR), lArmL: cap(lArm, armR * 0.95),
    uArmR: cap(uArm, armR), lArmR: cap(lArm, armR * 0.95),
    thighL: cap(thighLen, legR), shinL: cap(shinLen, legR * 0.9),
    thighR: cap(thighLen, legR), shinR: cap(shinLen, legR * 0.9),
  };
  const ss = s * s;
  const masses: Record<PartName, number> = {
    pelvis: 10 * m * ss, torso: 16 * m * ss, head: 4 * m * ss,
    uArmL: 2.2 * m * ss, lArmL: 1.8 * m * ss, uArmR: 2.2 * m * ss, lArmR: 1.8 * m * ss,
    thighL: 5 * m * ss, shinL: 4 * m * ss, thighR: 5 * m * ss, shinR: 4 * m * ss,
  };
  const lengths: Record<PartName, number> = {
    pelvis: pelvisH * 2, torso: (torsoHalf + torsoR) * 2, head: headR * 2,
    uArmL: uArm, lArmL: lArm, uArmR: uArm, lArmR: lArm,
    thighL: thighLen, shinL: shinLen + footH, thighR: thighLen, shinR: shinLen + footH,
  };
  const joints = [
    { parent: 'pelvis' as PartName, child: 'torso' as PartName, anchor: v(0, pelvisTop) },
    { parent: 'torso' as PartName, child: 'head' as PartName, anchor: v(0, torsoTop) },
    { parent: 'torso' as PartName, child: 'uArmL' as PartName, anchor: v(shoulderX, shoulderY) },
    { parent: 'uArmL' as PartName, child: 'lArmL' as PartName, anchor: v(shoulderX, shoulderY - uArm) },
    { parent: 'torso' as PartName, child: 'uArmR' as PartName, anchor: v(-shoulderX, shoulderY) },
    { parent: 'uArmR' as PartName, child: 'lArmR' as PartName, anchor: v(-shoulderX, shoulderY - uArm) },
    { parent: 'pelvis' as PartName, child: 'thighL' as PartName, anchor: v(hipX, hipY) },
    { parent: 'thighL' as PartName, child: 'shinL' as PartName, anchor: v(hipX, hipY - thighLen) },
    { parent: 'pelvis' as PartName, child: 'thighR' as PartName, anchor: v(-hipX, hipY) },
    { parent: 'thighR' as PartName, child: 'shinR' as PartName, anchor: v(-hipX, hipY - thighLen) },
  ];
  return {
    centers, shapes, masses, lengths, joints,
    handR: v(-shoulderX, shoulderY - uArm - lArm * 0.88),
    handL: v(shoulderX, shoulderY - uArm - lArm * 0.88),
    footSize: v(0.075 * s * b.limbThickness, footH / 2, 0.13 * s),
    standHeight: pelvisY - 0.03 * s,
    height: headY + headR,
  };
}

export interface RagdollOptions {
  physics: Physics;
  body: BodyParams;
  position: THREE.Vector3; // ground point under the pelvis
  yaw: number;
  unitId: number;
  team: number;
  ref?: unknown;
}

export class Ragdoll {
  readonly parts = {} as Record<PartName, Part>;
  readonly list: Part[] = [];
  readonly layout: RagdollLayout;
  readonly totalMass: number;
  private readonly physics: Physics;

  // ---- control inputs (set by the unit/AI each step) ----
  /** Desired horizontal velocity (m/s). */
  readonly moveVel = new THREE.Vector3();
  /** Desired facing yaw (radians, 0 = +Z). */
  faceYaw: number;
  /** 0..2 balance strength; 0 makes the unit collapse. */
  balance = 1;
  /** 0..2 arm strength. */
  strength = 1;
  /** Extra forward lean / twist used by attacks. */
  torsoTwist = 0;
  torsoLean = 0;
  armR: ArmPose = { ...ARM_REST };
  armL: ArmPose = { ...ARM_REST };
  /** Stagger 0..1 temporarily weakens balance after heavy hits. */
  stagger = 0;
  active = true;

  // ---- state ----
  heading: number;
  grounded = false;
  private phase = 0;
  private gaitAmp = 0;
  /** Weight of extra mass hanging on each hand (weapons), for PD scaling. */
  handLoadR = 0;
  handLoadL = 0;

  constructor(opts: RagdollOptions) {
    this.physics = opts.physics;
    this.layout = computeLayout(opts.body);
    this.faceYaw = this.heading = opts.yaw;
    const L = this.layout;
    const rot = new THREE.Quaternion().setFromAxisAngle(Y, opts.yaw);
    const world = opts.physics.world;
    let total = 0;

    for (const name of PART_NAMES) {
      const c = L.centers[name].clone().applyQuaternion(rot).add(opts.position);
      const desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(c.x, c.y, c.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
        .setLinearDamping(0.05)
        .setAngularDamping(0.6)
        .setCanSleep(false);
      const body = world.createRigidBody(desc);
      const shape = L.shapes[name];
      const mass = L.masses[name];
      let cd: RAPIER.ColliderDesc;
      if (shape.type === 'box') cd = RAPIER.ColliderDesc.cuboid(shape.hx, shape.hy, shape.hz);
      else if (shape.type === 'capsule') cd = RAPIER.ColliderDesc.capsule(shape.halfHeight, shape.radius);
      else cd = RAPIER.ColliderDesc.ball(shape.radius);
      cd.setMass(mass).setFriction(0.6).setRestitution(0.05);
      const col = world.createCollider(cd, body);
      this.physics.tag(col, { kind: 'body', unitId: opts.unitId, team: opts.team, ref: { owner: opts.ref, part: name } });
      if (name === 'shinL' || name === 'shinR') {
        const shinHalf = (shape as { halfHeight: number }).halfHeight + (shape as { radius: number }).radius;
        const fd = RAPIER.ColliderDesc.cuboid(L.footSize.x, L.footSize.y, L.footSize.z)
          .setTranslation(0, -shinHalf - L.footSize.y * 0.4, L.footSize.z * 0.45)
          .setMass(mass * 0.15)
          .setFriction(1.4);
        const fc = world.createCollider(fd, body);
        this.physics.tag(fc, { kind: 'body', unitId: opts.unitId, team: opts.team, ref: { owner: opts.ref, part: name } });
      }
      const len = L.lengths[name];
      const part: Part = { name, body, shape, mass, inertia: Math.max(mass * len * len / 3, 0.02) };
      this.parts[name] = part;
      this.list.push(part);
      total += mass;
    }
    this.totalMass = total;

    for (const j of L.joints) {
      const p = this.parts[j.parent];
      const c = this.parts[j.child];
      c.parent = p;
      const a1 = j.anchor.clone().sub(L.centers[j.parent]);
      const a2 = j.anchor.clone().sub(L.centers[j.child]);
      const jd = RAPIER.JointData.spherical(a1, a2);
      const joint = world.createImpulseJoint(jd, p.body, c.body, true);
      joint.setContactsEnabled(false);
    }
  }

  // ------------------------------------------------------------------ queries
  pos(name: PartName = 'pelvis'): THREE.Vector3 {
    const t = this.parts[name].body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  /** World-space velocity of the pelvis. */
  vel(): THREE.Vector3 {
    const v = this.parts.pelvis.body.linvel();
    return new THREE.Vector3(v.x, v.y, v.z);
  }

  /** How upright the torso is: 1 = vertical, 0 = lying down. */
  uprightness(): number {
    quatOf(this.parts.torso.body.rotation(), _q);
    return _v.copy(Y).applyQuaternion(_q).y;
  }

  /** Hand grip point in world space. */
  handWorld(right = true, out = new THREE.Vector3()): THREE.Vector3 {
    const part = this.parts[right ? 'lArmR' : 'lArmL'];
    const local = (right ? this.layout.handR : this.layout.handL).clone().sub(this.layout.centers[part.name]);
    const t = part.body.translation();
    quatOf(part.body.rotation(), _q);
    return out.copy(local).applyQuaternion(_q).add(_v.set(t.x, t.y, t.z));
  }

  handLocal(right = true): THREE.Vector3 {
    const name: PartName = right ? 'lArmR' : 'lArmL';
    return (right ? this.layout.handR : this.layout.handL).clone().sub(this.layout.centers[name]);
  }

  // ------------------------------------------------------------------ control
  /** Runs one physics step worth of muscle forces. Call before world.step(). */
  control(): void {
    if (!this.active) return;
    const dt = PHYSICS_DT;
    const P = this.parts;
    this.stagger = Math.max(0, this.stagger - dt * 0.9);
    const bal = Math.max(0, this.balance * (1 - this.stagger * 0.85));
    const str = Math.max(0.05, this.strength * (1 - this.stagger * 0.5));

    // Turn heading toward desired facing at a limited rate.
    let dy = this.faceYaw - this.heading;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.heading += THREE.MathUtils.clamp(dy, -7 * dt, 7 * dt);
    const qHeading = _q3.setFromAxisAngle(Y, this.heading);

    // ---- standing handler (marionette strings) ----
    const pp = P.pelvis.body.translation();
    const reach = this.layout.standHeight * 1.45;
    const d = this.physics.groundDistance(pp.x, pp.y, pp.z, reach);
    const upright = this.uprightness();
    this.grounded = d !== null;
    const pv = P.pelvis.body.linvel();
    if (d !== null && upright > 0.15) {
      // Fade the strings out as the unit tips over so it can actually fall.
      const tilt = THREE.MathUtils.smoothstep(upright, 0.15, 0.7);
      const err = this.layout.standHeight - d;
      let a = GRAVITY + 90 * err - 12 * pv.y;
      a = THREE.MathUtils.clamp(a, 0, GRAVITY * 2.6) * Math.min(bal, 1.25) * tilt;
      const F = this.totalMass * a * dt;
      P.pelvis.body.applyImpulse({ x: 0, y: F * 0.55, z: 0 }, true);
      P.torso.body.applyImpulse({ x: 0, y: F * 0.45, z: 0 }, true);

      // Head up, feet down: a pure righting couple.
      const fh = this.totalMass * GRAVITY * 0.3 * bal * dt;
      P.head.body.applyImpulse({ x: 0, y: fh, z: 0 }, true);
      P.shinL.body.applyImpulse({ x: 0, y: -fh * 0.5, z: 0 }, true);
      P.shinR.body.applyImpulse({ x: 0, y: -fh * 0.5, z: 0 }, true);

      // Locomotion: push the core toward the desired velocity.
      const ax = THREE.MathUtils.clamp((this.moveVel.x - pv.x) * 7, -14, 14);
      const az = THREE.MathUtils.clamp((this.moveVel.z - pv.z) * 7, -14, 14);
      const k = this.totalMass * dt * Math.min(bal, 1) * tilt;
      P.pelvis.body.applyImpulse({ x: ax * k * 0.6, y: 0, z: az * k * 0.6 }, true);
      P.torso.body.applyImpulse({ x: ax * k * 0.4, y: 0, z: az * k * 0.4 }, true);
    }

    // ---- posture: pelvis, torso and head toward the heading frame ----
    const speed = Math.hypot(pv.x, pv.z);
    const core = 1.8 * bal;
    _q.copy(qHeading);
    this.drive(P.pelvis, _q, 160 * core, 22 * Math.sqrt(core), undefined, 0, 8);
    _q.copy(qHeading)
      .multiply(_q2.setFromAxisAngle(Y, this.torsoTwist))
      .multiply(_q2.setFromAxisAngle(X, 0.06 * speed + this.torsoLean));
    this.drive(P.torso, _q, 160 * core, 22 * Math.sqrt(core), undefined, 0, 8);
    _q.copy(qHeading);
    this.drive(P.head, _q, 90 * core, 10 * Math.sqrt(core), P.torso, 0.4, 6);

    // ---- legs: procedural walk cycle driven by actual speed ----
    // Step when we intend to move, or when shoved hard enough that we need to catch ourselves.
    const want = Math.hypot(this.moveVel.x, this.moveVel.z);
    const gait = want > 0.2 ? Math.max(want, speed) : speed > 1.2 ? speed : 0;
    const speedRatio = Math.min(1.3, gait / 3);
    if (gait > 0) this.phase += dt * Math.PI * 2 * (0.9 + 1.0 * speedRatio);
    this.gaitAmp += (0.6 * Math.min(1, speedRatio * 1.2) - this.gaitAmp) * Math.min(1, dt * 6);
    const amp = this.gaitAmp;
    const legK = 260 * Math.max(0.25, bal);
    const legD = 18 * Math.sqrt(Math.max(0.25, bal));
    for (const side of [0, 1]) {
      const ph = this.phase + side * Math.PI;
      const thigh = side === 0 ? P.thighL : P.thighR;
      const shin = side === 0 ? P.shinL : P.shinR;
      const outward = side === 0 ? 0.05 : -0.05;
      const pitch = -amp * Math.sin(ph);
      const knee = 0.08 + 1.1 * amp * Math.max(0, Math.cos(ph));
      _q.copy(qHeading).multiply(_q2.setFromAxisAngle(Z, outward)).multiply(_q2.setFromAxisAngle(X, pitch));
      this.drive(thigh, _q, legK, legD, P.pelvis, 0.25, 6);
      quatOf(thigh.body.rotation(), _q).multiply(_q2.setFromAxisAngle(X, knee));
      this.drive(shin, _q, legK, legD, thigh, 0.5, 6);
    }

    // ---- arms ----
    const sway = amp * 0.7 * Math.sin(this.phase);
    this.driveArm(this.armR, P.uArmR, P.lArmR, -1, this.handLoadR, str, sway);
    this.driveArm(this.armL, P.uArmL, P.lArmL, 1, this.handLoadL, str, -sway);
  }

  private driveArm(pose: ArmPose, upper: Part, lower: Part, mirror: number, load: number, str: number, sway: number) {
    const torsoQ = quatOf(this.parts.torso.body.rotation(), _q3);
    // roll is authored for the right arm (mirror -1); the left arm flips it.
    const roll = -pose.roll * mirror;
    const yaw = pose.yaw * -mirror;
    const pitch = pose.pitch + (pose.stiffness < 1 ? sway : 0);
    _q.copy(torsoQ)
      .multiply(_q2.setFromAxisAngle(Y, yaw))
      .multiply(_q2.setFromAxisAngle(Z, roll))
      .multiply(_q2.setFromAxisAngle(X, pitch));
    const k = 520 * pose.stiffness * str;
    const dmp = 30 * Math.sqrt(pose.stiffness * str);
    const loadFactor = 1 + load * 1.4;
    this.drive(upper, _q, k, dmp, this.parts.torso, 0.35, 12, loadFactor);
    quatOf(upper.body.rotation(), _q).multiply(_q2.setFromAxisAngle(X, pose.bend));
    this.drive(lower, _q, k, dmp, upper, 0.5, 12, 1 + load * 2.2);
  }

  /**
   * PD torque toward a world-space target orientation.
   * torque = I * (kp * angleError - kd * relativeAngularVelocity), applied as an impulse,
   * with an optional equal-and-opposite share on the parent so limbs push the body around.
   */
  private drive(part: Part, target: THREE.Quaternion, kp: number, kd: number, parent: Part | undefined, reaction: number, maxAccelK: number, inertiaMul = 1) {
    const b = part.body;
    quatOf(b.rotation(), _q2).invert();
    const qe = _q2.premultiply(target); // target * inverse(current)
    if (qe.w < 0) qe.set(-qe.x, -qe.y, -qe.z, -qe.w);
    const sinHalf = Math.sqrt(qe.x * qe.x + qe.y * qe.y + qe.z * qe.z);
    if (sinHalf > 1e-6) {
      const angle = 2 * Math.atan2(sinHalf, qe.w);
      _e.set(qe.x, qe.y, qe.z).multiplyScalar(angle / sinHalf);
    } else _e.set(0, 0, 0);
    const av = b.angvel();
    _w.set(av.x, av.y, av.z);
    if (parent) {
      const pav = parent.body.angvel();
      _w.x -= pav.x; _w.y -= pav.y; _w.z -= pav.z;
    }
    const I = part.inertia * inertiaMul;
    _e.multiplyScalar(kp).addScaledVector(_w, -kd);
    // Cap angular acceleration so huge errors (e.g. after a big hit) don't explode.
    const maxA = kp * maxAccelK * 0.25;
    if (_e.lengthSq() > maxA * maxA) _e.setLength(maxA);
    _e.multiplyScalar(I * PHYSICS_DT);
    b.applyTorqueImpulse({ x: _e.x, y: _e.y, z: _e.z }, true);
    if (parent && reaction > 0) {
      parent.body.applyTorqueImpulse({ x: -_e.x * reaction, y: -_e.y * reaction, z: -_e.z * reaction }, true);
    }
  }

  /** Go limp: controller off, looser damping. */
  goLimp(): void {
    this.active = false;
    for (const p of this.list) {
      p.body.setAngularDamping(1.2);
      p.body.setLinearDamping(0.2);
    }
  }

  applyImpulseTo(name: PartName, impulse: THREE.Vector3): void {
    this.parts[name].body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
  }

  dispose(): void {
    for (const p of this.list) this.physics.removeBody(p.body);
  }
}
