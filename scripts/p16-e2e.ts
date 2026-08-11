import * as fs from 'node:fs';
import * as path from 'node:path';
import { createServer, type Server } from 'node:http';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createPrismaClient, resetDatabase, seedDatabase } from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { createP09Fixture } from './p09-test-support';

const root = path.resolve(__dirname, '..');

function browserExecutable(): string {
  if (process.env.CHROMIUM_BIN) return process.env.CHROMIUM_BIN;
  if (process.platform === 'win32') {
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    if (fs.existsSync(chromePath)) return chromePath;
    const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    if (fs.existsSync(edgePath)) return edgePath;
  }
  return 'google-chrome';
}

function productionWebServer(webOrigin: string): Server {
  const distRoot = path.join(root, 'apps/web/dist');
  if (!fs.existsSync(path.join(distRoot, 'index.html'))) {
    throw new Error('P16 browser E2E requires current production build in apps/web/dist');
  }
  const types: Record<string, string> = {
    '.css': 'text/css',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml'
  };
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
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not start: ${url}`);
}

async function newPage(browser: Browser, apiOrigin: string, viewport = { width: 1440, height: 900 }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((origin: string) => { (window as any).__CLAIM_API_ORIGIN__ = origin; }, apiOrigin);
  return { context, page: await context.newPage() };
}

async function login(page: Page, webOrigin: string, email: string) {
  await page.goto(`${webOrigin}/login`, { waitUntil: 'domcontentloaded' });
  const emailInput = page.locator('#email').or(page.getByLabel('이메일'));
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });
  await emailInput.fill(email);
  const passwordInput = page.locator('#password').or(page.getByLabel('비밀번호'));
  await passwordInput.fill('Password123!');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.locator('.session-identity').waitFor({ state: 'attached', timeout: 15000 });
}

async function main() {
  console.log('--- Starting P16 Chromium Real E2E Test (Staging Readiness & Responsive UX) ---');
  const unique = `p16-e2e-${process.pid}`;
  const databasePath = path.join(root, 'packages/database/.data', `${unique}.db`);
  const uploadDir = path.join(root, 'packages/database/.data', `${unique}-uploads`);
  const databaseUrl = `file:${databasePath}`;

  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const db = createPrismaClient(databaseUrl);

  let webOrigin = '';
  const webServer = productionWebServer('http://127.0.0.1:0');
  await new Promise<void>((resolve) => webServer.listen(0, '127.0.0.1', resolve));
  const webPort = (webServer.address() as any).port;
  webOrigin = `http://127.0.0.1:${webPort}`;

  const api: ManagedApiServer = createApiServer({
    databaseUrl,
    allowedOrigins: [webOrigin],
    secureCookies: false,
    uploadDir
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  const apiPort = (api.address() as any).port;
  const apiOrigin = `http://127.0.0.1:${apiPort}`;

  let browser: Browser | undefined;

  try {
    await waitFor(`${apiOrigin}/health`);
    await waitFor(`${webOrigin}/`);

    await createP09Fixture(apiOrigin, db, { sectionCount: 1, requestOrigin: webOrigin });

    browser = await chromium.launch({ executablePath: browserExecutable(), headless: true });

    // 1. API Probes Verification (/api/health and /api/readiness)
    console.log('1. Verifying /api/health and /api/readiness API probes...');
    const healthResp = await fetch(`${apiOrigin}/api/health`);
    const healthJson: any = await healthResp.json();
    if (healthResp.status !== 200 || healthJson.status !== 'ok') {
      throw new Error('/api/health probe failed');
    }

    const readinessResp = await fetch(`${apiOrigin}/api/readiness`);
    const readinessJson: any = await readinessResp.json();
    if (readinessResp.status !== 200 || readinessJson.status !== 'ready') {
      throw new Error('/api/readiness probe failed');
    }

    // 2. Responsive UI Viewports: 1440, 1024, 640
    console.log('2. Responsive layout verification (1440, 1024, 640 viewports)...');

    // Viewport 1440
    const { page: page1440 } = await newPage(browser, apiOrigin, { width: 1440, height: 900 });
    await login(page1440, webOrigin, 'admin@example.invalid');
    await page1440.goto(`${webOrigin}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page1440.waitForSelector('text=메인 대시보드');

    // Viewport 1024
    const { page: page1024 } = await newPage(browser, apiOrigin, { width: 1024, height: 768 });
    await login(page1024, webOrigin, 'admin@example.invalid');
    await page1024.goto(`${webOrigin}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page1024.waitForSelector('text=메인 대시보드');

    // Viewport 640
    const { page: page640 } = await newPage(browser, apiOrigin, { width: 640, height: 960 });
    await login(page640, webOrigin, 'admin@example.invalid');
    await page640.goto(`${webOrigin}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page640.waitForSelector('text=메인 대시보드');

    console.log('✅ P16 Chromium Real E2E Test Passed Cleanly!');
  } finally {
    if (browser) await browser.close();
    await new Promise<void>((resolve) => webServer.close(() => resolve()));
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await db.$disconnect();
    try { if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath); } catch {}
    try { if (fs.existsSync(uploadDir)) fs.rmSync(uploadDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((err) => {
  console.error('❌ P16 Chromium E2E Test Failed:', err);
  process.exit(1);
});
