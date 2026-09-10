# CF107 · 업무·보고서 선택 화면 정리

## 요청 범위

- 착수회의·현장조사·물량산출 및 내역: 현재 프로젝트 선택 왼쪽, 기준 일정 오른쪽. 좁은 화면에서는 같은 순서로 세로 배치한다.
- 해당 세 업무 화면의 상단 6단계 메뉴를 제거한다. 사이드바 이동 경로는 유지한다.
- 산출 담당자 선택의 표시명만 `산출 및 내역 PM`으로 바꾼다. 기존 `memberName` 저장 및 전체 프로젝트 담당 PM은 변경하지 않는다.
- 보고서 1단계: 프로젝트 선택/원본 템플릿 선택을 좌우로 묶고 참고자료 준비상태를 아래에 배치한다. 중복 현재 프로젝트 배너와 유형·승인 템플릿·자동저장 요약 카드는 제거한다.
- 보고서 제목을 계약·판례·현장 근거 중심의 작성 안내로 바꾸고 5단계 카드의 크기와 글자를 키운다.

## 보존한 동작

- 프로젝트 선택의 탐색·미저장 보호, 기준 일정 권한·버전 충돌·저장 동작, 담당자 배정 데이터.
- 템플릿 원본 열람과 실제 적용 유형의 분리, 보고서 단계 완료 조건·잠금·자동저장·복구·출력.
- 관리자 전용 프롬프트 설정 진입점과 `/ai-config` 접근 제한.
- 실제 자동저장 상태 표시와 오류 시 다시 불러오기. 템플릿 미등록 사유는 1단계 조건부 경고로 유지한다.
- 보고서 2~5단계의 현재 프로젝트 배너. API·DB·migration 변경 없음.

## 검수

```powershell
node node_modules/tsx/dist/cli.mjs --test scripts/cf107-workflow-report-layout-test.ts scripts/cf20-visual-hierarchy-test.ts scripts/cf67-document-workflow-test.ts scripts/cf73-workflow-minutes-parity-test.ts
node node_modules/tsx/dist/cli.mjs --test --test-name-pattern='CF40 responsible PM|CF70 linked schedule|CF77 shares|CF77 enforces|CF84 keeps package' scripts/cf39-integrated-project-workspace-test.ts scripts/cf77-cf78-collaboration-business-card-test.ts scripts/cf84-claim-report-guideline-package-test.ts
corepack pnpm cf:build
git diff --check
```

- UI·문서 검사 20개, API·권한 회귀 5개 통과. 타입 검사 및 프로덕션 빌드 통과.
- 기존 CF20 단계 메뉴/CF67 필수 프로젝트 라벨 기대값을 이번 요청에 맞게 갱신했다.
- `apps/web/qa/cf107-layout.html`: 실제 컴포넌트와 앱 기본 스타일을 사용하는 합성 브라우저 검수. 모든 요청을 mock에서 처리하고 비GET 요청은 409로 차단하므로 실제 회사 데이터는 저장하지 않는다. 기본 프로덕션 빌드에는 포함되지 않는다.
- 변경 전부터 존재하던 CF71의 옛 백업 버튼 문구 기대값 실패는 범위 밖으로 유지했다.
- Impeccable layout 검사 0건. 1440/1050/390px 브라우저 DOM 실측에서 페이지 가로 넘침 0, HWP 메뉴가 헤더 경계 안에 표시됨을 확인했다. 5단계 카드는 약 96px이며 좁은 컨테이너는 내부 가로 스크롤을 사용한다.
- 선택 영역이 밀리지 않도록 보고서 히어로 높이를 조정했다(1440px 화면 414→272px). 모바일 단계 메뉴는 고정을 해제해 입력 화면을 가리지 않는다.
- 일반 PM의 프롬프트 설정 버튼 0개/관리자 1개, 미등록 템플릿 경고, 세 업무 화면의 6단계 메뉴 0개 및 산출 PM 라벨을 확인했다.
- 화면 캡처 연결 오류 때문에 보정 후 최종 검증은 DOM 실측으로 진행했다. 다크 테마는 스타일 적용만 확인했으며 전체 시각 가독성 검수 완료로 취급하지 않는다. 로컬 근거: `outputs/cf107-visual/layout-measurements.json`, `layout-final-measurements.json`.

## 배포 제한

개발 환경 `wrangler.development.jsonc` / `concost-claim-center-development`에만 배포한다. 실제 Chrome 세션은 로그인 화면이므로 로그인된 업무 데이터로의 사용자 경로 검수와 합성 화면 검수를 구분한다.

## 개발 서버 배포 결과 · 2026-09-04

- 소스 커밋 `c5d605a`, `test-server/fix/CF73-workflow-minutes-parity`에 푸시.
- Worker 버전 `2cb37017-9831-4733-b53c-6075c2351f2b`.
- URL: https://concost-claim-center-development.jjwwhhjj1116.workers.dev
- `/health` 200 `ok`, `/readiness` 200 `ready`, Google Drive 연결 유지.
- `/reports/studio`의 HTML에서 새 `index-DqsWzJJ6.js` 참조를 확인했다. 해당 JS, `index.es-CIKpov5t.js`, `index-Bjn473Uk.css`의 배포 SHA-256이 검증한 로컬 빌드와 일치한다.
- 개발 환경만 반영. DB migration·실제 회사 데이터 수정 없음. 로그인된 실제 업무 경로와 최종 시각 캡처는 앞서 명시한 검수 한계로 남긴다.

## CF145 · 2026-09-10 전체 일정 출력·회의록 입력 배치

- 시작 `feat/CF123-es-v2` / `0a3f175`, 추적 파일 변경 없음 확인 후 시작. 이전 CF144 ES 기능은 변경하지 않았다.
- 전체 일정 출력은 조회된 프로젝트의 유효한 명시 일정 시작월부터 마지막 종료월까지 기본으로 출력한다. 11월까지 일정이 있으면 11월을 포함하고 중간 월도 생략하지 않는다. 월별 A4 가로·프로젝트 8행 분할, 기존 상세 일정 출력/휴일/담당 PM/권한 필터는 유지한다.
- 기본 `scope=all`, 필요한 경우 ‘한 달’ 선택. 월·언어·색상 변경 시 scope를 URL에 보존한다. PDF 저장과 인쇄는 동일한 전체 페이지 DOM을 사용한다. API의 기존 최대 100프로젝트 제한은 확장하지 않았다.
- 착수·현장조사 공통 입력: 일시/시작·종료를 한 그룹, 작성자 3열, 거래처·보고·참조 3열, 양측 참석자 2열, 장소·안건·메모는 1열. 입력 컨테이너가 좁아지면 2열/1열로 전환한다. 기존 화면 정체성과 출력 테이블을 유지하는 Impeccable layout/Ponytail 최소 변경을 적용했다.
- 회의/조사 상태 선택만 제거했다. status 저장·가져오기·확정 처리와 기존 값은 보존. 착수 시작은 meetingAt, 참석자는 participantUnits, 현장 시작은 surveyDate+minutesFields.meetingStartTime, 참석자는 minutesFields.participants 경로 유지. 종료/작성자/거래처/첨부 필드는 동일 minutesFields로 저장한다. 조사일별 기존 기록/버전 로딩도 유지한다.
- 회의록 최종 표 및 XLSX 생성기, 입력 취소/저장·권한·자동정리·확정 조건은 변경하지 않았다. 사용자 기록/DB/키/migration 변경 없음.
- 최종 관련 검사 **32/32 PASS**, 실패/skip 0. CF102/58 일정 범위, CF73/80/103/106 저장·출력, CF115 실제 React 가져오기·저장 요청, CF117 실제 Chromium 회의/조사 배치·PUT 값·status 보존·저장 실패시 입력 유지·일정 재조회 보호, CF145 출력 UI/단월 전환/색상·언어/range 유지 포함.
- 1920px 작성자 3열·참석자 2열 실측, 390px 1열·가로 넘침 없음, 입력 겹침 방지 확인. 인쇄 CSS의 297×210mm와 2페이지 모두 높이 넘침 없음 확인. PDF/인쇄 버튼은 테스트에서 window.print를 대체하여 동일 2페이지 전달을 확인했으며 실제 프린터 및 OS PDF 저장은 실행하지 않았다.
- 웹 TypeScript+Vite build PASS, 새 CF145 출력 UI 테스트 TypeScript PASS, 정적 layout 검사 0건, diff check PASS. 기존 대형 번들 경고 유지. 별도 기존 테스트의 CF107 보고서 문구 기대값 실패는 이번 범위 밖으로 보존했다. 기존 CF102 fixture stageCode 문자열 타입과 CF117 Vite plugin 타입 때문에 보조 전체 테스트 TypeScript 명령은 실패하며, 제품 웹 타입검사 및 실제 테스트 성공과 구분한다.
- 로컬 Vite 테스트들을 동시에 시작했을 때 첫 화면 로딩 timeout 1회가 있었고, 저장소의 기존 `--test-concurrency=1` 방식으로 최종 32개를 순차 실행해 모두 통과했다. 시각 캡처는 `output/playwright/cf145-*`, 개발 이전 화면은 `output/cf145-before-*`이며 Git에 고객 화면은 포함하지 않는다.

검증 명령:
`node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 scripts/cf102-workflow-usability-test.ts scripts/cf117-workflow-schedule-test.ts scripts/cf145-schedule-print-ui-test.ts scripts/cf58-schedule-print-hwp-test.ts scripts/cf73-workflow-minutes-parity-test.ts scripts/cf80-company-minutes-accessible-type-test.ts scripts/cf103-minutes-export-test.ts scripts/cf106-minutes-layout-test.ts scripts/cf115-workflow-ui-test.ts`

다음 시작점: 개발 배포 결과 확인 → 미저장 작업 보존 후 새로고침 → 전체일정표 출력의 월 범위와 착수/현장조사 입력 그룹 확인. 롤백은 `0a3f175` 소스를 development에 재배포하며 DB 복구는 필요 없다.

### CF145 개발 배포 결과

- 제품 `da2461d`, Worker `31ea79c2-ff1d-4022-bbac-76f07c92b870`, 자산 `index-D9jG5h3N.js` / `index-BP3loTSC.css`.
- 개발 URL https://concost-claim-center-development.jjwwhhjj1116.workers.dev . 운영/Node 배포·DB·키 변경 없음.
- 배포 직후 smoke에서 1개 자산 SHA 불일치가 1회 있었으며, 해당 URL의 JS 응답 재확인과 전체 smoke 재실행으로 5개 자산 SHA 일치 PASS를 확인했다. 초기 불일치 원인은 단정하지 않는다. health/readiness/Drive 정상, 익명 문서 접근401 유지.

### CF145 실제 화면 확인 및 단계 이동 보완

- 로그인된 개발 화면 읽기 전용 검수: 실제 저장 일정의 마지막 종료일 2026-11-30과 기본 출력 9~11월 3쪽 일치. 한 달 1쪽에서 전체 3쪽 복귀 확인. 착수/현장조사 시간·작성자·양측 참석자 묶음과 상태 선택 제거 확인. 사용자 입력·저장·실제 인쇄 없이 검수 탭만 닫고 기존 탭 보존. 증거는 `output/cf145-live-readonly-results.json`, `output/cf145-after-*.png`.
- 최종 화면 이동에서 현장조사 기준 일정이 착수회의에 남는 기존 문제를 재현했다. 초기 조회 effect가 최초 mount에만 실행되던 원인으로, 단계 변경 시 조회를 다시 실행하고 선택 프로젝트는 새 단계의 조회 대상 안에 있으면 유지한다. Router key로 전체 상태를 버리지 않는다.
- 이전 단계 조회·저장 응답은 세대 번호로 화면 반영을 차단한다. 서버에 이미 요청한 저장 자체는 취소하지 않는다. 기록 저장 이후 일정 저장에도 최초 요청 세대를 전달한다.
- 실제 Router 합성 회귀: 수정 전 단계 재조회 timeout으로 실패, 수정 후 단계별 9/21→9/17→9/21 전환과 미저장 원문 이동 취소 보존 통과. 지연된 현장조사 저장 응답이 현재 착수 일정에 반영되지 않는 회귀도 추가했다. 실제 업무 데이터 저장 테스트는 하지 않았다.
- 기존 한계: 상단 기준 일정만 수정했을 때 및 일부 새 기록의 날짜만 바꿨을 때 미저장 이동 경고가 누락될 수 있다. 이번에 모든 입력의 이동 보호를 완성했다고 주장하지 않으며, 별도 후속 범위로 남긴다.
- 최종 추가 보완 제품 커밋 `9395b5d`, 개발 Worker `e6a84c01-4ede-41c2-97af-45ac78afc236`, JS `index-DWZc-g3J.js`. 동일 범위 최종 **34/34 PASS**, web TypeScript/Vite build PASS. `cf114-live-smoke.mjs development` 1회 전체 PASS(health/readiness/Drive, 익명401, 자산5종 SHA 일치). 운영/Node/DB/migration/키 변경 없음.
- 최종 배포 실제 Chrome 재검수 PASS: 최신 JS에서 현장조사 9/21 → 착수회의 9/17 → 현장조사 9/21, 각각 저장 v2 정상 표시. 입력·저장 0회, 기존 사용자 탭 보존, 검수 탭만 종료. `output/cf145-live-readonly-results.json`에 최초 잔존 증거와 해소 결과를 함께 기록했다.
