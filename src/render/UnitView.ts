import * as THREE from 'three';
import type { Unit } from '../units/Unit';
import { computeLayout, PART_NAMES, type PartName, type RagdollLayout } from '../units/Ragdoll';
import type { BodyParams, UnitDef, HatId } from '../units/types';
import { getWeapon } from '../units/weapons';
import { weaponPieces, type WeaponPiece } from '../units/weaponShapes';
import { TEAM_COLORS } from './MapView';

/*
 * Soft "toy" look: smooth, rounded, slightly glossy shapes. Bean-shaped torso whose
 * profile comes from the body type (shoulders / belly), capsule limbs, ball hands,
 * rounded boots and a big round head with dot eyes. Geometries are shared through a
 * cache, so rounder shapes cost almost nothing per unit. Physics uses the ragdoll shapes.
 */
const SEG = 14; // radial segments: smooth, round limbs

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
const k3 = (...n: number[]) => n.map((x) => x.toFixed(3)).join(',');

/** Chunky rounded limb along Y, centred on the origin. */
function limbGeo(len: number, r: number): THREE.BufferGeometry {
  return cached(`limb${k3(len, r)}`, () => new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 6, SEG));
}

/** Torso: a smooth bean whose silhouette follows the body type. */
function torsoGeo(L: RagdollLayout, b: BodyParams): THREE.BufferGeometry {
  const s = L.shapes.torso as { radius: number; halfHeight: number };
  const R = s.radius * 1.08;
  const H = s.halfHeight + s.radius; // half the visual height
  return cached(`torso${k3(R, H, b.shoulders, b.belly)}`, () => {
    const curve = new THREE.SplineCurve([
      new THREE.Vector2(0.001, -H * 1.02),
      new THREE.Vector2(R * 0.75 * Math.max(0.85, b.belly), -H * 0.85),
      new THREE.Vector2(R * 1.0 * b.belly, -H * 0.3),
      new THREE.Vector2(R * 0.97 * Math.max(b.shoulders, b.belly * 0.85), H * 0.3),
      new THREE.Vector2(R * 0.95 * b.shoulders, H * 0.7),
      new THREE.Vector2(R * 0.45 * b.shoulders, H * 0.98),
      new THREE.Vector2(0.001, H * 1.02),
    ]);
    const g = new THREE.LatheGeometry(curve.getPoints(18), 22);
    g.scale(1, 1, 0.88);
    return g;
  });
}

interface Mats { shirt: THREE.MeshStandardMaterial; pants: THREE.MeshStandardMaterial; skin: THREE.MeshStandardMaterial; boots: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial; belt: THREE.MeshStandardMaterial; white: THREE.MeshStandardMaterial }

function makeMats(def: UnitDef, team: number, ghost: boolean): Mats {
  const teamCol = new THREE.Color(TEAM_COLORS[team]);
  const shirt = def.look.shirt !== undefined ? new THREE.Color(def.look.shirt) : teamCol.clone();
  const pants = teamCol.clone().multiplyScalar(0.5);
  const mk = (color: THREE.Color | number, roughness = 0.55): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({
    color, roughness, transparent: ghost, opacity: ghost ? 0.45 : 1, depthWrite: !ghost,
  });
  return {
    shirt: mk(shirt), pants: mk(pants), skin: mk(def.look.skin),
    boots: mk(0x3b2a1e), dark: mk(0x16110d, 0.25), belt: mk(0x5a3b1c), white: mk(0xffffff, 0.2),
  };
}

function hatMesh(geo: THREE.BufferGeometry, color: number, ghost: boolean, metal = false): THREE.Mesh {
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color, roughness: metal ? 0.3 : 0.6, metalness: metal ? 0.5 : 0, transparent: ghost, opacity: ghost ? 0.45 : 1,
  }));
}

function buildHat(hat: HatId, r: number, team: number, ghost: boolean): THREE.Object3D | null {
  const g = new THREE.Group();
  const teamCol = TEAM_COLORS[team];
  const dome = (color: number, metal = false) => {
    const m = hatMesh(new THREE.SphereGeometry(r * 1.08, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), color, ghost, metal);
    m.position.y = r * 0.1;
    return m;
  };
  switch (hat) {
    case 'helmet': {
      const nose = hatMesh(new THREE.BoxGeometry(r * 0.14, r * 0.6, r * 0.12), 0x9aa3ad, ghost, true);
      nose.position.set(0, r * 0.05, r * 1.05);
      const rim = hatMesh(new THREE.TorusGeometry(r * 1.08, r * 0.07, 6, 24).rotateX(Math.PI / 2), 0x7d858f, ghost, true);
      rim.position.y = r * 0.12;
      g.add(dome(0x9aa3ad, true), rim, nose);
      break;
    }
    case 'viking': {
      g.add(dome(0x8a6a44));
      for (const s of [-1, 1]) {
        const horn = hatMesh(new THREE.ConeGeometry(r * 0.2, r * 1.0, 10), 0xf3ead2, ghost);
        horn.position.set(s * r * 1.05, r * 0.65, 0);
        horn.rotation.z = -s * 0.75;
        g.add(horn);
      }
      break;
    }
    case 'wizard': {
      const brim = hatMesh(new THREE.CylinderGeometry(r * 1.7, r * 1.7, r * 0.1, 24), 0x3d2a78, ghost);
      brim.position.y = r * 0.5;
      const cone = hatMesh(new THREE.ConeGeometry(r * 1.0, r * 2.6, 20), 0x4b3593, ghost);
      cone.position.set(0, r * 1.75, -r * 0.15);
      cone.rotation.x = -0.22;
      const band = hatMesh(new THREE.CylinderGeometry(r * 0.94, r * 0.98, r * 0.24, 20), teamCol, ghost);
      band.position.y = r * 0.66;
      g.add(brim, cone, band);
      break;
    }
    case 'cap': {
      const peak = hatMesh(new THREE.BoxGeometry(r * 1.2, r * 0.07, r * 0.8), teamCol, ghost);
      peak.position.set(0, r * 0.2, r * 0.95);
      g.add(dome(teamCol), peak);
      break;
    }
    case 'crown': {
      const ring = hatMesh(new THREE.CylinderGeometry(r * 0.82, r * 0.76, r * 0.36, 20, 1, true), 0xe8c53a, ghost, true);
      ring.position.y = r * 0.85;
      g.add(ring);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const spike = hatMesh(new THREE.ConeGeometry(r * 0.14, r * 0.4, 8), 0xe8c53a, ghost, true);
        spike.position.set(Math.cos(a) * r * 0.79, r * 1.2, Math.sin(a) * r * 0.79);
        g.add(spike);
      }
      break;
    }
    default:
      return null;
  }
  return g;
}

const PART_MAT: Record<PartName, keyof Mats> = {
  pelvis: 'pants', torso: 'shirt', head: 'skin',
  uArmL: 'shirt', uArmR: 'shirt', lArmL: 'skin', lArmR: 'skin',
  thighL: 'pants', thighR: 'pants', shinL: 'boots', shinR: 'boots',
};

function pieceMesh(p: WeaponPiece, m: THREE.Material, ghost: boolean): THREE.Mesh {
  let g: THREE.BufferGeometry;
  if (p.kind === 'capsuleZ') g = new THREE.CapsuleGeometry(p.r, p.half * 2, 4, 12).rotateX(Math.PI / 2);
  else if (p.kind === 'box') g = new THREE.BoxGeometry(p.hx * 2, p.hy * 2, p.hz * 2);
  else g = new THREE.SphereGeometry(p.r, 16, 12);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.copy(p.at);
  mesh.castShadow = !ghost;
  return mesh;
}

function buildWeapon(def: UnitDef, ghost: boolean): THREE.Group {
  const weapon = new THREE.Group();
  const w = getWeapon(def.weapon);
  const pieces = weaponPieces(w).pieces;
  for (const p of pieces) {
    const metal = p.color === w.color && (w.shape === 'sword' || w.shape === 'axe' || w.shape === 'mace');
    const m = new THREE.MeshStandardMaterial({
      color: p.color, roughness: p.glow ? 0.25 : metal ? 0.3 : 0.6, metalness: metal ? 0.45 : 0,
      emissive: p.glow ? p.color : 0x000000, emissiveIntensity: p.glow ? 1.4 : 0,
      transparent: ghost, opacity: ghost ? 0.45 : 1,
    });
    weapon.add(pieceMesh(p, m, ghost));
    if (w.shape === 'sword' && p.kind === 'box' && p.hz > 0.2) {
      const tip = new THREE.Mesh(new THREE.ConeGeometry(p.hx, p.hx * 2.4, 12).rotateX(Math.PI / 2).scale(1, 0.28, 1), m);
      tip.position.set(p.at.x, p.at.y, p.at.z + p.hz + p.hx * 1.2);
      tip.castShadow = !ghost;
      weapon.add(tip);
    }
  }
  if (w.shape === 'bow') {
    // bowstring between the limb tips
    const tipZ = w.length * 0.9;
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, tipZ * 2, 4).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xf2ead8, transparent: ghost, opacity: ghost ? 0.45 : 1 }));
    string.position.set(0, -0.13, 0);
    weapon.add(string);
  }
  return weapon;
}

function buildShield(team: number, ghost: boolean): THREE.Group {
  const g = new THREE.Group();
  const op = { transparent: ghost, opacity: ghost ? 0.45 : 1 };
  // Disc in the forearm's XZ plane, face pointing along -Y (away from the fist).
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.07, 32),
    new THREE.MeshStandardMaterial({ color: TEAM_COLORS[team], roughness: 0.5, ...op }));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.035, 8, 32).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.3, metalness: 0.5, ...op }));
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI),
    new THREE.MeshStandardMaterial({ color: 0xd9b440, roughness: 0.3, metalness: 0.6, ...op }));
  boss.position.y = -0.035;
  for (const m of [face, rim, boss]) { m.castShadow = !ghost; g.add(m); }
  // match the physics box centre (see offhandPieces)
  g.children.forEach((c) => c.position.add(new THREE.Vector3(0, -0.1, 0)));
  return g;
}

/** Builds the mesh for every body part (at the rest pose) plus the weapon and off-hand item. */
export function buildUnitMeshes(def: UnitDef, team: number, ghost = false) {
  const L = computeLayout(def.body);
  const mats = makeMats(def, team, ghost);
  const parts = {} as Record<PartName, THREE.Mesh>;
  const shadow = <T extends THREE.Object3D>(m: T): T => { m.castShadow = !ghost; return m; };

  for (const name of PART_NAMES) {
    const shape = L.shapes[name];
    let geo: THREE.BufferGeometry;
    if (name === 'torso') geo = torsoGeo(L, def.body);
    else if (name === 'head') {
      const r = (shape as { radius: number }).radius * 1.08;
      geo = cached(`head${k3(r)}`, () => new THREE.SphereGeometry(r, 28, 20).scale(1, 1.04, 1));
    } else if (shape.type === 'box') {
      geo = cached(`pelvis${k3(shape.hx, shape.hy, shape.hz)}`, () => new THREE.SphereGeometry(1, 20, 12).scale(shape.hx * 1.08, shape.hy * 1.55, shape.hz * 1.2));
    } else if (shape.type === 'capsule') {
      const len = (shape.halfHeight + shape.radius) * 2;
      geo = limbGeo(len, shape.radius * 1.12);
    } else {
      geo = cached(`ball${k3(shape.radius)}`, () => new THREE.SphereGeometry(shape.radius, 20, 14));
    }
    const mesh = shadow(new THREE.Mesh(geo, mats[PART_MAT[name]]));
    mesh.position.copy(L.centers[name]);
    parts[name] = mesh;

    if (name === 'shinL' || name === 'shinR') {
      const s = shape as { halfHeight: number; radius: number };
      const shinHalf = s.halfHeight + s.radius;
      const f = L.footSize;
      const foot = shadow(new THREE.Mesh(cached(`foot${k3(f.x, f.y, f.z)}`, () => {
        const g = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
        g.scale(f.x * 1.25, f.y * 2.6, f.z * 1.2);
        return g;
      }), mats.boots));
      foot.position.set(0, -shinHalf - f.y * 1.0, f.z * 0.45);
      mesh.add(foot);
    }
    if (name === 'lArmL' || name === 'lArmR') {
      const s = shape as { halfHeight: number; radius: number };
      const len = (s.halfHeight + s.radius) * 2;
      const hr = s.radius * 1.55;
      const hand = shadow(new THREE.Mesh(cached(`hand${k3(hr)}`, () => new THREE.SphereGeometry(hr, 16, 12)), mats.skin));
      hand.position.y = -len * 0.4;
      mesh.add(hand);
    }
    if (name === 'pelvis') {
      const p = shape as { hx: number; hy: number; hz: number };
      const belt = new THREE.Mesh(cached(`belt${k3(p.hx, p.hz)}`, () => {
        const g = new THREE.TorusGeometry(1, 0.09, 8, 28).rotateX(Math.PI / 2);
        g.scale(p.hx * 1.04, 1, p.hz * 1.15);
        return g;
      }), mats.belt);
      belt.position.y = p.hy * 0.85;
      mesh.add(belt);
    }
    if (name === 'head') {
      const r = (shape as { radius: number }).radius * 1.08;
      for (const sx of [-1, 1]) {
        const eye = new THREE.Mesh(cached(`eye${k3(r)}`, () => new THREE.SphereGeometry(r * 0.14, 14, 10).scale(0.85, 1.3, 0.5)), mats.dark);
        eye.position.set(sx * r * 0.34, r * 0.14, r * 0.92);
        const shine = new THREE.Mesh(cached(`shine${k3(r)}`, () => new THREE.SphereGeometry(r * 0.045, 8, 6)), mats.white);
        shine.position.set(sx * r * 0.34 + r * 0.03, r * 0.22, r * 0.99);
        mesh.add(eye, shine);
      }
      const mouth = new THREE.Mesh(cached(`mouth${k3(r)}`, () => new THREE.TorusGeometry(r * 0.2, r * 0.035, 6, 14, Math.PI * 0.8).rotateZ(Math.PI * 1.1)), mats.dark);
      mouth.position.set(0, -r * 0.28, r * 0.93);
      mesh.add(mouth);
      const hat = buildHat(def.look.hat, r, team, ghost);
      if (hat) {
        hat.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = !ghost; });
        mesh.add(hat);
      }
    }
  }

  const weapon = buildWeapon(def, ghost);
  weapon.position.copy(L.handR);
  const offhand = def.offhand === 'shield' ? buildShield(team, ghost) : null;
  if (offhand) offhand.position.copy(L.handL);
  return { parts, weapon, offhand, mats, layout: L };
}

/** A static, posed copy of a unit for previews and placement ghosts. */
export function buildStaticUnit(def: UnitDef, team: number, ghost = true): THREE.Group {
  const g = new THREE.Group();
  const { parts, weapon, offhand } = buildUnitMeshes(def, team, ghost);
  for (const m of Object.values(parts)) g.add(m);
  weapon.rotation.x = -Math.PI / 2.6;
  g.add(weapon);
  if (offhand) g.add(offhand);
  return g;
}

const GREY = new THREE.Color(0x777777);

/**
 * Live view that follows a Unit's physics bodies. Poses are interpolated between
 * the previous and current physics step, so motion stays smooth on high-refresh
 * screens and in slow motion even though physics ticks at a fixed 60 Hz.
 */
export class UnitView {
  private readonly parts: Record<PartName, THREE.Mesh>;
  private readonly weapon: THREE.Group;
  private offhand: THREE.Group | null;
  private readonly mats: THREE.MeshStandardMaterial[];
  private readonly objects: THREE.Object3D[];
  /** Previous-step pose per object: x,y,z,qx,qy,qz,qw. */
  private readonly prev: Float32Array;
  private hasPrev = false;
  private flashT = 0;
  private deadFade = 1;
  private readonly _p = new THREE.Vector3();
  private readonly _q = new THREE.Quaternion();
  private readonly _q2 = new THREE.Quaternion();

  constructor(private readonly unit: Unit, private readonly scene: THREE.Scene) {
    const built = buildUnitMeshes(unit.def, unit.team);
    this.parts = built.parts;
    this.weapon = built.weapon;
    this.offhand = built.offhand;
    this.mats = Object.values(built.mats);
    for (const name of PART_NAMES) {
      const m = this.parts[name];
      m.traverse((o) => { o.userData.unit = unit; });
      scene.add(m);
    }
    scene.add(this.weapon);
    this.objects = [...unit.ragdoll.list.map((p) => this.parts[p.name]), this.weapon];
    if (this.offhand && unit.offhandBody) {
      this.offhand.position.set(0, 0, 0);
      const holder = new THREE.Group();
      holder.add(this.offhand);
      this.offhand = holder;
      scene.add(holder);
      this.objects.push(holder);
    }
    this.prev = new Float32Array(this.objects.length * 7);
    unit.view = this;
    this.sync(0, 1);
  }

  private bodies() {
    const b = [...this.unit.ragdoll.list.map((p) => p.body), this.unit.weaponBody];
    if (this.offhand && this.unit.offhandBody) b.push(this.unit.offhandBody);
    return b;
  }

  /** Snapshot the current physics pose (called right before each physics step). */
  capture(): void {
    this.bodies().forEach((b, i) => {
      const t = b.translation();
      const r = b.rotation();
      this.prev.set([t.x, t.y, t.z, r.x, r.y, r.z, r.w], i * 7);
    });
    this.hasPrev = true;
  }

  flash(): void {
    this.flashT = 0.12;
  }

  sync(dt = 0, alpha = 1): void {
    const lerp = this.hasPrev && alpha < 1;
    this.bodies().forEach((b, i) => {
      const t = b.translation();
      const r = b.rotation();
      const o = this.objects[i];
      if (lerp) {
        const pv = this.prev;
        const j = i * 7;
        this._p.set(pv[j], pv[j + 1], pv[j + 2]);
        o.position.set(t.x, t.y, t.z).sub(this._p).multiplyScalar(alpha).add(this._p);
        this._q.set(pv[j + 3], pv[j + 4], pv[j + 5], pv[j + 6]);
        o.quaternion.copy(this._q).slerp(this._q2.set(r.x, r.y, r.z, r.w), alpha);
      } else {
        o.position.set(t.x, t.y, t.z);
        o.quaternion.set(r.x, r.y, r.z, r.w);
      }
    });

    if (this.flashT > 0 || dt === 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      const k = this.flashT > 0 ? 0.8 : 0;
      for (const m of this.mats) m.emissive.setRGB(k, k * 0.15, k * 0.1);
    }
    if (!this.unit.alive && this.deadFade > 0.55) {
      // Desaturate corpses a little so the living stand out.
      this.deadFade = Math.max(0.55, this.deadFade - dt * 0.5);
      for (const m of this.mats) m.color.lerp(GREY, dt * 0.4);
    }
  }

  dispose(): void {
    for (const name of PART_NAMES) {
      const m = this.parts[name];
      this.scene.remove(m);
      m.traverse((o) => {
        // hats use their own materials; shared geometries stay cached
        if (o instanceof THREE.Mesh && !this.mats.includes(o.material as THREE.MeshStandardMaterial)) (o.material as THREE.Material).dispose();
      });
    }
    this.scene.remove(this.weapon);
    if (this.offhand) {
      this.scene.remove(this.offhand);
      this.offhand.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    }
    for (const m of this.mats) m.dispose();
    this.weapon.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
  }
}
