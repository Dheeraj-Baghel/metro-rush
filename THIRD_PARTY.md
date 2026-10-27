# METRO RUSH — shipped third-party content

This release uses the current runtime asset manifest, not the earlier procedural
prototype described in historical notes. Source download archives and unused
asset packs are excluded from publication/deployment. No Subway Surfers fan model,
logo, proprietary character or reference recreation is included in the manifest.

## 3D models, rig and clips

- **Quaternius Universal Base Characters, Standard/free edition**: current
  runner, adapted locally for this game; **CC0 1.0**. Original bundled notice is
  preserved under public/assets/licenses/quaternius-universal-base-characters.txt.
  https://quaternius.com/packs/universalbasecharacters.html
- **Quaternius Universal Animation Library 1 and 2, Standard/free editions**:
  selected/retargeted run, jump, slide, hit and death animation clips; **CC0 1.0**.
  Bundled notices are preserved under public/assets/licenses/.
  https://quaternius.com/packs/universalanimationlibrary.html
  https://quaternius.com/packs/universalanimationlibrary2.html
- **Kenney** Train Kit, Platformer Kit, City Kit Commercial, Roads and Industrial:
  trains, rails, obstacles, pickups and city dressing; **CC0 1.0**. Existing
  notices in public/assets/licenses/ are included. Some textures were recolored
  for the original Metro Rush palette.
  https://kenney.nl/assets/train-kit
  https://kenney.nl/assets/platformer-kit
  https://kenney.nl/assets/city-kit-commercial
  https://kenney.nl/assets/city-kit-roads
  https://kenney.nl/assets/city-kit-industrial

## Sound and music

- **Kenney** Impact Sounds, Digital Audio, Interface Sounds, RPG Audio and Music
  Jingles: steps, impacts, pickups, movement/UI cues and result stingers; **CC0**.
  Existing license copies ship under public/assets/licenses/.
- **Joseph Sardin / BigSoundBank**: train passage #6 (s3416), train horn #2
  (s2846), whoosh #3 (s1795), Dock Gare du Nord Paris (s0647); source-page records
  identify these as **CC0/public domain**. Copies are trimmed, leveled and/or
  crossfaded for this game, not used as externally streamed files.
  https://bigsoundbank.com/passage-of-a-train-6-s3416.html
  https://bigsoundbank.com/train-horn-2-s2846.html
  https://bigsoundbank.com/whoosh-3-s1795.html
  https://bigsoundbank.com/dock-gare-du-nord-paris-s0647.html
- **congusbongus, “Keep your dream alive! (seamless loop)”**, OpenGameArt:
  **CC0**, confirmed on the original asset page for publication. A selected loop
  is crossfaded/resampled/leveled locally by qa/build-audio.mjs.
  https://opengameart.org/content/keep-your-dream-alive-seamless-loop
  The unrelated Ansimuz notice in the local music inbox does not establish this
  track's provenance and is not used as its license evidence.

Exact source paths, selected regions and conversion metadata are in the shipped
public/assets/c/audio/audio-sources.json. These paths are historical provenance,
not runtime download requirements. No raw audio inbox is served.

## Fonts and libraries

- **Kenney Future / Kenney Future Narrow**: **CC0**, Kenney Fonts pack.
  https://kenney.nl/assets/kenney-fonts
- React / React DOM (MIT), Three.js (MIT), and build/test dependencies retain
  their upstream notices and exact versions through the npm lockfile. The game
  does not relicense those libraries. The original game source has no new
  open-source licence granted merely by GitHub hosting; repository stays private.

CC0 does not require attribution, but credits and included notices are retained.
These assets' permissive status does not claim rights to third-party trademarks,
Subway Surfers branding, or arbitrary content in excluded reference downloads.
