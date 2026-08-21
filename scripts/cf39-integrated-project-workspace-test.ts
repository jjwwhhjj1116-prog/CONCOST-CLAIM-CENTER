import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const PM_ID = '00000000-0000-4000-8000-000000000002';
const REVIEWER_ID = '00000000-0000-4000-8000-000000000004';
const STAFF_ID = '00000000-0000-4000-8000-000000000039';
const CASE_ID = '40000000-0000-4000-8000-000000000010';
const ADMIN_TOKEN = 'cf39-admin-session-token';
const PM_TOKEN = 'cf39-pm-session-token';
const REVIEWER_TOKEN = 'cf39-reviewer-session-token';
const STAFF_TOKEN = 'cf39-staff-session-token';

const migrations = [
  '0001_cf_foundation.sql','0001_cf02_preview_drafts.sql','0002_cf03_preview_evidence.sql','0003_cf04_preview_auth.sql','0004_cf05_google_drive.sql','0005_cf06_case_operations.sql',
  '0006_cf07_report_studio_drafts.sql','0007_cf08_report_review_approval.sql','0008_cf09_final_output.sql','0009_cf09_output_actor_scope.sql','0010_cf10_product_experience.sql',
  '0011_cf11_project_workflow.sql','0012_cf12_report_ai_prompts.sql','0013_cf13_litigation_records.sql','0014_cf14_proposal_award_workflow.sql','0015_cf15_case_evidence_library.sql',
  '0016_cf18_report_outline_evidence.sql','0017_cf19_multi_provider_ai.sql','0018_cf26_ai_credentials.sql','0019_cf27_proposal_authoring.sql','0020_cf28_workspace_settings.sql',
  '0021_cf29_report_memory_learning.sql','0022_cf30_settings_template_preview.sql','0023_cf31_google_oauth_app_settings.sql','0024_cf32_source_template_library.sql','0025_cf33_type_authoring_guidelines.sql',
  '0026_cf34_hermes_memory_architecture.sql','0027_cf35_guided_workspace.sql','0028_cf36_workflow_integrity_tutorial_approval_intake.sql','0029_cf37_report_workspace_resume.sql',
  '0030_cf38_admin_account_management.sql','0031_cf39_integrated_project_workspace.sql','0032_cf40_pm_schedule_ai_import_security.sql'
];

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
  async run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }> { this.database.run(this.sql, this.values as any[]); const row = this.database.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0]; return { success: true, meta: { changes: this.database.getRowsModified(), last_row_id: Number(row ?? 0) } }; }
}

class SqlD1 {
  constructor(readonly database: Database) {}
  prepare(sql: string): SqlStatement { return new SqlStatement(this.database, sql); }
  async batch(statements: SqlStatement[]): Promise<unknown[]> { this.database.run('BEGIN IMMEDIATE'); try { const results = []; for (const statement of statements) results.push(await statement.run()); this.database.run('COMMIT'); return results; } catch (error) { this.database.run('ROLLBACK'); throw error; } }
}

function migration(name: string): string { return readFileSync(join(process.cwd(), 'apps', 'cloudflare', 'migrations', name), 'utf8'); }
function request(path: string, token: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('X-Session-Token', token);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  return new Request(`https://preview.example${path}`, { ...init, headers });
}
function evidenceForm(category: string, name: string, mimeType: string, bytes: number[]): FormData {
  const form = new FormData();
  form.set('category', category);
  form.set('file', new File([Uint8Array.from(bytes).buffer], name, { type: mimeType }));
  return form;
}

async function setup(): Promise<{ sql: Database; env: CloudflareEnv }> {
  const SQL = await initSqlJs();
  const sql = new SQL.Database();
  sql.run('PRAGMA foreign_keys=ON');
  const now = '2026-08-21T00:00:00.000Z';
  for (const name of migrations) {
    sql.exec(migration(name));
    if (name === '0009_cf09_output_actor_scope.sql') {
      const add = (id: string, login: string, label: string, roles: string) => sql.run(
        'INSERT INTO preview_users (id,login_id,password_salt,password_hash,password_iterations,display_name,email,roles_json,is_active,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)',
        [id, login, '1'.repeat(32), '2'.repeat(64), 100000, label, `${login}@example.invalid`, roles, now]
      );
      add(ADMIN_ID, 'admin', '관리자', '["admin"]');
      add(PM_ID, 'pm', '프로젝트 PM', '["pm"]');
      add(REVIEWER_ID, 'reviewer', '검토자', '["reviewer"]');
      add(STAFF_ID, 'staff-cf39', '프로젝트 Staff', '["staff"]');
    }
  }
  for (const userId of [PM_ID, REVIEWER_ID, STAFF_ID]) sql.run('INSERT OR IGNORE INTO preview_case_assignments (case_id,user_id,assigned_by,assigned_at) VALUES (?,?,?,?)', [CASE_ID, userId, ADMIN_ID, now]);
  for (const [token, userId] of [[ADMIN_TOKEN, ADMIN_ID], [PM_TOKEN, PM_ID], [REVIEWER_TOKEN, REVIEWER_ID], [STAFF_TOKEN, STAFF_ID]] as const) {
    sql.run('INSERT INTO preview_sessions VALUES (?,?,?,?)', [await sha256(token), userId, now, '2099-01-01T00:00:00.000Z']);
  }
  const geminiFetch: typeof fetch = async () => new Response(JSON.stringify({
    status: 'completed',
    steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ summary: '현장 범위와 제출 일정에 합의했습니다.', timeline: [{ title: '범위 확정', detail: '발주처 제공자료 확인 후 현장조사 범위를 확정합니다.' }, { title: '후속 업무', detail: 'PM이 다음 회의 전 자료 목록을 확인합니다.' }] }) }] }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return { sql, env: { DB: new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']>, GEMINI_API_KEY: 'AQ.SYNTHETIC_CF39_ORGANIZATION_KEY', GEMINI_TEST_FETCH: geminiFetch } };
}

test('CF39 all assigned login roles upload project-wide evidence categories and immutable attribution survives listing', async () => {
  const { sql, env } = await setup();
  const meeting = await worker.fetch(request(`/api/cases/${CASE_ID}/evidence`, STAFF_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf39-meeting-recording-0001' }, body: evidenceForm('MEETING_RECORDING', 'kickoff.mp3', 'audio/mpeg', [0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x41]) }), env);
  assert.equal(meeting.status, 201);
  assert.equal((await meeting.json() as any).file.category, 'MEETING_RECORDING');
  const final = await worker.fetch(request(`/api/cases/${CASE_ID}/evidence`, REVIEWER_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf39-final-deliverable-0001' }, body: evidenceForm('FINAL_DELIVERABLE', 'approved-report.pdf', 'application/pdf', [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]) }), env);
  assert.equal(final.status, 201);
  const rows = sql.exec('SELECT category,workflow_category,uploaded_by_id FROM preview_case_evidence ORDER BY uploaded_at');
  assert.deepEqual(rows[0].values.map((row) => [row[0], row[1]]), [['TAKEOFF_SOURCE', 'MEETING_RECORDING'], ['TAKEOFF_SOURCE', 'FINAL_DELIVERABLE']]);
  assert.deepEqual(rows[0].values.map((row) => row[2]), [STAFF_ID, REVIEWER_ID]);
  const list = await worker.fetch(request(`/api/cases/${CASE_ID}/evidence`, PM_TOKEN), env);
  const body = await list.json() as any;
  assert.equal(body.phase, 'CF39_INTEGRATED_PROJECT_EVIDENCE');
  assert.deepEqual(new Set(body.files.map((file: any) => file.category)), new Set(['MEETING_RECORDING', 'FINAL_DELIVERABLE']));
  assert.equal(Object.keys(body.categories).length, 13);
  assert.throws(() => sql.run("UPDATE preview_case_evidence SET workflow_category='COURT_DOCUMENT'"), /append-only/u);
  sql.close();
});

test('CF39 kickoff notes use the Admin organization Gemini route and persist a safe meeting timeline', async () => {
  const { sql, env } = await setup();
  const current = Number(sql.exec('SELECT COALESCE(version,0) FROM preview_workflow_kickoffs WHERE case_id=?', [CASE_ID])[0]?.values[0]?.[0] ?? 0);
  const save = await worker.fetch(request(`/api/cases/${CASE_ID}/workflow/kickoff`, PM_TOKEN, { method: 'PUT', body: JSON.stringify({ meetingAt: '2026-08-21T01:00:00.000Z', location: '회의실', agenda: '현장 범위와 제출 일정 협의', participantUnits: ['발주처', '클레임센터'], rawNotes: '10:00 발주처 자료 목록 확인. 10:30 PM이 현장조사 범위를 정리하기로 함.', status: 'COMPLETED', expectedVersion: current }) }), env);
  assert.equal(save.status, 200);
  const summarize = await worker.fetch(request(`/api/cases/${CASE_ID}/workflow/kickoff-summary`, PM_TOKEN, { method: 'POST', body: JSON.stringify({ expectedVersion: current + 1 }) }), env);
  assert.equal(summarize.status, 200);
  const kickoff = sql.exec('SELECT summary_text,timeline_json FROM preview_workflow_kickoffs WHERE case_id=?', [CASE_ID])[0].values[0];
  assert.match(String(kickoff[0]), /현장 범위/u);
  assert.equal(JSON.parse(String(kickoff[1])).length, 2);
  assert.match(String(sql.exec("SELECT detail_json FROM preview_workflow_events WHERE event_type='KICKOFF_DRAFT_GENERATED' ORDER BY created_at DESC LIMIT 1")[0].values[0][0]), /GEMINI:gemini-3\.7-flash:ORGANIZATION/u);
  sql.close();
});

test('CF39 proposal AI preserves the approved template and uses only the Admin organization Gemini credential', async () => {
  const { sql, env } = await setup();
  const providerBodies: Array<Record<string, unknown>> = [];
  env.GEMINI_TEST_FETCH = async (_input, init) => {
    providerBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: '승인 템플릿 구조를 유지한 건설 클레임 기술제안서 AI 초안입니다. [확인 필요]' }] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const caseResponse = await worker.fetch(request(`/api/cases/${CASE_ID}`, PM_TOKEN), env);
  const project = (await caseResponse.json() as any).case;
  const templatesResponse = await worker.fetch(request(`/api/proposal-templates?claimType=${encodeURIComponent(project.claimType)}`, PM_TOKEN), env);
  const template = (await templatesResponse.json() as any).templates[0];
  assert.ok(template?.id);
  const created = await worker.fetch(request(`/api/cases/${CASE_ID}/proposals`, PM_TOKEN, { method: 'POST', body: JSON.stringify({ templateId: template.id }) }), env);
  assert.equal(created.status, 201);
  const proposal = (await created.json() as any).proposal;
  const generated = await worker.fetch(request(`/api/cases/${CASE_ID}/proposals/${proposal.id}/versions`, PM_TOKEN, { method: 'POST', body: JSON.stringify({ background: '발주처 제공자료와 의뢰 녹취를 검토합니다.', objective: '클라이언트 관점의 쟁점을 정리합니다.', method: '계약문서와 현장 근거를 교차 확인합니다.', expectedOutcome: '검증 가능한 기술제안서를 작성합니다.', exclusions: '확인되지 않은 법률 판단은 제외합니다.', generationMode: 'AI', sourceDocumentVersionIds: [], version: proposal.version }) }), env);
  assert.equal(generated.status, 200);
  const version = (await generated.json() as any).proposal.versions[0];
  assert.equal(version.providerId, 'GEMINI');
  assert.equal(version.modelId, 'gemini-3.7-flash');
  assert.equal(providerBodies.length, 1);
  assert.match(String(providerBodies[0].system_instruction), /승인된 제안서 템플릿 구조/u);
  assert.match(String(providerBodies[0].input), /approvedTemplate/u);
  assert.match(String(providerBodies[0].input), /clientLegalPosition/u);
  sql.close();
});

test('CF39 judgment performance is derived only from recorded court events and final delivery has a Drive-backed finder UI', async () => {
  const { sql, env } = await setup();
  const recordPayload = { caseId: CASE_ID, courtName: '서울중앙지방법원', courtCaseNumber: '2026가합39001', caseTitle: '공사대금 청구의 소', divisionName: '민사 제39부', partiesText: '원고 발주처 / 피고 시공사', filedOn: '2026-01-01', currentStage: 'JUDGEMENT', nextHearingAt: null, verificationStatus: 'VERIFIED', officialSourceUrl: 'https://www.scourt.go.kr/portal/information/events/search' };
  const created = await worker.fetch(request('/api/litigation-records', ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf39-litigation-record-0001' }, body: JSON.stringify(recordPayload) }), env);
  assert.equal(created.status, 201);
  const recordId = (await created.json() as any).record.id;
  const event = await worker.fetch(request(`/api/litigation-records/${recordId}/events`, ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf39-judgement-event-0001' }, body: JSON.stringify({ eventType: 'JUDGEMENT', occurredAt: '2026-08-20T01:00:00.000Z', title: '1심 판결 선고', detailText: '법원 공식 기록에 판결 선고가 등록되었습니다.', verificationStatus: 'VERIFIED', officialSourceUrl: 'https://www.scourt.go.kr/portal/information/events/search', sourceSha256: 'a'.repeat(64), createCourtSchedule: false }) }), env);
  assert.equal(event.status, 200);
  const outcomes = await worker.fetch(request('/api/litigation-outcomes', PM_TOKEN), env);
  assert.equal(outcomes.status, 200);
  const outcome = (await outcomes.json() as any).outcomes.find((item: any) => item.id === recordId);
  assert.equal(outcome.outcomeStatus, 'JUDGEMENT_RECORDED');
  assert.match(outcome.performanceSummary, /공식 근거 확인/u);
  const deliverySource = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'routes', 'PreviewDeliveryCenter.tsx'), 'utf8');
  assert.match(deliverySource, /FINAL_DELIVERABLE/u);
  assert.match(deliverySource, /Drive에서 열기|Google Drive/u);
  const outcomeSource = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'routes', 'PreviewOutcomeCenter.tsx'), 'utf8');
  assert.match(outcomeSource, /litigation-outcomes/u);
  sql.close();
});

test('CF40 responsible PM owns explicit stage schedules and approved change requests update the calendar atomically', async () => {
  const { sql, env } = await setup();
  const assigned = await worker.fetch(request(`/api/project-workflow/projects/${CASE_ID}/profile`, ADMIN_TOKEN, {
    method: 'PUT', body: JSON.stringify({ responsiblePmId: PM_ID, expectedProfileVersion: 0 })
  }), env);
  assert.equal(assigned.status, 200);
  const saved = await worker.fetch(request(`/api/project-workflow/projects/${CASE_ID}/stages/KICKOFF`, PM_TOKEN, {
    method: 'PUT', body: JSON.stringify({ startDate: '2026-08-24', endDate: '2026-08-24', status: 'PLANNED', noteText: '발주처 참석 일정 확인', expectedVersion: 0 })
  }), env);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json() as any).schedule.version, 1);
  const denied = await worker.fetch(request(`/api/project-workflow/projects/${CASE_ID}/stages/KICKOFF`, STAFF_TOKEN, {
    method: 'PUT', body: JSON.stringify({ startDate: '2026-08-25', endDate: '2026-08-25', status: 'PLANNED', noteText: '직접 변경 시도', expectedVersion: 1 })
  }), env);
  assert.equal(denied.status, 403);
  const requested = await worker.fetch(request(`/api/project-workflow/projects/${CASE_ID}/change-requests`, STAFF_TOKEN, {
    method: 'POST', headers: { 'Idempotency-Key': 'cf40-schedule-change-0001' }, body: JSON.stringify({ stageCode: 'KICKOFF', proposedStartDate: '2026-08-26', proposedEndDate: '2026-08-26', reasonText: '발주처 요청으로 착수회의 날짜 변경', expectedScheduleVersion: 1 })
  }), env);
  assert.equal(requested.status, 201);
  const requestId = (await requested.json() as any).request.id;
  const notificationBefore = sql.exec("SELECT notification_type,user_id FROM preview_project_notifications WHERE change_request_id=?", [requestId])[0].values[0];
  assert.deepEqual(notificationBefore, ['SCHEDULE_CHANGE_REQUESTED', PM_ID]);
  const approved = await worker.fetch(request(`/api/project-workflow/change-requests/${requestId}/decision`, PM_TOKEN, {
    method: 'POST', body: JSON.stringify({ decision: 'APPROVED', reviewNote: '담당 PM 일정 변경 승인' })
  }), env);
  assert.equal(approved.status, 200);
  const exact = sql.exec("SELECT start_date,end_date,version FROM preview_project_stage_schedules WHERE case_id=? AND stage_code='KICKOFF'", [CASE_ID])[0].values[0];
  assert.deepEqual(exact, ['2026-08-26', '2026-08-26', 2]);
  const dashboard = await worker.fetch(request('/api/dashboard/kpi', STAFF_TOKEN), env);
  assert.equal(dashboard.status, 200);
  const dashboardBody = await dashboard.json() as any;
  assert.ok(dashboardBody.projectScheduleReminders.some((item: any) => item.caseId === CASE_ID && item.startDate === '2026-08-26'));
  assert.throws(() => sql.run("UPDATE preview_project_stage_schedules SET updated_by=? WHERE case_id=?", [STAFF_ID, CASE_ID]), /schedule update|PM authority/u);
  sql.close();
});

test('CF40 project intake confirmation requires an assigned PM and opens project-work schedule management', async () => {
  const { sql, env } = await setup();
  const caseVersion = Number(sql.exec('SELECT version FROM preview_cases WHERE id=?', [CASE_ID])[0].values[0][0]);
  const proposalPayload = {
    caseId: CASE_ID, proposalNumber: 'PROP-CF40-001', proposalTitle: 'CF40 프로젝트 접수 제안서', revisionLabel: 'V1-SENT',
    clientName: '합성 발주처', sentAt: '2026-08-21T02:00:00.000Z', responseDueOn: '2026-08-30', proposedAmountKrw: 44000000,
    documentUrl: 'https://preview.example/proposals/cf40.pdf', documentSha256: 'b'.repeat(64), verificationStatus: 'VERIFIED', expectedCaseVersion: caseVersion
  };
  const linked = await worker.fetch(request('/api/proposal-workflow/links', ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf40-proposal-link-0001' }, body: JSON.stringify(proposalPayload) }), env);
  assert.equal(linked.status, 200);
  const proposal = (await linked.json() as any).proposal;
  const withoutPm = await worker.fetch(request(`/api/proposal-workflow/links/${proposal.id}/decision`, ADMIN_TOKEN, {
    method: 'POST', headers: { 'Idempotency-Key': 'cf40-award-no-pm-0001' }, body: JSON.stringify({ decision:'WON',decisionNote:'계약서 확인',decidedAt:'2026-08-21T03:00:00.000Z',contractAmountKrw:44000000,projectStartOn:'2026-09-01',projectEndOn:'2026-12-31',responsiblePmId:null,expectedLinkVersion:proposal.version,expectedCaseVersion:proposal.caseVersion })
  }), env);
  assert.equal(withoutPm.status, 409);
  const confirmed = await worker.fetch(request(`/api/proposal-workflow/links/${proposal.id}/decision`, ADMIN_TOKEN, {
    method: 'POST', headers: { 'Idempotency-Key': 'cf40-award-with-pm-0001' }, body: JSON.stringify({ decision:'WON',decisionNote:'계약서와 발주서를 확인하고 프로젝트 접수를 확정합니다.',decidedAt:'2026-08-21T03:00:00.000Z',contractAmountKrw:44000000,projectStartOn:'2026-09-01',projectEndOn:'2026-12-31',responsiblePmId:PM_ID,expectedLinkVersion:proposal.version,expectedCaseVersion:proposal.caseVersion })
  }), env);
  assert.equal(confirmed.status, 200);
  assert.deepEqual(sql.exec('SELECT responsible_pm_id,version FROM preview_project_schedule_profiles WHERE case_id=?', [CASE_ID])[0].values[0], [PM_ID, 1]);
  const schedule = await worker.fetch(request('/api/project-workflow/schedule', PM_TOKEN), env);
  const project = (await schedule.json() as any).projects.find((item: any) => item.caseId === CASE_ID);
  assert.equal(project.responsiblePm.id, PM_ID); assert.equal(project.canManageSchedule, true);
  assert.ok(project.stages.filter((item: any) => ['KICKOFF','SITE_SURVEY','TAKEOFF_COST','REPORT_WRITING'].includes(item.stageCode)).every((item: any) => item.scheduleExplicit === false));
  sql.close();
});

test('CF40 external AI is default-deny for internal documents, then minimizes identifiers under acknowledged paid policy', async () => {
  const { sql, env } = await setup();
  let providerCalls = 0;
  env.GEMINI_TEST_FETCH = async () => {
    providerCalls += 1;
    const result = {
      meetingAt: '2026-08-28T01:00:00.000Z', surveyDate: null, location: '현장 회의실', agenda: '현장 범위와 제출 일정',
      participants: ['발주처 담당자', '프로젝트 PM'], leadUnit: '클레임센터', sourceNotes: '10시 현장 범위 확인. 11시 제출일 합의.',
      summary: '착수회의 내용을 원문 근거에 따라 정리한 검토용 초안입니다.', timeline: [{ title: '범위 확인', detail: '발주처 제공자료와 현장 범위를 확인했습니다.' }], missingFields: []
    };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const form = () => {
    const value = new FormData(); value.set('workflowKind', 'KICKOFF'); value.set('dataClass', 'INTERNAL');
    value.set('file', new File(['담당 010-1234-5678, pm@example.com\n10시 현장 범위 확인'], '착수회의.csv', { type: 'text/csv' })); return value;
  };
  const blocked = await worker.fetch(request(`/api/cases/${CASE_ID}/workflow/ai-import`, PM_TOKEN, { method: 'POST', body: form() }), env);
  assert.equal(blocked.status, 423); assert.equal(providerCalls, 0);
  assert.equal(sql.exec("SELECT status FROM preview_workflow_ai_imports ORDER BY created_at DESC LIMIT 1")[0].values[0][0], 'BLOCKED_BY_POLICY');
  const acknowledged = await worker.fetch(request('/api/settings/ai-governance', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ providerServiceTier: 'PAID_NO_PRODUCT_IMPROVEMENT', confidentialExternalAiEnabled: true, expectedVersion: 1, acknowledgement: '유료 서비스의 비학습 조건과 회사 보안정책을 확인했습니다' }) }), env);
  assert.equal(acknowledged.status, 200);
  const imported = await worker.fetch(request(`/api/cases/${CASE_ID}/workflow/ai-import`, PM_TOKEN, { method: 'POST', body: form() }), env);
  assert.equal(imported.status, 200); assert.equal(providerCalls, 1);
  const body = await imported.json() as any;
  assert.equal(body.security.rawProviderPayloadStored, false); assert.ok(body.security.redactionCount >= 2);
  assert.equal(body.import.location, '현장 회의실'); assert.equal(body.import.timeline.length, 1);
  const columns = sql.exec("PRAGMA table_info('preview_workflow_ai_imports')")[0].values.map((row) => row[1]);
  assert.equal(columns.includes('raw_payload'), false); assert.equal(columns.includes('response_text'), false);
  const ui = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'workflow', 'WorkflowOperations.tsx'), 'utf8');
  assert.match(ui, /끌어 놓으면/u); assert.match(ui, /Excel 양식\(\.csv\) 내보내기/u); assert.match(ui, /비학습 조건/u);
  sql.close();
});
