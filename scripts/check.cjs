const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const base = path.resolve(__dirname, '../extension');
const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json')));
const files = ['background.js', 'engine-client.js', 'offscreen.js', 'native-engine.js', 'wasm-engine.js', 'pikafish-worker.js', 'page-bridge.js', 'site-adapter.js', 'content.js'];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(base, file)], { encoding: 'utf8' });
  if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
}
for (const file of ['offscreen.html', 'engine/stockfish.js', 'engine/stockfish.wasm', 'engine/stockfish.worker.js', 'icons/icon32.png', 'icons/icon128.png']) {
  if (!fs.existsSync(path.join(base, file))) throw new Error(`Missing ${file}`);
}
for (const [file, expected] of Object.entries({
  'engine/pikafish/pikafish.js':'17bc398028450c4c56df27812324cca8e5af9e2c86662f4a0d7f5b328270df3a',
  'engine/pikafish/pikafish.wasm':'b437f89ca16a1ff9181878813d1991f60b22067dca6b3feb79a26033224a83b1',
  'engine/pikafish/pikafish.nnue':'7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e',
})) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(base,file))).digest('hex');
  if (actual !== expected) throw new Error(`Pikafish asset integrity mismatch: ${file}`);
}
if (manifest.manifest_version !== 3) throw new Error('Expected MV3');
console.log('Extension syntax, manifest and packaged runtime assets verified.');
