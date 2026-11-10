import type { Battle } from './Battle';
import { allUnits } from '../units/registry';
import { ZONE } from '../render/MapView';

/**
 * Fill a team with random units up to a budget, in a loose formation:
 * melee in front, ranged at the back.
 */
export function randomArmy(battle: Battle, team: number, budget: number, rand = Math.random): void {
  const defs = allUnits();
  const picks: typeof defs = [];
  let spent = battle.teamCost(team);
  for (let tries = 0; tries < 200; tries++) {
    const d = defs[Math.floor(rand() * defs.length)];
    if (spent + d.cost > budget) continue;
    picks.push(d);
    spent += d.cost;
  }
  picks.sort((a, b) => (a.role === b.role ? 0 : a.role === 'melee' ? -1 : 1));
  const perRow = Math.max(4, Math.ceil(Math.sqrt(picks.length * 2)));
  const side = team === 0 ? -1 : 1;
  const startX = 9 + rand() * 4;
  picks.forEach((d, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const z = (col - (perRow - 1) / 2) * 1.6 + (rand() - 0.5) * 0.5;
    const x = side * Math.min(ZONE.maxX - 1, startX + row * 1.9 + (rand() - 0.5) * 0.4);
    battle.addUnit(d, team, x, Math.max(-ZONE.halfZ, Math.min(ZONE.halfZ, z)));
  });
}
