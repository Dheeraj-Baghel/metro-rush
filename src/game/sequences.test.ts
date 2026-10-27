import { describe, it, expect } from 'vitest';
import { LIBRARY, TUTORIAL, validateRoute, coinsAvoidHazards, type Limits, type Hazard } from './sequences';
import { CONFIG } from './config';

const lim = (speed: number): Limits => ({
  speed,
  laneChangeTime: CONFIG.laneChangeTime,
  jumpAirtime: (2 * CONFIG.jumpVelocity) / -CONFIG.gravity,
  slideDuration: CONFIG.slideDuration,
  reaction: 0.35,
});

describe('authored sequences', () => {
  it('tutorial ids exist in the library', () => {
    for (const id of TUTORIAL) expect(LIBRARY.find((s) => s.id === id), id).toBeTruthy();
  });

  for (const s of LIBRARY) {
    it(`${s.id}: coins never sit inside a solid footprint`, () => {
      expect(coinsAvoidHazards(s)).toBeNull();
    });
    for (const speed of [CONFIG.startSpeed, 22, CONFIG.maxSpeed]) {
      it(`${s.id}: reachable from every entry lane at ${speed} u/s`, () => {
        for (const e of s.entry) {
          const r = validateRoute(s.hazards, [e], s.length, lim(speed));
          expect(r.ok, `${s.id} entry ${e} @${speed}: ${r.reason}`).toBe(true);
        }
      });
    }
  }
});

describe('validator rejects impossible fields', () => {
  it('three-lane wall of crates', () => {
    const wall: Hazard[] = [0, 1, 2].map((lane) => ({ kind: 'crates', lane, z: 20, length: 1.2 }));
    expect(validateRoute(wall, [1], 40, lim(20)).ok).toBe(false);
  });
  it('train in every lane with no ramp', () => {
    const t: Hazard[] = [0, 1, 2].map((lane) => ({ kind: 'train', lane, z: 15, length: 15 }));
    expect(validateRoute(t, [1], 40, lim(20)).ok).toBe(false);
  });
  it('same field becomes passable once a ramp feeds the middle roof', () => {
    const t: Hazard[] = [0, 1, 2].map((lane) => ({ kind: 'train', lane, z: 15, length: 15 }));
    t.push({ kind: 'ramp', lane: 1, z: 9, length: 6 });
    expect(validateRoute(t, [1], 40, lim(20)).ok).toBe(true);
  });
  it('lane switch that is too late at high speed is rejected', () => {
    // train directly ahead in the only lane, the escape lane opens 3 m before it
    const f: Hazard[] = [
      { kind: 'train', lane: 1, z: 6, length: 15 },
      { kind: 'crates', lane: 0, z: 0, length: 3 },
      { kind: 'crates', lane: 2, z: 0, length: 40 },
    ];
    expect(validateRoute(f, [1], 30, lim(CONFIG.maxSpeed)).ok).toBe(false);
  });
  it('moving train with no escape lane is rejected', () => {
    const f: Hazard[] = [
      { kind: 'movingTrain', lane: 1, z: 50, length: 15, speed: 10 },
      { kind: 'train', lane: 0, z: 0, length: 60 },
      { kind: 'train', lane: 2, z: 0, length: 60 },
    ];
    expect(validateRoute(f, [1], 70, lim(20)).ok).toBe(false);
  });
});

describe('back-to-back sequence transitions', () => {
  // overlapping exits/entries are the real risk: validate every ordered pair
  // as one joined field, at the fastest speed, from every lane the first
  // sequence can exit in.
  const nonTut = LIBRARY.filter((s) => s.tier > 0);
  for (const a of nonTut) for (const b of nonTut) {
    it(`${a.id} -> ${b.id}`, () => {
      const joined: Hazard[] = [...a.hazards, ...b.hazards.map((h) => ({ ...h, z: h.z + a.length }))];
      for (const e of a.entry) {
        const r = validateRoute(joined, [e], a.length + b.length, lim(CONFIG.maxSpeed));
        expect(r.ok, `${a.id}->${b.id} entry ${e}: ${r.reason}`).toBe(true);
      }
    });
  }
});
