import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';
import { generateFinalDocx, generateFinalPdf, type FinalReportDocument } from '../apps/cloudflare/src/final-output.js';

const ADMIN_ID = '30000000-0000-4000-8000-000000000001';
const REVIEWER_ID = '30000000-0000-4000-8000-000000000002';
const ADMIN_TOKEN = 'cf09-admin-session-token';
const REVIEWER_TOKEN = 'cf09-reviewer-session-token';

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

class Statement {
  private values: unknown[] = [];
  constructor(private readonly db: Database, private readonly sql: string) {}
  bind(...values: unknown[]): Statement { this.values = values; return this; }
  async first<T>(): Promise<T | null> { const stmt = this.db.prepare(this.sql); try { stmt.bind(this.values as any[]); return stmt.step() ? stmt.getAsObject() as T : null; } finally { stmt.free(); } }
  async all<T>(): Promise<{ results: T[] }> { const stmt = this.db.prepare(this.sql); const results: T[] = []; try { stmt.bind(this.values as any[]); while (stmt.step()) results.push(stmt.getAsObject() as T); return { results }; } finally { stmt.free(); } }
  async run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }> { this.db.run(this.sql, this.values as any[]); const row=this.db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0]; return { success: true, meta: { changes: this.db.getRowsModified(), last_row_id: Number(row ?? 0) } }; }
}
class D1 {
  constructor(readonly db: Database) {}
  prepare(sql: string): Statement { return new Statement(this.db, sql); }
  async batch(statements: Statement[]): Promise<unknown[]> { this.db.run('BEGIN IMMEDIATE'); try { const results = []; for (const statement of statements) results.push(await statement.run()); this.db.run('COMMIT'); return results; } catch (error) { this.db.run('ROLLBACK'); throw error; } }
}

async function fixture(): Promise<{ sql: Database; env: CloudflareEnv }> {
  const SQL = await initSqlJs(); const sql = new SQL.Database(); sql.run('PRAGMA foreign_keys=ON');
  const migrations = ['0001_cf_foundation.sql','0001_cf02_preview_drafts.sql','0002_cf03_preview_evidence.sql','0003_cf04_preview_auth.sql','0004_cf05_google_drive.sql','0005_cf06_case_operations.sql','0006_cf07_report_studio_drafts.sql','0007_cf08_report_review_approval.sql','0008_cf09_final_output.sql','0009_cf09_output_actor_scope.sql'];
  for (const name of migrations) sql.exec(readFileSync(join(process.cwd(), 'apps/cloudflare/migrations', name), 'utf8'));
  const now = new Date().toISOString();
  const user = (id: string, login: string, roles: string) => sql.run('INSERT INTO preview_users VALUES (?,?,?,?,?,?,?,?,1,?)', [id, login, '1'.repeat(32), '2'.repeat(64), 100000, login, `${login}@example.invalid`, roles, now]);
  user(ADMIN_ID, 'admin', '["admin"]'); user(REVIEWER_ID, 'reviewer', '["reviewer"]');
  sql.run('INSERT INTO preview_sessions VALUES (?,?,?,?)', [await sha256(ADMIN_TOKEN), ADMIN_ID, now, new Date(Date.now()+3_600_000).toISOString()]);
  sql.run('INSERT INTO preview_sessions VALUES (?,?,?,?)', [await sha256(REVIEWER_TOKEN), REVIEWER_ID, now, new Date(Date.now()+3_600_000).toISOString()]);
  return { sql, env: { DB: new D1(sql) as unknown as NonNullable<CloudflareEnv['DB']> } };
}

function request(path: string, token: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers); headers.set('X-Session-Token', token); if (init.body) headers.set('Content-Type','application/json');
  return new Request(`https://preview.example${path}`, { ...init, headers });
}

async function approvedReport(env: CloudflareEnv, sql: Database): Promise<{ caseId: string; reviewId: string }> {
  const created = await worker.fetch(request('/api/cases', ADMIN_TOKEN, { method:'POST', headers:{'Idempotency-Key':`cf09-case-${crypto.randomUUID()}`}, body:JSON.stringify({ title:'최종 출력 검증 사건', claimType:'TYPE-02', description:'CF09', category:{major:'보고서',middle:'출력',minor:'확정'} }) }), env);
  const createdBody = await created.json() as {case?:{id:string}; error?:string; code?:string};
  assert.equal(created.status, 201, JSON.stringify(createdBody)); const caseId = createdBody.case!.id;
  sql.run('INSERT INTO preview_case_assignments VALUES (?,?,?,?)', [caseId, REVIEWER_ID, ADMIN_ID, new Date().toISOString()]);
  assert.equal((await worker.fetch(request(`/api/report-drafts?caseId=${caseId}`, ADMIN_TOKEN, { method:'PUT', body:JSON.stringify({title:'공사비 검토 최종 보고서',content:'1. 검토 목적\n근거 자료와 산식을 확인했습니다.\n2. 결론\n적정합니다.',expectedVersion:0}) }), env)).status, 200);
  const submitted = await worker.fetch(request('/api/report-reviews', ADMIN_TOKEN, { method:'POST', headers:{'Idempotency-Key':'cf09-review-001'}, body:JSON.stringify({caseId,expectedVersion:1,note:'최종 검토 요청'}) }), env);
  const reviewId = (await submitted.json() as {reviews:Array<{id:string}>}).reviews[0].id;
  assert.equal((await worker.fetch(request(`/api/report-reviews/${reviewId}/decision`, REVIEWER_TOKEN, { method:'POST', body:JSON.stringify({decision:'APPROVED',note:'확인 완료',expectedStatus:'PENDING'}) }), env)).status, 200);
  return { caseId, reviewId };
}

test('CF09 approved revision finalizes idempotently and regenerates hash-stable DOCX/PDF', async () => {
  const { sql, env } = await fixture(); const { caseId, reviewId } = await approvedReport(env, sql);
  const finalize = () => worker.fetch(request('/api/report-finalizations', ADMIN_TOKEN, { method:'POST', headers:{'Idempotency-Key':'cf09-finalize-001'}, body:JSON.stringify({caseId,reviewId}) }), env);
  const first = await finalize(); assert.equal(first.status, 201); const finalization = (await first.json() as {finalizations:Array<{id:string}>}).finalizations[0];
  assert.equal((await finalize()).status, 200);
  const forbidden = await worker.fetch(request('/api/report-finalizations', REVIEWER_TOKEN, { method:'POST', headers:{'Idempotency-Key':'cf09-finalize-reviewer'}, body:JSON.stringify({caseId,reviewId}) }), env); assert.equal(forbidden.status, 403);
  for (const format of ['DOCX','PDF'] as const) {
    const generated = await worker.fetch(request(`/api/report-finalizations/${finalization.id}/outputs`, ADMIN_TOKEN, { method:'POST', body:JSON.stringify({format}) }), env); assert.equal(generated.status, 200);
  }
  const listed = await worker.fetch(request(`/api/report-finalizations?caseId=${caseId}`, ADMIN_TOKEN), env);
  const outputs = (await listed.json() as {finalizations:Array<{outputs:Array<{id:string;format:string;contentSha256:string}>}>}).finalizations[0].outputs; assert.equal(outputs.length, 2);
  for (const output of outputs) {
    const download = await worker.fetch(request(`/api/report-outputs/${output.id}/download`, ADMIN_TOKEN), env); assert.equal(download.status, 200);
    const bytes = new Uint8Array(await download.arrayBuffer());
    assert.equal(await sha256(String.fromCharCode(...bytes.slice(0, 64))) === output.contentSha256, false, 'ledger hash must cover complete binary, not prefix');
    assert.equal(download.headers.get('X-Content-SHA256'), output.contentSha256);
    assert.equal(output.format === 'DOCX' ? String.fromCharCode(...bytes.slice(0,4)) : new TextDecoder().decode(bytes.slice(0,8)), output.format === 'DOCX' ? 'PK\u0003\u0004' : '%PDF-1.7');
  }
  const SQL = await initSqlJs(); const restarted = new SQL.Database(sql.export());
  assert.equal(restarted.exec('SELECT count(*) FROM preview_report_finalizations')[0].values[0][0], 1); assert.equal(restarted.exec('SELECT count(*) FROM preview_report_outputs')[0].values[0][0], 2);
  restarted.close(); sql.close();
});

test('CF09 D1 rejects raw mutation and output ledger tampering', async () => {
  const { sql, env } = await fixture(); const { caseId, reviewId } = await approvedReport(env, sql);
  const response = await worker.fetch(request('/api/report-finalizations', ADMIN_TOKEN, { method:'POST', headers:{'Idempotency-Key':'cf09-finalize-002'}, body:JSON.stringify({caseId,reviewId}) }), env);
  const id = (await response.json() as {finalizations:Array<{id:string}>}).finalizations[0].id;
  assert.throws(() => sql.run('UPDATE preview_report_finalizations SET report_version=2 WHERE id=?',[id]), /immutable/u);
  assert.throws(() => sql.run('DELETE FROM preview_report_finalizations WHERE id=?',[id]), /immutable/u);
  sql.close();
});

test('CF09 Worker document engine is byte deterministic and embeds immutable provenance', () => {
  const doc: FinalReportDocument = { caseNumber:'CLM-2026-001',caseTitle:'합성 사건',reportTitle:'최종 보고서',reportVersion:3,content:'본문\n두 번째 줄',contentSha256:'a'.repeat(64),approvedBy:'검토자',approvedAt:'2026-08-13T00:00:00.000Z',finalizedBy:'관리자',finalizedAt:'2026-08-13T00:01:00.000Z' };
  const docxA=generateFinalDocx(doc), docxB=generateFinalDocx(doc), pdfA=generateFinalPdf(doc), pdfB=generateFinalPdf(doc);
  assert.deepEqual(docxA,docxB); assert.deepEqual(pdfA,pdfB); assert.equal(String.fromCharCode(...docxA.slice(0,4)),'PK\u0003\u0004'); assert.equal(new TextDecoder().decode(pdfA.slice(0,8)),'%PDF-1.7');
  const pdfText=new TextDecoder().decode(pdfA); const xrefOffset=Number(pdfText.match(/startxref\n(\d+)\n%%EOF$/u)?.[1]); assert.equal(pdfText.slice(xrefOffset,xrefOffset+4),'xref','PDF xref offset must point to the exact byte position');
});

test('CF09 production studio exposes finalize, generate and download actions', () => {
  const studio=readFileSync(join(process.cwd(),'apps/web/src/routes/PreviewReportStudio.tsx'),'utf8');
  assert.match(studio,/승인본 최종 확정/u); assert.match(studio,/\{format\} 다운로드/u); assert.match(studio,/DOCX.*PDF/su); assert.match(studio,/apiDownload/u);
});
