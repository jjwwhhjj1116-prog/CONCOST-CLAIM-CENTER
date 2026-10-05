import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const STAFF_ID = '00000000-0000-4000-8000-000000000002';
const CASE_ID = '40000000-0000-4000-8000-000000000010';
const ADMIN_TOKEN = 'cf18-admin-session-token';
const STAFF_TOKEN = 'cf18-staff-session-token';
const SOURCE_TEXT = '원문 검증 자료: 외벽 균열 조사 수량은 127개이며 현장 대조가 필요합니다.';

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

class SqlStatement {
  private values: unknown[] = [];
  constructor(private readonly database: Database, private readonly sql: string) {}
  bind(...values: unknown[]): SqlStatement { this.values = values.map((value) => value instanceof ArrayBuffer ? new Uint8Array(value) : value); return this; }
  async first<T>(): Promise<T | null> { const statement = this.database.prepare(this.sql); try { statement.bind(this.values as any[]); return statement.step() ? statement.getAsObject() as T : null; } finally { statement.free(); } }
  async all<T>(): Promise<{ results: T[] }> { const statement = this.database.prepare(this.sql); const results: T[] = []; try { statement.bind(this.values as any[]); while (statement.step()) results.push(statement.getAsObject() as T); return { results }; } finally { statement.free(); } }
  async run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }> { this.database.run(this.sql, this.values as any[]); const row = this.database.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0]; return { success: true, meta: { changes: this.database.getRowsModified(), last_row_id: Number(row ?? 0) } }; }
}
class SqlD1 {
  constructor(readonly database: Database) {}
  prepare(sql: string): SqlStatement { return new SqlStatement(this.database, sql); }
  async batch(statements: SqlStatement[]): Promise<unknown[]> { this.database.run('BEGIN IMMEDIATE'); try { const results = []; for (const statement of statements) results.push(await statement.run()); this.database.run('COMMIT'); return results; } catch (error) { this.database.run('ROLLBACK'); throw error; } }
}

const migration = (name: string): string => readFileSync(join(process.cwd(), 'apps', 'cloudflare', 'migrations', name), 'utf8');
function request(path: string, token: string, init: RequestInit = {}): Request { const headers = new Headers(init.headers); headers.set('X-Session-Token', token); if (init.body) headers.set('Content-Type', 'application/json'); return new Request(`https://preview.example${path}`, { ...init, headers }); }

async function setup(pdfMode?: 'complete' | 'partial'): Promise<{ sql: Database; env: CloudflareEnv; providerBodies: Array<Record<string, unknown>> }> {
  const SQL = await initSqlJs(); const sql = new SQL.Database(); sql.run('PRAGMA foreign_keys = ON');
  for (const name of ['0001_cf_foundation.sql','0001_cf02_preview_drafts.sql','0002_cf03_preview_evidence.sql','0003_cf04_preview_auth.sql','0004_cf05_google_drive.sql','0005_cf06_case_operations.sql']) sql.exec(migration(name));
  const now = new Date().toISOString();
  const insertUser = (id: string, login: string, roles: string) => sql.run('INSERT INTO preview_users VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)', [id, login, '1'.repeat(32), '2'.repeat(64), 100000, login, `${login}@example.invalid`, roles, now]);
  insertUser(ADMIN_ID, 'admin', '["admin"]');
  sql.exec(migration('0010_cf10_product_experience.sql'));
  insertUser(STAFF_ID, 'staff', '["pm"]');
  for (const name of ['0006_cf07_report_studio_drafts.sql','0007_cf08_report_review_approval.sql','0008_cf09_final_output.sql','0009_cf09_output_actor_scope.sql','0011_cf11_project_workflow.sql','0012_cf12_report_ai_prompts.sql','0013_cf13_litigation_records.sql','0014_cf14_proposal_award_workflow.sql','0015_cf15_case_evidence_library.sql','0016_cf18_report_outline_evidence.sql']) sql.exec(migration(name));
  sql.exec(migration('0017_cf19_multi_provider_ai.sql'));
  const governanceSql = migration('0032_cf40_pm_schedule_ai_import_security.sql');
  sql.exec(governanceSql.slice(governanceSql.indexOf('CREATE TABLE preview_ai_data_governance'), governanceSql.indexOf('CREATE INDEX idx_preview_stage_schedules_case')));
  sql.run("UPDATE preview_ai_data_governance SET provider_service_tier='PAID_NO_PRODUCT_IMPROVEMENT',confidential_external_ai_enabled=1,acknowledged_by=?,acknowledged_at=?", [ADMIN_ID,now]);
  sql.exec(migration('0024_cf32_source_template_library.sql'));
  sql.run('INSERT INTO preview_case_assignments VALUES (?, ?, ?, ?)', [CASE_ID, STAFF_ID, ADMIN_ID, now]);
  for (const [token, id] of [[ADMIN_TOKEN, ADMIN_ID],[STAFF_TOKEN, STAFF_ID]] as const) sql.run('INSERT INTO preview_sessions VALUES (?, ?, ?, ?)', [await sha256(token), id, now, new Date(Date.now() + 3_600_000).toISOString()]);
  const sourceBytes = new TextEncoder().encode(SOURCE_TEXT);
  sql.run('INSERT INTO preview_case_evidence VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['50000000-0000-4000-8000-000000000018', 'concost', CASE_ID, 'TAKEOFF_SOURCE', pdfMode ? 'mock-provider.pdf' : 'verified-takeoff.txt', pdfMode ? 'application/pdf' : 'text/plain', sourceBytes.length, await sha256(SOURCE_TEXT), 1, 'D1_TEMPORARY', ADMIN_ID, 'admin', now, 'cf18-evidence-key-0001', 'b'.repeat(64)]);
  sql.run('INSERT INTO preview_case_evidence_chunks VALUES (?,?,?,?)', ['50000000-0000-4000-8000-000000000018', 0, sourceBytes.length, sourceBytes]);
  const providerBodies: Array<Record<string, unknown>> = [];
  const geminiFetch: typeof fetch = async (_input, init) => { const body = JSON.parse(String(init?.body)) as Record<string, unknown>; providerBodies.push(body);
    const text = pdfMode && JSON.stringify(body).includes('inline_data') ? JSON.stringify({text:'PDF 인식 모의 원문 4729',complete:pdfMode === 'complete'}) : '## 현장 검토\n\n프로젝트 근거 범위 안에서 작성한 초안입니다. [확인 필요]';
    return new Response(JSON.stringify({ candidates: [{content:{parts:[{text}]}}] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  return { sql, providerBodies, env: { DB: new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']>, GEMINI_API_KEY: 'SYNTHETIC_SERVER_ONLY_KEY', GEMINI_TEST_FETCH: geminiFetch } };
}

test('CF18 persists an exact optimistic outline before chapter generation', async () => {
  const { sql, env, providerBodies } = await setup();
  const configResponse = await worker.fetch(request(`/api/report-authoring/config?caseId=${CASE_ID}`, STAFF_TOKEN), env);
  assert.equal(configResponse.status, 200);
  const configText = await configResponse.text();
  const config = JSON.parse(configText) as { outlinePlan: { status: string; version: number; items: Array<{ chapterId: string; chapterCode: string; chapterTitle: string; promptVersion: number; planningNote: string }> }; sourceGroups: Array<{ code: string; status: string; itemCount: number }>; chapters: Array<{ id: string; chapterCode: string; title: string; promptVersion: number }> };
  assert.equal(config.outlinePlan.status, 'DRAFT'); assert.equal(config.outlinePlan.version, 0); assert.equal(config.outlinePlan.items.length, config.chapters.length);
  assert.equal(config.sourceGroups.find((entry) => entry.code === 'EVIDENCE')?.status, 'READY');
  assert.equal(config.sourceGroups.find((entry) => entry.code === 'EVIDENCE')?.itemCount, 1);

  const beforeConfirm = await worker.fetch(request('/api/report-authoring/generate', STAFF_TOKEN, { method: 'POST', body: JSON.stringify({ caseId: CASE_ID, chapterId: config.chapters[0].id, expectedDraftVersion: 0 }) }), env);
  assert.equal(beforeConfirm.status, 409); assert.equal(providerBodies.length, 0);

  const items = config.chapters.map((chapter, index) => ({ chapterId: chapter.id, chapterCode: chapter.chapterCode, chapterTitle: index === 0 ? '수행 결과와 핵심 차이 분석' : chapter.title, promptVersion: chapter.promptVersion, planningNote: index === 0 ? '현장조사와 수량산출 차이를 우선 비교합니다.' : '' }));
  const confirmed = await worker.fetch(request('/api/report-authoring/outline', STAFF_TOKEN, { method: 'PUT', body: JSON.stringify({ caseId: CASE_ID, items, status: 'CONFIRMED', expectedVersion: 0 }) }), env);
  assert.equal(confirmed.status, 200);
  assert.equal(sql.exec("SELECT status,version FROM preview_report_outline_plans WHERE case_id='40000000-0000-4000-8000-000000000010'")[0].values[0].join(':'), 'CONFIRMED:1');
  assert.equal(sql.exec("SELECT COUNT(*) FROM preview_case_activities WHERE event_type='REPORT_OUTLINE_CONFIRMED'")[0].values[0][0], 1);

  const stale = await worker.fetch(request('/api/report-authoring/outline', STAFF_TOKEN, { method: 'PUT', body: JSON.stringify({ caseId: CASE_ID, items, status: 'CONFIRMED', expectedVersion: 0 }) }), env);
  assert.equal(stale.status, 409);
  const omitted = await worker.fetch(request('/api/report-authoring/outline', STAFF_TOKEN, { method: 'PUT', body: JSON.stringify({ caseId: CASE_ID, items: items.slice(1), status: 'CONFIRMED', expectedVersion: 1 }) }), env);
  assert.equal(omitted.status, 409);

  const generated = await worker.fetch(request('/api/report-authoring/generate', STAFF_TOKEN, { method: 'POST', body: JSON.stringify({ caseId: CASE_ID, chapterId: config.chapters[0].id, expectedDraftVersion: 0 }) }), env);
  assert.equal(generated.status, 200); assert.equal(providerBodies.length, 1);
  const providerInput = JSON.stringify(providerBodies[0]);
  assert.match(providerInput, /현장조사와 수량산출 차이를 우선 비교/u);
  assert.match(providerInput, /verified-takeoff\.txt/u);
  assert.ok(providerInput.includes(SOURCE_TEXT));
  assert.ok(providerInput.includes(await sha256(SOURCE_TEXT)));
  assert.match(providerInput, /NOT_REVIEWED/u);
  assert.match(providerInput, /UNVERSIONED_REGISTERED_SOURCE/u);
  assert.match(providerInput, /binary file contents must not be inferred/u);
  assert.doesNotMatch(configText, /rolePrompt|instructionPrompt/u);
  const now = new Date().toISOString();
  const prior = `<!-- AI-CHAPTER:${config.chapters[0].chapterCode}:START -->\n## 앞 장\n\n이전 장 대조용 문장 9271\n<!-- AI-CHAPTER:${config.chapters[0].chapterCode}:END -->`;
  sql.run('INSERT INTO preview_report_drafts (case_id,organization_id,title,content,version,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [CASE_ID,'concost','검증 초안',prior,1,STAFF_ID,STAFF_ID,now,now]);
  const nextChapter = await worker.fetch(request('/api/report-authoring/generate', STAFF_TOKEN, { method: 'POST', body: JSON.stringify({ caseId: CASE_ID, chapterId: config.chapters[1].id, expectedDraftVersion: 1 }) }), env);
  assert.equal(nextChapter.status, 200);
  assert.match(JSON.stringify(providerBodies[1]), /이전 장 대조용 문장 9271/u);
  assert.match(JSON.stringify(providerBodies[1]), /DRAFT_NOT_APPROVED/u);
  sql.run('INSERT INTO preview_case_evidence SELECT ?,organization_id,case_id,category,original_name,mime_type,byte_size,?,chunk_count,storage_provider,uploaded_by_id,uploaded_by_name,uploaded_at,?,request_fingerprint FROM preview_case_evidence WHERE case_id=?', ['50000000-0000-4000-8000-000000000019','a'.repeat(64),'cf18-damaged-key-0002',CASE_ID]);
  sql.run('INSERT INTO preview_case_evidence_chunks SELECT ?,chunk_index,byte_size,payload FROM preview_case_evidence_chunks WHERE evidence_id=?', ['50000000-0000-4000-8000-000000000019','50000000-0000-4000-8000-000000000018']);
  const damaged = await worker.fetch(request('/api/report-authoring/generate', STAFF_TOKEN, { method: 'POST', body: JSON.stringify({ caseId: CASE_ID, chapterId: config.chapters[0].id, expectedDraftVersion: 1 }) }), env);
  assert.equal(damaged.status, 409);
  assert.equal((await damaged.json() as { code: string }).code, 'REPORT_SOURCES_UNREADABLE');
  assert.equal(providerBodies.length, 2, 'unreadable original must not call report AI');
  assert.equal(sql.exec('SELECT content FROM preview_report_drafts')[0].values[0][0], prior);
  sql.run('UPDATE preview_ai_data_governance SET confidential_external_ai_enabled=0');
  const noConsent = await worker.fetch(request('/api/report-authoring/generate', STAFF_TOKEN, { method:'POST',body:JSON.stringify({caseId:CASE_ID,chapterId:config.chapters[1].id,expectedDraftVersion:1}) }),env);
  assert.equal(noConsent.status,403);
  assert.equal((await noConsent.json() as {code:string}).code,'REPORT_SOURCE_CONSENT_REQUIRED');
  assert.equal(providerBodies.length,2);
  sql.close();
});

test('CF18 mocked PDF transcription is unverified and partial reading prevents report generation', async () => {
  for (const mode of ['complete','partial'] as const) {
    const {sql,env,providerBodies} = await setup(mode);
    const config = await (await worker.fetch(request(`/api/report-authoring/config?caseId=${CASE_ID}`, STAFF_TOKEN),env)).json() as {chapters:Array<{id:string;chapterCode:string;title:string;promptVersion:number}>};
    const items = config.chapters.map(chapter => ({chapterId:chapter.id,chapterCode:chapter.chapterCode,chapterTitle:chapter.title,promptVersion:chapter.promptVersion,planningNote:''}));
    assert.equal((await worker.fetch(request('/api/report-authoring/outline',STAFF_TOKEN,{method:'PUT',body:JSON.stringify({caseId:CASE_ID,items,status:'CONFIRMED',expectedVersion:0})}),env)).status,200);
    const result = await worker.fetch(request('/api/report-authoring/generate',STAFF_TOKEN,{method:'POST',body:JSON.stringify({caseId:CASE_ID,chapterId:config.chapters[0].id,expectedDraftVersion:0})}),env);
    assert.equal(result.status,mode === 'complete' ? 200 : 409);
    assert.equal(providerBodies.length,mode === 'complete' ? 2 : 1);
    if(mode === 'complete') {
      assert.match(JSON.stringify(providerBodies[1]),/PDF 인식 모의 원문 4729/u);
      assert.match(JSON.stringify(providerBodies[1]),/GEMINI_UNVERIFIED_TRANSCRIPTION/u);
    } else assert.equal((await result.json() as {code:string}).code,'REPORT_SOURCES_UNREADABLE');
    const repeated = await worker.fetch(request('/api/report-authoring/generate',STAFF_TOKEN,{method:'POST',body:JSON.stringify({caseId:CASE_ID,chapterId:config.chapters[0].id,expectedDraftVersion:0})}),env);
    assert.equal(repeated.status,mode === 'complete' ? 200 : 409);
    assert.equal(providerBodies.length,mode === 'complete' ? 3 : 2,'successful OCR reused; partial OCR is not cached');
    if(mode === 'complete') {
      assert.match(JSON.stringify(providerBodies[2]),/NOT_REVIEWED/);
      sql.run('UPDATE preview_ai_data_governance SET confidential_external_ai_enabled=0');
      const revoked = await worker.fetch(request('/api/report-authoring/generate',STAFF_TOKEN,{method:'POST',body:JSON.stringify({caseId:CASE_ID,chapterId:config.chapters[0].id,expectedDraftVersion:0})}),env);
      assert.equal(revoked.status,403);
      assert.equal(providerBodies.length,3,'cached OCR cannot bypass revoked consent');
    }
    sql.close();
  }
});

async function confirmedChapter(env: CloudflareEnv): Promise<string> {
  const config = await (await worker.fetch(request(`/api/report-authoring/config?caseId=${CASE_ID}`,STAFF_TOKEN),env)).json() as {chapters:Array<{id:string;chapterCode:string;title:string;promptVersion:number}>};
  const items=config.chapters.map(chapter=>({chapterId:chapter.id,chapterCode:chapter.chapterCode,chapterTitle:chapter.title,promptVersion:chapter.promptVersion,planningNote:''}));
  assert.equal((await worker.fetch(request('/api/report-authoring/outline',STAFF_TOKEN,{method:'PUT',body:JSON.stringify({caseId:CASE_ID,items,status:'CONFIRMED',expectedVersion:0})}),env)).status,200);
  return config.chapters[0].id;
}

test('CF18 catalog failures block generation rather than masquerading as no evidence',async()=>{
  for(const table of ['preview_case_evidence','preview_google_case_evidence','preview_evidence_versions']) {
    const {sql,env,providerBodies}=await setup();
    const chapterId=await confirmedChapter(env);
    const prepare=env.DB!.prepare.bind(env.DB);
    env.DB!.prepare=(query:string)=>{if(query.includes(`FROM ${table} WHERE`))throw new Error('synthetic database unavailable');return prepare(query);};
    const result=await worker.fetch(request('/api/report-authoring/generate',STAFF_TOKEN,{method:'POST',body:JSON.stringify({caseId:CASE_ID,chapterId,expectedDraftVersion:0})}),env);
    assert.equal(result.status,503,table);
    assert.equal((await result.json() as {code:string}).code,'REPORT_SOURCE_CATALOG_UNAVAILABLE');
    assert.equal(providerBodies.length,0);
    if(table !== 'preview_evidence_versions') {
      const config=await (await worker.fetch(request(`/api/report-authoring/config?caseId=${CASE_ID}`,STAFF_TOKEN),env)).json() as {sourceGroups:Array<{code:string;status:string;lookupFailed:boolean;detail:string}>};
      const evidence=config.sourceGroups.find(group=>group.code==='EVIDENCE')!;
      assert.equal(evidence.status,'PARTIAL');assert.equal(evidence.lookupFailed,true);assert.match(evidence.detail,/조회 실패/);
    }
    sql.close();
  }
});

test('CF18 keeps historical source versions without treating them as the current contract',async()=>{
  const {sql,env,providerBodies}=await setup();
  const chapterId=await confirmedChapter(env);
  sql.exec(migration('0058_cf104_evidence_versions.sql').split('CREATE TABLE IF NOT EXISTS preview_evidence_upload_reviews')[0]);
  const oldId='50000000-0000-4000-8000-000000000018',newId='50000000-0000-4000-8000-000000000019';
  sql.run('INSERT INTO preview_case_evidence SELECT ?,organization_id,case_id,category,?,mime_type,byte_size,sha256,chunk_count,storage_provider,uploaded_by_id,uploaded_by_name,uploaded_at,?,request_fingerprint FROM preview_case_evidence WHERE id=?',[newId,'current-contract.txt','cf18-new-version',oldId]);
  sql.run('INSERT INTO preview_case_evidence_chunks SELECT ?,chunk_index,byte_size,payload FROM preview_case_evidence_chunks WHERE evidence_id=?',[newId,oldId]);
  sql.run('INSERT INTO preview_evidence_versions (evidence_id,organization_id,case_id,category,group_id,version_num,is_latest) VALUES (?,?,?,?,?,1,1)',[oldId,'concost',CASE_ID,'TAKEOFF_SOURCE',oldId]);
  sql.run('INSERT INTO preview_evidence_versions (evidence_id,organization_id,case_id,category,group_id,version_num,is_latest,supersedes_id) VALUES (?,?,?,?,?,2,1,?)',[newId,'concost',CASE_ID,'TAKEOFF_SOURCE',oldId,oldId]);
  const result=await worker.fetch(request('/api/report-authoring/generate',STAFF_TOKEN,{method:'POST',body:JSON.stringify({caseId:CASE_ID,chapterId,expectedDraftVersion:0})}),env);
  assert.equal(result.status,200);
  const contents=providerBodies[0].contents as Array<{parts:Array<{text:string}>}>;
  const context=JSON.parse(contents[0].parts[0].text.split('\n').at(-1)!) as {reportGrounding:{sources:Array<{sourceId:string;sourceRole:string;versionNumber:number}>}};
  assert.equal(context.reportGrounding.sources.find(source=>source.sourceId===oldId)?.sourceRole,'HISTORICAL_VERSION');
  assert.equal(context.reportGrounding.sources.find(source=>source.sourceId===newId)?.sourceRole,'CURRENT_REGISTERED_VERSION');
  assert.equal(context.reportGrounding.sources.find(source=>source.sourceId===newId)?.versionNumber,2);
  assert.equal(sql.exec('SELECT COUNT(*) FROM preview_case_evidence')[0].values[0][0],2,'historical originals are preserved');
  sql.close();
});

test('CF18 DB and UI prevent outline tampering and expose source readiness honestly', async () => {
  const { sql } = await setup();
  const now = new Date().toISOString();
  const claimType = String(sql.exec(`SELECT claim_type FROM preview_cases WHERE id='${CASE_ID}'`)[0].values[0][0]);
  const prompt = sql.exec(`SELECT p.id,p.chapter_code,p.version FROM preview_report_chapter_prompts p JOIN preview_report_prompt_sets s ON s.id=p.prompt_set_id WHERE s.claim_type='${claimType}' ORDER BY p.ordinal LIMIT 1`)[0].values[0];
  const oneItem = JSON.stringify([{ chapterId: String(prompt[0]), chapterCode: String(prompt[1]), chapterTitle: '검증용 목차 제목', promptVersion: Number(prompt[2]), planningNote: '' }]);
  assert.throws(() => sql.run('INSERT INTO preview_report_outline_plans VALUES (?,?,?,?,?,?,?,?,?)', [CASE_ID, 'concost', claimType, oneItem, 'CONFIRMED', 1, STAFF_ID, now, now]), /omits an approved chapter/u);
  assert.equal(sql.exec('SELECT COUNT(*) FROM preview_report_outline_plans')[0].values[0][0], 0);
  const studio = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'routes', 'PreviewReportStudio.tsx'), 'utf8');
  const css = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'routes', 'PreviewReportStudio.css'), 'utf8');
  assert.match(studio, /renderStageHeader\(1\)/u);
  assert.match(studio, /report-stage-section report-source-readiness/u);
  assert.match(studio, /참고자료 준비상태/u);
  assert.match(studio, /'변경 목차 다시 확정' : '목차 확정'/u); assert.match(studio, /outlineStatus !== 'CONFIRMED'/u);
  assert.match(studio, /파일 본문을 확인하지 못한 내용은 추측하지 않고/u);
  assert.match(studio, /\[확인 필요\]/u);
  assert.doesNotMatch(studio, /report-chapter-source-pack/u); assert.match(studio, /report-draft-context/u); assert.match(css, /report-source-grid/u);
  sql.close();
});
