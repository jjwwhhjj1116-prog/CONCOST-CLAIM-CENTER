import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('CF188 actual report route confirms, versions, reopens and retries navigation without changing native body', async () => {
  const caseId = '40000000-0000-4000-8000-000000000010';
  const ids = ['PROMPT-TYPE-01-CH-01', 'PROMPT-TYPE-01-CH-02'];
  const presentationPath = resolve('packages/document-engine/src/report-presentation.ts').replace(/\\/g, '/');
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const server = await createServer({ root: resolve('apps/web'), ...(process.env.CF149_CACHE_ROOT ? {cacheDir: process.env.CF149_CACHE_ROOT} : {}), server: {host: '127.0.0.1', port: 0, hmr: false}, logLevel: 'error', plugins: [{
    name: 'cf188-report-route',
    configureServer(server) { server.middlewares.use(async (req, res, next) => {
      if (/^\/page-[12]\.svg$/u.test(req.url ?? '')) {res.setHeader('Content-Type', 'image/svg+xml'); res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123"><rect width="794" height="1123" fill="white"/><text x="80" y="180">${req.url}</text></svg>`); return;}
      if (!req.url?.startsWith('/native-nav.html')) return next();
      res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml(req.url, '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/native-nav-entry.js"></script></body></html>'));
    }); },
    resolveId: id => id === '/native-nav-entry.js' ? '\0native-nav-entry' : undefined,
    load: id => id === '\0native-nav-entry' ? `
      import React from 'react';import{createRoot}from'react-dom/client';
      import{PreviewReportStudio}from'/src/routes/PreviewReportStudio.tsx';
      import{parseStructuredDocumentMarkdown}from'/src/documents/StructuredDocumentEditor.tsx';
      import{reportNativeBodySha256}from'/src/documents/report-native-source.ts';
      import{joinReportPresentation}from'/@fs/${presentationPath}';
      import'/src/preview-theme.css';import'/src/theme-system.css';
      const content='<!-- MANUAL-WHOLE-DOCUMENT:START -->\\n\\n'+[1,2].map(p=>'<img src="'+location.origin+'/page-'+p+'.svg" alt="합성 원본 '+p+'쪽" data-report-source-page="true">').join('\\n\\n')+'\\n\\n<!-- MANUAL-WHOLE-DOCUMENT:END -->';
      const body=parseStructuredDocumentMarkdown(content);body.attrs={...body.attrs,reportNativeSource:{caseId:'${caseId}',evidenceId:'synthetic-native',downloadUrl:'/api/cases/evidence/synthetic-native/download',name:'synthetic.hwp',byteSize:128,sha256:'a'.repeat(64),bindingVersion:1,originalSource:{caseId:'${caseId}',evidenceId:'first-original',downloadUrl:'/api/cases/evidence/first-original/download',name:'synthetic-first.hwp',byteSize:256,sha256:'b'.repeat(64)}}};
      const editorJson=joinReportPresentation(body,{enabled:false,text:null},{enabled:false});editorJson.attrs.reportNativeSource.bodySha256=await reportNativeBodySha256(editorJson);
      globalThis.cf188InitialDraft={caseId:'${caseId}',title:'합성 검수 보고서',content,editorJson,version:1,wizardStep:4,selectedChapterId:'${ids[0]}',updatedAt:'2026-10-07T00:00:00Z',updatedBy:{id:'qa',name:'합성 검수자'}};
      createRoot(document.getElementById('root')).render(React.createElement(PreviewReportStudio,{roles:new URL(location.href).searchParams.has('readonly')?['staff']:['admin'],onNavigate:()=>{}}));
    ` : undefined,
  }] });
  await server.listen();
  const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as {port: number}).port;
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync); assert.ok(executablePath);
  const browser = await chromium.launch({executablePath, headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}}); page.setDefaultTimeout(10000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    let draft: any = null, failure: 'HTTP503' | 'CONFLICT' | 'WRONG_ACK' | null = null, saves = 0, readOnly = false;
    const requests: any[] = [];
    const chapters = ids.map((id, i) => ({id, chapterCode: `CH-0${i + 1}`, title: ['대상·개요', '감정자료 목록'][i], agentCode: 'QA', ordinal: i + 1, promptVersion: 1}));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url()), method = route.request().method();
      if (!url.pathname.startsWith('/api/')) return url.origin === origin ? route.continue() : route.abort();
      const send = (body: unknown, status = 200) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
      if (url.pathname === '/api/report-drafts' && method === 'PUT') {
        const body = route.request().postDataJSON(); requests.push(body); saves++;
        assert.equal(body.expectedVersion, draft.version);
        assert.deepEqual(Object.keys(body).sort(), ['title', 'content', 'editorJson', 'expectedVersion', 'wizardStep', 'selectedChapterId', 'saveKind'].sort());
        if (failure === 'HTTP503') return send({error: 'CF188 합성 저장 거부'}, 503);
        if (failure === 'CONFLICT') return send({error: 'CF188 합성 버전 충돌'}, 409);
        if (failure === 'WRONG_ACK') return send({draft: {...draft, version: 99}, revisions: [], backups: []});
        // Match the existing Worker: a workspace-only chapter jump keeps the
        // content version and timestamp; changing navigation metadata does not.
        const changed = body.title !== draft.title || body.content !== draft.content || JSON.stringify(body.editorJson) !== JSON.stringify(draft.editorJson);
        draft = {...draft, ...body, version: draft.version + Number(changed), updatedAt: changed ? new Date().toISOString() : draft.updatedAt}; delete draft.expectedVersion; delete draft.saveKind;
        return send({draft, revisions: [], backups: []});
      }
      assert.equal(method, 'GET', 'Only isolated report-draft saves are permitted; no upload, approval or staff request');
      switch (url.pathname) {
        case '/api/cases': return send({cases: [{id: caseId, caseNumber: 'CF188-SYNTHETIC', title: '고객 자료 없는 합성 검수', claimType: 'TYPE03', status: 'CONTRACT'}], total: 1, nextOffset: null});
        case '/api/report-workspaces': return send({workspaces: []});
        case '/api/report-drafts': draft ??= await page.evaluate(() => (globalThis as any).cf188InitialDraft); return send({draft, revisions: [], backups: []});
        case '/api/report-reviews': return send({reviews: []});
        case '/api/report-finalizations': return send({finalizations: []});
        case '/api/report-authoring/config': return send({available: true, claimType: 'TYPE03', aiConnected: false, assistantConnected: false, outlineAiConnected: false, chapters, templateLibrary: [], templates: [], sourceGroups: [], typeGuideline: null, outlinePlan: {status: 'CONFIRMED', version: 1, persistenceAvailable: true, items: chapters.map(c => ({chapterId: c.id, chapterCode: c.chapterCode, chapterTitle: c.title, planningNote: '', promptVersion: 1}))}});
        case '/api/report-chapter-collaboration': return send({assignments: [], members: [], canManage: !readOnly, currentUserId: 'qa'});
        case '/api/report-authoring/case-law': return send({sources: [], citations: [], apiConfigured: false});
        default: assert.fail('Unexpected isolated API: ' + url.pathname);
      }
    });
    await page.goto(origin + '/native-nav.html?caseId=' + caseId);
    const links = page.locator('.document-review-pages__source-links'), nav = page.getByRole('combobox', {name: '원형 보고서 쪽 이동', exact: true});
    await links.locator('summary').click();
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.document-review-pages__side img[data-report-source-page]')].filter(i => i.closest('.tiptap') || i.closest('[data-export-page]')).length === 4 && [...document.querySelectorAll<HTMLImageElement>('.document-review-pages__side img[data-report-source-page]')].every(i => i.complete && i.naturalWidth > 0));
    const original = structuredClone(draft);
    await links.getByRole('combobox', {name: '연결할 목차 항목', exact: true}).selectOption(ids[1]);
    await links.getByRole('combobox', {name: '연결할 원본 물리 쪽', exact: true}).selectOption('2');
    assert.equal(saves, 0, 'Tentative selection cannot save');
    await links.getByRole('button', {name: '쪽 보기', exact: true}).click();
    await links.getByRole('button', {name: '연결 확인·보고서 저장', exact: true}).click();
    await links.getByRole('status').getByText(/탐색 연결을 원본 2쪽으로 저장했습니다/u).waitFor();
    assert.equal(draft.version, 2); assert.equal(saves, 1); assert.equal(requests[0].saveKind, 'MANUAL');
    const source = {...draft.editorJson.attrs.reportNativeSource}; delete source.confirmedChapterPages;
    assert.deepEqual(source, original.editorJson.attrs.reportNativeSource); assert.deepEqual(draft.editorJson.content, original.editorJson.content); assert.equal(draft.content, original.content);
    for (const width of [1440, 390]) {
      await page.setViewportSize({width, height: 1000}); await links.scrollIntoViewIfNeeded();
      assert.ok(await links.locator('select,button,summary').evaluateAll(controls => controls.every(control => {
        const box = control.getBoundingClientRect(); return box.height >= 44 && box.left >= 0 && box.right <= window.innerWidth;
      })), 'Chapter-link controls must remain visible and usable on desktop/mobile');
      if (process.env.CF188_QA_OUTPUT_DIR) {
        const snapshot = resolve(process.env.CF188_QA_OUTPUT_DIR, `native-links-${width}.png`);
        assert.equal(existsSync(snapshot), false, 'Do not overwrite previous QA evidence');
        await page.screenshot({path: snapshot});
      }
    }
    await nav.selectOption('1');
    await page.getByRole('combobox', {name: '수정할 챕터', exact: true}).selectOption(ids[1]);
    await page.waitForFunction(() => document.querySelector<HTMLSelectElement>('[aria-label="원형 보고서 쪽 이동"]')?.value === '2');
    assert.equal(saves, 1, 'Mapped jump itself creates no body save');
    await page.waitForResponse(response => new URL(response.url()).pathname === '/api/report-drafts' && response.request().method() === 'PUT');
    assert.equal(draft.version, 2); assert.equal(draft.selectedChapterId, ids[1]); assert.deepEqual(draft.editorJson.content, original.editorJson.content);
    const mapped = structuredClone(draft);
    await page.reload(); await links.locator('summary').click();
    await links.getByText(/현재 작업본 연결/u).waitFor({state: 'hidden'}); // Draft selects remain empty after re-entry.
    await links.getByRole('combobox', {name: '연결할 목차 항목', exact: true}).selectOption(ids[1]);
    await links.getByText(/현재 작업본 연결.*2쪽/u).waitFor();
    failure = 'HTTP503';
    await links.getByRole('button', {name: '선택 연결 해제·보고서 저장', exact: true}).click();
    await page.getByText('CF188 합성 저장 거부', {exact: true}).waitFor();
    assert.equal(draft.version, 2); assert.deepEqual(draft, mapped, 'A failed save cannot mutate the isolated server snapshot');
    assert.equal(await links.getByRole('button', {name: '연결 확인·보고서 저장', exact: true}).isDisabled(), true);
    assert.doesNotMatch(await links.getByRole('status').innerText(), /저장했습니다/u);
    failure = 'CONFLICT';
    await page.getByRole('button', {name: '저장 다시 시도', exact: true}).click();
    await page.getByText(/서버의 보고서 버전이 변경되어 저장하지 않았습니다/u).waitFor();
    assert.deepEqual(draft, mapped);
    failure = 'WRONG_ACK';
    await page.getByRole('button', {name: '저장 다시 시도', exact: true}).click();
    await page.getByText(/저장 완료 응답을 확인하지 못했습니다/u).waitFor();
    assert.deepEqual(draft, mapped, 'A wrong version/JSON acknowledgement must not be treated as a saved report');
    failure = null;
    const retried = page.waitForResponse(response => new URL(response.url()).pathname === '/api/report-drafts' && response.request().method() === 'PUT');
    await page.getByRole('button', {name: '저장 다시 시도', exact: true}).click();
    await retried; await page.getByText(/저장 완료 응답을 확인하지 못했습니다/u).waitFor({state:'hidden'});
    assert.equal(draft.version, 3); assert.equal(draft.editorJson.attrs.reportNativeSource.confirmedChapterPages, undefined);
    assert.deepEqual(draft.editorJson.content, original.editorJson.content); assert.equal(draft.content, original.content);
    readOnly = true; await page.goto(origin + '/native-nav.html?readonly=1&caseId=' + caseId); await links.locator('summary').click();
    await links.getByRole('combobox', {name: '연결할 목차 항목', exact: true}).selectOption(ids[0]);
    await links.getByRole('combobox', {name: '연결할 원본 물리 쪽', exact: true}).selectOption('1');
    assert.equal(await links.getByRole('button', {name: '연결 확인·보고서 저장', exact: true}).isDisabled(), true);
    assert.equal(saves, 6, 'Readonly draft selection cannot cause another save');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});
