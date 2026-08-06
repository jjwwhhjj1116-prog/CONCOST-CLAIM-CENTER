import test, { after, before } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import {
  createPrismaClient, databaseUrlFor, hashToken, resetDatabase, seedDatabase, type PrismaClient
} from '../packages/database/src';

interface HttpResult {
  status: number;
  body: Record<string, any>;
  headers: http.IncomingHttpHeaders;
}

const allowedOrigin = 'http://localhost:3000';
const databasePath = path.join(__dirname, '../packages/database/.data', `p04-security-${process.pid}.db`);
const databaseUrl = databaseUrlFor(databasePath);
let db: PrismaClient;
let server: ManagedApiServer;
let origin: string;

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
  const first = createPrismaClient(databaseUrl);
  const firstSnapshot = await Promise.all([
    first.role.findMany({ orderBy: { id: 'asc' } }),
    first.user.findMany({ select: { id: true, email: true, passwordHash: true, organizationId: true }, orderBy: { id: 'asc' } }),
    first.caseItem.findMany({ select: { id: true, organizationId: true, title: true, claimType: true, version: true, deletedAt: true }, orderBy: { id: 'asc' } }),
    first.auditLog.findMany({ orderBy: { id: 'asc' } })
  ]);
  await first.$disconnect();

  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const second = createPrismaClient(databaseUrl);
  const secondSnapshot = await Promise.all([
    second.role.findMany({ orderBy: { id: 'asc' } }),
    second.user.findMany({ select: { id: true, email: true, passwordHash: true, organizationId: true }, orderBy: { id: 'asc' } }),
    second.caseItem.findMany({ select: { id: true, organizationId: true, title: true, claimType: true, version: true, deletedAt: true }, orderBy: { id: 'asc' } }),
    second.auditLog.findMany({ orderBy: { id: 'asc' } })
  ]);
  await second.$disconnect();
  assert.deepStrictEqual(secondSnapshot, firstSnapshot, 'reset+migrate+seed must be deterministic');

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

test('P04 uses a real SQLite file, six fixed roles, and enforced foreign keys', async () => {
  assert.strictEqual(fs.readFileSync(databasePath).subarray(0, 16).toString('utf8'), 'SQLite format 3\u0000');
  const roles = (await db.role.findMany({ orderBy: { id: 'asc' } })).map((role) => role.id);
  assert.deepStrictEqual(roles, ['admin', 'ceo', 'director', 'pm', 'reviewer', 'staff']);
  await assert.rejects(db.$executeRawUnsafe('INSERT INTO "Role" ("id","name") VALUES (?,?)', 'TYPE-07', 'INVALID'), /check constraint/i);
  await assert.rejects(
    db.$executeRawUnsafe(
      'INSERT INTO "CaseItem" ("id","organizationId","caseNumber","title","claimType","version","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)',
      'CASE-BAD-FK', 'ORG-NOT-FOUND', 'CASE-BAD-FK', 'Invalid', 'TYPE-01', 1, new Date().toISOString(), new Date().toISOString()
    ),
    /foreign key constraint/i
  );
});

test('P04 database triggers reject AuditLog mutation through Prisma and raw SQL', async () => {
  const audit = await db.auditLog.findFirstOrThrow();
  await assert.rejects(db.auditLog.update({ where: { id: audit.id }, data: { action: 'TAMPERED' } }), /append-only|constraint/i);
  await assert.rejects(db.auditLog.delete({ where: { id: audit.id } }), /append-only|constraint/i);
  await assert.rejects(db.$executeRawUnsafe('UPDATE "AuditLog" SET "action" = ? WHERE "id" = ?', 'TAMPERED', audit.id), /append-only|constraint/i);
  await assert.rejects(db.$executeRawUnsafe('DELETE FROM "AuditLog" WHERE "id" = ?', audit.id), /append-only|constraint/i);
});

test('P04 authentication stores only token hashes and issues hardened cookies without exposing the session token in JSON', async () => {
  const denied = await request('/auth/login', 'POST', { email: 'pm@example.invalid', password: 'wrong' }, { Origin: allowedOrigin });
  assert.strictEqual(denied.status, 401);

  const pm = await login('pm@example.invalid');
  const setCookies = pm.response.headers['set-cookie'] ?? [];
  assert.match(setCookies[0], /HttpOnly/);
  assert.match(setCookies[0], /SameSite=Strict/);
  assert.match(setCookies[0], /Secure/);
  assert.strictEqual(pm.response.body.token, undefined);

  const rawSessionToken = /session_token=([^;]+)/.exec(setCookies[0])?.[1] ?? '';
  assert.strictEqual(await db.session.findUnique({ where: { tokenHash: rawSessionToken } }), null, 'raw token must not be stored');
  assert.ok(await db.session.findUnique({ where: { tokenHash: hashToken(rawSessionToken) } }), 'token hash missing');
  const session = await request('/auth/session', 'GET', undefined, { Cookie: pm.cookie });
  assert.strictEqual(session.status, 200);
  assert.deepStrictEqual(session.body.roles, ['pm']);
});

test('P04 CORS Origin and double-submit CSRF defenses reject hostile or incomplete mutations', async () => {
  const hostile = await request('/auth/login', 'POST', { email: 'pm@example.invalid', password: 'Password123!' }, { Origin: 'https://evil.invalid' });
  assert.strictEqual(hostile.status, 403);
  const pm = await login('pm@example.invalid');
  const missingOrigin = await request('/api/cases/CASE-SYN-001', 'PATCH', { title: 'CSRF', version: 1 }, { Cookie: pm.cookie });
  assert.strictEqual(missingOrigin.status, 403);
  const badCsrf = await request('/api/cases/CASE-SYN-001', 'PATCH', { title: 'CSRF', version: 1 }, { Cookie: pm.cookie, Origin: allowedOrigin, 'X-CSRF-Token': 'bad' });
  assert.strictEqual(badCsrf.status, 403);
});

test('P04 IDOR, organization isolation, assignment, and soft-delete filters are server enforced', async () => {
  const pm = await login('pm@example.invalid');
  assert.strictEqual((await request('/api/cases/CASE-SYN-ORGB', 'GET', undefined, { Cookie: pm.cookie })).status, 403);
  assert.strictEqual((await request('/api/cases/CASE-SYN-003', 'GET', undefined, { Cookie: pm.cookie })).status, 403);
  assert.strictEqual((await request('/api/cases/CASE-SYN-002', 'GET', undefined, { Cookie: pm.cookie })).status, 404);
  assert.strictEqual((await request('/api/cases/CASE-SYN-001', 'GET', undefined, { Cookie: pm.cookie })).status, 200);
});

test('P04 Reviewer permissions are checked against real report ownership and persisted actions', async () => {
  const reviewer = await login('reviewer@example.invalid');
  const headers = mutationHeaders(reviewer);
  assert.strictEqual((await request('/api/reports/REPO-SYN-001/sections/SEC-SYN-001/body', 'PATCH', { content: 'tamper', version: 1 }, headers)).status, 403);
  assert.strictEqual((await request('/api/reports/REPO-SYN-001/merge', 'POST', {}, headers)).status, 403);
  assert.strictEqual((await request('/api/reports/REPO-SYN-001/sections/SEC-SYN-001/approve', 'POST', {}, headers)).status, 200);
  assert.strictEqual((await db.reportSection.findUniqueOrThrow({ where: { id: 'SEC-SYN-001' } })).status, 'approved');
  assert.strictEqual((await request('/api/reports/REPO-NOT-FOUND/sections/SEC-SYN-001/approve', 'POST', {}, headers)).status, 404);
});

test('P04 case mutation and audit insertion share one rollback boundary', async () => {
  const pm = await login('pm@example.invalid');
  await db.$executeRawUnsafe(`
    CREATE TRIGGER "P04_force_audit_failure"
    BEFORE INSERT ON "AuditLog" WHEN NEW."action" = 'CASE_UPDATED'
    BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END
  `);
  const failed = await request('/api/cases/CASE-SYN-001', 'PATCH', { title: 'MUST_ROLL_BACK', version: 1 }, mutationHeaders(pm));
  assert.strictEqual(failed.status, 500);
  const caseRow = await db.caseItem.findUniqueOrThrow({ where: { id: 'CASE-SYN-001' } });
  assert.strictEqual(caseRow.title, 'SYNTHETIC_CASE_01');
  assert.strictEqual(caseRow.version, 1);
  await db.$executeRawUnsafe('DROP TRIGGER "P04_force_audit_failure"');
});

test('P04 optimistic locking returns 409 and records only successful updates', async () => {
  const pm = await login('pm@example.invalid');
  const headers = mutationHeaders(pm);
  assert.strictEqual((await request('/api/cases/CASE-SYN-001', 'PATCH', { title: 'stale', version: 999 }, headers)).status, 409);
  assert.strictEqual((await request('/api/cases/CASE-SYN-001', 'PATCH', { title: 'updated', version: 1 }, headers)).status, 200);
  assert.strictEqual((await request('/api/cases/CASE-SYN-001', 'PATCH', { title: 'stale-again', version: 1 }, headers)).status, 409);
  const caseRow = await db.caseItem.findUniqueOrThrow({ where: { id: 'CASE-SYN-001' } });
  assert.deepStrictEqual({ title: caseRow.title, version: caseRow.version }, { title: 'updated', version: 2 });
  assert.strictEqual(await db.auditLog.count({ where: { action: 'CASE_UPDATED', targetId: 'CASE-SYN-001' } }), 1);
});

test('P04 admin role endpoint rejects TYPE-07 and cross-organization targets', async () => {
  const admin = await login('admin@example.invalid');
  const headers = mutationHeaders(admin);
  assert.strictEqual((await request('/api/admin/roles', 'POST', { targetUserId: 'USR-PM', roleId: 'TYPE-07' }, headers)).status, 400);
  assert.strictEqual((await request('/api/admin/roles', 'POST', { targetUserId: 'USR-ORGB-PM', roleId: 'reviewer' }, headers)).status, 403);
});
