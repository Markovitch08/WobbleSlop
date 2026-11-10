import * as THREE from 'three';
import type { Unit } from '../units/Unit';
import { computeLayout, PART_NAMES, type PartName, type PartShape } from '../units/Ragdoll';
import type { UnitDef, HatId } from '../units/types';
import { getWeapon } from '../units/weapons';
import { weaponPieces } from '../units/weaponShapes';
import { TEAM_COLORS } from './MapView';

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
const r3 = (n: number) => n.toFixed(3);

function shapeGeo(s: PartShape): THREE.BufferGeometry {
  if (s.type === 'box') return cached(`b${r3(s.hx)},${r3(s.hy)},${r3(s.hz)}`, () => roundedBox(s.hx, s.hy, s.hz));
  if (s.type === 'capsule') return cached(`c${r3(s.radius)},${r3(s.halfHeight)}`, () => new THREE.CapsuleGeometry(s.radius, s.halfHeight * 2, 6, 14));
  return cached(`s${r3(s.radius)}`, () => new THREE.SphereGeometry(s.radius, 20, 14));
}

function roundedBox(hx: number, hy: number, hz: number): THREE.BufferGeometry {
  // A squashed capsule reads friendlier than a hard box for the pelvis.
  const g = new THREE.SphereGeometry(1, 16, 10);
  g.scale(hx * 1.05, hy * 1.25, hz * 1.1);
  return g;
}

interface Mats { shirt: THREE.MeshStandardMaterial; pants: THREE.MeshStandardMaterial; skin: THREE.MeshStandardMaterial; boots: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial }

function makeMats(def: UnitDef, team: number, ghost: boolean): Mats {
  const teamCol = new THREE.Color(TEAM_COLORS[team]);
  const shirt = def.look.shirt !== undefined ? new THREE.Color(def.look.shirt) : teamCol.clone();
  const pants = teamCol.clone().multiplyScalar(0.55);
  const opts = (color: THREE.Color | number): THREE.MeshStandardMaterialParameters => ({
    color, roughness: 0.75, transparent: ghost, opacity: ghost ? 0.45 : 1, depthWrite: !ghost,
  });
  return {
    shirt: new THREE.MeshStandardMaterial(opts(shirt)),
    pants: new THREE.MeshStandardMaterial(opts(pants)),
    skin: new THREE.MeshStandardMaterial(opts(def.look.skin)),
    boots: new THREE.MeshStandardMaterial(opts(0x3b2a1e)),
    dark: new THREE.MeshStandardMaterial({ ...opts(0x111111), roughness: 0.4 }),
  };
}

const PART_MAT: Record<PartName, keyof Mats> = {
  pelvis: 'pants', torso: 'shirt', head: 'skin',
  uArmL: 'shirt', uArmR: 'shirt', lArmL: 'skin', lArmR: 'skin',
  thighL: 'pants', thighR: 'pants', shinL: 'boots', shinR: 'boots',
};

function buildHat(hat: HatId, r: number, team: number, ghost: boolean): THREE.Object3D | null {
  const g = new THREE.Group();
  const mat = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: c === 0x9aa3ad || c === 0xe8c53a ? 0.6 : 0, transparent: ghost, opacity: ghost ? 0.45 : 1 });
  const teamCol = TEAM_COLORS[team];
  switch (hat) {
    case 'helmet': {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(r * 1.08, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x9aa3ad));
      dome.position.y = r * 0.12;
      const nose = new THREE.Mesh(new THREE.BoxGeometry(r * 0.12, r * 0.6, r * 0.1), mat(0x9aa3ad));
      nose.position.set(0, r * 0.05, r * 1.02);
      g.add(dome, nose);
      break;
    }
    case 'viking': {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(r * 1.08, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x8a6a44));
      dome.position.y = r * 0.12;
      g.add(dome);
      for (const s of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(r * 0.18, r * 0.9, 8), mat(0xf3ead2));
        horn.position.set(s * r * 1.0, r * 0.6, 0);
        horn.rotation.z = -s * 0.8;
        g.add(horn);
      }
      break;
    }
    case 'wizard': {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.6, r * 1.6, r * 0.08, 20), mat(0x3d2a78));
      brim.position.y = r * 0.55;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 0.95, r * 2.4, 16), mat(0x4b3593));
      cone.position.set(0, r * 1.7, -r * 0.1);
      cone.rotation.x = -0.18;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.95, r * 0.22, 16), mat(teamCol));
      band.position.y = r * 0.7;
      g.add(brim, cone, band);
      break;
    }
    case 'cap': {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(r * 1.05, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(teamCol));
      dome.position.y = r * 0.15;
      const peak = new THREE.Mesh(new THREE.BoxGeometry(r * 1.2, r * 0.06, r * 0.8), mat(teamCol));
      peak.position.set(0, r * 0.2, r * 0.95);
      g.add(dome, peak);
      break;
    }
    case 'crown': {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.75, r * 0.35, 12, 1, true), mat(0xe8c53a));
      ring.position.y = r * 0.85;
      g.add(ring);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(r * 0.12, r * 0.35, 6), mat(0xe8c53a));
        spike.position.set(Math.cos(a) * r * 0.78, r * 1.15, Math.sin(a) * r * 0.78);
        g.add(spike);
      }
      break;
    }
    default:
      return null;
  }
  return g;
}

/** Builds the mesh for every body part (at the rest pose) plus the weapon. */
export function buildUnitMeshes(def: UnitDef, team: number, ghost = false) {
  const L = computeLayout(def.body);
  const mats = makeMats(def, team, ghost);
  const parts = {} as Record<PartName, THREE.Mesh>;
  for (const name of PART_NAMES) {
    const mesh = new THREE.Mesh(shapeGeo(L.shapes[name]), mats[PART_MAT[name]]);
    mesh.castShadow = !ghost;
    mesh.position.copy(L.centers[name]);
    parts[name] = mesh;
    if (name === 'shinL' || name === 'shinR') {
      const s = L.shapes[name] as { halfHeight: number; radius: number };
      const shinHalf = s.halfHeight + s.radius;
      const f = L.footSize;
      const foot = new THREE.Mesh(cached(`f${r3(f.x)},${r3(f.y)},${r3(f.z)}`, () => roundedBox(f.x, f.y, f.z)), mats.boots);
      foot.position.set(0, -shinHalf - f.y * 0.4, f.z * 0.45);
      foot.castShadow = !ghost;
      mesh.add(foot);
    }
    if (name === 'head') {
      const r = (L.shapes.head as { radius: number }).radius;
      for (const sx of [-1, 1]) {
        const eye = new THREE.Mesh(cached(`eye${r3(r)}`, () => new THREE.SphereGeometry(r * 0.16, 10, 8)), mats.dark);
        eye.position.set(sx * r * 0.36, r * 0.12, r * 0.88);
        eye.scale.set(1, 1.35, 0.6);
        mesh.add(eye);
      }
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
    const m = new THREE.MeshStandardMaterial({
      color: p.color, roughness: p.glow ? 0.2 : 0.45, metalness: p.color === w.color && w.shape !== 'club' && w.shape !== 'staff' ? 0.35 : 0.05,
      emissive: p.glow ? p.color : 0x000000, emissiveIntensity: p.glow ? 1.4 : 0,
      transparent: ghost, opacity: ghost ? 0.45 : 1,
    });
    let g: THREE.BufferGeometry;
    if (p.kind === 'capsuleZ') g = new THREE.CapsuleGeometry(p.r, p.half * 2, 4, 10).rotateX(Math.PI / 2);
    else if (p.kind === 'box') g = new THREE.BoxGeometry(p.hx * 2, p.hy * 2, p.hz * 2);
    else g = new THREE.SphereGeometry(p.r, 14, 10);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.copy(p.at);
    mesh.castShadow = !ghost;
    weapon.add(mesh);
  }
  weapon.position.copy(L.handR);
  return { parts, weapon, mats, layout: L };
}

/** A static, posed copy of a unit for previews and placement ghosts. */
export function buildStaticUnit(def: UnitDef, team: number, ghost = true): THREE.Group {
  const g = new THREE.Group();
  const { parts, weapon } = buildUnitMeshes(def, team, ghost);
  for (const m of Object.values(parts)) g.add(m);
  // Hold the weapon upright-forward like the guard pose.
  weapon.rotation.x = -Math.PI / 2.6;
  g.add(weapon);
  return g;
}

/** Live view that follows a Unit's physics bodies each frame. */
export class UnitView {
  private readonly parts: Record<PartName, THREE.Mesh>;
  private readonly weapon: THREE.Group;
  private readonly mats: THREE.MeshStandardMaterial[];
  private flashT = 0;
  private deadFade = 1;

  constructor(private readonly unit: Unit, private readonly scene: THREE.Scene) {
    const built = buildUnitMeshes(unit.def, unit.team);
    this.parts = built.parts;
    this.weapon = built.weapon;
    this.mats = Object.values(built.mats);
    for (const name of PART_NAMES) {
      const m = this.parts[name];
      m.userData.unit = unit;
      m.traverse((o) => { o.userData.unit = unit; });
      scene.add(m);
    }
    scene.add(this.weapon);
    unit.view = this;
    this.sync();
  }

  flash(): void {
    this.flashT = 0.12;
  }

  sync(dt = 0): void {
    for (const p of this.unit.ragdoll.list) {
      const t = p.body.translation();
      const r = p.body.rotation();
      const m = this.parts[p.name];
      m.position.set(t.x, t.y, t.z);
      m.quaternion.set(r.x, r.y, r.z, r.w);
    }
    const wt = this.unit.weaponBody.translation();
    const wr = this.unit.weaponBody.rotation();
    this.weapon.position.set(wt.x, wt.y, wt.z);
    this.weapon.quaternion.set(wr.x, wr.y, wr.z, wr.w);

    if (this.flashT > 0 || dt === 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      const k = this.flashT > 0 ? 0.8 : 0;
      for (const m of this.mats) m.emissive.setRGB(k, k * 0.15, k * 0.1);
    }
    if (!this.unit.alive && this.deadFade > 0.55) {
      // Desaturate corpses a little so the living stand out.
      this.deadFade = Math.max(0.55, this.deadFade - dt * 0.5);
      for (const m of this.mats) m.color.lerp(new THREE.Color(0x777777), dt * 0.4);
    }
  }

  dispose(): void {
    for (const name of PART_NAMES) this.scene.remove(this.parts[name]);
    this.scene.remove(this.weapon);
    for (const m of this.mats) m.dispose();
    this.weapon.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
  }
}
