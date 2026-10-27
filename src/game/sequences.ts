// Designed obstacle sequences + route validation (pure logic, no Three.js).
//
// A sequence is authored in local distance units (0 = sequence start, +z =
// further ahead). The generator places sequences back-to-back and validates
// every placement against the player's real movement limits BEFORE spawning:
//
//   • lateral: one lane change takes CONFIG.laneChangeTime; at speed v the
//     player needs   laneGap(v) = v * (laneChangeTime + reactionTime)   metres
//     of clear lane per lane switched.
//   • jump: a low barrier is cleared if it lies inside the airborne window;
//     the player must be in that lane >= jumpLead metres before it.
//   • slide: slide covers v * slideDuration metres.
//   • moving trains: their closing speed shortens the effective gap, and
//     their whole footprint (front + length) is projected to the moment the
//     player arrives.
//
// validateRoute() walks the combined obstacle field lane-by-lane as a graph
// over distance slices and proves at least one reachable path exists from
// the entry lane through the end. Placement is rejected (and a simpler
// sequence substituted) if it fails.

export type HazardKind = 'train' | 'movingTrain' | 'ramp' | 'lowBarrier' | 'overhead' | 'barrel' | 'crates';
export type Action = 'none' | 'jump' | 'slide' | 'lane' | 'roof';

export interface Hazard {
  kind: HazardKind;
  lane: number;
  z: number; // start (near end) in sequence-local metres
  length: number; // footprint along z
  speed?: number; // movingTrain: approach speed added to world speed (u/s)
}

export interface CoinPath {
  lane: number;
  z: number;
  count: number;
  spacing: number;
  /** 'flat' ground, 'arc' jump arc, 'roof' at roof height, 'rampUp' rises along a ramp, 'drop' descends */
  shape: 'flat' | 'arc' | 'roof' | 'rampUp' | 'drop';
  /** lane switch mid-trail (lane-change teaching trail) */
  toLane?: number;
}

export interface Sequence {
  id: string;
  length: number;
  /** lanes the player may be in when the sequence begins / must be able to end in */
  entry: number[];
  exit: number[];
  actions: Action[];
  hazards: Hazard[];
  coins: CoinPath[];
  powerup?: { lane: number; z: number };
  /** min tier (0 tutorial .. 3 hard) and selection weight */
  tier: number;
  weight: number;
  /** minimum reaction time this sequence demands at its first decision (s) */
  minReaction: number;
}

// Kenney subway car, measured in-engine after normalize(scale 1.9) +
// grounding: 2.09 w x 2.985 h x 4.94 l. (The raw accessor max-min of 1.93 u
// includes wheel geometry that the node transform places differently, so
// the in-engine Box3 is authoritative; world.ts re-asserts it at build.)
export const TRAIN_SCALE = 1.9;
export const TRAIN_GAP = 0.12;
export const TRAIN_LEN = 2.6 * TRAIN_SCALE * 3 + TRAIN_GAP * 2; // 15.06 m
export const RAMP_LEN = 6.5;
export const ROOF_Y = 2.98; // walkable roof top (m)

// ---------- the authored library ----------
// Lanes: 0 left, 1 centre, 2 right. z grows away from the player.
const L = (id: string, s: Omit<Sequence, 'id'>): Sequence => ({ id, ...s });

export const LIBRARY: Sequence[] = [
  // --- tutorial set (tier 0): each introduces exactly one action ---
  L('t-coins-lane', {
    length: 44, entry: [0, 1, 2], exit: [0, 1, 2], actions: ['lane'], tier: 0, weight: 1, minReaction: 1.2,
    hazards: [],
    coins: [{ lane: 1, z: 4, count: 6, spacing: 1.7, shape: 'flat', toLane: 2 }, { lane: 2, z: 24, count: 6, spacing: 1.7, shape: 'flat', toLane: 0 }],
  }),
  L('t-jump', {
    length: 40, entry: [0, 1, 2], exit: [0, 1, 2], actions: ['jump'], tier: 0, weight: 1, minReaction: 1.1,
    hazards: [0, 1, 2].map((lane) => ({ kind: 'lowBarrier' as const, lane, z: 22, length: 0.5 })),
    coins: [{ lane: 1, z: 18, count: 5, spacing: 1.6, shape: 'arc' }],
  }),
  L('t-slide', {
    length: 40, entry: [0, 1, 2], exit: [0, 1, 2], actions: ['slide'], tier: 0, weight: 1, minReaction: 1.1,
    hazards: [0, 1, 2].map((lane) => ({ kind: 'overhead' as const, lane, z: 22, length: 0.5 })),
    coins: [{ lane: 1, z: 19, count: 5, spacing: 1.4, shape: 'flat' }],
  }),
  L('t-train', {
    length: 48, entry: [0, 1, 2], exit: [0, 2], actions: ['lane'], tier: 0, weight: 1, minReaction: 1.2,
    hazards: [{ kind: 'train', lane: 1, z: 22, length: TRAIN_LEN }],
    coins: [{ lane: 1, z: 6, count: 5, spacing: 1.6, shape: 'flat', toLane: 0 }, { lane: 0, z: 22, count: 8, spacing: 1.9, shape: 'flat' }],
  }),

  // --- core sequences ---
  L('train-alt', { // stationary train, signposted alternate route
    length: 46, entry: [0, 1, 2], exit: [0, 1, 2], actions: ['lane'], tier: 1, weight: 3, minReaction: 0.9,
    hazards: [{ kind: 'train', lane: 0, z: 18, length: TRAIN_LEN }, { kind: 'train', lane: 2, z: 26, length: TRAIN_LEN }],
    coins: [{ lane: 1, z: 16, count: 9, spacing: 2.0, shape: 'flat' }],
  }),
  L('ramp-roof', { // ramp up onto a train roof, roof coins, readable drop
    length: 58, entry: [0, 1, 2], exit: [0, 1, 2], actions: ['roof'], tier: 1, weight: 3, minReaction: 1.0,
    hazards: [
      { kind: 'ramp', lane: 1, z: 14, length: RAMP_LEN },
      { kind: 'train', lane: 1, z: 14 + RAMP_LEN, length: TRAIN_LEN },
      // left-lane train starts at 16 m: at max speed (32 u/s) a lane change
      // needs ~10.7 m, so a player entering on the left can still escape
      { kind: 'train', lane: 0, z: 16, length: TRAIN_LEN },
    ],
    coins: [
      { lane: 1, z: 14.5, count: 4, spacing: 1.5, shape: 'rampUp' },
      { lane: 1, z: 21, count: 8, spacing: 1.8, shape: 'roof' },
      { lane: 1, z: 36.5, count: 4, spacing: 1.6, shape: 'drop' },
    ],
  }),
  L('roof-hop', { // ramp -> roof -> gap jump to a second train -> drop
    length: 72, entry: [0, 1, 2], exit: [0, 1, 2], actions: ['roof', 'jump'], tier: 2, weight: 2, minReaction: 0.9,
    hazards: [
      { kind: 'ramp', lane: 2, z: 12, length: RAMP_LEN },
      { kind: 'train', lane: 2, z: 12 + RAMP_LEN, length: TRAIN_LEN },
      // 4.5 m roof gap: needs a jump (airtime at 13 u/s covers ~8.8 m)
      { kind: 'train', lane: 2, z: 12 + RAMP_LEN + TRAIN_LEN + 4.5, length: TRAIN_LEN },
      { kind: 'barrel', lane: 1, z: 30, length: 1.0 },
    ],
    coins: [
      { lane: 2, z: 12.5, count: 4, spacing: 1.5, shape: 'rampUp' },
      { lane: 2, z: 19, count: 7, spacing: 1.9, shape: 'roof' },
      { lane: 2, z: 33.5, count: 5, spacing: 1.7, shape: 'roof' },
      { lane: 2, z: 41, count: 6, spacing: 1.8, shape: 'roof' },
    ],
  }),
  L('jump-slide', { // read-then-act: barrier then sign in alternating lanes
    length: 44, entry: [0, 1, 2], exit: [0, 1, 2], actions: ['jump', 'slide'], tier: 1, weight: 3, minReaction: 0.75,
    hazards: [
      { kind: 'lowBarrier', lane: 0, z: 14, length: 0.5 }, { kind: 'lowBarrier', lane: 1, z: 14, length: 0.5 },
      { kind: 'crates', lane: 2, z: 13, length: 1.2 },
      { kind: 'overhead', lane: 1, z: 30, length: 0.5 }, { kind: 'overhead', lane: 2, z: 30, length: 0.5 },
      { kind: 'barrel', lane: 0, z: 30, length: 1.0 },
    ],
    coins: [{ lane: 1, z: 10, count: 5, spacing: 1.6, shape: 'arc' }, { lane: 1, z: 27, count: 5, spacing: 1.4, shape: 'flat' }],
  }),
  L('moving-escape', { // oncoming train with long warning + reachable escape
    length: 70, entry: [0, 1, 2], exit: [0, 2], actions: ['lane'], tier: 2, weight: 2, minReaction: 1.3,
    hazards: [{ kind: 'movingTrain', lane: 1, z: 52, length: TRAIN_LEN, speed: 9 }, { kind: 'crates', lane: 2, z: 26, length: 1.2 }],
    coins: [{ lane: 0, z: 10, count: 10, spacing: 2.0, shape: 'flat' }],
    powerup: { lane: 0, z: 34 },
  }),
  L('double-train-slide', { // corridor between trains with a sign to slide
    length: 50, entry: [0, 1, 2], exit: [1], actions: ['lane', 'slide'], tier: 2, weight: 2, minReaction: 0.8,
    hazards: [
      { kind: 'train', lane: 0, z: 16, length: TRAIN_LEN }, { kind: 'train', lane: 2, z: 16, length: TRAIN_LEN },
      { kind: 'overhead', lane: 1, z: 26, length: 0.5 },
    ],
    coins: [{ lane: 1, z: 14, count: 9, spacing: 1.8, shape: 'flat' }],
  }),
  L('barrel-weave', {
    length: 40, entry: [0, 1, 2], exit: [0, 1, 2], actions: ['lane', 'jump'], tier: 1, weight: 2, minReaction: 0.8,
    hazards: [
      { kind: 'barrel', lane: 0, z: 10, length: 1.0 }, { kind: 'barrel', lane: 1, z: 18, length: 1.0 },
      { kind: 'barrel', lane: 2, z: 26, length: 1.0 }, { kind: 'barrel', lane: 1, z: 34, length: 1.0 },
    ],
    coins: [{ lane: 1, z: 4, count: 4, spacing: 1.5, shape: 'flat', toLane: 2 }, { lane: 0, z: 20, count: 6, spacing: 1.6, shape: 'flat' }],
  }),
  L('powerup-gift', {
    length: 30, entry: [0, 1, 2], exit: [0, 1, 2], actions: ['none'], tier: 1, weight: 1, minReaction: 0.5,
    hazards: [{ kind: 'crates', lane: 0, z: 18, length: 1.2 }, { kind: 'crates', lane: 2, z: 18, length: 1.2 }],
    coins: [{ lane: 1, z: 4, count: 6, spacing: 1.8, shape: 'flat' }],
    powerup: { lane: 1, z: 18 },
  }),
];

export const TUTORIAL = ['t-coins-lane', 't-jump', 't-slide', 't-train'];

// ---------- route validation ----------
export interface Limits {
  speed: number; // world speed u/s at placement time
  laneChangeTime: number;
  jumpAirtime: number;
  slideDuration: number;
  reaction: number; // assumed human reaction (s)
}

/** Per-lane blocked intervals along distance with how each can be passed. */
interface Block { z0: number; z1: number; pass: 'none' | 'jump' | 'slide' | 'roof' }

function blocksFor(h: Hazard, lim: Limits, zOffset: number): Block[] {
  const z0 = h.z + zOffset, z1 = z0 + h.length;
  switch (h.kind) {
    case 'lowBarrier': case 'barrel': return [{ z0: z0 - 0.4, z1: z1 + 0.4, pass: 'jump' }];
    case 'overhead': return [{ z0: z0 - 0.3, z1: z1 + 0.3, pass: 'slide' }];
    case 'crates': return [{ z0: z0 - 0.5, z1: z1 + 0.5, pass: 'none' }];
    case 'ramp': return [{ z0, z1, pass: 'roof' }];
    case 'train': return [{ z0, z1, pass: 'roof' }]; // roof only if reached via ramp/roof; checked below
    case 'movingTrain': {
      // the train advances toward the player: the region it sweeps before the
      // player could pass it is unsafe for the whole approach
      const closing = (h.speed ?? 0) / Math.max(1, lim.speed);
      const swept = (z0 - 0) * closing; // distance it moves while player covers z0
      return [{ z0: Math.max(0, z0 - swept - 2), z1: z1, pass: 'none' }];
    }
  }
}

/**
 * Proves a path exists through `hazards` (absolute z, metres ahead of the
 * sequence start) from any lane in `entry`. Discretised in 1 m slices; a
 * lane switch costs laneGap metres during which the destination lane must
 * already be clear. Trains are passable only on the roof, and the roof is
 * only reachable from a ramp or an adjacent roof (jump across <= jumpReach).
 */
export function validateRoute(hazards: Hazard[], entry: number[], length: number, lim: Limits): { ok: boolean; reason?: string; reachableExit: number[] } {
  const STEP = 1;
  const n = Math.ceil(length / STEP) + 1;
  const laneGap = lim.speed * (lim.laneChangeTime + lim.reaction * 0.5);
  const jumpReach = lim.speed * lim.jumpAirtime;
  const slideReach = lim.speed * lim.slideDuration;
  const blocks: Block[][] = [[], [], []];
  for (const h of hazards) for (const b of blocksFor(h, lim, 0)) blocks[h.lane].push(b);
  // states: lane 0..2 x level (0 ground, 1 roof)
  type S = { lane: number; roof: boolean };
  const key = (s: S) => s.lane * 2 + (s.roof ? 1 : 0);
  const reach: boolean[][] = Array.from({ length: n }, () => new Array(6).fill(false));
  // a ground slice is safe if no non-ground-passable block covers it;
  // jump/slide blocks are safe if the action window spans the block
  const blockAt = (lane: number, z: number) => blocks[lane].find((b) => z >= b.z0 && z < b.z1);
  const roofAt = (lane: number, z: number) => hazards.some((h) => h.lane === lane && h.kind === 'train' && z >= h.z && z < h.z + h.length);
  const rampAt = (lane: number, z: number) => hazards.some((h) => h.lane === lane && h.kind === 'ramp' && z >= h.z && z < h.z + h.length);
  const groundSafe = (lane: number, z: number) => {
    const b = blockAt(lane, z);
    if (!b) return true;
    if (b.pass === 'jump') return b.z1 - b.z0 <= jumpReach * 0.8;
    if (b.pass === 'slide') return b.z1 - b.z0 <= slideReach * 0.9;
    if (b.pass === 'roof') return rampAt(lane, z); // ramp itself is runnable
    return false;
  };
  for (const l of entry) if (groundSafe(l, 0)) reach[0][key({ lane: l, roof: false })] = true;
  const gapSlices = Math.ceil(laneGap / STEP);
  for (let i = 0; i < n - 1; i++) {
    const z = i * STEP, zn = (i + 1) * STEP;
    for (let lane = 0; lane < 3; lane++) for (const roof of [false, true]) {
      if (!reach[i][key({ lane, roof })]) continue;
      // continue straight
      if (roof) {
        if (roofAt(lane, zn)) reach[i + 1][key({ lane, roof: true })] = true;
        else {
          // end of roof: drop to ground if ground is safe there, or jump a gap to the next roof
          if (groundSafe(lane, zn)) reach[i + 1][key({ lane, roof: false })] = true;
          for (let k = 1; k <= Math.floor(jumpReach * 0.85); k++) {
            if (roofAt(lane, z + k)) { if (i + k < n) reach[i + k][key({ lane, roof: true })] = true; break; }
          }
          // lateral hop from one roof to an adjacent roof
        }
        for (const d of [-1, 1]) {
          const nl = lane + d;
          if (nl < 0 || nl > 2) continue;
          if (roofAt(nl, z + laneGap) && i + gapSlices < n) reach[i + gapSlices][key({ lane: nl, roof: true })] = true;
        }
      } else {
        if (rampAt(lane, z) && !rampAt(lane, zn) && roofAt(lane, zn)) reach[i + 1][key({ lane, roof: true })] = true;
        else if (groundSafe(lane, zn)) reach[i + 1][key({ lane, roof: false })] = true;
        // lane change: destination must be clear for the whole manoeuvre
        for (const d of [-1, 1]) {
          const nl = lane + d;
          if (nl < 0 || nl > 2) continue;
          let clear = true;
          for (let k = 1; k <= gapSlices; k++) {
            const zz = z + k * STEP;
            if (!groundSafe(nl, zz) || (blockAt(lane, zz) && !groundSafe(lane, zz))) { clear = false; break; }
          }
          if (clear && i + gapSlices < n) reach[i + gapSlices][key({ lane: nl, roof: false })] = true;
        }
      }
    }
  }
  const last = reach[n - 1];
  const reachableExit = [0, 1, 2].filter((l) => last[key({ lane: l, roof: false })] || last[key({ lane: l, roof: true })]);
  if (!reachableExit.length) {
    // find the furthest reached slice for a useful diagnostic
    let far = 0; for (let i = 0; i < n; i++) if (reach[i].some(Boolean)) far = i;
    return { ok: false, reason: `no path beyond ${far * STEP} m`, reachableExit };
  }
  return { ok: true, reachableExit };
}

/** Coins never sit inside a solid footprint (except roof coins on roofs). */
export function coinsAvoidHazards(seq: Sequence): string | null {
  for (const c of seq.coins) {
    for (let i = 0; i < c.count; i++) {
      const z = c.z + i * c.spacing;
      const lane = c.toLane !== undefined && i >= c.count / 2 ? c.toLane : c.lane;
      for (const h of seq.hazards) {
        if (h.lane !== lane) continue;
        if (z < h.z - 0.3 || z > h.z + h.length + 0.3) continue;
        if (h.kind === 'train' && (c.shape === 'roof' || c.shape === 'drop')) continue;
        if (h.kind === 'ramp' && c.shape === 'rampUp') continue;
        if ((h.kind === 'lowBarrier' || h.kind === 'barrel') && c.shape === 'arc') continue;
        if (h.kind === 'overhead' && c.shape === 'flat') continue; // coins under the sign reward the slide
        return `${seq.id}: coin ${i} of trail @lane ${lane} z=${z.toFixed(1)} sits inside ${h.kind}`;
      }
    }
  }
  return null;
}
