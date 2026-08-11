import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createServer, type Server } from 'node:http';
import * as assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import {
  createPrismaClient, databaseUrlFor, resetDatabase, seedDatabase, type PrismaClient
} from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { EncryptedFileGooglePkceVerifierVault } from '../apps/api/src/google-workspace/GoogleCredentialVault';
import { createP09Fixture, type P09Fixture, type TestSession } from './p09-test-support';

const root = path.resolve(__dirname, '..');

function browserExecutable(): string {
  const candidates = [
    process.env.CHROME_PATH ?? '',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ];
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) throw new Error('Chrome/Edge executable not found. Set CHROME_PATH for P16 browser E2E.');
  return found;
}

function productionWebServer(webOrigin: string): Server {
  const distRoot = path.join(root, 'apps/web/dist');
  if (!fs.existsSync(path.join(distRoot, 'index.html'))) throw new Error('P16 E2E requires a current production build.');
  const types: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml'
  };
  return createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', webOrigin).pathname);
    const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const candidate = path.resolve(distRoot, requested);
    const safe = candidate.startsWith(path.resolve(distRoot) + path.sep);
    const filePath = safe && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
      ? candidate
      : path.join(distRoot, 'index.html');
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': types[path.extname(filePath)] ?? 'application/octet-stream'
    });
    fs.createReadStream(filePath).pipe(response);
  });
}

async function listen(server: Server | ManagedApiServer, port = 0): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return (server.address() as { port: number }).port;
}

async function closeApi(api: ManagedApiServer): Promise<void> {
  await new Promise<void>((resolve) => api.close(() => resolve()));
  await api.waitForDatabaseClose();
}

async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* process is starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server did not become ready: ' + url);
}

function signedInContext(browser: Browser, session: TestSession, apiOrigin: string): Promise<BrowserContext> {
  return browser.newContext({ viewport: { width: 1440, height: 900 } }).then(async (context) => {
    await context.addCookies(session.cookie.split('; ').map((entry) => {
      const separator = entry.indexOf('=');
      return {
        name: entry.slice(0, separator),
        value: entry.slice(separator + 1),
        domain: '127.0.0.1',
        path: '/',
        sameSite: 'Lax' as const
      };
    }));
    await context.addInitScript((origin: string) => { window.__CLAIM_API_ORIGIN__ = origin; }, apiOrigin);
    return context;
  });
}

async function assertNoOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    body: document.body.scrollWidth > document.body.clientWidth
  }));
  assert.deepEqual(overflow, { document: false, body: false }, label + ' must not horizontally overflow');
}

async function openRoute(page: Page, url: string, selector: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 15_000 });
}

async function main(): Promise<void> {
  console.log('P16 browser E2E: real workflow, status recovery, restart, responsive release candidate');
  const dataRoot = path.join(root, 'packages/database/.data', `p16-e2e-${process.pid}-${Date.now()}`);
  const databasePath = path.join(dataRoot, 'database', 'claim-center.db');
  const uploadDir = path.join(dataRoot, 'storage');
  const backupRootDir = path.join(dataRoot, 'backups');
  const restoreRootDir = path.join(dataRoot, 'restores');
  const credentialVaultDir = path.join(dataRoot, 'google-credentials');
  const pkceVaultDir = path.join(dataRoot, 'google-pkce');
  const databaseUrl = databaseUrlFor(databasePath);
  const backupSigningKey = crypto.createHash('sha256').update(dataRoot + ':backup').digest();
  const pkceMasterKey = crypto.createHash('sha256').update(dataRoot + ':pkce').digest();
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  let db: PrismaClient = createPrismaClient(databaseUrl);

  const web = productionWebServer('http://127.0.0.1:0');
  const webPort = await listen(web);
  const webOrigin = `http://127.0.0.1:${webPort}`;
  const makeApi = () => createApiServer({
    databaseUrl,
    databasePath,
    volumeRootDir: dataRoot,
    allowedOrigins: [webOrigin],
    secureCookies: false,
    uploadDir,
    backupRootDir,
    restoreRootDir,
    credentialVaultDir,
    pkceVaultDir,
    backupSigningKey,
    backupStorageRoots: [
      { name: 'google-credentials', sourceDir: credentialVaultDir },
      { name: 'google-pkce', sourceDir: pkceVaultDir }
    ],
    googlePkceVerifierVault: new EncryptedFileGooglePkceVerifierVault({
      directory: pkceVaultDir,
      masterKey: pkceMasterKey
    }),
    allowTestGoogleModes: true
  });
  let api = makeApi();
  const apiPort = await listen(api);
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  let browser: Browser | undefined;
  const contexts: BrowserContext[] = [];

  try {
    await Promise.all([waitFor(webOrigin), waitFor(apiOrigin + '/api/readiness')]);
    const fixture: P09Fixture = await createP09Fixture(apiOrigin, db, {
      sectionCount: 3,
      requestOrigin: webOrigin
    });
    const caseId = (await db.report.findUniqueOrThrow({ where: { id: fixture.reportId } })).caseId;
    browser = await chromium.launch({ executablePath: browserExecutable(), headless: true });

    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    contexts.push(adminContext);
    await adminContext.addInitScript((origin: string) => { window.__CLAIM_API_ORIGIN__ = origin; }, apiOrigin);
    const page = await adminContext.newPage();
    await page.route('**/api/dashboard/kpi', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 450));
      await route.continue();
    }, { times: 1 });
    await page.goto(webOrigin + '/login', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('이메일').fill('admin@example.invalid');
    await page.getByLabel('비밀번호').fill('Password123!');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.locator('[data-status-type="loading"]').waitFor({ state: 'visible', timeout: 5_000 });
    await page.locator('.dashboard-page').waitFor({ state: 'visible', timeout: 15_000 });
    console.log('  1/6 actual login and dashboard loading-to-ready state PASS');

    await page.route('**/api/cases?**', async (route) => {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Concurrent case list conflict' }) });
    }, { times: 1 });
    await openRoute(page, webOrigin + '/cases', '[data-status-type="conflict"]');
    await page.locator('.status-feedback-action-btn').click();
    await page.locator('table').waitFor({ state: 'visible', timeout: 15_000 });

    await page.route('**/api/cases?**', async (route) => { await route.abort('internetdisconnected'); }, { times: 1 });
    await openRoute(page, webOrigin + '/cases', '[data-status-type="offline"]');
    await page.locator('.status-feedback-action-btn').click();
    await page.locator('table').waitFor({ state: 'visible', timeout: 15_000 });

    await page.route('**/api/cases?**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cases: [], total: 0, page: 1, limit: 100 }) });
    }, { times: 1 });
    await openRoute(page, webOrigin + '/cases', '[data-status-type="empty"]');
    console.log('  2/6 409, offline/retry, and true empty states PASS');

    const reviewerContext = await signedInContext(browser, fixture.reviewer, apiOrigin);
    contexts.push(reviewerContext);
    const reviewerPage = await reviewerContext.newPage();
    await openRoute(reviewerPage, webOrigin + '/ai-config', '[data-status-type="forbidden"]');
    assert.match(await reviewerPage.locator('[data-status-type="forbidden"]').innerText(), /403/);
    console.log('  3/6 real reviewer 403 route PASS');

    const routeChecks = [
      [`/cases/detail?caseId=${encodeURIComponent(caseId)}`, '#route-title'],
      [`/cases/files?caseId=${encodeURIComponent(caseId)}`, '#route-title'],
      [`/meetings?caseId=${encodeURIComponent(caseId)}`, '#route-title'],
      ['/reports', '.report-list-page'],
      [`/cases/${encodeURIComponent(caseId)}/reports/${encodeURIComponent(fixture.reportId)}/studio`, '.p09-studio'],
      ['/approval', '.approval-inbox-page']
    ] as const;
    for (const [pathname, selector] of routeChecks) await openRoute(page, webOrigin + pathname, selector);
    await openRoute(
      page,
      webOrigin + `/cases/${encodeURIComponent(caseId)}/reports/${encodeURIComponent(fixture.reportId)}/studio`,
      '.p12-outputs-section'
    );
    console.log('  4/6 dashboard→case→materials/meetings→studio→approval→output route PASS');

    await closeApi(api);
    api = makeApi();
    await listen(api, apiPort);
    await waitFor(apiOrigin + '/api/readiness');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.p09-studio').waitFor({ state: 'visible', timeout: 15_000 });
    assert.equal(await page.locator('.p12-outputs-section').isVisible(), true);
    console.log('  5/6 API process restart restored the active studio session PASS');

    const screenshotRoot = path.join(root, 'artifacts/harness/P16/screenshots');
    fs.mkdirSync(screenshotRoot, { recursive: true });
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
      { width: 640, height: 900 }
    ]) {
      await page.setViewportSize(viewport);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.p09-studio').waitFor({ state: 'visible', timeout: 15_000 });
      await assertNoOverflow(page, viewport.width + 'px');
      await page.screenshot({
        path: path.join(screenshotRoot, `report-studio-${viewport.width}.png`),
        fullPage: true
      });
    }
    await page.evaluate(() => { document.documentElement.style.zoom = '200%'; });
    await assertNoOverflow(page, '200% zoom');
    const editor = page.locator('#p09-report-content');
    await editor.focus();
    const focus = await editor.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    assert.notEqual(focus.outlineStyle, 'none');
    assert.notEqual(focus.outlineWidth, '0px');
    console.log('  6/6 1440/1024/640, 200% zoom, focus, and screenshots PASS');
    console.log('P16 Chromium E2E PASSED (6 release-candidate flows)');
  } finally {
    for (const context of contexts) await context.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    if (api.listening) await closeApi(api).catch(() => undefined);
    await db.$disconnect().catch(() => undefined);
    await new Promise<void>((resolve) => web.close(() => resolve()));
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error('P16 Chromium E2E failed', error);
  process.exitCode = 1;
});
