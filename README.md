# WobbleSlop

A wobbly 3D physics battle simulator prototype: **Three.js** rendering, **Rapier** physics, TypeScript.
Inspired by how TABS does things (active ragdolls, a battle editor, a unit creator) but with its own units and art.

## Play

```bash
npm install
npm run dev        # dev server with hot reload
npm run build      # -> dist/index.html, ONE self-contained file (wasm inlined), open it directly
npm test           # headless checks: units stand, walk, and an AI battle resolves
```

`dist/index.html` runs straight from disk, so you can double-click it or host it anywhere.
The included workflow `.github/workflows/pages.yml` publishes it to GitHub Pages on every push to `main`
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
| Right- or middle-drag | look (orbit in follow mode) |
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
2. **PD muscles**: each limb is torqued toward a target orientation with
   `τ = I · (kp · angleError − kd · relativeAngularVelocity)`, with an optional reaction torque on the parent.
3. **Procedural gait**: thigh and knee targets follow a sine walk cycle driven by intended and actual speed.
4. **Attacks**: the arm switches between guard, windup and strike poses with stronger muscles on the strike,
   and the weapon tip is pulled toward the target (TABS-like) so swings connect.
5. **Balance, strength and stagger** scale all of the above. Hits add stagger, which weakens the muscles
   for a moment (more wobble). On death the controller switches off, the weapon joint is released, and the unit goes limp.

Physics runs at a fixed 60 Hz (`src/core/Physics.ts`). Self-collision and friendly fire are filtered with
Rapier collision-group bitmasks inside the wasm solver, with no per-contact JS callbacks.

## Architecture

```
src/core/Physics.ts       Rapier world wrapper: fixed step, collider tags, collision groups, events
src/units/types.ts        UnitDef / WeaponDef data model (JSON-serialisable)
src/units/registry.ts     built-in units + custom (localStorage) units, cost estimate
src/units/weapons.ts      weapon registry (sword, club, staff, axe, spear)
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
  Attack styles (`slash`, `overhead`, `cast`) are pose tables in `src/units/Unit.ts`.
- **New creator option**: add a row to `SLIDERS` in `src/ui/Creator.ts`.
- **New map**: write another `create…(): MapData` in `src/world/MapData.ts`.
- **New sound**: add a voice to `src/audio/Sfx.ts`.
