import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { strFromU8, unzipSync } from '../apps/web/node_modules/fflate';
import { getDocumentProxy } from 'unpdf';

test('CF182 real report UI exports unapproved saved DOCX PDF HWP with GET-only access and hides QA from non-admin', async () => {
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const runtimeRoot = resolve('apps/web/dist/rhwp');
  const server = await createServer({ root: resolve('apps/web'), server: {host:'127.0.0.1',port:0,hmr:false}, logLevel:'error', plugins:[{
    name: 'admin-qa-report-fixture',
    configureServer(s) { s.middlewares.use(async (req, res, next) => {
      const pathname = (req.url ?? '').split('?')[0];
      if (pathname.startsWith('/rhwp/')) {
        const file = resolve(runtimeRoot, pathname.slice('/rhwp/'.length));
        if (!file.startsWith(runtimeRoot + '\\') && !file.startsWith(runtimeRoot + '/')) { res.statusCode=403; res.end(); return; }
        res.setHeader('Content-Type',file.endsWith('.json')?'application/json':file.endsWith('.js')?'text/javascript':'application/wasm'); res.end(readFileSync(file)); return;
      }
      if (pathname !== '/admin-qa.html') return next();
      res.setHeader('Content-Type','text/html');
      res.end(await s.transformIndexHtml(req.url!, '<html><body><script>window.__CLAIM_API_ORIGIN__=window.location.origin;</script><div id="root"></div><script type="module" src="/admin-qa-entry.js"></script></body></html>'));
    }); },
    resolveId: id => id === '/admin-qa-entry.js' ? '\0admin-qa-entry' : undefined,
    load: id => id === '\0admin-qa-entry' ? `import React from'react';import{createRoot}from'react-dom/client';import{PreviewReportStudio}from'/src/routes/PreviewReportStudio.tsx';import'/src/theme-system.css';import'/src/routes/PreviewReportStudio.css';import'/src/documents/StructuredDocumentEditor.css';import'/src/documents/DocumentReviewWorkspace.css';createRoot(document.getElementById('root')).render(React.createElement(PreviewReportStudio,{roles:[new URLSearchParams(location.search).get('role')||'admin'],onNavigate:()=>{}}));` : undefined
  }] });
  await server.listen();
  const origin = `http://127.0.0.1:${(server.httpServer!.address() as {port:number}).port}`;
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync); assert.ok(executablePath);
  const browser = await chromium.launch({executablePath,headless:true});
  const json = {type:'doc',attrs:{reportHeader:{enabled:false,text:null},reportFrontMatter:{enabled:false,date:'',author:''}},content:[
    {type:'paragraph',content:[{type:'text',text:'검수용 합성 저장 본문'}]},
    {type:'table',content:[{type:'tableRow',content:[{type:'tableCell',content:[{type:'paragraph',content:[{type:'text',text:'검수 셀'}]}]},{type:'tableCell',content:[{type:'paragraph',content:[{type:'text',text:'123원'}]}]}]}]}
  ]};
  const draft = {caseId:'qa-case',title:'합성 검수 제목',content:'검수용 합성 저장 본문\n\n| 검수 셀 | 123원 |',editorJson:json,version:5,wizardStep:4,selectedChapterId:null,updatedAt:'2026-10-06T04:11:19.766Z'};
  const before = JSON.stringify(draft), methods:string[]=[], errors:string[]=[];
  try {
    const page = await browser.newPage({acceptDownloads:true,viewport:{width:1440,height:1000}}); page.setDefaultTimeout(15000); page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      methods.push(route.request().method()); assert.equal(route.request().method(),'GET','QA must not create review, finalization, output, upload or saved draft records');
      const send = (body:unknown) => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
      switch(url.pathname) {
        case '/api/cases': return send({cases:[{id:'qa-case',caseNumber:'QA-6',title:'합성 시험 사건',claimType:'TYPE03',status:'CONTRACT'}],total:1,nextOffset:null});
        case '/api/report-workspaces': return send({workspaces:[]});
        case '/api/report-drafts': return send({draft,revisions:[],backups:[]});
        case '/api/report-reviews': return send({reviews:[]});
        case '/api/report-finalizations': return send({finalizations:[]});
        case '/api/report-chapter-collaboration': return send({assignments:[],members:[],canManage:true,currentUserId:'qa-admin'});
        case '/api/report-authoring/config': return send({available:true,claimType:'TYPE03',aiConnected:false,chapters:[],templateLibrary:[],templates:[],sourceGroups:[],outlinePlan:{status:'CONFIRMED',version:1,items:[],persistenceAvailable:true},typeGuideline:null});
        default: assert.fail('Unexpected QA API ' + url.pathname);
      }
    });
    await page.goto(origin + '/admin-qa.html?caseId=qa-case');
    await page.getByRole('button',{name:'저장본 검수 미리보기 불러오기',exact:true}).click();
    const output = page.getByLabel('미승인 관리자 검수용 저장 보고서 미리보기',{exact:true});
    await output.locator('[data-export-page]').waitFor();
    assert.equal(await output.locator('[data-export-page]').count(),1);
    assert.match(await output.innerText(), /검수용 합성 저장 본문/);
    const generated:Record<string,Buffer> = {};
    for (const format of ['docx','pdf','hwp']) {
      const downloading = page.waitForEvent('download');
      await page.getByRole('button',{name:`미승인 관리자 검수용 ${format.toUpperCase()} 내려받기`,exact:true}).click();
      const download = await downloading, stream = await download.createReadStream(); assert.ok(stream);
      const chunks:Buffer[]=[]; for await(const chunk of stream) chunks.push(Buffer.from(chunk)); generated[format] = Buffer.concat(chunks);
      assert.match(download.suggestedFilename(),new RegExp(`^QA-6_미승인_관리자검수용_v5_.*\\.${format}$`));
      await page.getByRole('button',{name:'저장본 검수 미리보기 불러오기',exact:true}).waitFor();
      await page.getByText(new RegExp(`미승인 관리자 검수용 ${format.toUpperCase()} · v5 · 1쪽 내려받기 완료`)).waitFor();
    }
    const word = strFromU8(unzipSync(generated.docx)['word/document.xml']);
    assert.match(word,/검수용 합성 저장 본문/); assert.match(word,/<w:tbl>/); assert.match(word,/123원/); assert.match(word,/w:w="11906" w:h="16838"/);
    const pdf = await getDocumentProxy(new Uint8Array(generated.pdf));
    assert.equal(pdf.numPages,1); const view=(await pdf.getPage(1)).getViewport({scale:1}); assert.ok(Math.abs(view.width-595.28)<1 && Math.abs(view.height-841.89)<1);
    const engine = await import(pathToFileURL(resolve('pinned-runtime/pkg/rhwp.js')).href); await engine.default({module_or_path:readFileSync('pinned-runtime/pkg/rhwp_bg.wasm')});
    const hwp = new engine.HwpDocument(new Uint8Array(generated.hwp));
    try { assert.equal(hwp.pageCount(),1); const section=strFromU8(unzipSync(hwp.exportHwpx())['Contents/section0.xml']); assert.match(section,/검수용 합성 저장 본문/); assert.match(section,/<hp:tbl/); assert.match(section,/123원/); } finally { hwp.free(); }
    assert.equal(JSON.stringify(draft),before); assert.equal(methods.every(method=>method==='GET'),true); assert.deepEqual(errors,[]);
    await page.goto(origin + '/admin-qa.html?caseId=qa-case&role=pm');
    await page.locator('.report-current-project--persistent').waitFor();
    assert.equal(await page.getByRole('button',{name:'저장본 검수 미리보기 불러오기',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:/미승인 관리자 검수용 .* 내려받기/}).count(),0);
  } finally { await browser.close(); await server.close(); }
});
