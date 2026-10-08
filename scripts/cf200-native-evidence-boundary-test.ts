import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('CF200 actual report route keeps native attachments in HWP and ordinary attachments in the report', { timeout: 180_000 }, async t => {
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
          (globalThis as any).cf202Read = () => ({ chapterStepComplete, dirty, saving, version });
          (globalThis as any).cf200UseNative = (draft: any) => { contentRef.current = draft.content; setContent(draft.content); setEditorJson(draft.editorJson); };
          ${marker}`);
        if (process.env.CF200_LEGACY_NATIVE_EVIDENCE === '1') {
          const dispatch = 'if (readReportNativeSource(editorJsonRef.current, selectedCaseId)) { void reopenNativeSource(); return; }';
          assert.ok(source.includes(dispatch));
          source = source.replace(dispatch, '// Test-only old dispatch: let a native report acquire a structural attachment dialog.');
        }
        return source;
      }
      if (id.endsWith('/StructuredDocumentEditor.tsx')) {
        const marker = 'useImperativeHandle(ref, () => ({';
        assert.ok(source.includes(marker));
        source = source.replace(marker, `(globalThis as any).cf202Editor = editor; ${marker}`);
        if (process.env.CF202_LEGACY_MANUAL_MARKERS === '1') {
          const extension = '...(reportMode && !collaborationSession ? [PreserveManualReportMode.configure({isEnabled:()=>manualModeContextRef.current.key===documentKey && manualModeContextRef.current.enabled})] : []),';
          assert.ok(source.includes(extension));
          source = source.replace(extension, '// Test-only previous editor: no manual-mode transaction preservation.');
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
      const mode = params.get('mode');
      if (mode === 'no-pair' || mode === 'ai') {
        ordinaryDraft.content = (mode === 'ai' ? '<!-- AI-CHAPTER:CH-01:START -->\\n\\n' : '') + '# 경계 검수 본문\\n\\nCF202 initial source' + (mode === 'ai' ? '\\n\\n<!-- AI-CHAPTER:CH-01:END -->' : '');
        ordinaryDraft.editorJson = joinReportPresentation(parseStructuredDocumentMarkdown(ordinaryDraft.content),{enabled:false,text:null},{enabled:false});
      }
      if (mode === 'raw-native') ordinaryDraft.editorJson.attrs.reportNativeSource = {caseId:'wrong-case',bodySha256:'RAW INVALID MUST NOT REWRITE'};
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
    const open = async (step: number, ordinary = false, readonly = false, options: {allowSave?:boolean; mode?:string; tenChapters?:boolean} = {}) => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(10_000);
      const errors: string[] = [], unexpected: string[] = [], writes: string[] = [], evidenceReads: URL[] = [];
      const savedBodies: any[] = [];
      page.on('pageerror', error => errors.push(error.message));
      let draft: any;
      await page.route('**/*', async route => {
        const url = new URL(route.request().url()), method = route.request().method();
        if (!url.pathname.startsWith('/api/')) return url.origin === origin ? route.continue() : route.abort();
        const send = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (method !== 'GET') {
          writes.push(method + ' ' + url.pathname);
          if (options.allowSave && method === 'PUT' && url.pathname === '/api/report-drafts' && url.searchParams.get('caseId') === caseId) {
            const body = route.request().postDataJSON();
            assert.equal(body.expectedVersion, draft.version);
            savedBodies.push(body);
            draft = {caseId,title:body.title,content:body.content,editorJson:body.editorJson,version:body.expectedVersion+1,wizardStep:body.wizardStep,selectedChapterId:body.selectedChapterId,updatedAt:'2026-10-08T01:00:00Z',updatedBy:{id:'qa',name:'합성 검수자'}};
            return send({draft,revisions:[],backups:[]});
          }
          return send({error:'CF200 forbids synthetic writes'}, 409);
        }
        if (url.pathname === `/api/cases/${caseId}/evidence`) { evidenceReads.push(url); return send({files:[]}); }
        const chapters = Array.from({length:options.tenChapters?10:1},(_,i)=>({id:i===0?chapterId:`PROMPT-TYPE-01-CH-${String(i+1).padStart(2,'0')}`,chapterCode:`CH-${String(i+1).padStart(2,'0')}`,title:i===0?'대상·개요':`합성 항목 ${i+1}`,agentCode:'QA',ordinal:i+1,promptVersion:1}));
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
      await page.goto(`${origin}/native-evidence.html?caseId=${caseId}&step=${step}${ordinary?'&ordinary=1':''}${readonly?'&readonly=1':''}${options.mode?'&mode='+options.mode:''}`);
      await page.getByRole('button',{name:ordinary?'사진·근거자료 넣기':'연결 HWP에서 첨부자료 편집',exact:true}).waitFor();
      await page.waitForFunction(() => Boolean((globalThis as any).cf200Read?.().editorJson?.content?.length));
      const before = await page.evaluate(() => (globalThis as any).cf200Read());
      return {page,errors,unexpected,writes,evidenceReads,before,savedBodies,getDraft:()=>draft};
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
    const markers = (json: any) => (json.content ?? []).filter((node:any)=>node.type==='aiChapterMarker' && /^MANUAL-WHOLE-DOCUMENT:(?:START|END)$/u.test(String(node.attrs?.marker))).map((node:any)=>node.attrs.marker);
    const pair = ['MANUAL-WHOLE-DOCUMENT:START','MANUAL-WHOLE-DOCUMENT:END'];
    const live = (page: any) => page.evaluate(() => (globalThis as any).cf202Editor.getJSON());
    await t.test('CF202 Ctrl+A replacement keeps manual mode, caret, undo, ten H2 sections, autosave and reopen',async()=>{
      const f=await open(3,true,false,{allowSave:true,tenChapters:true});
      try {
        assert.equal(await f.page.evaluate(()=>(globalThis as any).cf202Read().chapterStepComplete),true);
        await f.page.locator('.tiptap').click();
        await f.page.keyboard.press('Control+a');await f.page.keyboard.press('Backspace');
        assert.deepEqual(markers(await live(f.page)),pair,'A real document deletion retains exactly one invisible mode pair');
        try {await f.page.waitForFunction(()=>(globalThis as any).cf202Read().chapterStepComplete===false,{},{timeout:1_000});}
        catch {assert.fail('CF202 deletion state: '+JSON.stringify(await f.page.evaluate(()=>({live:(globalThis as any).cf202Editor.getJSON(),parent:(globalThis as any).cf200Read(),stage:(globalThis as any).cf202Read()}))));}
        assert.equal(await f.page.evaluate(()=>(globalThis as any).cf202Read().chapterStepComplete),false,'Marker-only is not a completed draft');
        for(let i=1;i<=10;i++){
          await f.page.getByLabel('문단 스타일',{exact:true}).selectOption('h2');
          await f.page.keyboard.type(`CF202 section ${String(i).padStart(2,'0')}`);
          await f.page.keyboard.press('Enter');
          await f.page.getByLabel('문단 스타일',{exact:true}).selectOption('paragraph');
          await f.page.keyboard.type(`CF202 body ${String(i).padStart(2,'0')} amount 123.45`);
          await f.page.keyboard.press('Enter');
        }
        const typed=await live(f.page);
        assert.deepEqual(markers(typed),pair);
        assert.deepEqual(typed.content.filter((node:any)=>node.type==='heading'&&node.attrs.level===2).map((node:any)=>node.content?.map((part:any)=>part.text??'').join('')),Array.from({length:10},(_,i)=>`CF202 section ${String(i+1).padStart(2,'0')}`),'Caret never jumps to an earlier section');
        assert.equal(await f.page.evaluate(()=>(globalThis as any).cf202Read().chapterStepComplete),true);
        await f.page.waitForTimeout(600);
        await f.page.keyboard.type('CF202 undo sentinel');
        const withSentinel=await live(f.page);
        await f.page.keyboard.press('Control+z');
        assert.deepEqual(await live(f.page),typed,'Undo is one editing history step, not a parent setContent reset');
        await f.page.keyboard.press('Control+y');
        assert.deepEqual(await live(f.page),withSentinel,'Redo restores the exact body and mode pair');
        await f.page.waitForFunction(() => {const s=(globalThis as any).cf202Read();return s.version>5&&!s.dirty&&!s.saving;});
        assert.ok(f.savedBodies.some(body=>body.saveKind==='AUTO'),'Actual autosave consumes and verifies the mock ACK');
        assert.ok(f.writes.every(write=>write==='PUT /api/report-drafts'));
        const saved=f.getDraft();
        assert.deepEqual(markers(saved.editorJson),pair);
        assert.equal(saved.wizardStep,3);
        await f.page.reload();
        await f.page.getByRole('button',{name:'사진·근거자료 넣기',exact:true}).waitFor();
        await f.page.waitForFunction(() => Boolean((globalThis as any).cf202Editor?.isInitialized));
        assert.deepEqual(await live(f.page),withSentinel,'Saved editor JSON is identical after a real route reload');
        assert.equal(await f.page.evaluate(()=>(globalThis as any).cf202Read().chapterStepComplete),true,'Step 3 remains complete after reopen');
        assert.deepEqual(f.unexpected,[]);assert.deepEqual(f.errors,[]);
      } finally {await f.page.close();}
    });
    await t.test('CF202 transaction wraps only metadata while preserving rich text, table, image and attributes exactly',async()=>{
      const f=await open(4,true);
      try {
        const result=await f.page.evaluate(()=>{
          const editor=(globalThis as any).cf202Editor;
          const body=editor.schema.nodeFromJSON({type:'doc',attrs:{reportNativeSource:null},content:[
            {type:'paragraph',attrs:{textAlign:'right'},content:[{type:'text',text:'CF202 exact rich body 0 | <literal>',marks:[{type:'bold'}]}]},
            {type:'table',attrs:{documentDefaultsVersion:2,tableWidth:80,tableAlignment:'left',tableDensity:'compact'},content:[{type:'tableRow',attrs:{rowHeightMm:12},content:[{type:'tableCell',attrs:{colspan:1,rowspan:1,colwidth:[200],verticalAlignment:'top',horizontalAlignment:'left'},content:[{type:'paragraph',content:[{type:'text',text:'0'}]}]},{type:'tableCell',attrs:{colspan:1,rowspan:1,colwidth:[200],verticalAlignment:'middle',horizontalAlignment:'right'},content:[{type:'paragraph',content:[{type:'text',text:'246.90'}]}]}]}]},
            {type:'image',attrs:{src:location.origin+'/page-1.svg',alt:'CF202 synthetic image',title:'NO CUSTOMER DATA',width:300,height:424,alignment:'right',reportPhoto:true}},
            {type:'paragraph'}
          ]});
          editor.view.dispatch(editor.state.tr.replaceWith(0,editor.state.doc.content.size,body.content));
          return {expected:body.toJSON(),actual:editor.getJSON()};
        });
        assert.deepEqual(markers(result.actual),pair);
        assert.deepEqual({...result.actual,content:result.actual.content.filter((node:any)=>node.type!=='aiChapterMarker')},result.expected,'The append transaction preserves every non-marker node, raw value and layout attribute');
        const intact=await live(f.page);
        await f.page.evaluate(()=>{const e=(globalThis as any).cf202Editor;e.view.dispatch(e.state.tr.insertText(' exact tail',2));});
        assert.deepEqual(markers(await live(f.page)),pair,'An existing proper pair is never duplicated');
        assert.deepEqual((await live(f.page)).content.filter((node:any)=>node.type==='table'||node.type==='image'),intact.content.filter((node:any)=>node.type==='table'||node.type==='image'));
        assert.deepEqual(f.writes,[]);assert.deepEqual(f.unexpected,[]);assert.deepEqual(f.errors,[]);
      } finally {await f.page.close();}
    });
    for(const mode of ['no-pair','ai','raw-native']) await t.test(`CF202 ${mode} input cannot acquire an automatic manual pair`,async()=>{
      const f=await open(3,true,false,{mode,tenChapters:true});
      try {
        const source=(await live(f.page)).attrs?.reportNativeSource;
        await f.page.locator('.tiptap').click();await f.page.keyboard.press('Control+a');await f.page.keyboard.press('Backspace');
        await f.page.keyboard.type('CF202 replacement without automatic manual mode');
        const after=await live(f.page);
        assert.deepEqual(markers(after),[]);
        assert.equal(await f.page.evaluate(()=>(globalThis as any).cf202Read().chapterStepComplete),false);
        if(mode==='raw-native') assert.deepEqual(after.attrs.reportNativeSource,source,'Even an invalid raw pointer blocks wrapping and is never rehashed');
        assert.deepEqual(f.writes,[]);assert.deepEqual(f.unexpected,[]);assert.deepEqual(f.errors,[]);
      } finally {await f.page.close();}
    });
    await t.test('CF202 current raw native attribute and silent programmatic replacement remain outside mode repair',async()=>{
      const f=await open(4,true);
      try {
        const result=await f.page.evaluate(()=>{
          const e=(globalThis as any).cf202Editor;
          const body=e.schema.nodeFromJSON({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'CF202 raw native replacement'}]}]});
          const raw={caseId:'invalid-case',bodySha256:'RAW INVALID DO NOT REHASH'};
          e.view.dispatch(e.state.tr.setDocAttribute('reportNativeSource',raw).replaceWith(0,e.state.doc.content.size,body.content));
          return {raw,json:e.getJSON()};
        });
        assert.deepEqual(markers(result.json),[]);assert.deepEqual(result.json.attrs.reportNativeSource,result.raw);
        await f.page.evaluate(()=>{const initial=(globalThis as any).cf200InitialDraft;(globalThis as any).cf200UseNative(initial);});
        await f.page.waitForFunction(()=>Boolean((globalThis as any).cf202Editor?.getJSON().content[0]?.attrs?.marker==='MANUAL-WHOLE-DOCUMENT:START'));
        const silent=await f.page.evaluate(()=>{const e=(globalThis as any).cf202Editor;e.commands.setContent({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'CF202 authoritative no-pair revision'}]}]},{emitUpdate:false});return e.getJSON();});
        assert.deepEqual(markers(silent),[],'preventUpdate setContent is authoritative, not a user deletion');
        assert.deepEqual(f.writes,[]);assert.deepEqual(f.unexpected,[]);assert.deepEqual(f.errors,[]);
      } finally {await f.page.close();}
    });
    await t.test('CF202 hidden whole/chapter metadata alone cannot satisfy draft completion',async()=>{
      const f=await open(3,true,false,{tenChapters:true});
      try {
        await f.page.evaluate(()=>{const e=(globalThis as any).cf202Editor;const node=e.schema.nodeFromJSON({type:'doc',content:['MANUAL-WHOLE-DOCUMENT:START','AI-CHAPTER:CH-01:START','AI-CHAPTER:CH-01:END','MANUAL-WHOLE-DOCUMENT:END'].map(marker=>({type:'aiChapterMarker',attrs:{marker}}))});e.view.dispatch(e.state.tr.replaceWith(0,e.state.doc.content.size,node.content));});
        assert.deepEqual(markers(await live(f.page)),pair);
        assert.equal(await f.page.evaluate(()=>(globalThis as any).cf202Read().chapterStepComplete),false);
        assert.deepEqual(f.writes,[]);assert.deepEqual(f.unexpected,[]);assert.deepEqual(f.errors,[]);
      } finally {await f.page.close();}
    });
  } finally { await browser.close(); await server.close(); }
});
