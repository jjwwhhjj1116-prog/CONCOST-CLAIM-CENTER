export const CURRENT_TUTORIAL_VERSION = 'CF35_V1';

export interface TutorialStep {
  eyebrow: string;
  title: string;
  explanation: string;
  tasks: readonly string[];
  completion: string;
  path: string;
  pathLabel: string;
}

export const WORKSPACE_TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    eyebrow: 'START · 업무 홈', title: '먼저 오늘 해야 할 프로젝트를 확인합니다.',
    explanation: '처음에는 CLAIM CENTER HOME에서 진행 중 프로젝트, 검토 대기, 일정과 마감 항목을 확인하세요.',
    tasks: ['대시보드의 진행 현황 확인', '내가 담당한 프로젝트 선택', '현재 단계와 다음 할 일 확인'],
    completion: '작업할 프로젝트와 오늘 처리할 단계가 정해지면 완료입니다.', path: '/dashboard', pathLabel: '업무 홈 열기'
  },
  {
    eyebrow: 'PROPOSAL · 의뢰와 수주', title: '새 의뢰를 등록하고 제안서를 연결합니다.',
    explanation: '프로젝트 의뢰를 저장하면 제안서 작성으로 이어집니다. 수주가 확정된 프로젝트만 실제 업무 단계로 넘어갑니다.',
    tasks: ['프로젝트 의뢰 등록', '제안서 작성·발송본 연결', '수주 여부와 프로젝트 접수 확인'],
    completion: '수주 확정과 담당자 배정이 끝나면 프로젝트 워크가 열립니다.', path: '/cases/new', pathLabel: '프로젝트 의뢰 열기'
  },
  {
    eyebrow: 'PROJECT WORK · 실행', title: '일정표에서 프로젝트의 현재 위치를 확인합니다.',
    explanation: '착수회의, 현장조사, 물량산출·내역, 보고서 작성이 하나의 프로젝트 일정에 연결됩니다.',
    tasks: ['프로젝트 일정표에서 대상 선택', '착수회의 기록·후속 업무 작성', '현장·산출 자료와 팀 일정을 등록'],
    completion: '보고서에 필요한 회의·현장·수량 근거가 준비되면 완료입니다.', path: '/projects/schedule', pathLabel: '프로젝트 일정표 열기'
  },
  {
    eyebrow: 'EVIDENCE · 자료실', title: '모든 근거 자료는 프로젝트 자료실에 모읍니다.',
    explanation: '사진, 녹음, 산출서, 내역서와 회의 자료를 프로젝트에 연결합니다. 원본은 회사 Google Drive, 메타데이터는 D1에서 관리합니다.',
    tasks: ['올바른 프로젝트 선택', '자료 종류와 날짜 확인', '업로드 완료·해시·업로더 확인'],
    completion: '보고서가 참조할 자료가 올바른 프로젝트에 표시되면 완료입니다.', path: '/cases/files', pathLabel: '자료실 열기'
  },
  {
    eyebrow: 'REPORT · 5단계 작성', title: '보고서는 한 단계씩 완료하고 다음으로 이동합니다.',
    explanation: '템플릿 확인 → 목차 기획 → 챕터별 AI 작성 → 사람 검토·수정 → 검토·승인·출력 순서입니다.',
    tasks: ['유형별 완제품 템플릿 열람', '목차를 먼저 확정', '각 챕터 근거 확인 후 AI 작성', '숫자·출처를 사람이 검토', '최신 저장본만 검토 요청'],
    completion: '독립 검토자가 승인한 정확한 버전의 DOCX/PDF를 생성하면 완료입니다.', path: '/reports/studio', pathLabel: '보고서 작성 열기'
  },
  {
    eyebrow: 'COURT & DELIVERY · 납품 이후', title: '검토·납품 후 법원 일정과 수정 이력을 관리합니다.',
    explanation: '검토 승인, 납품 보고서, 법원 사건번호·기일, 판결과 후속 수정 차수를 프로젝트별로 남깁니다.',
    tasks: ['검토 의견 반영', '승인본 납품 이력 확인', '법원 사건번호·기일 등록', '수정 차수와 판결 결과 기록'],
    completion: '프로젝트의 납품본과 사후 일정이 서로 연결되면 완료입니다.', path: '/after-delivery', pathLabel: '법원 자료 열기'
  },
  {
    eyebrow: 'SETTINGS · 안전한 연결', title: '설정은 개인용과 관리자용을 구분합니다.',
    explanation: '개인은 Gemini 보조 키를 저장하고, 관리자는 회사 Google Drive·유형별 프롬프트·D1 Hermes 호환 메모리 정책을 관리합니다.',
    tasks: ['개인 Gemini 키 연결 상태 확인', '관리자만 회사 공용 정책 변경', '학습 후보는 관리자 승인 후 사용', '베트남 서버 연결 시 Private Bridge 상태 확인'],
    completion: '화면에 연결 상태가 표시되고 비밀키 원문이 노출되지 않으면 완료입니다.', path: '/settings', pathLabel: '설정 열기'
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
  home: { title: 'CLAIM CENTER HOME', purpose: '오늘 처리할 프로젝트와 병목을 가장 먼저 찾는 화면입니다.', inputs: ['담당 프로젝트', '검토 대기', '마감 일정'], actions: ['프로젝트 선택', '현재 단계 확인', '다음 업무 화면 이동'], outputs: ['오늘의 우선순위', '프로젝트 진행률'], cautions: ['표시 숫자는 상세 목록과 함께 확인하세요.'] },
  proposal: { title: '프로젝트 제안 및 수주', purpose: '의뢰를 제안서와 연결하고 수주 확정 후 실제 프로젝트로 전환합니다.', inputs: ['의뢰 정보', '발송 제안서', '거래처 회신'], actions: ['의뢰 저장', '제안서 작성·연결', '수주 확정·담당자 배정'], outputs: ['수주 프로젝트', '프로젝트 기본정보'], cautions: ['회신 대기 상태에서는 착수 단계로 넘기지 마세요.'] },
  work: { title: '프로젝트 워크', purpose: '착수부터 보고서 작성까지 실행 자료·팀·일정을 연결합니다.', inputs: ['수주 프로젝트', '회의록', '현장 자료', '산출·내역 자료'], actions: ['일정 조정', '업무 기록', '자료 업로드', '보고서 작성'], outputs: ['단계별 완료 상태', '통합 일정', '보고서 근거'], cautions: ['항상 상단과 좌측의 현재 프로젝트를 확인하세요.'] },
  library: { title: '클레임센터 자료실', purpose: '프로젝트별 원본 자료를 회사 Google Drive 구조와 연결합니다.', inputs: ['사진·녹음·문서', '자료 종류', '촬영·작성 날짜'], actions: ['프로젝트 선택', '드래그앤드롭', '분류·해시 확인'], outputs: ['Drive 원본', 'D1 자료 메타데이터'], cautions: ['다른 프로젝트를 선택한 상태에서 업로드하지 마세요.'] },
  court: { title: '법원 자료', purpose: '사건번호, 법원, 기일과 제출 자료를 프로젝트별로 관리합니다.', inputs: ['사건번호', '법원·재판부', '기일', '제출·송달 자료'], actions: ['일정 등록', '자료 연결', '상태 갱신'], outputs: ['소송 일정표', '법원 자료 이력'], cautions: ['법원 공식 자료와 사람이 대조한 값만 확정하세요.'] },
  quality: { title: '검토·납품·품질관리', purpose: '작성자와 다른 검토자가 승인한 버전만 납품본으로 확정합니다.', inputs: ['최신 보고서 버전', '검토 의견', '납품 정보', '판결 결과'], actions: ['검토 요청', '수정·승인', 'DOCX/PDF 생성', '납품·성과 기록'], outputs: ['불변 승인 이력', '최종 납품 파일'], cautions: ['승인 전 초안을 납품본으로 사용하지 마세요.'] },
  settings: { title: '설정', purpose: '개인 Gemini와 관리자 공용 연결·프롬프트·메모리 정책을 안전하게 관리합니다.', inputs: ['개인 API 키', '회사 OAuth', '프롬프트 정책', '메모리 정책'], actions: ['연결 확인', '암호화 저장', '관리자 승인', 'Private Bridge 준비'], outputs: ['사용자별 연결 상태', '조직 공용 정책'], cautions: ['API 키 원문을 문서·보고서·메모리에 붙여 넣지 마세요.'] }
};

export const ROUTE_HELP: Record<string, { title: string; steps: readonly string[]; next: string }> = {
  'CASE-02': { title: '프로젝트 의뢰', steps: ['필수 의뢰정보 입력', '클레임 유형 선택', '담당자 확인', '저장 후 제안서 작성으로 이동'], next: '제안서 작성' },
  'PROP-02': { title: '제안서 작성', steps: ['의뢰 프로젝트 선택', '제안 내용 작성', '발송본 버전 고정', '수주 회신 대기'], next: '프로젝트 접수' },
  'WF-02': { title: '프로젝트 접수', steps: ['발송 제안서 연결', '수주 확정 확인', '프로젝트 담당자 배정'], next: '프로젝트 일정표' },
  'PROJ-01': { title: '프로젝트 일정표', steps: ['프로젝트 검색', '세부 팝업 열기', '단계·팀·기간 확인', '충돌 일정 조정'], next: '현재 프로젝트 단계' },
  'WF-03': { title: '착수회의', steps: ['회의 일시·참석자 기록', '회의 메모 저장', 'AI 회의록·타임라인 생성', '후속 업무 확인'], next: '현장조사' },
  'WF-04': { title: '현장조사', steps: ['조사 범위 확인', '사진·녹음 업로드', '날짜·사용자·자료 유형 확인', '특이사항 기록'], next: '물량산출 및 내역' },
  'WF-05': { title: '물량산출 및 내역', steps: ['산출 범위·기준 기록', '팀·기간 배정', '산출서·내역서 업로드', '자료실 반영 확인'], next: '보고서 작성' },
  'REPO-02': { title: '보고서 작성', steps: ['프로젝트·템플릿 확인', '목차 기획 확정', '챕터별 AI 작성', '사람 검토·수정', '검토·승인·출력'], next: '검토·승인' },
  'CASE-06': { title: '클레임센터 자료실', steps: ['프로젝트 선택', '자료 구분 선택', '파일 업로드', 'Drive·D1 저장 상태 확인'], next: '해당 프로젝트 업무 단계' },
  'POST-01': { title: '법원 자료·소송 일정', steps: ['프로젝트 선택', '사건번호·법원 입력', '기일·제출기한 등록', '공식 출처 연결'], next: '판결·성과 관리' },
  'APPR-01': { title: '검토·승인', steps: ['제출 버전 확인', '근거·수치 검토', '수정 요청 또는 승인', '감사 이력 확인'], next: '납품 보고서' },
  'MY-01': { title: '설정', steps: ['개인 또는 관리자 탭 확인', '연결 상태 확인', '필요한 항목만 변경', '저장 결과 확인'], next: '업무 화면으로 복귀' }
};
