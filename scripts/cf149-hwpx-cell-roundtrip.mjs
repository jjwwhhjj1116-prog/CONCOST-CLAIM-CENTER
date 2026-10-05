// Read-only source check for a real table-cell edit through the release engine.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [pkg, sourceFile] = process.argv.slice(2);
assert.ok(pkg && sourceFile);
const { default: init, HwpDocument } = await import(pathToFileURL(resolve(pkg, 'rhwp.js')).href);
await init({ module_or_path: readFileSync(resolve(pkg, 'rhwp_bg.wasm')) });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = readFileSync(sourceFile);
const sourceHash = hash(source);
const insertedText = 'CF149'.repeat(Number(process.env.CF149_CELL_REPEAT || 1));
const doc = new HwpDocument(source);
let reopened;
try {
  let target;
  for (let s = 0; s < doc.getSectionCount() && !target; s++) {
    for (let p = 0; p < doc.getParagraphCount(s) && !target; p++) {
      for (let c = 0; c < 4; c++) {
        try {
          const size = JSON.parse(doc.getTableDimensions(s, p, c));
          if (size && doc.getCellParagraphCount(s, p, c, 0) > 0) { target = { s, p, c }; break; }
        } catch { /* This control is not a table. */ }
      }
    }
  }
  assert.ok(target, 'No editable table cell found');
  const { s, p, c } = target;
  const beforePages = doc.pageCount();
  assert.equal(JSON.parse(doc.insertTextInCell(s, p, c, 0, 0, 0, insertedText)).ok, true);
  reopened = new HwpDocument(doc.exportHwpx());
  assert.ok(reopened.getTextInCell(s, p, c, 0, 0, 0, insertedText.length + 30).includes(insertedText));
  assert.equal(reopened.pageCount(), doc.pageCount());
  const differentPages = [];
  for (let page = 0; page < doc.pageCount(); page++) {
    if (doc.renderPageSvgWithProfile(page, 'print') !== reopened.renderPageSvgWithProfile(page, 'print')) differentPages.push(page + 1);
  }
  assert.deepEqual(differentPages, []);
  assert.equal(hash(readFileSync(sourceFile)), sourceHash);
  console.log(JSON.stringify({ sourceSha256: sourceHash, table: target, inputLength: insertedText.length, beforePages, afterPages: reopened.pageCount(), differentPages, pass: true }));
} finally { reopened?.free(); doc.free(); }
