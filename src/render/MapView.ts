import * as THREE from 'three';
import { terrainGrid, type MapData } from '../world/MapData';

export const TEAM_COLORS = [0xd8433a, 0x3a72d8];

/** Visuals for a MapData: vertex-coloured terrain, instanced trees and rocks, team zones. */
export class MapView {
  readonly group = new THREE.Group();
  readonly terrain: THREE.Mesh;
  readonly zones: THREE.Group;

  constructor(readonly map: MapData) {
    const { vertices, indices } = terrainGrid(map);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    const colors = new Float32Array(vertices.length);
    const normals = geo.getAttribute('normal');
    const c = new THREE.Color();
    const grassA = new THREE.Color(0x6aa84f);
    const grassB = new THREE.Color(0x8cc063);
    const dirt = new THREE.Color(0x9b7b52);
    for (let i = 0; i < vertices.length / 3; i++) {
      const x = vertices[i * 3];
      const y = vertices[i * 3 + 1];
      const z = vertices[i * 3 + 2];
      const n = 0.5 + 0.5 * Math.sin(x * 0.21 + Math.cos(z * 0.17) * 2.0) * Math.cos(z * 0.23);
      c.copy(grassA).lerp(grassB, n * 0.8 + Math.min(1, y / 12) * 0.3);
      const steep = 1 - normals.getY(i);
      c.lerp(dirt, Math.min(1, steep * 3));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    this.terrain.receiveShadow = true;
    this.terrain.name = 'terrain';
    this.group.add(this.terrain);

    // Trees: instanced trunks + two soft round foliage blobs.
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1, 10);
    const coneGeo = new THREE.SphereGeometry(0.62, 18, 12);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 }), map.trees.length);
    const leaves = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ color: 0x3f8f45, roughness: 0.8 }), map.trees.length * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    map.trees.forEach((t, i) => {
      const y = map.heightAt(t.x, t.z);
      const h = 2.4 * t.s;
      trunks.setMatrixAt(i, m.compose(p.set(t.x, y + h / 2, t.z), q.identity(), s.set(t.s, h, t.s)));
      leaves.setMatrixAt(i * 2, m.compose(p.set(t.x, y + h + 0.5 * t.s, t.z), q, s.set(2.4 * t.s, 2.1 * t.s, 2.4 * t.s)));
      leaves.setMatrixAt(i * 2 + 1, m.compose(p.set(t.x + 0.2 * t.s, y + h + 1.5 * t.s, t.z - 0.1 * t.s), q, s.set(1.7 * t.s, 1.6 * t.s, 1.7 * t.s)));
    });
    for (const im of [trunks, leaves]) { im.castShadow = true; im.receiveShadow = true; this.group.add(im); }

    const rockGeo = new THREE.IcosahedronGeometry(1, 2);
    const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x9a968e, roughness: 0.85 }), map.rocks.length);
    map.rocks.forEach((r, i) => {
      q.setFromEuler(new THREE.Euler(r.x, r.z, r.r));
      rocks.setMatrixAt(i, m.compose(p.set(r.x, map.heightAt(r.x, r.z) + r.r * 0.35, r.z), q, s.set(r.r, r.r * 0.9, r.r)));
    });
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    this.group.add(rocks);

    // Soft round clouds.
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xb4c4d4, emissiveIntensity: 0.45 });
    const puff = new THREE.SphereGeometry(1, 16, 12);
    for (let i = 0; i < 14; i++) {
      const cloud = new THREE.Group();
      const a = (i / 14) * Math.PI * 2 + Math.sin(i * 7.1);
      const d = 70 + (i % 4) * 25;
      cloud.position.set(Math.cos(a) * d, 38 + (i % 3) * 7, Math.sin(a) * d);
      for (let j = 0; j < 5; j++) {
        const m = new THREE.Mesh(puff, cloudMat);
        const s = 2.6 + ((i * 3 + j * 5) % 4) * 0.7;
        m.scale.set(s * 1.3, s, s);
        m.position.set((j - 2) * 3, Math.abs(j - 2) === 1 ? 1.3 : 0, ((i + j) % 3) - 1);
        cloud.add(m);
      }
      this.group.add(cloud);
    }

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
