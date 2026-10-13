import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';

test('CF213 new intake renders its existing form without the large introduction hero at desktop and mobile sizes', { timeout: 120_000 }, async t => {
  const base = resolve(process.env.CF213_OUTPUT_ROOT || 'output/playwright');
  mkdirSync(base, { recursive: true });
  const proof = mkdtempSync(join(base, 'cf213-intake-layout-'));
  const source = readFileSync('apps/web/src/case-management/CaseManagement.tsx');
  // Keep the production index's lang, viewport, box sizing and baseline style.
  const html = readFileSync('apps/web/index.html', 'utf8')
    .replace('<script src="/runtime-config.js"></script>', '')
    .replace('<script type="module" src="/src/main.tsx"></script>', '<script type="module" src="/cf213-intake-layout.jsx"></script>');
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const server = await createServer({ root: resolve('apps/web'), cacheDir: join(proof, 'cache'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', plugins: [{
    name: 'cf213-production-intake-layout',
    configureServer(server) { server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/cf213-intake-layout.html')) return next();
      res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml(req.url, html));
    }); },
    resolveId: id => id === '/cf213-intake-layout.jsx' ? '\0cf213-intake-layout' : undefined,
    load: id => id === '\0cf213-intake-layout' ? `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {CaseManagement} from '/src/case-management/CaseManagement.tsx';
      import '/src/preview-theme.css'; import '/src/theme-system.css';
      createRoot(document.getElementById('root')).render(
        React.createElement('section',{className:'route-view'},
          React.createElement(CaseManagement,{routeId:'CASE-02',previewMode:true,onNavigate:()=>{}})));
    ` : undefined
  }] });
  await server.listen();
  const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
  assert.ok(executablePath, 'An installed Chrome is required for the isolated local fixture');
  const browser = await chromium.launch({ executablePath, headless: true });
  const measurements: unknown[] = [];
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) await t.test(`${viewport.width}px production intake`, async () => {
      const page = await browser.newPage({ viewport });
      const errors: string[] = [], writes: string[] = [], unexpectedReads: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname.startsWith('/api/')) {
          if (request.method() !== 'GET') { writes.push(url.pathname); return route.fulfill({ status: 405, json: { error: 'CF213: local fixture must not save or upload' } }); }
          unexpectedReads.push(url.pathname); return route.fulfill({ status: 403, json: { error: 'CF213: new empty form does not need customer data' } });
        }
        return route.continue();
      });
      try {
        await page.goto(origin + '/cf213-intake-layout.html');
        await page.getByRole('heading', { name: '사건 기본정보', exact: true }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        const screenshot = join(proof, `intake-${viewport.width}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        assert.equal(await page.locator('.case-create-hero,.case-create-number').count(), 0);
        assert.doesNotMatch(await page.locator('.case-create-page').innerText(), /NEW PROJECT INTAKE|INTAKE → PROPOSAL|새 프로젝트 의뢰를 등록합니다/u);
        assert.equal(await page.locator('.case-create-form').count(), 1);
        for (const label of ['사건명', '클라이언트명', '클라이언트 입장 상세']) assert.equal(await page.getByRole('textbox', { name: label, exact: true }).isVisible(), true, label);
        for (const label of ['클레임 업무 유형', '우리 클라이언트의 법적 지위']) assert.equal(await page.getByRole('combobox', { name: label, exact: true }).isVisible(), true, label);
        assert.equal(await page.locator('#case-description[required]').isVisible(), true);
        assert.equal(await page.locator('.case-create-form [required]').count(), 5);
        assert.match(await page.locator('.case-description-field').innerText(), /반드시 클라이언트 관점/u);
        assert.equal(await page.getByText('Gemini AI 의뢰 자동작성', { exact: true }).isVisible(), true);
        assert.equal(await page.getByRole('button', { name: 'AI 자동 작성', exact: true }).isDisabled(), true, 'No file was selected or uploaded');
        assert.match(await page.locator('#case-intake-source').getAttribute('accept') || '', /\.xlsx/u);
        assert.match(await page.locator('.case-create-summary').innerText(), /저장 후 다음 단계|제안서 작성 1단계/u);
        assert.equal(await page.getByRole('button', { name: '의뢰 저장 후 제안서 작성', exact: true }).isVisible(), true);
        const geometry = await page.evaluate(() => {
          const form = document.querySelector('.case-create-form')!;
          const nodes = [...form.querySelectorAll('input,select,textarea,.case-intake-assistant,.case-create-summary,.case-create-actions')];
          const overflow = nodes.filter(node => { const r = node.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1); }).map(node => ({ tag: node.tagName, className: node.className, id: node.id }));
          return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, formWidth: form.getBoundingClientRect().width, columns: getComputedStyle(form).gridTemplateColumns, overflow };
        });
        // The incumbent sticky save bar may overlay the initial viewport. Each
        // form control must still be reachable after ordinary vertical scroll.
        const reachableControls: string[] = [];
        for (const control of await page.locator('.case-create-form input,.case-create-form select,.case-create-form textarea,.case-create-form button').all()) {
          await control.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
          const hit = await control.evaluate(node => { const r = node.getBoundingClientRect(), target = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { name: node.id || node.textContent?.trim(), reachable: target === node || Boolean(target && node.contains(target)) }; });
          assert.equal(hit.reachable, true, `The save bar must not block ${hit.name}`);
          reachableControls.push(hit.name || control.toString());
        }
        measurements.push({ viewport, geometry, screenshot, reachableControls, javascriptErrors: errors, attemptedApiWrites: writes, unexpectedApiReads: unexpectedReads });
        assert.ok(geometry.documentWidth <= viewport.width + 1 && geometry.bodyWidth <= viewport.width + 1, JSON.stringify(geometry));
        assert.deepEqual(geometry.overflow, []);
        assert.deepEqual(errors, []); assert.deepEqual(writes, []); assert.deepEqual(unexpectedReads, []);
      } finally { await page.close(); }
    });
  } finally {
    writeFileSync(join(proof, 'receipt.json'), JSON.stringify({ sourceSha256: createHash('sha256').update(source).digest('hex'), scope: 'Production CaseManagement CASE-02 React and production index/theme CSS in an isolated local headless fixture; no AppShell, user Chrome, provider, remote save, AI generation or actual upload verification', measurements }, null, 2));
    console.log(JSON.stringify({ proof, measurements }));
    await browser.close(); await server.close();
  }
});
