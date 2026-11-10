import * as THREE from 'three';
import { initRapier } from './core/Physics';
import { Renderer } from './render/Renderer';
import { MapView, TEAM_COLORS, zoneTeam } from './render/MapView';
import { createGrassyPlains } from './world/MapData';
import { Battle, TEAM_NAMES, type Placement } from './battle/Battle';
import { randomArmy } from './battle/armies';
import { UnitView, buildStaticUnit } from './render/UnitView';
import { Effects, ProjectileView } from './render/Effects';
import { CameraController } from './render/CameraController';
import { sfx } from './audio/Sfx';
import { allUnits, loadCustomUnits } from './units/registry';
import type { UnitDef } from './units/types';
import type { BattleEvent, Unit } from './units/Unit';
import { h } from './ui/dom';
import { Creator } from './ui/Creator';

type Mode = 'menu' | 'editor' | 'spectate' | 'creator';

const ICONS: Record<string, string> = { sword: '🗡️', club: '🏏', staff: '🔮', axe: '🪓', spear: '🔱' };
const BUDGETS = [500, 1000, 1500, 3000, 6000];

export class Game {
  readonly r: Renderer;
  readonly map = createGrassyPlains();
  readonly mapView: MapView;
  readonly battle: Battle;
  readonly cam: CameraController;
  readonly effects: Effects;
  readonly ui = document.getElementById('ui')!;
  mode: Mode = 'menu';
  private last = performance.now();
  private readonly raycaster = new THREE.Raycaster();
  private readonly mouse = new THREE.Vector2();

  // editor state
  selected: UnitDef = allUnits()[0];
  budget = 1500;
  private ghost: THREE.Group | null = null;
  private ghostKey = '';
  private painting = false;
  private lastPaint = new THREE.Vector3(1e9, 0, 0);
  private savedLayout: Placement[] = [];
  private announced = false;
  private overTimer = 0;
  autoRound = 0;
  private hudHidden = false;

  // HUD elements
  private hud!: HTMLDivElement;
  private creator: Creator;

  constructor() {
    this.r = new Renderer(document.body);
    this.mapView = new MapView(this.map);
    this.r.scene.add(this.mapView.group);
    this.effects = new Effects(this.r.scene);
    this.battle = new Battle(this.map, {
      onUnitCreated: (u) => new UnitView(u, this.r.scene),
      onProjectileCreated: (p) => new ProjectileView(p, this.r.scene),
      onEvent: (e) => this.onBattleEvent(e),
    });
    this.cam = new CameraController(this.r.camera, this.r.renderer.domElement, this.map.heightAt);
    this.creator = new Creator(this);
    this.bindInput();
    const params = new URLSearchParams(location.search);
    if (params.get('mode') === 'spectate') this.enterSpectate();
    else this.enterMenu();
    requestAnimationFrame(this.frame);
  }

  // ================================================================ modes
  private clearUi(): void {
    this.ui.innerHTML = '';
    this.creator.hide();
    this.setGhost(null);
    this.mapView.zones.visible = false;
  }

  enterMenu(): void {
    this.mode = 'menu';
    this.clearUi();
    this.newAutoBattle();
    this.cam.cinematic();
    const title = h('h1', { id: 'title' });
    for (const [i, ch] of [...'WOBBLESLOP'].entries()) {
      const s = h('span', {}, ch);
      s.style.animationDelay = `${i * 0.09}s`;
      title.append(s);
    }
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: String(sfx.getVolume()) }) as HTMLInputElement;
    vol.addEventListener('input', () => sfx.setVolume(Number(vol.value)));
    this.ui.append(h('div', { id: 'menu' },
      title,
      h('p', { id: 'subtitle' }, 'a wobbly physics battle simulator'),
      h('button', { class: 'primary', onclick: () => this.go(() => this.enterEditor()) }, '⚔️ Battle Editor'),
      h('button', { onclick: () => this.go(() => this.enterSpectate()) }, '🎥 Auto Battle'),
      h('button', { onclick: () => this.go(() => this.enterCreator()) }, '🛠️ Unit Creator'),
      h('div', { class: 'row' }, '🔊', vol),
    ));
  }

  /** Every button press unlocks audio (browser autoplay rule) and clicks. */
  private go(fn: () => void): void {
    sfx.unlock();
    sfx.play('click');
    fn();
  }

  enterEditor(keepLayout = false): void {
    this.mode = 'editor';
    this.clearUi();
    this.battle.timeScale = 1;
    this.battle.load(keepLayout ? this.savedLayout : []);
    this.announced = false;
    this.cam.setView(new THREE.Vector3(0, 22, 30), new THREE.Vector3(0, 0, 2));
    this.buildEditorHud();
  }

  enterSpectate(): void {
    this.mode = 'spectate';
    this.clearUi();
    this.newAutoBattle();
    this.cam.cinematic();
    this.hud = h('div');
    this.ui.append(this.hud);
    this.hud.append(
      h('div', { id: 'topbar', class: 'bar panel' },
        h('div', { class: 'teamstat r', id: 'rstat' }),
        h('div', { id: 'clock' }),
        h('div', { class: 'teamstat b', id: 'bstat' }),
      ),
      h('div', { id: 'sidebar', class: 'bar' },
        h('button', { onclick: () => this.go(() => this.newAutoBattle()) }, '⏭ Next'),
        this.speedButtons(),
        h('button', { id: 'cambtn', onclick: () => this.go(() => this.cycleCamera()) }, '🎥 Camera'),
        h('button', { onclick: () => this.go(() => this.enterMenu()) }, '⌂ Menu'),
      ),
      h('div', { id: 'help' }, 'Auto Battle: random armies fight forever, no player needed. ', h('br'), 'C: camera mode • F: follow a unit • WASD + right-drag: fly • H: hide UI • M: mute'),
      h('div', { id: 'toast' }),
    );
  }

  enterCreator(): void {
    this.mode = 'creator';
    this.clearUi();
    this.battle.timeScale = 1;
    this.creator.show();
  }

  newAutoBattle(): void {
    this.autoRound++;
    this.battle.timeScale = 1;
    this.battle.load([]);
    const budget = 600 + Math.floor(Math.random() * 6) * 200;
    randomArmy(this.battle, 0, budget);
    randomArmy(this.battle, 1, budget);
    this.battle.start();
    this.announced = false;
    this.overTimer = 0;
    if (this.mode !== 'menu') sfx.play('start');
    this.toast(`Battle #${this.autoRound}`);
  }

  // ================================================================ editor HUD
  private buildEditorHud(): void {
    this.hud = h('div');
    this.ui.append(this.hud);
    const budgetSel = h('select', {
      onchange: (e: Event) => { this.budget = Number((e.target as HTMLSelectElement).value); },
    }, ...BUDGETS.map((b) => h('option', { value: String(b), selected: b === this.budget }, `Budget ${b}`)),
      h('option', { value: '999999', selected: this.budget === 999999 }, 'Unlimited'));
    this.hud.append(
      h('div', { id: 'topbar', class: 'bar panel' },
        h('div', { class: 'teamstat r', id: 'rstat' }),
        h('div', { id: 'clock' }),
        h('div', { class: 'teamstat b', id: 'bstat' }),
      ),
      h('div', { id: 'sidebar', class: 'bar' }),
      h('div', { id: 'unitbar', class: 'bar panel' }),
      h('div', { id: 'help' }),
      h('div', { id: 'toast' }),
    );
    this.hud.querySelector('#sidebar')!.append(budgetSel);
    this.refreshEditorHud();
  }

  /** Rebuilds the context-sensitive parts of the editor HUD (placement vs battle). */
  refreshEditorHud(): void {
    if (this.mode !== 'editor') return;
    const side = this.hud.querySelector('#sidebar')!;
    const select = side.querySelector('select');
    side.innerHTML = '';
    const unitbar = this.hud.querySelector('#unitbar') as HTMLElement;
    const help = this.hud.querySelector('#help')!;
    const placing = this.battle.phase === 'placement';
    this.mapView.zones.visible = placing;
    unitbar.classList.toggle('hidden', !placing);
    if (placing) {
      if (select) side.append(select);
      side.append(
        h('button', { class: 'primary', onclick: () => this.go(() => this.startBattle()) }, '▶ START'),
        h('button', { onclick: () => this.go(() => this.randomFill()) }, '🎲 Random'),
        h('button', { class: 'red', onclick: () => this.go(() => { this.battle.clearTeam(0); sfx.play('remove'); }) }, 'Clear Red'),
        h('button', { class: 'blue', onclick: () => this.go(() => { this.battle.clearTeam(1); sfx.play('remove'); }) }, 'Clear Blue'),
        h('button', { onclick: () => this.go(() => this.enterMenu()) }, '⌂ Menu'),
      );
      unitbar.innerHTML = '';
      allUnits().forEach((d, i) => {
        unitbar.append(h('button', {
          class: 'card' + (d.id === this.selected.id ? ' sel' : ''),
          title: d.description,
          onclick: () => this.go(() => this.selectUnit(d)),
        },
        h('span', { class: 'key' }, i < 9 ? String(i + 1) : ''),
        h('span', { class: 'icon' }, d.custom ? '⭐' : ICONS[d.weapon] ?? '❔'),
        d.name,
        h('span', { class: 'cost' }, `${d.cost} 🪙`)));
      });
      help.innerHTML = '';
      help.append('Left click / drag: place units — left half is ', red('RED'), ', right half is ', blue('BLUE'), h('br'),
        'Right click a unit: remove • 1-9: pick unit • Enter: start', h('br'),
        'WASD/arrows: move • Right-drag: look • Wheel: zoom • Space/Q: up/down • Shift: fast');
    } else {
      side.append(
        this.speedButtons(),
        h('button', { id: 'cambtn', onclick: () => this.go(() => this.cycleCamera()) }, '🎥 Camera'),
        h('button', { class: 'primary', onclick: () => this.go(() => this.resetBattle()) }, '⟲ Reset'),
        h('button', { onclick: () => this.go(() => this.enterMenu()) }, '⌂ Menu'),
      );
      help.innerHTML = '';
      help.append('R: reset to your layout • C: camera mode • F: follow a unit', h('br'), 'P: pause • 1-4: speed • H: hide UI • M: mute');
    }
  }

  private speedButtons(): HTMLElement {
    const wrap = h('div', { class: 'bar panel', style: 'position:static;padding:4px;gap:4px' });
    const speeds: [string, number][] = [['⏸', 0], ['¼×', 0.25], ['1×', 1], ['2×', 2]];
    for (const [label, s] of speeds) {
      wrap.append(h('button', {
        class: this.battle.timeScale === s ? 'on' : '',
        style: 'padding:4px 8px;font-size:15px',
        'data-speed': String(s),
        onclick: () => this.go(() => this.setSpeed(s)),
      }, label));
    }
    return wrap;
  }

  setSpeed(s: number): void {
    this.battle.timeScale = s;
    this.ui.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === s));
  }

  private selectUnit(d: UnitDef): void {
    this.selected = d;
    this.hud.querySelectorAll('.card').forEach((c, i) => c.classList.toggle('sel', allUnits()[i]?.id === d.id));
  }

  private randomFill(): void {
    for (const t of [0, 1]) if (this.battle.teamCost(t) < Math.min(this.budget, 6000) - 50) randomArmy(this.battle, t, Math.min(this.budget, 6000));
  }

  startBattle(): void {
    if (this.battle.phase !== 'placement') return;
    if (this.battle.aliveCount(0) === 0 || this.battle.aliveCount(1) === 0) {
      this.toast('Both teams need at least one unit!');
      return;
    }
    this.savedLayout = this.battle.getPlacements();
    this.setGhost(null);
    this.battle.start();
    this.announced = false;
    sfx.play('start');
    this.refreshEditorHud();
  }

  resetBattle(): void {
    if (this.mode !== 'editor') return;
    this.ui.querySelector('#banner')?.remove();
    this.battle.timeScale = 1;
    this.battle.load(this.savedLayout);
    if (this.cam.mode !== 'free') this.cam.setView(new THREE.Vector3(0, 22, 30), new THREE.Vector3(0, 0, 2));
    this.announced = false;
    this.refreshEditorHud();
  }

  cycleCamera(): void {
    const order = ['free', 'follow', 'cinematic'] as const;
    const next = order[(order.indexOf(this.cam.mode) + 1) % order.length];
    if (next === 'follow') this.followRandom();
    else if (next === 'cinematic') this.cam.cinematic();
    else this.cam.follow(null);
    this.toast(`Camera: ${this.cam.mode}`);
  }

  private followRandom(): void {
    const alive = this.battle.units.filter((u) => u.alive);
    if (alive.length) this.cam.follow(alive[Math.floor(Math.random() * alive.length)]);
  }

  toast(msg: string): void {
    const t = this.ui.querySelector('#toast') as HTMLElement | null;
    if (!t) return;
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout((t as unknown as { _t?: number })._t);
    (t as unknown as { _t?: number })._t = window.setTimeout(() => { t.style.opacity = '0'; }, 1600);
  }

  // ================================================================ input
  private bindInput(): void {
    const dom = this.r.renderer.domElement;
    dom.addEventListener('mousemove', (e) => {
      this.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      if (this.painting) this.tryPlace(true);
    });
    dom.addEventListener('mousedown', (e) => {
      sfx.unlock();
      if (e.button === 0 && this.mode === 'editor' && this.battle.phase === 'placement') {
        this.painting = true;
        this.lastPaint.set(1e9, 0, 0);
        this.tryPlace(false);
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.painting = false;
      if (e.button === 2 && this.cam.dragDistance < 6 && this.mode === 'editor' && this.battle.phase === 'placement') this.tryRemove();
    });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      sfx.unlock();
      const k = e.code;
      if (k === 'Escape') { if (this.mode !== 'menu') this.enterMenu(); return; }
      if (k === 'KeyM') this.toast(sfx.toggleMute() ? 'Muted' : 'Sound on');
      if (k === 'KeyH') { this.hudHidden = !this.hudHidden; this.ui.style.display = this.hudHidden ? 'none' : ''; }
      if (this.mode === 'menu') return;
      if (k === 'KeyC') this.cycleCamera();
      if (k === 'KeyF') { this.followRandom(); this.toast('Camera: follow'); }
      if (this.mode === 'editor' && this.battle.phase === 'placement') {
        if (k === 'Enter') this.startBattle();
        const n = Number(e.key);
        if (n >= 1 && n <= 9 && allUnits()[n - 1]) this.selectUnit(allUnits()[n - 1]);
      } else if (this.mode === 'editor' || this.mode === 'spectate') {
        if (k === 'KeyR' && this.mode === 'editor') this.resetBattle();
        if (k === 'KeyP') this.setSpeed(this.battle.timeScale === 0 ? 1 : 0);
        const speeds = [0, 0.25, 1, 2];
        const n = Number(e.key);
        if (n >= 1 && n <= 4) this.setSpeed(speeds[n - 1]);
      }
    });
  }

  private groundHit(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.mouse, this.r.camera);
    const hit = this.raycaster.intersectObject(this.mapView.terrain, false)[0];
    return hit ? hit.point : null;
  }

  private tryPlace(drag: boolean): void {
    const p = this.groundHit();
    if (!p) return;
    const team = zoneTeam(p.x, p.z);
    if (team === null) return;
    if (drag && p.distanceTo(this.lastPaint) < 1.1) return;
    if (this.battle.teamCost(team) + this.selected.cost > this.budget) {
      if (!drag) this.toast(`${TEAM_NAMES[team]} is out of budget!`);
      return;
    }
    this.lastPaint.copy(p);
    this.battle.addUnit(this.selected, team, p.x, p.z);
    sfx.play('place', p);
  }

  private tryRemove(): void {
    this.raycaster.setFromCamera(this.mouse, this.r.camera);
    const hits = this.raycaster.intersectObjects(this.r.scene.children, true);
    for (const hit of hits) {
      const u = hit.object.userData.unit as Unit | undefined;
      if (u) {
        this.battle.removeUnit(u);
        sfx.play('remove', hit.point);
        return;
      }
      if (hit.object === this.mapView.terrain) break;
    }
  }

  setGhost(def: UnitDef | null, team = 0): void {
    const key = def ? `${def.id}:${team}` : '';
    if (key === this.ghostKey) return;
    this.ghostKey = key;
    if (this.ghost) {
      this.r.scene.remove(this.ghost);
      this.ghost.traverse((o) => { if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose(); });
      this.ghost = null;
    }
    if (def) {
      this.ghost = buildStaticUnit(def, team, true);
      this.r.scene.add(this.ghost);
    }
  }

  private updateGhost(): void {
    if (this.mode !== 'editor' || this.battle.phase !== 'placement') { this.setGhost(null); return; }
    const p = this.groundHit();
    const team = p ? zoneTeam(p.x, p.z) : null;
    if (!p || team === null) { this.setGhost(null); return; }
    this.setGhost(this.selected, team);
    this.ghost!.position.copy(p);
    this.ghost!.rotation.y = team === 0 ? Math.PI / 2 : -Math.PI / 2;
  }

  // ================================================================ events
  private onBattleEvent(e: BattleEvent): void {
    switch (e.type) {
      case 'hit':
        this.effects.hit(e.pos, e.power);
        sfx.play(e.weapon === 'club' || e.weapon === 'axe' ? 'hitClub' : 'hitSword', e.pos, e.power);
        break;
      case 'clang':
        this.effects.clang(e.pos);
        sfx.play('clang', e.pos, e.power);
        break;
      case 'swing':
        sfx.play('swing', e.pos, 0.7);
        break;
      case 'cast':
        this.effects.burst(e.pos, 12, 0xffa040, 2, 0.05, 0.4, -1);
        sfx.play('cast', e.pos);
        break;
      case 'explode':
        this.effects.explode(e.pos, e.radius);
        sfx.play('explode', e.pos);
        break;
      case 'death':
        sfx.play('death', e.pos);
        break;
      case 'spawn':
        this.effects.dust(e.pos);
        break;
    }
  }

  // ================================================================ loop
  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const realDt = Math.min(0.5, (now - this.last) / 1000);
    const dt = Math.min(0.05, realDt);
    this.last = now;
    const b = this.battle;
    b.update(dt);
    for (const u of b.units) (u.view as UnitView | undefined)?.sync(dt);
    for (const p of b.projectiles) {
      p.view?.sync();
      if (b.timeScale > 0) this.effects.trail(p);
    }
    this.effects.update(dt * Math.max(0.25, Math.min(1, b.timeScale || 0.0001)));
    this.cam.enabled = this.mode !== 'menu';
    this.cam.update(dt, b.units);
    sfx.setListener(this.r.camera);
    this.updateGhost();
    this.updateHud(realDt);
    this.creator.update(dt);
    this.r.render();
  };

  private updateHud(dt: number): void {
    const b = this.battle;
    if (this.mode === 'menu' || this.mode === 'spectate') {
      if (b.phase === 'over') {
        this.overTimer += dt;
        if (!this.announced) this.announceWinner(false);
        if (this.overTimer > 5) this.newAutoBattle();
      } else if (b.time > 150) this.newAutoBattle(); // stalemate guard
    }
    if (this.mode === 'editor' && b.phase === 'over' && !this.announced) this.announceWinner(true);
    if (this.mode !== 'editor' && this.mode !== 'spectate') return;
    const rs = this.ui.querySelector('#rstat');
    const bs = this.ui.querySelector('#bstat');
    const clock = this.ui.querySelector('#clock');
    if (!rs || !bs || !clock) return;
    if (b.phase === 'placement') {
      const cnt = (t: number) => b.units.filter((u) => u.team === t).length;
      rs.textContent = `RED ${b.teamCost(0)}/${this.budget > 99999 ? '∞' : this.budget} · ${cnt(0)}`;
      bs.textContent = `BLUE ${b.teamCost(1)}/${this.budget > 99999 ? '∞' : this.budget} · ${cnt(1)}`;
      clock.textContent = 'DEPLOY';
    } else {
      rs.textContent = `RED ${b.aliveCount(0)} alive`;
      bs.textContent = `BLUE ${b.aliveCount(1)} alive`;
      const t = Math.floor(b.time);
      clock.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    }
  }

  private announceWinner(withButtons: boolean): void {
    this.announced = true;
    const w = this.battle.winner;
    if (this.mode !== 'menu') sfx.play('victory');
    if (this.mode === 'menu') return;
    const title = w === null ? 'DRAW!' : `${TEAM_NAMES[w].toUpperCase()} WINS!`;
    const banner = h('div', { id: 'banner', class: 'panel' }, h('h1', {}, title));
    banner.style.background = w === null ? '#777' : hexStr(TEAM_COLORS[w]);
    if (withButtons) {
      banner.append(h('div', { class: 'btns' },
        h('button', { class: 'primary', onclick: () => this.go(() => this.resetBattle()) }, '⟲ Reset'),
        h('button', { onclick: () => this.go(() => { banner.remove(); }) }, 'Keep watching'),
      ));
    } else {
      setTimeout(() => banner.remove(), 4500);
    }
    this.ui.append(banner);
  }
}

const hexStr = (n: number) => '#' + n.toString(16).padStart(6, '0');
const red = (s: string) => { const e = h('b'); e.style.color = '#ff8a80'; e.textContent = s; return e; };
const blue = (s: string) => { const e = h('b'); e.style.color = '#8ab4ff'; e.textContent = s; return e; };

async function boot(): Promise<void> {
  await initRapier();
  loadCustomUnits();
  const game = new Game();
  (window as unknown as { game: Game }).game = game;
  document.getElementById('loading')?.remove();
}

boot().catch((err) => {
  console.error(err);
  const l = document.getElementById('loading');
  if (l) l.textContent = 'Failed to start: ' + (err as Error).message;
});
