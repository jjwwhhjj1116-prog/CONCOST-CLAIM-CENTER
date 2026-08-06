import test, { after, before } from 'node:test';
import assert from 'node:assert';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import initSqlJs from 'sql.js';
import { createApiServer, validateFileSecurity, type ManagedApiServer } from '../apps/api/src/server';
import { createPrismaClient, databaseUrlFor, migrateDatabase, resetDatabase, seedDatabase, type PrismaClient } from '../packages/database/src';

interface Result { status: number; body: Record<string, any>; headers: http.IncomingHttpHeaders }
interface Session { cookie: string; csrf: string }
const allowedOrigin = 'http://localhost:3000';
const databasePath = path.join(__dirname, '../packages/database/.data', `p06-security-${process.pid}.db`);
const uploadDir = path.join(__dirname, '../packages/database/.data', `p06-security-uploads-${process.pid}`);
const databaseUrl = databaseUrlFor(databasePath);
let db: PrismaClient;
let server: ManagedApiServer;
let origin: string;

function request(pathname: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}): Promise<Result> {
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

async function login(email: string): Promise<Session> {
  const response = await request('/auth/login', 'POST', { email, password: 'Password123!' }, { Origin: allowedOrigin });
  assert.strictEqual(response.status, 200);
  return {
    cookie: (response.headers['set-cookie'] ?? []).map((value) => value.split(';')[0]).join('; '),
    csrf: response.body.csrfToken
  };
}

const headersFor = (session: Session): Record<string, string> => ({ Cookie: session.cookie, Origin: allowedOrigin, 'X-CSRF-Token': session.csrf });
const pdf = (value: string): Buffer => Buffer.from(`%PDF-1.4\n${value}\n%%EOF`);
const payload = (title: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  title, source: 'RECEIVED', category: 'EVIDENCE', filename: `${title}.pdf`,
  fileBase64: pdf(title).toString('base64'), mimeType: 'application/pdf', ...extra
});

before(async () => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  db = createPrismaClient(databaseUrl);
  await db.schedule.create({ data: {
    id: 'P06-SEC-SCHED-CASE1', caseId: 'CASE-SYN-001', title: 'P06 security same-case schedule', type: 'INTERNAL',
    date: new Date('2026-08-08T00:00:00.000Z'), location: 'SYNTHETIC_ROOM', description: 'P06 security fixture'
  } });
  server = createApiServer({ databaseUrl, allowedOrigins: [allowedOrigin], secureCookies: true, uploadDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (server) await server.waitForDatabaseClose();
  if (db) await db.$disconnect();
  fs.rmSync(uploadDir, { recursive: true, force: true });
  for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
});

test('P06 upgrades a populated P05 database without losing P04/P05 rows', async () => {
  const upgradePath = path.join(__dirname, '../packages/database/.data', `p06-upgrade-${process.pid}.db`);
  const p04Name = '20260806070000_p04_baseline';
  const p05Name = '20260806080000_p05_case_management';
  const p04Sql = fs.readFileSync(path.join(__dirname, `../packages/database/prisma/migrations/${p04Name}/migration.sql`), 'utf8');
  const p05Sql = fs.readFileSync(path.join(__dirname, `../packages/database/prisma/migrations/${p05Name}/migration.sql`), 'utf8');
  const SQL = await initSqlJs({ locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`) });
  const sqlite = new SQL.Database();
  const now = new Date().toISOString();
  try {
    sqlite.run('PRAGMA foreign_keys = ON');
    sqlite.run('CREATE TABLE "_P04Migration" ("name" TEXT NOT NULL PRIMARY KEY, "checksum" TEXT NOT NULL, "appliedAt" TEXT NOT NULL)');
    sqlite.run(p04Sql);
    sqlite.run('INSERT INTO "_P04Migration" VALUES (?,?,?)', [p04Name, crypto.createHash('sha256').update(p04Sql).digest('hex'), now]);
    sqlite.run('INSERT INTO "Organization" ("id","name","createdAt","updatedAt") VALUES (?,?,?,?)', ['P06-UPGRADE-ORG', 'Synthetic P06 upgrade org', now, now]);
    sqlite.run('INSERT INTO "User" ("id","email","passwordHash","name","organizationId","isActive","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)', ['P06-UPGRADE-USER', 'p06-upgrade@example.invalid', 'synthetic', 'Synthetic P06 Upgrade User', 'P06-UPGRADE-ORG', 1, now, now]);
    sqlite.run('INSERT INTO "CaseItem" ("id","organizationId","title","claimType","version","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)', ['P06-UPGRADE-CASE', 'P06-UPGRADE-ORG', 'Synthetic preserved P05 case', 'TYPE-01', 1, now, now]);
    sqlite.run('INSERT INTO "CaseAssignment" ("caseId","userId") VALUES (?,?)', ['P06-UPGRADE-CASE', 'P06-UPGRADE-USER']);
    sqlite.run('INSERT INTO "Report" ("id","caseId","title","version","createdAt","updatedAt") VALUES (?,?,?,?,?,?)', ['P06-UPGRADE-REPORT', 'P06-UPGRADE-CASE', 'Synthetic preserved report', 1, now, now]);
    sqlite.run('INSERT INTO "ReportSection" ("id","reportId","title","content","status","version","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)', ['P06-UPGRADE-SECTION', 'P06-UPGRADE-REPORT', 'Facts', 'Preserved', 'draft', 1, now, now]);
    sqlite.run('INSERT INTO "AuditLog" ("id","organizationId","userId","action","targetEntity","targetId","metadataJson","createdAt") VALUES (?,?,?,?,?,?,?,?)', ['P06-UPGRADE-AUDIT', 'P06-UPGRADE-ORG', 'P06-UPGRADE-USER', 'SYNTHETIC', 'CaseItem', 'P06-UPGRADE-CASE', '{}', now]);
    sqlite.run(p05Sql);
    sqlite.run('INSERT INTO "_P04Migration" VALUES (?,?,?)', [p05Name, crypto.createHash('sha256').update(p05Sql).digest('hex'), now]);
    sqlite.run('INSERT INTO "Schedule" ("id","caseId","title","type","date","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)', ['P06-UPGRADE-SCHEDULE', 'P06-UPGRADE-CASE', 'Preserved deadline', 'INTERNAL', now, now, now]);
    sqlite.run('INSERT INTO "StatusHistory" ("id","caseId","fromStatus","toStatus","changedById","reason","createdAt") VALUES (?,?,?,?,?,?,?)', ['P06-UPGRADE-HISTORY', 'P06-UPGRADE-CASE', null, 'INQUIRY', 'P06-UPGRADE-USER', 'Preserved history', now]);
    fs.writeFileSync(upgradePath, Buffer.from(sqlite.export()));
  } finally { sqlite.close(); }

  await migrateDatabase(databaseUrlFor(upgradePath));
  const upgraded = createPrismaClient(databaseUrlFor(upgradePath));
  try {
    assert.ok(await upgraded.caseAssignment.findUnique({ where: { caseId_userId: { caseId: 'P06-UPGRADE-CASE', userId: 'P06-UPGRADE-USER' } } }));
    assert.ok(await upgraded.reportSection.findUnique({ where: { id: 'P06-UPGRADE-SECTION' } }));
    assert.ok(await upgraded.schedule.findUnique({ where: { id: 'P06-UPGRADE-SCHEDULE' } }));
    assert.ok(await upgraded.statusHistory.findUnique({ where: { id: 'P06-UPGRADE-HISTORY' } }));
    assert.ok(await upgraded.auditLog.findUnique({ where: { id: 'P06-UPGRADE-AUDIT' } }));
    await upgraded.document.create({ data: {
      id: 'P06-UPGRADE-DOCUMENT', caseId: 'P06-UPGRADE-CASE', scheduleId: 'P06-UPGRADE-SCHEDULE',
      reportSectionId: 'P06-UPGRADE-SECTION', title: 'P06 relation proof', category: 'EVIDENCE', source: 'RECEIVED'
    } });
    assert.ok(await upgraded.document.findUnique({ where: { id: 'P06-UPGRADE-DOCUMENT' } }));
  } finally {
    await upgraded.$disconnect();
    for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${upgradePath}${suffix}`, { force: true });
  }
});

test('P06 positive and negative signature policy is exact and rejects disguised executable content', () => {
  assert.deepStrictEqual(validateFileSecurity('safe.pdf', 'application/pdf', pdf('SAFE')).extension, '.pdf');
  assert.deepStrictEqual(validateFileSecurity('safe.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).extension, '.png');
  assert.deepStrictEqual(validateFileSecurity('safe.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00])).extension, '.jpg');
  assert.deepStrictEqual(validateFileSecurity('safe.txt', 'text/plain', Buffer.from('synthetic UTF-8 text')).extension, '.txt');
  assert.throws(() => validateFileSecurity('payload.exe.pdf', 'application/pdf', pdf('MZ')));
  assert.throws(() => validateFileSecurity('payload.pdf', 'application/pdf', Buffer.from('MZ executable')));
  assert.throws(() => validateFileSecurity('payload.hwp', 'application/x-hwp', Buffer.from('not OLE')));
});

test('P06 upload requires trusted origin, CSRF token and editor role before storing bytes', async () => {
  const pm = await login('pm@example.invalid');
  const staff = await login('staff@example.invalid');
  const before = fs.readdirSync(uploadDir).length;
  assert.strictEqual((await request('/api/cases/CASE-SYN-001/documents', 'POST', payload('NO_ORIGIN'), { Cookie: pm.cookie, 'X-CSRF-Token': pm.csrf })).status, 403);
  assert.strictEqual((await request('/api/cases/CASE-SYN-001/documents', 'POST', payload('NO_CSRF'), { Cookie: pm.cookie, Origin: allowedOrigin })).status, 403);
  assert.strictEqual((await request('/api/cases/CASE-SYN-001/documents', 'POST', payload('STAFF_BLOCKED'), headersFor(staff))).status, 403);
  assert.strictEqual(fs.readdirSync(uploadDir).length, before);
});

test('P06 API rejects cross-case schedule/report links and cross-organization meeting actors', async () => {
  const pm = await login('pm@example.invalid');
  const headers = headersFor(pm);
  assert.strictEqual((await request('/api/cases/CASE-SYN-001/documents', 'POST', payload('CROSS_SCHEDULE', { scheduleId: 'SCHED-SYN-001' }), headers)).status, 400);
  assert.strictEqual((await request('/api/cases/CASE-SYN-004/documents', 'POST', payload('CROSS_SECTION', { reportSectionId: 'SEC-SYN-001' }), headers)).status, 400);
  const meeting = await request('/api/cases/CASE-SYN-001/meetings', 'POST', {
    title: 'P06_SECURITY_MEETING', meetingDate: '2026-08-06T01:00:00.000Z'
  }, headers);
  assert.strictEqual(meeting.status, 201);
  assert.strictEqual((await request(`/api/cases/CASE-SYN-001/meetings/${meeting.body.meeting.id}/action-items`, 'POST', {
    title: 'Cross tenant actor', assigneeId: 'USR-ORGB-PM'
  }, headers)).status, 403);
  assert.strictEqual((await request(`/api/cases/CASE-SYN-001/meetings/${meeting.body.meeting.id}/action-items`, 'POST', {
    title: 'Cross case schedule', scheduleId: 'SCHED-SYN-001'
  }, headers)).status, 403);
});

test('P06 storage keys and final document rows cannot be redirected, duplicated or altered in the database', async () => {
  await assert.rejects(db.documentVersion.update({ where: { id: 'DOCVER-SYN-001' }, data: { storageKey: '../escape.pdf' } }));
  await assert.rejects(db.documentVersion.update({ where: { id: 'DOCVER-SYN-001' }, data: { isFinal: true } }));
  await assert.rejects(db.documentVersion.update({ where: { id: 'DOCVER-SYN-002' }, data: { sha256: 'd'.repeat(64) } }));
  assert.strictEqual((await db.documentVersion.findUniqueOrThrow({ where: { id: 'DOCVER-SYN-002' } })).sha256, 'b'.repeat(64));
  const finalDoc = await db.document.findUniqueOrThrow({ where: { id: 'DOC-SYN-001' } });
  assert.strictEqual(finalDoc.finalVersionId, 'DOCVER-SYN-002');
});

test('P06 finalized meetings freeze parent, original transcript and every child mutation path', async () => {
  await assert.rejects(db.meeting.update({ where: { id: 'MEET-SYN-002' }, data: { summary: 'tamper' } }), /Finalized meeting/i);
  await assert.rejects(db.meeting.delete({ where: { id: 'MEET-SYN-002' } }), /Finalized meeting/i);
  await assert.rejects(db.meetingActionItem.create({ data: { id: 'P06-FINAL-CHILD', meetingId: 'MEET-SYN-002', title: 'tamper' } }));
  assert.strictEqual(await db.meetingActionItem.count({ where: { id: 'P06-FINAL-CHILD' } }), 0);
  await assert.rejects(db.meeting.update({ where: { id: 'MEET-SYN-001' }, data: { rawText: 'tamper' } }));
  assert.strictEqual((await db.meeting.findUniqueOrThrow({ where: { id: 'MEET-SYN-001' } })).rawText, 'Synthetic meeting raw transcript text');
});
