// Real local runtime references, not source-pack assumptions. Node 24 strips
// the manifest's TypeScript types; no extra build dependency is required.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { MANIFEST, REQUIRED_CLIPS } from '../src/game/assetManifest.ts';
const publicRoot = path.resolve('public');
const keys = new Set();
let bytes = 0;
function modelJson(buffer, name) {
  if (name.endsWith('.gltf')) return JSON.parse(buffer.toString('utf8'));
  assert.equal(buffer.readUInt32LE(0), 0x46546c67, `GLB magic ${name}`);
  assert.equal(buffer.readUInt32LE(4), 2, `GLB version ${name}`);
  assert.equal(buffer.readUInt32LE(8), buffer.length, `GLB byte length ${name}`);
  const length = buffer.readUInt32LE(12);
  assert.equal(buffer.readUInt32LE(16), 0x4e4f534a, `GLB JSON chunk ${name}`);
  return JSON.parse(buffer.subarray(20, 20 + length).toString('utf8').trim());
}
for (const entry of MANIFEST) {
  assert.ok(!keys.has(entry.key), `Duplicate runtime key ${entry.key}`); keys.add(entry.key);
  assert.ok(!/^https?:|^\/|\.\./.test(entry.url), `Only local relative assets: ${entry.url}`);
  const file = path.resolve(publicRoot, entry.url);
  assert.ok(file.startsWith(publicRoot + path.sep));
  const buffer = await fs.readFile(file); bytes += buffer.length;
  assert.ok(buffer.length > 0, `Empty runtime file: ${entry.url}`);
  if (entry.kind !== 'audio') {
    const gltf = modelJson(buffer, entry.url);
    for (const reference of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) {
      if (!reference.uri || reference.uri.startsWith('data:')) continue;
      assert.ok(!/^(https?:|\/)/.test(reference.uri), `Remote model dependency ${entry.url}`);
      const dependency = path.resolve(path.dirname(file), decodeURIComponent(reference.uri));
      assert.ok(dependency.startsWith(publicRoot + path.sep), 'Model dependency escapes public root');
      await fs.access(dependency);
    }
    if (entry.key === 'runnerClips') {
      const names = new Set((gltf.animations ?? []).map(clip => clip.name));
      for (const name of REQUIRED_CLIPS) assert.ok(names.has(name), `Missing required animation ${name}`);
    }
    if (entry.kind === 'skinned') assert.ok(gltf.skins?.length > 0, 'Runner must have a real skeleton');
  } else {
    assert.equal(buffer.toString('ascii', 0, 4), 'RIFF', `Expected WAV ${entry.url}`);
    assert.equal(buffer.toString('ascii', 8, 12), 'WAVE', `Expected WAV payload ${entry.url}`);
  }
}
for (const name of ['quaternius-universal-base-characters.txt', 'quaternius-universal-animation-library-1.txt', 'quaternius-universal-animation-library-2.txt', 'current-audio-and-fonts.txt', 'kenney-train-kit.txt', 'kenney-platformer-kit.txt', 'kenney_city-kit-roads-LICENSE.txt', 'kenney_city-kit-industrial_2.0-LICENSE.txt']) await fs.access(path.join(publicRoot, 'assets/licenses', name));
for (const font of ['KenneyFuture.ttf', 'KenneyFutureNarrow.ttf']) await fs.access(path.join('src/fonts', font));
console.log(`Runtime audit passed: ${MANIFEST.length} concrete asset entries, ${REQUIRED_CLIPS.length} required animation clips, ${(bytes / 1048576).toFixed(2)} MB referenced.`);
