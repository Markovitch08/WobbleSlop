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
  projectile: { kind: 'fireball', speed: 15, radius: 0.18, gravityScale: 0.35, damage: 42, blastRadius: 2.4, blastImpulse: 60, color: 0xff7a1a },
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
registerWeapon({
  id: 'bow', name: 'Bow', shape: 'bow', length: 0.6, mass: 0.8,
  damage: 4, knockback: 4, cooldown: 1.1, windup: 0.7, strike: 0.2,
  style: 'shoot', range: 16, color: 0x8a5a2b,
  projectile: { kind: 'arrow', speed: 26, radius: 0.05, gravityScale: 1, damage: 30, blastRadius: 0, blastImpulse: 14, color: 0xe8e0c8 },
});
registerWeapon({
  id: 'mace', name: 'Mace', shape: 'mace', length: 0.75, mass: 3.2,
  damage: 30, knockback: 26, cooldown: 0.75, windup: 0.35, strike: 0.24,
  style: 'overhead', range: 1.7, color: 0x9aa3ad,
});
