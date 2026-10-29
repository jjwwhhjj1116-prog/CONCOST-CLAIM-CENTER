import { assistantGuides, ASSISTANT_MANUAL_VERSION, ASSISTANT_ROUTES, type AssistantProject, type AssistantSnapshot, type AssistantReply } from '../../web/src/layout/workspace-assistant-guide';

interface Database { prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null> } } }
interface Context { db: Database; organizationId: string; userId: string; }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const assigned = 'c.organization_id=? AND c.deleted_at IS NULL AND EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=c.id AND a.user_id=?)';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
async function snapshot(context: Context, caseId: string): Promise<AssistantSnapshot | null> {
  return context.db.prepare(`SELECT c.id,c.case_number AS caseNumber,c.title,c.status,c.updated_at AS updatedAt,
    EXISTS(SELECT 1 FROM preview_case_activities a WHERE a.case_id=c.id AND a.event_type='REPORT_WORKSPACE_DELETED') AS reportDeleted,
    (SELECT version FROM preview_report_drafts d WHERE d.case_id=c.id AND d.organization_id=c.organization_id) AS draftVersion,
    (SELECT wizard_step FROM preview_report_drafts d WHERE d.case_id=c.id AND d.organization_id=c.organization_id) AS wizardStep,
    (SELECT updated_at FROM preview_report_drafts d WHERE d.case_id=c.id AND d.organization_id=c.organization_id) AS draftSavedAt,
    (SELECT status FROM preview_report_reviews r WHERE r.case_id=c.id AND r.organization_id=c.organization_id ORDER BY requested_at DESC,id DESC LIMIT 1) AS reviewStatus,
    (SELECT report_version FROM preview_report_reviews r WHERE r.case_id=c.id AND r.organization_id=c.organization_id ORDER BY requested_at DESC,id DESC LIMIT 1) AS reviewVersion,
    (SELECT report_version FROM preview_report_finalizations f WHERE f.case_id=c.id AND f.organization_id=c.organization_id ORDER BY finalized_at DESC,id DESC LIMIT 1) AS finalizedVersion,
    (SELECT status FROM preview_proposals p WHERE p.case_id=c.id AND p.organization_id=c.organization_id ORDER BY updated_at DESC,id DESC LIMIT 1) AS proposalStatus
    FROM preview_cases c WHERE ${assigned} AND c.id=?`).bind(context.organizationId, context.userId, caseId).first<AssistantSnapshot>();
}
export async function handleWorkspaceAssistant(request: Request, context: Context): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const caseId = url.searchParams.get('caseId');
    if (caseId) {
      if (!uuid.test(caseId)) return reply({ error: '프로젝트 식별자를 확인하세요.' }, 400);
      const state = await snapshot(context, caseId);
      return state ? reply({ snapshot: state, observedAt: new Date().toISOString() }) : reply({ error: '본인에게 배정된 프로젝트를 선택하세요.' }, 404);
    }
    const query = (url.searchParams.get('q') ?? '').trim();
    if (query.length > 100) return reply({ error: '검색어는 100자 이내로 입력하세요.' }, 400);
    const projects = await context.db.prepare(`SELECT c.id,c.case_number AS caseNumber,c.title,c.status FROM preview_cases c WHERE ${assigned} AND (?='' OR instr(lower(c.title),lower(?))>0 OR instr(lower(c.case_number),lower(?))>0) ORDER BY c.updated_at DESC,c.id DESC LIMIT 50`)
      .bind(context.organizationId, context.userId, query, query, query).all<AssistantProject>();
    return reply({ projects: projects.results, manualVersion: ASSISTANT_MANUAL_VERSION });
  }
  if (request.method !== 'POST') return reply({ error: '조회와 질문만 지원합니다.' }, 405);
  const origin = request.headers.get('Origin');
  if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site' || (request.headers.has('Cookie') && origin !== url.origin)) return reply({ error: '현재 서버 화면에서 다시 질문하세요.' }, 403);
  if (!/^application\/json(?:;|$)/iu.test(request.headers.get('Content-Type') ?? '')) return reply({ error: 'JSON 질문이 필요합니다.' }, 415);
  const reader = request.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  if (!reader) return reply({ error: '질문이 비어 있습니다.' }, 400);
  for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 12_000) { await reader.cancel(); return reply({ error: '질문이 너무 깁니다.' }, 413); } chunks.push(value); }
  let body: Record<string, unknown>;
  try { const bytes = new Uint8Array(size); let pos = 0; for (const chunk of chunks) { bytes.set(chunk, pos); pos += chunk.length; } body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return reply({ error: '질문 형식을 확인하세요.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['question', 'routeId', 'caseId', 'previousQuestion'].includes(key)) || typeof body.question !== 'string' || !body.question.trim() || body.question.length > 600 || typeof body.routeId !== 'string' || !ASSISTANT_ROUTES.some(route => route[0] === body.routeId) && body.routeId !== '' || body.caseId !== null && (typeof body.caseId !== 'string' || !uuid.test(body.caseId)) || body.previousQuestion !== undefined && (typeof body.previousQuestion !== 'string' || body.previousQuestion.length > 600)) return reply({ error: '질문은 600자 이내로 입력하고 프로젝트를 다시 선택하세요.' }, 400);
  const state = body.caseId ? await snapshot(context, String(body.caseId)) : null;
  if (body.caseId && !state) return reply({ error: '본인에게 배정된 프로젝트를 선택하세요.' }, 404);
  const currentSources = assistantGuides(body.question, body.routeId);
  const followUp = /^(?:그럼\s*)?(?:그?\s*다음(?:은|엔|에는)?|이어서(?:는)?|그(?:거|것)(?:는|은)?|이(?:거|것)(?:는|은)?)[?？.!\s]*$/u.test(body.question.trim());
  const matches = currentSources.length ? currentSources : followUp && typeof body.previousQuestion === 'string' && body.previousQuestion.trim() ? assistantGuides(body.previousQuestion, body.routeId) : [];
  const sources = matches.length ? matches : assistantGuides('', body.routeId);
  const answer = matches.length
    ? `${sources[0].title} 매뉴얼에 정해진 절차입니다.\n\n${sources[0].steps.map((step, index) => `${index + 1}. ${step}`).join('\n\n')}`
    : '등록된 매뉴얼에서 이 질문에 맞는 항목을 찾지 못했습니다. 아래 참고 매뉴얼을 선택하거나 보고서·명함·업무일지처럼 업무 이름을 넣어 질문하세요.';
  const base: AssistantReply = { answer, mode: 'MANUAL', observedAt: new Date().toISOString(), manualVersion: ASSISTANT_MANUAL_VERSION, sources, snapshot: state };
  if (/(?:저장|상신|승인|삭제|권한|설정).*(?:해(?:줘|라|요)?|바꿔|변경|실행|처리)|\b(?:save|submit|approve|delete|grant)\b/iu.test(body.question)) return reply({ ...base, answer: '도우미는 업무를 저장하거나 상신·승인·삭제하지 않습니다. 아래 매뉴얼과 해당 화면에서 내용을 확인하고 기존 절차로 진행하세요.' });
  // Project status is a local, deterministic projection. Never ask a model to infer saved/approved state.
  if (/(?:상태|다음.*(?:할|해야)|왜.*출력|출력.*(?:안|않|불가)|승인.*(?:됐|되었)|저장.*(?:됐|되었))/u.test(body.question)) {
    base.answer = state ? '아래 서버 저장 상태를 확인하세요. 다음 절차는 참고 매뉴얼과 해당 화면에서 확인할 수 있습니다.' : '프로젝트를 선택하면 본인 배정 프로젝트의 실제 서버 저장 상태를 확인할 수 있습니다. 프로젝트를 선택하지 않은 상태에서는 사용법만 안내합니다.';
    return reply(base);
  }
  return reply(base);
}
