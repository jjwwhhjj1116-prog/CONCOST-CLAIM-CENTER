import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('CF146 actual evidence dialog inserts photos and document locators; JSON survives remount', async () => {
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const server = await createServer({ root: fileURLToPath(new URL('../apps/web', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
    name: 'cf146-evidence',
    configureServer(server) { server.middlewares.use(async (req, res, next) => {
      if (/^\/api\/cases\/evidence\/[123]\/download$/u.test(req.url ?? '')) { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#555"/></svg>'); return; }
      if (req.url === '/api/cases/test-case/evidence') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ files: [1,2,3].map(id => ({id:String(id),originalName:`사진${id}`,mimeType:'image/svg+xml',category:'SITE_PHOTO',downloadUrl:`/api/cases/evidence/${id}/download`})).concat([{id:'4',originalName:'내역.pdf',mimeType:'application/pdf',category:'REPORT_REFERENCE',downloadUrl:'/api/cases/evidence/4/download'}]) })); return; }
      if (req.url !== '/cf146-evidence.html') return next();
      res.setHeader('Content-Type','text/html');
      res.end(await server.transformIndexHtml(req.url,'<!doctype html><html><body><div id="root"></div><script>window.__CLAIM_API_ORIGIN__=location.origin;</script><script type="module" src="/cf146-evidence.js"></script></body></html>'));
    }); },
    resolveId: id => id === '/cf146-evidence.js' ? '\0cf146-evidence' : undefined,
    load: id => id === '\0cf146-evidence' ? `
      import React,{useRef,useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {StructuredDocumentEditor,parseStructuredDocumentMarkdown} from '/src/documents/StructuredDocumentEditor.tsx';
      import {ReportEvidenceInsert} from '/src/documents/ReportEvidenceInsert.tsx';
      import '/src/preview-theme.css'; import '/src/documents/StructuredDocumentEditor.css'; import '/src/documents/DocumentReviewWorkspace.css';
      function App(){
        const editor=useRef(null); const [open,setOpen]=useState(false),[readOnly,setReadOnly]=useState(false),[key,setKey]=useState(0);
        const [json,setJson]=useState(parseStructuredDocumentMarkdown('앞 문단\\n\\n뒤 문단')),[text,setText]=useState('앞 문단\\n\\n뒤 문단');
        window.evidenceQa={get:()=>editor.current.getJSON(),remount:()=>setKey(k=>k+1),readonly:setReadOnly,insert:html=>editor.current.insertHtml(html)};
        return React.createElement(React.Fragment,null,
          React.createElement(StructuredDocumentEditor,{key,ref:editor,value:text,editorJson:json,label:'검수 원고',readOnly,onRequestInsertImage:()=>setOpen(true),onChange:(text,json)=>{setText(text);setJson(json)}}),
          open&&React.createElement(ReportEvidenceInsert,{caseId:'test-case',onClose:()=>setOpen(false),onInsert:html=>editor.current.insertHtml(html)}));
      }createRoot(document.getElementById('root')).render(React.createElement(App));
    ` : undefined
  }] });
  await server.listen();
  const origin='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port;
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1100}}); const errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await page.goto(origin+'/cf146-evidence.html');
    const editor=page.locator('.tiptap.ProseMirror[contenteditable="true"]');
    await editor.waitFor(); await editor.locator('p').first().click(); await page.keyboard.press('End');
    await page.getByRole('button',{name:'이미지',exact:true}).click();
    const dialog=page.getByRole('dialog'); await dialog.waitFor();
    await dialog.getByLabel('쟁점·첨부 제목').fill('층고 확인');
    await dialog.getByLabel('페이지·시트·셀').fill('내역 12쪽 / 구조 D25');
    for(const name of ['사진1','사진2','사진3','내역.pdf']) await dialog.getByRole('checkbox',{name,exact:true}).check();
    await dialog.getByLabel('사진1 설명',{exact:true}).fill('현관 층고 2,480mm');
    await dialog.getByRole('button',{name:'선택 자료를 현재 위치에 넣기'}).click();
    await dialog.waitFor({state:'hidden'});
    const before=await page.evaluate(()=> (window as any).evidenceQa.get());
    const nodes=JSON.stringify(before);
    assert.match(nodes,/층고 확인/); assert.match(nodes,/현관 층고 2,480mm/); assert.match(nodes,/내역 12쪽 \/ 구조 D25/);
    assert.equal((nodes.match(/"type":"image"/gu)??[]).length,3);
    assert.equal((nodes.match(/"reportPhoto":true/gu)??[]).length,3);
    const photos = editor.locator('img[data-report-photo="true"]');
    assert.deepEqual(await photos.evaluateAll(images => images.map(image => getComputedStyle(image).objectFit)), ['contain','contain','contain']);
    assert.ok(nodes.indexOf('앞 문단')<nodes.indexOf('층고 확인') && nodes.indexOf('층고 확인')<nodes.indexOf('뒤 문단'));
    await page.evaluate(()=> (window as any).evidenceQa.remount()); await editor.waitFor();
    assert.deepEqual(await page.evaluate(()=> (window as any).evidenceQa.get()),before);
    await page.evaluate(()=> (window as any).evidenceQa.readonly(true));
    await page.waitForFunction(()=>Boolean(document.querySelector('.tiptap[contenteditable="false"]')));
    assert.equal(await page.evaluate(()=> (window as any).evidenceQa.insert('<p>삽입 금지</p>')),false);
    assert.deepEqual(await page.evaluate(()=> (window as any).evidenceQa.get()),before);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); await server.close(); }
});
