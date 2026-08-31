export type WorkflowStageId = 1 | 2 | 3 | 4 | 5 | 6;

export interface WorkflowStageDefinition {
  id: WorkflowStageId;
  routeId: `WF-0${WorkflowStageId}`;
  path: string;
  name: string;
  eyebrow: string;
  description: string;
  color: string;
}

export const WORKFLOW_STAGES: readonly WorkflowStageDefinition[] = [
  {
    id: 1,
    routeId: 'WF-01',
    path: '/workflow/proposal-link',
    name: '제안서 연동',
    eyebrow: 'PROPOSAL LINK',
    description: '제안서 작성 메뉴에서 완성해 발송한 제안서를 프로젝트에 연결합니다.',
    color: '#7b72c9'
  },
  {
    id: 2,
    routeId: 'WF-02',
    path: '/workflow/award',
    name: '수주 확정',
    eyebrow: 'AWARD DECISION',
    description: '거래처 회신과 수주 여부를 기록하고 수주된 건만 수행 프로젝트로 전환합니다.',
    color: '#5b93c9'
  },
  {
    id: 3,
    routeId: 'WF-03',
    path: '/workflow/kickoff',
    name: '착수회의',
    eyebrow: 'KICK-OFF',
    description: '회의 녹음·자료를 모아 AI 요약, 회의록, 결정사항과 타임라인을 만듭니다.',
    color: '#4ba6b5'
  },
  {
    id: 4,
    routeId: 'WF-04',
    path: '/workflow/site-survey',
    name: '현장조사',
    eyebrow: 'SITE SURVEY',
    description: '사진·녹음·도면을 조사일과 유형별로 정리하고 Drive 연결을 준비합니다.',
    color: '#57a98c'
  },
  {
    id: 5,
    routeId: 'WF-05',
    path: '/workflow/quantity',
    name: '수량산출·내역작성',
    eyebrow: 'QUANTITY & BOQ',
    description: '산출 범위와 기준, 마감·구조·토목조경·VIETQS 팀 일정과 투입률을 관리합니다.',
    color: '#d69a56'
  },
  {
    id: 6,
    routeId: 'WF-06',
    path: '/workflow/report',
    name: '보고서 작성',
    eyebrow: 'REPORT AUTHORING',
    description: '1~5단계 근거를 유형별 목차와 프롬프트로 묶어 장별 AI 초안을 작성합니다.',
    color: '#cc7693'
  }
] as const;

export const REPORT_AUTHOR_NAMES = ['현동명', '이원희', '이경훈', '최영배', '장범선'] as const;

export interface WorkforceUnit {
  organization: 'CONCOST' | 'VIETQS';
  discipline: '마감' | '구조' | '토목·조경' | '클레임';
  unit: string;
  size: number;
  schedulingMode: 'PERSON' | 'TEAM';
  members?: readonly string[];
}

export const WORKFORCE_UNITS: readonly WorkforceUnit[] = [
  {
    organization: 'CONCOST', discipline: '마감', unit: '마감팀', size: 12, schedulingMode: 'PERSON',
    members: ['조한빈', '김재헌', '성대용', '양한규', '원종수', '송영길', '이은지', '남은주', '송치영', '임승주', '임창열', '김수겸']
  },
  {
    organization: 'CONCOST', discipline: '구조', unit: '구조팀', size: 6, schedulingMode: 'PERSON',
    members: ['신동헌', '김채원', '이정철', '박소현', '서화원', '양진혁']
  },
  {
    organization: 'CONCOST', discipline: '토목·조경', unit: '토목·조경팀', size: 2, schedulingMode: 'PERSON',
    members: ['오승균', '장명진']
  },
  {
    organization: 'CONCOST', discipline: '클레임', unit: '보고서 전담', size: 5, schedulingMode: 'PERSON',
    members: REPORT_AUTHOR_NAMES
  },
  { organization: 'VIETQS', discipline: '마감', unit: 'Finish External', size: 7, schedulingMode: 'TEAM' },
  { organization: 'VIETQS', discipline: '마감', unit: 'Finish Internal 1', size: 4, schedulingMode: 'TEAM' },
  { organization: 'VIETQS', discipline: '마감', unit: 'Finish Internal 2', size: 5, schedulingMode: 'TEAM' },
  { organization: 'VIETQS', discipline: '마감', unit: 'Finish Internal 3', size: 5, schedulingMode: 'TEAM' },
  { organization: 'VIETQS', discipline: '마감', unit: 'Finish P&O 1', size: 4, schedulingMode: 'TEAM' },
  { organization: 'VIETQS', discipline: '마감', unit: 'Finish P&O 2', size: 5, schedulingMode: 'TEAM' },
  { organization: 'VIETQS', discipline: '구조', unit: 'Structure Horizon 1', size: 5, schedulingMode: 'TEAM' },
  { organization: 'VIETQS', discipline: '구조', unit: 'Structure Horizon 2', size: 3, schedulingMode: 'TEAM' },
  { organization: 'VIETQS', discipline: '구조', unit: 'Structure Horizon 3', size: 3, schedulingMode: 'TEAM' },
  { organization: 'VIETQS', discipline: '구조', unit: 'Structure Vertical 1', size: 3, schedulingMode: 'TEAM' },
  { organization: 'VIETQS', discipline: '구조', unit: 'Structure Vertical 2', size: 3, schedulingMode: 'TEAM' },
  { organization: 'VIETQS', discipline: '구조', unit: 'Structure Vertical 3', size: 5, schedulingMode: 'TEAM' },
  { organization: 'VIETQS', discipline: '토목·조경', unit: 'Civil', size: 2, schedulingMode: 'TEAM' }
] as const;

export interface ProjectWorkflowItem {
  stageId: WorkflowStageId;
  stageCode?: 'PROPOSAL' | 'AWARD' | 'KICKOFF' | 'SITE_SURVEY' | 'TAKEOFF_COST' | 'REPORT_WRITING';
  startDay: number;
  endDay: number;
  startDate?: string | null;
  endDate?: string | null;
  scheduleVersion?: number;
  scheduleStatus?: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'DELAYED';
  scheduleNote?: string;
  scheduleExplicit?: boolean;
  status: 'DONE' | 'IN_PROGRESS' | 'PLANNED';
  owner: string;
  detail: string;
}

export interface WorkflowProject {
  id: string;
  caseId: string;
  code: string;
  name: string;
  client: string;
  claimType: string;
  caseStatus?: string;
  progress: number;
  start: string;
  end: string;
  awardStatus: 'WON' | 'PENDING' | 'LOST';
  deliveryStatus?: 'IN_PROGRESS' | 'FINALIZED_PENDING_ARCHIVE' | 'DELIVERED';
  finalDeliverableCount?: number;
  scheduleVisibilityVersion?: number;
  canRemoveFromSchedule?: boolean;
  responsiblePm?: { id: string; name: string } | null;
  profileVersion?: number;
  canManageSchedule?: boolean;
  pendingChangeRequests?: readonly {
    id: string;
    stageCode: string;
    proposedStartDate: string;
    proposedEndDate: string;
    proposedStatus: string;
    reasonText: string;
    expectedScheduleVersion: number;
    requestedByName: string;
    requestedAt: string;
  }[];
  highlights: readonly {
    label: string;
    tone: 'finish' | 'structure' | 'civil' | 'report' | 'survey' | 'pending';
  }[];
  stages: readonly ProjectWorkflowItem[];
}

export const WORKFLOW_PROJECTS: readonly WorkflowProject[] = [
  {
    id: 'project-demo-01',
    caseId: '40000000-0000-4000-8000-000000000010',
    code: 'DEMO-2026-001',
    name: '클레임센터 스튜디오 샘플 사건',
    client: '합성 테스트 발주처',
    claimType: 'TYPE-02',
    progress: 44,
    start: '2026-08-03',
    end: '2026-09-11',
    awardStatus: 'WON',
    highlights: [
      { label: '마감팀 · 마감 물량 산출', tone: 'finish' },
      { label: '구조팀 · 구조 물량 산출', tone: 'structure' },
      { label: '토목조경팀 · 범위 확인', tone: 'civil' }
    ],
    stages: [
      { stageId: 1, startDay: 3, endDay: 5, status: 'DONE', owner: '제안 담당', detail: '작성 완료 제안서 v3 연동' },
      { stageId: 2, startDay: 6, endDay: 7, status: 'DONE', owner: '프로젝트 책임자', detail: '수주 확정 · 프로젝트 전환' },
      { stageId: 3, startDay: 10, endDay: 12, status: 'IN_PROGRESS', owner: '이경훈 · 최영배', detail: '착수회의 및 AI 회의록' },
      { stageId: 4, startDay: 13, endDay: 17, status: 'PLANNED', owner: '현장조사팀', detail: '사진·녹음·도면 수집' },
      { stageId: 5, startDay: 18, endDay: 27, status: 'PLANNED', owner: '마감·구조·토목조경·VIETQS', detail: '산출범위 확정 및 내역작성' },
      { stageId: 6, startDay: 25, endDay: 31, status: 'PLANNED', owner: REPORT_AUTHOR_NAMES.join(' · '), detail: '유형별 장 초안 작성' }
    ]
  },
  {
    id: 'project-demo-02', caseId: 'demo-case-02', code: 'CLM-2026-014', name: '공동주택 공사비 적정성 검토', client: '합성 테스트 조합', claimType: 'TYPE-01', progress: 61,
    start: '2026-08-01', end: '2026-08-29', awardStatus: 'WON',
    highlights: [
      { label: 'Finish Internal 1 · 마감 산출', tone: 'finish' },
      { label: 'Structure Horizon 1 · 구조 산출', tone: 'structure' },
      { label: '보고서 근거 검토', tone: 'report' }
    ],
    stages: [
      { stageId: 1, startDay: 1, endDay: 2, status: 'DONE', owner: '제안 담당', detail: '제안서 연동' },
      { stageId: 2, startDay: 3, endDay: 4, status: 'DONE', owner: 'PM', detail: '수주 확정' },
      { stageId: 3, startDay: 5, endDay: 6, status: 'DONE', owner: '클레임센터', detail: '착수회의 확정' },
      { stageId: 4, startDay: 7, endDay: 11, status: 'DONE', owner: '현장조사팀', detail: '현장조사 완료' },
      { stageId: 5, startDay: 12, endDay: 23, status: 'IN_PROGRESS', owner: 'Finish Internal 1 · Structure Horizon 1', detail: '수량산출 진행' },
      { stageId: 6, startDay: 22, endDay: 29, status: 'PLANNED', owner: REPORT_AUTHOR_NAMES.join(' · '), detail: '보고서 작성 예정' }
    ]
  },
  {
    id: 'project-demo-03', caseId: 'demo-case-03', code: 'CLM-2026-018', name: '물가변동 검토 및 협상 보고서', client: '합성 테스트 시공사', claimType: 'TYPE-06', progress: 17,
    start: '2026-08-12', end: '2026-09-30', awardStatus: 'PENDING',
    highlights: [
      { label: '물가변동 기준지수 검토', tone: 'survey' },
      { label: '제안서 회신 대기', tone: 'pending' }
    ],
    stages: [
      { stageId: 1, startDay: 12, endDay: 16, status: 'IN_PROGRESS', owner: '제안 담당', detail: '제안서 발송·회신 대기' },
      { stageId: 2, startDay: 17, endDay: 19, status: 'PLANNED', owner: '프로젝트 책임자', detail: '수주 여부 결정' },
      { stageId: 3, startDay: 20, endDay: 21, status: 'PLANNED', owner: '클레임센터', detail: '수주 시 착수' },
      { stageId: 4, startDay: 22, endDay: 24, status: 'PLANNED', owner: '조사 담당', detail: '자료 확인' },
      { stageId: 5, startDay: 24, endDay: 29, status: 'PLANNED', owner: '산출 담당', detail: '지수·기준 검토' },
      { stageId: 6, startDay: 28, endDay: 31, status: 'PLANNED', owner: REPORT_AUTHOR_NAMES.join(' · '), detail: '유형별 보고서' }
    ]
  }
] as const;

export const workflowStageFromRoute = (routeId: string): WorkflowStageId | undefined => {
  const match = WORKFLOW_STAGES.find((stage) => stage.routeId === routeId);
  return match?.id;
};
