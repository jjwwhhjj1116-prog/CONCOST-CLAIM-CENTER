# 인수 시나리오 및 추적성 매핑 명세서 (Acceptance Scenarios & Traceability Matrix)

## 1. 개요
본 명세서는 클레임 케이스 허브 및 AI 보고서 스튜디오의 사용자 요구사항, 20개 전수 화면, 33개 데이터 엔터티, 6대 고정 클레임 업무 유형 (`TYPE-01`~`TYPE-06`), 제품 불변조건 간의 양방향 추적성을 보장하고, 12가지 독립적 완결 정상 인수 시나리오 및 2가지 독립 실패/거부 시나리오를 정의합니다.

## 2. 화면-엔터티-요구사항 추적성 매핑 표 (Full Traceability Matrix: 20 Screens x 33 Entities)

| 화면 ID 및 화면명 | 주 데이터 엔터티 (Entity: 33종 전수) | 관련 시나리오 | 관련 불변조건 및 비목표 규칙 |
| :--- | :--- | :---: | :--- |
| **01 로그인 (AUTH-01)** | `User`, `Role`, `Permission`, `AuditLog` | SCENARIO-12 | OAuth토큰 브라우저 평문 저장 금지, 감사로그 기록 |
| **02 메인 대시보드 (DASH-01)** | `Case`, `Deadline`, `SuccessFee`, `ApprovalRequest`, `Notification` | SCENARIO-01, SCENARIO-11 | 10초 이해 원칙, 6대 클레임 유형별 KPI 및 7개 핵심 질문 |
| **03 사건 목록 (CASE-01)** | `Case`, `CaseCategory`, `CaseParty`, `Party` | SCENARIO-01 | 역할별 사건 조회 범위 제한, RBAC 권한 가드 |
| **04 새 사건 등록 (CASE-02)** | `Case`, `CaseCategory`, `AuditLog` | SCENARIO-01 | 6대 클레임 유형(TYPE-01~06) 및 대·중·소분류 지정, 생성 시 AuditLog |
| **05 사건 상세-개요 (CASE-03)** | `Case`, `Activity`, `AuditLog` | SCENARIO-01 | 소프트 삭제 지원, 낙관적 잠금 (Version) |
| **06 사건 상세-일정 (CASE-04)** | `Case`, `Deadline`, `Notification` | SCENARIO-02 | 복수 D-day 등록, 기일 정렬 및 알림 수신 |
| **07 사건 상세-관계자 (CASE-05)** | `Case`, `CaseParty`, `Party` | SCENARIO-02 | 원고/피고/참고인 복수 관계자 등록 |
| **08 사건 상세-자료실 (CASE-06)** | `Document`, `DocumentVersion`, `AuditLog` | SCENARIO-03 | 표준 파일명 규칙, 버전 및 원본/최종본 보존 |
| **09 회의록 (MEET-01)** | `Meeting`, `MeetingActionItem`, `Activity` | SCENARIO-05 | 원본/확정 회의록 보존, 할 일 담당자 연결 |
| **10 제안서 템플릿 선택 (PROP-01)**| `Template`, `TemplateSection`, `Proposal` | SCENARIO-04 | 6대 클레임 유형별 템플릿 선택, 사건 정보 자동 치환 |
| **11 제안서 단계형 작성기 (PROP-02)**| `Proposal`, `ProposalVersion`, `GenerationRun`, `GenerationSource` | SCENARIO-04 | 치환 누락 필드 주황색 배지, 승인 전 출력 차단 |
| **12 보고서 목록 (REPO-01)** | `Report`, `ReportSection`, `Case` | SCENARIO-06 | 보고서 제출 ≠ 사건 종결 불변조건 |
| **13 보고서 스튜디오 (REPO-02)** | `Report`, `ReportSection`, `ReportSectionVersion`, `SourceReference`, `GenerationSource` | SCENARIO-07, SCENARIO-08, SCENARIO-09, SCENARIO-10, FAIL-02 | 3단 구조, 7대 표준 장 상태, 명시적 근거 선택 |
| **14 검토·승인함 (APPR-01)** | `ApprovalRequest`, `ApprovalDecision`, `ReportSection`, `Notification` | SCENARIO-08, SCENARIO-09, SCENARIO-10, FAIL-01 | 2인 교차 검수, 승인된 장만 DOCX/PDF 병합 |
| **15 성공보수 (FEE-01)** | `Contract`, `SuccessFee`, `Case` | SCENARIO-11 | 정산 요율 계산식, 미수 상태 종결 경고 |
| **16 템플릿 관리 (TPL-01)** | `Template`, `TemplateSection`, `TemplateBlock` | SCENARIO-06 | 6대 유형별 primary/secondary 템플릿 분류 관리 |
| **17 AI 공급자 설정 (AI-01)** | `AIProvider`, `AIModel`, `AIPolicy` | SCENARIO-12 | API키 서버 전용, 5개 멀티 공급자 지원 |
| **18 사용자·권한 (USER-01)** | `User`, `Role`, `Permission` | SCENARIO-12, FAIL-01 | RBAC 6대 사용자 역할 제어 |
| **19 감사로그 (AUD-01)** | `AuditLog` | SCENARIO-12 | Append-only 불변 로그 기록 |
| **20 태블릿 축약 화면 (RESP-01)**| 전체 엔터티 33종 전수 | SCENARIO-01~SCENARIO-12, FAIL-01~FAIL-02 | 1024px 축약 레이아웃 기능 누락 없음 |

---

## 3. 12가지 독립 완결 정상 인수 시나리오 (12 Independent Complete Scenarios)

### SCENARIO-01: 신규 사건 등록 및 6대 클레임 유형(TYPE-01~06) 지정 시나리오
- **목적**: 신규 클레임 사건을 수임하여 6대 업무 유형 중 하나를 지정하고 등록한다.
- **사전조건**: PM 권한 사용자로 로그인 완료.
- **수행 절차**:
  1. [사건 목록 (CASE-01)]에서 [새 사건 등록] 버튼 클릭.
  2. 사건명, 사건코드, 6대 클레임 유형(`TYPE-01` ~ `TYPE-06` 중 1개 선택), 대분류(건설), 중분류(하자보수), 소분류(지하주차장 균열) 선택 후 저장.
- **인수 검증 기준**: `Case` 엔터티가 생성되고 선택된 클레임 유형과 생성자, 시각이 `AuditLog`에 기록됨.

### SCENARIO-02: 복수 관계자 및 다중 기일(D-day) 알림 등록 시나리오
- **목적**: 사건에 복수 당사자(원고, 피고, 참고인) 및 법원/고객 기일을 다중 지정한다.
- **사전조건**: 등록된 사건이 존재함.
- **수행 절차**:
  1. [사건 상세-관계자 (CASE-05)]에서 원고 2명, 피고 1명 등록.
  2. [사건 상세-일정 (CASE-04)]에서 법원 제출일(D-3), 현장 감정일(D-7) 등록 및 `Notification` 발송 지정.
- **인수 검증 기준**: `CaseParty`, `Party`, `Deadline`, `Notification` 엔터티에 수록됨.

### SCENARIO-03: 사건 증거 자료 업로드 및 파일 버전 관리 시나리오
- **목적**: 사건 증거 문서를 표준 규칙으로 업로드하고 개정판 버전을 관리한다.
- **사전조건**: PM 또는 실무자 권한 사용자.
- **수행 절차**:
  1. [사건 상세-자료실 (CASE-06)]에서 감정 보고서 PDF 업로드 (v01 생성).
  2. 수정된 감정 보고서 PDF를 재업로드하여 v02 지정.
- **인수 검증 기준**: 표준 파일명 규칙(`[사건코드]_[문서유형]_[문서명]_[YYYYMMDD]_v01`) 준수. `Document` 및 `DocumentVersion` 엔터티 보존.

### SCENARIO-04: 사건 정보 치환 제안서 초안 생성 및 DOCX 출력 시나리오
- **목적**: 사건 정보를 자동 치환하여 제안서 초안을 작성하고 DOCX로 출력한다.
- **사전조건**: 제안서 템플릿이 시스템에 존재함.
- **수행 절차**:
  1. [제안서 템플릿 선택 (PROP-01)]에서 해당 클레임 유형의 제안서 템플릿 선택.
  2. 사건 정보를 치환하여 초안 생성 후 미입력 누락 필드 확인.
- **인수 검증 기준**: `Proposal`, `ProposalVersion`, `GenerationSource` 엔터티 생성. 미입력 필드는 주황색 배지로 경고 표시.

### SCENARIO-05: 회의록 자동 요약 및 담당자 업무 큐 연동 시나리오
- **목적**: 회의 텍스트에서 요약, 결정사항, 할 일(Action Item)을 추출하여 업무 큐에 연동한다.
- **사전조건**: 회의 텍스트 원본 준비.
- **수행 절차**:
  1. [회의록 (MEET-01)]에서 회의 텍스트 입력 및 AI 요약 실행.
  2. 추출된 할 일을 실무자 담당 업무로 배정.
- **인수 검증 기준**: `Meeting` 및 `MeetingActionItem` 엔터티 저장. 원본 텍스트 보존.

### SCENARIO-06: 보고서 템플릿 인스턴스화 및 3단 보고서 스튜디오 로딩 시나리오
- **목적**: 사건 유형(TYPE-01~06)별 primary 템플릿을 적용하여 8개 표준 장 목차를 생성한다.
- **사전조건**: 템플릿 관리자(Admin)가 만든 보고서 템플릿 존재.
- **수행 절차**:
  1. [보고서 목록 (REPO-01)]에서 [새 보고서 생성] 선택.
  2. [보고서 스튜디오 (REPO-02)]로 진입하여 3단 구조 확인.
- **인수 검증 기준**: `Report` 및 `ReportSection` 인스턴스화 완료. 초기의 모든 장 상태는 `미작성`으로 시작.

### SCENARIO-07: 근거자료 명시 선택 기반 장별 AI 초안 생성 시나리오
- **목적**: 사용자가 명시적으로 선택한 증거 자료만을 사용하여 특정 장의 AI 초안을 생성한다.
- **사전조건**: 자료실에 증거 문서 2건 이상 존재.
- **수행 절차**:
  1. 우측 자료실 패널에서 증거 문서 2건 체크박스 선택.
  2. 3장(사실관계)의 [AI 초안 생성] 버튼 클릭.
- **인수 검증 기준**: 선택되지 않은 자료 제외. `GenerationRun`, `GenerationSource`, `SourceReference`에 Provenance 기록. 장 상태가 `AI 초안`으로 전환.

### SCENARIO-08: AI 플래그 탐지 및 검토자의 수정 요청 시나리오
- **목적**: AI가 생성한 초안에서 검증 플래그를 탐지하고 수정 요청을 등록한다.
- **사전조건**: SCENARIO-07 완료된 장 존재 (`AI 초안` 상태).
- **수행 절차**:
  1. 검토자가 `[확인 필요]` 및 `[숫자 검증 필요]` 플래그 확인.
  2. 문단에 inline 댓글 작성 후 [수정 요청] 상태로 전환.
- **인수 검증 기준**: 검토자는 본문 직접 수정 대신 댓글 및 수정 요청만 수행. 장 상태가 `담당자 검토`에서 `수정 요청`으로 변경.

### SCENARIO-09: 작성자의 보완 수정 및 검토자의 장별 1차 승인/승인취소 시나리오
- **목적**: 작성자가 수정 완료 후 검토자가 해당 장을 승인하고 편집을 잠근다.
- **사전조건**: `수정 요청` 상태인 장 존재.
- **수행 절차**:
  1. 작성자가 수정 완료 후 `담당자 검토` 상태로 전달.
  2. 검토자가 검토 후 [1차 승인] 버튼 클릭.
- **인수 검증 기준**: 장 상태가 `승인`으로 변경되고 작성자의 편집권 잠금. `ApprovalRequest` 및 `ApprovalDecision` 수록.

### SCENARIO-10: 승인된 장만 DOCX/PDF 최종 병합 및 해시 기록 시나리오
- **목적**: 승인 완료된 장만 최종 보고서로 병합하여 DOCX/PDF로 출력한다.
- **사전조건**: 승인 완료된 장 존재.
- **수행 절차**:
  1. [보고서 스튜디오 (REPO-02)] 상단의 [최종 문서 병합] 클릭.
  2. DOCX 및 PDF 문서 병합 다운로드.
- **인수 검증 기준**: 미승인 장 제외. 출력 문서 SHA-256 해시가 `Report` 및 `AuditLog`에 기록됨.

### SCENARIO-11: 성공보수 요율 정산 및 미수금 종결 차단 경고 시나리오
- **목적**: 사건 승소 금액 대비 성공보수를 계산하고 미수금 존재 시 사건 종결을 차단한다.
- **사전조건**: 계약 정보 및 판결 금액 입력 완료.
- **수행 절차**:
  1. [성공보수 (FEE-01)]에서 정산 요율 10% 적용하여 성공보수산출.
  2. 미수금 남아있는 상태에서 사건 종결 시도.
- **인수 검증 기준**: `Contract` 및 `SuccessFee` 계산 기록. 미수금 존재 시 종결 불가 경고 토스트 노출.

### SCENARIO-12: 감사로그(AuditLog) 추적 및 시스템 환경 설정 시나리오
- **목적**: 주요 작업의 Append-only 감사로그를 조회하고 AI 공급자 설정을 구성한다.
- **사전조건**: Admin 권한 사용자.
- **수행 절차**:
  1. [AI 설정 (AI-01)]에서 Gemini/OpenAI 연동 설정.
  2. [감사로그 (AUD-01)]에서 변경 이력 조회.
- **인수 검증 기준**: `AuditLog`, `AIProvider`, `AIPolicy` 엔터티 저장. 민감정보 및 API 키는 마스킹 처리됨.

---

## 4. 2가지 독립 실패/거부 시나리오 (2 Independent Failure Scenarios)

### FAIL-01: Reviewer 권한자의 본문 직접 수정 시도 시 403 Forbidden 거부 시나리오
- **목적**: 검토자(Reviewer) 역할의 사용자가 보고서 본문을 직접 수정하려고 시도할 때 시스템이 이를 차단하는지 검증한다.
- **사전조건**: Reviewer 권한 계정으로 로그인 후 [보고서 스튜디오 (REPO-02)] 진입.
- **수행 절차**:
  1. Reviewer 계정으로 2장(하자원인) 에디터 영역에 키보드 입력 시도.
  2. 에디터 폼의 direct edit 시도.
- **인수 검증 기준**: 시스템은 HTTP 403 Forbidden 권한 에러 모달(`forbiddenState`)을 즉시 발생시키고 본문 변경을 차단함. `AuditLog`에 권한 위반 시도 기록.

### FAIL-02: 근거자료 미선택 상태에서의 AI 초안 생성 거부 시나리오
- **목적**: 사용자가 자료실에서 아무런 증거 문서도 선택하지 않은 채 AI 초안 생성을 요청할 때 시스템이 이를 거부하는지 검증한다.
- **사전조건**: [보고서 스튜디오 (REPO-02)] 우측 패널에서 증거 문서를 0건 선택.
- **수행 절차**:
  1. 근거 자료 체크박스를 모두 해제(0건 선택).
  2. [AI 초안 생성] 버튼 클릭.
- **인수 검증 기준**: AI 생성 파이프라인이 동작하지 않고, `[근거자료 없음]` 오류 토스트(`errorState`) 및 경고 안내가 표시됨. API 요청이 전송되지 않음.
