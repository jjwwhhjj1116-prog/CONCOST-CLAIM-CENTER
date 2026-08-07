import assert from 'node:assert';
import * as fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import * as path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { databaseUrlFor, resetDatabase, seedDatabase } from '../packages/database/src';

const root = path.join(__dirname, '..');
const webPort = 43178;
const webOrigin = `http://127.0.0.1:${webPort}`;
const apiOrigin = 'http://127.0.0.1:3001';
const databasePath = path.join(root, 'packages/database/.data', `p08-e2e-${process.pid}.db`);
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
  if (!executable) throw new Error('Chrome/Edge executable not found. Set CHROME_PATH for P08 browser E2E.');
  return executable;
}

async function waitForUrl(url: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* server starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not start at ${url}`);
}

function createProductionWebServer(): Server {
  const distRoot = path.join(root, 'apps/web/dist');
  if (!fs.existsSync(path.join(distRoot, 'index.html'))) throw new Error('P08 E2E requires the current production build. Run pnpm build first.');
  const contentTypes: Record<string, string> = {
    '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml'
  };
  return createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', webOrigin).pathname);
    const requestedPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const candidate = path.resolve(distRoot, requestedPath);
    const safe = candidate.startsWith(`${path.resolve(distRoot)}${path.sep}`);
    const filePath = safe && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(distRoot, 'index.html');
    response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': contentTypes[path.extname(filePath)] ?? 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(response);
  });
}

function cookieValue(setCookies: string[], name: string): string {
  const value = setCookies.find((cookie) => cookie.startsWith(`${name}=`))?.split(';')[0].slice(name.length + 1);
  if (!value) throw new Error(`Login did not return ${name}`);
  return value;
}

async function createSignedInPage(browser: Browser, email: string, viewport = { width: 1440, height: 900 }): Promise<{ context: BrowserContext; page: Page }> {
  const response = await fetch(`${apiOrigin}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: webOrigin },
    body: JSON.stringify({ email, password: 'Password123!' })
  });
  assert.strictEqual(response.status, 200, `${email} login should succeed`);
  const cookies = response.headers.getSetCookie();
  const context = await browser.newContext({ viewport });
  await context.addCookies([
    { name: 'session_token', value: cookieValue(cookies, 'session_token'), domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' },
    { name: 'csrf_token', value: cookieValue(cookies, 'csrf_token'), domain: '127.0.0.1', path: '/', httpOnly: false, sameSite: 'Lax' }
  ]);
  await context.addInitScript((origin: string) => { window.__CLAIM_API_ORIGIN__ = origin; }, apiOrigin);
  return { context, page: await context.newPage() };
}

async function openCatalog(page: Page): Promise<void> {
  await page.goto(`${webOrigin}/templates`, { waitUntil: 'domcontentloaded' });
  await page.locator('.p08-catalog').waitFor({ state: 'visible' });
  await page.locator('.p08-skeleton').waitFor({ state: 'hidden' });
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  assert.strictEqual(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    true,
    'catalog must not cause horizontal overflow'
  );
}

async function main(): Promise<void> {
  console.log('P08 browser E2E: rebuilding isolated DB and immutable template catalog');
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);

  const api: ManagedApiServer = createApiServer({ databaseUrl, allowedOrigins: [webOrigin], secureCookies: false });
  await new Promise<void>((resolve, reject) => api.once('error', reject).listen(3001, '127.0.0.1', resolve));
  const web = createProductionWebServer();
  await new Promise<void>((resolve, reject) => web.once('error', reject).listen(webPort, '127.0.0.1', resolve));

  let browser: Browser | undefined;
  const contexts: BrowserContext[] = [];
  try {
    await Promise.all([waitForUrl(`${apiOrigin}/health`), waitForUrl(webOrigin)]);
    browser = await chromium.launch({ executablePath: findBrowserExecutable(), headless: true });

    const admin = await createSignedInPage(browser, 'admin@example.invalid');
    contexts.push(admin.context);
    await openCatalog(admin.page);
    assert.strictEqual(await admin.page.getByRole('tab').count(), 6, 'exactly six claim type tabs must render');
    assert.strictEqual(await admin.page.locator('.p08-block-grid > *').count(), 8, 'all eight instruction-defined standard blocks must render');

    await admin.page.getByRole('tab', { name: /TYPE-05/ }).click();
    await admin.page.getByText('TYPE-05 · TEMPLATE_NOT_FOUND').waitFor({ state: 'visible' });
    await admin.page.getByText(/fallback하지 않습니다/).waitFor({ state: 'visible' });
    assert.strictEqual(await admin.page.getByRole('button', { name: /추천|대체|fallback/i }).count(), 0, 'TYPE-05 must not expose a fallback action');

    await admin.page.getByRole('tab', { name: /TYPE-01/ }).click();
    const draftPanel = admin.page.getByText('Admin · 새 DRAFT 템플릿 만들기');
    await draftPanel.click();
    const uniqueCode = `RPT-P08-E2E-${Date.now()}`;
    await admin.page.getByLabel('템플릿 코드').fill(uniqueCode);
    await admin.page.getByLabel('템플릿 이름').fill('P08 브라우저 검증 템플릿');
    await admin.page.getByLabel('회사 표준 양식 설명').fill('합성 E2E 표준 양식');
    await admin.page.getByLabel('목차(쉼표 구분)').fill('검토 개요, 사실관계, 결론');
    await admin.page.getByLabel('필수 장(쉼표 구분)').fill('검토 개요, 결론');
    await admin.page.getByLabel('필수 자료 규칙(쉼표 구분)').fill('계약서 사본 확인');
    await admin.page.getByRole('button', { name: '새 템플릿 DRAFT 생성' }).click();
    await admin.page.getByText(/DRAFT 템플릿을 만들었습니다/).waitFor({ state: 'visible' });
    await admin.page.locator('.p08-template-option', { hasText: uniqueCode }).waitFor({ state: 'visible' });
    await assertNoHorizontalOverflow(admin.page);

    const director = await createSignedInPage(browser, 'director@example.invalid');
    contexts.push(director.context);
    await openCatalog(director.page);
    await director.page.locator('.p08-template-option', { hasText: uniqueCode }).click();
    await director.page.getByRole('button', { name: '사람 승인' }).click();
    await director.page.waitForTimeout(500);
    assert.match((await director.page.locator('.p08-alert').allTextContents()).join(' '), /사람 승인이 기록되었습니다/, 'Director approval UI must succeed');
    await director.page.getByRole('button', { name: 'ACTIVE 전환' }).click();
    await director.page.waitForTimeout(500);
    assert.match((await director.page.locator('.p08-alert').allTextContents()).join(' '), /ACTIVE 버전을 전환했습니다/, 'Director activation UI must succeed');
    await director.page.getByText('ACTIVE', { exact: true }).first().waitFor({ state: 'visible' });

    const pm = await createSignedInPage(browser, 'pm@example.invalid');
    contexts.push(pm.context);
    await openCatalog(pm.page);
    await pm.page.locator('.p08-template-option', { hasText: uniqueCode }).click();
    await pm.page.getByLabel('대상 사건').selectOption('CASE-SYN-001');
    await pm.page.getByRole('button', { name: 'ReportInstance 생성' }).click();
    await pm.page.getByText(/사건 보고서 snapshot을 생성했습니다/).waitFor({ state: 'visible' });

    await admin.page.bringToFront();
    await admin.page.getByRole('button', { name: '새로고침' }).click();
    await admin.page.locator('.p08-skeleton').waitFor({ state: 'hidden' });
    await admin.page.locator('.p08-template-option', { hasText: uniqueCode }).click();
    await admin.page.getByRole('button', { name: '선택 버전을 편집 폼으로 복사' }).click();
    await admin.page.getByLabel('템플릿 이름').fill('직원에게 숨겨야 하는 DRAFT');
    await admin.page.getByLabel('목차(쉼표 구분)').fill('결론, 사실관계, 검토 개요');
    await admin.page.getByLabel('필수 장(쉼표 구분)').fill('결론, 검토 개요');
    await admin.page.getByRole('button', { name: '새 버전 DRAFT 생성' }).click();
    await admin.page.getByText(/새 불변 DRAFT 버전을 만들었습니다/).waitFor({ state: 'visible' });

    const staff = await createSignedInPage(browser, 'staff@example.invalid', { width: 1024, height: 768 });
    contexts.push(staff.context);
    await openCatalog(staff.page);
    assert.strictEqual(await staff.page.getByText('직원에게 숨겨야 하는 DRAFT').count(), 0, 'Staff must not see DRAFT versions');
    assert.strictEqual(await staff.page.getByText('Admin · 새 DRAFT 템플릿 만들기').count(), 0, 'Staff must not see Admin creation control');
    assert.strictEqual(await staff.page.getByRole('button', { name: /사람 승인|ACTIVE 전환|ARCHIVED 전환/ }).count(), 0, 'Staff must not see lifecycle controls');
    await assertNoHorizontalOverflow(staff.page);

    await staff.page.getByRole('tab', { name: /TYPE-01/ }).focus();
    await staff.page.keyboard.press('Tab');
    const focusState = await staff.page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return { visible: false, outlineWidth: '0px' };
      const rect = element.getBoundingClientRect();
      return { visible: rect.width > 0 && rect.height > 0, outlineWidth: getComputedStyle(element).outlineWidth };
    });
    assert.strictEqual(focusState.visible, true, 'keyboard focus target must be visible');
    assert.notStrictEqual(focusState.outlineWidth, '0px', 'keyboard focus ring must be visible');

    await staff.page.evaluate(() => { document.documentElement.style.zoom = '200%'; });
    const activeTemplate = staff.page.locator('.p08-template-option', { hasText: uniqueCode });
    await activeTemplate.scrollIntoViewIfNeeded();
    assert.strictEqual(await activeTemplate.isVisible(), true, 'active template remains visible at 200% zoom');
    await assertNoHorizontalOverflow(staff.page);

    console.log('P08 browser E2E: six types, TYPE-05 no-fallback, Admin UI create, Director approval/activation, PM snapshot, Staff RBAC, 1024px, focus and 200% zoom PASSED');
  } finally {
    for (const context of contexts) await context.close().catch(() => undefined);
    await browser?.close();
    await new Promise<void>((resolve) => web.close(() => resolve()));
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await api.waitForDatabaseClose();
    for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
