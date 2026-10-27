// METRO RUSH runtime asset manifest.
//
// Every entry is a local file under public/ that was downloaded from a CC0
// source, inventoried, and (for audio) trimmed/levelled by qa/build-audio.mjs.
// Provenance: ASSET_REPORT.md, public/assets/c/audio/audio-sources.json,
// licenses in public/assets/licenses/.
//
// `required` assets block "ready": if one fails, the loading screen shows a
// retry with the exact failing path — the game never silently swaps in
// placeholder art. `stage` controls when an asset loads: 'opening' assets are
// preloaded before the menu is revealed; 'later' assets stream in the
// background after the reveal (districts the player has not reached yet).

export type AssetKind = 'model' | 'skinned' | 'clips' | 'audio';

export interface AssetEntry {
  key: string;
  url: string;
  kind: AssetKind;
  required: boolean;
  stage: 'opening' | 'later';
  pack: string;
}

const C = 'assets/c/';
const B = 'assets/b/';
const TK = 'Kenney Train Kit';
const CC = 'Kenney City Kit Commercial';
const CR = 'Kenney City Kit Roads';
const CI = 'Kenney City Kit Industrial';
const PK = 'Kenney Platformer Kit';

const model = (key: string, url: string, pack: string, required = true, stage: 'opening' | 'later' = 'opening'): AssetEntry =>
  ({ key, url, kind: 'model', required, stage, pack });
const audio = (key: string, required = true): AssetEntry =>
  ({ key: 'sfx:' + key, url: `${C}audio/${key}.wav`, kind: 'audio', required, stage: 'opening', pack: 'see audio-sources.json' });

export const MANIFEST: AssetEntry[] = [
  // ---- runner: Quaternius Universal Base Character + UAL1/UAL2 clips ----
  { key: 'runner', url: `${C}runner/runner.glb`, kind: 'skinned', required: true, stage: 'opening', pack: 'Quaternius Universal Base Characters (CC0)' },
  { key: 'runnerClips', url: `${C}runner/runner-anims.glb`, kind: 'clips', required: true, stage: 'opening', pack: 'Quaternius Universal Animation Library 1+2 (CC0)' },

  // ---- trains + track ----
  model('trainFront', `${B}trains/train-electric-subway-a.glb`, TK),
  model('trainMiddle', `${B}trains/train-electric-subway-b.glb`, TK),
  model('trainRear', `${B}trains/train-electric-subway-c.glb`, TK),
  model('track', `${B}trains/railroad-straight.glb`, TK),

  // ---- obstacles / pickups ----
  model('fenceLow', `${B}plat/fence-low-straight.glb`, PK),
  model('barrierRoad', `${C}props/roads/construction-barrier.glb`, CR),
  model('cone', `${C}props/roads/construction-cone.glb`, CR),
  model('constructionLight', `${C}props/roads/construction-light.glb`, CR),
  model('crate', `${B}plat/crate.glb`, PK),
  model('barrel', `${B}plat/barrel.glb`, PK),
  model('coin', `${B}plat/coin-gold.glb`, PK),
  model('tokMagnet', `${B}plat/jewel.glb`, PK),
  model('tokMultiplier', `${B}plat/star.glb`, PK),
  model('tokShield', `${B}plat/heart.glb`, PK),
  model('tokJetpack', `${B}plat/spring.glb`, PK),

  // ---- station dressing ----
  model('lamp', `${C}props/roads/light-square.glb`, CR),
  model('lampCurved', `${C}props/roads/light-curved.glb`, CR),
  model('warnSign', `${C}props/roads/road-sign-warning.glb`, CR),
  model('dumpster', `${C}props/roads/dumpster.glb`, CR, false),
  model('pillar', `${C}props/roads/bridge-pillar.glb`, CR, false, 'later'),

  // ---- streets: commercial kit (opening district) ----
  ...['building-a', 'building-b', 'building-c', 'building-d', 'building-e', 'building-f', 'building-g', 'building-h']
    .map((n) => model('bld:' + n, `${C}city/${n}.glb`, CC)),
  ...['building-skyscraper-a', 'building-skyscraper-b', 'building-skyscraper-c']
    .map((n) => model('sky:' + n, `${C}city/${n}.glb`, CC)),
  model('awning', `${C}city/detail-awning-wide.glb`, CC),
  model('overhang', `${C}city/detail-overhang-wide.glb`, CC),

  // ---- industrial district (streams in after reveal) ----
  ...['building-a', 'building-c', 'building-f', 'building-k']
    .map((n) => model('ind:' + n, `${C}props/ind/${n}.glb`, CI, false, 'later')),
  model('waterTower', `${C}props/ind/water-tower.glb`, CI, false, 'later'),
  model('container', `${C}props/ind/shipping-container-a.glb`, CI, false, 'later'),

  // ---- audio ----
  ...['step0', 'step1', 'step2', 'step3', 'jump', 'land', 'slide', 'lane', 'coin', 'powerup', 'activate',
    'trainPass', 'trainHorn', 'crash', 'crashMetal', 'click', 'back', 'countTick', 'countGo', 'gameOver', 'highScore']
    .map((k) => audio(k)),
  // beds are large; they are required for the intended experience but a
  // failure must not block play (audio may be unavailable on the device)
  audio('ambience', false),
  audio('music', false),
];

/** Animation clip names that MUST exist in runner-anims.glb (validated at load). */
export const REQUIRED_CLIPS = ['idle', 'run', 'jumpStart', 'jumpLoop', 'jumpLand', 'slideStart', 'slideLoop', 'slideExit', 'hit', 'knockback', 'death'];
