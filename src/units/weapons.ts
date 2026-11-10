import type { WeaponDef } from './types';

const weapons = new Map<string, WeaponDef>();

export function registerWeapon(w: WeaponDef): void {
  weapons.set(w.id, w);
}
export function getWeapon(id: string): WeaponDef {
  return weapons.get(id) ?? weapons.get('sword')!;
}
export function allWeapons(): WeaponDef[] {
  return [...weapons.values()];
}

registerWeapon({
  id: 'sword', name: 'Sword', shape: 'sword', length: 1.0, mass: 2.5,
  damage: 34, knockback: 18, cooldown: 0.55, windup: 0.3, strike: 0.22,
  style: 'slash', range: 1.9, color: 0xd8dde3,
});
registerWeapon({
  id: 'club', name: 'Club', shape: 'club', length: 0.95, mass: 6,
  damage: 48, knockback: 55, cooldown: 0.9, windup: 0.5, strike: 0.28,
  style: 'overhead', range: 1.9, color: 0x8a5a2b,
});
registerWeapon({
  id: 'staff', name: 'Fire Staff', shape: 'staff', length: 1.3, mass: 1.5,
  damage: 8, knockback: 6, cooldown: 2.1, windup: 0.55, strike: 0.25,
  style: 'cast', range: 12, color: 0x6b4ba8,
  projectile: { speed: 15, radius: 0.18, gravityScale: 0.35, damage: 42, blastRadius: 2.4, blastImpulse: 60, color: 0xff7a1a },
});
registerWeapon({
  id: 'axe', name: 'Axe', shape: 'axe', length: 0.9, mass: 4,
  damage: 42, knockback: 30, cooldown: 0.75, windup: 0.4, strike: 0.25,
  style: 'overhead', range: 1.85, color: 0xb0b6bd,
});
registerWeapon({
  id: 'spear', name: 'Spear', shape: 'spear', length: 1.8, mass: 2.5,
  damage: 30, knockback: 22, cooldown: 0.7, windup: 0.3, strike: 0.22,
  style: 'slash', range: 2.5, color: 0x9a7b4f,
});
