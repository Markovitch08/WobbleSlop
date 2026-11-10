import * as THREE from 'three';
import type { WeaponDef } from './types';

/** One piece of a weapon, in the weapon frame: grip at origin, business end along +Z. */
export type WeaponPiece =
  | { kind: 'capsuleZ'; r: number; half: number; at: THREE.Vector3; mass: number; color: number; glow?: boolean }
  | { kind: 'box'; hx: number; hy: number; hz: number; at: THREE.Vector3; mass: number; color: number; glow?: boolean }
  | { kind: 'ball'; r: number; at: THREE.Vector3; mass: number; color: number; glow?: boolean };

const WOOD = 0x7a4e26;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function weaponPieces(w: WeaponDef): { pieces: WeaponPiece[]; tip: THREE.Vector3 } {
  const L = w.length;
  const m = w.mass;
  switch (w.shape) {
    case 'club':
      return {
        pieces: [
          { kind: 'capsuleZ', r: 0.035, half: 0.22, at: v(0, 0, 0.12), mass: m * 0.2, color: WOOD },
          { kind: 'capsuleZ', r: 0.11, half: 0.17, at: v(0, 0, L - 0.22), mass: m * 0.8, color: w.color },
        ],
        tip: v(0, 0, L),
      };
    case 'staff':
      return {
        pieces: [
          { kind: 'capsuleZ', r: 0.03, half: L / 2, at: v(0, 0, L / 2 - 0.3), mass: m * 0.7, color: WOOD },
          { kind: 'ball', r: 0.1, at: v(0, 0, L - 0.25), mass: m * 0.3, color: w.color, glow: true },
        ],
        tip: v(0, 0, L - 0.1),
      };
    case 'axe':
      return {
        pieces: [
          { kind: 'capsuleZ', r: 0.03, half: L / 2, at: v(0, 0, L / 2 - 0.1), mass: m * 0.3, color: WOOD },
          { kind: 'box', hx: 0.025, hy: 0.16, hz: 0.11, at: v(0, 0.1, L - 0.18), mass: m * 0.7, color: w.color },
        ],
        tip: v(0, 0.2, L - 0.15),
      };
    case 'spear':
      return {
        pieces: [
          { kind: 'capsuleZ', r: 0.025, half: L / 2, at: v(0, 0, L / 2 - 0.45), mass: m * 0.75, color: WOOD },
          { kind: 'box', hx: 0.03, hy: 0.012, hz: 0.12, at: v(0, 0, L - 0.35), mass: m * 0.25, color: 0xc9ced4 },
        ],
        tip: v(0, 0, L - 0.23),
      };
    case 'sword':
    default: {
      const blade = L - 0.14;
      return {
        pieces: [
          { kind: 'capsuleZ', r: 0.028, half: 0.06, at: v(0, 0, 0), mass: m * 0.15, color: 0x3b2a1a },
          { kind: 'box', hx: 0.12, hy: 0.025, hz: 0.025, at: v(0, 0, 0.1), mass: m * 0.15, color: 0xc9a227 },
          { kind: 'box', hx: 0.045, hy: 0.012, hz: blade / 2, at: v(0, 0, 0.12 + blade / 2), mass: m * 0.7, color: w.color },
        ],
        tip: v(0, 0, L),
      };
    }
  }
}
