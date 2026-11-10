import * as THREE from 'three';

/**
 * Procedural sound effects with the Web Audio API — no audio files needed.
 * Sounds are lightly spatialised (distance falloff + stereo pan from the camera)
 * and rate-limited so a 50-unit brawl doesn't clip.
 */
export type SfxName =
  | 'swing' | 'hitSword' | 'hitClub' | 'clang' | 'cast' | 'explode' | 'death'
  | 'place' | 'remove' | 'click' | 'start' | 'victory' | 'whoosh' | 'bow' | 'block';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private readonly last = new Map<SfxName, number>();
  private voices = 0;
  private volume = 0.7;
  muted = false;
  private readonly listener = new THREE.Vector3();
  private readonly right = new THREE.Vector3(1, 0, 0);

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock(): void {
    if (typeof AudioContext === 'undefined') return;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 6;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.value = this.muted ? 0 : v;
  }
  getVolume(): number {
    return this.volume;
  }
  toggleMute(): boolean {
    this.muted = !this.muted;
    this.setVolume(this.volume);
    return this.muted;
  }

  setListener(cam: THREE.Camera): void {
    this.listener.copy(cam.position);
    this.right.set(1, 0, 0).applyQuaternion(cam.quaternion);
  }

  play(name: SfxName, pos?: THREE.Vector3, power = 1): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted) return;
    const now = ctx.currentTime;
    const gap = name === 'swing' || name === 'hitSword' || name === 'hitClub' ? 0.04 : 0.025;
    if ((this.last.get(name) ?? -1) > now - gap) return;
    if (this.voices > 28) return;
    let gain = 1;
    let pan = 0;
    if (pos) {
      const d = pos.distanceTo(this.listener);
      gain = 1 / (1 + d / 14);
      if (gain < 0.04) return;
      const dir = pos.clone().sub(this.listener).normalize();
      pan = THREE.MathUtils.clamp(dir.dot(this.right), -1, 1) * 0.8;
    }
    this.last.set(name, now);
    const out = ctx.createGain();
    out.gain.value = gain * (0.35 + 0.65 * power);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    out.connect(panner).connect(this.master);
    this.voices++;
    const done = (t: number) => setTimeout(() => { this.voices--; out.disconnect(); }, t * 1000 + 50);
    const r = 0.9 + Math.random() * 0.2; // random pitch so repeats don't sound robotic
    switch (name) {
      case 'swing':
      case 'whoosh': done(this.whoosh(out, now, r, name === 'whoosh' ? 0.6 : 0.28)); break;
      case 'hitSword': done(this.hitSword(out, now, r)); break;
      case 'hitClub': done(this.hitClub(out, now, r)); break;
      case 'clang': done(this.clang(out, now, r)); break;
      case 'cast': done(this.cast(out, now, r)); break;
      case 'explode': done(this.explode(out, now, r)); break;
      case 'death': done(this.death(out, now, r)); break;
      case 'place': done(this.blip(out, now, 480 * r, 900 * r, 0.09, 'sine', 0.35)); break;
      case 'remove': done(this.blip(out, now, 620 * r, 260 * r, 0.1, 'triangle', 0.3)); break;
      case 'click': done(this.blip(out, now, 1300, 1100, 0.035, 'square', 0.08)); break;
      case 'bow': done(this.bow(out, now, r)); break;
      case 'block': done(this.block(out, now, r)); break;
      case 'start': done(this.horn(out, now)); break;
      case 'victory': done(this.fanfare(out, now)); break;
    }
  }

  // ---------------------------------------------------------------- voices
  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private noiseSrc(t: number, dur: number): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.start(t, Math.random() * 0.5, dur + 0.05);
    return s;
  }

  private osc(type: OscillatorType, f0: number, f1: number, t: number, dur: number): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private whoosh(out: AudioNode, t: number, r: number, dur: number): number {
    const ctx = this.ctx!;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(350 * r, t);
    bp.frequency.exponentialRampToValueAtTime(2200 * r, t + dur * 0.45);
    bp.frequency.exponentialRampToValueAtTime(500 * r, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.5, dur * 0.4, dur * 0.6);
    this.noiseSrc(t, dur).connect(bp).connect(g).connect(out);
    return dur;
  }

  private hitSword(out: AudioNode, t: number, r: number): number {
    const ctx = this.ctx!;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const g = ctx.createGain();
    this.env(g, t, 0.6, 0.003, 0.12);
    this.noiseSrc(t, 0.15).connect(hp).connect(g).connect(out);
    const g2 = ctx.createGain();
    this.env(g2, t, 0.8, 0.004, 0.16);
    this.osc('sine', 190 * r, 55, t, 0.18).connect(g2).connect(out);
    return 0.25;
  }

  private hitClub(out: AudioNode, t: number, r: number): number {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    this.env(g, t, 1.0, 0.004, 0.22);
    this.osc('sine', 160 * r, 45, t, 0.25).connect(g).connect(out);
    const g2 = ctx.createGain();
    this.env(g2, t, 0.45, 0.002, 0.12);
    this.osc('triangle', 700 * r, 180 * r, t, 0.12).connect(g2).connect(out); // cartoon "bonk"
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 600;
    const g3 = ctx.createGain();
    this.env(g3, t, 0.5, 0.002, 0.08);
    this.noiseSrc(t, 0.1).connect(bp).connect(g3).connect(out);
    return 0.3;
  }

  private clang(out: AudioNode, t: number, r: number): number {
    const ctx = this.ctx!;
    for (const [f, a, d] of [[1520, 0.3, 0.5], [2390, 0.22, 0.4], [3810, 0.15, 0.3], [5020, 0.08, 0.2]]) {
      const g = ctx.createGain();
      this.env(g, t, a, 0.002, d);
      this.osc('sine', f * r, f * r * 0.995, t, d).connect(g).connect(out);
    }
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const g = ctx.createGain();
    this.env(g, t, 0.4, 0.001, 0.05);
    this.noiseSrc(t, 0.06).connect(hp).connect(g).connect(out);
    return 0.55;
  }

  private cast(out: AudioNode, t: number, r: number): number {
    const ctx = this.ctx!;
    const o = this.osc('sawtooth', 220 * r, 880 * r, t, 0.45);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 18;
    const lg = ctx.createGain();
    lg.gain.value = 40;
    lfo.connect(lg).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + 0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    const g = ctx.createGain();
    this.env(g, t, 0.28, 0.05, 0.4);
    o.connect(lp).connect(g).connect(out);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5000;
    const g2 = ctx.createGain();
    this.env(g2, t, 0.25, 0.1, 0.35);
    this.noiseSrc(t, 0.5).connect(hp).connect(g2).connect(out);
    return 0.5;
  }

  private explode(out: AudioNode, t: number, r: number): number {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800 * r, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + 1.0);
    const g = ctx.createGain();
    this.env(g, t, 1.2, 0.005, 1.1);
    this.noiseSrc(t, 1.2).connect(lp).connect(g).connect(out);
    const g2 = ctx.createGain();
    this.env(g2, t, 1.0, 0.005, 0.5);
    this.osc('sine', 90 * r, 30, t, 0.55).connect(g2).connect(out);
    return 1.2;
  }

  private death(out: AudioNode, t: number, r: number): number {
    const ctx = this.ctx!;
    const f = (160 + Math.random() * 140) * r;
    const o = this.osc('sawtooth', f, f * 0.45, t, 0.5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(450, t + 0.5); // "wah-oof"
    const g = ctx.createGain();
    this.env(g, t, 0.45, 0.03, 0.5);
    o.connect(bp).connect(g).connect(out);
    return 0.6;
  }

  private blip(out: AudioNode, t: number, f0: number, f1: number, dur: number, type: OscillatorType, peak: number): number {
    const g = this.ctx!.createGain();
    this.env(g, t, peak, 0.005, dur);
    this.osc(type, f0, f1, t, dur).connect(g).connect(out);
    return dur + 0.05;
  }

  /** Bowstring twang: plucked low string plus a little air. */
  private bow(out: AudioNode, t: number, r: number): number {
    const g = this.ctx!.createGain();
    this.env(g, t, 0.45, 0.003, 0.25);
    const lp = this.ctx!.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + 0.25);
    this.osc('sawtooth', 210 * r, 160 * r, t, 0.28).connect(lp).connect(g).connect(out);
    this.whoosh(out, t + 0.02, r * 1.3, 0.18);
    return 0.35;
  }

  /** Shield block: a dull wooden thunk with a metal ting. */
  private block(out: AudioNode, t: number, r: number): number {
    const ctx = this.ctx!;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 380 * r;
    bp.Q.value = 2;
    const g = ctx.createGain();
    this.env(g, t, 1.0, 0.002, 0.14);
    this.noiseSrc(t, 0.16).connect(bp).connect(g).connect(out);
    const g2 = ctx.createGain();
    this.env(g2, t, 0.7, 0.002, 0.16);
    this.osc('sine', 130 * r, 70, t, 0.18).connect(g2).connect(out);
    const g3 = ctx.createGain();
    this.env(g3, t, 0.12, 0.002, 0.3);
    this.osc('sine', 2100 * r, 2080 * r, t, 0.3).connect(g3).connect(out);
    return 0.35;
  }

  private horn(out: AudioNode, t: number): number {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.linearRampToValueAtTime(1600, t + 0.4);
    lp.frequency.linearRampToValueAtTime(700, t + 1.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.25);
    g.gain.setValueAtTime(0.35, t + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    lp.connect(g).connect(out);
    for (const f of [146.8, 220, 293.7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.97, t);
      o.frequency.linearRampToValueAtTime(f, t + 0.2);
      o.connect(lp);
      o.start(t);
      o.stop(t + 1.45);
    }
    return 1.5;
  }

  private fanfare(out: AudioNode, t: number): number {
    const notes = [523.3, 659.3, 784, 1046.5, 784, 1046.5];
    const times = [0, 0.13, 0.26, 0.4, 0.62, 0.75];
    notes.forEach((f, i) => {
      const g = this.ctx!.createGain();
      const dur = i === notes.length - 1 ? 0.8 : 0.16;
      this.env(g, t + times[i], 0.3, 0.01, dur);
      this.osc('triangle', f, f, t + times[i], dur).connect(g).connect(out);
      const g2 = this.ctx!.createGain();
      this.env(g2, t + times[i], 0.08, 0.01, dur);
      this.osc('square', f / 2, f / 2, t + times[i], dur).connect(g2).connect(out);
    });
    return 1.7;
  }
}

export const sfx = new Sfx();
