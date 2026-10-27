# METRO RUSH

**Run Fast. Dodge Everything. Own the City.**

## GitHub / Vercel release

**[Play METRO RUSH](https://metro-rush-softtech10.vercel.app)** — live on the user's
Vercel Hobby account, with a dedicated
[private GitHub repository](https://github.com/Dheeraj-Baghel/metro-rush).
Future pushes to `main` automatically deploy. Node 24 and cloud asset/unit/type/
build gates are configured. **118 units, 55 local browser checks and 9 hosted
workflow groups pass**, including real public play/pause/restart, preference
persistence and phone-sized tap/swipe play. All 64 runtime assets match local
production bytes. No keys, backend or paid upgrade was added. See
[deployment and safe updates](DEPLOYMENT.md).

**Current runtime:** real Quaternius skinned runner/animation clips, Kenney
trains/rails/city/obstacles, authored fair sequences and roof/ramp gameplay,
normalized sampled WAV effects/ambience and a CC0 music loop. This supersedes the
historical procedural-character/music notes below. The 64 runtime assets and
11 required clip names are audited; **118 unit tests and TypeScript/build pass**.
[Third-party sources/notices](THIRD_PARTY.md) are preserved; no Subway Surfers
fan model ships. Private download inboxes, raw packs and local captures are not
uploaded. Public debug helpers are blocked; local QA retains them on loopback.

Build with **Node 24**: `npm ci && npm run verify`. Original regeneration tools
under `qa/` may require local source downloads; production builds do not.

A complete, browser-playable 3D endless runner in the style of premium mobile
arcade runners. Original art, character, sounds, and branding — no proprietary
assets. Built with Vite + TypeScript + React + Three.js.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-checks + production build to dist/
npm run preview  # serve the production build
```

## Controls

| Action | Desktop | Mobile |
| --- | --- | --- |
| Move left | ← / A | Swipe left |
| Move right | → / D | Swipe right |
| Jump | ↑ / W / Space | Swipe up |
| Slide | ↓ / S | Swipe down |
| Pause | Esc / P | Pause button |

Lane switching is allowed while airborne; pressing slide while airborne slams
the character down into a slide.

## Architecture

The Three.js engine runs entirely outside React's lifecycle; React renders only
menus/HUD and receives throttled (~10 Hz) HUD snapshots via a listener.

```
src/
  main.tsx, App.tsx      React shell: menus, HUD, pause, game over, settings
  styles.css             Arcade UI (glassmorphism, safe areas, responsive)
  game/
    game.ts              Engine: renderer, chase camera, game loop (rAF +
                         clamped delta), finite state machine (LOADING,
                         MAIN_MENU, COUNTDOWN, PLAYING, PAUSED, GAME_OVER),
                         AABB collision, scoring, power-up timers
    config.ts            All gameplay tuning constants + LocalStorage save
    player.ts            Procedural articulated runner (hoodie, backpack,
                         sneakers) with run/jump/fall/slide/lean/idle/crash
                         animation states, arcade physics, state-aware collider
    world.ts             Endless world: recycled track chunks, 6 themed
                         districts (city/station/construction/neon/bridge/
                         tunnel), pooled trains/obstacles/coins/power-ups,
                         seeded RNG, fair pattern generator
    particles.ts         Pooled additive point-sprite FX (dust, sparkle, crash)
    input.ts             Keyboard + swipe input (prevents page scroll)
    audio.ts             Procedural Web Audio SFX + chiptune loop, autoplay-safe
```

## Implemented features

- Three-lane endless running with smooth lane interpolation, gravity jump,
  timed slide (reduced collider height), air lane-switching
- Procedural chunk recycling + object pooling (no per-frame allocation churn,
  no unbounded scene growth)
- Obstacles: stationary trains, fast oncoming trains (with audio warning),
  low barriers (jump), overhead barriers (slide), cones, construction frames
- Fairness rule: every generated pattern keeps at least one passable lane
- Coins (rows + jump arcs), magnet attraction, pooled collection FX
- Power-ups: Coin Magnet, Jetpack (flies above hazards with aerial coin
  trails), Hoverboard Shield (absorbs one hit with glow board), 2× Score
  Multiplier — all with HUD duration meters
- Difficulty ramp: speed 12 → 34 u/s, denser/more complex patterns, FOV
  widening with speed
- Chase camera with damping, run bob, landing shake, crash shake, FOV boosts
- Golden-hour lighting, fog, soft shadows, distant skyline, neon signage
- Full state machine with countdown, pause (also on tab-hide), full in-place
  restart (no reload), main menu with orbiting character hero shot
- Procedural sound design + music, volume/mute settings, LocalStorage
  persistence of best score, coin total, and settings
- Graphics presets LOW/MEDIUM/HIGH (pixel ratio, shadows, decoration density)
- Mobile: swipe controls, portrait FOV widening, safe-area UI, touch-scroll
  prevention; WebGL-unavailable fallback screen

## Verification (automated browser QA)

`node qa/run-qa.mjs` serves the production build and drives the real game in
headless Chromium (WebGL enabled): menu render, countdown, HUD, score growth,
pause/resume, lane switch + jump + slide screenshots, forced collision →
game over, retry reset, LocalStorage persistence after reload, desktop
performance sampling, and a 390×844 mobile-viewport run. Latest run:
**15/15 checks passed, ~53–57 fps average** with zero page errors. Results in
`artifacts/testing/qa-results.json`; state screenshots (menu, run, jump,
slide, pause, game over, restart, mobile) in `artifacts/testing/`.

Gameplay fairness: pattern generation guarantees ≥1 passable lane, and the
first ~220 m keep the starting center lane fully clear so every new run has a
generous reaction window (verified by the restart check surviving countdown).

## CC0 asset integration

Per [METRO_RUSH_ASSET_PACK.md](METRO_RUSH_ASSET_PACK.md): Kenney Train Kit
trains (7 GLBs), Kenney City Kit Commercial buildings (6 GLBs), and Kenney
Interface Sounds (CC0) are downloaded locally, normalized on load
(`src/game/assets.ts`), and swapped in for the procedural stand-ins at
runtime; collision hulls are measured from the real meshes. Subway Surfers
fan models (section A of the brief) are deliberately NOT used — reference
only, rights not clear. Full provenance, normalization details, and the
missing-pack list: [ASSET_REPORT.md](ASSET_REPORT.md). Licenses:
`public/assets/licenses/`.

## Known limitations

- Character is procedural (no external GLTF rig); animation is hand-coded
  posing — expressive but simpler than mocap
- Music is a lightweight generative chiptune loop, not an authored track
- QA is headless-Chromium; real-device touch feel, Safari/Firefox, and
  sustained-GPU performance remain manual checks
- Single bundle (~184 kB gzip) — fine for static hosting, no code-splitting

## Deployment (Vercel / Netlify)

Static output, no backend:

- **Vercel:** import the repo, framework = Vite, build `npm run build`,
  output `dist`
- **Netlify:** build `npm run build`, publish directory `dist`

`base: './'` is set so the build also works from any sub-path or `file://`-like
static host.
