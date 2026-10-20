import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const ADMIN_ID = '20000000-0000-4000-8000-000000000001';
const REVIEWER_ID = '20000000-0000-4000-8000-000000000002';
const ADMIN_TOKEN = 'cf08-admin-session-token';
const REVIEWER_TOKEN = 'cf08-reviewer-session-token';

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
    try { statement.bind(this.values as any[]); return statement.step() ? statement.getAsObject() as T : null; }
    finally { statement.free(); }
  }
  async all<T>(): Promise<{ results: T[] }> {
    const statement = this.database.prepare(this.sql);
    const results: T[] = [];
    try { statement.bind(this.values as any[]); while (statement.step()) results.push(statement.getAsObject() as T); return { results }; }
    finally { statement.free(); }
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
    } catch (error) { this.database.run('ROLLBACK'); throw error; }
  }
}

async function databaseFixture({adminLogin='admin'}:{adminLogin?:string}={}): Promise<{ sql: Database; env: CloudflareEnv }> {
  mkdirSync(join(process.cwd(),'tmp','cf221-qa','approval-tests'),{recursive:true});
  const SQL = await initSqlJs();
  const sql = new SQL.Database();
  sql.run('PRAGMA foreign_keys = ON');
  const migration = (name: string) => readFileSync(join(process.cwd(), 'apps', 'cloudflare', 'migrations', name), 'utf8');
  for (const name of [
    '0001_cf_foundation.sql', '0001_cf02_preview_drafts.sql', '0002_cf03_preview_evidence.sql',
    '0003_cf04_preview_auth.sql', '0004_cf05_google_drive.sql', '0005_cf06_case_operations.sql',
    '0006_cf07_report_studio_drafts.sql', '0007_cf08_report_review_approval.sql'
  ]) sql.exec(migration(name));
  const now = new Date().toISOString();
  const addUser = (id: string, login: string, roles: string) => sql.run('INSERT INTO preview_users VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)', [id, login, '1'.repeat(32), '2'.repeat(64), 100000, login, `${login}@example.invalid`, roles, now]);
  addUser(ADMIN_ID, adminLogin, '["admin"]');
  addUser(REVIEWER_ID, 'reviewer', '["director"]');
  sql.run('INSERT INTO preview_sessions VALUES (?, ?, ?, ?)', [await sha256(ADMIN_TOKEN), ADMIN_ID, now, new Date(Date.now() + 3_600_000).toISOString()]);
  sql.run('INSERT INTO preview_sessions VALUES (?, ?, ?, ?)', [await sha256(REVIEWER_TOKEN), REVIEWER_ID, now, new Date(Date.now() + 3_600_000).toISOString()]);
  const done=['0001_cf_foundation.sql','0001_cf02_preview_drafts.sql','0002_cf03_preview_evidence.sql','0003_cf04_preview_auth.sql','0004_cf05_google_drive.sql','0005_cf06_case_operations.sql','0006_cf07_report_studio_drafts.sql','0007_cf08_report_review_approval.sql'];
  for(const file of readdirSync('apps/cloudflare/migrations').filter(n=>/^\d{4}_.*\.sql$/.test(n)&&Number(n.slice(0,4))<=66&&!done.includes(n)).sort())sql.exec(migration(file));
  return { sql, env: { DB: new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']> } };
}

function request(path: string, token: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('X-Session-Token', token);
  if (init.body) headers.set('Content-Type', 'application/json');
  return new Request(`https://preview.example${path}`, { ...init, headers });
}

async function createSavedReport(env: CloudflareEnv, sql: Database): Promise<string> {
  const created = await worker.fetch(request('/api/cases', ADMIN_TOKEN, {
    method: 'POST', headers: { 'Idempotency-Key': `cf08-case-${crypto.randomUUID()}` },
    body: JSON.stringify({ title: '독립 승인 검증 사건', claimType: 'TYPE-02', description: '검토·승인 D1 회귀', clientName:'합성 발주처',clientLegalPosition:'VICTIM',clientPositionDetail:'', category: { major: '보고서', middle: '검토', minor: '승인' } })
  }), env);
  assert.equal(created.status, 201, await created.clone().text());
  const caseId = (await created.json() as { case: { id: string } }).case.id;
  sql.run('INSERT INTO preview_case_assignments VALUES (?, ?, ?, ?)', [caseId, REVIEWER_ID, ADMIN_ID, new Date().toISOString()]);
  const saved = await worker.fetch(request(`/api/report-drafts?caseId=${caseId}`, ADMIN_TOKEN, {
    method: 'PUT', body: JSON.stringify({ title: '공사비 적정성 검토 보고서', content: '근거에 따라 작성한 검토 본문입니다.', expectedVersion: 0 })
  }), env);
  assert.equal(saved.status, 200);
  return caseId;
}

async function submitReview(env: CloudflareEnv, caseId: string, key = 'cf08-review-request-001'): Promise<{ status: number; id: string }> {
  const response = await worker.fetch(request('/api/report-reviews', ADMIN_TOKEN, {
    method: 'POST', headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ caseId, expectedVersion: 1, assignedReviewerId: REVIEWER_ID, note: '금액과 근거 인용을 확인해 주세요.' })
  }), env);
  const body = await response.json() as { reviews: Array<{ id: string }> };
  return { status: response.status, id: body.reviews[0].id };
}


export {worker,SqlD1,databaseFixture,createSavedReport,submitReview,request,sha256,ADMIN_ID,REVIEWER_ID,ADMIN_TOKEN,REVIEWER_TOKEN};
