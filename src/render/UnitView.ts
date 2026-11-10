import * as THREE from 'three';
import type { Unit } from '../units/Unit';
import { computeLayout, PART_NAMES, type PartName, type RagdollLayout } from '../units/Ragdoll';
import type { BodyParams, UnitDef, HatId } from '../units/types';
import { getWeapon } from '../units/weapons';
import { weaponPieces } from '../units/weaponShapes';
import { TEAM_COLORS } from './MapView';

/*
 * Low-poly look: everything is built from a handful of faceted primitives with flat
 * shading and flat colours — hexagonal tapered limbs, a lathe-turned torso whose
 * profile comes from the body type (shoulders / belly), an icosahedron head and
 * block hands and feet. Meshes only *look* like this; physics uses the ragdoll shapes.
 */

const SEG = 6; // radial segments for limbs: hexagonal prisms

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
const k3 = (...n: number[]) => n.map((x) => x.toFixed(3)).join(',');

/** Tapered hexagonal prism along Y, centred on the origin. */
function limbGeo(len: number, rTop: number, rBottom: number): THREE.BufferGeometry {
  return cached(`limb${k3(len, rTop, rBottom)}`, () => new THREE.CylinderGeometry(rTop, rBottom, len, SEG, 1));
}

/** Torso: a low-poly lathe whose silhouette follows the body type. */
function torsoGeo(L: RagdollLayout, b: BodyParams): THREE.BufferGeometry {
  const s = L.shapes.torso as { radius: number; halfHeight: number };
  const R = s.radius;
  const H = s.halfHeight + s.radius; // half the visual height
  return cached(`torso${k3(R, H, b.shoulders, b.belly)}`, () => {
    const pts = [
      new THREE.Vector2(0, -H),
      new THREE.Vector2(R * 0.78 * Math.max(0.8, b.belly * 0.9), -H),
      new THREE.Vector2(R * 1.0 * b.belly, -H * 0.35),
      new THREE.Vector2(R * 0.98 * Math.max(b.shoulders, b.belly * 0.85), H * 0.35),
      new THREE.Vector2(R * 1.02 * b.shoulders, H * 0.72),
      new THREE.Vector2(R * 0.5 * b.shoulders, H),
      new THREE.Vector2(0, H),
    ];
    const g = new THREE.LatheGeometry(pts, 7);
    g.scale(1, 1, 0.82); // a bit flatter front-to-back
    return g;
  });
}

interface Mats { shirt: THREE.MeshStandardMaterial; pants: THREE.MeshStandardMaterial; skin: THREE.MeshStandardMaterial; boots: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial; belt: THREE.MeshStandardMaterial }

function makeMats(def: UnitDef, team: number, ghost: boolean): Mats {
  const teamCol = new THREE.Color(TEAM_COLORS[team]);
  const shirt = def.look.shirt !== undefined ? new THREE.Color(def.look.shirt) : teamCol.clone();
  const pants = teamCol.clone().multiplyScalar(0.5);
  const mk = (color: THREE.Color | number, roughness = 0.85): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({
    color, roughness, flatShading: true, transparent: ghost, opacity: ghost ? 0.45 : 1, depthWrite: !ghost,
  });
  return {
    shirt: mk(shirt), pants: mk(pants), skin: mk(def.look.skin),
    boots: mk(0x3b2a1e), dark: mk(0x1a1410, 0.5), belt: mk(0x5a3b1c),
  };
}

function hatMesh(geo: THREE.BufferGeometry, color: number, ghost: boolean, metal = false): THREE.Mesh {
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color, flatShading: true, roughness: metal ? 0.35 : 0.8, metalness: metal ? 0.5 : 0, transparent: ghost, opacity: ghost ? 0.45 : 1,
  }));
}

function buildHat(hat: HatId, r: number, team: number, ghost: boolean): THREE.Object3D | null {
  const g = new THREE.Group();
  const teamCol = TEAM_COLORS[team];
  const dome = (color: number, metal = false) => {
    const m = hatMesh(new THREE.SphereGeometry(r * 1.1, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), color, ghost, metal);
    m.position.y = r * 0.1;
    return m;
  };
  switch (hat) {
    case 'helmet': {
      const nose = hatMesh(new THREE.BoxGeometry(r * 0.14, r * 0.6, r * 0.12), 0x9aa3ad, ghost, true);
      nose.position.set(0, r * 0.05, r * 1.05);
      const rim = hatMesh(new THREE.CylinderGeometry(r * 1.12, r * 1.12, r * 0.14, 7), 0x7d858f, ghost, true);
      rim.position.y = r * 0.12;
      g.add(dome(0x9aa3ad, true), rim, nose);
      break;
    }
    case 'viking': {
      g.add(dome(0x8a6a44));
      for (const s of [-1, 1]) {
        const horn = hatMesh(new THREE.ConeGeometry(r * 0.2, r * 1.0, 5), 0xf3ead2, ghost);
        horn.position.set(s * r * 1.05, r * 0.65, 0);
        horn.rotation.z = -s * 0.75;
        g.add(horn);
      }
      break;
    }
    case 'wizard': {
      const brim = hatMesh(new THREE.CylinderGeometry(r * 1.7, r * 1.7, r * 0.1, 8), 0x3d2a78, ghost);
      brim.position.y = r * 0.5;
      const cone = hatMesh(new THREE.ConeGeometry(r * 1.0, r * 2.6, 6), 0x4b3593, ghost);
      cone.position.set(0, r * 1.75, -r * 0.15);
      cone.rotation.x = -0.22;
      const band = hatMesh(new THREE.CylinderGeometry(r * 0.94, r * 0.98, r * 0.24, 6), teamCol, ghost);
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
      const ring = hatMesh(new THREE.CylinderGeometry(r * 0.82, r * 0.76, r * 0.36, 6, 1, true), 0xe8c53a, ghost, true);
      ring.position.y = r * 0.85;
      g.add(ring);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const spike = hatMesh(new THREE.ConeGeometry(r * 0.14, r * 0.4, 4), 0xe8c53a, ghost, true);
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

/** Builds the mesh for every body part (at the rest pose) plus the weapon. */
export function buildUnitMeshes(def: UnitDef, team: number, ghost = false) {
  const L = computeLayout(def.body);
  const mats = makeMats(def, team, ghost);
  const parts = {} as Record<PartName, THREE.Mesh>;
  const shadow = (m: THREE.Object3D) => { m.castShadow = !ghost; return m; };

  for (const name of PART_NAMES) {
    const shape = L.shapes[name];
    let geo: THREE.BufferGeometry;
    if (name === 'torso') geo = torsoGeo(L, def.body);
    else if (name === 'head') {
      const r = (shape as { radius: number }).radius;
      geo = cached(`head${k3(r)}`, () => new THREE.IcosahedronGeometry(r, 1));
    } else if (shape.type === 'box') {
      geo = cached(`pelvis${k3(shape.hx, shape.hy, shape.hz)}`, () => {
        const g = new THREE.CylinderGeometry(shape.hx * 1.02, shape.hx * 0.85, shape.hy * 2.6, SEG);
        g.scale(1, 1, shape.hz / shape.hx);
        return g;
      });
    } else if (shape.type === 'capsule') {
      const len = (shape.halfHeight + shape.radius) * 2;
      const r = shape.radius;
      const taper = name.startsWith('thigh') ? [1.1, 0.85] : name.startsWith('shin') ? [0.9, 0.75] : name.startsWith('uArm') ? [1.05, 0.85] : [0.85, 0.7];
      geo = limbGeo(len, r * taper[0], r * taper[1]);
    } else {
      geo = cached(`ball${k3(shape.radius)}`, () => new THREE.IcosahedronGeometry(shape.radius, 0));
    }
    const mesh = shadow(new THREE.Mesh(geo, mats[PART_MAT[name]])) as THREE.Mesh;
    mesh.position.copy(L.centers[name]);
    parts[name] = mesh;

    if (name === 'shinL' || name === 'shinR') {
      const s = shape as { halfHeight: number; radius: number };
      const shinHalf = s.halfHeight + s.radius;
      const f = L.footSize;
      const foot = shadow(new THREE.Mesh(cached(`foot${k3(f.x, f.y, f.z)}`, () => new THREE.BoxGeometry(f.x * 2.1, f.y * 2.4, f.z * 2.1)), mats.boots));
      foot.position.set(0, -shinHalf - f.y * 0.4, f.z * 0.45);
      mesh.add(foot);
    }
    if (name === 'lArmL' || name === 'lArmR') {
      const s = shape as { halfHeight: number; radius: number };
      const len = (s.halfHeight + s.radius) * 2;
      const hs = s.radius * 1.9;
      const hand = shadow(new THREE.Mesh(cached(`hand${k3(hs)}`, () => new THREE.BoxGeometry(hs, hs * 1.1, hs)), mats.skin));
      hand.position.y = -len * 0.38;
      hand.rotation.y = 0.3;
      mesh.add(hand);
    }
    if (name === 'pelvis') {
      const p = shape as { hx: number; hy: number; hz: number };
      const belt = new THREE.Mesh(cached(`belt${k3(p.hx, p.hz)}`, () => {
        const g = new THREE.CylinderGeometry(p.hx * 1.08, p.hx * 1.08, p.hy * 0.7, SEG);
        g.scale(1, 1, (p.hz / p.hx) * 1.05);
        return g;
      }), mats.belt);
      belt.position.y = p.hy * 0.9;
      mesh.add(belt);
    }
    if (name === 'head') {
      const r = (shape as { radius: number }).radius;
      for (const sx of [-1, 1]) {
        const eye = new THREE.Mesh(cached(`eye${k3(r)}`, () => new THREE.BoxGeometry(r * 0.17, r * 0.3, r * 0.08)), mats.dark);
        eye.position.set(sx * r * 0.36, r * 0.12, r * 0.9);
        mesh.add(eye);
      }
      const nose = new THREE.Mesh(cached(`nose${k3(r)}`, () => new THREE.ConeGeometry(r * 0.16, r * 0.34, 4).rotateX(Math.PI / 2)), mats.skin);
      nose.position.set(0, -r * 0.08, r * 1.0);
      mesh.add(nose);
      const hat = buildHat(def.look.hat, r, team, ghost);
      if (hat) {
        hat.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = !ghost; });
        mesh.add(hat);
      }
    }
  }

  const weapon = new THREE.Group();
  const w = getWeapon(def.weapon);
  for (const p of weaponPieces(w).pieces) {
    const metal = p.color === w.color && w.shape !== 'club' && w.shape !== 'staff';
    const m = new THREE.MeshStandardMaterial({
      color: p.color, flatShading: true, roughness: p.glow ? 0.3 : metal ? 0.35 : 0.8, metalness: metal ? 0.35 : 0,
      emissive: p.glow ? p.color : 0x000000, emissiveIntensity: p.glow ? 1.4 : 0,
      transparent: ghost, opacity: ghost ? 0.45 : 1,
    });
    let g: THREE.BufferGeometry;
    if (p.kind === 'capsuleZ') g = new THREE.CylinderGeometry(p.r, p.r * 0.9, (p.half + p.r) * 2, 6).rotateX(Math.PI / 2);
    else if (p.kind === 'box') g = new THREE.BoxGeometry(p.hx * 2, p.hy * 2, p.hz * 2);
    else g = new THREE.IcosahedronGeometry(p.r, 0);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.copy(p.at);
    mesh.castShadow = !ghost;
    weapon.add(mesh);
    if (w.shape === 'sword' && p.kind === 'box' && p.hz > 0.2) {
      // pointed tip
      const tip = new THREE.Mesh(new THREE.ConeGeometry(p.hx * 1.05, p.hx * 2.6, 4).rotateX(Math.PI / 2).scale(1, 0.3, 1), m);
      tip.position.set(p.at.x, p.at.y, p.at.z + p.hz + p.hx * 1.3);
      tip.castShadow = !ghost;
      weapon.add(tip);
    }
  }
  weapon.position.copy(L.handR);
  return { parts, weapon, mats, layout: L };
}

/** A static, posed copy of a unit for previews and placement ghosts. */
export function buildStaticUnit(def: UnitDef, team: number, ghost = true): THREE.Group {
  const g = new THREE.Group();
  const { parts, weapon } = buildUnitMeshes(def, team, ghost);
  for (const m of Object.values(parts)) g.add(m);
  weapon.rotation.x = -Math.PI / 2.6;
  g.add(weapon);
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
    this.mats = Object.values(built.mats);
    for (const name of PART_NAMES) {
      const m = this.parts[name];
      m.traverse((o) => { o.userData.unit = unit; });
      scene.add(m);
    }
    scene.add(this.weapon);
    this.objects = [...unit.ragdoll.list.map((p) => this.parts[p.name]), this.weapon];
    this.prev = new Float32Array(this.objects.length * 7);
    unit.view = this;
    this.sync(0, 1);
  }

  private bodies() {
    return [...this.unit.ragdoll.list.map((p) => p.body), this.unit.weaponBody];
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
    for (const m of this.mats) m.dispose();
    this.weapon.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
  }
}
