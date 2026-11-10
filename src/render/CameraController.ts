import * as THREE from 'three';
import type { Unit } from '../units/Unit';

export type CamMode = 'free' | 'follow' | 'cinematic';

/**
 * 3D camera:
 *  - free: WASD/arrows move, Space/E up, Ctrl/Q down, Shift = fast,
 *          right- or middle-drag to look, wheel to dolly;
 *  - follow: trails a unit (drag to orbit, wheel to zoom);
 *  - cinematic: hands-off orbit around the action that cuts between fighters.
 */
export class CameraController {
  mode: CamMode = 'free';
  yaw = -Math.PI / 2;
  pitch = -0.45;
  readonly pos = new THREE.Vector3(0, 14, 26);
  private readonly keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  /** Pixels moved during the current right-drag (to tell a click from a drag). */
  dragDistance = 0;
  followTarget: Unit | null = null;
  private followDist = 6;
  private followYaw = 0;
  private cineT = 0;
  private cineCut = 0;
  private readonly cineCenter = new THREE.Vector3();
  enabled = true;

  constructor(private readonly camera: THREE.PerspectiveCamera, dom: HTMLElement, private readonly heightAt: (x: number, z: number) => number) {
    this.lookTowards(new THREE.Vector3(0, 0, 0));
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('mousedown', (e) => {
      if (e.button === 2 || e.button === 1) {
        this.dragging = true;
        this.dragDistance = 0;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 2 || e.button === 1) this.dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging || !this.enabled) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.dragDistance += Math.abs(dx) + Math.abs(dy);
      if (this.mode === 'cinematic') this.mode = 'free';
      if (this.mode === 'follow') {
        this.followYaw += dx * 0.005;
        this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.004, -1.3, 0.3);
      } else {
        this.yaw += dx * 0.004;
        this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.004, -1.5, 1.2);
      }
    });
    dom.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      if (this.mode === 'follow') {
        this.followDist = THREE.MathUtils.clamp(this.followDist * (1 + Math.sign(e.deltaY) * 0.12), 2.5, 30);
        return;
      }
      if (this.mode === 'cinematic') this.mode = 'free';
      this.pos.addScaledVector(this.forward(), -Math.sign(e.deltaY) * 2.5);
    }, { passive: false });
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.cos(this.pitch) * Math.cos(this.yaw), Math.sin(this.pitch), Math.cos(this.pitch) * Math.sin(this.yaw));
  }

  lookTowards(p: THREE.Vector3): void {
    const d = p.clone().sub(this.pos);
    this.yaw = Math.atan2(d.z, d.x);
    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }

  setView(pos: THREE.Vector3, target: THREE.Vector3): void {
    this.mode = 'free';
    this.pos.copy(pos);
    this.lookTowards(target);
  }

  follow(u: Unit | null): void {
    this.followTarget = u;
    if (u) {
      this.mode = 'follow';
      this.followYaw = u.ragdoll.heading + Math.PI;
      this.pitch = -0.3;
    } else this.mode = 'free';
  }

  cinematic(): void {
    this.mode = 'cinematic';
    this.cineCut = 0;
  }

  update(dt: number, units: Unit[]): void {
    if (this.mode === 'follow' && (!this.followTarget || (!this.followTarget.alive && this.followTarget.deadTime > 2.5))) {
      const alive = units.filter((u) => u.alive);
      this.followTarget = alive.length ? alive[Math.floor(Math.random() * alive.length)] : null;
      if (!this.followTarget) this.mode = 'free';
    }
    const moveKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyE', 'KeyQ', 'ControlLeft'];
    if (this.enabled && this.mode !== 'free' && moveKeys.some((k) => this.keys.has(k))) {
      // Grabbing the controls drops out of automatic modes, keeping the current view.
      this.pos.copy(this.camera.position);
      const f = new THREE.Vector3();
      this.camera.getWorldDirection(f);
      this.yaw = Math.atan2(f.z, f.x);
      this.pitch = Math.asin(THREE.MathUtils.clamp(f.y, -1, 1));
      this.mode = 'free';
    }

    if (this.mode === 'free') this.updateFree(dt);
    else if (this.mode === 'follow') this.updateFollow(dt);
    else this.updateCinematic(dt, units);
  }

  private updateFree(dt: number): void {
    if (this.enabled) {
      const k = this.keys;
      const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 32 : 13) * dt;
      const fwd = new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      if (k.has('KeyW') || k.has('ArrowUp')) this.pos.addScaledVector(fwd, speed);
      if (k.has('KeyS') || k.has('ArrowDown')) this.pos.addScaledVector(fwd, -speed);
      if (k.has('KeyD') || k.has('ArrowRight')) this.pos.addScaledVector(right, speed);
      if (k.has('KeyA') || k.has('ArrowLeft')) this.pos.addScaledVector(right, -speed);
      if (k.has('Space') || k.has('KeyE')) this.pos.y += speed;
      if (k.has('ControlLeft') || k.has('KeyQ')) this.pos.y -= speed;
    }
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -90, 90);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -90, 90);
    this.pos.y = THREE.MathUtils.clamp(this.pos.y, this.heightAt(this.pos.x, this.pos.z) + 0.6, 90);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.pos.clone().add(this.forward()));
  }

  private updateFollow(dt: number): void {
    const u = this.followTarget!;
    const c = u.ragdoll.pos('torso');
    const back = new THREE.Vector3(Math.sin(this.followYaw), 0, Math.cos(this.followYaw));
    const h = Math.sin(-this.pitch) * this.followDist + 0.6;
    const want = c.clone().addScaledVector(back, Math.cos(this.pitch) * this.followDist).setY(c.y + h);
    want.y = Math.max(want.y, this.heightAt(want.x, want.z) + 0.5);
    this.camera.position.lerp(want, 1 - Math.exp(-dt * 5));
    this.camera.lookAt(c);
  }

  private updateCinematic(dt: number, units: Unit[]): void {
    this.cineT += dt;
    this.cineCut -= dt;
    const alive = units.filter((u) => u.alive);
    const list = alive.length ? alive : units;
    if (list.length) {
      const c = new THREE.Vector3();
      for (const u of list) c.add(u.pos);
      c.multiplyScalar(1 / list.length);
      this.cineCenter.lerp(c, 1 - Math.exp(-dt * 1.5));
    }
    let spread = 6;
    for (const u of list) spread = Math.max(spread, u.pos.distanceTo(this.cineCenter));
    const r = THREE.MathUtils.clamp(spread * 1.3 + 6, 10, 45);
    const a = this.cineT * 0.12;
    const want = new THREE.Vector3(this.cineCenter.x + Math.cos(a) * r, this.cineCenter.y + r * 0.45 + 2, this.cineCenter.z + Math.sin(a) * r);
    want.y = Math.max(want.y, this.heightAt(want.x, want.z) + 1.5);
    this.camera.position.lerp(want, 1 - Math.exp(-dt * 1.2));
    this.camera.lookAt(this.cineCenter.clone().setY(this.cineCenter.y + 0.8));
  }
}
