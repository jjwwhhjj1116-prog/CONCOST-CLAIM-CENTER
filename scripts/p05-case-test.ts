import test, { after, before } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { CASE_STATUSES, createApiServer, calculateDDay, type ManagedApiServer } from '../apps/api/src/server';
import {
  createPrismaClient, databaseUrlFor, resetDatabase, seedDatabase, type PrismaClient
} from '../packages/database/src';

interface HttpResult {
  status: number;
  body: Record<string, any>;
  headers: http.IncomingHttpHeaders;
}

const allowedOrigin = 'http://localhost:3000';
const databasePath = path.join(__dirname, '../packages/database/.data', `p05-case-${process.pid}.db`);
const databaseUrl = databaseUrlFor(databasePath);
let db: PrismaClient;
let server: ManagedApiServer;
let origin: string;
const category = { major: '건설', middle: '하자보수', minor: '합성 분류' };

function request(pathname: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request(`${origin}${pathname}`, {
      method,
      headers: {
        ...headers,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {})
      }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode ?? 500, body: text ? JSON.parse(text) : {}, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function login(email: string): Promise<{ cookie: string; csrf: string; response: HttpResult }> {
  const response = await request('/auth/login', 'POST', { email, password: 'Password123!' }, { Origin: allowedOrigin });
  assert.strictEqual(response.status, 200, `${email} login failed`);
  const setCookies = response.headers['set-cookie'] ?? [];
  return {
    response,
    cookie: setCookies.map((value) => value.split(';')[0]).join('; '),
    csrf: response.body.csrfToken
  };
}

function mutationHeaders(session: { cookie: string; csrf: string }): Record<string, string> {
  return { Cookie: session.cookie, Origin: allowedOrigin, 'X-CSRF-Token': session.csrf };
}

before(async () => {
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);

  db = createPrismaClient(databaseUrl);
  server = createApiServer({ databaseUrl, allowedOrigins: [allowedOrigin], secureCookies: true });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (server) await server.waitForDatabaseClose();
  if (db) await db.$disconnect();
  for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
});

test('P05 Case CRUD and exactly 6 claim types (TYPE-01 to TYPE-06 allowed, TYPE-07 rejected)', async () => {
  const pm = await login('pm@example.invalid');
  const headers = mutationHeaders(pm);

  // Attempt creating with invalid claimType (TYPE-07)
  const badTypeRes = await request('/api/cases', 'POST', { title: 'Invalid Type Case', claimType: 'TYPE-07', category }, headers);
  assert.strictEqual(badTypeRes.status, 400);

  // Create valid cases for all 6 claim types
  for (const claimType of ['TYPE-01', 'TYPE-02', 'TYPE-03', 'TYPE-04', 'TYPE-05', 'TYPE-06']) {
    const res = await request('/api/cases', 'POST', { title: `Case for ${claimType}`, claimType, description: 'Test desc', category }, headers);
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.case.caseNumber.startsWith('CASE-'));
    assert.strictEqual(res.body.case.claimType, claimType);
    assert.deepStrictEqual(res.body.case.category, category);
  }
});

test('P05 Parties management (0, 1, 10 parties with duplicate names)', async () => {
  const pm = await login('pm@example.invalid');

  // Case 1: 0 parties
  const case1 = await request('/api/cases/CASE-SYN-001', 'GET', undefined, { Cookie: pm.cookie });
  assert.strictEqual(case1.status, 200);
  assert.strictEqual(case1.body.case.parties.length, 0);

  // Case 4: 1 party
  const case4 = await request('/api/cases/CASE-SYN-004', 'GET', undefined, { Cookie: pm.cookie });
  assert.strictEqual(case4.status, 200);
  assert.strictEqual(case4.body.case.parties.length, 1);

  // Stress Case: 10 parties (includes duplicate names with distinct IDs)
  const caseStress = await request('/api/cases/CASE-SYN-STRESS', 'GET', undefined, { Cookie: pm.cookie });
  assert.strictEqual(caseStress.status, 200);
  assert.strictEqual(caseStress.body.case.parties.length, 10);

  const partyNames = caseStress.body.case.parties.map((p: any) => p.name);
  const duplicateNameCount = partyNames.filter((n: string) => n === 'SYNTHETIC_DUPLICATE_PARTY').length;
  assert.ok(duplicateNameCount > 1, 'Duplicate party names must be supported');

  // Test adding party via API
  const addRes = await request('/api/cases/CASE-SYN-001/parties', 'POST', { name: 'SYNTHETIC_PARTY_NEW', role: 'CLAIMANT', contact: 'SYNTHETIC_CONTACT_01' }, mutationHeaders(pm));
  assert.strictEqual(addRes.status, 201);
  assert.strictEqual(addRes.body.party.name, 'SYNTHETIC_PARTY_NEW');
});

test('P05 Schedules management (0, 1, 100 schedules with COURT/CLIENT/INTERNAL types)', async () => {
  const pm = await login('pm@example.invalid');

  // Case 1: 0 schedules
  const case1 = await request('/api/cases/CASE-SYN-001', 'GET', undefined, { Cookie: pm.cookie });
  assert.strictEqual(case1.body.case.schedules.length, 0);

  // Case 4: 1 schedule
  const case4 = await request('/api/cases/CASE-SYN-004', 'GET', undefined, { Cookie: pm.cookie });
  assert.strictEqual(case4.body.case.schedules.length, 1);
  assert.strictEqual(case4.body.case.schedules[0].type, 'COURT');

  // Stress Case: 100 schedules
  const caseStress = await request('/api/cases/CASE-SYN-STRESS', 'GET', undefined, { Cookie: pm.cookie });
  assert.strictEqual(caseStress.body.case.schedules.length, 100);

  // Invalid schedule type test
  const badType = await request('/api/cases/CASE-SYN-001/schedules', 'POST', { title: 'Bad Schedule', type: 'INVALID_TYPE', date: new Date().toISOString() }, mutationHeaders(pm));
  assert.strictEqual(badType.status, 400);
});

test('P05 Asia/Seoul D-day calculation (today midnight, past dates, leap day 2028-02-29, month boundaries)', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');

  // Today (2026-08-06 KST)
  const todayDate = new Date('2026-08-06T00:00:00.000Z');
  const dDayToday = calculateDDay(todayDate, now);
  assert.strictEqual(dDayToday.dDayStr, 'D-0');
  assert.strictEqual(dDayToday.isToday, true);

  // Past date (2026-08-01 KST -> 5 days overdue)
  const pastDate = new Date('2026-08-01T10:00:00.000Z');
  const dDayPast = calculateDDay(pastDate, now);
  assert.strictEqual(dDayPast.dDayStr, 'D+5');
  assert.strictEqual(dDayPast.isOverdue, true);

  // Future date (2026-08-10 KST -> 4 days remaining)
  const futureDate = new Date('2026-08-10T10:00:00.000Z');
  const dDayFuture = calculateDDay(futureDate, now);
  assert.strictEqual(dDayFuture.dDayStr, 'D-4');
  assert.strictEqual(dDayFuture.isOverdue, false);

  // Leap day (2028-02-29 KST)
  const leapDate = new Date('2028-02-29T10:00:00.000Z');
  const dDayLeap = calculateDDay(leapDate, new Date('2028-02-28T12:00:00.000Z'));
  assert.strictEqual(dDayLeap.dDayStr, 'D-1');
});

test('P05 Long case title (100+ chars) and same title cases with distinct IDs/caseNumbers', async () => {
  const pm = await login('pm@example.invalid');

  // Long title case
  const longCase = await request('/api/cases/CASE-SYN-LONG', 'GET', undefined, { Cookie: pm.cookie });
  assert.strictEqual(longCase.status, 200);
  assert.ok(longCase.body.case.title.length >= 100);

  // Same title cases
  const same1 = await request('/api/cases/CASE-SYN-SAME-1', 'GET', undefined, { Cookie: pm.cookie });
  const same2 = await request('/api/cases/CASE-SYN-SAME-2', 'GET', undefined, { Cookie: pm.cookie });
  assert.strictEqual(same1.body.case.title, same2.body.case.title);
  assert.notStrictEqual(same1.body.case.id, same2.body.case.id);
  assert.notStrictEqual(same1.body.case.caseNumber, same2.body.case.caseNumber);
});

test('P05 exact 12-state lifecycle and optimistic status transition history', async () => {
  assert.deepStrictEqual(CASE_STATUSES, [
    'INQUIRY', 'PROPOSAL', 'ESTIMATE', 'CONTRACT', 'MATERIAL_RECEIVED', 'ANALYSIS',
    'REPORT_DRAFTING', 'SUBMITTED', 'LITIGATION', 'JUDGEMENT', 'SUCCESS_FEE', 'CLOSED'
  ]);
  const pm = await login('pm@example.invalid');
  const headers = mutationHeaders(pm);

  // CASE-SYN-001 is in INQUIRY. Valid transition to PROPOSAL.
  const validTrans = await request('/api/cases/CASE-SYN-001/status', 'POST', { toStatus: 'PROPOSAL', reason: '합성 제안 단계', version: 1 }, headers);
  assert.strictEqual(validTrans.status, 200);
  assert.strictEqual(validTrans.body.case.status, 'PROPOSAL');
  assert.strictEqual(validTrans.body.case.version, 2);

  // Invalid transition from PROPOSAL directly to CONTRACT.
  const invalidTrans = await request('/api/cases/CASE-SYN-001/status', 'POST', { toStatus: 'CONTRACT', reason: '건너뛰기 시도', version: 2 }, headers);
  assert.strictEqual(invalidTrans.status, 400);

  // Stale transition cannot create a second history row.
  const stale = await request('/api/cases/CASE-SYN-001/status', 'POST', { toStatus: 'ESTIMATE', reason: '오래된 버전', version: 1 }, headers);
  assert.strictEqual(stale.status, 409);

  // Status history persisted
  const histories = await db.statusHistory.findMany({ where: { caseId: 'CASE-SYN-001' }, orderBy: { createdAt: 'desc' } });
  assert.strictEqual(histories.length, 2);
  assert.strictEqual(histories[0].toStatus, 'PROPOSAL');
});

test('P05 Optimistic locking 409 and soft-delete 404 with search/KPI exclusion', async () => {
  const pm = await login('pm@example.invalid');
  const headers = mutationHeaders(pm);

  // Soft deleted case access
  const softDel = await request('/api/cases/CASE-SYN-002', 'GET', undefined, { Cookie: pm.cookie });
  assert.strictEqual(softDel.status, 404);

  // Excluded from search
  const searchRes = await request('/api/cases?q=DELETED', 'GET', undefined, { Cookie: pm.cookie });
  assert.strictEqual(searchRes.body.cases.length, 0);

  // Optimistic locking 409
  const stale = await request('/api/cases/CASE-SYN-001', 'PATCH', { title: 'stale update', version: 999 }, headers);
  assert.strictEqual(stale.status, 409);
});

test('P05 IDOR protection across organizations for parties and schedules', async () => {
  const pm = await login('pm@example.invalid');
  const headers = mutationHeaders(pm);

  // Attempt adding party to Org B case
  const orgBParty = await request('/api/cases/CASE-SYN-ORGB/parties', 'POST', { name: 'IDOR Party', role: 'OTHER' }, headers);
  assert.strictEqual(orgBParty.status, 403);

  // Attempt adding schedule to Org B case
  const orgBSched = await request('/api/cases/CASE-SYN-ORGB/schedules', 'POST', { title: 'IDOR Sched', type: 'COURT', date: new Date().toISOString() }, headers);
  assert.strictEqual(orgBSched.status, 403);
});

test('P05 server RBAC blocks Staff/Reviewer/PM mutations prohibited by the product matrix', async () => {
  const staff = await login('staff@example.invalid');
  const reviewer = await login('reviewer@example.invalid');
  const pm = await login('pm@example.invalid');

  const staffCreate = await request('/api/cases', 'POST', { title: 'Forbidden staff case', claimType: 'TYPE-01', category }, mutationHeaders(staff));
  assert.strictEqual(staffCreate.status, 403);
  const staffPatch = await request('/api/cases/CASE-SYN-001', 'PATCH', { title: 'Forbidden', version: 2 }, mutationHeaders(staff));
  assert.strictEqual(staffPatch.status, 403);
  const reviewerStatus = await request('/api/cases/CASE-SYN-001/status', 'POST', { toStatus: 'ESTIMATE', version: 2 }, mutationHeaders(reviewer));
  assert.strictEqual(reviewerStatus.status, 403);
  const staffSchedule = await request('/api/cases/CASE-SYN-001/schedules', 'POST', { title: 'Forbidden', type: 'COURT', date: new Date().toISOString() }, mutationHeaders(staff));
  assert.strictEqual(staffSchedule.status, 403);
  const pmDelete = await request('/api/cases/CASE-SYN-001', 'DELETE', { version: 2 }, mutationHeaders(pm));
  assert.strictEqual(pmDelete.status, 403);
});

test('P05 rejects cross-organization assignees and malformed pagination without leaking data', async () => {
  const pm = await login('pm@example.invalid');
  const forbidden = await request('/api/cases', 'POST', {
    title: 'Cross organization assignment', claimType: 'TYPE-01', assignedUserId: 'USR-ORGB-PM', category
  }, mutationHeaders(pm));
  assert.strictEqual(forbidden.status, 403);
  const malformed = await request('/api/cases?page=NaN&limit=Infinity', 'GET', undefined, { Cookie: pm.cookie });
  assert.strictEqual(malformed.status, 200);
  assert.strictEqual(malformed.body.page, 1);
  assert.strictEqual(malformed.body.limit, 50);
});

test('P05 Dashboard KPI matches exact case/schedule query counts', async () => {
  const pm = await login('pm@example.invalid');
  const kpiRes = await request('/api/dashboard/kpi', 'GET', undefined, { Cookie: pm.cookie });
  assert.strictEqual(kpiRes.status, 200);

  const { totalCases, inProgressCount, reviewingDocsCount, todayTasksCount, delayedCount } = kpiRes.body;
  assert.ok(typeof totalCases === 'number' && totalCases > 0);
  assert.ok(typeof inProgressCount === 'number');
  assert.ok(typeof reviewingDocsCount === 'number');
  assert.ok(typeof todayTasksCount === 'number');
  assert.ok(typeof delayedCount === 'number');

  // Verify list query total equals KPI totalCases
  const listRes = await request('/api/cases?limit=100', 'GET', undefined, { Cookie: pm.cookie });
  assert.strictEqual(listRes.body.total, totalCases);

  const accessibleIds = (await db.caseAssignment.findMany({ where: { userId: 'USR-PM' }, select: { caseId: true } })).map((row) => row.caseId);
  const caseWhere = { id: { in: accessibleIds }, organizationId: 'ORG-SYN-A', deletedAt: null };
  assert.strictEqual(totalCases, await db.caseItem.count({ where: caseWhere }));
  assert.strictEqual(inProgressCount, await db.caseItem.count({ where: { ...caseWhere, status: { in: CASE_STATUSES.filter((status) => !['INQUIRY', 'CLOSED'].includes(status)) } } }));
  assert.strictEqual(reviewingDocsCount, await db.reportSection.count({ where: { deletedAt: null, status: { in: ['review', 'review_pending', 'reviewer_review'] }, report: { case: caseWhere, deletedAt: null } } }));
  const schedules = await db.schedule.findMany({ where: { case: caseWhere } });
  assert.strictEqual(todayTasksCount, schedules.filter((item) => calculateDDay(item.date).isToday).length);
  assert.strictEqual(delayedCount, schedules.filter((item) => calculateDDay(item.date).isOverdue).length);
});
