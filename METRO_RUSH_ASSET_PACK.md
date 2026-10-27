# METRO RUSH - asset sourcing and integration brief

Research date: 2026-10-21. Intended for a browser-playable Three.js/React endless runner inspired by the genre of Subway Surfers.

## Read this first: rights and scope

- Subway Surfers, Jake, its logos, maps, sound, characters, distinctive game artwork, and original models belong to their respective rights holders. A third-party fan upload labelled "CC BY" does not establish permission from the underlying rights holder.
- Assets in section A are references / private-prototype candidates only. **Do not redistribute them or publish a game using those recognizable protected designs without appropriate permission.** Prefer section B for a public project.
- Pack listing and license were checked on publicly accessible asset pages; the actual downloaded files were not obtained or tested in this research session. Recheck licenses when downloading.
- Treat links as asset-page URLs, not guaranteed direct .glb download endpoints. Sketchfab may require logging in; Kenney uses a free-download flow; Quaternius has free Standard and paid Source tiers.

## A. Subway Surfers fan/community 3D models -- rights for redistribution NOT VERIFIED

| Asset | Link | Page details |
| --- | --- | --- |
| Jake model A | <https://sketchfab.com/3d-models/jake-subway-surfers-50be24c8b2fe4628a401b339bb2e2958> | Download listed, CC BY uploader claim; 1.4k triangles |
| Jake model B | <https://sketchfab.com/3d-models/jake-subway-surfers-real-825926cbb5734b9e904a61549a9de640> | Download listed, CC BY uploader claim; 1.4k triangles |
| Train | <https://sketchfab.com/3d-models/subway-surfers-train-f212f9fb7ac347d0a15cf74c40548b9e> | Download listed, CC BY uploader claim; 164 triangles |
| Three trains + railway track inspired by Subway Surfers | <https://sketchfab.com/3d-models/trains-like-in-subway-surfers-748075daf6844e4698618b6ed8735b73> | 3 train types + 1 track type, no textures, CC BY uploader claim |
| Coin | <https://sketchfab.com/3d-models/subway-surfers-coin-0e9142deb008408f8814acd71abf8018> | Download listed, CC BY uploader claim; 80 triangles |
| Hoverboard | <https://sketchfab.com/3d-models/mobile-subway-surfers-hoverboard-6fa1bbc29cd3435e915695425064b0d0> | Download listed, CC BY uploader claim; 130 triangles |
| Police dog | <https://sketchfab.com/3d-models/subway-surfers-dog-e39f32904e1d474ab99d0a301bc37537> | Download listed, CC BY uploader claim; 644 triangles |
| Community map | <https://sketchfab.com/3d-models/subway-surfers-maps-efd4026fe3274204b156198e5c3ea03b> | Download listed, CC BY uploader claim; 50.3k triangles |

Use for reference only unless permission is confirmed from the rights holder. Do not assume these models contain skeletons/animation clips. Inspect before use.

## B. Free / CC0 packs recommended for the released game

| Role | Asset pack | Link | Verified page claims |
| --- | --- | --- | --- |
| Trains and rails | Kenney Train Kit | <https://kenney.nl/assets/train-kit> | 100 models, Creative Commons CC0 |
| Three-lane urban world | Quaternius Downtown City MegaKit | <https://quaternius.com/packs/downtowncitymegakit.html> | 300+ modular pieces, CC0; some content paid Source tier |
| Player base | Quaternius Universal Base Characters | <https://quaternius.com/packs/universalbasecharacters.html> | Rigged humanoids, hairstyles, CC0, free subset |
| Run/locomotion animations | Quaternius Universal Animation Library | <https://quaternius.com/packs/universalanimationlibrary.html> | 120+ animations, CC0, free subset |
| Parkour/slide clips | Quaternius Universal Animation Library 2 | <https://quaternius.com/packs/universalanimationlibrary2.html> | 130+ animations, CC0, free subset |
| Obstacles, pickups, animated starter character | Quaternius Ultimate Platformer Pack | <https://quaternius.itch.io/ultimate-platformer-pack> | 100+ models; animated character with 18 clips, CC0 |
| Traffic/street props | Kenney City Kit (Roads) | <https://kenney.nl/assets/city-kit-roads> | 90 pieces, CC0 |
| Stations/industrial neighborhoods | Kenney City Kit (Industrial) | <https://kenney.nl/assets/city-kit-industrial> | 40 pieces, CC0 |
| Buildings/skyscrapers | Kenney City Kit (Commercial) | <https://kenney.nl/assets/city-kit-commercial> | 50 pieces, CC0 |
| HUD/pause/menu | Kenney UI Pack | <https://kenney.nl/assets/ui-pack> | 430 assets, CC0 |
| Mobile controls | Kenney Mobile Controls | <https://kenney.nl/assets/mobile-controls> | 900 assets, CC0 |
| Clicks | Kenney Interface Sounds | <https://kenney.nl/assets/interface-sounds> | 100 sounds, CC0 |
| Trees and bushes | Quaternius Ultimate Stylized Nature Pack | <https://quaternius.com/packs/ultimatestylizednature.html> | 60+ assets, CC0 |

Download to local disk through the linked source page before the agent imports them; preserve accompanying license documents. If formats include glTF/GLB, use those preferentially. Otherwise convert FBX/OBJ to GLB in Blender, keeping original files and textures.

## C. Code references -- evaluate quality and license, do not blindly copy

1. React + Three.js browser endless runner, zero external assets, MIT listed: <https://github.com/NikhilMamilla/Subway-Surfers>
2. WebGL 2.0 sample with assets folder and MIT source code: <https://github.com/RohanChacko/Subway-Surfers> -- assets' origin and independent redistribution permissions are not established by that MIT license. The README warns of a Chrome CORS problem and recommends Firefox.
3. React/TypeScript/Three.js endless-runner sample, MIT listed: <https://github.com/zeuzmakessoftware/subtrae-surfers> -- review the implementation and third-party asset rights before reuse.

## D. Local folder layout for downloaded archives

```
project/
  ASSET_SOURCES.md                    # copy this file here
  asset-inbox/                        # original downloaded archives (do not load directly)
    kenney_train-kit.zip
    quaternius_downtown_city.zip
    quaternius_universal_base_characters.zip
    quaternius_animation_library.zip
    quaternius_animation_library_2.zip
    quaternius_platformer.zip
    kenney_city_roads.zip
    kenney_ui.zip
    kenney_interface_sounds.zip
  public/
    assets/
      characters/
      trains/
      track/
      city/
      obstacles/
      pickups/
      animations/
      audio/
      ui/
  src/
    game/
      assetManifest.ts
      loaders/
```

The filenames above are organizational placeholders, not asserted filenames from vendors. The agent should discover actual downloaded filenames and inventory archive contents before moving/converting files.

## E. Instructions to paste into a coding agent

> Use `ASSET_SOURCES.md` as the sourcing plan for a polished original Subway Surfers-style web game. Use the CC0 packs in section B for all public-facing game content. Section A contains potentially unauthorized fan recreations of proprietary game artwork and must be treated only as visual reference unless I supply clearance. Build the game in Vite + TypeScript + Three.js with a React HUD. First inspect `asset-inbox/`; do not assume the files have already been downloaded. Generate a report listing each usable asset, its source pack, license, file format, and destination path. Normalize axes, transforms, unit scale and origins before use. Prefer `.glb` files and Three.js `GLTFLoader`; retarget humanoid animation clips where skeletons differ, using a compatible rig. Use animation blending for run/jump/slide, and per-obstacle collision hulls distinct from detailed render meshes. Fit original assets to consistent track width and three lane centers. Keep source license files under `assets/licenses/`. Use relative local paths served by Vite, not Sketchfab page URLs. Create an `assetManifest.ts` whose entries point to real files verified on disk. If required models are missing, stop and list missing downloads or make clearly original procedural stand-ins. Never imply page links themselves are directly loadable 3D models. For performance, pool moving objects, clone skinned meshes correctly, use frustum culling and reusable materials, and test browser gameplay and asset loading.\`

## F. Implementation acceptance checklist

- [ ] Asset files are present locally (not just links).

- [ ] License/provenance is checked for every file.

- [ ] Three lane centers line up with train/track dimensions.

- [ ] Runner is skinned and animations blend correctly.

- [ ] Trains render with visible materials and no missing textures.

- [ ] Coin pickups and power-ups are correctly scaled.

- [ ] Obstacle hitboxes match visual geometry and are fair.

- [ ] No protected Subway Surfers visual identity is published without authorization.

- [ ] `npm run dev` launches the game and `npm run build` succeeds.

- [ ] Test desktop and mobile input, collision, game over, restart, and 5-minute gameplay.