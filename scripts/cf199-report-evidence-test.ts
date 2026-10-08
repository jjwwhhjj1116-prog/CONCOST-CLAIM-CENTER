import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { getDocumentProxy } from 'unpdf';
import { readSpreadsheetExcerpt } from '../apps/web/src/proposals/proposal-excel';

const webRequire = createRequire(resolve('apps/web/package.json'));
const { zipSync, strToU8, unzipSync, strFromU8 } = webRequire('fflate') as typeof import('../apps/web/node_modules/fflate');

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const caseId = '40000000-0000-4000-8000-000000000019', nextCase = '40000000-0000-4000-8000-000000000020';
const sheet = (formula = '<f>B25*2</f><v>246.90</v>') => `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>품명</t></is></c><c r="B1" t="inlineStr"><is><t>수량</t></is></c></row><row r="25"><c r="A25" t="inlineStr"><is><t>구조 | &lt;검수&gt;&#10;원문</t></is></c><c r="B25"><v>123.45</v></c><c r="C25">${formula}</c></row><row r="27"><c r="A27" t="inlineStr"><is><t>다음 항목</t></is></c><c r="B27"><v>0</v></c></row></sheetData></worksheet>`;
function workbook(xml = sheet()): Uint8Array {
  return zipSync({
    'xl/workbook.xml': strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="기본" r:id="one"/><sheet name="구조내역" r:id="two"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="one" Target="worksheets/sheet1.xml"/><Relationship Id="two" Target="worksheets/sheet2.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>첫 시트</t></is></c></row></sheetData></worksheet>'),
    'xl/worksheets/sheet2.xml': strToU8(xml)
  }, { level: 0 });
}
const xlsxFile = (xml?: string) => new File([Uint8Array.from(workbook(xml)).buffer], '구조내역.xlsx');

test('CF199 spreadsheet excerpt preserves real sparse addresses, sheet, zero, text and cached results', async () => {
  const result = await readSpreadsheetExcerpt(xlsxFile(), '$A$25:$C$27', '구조내역');
  assert.equal(result.range, 'A25:C27'); assert.equal(result.sheetName, '구조내역');
  assert.deepEqual(result.rows, [['구조 | <검수>\n원문', '123.45', '246.90'], ['', '', ''], ['다음 항목', '0', '']]);
  assert.deepEqual((await readSpreadsheetExcerpt(xlsxFile(), 'A25:B25', '구조내역')).rows, [['구조 | <검수>\n원문', '123.45']]);
  await assert.rejects(readSpreadsheetExcerpt(xlsxFile(), 'A2:B2', '구조내역'), /값이 없습니다/);
  assert.equal((await readSpreadsheetExcerpt(xlsxFile())).sheetName, '기본');
});
test('CF199 excerpt rejects wrong sheet, invalid bounds and formula with no cached value', async () => {
  await assert.rejects(readSpreadsheetExcerpt(xlsxFile(), 'A1:B2', '없는 시트'), /시트/);
  for (const range of ['A0:B1', 'B2:A1', 'A1:AY1', 'A1:B301', 'A1:XFE1', 'A1048577:B1048577']) await assert.rejects(readSpreadsheetExcerpt(xlsxFile(), range, '구조내역'));
  await assert.rejects(readSpreadsheetExcerpt(xlsxFile(sheet('<f>B25*2</f>')), 'A25:C25', '구조내역'), /계산 결과/);
  const file = xlsxFile(sheet('<f>B25*2</f>')); assert.equal((await readSpreadsheetExcerpt(file, 'A25:B25', '구조내역')).rows[0][1], '123.45', 'unselected formulas do not block a valid excerpt');
});

test('CF199 empty row/cell tokens and missing sheet relationships cannot shift provenance', async () => {
  const file = xlsxFile('<worksheet><sheetData><row r="20"/><row r="25"><c r="A25"/><c r="B25" t="inlineStr"><is><t>실제 B25</t></is></c></row></sheetData></worksheet>');
  const result = await readSpreadsheetExcerpt(file, 'A20:B25', '구조내역');
  assert.equal(result.range, 'A20:B25'); assert.equal(result.rows.length, 6); assert.deepEqual(result.rows[5], ['', '실제 B25']); assert.ok(result.rows.slice(0,5).every(row => row.every(value => value === '')));
  const zip = unzipSync(workbook()); zip['xl/_rels/workbook.xml.rels'] = strToU8('<Relationships><Relationship Id="one" Target="worksheets/sheet1.xml"/></Relationships>');
  await assert.rejects(readSpreadsheetExcerpt(new File([Uint8Array.from(zipSync(zip)).buffer], 'missing.xlsx'), 'A1:B2', '구조내역'), /원본 연결/);
  zip['xl/_rels/workbook.xml.rels'] = strToU8('<Relationships/>');
  await assert.rejects(readSpreadsheetExcerpt(new File([Uint8Array.from(zipSync(zip)).buffer], 'missing.xlsx'), 'A1:B2'), /원본 연결/);
  for (const cellXml of ['<c r="A26"><v>999</v></c>', '<c r="A25"><v>1</v></c><c r="A25"><v>2</v></c>', '<c r="A25" t="s"><v>999</v></c>']) await assert.rejects(readSpreadsheetExcerpt(xlsxFile(`<worksheet><sheetData><row r="25">${cellXml}</row></sheetData></worksheet>`), 'A25:B25', '구조내역'), /주소|문자열 연결/);
});

test('CF199 real attachment dialog protects uploads and prints selected photos plus editable source-cell table', { timeout: 180_000 }, async t => {
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const imageBytes = new Map<string, Buffer>();
  const xlsx = workbook(); const stored = new Map<string, { bytes: Uint8Array; file: Record<string, unknown> }>();
  let savedDraft: unknown = null, mode = '', posts = 0, latest = true, release: (() => void) | undefined;
  const files = () => [1, 2, 3].map(id => ({ id: String(id), originalName: `사진${id}.jpg`, mimeType: 'image/jpeg', category: 'SITE_PHOTO', downloadUrl: `/api/cases/evidence/${id}/download` })).concat([{ id: '4', originalName: '구조내역.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', category: 'REPORT_REFERENCE', downloadUrl: '/api/cases/evidence/4/download', byteSize: xlsx.length, sha256: sha(xlsx), versionNumber: 2, isLatest: latest } as any]);
  const server = await createServer({ root: resolve('apps/web'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', plugins: [{
    name: 'cf199-evidence',
    configureServer(s) { s.middlewares.use(async (req, res, next) => {
      const url = req.url ?? '';
      if (url === `/api/cases/${caseId}/evidence` || url === `/api/cases/${nextCase}/evidence`) {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'POST') { res.end(JSON.stringify(mode === 'list' ? {} : { files: files() })); return; }
        posts++; const parts: Buffer[] = []; for await (const chunk of req) parts.push(Buffer.from(chunk));
        const form = await new Request('http://localhost/upload', { method: 'POST', headers: { 'Content-Type': req.headers['content-type']! }, body: Buffer.concat(parts) }).formData();
        const file = form.get('file') as File; const bytes = new Uint8Array(await file.arrayBuffer()), id = 'upload-' + posts;
        if (mode === 'hold' || mode === 'late-conflict') await new Promise<void>(done => { release = done; });
        if (mode === 'late-conflict') { res.statusCode = 409; res.end(JSON.stringify({ status: 'VERSION_CONFLICT_CONFIRMATION', reviewId: 'review', nextVersion: 2, existing_file: { name: file.name, uploader: '시험', created_at: '2026-10-08' } })); return; }
        const meta = { id, originalName: file.name, mimeType: file.type, category: form.get('category'), byteSize: bytes.length, sha256: sha(bytes), downloadUrl: `/api/cases/evidence/${id}/download` };
        stored.set(id, { bytes, file: meta });
        res.end(mode === 'json' ? '{broken' : JSON.stringify(mode === 'missing' ? {} : { file: { ...meta, ...(mode === 'hash' ? { sha256: '0'.repeat(64) } : mode === 'url' ? { downloadUrl: 'https://example.invalid/file' } : {}) } })); return;
      }
      if (url === '/cf199-draft') {
        if (req.method === 'PUT') { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); savedDraft = JSON.parse(Buffer.concat(chunks).toString()); }
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(savedDraft)); return;
      }
      const download = /^\/api\/cases\/evidence\/([^/]+)\/download$/u.exec(url);
      if (download) { const id = download[1]; res.setHeader('Content-Type', id === '4' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'image/jpeg'); res.end(id === '4' ? mode === 'download-hash' ? Buffer.from('wrong') : xlsx : imageBytes.get(id) ?? stored.get(id)?.bytes); return; }
      if (url !== '/cf199.html') return next();
      const inline = readFileSync('apps/web/index.html', 'utf8').match(/<style>[\s\S]*?<\/style>/u)?.[0] ?? '';
      res.setHeader('Content-Type', 'text/html'); res.end(await s.transformIndexHtml(url, `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${inline}</head><body><div id="root"></div><script>window.__CLAIM_API_ORIGIN__=location.origin;</script><script type="module" src="/cf199.js"></script></body></html>`));
    }); },
    resolveId: id => id === '/cf199.js' ? '\0cf199' : undefined,
    load: id => id === '\0cf199' ? `
      import React,{useRef,useState,useEffect} from 'react';import{createRoot}from'react-dom/client';
      import{StructuredDocumentEditor,parseStructuredDocumentMarkdown}from'/src/documents/StructuredDocumentEditor.tsx';
      import{ReportEvidenceInsert}from'/src/documents/ReportEvidenceInsert.tsx';import{createReportEvidenceUploader}from'/src/evidence/report-evidence-upload.ts';
      import{ReportFinalDocumentPreview}from'/src/routes/PreviewReportStudio.tsx';import{downloadFinalDocument}from'/src/documents/final-document-export.ts';
      import'/src/preview-theme.css';import'/src/theme-system.css';import'/src/documents/StructuredDocumentEditor.css';import'/src/documents/DocumentReviewWorkspace.css';
      function App(){const editor=useRef(null),[uploader]=useState(createReportEvidenceUploader);const[open,setOpen]=useState(false),[id,setId]=useState('${caseId}'),[readonly,setReadonly]=useState(false);const[json,setJson]=useState(parseStructuredDocumentMarkdown('앞 문단\\n\\n뒤 문단')),[text,setText]=useState('앞 문단\\n\\n뒤 문단');
        useEffect(()=>{fetch('/cf199-draft').then(r=>r.json()).then(value=>{if(value){setJson(value.json);setText(value.text)}})},[]);
        window.evidenceQa={get:()=>editor.current.getJSON(),close:()=>setOpen(false),open:()=>setOpen(true),case:setId,readonly:setReadonly};
        async function save(){const doc={json:editor.current.getJSON(),text};await fetch('/cf199-draft',{method:'PUT',body:JSON.stringify(doc)});window.saved=true;}
        async function output(format){try{const result=await downloadFinalDocument({root:document.querySelector('.report-final-document'),format,fileName:'CF199 검수',orientation:'portrait',purpose:'ADMIN_QA'});window.exportResult=result;}catch(e){window.exportError=e.message;}}
        return React.createElement(React.Fragment,null,React.createElement('button',{onClick:save},'시험 저장'),React.createElement('button',{onClick:()=>output('docx')},'시험 DOCX'),React.createElement('button',{onClick:()=>output('pdf')},'시험 PDF'),React.createElement(StructuredDocumentEditor,{ref:editor,value:text,editorJson:json,label:'검수 원고',readOnly:readonly,onRequestInsertImage:()=>setOpen(true),onChange:(text,json)=>{setText(text);setJson(json)}}),React.createElement(ReportFinalDocumentPreview,{caseNumber:'QA',caseTitle:'첨부 근거',title:'보고서 첨부 검수',content:text,editorJson:json}),open&&React.createElement(ReportEvidenceInsert,{key:id,caseId:id,uploader,disabled:readonly,onClose:()=>setOpen(false),onInsert:html=>editor.current.insertHtml(html)}));
      }createRoot(document.getElementById('root')).render(React.createElement(App));
    ` : undefined
  }] });
  await server.listen(); const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const generator = await browser.newPage(); await generator.goto(origin + '/cf199.html');
    const images = await generator.evaluate(() => [1,2,3].map(id => { const c = document.createElement('canvas'); c.width = id === 2 ? 100 : 200; c.height = id === 2 ? 200 : 100; const ctx = c.getContext('2d')!; ctx.fillStyle = ['#345678','#876543','#526f24'][id-1]; ctx.fillRect(0,0,c.width,c.height); ctx.fillStyle='#fff';ctx.fillText('PHOTO '+id,10,30);return c.toDataURL('image/jpeg').split(',')[1]; }));
    images.forEach((data,index) => imageBytes.set(String(index + 1), Buffer.from(data,'base64'))); await generator.close();
    const newPage = async () => { const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort()); await page.goto(origin + '/cf199.html'); await page.locator('.tiptap').waitFor(); await page.getByRole('button',{name:'이미지',exact:true}).click(); await page.getByRole('checkbox',{name:'사진1.jpg',exact:true}).waitFor(); return page; };
    for (const fault of ['hash','url','json','missing']) await t.test(`bad upload ${fault} persists across dialog reopen`, async () => {
      mode=fault; posts=0; savedDraft=null; const page=await newPage();
      await page.getByLabel('PC에서 사진·근거자료 추가').setInputFiles({ name:'new.jpg',mimeType:'image/jpeg',buffer:imageBytes.get('1')! });
      await page.getByRole('alert').filter({hasText:'저장 결과가 불명확'}).waitFor();
      assert.equal(posts,1); assert.match(await page.locator('.report-evidence-insert').innerText(),/저장 결과/);
      assert.equal((await page.locator('.report-evidence-list').innerText()).includes('new.jpg'),false);
      await page.keyboard.press('Escape'); await page.getByRole('button',{name:'이미지',exact:true}).click(); await page.getByLabel('PC에서 사진·근거자료 추가').waitFor(); assert.equal(await page.getByLabel('PC에서 사진·근거자료 추가').isDisabled(),true);
      assert.equal(posts,1); await page.close();
    });
    await t.test('late conflict after unmount has no confirmation or remaining POST',async()=>{
      mode='late-conflict';posts=0;release=undefined;savedDraft=null;const page=await newPage();
      await page.getByLabel('PC에서 사진·근거자료 추가').setInputFiles([{name:'first.jpg',mimeType:'image/jpeg',buffer:imageBytes.get('1')!},{name:'second.jpg',mimeType:'image/jpeg',buffer:imageBytes.get('2')!}]);
      await new Promise<void>((done,reject)=>{let remaining=100;const check=()=>release?done():remaining--?setTimeout(check,20):reject(Error('POST not entered'));check();});
      await page.evaluate(()=> (window as any).evidenceQa.close());release!(); await page.waitForTimeout(200);
      assert.equal(await page.getByRole('dialog').count(),0);assert.equal(posts,1);assert.doesNotMatch(JSON.stringify(await page.evaluate(()=> (window as any).evidenceQa.get())),/first\.jpg|second\.jpg/);await page.close();
    });
    await t.test('XLSX wrong hash or sheet cannot become a table, inputs remain',async()=>{
      mode='download-hash';savedDraft=null;const page=await newPage();await page.getByRole('checkbox',{name:/구조내역.xlsx/}).check();await page.getByLabel('시트 이름',{exact:true}).fill('구조내역');await page.getByLabel('발췌 셀 범위').fill('A25:C27');await page.getByRole('button',{name:'셀 범위를 표로 발췌'}).click();await page.getByRole('alert').filter({hasText:'해시·크기'}).waitFor();assert.equal(await page.locator('.report-evidence-excerpt table').count(),0);assert.equal(await page.getByLabel('발췌 셀 범위').inputValue(),'A25:C27');
      mode='';await page.getByLabel('시트 이름',{exact:true}).fill('없는 시트');await page.getByRole('button',{name:'셀 범위를 표로 발췌'}).click();await page.getByRole('alert').filter({hasText:'시트를 찾지'}).waitFor();assert.equal(await page.locator('.report-evidence-excerpt table').count(),0);await page.close();
    });
    await t.test('already-open version confirmation closes when attachment owner unmounts',async()=>{
      mode='late-conflict';posts=0;release=undefined;savedDraft=null;const page=await newPage();
      await page.getByLabel('PC에서 사진·근거자료 추가').setInputFiles({name:'replace.jpg',mimeType:'image/jpeg',buffer:imageBytes.get('1')!});
      await new Promise<void>((done,reject)=>{let remaining=100;const check=()=>release?done():remaining--?setTimeout(check,20):reject(Error('POST not entered'));check();});release!();await page.getByRole('button',{name:'최신본으로 대체 · v2',exact:true}).waitFor();
      await page.evaluate(()=> (window as any).evidenceQa.close());await page.getByRole('button',{name:'최신본으로 대체 · v2',exact:true}).waitFor({state:'hidden'});assert.equal(posts,1);assert.equal(await page.getByRole('dialog').count(),0);await page.close();
    });
    await t.test('verified photo upload locks inputs until receipt and list refresh updates version labels',async()=>{
      mode='hold';posts=0;release=undefined;savedDraft=null;latest=true;const page=await newPage();
      await page.getByLabel('쟁점·첨부 제목').fill('입력 보존');await page.getByLabel('PC에서 사진·근거자료 추가').setInputFiles({name:'new.jpg',mimeType:'image/jpeg',buffer:imageBytes.get('1')!});
      await new Promise<void>((done,reject)=>{let remaining=100;const check=()=>release?done():remaining--?setTimeout(check,20):reject(Error('POST not entered'));check();});
      assert.equal(await page.getByLabel('쟁점·첨부 제목').isDisabled(),true);assert.equal(await page.getByLabel('첨부 시작번호').isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),1);release!();await page.getByRole('checkbox',{name:'new.jpg',exact:true}).waitFor();assert.equal(await page.getByRole('checkbox',{name:'new.jpg',exact:true}).isChecked(),true);assert.equal(posts,1);assert.equal([...stored.values()].at(-1)?.file.category,'SITE_PHOTO');assert.equal(await page.getByLabel('쟁점·첨부 제목').inputValue(),'입력 보존');
      mode='';latest=false;await page.getByRole('button',{name:'자료 목록 다시 불러오기'}).click();await page.getByRole('checkbox',{name:'구조내역.xlsx · v2 이전본',exact:true}).waitFor();assert.equal(await page.getByRole('checkbox',{name:'구조내역.xlsx · v2 최신본',exact:true}).count(),0);latest=true;
      await page.evaluate(()=> (window as any).evidenceQa.readonly(true));await page.waitForFunction(()=>Boolean(document.querySelector('.report-evidence-insert input:disabled')));assert.equal(await page.getByRole('button',{name:'선택 자료를 현재 위치에 넣기'}).isDisabled(),true);await page.close();
    });
    await t.test('actual selection order, number, XLSX native table, save/reload and DOCX/PDF bytes',async()=>{
      mode='';savedDraft=null;const page=await newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
      await page.getByLabel('쟁점·첨부 제목').fill('층고와 산출 근거');await page.getByLabel('첨부 시작번호').fill('9');
      for(const name of ['사진3.jpg','사진1.jpg','사진2.jpg'])await page.getByRole('checkbox',{name,exact:true}).check();
      await page.getByRole('checkbox',{name:/구조내역.xlsx/}).check();await page.getByLabel('사진2.jpg 설명',{exact:true}).fill('현관 층고 2,480mm');await page.getByLabel('시트 이름',{exact:true}).fill('구조내역');await page.getByLabel('발췌 셀 범위').fill('A25:C27');await page.getByRole('button',{name:'셀 범위를 표로 발췌'}).click();await page.locator('.report-evidence-excerpt table').waitFor();
      const outputDir=process.env.CF199_OUTPUT;if(outputDir){mkdirSync(outputDir,{recursive:true});await page.getByRole('dialog').screenshot({path:resolve(outputDir,'dialog-desktop.png')});await page.setViewportSize({width:390,height:844});await page.getByRole('dialog').screenshot({path:resolve(outputDir,'dialog-mobile.png')});assert.ok(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.setViewportSize({width:1440,height:1100});}
      await page.getByRole('button',{name:'선택 자료를 현재 위치에 넣기'}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
      const doc=await page.evaluate(()=> (window as any).evidenceQa.get()), serialized=JSON.stringify(doc);
      assert.match(serialized,/첨부자료 9/);assert.match(serialized,/첨부자료 11/);assert.match(serialized,/구조내역!A25:C27/);assert.match(serialized,/123\.45/);assert.match(serialized,/246\.90/);assert.equal((serialized.match(/"type":"image"/gu)??[]).length,3);
      assert.ok(serialized.indexOf('/evidence/3/download')<serialized.indexOf('/evidence/1/download')&&serialized.indexOf('/evidence/1/download')<serialized.indexOf('/evidence/2/download'));
      await page.getByRole('button',{name:'시험 저장',exact:true}).click();await page.waitForFunction(()=> (window as any).saved);await page.reload();await page.waitForFunction(()=>document.querySelector('.tiptap')?.textContent?.includes('246.90'));assert.deepEqual(await page.evaluate(()=> (window as any).evidenceQa.get()),doc);
      await page.waitForFunction(()=>[...document.querySelectorAll('.report-final-document [data-export-page] img')].length===3&&[...document.querySelectorAll('.report-final-document [data-export-page] img')].every(im=>(im as HTMLImageElement).complete&&(im as HTMLImageElement).naturalWidth>0));
      const imageLayout=await page.locator('.report-final-document [data-export-page] img').evaluateAll(images=>images.map(im=>({fit:getComputedStyle(im).objectFit,w:im.getBoundingClientRect().width,h:im.getBoundingClientRect().height,html:im.outerHTML})));if(outputDir)await page.locator('.report-final-document').screenshot({path:resolve(outputDir,'preview-before-export.png')});assert.ok(imageLayout.every(im=>im.fit==='contain'&&im.w>0&&im.h>0),JSON.stringify(imageLayout));
      const colors=await page.locator('.report-final-document [data-export-page] td p').evaluateAll(elements=>elements.map(p=>({text:p.textContent,color:getComputedStyle(p).color,html:p.outerHTML,parent:p.parentElement?.outerHTML})));assert.ok(colors.every(item=>item.color==='rgb(17, 17, 17)'),JSON.stringify(colors));
      const docxDownload=page.waitForEvent('download');await page.getByRole('button',{name:'시험 DOCX',exact:true}).click();const docx=await docxDownload;const docxPath=await docx.path();assert.ok(docxPath);const docxBytes=readFileSync(docxPath),zip=unzipSync(docxBytes);const xml=strFromU8(zip['word/document.xml']),rels=strFromU8(zip['word/_rels/document.xml.rels']);assert.match(xml,/123\.45/);assert.match(xml,/246\.90/);assert.ok((xml.match(/<w:tbl>/gu)??[]).length>=2);assert.match(rels,/\/api\/cases\/evidence\/4\/download/);assert.match(rels,/relationships\/hyperlink/);assert.match(xml,/<w:hyperlink/);
      const pdfDownload=page.waitForEvent('download');await page.getByRole('button',{name:'시험 PDF',exact:true}).click();const pdf=await pdfDownload,pdfPath=await pdf.path();assert.ok(pdfPath);const pdfBytes=readFileSync(pdfPath),parsed=await getDocumentProxy(new Uint8Array(pdfBytes));assert.ok(parsed.numPages>0);for(let n=1;n<=parsed.numPages;n++){const p=await parsed.getPage(n),view=p.getViewport({scale:1});assert.ok(Math.abs(view.width-595.28)<1&&Math.abs(view.height-841.89)<1);assert.ok((await p.getOperatorList()).fnArray.length>0);}
      let pdfPhotoRatios: number[] | null = null;
      if(process.env.CF199_PDF_QA_PYTHON){
        const probe=String.raw`import json,sys,numpy as np
from pypdf import PdfReader
p=PdfReader(sys.argv[1]).pages[-1]
names=[str(args[0]).lstrip('/') for args,op in p.get_contents().operations if op==b'Do']
assert len(names)==1
im=next(x.image for x in p.images if x.name.rsplit('.',1)[0]==names[0]).convert('RGB')
a=np.asarray(im).astype(np.int16)
ratios=[]
for c in [(52,86,120),(135,101,67),(82,111,36)]:
 m=np.all(np.abs(a-np.array(c))<=18,axis=2)
 rows=m.sum(axis=1)>40
 d=np.diff(np.r_[False,rows,False].astype(np.int8))
 starts=np.flatnonzero(d==1);ends=np.flatnonzero(d==-1)
 k=np.argmax(ends-starts);start,end=int(starts[k]),int(ends[k])
 y,x=np.where(m[start:end]);assert len(x)>1000
 ratios.append((int(x.max())-int(x.min())+1)/(end-start))
print(json.dumps(ratios))`;
        const measure=(path:string)=>JSON.parse(execFileSync(process.env.CF199_PDF_QA_PYTHON!,['-c',probe,path],{encoding:'utf8',timeout:15_000})) as number[];
        pdfPhotoRatios=measure(pdfPath);assert.ok(pdfPhotoRatios.every((ratio,index)=>Math.abs(ratio-[2,.5,2][index])<.08),JSON.stringify(pdfPhotoRatios));
        if(process.env.CF199_NEGATIVE_PDF){const before=measure(process.env.CF199_NEGATIVE_PDF);assert.ok(Math.abs(before[1]-.5)>.5,'The same pixel gate must reject the before-fix stretched portrait');}
      }
      assert.deepEqual(await page.evaluate(()=> (window as any).evidenceQa.get()),doc,'PDF/DOCX capture cannot mutate the reviewed editor JSON');assert.deepEqual(await page.locator('.report-final-document [data-export-page] img').evaluateAll(images=>images.map(image=>image.getAttribute('src'))),['/api/cases/evidence/3/download','/api/cases/evidence/1/download','/api/cases/evidence/2/download']);assert.equal(await page.locator('[data-final-export-capture]').count(),0);
      if(outputDir){writeFileSync(resolve(outputDir,'reviewed.docx'),docxBytes);writeFileSync(resolve(outputDir,'reviewed.pdf'),pdfBytes);await page.locator('.report-final-document').screenshot({path:resolve(outputDir,'preview.png')});writeFileSync(resolve(outputDir,'result.json'),JSON.stringify({pass:true,scope:'localhost React + memory HTTP storage, not real Worker DB',pdfPages:parsed.numPages,pdfPhotoRatios,pdfPixelGate:pdfPhotoRatios?'PASS':'NOT_RUN',docxSha:sha(docxBytes),pdfSha:sha(pdfBytes),independentOfficeRender:'NOT_RUN'},null,2));}await parsed.cleanup();
      assert.deepEqual(errors,[]);await page.close();
    });
    await t.test('native DOCX linked-image line box grows while unsafe links remain plain text',async()=>{
      mode='';savedDraft=null;const page=await newPage();await page.keyboard.press('Escape');
      const result=await page.evaluate(async()=>{
        const path='/src/documents/editable-docx-export.ts';const{createEditableDocx}=await import(path),zipPath='/node_modules/.vite/deps/fflate.js';const{unzipSync}=await import(zipPath);
        const root=document.createElement('article');root.dataset.exportDocumentKind='REPORT';root.innerHTML='<section data-export-page><p style="line-height:24px"><a href="https://example.invalid/source"><img src="/api/cases/evidence/1/download" width="200" height="180"></a></p><p style="line-height:24px"><a href="https://example.invalid/text">정상 텍스트 링크</a></p><p><a href="javascript:alert(1)">안전한 원문 보존</a><a href="file:///private">파일 링크 텍스트</a></p></section>';document.body.append(root);
        try{await Promise.all([...root.querySelectorAll('img')].map(img=>img.decode()));const zip=unzipSync(await createEditableDocx(root,'portrait'));const doc=new DOMParser().parseFromString(new TextDecoder().decode(zip['word/document.xml']),'application/xml'),ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';return{xml:new TextDecoder().decode(zip['word/document.xml']),rels:new TextDecoder().decode(zip['word/_rels/document.xml.rels']),rules:[...doc.getElementsByTagNameNS(ns,'p')].map(p=>p.getElementsByTagNameNS(ns,'spacing')[0]?.getAttributeNS(ns,'lineRule'))};}finally{root.remove();}
      });
      assert.equal(result.rules[0],'atLeast');assert.equal(result.rules[1],'exact');assert.match(result.xml,/<w:drawing/);assert.match(result.xml,/안전한 원문 보존/);assert.match(result.xml,/파일 링크 텍스트/);assert.doesNotMatch(result.rels,/javascript:|file:/);assert.match(result.rels,/example.invalid\/source/);await page.close();
    });
  }finally{release?.();await browser.close();await server.close();}
});
