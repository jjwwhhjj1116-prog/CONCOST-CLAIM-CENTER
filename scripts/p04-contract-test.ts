import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.join(__dirname, '..');
const read = (relativePath: string): string => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('P04 real Prisma SQLite schema covers tenant, auth, case, report, and audit relations', () => {
  const schema = read('packages/database/prisma/schema.prisma');
  for (const model of ['Organization', 'User', 'Role', 'UserRole', 'Session', 'CaseItem', 'CaseAssignment', 'Report', 'ReportSection', 'AuditLog']) {
    assert.match(schema, new RegExp(`model\\s+${model}\\s+\\{`), `Missing model ${model}`);
  }
  assert.match(schema, /provider\s*=\s*"sqlite"/);
  assert.match(schema, /organizationId String/);
  assert.match(schema, /version\s+Int/);
  assert.match(schema, /deletedAt\s+DateTime\?/);
});

test('P04 migration enforces foreign keys and append-only AuditLog in the database', () => {
  const migration = read('packages/database/prisma/migrations/20260806070000_p04_baseline/migration.sql');
  assert.match(migration, /FOREIGN KEY/);
  assert.match(migration, /CREATE TRIGGER "AuditLog_prevent_update"/);
  assert.match(migration, /CREATE TRIGGER "AuditLog_prevent_delete"/);
  assert.match(migration, /RAISE\(ABORT, 'AuditLog is append-only/);
});

test('P04 rejects the former JSON/SQL-string database simulation', () => {
  const engine = read('packages/database/src/db-engine.ts');
  assert.doesNotMatch(engine, /MemoryDbConnection|harness-db\.json|trimmed\.startsWith\('UPDATE AuditLog'/);
  assert.match(engine, /PrismaClient/);
  assert.match(engine, /sql\.js/);
  assert.match(engine, /migration\.sql/);
});

test('P04 API contract keeps session tokens out of JSON and applies server-side tenant, CSRF, RBAC, and transactions', () => {
  const server = read('apps/api/src/server.ts');
  assert.doesNotMatch(server, /sendJson\([^\n]+token:\s*rawToken/);
  assert.match(server, /X-CSRF-Token/);
  assert.match(server, /timingSafeEqual/);
  assert.match(server, /organizationId !== context\.user\.organizationId/);
  assert.match(server, /Case assignment required/);
  assert.match(server, /Reviewer cannot edit report body/);
  assert.match(server, /\$transaction/);
});

test('P04 quality scripts preserve real browser E2E and use a separate security suite', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.match(packageJson.scripts['test:e2e'], /p0[356]-e2e\.ts/);
  assert.match(packageJson.scripts['test:security'], /p04-security-test\.ts/);
  assert.match(packageJson.scripts['test:security'], /p05-security-test\.ts/);
  assert.match(packageJson.scripts['test:security'], /p06-security-test\.ts/);
  assert.notStrictEqual(packageJson.scripts.test, packageJson.scripts['test:e2e']);
  assert.notStrictEqual(packageJson.scripts.test, packageJson.scripts['test:security']);
});
