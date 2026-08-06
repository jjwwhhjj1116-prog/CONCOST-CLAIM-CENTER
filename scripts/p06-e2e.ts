import assert from 'node:assert';
import * as fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import * as path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { createPrismaClient, databaseUrlFor, resetDatabase, seedDatabase } from '../packages/database/src';

const root = path.join(__dirname, '..');
const webPort = 43176;
const webOrigin = `http://127.0.0.1:${webPort}`;
const apiOrigin = 'http://127.0.0.1:3001';
const databasePath = path.join(root, 'packages/database/.data', `p06-e2e-${process.pid}.db`);
const uploadDir = path.join(root, 'packages/database/.data', `p06-e2e-uploads-${process.pid}`);
const fixtureDir = path.join(root, 'packages/database/.data', `p06-e2e-fixtures-${process.pid}`);
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
  if (!executable) throw new Error('Chrome/Edge executable not found. Set CHROME_PATH for P06 browser E2E.');
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
  if (!fs.existsSync(path.join(distRoot, 'index.html'))) throw new Error('P06 E2E requires the current production build. Run pnpm build first.');
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

async function main(): Promise<void> {
  console.log('P06 E2E: rebuilding isolated DB, upload store and browser fixtures');
  fs.rmSync(uploadDir, { recursive: true, force: true });
  fs.rmSync(fixtureDir, { recursive: true, force: true });
  fs.mkdirSync(fixtureDir, { recursive: true });
  const v1Path = path.join(fixtureDir, 'p06-browser-v1.pdf');
  const v2Path = path.join(fixtureDir, 'p06-browser-v2.pdf');
  const transcriptPath = path.join(fixtureDir, 'p06-browser-transcript.txt');
  fs.writeFileSync(v1Path, '%PDF-1.4\nP06_BROWSER_VERSION_ONE\n%%EOF');
  fs.writeFileSync(v2Path, '%PDF-1.4\nP06_BROWSER_VERSION_TWO\n%%EOF');
  fs.writeFileSync(transcriptPath, 'P06_BROWSER_ORIGINAL_TRANSCRIPT');
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const fixtureDb = createPrismaClient(databaseUrl);
  await fixtureDb.schedule.create({ data: {
    id: 'P06-E2E-SCHED-CASE1', caseId: 'CASE-SYN-001', title: 'P06 browser same-case schedule', type: 'INTERNAL',
    date: new Date('2026-08-08T00:00:00.000Z'), location: 'SYNTHETIC_BROWSER_ROOM', description: 'P06 browser fixture'
  } });
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

    await page.goto(`${webOrigin}/cases/files?caseId=CASE-SYN-001`);
    await page.getByLabel('문서 제목').fill('P06_BROWSER_DOCUMENT');
    await page.getByLabel('첨부 파일 선택').setInputFiles(v1Path);
    await page.getByLabel('연결 기일 ID (선택)').fill('P06-E2E-SCHED-CASE1');
    await page.getByLabel('연결 보고서 장 ID (선택)').fill('SEC-SYN-001');
    await page.getByRole('button', { name: '문서 업로드' }).click();
    const documentItem = page.locator('li.doc-item').filter({ hasText: 'P06_BROWSER_DOCUMENT' });
    await documentItem.waitFor({ state: 'visible' });
    await documentItem.getByText(/연결 기일: P06-E2E-SCHED-CASE1/).waitFor({ state: 'visible' });
    await documentItem.getByLabel('새 버전 파일 - P06_BROWSER_DOCUMENT').setInputFiles(v2Path);
    await documentItem.getByRole('button', { name: '새 버전 업로드' }).click();
    const versionTwo = documentItem.locator('li').filter({ hasText: '(v02)' });
    await versionTwo.waitFor({ state: 'visible' });
    await versionTwo.getByText(/SHA-256/).waitFor({ state: 'visible' });
    await versionTwo.getByRole('button', { name: '최종본 지정' }).click();
    await versionTwo.getByText('[최종본]', { exact: true }).waitFor({ state: 'visible' });
    const downloadPromise = page.waitForEvent('download');
    await versionTwo.getByRole('button', { name: '다운로드' }).click();
    const download = await downloadPromise;
    const savedPath = await download.path();
    assert.ok(savedPath);
    assert.strictEqual(fs.readFileSync(savedPath!, 'utf8'), fs.readFileSync(v2Path, 'utf8'));
    assert.match(download.suggestedFilename(), /_v02\.pdf$/);

    await page.goto(`${webOrigin}/meetings?caseId=CASE-SYN-001`);
    await page.getByLabel('회의 제목').fill('P06_BROWSER_MEETING');
    await page.getByLabel('회의 일시').fill('2026-08-06T10:00');
    await page.getByLabel('장소').fill('SYNTHETIC_BROWSER_ROOM');
    await page.getByLabel('참석자').fill('SYNTHETIC_BROWSER_ATTENDEES');
    await page.getByLabel('회의 원문 TXT 업로드').setInputFiles(transcriptPath);
    await page.getByLabel('핵심 요약', { exact: true }).fill('P06_BROWSER_INITIAL_SUMMARY');
    await page.getByLabel('의결 사항', { exact: true }).fill('P06_BROWSER_INITIAL_DECISION');
    await page.getByRole('button', { name: '회의록 등록' }).click();
    const meetingItem = page.locator('li.meeting-item').filter({ hasText: 'P06_BROWSER_MEETING' });
    await meetingItem.waitFor({ state: 'visible' });
    await meetingItem.getByText(/DRAFT/).waitFor({ state: 'visible' });
    await meetingItem.getByLabel('할 일 제목 - P06_BROWSER_MEETING').fill('P06_BROWSER_ACTION');
    await meetingItem.getByLabel('담당자 ID - P06_BROWSER_MEETING').fill('USR-STAFF');
    await meetingItem.getByLabel('연결 기일 ID - P06_BROWSER_MEETING').fill('P06-E2E-SCHED-CASE1');
    await meetingItem.getByLabel('할 일 기한 - P06_BROWSER_MEETING').fill('2026-08-08');
    await meetingItem.getByRole('button', { name: '할 일 추가' }).click();
    await meetingItem.getByText(/P06_BROWSER_ACTION/).waitFor({ state: 'visible' });
    await meetingItem.getByLabel('핵심 요약 - P06_BROWSER_MEETING').fill('P06_BROWSER_REVISED_SUMMARY');
    await meetingItem.getByRole('button', { name: '요약·결정사항 저장' }).click();
    await meetingItem.getByRole('button', { name: '회의록 확정 (FINAL)' }).click();
    await meetingItem.getByText(/FINAL/).waitFor({ state: 'visible' });
    await meetingItem.getByText(/확정본은 원문·요약·결정사항·할 일을 변경할 수 없습니다/).waitFor({ state: 'visible' });

    await logout(page);
    await login(page, 'staff@example.invalid');
    await page.goto(`${webOrigin}/cases/files?caseId=CASE-SYN-001`);
    await page.getByLabel('문서 제목').fill('P06_STAFF_FORBIDDEN');
    await page.getByLabel('첨부 파일 선택').setInputFiles(v1Path);
    await page.getByRole('button', { name: '문서 업로드' }).click();
    await page.getByRole('alert').getByText(/forbidden/i).waitFor({ state: 'visible' });

    console.log('P06 browser E2E: browser-native upload, v02, final, authenticated download, links, transcript, action item, FINAL freeze and Staff RBAC PASSED');
  } finally {
    await browser?.close();
    await new Promise<void>((resolve) => web.close(() => resolve()));
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await api.waitForDatabaseClose();
    fs.rmSync(uploadDir, { recursive: true, force: true });
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
