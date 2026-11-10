import * as THREE from 'three';
import type { Unit } from '../units/Unit';
import { PHYSICS_DT } from '../core/Physics';

const _sep = new THREE.Vector3();

/**
 * Simple battle AI: pick the nearest enemy, close to weapon range (or keep
 * distance for ranged units), face it and attack when ready. Runs every
 * physics step, so battles play out with no human input at all.
 */
export function think(u: Unit, units: Unit[], battleOver: boolean): void {
  if (!u.alive) return;
  const rd = u.ragdoll;
  u.aiTimer -= PHYSICS_DT;
  const me = u.pos;

  if (u.aiTimer <= 0 || !u.target || !u.target.alive) {
    u.aiTimer = 0.35 + Math.random() * 0.25;
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const o of units) {
      if (!o.alive || o.team === u.team) continue;
      const p = o.pos;
      const d = (p.x - me.x) ** 2 + (p.z - me.z) ** 2;
      if (d < bestD) { bestD = d; best = o; }
    }
    u.target = best;
  }

  const tgt = u.target;
  if (!tgt) {
    rd.moveVel.set(0, 0, 0);
    u.cheering = battleOver;
    return;
  }
  u.cheering = false;

  const tp = tgt.pos;
  const dx = tp.x - me.x;
  const dz = tp.z - me.z;
  const dist = Math.hypot(dx, dz) || 0.001;
  const nx = dx / dist;
  const nz = dz / dist;
  rd.faceYaw = Math.atan2(nx, nz);

  const speed = u.def.stats.speed;
  let want = 0;
  if (u.isRanged) {
    if (dist > u.range * 0.85) want = speed;
    else if (dist < u.range * 0.4) want = -speed * 0.7;
  } else {
    if (dist > u.range * 0.8) want = speed;
    else if (dist < u.range * 0.45) want = -speed * 0.25;
  }
  // Slow down while swinging so attacks have weight.
  if (u.attackState !== 'ready') want *= 0.35;

  // Light separation from allies so blobs spread out a bit.
  _sep.set(0, 0, 0);
  for (const o of units) {
    if (o === u || !o.alive || o.team !== u.team) continue;
    const p = o.pos;
    const ox = me.x - p.x;
    const oz = me.z - p.z;
    const d2 = ox * ox + oz * oz;
    if (d2 < 1.0 && d2 > 1e-4) {
      const d = Math.sqrt(d2);
      _sep.x += (ox / d) * (1 - d);
      _sep.z += (oz / d) * (1 - d);
    }
  }
  rd.moveVel.set(nx * want + _sep.x * 1.5, 0, nz * want + _sep.z * 1.5);

  if (dist <= u.range && u.canAttack()) u.startAttack(tgt);
}
