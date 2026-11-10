import * as THREE from 'three';
import type { Game } from '../main';
import { allUnits, deleteCustomUnit, estimateCost, getUnit, saveCustomUnit } from '../units/registry';
import { allWeapons, getWeapon } from '../units/weapons';
import { DEFAULT_BODY, type HatId, type UnitDef } from '../units/types';
import type { Unit } from '../units/Unit';
import { sfx } from '../audio/Sfx';
import { h, hex, unhex } from './dom';

const HATS: HatId[] = ['none', 'helmet', 'viking', 'wizard', 'cap', 'crown'];

interface Slider { key: string; label: string; min: number; max: number; step: number; get(d: UnitDef): number; set(d: UnitDef, v: number): void }

/** Slider table — add a row here to expose a new UnitDef field in the creator. */
const SLIDERS: Slider[] = [
  { key: 'size', label: 'Size', min: 0.6, max: 1.6, step: 0.05, get: (d) => d.body.size, set: (d, v) => { d.body.size = v; } },
  { key: 'mass', label: 'Heaviness', min: 0.5, max: 2.5, step: 0.05, get: (d) => d.body.mass, set: (d, v) => { d.body.mass = v; } },
  { key: 'head', label: 'Head size', min: 0.6, max: 1.8, step: 0.05, get: (d) => d.body.headSize, set: (d, v) => { d.body.headSize = v; } },
  { key: 'torso', label: 'Chonk', min: 0.7, max: 1.6, step: 0.05, get: (d) => d.body.torsoWidth, set: (d, v) => { d.body.torsoWidth = v; } },
  { key: 'limb', label: 'Limb thickness', min: 0.6, max: 1.6, step: 0.05, get: (d) => d.body.limbThickness, set: (d, v) => { d.body.limbThickness = v; } },
  { key: 'legs', label: 'Leg length', min: 0.7, max: 1.4, step: 0.05, get: (d) => d.body.legLength, set: (d, v) => { d.body.legLength = v; } },
  { key: 'arms', label: 'Arm length', min: 0.7, max: 1.5, step: 0.05, get: (d) => d.body.armLength, set: (d, v) => { d.body.armLength = v; } },
  { key: 'hp', label: 'Health', min: 20, max: 600, step: 10, get: (d) => d.stats.health, set: (d, v) => { d.stats.health = v; } },
  { key: 'speed', label: 'Speed', min: 1, max: 6, step: 0.1, get: (d) => d.stats.speed, set: (d, v) => { d.stats.speed = v; } },
  { key: 'bal', label: 'Balance', min: 0.3, max: 2, step: 0.05, get: (d) => d.stats.balance, set: (d, v) => { d.stats.balance = v; } },
  { key: 'str', label: 'Strength', min: 0.3, max: 2.5, step: 0.05, get: (d) => d.stats.strength, set: (d, v) => { d.stats.strength = v; } },
];

function clone(d: UnitDef): UnitDef {
  return JSON.parse(JSON.stringify(d)) as UnitDef;
}

/**
 * Unit Creator: edit a UnitDef with live physics preview, then save it.
 * Saved units appear in the Battle Editor and in Auto Battles.
 */
export class Creator {
  private root: HTMLDivElement | null = null;
  private draft: UnitDef;
  private preview: Unit | null = null;
  private dirty = 0;
  private sparring = false;

  constructor(private readonly game: Game) {
    this.draft = this.fromTemplate('sword');
  }

  private fromTemplate(id: string): UnitDef {
    const base = clone(getUnit(id) ?? allUnits()[0]);
    return { ...base, id: '', name: base.custom ? base.name : `My ${base.name}`, custom: true, body: { ...DEFAULT_BODY, ...base.body } };
  }

  show(): void {
    this.sparring = false;
    this.game.cam.setView(new THREE.Vector3(4.2, 2.2, 1.6), new THREE.Vector3(0, 1.1, 0));
    this.rebuildPreview();
    this.render();
  }

  hide(): void {
    this.root?.remove();
    this.root = null;
    this.preview = null;
  }

  update(dt: number): void {
    if (!this.root) return;
    if (this.dirty > 0) {
      this.dirty -= dt;
      if (this.dirty <= 0) this.rebuildPreview();
    }
    // Keep the preview unit facing the camera.
    const u = this.preview;
    if (u && u.alive && !this.sparring) {
      const p = u.pos;
      const c = this.game.r.camera.position;
      u.ragdoll.faceYaw = Math.atan2(c.x - p.x, c.z - p.z);
    }
  }

  private rebuildPreview(): void {
    const b = this.game.battle;
    b.load([]);
    b.startSandbox();
    this.draft.cost = estimateCost(this.draft);
    this.preview = b.addUnit(this.draft, 0, 0, 0, false);
    if (this.sparring) b.addUnit('sword', 1, 4, 0, false);
  }

  private changed(rebuildUi = false): void {
    this.dirty = 0.25;
    this.draft.cost = estimateCost(this.draft);
    const c = this.root?.querySelector('.cost');
    if (c) c.textContent = `Cost: ${this.draft.cost} 🪙`;
    if (rebuildUi) this.render();
  }

  private render(): void {
    this.root?.remove();
    const d = this.draft;
    const root = h('div', { id: 'creator', class: 'panel' });
    this.root = root;

    const nameIn = h('input', { type: 'text', value: d.name, maxlength: 24 }) as HTMLInputElement;
    nameIn.addEventListener('input', () => { d.name = nameIn.value || 'Unnamed'; });

    const tmpl = h('select', {}, h('option', { value: '' }, 'Start from…'), ...allUnits().map((u) => h('option', { value: u.id }, u.name)));
    tmpl.addEventListener('change', () => {
      if (!tmpl.value) return;
      const keepId = d.id;
      this.draft = this.fromTemplate(tmpl.value);
      if (getUnit(tmpl.value)?.custom) this.draft.id = tmpl.value;
      else this.draft.id = keepId && getUnit(keepId)?.custom ? keepId : '';
      this.changed(true);
    });

    const weaponSel = h('select', {}, ...allWeapons().map((w) => h('option', { value: w.id, selected: w.id === d.weapon }, w.name)));
    weaponSel.addEventListener('change', () => {
      d.weapon = weaponSel.value;
      d.role = getWeapon(d.weapon).projectile ? 'ranged' : 'melee';
      this.changed();
    });
    const hatSel = h('select', {}, ...HATS.map((x) => h('option', { value: x, selected: x === d.look.hat }, x)));
    hatSel.addEventListener('change', () => { d.look.hat = hatSel.value as HatId; this.changed(); });
    const skin = h('input', { type: 'color', value: hex(d.look.skin) }) as HTMLInputElement;
    skin.addEventListener('input', () => { d.look.skin = unhex(skin.value); this.changed(); });
    const shirtOn = h('input', { type: 'checkbox', checked: d.look.shirt !== undefined }) as HTMLInputElement;
    const shirt = h('input', { type: 'color', value: hex(d.look.shirt ?? 0x888888) }) as HTMLInputElement;
    const shirtUpd = () => { d.look.shirt = shirtOn.checked ? unhex(shirt.value) : undefined; this.changed(); };
    shirtOn.addEventListener('change', shirtUpd);
    shirt.addEventListener('input', shirtUpd);

    root.append(
      h('h2', {}, '🛠️ Unit Creator'),
      h('label', { class: 'wide' }, 'Name', nameIn),
      h('label', { class: 'wide' }, 'Template', tmpl),
      h('label', { class: 'wide' }, 'Weapon', weaponSel),
      h('label', { class: 'wide' }, 'Hat', hatSel),
      h('label', { class: 'wide' }, 'Skin', skin),
      h('label', { class: 'wide' }, 'Fixed shirt', h('span', {}, shirtOn, ' ', shirt)),
      h('div', { class: 'hint' }, 'Without a fixed shirt the unit wears its team colour.'),
    );
    for (const s of SLIDERS) {
      const val = h('span', { class: 'val' }, fmt(s.get(d)));
      const input = h('input', { type: 'range', min: s.min, max: s.max, step: s.step, value: String(s.get(d)) }) as HTMLInputElement;
      input.addEventListener('input', () => {
        s.set(d, Number(input.value));
        val.textContent = fmt(Number(input.value));
        this.changed();
      });
      root.append(h('label', {}, s.label, input, val));
    }
    root.append(
      h('div', { class: 'cost' }, `Cost: ${estimateCost(d)} 🪙`),
      h('div', { class: 'btns' },
        h('button', { class: 'primary', onclick: () => this.save() }, '💾 Save'),
        h('button', { onclick: () => this.click(() => { this.sparring = !this.sparring; this.rebuildPreview(); }) }, this.sparring ? '🙅 No sparring' : '🥊 Sparring partner'),
        h('button', { onclick: () => this.click(() => this.poke()) }, '👉 Poke'),
        h('button', { onclick: () => this.click(() => { this.draft = this.fromTemplate('sword'); this.changed(true); }) }, '✨ New'),
        h('button', { onclick: () => this.click(() => this.game.enterMenu()) }, '⌂ Menu'),
      ),
      h('div', { class: 'hint' }, 'Right-drag to look around, WASD to move. Saved units show up in the Battle Editor and Auto Battles.'),
      h('h3', {}, 'Saved units'),
    );
    const customs = allUnits().filter((u) => u.custom);
    if (!customs.length) root.append(h('div', { class: 'hint' }, 'None yet.'));
    for (const u of customs) {
      root.append(h('div', { class: 'saved' },
        h('span', {}, `${u.name} (${u.cost})`),
        h('span', {},
          h('button', { onclick: () => this.click(() => { this.draft = clone(u); this.changed(true); }) }, 'Edit'), ' ',
          h('button', { class: 'red', onclick: () => this.click(() => { deleteCustomUnit(u.id); if (this.draft.id === u.id) this.draft.id = ''; this.render(); }) }, '✕'),
        ),
      ));
    }
    this.game.ui.append(root);
  }

  private click(fn: () => void): void {
    sfx.unlock();
    sfx.play('click');
    fn();
  }

  private poke(): void {
    const u = this.preview;
    if (!u) return;
    const dir = new THREE.Vector3(Math.random() - 0.5, 0.3, Math.random() - 0.5).normalize();
    u.ragdoll.applyImpulseTo('torso', dir.multiplyScalar(u.ragdoll.totalMass * 3));
    u.ragdoll.stagger = 0.6;
    sfx.play('hitClub', u.pos);
  }

  private save(): void {
    sfx.unlock();
    const d = this.draft;
    if (!d.id) d.id = `custom-${Date.now().toString(36)}`;
    d.cost = estimateCost(d);
    d.description = `Custom ${getWeapon(d.weapon).name.toLowerCase()} unit.`;
    saveCustomUnit(clone(d));
    sfx.play('victory');
    this.render();
  }
}

const fmt = (v: number) => (Math.abs(v) >= 10 ? String(Math.round(v)) : v.toFixed(2));
