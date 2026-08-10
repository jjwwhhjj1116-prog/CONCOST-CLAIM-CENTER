import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createServer, type Server } from 'node:http';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createPrismaClient, resetDatabase, seedDatabase, type PrismaClient } from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { createP09Fixture, requestJson as requestApiJson } from './p09-test-support';

const root = path.resolve(__dirname, '..');
const caseId = 'CASE-SYN-001';
const forbiddenBrowserData = /ya29\.|1\/\/[A-Za-z0-9_-]{20,}|client[_-]?secret|access[_-]?token|refresh[_-]?token|secretRef|pkceVerifier/i;

function browserExecutable(): string {
  if (process.env.CHROMIUM_BIN) return process.env.CHROMIUM_BIN;
  if (process.platform === 'win32') {
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    if (fs.existsSync(chromePath)) return chromePath;
    const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    if (fs.existsSync(edgePath)) return edgePath;
  }
  return 'google-chrome';
}

function productionWebServer(webOrigin: string): Server {
  const distRoot = path.join(root, 'apps/web/dist');
  if (!fs.existsSync(path.join(distRoot, 'index.html'))) throw new Error('P14 browser E2E requires a current production build in apps/web/dist');
  const types: Record<string, string> = { '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
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
    try { if ((await fetch(url)).ok) return; } catch { /* server is starting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not start: ${url}`);
}

async function seedBoundaryWorkspace(db: PrismaClient): Promise<void> {
  const longName = `E2E-BOUNDARY-${'매우긴사건리소스이름'.repeat(18)}`;
  const operations = Array.from({ length: 121 }, (_, index) => ({
    id: `GSYNC-P14-E2E-${String(index).padStart(3, '0')}`,
    organizationId: 'ORG-SYN-A',
    caseId,
    operationKind: 'GMAIL_IMPORT',
    idempotencyKey: `P14-E2E-BOUNDARY-${index}`,
    requestFingerprint: `${index.toString(16).padStart(64, '0')}`,
    status: 'PENDING',
    resultJson: null,
    completedAt: null,
    actorId: 'USR-PM',
    createdAt: new Date(Date.UTC(2026, 7, 10, 3, index % 60, 0))
  }));
  const resources = operations.map((operation, index) => ({
    id: `GRLINK-P14-E2E-${String(index).padStart(3, '0')}`,
    organizationId: 'ORG-SYN-A',
    caseId,
    operationId: operation.id,
    entityType: 'GMAIL_ATTACHMENT',
    internalEntityId: `DOCVER-P14-E2E-BOUNDARY-${index}`,
    externalResourceId: `P14-E2E-EXTERNAL-${index}`,
    resourceMetadataJson: JSON.stringify({
      name: index === 0 ? longName : `E2E-BOUNDARY-RESOURCE-${String(index).padStart(3, '0')}`,
      webViewLink: `https://drive.google.invalid/boundary/${index}`,
      provenance: `synthetic:p14-e2e:${index}`,
      documentVersionId: `DOCVER-P14-E2E-BOUNDARY-${index}`
    }),
    createdAt: new Date(Date.UTC(2026, 7, 10, 3, index % 60, 1))
  }));
  const snapshots = operations.map((operation, index) => ({
    id: `GSNAP-P14-E2E-${String(index).padStart(3, '0')}`,
    organizationId: 'ORG-SYN-A',
    caseId,
    operationId: operation.id,
    sourceType: 'GMAIL_ATTACHMENT',
    externalResourceId: `P14-E2E-EXTERNAL-${index}`,
    sha256: crypto.createHash('sha256').update(`p14-boundary-${index}`).digest('hex'),
    provenanceJson: JSON.stringify({
      attachmentId: `P14-E2E-EXTERNAL-${index}`,
      documentVersionId: `DOCVER-P14-E2E-BOUNDARY-${index}`
    }),
    createdById: 'USR-PM'
  }));
  await db.document.createMany({ data: operations.map((_, index) => ({
    id: `DOC-P14-E2E-BOUNDARY-${index}`,
    caseId,
    title: `Synthetic E2E boundary document ${index}`,
    source: 'RECEIVED'
  })) });
  await db.documentVersion.createMany({ data: operations.map((_, index) => ({
    id: `DOCVER-P14-E2E-BOUNDARY-${index}`,
    documentId: `DOC-P14-E2E-BOUNDARY-${index}`,
    versionNumber: 1,
    originalName: `p14-boundary-${index}.txt`,
    displayName: `p14-boundary-${index}.txt`,
    storageKey: `p14-e2e-boundary-${index}.txt`,
    fileSize: 1,
    mimeType: 'text/plain',
    sha256: crypto.createHash('sha256').update(`p14-boundary-${index}`).digest('hex'),
    uploadedById: 'USR-PM'
  })) });
  for (const [index, operation] of operations.entries()) {
    // At most one unresolved operation of a kind may exist for a case. Create
    // each deterministic boundary history item through its full audited lifecycle.
    await db.$transaction(async (tx) => {
      await tx.googleSyncOperation.create({ data: operation });
      await tx.googleImportSnapshot.create({ data: snapshots[index] });
      await tx.googleResourceLink.create({ data: resources[index] });
      await tx.googleSyncOperation.update({
        where: { id: operation.id },
        data: {
          status: 'SUCCESS',
          resultJson: JSON.stringify({ httpStatus: 201, body: { synthetic: true, index } }),
          completedAt: new Date(Date.UTC(2026, 7, 10, 4, index % 60, 0))
        }
      });
    });
  }
}

async function newPage(browser: Browser, apiOrigin: string, viewport = { width: 1440, height: 900 }): Promise<{ context: BrowserContext; page: Page; googlePayloads: string[] }> {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((origin: string) => { (window as Window & { __CLAIM_API_ORIGIN__?: string }).__CLAIM_API_ORIGIN__ = origin; }, apiOrigin);
  const page = await context.newPage();
  const googlePayloads: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/google-workspace') || response.url().includes('/google/')) {
      void response.text().then((value) => googlePayloads.push(value)).catch(() => undefined);
    }
  });
  return { context, page, googlePayloads };
}

async function login(page: Page, webOrigin: string, email: string): Promise<void> {
  await page.goto(`${webOrigin}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill('Password123!');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.locator('.session-identity').waitFor({ state: 'visible', timeout: 15_000 });
}

async function assertNoBrowserSecret(page: Page, payloads: string[]): Promise<void> {
  await page.waitForTimeout(50);
  const snapshot = await page.evaluate(() => ({
    body: document.body.innerText,
    dom: document.documentElement.outerHTML,
    inputs: Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')).map((element) => element.value).join('\n'),
    url: location.href,
    localStorage: JSON.stringify({ ...localStorage }),
    sessionStorage: JSON.stringify({ ...sessionStorage })
  }));
  for (const [location, value] of Object.entries(snapshot)) {
    assert.doesNotMatch(value, forbiddenBrowserData, `forbidden Google credential material found in browser ${location}`);
  }
  for (const payload of payloads) assert.doesNotMatch(payload, forbiddenBrowserData, 'forbidden Google credential material found in API response');
  assert.doesNotMatch(new URL(snapshot.url).search, /(?:code|token|state)=/i, 'OAuth material must not remain in the browser URL');
}

async function assertResponsive(page: Page): Promise<void> {
  for (const width of [1440, 1024, 640]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(100);
    const geometry = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, body: document.body.scrollWidth }));
    assert.ok(geometry.body <= geometry.viewport + 2, `${width}px layout has horizontal document overflow: ${JSON.stringify(geometry)}`);
  }
}

async function main(): Promise<void> {
  console.log('--- Starting P14 Full Chromium Vertical Slice E2E ---');
  const unique = `p14-e2e-${process.pid}-${Date.now()}`;
  const databasePath = path.join(root, 'packages/database/.data', `${unique}.db`);
  const uploadDir = path.join(root, 'packages/database/.data', `${unique}-uploads`);
  const databaseUrl = `file:${databasePath}`;

  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const db = createPrismaClient(databaseUrl);
  let webOrigin = '';
  const webServer = productionWebServer('http://127.0.0.1:0');
  await new Promise<void>((resolve) => webServer.listen(0, '127.0.0.1', resolve));
  const webPort = (webServer.address() as { port: number }).port;
  webOrigin = `http://127.0.0.1:${webPort}`;
  const api: ManagedApiServer = createApiServer({ databaseUrl, allowedOrigins: [webOrigin], secureCookies: false, uploadDir, allowTestGoogleModes: true });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  const apiOrigin = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
  let browser: Browser | undefined;

  try {
    await waitFor(`${apiOrigin}/health`);
    await waitFor(`${webOrigin}/`);
    const fixture = await createP09Fixture(apiOrigin, db, { sectionCount: 1, requestOrigin: webOrigin });
    const secondCase = await db.caseItem.findUnique({ where: { id: 'CASE-SYN-004' } });
    if (secondCase) await db.caseAssignment.upsert({
      where: { caseId_userId: { caseId: secondCase.id, userId: 'USR-PM' } },
      create: { caseId: secondCase.id, userId: 'USR-PM' },
      update: {}
    });
    const reconciliationOperation = await db.googleSyncOperation.create({ data: {
      id: `GSYNC-P14-E2E-RECON-${crypto.randomUUID()}`,
      organizationId: 'ORG-SYN-A',
      caseId,
      operationKind: 'CALENDAR_EVENT',
      idempotencyKey: 'P14-E2E-RECONCILIATION-0001',
      requestFingerprint: crypto.createHash('sha256').update('P14-E2E-RECONCILIATION-0001').digest('hex'),
      status: 'PENDING',
      actorId: 'USR-PM'
    } });
    await db.googleSyncOperation.update({
      where: { id: reconciliationOperation.id },
      data: {
        status: 'RECONCILIATION_REQUIRED',
        resultJson: JSON.stringify({ httpStatus: 503, body: { error: 'manual reconciliation required', reconciliationRequired: true } }),
        completedAt: new Date()
      }
    });
    await seedBoundaryWorkspace(db);
    browser = await chromium.launch({ executablePath: browserExecutable(), headless: true });

    console.log('1. Admin keyboard-accessible deterministic Fake provider consent...');
    const admin = await newPage(browser, apiOrigin);
    await login(admin.page, webOrigin, 'admin@example.invalid');
    await admin.page.goto(`${webOrigin}/integrations/google`, { waitUntil: 'domcontentloaded' });
    await admin.page.getByText('DETERMINISTIC FAKE PROVIDER').waitFor();
    console.log('1a. Admin explicitly verifies and releases a quarantined operation...');
    const reconciliationPanel = admin.page.getByTestId('google-reconciliation-panel');
    await reconciliationPanel.getByText('수동 재조정 대기열').waitFor();
    await reconciliationPanel.getByText('RECONCILIATION_REQUIRED').waitFor();
    await reconciliationPanel.getByLabel('외부 리소스 없음 검증 참조').fill('Google Calendar admin console check P14-E2E');
    admin.page.once('dialog', (dialog) => void dialog.accept());
    await reconciliationPanel.getByRole('button', { name: '외부 리소스 없음 확인 및 재시도 잠금 해제' }).click();
    await admin.page.getByText(/새 작업 키로 다시 시도할 수 있습니다/).waitFor();
    await reconciliationPanel.getByText('재조정이 필요한 작업이 없습니다.').waitFor();
    assert.strictEqual((await db.googleSyncOperation.findUniqueOrThrow({ where: { id: reconciliationOperation.id } })).status, 'RECONCILED_NO_SIDE_EFFECT');
    assert.strictEqual(await db.auditLog.count({ where: {
      action: 'GOOGLE_RECONCILIATION_RESOLVED', targetId: reconciliationOperation.id, userId: 'USR-ADMIN'
    } }), 1, 'manual reconciliation must be coupled to one Admin audit row');

    const beginConsent = admin.page.getByRole('button', { name: 'Fake provider 동의 시작' });
    await beginConsent.focus();
    await admin.page.keyboard.press('Enter');
    await admin.page.getByRole('dialog', { name: 'Fake provider 동의 확인' }).waitFor();
    await admin.page.keyboard.press('Escape');
    await admin.page.waitForFunction(() => document.activeElement instanceof HTMLButtonElement && document.activeElement.textContent?.includes('Fake provider 동의 시작') === true);
    assert.strictEqual(await beginConsent.evaluate((element) => element === document.activeElement), true, 'Escape must restore focus to the consent trigger');
    await beginConsent.press('Enter');
    await admin.page.getByRole('button', { name: 'Fake provider 동의 완료' }).click();
    await admin.page.getByText('연결됨 (CONNECTED)').waitFor();
    const expiredMode = await requestApiJson(apiOrigin, '/api/google-workspace/fake-mode', 'POST', { mode: 'TOKEN_EXPIRED' }, fixture.admin, webOrigin);
    assert.strictEqual(expiredMode.status, 200);
    await admin.page.getByRole('button', { name: '연결 상태 테스트' }).click();
    await admin.page.getByText(/Google 토큰이 만료되었습니다/).waitFor();
    await admin.page.getByRole('button', { name: '상태 다시 불러오기' }).click();
    await admin.page.getByText('토큰 만료 (EXPIRED)').waitFor();
    const successfulMode = await requestApiJson(apiOrigin, '/api/google-workspace/fake-mode', 'POST', { mode: 'SUCCESS' }, fixture.admin, webOrigin);
    assert.strictEqual(successfulMode.status, 200);
    await admin.page.getByRole('button', { name: 'Fake provider 재동의 시작' }).press('Enter');
    await admin.page.getByRole('button', { name: 'Fake provider 동의 완료' }).click();
    await admin.page.getByText('연결됨 (CONNECTED)').waitFor();

    console.log('1b. Expiring-soon badge and distinct safe provider failures with recovery...');
    const connectedBeforeExpiryBoundary = await db.googleWorkspaceConnection.findUnique({ where: { organizationId: 'ORG-SYN-A' } });
    assert.ok(connectedBeforeExpiryBoundary, 'connected Google Workspace row must exist before expiry-boundary UI validation');
    await db.googleWorkspaceConnection.update({
      where: { organizationId: 'ORG-SYN-A' },
      data: { tokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000), version: { increment: 1 } }
    });
    await admin.page.getByRole('button', { name: '새로고침' }).click();
    await admin.page.getByText('만료 임박 (EXPIRING_SOON)').waitFor();
    assert.strictEqual(await admin.page.getByText('만료 임박 (EXPIRING_SOON)').count(), 1, 'a connected token expiring within 15 minutes must expose exactly one EXPIRING_SOON badge');

    await db.googleWorkspaceConnection.update({
      where: { organizationId: 'ORG-SYN-A' },
      data: { tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000), version: { increment: 1 } }
    });
    await admin.page.getByRole('button', { name: '새로고침' }).click();
    await admin.page.getByText('연결됨 (CONNECTED)').waitFor();

    const timeoutMode = await requestApiJson(apiOrigin, '/api/google-workspace/fake-mode', 'POST', { mode: 'TIMEOUT' }, fixture.admin, webOrigin);
    assert.strictEqual(timeoutMode.status, 200, `TIMEOUT Fake adapter mode setup failed: ${JSON.stringify(timeoutMode.body)}`);
    await admin.page.getByRole('button', { name: '연결 상태 테스트' }).click();
    const timeoutAlert = admin.page.getByRole('alert').filter({ hasText: 'TIMEOUT:' });
    await timeoutAlert.waitFor();
    const timeoutMessage = await timeoutAlert.innerText();
    assert.match(timeoutMessage, /Google 응답 시간이 초과되었습니다/, 'TIMEOUT must have a dedicated safe recovery message');
    assert.doesNotMatch(timeoutMessage, /provider timeout from upstream|socket|stack|secret/i, 'TIMEOUT UI must not expose provider raw diagnostics');

    const serverErrorMode = await requestApiJson(apiOrigin, '/api/google-workspace/fake-mode', 'POST', { mode: 'SERVER_ERROR' }, fixture.admin, webOrigin);
    assert.strictEqual(serverErrorMode.status, 200, `SERVER_ERROR Fake adapter mode setup failed: ${JSON.stringify(serverErrorMode.body)}`);
    await admin.page.getByRole('button', { name: '연결 상태 테스트' }).click();
    const serverErrorAlert = admin.page.getByRole('alert').filter({ hasText: '5XX:' });
    await serverErrorAlert.waitFor();
    const serverErrorMessage = await serverErrorAlert.innerText();
    assert.match(serverErrorMessage, /Google 서비스가 일시적으로 실패했습니다/, 'SERVER_ERROR must have a dedicated safe recovery message');
    assert.notStrictEqual(serverErrorMessage, timeoutMessage, 'TIMEOUT and SERVER_ERROR must remain visually distinguishable');
    assert.doesNotMatch(serverErrorMessage, /provider 5xx from upstream|stack|secret/i, 'SERVER_ERROR UI must not expose provider raw diagnostics');

    const revokeFailureMode = await requestApiJson(apiOrigin, '/api/google-workspace/fake-mode', 'POST', { mode: 'REVOKE_FAILURE' }, fixture.admin, webOrigin);
    assert.strictEqual(revokeFailureMode.status, 200, `REVOKE_FAILURE Fake adapter mode setup failed: ${JSON.stringify(revokeFailureMode.body)}`);
    admin.page.once('dialog', (dialog) => void dialog.accept());
    await admin.page.getByRole('button', { name: '연동 해제' }).click();
    await admin.page.getByRole('alert').filter({ hasText: '연동 해제 실패' }).waitFor();
    await admin.page.getByText('연결됨 (CONNECTED)').waitFor();
    const connectionAfterRevokeFailure = await db.googleWorkspaceConnection.findUnique({ where: { organizationId: 'ORG-SYN-A' } });
    assert.strictEqual(connectionAfterRevokeFailure?.status, 'CONNECTED', 'REVOKE_FAILURE must preserve the connected server state');

    const recoveryMode = await requestApiJson(apiOrigin, '/api/google-workspace/fake-mode', 'POST', { mode: 'SUCCESS' }, fixture.admin, webOrigin);
    assert.strictEqual(recoveryMode.status, 200, `SUCCESS Fake adapter mode restoration failed: ${JSON.stringify(recoveryMode.body)}`);
    await admin.page.getByRole('button', { name: '연결 상태 테스트' }).click();
    await admin.page.getByText('연결 테스트가 성공했습니다.').waitFor();
    await admin.page.getByText('연결됨 (CONNECTED)').waitFor();
    await assertNoBrowserSecret(admin.page, admin.googlePayloads);

    console.log('2. 403 route guard and assigned-case selection...');
    const pm = await newPage(browser, apiOrigin);
    await login(pm.page, webOrigin, 'pm@example.invalid');
    await pm.page.goto(`${webOrigin}/integrations/google`, { waitUntil: 'domcontentloaded' });
    await pm.page.getByText('403 Forbidden').waitFor();
    await pm.page.goto(`${webOrigin}/cases/files?caseId=CASE-SYN-003`, { waitUntil: 'domcontentloaded' });
    await pm.page.getByTestId('google-tools-case-06').getByText(/403 이 사건 또는 Google 작업에 대한 권한이 없습니다/).waitFor();
    await pm.page.goto(`${webOrigin}/cases/files?caseId=${encodeURIComponent(caseId)}`, { waitUntil: 'domcontentloaded' });
    const tools = pm.page.getByTestId('google-tools-case-06');
    await tools.getByText('Google Workspace 사건 작업').waitFor();
    await tools.getByText('CONNECTED', { exact: true }).waitFor();
    await tools.getByTestId('google-case-select').selectOption(caseId);

    console.log('2b. Assigned Reviewer may mutate evidence, but not Calendar schedules...');
    const reviewer = await newPage(browser, apiOrigin);
    await login(reviewer.page, webOrigin, 'reviewer@example.invalid');
    await reviewer.page.goto(`${webOrigin}/cases/files?caseId=${encodeURIComponent(caseId)}`, { waitUntil: 'domcontentloaded' });
    const reviewerFiles = reviewer.page.getByTestId('google-tools-case-06');
    await reviewerFiles.getByText('CONNECTED', { exact: true }).waitFor();
    assert.strictEqual(await reviewerFiles.getByRole('button', { name: 'Drive 폴더 생성·열기' }).isEnabled(), true, 'assigned Reviewer must be allowed evidence operations');
    await reviewer.page.goto(`${webOrigin}/cases/schedule?caseId=${encodeURIComponent(caseId)}`, { waitUntil: 'domcontentloaded' });
    const reviewerCalendar = reviewer.page.getByTestId('google-tools-case-04');
    await reviewerCalendar.getByText('CONNECTED', { exact: true }).waitFor();
    assert.strictEqual(await reviewerCalendar.getByRole('button', { name: 'Drive 폴더 생성·열기' }).isEnabled(), true, 'Reviewer Drive evidence action must remain available on the schedule route');
    await reviewerCalendar.getByLabel('Calendar 날짜 후보 선택').selectOption({ index: 1 });
    await reviewerCalendar.getByLabel('위 서버 고정 후보의 원문 위치와 날짜·시간을 사람이 확인했습니다.').check();
    assert.strictEqual(await reviewerCalendar.getByRole('button', { name: '확인한 후보로 일정 생성' }).isDisabled(), true, 'Reviewer must not be allowed to create Calendar schedules');
    await reviewerCalendar.getByText(/Drive 자료 작업은 가능하지만 Calendar 기일 생성/).waitFor();
    await assertNoBrowserSecret(reviewer.page, reviewer.googlePayloads);

    console.log('3. Optimistic 409 refresh, then idempotent Drive folder retry...');
    await db.caseItem.update({ where: { id: caseId }, data: { version: { increment: 1 } } });
    await tools.getByRole('button', { name: 'Drive 폴더 생성·열기' }).click();
    await tools.getByText(/409 사건 버전/).waitFor();
    await tools.getByRole('button', { name: '다시 시도' }).click();
    try {
      await tools.getByText(/Drive 사건 폴더가 준비되었습니다/).waitFor({ timeout: 10_000 });
    } catch {
      throw new Error(`Drive retry did not converge. url=${pm.page.url()} UI=${await pm.page.locator('body').innerText()} latestApi=${pm.googlePayloads.slice(-3).join('\n')}`);
    }

    console.log('4. Gmail retry cannot retain a stale attachment payload after selection changes...');
    const attachmentInputs = tools.locator('.google-selection-list input[type="checkbox"]');
    const candidateCount = await attachmentInputs.count();
    assert.ok(candidateCount >= 2, `workspace must expose at least two selectable Gmail candidates; UI=${await tools.innerText()} latestApi=${pm.googlePayloads.at(-1) ?? 'none'}`);
    const firstAttachment = attachmentInputs.first();
    const secondAttachment = attachmentInputs.nth(1);
    const staleAttachmentId = await firstAttachment.getAttribute('data-attachment-id');
    const selectedAttachmentId = await secondAttachment.getAttribute('data-attachment-id');
    assert.ok(staleAttachmentId && selectedAttachmentId, 'both Gmail candidates must have server identifiers');
    await firstAttachment.focus();
    await pm.page.keyboard.press('Space');
    await pm.context.setOffline(true);
    await tools.getByText(/OFFLINE/).first().waitFor();
    await tools.getByRole('button', { name: /선택 첨부 가져오기/ }).click();
    await tools.getByRole('button', { name: '다시 시도' }).waitFor();
    await firstAttachment.uncheck();
    await secondAttachment.check();
    assert.strictEqual(await tools.getByRole('button', { name: '다시 시도' }).count(), 0, 'changing Gmail selection must discard the stale retry closure and key');
    await pm.context.setOffline(false);
    await pm.page.waitForFunction(() => navigator.onLine === true);
    await tools.getByRole('button', { name: /선택 첨부 가져오기/ }).click();
    await tools.getByText(/Gmail 첨부를 가져왔습니다/).waitFor();
    assert.strictEqual(await db.googleImportSnapshot.count({ where: { caseId, sourceType: 'GMAIL_ATTACHMENT', externalResourceId: selectedAttachmentId! } }), 1);
    assert.strictEqual(await db.googleImportSnapshot.count({ where: { caseId, sourceType: 'GMAIL_ATTACHMENT', externalResourceId: staleAttachmentId! } }), 0, 'the attachment captured by the discarded retry closure must not be imported');
    const importedLink = await db.googleResourceLink.findFirst({ where: { caseId, entityType: 'GMAIL_ATTACHMENT', externalResourceId: selectedAttachmentId! } });
    assert.ok(importedLink, 'Gmail import must link the external attachment to an internal P06 document version');
    const importedVersion = await db.documentVersion.findUnique({ where: { id: importedLink.internalEntityId }, include: { document: true } });
    assert.ok(importedVersion, 'Gmail import must create a P06 DocumentVersion');
    assert.strictEqual(importedVersion.document.caseId, caseId, 'Gmail DocumentVersion must belong to the selected case');
    assert.ok(fs.existsSync(path.join(uploadDir, importedVersion.storageKey)), 'Gmail import bytes must exist in the P06 storage directory');

    console.log('5. Transport-ambiguous Sheets response retries with the same idempotency key...');
    await tools.getByLabel('Google Sheets 허용 범위 선택').selectOption({ index: 1 });
    const sheetsPattern = `**/api/cases/${caseId}/google/import-sheets`;
    let droppedSheetsResponse = false;
    await pm.page.route(sheetsPattern, async (route) => {
      if (droppedSheetsResponse) {
        await route.continue();
        return;
      }
      droppedSheetsResponse = true;
      const response = await route.fetch();
      assert.strictEqual(response.status(), 201, `the server must commit the first Sheets request before its response is dropped: ${await response.text()}`);
      await route.abort('failed');
    });
    await tools.getByRole('button', { name: '선택 범위 가져오기' }).click();
    await tools.getByRole('button', { name: '다시 시도' }).waitFor();
    await pm.page.unroute(sheetsPattern);
    await tools.getByRole('button', { name: '다시 시도' }).click();
    await tools.getByText(/Sheets 범위 snapshot을 저장했습니다/).waitFor();
    assert.strictEqual(await db.googleSyncOperation.count({ where: { caseId, actorId: 'USR-PM', operationKind: 'SHEETS_IMPORT' } }), 1, 'response-loss retry must replay one canonical Sheets operation');

    console.log('6. Server-bound Calendar candidate and terminal 429 retry with a fresh key...');
    await pm.page.goto(`${webOrigin}/cases/schedule?caseId=${encodeURIComponent(caseId)}`, { waitUntil: 'domcontentloaded' });
    const calendarTools = pm.page.getByTestId('google-tools-case-04');
    await calendarTools.getByText('CONNECTED', { exact: true }).waitFor();
    assert.strictEqual(await calendarTools.locator('input[type="datetime-local"], textarea').count(), 0, 'Calendar UI must not permit freeform date/source input');
    await calendarTools.getByLabel('Calendar 날짜 후보 선택').selectOption({ index: 1 });
    await calendarTools.getByText(/MEETING_ACTION_ITEM/).waitFor();
    await calendarTools.locator('.google-candidate-preview').getByText('신뢰도', { exact: true }).waitFor();
    await calendarTools.locator('.google-candidate-preview').getByText('95%', { exact: true }).waitFor();
    await calendarTools.getByLabel('위 서버 고정 후보의 원문 위치와 날짜·시간을 사람이 확인했습니다.').check();
    const rateLimited = await requestApiJson(apiOrigin, '/api/google-workspace/fake-mode', 'POST', { mode: 'RATE_LIMIT_RETRY_AFTER' }, fixture.admin, webOrigin);
    assert.strictEqual(rateLimited.status, 200, `test-only Fake adapter mode setup failed: ${JSON.stringify(rateLimited.body)}`);
    await calendarTools.getByRole('button', { name: '확인한 후보로 일정 생성' }).click();
    await calendarTools.getByText(/429 Google 요청 제한/).waitFor();
    const restored = await requestApiJson(apiOrigin, '/api/google-workspace/fake-mode', 'POST', { mode: 'SUCCESS' }, fixture.admin, webOrigin);
    assert.strictEqual(restored.status, 200, `Fake adapter mode restoration failed: ${JSON.stringify(restored.body)}`);
    await calendarTools.getByRole('button', { name: '다시 시도' }).click();
    await calendarTools.getByText(/Calendar 일정을 생성했습니다/).waitFor();
    const calendarOperations = await db.googleSyncOperation.findMany({
      where: { caseId, actorId: 'USR-PM', operationKind: 'CALENDAR_EVENT', status: { in: ['FAILED', 'SUCCESS'] } },
      orderBy: { createdAt: 'asc' }
    });
    assert.deepStrictEqual(calendarOperations.map((operation) => operation.status), ['FAILED', 'SUCCESS'], 'terminal provider failure must be followed by a distinct successful operation');
    assert.notStrictEqual(calendarOperations[0]?.idempotencyKey, calendarOperations[1]?.idempotencyKey, 'terminal 429 retry must use a fresh idempotency key');
    if (secondCase) {
      await calendarTools.getByTestId('google-case-select').selectOption(secondCase.id);
      await calendarTools.getByText('CONNECTED', { exact: true }).waitFor();
      assert.strictEqual(await calendarTools.getByLabel('Calendar 날짜 후보 선택').inputValue(), '', 'case switch must clear the prior case date candidate');
      assert.strictEqual(await calendarTools.getByLabel('위 서버 고정 후보의 원문 위치와 날짜·시간을 사람이 확인했습니다.').isChecked(), false, 'case switch must clear human confirmation');
      assert.strictEqual(await calendarTools.getByText(/Calendar 일정을 생성했습니다/).count(), 0, 'case switch must clear operation notice');
    }

    console.log('7. Selected server meeting version to Docs...');
    await pm.page.goto(`${webOrigin}/meetings?caseId=${encodeURIComponent(caseId)}`, { waitUntil: 'domcontentloaded' });
    const meetingTools = pm.page.getByTestId('google-tools-meet-01');
    await meetingTools.getByText('CONNECTED', { exact: true }).waitFor();
    await meetingTools.getByLabel('Google Docs 내보낼 회의록 선택').selectOption({ index: 1 });
    await meetingTools.getByRole('button', { name: '선택 버전 Docs 내보내기' }).click();
    await meetingTools.getByText(/선택한 회의록을 Google Docs로 내보냈습니다/).waitFor();

    console.log('8. 121-resource / 100-history / long-name and responsive boundaries...');
    await pm.page.goto(`${webOrigin}/cases/files?caseId=${encodeURIComponent(caseId)}`, { waitUntil: 'domcontentloaded' });
    const boundaryTools = pm.page.getByTestId('google-tools-case-06');
    await boundaryTools.getByText('CONNECTED', { exact: true }).waitFor();
    await boundaryTools.getByLabel('리소스 검색').fill('E2E-BOUNDARY');
    await boundaryTools.getByRole('button', { name: '검색' }).last().click();
    await boundaryTools.getByText('연결 리소스 (121)').waitFor();
    assert.strictEqual(await boundaryTools.getByTestId('google-resource-item').count(), 121);
    assert.strictEqual(await boundaryTools.getByTestId('google-history-item').count(), 100);
    const longName = boundaryTools.getByTestId('google-resource-item').filter({ hasText: '매우긴사건리소스이름' }).first().locator('.google-long-name');
    await longName.waitFor();
    await pm.page.setViewportSize({ width: 640, height: 900 });
    assert.ok(await longName.evaluate((element) => element.scrollWidth > element.clientWidth), '180-character resource name must use visible ellipsis overflow');
    await assertResponsive(pm.page);
    await pm.page.setViewportSize({ width: 1280, height: 900 });
    const zoomGeometry = await pm.page.evaluate(() => {
      document.body.style.zoom = '200%';
      return { viewport: document.documentElement.clientWidth, documentWidth: document.documentElement.scrollWidth };
    });
    assert.ok(zoomGeometry.documentWidth <= zoomGeometry.viewport + 2, `200% zoom must reflow without document overflow: ${JSON.stringify(zoomGeometry)}`);
    await pm.page.evaluate(() => { document.body.style.zoom = ''; });
    await assertNoBrowserSecret(pm.page, pm.googlePayloads);

    if (secondCase) {
      console.log('8b. Stale workspace response cannot overwrite a newly selected case...');
      let delayCaseOneOnce = true;
      await pm.page.route(`**/api/cases/${caseId}/google/workspace*`, async (route) => {
        if (delayCaseOneOnce) {
          delayCaseOneOnce = false;
          await new Promise((resolve) => setTimeout(resolve, 600));
        }
        await route.continue();
      });
      await boundaryTools.getByRole('button', { name: '검색' }).last().click({ noWaitAfter: true });
      await boundaryTools.getByTestId('google-case-select').selectOption(secondCase.id);
      await boundaryTools.getByText('연결 리소스 (0)').waitFor();
      await pm.page.waitForTimeout(800);
      assert.strictEqual(await boundaryTools.getByTestId('google-case-select').inputValue(), secondCase.id);
      assert.strictEqual(await boundaryTools.getByLabel('리소스 검색').inputValue(), '', 'case switch must clear the previous resource query');
      assert.strictEqual(await boundaryTools.getByTestId('google-resource-item').count(), 0, 'delayed prior-case response must be ignored');
      assert.strictEqual(await boundaryTools.getByText(/Drive 사건 폴더가 준비되었습니다/).count(), 0, 'case switch must clear prior operation notices');
      await pm.page.unroute(`**/api/cases/${caseId}/google/workspace*`);
    }

    console.log('9. Disconnect while preserving internal case and imported snapshots...');
    await admin.page.bringToFront();
    await admin.page.setViewportSize({ width: 1024, height: 900 });
    admin.page.once('dialog', (dialog) => void dialog.accept());
    await admin.page.getByRole('button', { name: '연동 해제' }).click();
    await admin.page.getByText('해제됨 (DISCONNECTED)').waitFor();
    await assertResponsive(admin.page);
    await assertNoBrowserSecret(admin.page, admin.googlePayloads);
    assert.ok(await db.caseItem.findUnique({ where: { id: caseId } }), 'disconnect must preserve the internal case');
    assert.ok(await db.googleImportSnapshot.count({ where: { caseId } }) >= 2, 'disconnect must preserve Gmail and Sheets snapshots');
    assert.ok(await db.googleResourceLink.count({ where: { caseId, entityType: { in: ['CASE_DRIVE_FOLDER', 'GMAIL_ATTACHMENT', 'CALENDAR_EVENT', 'DOCS_EXPORT'] } } }) >= 4, 'full flow must preserve linked Drive/Gmail/Calendar/Docs resources');
    const googleAuditCount = await db.auditLog.count({ where: { action: { in: [
      'GOOGLE_DRIVE_FOLDER_CREATED',
      'GMAIL_ATTACHMENTS_IMPORTED',
      'GOOGLE_CALENDAR_EVENT_CREATED',
      'GOOGLE_DOCS_EXPORTED',
      'GOOGLE_SHEETS_IMPORTED'
    ] } } });
    assert.ok(googleAuditCount >= 5, `full flow must create atomic audit events for all five Google operations (actual ${googleAuditCount})`);

    console.log('✅ P14 Full Chromium Vertical Slice E2E Passed (10 flows)');
  } finally {
    if (browser) await browser.close();
    await new Promise<void>((resolve) => webServer.close(() => resolve()));
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await db.$disconnect();
    try { if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath); } catch { /* best effort */ }
    try { if (fs.existsSync(uploadDir)) fs.rmSync(uploadDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

main().catch((error) => {
  console.error('❌ P14 Chromium E2E Test Failed:', error);
  process.exit(1);
});
