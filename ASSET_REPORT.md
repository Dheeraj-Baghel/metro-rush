# METRO RUSH asset integration report

Source: the user-supplied CC0 bundle `metro-rush-assets/` (8 packs, per its
`starter-manifest.json` / `model-catalog.json`). Only the files the game uses
are copied into `public/assets/b/` (4.4 MB). No FBX/OBJ/previews ship.
License copies: `public/assets/licenses/`. No Subway Surfers assets are used.

## Runtime assets (bounds measured with `qa/probe-assets.mjs`)

| File (public/assets/b/) | Role | Pack | Native size (u) | In-game handling |
|---|---|---|---|---|
| men/Casual_Hoodie.gltf | Runner (skinned, 24 clips) | Quaternius Modular Men | 1.87 tall | Scaled to 2.0 u at its parent, rotated to face -z, Root/Hips translation stripped, hoodie recolored orange/navy for readability |
| trains/train-electric-subway-a/b/c.glb | Train front/middle/rear | Kenney Train Kit | 1.1 x 1.93 x 2.6 | ×1.9, 3-car consist, collider from measured length |
| trains/railroad-straight.glb | Rail tile | Kenney Train Kit | 1 x 4 | Instanced 9 per lane per chunk, grounded via measured bounds |
| plat/fence-low-straight.glb | Low barrier (jump) | Kenney Platformer Kit | 1 x 0.3 | ×2.4, collider top 0.72 |
| plat/fence-straight.glb | Overhead bar (slide) | Kenney Platformer Kit | 1 x 0.4 | ×2.3 on posts, gap below 1.25 |
| plat/barrel.glb | Single-lane hazard | Kenney Platformer Kit | 0.52 | ×1.9 |
| plat/crate.glb | Crate wall (lane switch) | Kenney Platformer Kit | 0.5 | 3 crates at ×2 |
| plat/coin-gold.glb | Coin | Kenney Platformer Kit | 0.4 | ×1.6, pooled |
| plat/jewel, star, heart, spring.glb | Magnet, ×2, shield, jetpack tokens | Kenney Platformer Kit | ~0.35 | Kept the halo ring (the bundle has no bespoke power-up art) |
| city/building-*.glb, low-detail-building-*.glb | Street and far buildings | Kenney City Kit Commercial | ~1 | ×6.5 near, ×14 far |
| audio/highUp, phaseJump1, powerUp1, impactSoft_heavy_000, footstep_concrete_000-003.ogg | Coin, jump, power-up, crash, footsteps | Kenney Digital Audio / Impact Sounds | — | Footsteps rotate through 4 samples; voice caps (coin 3, step 2); synth fallback |

## Animation
- `Idle` on the menu. `Run` during play, playback speed scaled with game speed. `Roll` plays as the slide, sped up to the 0.75 s slide window. `HitRecieve` plays once when the shield absorbs a hit. `Death` plays once and holds its last frame.
- The rig has no jump clip, so jumping uses the gameplay arc plus a layered bone pose (tucked legs, raised arms) over a frozen Run frame. The spine also leans during lane changes.
- Gameplay movement and colliders stay independent of animation.

## Not supplied by the bundle, kept as original procedural art
Hoverboard/shield bubble, jetpack, station canopies, the logo and the music.

## Verification
`qa/run-qa.mjs` (headless Chromium, production build): **17/17 checks pass**.
- Skinned runner present (10 skinned meshes), and its skeleton is shown to change pose over time.
- Gameplay averages 43–60 fps. There are no page errors and no 404s.

Screenshots are in `artifacts/testing/`.

Not verified:
- Real-device touch.
- Safari OGG decoding. The synth fallback is in place for that case.
- Listening tests of the sound mix.
