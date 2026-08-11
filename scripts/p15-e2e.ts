import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createServer, type Server } from 'node:http';
import * as assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createPrismaClient, resetDatabase, seedDatabase, type PrismaClient } from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { createBackupPackage, restoreBackupPackage } from '../apps/api/src/backup/backup-engine';
import { createP09Fixture, type P09Fixture, type TestSession } from './p09-test-support';

const root = path.resolve(__dirname, '..');
const axeSourcePath = require.resolve('axe-core/axe.min.js');

function browserExecutable(): string {
  const candidates = [
    process.env.CHROME_PATH ?? '',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium'
  ];
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) throw new Error('Chrome/Edge executable not found. Set CHROME_PATH for P15 browser E2E.');
  return found;
}

function productionWebServer(webOrigin: string): Server {
  const distRoot = path.join(root, 'apps/web/dist');
  if (!fs.existsSync(path.join(distRoot, 'index.html'))) throw new Error('P15 E2E requires a current production build.');
  const types: Record<string, string> = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
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

async function listen(server: Server | ManagedApiServer, port = 0): Promise<number> {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return (server.address() as { port: number }).port;
}

async function closeApi(api: ManagedApiServer): Promise<void> {
  await new Promise<void>((resolve) => api.close(() => resolve()));
  await api.waitForDatabaseClose();
}

async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* restarting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${url}`);
}

function apiFor(databaseUrl: string, port: number, webOrigin: string, data: {
  uploadDir: string; backupRootDir: string; restoreRootDir: string; credentialVaultDir: string; pkceVaultDir: string; signingKey: Buffer;
}): ManagedApiServer {
  return createApiServer({
    databaseUrl,
    allowedOrigins: [webOrigin],
    secureCookies: false,
    uploadDir: data.uploadDir,
    backupRootDir: data.backupRootDir,
    restoreRootDir: data.restoreRootDir,
    backupSigningKey: data.signingKey,
    backupStorageRoots: [
      { name: 'google-credentials', sourceDir: data.credentialVaultDir },
      { name: 'google-pkce', sourceDir: data.pkceVaultDir }
    ]
  });
}

async function signedInPage(browser: Browser, session: TestSession, apiOrigin: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies(session.cookie.split('; ').map((entry) => {
    const separator = entry.indexOf('=');
    return { name: entry.slice(0, separator), value: entry.slice(separator + 1), domain: '127.0.0.1', path: '/', sameSite: 'Lax' as const };
  }));
  await context.addInitScript((origin: string) => { window.__CLAIM_API_ORIGIN__ = origin; }, apiOrigin);
  return { context, page: await context.newPage() };
}

async function openStudio(page: Page, webOrigin: string, fixture: P09Fixture): Promise<void> {
  await page.goto(`${webOrigin}/cases/CASE-SYN-001/reports/${encodeURIComponent(fixture.reportId)}/studio`, { waitUntil: 'domcontentloaded' });
  await page.locator('.p09-studio').waitFor({ state: 'visible', timeout: 15_000 });
}

async function assertNoSeriousAccessibilityViolations(page: Page): Promise<void> {
  await page.addScriptTag({ path: axeSourcePath });
  const violations = await page.evaluate(async () => {
    const result = await (window as any).axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      resultTypes: ['violations']
    });
    return result.violations
      .filter((violation: any) => violation.impact === 'critical' || violation.impact === 'serious')
      .map((violation: any) => ({ id: violation.id, impact: violation.impact, targets: violation.nodes.map((node: any) => node.target) }));
  });
  assert.deepEqual(violations, [], 'axe critical/serious violations: ' + JSON.stringify(violations));
}

async function assertNoOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(overflow, false, `${label} must not horizontally overflow`);
}

async function main(): Promise<void> {
  console.log('P15 browser E2E: autosave, API restart, signed backup restore, responsive recovery');
  const dataRoot = path.join(root, 'packages/database/.data', `p15-e2e-${process.pid}-${Date.now()}`);
  const databasePath = path.join(dataRoot, 'database.db');
  const data = {
    uploadDir: path.join(dataRoot, 'uploads'),
    backupRootDir: path.join(dataRoot, 'backups'),
    restoreRootDir: path.join(dataRoot, 'restores'),
    credentialVaultDir: path.join(dataRoot, 'google-credentials'),
    pkceVaultDir: path.join(dataRoot, 'google-pkce'),
    signingKey: crypto.createHash('sha256').update(`p15-e2e-${dataRoot}`).digest()
  };
  const databaseUrl = `file:${databasePath}`;
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  let db: PrismaClient = createPrismaClient(databaseUrl);
  const web = productionWebServer('http://127.0.0.1:0');
  const webPort = await listen(web);
  const webOrigin = `http://127.0.0.1:${webPort}`;
  let api = apiFor(databaseUrl, 0, webOrigin, data);
  const apiPort = await listen(api);
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  let browser: Browser | undefined;
  let browserContext: BrowserContext | undefined;

  try {
    await Promise.all([waitFor(`${apiOrigin}/health`), waitFor(webOrigin)]);
    const fixture = await createP09Fixture(apiOrigin, db, { sectionCount: 3, requestOrigin: webOrigin });
    browser = await chromium.launch({ executablePath: browserExecutable(), headless: true });
    const signedIn = await signedInPage(browser, fixture.pm, apiOrigin);
    browserContext = signedIn.context;
    const page = signedIn.page;
    await openStudio(page, webOrigin, fixture);

    const durableText = `P15 서버 재시작 후 복구되는 자동저장 본문 ${Date.now()}`;
    const autoSave = page.waitForResponse((response) => response.url().includes('/revisions') && response.request().method() === 'POST', { timeout: 15_000 });
    await page.locator('#p09-report-content').fill(durableText);
    assert.equal((await autoSave).status(), 201, 'debounced autosave must commit to the database');
    await page.waitForTimeout(100);
    assert.equal(await db.reportSectionRevision.count({ where: { sectionId: fixture.sectionIds[0], content: durableText } }), 1);

    console.log('  1/4 autosave committed; simulating API process stop/restart');
    await closeApi(api);
    await db.$disconnect();
    api = apiFor(databaseUrl, apiPort, webOrigin, data);
    await listen(api, apiPort);
    await waitFor(`${apiOrigin}/health`);
    db = createPrismaClient(databaseUrl);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.p09-studio').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#p09-report-content').inputValue(), durableText, 'autosaved text must survive API restart');

    console.log('  2/4 creating signed backup, then introducing a post-backup change');
    fs.mkdirSync(data.uploadDir, { recursive: true });
    fs.writeFileSync(path.join(data.uploadDir, 'browser-proof.txt'), 'P15 browser recovery upload', 'utf8');
    const manifest = await createBackupPackage({
      backupRootDir: data.backupRootDir,
      uploadDir: data.uploadDir,
      additionalStorageRoots: [
        { name: 'google-credentials', sourceDir: data.credentialVaultDir },
        { name: 'google-pkce', sourceDir: data.pkceVaultDir }
      ],
      signingKey: data.signingKey,
      db
    });
    const postBackupText = `post-backup change ${Date.now()}`;
    const postBackupSave = page.waitForResponse((response) => response.url().includes('/revisions') && response.request().method() === 'POST', { timeout: 15_000 });
    await page.locator('#p09-report-content').fill(postBackupText);
    assert.equal((await postBackupSave).status(), 201);

    await closeApi(api);
    await db.$disconnect();
    const restored = await restoreBackupPackage({
      backupId: manifest.backupId,
      backupRootDir: data.backupRootDir,
      restoreRootDir: data.restoreRootDir,
      restoreName: 'browser-drill',
      signingKey: data.signingKey
    });
    const restoredUrl = `file:${restored.dbPath}`;
    api = apiFor(restoredUrl, apiPort, webOrigin, {
      ...data,
      uploadDir: path.join(restored.storageDir, 'uploads'),
      credentialVaultDir: path.join(restored.storageDir, 'google-credentials'),
      pkceVaultDir: path.join(restored.storageDir, 'google-pkce')
    });
    await listen(api, apiPort);
    await waitFor(`${apiOrigin}/health`);
    db = createPrismaClient(restoredUrl);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.p09-studio').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#p09-report-content').inputValue(), durableText, 'signed restore must return to the backed-up autosave revision');
    assert.equal(await db.reportSectionRevision.count({ where: { sectionId: fixture.sectionIds[0], content: postBackupText } }), 0);
    assert.equal(fs.readFileSync(path.join(restored.storageDir, 'uploads', 'browser-proof.txt'), 'utf8'), 'P15 browser recovery upload');
    await assertNoSeriousAccessibilityViolations(page);

    console.log('  3/4 restored report/upload and axe scan verified; checking responsive/accessibility boundaries');
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 640, height: 800 }]) {
      await page.setViewportSize(viewport);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.p09-studio').waitFor({ state: 'visible' });
      await assertNoOverflow(page, `${viewport.width}px`);
    }
    await page.evaluate(() => { document.documentElement.style.zoom = '200%'; });
    await assertNoOverflow(page, '200% zoom');
    const editor = page.locator('#p09-report-content');
    await editor.focus();
    const focus = await editor.evaluate((element) => ({
      visible: element.getBoundingClientRect().width > 0,
      outlineWidth: getComputedStyle(element).outlineWidth
    }));
    assert.equal(focus.visible, true);
    assert.notEqual(focus.outlineWidth, '0px');

    console.log('  4/4 P15 autosave/restart/backup/restore/1440-1024-640/200%-focus PASSED');
  } finally {
    await browserContext?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    if (api.listening) await closeApi(api).catch(() => undefined);
    await db.$disconnect().catch(() => undefined);
    await new Promise<void>((resolve) => web.close(() => resolve()));
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
