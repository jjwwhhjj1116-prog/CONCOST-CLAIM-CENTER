import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('CF148 template registration preserves the library and unsaved prompts when refresh fails', async () => {
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const styles = readFileSync('apps/web/index.html', 'utf8').match(/<style>([\s\S]*?)<\/style>/u)?.[1];
  assert.ok(styles);
  const server = await createServer({ root: resolve('apps/web'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', plugins: [{
    name: 'cf148-template-library',
    configureServer(server) { server.middlewares.use(async (req, res, next) => {
      if (req.url !== '/cf148-template.html') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml(req.url, `<!doctype html><html lang="ko" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}</style></head><body><div id="root"></div><script>window.__CLAIM_API_ORIGIN__=location.origin;</script><script type="module" src="/cf148-template-entry.js"></script></body></html>`));
    }); },
    resolveId: id => id === '/cf148-template-entry.js' ? '\0cf148-template-entry' : undefined,
    load: id => id === '\0cf148-template-entry' ? `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {PreviewAiAdmin} from '/src/routes/PreviewAiAdmin.tsx';
      import '/src/routes/PreviewAiAdmin.css'; import '/src/layout/StatusFeedbackState.css';
      import '/src/preview-theme.css'; import '/src/theme-system.css';
      createRoot(document.getElementById('root')).render(React.createElement(PreviewAiAdmin));
    ` : undefined,
  }] });
  await server.listen();
  const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
  assert.ok(executablePath);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const oldFile = { id: 'old-file', originalName: '기존 원본.pdf', fileExtension: 'pdf', byteSize: 1234, sha256: 'a'.repeat(64), uploadedAt: '2026-09-16', uploadedByName: '검수자', viewMode: 'INLINE', contentUrl: '/api/report-templates/files/old-file' };
    const category = { id: 'ref07', categoryCode: 'REF-07', displayName: '사진대지', primaryClaimType: 'TYPE-01', secondaryClaimTypes: [], expectedSourceCount: 32, uploadedSourceCount: 1, analysisSummary: '합성 원본 목록 검수', outline: ['사진대지'], analysisVersion: 1, files: [oldFile] };
    const payload = { aiConfig: { providers: [], routes: [] }, typeGuidelines: [], templateLibrary: [category], promptSets: [{ claimType: 'TYPE-01', name: '감정보고서', status: 'READY', systemPrompt: '', chapters: [{ id: 'ch1', chapterCode: 'CH-01', title: '개요', agentCode: 'AUTHOR', rolePrompt: '기존 역할', instructionPrompt: '기존 지침', ordinal: 1, version: 1, updatedAt: '2026-09-16', updatedBy: '검수자', sourceCategoryCodes: [], sourceAnalysisNote: '', sourceAnalysisVersion: 1 }] }] };
    let adminFails = true, refreshFails = true, importFails = false, adminReads = 0, libraryReads = 0;
    const writes: Array<{ key: string; body: string }> = [];
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const send = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/api/admin/report-prompts' && request.method() === 'GET') {
        adminReads++;
        return adminFails ? send({ error: '원본 템플릿 목록을 조회하지 못했습니다.', code: 'TEMPLATE_LIBRARY_UNAVAILABLE' }, 503) : send(payload);
      }
      if (url.pathname === '/api/admin/report-templates/import' && request.method() === 'POST') {
        writes.push({ key: request.headers()['idempotency-key'], body: request.postDataBuffer()!.toString() });
        return importFails ? send({ error: '합성 등록 실패' }, 503) : send({ fileId: 'new-file', importCommitted: true, libraryRefreshRequired: true }, 201);
      }
      if (url.pathname === '/api/report-templates/library' && request.method() === 'GET') {
        libraryReads++;
        return refreshFails ? send({ error: '합성 목록 조회 실패', code: 'TEMPLATE_LIBRARY_UNAVAILABLE' }, 503) : send({ categories: [{ ...category, uploadedSourceCount: 2, files: [oldFile, { ...oldFile, id: 'new-file', originalName: '새 원본.pdf' }] }] });
      }
      if (url.pathname.startsWith('/api/')) throw new Error('Unexpected API ' + request.method() + ' ' + url.pathname);
      return url.origin === origin ? route.continue() : route.abort();
    });
    await page.goto(origin + '/cf148-template.html');
    await page.getByText('AI 설정을 불러오지 못했습니다').waitFor();
    assert.equal(await page.locator('.template-library-admin__grid').count(), 0);
    adminFails = false;
    await page.getByRole('button', { name: '다시 시도', exact: true }).click();
    const roleDraft = page.getByLabel('챕터 작성자 역할');
    await roleDraft.fill('관리자가 아직 저장하지 않은 역할 지침');
    const importButton = page.getByRole('button', { name: '원본 32개 폴더 선택·등록' });
    const refreshButton = page.getByRole('button', { name: '목록 다시 조회', exact: true });
    const selectSyntheticFile = async (name: string | string[]) => page.locator('input[type="file"]').evaluate((input, names) => {
      const files = new DataTransfer();
      for (const fileName of Array.isArray(names) ? names : [names]) {
        const file = new File(['%PDF-1.7 synthetic'], fileName, { type: 'application/pdf', lastModified: 123 });
        Object.defineProperty(file, 'webkitRelativePath', { value: '원본/07.사진대지/' + fileName });
        files.items.add(file);
      }
      (input as HTMLInputElement).files = files.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    }, name);
    await selectSyntheticFile('새 원본.pdf');
    await page.getByText('아래 목록은 마지막 조회 결과입니다', { exact: true }).waitFor();
    assert.equal(await importButton.isDisabled(), true);
    assert.equal(await page.getByRole('link', { name: '기존 원본.pdf', includeHidden: true }).count(), 1);
    assert.equal(await page.getByRole('link', { name: '새 원본.pdf', includeHidden: true }).count(), 0);
    assert.equal(await page.getByText(/1개 원본을 등록했습니다/).count(), 1);
    assert.equal(writes.length, 1); assert.match(writes[0].body, /REF-07/);
    await refreshButton.click();
    await page.getByRole('alert').filter({ hasText: '합성 목록 조회 실패' }).waitFor();
    assert.equal(await importButton.isDisabled(), true);
    assert.equal(await roleDraft.inputValue(), '관리자가 아직 저장하지 않은 역할 지침');
    refreshFails = false;
    await refreshButton.click();
    await page.waitForFunction(() => document.querySelector('.template-library-admin__intro strong')?.textContent?.startsWith('2/32'));
    assert.equal(await importButton.isEnabled(), true);
    assert.equal(await roleDraft.inputValue(), '관리자가 아직 저장하지 않은 역할 지침');
    assert.equal(await page.getByRole('link', { name: '기존 원본.pdf', includeHidden: true }).count(), 1);
    assert.equal(await page.getByRole('link', { name: '새 원본.pdf', includeHidden: true }).count(), 1);
    assert.equal(adminReads, 2); assert.equal(libraryReads, 2); assert.equal(writes.length, 1);
    importFails = true;
    await selectSyntheticFile(['실패 재시도.pdf', '실패 재시도2.pdf']);
    await page.getByRole('alert').filter({ hasText: '확인할 오류 2건' }).waitFor();
    assert.match(await page.getByRole('alert').textContent() ?? '', /원본\/07.사진대지\/실패 재시도.pdf/);
    assert.match(await page.getByRole('alert').textContent() ?? '', /원본\/07.사진대지\/실패 재시도2.pdf/);
    assert.equal(await importButton.isEnabled(), true);
    const retryList = page.waitForResponse(response => new URL(response.url()).pathname === '/api/report-templates/library');
    await refreshButton.click(); await retryList;
    await page.getByRole('button', { name: '목록 다시 조회', exact: true }).waitFor();
    assert.equal(await page.getByRole('alert').filter({ hasText: '확인할 오류 2건' }).count(), 1, 'Refreshing the catalog must not erase failed registration filenames');
    importFails = false;
    await selectSyntheticFile(['실패 재시도.pdf', '실패 재시도2.pdf']);
    await page.getByText('아래 목록은 마지막 조회 결과입니다', { exact: true }).waitFor();
    await page.getByText(/2개 원본을 등록했습니다/).waitFor();
    assert.equal(writes.length, 5); assert.equal(writes[1].key, writes[3].key); assert.equal(writes[2].key, writes[4].key);
    await refreshButton.click();
    await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('input[type="file"]')?.disabled && !Array.from(document.querySelectorAll('button')).find(button => button.textContent === '원본 32개 폴더 선택·등록')?.disabled);
    // Native directory Files serialize their relative path unless FormData receives an explicit filename.
    await page.locator('input[type="file"]').setInputFiles(resolve('scripts/fixtures/template-folder'));
    await page.getByText(/1개 원본을 등록했습니다/).waitFor();
    assert.equal(writes.length, 6);
    assert.match(writes[5].body, /name="categoryCode"\r\n\r\nREF-07/);
    assert.match(writes[5].body, /filename="폴더 선택 원본.pdf"/);
    assert.doesNotMatch(writes[5].body, /filename="[^"]*[\\/]/);
    await page.locator('.template-library-admin__intro').scrollIntoViewIfNeeded();
    mkdirSync('output/playwright', { recursive: true });
    await page.screenshot({ path: 'output/playwright/cf148-template-refresh-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await refreshButton.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: 'output/playwright/cf148-template-refresh-mobile.png' });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});
