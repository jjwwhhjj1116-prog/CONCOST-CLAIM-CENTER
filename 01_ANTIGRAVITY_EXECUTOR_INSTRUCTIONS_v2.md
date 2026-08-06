# Antigravity 실행자 지시서

> 개정: 2026-08-06 · 클레임 유형 6종 및 보고서 템플릿 레퍼런스 반영
## 클레임센터 보고서 스튜디오 개발 실행 명령서

### 0. 임무와 절대 경로

당신은 이 프로젝트의 **유일한 구현 실행자**다.

- 프로젝트명: 클레임 케이스 허브 및 AI 보고서 스튜디오
- 작업 루트: `E:\■ 개발_TF팀\클레임센터 보고서 스튜디오\`
- UX/UI 설계 도구: Google Stitch
- 구현 실행자: Google Antigravity
- 독립 검수자: Codex
- 목표: 클레임 사건을 관리하고, 사건 자료를 근거로 제안서·회의록·법원 제출용 보고서를 장별로 작성·검토·승인·출력하는 업무 플랫폼을 구축한다.
- 대상 사용자: 대표, 본부장, 센터장, PM, 실무자, 검토자, 시스템 관리자
- UX 기준: 중학생도 10초 안에 현재 상황과 다음 행동을 이해할 수 있어야 한다.

PowerShell 기준으로 작업한다.

```powershell
Set-Location 'E:\■ 개발_TF팀\클레임센터 보고서 스튜디오'
```

루트가 없으면 생성한다. 기존 파일이 있으면 삭제·덮어쓰기 전에 반드시 목록과 구조를 기록한다.

---

## 1. 역할 경계

### 당신이 해야 하는 일

1. 저장소 조사, 설계, 구현, 테스트, 문서화
2. Google Stitch용 UI 설계 프롬프트와 화면 요구사항 작성
3. Stitch 결과를 개발 가능한 컴포넌트 구조로 변환
4. 프론트엔드, 백엔드, 데이터베이스, AI Gateway, 문서 엔진 구현
5. 자동 테스트와 수동 테스트 시나리오 작성
6. 각 단계의 실행 증거를 `/artifacts/harness/`에 보관
7. Codex 검수 결과에 따라 수정
8. 통과된 단계만 다음 단계로 진행

### 당신이 하면 안 되는 일

1. Codex 대신 스스로 최종 통과 판정
2. 검수 실패를 무시하고 다음 단계 진행
3. API 키를 코드, Git, 브라우저 번들, 로그에 기록
4. 법률 근거, 사건번호, 날짜, 금액, 계약조건, 산출 결과를 AI가 임의 생성하도록 구현
5. 근거가 없는 AI 결과를 “확정” 상태로 전환
6. 여러 단계를 한꺼번에 구현하고 나중에 테스트
7. 실제 고객 데이터나 운영 API 키를 샘플 데이터에 사용
8. `main` 브랜치에 직접 작업

---

# 2. 하네스 엔지니어링 운영 규칙

## 2.1 단계 상태 머신

모든 개발 단계는 다음 상태를 따른다.

```text
PLANNED
→ IMPLEMENTING
→ SELF_CHECK
→ READY_FOR_REVIEW
→ CODEX_REVIEW
→ PASS
또는
→ FAIL
→ FIXING
→ READY_FOR_REVIEW
```

단계 상태는 다음 파일에 기록한다.

```text
/docs/harness/phase-status.json
```

예시:

```json
{
  "project": "claim-center-report-studio",
  "currentPhase": "P02",
  "phases": {
    "P00": {
      "name": "workspace-bootstrap",
      "status": "PASS",
      "implementationCommit": "abc1234",
      "reviewReport": "docs/reviews/P00-codex-review.md"
    },
    "P01": {
      "name": "product-contract",
      "status": "READY_FOR_REVIEW"
    }
  }
}
```

Codex가 `PASS`를 명시하지 않은 단계는 완료가 아니다.

## 2.2 단계별 증거 패키지

각 단계가 끝나면 다음 폴더를 생성한다.

```text
/artifacts/harness/PXX/
  manifest.json
  commands.log
  test-results/
  screenshots/
  api-samples/
  accessibility/
  security/
  notes.md
```

`manifest.json` 필수 항목:

```json
{
  "phase": "PXX",
  "scope": [],
  "changedFiles": [],
  "commandsExecuted": [],
  "tests": {
    "passed": 0,
    "failed": 0,
    "skipped": 0
  },
  "knownLimitations": [],
  "acceptanceCriteria": [],
  "selfAssessment": "READY_FOR_REVIEW"
}
```

## 2.3 결정 기록

중요한 기술·제품 결정은 ADR로 남긴다.

```text
/docs/adr/ADR-0001-*.md
```

ADR 필수 구조:

```text
상황
결정
대안
선택 이유
보안 영향
데이터 영향
향후 변경 비용
```

## 2.4 작업 단위

한 작업 단위는 다음 조건을 만족해야 한다.

- 하나의 사용자 가치 또는 하나의 기술 기반만 포함
- 변경 파일 수가 지나치게 커지지 않도록 분리
- 단독으로 테스트 가능
- 실패 시 되돌릴 수 있음
- 완료 조건이 명시됨
- 검수자가 재현할 수 있는 명령이 있음

## 2.5 공통 품질 게이트

모든 단계에서 다음 명령이 통과해야 한다.

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

E2E 단계부터 추가:

```powershell
pnpm test:e2e
```

보안 단계부터 추가:

```powershell
pnpm test:security
pnpm audit --audit-level high
```

명령 이름이 다르면 동일 목적의 스크립트를 `package.json`에 등록한다.

---

# 3. 제품 불변조건

다음 조건은 구현 전 과정에서 변경할 수 없다.

## 3.1 사건관리 불변조건

1. 사건에는 복수 관계자를 등록할 수 있다.
2. 사건에는 복수 D-day와 법원·고객·내부 일정을 등록할 수 있다.
3. 사건 상태는 아래 흐름을 기본으로 한다.

```text
문의
→ 제안
→ 견적
→ 계약
→ 자료접수
→ 분석
→ 보고서 작성
→ 제출
→ 소송 진행
→ 판결
→ 성공보수 정산
→ 종결
```

4. 보고서 제출만으로 사건이 종결되지 않는다.
5. 모든 변경은 사용자, 시각, 변경 전후 값과 함께 감사로그에 남는다.
6. 문서는 원본·버전·최종본을 구분한다.
7. 삭제는 기본적으로 소프트 삭제이며 복구 가능해야 한다.

## 3.2 문서작성 불변조건

1. 제안서는 사건정보와 템플릿을 조합해 생성한다.
2. 보고서는 한 번에 전체 생성하지 않고 장·절 단위로 작성한다.
3. 승인된 장만 최종 문서에 병합한다.
4. AI가 생성한 내용에는 사용한 사건자료와 근거 위치가 연결되어야 한다.
5. 근거 부족, 숫자 미확인, 법률 검토 필요 상태를 표시한다.
6. 확정 전 반드시 사람이 수정·검토·승인한다.
7. AI 결과는 버전, 모델, 지시문, 입력자료 범위, 생성자, 생성시각을 기록한다.

## 3.3 AI 안전 불변조건

AI는 다음 값을 임의 생성할 수 없다.

- 사건번호
- 당사자명
- 계약금액
- 청구금액
- 날짜와 기일
- 법령·판례 인용
- 계약조항
- 산출 결과
- 성공보수
- 승소 가능성
- 최종 법적 결론

선택된 근거자료에서 확인되지 않으면 다음 중 하나로 처리한다.

```text
[확인 필요]
[근거자료 없음]
[법률전문가 검토 필요]
[숫자 검증 필요]
```

---

# 4. 권장 기술 구조

기존 저장소가 있으면 먼저 분석하고 충돌 없는 범위에서 적용한다. 저장소가 비어 있으면 다음 기본 구조로 시작한다.

```text
claim-center-report-studio/
  apps/
    web/
    api/
  packages/
    ui/
    domain/
    database/
    ai-gateway/
    document-engine/
    google-workspace/
    test-fixtures/
  docs/
    product/
    architecture/
    adr/
    harness/
    reviews/
    stitch/
  artifacts/
    harness/
  scripts/
```

권장 기술:

- Monorepo: pnpm workspace + Turborepo
- Web: Next.js App Router + TypeScript
- UI: Tailwind CSS + 접근성 가능한 컴포넌트 라이브러리
- 상태: 서버 상태는 TanStack Query, 화면 상태는 필요한 범위에서 Zustand
- API: Next.js Route Handler 또는 별도 Node API. 경계가 명확해야 함
- DB: PostgreSQL + Prisma
- 인증: Auth.js 또는 기존 인증 체계
- 편집기: Tiptap 계열의 구조화 편집기
- 테스트: Vitest, Testing Library, Playwright
- 문서 출력: DOCX 생성 엔진 + PDF 변환 어댑터
- 파일 저장: 개발환경 로컬/MinIO 어댑터, 운영 Google Drive 어댑터
- 비밀정보: 서버 전용 환경변수 또는 암호화된 Secret Store
- 로그: 구조화 로그, 민감정보 마스킹
- API 계약: OpenAPI 또는 타입 공유 계약

기술 선택 변경 시 ADR을 작성한다.

---


# 4A. 클레임 업무 프로세스 6대 유형과 레퍼런스 템플릿

## 4A.1 단일 기준 소스

클레임 유형은 임의로 새로 만들지 않는다. 아래 Excel 원본의 **6가지 유형만 1차 표준 유형**으로 사용한다.

권장 원본 위치:

```text
E:\■ 개발_TF팀\클레임센터 보고서 스튜디오\
  docs\
    업무 프로세스\
      클레임 업무 프로세스.xlsx
```

원본 탐색 순서:

```text
1. 프로젝트 루트의 `클레임 업무 프로세스.xlsx`
2. `docs\업무 프로세스\클레임 업무 프로세스.xlsx`
3. 발견하지 못하면 BLOCKED_SOURCE_MISSING으로 중지
```

파일을 찾았을 때 원본을 이동하거나 덮어쓰지 말고 SHA-256 해시와 수정시각을 기록한다.

## 4A.2 고정된 6가지 유형

표시명은 Excel 원문의 용어를 유지한다.

```yaml
claim_types:
  - id: TYPE-01
    order: 1
    name: 현장조사 및 수량산출이 필요한 클레임(하자, 기시공, 미시공 등)
    core_flow:
      - 제안서
      - 계약
      - 착수회의
      - 현장조사(하자, 기시공, 미시공)
      - 수량산출 및 내역서 작성
      - 보고서 작성

  - id: TYPE-02
    order: 2
    name: 분석 보고서 작성 클레임(감정보완 신청서, 항소에 대한 반박, 공사비 적정성 검토 등)
    core_flow:
      - 제안서
      - 계약
      - 필요시 착수회의
      - 자료접수(소장, 감정서, 공사비증액 등)
      - 자료분석
      - 감정보완 신청서 작성

  - id: TYPE-03
    order: 3
    name: 일반적인 클레임
    core_flow:
      - 제안서
      - 계약
      - 착수회의
      - 자료 접수 및 분석
      - 필요시 현장조사
      - 업무 성격에 맞는 보고서

  - id: TYPE-04
    order: 4
    name: 재건축·재개발 공사비 협상
    core_flow:
      - 업무협의
      - 제안서
      - 계약
      - 착수회의
      - 자료접수(시공사 증액사유서 등)
      - 공사비 적정성 보고서
      - 시공사와의 협상지원(협상회의 참석)
      - 시공사 반박 자료 검토
      - 반박 보고서 작성
    repeatable_steps:
      - 시공사와의 협상지원(협상회의 참석)
      - 시공사 반박 자료 검토
      - 반박 보고서 작성

  - id: TYPE-05
    order: 5
    name: 사감정보고서
    core_flow:
      - 제안서
      - 계약
      - 필요시 착수회의
      - 자료접수
      - 필요시 현장조사
      - 사감정 보고서 작성
      - 업무협의(사감정보고서 활용방안)
      - 법원감정인 선정 지원
      - 법원감정인 현장조사시 동행
      - 감정서 접수
      - 감정보완신청서 작성

  - id: TYPE-06
    order: 6
    name: 물가변동
    core_flow:
      - 업무의뢰
      - 추정보고서 작성
      - 계약
      - 자료접수
      - 보고서 작성
```

금지:

- 스크린샷의 9개 폴더를 9개 업무 유형으로 생성
- 보고서 제목을 곧바로 업무 유형으로 간주
- 원본 Excel에 없는 7번째 유형을 자동 생성
- 애매한 자료를 강제로 한 유형에 확정 배치

## 4A.3 보고서 템플릿 원본 폴더

사용자가 준비한 레퍼런스 원본:

```text
E:\■ 개발_TF팀\클레임센터 보고서 스튜디오\
  docs\
    보고서 템플릿\
```

이 폴더는 **레퍼런스 원본 보관소**다.

절대 규칙:

1. 원본 파일과 폴더를 이동·삭제·이름변경·덮어쓰기하지 않는다.
2. 템플릿을 유형별로 물리 복제하지 않는다.
3. 원본의 상대경로와 해시를 보존한다.
4. 실제 고객명, 사건번호, 금액, 개인정보가 포함될 수 있으므로 Git 커밋 전에 민감정보 여부를 검사한다.
5. 원본 문서는 기본적으로 Git 추적 대상에서 제외하고, 정제된 메타데이터·스키마·블록 정의만 커밋한다.
6. 원본을 외부 AI에 자동 전송하지 않는다.
7. 분석 전에 파일 목록과 확장자, 크기, 수정일, 해시를 인벤토리로 만든다.

권장 산출물:

```text
/docs/domain/claim-types.yaml
/docs/templates/reference-inventory.json
/docs/templates/template-classification.yaml
/docs/templates/template-review-queue.yaml
/docs/templates/template-block-catalog.json
/docs/templates/template-variable-dictionary.json
/docs/templates/template-sensitivity-report.md
```

## 4A.4 초기 논리 배치안

스크린샷에서 확인된 폴더명에 대한 **초기 후보 배치**다. 이는 폴더명 기준의 임시안이며 실제 파일 본문·목차·산출물 구조를 분석한 뒤 확정한다.

```yaml
initial_template_mapping:
  TYPE-01:
    primary:
      - "04. 하자검토 보고서"
      - "07. 하자조사 보고서"
      - "08. 물량공사비"
      - "09. 기시공+미시공"

  TYPE-02:
    primary:
      - "01. 감정보완 신청서"
      - "02. 항소에 대한 의견 보고서"
    secondary_candidates:
      - "06. 공사비 적정성 검토 보고서"

  TYPE-03:
    primary:
      - "03. 설계변경+물가변동+간접비"
    secondary_candidates:
      - "05. 설계변경+물가변동"

  TYPE-04:
    primary:
      - "06. 공사비 적정성 검토 보고서"

  TYPE-05:
    primary: []
    status: TEMPLATE_NOT_FOUND_IN_SCREENSHOT

  TYPE-06:
    primary:
      - "05. 설계변경+물가변동"
    secondary_candidates:
      - "03. 설계변경+물가변동+간접비"
```

분류 원칙:

- `primaryType`: 템플릿의 주 사용 유형 1개
- `secondaryTypes`: 실제로 재사용 가능한 보조 유형 0개 이상
- 하나의 원본을 여러 곳에 복사하지 않고 **논리 참조**로 연결
- TYPE-05에 맞는 원본이 없으면 빈 상태로 유지하고 `템플릿 미확보`로 표시
- 애매한 자료는 `REVIEW_REQUIRED`
- 실제 문서 내용이 초기 배치안과 다르면 실제 내용이 우선
- 변경 사유와 승인자를 기록

## 4A.5 템플릿 분석 하네스

각 원본 파일에 대해 다음을 추출한다.

```text
파일 ID
원본 상대경로
SHA-256
확장자
문서 제목
표지 유형
목차
장·절 구조
고정 문구
가변 필드
필수 표
사진·도면 위치
산출표 위치
법률·계약 근거 위치
결론 구조
회사 머리말·바닥글
민감정보 포함 가능성
primaryType
secondaryTypes
분류 신뢰도
분류 근거
검토 상태
```

분류 상태:

```text
UNSCANNED
→ EXTRACTED
→ AUTO_CLASSIFIED
→ REVIEW_REQUIRED
→ HUMAN_APPROVED
→ ACTIVE
```

AI 자동 분류 결과만으로 `ACTIVE`가 될 수 없다.

## 4A.6 시스템 반영 방식

### 사건 생성

사용자는 먼저 6개 유형 중 하나를 선택한다. 선택 후 해당 유형의 업무 프로세스와 추천 템플릿을 보여준다.

### 제안서·보고서 작성

```text
사건 유형 선택
→ 해당 유형의 프로세스 표시
→ 해당 유형의 primary 템플릿 우선 표시
→ secondary 템플릿은 “다른 유형에서도 사용”으로 표시
→ 템플릿 미리보기
→ 사건용 복사본 생성
```

### 관리자 화면

`템플릿 관리` 화면에 다음을 제공한다.

- 6개 유형별 템플릿 수
- 미분류
- 검토 필요
- 민감정보 확인 필요
- 활성/비활성
- 템플릿 버전
- 분류 근거
- 원본 경로
- 마지막 분석일
- 재분류 이력

### 대시보드

9개 폴더명이 아니라 **6개 업무 유형** 기준으로 사건 건수와 작성 중 보고서를 집계한다.

## 4A.7 Git과 민감자료 정책

`.gitignore` 후보:

```gitignore
/docs/보고서 템플릿/**
!/docs/보고서 템플릿/README.md
!/docs/보고서 템플릿/.gitkeep
/local-reference/**
```

단, 기존 저장소 정책을 먼저 확인한다. 이미 원본 문서가 Git에 추적 중이면 임의 삭제하지 말고 보안 위험을 보고한다.

원본 문서 내용은 테스트 픽스처로 그대로 사용하지 않는다. 테스트에는 익명화·합성 데이터를 사용한다.


# 5. 화면 정보 구조

## 5.1 왼쪽 전역 메뉴

```text
홈
사건
일정
자료실
회의록
제안서 작성
보고서 작성
검토·승인
비용·성공보수
템플릿 관리
AI 설정
사용자·권한
변경 기록
```

## 5.2 메인 대시보드

첫 화면은 다음 질문에 즉시 답해야 한다.

1. 진행 중인 사건은 몇 개인가?
2. 오늘 또는 곧 마감되는 일은 무엇인가?
3. 내가 해야 할 일은 무엇인가?
4. 어떤 문서가 작성·검토·승인 중인가?
5. 지연된 업무는 무엇인가?
6. 미수 성공보수는 얼마인가?
7. 최근 어떤 변경이 있었는가?

필수 컴포넌트:

- 통합 검색
- 새 사건 등록
- 제안서 작성
- 보고서 작성
- 자료 업로드
- 진행 중 사건 수
- 이번 주 마감 수
- 지연 업무 수
- 검토 대기 문서 수
- 승인 완료 문서 수
- 미수 성공보수
- 오늘/3일/7일/기한 초과 업무
- 사건 단계 분포
- 제안서·보고서 상태 분포
- 최근 활동
- 담당자별 업무 큐

색상만으로 상태를 표현하지 말고 텍스트와 아이콘을 함께 사용한다.

## 5.3 사건 상세 탭

```text
개요
업무 과정
일정·기일
관계자
자료실
이메일
회의록
제안서
견적·계약
보고서
소송 진행
비용·성공보수
변경 이력
```

## 5.4 보고서 스튜디오

3단 구조:

```text
왼쪽: 목차·장 상태·담당자·승인 상태
중앙: 구조화 본문 편집기
오른쪽: 사건정보·근거자료·AI 비서·검증 상태
```

장 상태:

```text
미작성
→ 작성 중
→ AI 초안
→ 담당자 검토
→ 수정 요청
→ 승인
→ 최종 확정
```

---

# 6. Google Stitch 지시 패키지

P02에서 `/docs/stitch/stitch-master-prompt.md`를 작성한다.

Stitch에 다음을 요구한다.

1. 데스크톱 1440px 우선, 태블릿 1024px 대응
2. 중학생도 이해할 수 있는 쉬운 메뉴명
3. 정보밀도는 높되 한 카드에는 하나의 질문만 표시
4. 상태는 색상+아이콘+텍스트 병행
5. 주요 행동은 화면 상단에 고정
6. 사건·일정·문서·승인 흐름을 시각적으로 연결
7. 보고서 스튜디오는 3단 구조
8. 표, 긴 문서명, 복수 관계자, 많은 일정이 깨지지 않아야 함
9. 키보드 탐색, 명확한 포커스, 충분한 대비
10. 빈 상태, 오류 상태, 로딩 상태, 권한 없음 상태 포함

필수 Stitch 화면:

```text
01 로그인
02 메인 대시보드
03 사건 목록
04 새 사건 등록
05 사건 상세-개요
06 사건 상세-일정
07 사건 상세-관계자
08 사건 상세-자료실
09 회의록
10 제안서 템플릿 선택
11 제안서 단계형 작성기
12 보고서 목록
13 보고서 스튜디오
14 검토·승인함
15 성공보수
16 템플릿 관리
17 AI 공급자 설정
18 사용자·권한
19 감사로그
20 모바일이 아닌 태블릿 축약 화면
```

Stitch 결과를 그대로 복사하지 말고 다음 문서로 정규화한다.

```text
/docs/stitch/component-map.md
/docs/stitch/design-tokens.json
/docs/stitch/page-specs/*.md
/docs/stitch/accessibility-notes.md
```

---

# 7. 데이터 모델 최소 범위

다음 엔터티를 초기 설계에 포함한다.

```text
User
Role
Permission
Case
CaseCategory
CaseParty
Party
Deadline
Activity
Document
DocumentVersion
Meeting
MeetingActionItem
Proposal
ProposalVersion
Report
ReportSection
ReportSectionVersion
Template
TemplateSection
TemplateBlock
ApprovalRequest
ApprovalDecision
Contract
SuccessFee
AIProvider
AIModel
AIPolicy
GenerationRun
GenerationSource
SourceReference
AuditLog
Notification
```

핵심 관계:

- Case 1:N Deadline
- Case 1:N CaseParty
- Case 1:N Document
- Case 1:N Activity
- Case 1:N Proposal
- Case 1:N Report
- Report 1:N ReportSection
- ReportSection 1:N ReportSectionVersion
- GenerationRun N:M Document 또는 문서 청크
- ApprovalRequest는 ProposalVersion 또는 ReportSectionVersion을 대상으로 함
- 모든 중요 엔터티는 createdBy, updatedBy, timestamps를 가짐
- 감사로그는 append-only

---

# 8. AI Gateway 계약

## 8.1 지원 공급자

1. Local OpenAI-compatible
   - Ollama
   - LM Studio
   - vLLM
   - 기타 OpenAI 호환 서버
2. Anthropic
3. OpenAI
4. Google Gemini
5. DeepSeek

## 8.2 어댑터 인터페이스

```ts
interface AIProviderAdapter {
  testConnection(config: ProviderConfig): Promise<ConnectionResult>;
  listModels(config: ProviderConfig): Promise<ModelInfo[]>;
  generate(request: GenerationRequest): Promise<GenerationResult>;
  stream?(request: GenerationRequest): AsyncIterable<GenerationChunk>;
}
```

`GenerationRequest` 필수 필드:

```text
caseId
documentType
sectionId
taskType
providerId
modelId
systemPolicyVersion
templateVersion
selectedSourceIds
userInstruction
outputSchema
maxCost
```

`GenerationResult` 필수 필드:

```text
content
structuredOutput
sourceReferences
warnings
verificationFlags
provider
model
usage
estimatedCost
requestHash
createdAt
```

## 8.3 서버 보안

- API 키는 서버에서만 복호화
- 클라이언트 응답에는 마스킹된 식별자만 전달
- 로그에 키, 원문 민감정보, 인증토큰 기록 금지
- 공급자별 송신 허용 데이터 범위 설정
- 사건 보안등급에 따라 외부 API 사용 차단 가능
- 로컬 AI만 허용하는 사건 정책 지원
- 사용자별 월 비용 제한
- 모델별 사용 권한
- 공급자 연결 테스트
- 생성 건별 비용·토큰 기록

## 8.4 생성 품질 정책

생성 전:

1. 사용자가 사건과 작성할 장을 선택
2. 근거자료를 명시적으로 선택
3. 작성 목적 또는 핵심 주장을 입력
4. 외부 전송 범위 확인
5. 비용 예측 표시

생성 후:

1. 문단별 근거자료 표시
2. 근거 없는 숫자 탐지
3. 미확인 날짜 탐지
4. 법령·판례 인용 검증 대기 표시
5. 금지 표현 검사
6. 작성자 검토 없이는 승인 불가

---

# 9. 단계별 구현 계획

## P00. 작업공간 부트스트랩

### 작업

- 작업 루트 존재 여부 확인
- 기존 파일 구조와 Git 상태 기록
- Git 저장소 초기화 또는 기존 저장소 분석
- 브랜치 생성: `feat/harness-bootstrap`
- `.gitignore`, `.editorconfig`, Node 버전, pnpm 버전 고정
- 하네스 디렉터리 생성
- 단계 상태 파일 생성
- 기본 README 생성

### 산출물

```text
README.md
/docs/harness/phase-status.json
/docs/harness/working-agreement.md
/artifacts/harness/P00/manifest.json
```

### 통과 조건

- 경로에서 프로젝트가 재현 가능
- 비밀정보가 저장소에 없음
- 기본 스크립트 실행 가능
- Codex가 저장소 구조와 하네스를 확인 가능

---

## P01. 제품 계약 및 범위 고정

### 작업

다음 문서를 작성한다.

```text
/docs/product/product-brief.md
/docs/product/personas.md
/docs/product/navigation.md
/docs/product/status-flows.md
/docs/product/permissions-matrix.md
/docs/product/acceptance-scenarios.md
/docs/product/non-goals.md
```

권한 예시:

```text
대표: 전체 조회·최종 승인
본부장/센터장: 담당 조직 조회·검토·승인
PM: 담당 사건 관리·문서 작성
실무자: 배정 업무와 자료 작성
검토자: 지정 문서 검토·수정 요청
관리자: 사용자·권한·AI 공급자·템플릿 설정
```

### 대표 인수 시나리오

1. 완료된 사건 1건을 신규 사건으로 등록
2. 대·중·소분류 선택
3. 복수 관계자 등록
4. 복수 기일 등록
5. 자료 업로드와 버전 관리
6. 사건정보로 제안서 초안 생성
7. 회의 녹음 또는 텍스트로 회의록 초안 생성
8. 보고서 템플릿과 목차 불러오기
9. 근거자료를 선택해 장별 AI 초안 생성
10. 수정·검토·승인
11. 승인 장만 DOCX/PDF로 병합
12. 성공보수 청구와 입금 상태 확인

### 통과 조건

- 모든 화면과 데이터 엔터티가 하나 이상의 사용자 시나리오와 연결
- 비목표가 명확
- 용어가 일관됨
- 중학생 수준의 쉬운 메뉴명 사용
- 클레임 업무 유형이 Excel 원문의 6개로 고정됨
- `docs/보고서 템플릿` 원본 인벤토리와 SHA-256이 생성됨
- 9개 템플릿 폴더가 9개 업무 유형으로 잘못 생성되지 않음
- 초기 템플릿 분류안과 검토 필요 목록이 생성됨
- 원본 문서의 Git 추적·민감정보 위험이 보고됨

---

## P02. Stitch UX/UI 설계와 디자인 시스템

### 작업

- Stitch 마스터 프롬프트 작성
- 20개 필수 화면 생성
- 컴포넌트 맵 작성
- 디자인 토큰 작성
- PC·태블릿 레이아웃 정의
- 빈 상태·오류·권한 없음·로딩 상태 설계
- 주요 화면 접근성 자체 점검

### 통과 조건

- 대시보드 10초 이해 테스트 통과
- 주요 행동이 2클릭 이내
- 상태 표현이 색상에만 의존하지 않음
- 1024px에서 기능 누락 없음
- 보고서 스튜디오 3단 구조 유지

---

## P03. 애플리케이션 셸과 디자인 시스템 구현

### 작업

- Monorepo 또는 기존 구조 정리
- 공통 UI 패키지
- 로그인·전역 레이아웃·사이드바·상단바
- 라우팅
- 페이지 권한 가드
- 공통 테이블, 카드, 상태 배지, D-day, 타임라인
- 테스트용 가상 데이터
- Storybook 또는 컴포넌트 카탈로그

### 통과 조건

- 주요 페이지가 라우팅 가능
- 키보드로 전역 메뉴 접근 가능
- 1440px/1024px에서 레이아웃 안정
- 공통 컴포넌트 단위 테스트 통과

---

## P04. 데이터베이스·인증·권한·감사로그

### 작업

- Prisma 스키마
- 마이그레이션
- 개발 시드
- 인증
- 역할 기반 접근제어
- 조직 또는 담당 사건 범위 제한
- 감사로그
- 소프트 삭제
- 낙관적 잠금 또는 버전 충돌 방지

### 통과 조건

- 역할별 허용·거부 테스트
- 직접 URL 접근 차단
- API 수준 권한 검사
- 감사로그 누락 없음
- 데이터베이스 초기화·시드 재현 가능

---

## P05. 사건관리 코어

### 작업

- 사건 생성·수정·조회
- 대·중·소분류 트리
- 복수 관계자
- 담당자
- 사건 상태
- 복수 D-day
- 활동 타임라인
- 통합 검색
- 대시보드 KPI
- 담당자별 업무 큐

### 통과 조건

- 기존 사건 1건을 문의부터 종결까지 입력 가능
- D-day 정렬과 지연 판정 정확
- 사건 상태 이력 보존
- 대시보드 수치가 DB와 일치
- 검색 결과가 권한 범위를 넘지 않음

---

## P06. 자료실·문서 버전·회의록

### 작업

- 자료 업로드
- 수신·작성·제출 구분
- 메타데이터
- 파일명 규칙
- 버전과 최종본
- 사건·일정·보고서 장 연결
- 회의록 직접 작성
- 회의 텍스트 업로드
- 요약·결정사항·할 일 추출 인터페이스
- 원본과 확정 회의록 보존

파일명 기본 규칙:

```text
[사건코드]_[문서유형]_[문서명]_[YYYYMMDD]_v01
```

### 통과 조건

- 동일 문서의 버전 추적 가능
- 최종본 지정 변경 이력 기록
- 잘못된 파일 형식과 용량 제한
- 사용자 권한에 따른 다운로드 제한
- 회의 할 일이 담당자와 일정으로 연결 가능

---

## P07. 제안서 템플릿과 작성기

### 작업

1. 사건 선택
2. 템플릿 선택
3. 사건정보 자동 치환
4. 의뢰 배경·수행 목적·방법·성과물·제외사항 입력
5. AI 공급자·모델 선택
6. 초안 생성
7. 사용자 수정
8. 검토·승인
9. DOCX/PDF 출력
10. 버전 관리

### 통과 조건

- 사건정보가 템플릿 필드에 정확히 반영
- 누락 필드는 명시적으로 표시
- AI 미사용 수동 작성 가능
- 승인 전 최종본 출력 제한 정책 적용
- 생성 이력과 근거자료 기록

---

## P08. 보고서 템플릿·블록 카탈로그

### 작업

- 고정 회사 양식
- 유형별 목차
- 표준 본문 블록
- 필수 자료 규칙
- 장 추가·삭제·순서 변경
- 템플릿 버전
- 템플릿 미리보기
- 사건 생성 시 보고서 인스턴스화
- 6개 클레임 유형별 템플릿 논리 배치
- `primaryType`과 `secondaryTypes` 지원
- 미분류·검토 필요·템플릿 미확보 상태
- 레퍼런스 원본 해시와 템플릿 버전 연결
- 원본 문서가 아닌 사건용 작업 복사본 생성

기본 블록:

```text
검토 개요
계약 현황
사실관계
사진 분석
산출근거
법률 검토
의견
결론
```

### 통과 조건

- 템플릿 변경이 기존 보고서를 훼손하지 않음
- 보고서 인스턴스는 생성 시점 템플릿 버전을 보존
- 필수 장 누락 경고
- 유형별 목차 검색 가능
- 템플릿 선택기가 6개 유형 기준으로 그룹화됨
- TYPE-05에 원본이 없으면 임의 템플릿을 강제 배정하지 않음
- 초기 폴더명 분류가 실제 문서 분석과 다를 경우 검토 이력과 승인자가 기록됨
- 같은 원본을 여러 유형에 물리 복제하지 않고 논리 참조함

---

## P09. 보고서 스튜디오

### 작업

- 3단 화면
- 장별 상태
- 구조화 편집기
- 자동 저장
- 수동 저장
- 버전 비교
- 근거자료 선택
- 자료 위치 참조
- 문단별 검증 상태
- 댓글과 수정 요청
- 승인된 장 잠금
- 최종 병합

### 통과 조건

- 서로 다른 사용자의 동시 수정 충돌 감지
- 승인된 버전과 편집 중 버전 구분
- 승인된 장만 최종 병합
- 근거자료 링크가 깨지지 않음
- 대용량 보고서에서도 목차 이동 가능

---

## P10. AI Gateway와 공급자 설정

### 작업

- Local OpenAI-compatible
- Anthropic
- OpenAI
- Gemini
- DeepSeek
- 연결 테스트
- 모델 목록
- 공급자별 정책
- 비용 제한
- 사건 보안등급 정책
- 생성 로그
- 스트리밍
- 타임아웃·재시도·취소
- 공급자 장애 시 명시적 실패 처리

### 통과 조건

- API 키가 클라이언트 번들에 없음
- 서버 로그에 API 키 없음
- 공급자별 모킹 테스트
- 연결 실패 메시지가 이해 가능
- 비용 제한 초과 시 생성 차단
- 외부 전송 금지 사건은 로컬 모델만 선택 가능

---

## P11. 근거 기반 장별 AI 작성

### 작업

- 선택 자료만 AI에 전달
- 자료 청크와 메타데이터 생성
- 문단별 source reference 저장
- 출력 JSON 스키마 강제
- 숫자·날짜·법률 인용 검증 플래그
- 회사 문체와 금지 표현
- 다른 모델을 이용한 선택적 교차 검토
- 생성 전 미리보기
- 생성 후 차이 비교

### 통과 조건

- 선택하지 않은 자료가 프롬프트에 포함되지 않음
- 근거가 없는 숫자는 확정 문장으로 출력되지 않음
- 모든 AI 문단에 근거 또는 확인 필요 상태 존재
- 생성 실패가 편집 내용을 덮어쓰지 않음
- 재생성 시 이전 버전 보존

---

## P12. 검토·승인·최종 문서 출력

### 작업

- 검토 요청
- 수정 요청
- 승인
- 반려
- 재검토
- 최종 확정
- 승인자·시간 기록
- 승인된 장 병합
- DOCX 출력
- PDF 출력
- 머리말·바닥글·쪽번호·표지
- 출력물 해시와 버전 기록

### 통과 조건

- 권한 없는 사용자는 승인 불가
- 미확인 중요 플래그가 있으면 최종 확정 차단
- 출력 문서의 장 순서와 승인 버전 일치
- 재출력 시 동일 버전은 동일 내용
- 다운로드 이력 감사로그 기록

---

## P13. 비용·성공보수

### 작업

- 계약금액
- 성공보수 적용 여부
- 기준 금액
- 요율
- 예상·확정 성공보수
- 청구일
- 입금일
- 세금계산서
- 미수금
- 종결 가능 여부

### 통과 조건

- 계산식과 반올림 규칙 명시
- 입력값과 계산 결과 이력 보존
- 미수 상태에서 종결 경고
- 권한 없는 사용자의 금액 수정 차단

---

## P14. Google Workspace 연동

### 작업

- 사건 생성 시 Drive 폴더 생성
- Gmail 첨부 저장
- 날짜 후보 추출
- Calendar 기일 등록
- Google Docs 회의록 저장
- Sheets 데이터 반영
- OAuth 토큰 서버 보관
- 재동의·토큰 만료 처리

초기에는 어댑터와 mock으로 시작하고 실제 연동은 별도 환경에서 검증한다.

### 통과 조건

- OAuth 토큰이 브라우저 저장소에 평문 저장되지 않음
- 중복 폴더·중복 일정 방지
- 실패 재시도와 사용자 피드백
- 연동 해제 시 내부 데이터 보존 정책 명시

---

## P15. 통합 테스트·보안·접근성·성능

### 테스트 매트릭스

- 단위 테스트
- API 통합 테스트
- DB 통합 테스트
- 권한 테스트
- E2E
- 접근성
- 업로드 보안
- 비밀정보 노출
- AI 프롬프트 주입
- 잘못된 근거 연결
- 동시 수정
- 대량 사건·일정·문서
- 백업·복구
- 브라우저 호환
- 태블릿

### 필수 기준

```text
TypeScript 오류: 0
Lint 오류: 0
빌드 오류: 0
Critical/High 보안 취약점: 0
권한 우회: 0
클라이언트 API 키 노출: 0
주요 E2E 실패: 0
접근성 Critical 오류: 0
미검증 중요 데이터의 최종 확정: 0
```

---

## P16. 데모 릴리스

### 데모 시나리오

1. 기존 완료 사건을 신규 사건으로 등록
2. 분류와 관계자 등록
3. 담당자·상태 지정
4. 자료 업로드
5. Drive 폴더 생성
6. 여러 기일 등록
7. 활동 타임라인 확인
8. 사건정보로 제안서 생성
9. 회의록 초안 생성
10. 보고서 목차 불러오기
11. 근거자료로 한 장 생성
12. 수정·승인
13. DOCX/PDF 출력
14. 감사로그 확인
15. 성공보수 상태 확인

### 통과 조건

- 전체 시나리오가 끊김 없이 완료
- 가상 데이터만 사용
- 모든 단계에 감사로그 존재
- 실패 상황 3개 이상 시연 가능
- 운영 전 남은 항목을 명확히 기록

---

# 10. 테스트 픽스처

`/packages/test-fixtures/`에 최소 다음 가상 데이터를 둔다.

```text
사건 15건
관계자 40명
기일 80건
자료 120건
회의록 10건
제안서 8건
보고서 6건
장 60개
승인 요청 20건
성공보수 8건
사용자 8명
역할 6종
```

특수 케이스:

- 오늘 마감
- 기한 초과
- 동일 문서 여러 버전
- 관계자 10명 이상
- 긴 사건명
- 금액 미확인
- 법률 근거 미확인
- 외부 AI 사용 금지 사건
- 승인 후 수정 요청
- 동시 편집 충돌

---

# 11. Codex 검수 요청 방법

각 단계 완료 후 다음 파일을 작성한다.

```text
/docs/reviews/requests/PXX-review-request.md
```

형식:

```markdown
# PXX 검수 요청

## 구현 범위
## 제외 범위
## 변경 파일
## 실행 명령
## 테스트 결과
## 증거 경로
## 알려진 제한
## 인수 기준 자체 판정
## 검수자가 집중할 위험
```

그 후 상태를 `READY_FOR_REVIEW`로 바꾸고 Codex에게 검수를 요청한다.

Codex가 `FAIL`을 주면:

1. 실패 항목을 재현
2. 원인 기록
3. 최소 범위 수정
4. 회귀 테스트
5. 새 증거 패키지 작성
6. 동일 단계 재검수

---

# 12. 브랜치와 커밋 규칙

브랜치:

```text
feat/PXX-short-name
fix/PXX-review-findings
```

커밋 예시:

```text
feat(case): add multi-deadline case model
test(auth): cover role-based case access
fix(ai): block unsupported numeric claims
docs(harness): add P09 evidence manifest
```

각 단계는 하나 이상의 의미 있는 커밋으로 구성한다. 검수 요청 시 커밋 해시를 기록한다.

---

# 13. 즉시 시작 명령

첫 실행에서는 P00만 수행한다. P01 이후를 동시에 구현하지 않는다.

```text
1. 작업 경로 확인
2. 기존 저장소 상태 조사
3. P00 하네스 생성
4. 기본 명령 실행
5. P00 증거 패키지 생성
6. P00 검수 요청서 생성
7. 상태를 READY_FOR_REVIEW로 변경
8. 중지
```

최종 응답 형식:

```markdown
# P00 실행 결과

- 상태:
- 브랜치:
- 커밋:
- 생성 파일:
- 실행 명령:
- 테스트:
- 증거 경로:
- 알려진 제한:
- Codex 검수 요청 경로:
```

P00이 Codex `PASS`를 받기 전에는 P01을 시작하지 마라.
