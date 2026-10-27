// METRO RUSH world: recycled track chunks with composed station/street
// modules, pooled trains/ramps/obstacles/coins/power-ups, designed obstacle
// sequences (sequences.ts) validated before spawning, and a walkable-surface
// query for train-roof traversal.
//
// Coordinate convention: the player stays at z=0; everything ahead has z<0
// and moves toward +z at world speed. Collision boxes are separate from the
// render meshes and sized from measured model bounds.
import * as THREE from 'three';
import { CONFIG } from './config';
import { normalized, type LoadedAssets } from './assets';
import { LIBRARY, TUTORIAL, validateRoute, TRAIN_LEN, TRAIN_SCALE, TRAIN_GAP, ROOF_Y, RAMP_LEN, type Sequence, type Hazard, type HazardKind } from './sequences';
import { createStationKit, type StationKit } from './stationKit';

export type ObstacleKind = HazardKind;
export type PowerKind = 'magnet' | 'jetpack' | 'shield' | 'multiplier';

export interface Obstacle {
  kind: ObstacleKind;
  mesh: THREE.Group;
  lane: number;
  z: number; // centre z (world)
  len: number;
  active: boolean;
  speed: number; // extra approach speed (moving trains)
  box: THREE.Box3; // solid collision volume (separate from render mesh)
  /** walkable top surface (trains / ramps); null for ground obstacles */
  topY: number | null;
  warned: boolean;
  passSoundAt: number;
}

export interface Coin {
  mesh: THREE.Object3D;
  lane: number;
  z: number;
  y: number;
  active: boolean;
  magnetized: boolean;
}

export interface PowerUp {
  kind: PowerKind;
  mesh: THREE.Group;
  lane: number;
  z: number;
  active: boolean;
}

export interface WorldEvents {
  trainWarn: Obstacle | null; // moving train entered warning range this frame
}

// collision volumes (half-extents x, height range y0..y1) per ground kind,
// measured against the scaled visual meshes in buildPools()
interface Solid { hx: number; y0: number; y1: number; hz: number }
const SOLIDS: Record<'lowBarrier' | 'overhead' | 'barrel' | 'crates', Solid> = {
  lowBarrier: { hx: 1.05, y0: 0, y1: 0.78, hz: 0.18 }, // top 0.78 < jump clearance (feet reach 1.82)
  overhead: { hx: 1.15, y0: 1.05, y1: 2.6, hz: 0.18 }, // gap 1.05 > slide height 0.75; < stand 1.7
  barrel: { hx: 0.48, y0: 0, y1: 0.95, hz: 0.48 },
  crates: { hx: 1.05, y0: 0, y1: 2.1, hz: 0.55 },
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- chunk: static track + recyclable dressing ----------
class Chunk {
  group = new THREE.Group();
  z = 0;
  private dressing = new THREE.Group();
  constructor(parent: THREE.Object3D, private kit: StationKit) {
    this.group.add(kit.makeTrackBed());
    this.group.add(this.dressing);
    parent.add(this.group);
  }
  /** Re-dress with a district variant. Kit pieces are pooled clones: no allocations of geometry/materials. */
  dress(variant: number, rng: () => number, density: number) {
    for (const c of [...this.dressing.children]) { this.dressing.remove(c); this.kit.release(c); }
    this.kit.dress(this.dressing, variant, rng, density);
  }
}

export class World {
  group = new THREE.Group();
  chunks: Chunk[] = [];
  obstacles: Obstacle[] = [];
  coins: Coin[] = [];
  powerups: PowerUp[] = [];
  distance = 0;
  decorationDensity = 1;
  private rng = mulberry32(1);
  private nextSeqZ = 0; // world distance (positive = ahead) where next sequence starts
  private seqIndex = 0;
  private districtIdx = 0;
  private pools: Record<string, THREE.Group[]> = {};
  private coinPool: Coin[] = [];
  private powerPool: PowerUp[] = [];
  private kit!: StationKit;
  private lastSeqId = '';
  private exitLanes = [0, 1, 2];
  validationLog: { id: string; ok: boolean; reason?: string; at: number }[] = [];

  constructor(private scene: THREE.Scene) {
    scene.add(this.group);
  }

  /** Builds everything from validated assets. Called once before reveal. */
  build(a: LoadedAssets) {
    const m = (k: string) => {
      const g = a.models.get(k);
      if (!g) throw new Error(`world: required model '${k}' missing after validation`);
      return g;
    };
    this.kit = createStationKit(a.models);
    for (let i = 0; i < CONFIG.visibleChunks + 1; i++) this.chunks.push(new Chunk(this.group, this.kit));
    this.buildPools(m);
    this.buildPickups(m);
  }

  private makePool(key: string, n: number, make: () => THREE.Group) {
    const arr: THREE.Group[] = [];
    for (let i = 0; i < n; i++) {
      const g = make();
      g.visible = false;
      g.userData.pool = key;
      this.group.add(g);
      arr.push(g);
    }
    this.pools[key] = arr;
  }

  private buildPools(m: (k: string) => THREE.Group) {
    // ---- 3-car subway consist; front car faces the player (+z) ----
    const car = (k: string) => normalized(m(k), TRAIN_SCALE);
    const front = car('trainFront'), mid = car('trainMiddle'), rear = car('trainRear');
    const cl = new THREE.Box3().setFromObject(mid).getSize(new THREE.Vector3());
    // assert our gameplay constants match the real model (catches asset swaps)
    const measuredLen = cl.z * 3 + TRAIN_GAP * 2;
    if (Math.abs(measuredLen - TRAIN_LEN) > 0.2 || Math.abs(cl.y - ROOF_Y) > 0.15) {
      console.error(`[metro-rush] train bounds ${cl.toArray()} disagree with sequences.ts (len ${measuredLen} vs ${TRAIN_LEN}, roof ${cl.y} vs ${ROOF_Y})`);
    }
    const mkTrain = (moving: boolean) => () => {
      const g = new THREE.Group();
      const f = front.clone(true), md = mid.clone(true), r = rear.clone(true);
      // Kenney subway-a nose points -z in model space; flip so it faces the runner
      f.rotation.y = Math.PI;
      f.position.z = TRAIN_LEN / 2 - cl.z / 2;
      md.position.z = 0;
      r.position.z = -TRAIN_LEN / 2 + cl.z / 2;
      g.add(f, md, r);
      if (moving) {
        // headlights: emissive discs that read clearly at distance
        const lm = new THREE.MeshBasicMaterial({ color: 0xfff4c2 });
        for (const x of [-0.55, 0.55]) {
          const l = new THREE.Mesh(new THREE.CircleGeometry(0.17, 16), lm);
          l.position.set(x, 1.05, TRAIN_LEN / 2 + 0.02);
          g.add(l);
        }
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.4), new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.position.set(0, 1.05, TRAIN_LEN / 2 + 0.04);
        g.add(glow);
      }
      return g;
    };
    this.makePool('train', 10, mkTrain(false));
    this.makePool('movingTrain', 3, mkTrain(true));

    // ---- ramp onto a roof: original geometry in station livery ----
    this.makePool('ramp', 4, () => this.kit.makeRamp(RAMP_LEN, ROOF_Y));

    // ---- low barrier (jump): Kenney construction barrier, 2.1 wide ----
    const barrier = normalized(m('barrierRoad'));
    const bs = new THREE.Box3().setFromObject(barrier).getSize(new THREE.Vector3());
    this.makePool('lowBarrier', 8, () => {
      const g = new THREE.Group();
      const b = barrier.clone(true);
      b.scale.set(2.1 / bs.x, SOLIDS.lowBarrier.y1 / bs.y, 1.6);
      g.add(b);
      return g;
    });

    // ---- overhead (slide): station gantry sign on posts ----
    this.makePool('overhead', 8, () => this.kit.makeOverheadSign(SOLIDS.overhead.y0, SOLIDS.overhead.y1));

    // ---- barrel: single-lane, jumpable ----
    const barrel = normalized(m('barrel'));
    const rb = new THREE.Box3().setFromObject(barrel).getSize(new THREE.Vector3());
    this.makePool('barrel', 10, () => {
      const g = new THREE.Group();
      const b = barrel.clone(true);
      b.scale.setScalar(SOLIDS.barrel.y1 / rb.y);
      g.add(b);
      const cone = normalized(m('cone'), 1.6);
      cone.position.set(0.85, 0, 0.3);
      g.add(cone);
      return g;
    });

    // ---- crates: stacked wall, lane switch only ----
    const crate = normalized(m('crate'));
    const cs = new THREE.Box3().setFromObject(crate).getSize(new THREE.Vector3());
    const cScale = 1.02 / cs.x;
    this.makePool('crates', 8, () => {
      const g = new THREE.Group();
      for (const [x, y, r] of [[-0.52, 0, 0.05], [0.52, 0, -0.08], [0, 1.04, 0.12]]) {
        const c = crate.clone(true);
        c.scale.setScalar(cScale);
        c.position.set(x, y, 0);
        c.rotation.y = r;
        g.add(c);
      }
      const light = normalized(m('constructionLight'), 1.4);
      light.position.set(0, 2.08, 0);
      g.add(light);
      return g;
    });
  }

  private buildPickups(m: (k: string) => THREE.Group) {
    // coins: instanced Kenney gold coin (one draw call per mesh part)
    const coin = normalized(m('coin'), 1.25);
    for (let i = 0; i < 140; i++) {
      const g = new THREE.Group();
      const c = coin.clone(true);
      c.position.y = -0.25; // centre the 0.5-tall coin on its pivot for spin
      g.add(c);
      g.visible = false;
      this.group.add(g);
      this.coinPool.push({ mesh: g, lane: 1, z: 0, y: 0.9, active: false, magnetized: false });
    }
    this.coins = this.coinPool;
    const tok: Record<PowerKind, [string, number, number]> = {
      magnet: ['tokMagnet', 0x38c6ff, 2.3], multiplier: ['tokMultiplier', 0xffc93c, 2.3],
      shield: ['tokShield', 0x5fe6c8, 2.3], jetpack: ['tokJetpack', 0xff7a45, 1.4],
    };
    for (const kind of Object.keys(tok) as PowerKind[]) {
      const [key, color, s] = tok[kind];
      for (let i = 0; i < 2; i++) {
        const g = new THREE.Group();
        const t = normalized(m(key), s);
        t.position.y = -0.4;
        g.add(t);
        // readable halo ring in the power-up's colour (identifies it at range)
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 8, 32), new THREE.MeshBasicMaterial({ color }));
        g.add(ring);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(0.6, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
        g.add(disc);
        g.visible = false;
        this.group.add(g);
        this.powerPool.push({ kind, mesh: g, lane: 1, z: 0, active: false });
      }
    }
    this.powerups = this.powerPool;
  }

  reset(seed = (Date.now() ^ 0x9e3779b9) >>> 0, tutorial = true) {
    this.rng = mulberry32(seed);
    this.distance = 0;
    for (const o of this.obstacles) this.release(o);
    this.obstacles.length = 0;
    for (const c of this.coinPool) { c.active = false; c.mesh.visible = false; }
    for (const p of this.powerPool) { p.active = false; p.mesh.visible = false; }
    this.districtIdx = 0;
    this.chunks.forEach((c, i) => {
      c.z = -i * CONFIG.chunkLength + CONFIG.chunkLength; // first chunk extends behind the camera
      c.group.position.z = c.z;
      c.dress(this.districtFor(i), this.rng, this.decorationDensity);
    });
    this.districtIdx = this.chunks.length;
    this.seqQueue = tutorial ? [...TUTORIAL] : [];
    this.nextSeqZ = 18; // short run-in, then straight into the tutorial
    this.seqIndex = 0;
    this.lastSeqId = '';
    this.exitLanes = [0, 1, 2];
    this.validationLog.length = 0;
  }

  private seqQueue: string[] = [];

  /** District for the n-th chunk: a stable opening station, then streets/yard. */
  private districtFor(n: number) {
    // 0..2 station platform (opening reference stretch), then rotate
    const pattern = [0, 0, 0, 1, 1, 2, 1, 0, 1, 1, 2, 2];
    return pattern[n % pattern.length];
  }

  // ---------- spawning ----------
  private acquire(key: string): THREE.Group | null {
    const p = this.pools[key];
    const g = p?.pop() ?? null;
    if (g) g.visible = true;
    return g;
  }

  private release(o: Obstacle) {
    o.active = false;
    o.mesh.visible = false;
    this.pools[o.mesh.userData.pool]?.push(o.mesh);
  }

  private spawnHazard(h: Hazard, base: number) {
    const key = h.kind;
    const mesh = this.acquire(key);
    if (!mesh) return; // pool exhausted: sequence spacing guarantees this is rare
    const zNear = -(base + h.z); // world z of near end
    const cz = zNear - h.length / 2;
    mesh.position.set(CONFIG.lanes[h.lane], 0, cz);
    const o: Obstacle = { kind: h.kind, mesh, lane: h.lane, z: cz, len: h.length, active: true, speed: h.speed ?? 0, box: new THREE.Box3(), topY: null, warned: false, passSoundAt: 0 };
    if (h.kind === 'train' || h.kind === 'movingTrain') o.topY = ROOF_Y;
    if (h.kind === 'ramp') o.topY = 0; // sloped: support() computes height along it
    this.obstacles.push(o);
    this.updateBox(o);
  }

  private updateBox(o: Obstacle) {
    const x = CONFIG.lanes[o.lane];
    if (o.kind === 'train' || o.kind === 'movingTrain') {
      // solid: full body below the roof surface
      o.box.min.set(x - 1.02, 0, o.z - o.len / 2);
      o.box.max.set(x + 1.02, ROOF_Y - 0.02, o.z + o.len / 2);
    } else if (o.kind === 'ramp') {
      o.box.makeEmpty(); // ramps are walkable everywhere; never solid
    } else {
      const s = SOLIDS[o.kind as keyof typeof SOLIDS];
      o.box.min.set(x - s.hx, s.y0, o.z - s.hz);
      o.box.max.set(x + s.hx, s.y1, o.z + s.hz);
    }
  }

  spawnCoinRow(lane: number, zNear: number, count: number, y = 0.9, spacing = 1.6, toLane?: number, shape: string = 'flat') {
    let placed = 0;
    for (const c of this.coinPool) {
      if (c.active) continue;
      const i = placed;
      const t = count > 1 ? i / (count - 1) : 0;
      c.active = true; c.magnetized = false;
      c.lane = toLane !== undefined && i >= count / 2 ? toLane : lane;
      c.z = zNear - i * spacing;
      switch (shape) {
        case 'arc': c.y = 0.9 + Math.sin(t * Math.PI) * 1.55; break;
        case 'roof': c.y = ROOF_Y + 0.9; break;
        case 'rampUp': c.y = 0.9 + ((i * spacing) / RAMP_LEN) * ROOF_Y; break;
        case 'drop': c.y = ROOF_Y + 0.9 - Math.min(ROOF_Y, t * t * ROOF_Y * 1.3); break;
        default: c.y = y;
      }
      c.mesh.position.set(CONFIG.lanes[c.lane], c.y, c.z);
      c.mesh.visible = true;
      if (++placed >= count) break;
    }
  }

  private spawnPowerUp(lane: number, z: number) {
    const free = this.powerPool.filter((p) => !p.active);
    if (!free.length) return;
    const p = free[Math.floor(this.rng() * free.length)];
    p.active = true; p.lane = lane; p.z = z; p.mesh.visible = true;
  }

  private chooseSequence(speed: number): Sequence {
    const id = this.seqQueue.shift();
    if (id) return LIBRARY.find((s) => s.id === id)!;
    const tier = speed < 17 ? 1 : speed < 24 ? 2 : 3;
    const pool = LIBRARY.filter((s) => s.tier > 0 && s.tier <= tier && s.id !== this.lastSeqId);
    const total = pool.reduce((a, s) => a + s.weight, 0);
    let r = this.rng() * total;
    for (const s of pool) { r -= s.weight; if (r <= 0) return s; }
    return pool[0];
  }

  /** Place the next sequence at world distance `ahead` after validating it against what is already on the track. */
  private placeSequence(ahead: number, speed: number) {
    const lim = {
      speed, laneChangeTime: CONFIG.laneChangeTime,
      jumpAirtime: (2 * CONFIG.jumpVelocity) / -CONFIG.gravity, slideDuration: CONFIG.slideDuration, reaction: 0.35,
    };
    // existing hazards that overlap the region we are about to fill
    const live: Hazard[] = [];
    for (const o of this.obstacles) {
      const near = -(o.z + o.len / 2) - ahead + 30; // relative to (ahead - 30)
      const far = near + o.len;
      if (far < 0) continue;
      live.push({ kind: o.kind, lane: o.lane, z: near, length: o.len, speed: o.speed });
    }
    let seq: Sequence | null = null;
    for (let attempt = 0; attempt < 6 && !seq; attempt++) {
      const cand = this.chooseSequence(speed);
      const joined = [...live, ...cand.hazards.map((h) => ({ ...h, z: h.z + 30 }))];
      const r = validateRoute(joined, this.exitLanes, 30 + cand.length, lim);
      this.validationLog.push({ id: cand.id, ok: r.ok, reason: r.reason, at: Math.round(this.distance) });
      if (this.validationLog.length > 60) this.validationLog.shift();
      if (r.ok) { seq = cand; this.exitLanes = r.reachableExit; }
    }
    if (!seq) {
      // conservative fallback: an empty coin run always connects
      seq = LIBRARY.find((s) => s.id === 't-coins-lane')!;
      this.exitLanes = [0, 1, 2];
    }
    for (const h of seq.hazards) this.spawnHazard(h, ahead);
    for (const c of seq.coins) {
      const zNear = -(ahead + c.z);
      this.spawnCoinRow(c.lane, zNear, c.count, 0.9, c.spacing, c.toLane, c.shape);
    }
    if (seq.powerup) this.spawnPowerUp(seq.powerup.lane, -(ahead + seq.powerup.z));
    this.lastSeqId = seq.id;
    this.seqIndex++;
    return seq.length;
  }

  /** Walkable surface height under the player at lane-x (z=0). */
  support(x: number, z: number, halfW: number): number {
    let h = 0;
    for (const o of this.obstacles) {
      if (!o.active || o.topY === null) continue;
      const ox = CONFIG.lanes[o.lane];
      if (Math.abs(x - ox) > 1.0 - halfW * 0.5) continue;
      // World +z points toward the camera. A hazard's near end (reached
      // first) is its max-z end (o.z + len/2); its far end is o.z - len/2.
      // The runner at z=0 is on it while far <= 0 <= near.
      const far = o.z - o.len / 2, near = o.z + o.len / 2;
      if (z < far || z > near) continue;
      if (o.kind === 'ramp') {
        // ramp is at ground level at its near end and ROOF_Y at its far end
        const t = (near - z) / o.len;
        h = Math.max(h, t * ROOF_Y);
      } else h = Math.max(h, o.topY);
    }
    return h;
  }

  update(dt: number, speed: number, events: WorldEvents) {
    const dz = speed * dt;
    this.distance += dz;
    events.trainWarn = null;

    // chunks
    for (const c of this.chunks) {
      c.z += dz;
      if (c.z > CONFIG.chunkLength * 2) {
        let minZ = Infinity;
        for (const cc of this.chunks) minZ = Math.min(minZ, cc.z);
        c.z = minZ - CONFIG.chunkLength;
        c.dress(this.districtFor(this.districtIdx++), this.rng, this.decorationDensity);
      }
      c.group.position.z = c.z;
    }

    // sequences: keep ~170 m of designed content ahead
    this.nextSeqZ -= dz;
    while (this.nextSeqZ < 170) {
      const len = this.placeSequence(this.nextSeqZ, Math.max(speed, CONFIG.startSpeed));
      this.nextSeqZ += len;
    }

    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];
      o.z += dz + o.speed * dt;
      o.mesh.position.z = o.z;
      if (o.kind === 'movingTrain' && !o.warned && o.z + o.len / 2 > -95) { o.warned = true; events.trainWarn = o; }
      this.updateBox(o);
      if (o.z - o.len / 2 > 14) { this.release(o); this.obstacles.splice(i, 1); }
    }

    const t = performance.now() * 0.001;
    for (const c of this.coinPool) {
      if (!c.active) continue;
      c.z += dz;
      if (c.z > 8) { c.active = false; c.mesh.visible = false; continue; }
      if (!c.magnetized) c.mesh.position.set(CONFIG.lanes[c.lane], c.y, c.z);
      c.mesh.rotation.y = t * 3.2 + c.z * 0.25;
    }
    for (const p of this.powerPool) {
      if (!p.active) continue;
      p.z += dz;
      if (p.z > 8) { p.active = false; p.mesh.visible = false; continue; }
      p.mesh.position.set(CONFIG.lanes[p.lane], 1.15 + Math.sin(t * 3) * 0.12, p.z);
      p.mesh.rotation.y = t * 2;
    }
  }

  /** Warm-up: dress the first chunk with every district once and render,
   *  so pooled dressing of all districts has compiled shaders + uploaded
   *  buffers before the reveal; then restore the opening layout. */
  warmDistricts(render: () => void) {
    const c = this.chunks[1];
    for (const d of [1, 2, 0]) { c.dress(d, this.rng, 1); render(); }
    this.reset(1234, false);
  }

  /** Debug/QA: number of live scene objects (for stability checks). */
  stats() {
    let objects = 0; this.group.traverse(() => objects++);
    return { objects, obstacles: this.obstacles.length, coins: this.coinPool.filter((c) => c.active).length, kitFree: this.kit.freeCount() };
  }
}
