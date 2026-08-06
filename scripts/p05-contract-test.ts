import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CASE_STATUSES } from '../apps/api/src/server';

const root = path.join(__dirname, '..');
const read = (relativePath: string): string => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('P05 uses the exact 12-state product lifecycle without legacy shortcut states', () => {
  assert.deepStrictEqual(CASE_STATUSES, [
    'INQUIRY', 'PROPOSAL', 'ESTIMATE', 'CONTRACT', 'MATERIAL_RECEIVED', 'ANALYSIS',
    'REPORT_DRAFTING', 'SUBMITTED', 'LITIGATION', 'JUDGEMENT', 'SUCCESS_FEE', 'CLOSED'
  ]);
  const server = read('apps/api/src/server.ts');
  assert.doesNotMatch(server, /REGISTERED|\bREVIEWING\b|\bIN_PROGRESS\b/);
});

test('P05 migration preserves P04 relations and adds DB-enforced history and tenant constraints', () => {
  const migration = read('packages/database/prisma/migrations/20260806080000_p05_case_management/migration.sql');
  assert.doesNotMatch(migration, /DROP TABLE "CaseItem"/);
  assert.match(migration, /ALTER TABLE "CaseItem" ADD COLUMN "caseNumber"/);
  assert.match(migration, /CREATE TABLE "CaseCategory"/);
  assert.match(migration, /CaseAssignment_same_org_insert/);
  assert.match(migration, /StatusHistory_prevent_update/);
  assert.match(migration, /StatusHistory_prevent_delete/);
});

test('P05 server enforces the product RBAC matrix and atomic mutation boundaries', () => {
  const server = read('apps/api/src/server.ts');
  assert.match(server, /CASE_EDITOR_ROLES = new Set\(\['ceo', 'director', 'pm', 'admin'\]\)/);
  assert.match(server, /CASE_DELETE_ROLES = new Set\(\['ceo', 'director', 'admin'\]\)/);
  assert.match(server, /Case creation forbidden/);
  assert.match(server, /Case deletion forbidden/);
  assert.match(server, /Case status modification forbidden/);
  assert.match(server, /\$transaction/);
});

test('P05 web binds to the real session and API instead of a synthetic role switch', () => {
  const app = read('apps/web/src/App.tsx');
  const caseUi = read('apps/web/src/case-management/CaseManagement.tsx');
  assert.match(app, /apiRequest<SessionUser>\('\/auth\/session'\)/);
  assert.match(app, /apiRequest\('\/auth\/login'/);
  assert.doesNotMatch(app, /P03 합성 세션|setUserRole|테스트 세션으로 로그인/);
  for (const endpoint of ['/api/dashboard/kpi', '/api/cases', '/parties', '/schedules', '/status']) assert.ok(caseUi.includes(endpoint));
  for (const category of ['대분류', '중분류', '소분류']) assert.ok(caseUi.includes(category));
});

test('P05 has distinct real browser and security suites while retaining P04 attacks', () => {
  const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  assert.strictEqual(packageJson.scripts['test:e2e'], 'tsx scripts/p05-e2e.ts');
  assert.match(packageJson.scripts['test:security'], /p04-security-test\.ts/);
  assert.match(packageJson.scripts['test:security'], /p05-security-test\.ts/);
  const e2e = read('scripts/p05-e2e.ts');
  for (const marker of ['P05_BROWSER_SYNTHETIC_CASE', '관계자 추가', '기일 추가', '다음 단계로 이동', '200% zoom']) assert.ok(e2e.includes(marker));
});
