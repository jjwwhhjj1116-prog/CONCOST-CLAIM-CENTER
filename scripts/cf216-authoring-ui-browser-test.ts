import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('CF216 actual shell and report traverse all five stages and every review panel without changing the draft', { timeout: 180_000 }, async t => {
  const base = resolve('tmp/cf216-qa'); mkdirSync(base, { recursive: true });
  const proof = mkdtempSync(join(base, 'authoring-'));
  const html = readFileSync('apps/web/index.html', 'utf8')
    .replace('<script src="/runtime-config.js"></script>', '')
    .replace('<div id="root"></div>', '<div hidden><button id="qa-fail"></button><button id="qa-navigate"></button><pre id="qa-audit"></pre></div><div id="root"></div>')
    .replace('<script type="module" src="/src/main.tsx"></script>', '<script type="module" src="/qa/cf114-studio.tsx"></script>');
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const server = await createServer({ root: resolve('apps/web'), cacheDir: join(proof, 'cache'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', plugins: [{
    name: 'cf216-shell-report-fixture', enforce: 'pre',
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/cf216-authoring.html')) return next();
      res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, html));
    }); },
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/qa/cf114-studio.tsx')) return;
      code = code.replaceAll('\r\n', '\n');
      const replace = (from: string, to: string) => { assert.ok(code.includes(from), 'The existing CF114 fixture anchor must match'); code = code.replace(from, to); };
      replace("import React from 'react';", `import React from 'react';
        import {AppShell} from '/src/layout/AppShell.tsx';
        import {markReleaseSeen} from '/src/layout/ReleaseNotice.tsx';
        import '/src/layout/WorkspaceHelpCenter.css'; import '/src/layout/SoftLaunchNotice.css';
        window.__CLAIM_API_ORIGIN__=location.origin;
        window.cf216={requests:[],navigation:[],expires:0};
        markReleaseSeen('cf216-synthetic-user');`);
      replace("document.head.prepend(...Array.from(new DOMParser().parseFromString(appHtml, 'text/html').head.querySelectorAll('style,link[rel=\"stylesheet\"]')).map(node => node.cloneNode(true)));", '');
      // CF114 predates persisted default front-matter attributes. Supply those
      // exact defaults before mount so navigation can be checked byte-for-byte.
      replace('let outline =', `draft.editorJson.attrs={reportHeader:{enabled:true,text:null},reportFrontMatter:{enabled:true,date:'',author:''}};\nlet outline =`);
      replace('window.fetch = async (input, init) => {', 'window.cf216.read=()=>structuredClone({draft,assignments});\nwindow.fetch = async (input, init) => {');
      replace("const method = init?.method ?? 'GET';", `const method = init?.method ?? 'GET';
        window.cf216.requests.push({path:url.pathname,method,body:init?.body?JSON.parse(String(init.body)):null});`);
      replace("if (method === 'POST' && url.pathname === '/api/report-chapter-collaboration') {", `if(method==='GET'&&url.pathname==='/api/member-alerts')return response({awards:[],todos:[],today:'2026-10-13',available:true});
        if (method === 'POST' && url.pathname === '/api/report-chapter-collaboration') {`);
      const rootLine = code.split('\n').find(line => line.startsWith("createRoot(document.getElementById('root')!).render(")); assert.ok(rootLine);
      replace(rootLine, `createRoot(document.getElementById('root')!).render(<AppShell currentPath="/reports/studio" currentSearch="" roles={['pm']} userId="cf216-synthetic-user" userName="합성 검수자" previewMode={false} onNavigate={path=>window.cf216.navigation.push(path)} onExpireSession={()=>window.cf216.expires++}><PreviewReportStudio roles={['pm']} onNavigate={path=>window.cf216.navigation.push(path)}/></AppShell>);`);
      return code;
    }
  }] });
  await server.listen(); const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path)); assert.ok(executablePath);
  const browser = await chromium.launch({ executablePath, headless: true }); const measurements: unknown[] = [];
  try {
    for (const width of [1440, 390]) await t.test(`${width}px all stages, review panels and preserved account tools`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 1000 } }); page.setDefaultTimeout(15000);
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const state = () => page.evaluate(() => (window as any).cf216.read());
      const ready = async (step: number) => {
        await page.waitForFunction(value => document.querySelector('.report-authoring-studio')?.getAttribute('data-wizard-step') === String(value) && document.querySelector('.report-autosave-status')?.textContent?.includes('자동 저장 완료') && (window as any).cf216.read().draft.wizardStep === value, step);
      };
      try {
        await page.goto(origin + '/cf216-authoring.html?step=1'); await ready(1);
        assert.equal(await page.locator('.topbar').count(), 0, 'The removed common top header must not render');
        assert.equal(await page.locator('.soft-launch-banner').count(), 0, 'The former global BETA band must not take authoring space');
        const original = (await state()).draft;
        const draftBytes = (draft: any) => JSON.stringify({ title: draft.title, content: draft.content, editorJson: draft.editorJson });
        const unchanged = async () => { const actual = (await state()).draft; if (draftBytes(actual) !== draftBytes(original)) writeFileSync(join(proof, `draft-mismatch-${width}.json`), JSON.stringify({ before: original, after: actual }, null, 2)); assert.equal(draftBytes(actual), draftBytes(original), 'Stage navigation and panel clicks must preserve the exact saved draft bytes'); };
        for (const step of [1, 2, 3, 4, 5, 4]) {
          if (step !== 1) await page.locator('.report-wizard-navigation li').nth(step - 1).getByRole('button').click();
          await ready(step); await unchanged();
          assert.equal(await page.locator('.report-wizard-navigation li').nth(step - 1).getByRole('button').getAttribute('aria-current'), 'step');
          assert.equal(await page.locator('.report-stage-card:visible').count(), 1);
          assert.equal(await page.locator('.report-stage-card:visible .report-stage-header--compact').count(), 1);
          assert.equal(await page.locator('.report-authoring-hero').count(), 0);
          assert.equal(await page.locator('.report-wizard-navigation').evaluate(node => getComputedStyle(node).position), 'static');
          if (step !== 1) assert.equal(await page.locator('.report-current-project--persistent').evaluate(node => getComputedStyle(node).position), 'static');
          const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
          assert.ok(geometry.document <= width + 1 && geometry.body <= width + 1, JSON.stringify({ step, geometry }));
          await page.locator('.report-wizard-navigation').scrollIntoViewIfNeeded();
          await page.screenshot({ path: join(proof, `stage-${width}-${step}${step === 4 && measurements.some((value: any) => value.width === width && value.step === 4) ? '-return' : ''}.png`) });
          measurements.push({ width, step, geometry });
        }
        const tools = page.locator('.report-review-tools-row');
        for (const [index, name] of ['목차 제목 수정', '챕터별 분담', '판례 인용 검수'].entries()) {
          const button = tools.getByRole('button', { name: new RegExp('^' + name) }); await button.click();
          assert.equal(await tools.locator('.report-review-tool-body').count(), 1);
          assert.equal(await button.getAttribute('aria-expanded'), 'true');
          const geometry = await tools.evaluate(node => { const row = node.getBoundingClientRect(); const panel = node.querySelector('.report-review-tool-body')!.getBoundingClientRect(); return { row: { left: row.left, right: row.right }, panel: { left: panel.left, right: panel.right }, buttons: [...node.querySelectorAll('.report-review-tool-tab')].map(button => ({ top: button.getBoundingClientRect().top, width: button.getBoundingClientRect().width })) }; });
          assert.equal(geometry.buttons.length, 3); assert.ok(geometry.buttons.every(box => Math.abs(box.top - geometry.buttons[0].top) < 1));
          assert.ok(Math.abs(geometry.row.left - geometry.panel.left) < 1 && Math.abs(geometry.row.right - geometry.panel.right) < 1, JSON.stringify(geometry));
          await unchanged(); await tools.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(proof, `panel-${width}-${index + 1}.png`) });
          await button.click(); assert.equal(await tools.locator('.report-review-tool-body').count(), 0); await unchanged();
          measurements.push({ width, panel: name, geometry });
        }
        const openTools = async () => {
          if (width === 390) { await page.getByRole('button', { name: '메인 메뉴 드로어 열기', exact: true }).click(); await page.getByRole('dialog', { name: '전체 내비게이션 메뉴' }).waitFor(); }
          const toggle = page.getByRole('button', { name: '계정·업무 도구 열기', exact: true });
          if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        };
        if (width === 390) { const menu = page.getByRole('button', { name: '메인 메뉴 드로어 열기', exact: true }); await menu.click(); await page.getByRole('dialog', { name: '전체 내비게이션 메뉴' }).waitFor(); await page.keyboard.press('Escape'); await page.getByRole('dialog', { name: '전체 내비게이션 메뉴' }).waitFor({ state: 'hidden' }); assert.equal(await menu.evaluate(node => document.activeElement === node), true); }
        for (const [action, dialog] of [
          [/^현재 화면 도움말 열기$/u, /^도움말 ·/u],
          [/^업무 알림 0건$/u, /^신규 수주·오늘의 프로젝트 투입 알림$/u],
          [/업데이트 내역 보기$/u, /^업데이트 안내$/u],
          [/^가오픈 이용 안내 열기$/u, /^가오픈 이용 안내$/u]
        ]) {
          await openTools(); await page.getByRole('button', { name: action }).click();
          await page.getByRole('dialog', { name: dialog }).waitFor();
          assert.equal(await page.getByRole('dialog', { name: '전체 내비게이션 메뉴' }).count(), 0, 'A utility dialog must not stay underneath the mobile navigation drawer');
          assert.equal(await page.getByRole('dialog').count(), 1);
          await page.keyboard.press('Escape'); await page.getByRole('dialog', { name: dialog }).waitFor({ state: 'hidden' }); await unchanged();
        }
        await openTools();
        assert.match(await page.locator('.session-identity').textContent() || '', /합성 검수자/u);
        await page.getByRole('button', { name: '개인 및 관리자 설정 열기', exact: true }).click();
        assert.deepEqual(await page.evaluate(() => (window as any).cf216.navigation), ['/settings']);
        await openTools();
        await page.getByRole('button', { name: '로그아웃', exact: true }).click(); assert.equal(await page.evaluate(() => (window as any).cf216.expires), 1);
        const writes = await page.evaluate(() => (window as any).cf216.requests.filter((item: any) => item.method !== 'GET'));
        assert.ok(writes.every((item: any) => item.method === 'PUT' && item.path === '/api/report-drafts'), 'Only local navigation metadata save is allowed');
        await unchanged(); assert.deepEqual(errors, []);
        t.diagnostic(JSON.stringify({ width, localNavigationSaves: writes.length, proof }));
      } finally { await page.close(); }
    });
  } finally { writeFileSync(join(proof, 'receipt.json'), JSON.stringify({ scope: 'Actual AppShell and PreviewReportStudio with existing in-memory CF114 API; no real account, customer data or remote writes', measurements }, null, 2)); await browser.close(); await server.close(); }
});
