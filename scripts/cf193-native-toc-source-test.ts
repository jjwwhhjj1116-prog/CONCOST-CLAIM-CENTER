import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {inspectNativeTocNumbers,refreshConfirmedNativeTocNumbers} from '../apps/web/src/documents/report-native-toc';
import {readQaNativeEngine,matchReferenceSources} from './cf183-template-source-gate.mjs';

const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex'),sourceRoot=process.env.CF193_SOURCE_ROOT;
test('CF193 actual 011 refreshes the leading PageHide TOC numeral and preserves the other 363 native pages',{skip:!sourceRoot},async()=>{
  assert.ok(sourceRoot);const file=matchReferenceSources(sourceRoot,JSON.parse(readFileSync('docs/templates/reference-inventory.json','utf8'))).find(file=>file.fileId==='TPL-REF-011');assert.ok(file);assert.equal(file.extension,'.hwpx');
  const bytes=new Uint8Array(readFileSync(file.source)),originalHash=hash(bytes),approved=readQaNativeEngine(),module=await import(pathToFileURL(resolve(approved.root,'rhwp.js')).href);await module.default({module_or_path:approved.wasm});const Engine=module.HwpDocument;
  const inspection=await inspectNativeTocNumbers(bytes,'hwpx',[2],Engine);assert.equal(inspection.numberRows,6);assert.equal(inspection.candidates.length,5);assert.equal(inspection.excluded.filter(row=>row.reason==='TARGET_CONTROL').length,0);
  const entry=inspection.candidates.find(row=>row.section===0&&row.paragraph===40);assert.ok(entry);assert.equal(entry.offset,47);assert.equal(entry.oldText,'10');assert.equal(entry.newText,'11');assert.equal(entry.anchor.physicalPage,13);assert.equal(entry.anchor.printedPage,11);assert.equal(entry.anchor.paragraph,179);assert.ok(entry.anchor.cells);
  const before=new Engine(bytes);let pageHashes:string[],controls:string,fields:string,target:string;
  try{assert.equal(before.pageCount(),364);assert.equal(before.getSectionCount(),251);assert.deepEqual(JSON.parse(before.getControlTextPositions(0,40)),[0]);controls=hash(before.getControls());fields=hash(before.getFieldList());pageHashes=Array.from({length:364},(_,page)=>hash(before.renderPageSvgWithProfile(page,'print')));target=before.getTextRange(0,40,0,before.getParagraphLength(0,40));}finally{before.free();}
  const result=await refreshConfirmedNativeTocNumbers(bytes,'hwpx',originalHash,[entry],Engine);assert.equal(result.changes.length,1);assert.equal(result.changes[0].newText,'11');assert.equal(hash(bytes),originalHash);
  const after=new Engine(result.bytes);
  try{assert.equal(after.pageCount(),364);assert.equal(after.getSectionCount(),251);assert.ok(hash(after.getControls())===controls,'Control chain changed');assert.ok(hash(after.getFieldList())===fields,'Field chain changed');assert.deepEqual(JSON.parse(after.getControlTextPositions(0,40)),[0]);const expected=[...target].slice(0,47).join('')+'11';assert.ok(hash(after.getTextRange(0,40,0,after.getParagraphLength(0,40)))===hash(expected),'Anonymous target text changed outside the numeral');
    for(let page=0;page<364;page++){const current=hash(after.renderPageSvgWithProfile(page,'print'));if(page===1)assert.ok(current!==pageHashes[page],'Expected TOC numeral did not change');else assert.ok(current===pageHashes[page],`Anonymous non-target page ${page+1} changed`);}
  }finally{after.free();}
  assert.equal(hash(readFileSync(file.source)),originalHash,'Actual original file was changed');
});
