import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const STAFF_ID = '00000000-0000-4000-8000-000000000002';
const ADMIN_TOKEN = 'cf06-admin-session-token';
const STAFF_TOKEN = 'cf06-staff-session-token';

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

class SqlStatement {
  private values: unknown[] = [];
  constructor(private readonly database: Database, private readonly sql: string) {}
  bind(...values: unknown[]): SqlStatement { this.values = values; return this; }
  async first<T>(): Promise<T | null> {
    const statement = this.database.prepare(this.sql);
    try {
      statement.bind(this.values as any[]);
      return statement.step() ? statement.getAsObject() as T : null;
    } finally { statement.free(); }
  }
  async all<T>(): Promise<{ results: T[] }> {
    const statement = this.database.prepare(this.sql);
    const results: T[] = [];
    try {
      statement.bind(this.values as any[]);
      while (statement.step()) results.push(statement.getAsObject() as T);
      return { results };
    } finally { statement.free(); }
  }
  async run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }> {
    this.database.run(this.sql, this.values as any[]);
    const row = this.database.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0];
    return { success: true, meta: { changes: this.database.getRowsModified(), last_row_id: Number(row ?? 0) } };
  }
}

class SqlD1 {
  constructor(readonly database: Database) {}
  prepare(sql: string): SqlStatement { return new SqlStatement(this.database, sql); }
  async batch(statements: SqlStatement[]): Promise<unknown[]> {
    this.database.run('BEGIN IMMEDIATE');
    try {
      const results: unknown[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.run('COMMIT');
      return results;
    } catch (error) {
      this.database.run('ROLLBACK');
      throw error;
    }
  }
}

async function seededDatabase(): Promise<{ sql: Database; env: CloudflareEnv }> {
  const SQL = await initSqlJs();
  const sql = new SQL.Database();
  sql.run('PRAGMA foreign_keys = ON');
  const migration = (name: string) => readFileSync(join(process.cwd(), 'apps', 'cloudflare', 'migrations', name), 'utf8');
  for (const name of [
    '0001_cf_foundation.sql', '0001_cf02_preview_drafts.sql', '0002_cf03_preview_evidence.sql',
    '0003_cf04_preview_auth.sql', '0004_cf05_google_drive.sql', '0005_cf06_case_operations.sql'
  ]) sql.exec(migration(name));
  const now = new Date().toISOString();
  const insertUser = (id: string, loginId: string, roles: string) => sql.run(
    'INSERT INTO preview_users VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)',
    [id, loginId, '1'.repeat(32), '2'.repeat(64), 100000, loginId, `${loginId}@example.invalid`, roles, now]
  );
  insertUser(ADMIN_ID, 'admin', '["admin"]');
  insertUser(STAFF_ID, 'staff', '["staff"]');
  sql.run('INSERT INTO preview_sessions VALUES (?, ?, ?, ?)', [await sha256(ADMIN_TOKEN), ADMIN_ID, now, new Date(Date.now() + 3_600_000).toISOString()]);
  sql.run('INSERT INTO preview_sessions VALUES (?, ?, ?, ?)', [await sha256(STAFF_TOKEN), STAFF_ID, now, new Date(Date.now() + 3_600_000).toISOString()]);
  return { sql, env: { DB: new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']> } };
}

function request(path: string, token: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('X-Session-Token', token);
  if (init.body) headers.set('Content-Type', 'application/json');
  return new Request(`https://preview.example${path}`, { ...init, headers });
}

test('CF06 D1 case workflow persists case, party, schedule, status, and dashboard data', async () => {
  const { sql, env } = await seededDatabase();
  const caseKey = 'cf06-case-create-0001';
  const payload = { title: '공사비 적정성 검토', claimType: 'TYPE-02', description: 'D1 영구 저장 사건', category: { major: '건설', middle: '공사비', minor: '적정성' } };
  const created = await worker.fetch(request('/api/cases', ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': caseKey }, body: JSON.stringify(payload) }), env);
  assert.equal(created.status, 201);
  const createdBody = await created.json() as { case: { id: string; caseNumber: string; version: number } };
  assert.match(createdBody.case.caseNumber, /^CC-\d{4}-00001$/u);
  assert.equal(createdBody.case.version, 1);

  const replay = await worker.fetch(request('/api/cases', ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': caseKey }, body: JSON.stringify(payload) }), env);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json() as { case: { id: string } }).case.id, createdBody.case.id);
  const mismatched = await worker.fetch(request('/api/cases', ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': caseKey }, body: JSON.stringify({ ...payload, title: '다른 사건' }) }), env);
  assert.equal(mismatched.status, 409);

  const party = await worker.fetch(request(`/api/cases/${createdBody.case.id}/parties`, ADMIN_TOKEN, { method: 'POST', body: JSON.stringify({ name: '발주처 담당자', role: 'CLIENT' }) }), env);
  assert.equal(party.status, 200);
  const schedule = await worker.fetch(request(`/api/cases/${createdBody.case.id}/schedules`, ADMIN_TOKEN, { method: 'POST', body: JSON.stringify({ title: '착수회의', type: 'CLIENT', date: '2030-01-02T01:00:00.000Z', location: '본사 회의실' }) }), env);
  assert.equal(schedule.status, 200);
  const advanced = await worker.fetch(request(`/api/cases/${createdBody.case.id}/status`, ADMIN_TOKEN, { method: 'POST', body: JSON.stringify({ toStatus: 'PROPOSAL', reason: '제안 단계 착수', version: 1 }) }), env);
  assert.equal(advanced.status, 200);
  const detail = await advanced.json() as { case: { status: string; version: number; parties: unknown[]; schedules: unknown[]; activityTimeline: unknown[] } };
  assert.equal(detail.case.status, 'PROPOSAL');
  assert.equal(detail.case.version, 2);
  assert.equal(detail.case.parties.length, 1);
  assert.equal(detail.case.schedules.length, 1);
  assert.equal(detail.case.activityTimeline.length, 4);

  const dashboard = await worker.fetch(request('/api/dashboard/kpi', ADMIN_TOKEN), env);
  assert.equal(dashboard.status, 200);
  const kpi = await dashboard.json() as { totalCases: number; inProgressCount: number; recentCases: unknown[]; upcomingSchedules: unknown[] };
  assert.deepEqual({ total: kpi.totalCases, active: kpi.inProgressCount, recent: kpi.recentCases.length, schedules: kpi.upcomingSchedules.length }, { total: 1, active: 1, recent: 1, schedules: 1 });

  const exported = sql.export();
  const SQL = await initSqlJs();
  const restarted = new SQL.Database(exported);
  assert.equal(restarted.exec('SELECT count(*) FROM preview_cases')[0].values[0][0], 1);
  assert.equal(restarted.exec('SELECT count(*) FROM preview_case_activities')[0].values[0][0], 4);
  restarted.close();
  sql.close();
});

test('CF06 shares intake work with members while preserving strict types, append-only history, and optimistic versions', async () => {
  const { sql, env } = await seededDatabase();
  const payload = { title: '현장 수량산출', claimType: 'TYPE-01', description: '', category: { major: '건설', middle: '현장', minor: '수량' } };
  const created = await worker.fetch(request('/api/cases', ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf06-security-case-1' }, body: JSON.stringify(payload) }), env);
  const id = (await created.json() as { case: { id: string } }).case.id;

  assert.equal((await worker.fetch(request(`/api/cases/${id}`, STAFF_TOKEN), env)).status, 200);
  assert.equal((await worker.fetch(request('/api/cases', STAFF_TOKEN, { method: 'POST', body: JSON.stringify(payload) }), env)).status, 201);
  const stale = await worker.fetch(request(`/api/cases/${id}/status`, ADMIN_TOKEN, { method: 'POST', body: JSON.stringify({ toStatus: 'PROPOSAL', reason: 'stale', version: 99 }) }), env);
  assert.equal(stale.status, 409);
  const badType = await worker.fetch(request('/api/cases', ADMIN_TOKEN, { method: 'POST', body: JSON.stringify({ ...payload, claimType: 'TYPE-07' }) }), env);
  assert.equal(badType.status, 400);

  assert.throws(() => sql.run("UPDATE preview_cases SET title='forged', updated_at=? WHERE id=?", [new Date(Date.now() + 1_000).toISOString(), id]), /optimistic version is invalid/u);
  assert.throws(() => sql.run('DELETE FROM preview_cases WHERE id=?', [id]), /cannot be physically deleted/u);
  assert.throws(() => sql.run("UPDATE preview_case_activities SET title='forged' WHERE case_id=?", [id]), /append-only/u);
  sql.close();
});

test('CF06 UI routes use live CaseManagement while Google Drive remains explicitly deferred', () => {
  const router = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'routes', 'Router.tsx'), 'utf8');
  const shell = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'layout', 'AppShell.tsx'), 'utf8');
  const phase = JSON.parse(readFileSync(join(process.cwd(), 'docs', 'harness', 'phase-status.json'), 'utf8')) as { currentPhase: string; phases: Record<string, { status: string }> };
  assert.match(router, /previewMode && \['DASH-01', 'CASE-01', 'CASE-02', 'CASE-03', 'CASE-04', 'CASE-05'\]\.includes/u);
  assert.match(shell, /D1 로그인·사건·초안 저장 활성/u);
  assert.doesNotMatch(shell, /FEE-01/u);
  assert.ok(['CF06', 'CF07', 'CF08', 'CF09'].includes(phase.currentPhase));
  assert.equal(phase.phases.CF05.status, 'DEFERRED_BY_USER');
  assert.equal(phase.phases.CF06.status, 'PASS_WITH_NOTES');
});
