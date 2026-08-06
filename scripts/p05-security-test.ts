import test, { after, before } from 'node:test';
import assert from 'node:assert';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import initSqlJs from 'sql.js';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { createPrismaClient, databaseUrlFor, migrateDatabase, resetDatabase, seedDatabase, type PrismaClient } from '../packages/database/src';

interface HttpResult { status: number; body: Record<string, any>; headers: http.IncomingHttpHeaders }
const allowedOrigin = 'http://localhost:3000';
const databasePath = path.join(__dirname, '../packages/database/.data', `p05-security-${process.pid}.db`);
const databaseUrl = databaseUrlFor(databasePath);
let db: PrismaClient;
let server: ManagedApiServer;
let origin: string;

function request(pathname: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request(`${origin}${pathname}`, {
      method,
      headers: { ...headers, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {}) }
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

async function login(email: string): Promise<{ cookie: string; csrf: string }> {
  const response = await request('/auth/login', 'POST', { email, password: 'Password123!' }, { Origin: allowedOrigin });
  assert.strictEqual(response.status, 200);
  const setCookies = response.headers['set-cookie'] ?? [];
  return { cookie: setCookies.map((value) => value.split(';')[0]).join('; '), csrf: response.body.csrfToken };
}

const mutationHeaders = (session: { cookie: string; csrf: string }) => ({ Cookie: session.cookie, Origin: allowedOrigin, 'X-CSRF-Token': session.csrf });

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

test('P05 upgrades a populated P04 database without losing assignments, reports, sections, or audit rows', async () => {
  const upgradePath = path.join(__dirname, '../packages/database/.data', `p05-upgrade-${process.pid}.db`);
  const upgradeUrl = databaseUrlFor(upgradePath);
  const p04Name = '20260806070000_p04_baseline';
  const p04Sql = fs.readFileSync(path.join(__dirname, `../packages/database/prisma/migrations/${p04Name}/migration.sql`), 'utf8');
  const checksum = crypto.createHash('sha256').update(p04Sql).digest('hex');
  const SQL = await initSqlJs({ locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`) });
  const sqlite = new SQL.Database();
  const now = new Date().toISOString();
  try {
    sqlite.run('PRAGMA foreign_keys = ON');
    sqlite.run('CREATE TABLE "_P04Migration" ("name" TEXT NOT NULL PRIMARY KEY, "checksum" TEXT NOT NULL, "appliedAt" TEXT NOT NULL)');
    sqlite.run(p04Sql);
    sqlite.run('INSERT INTO "_P04Migration" VALUES (?,?,?)', [p04Name, checksum, now]);
    sqlite.run('INSERT INTO "Organization" ("id","name","createdAt","updatedAt") VALUES (?,?,?,?)', ['UPGRADE-ORG', 'Synthetic upgrade org', now, now]);
    sqlite.run('INSERT INTO "User" ("id","email","passwordHash","name","organizationId","isActive","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)', ['UPGRADE-USER', 'upgrade@example.invalid', 'synthetic', 'Synthetic Upgrade User', 'UPGRADE-ORG', 1, now, now]);
    sqlite.run('INSERT INTO "CaseItem" ("id","organizationId","title","claimType","version","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)', ['UPGRADE-CASE', 'UPGRADE-ORG', 'Synthetic preserved case', 'TYPE-01', 1, now, now]);
    sqlite.run('INSERT INTO "CaseAssignment" ("caseId","userId") VALUES (?,?)', ['UPGRADE-CASE', 'UPGRADE-USER']);
    sqlite.run('INSERT INTO "Report" ("id","caseId","title","version","createdAt","updatedAt") VALUES (?,?,?,?,?,?)', ['UPGRADE-REPORT', 'UPGRADE-CASE', 'Synthetic report', 1, now, now]);
    sqlite.run('INSERT INTO "ReportSection" ("id","reportId","title","content","status","version","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)', ['UPGRADE-SECTION', 'UPGRADE-REPORT', 'Facts', 'Synthetic', 'draft', 1, now, now]);
    sqlite.run('INSERT INTO "AuditLog" ("id","organizationId","userId","action","targetEntity","targetId","metadataJson","createdAt") VALUES (?,?,?,?,?,?,?,?)', ['UPGRADE-AUDIT', 'UPGRADE-ORG', 'UPGRADE-USER', 'SYNTHETIC', 'CaseItem', 'UPGRADE-CASE', '{}', now]);
    fs.writeFileSync(upgradePath, Buffer.from(sqlite.export()));
  } finally { sqlite.close(); }

  await migrateDatabase(upgradeUrl);
  const upgraded = createPrismaClient(upgradeUrl);
  try {
    assert.ok(await upgraded.caseAssignment.findUnique({ where: { caseId_userId: { caseId: 'UPGRADE-CASE', userId: 'UPGRADE-USER' } } }));
    assert.ok(await upgraded.report.findUnique({ where: { id: 'UPGRADE-REPORT' } }));
    assert.ok(await upgraded.reportSection.findUnique({ where: { id: 'UPGRADE-SECTION' } }));
    assert.ok(await upgraded.auditLog.findUnique({ where: { id: 'UPGRADE-AUDIT' } }));
    const upgradedCase = await upgraded.caseItem.findUniqueOrThrow({ where: { id: 'UPGRADE-CASE' } });
    assert.strictEqual(upgradedCase.caseNumber, 'UPGRADE-CASE');
    assert.strictEqual(upgradedCase.status, 'INQUIRY');
  } finally {
    await upgraded.$disconnect();
    for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${upgradePath}${suffix}`, { force: true });
  }
});

test('P05 StatusHistory is append-only through Prisma and raw SQL', async () => {
  await assert.rejects(db.statusHistory.update({ where: { id: 'STHIST-SYN-001' }, data: { reason: 'tamper' } }), /append-only/i);
  await assert.rejects(db.$executeRawUnsafe('DELETE FROM "StatusHistory" WHERE "id" = ?', 'STHIST-SYN-001'), /append-only/i);
});

test('P05 database rejects invalid states and cross-organization assignments', async () => {
  await assert.rejects(db.caseItem.update({ where: { id: 'CASE-SYN-001' }, data: { status: 'REGISTERED' } }));
  await assert.rejects(db.caseAssignment.create({ data: { caseId: 'CASE-SYN-001', userId: 'USR-ORGB-PM' } }));
  await assert.rejects(db.caseItem.update({ where: { id: 'CASE-SYN-001' }, data: { assignedUserId: 'USR-ORGB-PM' } }));
  const caseRow = await db.caseItem.findUniqueOrThrow({ where: { id: 'CASE-SYN-001' } });
  assert.strictEqual(caseRow.status, 'INQUIRY');
  assert.strictEqual(caseRow.assignedUserId, 'USR-PM');
  assert.strictEqual(await db.caseAssignment.count({ where: { caseId: 'CASE-SYN-001', userId: 'USR-ORGB-PM' } }), 0);
});

test('P05 product RBAC rejects Staff/Reviewer edits and PM deletion over direct API calls', async () => {
  const staff = await login('staff@example.invalid');
  const reviewer = await login('reviewer@example.invalid');
  const pm = await login('pm@example.invalid');
  assert.strictEqual((await request('/api/cases', 'POST', { title: 'Forbidden', claimType: 'TYPE-01', category: { major: 'A', middle: 'B', minor: 'C' } }, mutationHeaders(staff))).status, 403);
  assert.strictEqual((await request('/api/cases/CASE-SYN-001', 'PATCH', { title: 'Forbidden', version: 1 }, mutationHeaders(staff))).status, 403);
  assert.strictEqual((await request('/api/cases/CASE-SYN-001/status', 'POST', { toStatus: 'PROPOSAL', version: 1 }, mutationHeaders(reviewer))).status, 403);
  assert.strictEqual((await request('/api/cases/CASE-SYN-001', 'DELETE', { version: 1 }, mutationHeaders(pm))).status, 403);
});

test('P05 subresource IDOR cannot swap a party or schedule from another case', async () => {
  const pm = await login('pm@example.invalid');
  const headers = mutationHeaders(pm);
  assert.strictEqual((await request('/api/cases/CASE-SYN-001/parties/PARTY-SYN-001', 'PATCH', { name: 'IDOR' }, headers)).status, 404);
  assert.strictEqual((await request('/api/cases/CASE-SYN-001/schedules/SCHED-SYN-001', 'DELETE', undefined, headers)).status, 404);
});

test('P05 party mutation rolls back when its audit insert is forced to fail', async () => {
  const pm = await login('pm@example.invalid');
  await db.$executeRawUnsafe(`CREATE TRIGGER "P05_force_audit_failure" BEFORE INSERT ON "AuditLog" WHEN NEW."action" = 'PARTY_ADDED' BEGIN SELECT RAISE(ABORT, 'forced P05 audit failure'); END`);
  const beforeCount = await db.party.count({ where: { caseId: 'CASE-SYN-001' } });
  const response = await request('/api/cases/CASE-SYN-001/parties', 'POST', { name: 'MUST_ROLL_BACK', role: 'OTHER' }, mutationHeaders(pm));
  assert.strictEqual(response.status, 500);
  assert.strictEqual(await db.party.count({ where: { caseId: 'CASE-SYN-001' } }), beforeCount);
  await db.$executeRawUnsafe('DROP TRIGGER "P05_force_audit_failure"');
});

test('P05 status transition rejects a stale version without appending history', async () => {
  const pm = await login('pm@example.invalid');
  const beforeCount = await db.statusHistory.count({ where: { caseId: 'CASE-SYN-001' } });
  const response = await request('/api/cases/CASE-SYN-001/status', 'POST', { toStatus: 'PROPOSAL', version: 999 }, mutationHeaders(pm));
  assert.strictEqual(response.status, 409);
  assert.strictEqual(await db.statusHistory.count({ where: { caseId: 'CASE-SYN-001' } }), beforeCount);
});
