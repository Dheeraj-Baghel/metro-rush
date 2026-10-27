// METRO RUSH — central gameplay tuning. All speeds in world units/sec.
export const CONFIG = {
  laneWidth: 2.4,
  lanes: [-2.4, 0, 2.4],
  startSpeed: 13,
  maxSpeed: 32,
  speedRampPerSec: 0.16, // speed gained per second survived
  laneChangeTime: 0.16, // seconds to fully switch lane
  jumpVelocity: 10.8,
  gravity: -32,
  // jump airtime = 2 * v / g = 0.675 s ; apex = v^2 / 2g = 1.82 u
  slideDuration: 0.78,
  playerHeight: 1.7,
  slideHeight: 0.75,
  playerRadius: 0.36,
  chunkLength: 36,
  visibleChunks: 7, // chunks ahead of player
  coinValue: 10,
  scorePerMeter: 1,
  powerupDurations: { magnet: 9, jetpack: 6, shield: 10, multiplier: 8 },
  magnetRadius: 6,
  jetpackHeight: 6.2,
  fogNear: 70,
  fogFar: 170,
  // train roofs: top surface height of a stationary train (measured from the
  // Kenney subway car after scaling, see world.ts injectAssets)
  roofLandTolerance: 0.45, // feet may be this far below roof top and still land
  physicsStep: 1 / 120, // fixed sub-step for player physics + collision
} as const;

/**
 * Chase-camera tuning. Values were chosen by comparing screenshots at
 * 1280x720 (landscape) and 390x844 (portrait). Portrait does not just widen
 * FOV: it pulls the camera back and up so all three lanes stay in frame while
 * the runner keeps the same relative size.
 */
export const CAMERA = {
  // landscape: closer + lower so the runner fills ~22% of frame height while
  // all three tracks and ~70 m of decisions stay visible
  landscape: { fov: 58, height: 3.05, distance: 5.0, lookAhead: 18, lookHeight: 1.7, follow: 0.62 },
  // portrait: narrower frame needs a higher camera + wider FOV to keep the
  // outer lanes on screen; runner sits lower so hazards get the top 2/3
  portrait: { fov: 70, height: 4.1, distance: 6.4, lookAhead: 15, lookHeight: 1.45, follow: 0.45 },
  lateralDamp: 9, // 1/s — how fast camera x chases runner x
  heightDamp: 5, // 1/s — vertical follow during jumps / roofs
  jumpFollow: 0.35, // fraction of runner height the camera follows while airborne
  roofFollow: 0.85, // fraction followed when standing on a train roof
  speedFovGain: 5, // extra degrees at max speed (restrained)
  bobAmplitude: 0.018,
  landShake: 0.06,
  crashShake: 0.35,
  shakeDecay: 3.5,
};

export type GraphicsPreset = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Settings {
  graphics: GraphicsPreset;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  muted: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  graphics: 'HIGH',
  masterVolume: 0.9,
  musicVolume: 0.55,
  sfxVolume: 0.9,
  ambienceVolume: 0.6,
  muted: false,
};

const SAVE_KEY = 'metro-rush-save-v1';

export interface SaveData {
  bestScore: number;
  totalCoins: number;
  settings: Settings;
  seenTutorial: boolean;
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return {
        bestScore: d.bestScore ?? 0,
        totalCoins: d.totalCoins ?? 0,
        settings: { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) },
        seenTutorial: !!d.seenTutorial,
      };
    }
  } catch {}
  return { bestScore: 0, totalCoins: 0, settings: { ...DEFAULT_SETTINGS }, seenTutorial: false };
}

export function writeSave(data: SaveData) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {}
}
