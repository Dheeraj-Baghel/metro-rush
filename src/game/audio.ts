// METRO RUSH audio: curated CC0 samples (see public/assets/c/audio/
// audio-sources.json) on four buses — master > music / sfx / ambience —
// plus a priority duck so train warnings sit above ambience and music.
//
// Rules implemented here:
//   • context is created/resumed only from a user gesture (Play / any button)
//   • voice caps per group (coins 4, steps 2, whoosh 2, train 2)
//   • coin pitch rises gently through a chain, resets after 0.9 s of no coins
//   • trains: gain + stereo pan follow distance and lane; horn on warning
//   • music/ambience loop gaplessly (AudioBufferSourceNode.loop on
//     crossfaded buffers) and fade on pause / tab hide / game over
//   • every sound started by a run is stopped on restart (no leftovers)
// Synthesis remains only as an explicit fallback if a buffer failed to
// decode (logged), never as the primary sound.
import type { Settings } from './config';

type Sfx = 'click' | 'back' | 'jump' | 'land' | 'slide' | 'lane' | 'coin' | 'powerup' | 'activate' | 'trainHorn'
  | 'crash' | 'crashMetal' | 'gameOver' | 'highScore' | 'countTick' | 'countGo';

const CAPS: Record<string, number> = { coin: 4, step: 2, lane: 2, train: 2, jump: 2, land: 2 };

interface Voice { src: AudioBufferSourceNode; gain: GainNode; group: string; run: boolean }

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode; private musicBus!: GainNode; private sfxBus!: GainNode; private ambBus!: GainNode;
  private duck!: GainNode; // music+ambience ducking for priority cues
  private raw = new Map<string, ArrayBuffer>();
  private buf = new Map<string, AudioBuffer>();
  private voices: Voice[] = [];
  private music: Voice | null = null;
  private amb: Voice | null = null;
  private trains = new Map<object, { v: Voice; panner: StereoPannerNode }>();
  private coinChain = 0; private lastCoin = 0;
  private stepIdx = 0;
  private settings: Settings;
  decodeFailures: string[] = [];
  private decoding: Promise<void> | null = null;

  constructor(settings: Settings) { this.settings = settings; }

  /** Hand over preloaded bytes (decoded lazily once the context exists). */
  provide(raw: Map<string, ArrayBuffer>) { for (const [k, v] of raw) this.raw.set(k, v); }

  /** Must be called from a user gesture. Resolves once buffers are decoded. */
  unlock(): Promise<void> {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return Promise.resolve();
      this.ctx = new AC({ latencyHint: 'interactive' });
      const c = this.ctx;
      this.master = c.createGain(); this.master.connect(c.destination);
      // gentle limiter: protects against stacked transients clipping
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
      comp.connect(this.master);
      this.duck = c.createGain(); this.duck.connect(comp);
      this.musicBus = c.createGain(); this.musicBus.connect(this.duck);
      this.ambBus = c.createGain(); this.ambBus.connect(this.duck);
      this.sfxBus = c.createGain(); this.sfxBus.connect(comp);
      this.applySettings(this.settings);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    if (!this.decoding) this.decoding = this.decodeAll();
    return this.decoding;
  }

  private async decodeAll() {
    const c = this.ctx!;
    await Promise.all([...this.raw].map(async ([k, ab]) => {
      try { this.buf.set(k, await c.decodeAudioData(ab.slice(0))); }
      catch (e) { this.decodeFailures.push(k); console.warn(`[metro-rush] audio decode failed: ${k}`, e); }
    }));
  }

  get ready() { return !!this.ctx && this.buf.size > 0; }

  applySettings(s: Settings) {
    this.settings = s;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.masterVolume, t, 0.03);
    this.musicBus.gain.setTargetAtTime(s.musicVolume * 0.42, t, 0.03); // music sits under action cues
    this.sfxBus.gain.setTargetAtTime(s.sfxVolume, t, 0.03);
    this.ambBus.gain.setTargetAtTime(s.ambienceVolume * 0.32, t, 0.03);
  }

  private start(name: string, { gain = 1, rate = 1, group = name, run = true, pan = 0, loop = false, when = 0, dest }: { gain?: number; rate?: number; group?: string; run?: boolean; pan?: number; loop?: boolean; when?: number; dest?: AudioNode } = {}): Voice | null {
    const c = this.ctx; const b = this.buf.get(name);
    if (!c || !b) return null;
    const cap = CAPS[group];
    if (cap) {
      const same = this.voices.filter((v) => v.group === group);
      if (same.length >= cap) { const old = same[0]; try { old.src.stop(); } catch {} }
    }
    const src = c.createBufferSource();
    src.buffer = b; src.playbackRate.value = rate; src.loop = loop;
    const g = c.createGain(); g.gain.value = gain;
    let node: AudioNode = g;
    if (pan) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
    src.connect(g);
    node.connect(dest ?? this.sfxBus);
    const v: Voice = { src, gain: g, group, run };
    this.voices.push(v);
    src.onended = () => { const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1); };
    src.start(c.currentTime + when);
    return v;
  }

  play(name: Sfx) {
    if (!this.ctx) return;
    switch (name) {
      case 'coin': {
        const now = this.ctx.currentTime;
        this.coinChain = now - this.lastCoin < 0.9 ? Math.min(this.coinChain + 1, 10) : 0;
        this.lastCoin = now;
        // +~1 semitone per coin, capped at a fifth above
        this.start('coin', { gain: 0.55, rate: Math.pow(2, Math.min(this.coinChain, 7) / 12), group: 'coin' });
        break;
      }
      case 'jump': this.start('jump', { gain: 0.6, rate: 0.96 + Math.random() * 0.08 }); break;
      case 'land': this.start('land', { gain: 0.55, rate: 0.95 + Math.random() * 0.1 }); break;
      case 'slide': this.start('slide', { gain: 0.75 }); break;
      case 'lane': this.start('lane', { gain: 0.5, rate: 0.95 + Math.random() * 0.1 }); break;
      case 'powerup': this.start('powerup', { gain: 0.65 }); break;
      case 'activate': this.start('activate', { gain: 0.5 }); break;
      case 'trainHorn': this.duckFor(1.6); this.start('trainHorn', { gain: 0.7, group: 'train' }); break;
      case 'crash': this.start('crash', { gain: 0.95 }); this.start('crashMetal', { gain: 0.45, when: 0.02 }); break;
      case 'crashMetal': this.start('crashMetal', { gain: 0.5 }); break;
      case 'gameOver': this.start('gameOver', { gain: 0.55, run: false, when: 0.35 }); break;
      case 'highScore': this.start('highScore', { gain: 0.6, run: false, when: 0.35 }); break;
      case 'click': this.start('click', { gain: 0.6, run: false }); break;
      case 'back': this.start('back', { gain: 0.6, run: false }); break;
      case 'countTick': this.start('countTick', { gain: 0.7, run: false }); break;
      case 'countGo': this.start('countGo', { gain: 0.6, run: false }); break;
    }
  }

  footstep() {
    if (!this.ctx) return;
    const i = this.stepIdx++ % 4;
    // restrained variation: tiny pitch + level jitter, never the same twice
    this.start('step' + i, { gain: 0.3 + Math.random() * 0.06, rate: 0.97 + Math.random() * 0.06, group: 'step' });
  }

  private duckFor(sec: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, g = this.duck.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0.45, t, 0.05);
    g.setTargetAtTime(1, t + sec, 0.4);
  }

  // ---------- trains: positional pass-by ----------
  trainStart(key: object, lane: number) {
    if (!this.ctx || this.trains.has(key)) return;
    if ([...this.trains.values()].length >= CAPS.train) return;
    const c = this.ctx;
    const panner = c.createStereoPanner();
    const g = c.createGain(); g.gain.value = 0;
    panner.connect(this.sfxBus);
    const b = this.buf.get('trainPass');
    if (!b) return;
    const src = c.createBufferSource(); src.buffer = b; src.loop = true;
    // loop only the steady rumble region so long approaches don't restart the swell
    src.loopStart = 1.6; src.loopEnd = 4.6;
    src.connect(g); g.connect(panner);
    src.start();
    const v: Voice = { src, gain: g, group: 'train', run: true };
    this.voices.push(v);
    src.onended = () => { const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1); };
    panner.pan.value = (lane - 1) * 0.6;
    this.trains.set(key, { v, panner });
  }

  /** distance: metres ahead (+) / behind (−) of the player; lane offset from player lane. */
  trainUpdate(key: object, distance: number, laneOffset: number) {
    const t = this.trains.get(key);
    if (!t || !this.ctx) return;
    const now = this.ctx.currentTime;
    const d = Math.abs(distance);
    const level = Math.min(1, 9 / (d + 3)) * (distance < 0 ? Math.max(0, 1 + distance / 25) : 1);
    t.v.gain.gain.setTargetAtTime(level * 0.85, now, 0.06);
    t.panner.pan.setTargetAtTime(Math.max(-0.9, Math.min(0.9, laneOffset * 0.45)), now, 0.08);
    t.v.src.playbackRate.setTargetAtTime(distance > 0 ? 1.04 : 0.94, now, 0.2); // small doppler cue
  }

  trainStop(key: object) {
    const t = this.trains.get(key);
    if (!t || !this.ctx) return;
    t.v.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    try { t.v.src.stop(this.ctx.currentTime + 0.8); } catch {}
    this.trains.delete(key);
  }

  // ---------- beds ----------
  startMusic() {
    if (!this.ctx || this.music) return;
    this.music = this.start('music', { loop: true, dest: this.musicBus, gain: 0, run: false, group: 'music' });
    this.music?.gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.4);
  }
  stopMusic(fade = 0.5) {
    if (!this.ctx || !this.music) return;
    const m = this.music; this.music = null;
    m.gain.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
    try { m.src.stop(this.ctx.currentTime + fade * 1.5); } catch {}
  }
  startAmbience() {
    if (!this.ctx || this.amb) return;
    this.amb = this.start('ambience', { loop: true, dest: this.ambBus, gain: 0, run: false, group: 'amb' });
    this.amb?.gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.8);
  }
  stopAmbience(fade = 0.6) {
    if (!this.ctx || !this.amb) return;
    const a = this.amb; this.amb = null;
    a.gain.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
    try { a.src.stop(this.ctx.currentTime + fade * 1.5); } catch {}
  }

  /** Stop everything a run started (restart / menu). Beds handled separately. */
  stopRunSounds() {
    for (const k of [...this.trains.keys()]) this.trainStop(k);
    for (const v of [...this.voices]) if (v.run) { try { v.src.stop(); } catch {} }
    this.coinChain = 0;
  }

  /** Pause/tab hide: suspend the whole graph so nothing keeps playing. */
  suspend() { this.ctx?.suspend().catch(() => {}); }
  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {}); }

  debug() {
    return { state: this.ctx?.state ?? 'none', voices: this.voices.length, trains: this.trains.size, music: !!this.music, amb: !!this.amb, buffers: this.buf.size, failures: this.decodeFailures };
  }
}
