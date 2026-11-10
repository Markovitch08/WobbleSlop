/**
 * Data model for units. Everything a unit is — body, stats, weapon, look, AI —
 * lives in a plain JSON-serialisable UnitDef, so the Unit Creator can build new
 * ones and save them without code. To add a unit in code, register a UnitDef
 * in registry.ts; to add a weapon, register a WeaponDef in weapons.ts.
 */

export type AttackStyle = 'slash' | 'overhead' | 'cast';
export type WeaponShape = 'sword' | 'club' | 'staff' | 'axe' | 'spear';
export type HatId = 'none' | 'helmet' | 'wizard' | 'cap' | 'viking' | 'crown';
export type AiRole = 'melee' | 'ranged';

export interface ProjectileDef {
  speed: number;
  radius: number;
  gravityScale: number;
  damage: number;
  /** Explosion radius; 0 = single target. */
  blastRadius: number;
  blastImpulse: number;
  color: number;
}

export interface WeaponDef {
  id: string;
  name: string;
  shape: WeaponShape;
  /** Grip-to-tip length in metres. */
  length: number;
  mass: number;
  damage: number;
  /** Impulse applied to whatever it hits, per unit of damage multiplier. */
  knockback: number;
  /** Seconds between attacks (after recovery). */
  cooldown: number;
  windup: number;
  strike: number;
  style: AttackStyle;
  /** How far ahead of the wielder the attack is started (metres from pelvis). */
  range: number;
  color: number;
  projectile?: ProjectileDef;
}

export interface BodyParams {
  /** Uniform scale of the whole body. */
  size: number;
  /** Multiplier on all part masses. */
  mass: number;
  headSize: number;
  torsoWidth: number;
  limbThickness: number;
  legLength: number;
  armLength: number;
  /** Visual torso shape: width at the shoulders and at the belly (1 = neutral). */
  shoulders: number;
  belly: number;
}

export interface UnitStats {
  health: number;
  /** Top walking speed (m/s). */
  speed: number;
  /** 0..2 — how hard the unit fights to stay upright. Low = wobblier. */
  balance: number;
  /** 0..2 — arm/weapon swing strength. */
  strength: number;
}

export interface Appearance {
  skin: number;
  hat: HatId;
  /** Optional fixed shirt colour; if omitted the team colour is used. */
  shirt?: number;
}

export interface UnitDef {
  id: string;
  name: string;
  description: string;
  cost: number;
  role: AiRole;
  weapon: string;
  body: BodyParams;
  stats: UnitStats;
  look: Appearance;
  custom?: boolean;
}

export const DEFAULT_BODY: BodyParams = {
  size: 1, mass: 1, headSize: 1, torsoWidth: 1, limbThickness: 1, legLength: 1, armLength: 1, shoulders: 1, belly: 1,
};
