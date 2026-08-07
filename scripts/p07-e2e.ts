import assert from 'node:assert';
import * as fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import * as path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { validateDocxBuffer, validatePdfBuffer } from '@claim-studio/document-engine';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { createPrismaClient, databaseUrlFor, resetDatabase, seedDatabase } from '../packages/database/src';

const root = path.join(__dirname, '..');
const webPort = 43177;
const webOrigin = `http://127.0.0.1:${webPort}`;
const apiOrigin = 'http://127.0.0.1:3001';
const databasePath = path.join(root, 'packages/database/.data', `p07-e2e-${process.pid}.db`);
const uploadDir = path.join(root, 'packages/database/.data', `p07-e2e-uploads-${process.pid}`);
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
  if (!executable) throw new Error('Chrome/Edge executable not found. Set CHROME_PATH for P07 browser E2E.');
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
  if (!fs.existsSync(path.join(distRoot, 'index.html'))) throw new Error('P07 E2E requires the current production build. Run pnpm build first.');
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

async function selectBrowserCase(page: Page): Promise<void> {
  await page.getByLabel('사건 선택').selectOption('P07-E2E-CASE');
}

async function main(): Promise<void> {
  console.log('P07 E2E: rebuilding isolated DB and approved output store');
  fs.rmSync(uploadDir, { recursive: true, force: true });
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const fixtureDb = createPrismaClient(databaseUrl);
  const now = new Date();
  await fixtureDb.caseItem.create({ data: {
    id: 'P07-E2E-CASE', organizationId: 'ORG-SYN-A', caseNumber: 'P07-BROWSER-0001', title: 'P07_BROWSER_CASE',
    description: 'Synthetic browser-only P07 case', claimType: 'TYPE-01', status: 'INQUIRY', assignedUserId: 'USR-PM', version: 1,
    createdAt: now, updatedAt: now
  } });
  await fixtureDb.caseCategory.create({ data: { id: 'P07-E2E-CATEGORY', caseId: 'P07-E2E-CASE', major: 'Synthetic', middle: 'P07', minor: 'Browser' } });
  await fixtureDb.party.create({ data: { id: 'P07-E2E-PARTY', caseId: 'P07-E2E-CASE', name: 'P07_BROWSER_CLIENT', role: 'CLIENT' } });
  for (const userId of ['USR-PM', 'USR-DIRECTOR', 'USR-STAFF']) {
    await fixtureDb.caseAssignment.create({ data: { caseId: 'P07-E2E-CASE', userId } });
  }
  await fixtureDb.$disconnect();

  const api: ManagedApiServer = createApiServer({ databaseUrl, allowedOrigins: [webOrigin], secureCookies: false, uploadDir });
  await new Promise<void>((resolve, reject) => api.once('error', reject).listen(3001, '127.0.0.1', resolve));
  const web = createProductionWebServer();
  await new Promise<void>((resolve, reject) => web.once('error', reject).listen(webPort, '127.0.0.1', resolve));

  let browser: Browser | undefined;
  try {
    await Promise.all([waitForUrl(`${apiOrigin}/health`), waitForUrl(webOrigin)]);
    browser = await chromium.launch({ executablePath: findBrowserExecutable(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await login(page, 'pm@example.invalid');
    await page.goto(`${webOrigin}/proposals/templates`);
    await selectBrowserCase(page);
    await page.getByRole('button', { name: '선택한 템플릿으로 제안서 생성' }).click();
    await page.waitForURL(`${webOrigin}/proposals/editor`);
    await page.locator('.proposal-status-header').waitFor({ state: 'visible' });

    await page.getByLabel('1-1. 의뢰 배경 (BACKGROUND)').fill('P07_BROWSER_BACKGROUND');
    await page.getByLabel('1-2. 수행 목적 (OBJECTIVE)').fill('P07_BROWSER_OBJECTIVE');
    await page.getByRole('button', { name: /다음 단계 \(수행 방법\)/ }).click();
    await page.getByLabel('2. 수행 방법 및 산출 범위 (METHOD)').fill('P07_BROWSER_METHOD');
    await page.getByRole('button', { name: /다음 단계 \(성과물\)/ }).click();
    await page.getByLabel('3-1. 예상 성과물 (EXPECTED_OUTCOME)').fill('P07_BROWSER_OUTCOME');
    await page.getByLabel('3-2. 제외 사항 (EXCLUSIONS)').fill('없음');
    await page.getByRole('button', { name: /다음 단계 \(미리보기 & 승인\)/ }).click();
    await page.getByRole('button', { name: '수동 버전 저장' }).click();
    await page.getByText(/수동.*성공적으로 저장/).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: /검토 요청/ }).click();
    await page.getByText(/IN_REVIEW/).first().waitFor({ state: 'visible' });

    await logout(page);
    await login(page, 'director@example.invalid');
    await page.goto(`${webOrigin}/proposals/editor`);
    await selectBrowserCase(page);
    await page.getByRole('button', { name: /Step 4/ }).click();
    await page.getByLabel('검토/반려 사유').fill('P07_BROWSER_DIRECTOR_APPROVAL');
    await page.getByRole('button', { name: /제안서 승인/ }).click();
    await page.getByText(/APPROVED/).first().waitFor({ state: 'visible' });

    const docxDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /DOCX 출력 다운로드/ }).click();
    const docxDownload = await docxDownloadPromise;
    const docxPath = await docxDownload.path();
    assert.ok(docxPath);
    assert.strictEqual(validateDocxBuffer(fs.readFileSync(docxPath!)).isValid, true);
    assert.match(docxDownload.suggestedFilename(), /_v02\.docx$/);

    const pdfDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /PDF 출력 다운로드/ }).click();
    const pdfDownload = await pdfDownloadPromise;
    const pdfPath = await pdfDownload.path();
    assert.ok(pdfPath);
    assert.strictEqual(validatePdfBuffer(fs.readFileSync(pdfPath!)).isValid, true);
    assert.match(pdfDownload.suggestedFilename(), /_v02\.pdf$/);
    await page.getByRole('list', { name: '제안서 버전 이력' }).getByText(/승인본/).waitFor({ state: 'visible' });
    await page.getByRole('list', { name: '제안서 검토 이력' }).getByText(/APPROVE/).waitFor({ state: 'visible' });

    await logout(page);
    await login(page, 'staff@example.invalid');
    await page.goto(`${webOrigin}/proposals/editor`);
    await selectBrowserCase(page);
    await page.getByRole('button', { name: /Step 4/ }).click();
    await assert.rejects(page.getByRole('button', { name: '수동 버전 저장' }).click({ timeout: 1_000 }));
    assert.strictEqual(await page.getByRole('button', { name: '수동 버전 저장' }).isDisabled(), true);
    assert.strictEqual(await page.getByRole('button', { name: /제안서 승인/ }).isDisabled(), true);

    await page.setViewportSize({ width: 1024, height: 768 });
    assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await page.getByLabel('사건 선택').focus();
    await page.keyboard.press('Tab');
    const keyboardFocus = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) return { visible: false, outlineWidth: '0px' };
      const rect = active.getBoundingClientRect();
      return { visible: rect.width > 0 && rect.height > 0, outlineWidth: getComputedStyle(active).outlineWidth };
    });
    assert.strictEqual(keyboardFocus.visible, true);
    assert.notStrictEqual(keyboardFocus.outlineWidth, '0px');

    await page.evaluate(() => { document.documentElement.style.zoom = '200%'; });
    const stepButton = page.getByRole('button', { name: /Step 4/ });
    await stepButton.scrollIntoViewIfNeeded();
    assert.strictEqual(await stepButton.isVisible(), true);
    await stepButton.focus();
    assert.strictEqual(await page.evaluate(() => document.activeElement?.textContent?.includes('Step 4') ?? false), true);

    console.log('P07 browser E2E: template, five inputs, manual version, role-switched approval, DOCX/PDF, history, Staff RBAC, 1024px, keyboard focus and 200% zoom PASSED');
  } finally {
    await browser?.close();
    await new Promise<void>((resolve) => web.close(() => resolve()));
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await api.waitForDatabaseClose();
    fs.rmSync(uploadDir, { recursive: true, force: true });
    for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
