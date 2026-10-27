// METRO RUSH station kit: a small set of recurring architectural modules with
// controlled variation, composed into three districts:
//   0 STATION  — platforms, canopy shelters, benches, signage, lamps
//   1 STREET   — terraced Kenney commercial buildings set back behind a
//                trackside retaining wall with original graffiti panels
//   2 YARD     — industrial buildings, containers, water towers (streams in)
//
// Palette (one cohesive direction, kept in sync with the re-paletted Kenney
// colormaps): cream stone, terracotta, teal/blue station steel, yellow safety.
//
// Performance: every module is built once as a template; dressing a chunk
// clones templates from per-kind free lists (geometry + materials shared),
// and recycling returns them to the free lists. Shared materials are never
// disposed. Graffiti/sign textures are generated once from canvas.
import * as THREE from 'three';
import { CONFIG } from './config';
import { normalized } from './assets';

export const PALETTE = {
  cream: 0xf1e4cc, creamDark: 0xd9c7a6, terracotta: 0xc8674a, terracottaDark: 0x9e4d37,
  teal: 0x1f8a8f, tealDark: 0x15656a, blue: 0x2f6fae, safety: 0xf4c430, concrete: 0xb9b2a6,
  ballast: 0x8a8076, sleeper: 0x7a604a, rail: 0xc9ced3, asphalt: 0x6c6a66, glass: 0x9fd3e6,
};

export interface StationKit {
  makeTrackBed(): THREE.Group;
  dress(into: THREE.Group, district: number, rng: () => number, density: number): void;
  release(o: THREE.Object3D): void;
  makeRamp(len: number, h: number): THREE.Group;
  makeOverheadSign(y0: number, y1: number): THREE.Group;
  freeCount(): number;
}

const std = (color: number, rough = 0.85, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Original graffiti panels — bold letter-shapes and stripes in the palette. */
function graffitiTextures(): THREE.Texture[] {
  const words = ['RUSH', 'LINE 7', 'GO!', 'MR', 'DASH'];
  const schemes = [
    ['#c8674a', '#f4c430', '#1f8a8f'], ['#1f8a8f', '#f1e4cc', '#c8674a'],
    ['#2f6fae', '#f4c430', '#f1e4cc'], ['#9e4d37', '#7cd6c0', '#f4c430'], ['#f4c430', '#1f8a8f', '#9e4d37'],
  ];
  return words.map((w, i) => canvasTex(512, 192, (g) => {
    const [a, b, c] = schemes[i];
    g.fillStyle = '#d9c7a6'; g.fillRect(0, 0, 512, 192); // wall base so panel blends
    // background burst
    g.fillStyle = a;
    g.beginPath();
    for (let k = 0; k < 14; k++) {
      const ang = (k / 14) * Math.PI * 2, r = k % 2 ? 70 : 110;
      g.lineTo(256 + Math.cos(ang) * r * 2.1, 96 + Math.sin(ang) * r * 0.8);
    }
    g.closePath(); g.fill();
    // outlined chunky letters
    g.font = `900 ${w.length > 3 ? 104 : 128}px "Arial Black", Impact, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 18; g.strokeStyle = '#2b2422'; g.strokeText(w, 256, 100);
    g.fillStyle = b; g.fillText(w, 256, 100);
    g.lineWidth = 4; g.strokeStyle = c; g.strokeText(w, 256, 100);
    // drips
    g.fillStyle = b;
    for (let k = 0; k < 7; k++) { const x = 120 + k * 45 + (k * 17) % 13; g.fillRect(x, 140, 6, 18 + ((k * 31) % 26)); }
  }));
}

function stationSignTexture(name: string): THREE.Texture {
  return canvasTex(512, 128, (g) => {
    g.fillStyle = '#15656a'; g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#f1e4cc'; g.fillRect(10, 10, 492, 108);
    g.fillStyle = '#1f8a8f'; g.fillRect(16, 16, 96, 96);
    g.fillStyle = '#f1e4cc'; g.font = '900 64px "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('M', 64, 68);
    g.fillStyle = '#1d2a33'; g.font = '800 54px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'left';
    g.fillText(name, 132, 68);
  });
}

function hazardStripeTexture(): THREE.Texture {
  const t = canvasTex(128, 32, (g) => {
    g.fillStyle = '#f4c430'; g.fillRect(0, 0, 128, 32);
    g.fillStyle = '#2b2422';
    for (let x = -32; x < 160; x += 32) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 32); g.lineTo(x + 32, 0); g.lineTo(x + 16, 0); g.fill(); }
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function tactileTexture(): THREE.Texture {
  // platform-edge tactile paving: yellow with raised dots
  const t = canvasTex(64, 64, (g) => {
    g.fillStyle = '#f4c430'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#d9a81c';
    for (let y = 8; y < 64; y += 16) for (let x = 8; x < 64; x += 16) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function platformTexture(): THREE.Texture {
  const t = canvasTex(128, 128, (g) => {
    g.fillStyle = '#e7dcc6'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(120,100,80,0.18)'; g.lineWidth = 2;
    for (let i = 0; i <= 128; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function ballastTexture(): THREE.Texture {
  const t = canvasTex(128, 128, (g) => {
    g.fillStyle = '#958a7e'; g.fillRect(0, 0, 128, 128);
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 900; i++) {
      const v = 118 + Math.floor(rnd() * 34);
      g.fillStyle = `rgb(${v + 10},${v + 2},${v - 6})`;
      g.fillRect(rnd() * 128, rnd() * 128, 1.5 + rnd() * 2, 1.5 + rnd() * 2);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function createStationKit(models: Map<string, THREE.Group>): StationKit {
  const L = CONFIG.chunkLength;
  const M = {
    ballast: new THREE.MeshStandardMaterial({ map: ballastTexture(), roughness: 1 }),
    sleeper: std(PALETTE.sleeper, 0.95),
    rail: std(PALETTE.rail, 0.35, 0.8),
    railBase: std(0x6d6a66, 0.8, 0.3),
    platform: new THREE.MeshStandardMaterial({ map: platformTexture(), roughness: 0.9 }),
    platformFace: std(PALETTE.creamDark, 0.9),
    tactile: new THREE.MeshStandardMaterial({ map: tactileTexture(), roughness: 0.8 }),
    safety: std(PALETTE.safety, 0.6),
    teal: std(PALETTE.teal, 0.55, 0.25),
    tealDark: std(PALETTE.tealDark, 0.6, 0.3),
    cream: std(PALETTE.cream, 0.9),
    terracotta: std(PALETTE.terracotta, 0.85),
    terracottaDark: std(PALETTE.terracottaDark, 0.9),
    glass: new THREE.MeshStandardMaterial({ color: PALETTE.glass, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.45 }),
    wood: std(0xa8743f, 0.8),
    steel: std(0x58636c, 0.5, 0.6),
    wall: std(0xd9c7a6, 0.95),
    wallCap: std(0xbfae90, 0.9),
    hazard: new THREE.MeshStandardMaterial({ map: hazardStripeTexture(), roughness: 0.6 }),
    signLight: new THREE.MeshBasicMaterial({ color: 0xfff6dc }),
    asphalt: std(PALETTE.asphalt, 0.95),
    hedge: std(0x5b9a5c, 0.95),
  };
  (M.hazard.map as THREE.Texture).repeat.set(4, 1);
  const graffiti = graffitiTextures().map((t) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }));
  const stationNames = ['Harbour Line', 'Central', 'Mill Street', 'Northgate', 'Riverside'];
  const signMats = stationNames.map((n) => new THREE.MeshStandardMaterial({ map: stationSignTexture(n), roughness: 0.6, emissive: 0x111111 }));

  const G = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
    plane: new THREE.PlaneGeometry(1, 1),
  };
  const box = (mat: THREE.Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0, shadow = true) => {
    const m = new THREE.Mesh(G.box, mat);
    m.scale.set(sx, sy, sz); m.position.set(x, y, z);
    m.castShadow = shadow; m.receiveShadow = true;
    m.userData.sharedAsset = true;
    return m;
  };
  const cyl = (mat: THREE.Material, r: number, h: number, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(G.cyl, mat);
    m.scale.set(r * 2, h, r * 2); m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true; m.userData.sharedAsset = true;
    return m;
  };

  // ---------------- static track bed (one per chunk, never recycled) -------------
  function makeTrackBed(): THREE.Group {
    const g = new THREE.Group();
    // ballast trough across all three tracks, slightly below rail level
    const bed = box(M.ballast, 7.6, 0.3, L, 0, -0.15, -L / 2, false);
    (bed.material as THREE.MeshStandardMaterial).map!.repeat.set(3, L / 3);
    g.add(bed);
    // instanced sleepers + rails per lane: 2 draw calls for the whole chunk
    const sleeperN = Math.floor(L / 0.9);
    const sleepers = new THREE.InstancedMesh(G.box, M.sleeper, sleeperN * 3);
    const rails = new THREE.InstancedMesh(G.box, M.rail, 6);
    const railBases = new THREE.InstancedMesh(G.box, M.railBase, 6);
    const tmp = new THREE.Object3D();
    let si = 0, ri = 0;
    for (const lx of CONFIG.lanes) {
      for (let k = 0; k < sleeperN; k++) {
        tmp.position.set(lx, 0.04, -0.45 - k * 0.9);
        tmp.scale.set(1.75, 0.1, 0.22); tmp.rotation.set(0, 0, 0); tmp.updateMatrix();
        sleepers.setMatrixAt(si++, tmp.matrix);
      }
      // standard-gauge proportions at runner scale: rails 1.44 apart, slim
      for (const off of [-0.72, 0.72]) {
        tmp.position.set(lx + off, 0.165, -L / 2); tmp.scale.set(0.07, 0.09, L); tmp.updateMatrix();
        rails.setMatrixAt(ri, tmp.matrix);
        tmp.position.set(lx + off, 0.11, -L / 2); tmp.scale.set(0.14, 0.03, L); tmp.updateMatrix();
        railBases.setMatrixAt(ri++, tmp.matrix);
      }
    }
    for (const im of [sleepers, rails, railBases]) { im.receiveShadow = true; im.castShadow = false; im.userData.sharedAsset = true; g.add(im); }
    // platforms either side with tactile edge + yellow safety line
    for (const s of [-1, 1]) {
      const plat = box(M.platform, 4.2, 1.0, L, s * 5.9, 0.5, -L / 2, false);
      (plat.material as THREE.MeshStandardMaterial).map!.repeat.set(2, L / 2);
      g.add(plat);
      g.add(box(M.platformFace, 0.12, 1.0, L, s * 3.82, 0.5, -L / 2, false));
      g.add(box(M.tactile, 0.55, 0.02, L, s * 4.18, 1.01, -L / 2, false));
      g.add(box(M.safety, 0.1, 0.021, L, s * 4.55, 1.012, -L / 2, false));
    }
    return g;
  }

  // ---------------- pooled dressing modules ----------------
  type Maker = () => THREE.Object3D;
  const free: Record<string, THREE.Object3D[]> = {};
  const makers: Record<string, Maker> = {};
  const take = (kind: string) => {
    const f = free[kind] ?? (free[kind] = []);
    const o = f.pop() ?? makers[kind]();
    o.userData.kitKind = kind;
    o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1);
    o.visible = true;
    return o;
  };
  const release = (o: THREE.Object3D) => {
    const k = o.userData.kitKind;
    if (!k) return;
    o.visible = false;
    (free[k] ?? (free[k] = [])).push(o);
  };

  const model = (k: string) => models.get(k);

  // canopy shelter: teal steel frame, glass roof, cream back panel, bench
  makers.shelter = () => {
    const g = new THREE.Group();
    for (const z of [-2.6, 2.6]) {
      g.add(cyl(M.teal, 0.09, 3.2, 0.6, 1.6, z));
      g.add(cyl(M.teal, 0.09, 3.2, -1.2, 1.6, z));
    }
    g.add(box(M.tealDark, 2.4, 0.14, 6.0, -0.3, 3.25, 0));
    const roof = box(M.glass, 2.3, 0.04, 5.9, -0.3, 3.34, 0, false);
    g.add(roof);
    g.add(box(M.cream, 0.08, 1.6, 5.2, -1.2, 1.5, 0));
    // bench
    g.add(box(M.wood, 0.5, 0.08, 2.4, -0.7, 0.48, 0));
    g.add(box(M.wood, 0.08, 0.45, 2.4, -0.95, 0.74, 0));
    for (const z of [-1.0, 1.0]) g.add(box(M.steel, 0.4, 0.44, 0.06, -0.7, 0.22, z));
    return g;
  };
  // station name sign on twin posts (variant chosen at dress time)
  makers.nameSign = () => {
    const g = new THREE.Group();
    g.add(cyl(M.steel, 0.05, 2.6, 0, 1.3, -1.1));
    g.add(cyl(M.steel, 0.05, 2.6, 0, 1.3, 1.1));
    const plate = new THREE.Mesh(G.plane, signMats[0]);
    plate.scale.set(2.6, 0.65, 1); plate.position.set(0.06, 2.35, 0); plate.rotation.y = Math.PI / 2;
    plate.userData.sharedAsset = true; plate.userData.signPlate = true;
    g.add(plate);
    const back = box(M.tealDark, 0.05, 0.72, 2.7, 0, 2.35, 0);
    g.add(back);
    return g;
  };
  // platform lamp (Kenney roads light, scaled to ~4.2 m) or kit fallback
  makers.lamp = () => {
    const src = model('lamp');
    if (src) { const l = normalized(src, 7.5); return l; }
    const g = new THREE.Group(); g.add(cyl(M.steel, 0.06, 4.0, 0, 2, 0)); return g;
  };
  makers.bench = () => {
    const g = new THREE.Group();
    g.add(box(M.wood, 0.5, 0.08, 2.0, 0, 0.48, 0));
    g.add(box(M.wood, 0.08, 0.42, 2.0, -0.22, 0.72, 0));
    for (const z of [-0.8, 0.8]) g.add(box(M.steel, 0.42, 0.44, 0.06, 0, 0.22, z));
    return g;
  };
  makers.planter = () => {
    const g = new THREE.Group();
    g.add(box(M.terracotta, 0.9, 0.55, 0.9, 0, 0.28, 0));
    g.add(box(M.hedge, 0.8, 0.5, 0.8, 0, 0.75, 0));
    return g;
  };
  // trackside retaining wall with coping, pilasters and a graffiti panel
  makers.wall = () => {
    const g = new THREE.Group();
    g.add(box(M.wall, 0.6, 3.4, 12, 0, 1.7, 0));
    g.add(box(M.wallCap, 0.8, 0.22, 12, 0, 3.5, 0));
    for (const z of [-5.6, 0, 5.6]) g.add(box(M.wallCap, 0.75, 3.4, 0.5, 0, 1.7, z));
    const panel = new THREE.Mesh(G.plane, graffiti[0]);
    panel.scale.set(4.8, 1.8, 1); panel.position.set(0.31, 1.75, -2.8); panel.rotation.y = Math.PI / 2;
    panel.userData.sharedAsset = true; panel.userData.graffiti = true;
    g.add(panel);
    return g;
  };
  // station back wall (full chunk length): cream masonry with pilasters, a
  // teal frieze band and recessed terracotta panels; poster frames carry
  // the original graffiti/advert art so the wall never reads as blank
  makers.backWall = () => {
    const g = new THREE.Group();
    g.add(box(M.cream, 0.5, 3.6, L, 0, 1.8, 0));
    g.add(box(M.teal, 0.56, 0.42, L, 0, 3.45, 0));
    g.add(box(M.wallCap, 0.62, 0.16, L, 0, 3.74, 0));
    g.add(box(M.terracottaDark, 0.54, 0.28, L, 0, 0.14, 0));
    for (let z = -L / 2 + 3; z < L / 2; z += 6) g.add(box(M.wallCap, 0.62, 3.3, 0.45, 0, 1.65, z));
    for (let z = -L / 2 + 6; z < L / 2 - 1; z += 12) {
      g.add(box(M.terracotta, 0.06, 1.7, 4.4, 0.27, 1.75, z));
      const poster = new THREE.Mesh(G.plane, graffiti[0]);
      poster.scale.set(3.9, 1.46, 1); poster.position.set(0.31, 1.75, z); poster.rotation.y = Math.PI / 2;
      poster.userData.sharedAsset = true; poster.userData.graffiti = true;
      g.add(poster);
    }
    return g;
  };
  // overhead catenary gantry spanning all three tracks
  makers.gantry = () => {
    const g = new THREE.Group();
    for (const s of [-1, 1]) g.add(box(M.tealDark, 0.22, 7.6, 0.22, s * 4.4, 3.8, 0));
    g.add(box(M.tealDark, 9.0, 0.24, 0.24, 0, 7.5, 0));
    for (const lx of CONFIG.lanes) g.add(box(M.steel, 0.03, 0.55, 0.03, lx, 7.2, 0, false));
    return g;
  };
  makers.wire = () => {
    const g = new THREE.Group();
    for (const lx of CONFIG.lanes) g.add(box(M.steel, 0.018, 0.018, L, lx, 6.9, 0, false));
    return g;
  };

  // Kenney buildings: wrapped so the facade faces the track (+x/-x), set on
  // a terracotta plinth so ground lines read cleanly at street level
  const buildingKeys = [...models.keys()].filter((k) => k.startsWith('bld:') || k.startsWith('sky:'));
  const industrialKeys = [...models.keys()].filter((k) => k.startsWith('ind:') || k === 'waterTower');
  for (const k of [...buildingKeys, ...industrialKeys]) {
    makers['b:' + k] = () => {
      const src = models.get(k)!;
      const s = k.startsWith('sky:') ? 5.0 : k.startsWith('ind:') ? 5.5 : k === 'waterTower' ? 4 : 6.2;
      return normalized(src, s);
    };
  }
  if (model('awning')) makers.awning = () => normalized(model('awning')!, 6.2);
  if (model('container')) makers.container = () => normalized(model('container')!, 2.2);

  // ---------------- district composition ----------------
  function dress(into: THREE.Group, district: number, rng: () => number, density: number) {
    const add = (o: THREE.Object3D) => { into.add(o); return o; };
    // gantries every 18 m keep a steady rhythm that sells speed
    for (const z of [-4, -22]) { const g = take('gantry'); g.position.set(0, 0, z); add(g); }
    { const w = take('wire'); w.position.set(0, 0, -L / 2); add(w); }

    if (district === 0) {
      // STATION: shelters + benches + name signs + lamps on both platforms
      for (const s of [-1, 1]) {
        const sh = take('shelter'); sh.position.set(s * 6.6, 1.0, -12); sh.rotation.y = s > 0 ? 0 : Math.PI; add(sh);
        const sign = take('nameSign');
        sign.position.set(s * 7.4, 1.0, -27); sign.rotation.y = s > 0 ? 0 : Math.PI;
        const plate = sign.children.find((c) => c.userData.signPlate) as THREE.Mesh;
        plate.material = signMats[Math.floor(rng() * signMats.length)];
        add(sign);
        for (const z of [-3, -21, -33]) { const l = take('lamp'); l.position.set(s * 4.95, 1.0, z); l.rotation.y = s > 0 ? Math.PI : 0; add(l); }
        if (rng() < 0.7 * density) { const b = take('bench'); b.position.set(s * 6.9, 1.0, -30); b.rotation.y = s > 0 ? 0 : Math.PI; add(b); }
        const p = take('planter'); p.position.set(s * 7.4, 1.0, -6); add(p);
        // station back wall closes the platform: cream masonry, teal frieze
        const bw = take('backWall'); bw.position.set(s * 8.25, 1.0, -L / 2); bw.rotation.y = s > 0 ? Math.PI : 0;
        for (const c of bw.children) if (c.userData.graffiti) (c as THREE.Mesh).material = graffiti[Math.floor(rng() * graffiti.length)];
        add(bw);
      }
    }
    // station back buildings / street terraces: buildings sit on a continuous
    // building line (x = ±11.5), packed edge to edge so the street reads as
    // intentional frontage rather than isolated objects
    const keys = district === 2 && industrialKeys.length ? industrialKeys : buildingKeys;
    for (const s of [-1, 1]) {
      if (district !== 0) {
        // retaining wall between track and street with graffiti
        for (const z of [-6, -18, -30]) {
          const w = take('wall'); w.position.set(s * 8.4, 0, z); w.rotation.y = s > 0 ? Math.PI : 0;
          const panel = w.children.find((c) => c.userData.graffiti) as THREE.Mesh;
          panel.material = graffiti[Math.floor(rng() * graffiti.length)];
          panel.visible = rng() < 0.75;
          add(w);
        }
      }
      let z = -1.5 - rng() * 2;
      while (z > -L + 1) {
        const k = keys[Math.floor(rng() * keys.length)];
        const b = take('b:' + k);
        const size = new THREE.Box3().setFromObject(b).getSize(_v);
        // rotate so the long facade faces the track; depth goes away from it
        b.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
        const width = size.x, depth = size.z;
        b.position.set(s * ((district === 0 ? 13.6 : 12.2) + depth / 2), district === 0 ? 1.0 : 0, z - width / 2);
        add(b);
        if (district === 1 && makers.awning && rng() < 0.5) {
          const a = take('awning'); a.rotation.y = b.rotation.y;
          a.position.set(s * 12.15, 0.0, z - width / 2); add(a);
        }
        z -= width + 0.15;
      }
      // distant skyline layer behind the street, sparse and tall
      if (rng() < 0.8) {
        const sk = buildingKeys.filter((k) => k.startsWith('sky:'));
        if (sk.length) {
          const b = take('b:' + sk[Math.floor(rng() * sk.length)]);
          b.rotation.y = rng() * Math.PI;
          b.position.set(s * (24 + rng() * 6), 0, -6 - rng() * (L - 12));
          add(b);
        }
      }
      if (district === 2 && makers.container) {
        for (let i = 0; i < 2; i++) { const c = take('container'); c.position.set(s * (9.6 + i * 0.1), 0, -8 - i * 14 - rng() * 4); c.rotation.y = Math.PI / 2; add(c); }
      }
    }
  }

  // ---------------- gameplay modules (pooled by World) ----------------
  function makeRamp(len: number, h: number): THREE.Group {
    // ramp rises from its near end (+z, ground) to the far end (-z, roof height)
    const g = new THREE.Group();
    const slope = Math.atan2(h, len);
    const hyp = Math.hypot(len, h);
    const deck = box(M.teal, 2.0, 0.18, hyp, 0, h / 2, 0);
    deck.rotation.x = slope; // tilt: far end (−z) up
    g.add(deck);
    // yellow chevron edges make the ramp read as "go up here"
    const edge = box(M.hazard, 0.16, 0.2, hyp, -1.0, h / 2 + 0.06, 0); edge.rotation.x = slope; g.add(edge);
    const edge2 = box(M.hazard, 0.16, 0.2, hyp, 1.0, h / 2 + 0.06, 0); edge2.rotation.x = slope; g.add(edge2);
    // support legs under the high end
    for (const x of [-0.8, 0.8]) g.add(box(M.steel, 0.12, h, 0.12, x, h / 2, -len / 2 + 0.2));
    g.add(box(M.steel, 1.8, 0.12, 0.12, 0, h - 0.15, -len / 2 + 0.2));
    return g;
  }

  function makeOverheadSign(y0: number, y1: number): THREE.Group {
    // station gantry board: hazard-striped lower edge at slide clearance
    const g = new THREE.Group();
    const hgt = y1 - y0;
    for (const x of [-1.12, 1.12]) g.add(box(M.tealDark, 0.14, y1, 0.14, x, y1 / 2, 0));
    g.add(box(M.cream, 2.3, hgt, 0.16, 0, y0 + hgt / 2, 0));
    const stripe = box(M.hazard, 2.32, 0.28, 0.18, 0, y0 + 0.14, 0);
    (stripe.material as THREE.MeshStandardMaterial).map!.repeat.set(6, 1);
    g.add(stripe);
    const arrow = new THREE.Mesh(G.plane, signMats[1]);
    arrow.scale.set(1.9, 0.6, 1); arrow.position.set(0, y0 + hgt * 0.62, 0.09); arrow.userData.sharedAsset = true;
    g.add(arrow);
    return g;
  }

  return {
    makeTrackBed, dress, release, makeRamp, makeOverheadSign,
    freeCount: () => Object.values(free).reduce((a, f) => a + f.length, 0),
  };
}

const _v = new THREE.Vector3();
