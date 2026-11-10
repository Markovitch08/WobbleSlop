import * as THREE from 'three';
import { terrainGrid, type MapData } from '../world/MapData';

export const TEAM_COLORS = [0xd8433a, 0x3a72d8];

/** Visuals for a MapData: vertex-coloured terrain, instanced trees and rocks, team zones. */
export class MapView {
  readonly group = new THREE.Group();
  readonly terrain: THREE.Mesh;
  readonly zones: THREE.Group;

  constructor(readonly map: MapData) {
    // Low-poly terrain: un-indexed so every triangle is its own flat facet with its own colour.
    const { vertices, indices } = terrainGrid(map);
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    indexed.setIndex(new THREE.BufferAttribute(indices, 1));
    const geo = indexed.toNonIndexed();
    geo.computeVertexNormals();
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const grassA = new THREE.Color(0x5f9e45);
    const grassB = new THREE.Color(0x8cc063);
    const dirt = new THREE.Color(0xa07d4f);
    const rock = new THREE.Color(0x8f8a7e);
    for (let f = 0; f < pos.count; f += 3) {
      const x = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3;
      const y = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
      const z = (pos.getZ(f) + pos.getZ(f + 1) + pos.getZ(f + 2)) / 3;
      const n = 0.5 + 0.5 * Math.sin(x * 0.17 + Math.cos(z * 0.13) * 2.0) * Math.cos(z * 0.19);
      const jitter = ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 + 1) % 1; // per-facet variation
      c.copy(grassA).lerp(grassB, n * 0.7 + jitter * 0.25 + Math.min(1, y / 14) * 0.2);
      const steep = 1 - nrm.getY(f);
      if (steep > 0.18) c.lerp(dirt, Math.min(1, (steep - 0.18) * 4));
      if (y > 9) c.lerp(rock, Math.min(0.6, (y - 9) / 10));
      for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (f + k) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    this.terrain.receiveShadow = true;
    this.terrain.name = 'terrain';
    this.group.add(this.terrain);

    // Chunky low-poly clouds.
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1, emissive: 0x9aa9b8, emissiveIntensity: 0.35 });
    const puff = new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < 14; i++) {
      const cloud = new THREE.Group();
      const a = (i / 14) * Math.PI * 2 + Math.sin(i * 7.1);
      const d = 70 + (i % 4) * 25;
      cloud.position.set(Math.cos(a) * d, 38 + (i % 3) * 7, Math.sin(a) * d);
      for (let j = 0; j < 4; j++) {
        const m = new THREE.Mesh(puff, cloudMat);
        const s = 3 + ((i * 3 + j * 5) % 4);
        m.scale.set(s * 1.4, s * 0.8, s);
        m.position.set((j - 1.5) * 3.5, (j % 2) * 1.2, ((i + j) % 3) - 1);
        m.rotation.set(j, i, j * i);
        cloud.add(m);
      }
      this.group.add(cloud);
    }

    // Trees: instanced trunks + two foliage cones.
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1, 5);
    const coneGeo = new THREE.ConeGeometry(1, 1, 6);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, flatShading: true }), map.trees.length);
    const leaves = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ color: 0x2f7a3a, roughness: 0.9, flatShading: true }), map.trees.length * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    map.trees.forEach((t, i) => {
      const y = map.heightAt(t.x, t.z);
      const h = 2.4 * t.s;
      trunks.setMatrixAt(i, m.compose(p.set(t.x, y + h / 2, t.z), q.identity(), s.set(t.s, h, t.s)));
      leaves.setMatrixAt(i * 2, m.compose(p.set(t.x, y + h + 0.8 * t.s, t.z), q, s.set(1.6 * t.s, 2.6 * t.s, 1.6 * t.s)));
      leaves.setMatrixAt(i * 2 + 1, m.compose(p.set(t.x, y + h + 2.0 * t.s, t.z), q, s.set(1.1 * t.s, 2.0 * t.s, 1.1 * t.s)));
    });
    for (const im of [trunks, leaves]) { im.castShadow = true; im.receiveShadow = true; this.group.add(im); }

    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x8d8a83, roughness: 0.9, flatShading: true }), map.rocks.length);
    map.rocks.forEach((r, i) => {
      q.setFromEuler(new THREE.Euler(r.x, r.z, r.r));
      rocks.setMatrixAt(i, m.compose(p.set(r.x, map.heightAt(r.x, r.z) + r.r * 0.35, r.z), q, s.set(r.r, r.r * 0.9, r.r)));
    });
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    this.group.add(rocks);

    // Team deployment zones (shown during placement).
    this.zones = new THREE.Group();
    const zw = ZONE.maxX - ZONE.minX;
    const zd = ZONE.halfZ * 2;
    for (const team of [0, 1]) {
      const mat = new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: 0.16, depthWrite: false });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(zw, zd), mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set((team === 0 ? -1 : 1) * (ZONE.minX + zw / 2), 0.03, 0);
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(zw, zd)),
        new THREE.LineBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: 0.7 }),
      );
      edge.rotation.x = -Math.PI / 2;
      edge.position.copy(plane.position).setY(0.04);
      this.zones.add(plane, edge);
    }
    this.group.add(this.zones);
  }
}

/** Deployment zones: red is x in [-maxX, -minX], blue mirrored. */
export const ZONE = { minX: 1.5, maxX: 30, halfZ: 26 };

export function zoneTeam(x: number, z: number): number | null {
  if (Math.abs(z) > ZONE.halfZ) return null;
  const ax = Math.abs(x);
  if (ax < ZONE.minX || ax > ZONE.maxX) return null;
  return x < 0 ? 0 : 1;
}
