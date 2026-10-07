import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {inspectNativeTocNumbers,refreshConfirmedNativeTocNumbers} from '../apps/web/src/documents/report-native-toc';
import {readQaNativeEngine,matchReferenceSources,exportNativeWithReport} from './cf183-template-source-gate.mjs';

// Explicit local originals only; no names/content, files, live drafts or network writes.
const sourceRoot=process.env.CF191_SOURCE_ROOT, hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
test('CF191 actual 017 private clone restores one wrong TOC numeral with two native reopens and 47 exact original pages',{skip:!sourceRoot},async()=>{
  assert.ok(sourceRoot);
  const files=matchReferenceSources(sourceRoot,JSON.parse(readFileSync('docs/templates/reference-inventory.json','utf8'))),file=files.find((file:any)=>file.fileId==='TPL-REF-017');assert.ok(file);assert.equal(file.extension,'.hwpx');
  const original=new Uint8Array(readFileSync(file.source)),originalHash=hash(original),approved=readQaNativeEngine(),module=await import(pathToFileURL(resolve(approved.root,'rhwp.js')).href);await module.default({module_or_path:approved.wasm});const Engine=module.HwpDocument;
  const baseline=await inspectNativeTocNumbers(original,'hwpx',[2],Engine);assert.equal(baseline.unchanged,4);assert.equal(baseline.candidates.length,0);assert.equal(baseline.numberRows,5);assert.equal(baseline.excluded.filter(row=>row.reason==='NO_PAGE_NUMBER').length,5);assert.equal(baseline.excluded.filter(row=>row.reason==='TITLE_NOT_FOUND').length,1);
  const seed=new Engine(original);let wrong:Uint8Array;
  try{
    assert.equal(seed.pageCount(),47);const text=seed.getTextRange(0,24,0,seed.getParagraphLength(0,24)),match=/([0-9]{2})( *)$/u.exec(text);assert.ok(match,'Anonymous expected numeric span');
    const offset=[...text].length-match[1].length-match[2].length,runs=JSON.parse(seed.getCharShapeRuns(0,24,offset,offset+2)),style=runs[0].charShapeId;
    assert.ok(JSON.parse(seed.replaceText(0,24,offset,2,'09')).ok===true,'Private clone mutation failed');assert.ok(JSON.parse(seed.setCharShapeId(0,24,offset,offset+2,style)).ok===true,'Private clone style restoration failed');
    const exported=exportNativeWithReport(seed,'hwpx');assert.equal(exported.report.count,0);assert.equal(exported.report.lossRecords,0);wrong=new Uint8Array(exported.bytes);
  }finally{seed.free();}
  const inspection=await inspectNativeTocNumbers(wrong,'hwpx',[2],Engine);assert.equal(inspection.candidates.length,1);assert.equal(inspection.unchanged,3);const candidate=inspection.candidates[0];assert.equal(candidate.paragraph,24);assert.equal(candidate.oldText,'09');assert.equal(candidate.newText,'01');assert.equal(candidate.anchor.physicalPage,3);assert.equal(candidate.anchor.printedPage,1);assert.ok(candidate.anchor.cells);
  const restored=await refreshConfirmedNativeTocNumbers(wrong,'hwpx',hash(wrong),[candidate],Engine);assert.equal(restored.changes.length,1);assert.equal(hash(wrong),inspection.sourceSha256,'Private clone input unchanged');
  const before=new Engine(original),after=new Engine(restored.bytes);
  try{
    assert.equal(after.pageCount(),47);assert.ok(hash(after.getTextRange(0,24,0,after.getParagraphLength(0,24)))===hash(before.getTextRange(0,24,0,before.getParagraphLength(0,24))),'Restored target text differs from original');
    for(let page=0;page<47;page++)assert.ok(hash(after.renderPageSvgWithProfile(page,'print'))===hash(before.renderPageSvgWithProfile(page,'print')),`Anonymous original page ${page+1} changed`);
    const checked=await inspectNativeTocNumbers(restored.bytes,'hwpx',[2],Engine);assert.equal(checked.unchanged,4);assert.equal(checked.candidates.length,0);
  }finally{before.free();after.free();}
  assert.equal(hash(readFileSync(file.source)),originalHash,'Actual original file must remain unchanged');
});
test('CF191 actual 025 has no supported original TOC rows and is never synthesized from body tables',{skip:!sourceRoot},async()=>{
  assert.ok(sourceRoot);
  const files=matchReferenceSources(sourceRoot,JSON.parse(readFileSync('docs/templates/reference-inventory.json','utf8'))),file=files.find((file:any)=>file.fileId==='TPL-REF-025');assert.ok(file);assert.equal(file.extension,'.hwpx');
  const bytes=new Uint8Array(readFileSync(file.source)),before=hash(bytes),approved=readQaNativeEngine(),module=await import(pathToFileURL(resolve(approved.root,'rhwp.js')).href);await module.default({module_or_path:approved.wasm});
  const inspected=await inspectNativeTocNumbers(bytes,'hwpx',[1,2,3,4],module.HwpDocument);assert.equal(inspected.numberRows,0);assert.equal(inspected.candidates.length,0);assert.equal(inspected.unchanged,0);assert.deepEqual(inspected.excluded,[]);assert.equal(hash(readFileSync(file.source)),before);
});
