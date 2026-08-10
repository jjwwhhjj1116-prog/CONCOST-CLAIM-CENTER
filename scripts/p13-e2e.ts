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
  const overflowCases = Array.from({ length: 120 }, (_, index) => ({
    id: `CASE-P13-OVERFLOW-${String(index + 1).padStart(3, '0')}`,
    organizationId: 'ORG-SYN-A',
    caseNumber: `CASE-P13-${String(index + 1).padStart(4, '0')}`,
    title: `SYNTHETIC_OVERFLOW_CASE_${String(index + 1).padStart(3, '0')}`,
    claimType: 'TYPE-01',
    status: 'INQUIRY',
    assignedUserId: 'USR-PM',
    createdAt: new Date(Date.now() + index + 1),
    updatedAt: new Date(Date.now() + index + 1)
  }));
  await db.caseItem.createMany({ data: overflowCases });
  await db.caseAssignment.createMany({
    data: overflowCases.map((item) => ({ caseId: item.id, userId: 'USR-PM' }))
  });
  await db.caseAssignment.create({ data: { caseId: 'CASE-SYN-LONG', userId: 'USR-DIRECTOR' } });
  const historyBillingDate = new Date('2026-07-01T00:00:00.000Z');
  const historyConfig = await db.caseFeeConfig.create({
    data: {
      id: 'FEECFG-P13-HISTORY', organizationId: 'ORG-SYN-A', caseId: 'CASE-SYN-LONG',
      contractAmount: 1_000n, hasSuccessFee: true, billingDate: historyBillingDate,
      baseAmount: 1_000n, feeRateBps: 10_000, isTaxInclusive: false, status: 'DRAFT', version: 1
    }
  });
  const historyEstimate = await db.caseFeeCalculation.create({
    data: {
      id: 'FEECALC-P13-HISTORY-ESTIMATE', organizationId: 'ORG-SYN-A', caseId: 'CASE-SYN-LONG',
      feeConfigId: historyConfig.id, calcType: 'ESTIMATED', contractAmount: 1_000n,
      hasSuccessFee: true, billingDate: historyBillingDate, baseAmount: 1_000n, feeRateBps: 10_000,
      isTaxInclusive: false, calculatedFee: 1_000n, taxAmount: 100n, totalClaimFee: 1_100n,
      formulaVersion: 'KRW_INTEGER_HALF_UP_BPS_TAX_V3', feeConfigVersion: 1,
      actorId: 'USR-PM', idempotencyKey: 'P13-HISTORY-ESTIMATE', idempotencyFingerprint: 'P13-HISTORY-ESTIMATE'
    }
  });
  await db.caseFeeCalculation.create({
    data: {
      id: 'FEECALC-P13-HISTORY-FINAL', organizationId: 'ORG-SYN-A', caseId: 'CASE-SYN-LONG',
      feeConfigId: historyConfig.id, calcType: 'FINAL', contractAmount: 1_000n,
      hasSuccessFee: true, billingDate: historyBillingDate, baseAmount: 1_000n, feeRateBps: 10_000,
      isTaxInclusive: false, calculatedFee: 1_000n, taxAmount: 100n, totalClaimFee: 1_100n,
      formulaVersion: 'KRW_INTEGER_HALF_UP_BPS_TAX_V3', feeConfigVersion: 1,
      sourceCalculationId: historyEstimate.id, actorId: 'USR-DIRECTOR',
      idempotencyKey: 'P13-HISTORY-FINAL', idempotencyFingerprint: 'P13-HISTORY-FINAL'
    }
  });
  await db.caseFeePayment.createMany({
    data: Array.from({ length: 100 }, (_, index) => ({
      id: `FEEPAY-P13-HISTORY-${String(index + 1).padStart(3, '0')}`,
      organizationId: 'ORG-SYN-A', caseId: 'CASE-SYN-LONG', feeConfigId: historyConfig.id,
      paymentType: 'PARTIAL', amount: 1n, paymentDate: new Date(`2026-07-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`),
      invoiceStatus: 'NOT_ISSUED', note: `Synthetic payment boundary ${index + 1}`,
      actorId: 'USR-PM', idempotencyKey: `P13-HISTORY-PAY-${index + 1}`,
      idempotencyFingerprint: `P13-HISTORY-PAY-${index + 1}`,
      createdAt: new Date(Date.now() + index + 1)
    }))
  });

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
    await pmPage.getByRole('heading', { name: '비용·성공보수 정산' }).waitFor();
    await assertVisibleText(pmPage, '예상 계산 → 독립 승인 → 수납 → 미수 확인까지 한 화면에서 관리합니다.');

    // The target is outside the first 100 assigned cases and must remain reachable by server-side search.
    await pmPage.getByLabel('사건 검색').fill('AAAAAAAAAAAA');
    await pmPage.locator('#fee-case-select option[value="CASE-SYN-LONG"]').waitFor({ state: 'attached' });
    await pmPage.getByLabel('정산 대상 사건', { exact: true }).selectOption('CASE-SYN-LONG');
    await pmPage.getByText('102건', { exact: true }).waitFor();
    await pmPage.getByText('수납·조정 이력 (100)').waitFor();
    const historyRows = await pmPage.locator('.fee-history details').nth(1).locator('tbody tr').count();
    if (historyRows !== 100) throw new Error(`Expected 100 rendered payment rows, received ${historyRows}`);

    // A slower response for the previously selected case must never overwrite the newly selected case.
    await pmPage.getByLabel('사건 검색').fill('SYNTHETIC_OVERFLOW_CASE_1');
    await pmPage.locator('#fee-case-select option[value="CASE-P13-OVERFLOW-120"]').waitFor({ state: 'attached' });
    await pmPage.locator('#fee-case-select option[value="CASE-P13-OVERFLOW-119"]').waitFor({ state: 'attached' });
    let releaseSlowRequest!: () => void;
    const slowRequestStarted = new Promise<void>((resolve) => { releaseSlowRequest = resolve; });
    await pmPage.route('**/api/cases/CASE-P13-OVERFLOW-120/fee-compensation', async (route) => {
      releaseSlowRequest();
      await new Promise((resolve) => setTimeout(resolve, 450));
      await route.continue();
    });
    await pmPage.getByLabel('정산 대상 사건', { exact: true }).selectOption('CASE-P13-OVERFLOW-120');
    await slowRequestStarted;
    await pmPage.getByLabel('정산 대상 사건', { exact: true }).selectOption('CASE-P13-OVERFLOW-119');
    await pmPage.waitForFunction(() => document.querySelector('[data-testid="fee-page"]')?.getAttribute('data-loaded-case-id') === 'CASE-P13-OVERFLOW-119');
    await pmPage.waitForTimeout(600);
    const loadedAfterOutOfOrderResponse = await pmPage.getByTestId('fee-page').getAttribute('data-loaded-case-id');
    if (loadedAfterOutOfOrderResponse !== 'CASE-P13-OVERFLOW-119') {
      throw new Error(`Stale fee response overwrote selected case: ${loadedAfterOutOfOrderResponse}`);
    }
    await pmPage.unroute('**/api/cases/CASE-P13-OVERFLOW-120/fee-compensation');

    await pmPage.getByLabel('사건 검색').fill('CASE-2026-0001');
    await pmPage.locator('#fee-case-select option[value="CASE-SYN-001"]').waitFor({ state: 'attached' });
    await pmPage.getByLabel('정산 대상 사건', { exact: true }).selectOption('CASE-SYN-001');
    await pmPage.getByLabel('계약 금액 (원)').waitFor();

    // A failed first load followed by retry must not carry case A's calculation draft into case B.
    await pmPage.getByLabel('계약 금액 (원)').fill('111');
    await pmPage.getByLabel('기준 금액 (원)').fill('222');
    await pmPage.getByLabel('성공보수 요율 (%)').fill('3.33');
    let failLongCaseOnce = true;
    await pmPage.route('**/api/cases/CASE-SYN-LONG/fee-compensation', async (route) => {
      if (failLongCaseOnce) {
        failLongCaseOnce = false;
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await pmPage.getByLabel('사건 검색').fill('AAAAAAAAAAAA');
    await pmPage.locator('#fee-case-select option[value="CASE-SYN-LONG"]').waitFor({ state: 'attached' });
    await pmPage.getByLabel('정산 대상 사건', { exact: true }).selectOption('CASE-SYN-LONG');
    await pmPage.getByRole('alert').waitFor();
    await pmPage.getByRole('button', { name: '최신 데이터 다시 불러오기' }).click();
    await pmPage.waitForFunction(() => document.querySelector('[data-testid="fee-page"]')?.getAttribute('data-loaded-case-id') === 'CASE-SYN-LONG');
    if (await pmPage.getByLabel('계약 금액 (원)').inputValue() !== '1000') throw new Error('Contract amount draft leaked across a failed case load retry');
    if (await pmPage.getByLabel('기준 금액 (원)').inputValue() !== '1000') throw new Error('Base amount draft leaked across a failed case load retry');
    if (await pmPage.getByLabel('성공보수 요율 (%)').inputValue() !== '100.00') throw new Error('Fee rate draft leaked across a failed case load retry');
    await pmPage.unroute('**/api/cases/CASE-SYN-LONG/fee-compensation');
    await pmPage.getByLabel('사건 검색').fill('CASE-2026-0001');
    await pmPage.locator('#fee-case-select option[value="CASE-SYN-001"]').waitFor({ state: 'attached' });
    await pmPage.getByLabel('정산 대상 사건', { exact: true }).selectOption('CASE-SYN-001');
    await pmPage.getByLabel('계약 금액 (원)').waitFor();

    // A UI-created PM case initially has only its creator assigned. Exercise the
    // real assignment API through the shipped UI instead of hiding the workflow
    // behind direct fixture insertion.
    await pmPage.locator('select[aria-label="독립 승인자"] option[value="USR-DIRECTOR"]').waitFor({ state: 'attached' });
    await pmPage.getByLabel('독립 승인자', { exact: true }).selectOption('USR-DIRECTOR');
    await pmPage.getByRole('button', { name: '승인자 공동 배정' }).click();
    await pmPage.getByText(/승인자를 사건에 공동 배정했습니다/).waitFor();
    const directorAssignment = await db.caseAssignment.findUnique({
      where: { caseId_userId: { caseId: 'CASE-SYN-001', userId: 'USR-DIRECTOR' } }
    });
    if (!directorAssignment) throw new Error('P13 UI did not persist the independent approver assignment');

    await pmPage.getByLabel('계약 금액 (원)').fill('100000000');
    await pmPage.getByLabel('기준 금액 (원)').fill('15');
    await pmPage.getByLabel('성공보수 요율 (%)').fill('100.00');
    await pmPage.getByLabel('청구일').fill('2026-07-15');
    await pmPage.getByText('공급가 ₩15 · 부가세 ₩2', { exact: true }).waitFor();
    await pmPage.getByLabel('기준 금액 (원)').fill('11000');
    await pmPage.getByLabel('부가세 포함 금액').check();

    // Simulate a lost response after the server commits. Retrying the unchanged payload must reuse the key.
    const estimateKeys: string[] = [];
    let loseFirstResponse = true;
    await pmPage.route('**/api/cases/*/fee-compensation/calculate', async (route) => {
      const body = route.request().postDataJSON() as { idempotencyKey?: string };
      estimateKeys.push(body.idempotencyKey ?? '');
      if (loseFirstResponse) {
        loseFirstResponse = false;
        const response = await route.fetch();
        if (!response.ok()) throw new Error(`Initial estimate commit failed with ${response.status()}`);
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await pmPage.getByRole('button', { name: '예상 보수 새 이력 저장' }).click();
    const firstAttemptAlert = pmPage.getByRole('alert');
    await firstAttemptAlert.waitFor();
    await pmPage.getByRole('button', { name: '예상 보수 새 이력 저장' }).click();
    await firstAttemptAlert.waitFor({ state: 'hidden' });
    const retryResult = await Promise.race([
      pmPage.getByText(/예상 성공보수 .*새 이력으로 저장/).waitFor().then(() => 'success'),
      pmPage.getByRole('alert').waitFor().then(async () => `error:${await pmPage.getByRole('alert').innerText()}`)
    ]);
    if (retryResult !== 'success') throw new Error(`Response-loss retry failed (${retryResult}); keys=${JSON.stringify(estimateKeys)}`);
    await pmPage.unroute('**/api/cases/*/fee-compensation/calculate');
    if (estimateKeys.length !== 2 || !estimateKeys[0] || estimateKeys[0] !== estimateKeys[1]) {
      throw new Error(`Response-loss retry changed idempotency key: ${JSON.stringify(estimateKeys)}`);
    }
    const estimateRow = pmPage.locator('.fee-history details').first().locator('tbody tr').first();
    await estimateRow.getByText('2026. 7. 15.').waitFor();
    const financialCells = await estimateRow.locator('td').allTextContents();
    if (financialCells[5] !== '₩10,000' || financialCells[6] !== '₩1,000' || financialCells[7] !== '₩11,000') {
      throw new Error(`Inclusive tax columns are not supply/tax/total: ${JSON.stringify(financialCells)}`);
    }

    // 2. Director Login & Final Fee Approval
    console.log('2. Director login & Final fee approval...');
    const { page: directorPage } = await newPage(browser, apiOrigin);
    await login(directorPage, webOrigin, 'director@example.invalid');

    await directorPage.goto(`${webOrigin}/success-fee`, { waitUntil: 'domcontentloaded' });
    await directorPage.getByRole('heading', { name: '비용·성공보수 정산' }).waitFor();

    await directorPage.getByRole('button', { name: '최신 예상 보수 독립 승인' }).click();
    await directorPage.getByText(/독립 승인으로 최종 성공보수/).waitFor();
    await directorPage.getByText('확정됨').waitFor();

    // Switching cases must discard every payment draft from the prior case.
    await pmPage.reload({ waitUntil: 'domcontentloaded' });
    await pmPage.getByLabel('사건 검색').fill('CASE-2026-0001');
    await pmPage.locator('#fee-case-select option[value="CASE-SYN-001"]').waitFor({ state: 'attached' });
    await pmPage.getByLabel('정산 대상 사건', { exact: true }).selectOption('CASE-SYN-001');
    await pmPage.getByText('확정됨').waitFor();
    await pmPage.getByLabel('수납 금액 (원)').fill('777');
    await pmPage.getByLabel('수납 기록 유형').selectOption('ADJUSTMENT');
    await pmPage.getByLabel('세금계산서 상태').selectOption('ISSUED');
    await pmPage.getByLabel('세금계산서 발행일').fill('2026-07-16');
    await pmPage.getByLabel('세금계산서 승인번호').fill('SYNTHETIC-DRAFT-MUST-CLEAR');
    await pmPage.getByLabel('수납 적요').fill('SYNTHETIC CASE A DRAFT');
    await pmPage.getByLabel('사건 검색').fill('AAAAAAAAAAAA');
    await pmPage.locator('#fee-case-select option[value="CASE-SYN-LONG"]').waitFor({ state: 'attached' });
    await pmPage.getByLabel('정산 대상 사건', { exact: true }).selectOption('CASE-SYN-LONG');
    await pmPage.waitForFunction(() => document.querySelector('[data-testid="fee-page"]')?.getAttribute('data-loaded-case-id') === 'CASE-SYN-LONG');
    if (await pmPage.getByLabel('수납 금액 (원)').inputValue() !== '') throw new Error('Payment amount leaked across cases');
    if (await pmPage.getByLabel('수납 기록 유형').inputValue() !== 'PARTIAL') throw new Error('Payment type leaked across cases');
    if (await pmPage.getByLabel('세금계산서 상태').inputValue() !== 'NOT_ISSUED') throw new Error('Invoice status leaked across cases');
    if (await pmPage.getByLabel('수납 적요').inputValue() !== '') throw new Error('Payment note leaked across cases');
    const leakedPayments = await db.caseFeePayment.count({ where: { caseId: 'CASE-SYN-LONG' } });
    if (leakedPayments !== 100) throw new Error(`Case switch changed the 100-row payment boundary to ${leakedPayments}`);

    // 3. Payment Addition & Unpaid Balance Update
    console.log('3. Payment recording & Unpaid balance update...');
    await directorPage.getByLabel('수납 금액 (원)').fill('5000');
    await directorPage.getByRole('button', { name: '수납 이력 기록' }).click();
    await directorPage.getByText(/입금 .*변경 불가 이력/).waitFor();

    // 4. Case Closure with Unpaid Balance Confirmation
    console.log('4. Case closure with unpaid balance confirmation modal...');
    await db.caseItem.update({ where: { id: 'CASE-SYN-001' }, data: { status: 'SUCCESS_FEE', version: { increment: 1 } } });
    await directorPage.reload({ waitUntil: 'domcontentloaded' });
    await directorPage.getByRole('button', { name: '사건 종결 확인' }).click();
    await directorPage.getByRole('heading', { name: '미수금이 남아 있습니다' }).waitFor();

    await directorPage.getByRole('button', { name: '미수 상태로 강제 종결' }).click();
    await directorPage.getByText(/권한자의 명시적 확인으로 미수 사건을 종결/).waitFor();

    // 5. 1024px / 200% equivalent narrow viewport / keyboard focus boundary.
    console.log('5. Responsive and keyboard boundary checks...');
    const { context: boundaryContext, page: boundaryPage } = await newPage(browser, apiOrigin, { width: 1024, height: 900 });
    await login(boundaryPage, webOrigin, 'pm@example.invalid');
    await boundaryPage.goto(`${webOrigin}/success-fee`, { waitUntil: 'domcontentloaded' });
    await boundaryPage.getByRole('heading', { name: '비용·성공보수 정산' }).waitFor();
    const overflow1024 = await boundaryPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow1024) throw new Error('P13 page causes horizontal viewport overflow at 1024px');
    await boundaryPage.setViewportSize({ width: 640, height: 900 });
    await boundaryPage.reload({ waitUntil: 'domcontentloaded' });
    const overflowZoomEquivalent = await boundaryPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflowZoomEquivalent) throw new Error('P13 page causes horizontal viewport overflow at 200% equivalent width');
    await boundaryPage.locator('button, input, select, a[href]').first().waitFor({ state: 'visible' });
    await boundaryPage.bringToFront();
    await boundaryPage.locator('body').click({ position: { x: 4, y: 4 } });
    let hasKeyboardFocus = false;
    for (let attempt = 0; attempt < 5 && !hasKeyboardFocus; attempt += 1) {
      await boundaryPage.keyboard.press('Tab');
      hasKeyboardFocus = await boundaryPage.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        return Boolean(active && active !== document.body && active.matches('button, input, select, a[href], [tabindex]:not([tabindex="-1"])'));
      });
    }
    if (!hasKeyboardFocus) throw new Error('Keyboard focus did not enter an interactive control');
    await boundaryContext.close();

    // 6. A real reviewer browser session must be unable to submit a fee calculation.
    console.log('6. Browser-enforced permission denial...');
    const { context: reviewerContext, page: reviewerPage } = await newPage(browser, apiOrigin);
    await login(reviewerPage, webOrigin, 'reviewer@example.invalid');
    await reviewerPage.goto(`${webOrigin}/success-fee`, { waitUntil: 'domcontentloaded' });
    await reviewerPage.getByRole('heading', { name: '403 Forbidden' }).waitFor();
    await reviewerPage.getByText('성공보수 화면에 접근할 권한이 없습니다.', { exact: false }).waitFor();
    const denied = await reviewerPage.evaluate(async ({ origin }) => {
      const csrf = document.cookie.split(';').map((value) => value.trim()).find((value) => value.startsWith('csrf_token='))?.slice('csrf_token='.length) ?? '';
      const response = await fetch(`${origin}/api/cases/CASE-SYN-001/fee-compensation/calculate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf) },
        body: JSON.stringify({
          contractAmount: '100000000', baseAmount: '11000', feeRateBps: 10000,
          hasSuccessFee: true, isTaxInclusive: true, billingDate: '2026-07-15',
          calcType: 'ESTIMATED', expectedVersion: 2, idempotencyKey: 'reviewer-browser-denial'
        })
      });
      return { status: response.status, body: await response.text() };
    }, { origin: apiOrigin });
    if (denied.status !== 403) throw new Error(`Reviewer browser mutation expected 403, received ${denied.status}: ${denied.body}`);
    await reviewerContext.close();

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

async function assertVisibleText(page: Page, text: string): Promise<void> {
  const target = page.getByText(text, { exact: true });
  await target.waitFor({ state: 'visible' });
  const color = await target.evaluate((element) => getComputedStyle(element).color);
  if (color === 'rgba(0, 0, 0, 0)') throw new Error(`Text is visually transparent: ${text}`);
}

main().catch((err) => {
  console.error('❌ P13 Chromium E2E Test Failed:', err);
  process.exit(1);
});
