import { CATEGORY_HELP, ROUTE_HELP, WORKSPACE_TUTORIAL_STEPS } from './workspace-help-content';

// The help centre and assistant consume the same shipped manual, never a copied AI manual.
export const ASSISTANT_MANUAL_VERSION = '2026-10-29';
export const ASSISTANT_ROUTES = [
  ['DASH-01', '/dashboard', 'home', '시작 처음 순서 사용법 작업 업무'],
  ['CASE-02', '/cases/new', 'proposal', '의뢰 등록 클라이언트'],
  ['PROP-02', '/proposals/editor', 'proposal', '제안서 견적'],
  ['WF-02', '/workflow/award', 'proposal', '접수 수주 계약'],
  ['PROJ-01', '/projects/schedule', 'work', '일정 기간 담당 PM'],
  ['WF-03', '/workflow/kickoff', 'work', '착수 회의 회의록 녹음'],
  ['WF-04', '/workflow/site-survey', 'work', '현장 조사'],
  ['WF-05', '/workflow/quantity', 'work', '물량 산출 내역'],
  ['REPO-02', '/reports/studio', 'work', '보고서 HWP DOCX PDF 한글 워드 가져오기 불러오기 출력 저장 복구 목차 챕터'],
  ['APPR-01', '/approval', 'quality', '결재 승인 상신 검토 반려'],
  ['WL-01', '/projects/worklogs', 'work', '일일 업무일지 일지'],
  ['WL-02', '/projects/worklogs/weekly', 'work', '주간 정기 금요일 월요일'],
  ['CASE-06', '/cases/files', 'library', '드라이브 Drive 자료 파일'],
  ['CONTACT-02', '/contacts/cards/new', 'library', '명함 QR 촬영 앞면 뒷면 인식'],
  ['MY-01', '/settings', 'settings', '설정 연결 API 키']
] as const;
export interface AssistantGuide { id: string; path: string; title: string; steps: readonly string[]; next: string }
export function assistantGuides(question: string, routeId: string): AssistantGuide[] {
  const normalized = question.toLocaleLowerCase().replace(/\s+/gu, '');
  return ASSISTANT_ROUTES.map(([id, path, category, keywords]) => {
    const guide = ROUTE_HELP[id];
    const tutorial = WORKSPACE_TUTORIAL_STEPS.find(step => step.path === path);
    return { id, path, title: guide?.title ?? CATEGORY_HELP[category].title,
      steps: id === 'DASH-01' ? WORKSPACE_TUTORIAL_STEPS.map(step => `${step.title} ${step.tasks.join(' → ')} ${step.completion}`) : guide?.steps ?? (tutorial ? [tutorial.explanation, ...tutorial.tasks] : CATEGORY_HELP[category].actions),
      next: guide?.next ?? tutorial?.completion ?? '',
      score: keywords.split(' ').reduce((sum, word) => sum + (normalized.includes(word.toLocaleLowerCase()) ? 2 : 0), 0) + (id === routeId ? 1 : 0) };
  }).sort((a, b) => b.score - a.score).slice(0, 3).map(({ score: _score, ...guide }) => guide);
}
export function assistantPath(guide: AssistantGuide, caseId: string | null): string {
  if (!caseId || ['DASH-01', 'CASE-02', 'CONTACT-02', 'MY-01', 'APPR-01'].includes(guide.id)) return guide.path;
  const params = new URLSearchParams({ caseId });
  if (guide.id.startsWith('WF-') && guide.id !== 'WF-02') params.set('projectId', `project-${caseId}`);
  return `${guide.path}?${params}`;
}
export const ASSISTANT_TARGETS: Record<string, { selector: string; text?: string; label: string }> = {
  'DASH-01': { selector: '.dashboard-kpi-grid', label: '프로젝트 진행 현황' },
  'CASE-02': { selector: '#main-content input', label: '의뢰 기본정보 입력' },
  'PROP-02': { selector: '.proposal-project-bar input, .proposal-project-bar select, .proposal-project-bar [role="combobox"]', label: '제안서 연결 프로젝트 선택' },
  'WF-02': { selector: '.proposal-flow-list', label: '접수 대상 프로젝트 선택' },
  'PROJ-01': { selector: '#main-content select', label: '일정 조회 조건 선택' },
  'WF-03': { selector: '#main-content select', label: '착수회의 프로젝트 선택' },
  'WF-04': { selector: '#main-content select', label: '현장조사 프로젝트 선택' },
  'WF-05': { selector: '#main-content select', label: '산출 프로젝트 선택' },
  'REPO-02': { selector: '#main-content button', text: 'HWP', label: 'HWP 메뉴·가져오기 위치' },
  'APPR-01': { selector: '#main-content h1, #main-content h2', label: '검토·승인 목록' },
  'WL-01': { selector: '#main-content select', label: '일일 업무일지 프로젝트 선택' },
  'WL-02': { selector: '#main-content input[type="date"]', label: '주간 업무일지 조회 날짜' },
  'CASE-06': { selector: '#main-content select', label: '자료실 프로젝트 선택' },
  'CONTACT-02': { selector: '#main-content button', text: 'QR', label: '휴대폰 촬영 QR 생성 버튼' },
  'MY-01': { selector: '#main-content h1, #main-content h2', label: '개인·관리자 연결 설정' }
};
export interface AssistantProject { id: string; caseNumber: string; title: string; status: string }
export interface AssistantSnapshot extends AssistantProject {
  updatedAt: string; reportDeleted: number; draftVersion: number | null; wizardStep: number | null;
  draftSavedAt: string | null; reviewStatus: string | null; reviewVersion: number | null;
  finalizedVersion: number | null; proposalStatus: string | null;
}
export function assistantFacts(snapshot: AssistantSnapshot): string[] {
  const statuses: Record<string, string> = { INQUIRY: '의뢰', PROPOSAL: '제안', ESTIMATE: '견적', CONTRACT: '계약', MATERIAL_RECEIVED: '자료 접수', ANALYSIS: '분석', REPORT_DRAFTING: '보고서 작성', SUBMITTED: '제출', LITIGATION: '소송', JUDGEMENT: '판결', CLOSED: '종결', IN_REVIEW: '검토 중', IN_PROGRESS: '진행 중', COMPLETED: '완료', PENDING: '결재 대기', APPROVED: '승인', REJECTED: '수정 요청', CHANGES_REQUESTED: '수정 요청', DRAFT: '작성 중' };
  const label = (value: string) => statuses[value] ?? `${value} · 상태 확인 필요`;
  const facts = [`프로젝트 원장: ${label(snapshot.status)}`, `제안서: ${snapshot.proposalStatus ? label(snapshot.proposalStatus) : '저장 이력 없음'}`];
  if (snapshot.reportDeleted) return [...facts, '보고서 작업공간: 삭제 처리됨. 과거 승인·확정 이력을 현재 출력 가능 상태로 판단하지 않습니다.'];
  facts.push(snapshot.draftVersion === null ? '보고서: 서버 저장본 없음' : `보고서 서버 저장본: v${snapshot.draftVersion} · ${snapshot.wizardStep ?? '미확인'}단계`);
  facts.push(snapshot.reviewVersion === null ? '보고서 결재: 상신 이력 없음' : `최근 상신: v${snapshot.reviewVersion} · ${label(snapshot.reviewStatus ?? 'UNKNOWN')}${snapshot.reviewVersion !== snapshot.draftVersion ? ' (현재 저장본과 다른 버전)' : ''}`);
  facts.push(snapshot.finalizedVersion === null ? '보고서 확정본: 없음' : `확정본: v${snapshot.finalizedVersion}${snapshot.finalizedVersion !== snapshot.draftVersion ? ' (현재 저장본과 다른 버전)' : ''}`);
  facts.push('출력 가능 여부는 보고서 5단계에서 해당 승인·확정 버전을 확인하세요. 화면의 미저장 입력은 이 조회에 포함하지 않습니다.');
  return facts;
}
export interface AssistantReply {
  answer: string; mode: 'AI' | 'MANUAL'; notice?: string; observedAt: string; manualVersion: string;
  sources: AssistantGuide[]; snapshot: AssistantSnapshot | null;
}
