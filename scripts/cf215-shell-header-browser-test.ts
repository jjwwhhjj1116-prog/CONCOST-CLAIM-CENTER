import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('CF215 actual AppShell removes the header while keeping account and navigation controls', { timeout: 120_000 }, async t => {
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const html = readFileSync('apps/web/index.html', 'utf8')
    .replace('<script src="/runtime-config.js"></script>', '')
    .replace('<script type="module" src="/src/main.tsx"></script>', '<script type="module" src="/cf215-shell-entry.js"></script>');
  const server = await createServer({ root: resolve('apps/web'), cacheDir: resolve('tmp/cf215-qa/shell-cache'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', plugins: [{
    name: 'cf215-actual-shell',
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/cf215-shell.html')) return next();
      res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, html));
    }); },
    resolveId: id => id === '/cf215-shell-entry.js' ? '\0cf215-shell' : undefined,
    load: id => id === '\0cf215-shell' ? `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {AppShell} from '/src/layout/AppShell.tsx';
      import {markReleaseSeen} from '/src/layout/ReleaseNotice.tsx';
      import '/src/layout/WorkspaceHelpCenter.css'; import '/src/layout/SoftLaunchNotice.css';
      import '/src/preview-theme.css'; import '/src/theme-system.css';
      window.__CLAIM_API_ORIGIN__=location.origin; window.cf215={navigation:[],expires:0};
      markReleaseSeen('cf215-synthetic-user');
      createRoot(document.getElementById('root')).render(React.createElement(AppShell,{
        currentPath:'/reports/studio',currentSearch:'',roles:['pm'],userId:'cf215-synthetic-user',userName:'합성 검수자',previewMode:false,
        onNavigate:path=>window.cf215.navigation.push(path),onExpireSession:()=>window.cf215.expires++
      },React.createElement('section',{className:'route-view',style:{minHeight:'3200px'}},React.createElement('h2',null,'CF215 합성 긴 작업화면'))));
    ` : undefined
  }] });
  await server.listen();
  const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
  assert.ok(executablePath);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const width of [1440, 390]) await t.test(`${width}px actual shell scroll and controls`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors: string[] = [], writes: string[] = [], unexpectedReads: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (request.method() !== 'GET') { writes.push(url.pathname); return route.fulfill({ status: 405, json: { error: 'Synthetic shell cannot write' } }); }
        if (url.pathname === '/api/member-alerts') return route.fulfill({ json: { awards: [], todos: [], today: '2026-10-13', available: true } });
        unexpectedReads.push(url.pathname); return route.fulfill({ status: 403, json: { error: 'Unexpected synthetic read' } });
      });
      const scroll = async (y: number) => {
        await page.evaluate(value => window.scrollTo(0, value), y);
        await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      };
      try {
        await page.goto(origin + '/cf215-shell.html');
        await page.getByRole('heading', { name: 'CF215 합성 긴 작업화면' }).waitFor();
        assert.equal(await page.locator('.topbar,.soft-launch-banner').count(), 0);
        if (width === 1440) assert.equal(await page.locator('.session-identity').textContent(), '합성 검수자PM');
        await scroll(800);
        const header = null; assert.equal(await page.locator('.topbar').count(), 0);
        if (width === 1440) {
          for (const height of [900, 760]) {
            await page.setViewportSize({ width, height }); await scroll(800);
            const sidebar = await page.locator('.sidebar').evaluate(node => { const box = node.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, height: box.height, viewport: innerHeight, cssTop: getComputedStyle(node).top }; });
            assert.equal(sidebar.cssTop, '0px'); assert.ok(Math.abs(sidebar.top) < 1 && sidebar.bottom <= height + 1, JSON.stringify(sidebar));
            assert.ok(Math.abs(sidebar.height - Math.max(160, sidebar.viewport - Math.max(0, sidebar.top))) < 1, 'Sidebar height follows its actual viewport position');
            t.diagnostic(JSON.stringify({ width, sidebar }));
          }
        } else assert.equal(await page.locator('.shell-body > .sidebar').count(), 0);
        await scroll(0);
        if (width === 390) await page.getByRole('button', { name: '메인 메뉴 드로어 열기', exact: true }).click();
        const settings = page.getByRole('button', { name: '개인 및 관리자 설정 열기', exact: true });
        await settings.click(); assert.deepEqual(await page.evaluate(() => (window as any).cf215.navigation), ['/settings']);
        if (width === 390) {
          const menu = page.getByRole('button', { name: '메인 메뉴 드로어 열기', exact: true });
          await menu.click(); await page.getByRole('dialog', { name: '전체 내비게이션 메뉴' }).waitFor();
          await page.keyboard.press('Escape'); await page.getByRole('dialog', { name: '전체 내비게이션 메뉴' }).waitFor({ state: 'hidden' });
          assert.equal(await menu.evaluate(node => document.activeElement === node), true, 'Closing the mobile menu restores focus');
          await menu.click();
        }
        assert.equal(await page.locator('.session-identity').textContent(), '합성 검수자PM');
        await page.getByRole('button', { name: '계정·업무 도구 열기', exact: true }).click();
        await page.getByRole('button', { name: '로그아웃', exact: true }).click();
        assert.equal(await page.evaluate(() => (window as any).cf215.expires), 1);
        const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
        assert.ok(geometry.document <= width + 1 && geometry.body <= width + 1, JSON.stringify(geometry));
        assert.deepEqual(errors, []); assert.deepEqual(writes, []); assert.deepEqual(unexpectedReads, []);
        t.diagnostic(JSON.stringify({ width, headerAfterScroll: header, geometry }));
      } finally { await page.close(); }
    });
  } finally { await browser.close(); await server.close(); }
});
