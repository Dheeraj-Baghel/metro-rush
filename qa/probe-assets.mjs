// Prints per-model POSITION bounds (mesh-local, unskinned) and animation
// track info so loader normalization is based on measured data.
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

function readGltfJson(file) {
  const buf = readFileSync(file);
  if (file.endsWith('.gltf')) return JSON.parse(buf.toString('utf8'));
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
}

const root = 'public/assets/b';
for (const dir of readdirSync(root)) {
  if (dir === 'audio') continue;
  for (const f of readdirSync(join(root, dir))) {
    if (!/\.(glb|gltf)$/.test(f)) continue;
    const j = readGltfJson(join(root, dir, f));
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const m of j.meshes ?? []) for (const p of m.primitives) {
      const a = j.accessors[p.attributes.POSITION];
      if (!a.min) continue;
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], a.min[i]); max[i] = Math.max(max[i], a.max[i]); }
    }
    const scales = (j.nodes ?? []).filter((n) => n.scale).map((n) => n.scale.map((v) => +v.toFixed(3)).join(','));
    console.log(`${dir}/${f}: size=${max.map((v, i) => (v - min[i]).toFixed(2)).join(' x ')} min=${min.map((v) => v.toFixed(2))} max=${max.map((v) => v.toFixed(2))} nodeScales=${[...new Set(scales)].slice(0, 3).join(' | ')}`);
    for (const an of j.animations ?? []) {
      if (!['Run', 'Idle', 'Roll', 'Death', 'HitRecieve', 'Run_Left'].includes(an.name)) continue;
      const tr = an.channels.filter((c) => c.target.path === 'translation').map((c) => j.nodes[c.target.node].name);
      const inp = j.accessors[an.samplers[0].input];
      console.log(`   anim ${an.name}: dur=${inp.max[0].toFixed(2)}s translationTracks=${tr.join(',')}`);
    }
  }
}
