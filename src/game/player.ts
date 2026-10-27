// Runner gameplay body: lane interpolation, jump/slide/land state, roof
// grounding and the state-aware collider. Visuals are the skinned
// Quaternius runner (PlayerAnimator) — there is no procedural fallback body;
// the loading screen guarantees the runner exists before play.
import * as THREE from 'three';
import { CONFIG } from './config';
import { PlayerAnimator } from './playerAnimator';

export type PlayerAnimState = 'idle' | 'run' | 'jump' | 'fall' | 'land' | 'slide' | 'crash' | 'fly';

/** World query: height of the walkable surface under (lane x, z). */
export type SupportQuery = (x: number, z: number, halfWidth: number) => number;

export class Player {
  group = new THREE.Group();
  lane = 1;
  targetLane = 1;
  laneX = 0;
  y = 0;
  vy = 0;
  grounded = true;
  groundY = 0; // height of the surface we are standing on (0 = track, >0 = roof)
  sliding = false;
  slideTimer = 0;
  crashed = false;
  jetpack = false;
  shield = false;
  anim: PlayerAnimState = 'idle';
  private landTimer = 0;
  private leanTarget = 0;
  private laneLerpFrom = 0;
  private laneLerpT = 1;
  private bufferedJump = 0; // input buffer: jump pressed just before landing
  private bufferedSlide = 0;
  private shadow: THREE.Mesh;
  shieldMesh!: THREE.Mesh;
  boardMesh!: THREE.Group;
  jetMesh!: THREE.Group;
  animator: PlayerAnimator | null = null;
  support: SupportQuery = () => 0;

  onLand: ((fromHeight: number) => void) | null = null;
  onFootstep: (() => void) | null = null;

  constructor() {
    // soft contact shadow (complements the real shadow map, readable on LOW)
    const tex = makeBlobTexture();
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 1.2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
    this.group.add(this.shadow);
    this.buildPowerVisuals();
  }

  private buildPowerVisuals() {
    // shield bubble: fresnel-ish rim via additive transparent sphere
    this.shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.05, 24, 18),
      new THREE.MeshBasicMaterial({ color: 0x6fe3ff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.shieldMesh.position.y = 0.95;
    this.shieldMesh.visible = false;
    this.group.add(this.shieldMesh);

    // hoverboard: rounded deck + glowing underside strip
    this.boardMesh = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.9, 4, 10), new THREE.MeshStandardMaterial({ color: 0x1f8fa8, roughness: 0.35, metalness: 0.2 }));
    deck.rotation.x = Math.PI / 2;
    deck.scale.set(1, 1, 0.22);
    deck.castShadow = true;
    this.boardMesh.add(deck);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 1.25), new THREE.MeshBasicMaterial({ color: 0x8ff3ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -0.07;
    this.boardMesh.add(glow);
    this.boardMesh.position.y = 0.1;
    this.boardMesh.visible = false;
    this.group.add(this.boardMesh);

    // jetpack: twin tanks + flame cones
    this.jetMesh = new THREE.Group();
    const tankM = new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.3, metalness: 0.7 });
    const flameM = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const x of [-0.11, 0.11]) {
      const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.3, 4, 10), tankM);
      tank.position.set(x, 1.15, -0.2);
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.45, 10), flameM);
      f.rotation.x = Math.PI;
      f.position.set(x, 0.78, -0.2);
      f.userData.flame = true;
      this.jetMesh.add(tank, f);
    }
    this.jetMesh.visible = false;
    this.group.add(this.jetMesh);
  }

  attachRunner(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    const anim = new PlayerAnimator(root, clips);
    if (!anim.ok) return false;
    this.animator = anim;
    anim.onFootContact = () => this.onFootstep?.();
    root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; }
    });
    this.group.add(root);
    return true;
  }

  reset() {
    this.lane = 1; this.targetLane = 1; this.laneX = 0; this.laneLerpT = 1;
    this.y = 0; this.vy = 0; this.grounded = true; this.groundY = 0;
    this.sliding = false; this.slideTimer = 0; this.landTimer = 0;
    this.crashed = false; this.jetpack = false; this.shield = false;
    this.bufferedJump = 0; this.bufferedSlide = 0;
    this.leanTarget = 0;
    this.anim = 'run';
    this.shieldMesh.visible = false; this.boardMesh.visible = false; this.jetMesh.visible = false;
    this.group.position.set(0, 0, 0);
    this.animator?.reset();
  }

  moveLane(dir: -1 | 1): boolean {
    const next = this.targetLane + dir;
    if (next < 0 || next > 2) return false;
    this.laneLerpFrom = this.laneX;
    this.targetLane = next;
    this.laneLerpT = 0;
    this.leanTarget = dir;
    return true;
  }

  jump(): boolean {
    if (this.jetpack || this.crashed) return false;
    if (!this.grounded) { this.bufferedJump = 0.12; return false; }
    if (this.sliding) { this.sliding = false; this.slideTimer = 0; }
    this.vy = CONFIG.jumpVelocity;
    this.grounded = false;
    this.landTimer = 0;
    this.anim = 'jump';
    return true;
  }

  slide(): boolean {
    if (this.jetpack || this.crashed || this.sliding) return false;
    if (!this.grounded) {
      // fast-fall then slide on touchdown (classic runner rule)
      this.vy = Math.min(this.vy, -24);
      this.bufferedSlide = 0.4;
      return true;
    }
    this.startSlide();
    return true;
  }

  private startSlide() {
    this.sliding = true;
    this.slideTimer = CONFIG.slideDuration;
    this.landTimer = 0;
    this.anim = 'slide';
  }

  getCollider(out: THREE.Box3): THREE.Box3 {
    const h = this.sliding ? CONFIG.slideHeight : CONFIG.playerHeight;
    const r = CONFIG.playerRadius;
    const p = this.group.position;
    out.min.set(p.x - r, p.y + 0.05, p.z - r);
    out.max.set(p.x + r, p.y + h, p.z + r);
    return out;
  }

  /** Physics only (fixed sub-step). Visual animation runs once per frame. */
  step(dt: number) {
    // lane interpolation (smoothstep over fixed time)
    if (this.laneLerpT < 1) {
      this.laneLerpT = Math.min(1, this.laneLerpT + dt / CONFIG.laneChangeTime);
      const t = this.laneLerpT, e = t * t * (3 - 2 * t);
      this.laneX = this.laneLerpFrom + (CONFIG.lanes[this.targetLane] - this.laneLerpFrom) * e;
      if (t >= 1) { this.lane = this.targetLane; this.leanTarget = 0; }
    } else this.laneX = CONFIG.lanes[this.targetLane];

    this.bufferedJump = Math.max(0, this.bufferedJump - dt);
    this.bufferedSlide = Math.max(0, this.bufferedSlide - dt);

    const surface = this.support(this.laneX, 0, CONFIG.playerRadius * 0.9);

    if (this.jetpack) {
      this.y += (CONFIG.jetpackHeight - this.y) * Math.min(1, dt * 4);
      this.vy = 0; this.grounded = false;
      this.anim = 'fly';
    } else if (this.grounded) {
      if (surface < this.y - 0.05) {
        // ran off the end of a roof: start falling
        this.grounded = false;
        this.vy = 0;
      } else {
        this.y = surface;
        this.groundY = surface;
      }
    }
    if (!this.jetpack && !this.grounded) {
      const prevY = this.y;
      this.vy += CONFIG.gravity * dt;
      this.y += this.vy * dt;
      // land on any surface we crossed downward through this sub-step. The
      // previous height only needs to have been at/above the surface top
      // (minus a small tolerance), so a fast descent can never slip past a
      // roof between sub-steps.
      if (this.vy <= 0 && this.y <= surface && prevY >= surface - CONFIG.roofLandTolerance) {
        const fromHeight = Math.max(0, this.groundY - surface) + Math.max(0, prevY - surface);
        this.y = surface; this.vy = 0; this.grounded = true; this.groundY = surface;
        this.onLand?.(fromHeight);
        if (this.bufferedSlide > 0) this.startSlide();
        else if (this.bufferedJump > 0) { this.bufferedJump = 0; this.jump(); }
        else this.landTimer = 0.22;
      }
      if (!this.grounded) this.anim = this.vy > 0 ? 'jump' : 'fall';
    }

    if (this.sliding) {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0) this.sliding = false;
    }
    if (this.landTimer > 0) this.landTimer -= dt;

    if (this.crashed) this.anim = 'crash';
    else if (this.jetpack) this.anim = 'fly';
    else if (this.grounded) this.anim = this.sliding ? 'slide' : this.landTimer > 0 ? 'land' : 'run';

    this.group.position.x = this.laneX;
    this.group.position.y = this.y;
  }

  /** Per-frame visuals: animation, shadow, power-up effects. */
  animate(dt: number, speed: number, menu = false) {
    if (menu) this.anim = 'idle';
    // contact shadow sits on the surface below, shrinking with height
    const below = this.support(this.laneX, 0, CONFIG.playerRadius * 0.9);
    const h = Math.max(0, this.y - below);
    this.shadow.position.y = below - this.y + 0.03;
    const k = Math.max(0.35, 1 - h * 0.18);
    this.shadow.scale.setScalar(k);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.5 * k;

    this.animator?.update(dt, this.anim, speed, this.leanTarget * (this.laneLerpT < 1 ? 1 : 0), this.vy,
      CONFIG.slideDuration - this.slideTimer, CONFIG.slideDuration);

    if (this.jetMesh.visible) for (const c of this.jetMesh.children) if (c.userData.flame) c.scale.y = 0.75 + Math.random() * 0.5;
    if (this.shieldMesh.visible) (this.shieldMesh.material as THREE.MeshBasicMaterial).opacity = 0.13 + Math.sin(performance.now() * 0.006) * 0.04;
  }

  crash() {
    this.crashed = true;
    this.sliding = false;
    this.anim = 'crash';
  }
}

function makeBlobTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(0,0,0,0.8)');
  grd.addColorStop(0.6, 'rgba(0,0,0,0.35)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}
