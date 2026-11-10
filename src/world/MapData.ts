import { RAPIER, type Physics } from '../core/Physics';

export interface Rock { x: number; z: number; r: number }
export interface Tree { x: number; z: number; s: number }

/** Pure-data map: terrain height function plus prop placement. Shared by physics and visuals. */
export interface MapData {
  name: string;
  size: number;
  segments: number;
  /** Half-extent of the flat battle area. */
  arena: number;
  heightAt(x: number, z: number): number;
  rocks: Rock[];
  trees: Tree[];
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** "Grassy Plains": a flat arena ringed by rolling hills, rocks and trees. */
export function createGrassyPlains(seed = 7): MapData {
  const rand = mulberry32(seed);
  const arena = 34;
  const heightAt = (x: number, z: number) => {
    const r = Math.max(Math.abs(x), Math.abs(z) * 1.1);
    const ring = smooth(arena, arena + 26, r);
    const hills = 3.2 + 2.2 * Math.sin(x * 0.07 + 1.3) * Math.cos(z * 0.06) + 1.4 * Math.sin(x * 0.13 + z * 0.11);
    const ripple = 0.12 * Math.sin(x * 0.35) * Math.sin(z * 0.31);
    return ring * hills * 2.2 + ripple * (1 - ring) * smooth(4, 20, r);
  };
  const rocks: Rock[] = [];
  const trees: Tree[] = [];
  for (let i = 0; i < 70; i++) {
    const a = rand() * Math.PI * 2;
    const d = arena + 6 + rand() * 40;
    trees.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, s: 0.8 + rand() * 0.7 });
  }
  for (let i = 0; i < 30; i++) {
    const a = rand() * Math.PI * 2;
    const d = arena - 4 + rand() * 40;
    rocks.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: 0.6 + rand() * 1.4 });
  }
  // A few small boulders inside the arena (but off the centre line) for some chaos.
  for (const [x, z] of [[-6, 16], [7, -15], [0, 24], [0, -24]]) rocks.push({ x, z, r: 0.7 });
  return { name: 'Grassy Plains', size: 160, segments: 120, arena, heightAt, rocks, trees };
}

/** Build the terrain grid (shared by trimesh collider and render mesh). */
export function terrainGrid(map: MapData): { vertices: Float32Array; indices: Uint32Array } {
  const n = map.segments;
  const half = map.size / 2;
  const step = map.size / n;
  const vertices = new Float32Array((n + 1) * (n + 1) * 3);
  const indices = new Uint32Array(n * n * 6);
  let k = 0;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = -half + i * step;
      const z = -half + j * step;
      vertices[k++] = x;
      vertices[k++] = map.heightAt(x, z);
      vertices[k++] = z;
    }
  }
  k = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + (n + 1);
      const d = c + 1;
      indices[k++] = a; indices[k++] = c; indices[k++] = b;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }
  }
  return { vertices, indices };
}

export function buildMapPhysics(physics: Physics, map: MapData): void {
  const world = physics.world;
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const { vertices, indices } = terrainGrid(map);
  const gc = world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(1.0), ground);
  physics.tag(gc, { kind: 'ground' });
  for (const r of map.rocks) {
    const c = world.createCollider(
      RAPIER.ColliderDesc.ball(r.r).setTranslation(r.x, map.heightAt(r.x, r.z) + r.r * 0.35, r.z).setFriction(0.9),
      ground,
    );
    physics.tag(c, { kind: 'prop' });
  }
  for (const t of map.trees) {
    const h = 2.4 * t.s;
    const c = world.createCollider(
      RAPIER.ColliderDesc.cylinder(h / 2, 0.22 * t.s).setTranslation(t.x, map.heightAt(t.x, t.z) + h / 2, t.z),
      ground,
    );
    physics.tag(c, { kind: 'prop' });
  }
}
