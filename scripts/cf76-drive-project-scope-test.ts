import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const CASE_ID = '76000000-0000-4000-8000-000000000001';
const USER_ID = '76000000-0000-4000-8000-000000000002';
const PROPOSAL_ID = '76000000-0000-4000-8000-000000000003';
const LINK_ID = '76000000-0000-4000-8000-000000000004';
const TOKEN = 'cf76-project-scope-session';

class SqlStatement {
  private values: unknown[] = [];
  constructor(private readonly database: Database, private readonly sql: string) {}
  bind(...values: unknown[]): SqlStatement { this.values = values; return this; }
  async first<T>(): Promise<T | null> {
    const statement = this.database.prepare(this.sql);
    try { statement.bind(this.values as never[]); return statement.step() ? statement.getAsObject() as T : null; }
    finally { statement.free(); }
  }
  async all<T>(): Promise<{ results: T[] }> {
    const statement = this.database.prepare(this.sql); const results: T[] = [];
    try { statement.bind(this.values as never[]); while (statement.step()) results.push(statement.getAsObject() as T); return { results }; }
    finally { statement.free(); }
  }
  async run(): Promise<{ success: boolean; meta: { changes: number } }> {
    this.database.run(this.sql, this.values as never[]);
    return { success: true, meta: { changes: this.database.getRowsModified() } };
  }
}

class SqlD1 {
  constructor(readonly database: Database) {}
  prepare(sql: string): SqlStatement { return new SqlStatement(this.database, sql); }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function setup(): Promise<{ sql: Database; env: CloudflareEnv }> {
  const SQL = await initSqlJs(); const sql = new SQL.Database();
  sql.exec(`
    CREATE TABLE preview_users(id TEXT PRIMARY KEY,login_id TEXT,display_name TEXT,email TEXT,roles_json TEXT,is_active INTEGER);
    CREATE TABLE preview_sessions(id_hash TEXT PRIMARY KEY,user_id TEXT,created_at TEXT,expires_at TEXT);
    CREATE TABLE preview_cases(id TEXT PRIMARY KEY,organization_id TEXT,case_number TEXT,title TEXT,description TEXT,claim_type TEXT,status TEXT,version INTEGER,category_major TEXT,category_middle TEXT,category_minor TEXT,client_legal_position TEXT,client_position_detail TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE preview_case_assignments(case_id TEXT,user_id TEXT);
    CREATE TABLE preview_proposals(id TEXT PRIMARY KEY,organization_id TEXT,case_id TEXT,status TEXT);
    CREATE TABLE preview_proposal_links(id TEXT PRIMARY KEY,organization_id TEXT,case_id TEXT,proposal_number TEXT,award_status TEXT);
    CREATE TABLE preview_award_effective_states(proposal_link_id TEXT PRIMARY KEY,effective_status TEXT);
    CREATE TABLE preview_catalog_records(record_kind TEXT,record_id TEXT,organization_id TEXT,db_deleted INTEGER,PRIMARY KEY(record_kind,record_id));
  `);
  const now = '2026-08-31T00:00:00.000Z';
  sql.run('INSERT INTO preview_users VALUES (?,?,?,?,?,1)', [USER_ID, 'admin', '관리자', 'admin@example.invalid', '["admin"]']);
  sql.run('INSERT INTO preview_sessions VALUES (?,?,?,?)', [await sha256(TOKEN), USER_ID, now, '2099-01-01T00:00:00.000Z']);
  sql.run('INSERT INTO preview_cases VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [CASE_ID, 'concost', 'CC-2026-00760', '자료실 범위 검증', null, 'TYPE-01', 'CONTRACT', 1, '기술', '클레임', '검토', 'UNSPECIFIED', null, now, now, null]);
  sql.run('INSERT INTO preview_proposals VALUES (?,?,?,?)', [PROPOSAL_ID, 'concost', CASE_ID, 'APPROVED']);
  sql.run('INSERT INTO preview_proposal_links VALUES (?,?,?,?,?)', [LINK_ID, 'concost', CASE_ID, 'PROP-76000000', 'WON']);
  sql.run('INSERT INTO preview_award_effective_states VALUES (?,?)', [LINK_ID, 'WON']);
  return { sql, env: { DB: new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']> } };
}

async function list(env: CloudflareEnv, scope = 'project-work'): Promise<{ status: number; total: number }> {
  const response = await worker.fetch(new Request(`https://preview.example/api/cases?limit=100&q=&scope=${scope}`, { headers: { 'X-Session-Token': TOKEN } }), env);
  const body = await response.json() as { total?: number };
  return { status: response.status, total: Number(body.total ?? -1) };
}

test('CF76 자료실은 수주 확정 프로젝트 워크만 노출하고 취소·DB 삭제·데모를 API에서도 차단한다', async () => {
  const { sql, env } = await setup();
  assert.deepEqual(await list(env), { status: 200, total: 1 });

  const unrelated = '76000000-0000-4000-8000-000000000099';
  sql.run('INSERT INTO preview_proposals VALUES (?,?,?,?)', [unrelated, 'concost', CASE_ID, 'APPROVED']);
  sql.run("INSERT INTO preview_catalog_records VALUES ('PROPOSAL',?,'concost',1)", [unrelated]);
  assert.equal((await list(env)).total, 1, 'unrelated proposal deletion must not hide the accepted project');

  sql.run("INSERT INTO preview_catalog_records VALUES ('PROPOSAL',?,'concost',1)", [PROPOSAL_ID]);
  assert.equal((await list(env)).total, 0, 'accepted proposal DB deletion must hide the project');
  sql.run("DELETE FROM preview_catalog_records WHERE record_kind='PROPOSAL' AND record_id=?", [PROPOSAL_ID]);

  sql.run("INSERT INTO preview_catalog_records VALUES ('INTAKE',?,'concost',1)", [CASE_ID]);
  assert.equal((await list(env)).total, 0, 'intake DB deletion must hide the project');
  const blockedEvidence = await worker.fetch(new Request(`https://preview.example/api/cases/${CASE_ID}/evidence`, { headers: { 'X-Session-Token': TOKEN } }), env);
  assert.equal(blockedEvidence.status, 404);
  sql.run("DELETE FROM preview_catalog_records WHERE record_kind='INTAKE' AND record_id=?", [CASE_ID]);

  sql.run("UPDATE preview_award_effective_states SET effective_status='LOST' WHERE proposal_link_id=?", [LINK_ID]);
  sql.run("UPDATE preview_cases SET status='PROPOSAL' WHERE id=?", [CASE_ID]);
  assert.equal((await list(env)).total, 0, 'cancelled award must leave the project-work scope');

  sql.run("UPDATE preview_award_effective_states SET effective_status='WON' WHERE proposal_link_id=?", [LINK_ID]);
  sql.run("UPDATE preview_cases SET status='CONTRACT',case_number='DEMO-2026-00760' WHERE id=?", [CASE_ID]);
  assert.equal((await list(env)).total, 0, 'demo cases must never appear in the operational library');
  sql.close();
});
