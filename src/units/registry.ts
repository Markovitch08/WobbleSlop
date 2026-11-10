import { DEFAULT_BODY, type UnitDef } from './types';
import { getWeapon } from './weapons';

const STORAGE_KEY = 'wobbleslop.customUnits.v1';
const builtins = new Map<string, UnitDef>();
const customs = new Map<string, UnitDef>();

export function registerUnit(def: UnitDef): void {
  builtins.set(def.id, def);
}

export function getUnit(id: string): UnitDef | undefined {
  return customs.get(id) ?? builtins.get(id);
}

export function allUnits(): UnitDef[] {
  return [...builtins.values(), ...customs.values()];
}

/** Cost estimate for creator-made units, so stronger builds cost more. */
export function estimateCost(def: UnitDef): number {
  const w = getWeapon(def.weapon);
  const dps = (w.projectile ? w.projectile.damage * 1.4 : w.damage) / (w.cooldown + w.windup + w.strike);
  const s = def.stats;
  const raw = (s.health / 100) * 40 + dps * 1.4 + s.speed * 6 + s.balance * 15 + s.strength * 15 + def.body.size * 25;
  return Math.max(20, Math.round((raw * 0.63) / 10) * 10);
}

export function saveCustomUnit(def: UnitDef): void {
  customs.set(def.id, { ...def, custom: true });
  persist();
}

export function deleteCustomUnit(id: string): void {
  customs.delete(id);
  persist();
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...customs.values()]));
  } catch {
    /* storage unavailable: customs live for this session only */
  }
}

export function loadCustomUnits(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    for (const d of JSON.parse(raw) as UnitDef[]) {
      if (d && typeof d.id === 'string') customs.set(d.id, { ...d, body: { ...DEFAULT_BODY, ...d.body }, custom: true });
    }
  } catch {
    /* ignore corrupt or unavailable storage */
  }
}

// Three distinct builds: athletic swordsman, stocky heavy brute, tall skinny mage.
registerUnit({
  id: 'sword', name: 'Sword Guy', description: 'Athletic all-rounder. Quick slashes.', cost: 100,
  role: 'melee', weapon: 'sword',
  body: { ...DEFAULT_BODY, size: 1.0, shoulders: 1.3, belly: 0.85, torsoWidth: 1.0, legLength: 1.0 },
  stats: { health: 100, speed: 3.2, balance: 1, strength: 1 },
  look: { skin: 0xf2c79c, hat: 'helmet' },
});
registerUnit({
  id: 'club', name: 'Club Guy', description: 'Big, slow, sends people flying.', cost: 140,
  role: 'melee', weapon: 'club',
  body: { ...DEFAULT_BODY, size: 1.2, mass: 1.4, torsoWidth: 1.3, shoulders: 1.15, belly: 1.45, limbThickness: 1.4, legLength: 0.82, armLength: 1.1, headSize: 0.85 },
  stats: { health: 170, speed: 2.5, balance: 1.15, strength: 1.4 },
  look: { skin: 0xd9a27a, hat: 'viking' },
});
registerUnit({
  id: 'magic', name: 'Magic Guy', description: 'Lobs exploding fireballs from range. Fragile.', cost: 180,
  role: 'ranged', weapon: 'staff',
  body: { ...DEFAULT_BODY, size: 0.92, mass: 0.8, torsoWidth: 0.78, shoulders: 0.9, belly: 0.95, limbThickness: 0.72, legLength: 1.2, armLength: 1.12, headSize: 1.15 },
  stats: { health: 70, speed: 2.8, balance: 0.85, strength: 0.8 },
  look: { skin: 0xf6d5b5, hat: 'wizard' },
});
