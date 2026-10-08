import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('CF200 actual report route keeps native attachments in HWP and ordinary attachments in the report', { timeout: 120_000 }, async t => {
  const caseId = '40000000-0000-4000-8000-000000000010';
  const chapterId = 'PROMPT-TYPE-01-CH-01';
  const presentationPath = resolve('packages/document-engine/src/report-presentation.ts').replace(/\\/g, '/');
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const server = await createServer({ root: resolve('apps/web'), ...(process.env.CF149_CACHE_ROOT ? { cacheDir: process.env.CF149_CACHE_ROOT } : {}), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', plugins: [{
    name: 'cf200-native-evidence-boundary', enforce: 'pre',
    transform(source, id) {
      if (id.endsWith('/PreviewReportStudio.tsx')) {
        const marker = 'const renderReportHeaderControls =';
        assert.ok(source.includes(marker));
        source = source.replace(marker, `(globalThis as any).cf200Read = () => ({ editorJson: editorJsonRef.current, content: contentRef.current });
          (globalThis as any).cf200UseNative = (draft: any) => { contentRef.current = draft.content; setContent(draft.content); setEditorJson(draft.editorJson); };
          ${marker}`);
        if (process.env.CF200_LEGACY_NATIVE_EVIDENCE === '1') {
          const dispatch = 'if (readReportNativeSource(editorJsonRef.current, selectedCaseId)) { void reopenNativeSource(); return; }';
          assert.ok(source.includes(dispatch));
          source = source.replace(dispatch, '// Test-only old dispatch: let a native report acquire a structural attachment dialog.');
        }
        return source;
      }
      if (id.endsWith('/ReportEvidenceInsert.tsx')) {
        const marker = 'const [localUploader] = useState(createReportEvidenceUploader);';
        assert.ok(source.includes(marker));
        return source.replace(marker, `(globalThis as any).cf200CapturedInsert = onInsert; ${marker}`);
      }
    },
    configureServer(server) { server.middlewares.use(async (req, res, next) => {
      const path = (req.url ?? '').split('?')[0];
      if (/^\/page-[12]\.svg$/u.test(path)) {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123"><rect width="794" height="1123" fill="white"/><text x="80" y="180">CF200 synthetic ${path}</text></svg>`); return;
      }
      if (path !== '/native-evidence.html') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml(req.url!, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/cf200-entry.js"></script></body></html>'));
    }); },
    resolveId: id => id === '/cf200-entry.js' ? '\0cf200-entry' : undefined,
    load: id => id === '\0cf200-entry' ? `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import { PreviewReportStudio } from '/src/routes/PreviewReportStudio.tsx';
      import { parseStructuredDocumentMarkdown } from '/src/documents/StructuredDocumentEditor.tsx';
      import { reportNativeBodySha256 } from '/src/documents/report-native-source.ts';
      import { joinReportPresentation } from '/@fs/${presentationPath}';
      import '/src/preview-theme.css'; import '/src/theme-system.css';
      const params = new URLSearchParams(location.search);
      const nativeContent = '<!-- MANUAL-WHOLE-DOCUMENT:START -->\\n\\n' + [1,2].map(p => '<img src="'+location.origin+'/page-'+p+'.svg" alt="합성 원형 '+p+'쪽" data-report-source-page="true">').join('\\n\\n') + '\\n\\n<!-- MANUAL-WHOLE-DOCUMENT:END -->';
      const nativeBody = parseStructuredDocumentMarkdown(nativeContent);
      nativeBody.attrs = { ...nativeBody.attrs, reportNativeSource: { caseId:'${caseId}', evidenceId:'synthetic-native', downloadUrl:'/api/cases/evidence/synthetic-native/download', name:'synthetic.hwp', byteSize:128, sha256:'a'.repeat(64), bindingVersion:1 } };
      const nativeJson = joinReportPresentation(nativeBody, {enabled:false,text:null}, {enabled:false});
      nativeJson.attrs.reportNativeSource.bodySha256 = await reportNativeBodySha256(nativeJson);
      const nativeDraft = { caseId:'${caseId}', title:'합성 원형 검수 보고서', content:nativeContent, editorJson:nativeJson, version:5, wizardStep:Number(params.get('step') || 4), selectedChapterId:'${chapterId}', updatedAt:'2026-10-08T00:00:00Z', updatedBy:{id:'qa',name:'합성 검수자'} };
      const ordinaryContent = '<!-- MANUAL-WHOLE-DOCUMENT:START -->\\n\\n# 첨부 검수 본문\\n\\n기존 본문·수치 123,456 보존\\n\\n<!-- MANUAL-WHOLE-DOCUMENT:END -->';
      const ordinaryDraft = {...nativeDraft, title:'합성 구조형 검수 보고서', content:ordinaryContent, editorJson:joinReportPresentation(parseStructuredDocumentMarkdown(ordinaryContent),{enabled:false,text:null},{enabled:false})};
      globalThis.cf200NativeDraft = nativeDraft;
      globalThis.cf200InitialDraft = params.has('ordinary') ? ordinaryDraft : nativeDraft;
      createRoot(document.getElementById('root')).render(React.createElement(PreviewReportStudio,{roles:params.has('readonly')?['staff']:['admin'],onNavigate:()=>{}}));
    ` : undefined,
  }] });
  await server.listen();
  const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
  assert.ok(executablePath);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const open = async (step: number, ordinary = false, readonly = false) => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(10_000);
      const errors: string[] = [], unexpected: string[] = [], writes: string[] = [], evidenceReads: URL[] = [];
      page.on('pageerror', error => errors.push(error.message));
      let draft: any;
      await page.route('**/*', async route => {
        const url = new URL(route.request().url()), method = route.request().method();
        if (!url.pathname.startsWith('/api/')) return url.origin === origin ? route.continue() : route.abort();
        const send = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (method !== 'GET') { writes.push(method + ' ' + url.pathname); return send({error:'CF200 forbids synthetic writes'}, 409); }
        if (url.pathname === `/api/cases/${caseId}/evidence`) { evidenceReads.push(url); return send({files:[]}); }
        const chapters = [{id:chapterId,chapterCode:'CH-01',title:'대상·개요',agentCode:'QA',ordinal:1,promptVersion:1}];
        switch (url.pathname) {
          case '/api/cases': return send({cases:[{id:caseId,caseNumber:'CF200-SYNTHETIC',title:'고객 자료 없는 합성 검수',claimType:'TYPE03',status:'CONTRACT'}],total:1,nextOffset:null});
          case '/api/report-workspaces': return send({workspaces:[]});
          case '/api/report-drafts': draft ??= await page.evaluate(() => (globalThis as any).cf200InitialDraft); return send({draft,revisions:[],backups:[]});
          case '/api/report-reviews': return send({reviews:[]});
          case '/api/report-finalizations': return send({finalizations:[]});
          case '/api/report-authoring/config': return send({available:true,claimType:'TYPE03',aiConnected:false,assistantConnected:false,outlineAiConnected:false,chapters,templateLibrary:[],templates:[],sourceGroups:[],typeGuideline:null,outlinePlan:{status:'CONFIRMED',version:1,persistenceAvailable:true,items:chapters.map(c=>({chapterId:c.id,chapterCode:c.chapterCode,chapterTitle:c.title,planningNote:'',promptVersion:1}))}});
          case '/api/report-chapter-collaboration': return send({assignments:[],members:[],canManage:!readonly,currentUserId:'qa'});
          case '/api/report-authoring/case-law': return send({sources:[],citations:[],apiConfigured:false});
          default: unexpected.push(url.pathname); return send({error:'Unexpected CF200 isolated API'}, 404);
        }
      });
      await page.goto(`${origin}/native-evidence.html?caseId=${caseId}&step=${step}${ordinary?'&ordinary=1':''}${readonly?'&readonly=1':''}`);
      await page.getByRole('button',{name:ordinary?'사진·근거자료 넣기':'연결 HWP에서 첨부자료 편집',exact:true}).waitFor();
      await page.waitForFunction(() => Boolean((globalThis as any).cf200Read?.().editorJson?.content?.length));
      const before = await page.evaluate(() => (globalThis as any).cf200Read());
      return {page,errors,unexpected,writes,evidenceReads,before,getDraft:()=>draft};
    };
    for (const step of [3,4]) await t.test(`native step ${step} header and image toolbar route to HWP without a structural dialog`, async () => {
      const f = await open(step);
      try {
        for (const label of ['연결 HWP에서 첨부자료 편집','이미지']) {
          const count = f.evidenceReads.length;
          const response = f.page.waitForResponse(r => new URL(r.url()).pathname === `/api/cases/${caseId}/evidence`);
          await f.page.getByRole('button',{name:label,exact:true}).click(); await response;
          await f.page.getByText('현재 프로젝트 자료 목록에서 연결된 HWP 편집본을 확인하지 못했습니다. 자료실의 원본을 확인해 주세요.',{exact:true}).waitFor();
          assert.equal(f.evidenceReads.length,count+1);
          assert.equal(f.evidenceReads.at(-1)!.searchParams.get('category'),'REPORT_REFERENCE');
          assert.equal(f.evidenceReads.at(-1)!.searchParams.get('evidenceId'),'synthetic-native');
          assert.equal(await f.page.locator('.report-evidence-insert').count(),0);
          assert.deepEqual(await f.page.evaluate(() => (globalThis as any).cf200Read()),f.before,'Native live JSON, source fingerprint and content remain exact');
        }
        await f.page.waitForTimeout(3_300);
        assert.deepEqual(f.writes,[]); assert.deepEqual(f.unexpected,[]); assert.deepEqual(f.errors,[]);
        assert.deepEqual(f.getDraft(),await f.page.evaluate(() => (globalThis as any).cf200InitialDraft));
      } finally { await f.page.close(); }
    });
    for (const step of [3,4]) await t.test(`ordinary step ${step} keeps header and image toolbar attachment insertion available`, async () => {
      const f = await open(step,true);
      try {
        for (const label of ['사진·근거자료 넣기','이미지']) {
          const count = f.evidenceReads.length;
          await f.page.getByRole('button',{name:label,exact:true}).click();
          await f.page.getByRole('dialog',{name:'쟁점·사진·산출 근거 넣기',exact:true}).waitFor();
          await f.page.getByText('등록된 자료가 없습니다. PC에서 추가해 주세요.',{exact:true}).waitFor();
          assert.equal(f.evidenceReads.length,count+1);
          assert.equal(f.evidenceReads.at(-1)!.search,'');
          assert.equal(await f.page.getByRole('button',{name:'선택 자료를 현재 위치에 넣기',exact:true}).isDisabled(),true);
          await f.page.keyboard.press('Escape'); await f.page.locator('.report-evidence-insert').waitFor({state:'hidden'});
          assert.deepEqual(await f.page.evaluate(() => (globalThis as any).cf200Read()),f.before);
        }
        assert.deepEqual(f.writes,[]); assert.deepEqual(f.unexpected,[]); assert.deepEqual(f.errors,[]);
      } finally { await f.page.close(); }
    });
    await t.test('a retained ordinary-dialog callback cannot insert after the latest document becomes native',async()=>{
      const f=await open(4,true);
      try {
        await f.page.getByRole('button',{name:'사진·근거자료 넣기',exact:true}).click();
        await f.page.getByRole('dialog',{name:'쟁점·사진·산출 근거 넣기',exact:true}).waitFor();
        const result=await f.page.evaluate(()=>{const native=(globalThis as any).cf200NativeDraft;const callback=(globalThis as any).cf200CapturedInsert;(globalThis as any).cf200UseNative(native);return{applied:callback('<p>CF200 MUST NOT INSERT</p>'),current:(globalThis as any).cf200Read(),expected:{editorJson:native.editorJson,content:native.content}};});
        assert.equal(result.applied,false);assert.deepEqual(result.current,result.expected);
        await f.page.locator('.report-evidence-insert').waitFor({state:'hidden'});
        assert.doesNotMatch(await f.page.locator('.tiptap').innerText(),/CF200 MUST NOT INSERT/u);
        assert.deepEqual(f.writes,[]);assert.deepEqual(f.unexpected,[]);assert.deepEqual(f.errors,[]);
      } finally {await f.page.close();}
    });
    await t.test('readonly native report cannot request either attachment path',async()=>{
      const f=await open(4,false,true);
      try {
        assert.equal(await f.page.getByRole('button',{name:'연결 HWP에서 첨부자료 편집',exact:true}).isDisabled(),true);
        assert.equal(await f.page.getByRole('button',{name:'이미지',exact:true}).count(),0);
        assert.deepEqual(f.evidenceReads,[]);assert.deepEqual(f.writes,[]);assert.deepEqual(f.unexpected,[]);assert.deepEqual(f.errors,[]);
      } finally {await f.page.close();}
    });
  } finally { await browser.close(); await server.close(); }
});
