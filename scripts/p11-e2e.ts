import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import * as path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createPrismaClient, databaseUrlFor, resetDatabase, seedDatabase } from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { createP09Fixture } from './p09-test-support';

const root = path.resolve(__dirname, '..');
const webPort = 43183;
const apiPort = 3003;
const webOrigin = `http://127.0.0.1:${webPort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const databasePath = path.join(root, 'packages/database/.data', `p11-e2e-${process.pid}.db`);
const uploadDir = path.join(root, 'packages/database/.data', `p11-e2e-uploads-${process.pid}`);
const databaseUrl = databaseUrlFor(databasePath);

function browserExecutable(): string {
  const candidates = [
    process.env.CHROME_PATH ?? '', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) throw new Error('Chrome/Edge executable not found. Set CHROME_PATH for P11 browser E2E.');
  return found;
}

function productionWebServer(): Server {
  const distRoot = path.join(root, 'apps/web/dist');
  if (!fs.existsSync(path.join(distRoot, 'index.html'))) throw new Error('P11 browser E2E requires the current production build');
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
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
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
  console.log('P11 browser E2E: source lock, scope confirmation, async generation/cancel, citation preview and human apply');
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const db = createPrismaClient(databaseUrl);
  const api: ManagedApiServer = createApiServer({ databaseUrl, allowedOrigins: [webOrigin], secureCookies: false, uploadDir, allowTestAiModes: true });
  await new Promise<void>((resolve, reject) => api.once('error', reject).listen(apiPort, '127.0.0.1', resolve));
  const web = productionWebServer();
  await new Promise<void>((resolve, reject) => web.once('error', reject).listen(webPort, '127.0.0.1', resolve));

  let browser: Browser | undefined;
  const contexts: BrowserContext[] = [];
  try {
    await Promise.all([waitFor(`${apiOrigin}/health`), waitFor(webOrigin)]);
    const fixture = await createP09Fixture(apiOrigin, db, { sectionCount: 1, requestOrigin: webOrigin });
    browser = await chromium.launch({ executablePath: browserExecutable(), headless: true });

    const pm = await newPage(browser);
    contexts.push(pm.context);
    const consoleErrors: string[] = [];
    await login(pm.page, 'pm@example.invalid');
    pm.page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await pm.page.goto(`${webOrigin}/cases/CASE-SYN-001/reports/${encodeURIComponent(fixture.reportId)}/studio`, { waitUntil: 'domcontentloaded' });
    await pm.page.locator('.p09-studio').waitFor({ state: 'visible' });
    const panel = pm.page.locator('.p11-grounding-section');
    await panel.getByText(/SYNTHETIC_MEETING_FINAL_02/).waitFor({ state: 'visible' });
    const lockedInstruction = await panel.getByLabel('작성 지시').inputValue();
    await panel.locator('.p11-source-item').filter({ hasText: 'SYNTHETIC_MEETING_FINAL_02' }).locator('input[type="checkbox"]').check();
    await panel.getByRole('button', { name: '1. 근거 Manifest 고정' }).click();
    const modal = pm.page.getByRole('dialog', { name: '외부 전송 범위 및 예상 비용 확인' });
    await modal.waitFor({ state: 'visible' });
    await modal.getByText(/선택 자료 수:\s*1개/).waitFor({ state: 'visible' });
    await modal.getByRole('button', { name: '전송 및 AI 초안 생성 시작' }).click();
    await panel.getByText('GENERATED', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    await panel.locator('.p11-cit-anchor').getByText(/Synthetic final raw transcript text/).waitFor({ state: 'visible' });
    const [applyResponse] = await Promise.all([
      pm.page.waitForResponse((response) => response.url().includes(`/ai/suggestions/`) && response.url().endsWith('/apply')),
      panel.getByRole('button', { name: '본문에 적용 (새 Revision 생성)' }).click()
    ]);
    assert.equal(applyResponse.status(), 200, await applyResponse.text());
    const applyNotice = pm.page.locator('.p09-notice');
    await applyNotice.getByText(/새 DRAFT 개정본으로 적용/).waitFor({ state: 'visible' });
    assert.match(await applyNotice.innerText(), /새 DRAFT 개정본으로 적용/);
    const revision = await db.reportSectionRevision.findFirstOrThrow({ where: { sectionId: fixture.sectionIds[0] }, include: { evidenceLinks: true } });
    assert.equal(revision.evidenceLinks.length, 1);
    assert.equal(revision.evidenceLinks[0].sourceMeetingId, 'MEET-SYN-002');
    assert.equal((await db.reportSection.findUniqueOrThrow({ where: { id: fixture.sectionIds[0] } })).status, 'DRAFT');

    const selection = await db.aiGroundingSelection.findFirstOrThrow({ where: { sectionId: fixture.sectionIds[0], actorId: 'USR-PM' }, orderBy: { createdAt: 'desc' } });
    const slowResponse = await pm.page.evaluate(async ({ origin, reportId, sectionId, selectionId, instruction }) => {
      const csrf = document.cookie.split(';').map((value) => value.trim()).find((value) => value.startsWith('csrf_token='))?.split('=')[1] ?? '';
      const response = await fetch(`${origin}/api/reports/${reportId}/sections/${sectionId}/ai/suggestions`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf) },
        body: JSON.stringify({ selectionId, instruction, idempotencyKey: 'P11-E2E-SLOW-CANCEL', waitForCompletion: false, testMode: 'SLOW_SUCCESS' })
      });
      return { status: response.status, body: await response.json() };
    }, { origin: apiOrigin, reportId: fixture.reportId, sectionId: fixture.sectionIds[0], selectionId: selection.id, instruction: lockedInstruction });
    assert.equal(slowResponse.status, 202, JSON.stringify(slowResponse.body));
    await pm.page.reload({ waitUntil: 'domcontentloaded' });
    await pm.page.locator('.p09-studio').waitFor({ state: 'visible' });
    const reloadedPanel = pm.page.locator('.p11-grounding-section');
    await reloadedPanel.getByRole('button', { name: '생성 요청 취소' }).waitFor({ state: 'visible' });
    await reloadedPanel.getByRole('button', { name: '생성 요청 취소' }).click();
    await pm.page.getByText(/생성 요청이 취소/).waitFor({ state: 'visible' });
    await new Promise((resolve) => setTimeout(resolve, 900));
    assert.equal((await db.aiDraftSuggestion.findUniqueOrThrow({ where: { id: slowResponse.body.suggestion.id } })).status, 'CANCELED');

    const reviewer = await newPage(browser);
    contexts.push(reviewer.context);
    await login(reviewer.page, 'reviewer@example.invalid');
    await reviewer.page.goto(`${webOrigin}/cases/CASE-SYN-001/reports/${encodeURIComponent(fixture.reportId)}/studio`, { waitUntil: 'domcontentloaded' });
    await reviewer.page.locator('.p09-studio').waitFor({ state: 'visible' });
    const reviewerPanel = reviewer.page.locator('.p11-grounding-section');
    assert.equal(await reviewerPanel.getByRole('button', { name: '1. 근거 Manifest 고정' }).isDisabled(), true);
    assert.equal(await reviewerPanel.getByRole('button', { name: '본문에 적용 (새 Revision 생성)' }).isDisabled(), true);

    const storage = await pm.page.evaluate(() => `${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)}`);
    assert.doesNotMatch(storage, /(?:sk-|api[_-]?key|Bearer\s)/i);
    assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
    await pm.page.setViewportSize({ width: 1024, height: 768 });
    assert.equal(await pm.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await pm.page.evaluate(() => { document.documentElement.style.zoom = '200%'; });
    await pm.page.getByRole('tab', { name: '목차·근거' }).focus();
    assert.equal(await pm.page.evaluate(() => document.activeElement?.textContent?.includes('목차·근거') ?? false), true);
    console.log('P11 browser E2E: real Chromium grounded authoring, citation, apply, cancel, reviewer RBAC, 1024/200% PASSED');
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
