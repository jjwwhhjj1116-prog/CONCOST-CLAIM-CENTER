import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { chromium, type Browser, type Download, type Page } from 'playwright-core';

const root = path.resolve(__dirname, '..');
const distRoot = path.join(root, 'apps', 'web', 'dist');

function browserExecutable(): string {
  const candidates = [
    process.env.CHROME_PATH ?? '',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) throw new Error('Chrome/Edge executable not found. Set CHROME_PATH for CF69 browser E2E.');
  return found;
}

function staticServer(origin: string): Server {
  const types: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
  };
  return createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', origin).pathname);
    const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const candidate = path.resolve(distRoot, requested);
    const safe = candidate.startsWith(`${path.resolve(distRoot)}${path.sep}`);
    const filePath = safe && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
      ? candidate
      : path.join(distRoot, 'index.html');
    response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': types[path.extname(filePath)] ?? 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(response);
  });
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return (server.address() as { port: number }).port;
}

const chapterTitles = [
  '제안(용역)의 목적', '당 현장의 핵심 쟁점 분석', '업무 수행 내용 및 추진 계획', '전문가 현황',
  '당사의 강점', '조직도 및 업무 영역', '도시정비사업 공사비검증 실적', '한국부동산원 공사비검증 실적',
  '건설 클레임·소송·기술감정 실적', '자격 증명자료', '용역 조건 및 제안 범위', '맺음말',
];

const chapterBodies = chapterTitles.map((title, index) => {
  if (index === 6) return `### ${title}\n\n| 구분 | 프로젝트 | 연도 |\n|---|---|---|\n| 공사비검증 | 검증 완료 사업 | 2026 |`;
  return `### ${title}\n\n- 담당자 검수에서 확정한 ${index + 1}장 본문입니다.\n- 사실·수치·이미지 순서를 보존해 출력합니다.`;
});

const structuredInputs = {
  clientName: '테스트 발주처',
  projectTitle: 'CF69 확정 문서 브라우저 검수',
  subtitle: '건설 클레임 전문용역 제안',
  submissionDate: '2026-08-28',
  keyIssues: chapterBodies[1],
  objective: chapterBodies[0],
  planNotes: chapterBodies[2],
  exclusions: '해당 없음',
  chapters: chapterTitles.map((title, index) => ({
    number: index + 1,
    title,
    kind: index < 3 ? 'VARIABLE' : 'FIXED',
    moduleCode: index < 3 ? undefined : `CH${String(index + 1).padStart(2, '0')}_MODULE`,
    body: chapterBodies[index],
    editorJson: null,
    excludedCompanyAssetKeys: [],
  })),
  includedModuleCodes: chapterTitles.slice(3).map((_, index) => `CH${String(index + 4).padStart(2, '0')}_MODULE`),
  templateSourceId: 'source-1',
  templateSourceName: 'CF69 검수 대표 템플릿',
};

const proposalVersion = {
  id: 'version-1', versionNumber: 8, bodyText: '', structuredInputsJson: JSON.stringify(structuredInputs),
  generationMode: 'MANUAL', providerId: null, modelId: null, inputSha256: 'a'.repeat(64),
  sourceDocumentVersionIdsJson: '[]', sha256: 'b'.repeat(64), isApproved: true,
  createdAt: '2026-08-28T00:00:00.000Z', createdBy: { id: 'user-1', name: '검수 담당자' },
};

const proposal = {
  id: 'proposal-1', caseId: 'case-1', templateId: 'template-1', title: 'CF69 확정 제안서',
  status: 'APPROVED', currentVersionId: 'version-1', approvedVersionId: 'version-1', version: 8,
  versions: [proposalVersion], reviews: [], exports: [],
};

const receptionBase = {
  caseStatus: 'CONTRACT', caseVersion: 4, proposalTitle: '확정 기술용역 제안서', proposalVersion: 8,
  versionNumber: 8, clientName: '테스트 발주처', documentSha256: 'c'.repeat(64),
  confirmedAt: '2026-08-28T01:00:00.000Z', revisionLabel: '확정 v8',
};
const receptions = [
  ...Array.from({ length: 6 }, (_, index) => ({
    ...receptionBase, proposalId: `ready-${index + 1}`, caseId: `ready-case-${index + 1}`,
    caseNumber: `CC-READY-${String(index + 1).padStart(3, '0')}`, caseTitle: `접수대기-${index + 1} 프로젝트`,
    proposalNumber: `PROP-READY-${index + 1}`, receptionStatus: 'READY', awardDecidedAt: null, awardDecidedByName: null,
  })),
  ...Array.from({ length: 6 }, (_, index) => ({
    ...receptionBase, proposalId: `won-${index + 1}`, caseId: `won-case-${index + 1}`,
    caseNumber: `CC-WON-${String(index + 1).padStart(3, '0')}`, caseTitle: `수주완료-${index + 1} 프로젝트`,
    proposalNumber: `PROP-WON-${index + 1}`, receptionStatus: 'WON',
    awardDecidedAt: '2026-08-28T02:00:00.000Z', awardDecidedByName: '수주 담당자',
  })),
];

async function verifyDownload(download: Download, extension: 'docx' | 'pdf' | 'hwp', expectedSignature: number[]): Promise<{ bytes: Buffer; fileName: string }> {
  const failure = await download.failure();
  assert.equal(failure, null, `${extension.toUpperCase()} browser download failed: ${failure}`);
  const fileName = download.suggestedFilename();
  assert.ok(fileName.endsWith(`.${extension}`), `${extension.toUpperCase()} file extension mismatch: ${fileName}`);
  const filePath = await download.path();
  assert.ok(filePath, `${extension.toUpperCase()} browser download path missing`);
  const bytes = fs.readFileSync(filePath);
  assert.ok(bytes.byteLength > 512, `${extension.toUpperCase()} browser download is unexpectedly small`);
  expectedSignature.forEach((value, index) => assert.equal(bytes[index], value, `${extension.toUpperCase()} signature byte ${index} mismatch`));
  return { bytes, fileName };
}

async function clickFinalDownload(page: Page, label: string, timeout = 240_000): Promise<Download> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout }),
    page.getByRole('button', { name: label, exact: true }).click(),
  ]);
  await page.getByText(/내려받기 완료 · 화면 미리보기와 동일한 A4 출력본입니다/u).waitFor({ state: 'visible', timeout });
  return download;
}

async function main(): Promise<void> {
  if (!fs.existsSync(path.join(distRoot, 'index.html'))) throw new Error('Run cf:build before CF69 browser E2E.');
  const server = staticServer('http://127.0.0.1');
  const port = await listen(server);
  const origin = `http://127.0.0.1:${port}`;
  let browser: Browser | undefined;
  const consoleErrors: string[] = [];
  try {
    browser = await chromium.launch({ executablePath: browserExecutable(), headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('requestfailed', (request) => consoleErrors.push(`REQUEST FAILED ${request.method()} ${request.url()} · ${request.failure()?.errorText ?? 'unknown'}`));
    page.on('response', (response) => { if (response.status() >= 400) consoleErrors.push(`HTTP ${response.status()} ${response.url()}`); });

    await page.route('**/auth/session', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      id: 'user-1', email: 'qa@con-cost.com', name: 'CF69 검수자', organizationId: 'concost', roles: ['admin'], previewMode: true,
    }) }));
    await page.route('**/api/settings/tutorial', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      tutorial: { completedTutorialVersion: 'CF62_V1', completedAt: '2026-08-28T00:00:00.000Z', completionAction: 'COMPLETED', version: 1, updatedAt: '2026-08-28T00:00:00.000Z' }, currentTutorialVersion: 'CF62_V1',
    }) }));
    await page.route('**/api/cases', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cases: [
      { id: 'case-1', caseNumber: 'CC-2026-00999', title: 'CF69 브라우저 검수 프로젝트', description: '확정 문서 출력 검수', claimType: 'TYPE-03', status: 'CONTRACT' },
    ] }) }));
    await page.route('**/api/proposal-studio/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      modules: chapterTitles.slice(3).map((title, index) => ({ code: `CH${String(index + 4).padStart(2, '0')}_MODULE`, chapterNumber: index + 4, title, category: 'COMPANY', bodyMarkdown: chapterBodies[index + 3], isActive: true, version: 2, updatedAt: '2026-08-28T00:00:00.000Z' })),
      sources: [{ id: 'source-1', sourceName: 'CF69 검수 대표 템플릿', sourceFormat: 'HWP', sourceDate: '2026-08-28', isDefault: true, analysisStatus: 'READY', chapterMapJson: '{}', version: 1 }],
      assets: [],
      templateTypes: [{ id: 'REDEVELOPMENT_FINANCE', label: '정비사업 금융·HUG 대응', description: 'CF69 검수 유형', representativeSourceId: 'source-1', representativeSourceName: 'CF69 검수 대표 템플릿', sourceCount: 1, promptReady: true }],
    }) }));
    await page.route('**/api/proposal-templates*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates: [
      { id: 'template-1', name: 'CF69 검수 템플릿', claimType: 'TYPE-03', description: '검수', bodyTemplate: '', placeholdersJson: '{}' },
    ] }) }));
    await page.route('**/api/cases/case-1/proposals', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ proposals: [proposal] }) }));
    await page.route('**/api/cases/case-1/proposals/proposal-1', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ proposal }) }));
    await page.route('**/api/proposal-workflow/receptions*', (route) => {
      if (route.request().method() === 'POST') {
        const payload = route.request().postDataJSON() as { proposalId: string; decision: 'WON' | 'LOST' };
        const selected = receptions.find((item) => item.proposalId === payload.proposalId);
        assert.ok(selected, 'reception POST must target a listed proposal');
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          reception: { ...selected, receptionStatus: payload.decision, awardDecidedAt: '2026-08-28T03:00:00.000Z', awardDecidedByName: 'CF69 검수자' },
          erpSync: { status: 'PENDING' },
        }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ receptions }) });
    });

    await page.goto(`${origin}/proposals/editor?caseId=case-1`, { waitUntil: 'domcontentloaded' });
    await page.getByText('CF69 확정 제안서 · 4단계 제안서 스튜디오').waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByRole('button', { name: /04 전체 미리보기·확정/u }).click();
    await page.getByRole('article', { name: '확정 전 제안서 전체 합본 미리보기' }).waitFor({ state: 'visible' });
    const preview = page.getByRole('article', { name: '확정 전 제안서 전체 합본 미리보기' });
    assert.equal(await preview.locator('[data-export-page]').count(), 14, 'preview must contain cover, TOC and 12 reviewed chapters');
    assert.equal(await preview.locator('[data-chapter-number]').count(), 12, 'preview must contain all 12 reviewed chapters');
    const previewText = await preview.innerText();
    assert.ok(!/<\/?(?:table|tr|td|img|p|div|colgroup)\b/iu.test(previewText), 'raw HTML tags leaked into final preview');
    assert.equal((previewText.match(/CF69 확정 문서 브라우저 검수/gu) ?? []).length, 1, 'cover title must not be duplicated');
    console.log('  1/4 reviewed cover, TOC and 12 chapters render without raw HTML or duplicate title PASS');

    const docx = await verifyDownload(await clickFinalDownload(page, '확정 제안서 Word DOCX 내려받기'), 'docx', [0x50, 0x4b, 0x03, 0x04]);
    assert.ok(docx.bytes.includes(Buffer.from('word/media/page-14.jpg')), 'DOCX must contain all 14 rendered A4 pages');
    console.log(`  2/4 browser downloaded valid DOCX (${docx.fileName}, ${docx.bytes.byteLength} bytes, 14 pages) PASS`);

    const unexpectedDialogs = await page.locator('.modal-backdrop').allInnerTexts();
    if (unexpectedDialogs.length) console.error('CF69 unexpected browser diagnostics', consoleErrors);
    assert.deepEqual(unexpectedDialogs, [], `unexpected dialog appeared after DOCX download: ${unexpectedDialogs.join(' | ')}`);

    const pdf = await verifyDownload(await clickFinalDownload(page, '확정 제안서 PDF 내려받기'), 'pdf', [0x25, 0x50, 0x44, 0x46, 0x2d]);
    console.log(`  3/4 browser downloaded valid PDF (${pdf.fileName}, ${pdf.bytes.byteLength} bytes) PASS`);

    const hwpPromise = clickFinalDownload(page, '확정 제안서 HWP 내려받기', 300_000);
    await page.waitForTimeout(300);
    assert.equal(await page.getByText('프로젝트 제안서 · 한글 문서 편집').count(), 0, 'final HWP download must not open the rhwp editor dialog');
    const hwp = await verifyDownload(await hwpPromise, 'hwp', [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    console.log(`  4/4 browser downloaded valid OLE HWP without opening editor (${hwp.fileName}, ${hwp.bytes.byteLength} bytes) PASS`);

    await page.goto(`${origin}/workflow/award`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '접수 예정 프로젝트' }).waitFor({ state: 'visible', timeout: 15_000 });
    assert.equal(await page.locator('.reception-status-list.is-ready .reception-status-list__body > button').count(), 6);
    assert.equal(await page.locator('.reception-status-list.is-won .reception-status-list__body > button').count(), 6);
    for (const selector of ['.reception-status-list.is-ready .reception-status-list__body', '.reception-status-list.is-won .reception-status-list__body']) {
      const scroll = await page.locator(selector).evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, overflowY: getComputedStyle(element).overflowY }));
      assert.ok(scroll.scrollHeight > scroll.clientHeight && scroll.overflowY === 'auto', `${selector} must remain scrollable for long project lists`);
    }
    const selectedReady = page.locator('.reception-status-list.is-ready button.is-active').first();
    const normalReady = page.locator('.reception-status-list.is-ready .reception-status-list__body > button').nth(1);
    const selectedStyle = await selectedReady.evaluate((element) => ({ backgroundImage: getComputedStyle(element).backgroundImage, boxShadow: getComputedStyle(element).boxShadow }));
    const normalStyle = await normalReady.evaluate((element) => ({ backgroundImage: getComputedStyle(element).backgroundImage, boxShadow: getComputedStyle(element).boxShadow }));
    assert.notDeepEqual(selectedStyle, normalStyle, 'selected reception must use a distinct accent instead of a white inversion');

    const search = page.getByRole('searchbox', { name: '접수 프로젝트 빠른 검색' });
    await search.fill('수주완료-4');
    assert.equal(await page.locator('.reception-status-list.is-ready .reception-status-list__body > button').count(), 0);
    assert.equal(await page.locator('.reception-status-list.is-won .reception-status-list__body > button').count(), 1);
    assert.equal(await page.locator('.reception-summary').count(), 0, 'hidden previous selection must clear its detail/action panel');
    await page.getByRole('button', { name: /CC-WON-004 · 수주완료-4 프로젝트/u }).click();
    assert.equal(await page.locator('.reception-status-list.is-won button.is-active').count(), 1);

    await search.fill('');
    await page.getByRole('button', { name: /CC-READY-002 · 접수대기-2 프로젝트/u }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '✓ 수주 확인 · 프로젝트 접수', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/projects/schedule' && url.searchParams.get('projectId') === 'project-ready-case-2' && url.searchParams.get('erpSync') === 'PENDING', { timeout: 15_000 });
    console.log('  5/5 reception lists stay separated, searchable, scrollable, selection-safe and one-click reception routes to schedule PASS');

    assert.deepEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join(' | ')}`);
    await context.close();
    console.log('✅ CF69 final document and reception real-Chrome E2E PASS (5 flows)');
  } finally {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
