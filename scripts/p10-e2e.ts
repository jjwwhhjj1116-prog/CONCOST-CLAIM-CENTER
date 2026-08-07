import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import * as path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createPrismaClient, databaseUrlFor, resetDatabase, seedDatabase } from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { createP09Fixture } from './p09-test-support';

const root = path.resolve(__dirname, '..');
const webPort = 43182;
const apiPort = 3002;
const webOrigin = `http://127.0.0.1:${webPort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const databasePath = path.join(root, 'packages/database/.data', `p10-e2e-${process.pid}.db`);
const uploadDir = path.join(root, 'packages/database/.data', `p10-e2e-uploads-${process.pid}`);
const databaseUrl = databaseUrlFor(databasePath);

function browserExecutable(): string {
  const candidates = [
    process.env.CHROME_PATH ?? '',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) throw new Error('Chrome/Edge executable not found. Set CHROME_PATH for P10 browser E2E.');
  return found;
}

function productionWebServer(): Server {
  const distRoot = path.join(root, 'apps/web/dist');
  if (!fs.existsSync(path.join(distRoot, 'index.html'))) throw new Error('P10 browser E2E requires the current production build');
  const types: Record<string, string> = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
  return createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', webOrigin).pathname);
    const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const candidate = path.resolve(distRoot, requested);
    const safe = candidate.startsWith(`${path.resolve(distRoot)}${path.sep}`);
    const filePath = safe && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(distRoot, 'index.html');
    response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': types[path.extname(filePath)] ?? 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(response);
  });
}

async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* server starting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not start: ${url}`);
}

async function newPage(browser: Browser, viewport = { width: 1440, height: 900 }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((origin: string) => { window.__CLAIM_API_ORIGIN__ = origin; }, apiOrigin);
  return { context, page: await context.newPage() };
}

async function login(page: Page, email: string): Promise<void> {
  await page.goto(`${webOrigin}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill('Password123!');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL(`${webOrigin}/dashboard`);
}

async function main(): Promise<void> {
  console.log('P10 browser E2E: production AI-01 and Report Studio async gateway/cancel workflow');
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const db = createPrismaClient(databaseUrl);
  const api: ManagedApiServer = createApiServer({ databaseUrl, allowedOrigins: [webOrigin], secureCookies: false, uploadDir });
  await new Promise<void>((resolve, reject) => api.once('error', reject).listen(apiPort, '127.0.0.1', resolve));
  const web = productionWebServer();
  await new Promise<void>((resolve, reject) => web.once('error', reject).listen(webPort, '127.0.0.1', resolve));

  let browser: Browser | undefined;
  const contexts: BrowserContext[] = [];
  try {
    await Promise.all([waitFor(`${apiOrigin}/health`), waitFor(webOrigin)]);
    const studio = await createP09Fixture(apiOrigin, db, { sectionCount: 1, requestOrigin: webOrigin });
    browser = await chromium.launch({ executablePath: browserExecutable(), headless: true });

    const admin = await newPage(browser);
    contexts.push(admin.context);
    await login(admin.page, 'admin@example.invalid');
    await admin.page.goto(`${webOrigin}/ai-config`, { waitUntil: 'domcontentloaded' });
    await admin.page.locator('.p10-ai-config').waitFor({ state: 'visible' });
    await admin.page.getByText('Local Synthetic Fake AI Engine').waitFor({ state: 'visible' });
    assert.equal((await admin.page.locator('body').innerText()).includes('fake-synthetic-local-key'), false);
    await admin.page.getByRole('button', { name: '연결 핑 테스트' }).click();
    await admin.page.getByRole('status').getByText(/성공 \(200 OK\)/).waitFor({ state: 'visible' });

    const pm = await newPage(browser);
    contexts.push(pm.context);
    await login(pm.page, 'pm@example.invalid');
    await pm.page.goto(`${webOrigin}/cases/CASE-SYN-001/reports/${encodeURIComponent(studio.reportId)}/studio`, { waitUntil: 'domcontentloaded' });
    await pm.page.locator('.p09-studio').waitFor({ state: 'visible' });
    const gateway = pm.page.locator('.p10-ai-gateway-section');
    await gateway.getByRole('button', { name: 'AI Gateway 연결 진단 시작' }).click();
    await gateway.getByRole('button', { name: '실행 중 요청 취소' }).waitFor({ state: 'visible' });
    await gateway.getByRole('button', { name: '실행 중 요청 취소' }).click();
    await gateway.getByText(/실행 중 요청이 취소되었습니다/).waitFor({ state: 'visible' });
    await new Promise((resolve) => setTimeout(resolve, 900));
    const canceled = await db.aiGenerationRequest.findFirstOrThrow({ where: { userId: 'USR-PM', status: 'CANCELED' }, orderBy: { createdAt: 'desc' } });
    assert.equal(canceled.status, 'CANCELED');

    await gateway.getByRole('button', { name: 'AI Gateway 연결 진단 시작' }).click();
    await gateway.getByText(/Gateway 진단 성공/).waitFor({ state: 'visible', timeout: 10_000 });
    assert.ok((await db.aiGenerationRequest.count({ where: { userId: 'USR-PM', status: 'COMPLETED' } })) >= 1);

    const storage = await pm.page.evaluate(() => `${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)}`);
    assert.equal(/(?:sk-|api[_-]?key|Bearer\s)/i.test(storage), false, 'browser storage must not contain provider credentials');
    await pm.page.setViewportSize({ width: 1024, height: 768 });
    assert.equal(await pm.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await pm.page.getByRole('tab', { name: '검토·승인' }).focus();
    assert.equal(await pm.page.evaluate(() => document.activeElement?.textContent?.includes('검토·승인') ?? false), true);
    await pm.page.evaluate(() => { document.documentElement.style.zoom = '200%'; });
    assert.equal(await pm.page.getByRole('tab', { name: '검토·승인' }).isVisible(), true);
    console.log('P10 browser E2E: real Chromium admin ping, async request, real cancellation, completion, 1024/focus/200% PASSED');
  } finally {
    for (const context of contexts) await context.close().catch(() => undefined);
    await browser?.close();
    await new Promise<void>((resolve) => web.close(() => resolve()));
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await api.waitForDatabaseClose();
    await db.$disconnect();
    fs.rmSync(uploadDir, { recursive: true, force: true });
    for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
