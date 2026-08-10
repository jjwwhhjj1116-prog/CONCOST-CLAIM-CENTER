import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import * as path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createPrismaClient, databaseUrlFor, resetDatabase, seedDatabase } from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { createP09Fixture } from './p09-test-support';
import { validateReportDocxBuffer } from '../packages/document-engine/src/docx-engine';
import { validateReportPdfBuffer } from '../packages/document-engine/src/pdf-engine';

const root = path.resolve(__dirname, '..');
const webPort = 43184;
const apiPort = 3004;
const webOrigin = `http://127.0.0.1:${webPort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const databasePath = path.join(root, 'packages/database/.data', `p12-e2e-${process.pid}.db`);
const uploadDir = path.join(root, 'packages/database/.data', `p12-e2e-uploads-${process.pid}`);
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
  if (!found) throw new Error('Chrome/Edge executable not found for P12 browser E2E.');
  return found;
}

function productionWebServer(): Server {
  const distRoot = path.join(root, 'apps/web/dist');
  if (!fs.existsSync(path.join(distRoot, 'index.html'))) {
    throw new Error('P12 browser E2E requires current production build in apps/web/dist');
  }
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
  await context.addInitScript((origin: string) => { (window as any).__CLAIM_API_ORIGIN__ = origin; }, apiOrigin);
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
  console.log('--- Starting P12 Chromium Real E2E Test ---');
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);

  const db = createPrismaClient(databaseUrl);
  const api: ManagedApiServer = createApiServer({ databaseUrl, allowedOrigins: [webOrigin], secureCookies: false, uploadDir, allowTestAiModes: true });
  await new Promise<void>((resolve, reject) => api.once('error', reject).listen(apiPort, '127.0.0.1', resolve));

  const web = productionWebServer();
  await new Promise<void>((resolve, reject) => web.once('error', reject).listen(webPort, '127.0.0.1', resolve));

  let browser: Browser | undefined;

  try {
    await waitFor(`${apiOrigin}/health`);
    await waitFor(`${webOrigin}/`);

    const fixture = await createP09Fixture(apiOrigin, db, { sectionCount: 3, requestOrigin: webOrigin });

    browser = await chromium.launch({ executablePath: browserExecutable(), headless: true });
    const { page } = await newPage(browser);

    // 1. Staff Login & Review Request
    console.log('1. Staff login & Review Request submission...');
    await login(page, 'staff@example.invalid');
    await page.goto(`${webOrigin}/cases/CASE-SYN-001/reports/${encodeURIComponent(fixture.reportId)}/studio`, { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: '검토 요청' }).click();
    await page.waitForSelector('#p12-review-title');
    await page.getByRole('button', { name: '검토 요청 전송' }).click();
    await page.waitForSelector('text=검토 요청이 등록되었습니다.');

    // Ensure all sections have an initial valid revision
    for (const secId of fixture.sectionIds) {
      const sec = await db.reportSection.findUniqueOrThrow({ where: { id: secId } });
      await db.reportSectionRevision.create({
        data: {
          id: `REV-E2E-${secId}`,
          sectionId: secId,
          revisionNumber: 1,
          authorId: 'USR-STAFF-001',
          title: sec.title,
          content: `제 ${sec.sectionNumber} 장 검토 본문 내용입니다.`,
          validationStatus: 'VALID',
          inputSha256: 'sha256-e2e-rev',
          sha256: 'sha256-e2e-rev'
        }
      });
    }

    // 2. Reviewer Login & Approve Sections
    console.log('2. Reviewer login & Approve all required sections...');
    const { page: reviewerPage } = await newPage(browser);
    await login(reviewerPage, 'reviewer@example.invalid');
    await reviewerPage.goto(`${webOrigin}/cases/CASE-SYN-001/reports/${encodeURIComponent(fixture.reportId)}/studio`, { waitUntil: 'domcontentloaded' });

    // Approve section 1
    await reviewerPage.getByRole('button', { name: '최신 VALID 개정 승인' }).click();
    await reviewerPage.waitForSelector('text=최신 VALID 개정본을 승인하고 잠갔습니다.');

    // Select and approve section 2
    await reviewerPage.getByRole('button', { name: /2\./ }).click();
    await reviewerPage.getByRole('button', { name: '최신 VALID 개정 승인' }).click();
    await reviewerPage.waitForSelector('text=최신 VALID 개정본을 승인하고 잠갔습니다.');

    // Select and approve section 3
    await reviewerPage.getByRole('button', { name: /3\./ }).click();
    await reviewerPage.getByRole('button', { name: '최신 VALID 개정 승인' }).click();
    await reviewerPage.waitForSelector('text=최신 VALID 개정본을 승인하고 잠갔습니다.');

    // 3. Finalization Modal & Snapshot Fixation
    console.log('3. Report Finalization fixation...');
    await reviewerPage.waitForSelector('button:has-text("최종 확정 진행")');
    await reviewerPage.getByRole('button', { name: '최종 확정 진행' }).click();
    await reviewerPage.waitForSelector('#p12-fin-title');
    await reviewerPage.getByRole('button', { name: '최종 확정 실행' }).click();
    await reviewerPage.waitForSelector('text=최종 확정 완료');

    // 4. Output Generation & Download Verification with Independent Parsers
    console.log('4. Generate DOCX/PDF outputs & Verify downloaded bytes...');
    await reviewerPage.getByRole('button', { name: 'DOCX 출력 생성' }).click();
    await reviewerPage.waitForSelector('text=DOCX 문서 출력이 완료되었습니다');

    await reviewerPage.getByRole('button', { name: 'PDF 출력 생성' }).click();
    await reviewerPage.waitForSelector('text=PDF 문서 출력이 완료되었습니다');

    // Trigger DOCX Download via link
    const [docxDownload] = await Promise.all([
      reviewerPage.waitForEvent('download'),
      reviewerPage.getByRole('link', { name: /다운로드/ }).first().click()
    ]);
    const docxStream = await docxDownload.createReadStream();
    const docxChunks: Buffer[] = [];
    for await (const chunk of docxStream) {
      if (chunk) docxChunks.push(Buffer.from(chunk));
    }
    const docxBuffer = Buffer.concat(docxChunks);

    const docxVal = validateReportDocxBuffer(docxBuffer);
    assert.ok(docxVal.isValid, `E2E Downloaded DOCX validation failed: ${docxVal.error ?? 'unknown'}`);
    console.log(`✓ E2E DOCX verified cleanly (${docxBuffer.length} bytes, entries: ${docxVal.entryCount})`);

    // Trigger PDF Download via link
    const [pdfDownload] = await Promise.all([
      reviewerPage.waitForEvent('download'),
      reviewerPage.getByRole('link', { name: /다운로드/ }).last().click()
    ]);
    const pdfStream = await pdfDownload.createReadStream();
    const pdfChunks: Buffer[] = [];
    for await (const chunk of pdfStream) {
      if (chunk) pdfChunks.push(Buffer.from(chunk));
    }
    const pdfBuffer = Buffer.concat(pdfChunks);

    const pdfVal = validateReportPdfBuffer(pdfBuffer);
    assert.ok(pdfVal.isValid, `E2E Downloaded PDF validation failed: ${pdfVal.error ?? 'unknown'}`);
    console.log(`✓ E2E PDF verified cleanly (${pdfBuffer.length} bytes, pages: ${pdfVal.pageCount})`);

    console.log('✅ P12 Chromium Real E2E Test Passed Cleanly!');
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
  console.error('❌ P12 Chromium E2E Test Failed:', err);
  process.exit(1);
});
