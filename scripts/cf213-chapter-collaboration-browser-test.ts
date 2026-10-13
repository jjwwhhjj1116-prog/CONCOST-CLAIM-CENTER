import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { chromium, type Page } from 'playwright-core';
import { splitReportPresentation } from '../packages/document-engine/src/report-presentation';

// Production React/editor/event handlers; only the existing, customer-free
// CF114 API fixture is extended in Vite memory. No source fixture is rewritten.
test('CF213 actual chapter workspace edits rich content, reopens and applies without losing unrelated work', async t => {
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const beforeSource = process.env.CF213_BEFORE === '1' ? execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, 'show', 'a49b7a2:apps/web/src/routes/PreviewReportStudio.tsx'], { encoding: 'utf8' }) : null;
  const server = await createServer({ root: resolve('apps/web'), cacheDir: process.env.CF149_CACHE_ROOT ?? resolve('tmp/cf213-qa/browser-cache'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', plugins: [{
    name: 'cf213-chapter-workspace', enforce: 'pre',
    configureServer(server) { server.middlewares.use((req, res, next) => {
      if (req.url !== '/api/cases/evidence/cf213-photo/download') return next();
      res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#1b7093"/><text x="12" y="50" fill="white">CF213 SYNTHETIC</text></svg>');
    }); },
    transform(source, id) {
      const normalized = id.replaceAll('\\', '/');
      if (beforeSource && normalized.endsWith('/src/routes/PreviewReportStudio.tsx')) return beforeSource;
      if (!normalized.endsWith('/qa/cf114-studio.tsx')) return;
      source = source.replaceAll('\r\n', '\n');
      const replace = (old: string, next: string) => { assert.ok(source.includes(old), `CF213 existing fixture anchor missing: ${old}`); source = source.replace(old, next); };
      replace('import { editorHtmlToMarkdown, renderStructuredDocumentHtml }', 'import { editorHtmlToMarkdown, renderStructuredDocumentHtml, parseStructuredDocumentMarkdown }');
      replace("selectedChapterId: 'ch2'", "selectedChapterId: params.get('chapter') || 'ch2'");
      replace("canEdit: true }));", "canEdit: !assigned || ch.id === 'ch2', draftEditorJson: parseStructuredDocumentMarkdown('<!-- MANUAL-CHAPTER:'+ch.chapterCode+':START -->\\n## '+ch.chapterCode+' '+ch.title+'\\n\\n'+ch.chapterCode+' 협업 검수 원고입니다.\\n<!-- MANUAL-CHAPTER:'+ch.chapterCode+':END -->') }));");
      replace('window.fetch = async (input, init) => {', `
        let failReport=false,holdReport=false,holdChapter=false;
        const cf213 = { posts: [], reportWrites: [], pendingReport:false,releaseReport:null,pendingChapter:false,releaseChapter:null, read: () => structuredClone({assignments,draft,log}), failNext: () => {failSave=true},failNextReport:()=>{failReport=true},holdNextReport:()=>{holdReport=true},holdNextChapter:()=>{holdChapter=true} };
        window.cf213 = cf213;
        window.fetch = async (input, init) => {`);
      replace("if (method === 'POST' && url.pathname === '/api/report-chapter-collaboration') {\n    const body = JSON.parse(String(init?.body));", `if (method === 'POST' && url.pathname === '/api/report-chapter-collaboration') {
        const body = JSON.parse(String(init?.body)); cf213.posts.push(structuredClone(body));
        if(body.action==='SAVE'&&holdChapter){holdChapter=false;cf213.pendingChapter=true;await new Promise(resolve=>{cf213.releaseChapter=()=>{cf213.pendingChapter=false;resolve()}})}`);
      replace("draftText: body.draftText, status: body.action === 'APPLY'", "draftText: body.draftText, draftEditorJson: body.draftEditorJson ?? assignment.draftEditorJson, status: body.action === 'APPLY'");
      replace('const merged = mergeGeneratedChapter(before, assignment.chapterCode, body.draftEditorJson);', 'const merged = mergeGeneratedChapter(before, assignment.chapterCode, assignment.draftEditorJson);');
      replace('incomingStructuredNodes: body.draftEditorJson.content?.length', 'incomingStructuredNodes: assignment.draftEditorJson.content?.length');
      replace("if (method === 'PUT' && url.pathname === '/api/report-drafts') {\n    const body = JSON.parse(String(init?.body));", `if (method === 'PUT' && url.pathname === '/api/report-drafts') {
        const body = JSON.parse(String(init?.body)); cf213.reportWrites.push(structuredClone(body));
        if(failReport){failReport=false;return response({error:'CF213 합성 전체 저장 실패'},503)}
        if(holdReport){holdReport=false;cf213.pendingReport=true;await new Promise(resolve=>{cf213.releaseReport=()=>{cf213.pendingReport=false;resolve()}})}`);
      replace("return response({ files: [], storagePolicy: 'GOOGLE_DRIVE_REQUIRED', googleDriveConnected: false });", "return response({ files: [{id:'cf213-photo',originalName:'CF213 합성 사진',mimeType:'image/svg+xml',category:'SITE_PHOTO',downloadUrl:'/api/cases/evidence/cf213-photo/download'}], storagePolicy: 'GOOGLE_DRIVE_REQUIRED', googleDriveConnected: false });");
      replace("createRoot(document.getElementById('root')!).render(params.has('release') ? <ReleaseFixture/> : params.has('delivery') ? <PreviewDeliveryCenter onNavigate={path => audit(`이동 요청: ${path}`)}/> : <PreviewReportStudio roles={assigned ? ['staff'] : ['pm']} onNavigate={path => audit(`이동 요청: ${path}`)} />);", `
        const root = createRoot(document.getElementById('root')); let mount=0;
        const render=()=>root.render(<PreviewReportStudio key={mount} roles={assigned?['staff']:['pm']} onNavigate={path=>audit('이동 요청: '+path)}/>);
        window.cf213Remount=()=>{mount++;render()};render();`);
      return source;
    }
  }] });
  await server.listen();
  const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
  assert.ok(executablePath);
  const browser = await chromium.launch({ executablePath, headless: true });
  const errors: string[] = [];
  const open = async (assigned: boolean) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(10_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/qa/cf114-studio.html?step=4${assigned ? '&assigned=1' : ''}`);
    await page.getByRole('textbox', { name: '보고서 제목', exact: true }).waitFor();
    const tool = page.locator('.report-review-tools-row').getByRole('button', { name: /^챕터별 분담/u });
    if (await tool.getAttribute('aria-expanded') !== 'true') await tool.click();
    await page.locator('.report-chapter-collaboration').waitFor();
    if (assigned) await page.locator('.report-chapter-workbench').getByRole('button', { name: '선택 챕터 보기', exact: true }).click();
    return page;
  };
  const state = (page: Page) => page.evaluate(() => (window as any).cf213.read()) as Promise<any>;
  const workbench = (page: Page) => page.locator('.report-chapter-workbench');
  const pane = (page: Page) => page.locator('.report-review-fields > [data-chapter-document]');
  const checkPhotoColumns = async (page: Page, expectedColumns=2) => {
    const [editor,preview]=await page.evaluate(()=>[
      '.report-review-fields > [data-chapter-document] .tiptap table',
      '.report-review-fields > [data-chapter-document] [data-export-page] table'
    ].map(selector=>{
        const table=[...document.querySelectorAll<HTMLTableElement>(selector)].find(table=>table.querySelector('img[data-report-photo="true"]'));if(!table)return null;
        const cells=[...table.rows[0].cells].map(cell=>({width:cell.getBoundingClientRect().width,colwidth:cell.getAttribute('colwidth')}));
        const sum=cells.reduce((total,cell)=>total+cell.width,0);
        return {cells,sum,ratios:cells.map(cell=>cell.width/sum),cols:[...table.querySelectorAll('col')].map(col=>({style:col.getAttribute('style'),width:col.getAttribute('width')}))};
    }));
    assert.ok(editor&&preview,'The edited and paginated photo tables must both exist');
    t.diagnostic(`CF213 photo columns ${JSON.stringify({editor,preview})}`);
    for(const table of [editor,preview]){
      assert.equal(table.cells.length,expectedColumns);assert.equal(table.cols.length,expectedColumns);
      if(expectedColumns===2)assert.ok(Math.abs(table.cells[0].width-table.cells[1].width)<=.1,'A requested two-column photo layout remains equal-width within browser geometry precision');
      else assert.equal(table.ratios[0],1,'One-column photo layout uses exactly its single full-width cell');
    }
    assert.ok(Math.abs(editor.ratios[0]-preview.ratios[0])*Math.max(editor.sum,preview.sum)<=.1,'Editor and preview column proportions cannot differ');
  };
  const waitForLocal = async (page: Page, kind: 'body' | 'late-title' | 'late-body') => {
    const until=Date.now()+10_000;
    while(Date.now()<until){
      const snapshot=await page.evaluate(async kind=>{
        const modulePath='/src/documents/local-document-recovery.ts',api=await import(modulePath);const journal=api.createLocalDocumentRecovery({accountId:'qa',workspaceId:'report:cf114-case'});
        for(const item of await journal.list()){const record=await journal.read(item.snapshotId);if(record?.payload.dirty&&(kind==='body'?JSON.stringify(record.payload.editorJson).includes('CF213 종료 전 복구 검수'):kind==='late-body'?JSON.stringify(record.payload.editorJson).includes('CF213 저장 중 새 본문'):record.payload.title==='CF213 저장 ACK 뒤에도 남아야 하는 새 제목'))return record}return null;
      },kind);
      if(snapshot)return snapshot;
      await page.waitForTimeout(100);
    }
    assert.fail(`Actual report root did not persist the ${kind} recovery snapshot`);
  };
  try {
    await t.test('assigned staff uses the real rich editor, inserts a table/photo, autosaves and reopens that same JSON', async () => {
      const page = await open(true);
      try {
        const before = await state(page), editor = pane(page).locator('.tiptap[contenteditable="true"]');
        await editor.waitFor();
        await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter');
        await pane(page).getByRole('button', { name: '굵게', exact: true }).click();
        await page.keyboard.insertText('CF213 담당 원문 <합성> 0');
        await pane(page).getByRole('button', { name: '굵게', exact: true }).click();
        await page.keyboard.press('Enter');
        await pane(page).getByRole('button', { name: '표 삽입', exact: true }).click();
        const tableDialog = page.getByRole('dialog', { name: '표 크기 설정' });
        await tableDialog.getByLabel('행 수', { exact: true }).fill('2'); await tableDialog.getByLabel('열 수', { exact: true }).fill('2');
        await tableDialog.getByRole('button', { name: /2행 × 2열 표 만들기/u }).click();
        await editor.locator('th,td').first().click(); await page.keyboard.insertText('CF213 셀 <합성>');
        await editor.locator('th,td').nth(1).click(); await page.keyboard.insertText('0');
        await editor.click(); await page.keyboard.press('Control+End');
        await pane(page).getByRole('button', { name: '이미지', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '쟁점·사진·산출 근거 넣기' }); await dialog.waitFor();
        await dialog.getByLabel('쟁점·첨부 제목').fill('CF213 담당 사진');
        await dialog.getByRole('checkbox', { name: 'CF213 합성 사진', exact: true }).check();
        await dialog.getByLabel('CF213 합성 사진 설명', { exact: true }).fill('CF213 합성 캡션 원문');
        await dialog.getByRole('button', { name: '선택 자료를 현재 위치에 넣기', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => { const s=(window as any).cf213.read(); return s.assignments.find((a:any)=>a.chapterId==='ch2').draftEditorJson && JSON.stringify(s.assignments.find((a:any)=>a.chapterId==='ch2').draftEditorJson).includes('CF213 합성 캡션 원문'); }, null, { timeout: 15_000 });
        const saved = await state(page), chapter = saved.assignments.find((a: any) => a.chapterId === 'ch2');
        const json = JSON.stringify(chapter.draftEditorJson);
        assert.match(json, /CF213 담당 원문 <합성> 0/u); assert.match(json, /"type":"bold"/u); assert.match(json, /CF213 셀 <합성>/u);
        assert.equal((json.match(/"type":"image"/gu) ?? []).length, 1);
        assert.equal((json.match(/"type":"table"/gu) ?? []).length, 2, 'one editable table plus the single photo-layout table');
        assert.deepEqual(saved.draft, before.draft, 'Chapter autosave must not mutate or PUT the whole report');
        assert.deepEqual(saved.assignments.find((a: any) => a.chapterId === 'ch1'), before.assignments.find((a: any) => a.chapterId === 'ch1'));
        assert.deepEqual(await page.evaluate(() => (window as any).cf213.reportWrites), []);
        const measuring = pane(page).locator('.report-pagination-source');
        assert.deepEqual(await measuring.evaluate(node=>({visibility:getComputedStyle(node).visibility,position:getComputedStyle(node).position})),{visibility:'hidden',position:'absolute'},'The measuring source must not be painted as a duplicate chapter page');
        await page.waitForFunction(()=>{const sheets=[...document.querySelectorAll('.report-review-fields > [data-chapter-document] [data-export-page]')];return sheets.length>0&&sheets.every(node=>node.getAttribute('data-page-fit-overflow')==='false')});
        assert.equal(await pane(page).locator('[data-export-page]').count(),1,'This measured small chapter fits one A4 page');
        assert.equal(await pane(page).locator('[data-export-page] img[data-report-photo="true"]').count(),1,'One edited photo is painted once in the true paginated preview');
        assert.equal(await pane(page).locator('[data-export-page]').getByText('CF213 합성 캡션 원문',{exact:true}).count(),1);
        await checkPhotoColumns(page);
        const plainTables=await page.evaluate(()=>[
          '.report-review-fields > [data-chapter-document] .tiptap table',
          '.report-review-fields > [data-chapter-document] [data-export-page] table'
        ].map(selector=>{
          const table=[...document.querySelectorAll<HTMLTableElement>(selector)].find(table=>!table.querySelector('img[data-report-photo="true"]'));if(!table)return null;
          const widths=[...table.rows[0].cells].map(cell=>cell.getBoundingClientRect().width),sum=widths.reduce((total,width)=>total+width,0);
          return {widths,sum,ratios:widths.map(width=>width/sum),html:table.outerHTML};
        }));
        t.diagnostic(`CF213 ordinary table columns ${JSON.stringify(plainTables)}`);
        assert.ok(plainTables[0]&&plainTables[1]);
        assert.ok(Math.abs(plainTables[0].ratios[0]-plainTables[1].ratios[0])*Math.max(plainTables[0].sum,plainTables[1].sum)<=.1,'The newly inserted ordinary table must retain the same column proportions in the editor and paginated preview');
        const tools=page.locator('.report-review-tools-row');
        assert.equal(await tools.locator('.report-review-tool-tab').count(),3);
        assert.equal(await tools.locator('.report-review-tool-body').count(),1);
        await tools.getByRole('button',{name:/^챕터별 분담/u}).click();
        assert.equal(await tools.locator('.report-review-tool-body').count(),0);
        assert.equal(await pane(page).getByText('담당: 합성 담당자 · 이 챕터 작성 가능 · 분담 작성 중',{exact:true}).isVisible(),true,'The current assignee and edit authority remain visible even with the assignment panel closed');
        await editor.waitFor();assert.match(await editor.innerText(),/CF213 셀 <합성>/u,'Closing the assignment panel cannot close or reset the active chapter editor');
        for(const name of [/^목차 제목 수정/u,/^판례 인용 검수/u,/^챕터별 분담/u]){
          await tools.getByRole('button',{name}).click();assert.equal(await tools.locator('.report-review-tool-body').count(),1);await editor.waitFor();
          assert.deepEqual((await state(page)).assignments.find((a:any)=>a.chapterId==='ch2').draftEditorJson,chapter.draftEditorJson);
        }
        if(process.env.CF213_ARTIFACT_DIR){
          const base=resolve('tmp/cf213-qa'),directory=resolve(process.env.CF213_ARTIFACT_DIR);
          assert.ok(directory===base||directory.startsWith(base+sep),'CF213 UI evidence must stay in its explicitly scoped QA directory');mkdirSync(directory,{recursive:true});
          for(const width of [1440,390]){
            await page.setViewportSize({width,height:1000});
            const geometry=await page.evaluate(()=>({body:{client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth},chapter:[...document.querySelectorAll<HTMLElement>('.report-chapter-workbench,[data-chapter-document]')].map(node=>({client:node.clientWidth,scroll:node.scrollWidth,left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right}))}));
            t.diagnostic(`CF213 ${width}px geometry ${JSON.stringify(geometry)}`);
            const toolBoxes=await tools.locator('.report-review-tool-tab').evaluateAll(nodes=>nodes.map(node=>({top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom})));
            assert.ok(toolBoxes.every(box=>Math.abs(box.top-toolBoxes[0].top)<.1),'The three review-tool buttons stay on one row');
            assert.equal(await tools.locator('.report-review-tool-body').count(),1);
            assert.equal(await page.locator('.report-authoring-hero').count(),0,'The large redundant report hero is removed');
            assert.equal(await page.locator('.report-wizard-navigation').evaluate(node=>getComputedStyle(node).position),'static','The stepper no longer takes a sticky/fixed band');
            assert.ok(geometry.body.scroll<=geometry.body.client,`Actual ${width}px page overflows horizontally: ${JSON.stringify(geometry)}`);
            for(const node of geometry.chapter)assert.ok(node.scroll<=node.client&&node.left>=0&&node.right<=width+.1,`Actual chapter workspace overflows: ${JSON.stringify(node)}`);
            assert.match(await editor.innerText(),/CF213 셀 <합성>/u);assert.match(await editor.innerText(),/CF213 합성 캡션 원문/u);
            assert.equal(await editor.getByText('0',{exact:true}).count(),1);
            assert.equal(await editor.locator('img[data-report-photo="true"]').count(),1);
            await checkPhotoColumns(page);
            const previousVersion=(await state(page)).assignments.find((a:any)=>a.chapterId==='ch2').version;
            await workbench(page).getByRole('button',{name:'챕터 중간 저장',exact:true}).click();
            await page.waitForFunction(v=>(window as any).cf213.read().assignments.find((a:any)=>a.chapterId==='ch2').version>v,previousVersion);
            assert.deepEqual((await state(page)).assignments.find((a:any)=>a.chapterId==='ch2').draftEditorJson,chapter.draftEditorJson);
            const screenshotPath=join(directory,`chapter-${width}.png`);assert.ok(!existsSync(screenshotPath),'Preserve prior UI evidence; use a new scoped artifact folder');
            await editor.scrollIntoViewIfNeeded();await page.screenshot({path:screenshotPath,fullPage:false});
          }
          await page.setViewportSize({width:1440,height:1000});
        }
        const reopenVersion=(await state(page)).assignments.find((a:any)=>a.chapterId==='ch2').version;
        await page.evaluate(() => (window as any).cf213Remount());
        await page.getByRole('textbox', { name: '보고서 제목', exact: true }).waitFor();
        const tool=page.locator('.report-review-tools-row').getByRole('button',{name:/^챕터별 분담/u});if(await tool.getAttribute('aria-expanded')!=='true')await tool.click();
        await workbench(page).getByRole('button', { name: '선택 챕터 보기', exact: true }).click();
        await pane(page).locator('.tiptap').getByText('CF213 합성 캡션 원문', { exact: true }).waitFor();
        await checkPhotoColumns(page);
        await workbench(page).getByRole('button', { name: '챕터 중간 저장', exact: true }).click();
        await page.waitForFunction(v => (window as any).cf213.read().assignments.find((a:any)=>a.chapterId==='ch2').version>v, reopenVersion);
        assert.deepEqual((await state(page)).assignments.find((a: any) => a.chapterId === 'ch2').draftEditorJson, chapter.draftEditorJson, 'Actual remount→GET→manual SAVE must retain exactly the server JSON');
        const oneColumn=await open(true);
        try{
          const oneEditor=pane(oneColumn).locator('.tiptap[contenteditable="true"]');await oneEditor.waitFor();await oneEditor.click();await oneColumn.keyboard.press('Control+End');
          await pane(oneColumn).getByRole('button',{name:'이미지',exact:true}).click();
          const dialog=oneColumn.getByRole('dialog',{name:'쟁점·사진·산출 근거 넣기'});await dialog.getByLabel('사진 배치').selectOption('1');await dialog.getByLabel('쟁점·첨부 제목').fill('CF213 단일열 사진');
          await dialog.getByRole('checkbox',{name:'CF213 합성 사진',exact:true}).check();await dialog.getByLabel('CF213 합성 사진 설명',{exact:true}).fill('CF213 단일열 캡션');
          await dialog.getByRole('button',{name:'선택 자료를 현재 위치에 넣기',exact:true}).click();await dialog.waitFor({state:'hidden'});
          await oneColumn.waitForFunction(()=>JSON.stringify((window as any).cf213.read().assignments.find((a:any)=>a.chapterId==='ch2').draftEditorJson).includes('CF213 단일열 캡션'),null,{timeout:15_000});
          await checkPhotoColumns(oneColumn,1);
          const oneSaved=(await state(oneColumn)).assignments.find((a:any)=>a.chapterId==='ch2');
          const nodes:any[]=[oneSaved.draftEditorJson];for(let index=0;index<nodes.length;index++)nodes.push(...nodes[index].content??[]);
          const photo=nodes.find(node=>node.type==='image'&&node.attrs?.reportPhoto);assert.equal(photo.attrs.width,560);assert.equal(photo.attrs.height,330);
          await oneColumn.evaluate(()=>(window as any).cf213Remount());await oneColumn.getByRole('textbox',{name:'보고서 제목',exact:true}).waitFor();
          await oneColumn.locator('.report-review-tools-row').getByRole('button',{name:/^챕터별 분담/u}).click();await workbench(oneColumn).getByRole('button',{name:'선택 챕터 보기',exact:true}).click();
          await pane(oneColumn).locator('.tiptap').getByText('CF213 단일열 캡션',{exact:true}).waitFor();await checkPhotoColumns(oneColumn,1);
          await workbench(oneColumn).getByRole('button',{name:'챕터 중간 저장',exact:true}).click();await oneColumn.waitForFunction(v=>(window as any).cf213.read().assignments.find((a:any)=>a.chapterId==='ch2').version>v,oneSaved.version);
          assert.deepEqual((await state(oneColumn)).assignments.find((a:any)=>a.chapterId==='ch2').draftEditorJson,oneSaved.draftEditorJson);
        }finally{await oneColumn.close()}
      } finally { await page.close(); }
    });
    await t.test('other assigned chapters and the whole report are visibly read-only to staff; PM can select both views and apply', async () => {
      const staffPage = await open(true);
      try {
        await pane(staffPage).locator('.tiptap').waitFor();
        await workbench(staffPage).getByLabel('작성·검수할 챕터').selectOption('ch1');
        await pane(staffPage).locator('.tiptap[contenteditable="false"]').waitFor();
        assert.equal(await pane(staffPage).getByText('담당: 합성 담당자 · 읽기 전용 · 분담 작성 중',{exact:true}).isVisible(),true);
        assert.equal(await workbench(staffPage).getByRole('button', { name: '챕터 중간 저장', exact: true }).count(), 0);
        assert.equal(await staffPage.getByRole('textbox', { name: '보고서 제목', exact: true }).isEditable(), false);
        assert.equal(await staffPage.getByRole('button', { name: '작성 완료본을 전체 보고서에 반영', exact: true }).count(), 0);
        await staffPage.getByRole('button', { name: '전체 보고서 보기', exact: true }).click();
        assert.equal(await staffPage.locator('.document-review-split .tiptap[contenteditable="true"]').count(), 0);
      } finally { await staffPage.close(); }
      const page = await open(false);
      try {
        const original = (await state(page)).draft.editorJson;
        await workbench(page).getByRole('button', { name: '선택 챕터 보기', exact: true }).click();
        await pane(page).locator('.tiptap[contenteditable="true"]').waitFor();
        await page.getByRole('button', { name: '전체 보고서 보기', exact: true }).click();
        await page.locator('.document-review-split .tiptap[contenteditable="true"]').waitFor();
        const tool=page.locator('.report-review-tools-row').getByRole('button',{name:/^챕터별 분담/u});if(await tool.getAttribute('aria-expanded')!=='true')await tool.click();
        await workbench(page).getByRole('button', { name: '작성 완료본을 전체 보고서에 반영', exact: true }).click();
        await page.waitForFunction(() => (window as any).cf213.read().assignments.find((a:any)=>a.chapterId==='ch2').status==='APPLIED').catch(async () => assert.fail(JSON.stringify({state:await state(page),posts:await page.evaluate(()=>(window as any).cf213.posts),errors:await page.locator('[role="alert"]').allTextContents()})));
        const merged = (await state(page)).draft.editorJson;
        const boundary = (doc: any) => doc.content.slice(0, doc.content.findIndex((n: any) => n.attrs?.marker === 'AI-CHAPTER:CH-01:END') + 1);
        assert.deepEqual(boundary(merged), boundary(original));
        assert.match(JSON.stringify(merged), /CH-02 협업 검수 원고입니다/u);
      } finally { await page.close(); }
    });
    await t.test('a chapter save 503 keeps its accepted local rich edits, does not save whole body and can explicitly retry', async () => {
      const page = await open(true);
      try {
        const original = await state(page), editor = pane(page).locator('.tiptap[contenteditable="true"]'); await editor.waitFor();
        await page.evaluate(() => (window as any).cf213.failNext());
        await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' CF213 실패 후 유지할 원고');
        await workbench(page).getByRole('button', { name: '챕터 중간 저장', exact: true }).click();
        await pane(page).getByRole('alert').filter({ hasText: '합성 협업 저장 실패: 원고는 유지됩니다.' }).waitFor();
        assert.match(await editor.innerText(), /CF213 실패 후 유지할 원고/u);
        assert.deepEqual((await state(page)).assignments, original.assignments);
        assert.deepEqual((await state(page)).draft, original.draft);
        await editor.click();await page.keyboard.press('Control+End');await page.keyboard.down('Shift');await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');await page.keyboard.up('Shift');
        await page.evaluate(()=>(window as any).cf213.holdNextChapter());
        await workbench(page).getByRole('button', { name: '챕터 중간 저장', exact: true }).click();
        await page.waitForFunction(()=>(window as any).cf213.pendingChapter);
        const bold=pane(page).getByRole('button',{name:'굵게',exact:true});assert.equal(await bold.isEnabled(),true,'SAVE must not disable the current editable formatting toolbar');await bold.click();
        await page.evaluate(()=>(window as any).cf213.releaseChapter());
        await page.waitForFunction(()=>(window as any).cf213.read().assignments.find((a:any)=>a.chapterId==='ch2').version===2);
        assert.equal(await editor.locator('strong').getByText('원고',{exact:true}).count(),1,'A formatting edit accepted while SAVE was in flight survives its older ACK');
        const oldAck=(await state(page)).assignments.find((a:any)=>a.chapterId==='ch2');assert.doesNotMatch(JSON.stringify(oldAck.draftEditorJson),/"type":"bold"/u);
        await workbench(page).getByRole('button',{name:'챕터 중간 저장',exact:true}).click();await page.waitForFunction(()=>(window as any).cf213.read().assignments.find((a:any)=>a.chapterId==='ch2').version===3);
        assert.match(JSON.stringify((await state(page)).assignments.find((a:any)=>a.chapterId==='ch2').draftEditorJson),/"type":"bold"/u,'The later formatting is saved only by its own acknowledged request');
        assert.deepEqual(await page.evaluate(() => (window as any).cf213.reportWrites), []);
      } finally { await page.close(); }
    });
    await t.test('actual whole-report 503 and page reload recover local rich JSON, chapter/view/step/cursor; a late edit survives the older save ACK', async () => {
      const page = await open(false);
      try {
        const title=page.getByRole('textbox',{name:'보고서 제목',exact:true}), editor=page.locator('.document-review-split .tiptap[contenteditable="true"]');
        await editor.waitFor();
        await page.evaluate(()=>(window as any).cf213.failNextReport());
        await editor.click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' CF213 종료 전 복구 검수');
        await page.keyboard.down('Shift');await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');await page.keyboard.up('Shift');
        await page.getByText('CF213 합성 전체 저장 실패',{exact:true}).waitFor();
        const local=await waitForLocal(page,'body') as any;
        assert.equal(local.payload.step,4);assert.equal(local.payload.chapterId,'ch2');assert.equal(local.payload.view,'whole');assert.equal(local.payload.selection.text,'검수');
        const rich=JSON.stringify(local.payload.editorJson);assert.match(rich,/"type":"image"/u);assert.match(rich,/"type":"table"/u);
        // Same server content version, but a different saved navigation location.
        // Workspace-only metadata is allowed to move without advancing content.
        await page.evaluate(()=>{const url=new URL(location.href);url.searchParams.set('step','2');url.searchParams.set('chapter','ch1');history.replaceState(null,'',url)});
        await page.reload();await page.waitForFunction(()=>document.querySelector('.report-wizard-navigation li:nth-child(2) button')?.getAttribute('aria-current')==='step');
        assert.doesNotMatch(JSON.stringify((await state(page)).draft.editorJson),/CF213 종료 전 복구 검수/u,'Reload first reads the unchanged server, not an implicit local overwrite');
        await page.getByRole('region',{name:'보고서 로컬 작업 복구'}).getByRole('button',{name:'이 로컬 작업 복구',exact:true}).click();
        await page.waitForFunction(()=>window.getSelection()?.toString()==='검수');
        assert.match(await page.locator('.document-review-split .tiptap').innerText(),/CF213 종료 전 복구 검수/u);
        assert.equal(await page.locator('.report-view-switch').getByRole('button',{name:'전체 보고서 보기',exact:true}).getAttribute('aria-pressed'),'true');
        const collaborationTool=page.locator('.report-review-tools-row').getByRole('button',{name:/^챕터별 분담/u});if(await collaborationTool.getAttribute('aria-expanded')!=='true')await collaborationTool.click();
        assert.equal(await workbench(page).getByLabel('작성·검수할 챕터').inputValue(),'ch2');
        assert.equal(await page.locator('.report-wizard-navigation li:nth-child(4) button').getAttribute('aria-current'),'step');
        const recovered=await page.evaluate(async()=>{
          const modulePath='/src/documents/local-document-recovery.ts',api=await import(modulePath);const journal=api.createLocalDocumentRecovery({accountId:'qa',workspaceId:'report:cf114-case'});
          const records=await Promise.all((await journal.list()).map((item:{snapshotId:string})=>journal.read(item.snapshotId)));return records.find((record:any)=>record?.payload.dirty&&JSON.stringify(record.payload.editorJson).includes('CF213 종료 전 복구 검수'));
        }) as any;
        assert.deepEqual(recovered.payload.editorJson,local.payload.editorJson);
        await page.evaluate(()=>(window as any).cf213.holdNextReport());await page.keyboard.press('Control+s');
        await page.waitForFunction(()=>(window as any).cf213.pendingReport);
        const acceptsLateTitle=await title.isEditable();
        if(acceptsLateTitle)await title.fill('CF213 저장 ACK 뒤에도 남아야 하는 새 제목');
        assert.equal(await page.locator('.document-review-split .tiptap').getAttribute('contenteditable'),'true','Stage 4 whole-report editing remains available while its own SAVE is in flight');
        await editor.click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' CF213 저장 중 새 본문');
        await page.evaluate(()=>(window as any).cf213.releaseReport());
        await page.waitForFunction(()=>(window as any).cf213.read().draft.version===2);
        const writes=await page.evaluate(()=>(window as any).cf213.reportWrites) as any[];
        assert.deepEqual(splitReportPresentation(writes[0].editorJson).body,local.payload.editorJson,'The actual editor saved precisely the recovered rich body, not just the old IndexedDB record');
        assert.match(await editor.innerText(),/CF213 저장 중 새 본문/u,'The older whole-report ACK cannot reset an accepted later body edit');
        assert.doesNotMatch(JSON.stringify(writes[0].editorJson),/CF213 저장 중 새 본문/u);
        const lateBody=await waitForLocal(page,'late-body') as any;assert.match(JSON.stringify(lateBody.payload.editorJson),/CF213 저장 중 새 본문/u);
        if(acceptsLateTitle){
          assert.equal(await title.inputValue(),'CF213 저장 ACK 뒤에도 남아야 하는 새 제목');
          await waitForLocal(page,'late-title');
          assert.equal(writes.length,1);assert.notEqual(writes[0].title,await title.inputValue(),'The old ACK did not include or discard the accepted new title');
        }
      }finally{await page.close()}
    });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});
