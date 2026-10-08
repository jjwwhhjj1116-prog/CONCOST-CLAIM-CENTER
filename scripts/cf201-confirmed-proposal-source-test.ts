import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test, { after } from 'node:test';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import initSqlJs, { type Database } from 'sql.js';
import currentWorker, { type CloudflareEnv } from '../apps/cloudflare/src/index';
import { encryptSecret } from '../apps/cloudflare/src/google-drive';
import { normalizeReportAiContent, validateReportAiImprovement } from '../packages/document-engine/src/report-ai-content';

const CASE_ID = '40000000-0000-4000-8000-000000000010';
const OTHER_CASE = '40000000-0000-4000-8000-000000000211';
const ADMIN = '00000000-0000-4000-8000-000000000201';
const TOKEN = 'cf201-synthetic-admin-session';
const PROPOSAL = '40000000-0000-4000-8000-000000000201';
const VERSION = '50000000-0000-4000-8000-000000000201';
const ORGANIZATION_KEY = 'AIza_CF201_ORGANIZATION_SYNTHETIC_ONLY_12345';
const PERSONAL_KEY = 'AIza_CF201_PERSONAL_SYNTHETIC_ONLY_123456789';
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const originalFetch = globalThis.fetch;
let unmockedFetchCalls = 0;
const blockedExternalFetch: typeof fetch = async () => { unmockedFetchCalls++; throw new Error('CF201 test forbids unmocked external IO'); };
globalThis.fetch = blockedExternalFetch; // This isolated Node test process only; provider mocks remain the sole allowed IO.
after(() => { globalThis.fetch = originalFetch; assert.equal(unmockedFetchCalls, 0, 'No unmocked external fetch may be attempted'); });
const legacy = process.env.CF201_USE_PREVIOUS_INDEX === '1';
const indexPath = resolve('apps/cloudflare/src/index.ts');
const worker: typeof currentWorker = legacy ? (() => {
  const source = execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, 'show', 'f6371f9:apps/cloudflare/src/index.ts'], { encoding: 'utf8' });
  assert.ok(!source.includes('async function previewReportConfirmedProposals'), 'The before proof must use the actual prior index');
  const compiled = transpileModule(source, { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} as { default: typeof currentWorker } };
  runInNewContext(compiled, { module, exports: module.exports, require: createRequire(indexPath), console, crypto, fetch: blockedExternalFetch, Request, Response, Headers, URL, Blob, File, FormData, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, AbortController, AbortSignal, ReadableStream, TransformStream, DecompressionStream, btoa, atob, setTimeout, clearTimeout, Buffer }, { filename: 'cf201-actual-before-index.js' });
  return module.exports.default;
})() : currentWorker;

class Statement {
  private values: unknown[] = [];
  constructor(private readonly db: Database, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>(): Promise<T | null> { const statement = this.db.prepare(this.sql); try { statement.bind(this.values as any[]); return statement.step() ? statement.getAsObject() as T : null; } finally { statement.free(); } }
  async all<T>(): Promise<{ results: T[] }> { const statement = this.db.prepare(this.sql), results: T[] = []; try { statement.bind(this.values as any[]); while (statement.step()) results.push(statement.getAsObject() as T); return { results }; } finally { statement.free(); } }
  async run() { this.db.run(this.sql, this.values as any[]); return { success: true, meta: { changes: this.db.getRowsModified() } }; }
}
class D1 {
  failInternalLookup = false;
  constructor(readonly database: Database) {}
  prepare(sql: string) { if (this.failInternalLookup && sql.includes('FROM preview_proposals p JOIN preview_cases c')) throw new Error('CF201 synthetic internal query failure'); return new Statement(this.database, sql); }
  async batch(statements: Statement[]) { this.database.run('BEGIN IMMEDIATE'); try { const results = []; for (const statement of statements) results.push(await statement.run()); this.database.run('COMMIT'); return results; } catch (reason) { this.database.run('ROLLBACK'); throw reason; } }
}
type Capture = { input: string; body: Record<string, unknown>; key: string; provider: string };
type Scenario = 'valid' | 'draft' | 'in-review' | 'pointer' | 'version-case' | 'other-case' | 'organization' | 'catalog-deleted' | 'body-hash' | 'input-hash' | 'invalid-snapshot' | 'lookup-failure' | 'old-schema' | 'long-outline';

async function setup(scenario: Scenario = 'valid') {
  const SQL = await initSqlJs(), sql = new SQL.Database(); sql.run('PRAGMA foreign_keys=ON');
  for (const name of ['0001_cf_foundation.sql', '0001_cf02_preview_drafts.sql', '0002_cf03_preview_evidence.sql', '0003_cf04_preview_auth.sql', '0004_cf05_google_drive.sql', '0005_cf06_case_operations.sql']) sql.exec(read('apps/cloudflare/migrations/' + name));
  const now = new Date().toISOString();
  sql.run('INSERT INTO preview_users VALUES (?,?,?,?,?,?,?,?,1,?)', [ADMIN, 'cf201-synthetic', '1'.repeat(32), '2'.repeat(64), 100000, 'CF201 합성 관리자', 'cf201@example.invalid', '["admin"]', now]);
  sql.exec(read('apps/cloudflare/migrations/0010_cf10_product_experience.sql'));
  for (const name of ['0006_cf07_report_studio_drafts.sql', '0007_cf08_report_review_approval.sql', '0008_cf09_final_output.sql', '0009_cf09_output_actor_scope.sql', '0011_cf11_project_workflow.sql', '0012_cf12_report_ai_prompts.sql', '0013_cf13_litigation_records.sql', '0014_cf14_proposal_award_workflow.sql', '0017_cf19_multi_provider_ai.sql', '0018_cf26_ai_credentials.sql', '0024_cf32_source_template_library.sql', '0025_cf33_type_authoring_guidelines.sql', '0047_cf72_project_members_calendar.sql']) sql.exec(read('apps/cloudflare/migrations/' + name));
  if (scenario !== 'old-schema') for (const name of ['0019_cf27_proposal_authoring.sql', '0040_cf52_hermes_bridge_intake_catalog.sql']) sql.exec(read('apps/cloudflare/migrations/' + name));
  const governance = read('apps/cloudflare/migrations/0032_cf40_pm_schedule_ai_import_security.sql');
  sql.exec(governance.slice(governance.indexOf('CREATE TABLE preview_ai_data_governance'), governance.indexOf('CREATE INDEX idx_preview_stage_schedules_case')));
  sql.run("UPDATE preview_ai_data_governance SET provider_service_tier='PAID_NO_PRODUCT_IMPROVEMENT',confidential_external_ai_enabled=1,acknowledged_by=?,acknowledged_at=?", [ADMIN, now]);
  sql.run("UPDATE preview_report_ai_routes SET provider_kind='GEMINI',model_code='gemini-3.6-flash',secret_name='GEMINI_API_KEY',version=version+1,updated_at=? WHERE task_kind='OUTLINE_PLANNING'", [new Date(Date.now() + 1000).toISOString()]);
  sql.run('INSERT INTO preview_sessions VALUES (?,?,?,?)', [sha(TOKEN), ADMIN, now, new Date(Date.now() + 3600000).toISOString()]);
  const captures: Capture[] = [];
  const provider: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const text = body.contents ? (body.contents as Array<{ parts: Array<{ text?: string }> }>).flatMap(item => item.parts.map(part => part.text ?? '')).join('\n') : String(body.input ?? '');
    captures.push({ input: text, body, key: new Headers(init?.headers).get('x-goog-api-key') ?? '', provider: String(input) });
    const approved = text.match(/\[승인 챕터\]\n([^\n]+)/u)?.[1];
    const output = approved ? JSON.stringify({ chapters: (JSON.parse(approved) as Array<{ chapterCode: string; title: string }>).map(item => ({ chapterCode: item.chapterCode, chapterTitle: item.title, planningNote: '합성 기록의 작성 범위와 확인 필요 자료만 대조' })) }) : '## 합성 기록 검토\n\n제공된 작성 기록의 범위를 대조합니다. [확인 필요]';
    return new Response(JSON.stringify(body.contents ? { candidates: [{ content: { parts: [{ text: output }] } }] } : { output_text: output }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const d1 = new D1(sql), env: CloudflareEnv = { DB: d1 as unknown as NonNullable<CloudflareEnv['DB']>, GEMINI_API_KEY: ORGANIZATION_KEY, OPENAI_API_KEY: 'CF201_OPENAI_SYNTHETIC_ONLY', GEMINI_TEST_FETCH: provider, OPENAI_TEST_FETCH: provider, AI_CREDENTIAL_MASTER_KEY: 'c'.repeat(64) };
  const credential = await encryptSecret(PERSONAL_KEY, 'c'.repeat(64), `claim-center:ai-credential:v1:concost:USER:${ADMIN}:GEMINI`);
  sql.run('INSERT INTO preview_ai_credentials VALUES (?,?,?,?,?,?,?,?,1,?,?,?)', ['concost', 'USER', ADMIN, 'GEMINI', credential.ciphertextHex, credential.ivHex, sha(PERSONAL_KEY), 'ACTIVE', ADMIN, now, now]);
  const chapters = Array.from({ length: 12 }, (_, index) => ({ number: index + 1, title: `합성 ${index + 1}장`, body: `CF201 immutable chapter ${index + 1}`, kind: index < 3 ? 'VARIABLE' : 'FIXED' }));
  if (scenario === 'long-outline') chapters[0].body = 'CF201 합성 장문 '.repeat(7000);
  const inputs = { clientName: 'CF201 합성 발주처', projectTitle: 'CF201 고객 없는 시험 프로젝트', subtitle: '합성 작성 기록', submissionDate: '2026-10-08', keyIssues: 'CF201 고유 쟁점 원문', objective: 'CF201 목적 원문', planNotes: 'CF201 수행 범위·계획 원문', exclusions: '실제 계약 사실과 무관', chapters: scenario === 'invalid-snapshot' ? chapters.slice(0, 11) : chapters };
  const structured = JSON.stringify(inputs), bodyText = chapters.map(item => `# ${item.number}. ${item.title}\n\n${item.body}`).join('\n\n');
  if (scenario !== 'old-schema') {
    sql.run('INSERT INTO preview_cases (id,organization_id,case_number,title,description,claim_type,status,version,category_major,category_middle,category_minor,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [OTHER_CASE, 'concost', 'CF201-OTHER-CASE', '다른 합성 사건', '', 'TYPE-03', 'CONTRACT', 1, '건설클레임', '일반클레임', '합성', ADMIN, now, now]);
    if (scenario === 'organization') sql.exec('DROP TRIGGER preview_proposal_insert_guard'); // Only this owned memory corruption fixture; production schema unchanged.
    const proposalCase = scenario === 'other-case' ? OTHER_CASE : CASE_ID;
    sql.run('INSERT INTO preview_proposals VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [PROPOSAL, scenario === 'organization' ? 'other-org' : 'concost', proposalCase, 'CF201-SYNTHETIC', 'CF201 immutable template', 'CF201 template body', 'CF201 내부 확정 제안서', scenario === 'draft' ? 'DRAFT' : scenario === 'in-review' ? 'IN_REVIEW' : 'APPROVED', VERSION, scenario === 'pointer' ? '50000000-0000-4000-8000-000000000299' : VERSION, 1, ADMIN, now, now]);
    sql.run('INSERT INTO preview_proposal_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [VERSION, PROPOSAL, scenario === 'version-case' ? OTHER_CASE : proposalCase, 1, bodyText, structured, 'MANUAL', null, null, scenario === 'input-hash' ? '0'.repeat(64) : sha(structured), '[]', '[]', scenario === 'body-hash' ? '0'.repeat(64) : sha(bodyText), 0, ADMIN, now]);
    if (scenario === 'catalog-deleted') sql.run('INSERT INTO preview_catalog_records (record_kind,record_id,organization_id,db_deleted,version,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', ['PROPOSAL', PROPOSAL, 'concost', 1, 1, ADMIN, now, now]);
  }
  if (scenario === 'lookup-failure') d1.failInternalLookup = true;
  return { sql, d1, env, captures, bodyText, structured, inputs };
}
const request = (path: string, body?: unknown) => new Request('https://cf201.example.invalid' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Session-Token': TOKEN, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function configuration(env: CloudflareEnv) {
  const response = await worker.fetch(request(`/api/report-authoring/config?caseId=${CASE_ID}`), env);
  assert.equal(response.status, 200, await response.clone().text());
  const config = await response.json() as { sourceGroups: Array<{ code: string; status: string; itemCount: number; lookupFailed: boolean }>; chapters: Array<{ id: string }> };
  const proposal = config.sourceGroups.find(group => group.code === 'PROPOSAL'); assert.ok(proposal);
  return { config, proposal };
}
function capturedContext(capture: Capture): Record<string, any> { const start = capture.input.lastIndexOf('\n{"case":'); assert.ok(start >= 0, 'Actual provider input must contain the full serialized same-case context'); return JSON.parse(capture.input.slice(start + 1)); }

test('CF201 internal approved snapshot makes readiness and real chapter AI context agree without changing proposal bytes', async () => {
  const f = await setup();
  try {
    const before = f.sql.exec('SELECT * FROM preview_proposal_versions');
    const { config, proposal } = await configuration(f.env);
    assert.equal(proposal.status, 'READY'); assert.equal(proposal.itemCount, 1); assert.equal(proposal.lookupFailed, false);
    const response = await worker.fetch(request('/api/report-authoring/generate', { caseId: CASE_ID, chapterId: config.chapters[0].id, expectedDraftVersion: 0 }), f.env);
    assert.equal(response.status, 200, await response.clone().text()); assert.equal(f.captures.length, 1);
    const context = capturedContext(f.captures[0]), snapshot = context.proposalWorkflow.confirmedInternalProposalSnapshots;
    assert.equal(snapshot.length, 1); assert.equal(context.proposalWorkflow.verifiedProposalSnapshots.length, 0);
    assert.equal(snapshot[0].sourceKind, 'INTERNAL_CONFIRMED_PROPOSAL'); assert.equal(snapshot[0].sourceId, VERSION);
    assert.equal(snapshot[0].bodyText, f.bodyText); assert.equal(snapshot[0].documentSha256, sha(f.bodyText)); assert.equal(snapshot[0].inputSha256, sha(f.structured));
    assert.equal(snapshot[0].keyIssues, f.inputs.keyIssues); assert.equal(snapshot[0].planNotes, f.inputs.planNotes);
    assert.match(snapshot[0].sourceBoundary, /not independent proof/u); assert.equal(f.captures[0].key, ORGANIZATION_KEY);
    assert.deepEqual(f.sql.exec('SELECT * FROM preview_proposal_versions'), before); assert.equal(before[0].values[0][13], 0, 'The legacy is_approved field is not the approval pointer');
    const inputHash = f.sql.exec('SELECT input_sha256 FROM preview_report_ai_generations')[0].values[0][0];
    assert.equal(inputHash, sha(JSON.stringify(context)), 'Report generation audit hashes the same context actually sent to the mocked provider');
  } finally { f.sql.close(); }
});

test('CF201 excluded draft, review, pointer, other-case, organization and catalog-deleted snapshots never enter readiness or AI', async () => {
  for (const scenario of ['draft', 'in-review', 'pointer', 'version-case', 'other-case', 'organization', 'catalog-deleted', 'old-schema'] as Scenario[]) {
    const f = await setup(scenario);
    try {
      const { config, proposal } = await configuration(f.env); assert.equal(proposal.status, 'EMPTY', scenario); assert.equal(proposal.itemCount, 0); assert.equal(proposal.lookupFailed, false);
      const generated = await worker.fetch(request('/api/report-authoring/generate', { caseId: CASE_ID, chapterId: config.chapters[0].id, expectedDraftVersion: 0 }), f.env);
      assert.equal(generated.status, 200, scenario + ': ' + await generated.clone().text());
      const context = capturedContext(f.captures[0]); assert.deepEqual(context.proposalWorkflow.confirmedInternalProposalSnapshots, [], scenario); assert.deepEqual(context.proposalWorkflow.proposalSourceErrors, []);
      assert.ok(!f.captures[0].input.includes('CF201 immutable chapter 1'), scenario + ': excluded source must not leak');
    } finally { f.sql.close(); }
  }
});

test('CF201 corrupted body/input hashes, invalid snapshot and database lookup failures are PARTIAL and block both AI consumers', async () => {
  for (const scenario of ['body-hash', 'input-hash', 'invalid-snapshot', 'lookup-failure'] as Scenario[]) {
    const f = await setup(scenario);
    try {
      const { config, proposal } = await configuration(f.env); assert.equal(proposal.status, 'PARTIAL', scenario); assert.equal(proposal.itemCount, 0); assert.equal(proposal.lookupFailed, true);
      for (const [path, body] of [['/api/report-authoring/generate', { caseId: CASE_ID, chapterId: config.chapters[0].id, expectedDraftVersion: 0 }], ['/api/report-authoring/outline/generate', { caseId: CASE_ID }]] as const) {
        const response = await worker.fetch(request(path, body), f.env); assert.equal(response.status, 503, scenario + ': ' + await response.clone().text()); assert.equal((await response.json() as { code: string }).code, 'REPORT_PROPOSAL_SOURCES_UNAVAILABLE');
      }
      assert.deepEqual(f.captures, []);
    } finally { f.sql.close(); }
  }
});

test('CF201 confidential consent, Gemini-only route and organization key are required for outline and chapter source transmission', async () => {
  for (const fault of ['consent', 'provider', 'organization-key']) {
    const f = await setup();
    try {
      if (fault === 'consent') f.sql.run('UPDATE preview_ai_data_governance SET confidential_external_ai_enabled=0');
      if (fault === 'provider') f.sql.run("UPDATE preview_report_ai_routes SET provider_kind='OPENAI',model_code='gpt-5.6',secret_name='OPENAI_API_KEY',version=version+1,updated_at=?", [new Date(Date.now() + 2000).toISOString()]);
      if (fault === 'organization-key') delete f.env.GEMINI_API_KEY;
      const { config } = await configuration(f.env);
      for (const [path, body] of [['/api/report-authoring/generate', { caseId: CASE_ID, chapterId: config.chapters[0].id, expectedDraftVersion: 0 }], ['/api/report-authoring/outline/generate', { caseId: CASE_ID }]] as const) {
        const response = await worker.fetch(request(path, body), f.env), result = await response.json() as { code: string };
        assert.equal(response.status, fault === 'consent' ? 403 : fault === 'provider' ? 409 : 503, fault + ': ' + JSON.stringify(result));
        assert.equal(result.code, fault === 'consent' ? 'REPORT_SOURCE_CONSENT_REQUIRED' : fault === 'provider' ? 'REPORT_SOURCE_PROVIDER_NOT_APPROVED' : 'REPORT_SOURCE_CREDENTIAL_REQUIRED');
      }
      assert.deepEqual(f.captures, [], 'All providers are mocks and none may be called through a forbidden boundary');
    } finally { f.sql.close(); }
  }
});

test('CF201 allowed outline source uses the organization key instead of the personal key, and over-budget context is not sliced', async () => {
  const f = await setup();
  try {
    const response = await worker.fetch(request('/api/report-authoring/outline/generate', { caseId: CASE_ID }), f.env);
    assert.equal(response.status, 200, await response.clone().text()); assert.equal(f.captures.length, 1); assert.equal(f.captures[0].key, ORGANIZATION_KEY);
    const context = capturedContext(f.captures[0]); assert.equal(context.proposalWorkflow.confirmedInternalProposalSnapshots[0].bodyText, f.bodyText);
  } finally { f.sql.close(); }
  const long = await setup('long-outline');
  try {
    const response = await worker.fetch(request('/api/report-authoring/outline/generate', { caseId: CASE_ID }), long.env);
    assert.equal(response.status, 413, await response.clone().text()); assert.equal((await response.json() as { code: string }).code, 'REPORT_CONTEXT_TOO_LARGE'); assert.deepEqual(long.captures, []);
  } finally { long.sql.close(); }
});

test('CF201 actual project-context handler carries caseId even when there is no workflow project', () => {
  const source = read('apps/web/src/routes/PreviewReportStudio.tsx');
  const expression = source.match(/const withProjectContext = (\(route: string\) => \{[\s\S]*?\n  \});/u)?.[1]; assert.ok(expression);
  const compiled = transpileModule(`(${expression})`, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
  for (const selectedWorkflowProject of [undefined, { id: 'CF201-project' }]) {
    const handler = runInNewContext(compiled, { window: { location: { origin: 'https://cf201.example.invalid' } }, URL, selectedWorkflowProject, selectedCaseId: CASE_ID }) as (route: string) => string;
    const url = new URL(handler('/proposals/editor?preserve=1&caseId=stale'), 'https://cf201.example.invalid');
    assert.equal(url.searchParams.get('caseId'), CASE_ID); assert.equal(url.searchParams.get('preserve'), '1'); assert.equal(url.searchParams.get('projectId'), selectedWorkflowProject?.id ?? null);
  }
});

test('CF201 confirmed proposal source diagnostics never become newly generated or improved report prose', () => {
  for (const token of ['confirmedInternalProposalSnapshots', 'proposalSourceErrors', 'INTERNAL_CONFIRMED_PROPOSAL', 'sourceBoundary']) {
    assert.throws(() => normalizeReportAiContent(`## 검토\n${token} 자료를 사용합니다.`), /내부 데이터·코드/u);
    assert.throws(() => validateReportAiImprovement('합성 기존 본문', `합성 기존 본문\n${token}`), /내부 데이터·코드/u);
  }
  const prose = '제안서의 확정된 작성 범위는 확인했으나 실제 계약의 효력과 수량·금액은 별도 자료가 필요합니다.';
  assert.equal(normalizeReportAiContent(prose), prose);
  assert.equal(validateReportAiImprovement(prose, prose), prose);
});
