import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const ADMIN = '11600000-0000-4000-8000-000000000001';
const TOKEN = 'cf116-local-storage-admin';
const migrationRoot = new URL('../apps/cloudflare/migrations/', import.meta.url);
const textDocument = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const emptyDraft = { title: 'CF116 신규 합성 보고서', content: '', editorJson: { type: 'doc', attrs: { reportHeader: { enabled: true, text: null } } }, expectedVersion: 0, wizardStep: 1, selectedChapterId: 'PROMPT-TYPE-01-CH-01', saveKind: 'NAVIGATION' };

// The same SQLite-backed transactional D1 contract used by the existing Worker tests.
class Statement {
  private values: unknown[] = [];
  constructor(private readonly db: Database, readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>(): Promise<T | null> {
    const statement = this.db.prepare(this.sql);
    try { statement.bind(this.values as never[]); return statement.step() ? statement.getAsObject() as T : null; }
    finally { statement.free(); }
  }
  async all<T>(): Promise<{ results: T[] }> {
    const statement = this.db.prepare(this.sql), results: T[] = [];
    try { statement.bind(this.values as never[]); while (statement.step()) results.push(statement.getAsObject() as T); return { results }; }
    finally { statement.free(); }
  }
  async run() {
    this.db.run(this.sql, this.values as never[]);
    return { success: true, meta: { changes: this.db.getRowsModified(), last_row_id: Number(this.db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? 0) } };
  }
}
class D1 {
  beforeBatch: ((statements: Statement[]) => Promise<void>) | undefined;
  constructor(readonly db: Database) {}
  queries: string[] = [];
  prepare(sql: string) { this.queries.push(sql); return new Statement(this.db, sql); }
  async batch(statements: Statement[]) {
    const hook = this.beforeBatch; this.beforeBatch = undefined;
    if (hook) await hook(statements);
    this.db.run('BEGIN IMMEDIATE');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.db.run('COMMIT'); return results; }
    catch (error) { this.db.run('ROLLBACK'); throw error; }
  }
}
const request = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers); headers.set('X-Session-Token', TOKEN);
  if (init.body) headers.set('Content-Type', 'application/json');
  return new Request(`https://preview.example${path}`, { ...init, headers });
};
async function json(response: Response, expectedStatus = 200): Promise<any> {
  const body = await response.json();
  assert.equal(response.status, expectedStatus, String(body?.code ?? 'unexpected response'));
  return body;
}
const snapshot = (db: Database) => Object.fromEntries([
  'preview_report_drafts', 'preview_report_revisions', 'preview_report_hourly_backups', 'preview_case_activities'
].map(table => [table, db.exec(`SELECT * FROM ${table} ORDER BY rowid`)]));
const rows = (db: Database, table: string) => db.exec(`SELECT * FROM ${table}`)[0]?.values.length ?? 0;

async function fixture() {
  const SQL = await initSqlJs(), db = new SQL.Database(); db.run('PRAGMA foreign_keys=ON');
  const foundation = ['0001_cf_foundation.sql', '0001_cf02_preview_drafts.sql', '0002_cf03_preview_evidence.sql', '0003_cf04_preview_auth.sql'];
  const apply = (name: string) => db.exec(readFileSync(new URL(name, migrationRoot), 'utf8'));
  for (const name of foundation) apply(name);
  const now = new Date().toISOString();
  db.run('INSERT INTO preview_users (id,login_id,password_salt,password_hash,password_iterations,display_name,email,roles_json,is_active,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)', [ADMIN, 'cf116@example.invalid', '1'.repeat(32), '2'.repeat(64), 100000, '합성 관리자', 'cf116@example.invalid', '["admin"]', now]);
  // Seed an administrator before migrations whose approved template rows reference one.
  for (const name of readdirSync(migrationRoot).filter(name => /^\d{4}_.+\.sql$/u.test(name) && Number(name.slice(0, 4)) <= 61 && !foundation.includes(name)).sort()) apply(name);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(TOKEN));
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  db.run('INSERT INTO preview_sessions (id_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)', [hash, ADMIN, now, new Date(Date.now() + 3_600_000).toISOString()]);
  const d1 = new D1(db), env: CloudflareEnv = { DB: d1 as unknown as NonNullable<CloudflareEnv['DB']> };
  const created = await json(await worker.fetch(request('/api/cases', {
    method: 'POST', headers: { 'Idempotency-Key': 'cf116-new-report-storage' },
    body: JSON.stringify({ title: '신규 보고서 저장 경로 검수', claimType: 'TYPE-01', description: '합성 데이터만 사용', clientName: '합성 발주처', clientLegalPosition: 'VICTIM', clientPositionDetail: '', category: { major: '보고서', middle: '저장', minor: '검수' } })
  }), env), 201);
  const caseId = created.case.id as string, path = `/api/report-drafts?caseId=${caseId}`;
  const put = (body: Record<string, unknown>) => worker.fetch(request(path, { method: 'PUT', body: JSON.stringify(body) }), env);
  const get = () => worker.fetch(request(path), env);
  assert.deepEqual(db.exec('PRAGMA foreign_key_check'), []);
  assert.equal((await json(await get())).draft, null);
  assert.equal(rows(db, 'preview_report_hourly_backups'), 0);
  return { db, d1, env, caseId, put, get };
}

test('CF230 real Worker large draft summary, exact ACK, scoped backup and legacy history', async()=>{
 const {db,d1,env,caseId}=await fixture();
 try{
  const document=textDocument('SYNTHETIC_CF230_'.repeat(100000));
  assert.ok(JSON.stringify(document).length>1_400_000 && JSON.stringify(document).length<2_000_000);
  const path=`/api/report-drafts?caseId=${caseId}`;
  const payload={...emptyDraft,title:'CF230 synthetic large report',content:'Synthetic content 123.45',editorJson:document};
  const call=(suffix:string,init:RequestInit={})=>worker.fetch(request(path+suffix,init),env);
  const assertSummary=(body:any)=>{assert.deepEqual(body.draft.editorJson,document);assert.equal(body.draft.content,payload.content);for(const r of [...body.revisions,...body.backups]){assert.equal(r.content,null);assert.equal(r.editorJson,null);assert.equal(r.contentDeferred,true);}assert.ok(JSON.stringify(body).length<JSON.stringify(document).length+30000);};
  for(let i=0;i<20;i++){
   const response=await json(await call('&history=summary',{method:'PUT',body:JSON.stringify({...payload,title:'CF230 synthetic '+i,expectedVersion:i})}));
   assertSummary(response);assert.equal(response.draft.version,i+1);
  }
  const backup=db.exec('SELECT id FROM preview_report_hourly_backups LIMIT 1')[0].values[0][0] as string;
  for(let i=1;i<=3;i++)db.run('INSERT INTO preview_report_hourly_backups SELECT ?,organization_id,case_id,report_version,title,content,editor_json,content_sha256,?,saved_by,saved_at FROM preview_report_hourly_backups WHERE id=?',[crypto.randomUUID(),`2026-01-0${i}T00`,backup]);
  d1.queries=[];const summary=await json(await call('&history=summary'));assertSummary(summary);assert.equal(summary.revisions.length,20);assert.equal(summary.backups.length,4);
  const historyQueries=d1.queries.filter(q=>/^SELECT/i.test(q)&&! /LIMIT 0\s*$/i.test(q)&&/FROM preview_report_(revisions|hourly_backups)/.test(q));
  assert.equal(historyQueries.length,2,historyQueries.join("\n"));
  for(const sql of historyQueries){const projection=sql.split(/\bFROM\b/i)[0];assert.doesNotMatch(projection,/(?:\br|\bb)\.(?:content|editor_json)\b|\bSELECT\s+\*/i,'summary must not read large history columns from D1');assert.match(projection,/NULL AS content/i);}
  const selected=await json(await call('&history=summary&backupId='+backup));assert.deepEqual(selected.backup.editorJson,document);assert.equal(selected.backup.content,payload.content);assert.equal(selected.draft,undefined);
  const other=await json(await worker.fetch(request('/api/cases',{method:'POST',headers:{'Idempotency-Key':'cf230-other-synthetic'},body:JSON.stringify({title:'CF230 other synthetic',claimType:'TYPE-01',description:'synthetic',clientName:'synthetic',clientLegalPosition:'VICTIM',clientPositionDetail:'',category:{major:'보고서',middle:'저장',minor:'검수'}})}),env),201);
  await json(await worker.fetch(request(`/api/report-drafts?caseId=${other.case.id}&backupId=${backup}`),env),404);
  const before=db.exec('SELECT version,content,editor_json FROM preview_report_drafts WHERE case_id=?',[caseId]);
  await json(await call('&history=summary',{method:'PUT',body:JSON.stringify({...payload,expectedVersion:19})}),409);
  assert.deepEqual(db.exec('SELECT version,content,editor_json FROM preview_report_drafts WHERE case_id=?',[caseId]),before);
  const legacy=await json(await call(''));assert.equal(legacy.revisions.length,20);assert.equal(legacy.backups.length,4);for(const item of [...legacy.revisions,...legacy.backups]){assert.deepEqual(item.editorJson,document);assert.equal(item.content,payload.content);assert.equal(item.contentDeferred,undefined);}
  assert.deepEqual(db.exec('PRAGMA integrity_check')[0].values,[['ok']]);assert.deepEqual(db.exec('PRAGMA foreign_key_check'),[]);
 }finally{db.close();}
});


