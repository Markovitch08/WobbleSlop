import * as THREE from 'three';
import type { Projectile } from '../battle/Battle';

const MAX = 1600;

interface Particle { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; size: number; drag: number; grav: number }
interface Flash { mesh: THREE.Mesh; t: number; max: number; radius: number }

/** Cheap pooled particles (one InstancedMesh) plus expanding explosion flashes. */
export class Effects {
  private readonly mesh: THREE.InstancedMesh;
  private readonly parts: (Particle | null)[] = new Array(MAX).fill(null);
  private cursor = 0;
  private readonly flashes: Flash[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor(private readonly scene: THREE.Scene) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX; i++) {
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, this.c.set(0xffffff));
    }
    scene.add(this.mesh);
  }

  burst(pos: THREE.Vector3, count: number, color: number, speed: number, size: number, life = 0.6, grav = 9, spread = 1): void {
    for (let n = 0; n < count; n++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2 * spread, Math.random() - 0.5).normalize()
        .multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      const l = life * (0.6 + Math.random() * 0.8);
      this.parts[i] = { p: pos.clone(), v, life: l, max: l, size: size * (0.6 + Math.random() * 0.8), drag: 1.5, grav };
      this.c.set(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.2);
      this.mesh.setColorAt(i, this.c);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  hit(pos: THREE.Vector3, power: number): void {
    this.burst(pos, 6 + Math.round(power * 10), 0xc8202a, 3 + power * 4, 0.05, 0.5);
    this.burst(pos, 4, 0xfff4c0, 5, 0.03, 0.18, 0);
  }

  clang(pos: THREE.Vector3): void {
    this.burst(pos, 10, 0xffd75a, 7, 0.025, 0.25, 4);
  }

  dust(pos: THREE.Vector3): void {
    this.burst(pos, 8, 0xb59b74, 1.5, 0.09, 0.8, -0.5);
  }

  explode(pos: THREE.Vector3, radius: number): void {
    this.burst(pos, 40, 0xff8a1e, radius * 4, 0.1, 0.7, 4);
    this.burst(pos, 18, 0x8a8078, radius * 1.5, 0.12, 1.1, -1);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.flashes.push({ mesh, t: 0, max: 0.35, radius });
  }

  trail(p: Projectile): void {
    const t = p.body.translation();
    this.burst(new THREE.Vector3(t.x, t.y, t.z), 1, p.def.color, 0.6, 0.07, 0.35, -1);
  }

  update(dt: number): void {
    const { m, q, s } = this;
    for (let i = 0; i < MAX; i++) {
      const p = this.parts[i];
      if (!p) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.parts[i] = null;
        this.mesh.setMatrixAt(i, m.makeScale(0, 0, 0));
        continue;
      }
      p.v.y -= p.grav * dt;
      p.v.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.p.addScaledVector(p.v, dt);
      const k = p.size * Math.min(1, (p.life / p.max) * 1.5);
      this.mesh.setMatrixAt(i, m.compose(p.p, q, s.set(k, k, k)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      const k = f.t / f.max;
      f.mesh.scale.setScalar(f.radius * (0.3 + k * 0.9));
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      if (k >= 1) {
        this.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        (f.mesh.material as THREE.Material).dispose();
        this.flashes.splice(i, 1);
      }
    }
  }
}

const ballGeo = new THREE.SphereGeometry(1, 14, 10);

export class ProjectileView {
  private readonly core: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  constructor(private readonly p: Projectile, private readonly scene: THREE.Scene) {
    this.core = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: 0xfff1b0 }));
    this.core.scale.setScalar(p.def.radius * 0.8);
    this.halo = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: p.def.color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.halo.scale.setScalar(p.def.radius * 1.8);
    scene.add(this.core, this.halo);
    p.view = this;
    this.sync();
  }
  sync(): void {
    const t = this.p.body.translation();
    this.core.position.set(t.x, t.y, t.z);
    this.halo.position.set(t.x, t.y, t.z);
    this.halo.scale.setScalar(this.p.def.radius * (1.6 + Math.random() * 0.5));
  }
  dispose(): void {
    this.scene.remove(this.core, this.halo);
    (this.core.material as THREE.Material).dispose();
    (this.halo.material as THREE.Material).dispose();
  }
}
