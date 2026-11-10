/**
 * Headless battle simulation: no renderer, no browser, no player.
 *   npm run sim            -> balance/walk checks + a random battle, prints PASS/FAIL
 */
import { initRapier, PHYSICS_HZ } from '../src/core/Physics';
import { Battle } from '../src/battle/Battle';
import { createGrassyPlains } from '../src/world/MapData';
import { allUnits } from '../src/units/registry';

await initRapier();
const map = createGrassyPlains();
let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
  if (!ok) failures++;
};

// 1. Each unit type stands on its own for 6 seconds.
for (const def of allUnits()) {
  const b = new Battle(map);
  const u = b.addUnit(def, 0, 0, 0)!;
  b.start();
  let minUp = 1;
  let minHead = Infinity;
  for (let i = 0; i < PHYSICS_HZ * 6; i++) {
    b.stepOnce();
    if (i > PHYSICS_HZ) {
      minUp = Math.min(minUp, u.ragdoll.uprightness());
      minHead = Math.min(minHead, u.ragdoll.pos('head').y);
    }
  }
  const standH = u.ragdoll.layout.height;
  check(`${def.id} stands`, minUp > 0.85 && minHead > standH * 0.8, `minUpright=${minUp.toFixed(2)} minHead=${minHead.toFixed(2)}/${standH.toFixed(2)}`);
  b.dispose();
}

// 2. Each unit type walks toward a distant enemy without falling over.
for (const def of allUnits()) {
  const b = new Battle(map);
  const u = b.addUnit(def, 0, -20, 0)!;
  b.addUnit('sword', 1, 25, 0);
  b.start();
  let minUp = 1;
  for (let i = 0; i < PHYSICS_HZ * 4; i++) {
    b.stepOnce();
    if (i > PHYSICS_HZ * 0.5) minUp = Math.min(minUp, u.ragdoll.uprightness());
  }
  const moved = u.pos.x + 20;
  const expect = def.stats.speed * 3.5 * 0.55;
  check(`${def.id} walks`, moved > expect && minUp > 0.6, `moved=${moved.toFixed(2)}m (>${expect.toFixed(1)}) minUpright=${minUp.toFixed(2)}`);
  b.dispose();
}

// 3. Limbs move smoothly: mean per-step change in limb angular velocity (rad/s) while walking.
//    The old explicit PD controller scored ~50 here (limbs buzzing); smooth is well under 3.
for (const def of allUnits()) {
  const b = new Battle(map);
  const u = b.addUnit(def, 0, -20, 0)!;
  b.addUnit('sword', 1, 30, 0);
  b.start();
  const prev = new Map<unknown, number[]>();
  let sum = 0;
  let n = 0;
  for (let i = 0; i < PHYSICS_HZ * 4; i++) {
    b.stepOnce();
    if (i < PHYSICS_HZ) continue;
    for (const body of [...u.ragdoll.list.map((p) => p.body), u.weaponBody]) {
      const w = body.angvel();
      const pr = prev.get(body);
      if (pr) { sum += Math.hypot(w.x - pr[0], w.y - pr[1], w.z - pr[2]); n++; }
      prev.set(body, [w.x, w.y, w.z]);
    }
  }
  const jitter = sum / n;
  check(`${def.id} limbs smooth`, jitter < 3, `jitter=${jitter.toFixed(2)} rad/s per step`);
  b.dispose();
}

// 4. A full AI-vs-AI battle resolves with a winner.
{
  const b = new Battle(map);
  const ids = allUnits().map((d) => d.id);
  for (let i = 0; i < 6; i++) {
    b.addUnit(ids[i % ids.length], 0, -12 - (i % 2) * 2, -6 + i * 2.2);
    b.addUnit(ids[(i + 1) % ids.length], 1, 12 + (i % 2) * 2, -6 + i * 2.2);
  }
  let hits = 0, deaths = 0, casts = 0;
  (b.hooks as { onEvent?: (e: { type: string }) => void }).onEvent = (e) => {
    if (e.type === 'hit') hits++;
    if (e.type === 'death') deaths++;
    if (e.type === 'cast') casts++;
  };
  b.start();
  const t0 = performance.now();
  while (b.phase === 'battle' && b.time < 120) b.stepOnce();
  const ms = performance.now() - t0;
  const label = b.winner === null ? 'none' : b.winner === 0 ? 'Red' : 'Blue';
  check('battle resolves', b.phase === 'over', `winner=${label} simTime=${b.time.toFixed(1)}s wall=${(ms / 1000).toFixed(1)}s hits=${hits} casts=${casts} deaths=${deaths}`);
  b.dispose();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
