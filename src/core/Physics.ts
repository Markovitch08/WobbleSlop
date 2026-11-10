import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

let ready: Promise<void> | null = null;
/** Loads the Rapier wasm module once. Must be awaited before creating a Physics world. */
export function initRapier(): Promise<void> {
  if (!ready) ready = RAPIER.init();
  return ready;
}

export type TagKind = 'ground' | 'prop' | 'body' | 'weapon' | 'shield' | 'projectile';

/** Game metadata attached to every collider, looked up by collider handle. */
export interface ColliderTag {
  kind: TagKind;
  /** Owning unit id (bodies and weapons), or the caster's id for projectiles. */
  unitId?: number;
  team?: number;
  /** Free slot for the owner object (Unit part, Projectile...). */
  ref?: unknown;
}

export type CollisionListener = (a: ColliderTag, b: ColliderTag, ca: RAPIER.Collider, cb: RAPIER.Collider) => void;

/*
 * Collision filtering with Rapier's 16-bit interaction groups (membership << 16 | filter),
 * evaluated inside the wasm solver, so no per-pair JS callbacks:
 *   bit 0       static world
 *   bits 1..10  "slot" of a unit (unitId % 10): a unit never collides with its own slot,
 *               so its limbs and weapon don't self-collide
 *   bits 11,12  body of team 0/1
 *   bits 13,14  weapon, shield or projectile of team 0/1 (never hits its own team)
 * Side effect: two teammates sharing a slot (1 in 10) can overlap. Enemies always collide.
 */
const ALL = 0xffff;
const SLOTS = 10;
const bit = (n: number) => 1 << n;

export function collisionGroups(tag: ColliderTag): number {
  let member = 0;
  let filter = ALL;
  const team = tag.team ?? 0;
  const slot = tag.unitId !== undefined ? bit(1 + (tag.unitId % SLOTS)) : 0;
  switch (tag.kind) {
    case 'ground':
    case 'prop':
      member = bit(0);
      break;
    case 'body':
      member = slot | bit(11 + team);
      filter = ALL & ~slot & ~bit(11 + team) & ~bit(13 + team);
      break;
    case 'weapon':
    case 'shield':
      member = slot | bit(13 + team);
      filter = ALL & ~slot & ~bit(11 + team) & ~bit(13 + team);
      break;
    case 'projectile':
      member = bit(13 + team);
      filter = ALL & ~bit(11 + team) & ~bit(13 + team);
      break;
  }
  return ((member << 16) | filter) >>> 0;
}

/** Fixed simulation rate. 60 Hz with 8 solver iterations; rendering interpolates between steps (see UnitView). */
export const PHYSICS_HZ = 60;
export const PHYSICS_DT = 1 / PHYSICS_HZ;
export const GRAVITY = 9.81;

/**
 * Thin wrapper around a Rapier world: fixed-step integration, collider tagging,
 * contact filtering (no self-collision, no friendly weapon contact) and collision events.
 * Independent of rendering so battles can run headless.
 */
export class Physics {
  readonly world: RAPIER.World;
  private readonly events: RAPIER.EventQueue;
  private readonly tags = new Map<number, ColliderTag>();
  private readonly listeners: CollisionListener[] = [];
  /** Simulated seconds since creation. */
  time = 0;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = PHYSICS_DT;
    this.world.numSolverIterations = 8;
    this.events = new RAPIER.EventQueue(true);
  }

  /** Tag a collider with game metadata and set its collision groups from it. */
  tag(collider: RAPIER.Collider, tag: ColliderTag): void {
    this.tags.set(collider.handle, tag);
    collider.setCollisionGroups(collisionGroups(tag));
  }

  getTag(collider: RAPIER.Collider | number): ColliderTag | undefined {
    return this.tags.get(typeof collider === 'number' ? collider : collider.handle);
  }

  onCollision(fn: CollisionListener): void {
    this.listeners.push(fn);
  }

  removeBody(body: RAPIER.RigidBody): void {
    for (let i = 0; i < body.numColliders(); i++) this.tags.delete(body.collider(i).handle);
    this.world.removeRigidBody(body);
  }

  step(): void {
    this.world.step(this.events);
    this.time += PHYSICS_DT;
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.tags.get(h1);
      const b = this.tags.get(h2);
      if (!a || !b) return;
      const ca = this.world.getCollider(h1);
      const cb = this.world.getCollider(h2);
      for (const l of this.listeners) l(a, b, ca, cb);
    });
  }

  /** Downward ray against static ground/props only. Returns hit distance or null. */
  groundDistance(x: number, y: number, z: number, maxDist: number): number | null {
    const ray = new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, maxDist, true, undefined, undefined, undefined, undefined, (c) => {
      const t = this.tags.get(c.handle);
      return !!t && (t.kind === 'ground' || t.kind === 'prop');
    });
    return hit ? hit.timeOfImpact : null;
  }

  dispose(): void {
    this.events.free();
    this.world.free();
    this.tags.clear();
  }
}
