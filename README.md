# WobbleSlop

A wobbly 3D physics battle simulator prototype: **Three.js** rendering, **Rapier** physics, TypeScript.
Inspired by how TABS does things (active ragdolls, a battle editor, a unit creator) but with its own units and art.

## Play

```bash
npm install
npm run dev        # dev server with hot reload
npm run build      # -> dist/index.html, ONE self-contained file (wasm inlined), open it directly
npm test           # headless checks: units stand, walk, limbs stay smooth, and an AI battle resolves
```

`dist/index.html` runs straight from disk, so you can double-click it or host it anywhere.
The included workflow `.github/workflows/pages.yml` publishes it to GitHub Pages on every push to `main` or `claude/focused-gates-ll0kaq`
(turn it on once under **Settings → Pages → Source: GitHub Actions**).

### Modes
- **Battle Editor**: place units (left half is Red, right half is Blue), set a budget, press START. Reset brings your layout back.
- **Auto Battle**: random armies fight forever with a cinematic camera, no player needed. Open `index.html?mode=spectate` to boot straight into it.
- **Unit Creator**: tweak body, stats, weapon, hat and colours with a live physics preview, a sparring partner and a "poke" button. Saved units go to `localStorage` and show up in the editor and in auto battles.
- The menu itself runs a live AI battle in the background.

### Controls
| | |
|---|---|
| WASD / arrows | move camera |
| Right- or middle-drag | look (horizontal inverted; orbit in follow mode) |
| Wheel | dolly / zoom |
| Space or E / Q or Ctrl | up / down |
| Shift | fast |
| Left click / drag | place units (editor) |
| Right click on a unit | remove it |
| 1–9 | choose unit (placement) / 1–4 speed (battle) |
| Enter | start battle |
| C / F | cycle camera mode / follow a random unit |
| P, R | pause, reset to layout |
| H, M, Esc | hide UI, mute, back to menu |

## How the wobble works (`src/units/Ragdoll.ts`)

Every unit is an **active ragdoll**: 11 rigid bodies (pelvis, torso, head, upper and lower arms, thighs, shins with feet)
joined by spherical joints. Nothing is animated kinematically; all motion comes from forces:

1. **Standing handler**: a ray from the pelvis finds the ground. While upright, a spring-damper holds the pelvis
   at standing height like marionette strings, and a **head-up / feet-down** force pair rights the body.
   Both fade out as the unit tips over, so big hits really knock units down.
2. **Stable-PD muscles**: each limb's angular velocity is changed by
   `Δω = dt·(kp·angleError − kd·relativeAngularVelocity) / (1 + dt·kd + dt²·kp)` and applied as an impulse through
   the body's real inertia tensor. The implicit denominator means a limb can never overshoot its target in one step,
   which is what made limbs buzz in the first version. `npm test` measures this (limb "jitter") and fails if it regresses.
   Held weapons ignore gravity while held (a TABS-style "just hold this object" helper), and the weapon arm has a mass
   floor relative to its weapon, so even skinny arms hold heavy weapons steadily.
3. **Procedural gait**: thigh and knee targets follow a sine walk cycle driven by intended and actual speed.
4. **Attacks**: the arm switches between guard, windup and strike poses with stronger muscles on the strike,
   and the weapon tip is pulled toward the target (TABS-like) so swings connect.
5. **Balance, strength and stagger** scale all of the above. Hits add stagger, which weakens the muscles
   for a moment (more wobble). On death the controller switches off, the weapon joint is released, and the unit goes limp.

Physics runs at a fixed 60 Hz with 8 solver iterations (`src/core/Physics.ts`). Rendering interpolates
between physics steps, so motion stays smooth on 120/144 Hz screens and in slow motion. Self-collision and friendly fire are filtered with
Rapier collision-group bitmasks inside the wasm solver, with no per-contact JS callbacks.

## Units, look and body types

| Unit | Build | Weapon | Notes |
|---|---|---|---|
| Sword Guy | athletic | sword | quick slashes |
| Club Guy | heavy brute, 1.2× size | club | slow, huge knockback |
| Magic Guy | tall and skinny | fire staff | exploding fireballs from range |
| Archer | lean | bow | arrows hit exactly what they strike; long range |
| Shield Guy | stocky | mace + round shield | the shield physically blocks swings and arrows |

Style: soft, rounded "toy" characters. Each has a smooth bean torso whose silhouette comes from the body type
(`shoulders`, `belly`), capsule limbs, ball hands, rounded boots, and a big round head with dot eyes and a smile.
Geometries are cached and shared, so the round look costs about the same as simple shapes.
Everything (body shape, weapon, off-hand shield, hat, colours) can be changed in the Unit Creator.

## Architecture

```
src/core/Physics.ts       Rapier world wrapper: fixed step, collider tags, collision groups, events
src/units/types.ts        UnitDef / WeaponDef data model (JSON-serialisable)
src/units/registry.ts     built-in units + custom (localStorage) units, cost estimate
src/units/weapons.ts      weapon registry (sword, club, staff, axe, spear, bow, mace)
src/units/Ragdoll.ts      active ragdoll + balance/muscle controller
src/units/Unit.ts         health, weapon body, attack timeline, projectiles, death
src/ai/Brain.ts           target selection, spacing, ranged kiting, attack trigger
src/battle/Battle.ts      simulation (no DOM): placement, stepping, combat, explosions, win check
src/world/MapData.ts      terrain height function + props, physics colliders
src/render/*              Three.js views: terrain, units, effects, camera controller
src/audio/Sfx.ts          procedural WebAudio sound effects (no audio files)
src/ui/*                  menu/editor HUD (in main.ts) and the Unit Creator
scripts/sim.ts            headless simulation + checks
```

### Extending
- **New unit**: `registerUnit({...})` in `src/units/registry.ts`, or build one in the Unit Creator.
- **New weapon**: `registerWeapon({...})` in `src/units/weapons.ts` and give it a shape in `src/units/weaponShapes.ts`.
  Attack styles (`slash`, `overhead`, `cast`, `shoot`) are pose tables in `src/units/Unit.ts`.
  Projectiles are either `fireball` (explodes) or `arrow` (direct hit).
- **New off-hand item**: add it to `offhandPieces` in `src/units/weaponShapes.ts` and to `OffhandId`.
- **New creator option**: add a row to `SLIDERS` in `src/ui/Creator.ts`.
- **New map**: write another `create…(): MapData` in `src/world/MapData.ts`.
- **New sound**: add a voice to `src/audio/Sfx.ts`.
