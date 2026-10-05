// Local, sequential diagnostic. Never writes the supplied customer document.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [engineDirectory, sourceFile] = process.argv.slice(2);
assert.ok(engineDirectory && sourceFile, 'Usage: node scripts/cf149-hwpx-edit-roundtrip.mjs <engine pkg directory> <source.hwpx>');
const { default: init, HwpDocument } = await import(pathToFileURL(resolve(engineDirectory, 'rhwp.js')).href);
await init({ module_or_path: readFileSync(resolve(engineDirectory, 'rhwp_bg.wasm')) });
const source = readFileSync(sourceFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHash = hash(source);
const expectedPages = Number(process.env.CF149_EXPECTED_PAGES || 0);
const outputFormat = process.env.CF149_EXPORT_FORMAT === 'hwp' ? 'hwp' : 'hwpx';
const exportBytes = document => outputFormat === 'hwp' ? document.exportHwp() : document.exportHwpx();
console.log(JSON.stringify({ sourceSha256: sourceHash, engineSha256: hash(readFileSync(resolve(engineDirectory, 'rhwp_bg.wasm'))), outputFormat }));
let failures = 0;
const results = [];
const cases = process.env.CF149_NO_EDIT_ONLY === '1' ? [''] : process.env.CF149_LONG_ONLY === '1' ? ['CF148_EDIT_20260923'] : ['', 'TEST', 'CF148_EDIT_20260923'];
for (const text of cases) {
  const document = new HwpDocument(source);
  let reopened;
  let reopenedAgain;
  try {
    let target = { secIdx: 0, paraIdx: 0, charStart: 0 };
    if (text && process.env.CF149_VISIBLE_TARGET === '1') {
      let visible, visiblePage = -1;
      for (let page = 0; page < Math.min(document.pageCount(), 10) && !visible; page++) {
        visible = JSON.parse(document.getPageTextLayout(page)).runs.find(run => Number.isInteger(run.secIdx) && Number.isInteger(run.paraIdx) && Number.isInteger(run.charStart) && !run.cellPath?.length && run.parentParaIdx === undefined && run.text?.trim());
        if (visible) visiblePage = page;
      }
      assert.ok(visible, 'First ten pages have no directly editable body text run');
      target = { secIdx: visible.secIdx, paraIdx: visible.paraIdx, charStart: visible.charStart };
      console.log(JSON.stringify({ visibleTarget: target, visiblePage }));
    }
    if (text) assert.equal(JSON.parse(document.insertText(target.secIdx, target.paraIdx, target.charStart, text)).ok, true);
    reopened = new HwpDocument(exportBytes(document));
    const count = document.pageCount();
    if (expectedPages) assert.equal(count, expectedPages);
    const markerPage = (doc, marker) => marker ? Array.from({ length: doc.pageCount() }, (_, page) => page).find(page => doc.getPageText(page).includes(marker)) ?? -1 : -1;
    const markerPageBefore = markerPage(document, text), markerPageAfter = markerPage(reopened, text);
    const inserted = !text || markerPageBefore >= 0;
    const retained = !text || markerPageAfter >= 0;
    const differentPages = [];
    reopenedAgain = new HwpDocument(exportBytes(reopened));
    const secondSaveDifferentPages = [];
    for (let page = 0; page < Math.min(count, reopened.pageCount()); page++) {
      if (document.renderPageSvgWithProfile(page, 'print') !== reopened.renderPageSvgWithProfile(page, 'print')) differentPages.push(page + 1);
      if (page < reopenedAgain.pageCount() && reopened.renderPageSvgWithProfile(page, 'print') !== reopenedAgain.renderPageSvgWithProfile(page, 'print')) secondSaveDifferentPages.push(page + 1);
    }
    const pass = inserted && retained && count === reopened.pageCount() && count === reopenedAgain.pageCount() && !differentPages.length && !secondSaveDifferentPages.length;
    const result = { inputLength: text.length, inserted, retained, markerPageBefore, markerPageAfter, pagesBefore: count, pagesAfter: reopened.pageCount(), differentPages, secondSaveDifferentPages, pass };
    if (text && !inserted && process.env.CF149_DIAGNOSE === '1') {
      const firstLength = document.getParagraphLength(0, 0);
      console.log(JSON.stringify({ firstParagraphLength: firstLength,
        markerInFirstParagraph: document.getTextRange(0, 0, 0, Math.min(firstLength, 128)).includes(text),
        firstParagraphPage: document.getPageOfPosition(0, 0) }));
    }
    if (process.env.CF149_DIAGNOSE === '1' && differentPages.length) {
      for (const page of differentPages) {
        const index = page - 1;
        const beforeText = document.getPageText(index), afterText = reopened.getPageText(index);
        const beforeSvg = document.renderPageSvgWithProfile(index, 'print'), afterSvg = reopened.renderPageSvgWithProfile(index, 'print');
        const countTag = (svg, tag) => (svg.match(new RegExp(`<${tag}(?:[\\s>])`, 'g')) ?? []).length;
        console.log(JSON.stringify({ page, beforeTextLength: beforeText.length, afterTextLength: afterText.length,
          textShaEqual: hash(beforeText) === hash(afterText), beforeSvgLength: beforeSvg.length, afterSvgLength: afterSvg.length,
          tags: Object.fromEntries(['text', 'image', 'path', 'rect', 'clipPath'].map(tag => [tag, [countTag(beforeSvg, tag), countTag(afterSvg, tag)]])) }));
      }
    }
    results.push(result);
    console.log(JSON.stringify(result));
    if (!pass) failures++;
  } finally {
    reopenedAgain?.free();
    reopened?.free();
    document.free();
  }
}
assert.equal(hash(readFileSync(sourceFile)), sourceHash, 'Original file must remain unchanged');
if (process.env.CF149_RESULT_FILE) writeFileSync(process.env.CF149_RESULT_FILE, JSON.stringify({ sourceSha256: sourceHash, engineSha256: hash(readFileSync(resolve(engineDirectory, 'rhwp_bg.wasm'))), originalUnchanged: true, results }, null, 2));
process.exitCode = failures ? 1 : 0;
