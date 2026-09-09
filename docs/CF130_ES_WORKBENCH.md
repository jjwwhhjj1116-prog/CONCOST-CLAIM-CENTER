# CF130 ES 업무형 작업 화면 리뉴얼

## 승인된 방향

2026-09-09 사용자가 거래명세표 원가관리 프로그램을 참고한 ES 리뉴얼을 승인했다. 모달 폼을 전용 업무 화면으로 바꾸되 기존 계산·권한·저장·가져오기·출력의 진실성을 유지한다. 개발 테스트 서버만 대상이다.

### Direction contract

- THESIS: 엑셀의 원본 구조를 유지하면서 기간 비교·수정 위치·저장 상태를 같은 작업 공간에서 확인한다. 큰 모달 안의 장문 입력 나열을 대체한다.
- OWN-WORLD: 사용자가 지정한 desktop 업무 프로그램. 흰 작업표, 차분한 구분선, 파란 선택·주요동작, 노란 수동입력. 새 브랜드나 장식 자산은 없다.
- STORY: 가져오기 확인 → 기준일 확인 → 비목·원자료 비교 → 계산검토의 선택 비목 → 수정 또는 저장·계산 → 출력.
- FIRST VIEWPORT: 클레임센터 메뉴 유지, 상단 ES 명칭과 6단계 SVG 메뉴, 산출서 정보·저장 버튼, 중앙 원본 5구역과 적용자료, 하단 계산·출력 상태. 서브메뉴는 페이지 이동이 아닌 로컬 단계 전환이다.
- FORM: user-pinned 업무 프로그램 구조. 디자인 seed 2f5d0ddc는 사용자가 지정한 레퍼런스를 대체하지 않는다. 코드 기반 구현이며 새 디자인 시안 이미지를 만들지 않는다.

## 구현 범위

- 외부 편집 모달/portal/root inert/전체 Tab trap 제거. 기존 앱 메뉴를 사용할 수 있는 ES 전용 section.
- 6단계 아이콘·번호·설명, 현재 산출서명/기준일/조정일/계약금액, 저장 revision 상태, 단계 이동 및 계산 요약.
- 작업영역 넓게/메뉴 복구. 해당 ES 화면에만 적용.
- 28개 비목 검색, 원본 순서 다중행 금액 붙여넣기, 선택 비목 상세, 계산검토의 현재/직전 비교, 선택 비목 금액 수정으로 복귀.
- 3기간 원자료를 항목별 가로 비교·수정. 날짜 변경 연동은 CF129 syncEsSourceDates 재사용.
- 출력 시트 목록 / 중앙 A4 미리보기 / 오른쪽 인쇄 설정으로 분리. 기존 저장·계산본 revision 가드 유지.
- 선택적 작업 안내, ES 화면 Ctrl/Meta+S 저장. 원자료/가져오기 native dialog의 확인·취소 계약 유지.

## 보존 경계

계산식·서버/DB·권한·API 연결 설정 변경 없음. 가격·계수는 기존 엔진이 계산하며 UI에서 재계산식을 새로 만들지 않는다. 지수·요율의 표시된 출처는 해당 기간 메모이고 각 비목의 공식 검증된 인용이라는 의미가 아니다. 건강보험 외 자동 수집이 연결됐다고 표시하지 않는다. LEGACY_REPLAY는 여전히 검토용 초안이다.

## 검증 및 배포

- 회귀 149/149 PASS (실패·SKIP 0). 계산·저장/권한·Excel·금액·날짜 동기화·Chromium 출력 관련 기존 138건과 새 작업 화면 11건이다.
- `node node_modules/tsx/dist/cli.mjs --test scripts/cf123-es-calculation-test.ts scripts/cf123-es-storage-test.ts scripts/cf123-es-output-test.ts scripts/cf124-es-input-layout-test.ts scripts/cf125-es-import-dialog-test.ts scripts/cf127-es-health-test.ts scripts/cf127-es-money-test.ts scripts/cf128-es-print-test.ts scripts/cf129-es-source-sync-test.ts scripts/cf129-es-print-test.ts scripts/cf130-es-workbench-test.ts`
- 신규 테스트 strict TypeScript, 웹 전체 TypeScript, `corepack.cmd pnpm cf:build` PASS. 기존 큰 JS 청크 경고는 남아 있으며 번들 최적화 완료를 주장하지 않는다.
- 실제 App + 로컬 격리 API + 합성자료 브라우저 검사 6개 흐름 PASS: 일반 페이지/포커스/6단계, 28개 비목 선택, 실제 키보드 금액/undo/기간비교, 가져오기 취소·포커스 및 조회 pending 차단, 이동 취소/확인·저장/재진입/출력 revision 가드, 1440/1280/390 배치·라이트/다크. pageErrors 0, 예상 외 API 0.
- Ctrl+S 1회 저장, 날짜 변경 후 원자료 동기화/undo, 17개 시트 미리보기 실제 A4 생성 확인. 금액 입력은 실제 click→Ctrl+A→입력으로 검수했다. Playwright fill의 focus/원금액 표시 전환 경합과 실제 키보드 동작을 구분했다.
- 독립 UI 재검토: 출력 3열·A4 렌더, 모바일 메뉴, 현재 단계, 직접저장 문구 확인. 원본 셀 계산을 새로 구현하지 않았고 출력 함수/이력 상태 전이는 기존 것을 유지했다.
- 최종 테마 보정 국소 확인 PASS: 검색·비교 기간·페이지 범위·화면 확대 4종은 작업면 토큰 `#fafcfe`와 같고 노란 입력색이 아니다. 390px 라이트/다크 단일 현재 단계와 글자 대비 확인. 독립 UI 마감 SHIP 조건 충족(계산·실물 인쇄 승인과 구분).
- 원본 파일·합성 UI 증거·PDF·인증정보는 커밋 대상이 아니다. 로컬 증거: `output/playwright/es-v2/cf130-final-results.json` 및 동일 접두사의 캡처. 기존 CF129 원본 계산/PDF 비교는 CF129 문서에 구분 기록한다.

### 미실행·제한

- 이번 CF130에서 라이브 고객 문서를 저장·수정하거나 실제 외부 건강보험 API 요청을 실행하지 않았다. 로컬 모의 API 저장 성공을 라이브 저장 검증으로 표시하지 않는다.
- 물리 프린터 성공, Excel 네이티브 출력과 완전한 동일성, 노임·물가지수 전체 자동수집은 이번 UI 검수 범위 밖이다. CF129의 일부 긴 텍스트 내부 셀 넘침 잔여 사항도 유지한다.
- 테스트 서버 배포 식별자와 읽기 전용 라이브 확인은 배포 후 아래에 기록한다.

### Development 배포

2026-09-09 Worker `b61f2959-f0a2-47d9-b594-522ba8da7157`.

- 명시적 `wrangler.development.jsonc`로 dry-run 및 배포 완료. 가오픈·실서비스 배포 및 DB 변경 없음.
- `node scripts/cf114-live-smoke.mjs development` PASS: health/readiness 200, 보호 API 비로그인 401, 원격·로컬 JS/CSS SHA256 일치.
- 배포 CSS `index-D7__ozmF.css`, 주 JS `index-GTQkQEnF.js`. 9월 9일 변경 알림 포함.
- 로그인된 실제 테스트 서버에서 /es 메뉴 → 새 산출서 진입, CF130 section/6단계/직접저장 문구/9월 9일 팝업/작업영역 넓게 및 메뉴 복구를 확인했다. 입력·저장·기존 문서 열기·외부 API 조회 없이 읽기 전용으로 종료했다. 증거 `cf130-live-basic.png`, `cf130-live-wide.png`.
- 구현 기반 시각 규칙은 `DESIGN.md`, 렌더 가능한 UI 기본 요소는 `.impeccable/design.json`에 기록했다. 이는 ES 전용 시각 문서이며 전역 브랜드나 계산·API 계약을 바꾸지 않는다.
