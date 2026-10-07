import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createNativeHwp } from '../apps/web/src/documents/editable-hwp-export';
import type { NativeHwpEngine } from '../apps/web/src/documents/editable-hwp-export';
import {zipSync,unzipSync,strFromU8,strToU8} from '../apps/web/node_modules/fflate';
import { refreshConfirmedNativeTocNumbers, inspectNativeTocNumbers, parseNativeTocPages, type ConfirmedNativeTocNumber } from '../apps/web/src/documents/report-native-toc';
import { readQaNativeEngine } from './cf183-template-source-gate.mjs';

const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const approved = readQaNativeEngine();
const engine = import(pathToFileURL(resolve(approved.root, 'rhwp.js')).href).then(async module => {await module.default({module_or_path: approved.wasm}); return module.HwpDocument;});
async function fixture(format: 'hwp' | 'hwpx', printedPage = 23, digits = 1, oldText = '9', bodyHtml='<p>😀 대상 항목</p><p>확정 금액 123,456원 · 보존 본문</p>',tab=false) {
  const Engine = await engine;
  const pages = [
    {html:`<p>목 차</p><p>😀 대상 항목 ........ <strong>${oldText}</strong></p>`,text:`목 차😀 대상 항목 ........ ${oldText}`},
    {html:bodyHtml,text:bodyHtml.replace(/<[^>]*>/gu,'')},
  ].map(page => ({...page,tables:0,images:0,width:794,height:1123,margins:{top:40,right:40,bottom:40,left:40}}));
  const doc = new Engine(createNativeHwp(pages, Engine));
  try {
    if(tab){const text=doc.getTextRange(0,1,0,doc.getParagraphLength(0,1));const prefix=[...text.slice(0,text.indexOf('........'))].length;assert.equal(JSON.parse(doc.replaceText(0,1,prefix,8,'\t')).ok,true);}
    const anchorLength = doc.getParagraphLength(1,0);
    assert.equal(JSON.parse(doc.insertNewNumber(1,0,anchorLength,printedPage)).ok,true);
    const bytes = format === 'hwp' ? doc.exportHwp() : doc.exportHwpx();
    const loaded = new Engine(bytes);
    try {
      const text = loaded.getTextRange(0,1,0,loaded.getParagraphLength(0,1));
      const anchorText = loaded.getTextRange(1,0,0,loaded.getParagraphLength(1,0));
      const position=JSON.parse(loaded.getPageOfPosition(1,0));assert.equal(position.ok,true);const page=position.page, info=JSON.parse(loaded.getPageInfo(page));
      assert.equal(page,1); assert.equal(info.pageNumber,printedPage);
      const entry:ConfirmedNativeTocNumber={section:0,paragraph:1,offset:[...text].length-oldText.length,oldText,paragraphSha256:hash(text),decimalDigits:digits,tocPhysicalPage:1,anchor:{section:1,paragraph:0,paragraphSha256:hash(anchorText),physicalPage:page+1,printedPage}};
      return {Engine,bytes:new Uint8Array(bytes),entry,text};
    } finally {loaded.free();}
  } finally {doc.free();}
}
test('CF190 approved native engine refreshes only the confirmed numeral using printed restart, not physical order', async () => {
  for(const format of ['hwp','hwpx'] as const){
    const {Engine,bytes,entry,text}=await fixture(format), originalHash=hash(bytes);
    const result=await refreshConfirmedNativeTocNumbers(bytes,format,originalHash,[entry],Engine);
    assert.equal(hash(bytes),originalHash);assert.equal(result.changes.length,1);assert.equal(result.changes[0].newText,'23');assert.equal(result.changes[0].physicalPage,2);
    const reopened=new Engine(result.bytes);
    try{assert.equal(reopened.getTextRange(0,1,0,reopened.getParagraphLength(0,1)),[...text].slice(0,entry.offset).join('')+'23');assert.equal(JSON.parse(reopened.getPageInfo(1)).pageNumber,23);assert.match(reopened.getTextFileText(),/123,456원/u);}finally{reopened.free();}
  }
});
test('CF190 native TAB markup is retained and changes to that markup or a field target are rejected',async()=>{
  const {Engine,bytes,entry}=await fixture('hwpx',23,1,'9',undefined,true);
  const before=strFromU8(unzipSync(bytes)['Contents/section0.xml']);assert.match(before,/<hp:tab\b/u);
  const good=await refreshConfirmedNativeTocNumbers(bytes,'hwpx',hash(bytes),[entry],Engine);
  const after=strFromU8(unzipSync(good.bytes)['Contents/section0.xml']);assert.deepEqual([...after.matchAll(/<hp:tab\b[^>]*\/>/gu)].map(match=>match[0]),[...before.matchAll(/<hp:tab\b[^>]*\/>/gu)].map(match=>match[0]));
  class BadTab extends Engine{
    changed=false;
    setCharShapeId(...args:any[]){const result=super.setCharShapeId(...args);this.changed=true;return result;}
    exportHwpxWithReport(){const result=super.exportHwpxWithReport();if(!this.changed)return result;const loss=result.contentLoss(),archive=unzipSync(result.takeBytes());result.free();let xml=strFromU8(archive['Contents/section0.xml']);assert.match(xml,/<hp:tab\b/u);xml=xml.replace(/<hp:tab\b/u,'<hp:tab cf190Injected="true"');archive['Contents/section0.xml']=strToU8(xml);return{contentLoss:()=>loss,takeBytes:()=>zipSync(archive),free:()=>{}};}
  }
  await assert.rejects(refreshConfirmedNativeTocNumbers(bytes,'hwpx',hash(bytes),[entry],BadTab as unknown as NativeHwpEngine));
  const field=new Engine(bytes);let fieldBytes:Uint8Array;
  try{const inserted=JSON.parse(field.insertClickHereField(0,1,0,'입력','검수','합성 필드',true));assert.equal(inserted.ok,true);fieldBytes=field.exportHwpx();}finally{field.free();}
  const withField=new Engine(fieldBytes);try{
    const text=withField.getTextRange(0,1,0,withField.getParagraphLength(0,1));assert.match(strFromU8(unzipSync(fieldBytes)['Contents/section0.xml']),/fieldBegin/u);
    await assert.rejects(refreshConfirmedNativeTocNumbers(fieldBytes,'hwpx',hash(fieldBytes),[{...entry,offset:[...text].length-1,paragraphSha256:hash(text)}],Engine));
  }finally{withField.free();}
});
test('CF190 padding, max native folio, no-op bytes and actual format contract are preserved', async()=>{
  for(const format of ['hwp','hwpx'] as const){
    for(const [number,digits,oldText,expected] of [[23,3,'009','023'],[65535,1,'9','65535']] as const){
      const {Engine,bytes,entry}=await fixture(format,number,digits,oldText);
      const result=await refreshConfirmedNativeTocNumbers(bytes,format,hash(bytes),[entry],Engine);assert.equal(result.changes[0].newText,expected);
    }
    const {Engine,bytes,entry}=await fixture(format,9), noop=await refreshConfirmedNativeTocNumbers(bytes,format,hash(bytes),[entry],Engine);
    assert.deepEqual(noop.changes,[]);assert.deepEqual(noop.bytes,bytes);
    await assert.rejects(refreshConfirmedNativeTocNumbers(bytes,format==='hwp'?'hwpx':'hwp',hash(bytes),[entry],Engine));
    class BadNumber extends Engine{getPageInfo(page:number){const info=JSON.parse(super.getPageInfo(page));return JSON.stringify({...info,pageNumber:65536});}}
    await assert.rejects(refreshConfirmedNativeTocNumbers(bytes,format,hash(bytes),[{...entry,anchor:{...entry.anchor,printedPage:65536}}],BadNumber as unknown as NativeHwpEngine));
  }
});
test('CF190 read-only inspector proposes unique literal titles outside chosen physical TOC pages',async()=>{
  const {Engine,bytes}=await fixture('hwpx',23,3,'009'), before=hash(bytes);
  const inspected=await inspectNativeTocNumbers(bytes,'hwpx',parseNativeTocPages('1',2),Engine);
  assert.equal(inspected.sourceSha256,before);assert.equal(inspected.candidates.length,1);assert.equal(inspected.candidates[0].title,'😀 대상 항목');assert.equal(inspected.candidates[0].newText,'023');assert.equal(inspected.candidates[0].anchor.physicalPage,2);assert.equal(inspected.unsupported,0);
  const candidate=await refreshConfirmedNativeTocNumbers(bytes,'hwpx',before,inspected.candidates,Engine);assert.equal(candidate.changes.length,1);assert.equal(hash(bytes),before);
  const ambiguous=await fixture('hwpx',23,1,'9','<p>😀 대상 항목</p><p>😀 대상 항목</p>');
  const rejected=await inspectNativeTocNumbers(ambiguous.bytes,'hwpx',[1],Engine);assert.equal(rejected.candidates.length,0);assert.equal(rejected.unsupported,1);
  const noMatch=await fixture('hwpx',23,1,'9','<p>다른 제목</p>');assert.equal((await inspectNativeTocNumbers(noMatch.bytes,'hwpx',[1],Engine)).candidates.length,0);
  for(const input of ['', '0','2-1','1-3','1,2','x','1-101']) assert.throws(()=>parseNativeTocPages(input,2));
  assert.deepEqual(parseNativeTocPages(' 2-4, 4,6 ',8),[2,3,4,6]);
  const empty=await fixture('hwpx',23,1,'9','<p>😀 대상 항목</p><p></p><p>보존 본문</p>');
  class NoEmptyPage extends Engine{getPageOfPosition(section:number,para:number){if(!super.getParagraphLength(section,para))throw Error('Synthetic unrendered empty paragraph');return super.getPageOfPosition(section,para);}}
  assert.equal((await inspectNativeTocNumbers(empty.bytes,'hwpx',[1],NoEmptyPage as unknown as NativeHwpEngine)).candidates.length,1,'Empty unrendered paragraphs in real originals cannot abort the complete scan');
});
test('CF190 original hash, exact scalar offset, paragraph/anchor proof and unique target are required', async () => {
  const {Engine,bytes,entry}=await fixture('hwpx'), originalHash=hash(bytes);
  for(const bad of [ {...entry,offset:entry.offset+1}, {...entry,tocPhysicalPage:2}, {...entry,oldText:'8'}, {...entry,paragraphSha256:'0'.repeat(64)}, {...entry,anchor:{...entry.anchor,paragraphSha256:'0'.repeat(64)}}, {...entry,anchor:{...entry.anchor,physicalPage:1}}, {...entry,anchor:{...entry.anchor,printedPage:2}} ]) await assert.rejects(refreshConfirmedNativeTocNumbers(bytes,'hwpx',originalHash,[bad],Engine));
  await assert.rejects(refreshConfirmedNativeTocNumbers(bytes,'hwpx','0'.repeat(64),[entry],Engine));
  await assert.rejects(refreshConfirmedNativeTocNumbers(bytes,'hwpx',originalHash,[entry,entry],Engine));
  assert.equal(hash(bytes),originalHash);
});
test('CF190 confirmed zero padding is explicit and an invalid format is rejected', async () => {
  const {Engine,bytes,entry}=await fixture('hwpx'), originalHash=hash(bytes);
  for(const digits of [0,-1,1.5,10]) await assert.rejects(refreshConfirmedNativeTocNumbers(bytes,'hwpx',originalHash,[{...entry,decimalDigits:digits}],Engine));
  await assert.rejects(refreshConfirmedNativeTocNumbers(bytes,'hwpx',originalHash,[{...entry,decimalDigits:2}],Engine),'Old 9 cannot be silently interpreted as a zero-padded format');
});
test('CF190 numeric-only claims cannot hide another text or layout mutation in the native candidate', async () => {
  const {Engine,bytes,entry}=await fixture('hwpx'), originalHash=hash(bytes);
  class BadText extends Engine{setCharShapeId(...args:any[]){const result=super.setCharShapeId(...args);super.replaceText(0,1,0,1,'X');return result;}}
  await assert.rejects(refreshConfirmedNativeTocNumbers(bytes,'hwpx',originalHash,[entry],BadText as unknown as NativeHwpEngine));
  class BadCounter extends Engine{setCharShapeId(...args:any[]){const result=super.setCharShapeId(...args);super.insertNewNumber(1,0,super.getParagraphLength(1,0),99);return result;}}
  await assert.rejects(refreshConfirmedNativeTocNumbers(bytes,'hwpx',originalHash,[entry],BadCounter as unknown as NativeHwpEngine));
  class BadNumberLine extends Engine{
    changed=false;setCharShapeId(...args:any[]){const result=super.setCharShapeId(...args);this.changed=true;return result;}
    getPageTextLayout(page:number){const value=JSON.parse(super.getPageTextLayout(page));if(this.changed)for(const run of value.runs)if(run.secIdx===entry.section&&run.paraIdx===entry.paragraph&&run.charStart>=entry.offset)run.y+=20;return JSON.stringify(value);}
  }
  await assert.rejects(refreshConfirmedNativeTocNumbers(bytes,'hwpx',originalHash,[entry],BadNumberLine as unknown as NativeHwpEngine));
  assert.equal(hash(bytes),originalHash);
});

test('CF191 numeral suffix spaces retain text, style and line while later text or TAB cannot be hidden',async()=>{
  for(const format of ['hwp','hwpx'] as const){
    const fixtureSource=await fixture(format),doc=new fixtureSource.Engine(fixtureSource.bytes);let bytes:Uint8Array;
    try{assert.equal(JSON.parse(doc.insertText(0,1,doc.getParagraphLength(0,1),'  ')).ok,true);bytes=format==='hwp'?doc.exportHwp():doc.exportHwpx();}finally{doc.free();}
    const read=new fixtureSource.Engine(bytes);let text:string;try{text=read.getTextRange(0,1,0,read.getParagraphLength(0,1));}finally{read.free();}
    const entry={...fixtureSource.entry,paragraphSha256:hash(text)},checked=await inspectNativeTocNumbers(bytes,format,[1],fixtureSource.Engine);
    assert.equal(checked.candidates.length,1);assert.equal(checked.numberRows,1);assert.equal(checked.excluded.length,0);
    const result=await refreshConfirmedNativeTocNumbers(bytes,format,hash(bytes),[entry],fixtureSource.Engine),after=new fixtureSource.Engine(result.bytes);
    try{assert.equal(after.getTextRange(0,1,0,after.getParagraphLength(0,1)),[...text].slice(0,entry.offset).join('')+'23  ');}finally{after.free();}
    for(const suffix of ['x','\t','\n']){
      const bad=new fixtureSource.Engine(fixtureSource.bytes);let badBytes:Uint8Array;try{assert.equal(JSON.parse(bad.insertText(0,1,bad.getParagraphLength(0,1),suffix)).ok,true);badBytes=format==='hwp'?bad.exportHwp():bad.exportHwpx();}finally{bad.free();}
      const opened=new fixtureSource.Engine(badBytes);try{const raw=opened.getTextRange(0,1,0,opened.getParagraphLength(0,1));await assert.rejects(refreshConfirmedNativeTocNumbers(badBytes,format,hash(badBytes),[{...entry,paragraphSha256:hash(raw)}],fixtureSource.Engine));}finally{opened.free();}
    }
  }
});
async function compoundFixture(format:'hwp'|'hwpx',body='<table><tr><td><p>Ⅰ.</p></td><td><p>자료 목록</p></td></tr></table>'){
  const Engine=await engine,html=['<p>목 차</p><p>Ⅰ. 자료 목록 ........ <strong>9</strong> </p>',body+'<p>확정 금액 123,456원 · 보존 본문</p>'];
  const tableCells=[...body.matchAll(/<table>(.*?)<\/table>/gu)].map(table=>[...table[1].matchAll(/<tr>(.*?)<\/tr>/gu)].flatMap((row,rowIndex)=>[...row[1].matchAll(/<td>(.*?)<\/td>/gu)].map((cell,col)=>({row:rowIndex,col,rowSpan:1,colSpan:1,text:cell[1].replace(/<[^>]*>/gu,'')}))));
  const doc=new Engine(createNativeHwp(html.map((html,index)=>({html,text:html.replace(/<[^>]*>/gu,''),tables:index===1?tableCells.length:0,tableCells:index===1?tableCells:[],images:0,width:794,height:1123,margins:{top:40,right:40,bottom:40,left:40}})),Engine));
  try{assert.equal(JSON.parse(doc.insertNewNumber(1,1,doc.getParagraphLength(1,1),23)).ok,true);return {Engine,bytes:new Uint8Array(format==='hwp'?doc.exportHwp():doc.exportHwpx())};}finally{doc.free();}
}
test('CF191 source-proven 1x2 Roman/title cells are read-only anchors with exact whole-title uniqueness',async()=>{
  for(const format of ['hwp','hwpx'] as const){
    const {Engine,bytes}=await compoundFixture(format),before=hash(bytes),inspection=await inspectNativeTocNumbers(bytes,format,[1],Engine);
    assert.equal(inspection.candidates.length,1);const entry=inspection.candidates[0];assert.ok(entry.anchor.cells);assert.equal(entry.anchor.physicalPage,2);assert.equal(entry.anchor.printedPage,23);
    const result=await refreshConfirmedNativeTocNumbers(bytes,format,before,[entry],Engine);assert.equal(result.changes[0].newText,'23');assert.equal(hash(bytes),before);
    for(const cells of [ [...entry.anchor.cells].reverse(),[{...entry.anchor.cells[0],sha256:'0'.repeat(64)},entry.anchor.cells[1]],[{...entry.anchor.cells[0],path:[{...entry.anchor.cells[0].path[0],cellIndex:10}]},entry.anchor.cells[1]] ])await assert.rejects(refreshConfirmedNativeTocNumbers(bytes,format,before,[{...entry,anchor:{...entry.anchor,cells:cells as typeof entry.anchor.cells}}],Engine));
    class BadGrid extends Engine{getCellInfoByPath(...args:any[]){const info=JSON.parse(super.getCellInfoByPath(...args));return JSON.stringify({...info,colSpan:2});}}
    await assert.rejects(refreshConfirmedNativeTocNumbers(bytes,format,before,[entry],BadGrid as unknown as NativeHwpEngine));
    class MissingGlyph extends Engine{getPageTextLayout(page:number){const value=JSON.parse(super.getPageTextLayout(page));value.runs=value.runs.filter((run:any)=>!run.cellPath?.length);return JSON.stringify(value);}}
    await assert.rejects(refreshConfirmedNativeTocNumbers(bytes,format,before,[entry],MissingGlyph as unknown as NativeHwpEngine));
    class RepeatedGlyph extends Engine{getPageTextLayout(page:number){const value=JSON.parse(super.getPageTextLayout(page)),cell=value.runs.find((run:any)=>run.cellPath?.length);if(cell)value.runs.push({...cell});return JSON.stringify(value);}}
    await assert.rejects(refreshConfirmedNativeTocNumbers(bytes,format,before,[entry],RepeatedGlyph as unknown as NativeHwpEngine));
  }
  for(const body of [ '<table><tr><td><p>Ⅱ.</p></td><td><p>자료 목록</p></td></tr></table>', '<table><tr><td><p>Ⅰ.</p><p>추가</p></td><td><p>자료 목록</p></td></tr></table>', '<table><tr><td><p>Ⅰ.</p></td><td><p>자료 목록</p></td><td><p>추가</p></td></tr></table>', '<table><tr><td><p>Ⅰ.</p></td><td><p>자료 목록</p></td></tr></table><table><tr><td><p>Ⅰ.</p></td><td><p>자료 목록</p></td></tr></table>' ]){
    const {Engine,bytes}=await compoundFixture('hwpx',body),inspection=await inspectNativeTocNumbers(bytes,'hwpx',[1],Engine);assert.equal(inspection.candidates.length,0);assert.ok(inspection.excluded.length>0);
  }
  const duplicate=await compoundFixture('hwpx','<table><tr><td><p>Ⅰ.</p></td><td><p>자료 목록</p></td></tr></table><table><tr><td><p>Ⅰ.</p></td><td><p>자료 목록</p></td></tr></table>'),opened=new duplicate.Engine(duplicate.bytes);
  let secondParent:number;try{const parents=[...new Set<number>(JSON.parse(opened.getCursorModel()).lists.filter((list:any)=>list.isCell&&list.sectionIndex===1).map((list:any)=>list.hostPara))];assert.equal(parents.length,2);secondParent=parents[1];}finally{opened.free();}
  class BadSecondGlyph extends duplicate.Engine{getPageTextLayout(page:number){const value=JSON.parse(super.getPageTextLayout(page));value.runs=value.runs.filter((run:any)=>!(run.secIdx===1&&run.parentParaIdx===secondParent));return JSON.stringify(value);}}
  const ambiguous=await inspectNativeTocNumbers(duplicate.bytes,'hwpx',[1],BadSecondGlyph as unknown as NativeHwpEngine);assert.equal(ambiguous.candidates.length,0);assert.equal(ambiguous.excluded[0].reason,'TITLE_AMBIGUOUS','An unverified known duplicate cannot make another matching table look unique');
  const withField=await compoundFixture('hwpx'),field=new withField.Engine(withField.bytes);let fieldBytes:Uint8Array;
  try{const cell=JSON.parse(field.getCursorModel()).lists.find((list:any)=>list.isCell&&list.sectionIndex===1&&list.col===1);assert.ok(cell);assert.ok(JSON.parse(field.insertClickHereFieldInCell(1,cell.hostPara,cell.controlIndex,cell.cellIndex,0,0,false,' ','','qa-cell-field',true)).ok);assert.match(field.getFieldList(),/qa-cell-field/u);fieldBytes=field.exportHwpx();}finally{field.free();}
  assert.equal((await inspectNativeTocNumbers(fieldBytes,'hwpx',[1],withField.Engine)).candidates.length,0);
});
