export const CURRENT_TUTORIAL_VERSION = 'CF79_V1';

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
    explanation: '피해자 측인지 피의자·피고 측인지 선택하고 사건 설명과 첨부 자료의 AI 정리문을 남깁니다. 의뢰·제안·접수 목록은 특정 작성자의 개인 목록이 아니라 승인 회원 모두가 함께 보는 조직 업무입니다.',
    tasks: ['클라이언트 법적 지위 선택', '사건 설명 입력', '필요하면 녹음·TXT·CSV·Excel 자료 추가', '의뢰 저장 후 전 회원 공유 목록 확인'],
    completion: '저장한 의뢰가 다른 승인 회원에게도 보이고 같은 프로젝트가 선택된 제안서 화면으로 이어지면 완료입니다.', path: '/cases/new', pathLabel: '프로젝트 의뢰 열고 확인',
    targetSelectors: ['.case-create-form select', '.case-create-form textarea', '.case-intake-assistant', '.case-create-actions']
  },
  {
    eyebrow: 'PROPOSAL · 제안서 작성', title: '의뢰 내용을 제안서로 이어갑니다.',
    explanation: '의뢰 프로젝트와 HWP 템플릿을 선택하고, Gemini 초안 → 사람 편집 → 전체 미리보기·확정 순서로 진행합니다.',
    tasks: ['연결 프로젝트·원본 템플릿 확인', 'Gemini 1~3장 초안과 회사 고정 모듈 확인', '담당자 검수 편집기·AI 글쓰기 개선 사용', 'HWP·DOCX·PDF 내보내기와 확정본 보관 확인'],
    completion: '전체 미리보기에서 확정한 제안서가 변경 이력과 함께 보관되면 완료입니다.', path: '/proposals/editor', pathLabel: '제안서 스튜디오 열기',
    targetSelectors: ['.proposal-intake-context select', '.proposal-step-card', '.proposal-editor-toolbar, .proposal-step-card textarea', '.proposal-step-button, .proposal-export-actions']
  },
  {
    eyebrow: 'AWARD · 프로젝트 접수', title: '수주 여부를 확인하고 프로젝트로 전환합니다.',
    explanation: '수주 확정된 제안서만 계약 금액과 수행 기간을 가진 실제 프로젝트가 됩니다. 수주 후 취소·수정 이력도 조직 공용 원장에 남습니다.',
    tasks: ['전 회원에게 공유된 제안서 연동 확인', '수주 확정·수정 또는 접수 취소', '수주 시 일정표에서 PM·기간 설정'],
    completion: '수주 프로젝트가 일정표에 나타나면 완료입니다.', path: '/workflow/award', pathLabel: '프로젝트 접수 열고 확인',
    targetSelectors: ['.proposal-flow-list', '.proposal-flow-detail select', '.proposal-flow-detail button']
  },
  {
    eyebrow: 'SCHEDULE · 프로젝트 일정표', title: '모든 단계가 한 프로젝트 일정으로 연결되는지 봅니다.',
    explanation: '수주된 프로젝트만 표시하며 PM·1~6단계 기간·한국/베트남 휴일을 저장합니다. 완료월까지 가로 스크롤로 확인하고 다른 업무 화면과 양방향으로 연결합니다.',
    tasks: ['월 표시·하단 가로 스크롤·한국/베트남 휴일 확인', '프로젝트를 눌러 PM·단계별 기간 편집', '일정 저장 후 관련 업무 화면 반영 확인', '납품완료 표시·Drive 보관 상태와 보관 권한 확인'],
    completion: 'PM과 단계별 일정이 동일하게 보이고 납품완료 건은 PM·관리자만 Drive 확인 후 일정표에서 보관할 수 있으면 완료입니다.', path: '/projects/schedule', pathLabel: '통합 일정표 열기',
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
    explanation: 'PM이 초안을 준비하거나 HWP·DOCX를 적용하고 챕터별 담당자 지정·반영을 맡습니다. 담당자는 배정된 챕터의 문장·표·사진을 편집합니다. 최종 출력은 5단계 결재 승인·확정 후 진행합니다.',
    tasks: ['저장본·템플릿·목차와 이전 작업 복구 확인', 'PM이 초안을 준비하거나 HWP·DOCX 전체 문서 적용', '목차 제목 수정·챕터별 분담·판례 인용 검수 선택', 'Ctrl+S·자동저장 완료 후 문장·표·사진과 배치 확인', '5단계에서 최종 결재자 선택·상신 후 승인본 HWP/DOCX/PDF 출력'],
    completion: '지정 결재자가 저장 버전을 승인하고 PM이 5단계에서 승인본을 확정·출력하면 완료입니다.', path: '/reports/studio', pathLabel: '보고서 스튜디오 열기',
    targetSelectors: ['.report-workspace-resume, .report-workspace-selector', '.report-template-viewer-control, .report-outline-editor', '.report-wizard-navigation, .report-ai-action', '.structured-document-editor, .report-editor', '.report-wizard-footer']
  },
  {
    eyebrow: 'APPROVAL · 검토 승인', title: '대표 또는 부사장이 최종 승인합니다.',
    explanation: '5단계에서 지정한 대표·임원이 제출 당시의 본문·표·사진을 확인하고 승인 또는 수정 요청을 합니다. 상신자와 해당 버전 저장자는 자신의 보고서를 승인할 수 없습니다.',
    tasks: ['업무 알림·결재함에서 지정된 상신본 열기', '제출 버전 확인 표시 후 승인 또는 사유를 적어 수정 요청', 'PM 알림·승인 이메일 상태 확인 후 5단계 확정·출력'],
    completion: '승인 이력과 PM 알림이 남고 5단계에서 승인본을 확정·출력할 수 있으면 완료입니다.', path: '/approval', pathLabel: '검토·승인 열고 확인',
    targetSelectors: ['.content-stack > *:first-child', '.inline-form', '.content-stack > *:last-child']
  },
  {
    eyebrow: 'EVIDENCE · 자료실', title: '모든 원본 자료는 회사 Google Drive에 모읍니다.',
    explanation: '프로젝트 워크로 전환된 활성 프로젝트만 선택할 수 있습니다. 원본은 클레임센터 전용 Drive 폴더에 저장되고 업로더·시간·무결성 확인 이력이 함께 남습니다.',
    tasks: ['프로젝트 선택', '착수·현장·산출·내역 등 자료 종류 선택', '드래그앤드롭 업로드', 'Drive 폴더·업로더·날짜·무결성 확인'],
    completion: 'GOOGLE_DRIVE 저장 표시와 다운로드 링크가 보이면 완료입니다.', path: '/cases/files', pathLabel: '자료실 열고 확인',
    targetSelectors: ['.preview-evidence-hero', '.inline-form', '.case-evidence-dropzone']
  },
  {
    eyebrow: 'CONTACTS · 인맥관리', title: '명함 사진을 확인 가능한 인맥 데이터로 바꿉니다.',
    explanation: '명함 촬영본을 올리면 Gemini가 이름·회사·직함·연락처를 구조화합니다. AI 결과를 원본과 대조해 수정한 뒤 등록해야 하며 원본 이미지는 회사 Google Drive에 저장됩니다.',
    tasks: ['모바일 촬영 또는 JPG·PNG·WEBP 선택', 'Gemini 명함 인식 실행', '원본과 인식값 대조·직접 수정', '확인 완료 후 Drive 저장·인맥 등록'],
    completion: 'Drive 원본 링크가 있는 연락처를 인맥관리 검색에서 찾을 수 있으면 완료입니다.', path: '/contacts/cards/new', pathLabel: '명함등록 열기',
    targetSelectors: ['.business-card-drop', '.business-card-register-grid button', '.business-card-form', '.business-card-register-actions']
  },
  {
    eyebrow: 'COURT · 법원 자료', title: '법원 사건번호와 소송 일정을 사람이 확인해 등록합니다.',
    explanation: '현재는 법원 자동 스크래핑이 아니라 사람이 공식 출처를 확인하는 내부 검증 방식입니다. 확인된 값만 일정표에 반영합니다.',
    tasks: ['법원·사건번호 입력', '공식 출처 URL 기록', '기일·제출기한 등록', '검증 상태 확인'],
    completion: '프로젝트와 법원 일정이 연결되면 완료입니다.', path: '/after-delivery', pathLabel: '법원 자료 열고 확인',
    targetSelectors: ['.litigation-search', '.litigation-list', '.litigation-detail']
  },
  {
    eyebrow: 'SETTINGS · 안전한 연결', title: '마지막으로 개인·관리자 연결 상태를 확인합니다.',
    explanation: '개인은 Gemini 보조 키와 비밀번호를, 관리자는 회사 Google Drive·회원·OpenAI/Claude/Gemini 모델·유형별 프롬프트·메모리 브리지를 관리합니다.',
    tasks: ['개인 Gemini 키·비밀번호 저장 상태 확인', '회사 Google Drive 연결 계정 확인', '회원 승인·AI 모델 선택 확인', '자동 저장·협업 기능 준비 상태 확인'],
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
  proposal: { title: '프로젝트 접수', purpose: '승인 회원 모두가 같은 의뢰 → 제안서 → 접수 원장을 보고, 확정된 건만 실제 프로젝트로 전환합니다.', inputs: ['조직 공용 의뢰 원문·첨부자료', 'HWP 제안서 템플릿', 'Gemini API', '거래처 수주 회신'], actions: ['AI 의뢰서 초안 검수', '제안서 4단계 작성·담당자 편집', 'HWP·DOCX·PDF 확정본 보관', '제안서 연동 후 수주·수정 또는 취소'], outputs: ['전 회원 공용 프로젝트 원장', '프로젝트별 제안서 버전', '수주 프로젝트', 'ERP 전송 대기정보'], cautions: ['작성자 개인 목록이 아닙니다. 수주·취소 변경 전 프로젝트와 제안서 번호를 다시 확인하세요.'] },
  work: { title: '프로젝트 워크', purpose: '수주 후 PM 일정부터 착수·현장·산출·보고서 작성·지정 결재·최종 출력까지 연결합니다.', inputs: ['수주 프로젝트', 'PM·단계별 기간', '회의록·현장·산출 자료', '보고서 템플릿 또는 HWP·DOCX', '최종 결재자'], actions: ['일정·회의·현장·산출 자료 저장', 'HWP·DOCX 적용 후 문장·표·사진 편집', '목차 제목 수정·챕터별 분담·판례 인용 검수', '자동 저장 완료 후 5단계에서 결재상신', '승인본 확정 후 DOCX·HWP·PDF 출력'], outputs: ['통합 일정·근거 자료', '편집·협업·서버 저장 이력', '지정 결재 이력과 확정 보고서'], cautions: ['담당자는 배정 챕터를, PM은 전체 본문과 배정·반영을 담당합니다.', '이전 작업 복구의 임시본은 마지막 보관 후 7일간 유지하고 사이트 사용 중 만료본을 정리합니다. 서버 저장과는 별도입니다.', '업데이트·도움말·알림은 왼쪽 아래 계정·업무 도구에서 엽니다. 모바일은 메뉴를 먼저 엽니다.'] },
  library: { title: '드라이브', purpose: '활성 프로젝트 원본과 명함 인맥을 클레임센터 전용 회사 Google Drive 구조에 연결합니다.', inputs: ['사진·녹음·문서', '자료 종류', '명함 촬영본', '촬영·작성 날짜'], actions: ['활성 프로젝트 선택', '자료 업로드·분류·무결성 확인', 'Gemini 명함 인식', '사람 확인 후 인맥 등록·검색'], outputs: ['Drive 원본', '자료 등록 이력', '검색 가능한 인맥 목록'], cautions: ['삭제·취소된 프로젝트는 선택되지 않습니다. AI 명함 인식값은 등록 전에 원본과 반드시 대조하세요.'] },
  court: { title: '법원 자료', purpose: '사건번호, 법원, 기일과 제출 자료를 프로젝트별로 관리합니다.', inputs: ['사건번호', '법원·재판부', '기일', '제출·송달 자료'], actions: ['일정 등록', '자료 연결', '상태 갱신'], outputs: ['소송 일정표', '법원 자료 이력'], cautions: ['법원 공식 자료와 사람이 대조한 값만 확정하세요.'] },
  quality: { title: '검토·납품 관리', purpose: '지정 결재자가 상신본을 승인한 뒤 보고서 5단계에서 승인 버전을 납품본으로 확정합니다.', inputs: ['상신된 보고서 버전', '지정 결재자', '검토 의견', '납품 정보'], actions: ['업무 알림·결재함에서 제출 본문·표·사진 열기', '제출 버전 확인 후 승인 또는 수정 요청', 'PM 알림·승인 이메일 수신 담당자와 발송 상태 확인', '보고서 5단계에서 승인본 확정·DOCX·HWP·PDF 출력', '납품·성과 기록'], outputs: ['상신·승인 이력', '확정 당시 본문으로 만든 최종 파일'], cautions: ['상신자와 해당 버전 저장자는 자신의 보고서를 승인할 수 없습니다.', '메일 서버 접수는 실제 받은함 도착·열람과 다릅니다. 결과 확인 중에는 중복 발송을 하지 않습니다.', '앞 단계의 작성본 출력은 검수용입니다. 수정 요청 후에는 새 버전을 저장해 다시 상신하세요.'] },
  settings: { title: '설정', purpose: '개인 계정과 AI 연결을 관리하고, 관리자는 회사 Drive·회원·공용 작성 정책을 관리합니다.', inputs: ['개인 API 키', '비밀번호', '회사 Drive 계정', '회원 권한'], actions: ['안전하게 저장', 'Drive 계정 연결·교체', '회원 승인·비밀번호 관리', '작성 정책 확인'], outputs: ['사용자별 연결 상태', '조직 공용 정책'], cautions: ['비밀키 원문을 문서·보고서·메모리에 붙이지 말고 브라우저에 다시 표시하지 마세요.'] }
};

export const ROUTE_HELP: Record<string, { title: string; steps: readonly string[]; next: string }> = {
  'WL-01': {title:'일일 업무일지',steps:['프로젝트 워크→업무일지를 펼쳐 일일 업무일지를 엽니다. 이경훈·최영배·장범선 본인 계정으로 배정 프로젝트와 작성일을 선택합니다.','실제 저장된 업무는 자동 기록됩니다. 오늘의 목표·세부 계획·계획 메모, 수행 업무·진행률·상태·실제 시간, 미완료·지연 사유·장애요인, 내일 계획·특이사항은 본인이 입력합니다.','일일 업무일지 저장 후 서버 저장본 다시 열기로 본인 내용과 버전을 확인합니다. 충돌 시 입력을 유지합니다. 기존 직접 기록도 보존됩니다.','주간 업무일지 보기로 같은 프로젝트·작성일의 주간표를 엽니다. 대표·부사장·관리자는 작성 대상에서 제외하며 기존 조회 권한을 유지합니다.'],next:'주간 업무일지 확인'},
  'WL-02': {title:'주간 업무일지',steps:['프로젝트 워크→업무일지→주간 업무일지를 엽니다. 월요일에는 전주, 나머지 요일에는 이번 주를 먼저 보여 줍니다.','조회 날짜·이전 주·다음 주·이번 주로 기간을 선택하고 전체 배정 프로젝트 또는 프로젝트 하나를 선택합니다. 직원은 본인 일지를 작성하며 수신자는 지정된 상신본만 결재합니다.','월~일 7열의 최신 일일 작성본과 실제 자동 작업을 확인합니다. 주간 표 엑셀로 현재 개인별 표를 내려받습니다. 시간·진행률을 자동 추정하지 않습니다.','결재 수신자 선택을 펼쳐 본인을 제외한 기존 활성 결재자를 선택하고 현재 주간 상신을 누릅니다. 같은 주간 대기본의 중복 상신은 차단합니다. 상신 당시 내용은 이후 일일 원고를 고쳐도 바뀌지 않습니다.','받은·보낸 상신본 또는 업무 알림에서 고정 날짜별 표를 열어 확인 체크 후 승인하거나 의견과 함께 수정 요청합니다. 수신자 전원이 승인해야 완료됩니다. 반려 후에는 수정하고 새로 상신합니다.','정기보고 사용·수신자를 확인하고 정기보고 설정 저장을 누르면 현재 프로젝트 범위를 함께 저장합니다. 기본은 전체 배정 프로젝트·기존 대표/부사장입니다. 한국시간 금요일 17:10 이후 당주, 월요일 09:00 이후 전주 토·일 업무가 있을 때 추가 보고를 자동 상신합니다. 중복 실행으로 같은 정기본이 늘지 않습니다.','정기전달은 앱 내 결재 알림입니다. 이메일 접수·수신 상태와 혼동하지 않습니다. 모바일 주간표는 표 안에서 좌우로 이동합니다. 미저장 경고에서 취소하면 입력을 유지합니다.'],next:'지정 수신자의 상신본 확인·결재와 정기보고 상태 확인'},
  'CASE-02': { title: '프로젝트 의뢰서 작성', steps: ['필수 의뢰정보 입력', '클레임 유형·클라이언트 지위 선택', '녹음·TXT·CSV·Excel 자료를 Gemini로 정리', '저장 후 제안서 작성으로 이동'], next: '프로젝트 의뢰 목록' },
  'CASE-07': { title: '프로젝트 의뢰 목록', steps: ['등록된 의뢰 검색', '의뢰 원문과 상태 확인', '제안서 작성으로 연결', '완료 항목은 일반 목록에서 숨기기'], next: '프로젝트 제안서' },
  'CASE-08': { title: '프로젝트 의뢰 DB관리', steps: ['숨긴 의뢰까지 전체 확인', '일반 목록 복원', 'Google Drive 감사본 보관', '관리자 삭제 처리'], next: '감사 원장 확인' },
  'PROP-02': { title: '제안서 작성', steps: ['의뢰 프로젝트·HWP 원본 템플릿 선택', 'Gemini로 1~3장 순차 초안 작성', '4~12장 회사 공통 기본 모듈·이미지 배치 확인', '담당자 편집·글꼴·색상·AI 문장 개선', '전체 미리보기 확정 후 HWP·DOCX·PDF 확정본 보관'], next: '프로젝트 접수' },
  'PROP-03': { title: '프로젝트별 제안서 목록', steps: ['제안서를 발송한 프로젝트 확인', '프로젝트별 발송 버전 비교', '회신·수주 상태 확인', '필요 시 작성 화면에서 이어서 수정'], next: '프로젝트 접수' },
  'PROP-04': { title: '제안서 DB관리', steps: ['발송본 개별 원장 확인', '원문 URL·SHA-256 검증', '등록자·발송시각 감사', '필요한 원장을 Excel로 내보내기'], next: '감사로그' },
  'WF-02': { title: '프로젝트 접수', steps: ['확정한 제안서의 프로젝트·버전을 확인합니다. 긴 한글 제목 전체와 영문 대소문자 구분 없이 검색할 수 있으며 %와 _는 문자 그대로 찾습니다.', '수주 확정 또는 접수 취소를 선택합니다. 접수 후 같은 프로젝트의 담당 PM과 보고서 작성 일정을 지정합니다.', '수주 시 ERP 등록 요청 상태를 확인하고 일정표를 엽니다. 내부 접수 완료와 외부 ERP 등록 완료는 별개이며 연결 대기·실패는 완료로 처리하지 않습니다.'], next: '프로젝트 일정표 → 보고서 작성' },
  'WF-07': { title: '프로젝트 DB관리', steps: ['접수 예정·수주 확정·접수 취소 전체 이력 확인', '프로젝트·제안서 통합 검색', '확정 담당자·시각·버전 감사'], next: '프로젝트 접수 또는 감사로그' },
  'PROJ-01': { title: '프로젝트 일정표', steps: ['월 표시·하단 가로 스크롤·한국/베트남 휴일 확인', '프로젝트 세부 팝업 열기', '담당 PM과 1~6단계 기간 입력·저장', '업무 화면 양방향 일정 반영 확인', '납품완료 표시와 Drive 보관 확인 후 PM·관리자 보관'], next: '현재 프로젝트 단계' },
  'WF-03': { title: '착수회의', steps: ['회사 Excel 회의록 양식 내보내기·가져오기', '회의 일시·참석자·안건 기록', '회의록·녹음·제공자료 Drive 업로드', 'Gemini 회의록·결정사항·후속업무 생성', '사람 검수 후 저장'], next: '현장조사' },
  'WF-04': { title: '현장조사', steps: ['조사 범위 확인', '사진·녹음 업로드', '날짜·사용자·자료 유형 확인', '원문·요약·후속 일정을 저장하고 사람이 검수한 결과를 확정합니다. 조사 계획 완료와 결과 확정은 별도입니다.', '보고서 작성은 같은 프로젝트의 저장된 조사 결과와 확정 상태·버전을 참고합니다. 누락·미확정 사항과 실제 근거를 대조하며, 저장 요약만으로 수량·금액·책임을 확정하지 않습니다.'], next: '물량산출 및 내역' },
  'WF-05': { title: '물량산출 및 내역', steps: ['산출 범위·기준 기록', '팀·기간 배정', '산출서·내역서 업로드', '자료실 반영 확인'], next: '보고서 작성' },
  'REPO-02': { title: '보고서 작성', steps: ['저장본 이어쓰기에서 프로젝트·저장 버전을 확인합니다. 임시본은 이전 작업 복구를 눌러 서버 저장본과 비교한 뒤 선택합니다.', '임시 복구본은 마지막 보관 후 7일간 유지하며 만료본은 사이트 사용 중 정리합니다. 서버 저장본·직접 보관한 파일은 이 정책으로 삭제하지 않습니다.', '3단계에서 HWP 메뉴의 HWP/HWPX 문장·표·사진 가져오기를 선택하고, 확인창의 N쪽 편집 가능하게 적용을 누릅니다. DOCX는 DOCX 전체 적용으로 가져옵니다. 전체 적용은 현재 본문을 교체하므로 적용 전 저장하세요.', '가져온 문장·표·사진을 웹에서 수정합니다. 원형 HWP 팝업의 전체 문서를 보고서에 적용은 페이지 적용 경로이며, 문장·표·사진 편집형 가져오기와 다릅니다. 지원하지 않는 구조 안내가 나오면 기존 원고를 유지하고 원본을 확인하세요.', '4단계의 목차 제목 수정·챕터별 분담·판례 인용 검수를 선택해 필요한 도구만 엽니다. 담당자 작성 후 PM이 최신 챕터를 전체 편집본에 반영합니다.', 'Ctrl+S 또는 자동 저장 완료를 확인하고 다시 열어 글자·셀·사진과 배치를 확인합니다. 앞 단계의 작성본 출력·미리보기는 검수용입니다.', '5단계에서 저장 버전·최종 결재자·결재 요청 내용을 확인하고 선택한 결재자에게 상신을 누릅니다. 상신자와 해당 버전 저장자는 결재자로 선택할 수 없습니다.', '결재자는 업무 알림·검토·승인에서 상신본을 확인합니다. 수정 요청을 받으면 의견에 따라 고친 새 버전을 저장하고 다시 상신합니다.', '승인 후 승인본 확정·출력 준비를 누르거나 DOCX·HWP·PDF 첫 출력으로 승인 버전을 확정합니다. 이후 출력은 현재 편집본이 아닌 확정 당시 본문을 사용합니다. HWP는 실제 생성 파일의 문장·줄바꿈·글자 위치를 검사한 뒤 내려받습니다. 위치 검증 오류가 표시되면 기존 저장·확정본은 유지됩니다.', '결재 승인 이메일에서 수신 담당자와 상태를 확인합니다. 재요청 가능 시 담당자에게 승인 이메일 보내기를 누릅니다. 받은 메일의 승인 보고서 확인·출력을 눌러 해당 프로젝트 5단계를 엽니다. 로그인 안내가 나오면 기존 계정으로 로그인하고 프로젝트·승인 버전을 확인한 뒤 출력합니다. 접수 완료·결과 확인 중에는 중복 발송하지 않으며, 서버 접수는 실제 받은함 도착과 다릅니다.'], next: '지정 결재자 검토 → 승인본 확정·출력' },
  'CASE-06': { title: '드라이브', steps: ['프로젝트 선택', '자료 구분 선택', '파일 업로드', 'Drive 저장 상태 확인'], next: '해당 프로젝트 업무 단계' },
  'CONTACT-01': { title: '인맥관리', steps: ['이름·회사·부서·직함·연락처·태그 검색', '연락처 상세 확인', 'Drive 원본 명함 열기', '필요하면 새 명함 등록'], next: '명함등록' },
  'CONTACT-02': { title: '명함등록', steps: ['모바일 촬영 또는 이미지 선택', 'Gemini 구조화 인식', '원본과 인식값 대조·수정', '확인 완료 후 Drive 저장·인맥 등록'], next: '인맥관리 검색' },
  'CONTACT-03': { title: '명함 DB관리', steps: ['관리자 권한 확인', '활성·보관 명함 통합 검색', 'Drive 원본·등록자·모델 확인', '물리 삭제 없이 보관 또는 복원'], next: '인맥관리' },
  'POST-01': { title: '법원 자료·소송 일정', steps: ['프로젝트 선택', '사건번호·법원 입력', '기일·제출기한 등록', '공식 출처 연결'], next: '판결·성과 관리' },
  'APPR-01': { title: '검토·승인', steps: ['업무 알림의 상신본 확인·결재 또는 검토·승인 메뉴에서 나에게 지정된 상신을 엽니다.', '제출 본문·표·사진 보기로 제출 당시 버전과 자료를 읽습니다. 현재 편집 중인 원고와 구분하세요.', '본문·표·사진 확인 표시 후 이 버전 승인을 누르거나, 검토 의견에 사유를 적고 수정 요청을 합니다. 상신자와 해당 버전 저장자는 승인할 수 없습니다.', '승인 후 PM의 업무 알림과 결재 승인 이메일의 수신 담당자·발송 상태를 확인합니다. 받은 메일의 결재 내용 버튼으로 해당 상신본·승인 결과를 확인합니다. 서버 접수와 실제 받은함 도착은 구분합니다.', 'PM은 보고서 5단계에서 승인본 확정·출력 준비 또는 첫 출력으로 승인 버전을 확정하고 DOCX·HWP·PDF를 내려받습니다.'], next: '보고서 5단계 승인본 확정·출력 → 납품 보고서' },
  'MY-01': { title: '설정', steps: ['개인 Gemini 키·비밀번호 저장', '회사 Google Drive 연결·계정 교체', '관리자 회원 승인·권한 관리', '제안서·보고서 작성 정책 확인', '자동 저장·협업 기능 상태 확인'], next: '업무 화면으로 복귀' }
};
