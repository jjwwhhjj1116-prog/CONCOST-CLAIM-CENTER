import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import { createServer } from 'node:http';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createPrismaClient, resetDatabase, seedDatabase } from '@claim-studio/database';
import { createApiServer } from '../apps/api/src/server';

const root = path.resolve(__dirname, '..');

function browserExecutable(): string {
  if (process.env.CHROMIUM_BIN) return process.env.CHROMIUM_BIN;
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    if (fs.existsSync(chromePath)) return chromePath;
    const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    if (fs.existsSync(edgePath)) return edgePath;
    const ungoogledPath = path.join(localAppData, 'Chromium\\Application\\chrome.exe');
    if (fs.existsSync(ungoogledPath)) return ungoogledPath;
  }
  return 'google-chrome';
}

function serveStaticFile(req: http.IncomingMessage, res: http.ServerResponse, webDist: string, webOrigin: string): void {
  const urlPath = decodeURIComponent(new URL(req.url || '/', webOrigin).pathname);
  const requested = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const candidate = path.resolve(webDist, requested);
  const safe = candidate.startsWith(`${path.resolve(webDist)}${path.sep}`);
  const filePath = safe && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(webDist, 'index.html');
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };
  res.statusCode = 200;
  res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
}

async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not start: ${url}`);
}

declare global {
  interface Window {
    __CLAIM_API_ORIGIN__?: string;
  }
}

async function newPage(browser: Browser, apiOrigin: string, viewport = { width: 1440, height: 900 }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((origin: string) => { window.__CLAIM_API_ORIGIN__ = origin; }, apiOrigin);
  return { context, page: await context.newPage() };
}

async function login(page: Page, webOrigin: string, email: string) {
  const loginUrl = `${webOrigin}/login`;
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
  const emailInput = page.locator('#email').or(page.getByLabel('이메일'));
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });
  await emailInput.fill(email);
  const passwordInput = page.locator('#password').or(page.getByLabel('비밀번호'));
  await passwordInput.fill('Password123!');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForSelector('.session-identity', { timeout: 15000 });
}

async function main() {
  console.log('--- Starting P13 Chromium Real E2E Test ---');
  const unique = `p13-e2e-${process.pid}`;
  const databasePath = path.join(root, 'packages/database/.data', `${unique}.db`);
  const uploadDir = path.join(root, 'packages/database/.data', `${unique}-uploads`);
  const databaseUrl = `file:${databasePath}`;

  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const db = createPrismaClient(databaseUrl);

  let webOrigin = '';
  const webDist = path.join(root, 'apps/web/dist');
  const web = createServer((req, res) => serveStaticFile(req, res, webDist, webOrigin));
  await new Promise<void>((resolve) => web.listen(0, '127.0.0.1', resolve));
  const webPort = (web.address() as any).port;
  webOrigin = `http://127.0.0.1:${webPort}`;

  const api = createApiServer({
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

    browser = await chromium.launch({ executablePath: browserExecutable(), headless: true });

    // 1. PM Login & FEE-01 Vertical Flow
    console.log('1. PM login & Fee Compensation calculation...');
    const { page: pmPage } = await newPage(browser, apiOrigin);
    await login(pmPage, webOrigin, 'pm@example.invalid');

    await pmPage.goto(`${webOrigin}/success-fee`, { waitUntil: 'domcontentloaded' });
    await pmPage.waitForSelector('text=FEE-01 손해사정 비용 & 성공보수 정산 관리');

    // Click Calculate Estimated
    await pmPage.getByRole('button', { name: '예상 보수 계산 (PM/Admin)' }).click();
    await pmPage.waitForSelector('text=예상 성공보수가 계산되었습니다');

    // 2. Director Login & Final Fee Approval
    console.log('2. Director login & Final fee approval...');
    const { page: directorPage } = await newPage(browser, apiOrigin);
    await login(directorPage, webOrigin, 'director@example.invalid');

    await directorPage.goto(`${webOrigin}/success-fee`, { waitUntil: 'domcontentloaded' });
    await directorPage.waitForSelector('text=FEE-01 손해사정 비용 & 성공보수 정산 관리');

    await directorPage.getByRole('button', { name: '최종 보수 승인 확정 (CEO/Director)' }).click();
    await directorPage.waitForSelector('text=최종 성공보수가 확정되었습니다');
    await directorPage.waitForSelector('text=최종 확정됨');

    // 3. Payment Addition & Unpaid Balance Update
    console.log('3. Payment recording & Unpaid balance update...');
    await directorPage.fill('#payment-amount-input', '10000000');
    await directorPage.getByRole('button', { name: '수납 내역 추가' }).click();
    await directorPage.waitForSelector('text=수납 내역이 추가되었습니다');

    // 4. Case Closure with Unpaid Balance Confirmation
    console.log('4. Case closure with unpaid balance confirmation modal...');
    await directorPage.getByRole('button', { name: '사건 종결 처리 시도' }).click();
    await directorPage.waitForSelector('text=미수금 존재 사건 종결 경고');

    await directorPage.getByRole('button', { name: '미수 강제 종결 진행' }).click();
    await directorPage.waitForSelector('text=미수금이 존재하는 상태로 사건이 종결 처리되었습니다');

    console.log('✅ P13 Chromium Real E2E Test Passed Cleanly!');
  } finally {
    if (browser) await browser.close();
    await new Promise<void>((resolve) => web.close(() => resolve()));
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await db.$disconnect();
    try { if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath); } catch {}
    try { if (fs.existsSync(uploadDir)) fs.rmSync(uploadDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((err) => {
  console.error('❌ P13 Chromium E2E Test Failed:', err);
  process.exit(1);
});
