import assert from 'node:assert';
import * as fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import * as path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { databaseUrlFor, resetDatabase, seedDatabase } from '../packages/database/src';

const root = path.join(__dirname, '..');
const webPort = 43175;
const webOrigin = `http://127.0.0.1:${webPort}`;
const apiOrigin = 'http://127.0.0.1:3001';
const databasePath = path.join(root, 'packages/database/.data', `p05-e2e-${process.pid}.db`);
const databaseUrl = databaseUrlFor(databasePath);

function findBrowserExecutable(): string {
  const localAppData = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    process.env.CHROME_PATH ?? '',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(localAppData, 'Google/Chrome/Application/chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  const executable = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!executable) throw new Error('Chrome/Edge executable not found. Set CHROME_PATH for P05 browser E2E.');
  return executable;
}

async function waitForUrl(url: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not start at ${url}`);
}

function createProductionWebServer(): Server {
  const distRoot = path.join(root, 'apps/web/dist');
  if (!fs.existsSync(path.join(distRoot, 'index.html'))) {
    throw new Error('P05 E2E requires a current apps/web/dist production build. Run pnpm build first.');
  }
  const contentTypes: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
  };
  return createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', webOrigin).pathname);
    const requestedPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const candidate = path.resolve(distRoot, requestedPath);
    const isSafeAsset = candidate.startsWith(`${path.resolve(distRoot)}${path.sep}`);
    const filePath = isSafeAsset && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
      ? candidate
      : path.join(distRoot, 'index.html');
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': contentTypes[path.extname(filePath)] ?? 'application/octet-stream',
    });
    fs.createReadStream(filePath).pipe(response);
  });
}

async function login(page: Page, email: string): Promise<void> {
  await page.goto(`${webOrigin}/login`);
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill('Password123!');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL(`${webOrigin}/dashboard`);
}

async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: '로그아웃' }).click();
  await page.waitForURL(/\/login\?returnTo=/);
}

async function main(): Promise<void> {
  console.log('P05 E2E: resetting isolated database');
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  console.log('P05 E2E: isolated database seeded');
  const api: ManagedApiServer = createApiServer({ databaseUrl, allowedOrigins: [webOrigin], secureCookies: false });
  await new Promise<void>((resolve, reject) => api.once('error', reject).listen(3001, '127.0.0.1', resolve));

  const web = createProductionWebServer();
  await new Promise<void>((resolve, reject) => web.once('error', reject).listen(webPort, '127.0.0.1', resolve));
  console.log('P05 E2E: API and current production build are listening');

  let browser: Browser | undefined;
  try {
    await Promise.all([waitForUrl(`${apiOrigin}/health`), waitForUrl(webOrigin)]);
    console.log('P05 E2E: launching real Chromium');
    browser = await chromium.launch({ executablePath: findBrowserExecutable(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    await login(page, 'pm@example.invalid');
    assert.strictEqual(await page.getByText('Synthetic PM · PM').isVisible(), true);
    const beforeTotal = Number(await page.locator('[data-kpi="전체 접근 사건"]').textContent());
    assert.ok(beforeTotal > 0);

    // Preserve P03 history and direct-route behavior under real authentication.
    await page.goto(`${webOrigin}/approval`);
    await page.getByRole('link', { name: /사건 목록/ }).click();
    await page.waitForURL(`${webOrigin}/cases`);
    await page.goBack();
    await page.waitForURL(`${webOrigin}/approval`);
    await page.goForward();
    await page.waitForURL(`${webOrigin}/cases`);
    await page.goto(`${webOrigin}/unknown-route`);
    assert.strictEqual(await page.getByRole('heading', { name: /404 Not Found/ }).isVisible(), true);

    // Actual P05 browser flow: create -> classify -> detail -> party -> schedule -> lifecycle -> search -> KPI.
    await page.goto(`${webOrigin}/cases/new`);
    await page.getByLabel('사건명').fill('P05_BROWSER_SYNTHETIC_CASE');
    await page.getByLabel('6대 고정 클레임 유형').selectOption('TYPE-06');
    await page.getByLabel('대분류').fill('건설');
    await page.getByLabel('중분류').fill('물가변동');
    await page.getByLabel('소분류').fill('합성 E2E');
    await page.getByRole('button', { name: '사건 저장' }).click();
    await page.waitForURL(/\/cases\/detail\?caseId=/);
    await page.getByText(/건설 > 물가변동 > 합성 E2E/).waitFor({ state: 'visible' });

    await page.getByRole('button', { name: '관계자' }).click();
    await page.getByLabel('새 관계자 이름').fill('P05_SYNTHETIC_PARTY');
    await page.getByRole('button', { name: '관계자 추가' }).click();
    await page.getByText(/P05_SYNTHETIC_PARTY/).waitFor({ state: 'visible' });

    await page.getByRole('button', { name: '일정' }).click();
    await page.getByLabel('새 기일 제목').fill('P05_SYNTHETIC_DEADLINE');
    await page.getByLabel('기일 유형').selectOption('COURT');
    await page.getByLabel('기일 일시').fill('2026-08-07T09:00');
    await page.getByRole('button', { name: '기일 추가' }).click();
    await page.getByText(/P05_SYNTHETIC_DEADLINE/).waitFor({ state: 'visible' });

    await page.getByRole('button', { name: '개요' }).click();
    await page.getByRole('button', { name: '다음 단계로 이동' }).click();
    await page.getByText(/상태:\s*제안/).waitFor({ state: 'visible' });

    await page.getByRole('link', { name: /사건 목록/ }).click();
    await page.getByLabel('사건명·사건번호·관계자 통합 검색').fill('P05_BROWSER_SYNTHETIC_CASE');
    await page.getByRole('button', { name: '검색' }).click();
    await page.getByText('P05_BROWSER_SYNTHETIC_CASE', { exact: true }).first().waitFor({ state: 'visible' });
    await page.getByRole('link', { name: /메인 대시보드/ }).click();
    const afterTotal = Number(await page.locator('[data-kpi="전체 접근 사건"]').textContent());
    assert.strictEqual(afterTotal, beforeTotal + 1);

    // Server roles, not a client role selector, drive route and mutation access.
    await logout(page);
    await login(page, 'staff@example.invalid');
    await page.goto(`${webOrigin}/cases/new`);
    assert.strictEqual(await page.getByRole('heading', { name: '403 Forbidden' }).isVisible(), true);

    await logout(page);
    await login(page, 'reviewer@example.invalid');
    await page.goto(`${webOrigin}/reports/studio`);
    const editor = page.getByLabel('보고서 초안 본문');
    assert.strictEqual(await editor.getAttribute('readonly'), '');
    assert.strictEqual(await page.getByRole('button', { name: '본문 저장' }).isEnabled(), false);
    assert.strictEqual(await page.getByRole('button', { name: '최종 DOCX/PDF 병합' }).isEnabled(), false);

    // P03 responsive/accessibility regression.
    await page.setViewportSize({ width: 1024, height: 768 });
    const menuButton = page.getByRole('button', { name: '메인 메뉴 드로어 열기' });
    await menuButton.click();
    assert.strictEqual(await page.getByRole('dialog', { name: '전체 내비게이션 메뉴' }).isVisible(), true);
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.getByRole('dialog', { name: '전체 내비게이션 메뉴' }).count(), 0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${webOrigin}/dashboard`);
    const skipLink = page.getByRole('link', { name: '본문 영역으로 바로가기' });
    await skipLink.focus();
    assert.strictEqual(await skipLink.evaluate((element) => element === document.activeElement), true);
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    assert.strictEqual(await page.getByRole('button', { name: '로그아웃' }).isVisible(), true);

    console.log('P05 browser E2E: real auth/API/DB case create, classification, party, schedule, lifecycle, search, KPI, RBAC, history, drawer, focus and 200% zoom PASSED');
  } finally {
    await browser?.close();
    await new Promise<void>((resolve) => web.close(() => resolve()));
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await api.waitForDatabaseClose();
    for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
