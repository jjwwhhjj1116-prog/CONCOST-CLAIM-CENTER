// Compare deployed development assets with the exact locally staged release.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const base = new URL(process.argv[2]);
assert.equal(base.protocol, 'https:');
assert.match(base.hostname, /^concost-claim-center-development\./);
const dist = process.env.CF149_DIST ? pathToFileURL(resolve(process.env.CF149_DIST) + sep) : new URL('../apps/web/dist/', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function compare(path) {
  const local = readFileSync(new URL(path.replace(/^\//, ''), dist));
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  assert.equal(response.status, 200, path);
  const remote = Buffer.from(await response.arrayBuffer());
  assert.equal(remote.length, local.length, path);
  assert.equal(sha(remote), sha(local), path);
  return { path: path.slice(1), sha256: sha(remote), byteSize: remote.length };
}
let readiness;
for (const path of ['/health', '/readiness']) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15000), cache: 'no-store' });
  assert.equal(response.status, 200, path);
  if (path === '/readiness') readiness = await response.json();
}
const manifest = JSON.parse(readFileSync(new URL('rhwp/build-manifest.json', dist)));
assert.equal(manifest.wasm, 'bcc40a79bcd9be813cb231c6d8a0376b803ab8a6c189a09bcccabb8a249f3c44');
const html = readFileSync(new URL('index.html', dist), 'utf8');
const entryAssets = [...new Set([...html.matchAll(/"(\/assets\/[^"?]+)"/g)].map(match => match[1]))];
assert.ok(entryAssets.some(path => path.endsWith('.js')) && entryAssets.some(path => path.endsWith('.css')));
for (const file of manifest.files) {
  const path = '/rhwp/' + file.path;
  assert.equal(sha(readFileSync(new URL(path.replace(/^\//, ''), dist))), file.sha256);
}
function filesBelow(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink(), 'Release must not contain symlinks');
    const path = prefix + entry.name;
    return entry.isDirectory() ? filesBelow(new URL(entry.name + '/', directory), path + '/') : [path];
  });
}
const paths = filesBelow(dist).sort();
const compared = await Promise.all(paths.map(path => compare('/' + path)));
const canonical = sha(Buffer.from(compared.map(file => file.path + '\t' + file.sha256 + '\n').join('')));
console.log(JSON.stringify({ base: base.origin, health: 200, readiness: 200, googleDriveConnected: readiness?.googleDriveConnected === true, entryAssetsCompared: entryAssets.length, runtimeFilesCompared: manifest.files.length, allFilesCompared: compared.length, totalBytes: compared.reduce((sum, file) => sum + file.byteSize, 0), canonical, wasm: manifest.wasm, pass: true }));
