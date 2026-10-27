// Runner animation on the Quaternius Universal Base Character rig, using
// dedicated clips from Universal Animation Library 1 + 2 (same skeleton, so
// no retargeting). Root translation tracks were stripped at build time
// (qa/build-runner.py); gameplay owns all character movement.
//
// Clip mapping (verified on the actual body with qa/preview-runner.mjs):
//   idle       Idle_Loop
//   run        Sprint_Loop     (0.67 s cycle, foot contacts at ~0.08 / ~0.42)
//   jumpStart  Jump_Start      takeoff (0.0-0.17 s crouch -> push, then tuck)
//   jumpLoop   Jump_Loop       airborne hold
//   jumpLand   Jump_Land       landing absorb (we play 0.0-0.45 s, then run)
//   slideStart Slide_Start     drop into a real ground slide (not a roll)
//   slideLoop  Slide_Loop      low slide hold (pelvis 0.05 m, head 0.48 m)
//   slideExit  Slide_Exit      stand back up
//   hit        Hit_Chest       shield-absorbed stumble (additive-style flinch)
//   knockback  Hit_Knockback   crash
import * as THREE from 'three';
import type { PlayerAnimState } from './player';

type Clip = 'idle' | 'run' | 'jumpStart' | 'jumpLoop' | 'jumpLand' | 'slideStart' | 'slideLoop' | 'slideExit' | 'hit' | 'knockback' | 'death' | 'celebrate';

// Sprint_Loop foot-contact phases (fraction of cycle) measured from the
// ball_l / ball_r bone heights: lowest support points of each foot.
const RUN_CYCLE = 0.667;
const CONTACTS = [0.08, 0.63]; // start of ball_l / ball_r contact windows (measured)
const RUN_AUTHORED_SPEED = 7.5; // u/s the sprint cycle reads correctly at

export class PlayerAnimator {
  root: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private a: Partial<Record<Clip, THREE.AnimationAction>> = {};
  private current: Clip | null = null;
  private stateTime = 0;
  private lastState: PlayerAnimState | null = null;
  private lean = 0;
  private spine: THREE.Bone | null = null;
  private pelvis: THREE.Bone | null = null;
  private lastPhase = 0;
  onFootContact: (() => void) | null = null;

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    for (const c of clips) this.a[c.name as Clip] = this.mixer.clipAction(c);
    for (const k of ['jumpStart', 'jumpLand', 'slideStart', 'slideExit', 'hit', 'knockback', 'death'] as Clip[]) {
      const act = this.a[k];
      if (act) { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; }
    }
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        if (o.name === 'spine_02') this.spine = o as THREE.Bone;
        if (o.name === 'pelvis') this.pelvis = o as THREE.Bone;
      }
    });
    this.play('idle', 0);
  }

  get ok() { return !!(this.a.run && this.a.idle && this.a.jumpStart && this.a.slideLoop && this.a.knockback); }

  private play(k: Clip, fade: number, timeScale = 1, startAt = 0) {
    const next = this.a[k];
    if (!next) return;
    if (this.current === k) { next.timeScale = timeScale; return; }
    const prev = this.current ? this.a[this.current] : null;
    next.reset();
    next.timeScale = timeScale;
    next.time = startAt;
    next.setEffectiveWeight(1);
    next.play();
    if (prev) {
      if (fade > 0) prev.crossFadeTo(next, fade, false);
      else prev.stop();
    }
    this.current = k;
  }

  /**
   * @param state     gameplay state for this frame
   * @param speed     world speed (u/s)
   * @param leanTarget  -1..1 lane-change lean (signed)
   * @param vy        vertical velocity (for airborne pose choice)
   * @param slideT    seconds elapsed in the current slide
   * @param slideDur  total slide duration
   */
  update(dt: number, state: PlayerAnimState, speed: number, leanTarget: number, vy: number, slideT: number, slideDur: number) {
    if (state !== this.lastState) { this.stateTime = 0; this.onEnter(state); this.lastState = state; }
    else this.stateTime += dt;

    switch (state) {
      case 'idle': this.play('idle', 0.3); break;
      case 'run': {
        // cadence scales with speed; clamp so feet never visibly skate
        const ts = THREE.MathUtils.clamp(speed / RUN_AUTHORED_SPEED, 1.0, 1.75);
        this.play('run', this.current === 'jumpLand' || this.current === 'slideExit' ? 0.12 : 0.18, ts);
        break;
      }
      case 'jump':
        // takeoff -> hold. Jump_Start's push happens at 0.06-0.17 s; skip the
        // anticipatory crouch so the visual takeoff matches the instant input
        if (this.current !== 'jumpStart' && this.current !== 'jumpLoop') this.play('jumpStart', 0.06, 1.6, 0.06);
        else if (this.current === 'jumpStart' && this.stateTime > 0.28) this.play('jumpLoop', 0.18);
        break;
      case 'fall':
        if (this.current !== 'jumpLoop') this.play('jumpLoop', 0.15);
        break;
      case 'fly': this.play('jumpLoop', 0.25); break;
      case 'land':
        // first 0.45 s of Jump_Land is the absorb; then crossfade to run
        this.play('jumpLand', 0.05, 1.7, 0.02);
        break;
      case 'slide': {
        // Slide_Start drops in 0.31 s; scale so we are fully low by ~0.16 s
        // (collider shrinks instantly — pose must get low quickly), hold the
        // loop, and begin Slide_Exit for the last 0.22 s of the slide window
        const remaining = slideDur - slideT;
        if (remaining < 0.22) { if (this.current !== 'slideExit') this.play('slideExit', 0.06, 2.0, 0.05); }
        else if (this.current !== 'slideStart' && this.current !== 'slideLoop') this.play('slideStart', 0.05, 2.0, 0.0);
        else if (this.current === 'slideStart' && this.stateTime > 0.2) this.play('slideLoop', 0.08);
        break;
      }
      case 'crash': this.play('knockback', 0.06, 1.1); break;
    }

    this.mixer.update(dt);

    // footstep events from the actual run cycle phase (not a timer)
    if (state === 'run' && this.current === 'run') {
      const act = this.a.run!;
      const phase = (act.time % RUN_CYCLE) / RUN_CYCLE;
      for (const c of CONTACTS) {
        const crossed = this.lastPhase <= phase ? (this.lastPhase < c && phase >= c) : (this.lastPhase < c || phase >= c);
        if (crossed) this.onFootContact?.();
      }
      this.lastPhase = phase;
    }

    // lane-change lean: absolute (not accumulated) offset on the spine after
    // the mixer has written this frame's pose, so it can never drift
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 14);
    if (this.spine && Math.abs(this.lean) > 1e-3 && state !== 'crash') this.spine.rotateZ(-this.lean * 0.32);
    if (this.pelvis && Math.abs(this.lean) > 1e-3 && state !== 'crash') this.pelvis.rotateZ(-this.lean * 0.12);
  }

  private onEnter(s: PlayerAnimState) {
    if (s === 'run') this.lastPhase = 0;
  }

  /** Shield absorbed a hit: brief stumble without losing the run. */
  stumble() {
    const hit = this.a.hit;
    if (!hit) return;
    hit.reset(); hit.setEffectiveWeight(0.85); hit.timeScale = 1.4; hit.play();
    // layered on top of the running action; fades out by itself
    hit.fadeOut(0.35);
  }

  celebrate() {
    // milestone flourish while running: a short additive-weight wave of the
    // dance clip, faded quickly so it never interrupts control
    const c = this.a.celebrate;
    if (!c) return;
    c.reset(); c.setEffectiveWeight(0.35); c.play(); c.fadeOut(0.9);
  }

  reset() {
    this.mixer.stopAllAction();
    this.current = null;
    this.lastState = null;
    this.lean = 0;
    this.play('idle', 0);
  }
}
