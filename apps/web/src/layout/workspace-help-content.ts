export const CURRENT_TUTORIAL_VERSION = 'CF62_V1';

export interface TutorialStep {
  eyebrow: string;
  title: string;
  explanation: string;
  tasks: readonly string[];
  completion: string;
  path: string;
  pathLabel: string;
  targetSelectors: readonly string[];
}

export const WORKSPACE_TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    eyebrow: 'START · 업무 홈', title: '먼저 오늘 해야 할 프로젝트를 확인합니다.',
    explanation: '처음에는 HOME에서 진행 중 프로젝트, 검토 대기, 일정과 마감 항목을 확인하세요.',
    tasks: ['대시보드의 진행 현황 확인', '내가 담당한 프로젝트 선택', '현재 단계와 다음 할 일 확인'],
    completion: '작업할 프로젝트와 오늘 처리할 단계가 정해지면 완료입니다.', path: '/dashboard', pathLabel: '업무 홈 열기',
    targetSelectors: ['#main-content h1', '.dashboard-kpi-grid', '.dashboard-columns']
  },
  {
    eyebrow: 'INTAKE · 프로젝트 의뢰', title: '클라이언트의 입장부터 분명하게 등록합니다.',
    explanation: '피해자 측인지 피의자·피고 측인지 선택하고, 그 입장에서 사건 설명과 첨부 자료의 AI 정리문을 남깁니다.',
    tasks: ['클라이언트 법적 지위 선택', '사건 설명 입력', '필요하면 녹음·TXT·CSV·Excel 자료 추가', '의뢰 저장'],
    completion: '저장 후 같은 프로젝트가 선택된 제안서 작성 화면으로 이동하면 완료입니다.', path: '/cases/new', pathLabel: '프로젝트 의뢰 열고 확인',
    targetSelectors: ['.case-create-form select', '.case-create-form textarea', '.case-intake-assistant', '.case-create-actions']
  },
  {
    eyebrow: 'PROPOSAL · 제안서 작성', title: '의뢰 내용을 제안서로 이어갑니다.',
    explanation: '의뢰 프로젝트와 HWP 템플릿을 선택하고, Gemini 초안 → 사람 편집 → 전체 미리보기·확정 순서로 진행합니다.',
    tasks: ['연결 프로젝트·원본 템플릿 확인', 'Gemini 1~3장 초안과 회사 고정 모듈 확인', '담당자 검수 편집기·AI 글쓰기 개선 사용', 'HWP·DOCX·PDF 내보내기와 DB 보관 확인'],
    completion: '전체 미리보기에서 확정한 제안서가 DB에 보관되면 완료입니다.', path: '/proposals/editor', pathLabel: '제안서 스튜디오 열기',
    targetSelectors: ['.proposal-intake-context select', '.proposal-step-card', '.proposal-editor-toolbar, .proposal-step-card textarea', '.proposal-step-button, .proposal-export-actions']
  },
  {
    eyebrow: 'AWARD · 프로젝트 접수', title: '수주 여부를 확인하고 프로젝트로 전환합니다.',
    explanation: '수주 확정된 제안서만 계약 금액과 수행 기간을 가진 실제 프로젝트가 됩니다.',
    tasks: ['제안서 연동 확인', '수주 확정 또는 접수 취소', '수주 시 일정표에서 PM·기간 설정'],
    completion: '수주 프로젝트가 일정표에 나타나면 완료입니다.', path: '/workflow/award', pathLabel: '프로젝트 접수 열고 확인',
    targetSelectors: ['.proposal-flow-list', '.proposal-flow-detail select', '.proposal-flow-detail button']
  },
  {
    eyebrow: 'SCHEDULE · 프로젝트 일정표', title: '모든 단계가 한 프로젝트 일정으로 연결되는지 봅니다.',
    explanation: '수주된 프로젝트만 표시하며 PM·1~6단계 기간·한국/베트남 휴일을 저장합니다. 다른 업무 화면의 일정과 양방향으로 연결됩니다.',
    tasks: ['월간 캘린더와 한국·베트남 휴일 확인', '프로젝트를 눌러 PM·단계별 기간 편집', '일정 저장 후 관련 업무 화면 반영 확인', 'A4 일정표 출력·PDF 확인'],
    completion: 'PM과 단계별 일정이 저장되고 캘린더·업무 화면에 동일하게 보이면 완료입니다.', path: '/projects/schedule', pathLabel: '통합 일정표 열기',
    targetSelectors: ['.schedule-board', '.schedule-project-info button, .schedule-board button', '.schedule-modal button, .schedule-project-info', '.schedule-toolbar button']
  },
  {
    eyebrow: 'KICKOFF · 착수회의', title: '회의 기록과 후속 업무를 남깁니다.',
    explanation: '회의 일시·참석자·쟁점을 저장하고 AI 요약과 타임라인 초안을 사람이 확인합니다.',
    tasks: ['회사 회의록 Excel 양식 내보내기·가져오기', '회의록·녹음·제공자료 업로드', 'Gemini 회의록·결정사항·후속업무 생성', '사람 검수 후 착수회의 저장'],
    completion: '확정 회의록과 다음 행동이 남으면 완료입니다.', path: '/meetings', pathLabel: '착수회의 열고 확인',
    targetSelectors: ['.workflow-project-selector', '.workflow-ai-import-controls, .workflow-dropzone', '.workflow-actions button', '.workflow-actions']
  },
  {
    eyebrow: 'SURVEY · 현장조사', title: '현장 범위와 사진·녹음 근거를 모읍니다.',
    explanation: '조사일, 위치, 범위를 기록하고 현장 자료를 해당 프로젝트에 연결합니다.',
    tasks: ['조사 범위 저장', '사진·녹음 업로드', '자료 날짜·업로더 확인'],
    completion: '현장조사 기록과 원본 자료가 연결되면 완료입니다.', path: '/workflow/site-survey', pathLabel: '현장조사 열고 확인',
    targetSelectors: ['.workflow-project-selector', '.workflow-form-grid', '.workflow-dropzone']
  },
  {
    eyebrow: 'QUANTITY · 물량산출 및 내역', title: '산출 기준·투입 팀·원본 파일을 연결합니다.',
    explanation: '산출 범위와 기준을 남기고 마감·구조·토목조경 팀 일정을 배정합니다.',
    tasks: ['산출 범위·기준 입력', '팀별 기간 배정', '산출서·내역서 업로드'],
    completion: '일정표와 자료실에 팀 일정과 파일이 모두 보이면 완료입니다.', path: '/workflow/quantity', pathLabel: '물량산출 열고 확인',
    targetSelectors: ['.workflow-project-selector', '.workflow-form-grid', '.workflow-evidence-card']
  },
  {
    eyebrow: 'REPORT · 5단계 작성', title: '보고서는 한 단계만 보고 차례대로 작성합니다.',
    explanation: '저장본 선택 → 유형별 템플릿 → 목차 → 챕터 AI 작성 → 사람 편집·Gemini 글쓰기 개선 → HWP/DOCX/PDF 출력 순서입니다.',
    tasks: ['저장한 보고서 선택 또는 새 작업 시작', '템플릿 열람 후 목차 자동생성·직접 편집', '챕터별 근거 확인·AI 초안 작성', 'Tiptap 편집·선택 문장 Gemini 개선', '자동저장·실시간 협업 상태와 HWP/DOCX/PDF 출력 확인'],
    completion: '최신본 저장 후 검토·승인 대기열로 보내면 완료입니다.', path: '/reports/studio', pathLabel: '보고서 스튜디오 열기',
    targetSelectors: ['.report-workspace-resume, .report-workspace-selector', '.report-template-viewer-control, .report-outline-editor', '.report-wizard-navigation, .report-ai-action', '.structured-document-editor, .report-editor', '.report-wizard-footer']
  },
  {
    eyebrow: 'APPROVAL · 검토 승인', title: '대표 또는 부사장이 최종 승인합니다.',
    explanation: '작성자와 다른 검토자가 확인하고, CEO·Director 권한의 최종 결재자가 승인해야 납품 알림이 PM에게 갑니다.',
    tasks: ['제출 버전·근거 확인', '수정 요청 또는 최종 승인', 'PM 알림·메일 발송 상태 확인'],
    completion: '승인 이력과 PM 납품 알림이 생성되면 완료입니다.', path: '/approval', pathLabel: '검토·승인 열고 확인',
    targetSelectors: ['.content-stack > *:first-child', '.inline-form', '.content-stack > *:last-child']
  },
  {
    eyebrow: 'EVIDENCE · 자료실', title: '모든 원본 자료는 회사 Google Drive에 모읍니다.',
    explanation: '브라우저는 Worker를 통해 업로드하고, 원본은 Drive에, 파일 ID·해시·업로더·시간은 D1에 남습니다.',
    tasks: ['프로젝트 선택', '착수·현장·산출·내역 등 자료 종류 선택', '드래그앤드롭 업로드', 'Drive 폴더·업로더·날짜·SHA-256 확인'],
    completion: 'GOOGLE_DRIVE 저장 표시와 다운로드 링크가 보이면 완료입니다.', path: '/cases/files', pathLabel: '자료실 열고 확인',
    targetSelectors: ['.preview-evidence-hero', '.inline-form', '.case-evidence-dropzone']
  },
  {
    eyebrow: 'COURT · 법원 자료', title: '법원 사건번호와 소송 일정을 사람이 확인해 등록합니다.',
    explanation: '현재는 법원 자동 스크래핑이 아니라 D1 기반 내부 검증 시스템입니다. 공식 출처를 확인한 값만 일정표에 반영합니다.',
    tasks: ['법원·사건번호 입력', '공식 출처 URL 기록', '기일·제출기한 등록', '검증 상태 확인'],
    completion: '프로젝트와 법원 일정이 연결되면 완료입니다.', path: '/after-delivery', pathLabel: '법원 자료 열고 확인',
    targetSelectors: ['.litigation-search', '.litigation-list', '.litigation-detail']
  },
  {
    eyebrow: 'SETTINGS · 안전한 연결', title: '마지막으로 개인·관리자 연결 상태를 확인합니다.',
    explanation: '개인은 Gemini 보조 키와 비밀번호를, 관리자는 회사 Google Drive·회원·유형별 프롬프트·Hermes·실시간 협업 브리지를 관리합니다.',
    tasks: ['개인 Gemini 키·비밀번호 저장 상태 확인', '회사 Google Drive OAuth 연결·계정 교체 확인', '회원 승인·관리자 전용 DB·프롬프트 확인', 'Hermes 메모리·Yjs/Hocuspocus 서버 브리지 상태 확인'],
    completion: '비밀키 원문 없이 연결 상태만 표시되면 완료입니다.', path: '/settings', pathLabel: '설정 열고 확인',
    targetSelectors: ['.settings-section-tabs', '.credential-settings-card', '.settings-admin-links', '.settings-admin-links, .settings-memory-card']
  }
] as const;

export interface HelpArticle {
  title: string;
  purpose: string;
  inputs: readonly string[];
  actions: readonly string[];
  outputs: readonly string[];
  cautions: readonly string[];
}

export const CATEGORY_HELP: Record<string, HelpArticle> = {
  home: { title: 'HOME', purpose: '오늘 처리할 프로젝트와 병목을 가장 먼저 찾는 화면입니다.', inputs: ['담당 프로젝트', '검토 대기', '마감 일정'], actions: ['프로젝트 선택', '현재 단계 확인', '다음 업무 화면 이동'], outputs: ['오늘의 우선순위', '프로젝트 진행률'], cautions: ['표시 숫자는 상세 목록과 함께 확인하세요.'] },
  proposal: { title: '프로젝트 제안 및 수주', purpose: '의뢰 → 제안서 → 수주 확인을 순서대로 연결하고 확정된 건만 실제 프로젝트로 전환합니다.', inputs: ['의뢰 원문·첨부자료', 'HWP 제안서 템플릿', 'Gemini API', '거래처 수주 회신'], actions: ['AI 의뢰서 초안 검수', '제안서 4단계 작성·사람 편집', 'HWP·DOCX·PDF 확정본 보관', '제안서 연동 후 수주 또는 취소'], outputs: ['프로젝트별 제안서 버전', '수주 프로젝트', 'ERP 전송 대기정보'], cautions: ['제안서 1~3장은 매번 사람이 검수하고, 수주 확정 전에는 프로젝트 일정표로 넘기지 마세요.'] },
  work: { title: '프로젝트 워크', purpose: '수주 후 PM 일정부터 착수·현장·산출·보고서 작성까지 실행 자료와 일정을 양방향 연결합니다.', inputs: ['수주 프로젝트', 'PM·단계별 기간', '회의록', '현장 자료', '산출·내역 자료', '유형별 보고서 템플릿'], actions: ['한국·베트남 휴일 포함 일정 저장', '회의록·현장자료 AI 정리', '자료 Drive 업로드', '보고서 목차·챕터 작성', 'Tiptap 편집·Gemini 개선·HWP 출력'], outputs: ['단계별 완료 상태', '통합 일정', '보고서 근거·버전', '실시간 협업 문서'], cautions: ['일정·본문을 바꾼 뒤 저장 상태와 현재 프로젝트를 반드시 확인하세요.'] },
  library: { title: '클레임센터 자료실', purpose: '프로젝트별 원본 자료를 회사 Google Drive 구조와 연결합니다.', inputs: ['사진·녹음·문서', '자료 종류', '촬영·작성 날짜'], actions: ['프로젝트 선택', '드래그앤드롭', '분류·해시 확인'], outputs: ['Drive 원본', 'D1 자료 메타데이터'], cautions: ['다른 프로젝트를 선택한 상태에서 업로드하지 마세요.'] },
  court: { title: '법원 자료', purpose: '사건번호, 법원, 기일과 제출 자료를 프로젝트별로 관리합니다.', inputs: ['사건번호', '법원·재판부', '기일', '제출·송달 자료'], actions: ['일정 등록', '자료 연결', '상태 갱신'], outputs: ['소송 일정표', '법원 자료 이력'], cautions: ['법원 공식 자료와 사람이 대조한 값만 확정하세요.'] },
  quality: { title: '검토·납품·품질관리', purpose: '작성자와 다른 검토자가 승인한 버전만 납품본으로 확정합니다.', inputs: ['최신 보고서 버전', '검토 의견', '납품 정보', '판결 결과'], actions: ['검토 요청', '수정·승인', 'DOCX/PDF 생성', '납품·성과 기록'], outputs: ['불변 승인 이력', '최종 납품 파일'], cautions: ['승인 전 초안을 납품본으로 사용하지 마세요.'] },
  settings: { title: '설정', purpose: '개인 Gemini와 관리자 공용 Drive·회원·프롬프트·메모리·협업 브리지를 안전하게 관리합니다.', inputs: ['개인 API 키', '회사 OAuth', '회원 권한', '제안서·보고서 프롬프트', 'Hermes·Yjs 서버 주소'], actions: ['암호화 저장', 'Drive 계정 연결·교체', '회원 승인·비밀번호 관리', '유형별 지침 수정', 'Private Bridge 연결 점검'], outputs: ['사용자별 연결 상태', '조직 공용 정책', '서버 브리지 준비도'], cautions: ['비밀키 원문을 문서·보고서·메모리에 붙이지 말고 브라우저에 다시 표시하지 마세요.'] }
};

export const ROUTE_HELP: Record<string, { title: string; steps: readonly string[]; next: string }> = {
  'CASE-02': { title: '프로젝트 의뢰서 작성', steps: ['필수 의뢰정보 입력', '클레임 유형·클라이언트 지위 선택', '녹음·TXT·CSV·Excel 자료를 Gemini로 정리', '저장 후 제안서 작성으로 이동'], next: '프로젝트 의뢰 목록' },
  'CASE-07': { title: '프로젝트 의뢰 목록', steps: ['등록된 의뢰 검색', '의뢰 원문과 상태 확인', '제안서 작성으로 연결', '완료 항목은 일반 목록에서 숨기기'], next: '프로젝트 제안서' },
  'CASE-08': { title: '프로젝트 의뢰 DB관리', steps: ['숨긴 의뢰까지 전체 확인', '일반 목록 복원', 'Google Drive 감사본 보관', '관리자 삭제 처리'], next: '감사 원장 확인' },
  'PROP-02': { title: '제안서 작성', steps: ['의뢰 프로젝트·HWP 원본 템플릿 선택', 'Gemini로 1~3장 순차 초안 작성', '4~12장 회사 공통 기본 모듈·이미지 배치 확인', '담당자 편집·글꼴·색상·AI 문장 개선', '전체 미리보기 확정 후 HWP·DOCX·PDF·DB 보관'], next: '프로젝트 접수' },
  'PROP-03': { title: '프로젝트별 제안서 목록', steps: ['제안서를 발송한 프로젝트 확인', '프로젝트별 발송 버전 비교', '회신·수주 상태 확인', '필요 시 작성 화면에서 이어서 수정'], next: '프로젝트 접수' },
  'PROP-04': { title: '제안서 DB관리', steps: ['발송본 개별 원장 확인', '원문 URL·SHA-256 검증', '등록자·발송시각 감사', '필요한 원장을 Excel로 내보내기'], next: '감사로그' },
  'WF-02': { title: '프로젝트 접수', steps: ['연동 제안서 확인', '수주 확정 또는 접수 취소', '수주 시 ERP 등록 요청 후 일정표 열기'], next: '프로젝트 일정표' },
  'WF-07': { title: '프로젝트 DB관리', steps: ['접수 예정·수주 확정·접수 취소 전체 이력 확인', '프로젝트·제안서 통합 검색', '확정 담당자·시각·버전 감사'], next: '프로젝트 접수 또는 감사로그' },
  'PROJ-01': { title: '프로젝트 일정표', steps: ['월간 캘린더·한국/베트남 휴일 확인', '프로젝트 세부 팝업 열기', '담당 PM과 1~6단계 기간 입력·저장', '업무 화면 양방향 일정 반영 확인', 'A4 출력·PDF 미리보기'], next: '현재 프로젝트 단계' },
  'WF-03': { title: '착수회의', steps: ['회사 Excel 회의록 양식 내보내기·가져오기', '회의 일시·참석자·안건 기록', '회의록·녹음·제공자료 Drive 업로드', 'Gemini 회의록·결정사항·후속업무 생성', '사람 검수 후 저장'], next: '현장조사' },
  'WF-04': { title: '현장조사', steps: ['조사 범위 확인', '사진·녹음 업로드', '날짜·사용자·자료 유형 확인', '특이사항 기록'], next: '물량산출 및 내역' },
  'WF-05': { title: '물량산출 및 내역', steps: ['산출 범위·기준 기록', '팀·기간 배정', '산출서·내역서 업로드', '자료실 반영 확인'], next: '보고서 작성' },
  'REPO-02': { title: '보고서 작성', steps: ['저장본 이어쓰기 또는 새 작업 선택', '프로젝트·완제품 템플릿 열람', '목차 AI 생성·직접 편집', '챕터별 근거 기반 AI 초안', 'Tiptap 사람 편집·드래그 선택 Gemini 개선', '자동저장·실시간 협업 확인', '검토·승인 후 HWP·DOCX·PDF 출력'], next: '검토·승인' },
  'CASE-06': { title: '클레임센터 자료실', steps: ['프로젝트 선택', '자료 구분 선택', '파일 업로드', 'Drive·D1 저장 상태 확인'], next: '해당 프로젝트 업무 단계' },
  'POST-01': { title: '법원 자료·소송 일정', steps: ['프로젝트 선택', '사건번호·법원 입력', '기일·제출기한 등록', '공식 출처 연결'], next: '판결·성과 관리' },
  'APPR-01': { title: '검토·승인', steps: ['제출 버전 확인', '근거·수치 검토', '수정 요청 또는 승인', '감사 이력 확인'], next: '납품 보고서' },
  'MY-01': { title: '설정', steps: ['개인 Gemini 키·비밀번호 저장', '회사 Google Drive OAuth 연결·계정 교체', '관리자 회원 승인·권한 관리', '제안서·보고서 유형별 프롬프트 편집', 'Hermes 메모리·Yjs/Hocuspocus Private Bridge 상태 확인'], next: '업무 화면으로 복귀' }
};
