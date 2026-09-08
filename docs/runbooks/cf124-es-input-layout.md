# CF124 ES 기본입력 밀도·입력색 — 2026-09-08

## 변경 범위

- 입력 가능한 ES 텍스트·날짜·선택·여러 줄 칸을 연노랑 `#fff5cc`로 통일. 공통 테마의 `!important` 흰색을 덮기 위해 실제 입력 요소에 `--field-bg`를 지정했다. 파일/체크박스/읽기 전용/비활성 칸은 구분한다.
- 기본입력 28개를 공사정보, 산출 기준일, 전체 계약, 금차 계약, 적용조건의 5개 그룹으로 재배치. 넓은 화면은 4열, 긴 공사정보는 2열, 좁은 컨테이너는 2열/1열이다.
- 항목명과 입력칸을 같은 행에 배치하고 중복 여백을 제거했다. 기존 13px 글자 크기 유지.
- ES 다크 모드의 미정의 surface 변수를 기존 테마 토큰에 연결해 흰 배경/흰 글자 충돌도 수정했다.
- 계산식, 자료형, 저장 API, 권한, DB, 다른 업무 화면은 변경하지 않았다. v2 미완료 계산·출력 범위는 CF123 기록과 동일하다.

## 검증

- 코드 매핑: 기본 7개(프로젝트 선택 포함) + 계약 21개 = 28개, 누락/중복 없음. native date 12개 유지.
- `node node_modules/tsx/dist/cli.mjs --test scripts/cf124-es-input-layout-test.ts scripts/cf123-es-calculation-test.ts scripts/cf123-es-output-test.ts`: 38/38 PASS.
- 새 테스트 strict 타입검사, web `tsc --noEmit && vite build`, development Worker dry-run, diff 검사 PASS. 기존 큰 bundle 경고는 유지.
- 실제 App 로컬 브라우저(API mock): 28개 항목/5개 그룹, Tab 순서, 입력·취소·재실행 PASS. 기본 패널 582.88px, 날짜 칸 약 180.55px. 수정 전 live 화면은 2열 14행, 날짜 칸 약 745px였다(측정 viewport 차이는 원본 증거에 기록).
- 820px/390px 가로 넘침 없음. 마지막 입력까지 스크롤 접근 가능. 라이트/다크 스크린샷 확인, 다크 주변 텍스트 최소 대비 5.70:1, 입력 내부 12.32:1.
- 디자인 검사 경고 2개는 기존 안내/경고의 좌측 테두리이며 이번 수정 범위 밖으로 유지했다.
- 로컬 증거: `output/playwright/es-v2/basic-input-results.json`, `basic-input-visual-findings.md`, `basic-input-local-*.png`.

## 테스트 서버 배포

- 코드 commit: `7fecad6`.
- Worker: `7614f52b-f1e5-4ce3-a7c3-49e6634ec436`.
- URL: https://concost-claim-center-development.jjwwhhjj1116.workers.dev/es
- 가오픈/베트남 서버 배포 없음. DB migration·데이터 교체·키 변경 없음.
- 직후 첫 공개 smoke는 HTML이 직전 JS를 가리켜 실패했다. 재확인 smoke PASS: health/readiness 200, Google Drive 연결 유지, 기존 보호 문서 비로그인 401, 최종 JS/CSS 4개 SHA256 일치.
- 이전 코드 Worker `be8a7dfa-2e67-46c3-8f80-7db9fdd0e9df`. 이번 변경은 UI 전용이며 DB 롤백이 필요하지 않다.

## 로그인된 서버 검수

- 사용자가 로그인한 실제 development ES 작성 화면과 최종 배포 asset 이름을 확인했다. 기존 사용자 문서 변경 없이 별도 합성 산출서 1건을 생성해 `v1 저장 완료`를 확인했다.
- 날짜 자동화 fill은 다른 입력 후 빈값으로 돌아가 native 키보드로 확정했다. DOM 직접 변경 없이 날짜·텍스트·금액의 입력값과 저장 완료를 확인했다. 이 자동화 방식 차이를 앱 날짜 오류로 단정하지 않는다.
- 실제 저장 → 목록 → 열기 PASS. `CF124 화면 검수용 — 합성자료` 독립 산출서 1건(v1, ID `b6f5a6e7-2256-4e6c-adf1-37ece35be48e`)에서 날짜 포함 28칸의 재진입 값 불일치 0. 기존 문서와 원래 사용자 탭은 그대로 보존했다. 검수용 문서는 목록에 남겼으며 삭제하지 않았다.
- 라이브 증거: `output/playwright/es-v2/cf124-live-results.json`, `cf124-live-reopened.jpg`. 실제 서버 계산·출력은 이번 UI 검수에서는 실행하지 않았다.
- 실제 Excel 재계산/물리 프린터 인쇄/전체 v2 수용 테스트 완료를 의미하지 않는다.
