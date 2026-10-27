// Staged asset loading for METRO RUSH.
//
// Stages (reported to the loading screen):
//   1. 'download'  — fetch bytes for every 'opening' entry; progress is real
//                    (bytes received / Content-Length summed across files)
//   2. 'decode'    — parse GLB/glTF and decode audio buffers (indeterminate)
//   3. 'validate'  — required assets present, required clips present
//   4. 'prepare'   — handled by Game: build scene, compile shaders, warm up
//
// Fetched bytes are cached per URL in-memory for the page lifetime, so a
// retry after a failure only re-requests files that actually failed.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MANIFEST, REQUIRED_CLIPS, type AssetEntry } from './assetManifest';

export type LoadStage = 'download' | 'decode' | 'validate' | 'prepare' | 'ready' | 'error';

export interface LoadProgress {
  stage: LoadStage;
  /** 0..1 for 'download' (measured bytes); null when indeterminate */
  fraction: number | null;
  detail: string;
}

export interface AssetReportEntry {
  key: string; url: string; ok: boolean; required: boolean; stage: string;
  bytes?: number; ms?: number; error?: string;
  bounds?: number[]; clips?: string[]; meshes?: number;
}

export interface LoadedAssets {
  models: Map<string, THREE.Group>;
  runner: { root: THREE.Object3D; clips: THREE.AnimationClip[] } | null;
  audio: Map<string, ArrayBuffer>; // raw bytes; AudioSystem decodes on unlock
  report: AssetReportEntry[];
}

const bytesCache = new Map<string, ArrayBuffer>();
const parsedCache = new Map<string, { scene: THREE.Group; animations: THREE.AnimationClip[] }>();
const gltf = new GLTFLoader();

export class AssetLoadError extends Error {
  failures: AssetReportEntry[];
  constructor(failures: AssetReportEntry[]) {
    super('Required assets failed: ' + failures.map((f) => `${f.url} (${f.error})`).join('; '));
    this.failures = failures;
  }
}

async function fetchBytes(url: string, onBytes: (n: number) => void, signal?: AbortSignal): Promise<ArrayBuffer> {
  const hit = bytesCache.get(url);
  if (hit) { onBytes(hit.byteLength); return hit; }
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ctype = res.headers.get('content-type') ?? '';
  // Vite dev/preview serve index.html for unknown paths: treat as missing
  if (ctype.includes('text/html')) throw new Error('not found (got HTML)');
  let buf: ArrayBuffer;
  if (res.body && 'getReader' in res.body) {
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); n += value.byteLength; onBytes(value.byteLength);
    }
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.byteLength; }
    buf = out.buffer;
  } else {
    buf = await res.arrayBuffer();
    onBytes(buf.byteLength);
  }
  bytesCache.set(url, buf);
  return buf;
}

async function sizeOf(url: string): Promise<number> {
  if (bytesCache.has(url)) return bytesCache.get(url)!.byteLength;
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return +(r.headers.get('content-length') ?? 0);
  } catch { return 0; }
}

function parseModel(url: string, buf: ArrayBuffer) {
  const hit = parsedCache.get(url);
  if (hit) return Promise.resolve(hit);
  const base = url.slice(0, url.lastIndexOf('/') + 1);
  return new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) => {
    gltf.parse(buf, base, (g) => {
      const v = { scene: g.scene, animations: g.animations };
      parsedCache.set(url, v);
      resolve(v);
    }, (e) => reject(e instanceof Error ? e : new Error(String((e as any)?.message ?? e))));
  });
}

/** Tag shared meshes (never disposed by recycling) and set shadow flags. */
function tagShared(o: THREE.Object3D, cast = true) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = cast;
      m.receiveShadow = true;
      m.userData.sharedAsset = true;
      // Kenney textures are sRGB albedo atlases; GLTFLoader already marks
      // baseColor maps sRGB. Use nearest-ish filtering-free defaults but
      // ensure anisotropy for readable atlas texels at grazing angles.
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat?.map) mat.map.anisotropy = 4;
    }
  });
}

/** Wrap in a parent whose origin sits on the ground at the footprint center. */
export function normalized(src: THREE.Object3D, scale = 1): THREE.Group {
  const inner = src.clone(true);
  inner.scale.multiplyScalar(scale);
  inner.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(inner);
  inner.position.x -= (b.min.x + b.max.x) / 2;
  inner.position.z -= (b.min.z + b.max.z) / 2;
  inner.position.y -= b.min.y;
  const g = new THREE.Group();
  g.add(inner);
  return g;
}

export async function loadAssets(onProgress: (p: LoadProgress) => void, stage: 'opening' | 'later' = 'opening', signal?: AbortSignal): Promise<LoadedAssets> {
  const entries = MANIFEST.filter((e) => e.stage === stage);
  const report: AssetReportEntry[] = [];

  // ---- 1. download (real byte progress) ----
  onProgress({ stage: 'download', fraction: 0, detail: 'Measuring downloads' });
  const sizes = await Promise.all(entries.map((e) => sizeOf(e.url)));
  const total = Math.max(1, sizes.reduce((a, b) => a + b, 0));
  let got = 0;
  const tick = (n: number) => {
    got += n;
    onProgress({ stage: 'download', fraction: Math.min(1, got / total), detail: `Downloading assets · ${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB` });
  };
  const raw = new Map<string, ArrayBuffer>();
  // limited concurrency keeps progress smooth and avoids HTTP/1 head-of-line stalls
  const queue = [...entries];
  const workers = Array.from({ length: 6 }, async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      const t0 = performance.now();
      try {
        const buf = await fetchBytes(e.url, tick, signal);
        raw.set(e.key, buf);
        report.push({ key: e.key, url: e.url, ok: true, required: e.required, stage: e.stage, bytes: buf.byteLength, ms: Math.round(performance.now() - t0) });
      } catch (err) {
        if (signal?.aborted) throw err;
        report.push({ key: e.key, url: e.url, ok: false, required: e.required, stage: e.stage, error: String((err as Error).message ?? err) });
      }
    }
  });
  await Promise.all(workers);

  // ---- 2. decode ----
  onProgress({ stage: 'decode', fraction: null, detail: 'Decoding models and animations' });
  const models = new Map<string, THREE.Group>();
  const audio = new Map<string, ArrayBuffer>();
  let runner: LoadedAssets['runner'] = null;
  let runnerScene: THREE.Group | null = null;
  let clips: THREE.AnimationClip[] = [];
  for (const e of entries) {
    const buf = raw.get(e.key);
    const rep = report.find((r) => r.key === e.key)!;
    if (!buf) continue;
    try {
      if (e.kind === 'audio') { audio.set(e.key.slice(4), buf); continue; }
      const g = await parseModel(e.url, buf);
      if (e.kind === 'skinned') runnerScene = g.scene;
      else if (e.kind === 'clips') clips = g.animations;
      else {
        tagShared(g.scene);
        models.set(e.key, g.scene);
      }
      const b = new THREE.Box3().setFromObject(g.scene);
      const s = b.getSize(new THREE.Vector3());
      rep.bounds = [s.x, s.y, s.z].map((v) => +v.toFixed(3));
      let meshes = 0; g.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
      rep.meshes = meshes;
      if (g.animations.length) rep.clips = g.animations.map((c) => `${c.name} (${c.duration.toFixed(2)}s)`);
    } catch (err) {
      rep.ok = false;
      rep.error = 'decode failed: ' + String((err as Error).message ?? err);
    }
  }

  // ---- 3. validate ----
  onProgress({ stage: 'validate', fraction: null, detail: 'Validating assets' });
  if (stage === 'opening') {
    const runnerRep = report.find((r) => r.key === 'runner');
    const clipRep = report.find((r) => r.key === 'runnerClips');
    if (runnerScene && clips.length) {
      const missing = REQUIRED_CLIPS.filter((n) => !clips.some((c) => c.name === n));
      if (missing.length && clipRep) { clipRep.ok = false; clipRep.error = 'missing clips: ' + missing.join(', '); }
      // every clip track must resolve to a bone on the body (skeleton compatibility)
      const names = new Set<string>();
      runnerScene.traverse((o) => names.add(o.name));
      const unbound = new Set<string>();
      for (const c of clips) for (const t of c.tracks) { const n = t.name.split('.')[0]; if (!names.has(n)) unbound.add(n); }
      if (unbound.size && clipRep) { clipRep.ok = false; clipRep.error = 'clip tracks do not match runner skeleton: ' + [...unbound].slice(0, 6).join(', '); }
      if (clipRep?.ok && runnerRep?.ok) runner = { root: runnerScene, clips };
    }
  }
  const fatal = report.filter((r) => r.required && !r.ok);
  // also catch required entries that never produced a report row
  for (const e of entries) if (e.required && !report.some((r) => r.key === e.key)) fatal.push({ key: e.key, url: e.url, ok: false, required: true, stage: e.stage, error: 'not loaded' });
  if (import.meta.env.DEV) {
    // development-only asset report: loads, failures, clip names, bounds
    (window as any).__metroAssetReport = report;
    console.groupCollapsed(`[metro-rush] asset report (${stage}): ${report.filter((r) => r.ok).length} ok, ${report.filter((r) => !r.ok).length} failed`);
    console.table(report.map((r) => ({ key: r.key, ok: r.ok, req: r.required, kb: r.bytes ? Math.round(r.bytes / 1024) : '', bounds: r.bounds?.join(' x ') ?? '', clips: r.clips?.length ?? '', error: r.error ?? '' })));
    console.groupEnd();
  }
  for (const f of fatal) console.error(`[metro-rush] required asset failed: ${f.url} — ${f.error}`);
  if (fatal.length) throw new AssetLoadError(fatal);
  return { models, runner, audio, report };
}

/** Skeleton-aware clone for skinned characters. */
export function cloneSkinned(root: THREE.Object3D): THREE.Object3D {
  return SkeletonUtils.clone(root);
}
