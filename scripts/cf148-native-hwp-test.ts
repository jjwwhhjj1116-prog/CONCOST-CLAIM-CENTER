import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { captureReportNativeSource } from '../apps/web/src/documents/report-native-source';
import { createNativeHwp, verifyNativeHwpContent, type NativeHwpPage } from '../apps/web/src/documents/editable-hwp-export';

// Runs the deployed engine, not a mocked formatter. No user files or network.
const pkg = resolve(process.env.CF148_RHWP_PKG || 'pinned-runtime/pkg');
const wasm = readFileSync(resolve(pkg, 'rhwp_bg.wasm'));
const expectedEngineSha = process.env.CF148_RHWP_SHA256 || 'bcc40a79bcd9be813cb231c6d8a0376b803ab8a6c189a09bcccabb8a249f3c44';
assert.match(expectedEngineSha, /^[a-f0-9]{64}$/u);
assert.equal(createHash('sha256').update(wasm).digest('hex'), expectedEngineSha);
const engine = import(pathToFileURL(resolve(pkg, 'rhwp.js')).href).then(async module => {
  await module.default({ module_or_path: wasm });
  return module.HwpDocument;
});
const { unzipSync, strFromU8, strToU8, zipSync } = createRequire(new URL('../apps/web/package.json', import.meta.url))('fflate');
const page = (html: string, text: string, tables = 0, images = 0): NativeHwpPage => ({ html, text, tables, images, width: 794, height: 1123, margins: { top: 40, right: 40, bottom: 40, left: 40 } });

test('applied snapshot keeps edited bytes and its own rendered pages, not the initial file', async () => {
  const Engine = await engine;
  const source = page('<p>기존 본문 123원</p>', '기존 본문 123원');
  const original = createNativeHwp([source], Engine);
  const opened = new Engine(original);
  try {
    assert.equal(JSON.parse(opened.insertText(0, 0, 0, '수정검수 ')).ok, true);
    const edited = opened.exportHwpx();
    const snapshot = captureReportNativeSource(edited, '검수_편집본.hwpx', Engine);
    const stored = new Uint8Array(await snapshot.file.arrayBuffer());
    assert.deepEqual(stored, edited);
    const reopened = new Engine(stored);
    try {
      verifyNativeHwpContent(reopened.exportHwpx(), [{ ...source, text: '수정검수 ' + source.text }]);
      assert.equal(snapshot.pages.length, reopened.pageCount());
      for (let index = 0; index < snapshot.pages.length; index++) assert.equal(snapshot.pages[index], reopened.renderPageSvg(index));
    } finally { reopened.free(); }
    assert.throws(() => captureReportNativeSource(new Uint8Array([1,2,3]), '오류.hwpx', Engine));
  } finally { opened.free(); }
});

test('native HWP preserves two sections and text remains editable after a second save', async () => {
  const Engine = await engine;
  const pages = [page('<p>본문 한글 123,456원 &amp; 기준</p>', '본문 한글 123,456원 & 기준'), page('<p>다음 장 원문</p>', '다음 장 원문')];
  const bytes = createNativeHwp(pages, Engine);
  assert.deepEqual([...bytes.subarray(0, 8)], [208, 207, 17, 224, 161, 177, 26, 225]);
  const opened = new Engine(bytes);
  try {
    assert.throws(() => verifyNativeHwpContent(opened.exportHwpx(), [{ ...pages[0], margins: { ...pages[0].margins, top: 41 } }, pages[1]]), /용지·여백/);
    assert.equal(JSON.parse(opened.insertText(0, 0, 0, '수정 ')).ok, true);
    const reopened = new Engine(opened.exportHwp());
    try { verifyNativeHwpContent(reopened.exportHwpx(), [{ ...pages[0], text: '수정 ' + pages[0].text }, pages[1]]); }
    finally { reopened.free(); }
  } finally { opened.free(); }
});

test('native HWP retains positive and negative letter spacing after binary reopen',async()=>{
  const Engine=await engine;
  const source=page('<p><span style="font-size:20px;letter-spacing:2px">양수</span><span style="font-size:20px;letter-spacing:-2px">음수</span></p>','양수음수');
  const opened=new Engine(createNativeHwp([source],Engine));
  try{
    const header=strFromU8(unzipSync(opened.exportHwpx())['Contents/header.xml']);
    assert.match(header,/<hh:spacing\b[^>]*hangul="10"/u);
    assert.match(header,/<hh:spacing\b[^>]*hangul="-10"/u);
  }finally{opened.free();}
});

test('native HWP retains consecutive and trailing inline line breaks after saving',async()=>{
  const Engine=await engine;
  const source=page('<p><span>A<br><br>B<br></span></p>','A\n\nB\n');
  const opened=new Engine(createNativeHwp([source],Engine));
  try{
    const files=unzipSync(opened.exportHwpx());
    const xml=strFromU8(files['Contents/section0.xml']);
    assert.equal((xml.match(/<hp:lineBreak\b/gu)||[]).length,3);
    const removed={...files,'Contents/section0.xml':strToU8(xml.replace(/<hp:lineBreak\b[^>]*\/>/u,''))};
    assert.throws(()=>verifyNativeHwpContent(zipSync(removed),[source]),/줄바꿈/);
    const spaces={...files,'Contents/section0.xml':strToU8(xml.replace(/<hp:lineBreak\b[^>]*\/>/gu,' '))};
    assert.throws(()=>verifyNativeHwpContent(zipSync(spaces),[source]),/줄바꿈/);
  }finally{opened.free();}
  assert.throws(()=>createNativeHwp([page('<p>&#57344;</p>','\ue000')],Engine),/표식과 본문이 충돌/);
});

test('native HWP retains real merged table cells, not a table screenshot', async () => {
  const Engine = await engine;
  const pages = [page('<table><tr><td rowspan="2">병합</td><td>120</td></tr><tr><td>145</td></tr></table>', '병합120145', 1)];
  pages[0].tableCells = [[{ row: 0, col: 0, rowSpan: 2, colSpan: 1, text: '병합' }, { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: '120' }, { row: 1, col: 1, rowSpan: 1, colSpan: 1, text: '145' }]];
  const opened = new Engine(createNativeHwp(pages, Engine));
  try {
    const xml = opened.exportHwpx();
    assert.match(strFromU8(unzipSync(xml)['Contents/section0.xml']), /rowSpan="2"/u);
    verifyNativeHwpContent(xml, pages);
    assert.throws(() => verifyNativeHwpContent(xml, [{ ...pages[0], tables: 2 }]), /표 누락/);
    assert.throws(() => verifyNativeHwpContent(xml, [{ ...pages[0], text: '틀린 원문' }]), /글자가 원문과 다릅니다/);
    const altered = unzipSync(xml);
    altered['Contents/section0.xml'] = strToU8(strFromU8(altered['Contents/section0.xml']).replace('rowSpan="2"', 'rowSpan="1"'));
    assert.throws(() => verifyNativeHwpContent(zipSync(altered), pages), /셀·병합·내용/);
  } finally { opened.free(); }
});

test('CSS fixed line-height uses native doubled storage units after HWP save',async()=>{
  const Engine=await engine;
  const source=page('<p style="line-height:40px">A</p><p style="line-height:150%">B</p>','AB');
  const opened=new Engine(createNativeHwp([source],Engine));
  try{
    const header=strFromU8(unzipSync(opened.exportHwpx())['Contents/header.xml']);
    assert.match(header,/<hh:lineSpacing\b[^>]*type="FIXED"[^>]*value="3000"/u);
    assert.match(header,/<hh:lineSpacing\b[^>]*type="FIXED"[^>]*value="6000"/u);
    assert.match(header,/<hh:lineSpacing\b[^>]*type="PERCENT"[^>]*value="150"/u);
  }finally{opened.free();}
});

test('measured cover insets retain negative right inset after HWP save',async()=>{
  const Engine=await engine,source=page('<p style="text-align:center">갑지</p>','갑지');
  source.paragraphInsets=[{left:30,right:-10}];
  const opened=new Engine(createNativeHwp([source],Engine));
  try{
    const files=unzipSync(opened.exportHwpx()),section=strFromU8(files['Contents/section0.xml']);
    const ref=section.match(/<hp:p\b[^>]*paraPrIDRef="(\d+)"/u)![1];
    const definition=[...strFromU8(files['Contents/header.xml']).matchAll(/<hh:paraPr\b[^>]*>[\s\S]*?<\/hh:paraPr>/gu)].find(m=>m[0].includes(`id="${ref}"`))![0];
    assert.match(definition,/<hc:left value="4500"/u);
    assert.match(definition,/<hc:right value="-1500"/u);
    assert.throws(()=>verifyNativeHwpContent(opened.exportHwpx(),[{...source,paragraphInsets:[{left:31,right:-10}]}]),/가로 위치/);
  }finally{opened.free();}
});

test('first paragraph keeps its actual center style and individual photo survives HWP save', async () => {
  const Engine = await engine;
  const image = '<img width="40" height="40" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5V8AAAAASUVORK5CYII=">';
  const pages = [page('<p style="text-align:center"><span style="font-size:24pt;color:#123456">갑지 제목</span></p>' + image, '갑지 제목', 0, 1)];
  pages[0].pictures = [{ bytes: Buffer.from(image.match(/base64,([^"]+)/u)![1], 'base64'), width: 40, height: 40 }];
  const opened = new Engine(createNativeHwp(pages, Engine));
  try {
    const files = unzipSync(opened.exportHwpx());
    const section = strFromU8(files['Contents/section0.xml']);
    const header = strFromU8(files['Contents/header.xml']);
    const paragraph = section.match(/<hp:p\b[^>]*>/u)?.[0];
    const ref = paragraph?.match(/paraPrIDRef="(\d+)"/u)?.[1];
    assert.ok(ref);
    const definition = [...header.matchAll(/<hh:paraPr\b[^>]*>[\s\S]*?<\/hh:paraPr>/gu)].find(match => match[0].includes(`id="${ref}"`))?.[0];
    assert.match(definition || '', /horizontal="CENTER"/u);
    const charRef = section.match(/<hp:run\b[^>]*charPrIDRef="(\d+)"[^>]*><hp:t>갑지 제목/u)?.[1];
    assert.ok(charRef);
    const charDefinition = [...header.matchAll(/<hh:charPr\b[^>]*>[\s\S]*?<\/hh:charPr>/gu)].find(match => match[0].includes(`id="${charRef}"`))?.[0];
    assert.match(charDefinition || '', /height="2400"/u);
    assert.match(charDefinition || '', /textColor="#123456"/u);
    assert.ok(!section.includes('CF148_NATIVE_IMPORT_ANCHOR'));
    verifyNativeHwpContent(opened.exportHwpx(), pages);
    assert.equal(Object.keys(files).filter(path => path.startsWith('BinData/')).length, 1);
    const noRef = { ...files, 'Contents/section0.xml': strToU8(section.replace(/binaryItemIDRef="[^"]+"/u, '')) };
    assert.throws(() => verifyNativeHwpContent(zipSync(noRef), pages), /사진 참조가 없습니다/);
    const picturePath = Object.keys(files).find(path => path.startsWith('BinData/'))!;
    const replaced = { ...files, [picturePath]: new Uint8Array([1, 2, 3]) };
    assert.throws(() => verifyNativeHwpContent(zipSync(replaced), pages), /사진 파일 또는 순서/);
    assert.throws(() => verifyNativeHwpContent(opened.exportHwpx(), [{ ...pages[0], pictures: [{ ...pages[0].pictures![0], width: 41 }] }]), /사진 크기/);
  } finally { opened.free(); }
});

test('lost images and changed pagination stop export instead of falling back to page pictures', async () => {
  const Engine = await engine;
  for(const rule of [
    {left:10,top:10,width:100,height:2,colors:['#123456"/>']},
    {left:10,top:NaN,width:100,height:2,colors:['#123456']},
    {left:790,top:10,width:100,height:2,colors:['#123456']},
  ])assert.throws(()=>createNativeHwp([{...page('<p>본문</p>','본문'),rules:[rule as NonNullable<NativeHwpPage['rules']>[number]]}],Engine),/장식선의 위치 또는 색상/);
  assert.throws(() => createNativeHwp([page('<p>본문</p>', '본문', 0, 1)], Engine), /사진 누락/);
  const overflow = Array.from({ length: 100 }, (_, i) => `<p>긴 문단 ${i}</p>`).join('');
  assert.throws(() => createNativeHwp([page(overflow, Array.from({ length: 100 }, (_, i) => `긴 문단 ${i}`).join(''))], Engine), /페이지 수가 달라졌습니다/);
});

test('native footer and measured merged table geometry survive binary HWP round trip', async () => {
  const Engine=await engine;
  const source=page('<table><tr><td colspan="2">너비 600</td></tr><tr><td>100</td><td>500</td></tr></table>','너비 600100500',1);
  source.tableCells=[[{row:0,col:0,rowSpan:1,colSpan:2,text:'너비 600'},{row:1,col:0,rowSpan:1,colSpan:1,text:'100'},{row:1,col:1,rowSpan:1,colSpan:1,text:'500'}]];
  source.tableGeometry=[{width:600,cells:[600,100,500].map(width=>({width,height:30,padding:{top:0,right:0,bottom:0,left:0}}))}];
  source.footer={html:'<p style="text-align:center">- 1 -</p>',text:'- 1 -',tables:0,images:0,distance:20};
  source.frame={left:20,top:20,width:754,height:1083,color:'#626262',stroke:1};
  const opened=new Engine(createNativeHwp([source],Engine));
  try{
    verifyNativeHwpContent(opened.exportHwpx(),[source]);
    assert.match(strFromU8(unzipSync(opened.exportHwpx())['Contents/section0.xml']),/<hp:footer\b/u);
    assert.throws(()=>verifyNativeHwpContent(opened.exportHwpx(),[{...source,tableGeometry:[{...source.tableGeometry![0],width:599}]}]),/표 너비/);
    assert.throws(()=>verifyNativeHwpContent(opened.exportHwpx(),[{...source,frame:{...source.frame!,left:21}}]),/테두리의 위치/);
  }finally{opened.free();}
});

test('image-only paragraphs keep their photograph instead of hitting the engine inline-image loss', async () => {
  const Engine = await engine;
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5V8AAAAASUVORK5CYII=';
  const source = page(`<p style="text-align:center;margin-top:20px;margin-bottom:12px"><img src="data:image/png;base64,${base64}" width="80" height="50"></p>`, '', 0, 1);
  source.pictures = [{ bytes: Buffer.from(base64, 'base64'), width: 80, height: 50 }];
  const opened = new Engine(createNativeHwp([source], Engine));
  try {
    verifyNativeHwpContent(opened.exportHwpx(), [source]);
    const files = unzipSync(opened.exportHwpx());
    const ref = strFromU8(files['Contents/section0.xml']).match(/<hp:p\b[^>]*paraPrIDRef="(\d+)"/u)![1];
    const definition = [...strFromU8(files['Contents/header.xml']).matchAll(/<hh:paraPr\b[^>]*>[\s\S]*?<\/hh:paraPr>/gu)].find(match => match[0].includes(`id="${ref}"`))![0];
    assert.match(definition, /horizontal="CENTER"/u);
    assert.match(definition, /<hc:prev value="3000"/u);
    assert.match(definition, /<hc:next value="1800"/u);
  }
  finally { opened.free(); }
  assert.throws(() => createNativeHwp([{ ...source, html: source.html.replace('<img', '같은 줄 <img'), text: '같은 줄' }], Engine), /사진 누락/);
  assert.throws(() => createNativeHwp([{ ...source, html: source.html.replace('text-align:center', 'padding:12px') }], Engine), /여백·테두리/);
});
