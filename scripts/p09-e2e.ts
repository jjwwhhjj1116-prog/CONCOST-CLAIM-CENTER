import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import * as path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createPrismaClient, databaseUrlFor, resetDatabase, seedDatabase } from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { createP09Fixture, requestJson, revisionPayload, type TestSession } from './p09-test-support';

const root = path.resolve(__dirname, '..');
const webPort = 43181;
const webOrigin = `http://127.0.0.1:${webPort}`;
const apiOrigin = 'http://127.0.0.1:3001';
const databasePath = path.join(root, 'packages/database/.data', `p09-e2e-${process.pid}.db`);
const uploadDir = path.join(root, 'packages/database/.data', `p09-e2e-uploads-${process.pid}`);
const databaseUrl = databaseUrlFor(databasePath);

function browserExecutable(): string {
  const localAppData = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    process.env.CHROME_PATH ?? '',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(localAppData, 'Google/Chrome/Application/chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) throw new Error('Chrome/Edge executable not found. Set CHROME_PATH for P09 browser E2E.');
  return found;
}

function productionWebServer(): Server {
  const distRoot = path.join(root, 'apps/web/dist');
  if (!fs.existsSync(path.join(distRoot, 'index.html'))) throw new Error('P09 E2E requires the current production build. Run pnpm build first.');
  const contentTypes: Record<string, string> = {
    '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml'
  };
  return createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', webOrigin).pathname);
    const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const candidate = path.resolve(distRoot, requested);
    const safe = candidate.startsWith(`${path.resolve(distRoot)}${path.sep}`);
    const filePath = safe && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(distRoot, 'index.html');
    response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': contentTypes[path.extname(filePath)] ?? 'application/octet-stream' });
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

async function signedInPage(browser: Browser, session: TestSession, viewport: { width: number; height: number }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport });
  const cookies = session.cookie.split('; ').map((entry) => {
    const separator = entry.indexOf('=');
    return { name: entry.slice(0, separator), value: entry.slice(separator + 1), domain: '127.0.0.1', path: '/', sameSite: 'Lax' as const };
  });
  await context.addCookies(cookies);
  await context.addInitScript((origin: string) => { window.__CLAIM_API_ORIGIN__ = origin; }, apiOrigin);
  return { context, page: await context.newPage() };
}

async function openStudio(page: Page, caseId: string, reportId: string): Promise<void> {
  await page.goto(`${webOrigin}/cases/${encodeURIComponent(caseId)}/reports/${encodeURIComponent(reportId)}/studio`, { waitUntil: 'domcontentloaded' });
  await page.locator('.p09-studio').waitFor({ state: 'visible' });
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'P09 must not horizontally overflow');
}

async function main(): Promise<void> {
  console.log('P09 browser E2E: production UI, autosave, conflict, approval lock, merge, responsive 100-section navigation');
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const db = createPrismaClient(databaseUrl);
  const api: ManagedApiServer = createApiServer({ databaseUrl, allowedOrigins: [webOrigin], secureCookies: false, uploadDir });
  await new Promise<void>((resolve, reject) => api.once('error', reject).listen(3001, '127.0.0.1', resolve));
  const web = productionWebServer();
  await new Promise<void>((resolve, reject) => web.once('error', reject).listen(webPort, '127.0.0.1', resolve));

  let browser: Browser | undefined;
  const contexts: BrowserContext[] = [];
  try {
    await Promise.all([waitFor(`${apiOrigin}/health`), waitFor(webOrigin)]);
    const studioFixture = await createP09Fixture(apiOrigin, db, { sectionCount: 3, requestOrigin: webOrigin });
    const boundaryFixture = await createP09Fixture(apiOrigin, db, { sectionCount: 100, requestOrigin: webOrigin });
    const [, section2, section3] = studioFixture.sectionIds;
    for (const sectionId of [section2, section3]) {
      const saved = await requestJson(apiOrigin, `/api/reports/${studioFixture.reportId}/sections/${sectionId}/revisions`, 'POST',
        revisionPayload(1, `브라우저 병합 준비용 ${sectionId} 검토 문단입니다.`), studioFixture.pm, webOrigin);
      assert.strictEqual(saved.status, 201);
      const approved = await requestJson(apiOrigin, `/api/reports/${studioFixture.reportId}/sections/${sectionId}/approve`, 'POST', {
        revisionId: saved.body.revision.id, expectedVersion: 2
      }, studioFixture.reviewer, webOrigin);
      assert.strictEqual(approved.status, 200);
    }

    browser = await chromium.launch({ executablePath: browserExecutable(), headless: true });
    const pm = await signedInPage(browser, studioFixture.pm, { width: 1440, height: 900 });
    contexts.push(pm.context);
    await openStudio(pm.page, 'CASE-SYN-001', studioFixture.reportId);
    assert.strictEqual(await pm.page.locator('.p09-pane:visible').count(), 3, '1440px must show all three panes');
    await noHorizontalOverflow(pm.page);

    const editor = pm.page.locator('#p09-report-content');
    await editor.fill('최종 회의에서 확인한 검토 문단입니다.');
    await pm.page.getByLabel('근거 자료').selectOption('MEET-SYN-002');
    await pm.page.getByLabel('원문 인용').fill('Synthetic final raw transcript text');
    await pm.page.getByLabel('원문 위치').fill('transcript:paragraph-1');
    await pm.page.getByRole('button', { name: '이 개정본에 근거 추가' }).click();
    const firstSaveResponse = pm.page.waitForResponse((response) => response.url().includes('/revisions') && response.request().method() === 'POST');
    await pm.page.getByRole('button', { name: '지금 저장' }).click();
    assert.strictEqual((await firstSaveResponse).status(), 201);
    await pm.page.getByText(/수동저장으로 새 개정본/).waitFor({ state: 'visible' });
    await pm.page.getByText(/최신 개정: VALID/).waitFor({ state: 'visible' });

    const staff = await signedInPage(browser, studioFixture.staff, { width: 1024, height: 768 });
    contexts.push(staff.context);
    await openStudio(staff.page, 'CASE-SYN-001', studioFixture.reportId);
    assert.strictEqual(await staff.page.locator('.p09-pane-tabs').isVisible(), true, '1024px pane tabs must be visible');
    assert.strictEqual(await staff.page.locator('.p09-pane:visible').count(), 1, '1024px must show one recoverable pane at a time');

    await editor.fill('PM이 먼저 저장한 서버 최신 문단입니다.');
    const pmSecondSave = pm.page.waitForResponse((response) => response.url().includes('/revisions') && response.request().method() === 'POST');
    await pm.page.getByRole('button', { name: '지금 저장' }).click();
    assert.strictEqual((await pmSecondSave).status(), 201);

    const staffEditor = staff.page.locator('#p09-report-content');
    await staffEditor.fill('STAFF 로컬 초안은 충돌 후에도 사라지면 안 됩니다.');
    await staff.page.locator('section.p09-conflict').waitFor({ state: 'visible', timeout: 10_000 });
    const conflictText = await staff.page.locator('section.p09-conflict').innerText();
    assert.match(conflictText, /PM이 먼저 저장한 서버 최신 문단/);
    assert.match(conflictText, /STAFF 로컬 초안은 충돌 후에도 사라지면 안 됩니다/);
    const conflictRecovery = staff.page.waitForResponse((response) => response.url().includes('/revisions') && response.request().method() === 'POST');
    await staff.page.getByRole('button', { name: '로컬 초안으로 새 개정 생성' }).click();
    assert.strictEqual((await conflictRecovery).status(), 201);

    const reviewer = await signedInPage(browser, studioFixture.reviewer, { width: 1440, height: 900 });
    contexts.push(reviewer.context);
    await openStudio(reviewer.page, 'CASE-SYN-001', studioFixture.reportId);
    assert.strictEqual(await reviewer.page.locator('#p09-report-content').getAttribute('readonly') !== null, true, 'Reviewer editor must be read-only');
    const approvalResponse = reviewer.page.waitForResponse((response) => response.url().endsWith('/approve') && response.request().method() === 'POST');
    await reviewer.page.getByRole('button', { name: '최신 VALID 개정 승인' }).click();
    assert.strictEqual((await approvalResponse).status(), 200);
    await reviewer.page.getByText(/최신 VALID 개정본을 승인하고 잠갔습니다/).waitFor({ state: 'visible' });

    await pm.page.reload({ waitUntil: 'domcontentloaded' });
    await pm.page.locator('.p09-studio').waitFor({ state: 'visible' });
    assert.strictEqual(await pm.page.locator('#p09-report-content').getAttribute('readonly') !== null, true, 'Approved section must be locked for PM');
    const mergeResponse = pm.page.waitForResponse((response) => response.url().endsWith('/merge') && response.request().method() === 'POST');
    await pm.page.getByRole('button', { name: '승인본 병합 스냅샷 생성' }).click();
    assert.strictEqual((await mergeResponse).status(), 201);
    await pm.page.getByText(/DOCX\/PDF 출력은 P12 범위/).waitFor({ state: 'visible' });
    assert.strictEqual(await pm.page.locator('.p09-snapshots li').count(), 1);

    await staff.page.goto(`${webOrigin}/cases/CASE-SYN-001/reports/${boundaryFixture.reportId}/studio`, { waitUntil: 'domcontentloaded' });
    await staff.page.locator('.p09-studio').waitFor({ state: 'visible' });
    await staff.page.getByRole('tab', { name: '목차·근거' }).click();
    assert.strictEqual(await staff.page.locator('.p09-section-list > button').count(), 100, 'all 100 sections must remain navigable');
    await staff.page.locator('.p09-section-list > button').last().click();
    await staff.page.getByText(/제100장/).waitFor({ state: 'visible' });
    await staff.page.getByRole('tab', { name: '본문 편집' }).focus();
    const focused = await staff.page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      return element ? { visible: element.getBoundingClientRect().width > 0, outline: getComputedStyle(element).outlineWidth } : { visible: false, outline: '0px' };
    });
    assert.strictEqual(focused.visible, true);
    assert.notStrictEqual(focused.outline, '0px');
    await staff.page.evaluate(() => { document.documentElement.style.zoom = '200%'; });
    await noHorizontalOverflow(staff.page);

    console.log('P09 browser E2E: 3 panes, real autosave, lossless conflict, reviewer lock, approved-only merge, 1024/100 sections/focus/200% PASSED');
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
