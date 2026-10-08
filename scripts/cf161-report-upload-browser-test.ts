import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('report HWP/original/PDF page uploads stop uncertain retries and stale confirmation writes', async t => {
  const source = readFileSync('apps/web/src/routes/PreviewReportStudio.tsx', 'utf8');
  assert.equal((source.match(/reportUploads\.upload\([^\n]*isCurrent\)/g) ?? []).length, 4);
  assert.doesNotMatch(source, /fetchEvidenceUpload/);
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const server = await createServer({ root: resolve('apps/web'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', plugins: [{
    name: 'cf161-report-upload',
    transform(code, id) {
      if (!id.endsWith('/report-evidence-upload.ts')) return;
      if (process.env.CF161_UNSAFE_RETRY === '1') return code.replace('if (uncertainCases.has(caseId)) throw new Error(UNKNOWN_UPLOAD);', '');
      if (process.env.CF161_UNSAFE_CURRENT === '1') return code.replace('{ reuseExact: true, isCurrent, signal }', '{ reuseExact: true }');
    },
    configureServer(s) { s.middlewares.use(async (req, res, next) => {
      if (req.url !== '/report-upload-test') return next();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(await s.transformIndexHtml(req.url, '<html lang="ko"><body><script type="module">import{createReportEvidenceUploader}from"/src/evidence/report-evidence-upload.ts";window.uploader=createReportEvidenceUploader();window.current=true;window.send=(caseId,name="sample.hwp")=>window.uploader.upload(caseId,new File(["hello"],name),()=>window.current).then(()=>"saved",e=>e.message).then(result=>{window.lastResult=result;return result;});</script></body></html>'));
    }); }
  }] });
  await server.listen();
  const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const caseId = '40000000-0000-4000-8000-000000000010', otherCase = '40000000-0000-4000-8000-000000000011';
  const stored = { id: 'test-file', originalName: 'sample.hwp', downloadUrl: '/api/cases/evidence/test-file/download', byteSize: 5, sha256: createHash('sha256').update('hello').digest('hex') };
  try {
    for (const mode of ['retryable', 'uncertain', 'network', 'json', 'missing', 'hash', 'url', 'late-unknown', 'late-success', 'success'] as const) await t.test(mode, async () => {
      const page = await browser.newPage(); const keys: string[] = []; const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        keys.push(req.headers()['idempotency-key']);
        if (mode.startsWith('late-')) await page.evaluate(() => { (window as any).current = false; });
        if (mode === 'network') return route.abort();
        if (mode === 'json') return route.fulfill({ status: 200, body: '{broken' });
        if (['success','late-success','missing','hash','url'].includes(mode)) return route.fulfill({ json: mode === 'missing' ? {} : { file: { ...stored, ...(mode === 'hash' ? { sha256: '0'.repeat(64) } : mode === 'url' ? { downloadUrl: 'https://example.invalid/file' } : {}) } } });
        return route.fulfill({ status: 503, json: { code: 'GOOGLE_TIMEOUT', error: '합성 Google 실패', ...(mode === 'retryable' ? { retryable: true } : {}) } });
      });
      await page.goto(origin + '/report-upload-test'); await page.waitForFunction(() => Boolean((window as any).uploader));
      const send = (id = caseId, name = 'sample.hwp') => page.evaluate(({ id, name }) => (window as any).send(id, name), { id, name });
      const first = await send();
      const blocked = !['retryable','success','late-success'].includes(mode);
      assert.equal(await page.evaluate(id => (window as any).uploader.isBlocked(id), caseId), blocked);
      if (mode === 'success') assert.equal(first, 'saved');
      if (mode === 'late-success') assert.match(first, /적용하지 않았습니다/);
      if (blocked) assert.match(first, /저장 결과/);
      await page.evaluate(() => { (window as any).current = true; });
      await send(caseId, blocked ? 'renamed.hwp' : 'sample.hwp');
      assert.equal(keys.length, blocked ? 1 : 2, 'renaming or opening again cannot bypass an uncertain upload');
      if (!blocked) assert.notEqual(keys[0], keys[1]);
      await page.evaluate(() => { (window as any).current = true; });
      await send(otherCase);
      assert.equal(keys.length, blocked ? 2 : 3, 'a different case retains its own independent scope');
      assert.deepEqual(errors, []); await page.close();
    });
    for (const mode of ['conflict', 'comparison', 'duplicate', 'cancel'] as const) await t.test(mode, async () => {
      const page = await browser.newPage(); const keys: string[] = [];
      await page.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        keys.push(req.headers()['idempotency-key']);
        if (keys.length > 1) return route.fulfill({ json: { file: stored } });
        return route.fulfill({ status: 409, json: mode === 'comparison' ? { code: 'VERSION_ANALYSIS_UNAVAILABLE', error: '합성 비교 불가' } : { status: mode === 'duplicate' ? 'DUPLICATE_EXACT' : 'VERSION_CONFLICT_CONFIRMATION', reviewId: 'review', nextVersion: 2, existing_file: { name: '이전.hwp', uploader: '시험', created_at: '2026-10-01' }, file: stored } });
      });
      await page.goto(origin + '/report-upload-test'); await page.waitForFunction(() => Boolean((window as any).uploader));
      const request = page.evaluate(id => (window as any).send(id), caseId);
      request.catch(() => undefined);
      if (mode === 'duplicate') {
        await page.waitForFunction(() => Boolean((window as any).lastResult) || Boolean(document.querySelector('dialog')));
        assert.equal(await page.getByRole('dialog').count(), 0, 'Exact duplicates in import tools must be reused without a per-page acknowledgement');
      } else {
        await page.getByRole('dialog').waitFor();
        if (mode === 'conflict' || mode === 'comparison') await page.evaluate(() => { (window as any).current = false; });
        await page.getByRole('button', { name: mode === 'comparison' ? 'AI 비교 없이 별도 저장' : mode === 'cancel' ? '취소' : '최신본으로 대체 · v2', exact: true }).click();
      }
      const result = await request;
      assert.equal(keys.length, 1, 'stale/cancelled confirmation must not issue the second POST');
      assert.equal(await page.evaluate(id => (window as any).uploader.isBlocked(id), caseId), false);
      if (mode === 'duplicate') assert.equal(result, 'saved');
      else assert.match(result, /취소/);
      await page.close();
    });
  } finally { await browser.close(); await server.close(); }
});
