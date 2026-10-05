// Local WASM regression only. Originals remain outside the repository and are never uploaded.
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const [pkgPath, manifestPath, outputPath] = process.argv.slice(2);
const root = process.env.CF146_SOURCE_ROOT;
if (!root || !pkgPath || !manifestPath || !outputPath) throw Error('Set CF146_SOURCE_ROOT; pass local pkg, reference manifest, output directory.');
const expected = JSON.parse(process.env.CF146_EXPECTED_COUNTS || '{}');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const files = manifest.results.filter(item => Object.hasOwn(expected, item.id));
if (!files.length) throw Error('No expected reference documents selected.');
if (new Set(files.map(item => item.id)).size !== files.length || files.length !== Object.keys(expected).length) throw Error('Expected documents must each match exactly one manifest entry.');
if (files.some(item => !/^[\w-]+$/.test(item.id) || !Number.isInteger(expected[item.id]) || expected[item.id] < 1)) throw Error('Invalid document id or expected page count.');
const {default: init, HwpDocument} = await import(pathToFileURL(path.resolve(pkgPath, 'rhwp.js')));
await init({module_or_path: readFileSync(path.resolve(pkgPath, 'rhwp_bg.wasm'))});
mkdirSync(outputPath, {recursive: true});
const results = [];
for (const item of files) {
  const source = path.resolve(root, item.relativePath);
  const relative = path.relative(path.resolve(root), source);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Reference escapes source root.');
  const bytes = readFileSync(source);
  const hash = data => createHash('sha256').update(data).digest('hex');
  if (hash(bytes) !== item.sha256) throw Error('Reference changed since baseline.');
  const doc = new HwpDocument(bytes);
  try {
    const count = doc.pageCount();
    for (let p = 0; p < count; p++) {
      writeFileSync(path.join(outputPath, `${item.id}-page-${p + 1}.svg`), doc.renderPageSvg(p));
    }
    const unchanged = hash(readFileSync(source)) === item.sha256;
    const result = {id: item.id, pageCount: count, expected: expected[item.id], unchanged, countMatches: count === expected[item.id]};
    results.push(result);
    console.log(JSON.stringify(result));
    if (!unchanged || !result.countMatches) process.exitCode = 1;
  } finally { doc.free(); }
}
writeFileSync(path.join(outputPath, 'regression.json'), JSON.stringify({note: 'Page-count gate only; visual fidelity requires separate review.', results}, null, 2));
