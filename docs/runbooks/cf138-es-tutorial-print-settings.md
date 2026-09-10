# CF138 ES 사용 안내와 머리글·바닥글 편집

## 현재 상태

- 시작: `feat/CF123-es-v2`, `d114e52` (CF137). 기존 tracked 변경 없음.
- 2026-09-10 사용자가 배포를 명시 재승인하여 **테스트서버 배포 완료**. 제품 커밋 `cf7a7f8`, Worker 버전 `4f8b3add-1d36-4c66-bc68-4796f4ff2163`.
- URL: https://concost-claim-center-development.jjwwhhjj1116.workers.dev/es . 운영 서버·DB 구조·기존 사용자 산출서·인증키 변경 없음.

## 변경

- ES 목록에 튜토리얼 시작과 접을 수 있는 첫 사용 설명. 편집기 작업 안내에서 재실행. 현재 6단계와 안내가 함께 이동하며 각 단계의 확인 항목을 설명한다. 건너뛰기/닫기 가능. 안내는 조회·입력·저장·계산을 자동 실행하지 않는다.
- 공사정보, 산출기준일, 전체계약, 금차계약, 적용조건 제목을 번호가 있는 제목 띠로 표시. 원본 노란 19칸·입력 의미·계산식 유지. 이미지 대신 실제 텍스트로 제공.
- 출력 탭에 머리글·바닥글의 원본 유지 / 직접 편집·모든 페이지 고정 / 숨김, 문구, 좌·중·우 정렬, 쪽번호 삽입, 문구 지우기, 원본 설정 복원.
- 사용자 문구는 80자·한 줄 이내, 9pt, 허용 토큰 `{page}`/`{pages}`. HTML/XML 및 Excel `&` 명령 별도 이스케이프. 사용자 문자열을 HTML/서식 명령으로 실행하지 않는다.
- 추가 머리글·바닥글 사용 시 해당 본문 여백을 24mm로 확보하여 페이지 분할. 기본값은 이전 12mm 상단/16mm 하단 그대로. 원본 본문 A1·D47·붙임 제목·주의문은 숨김 기능으로 지우지 않는다.
- 설정은 optional `EsInput.printSettings`로 검증하고 기존 revision/inputHash/run 스냅샷에 저장한다. 스키마 migration 없음. 설정 없는 기존 입력은 속성을 추가하지 않아 호환성 유지.
- 편집기는 dirty 출력 차단 조건 밖에 있어 첫 글자 수정 후에도 유지. 변경은 기존 undo/redo/저장·계산 대상이며 과거 run에 새 설정을 섞지 않는다.
- 작업용 Excel의 기존 입력 행 구조는 변경하지 않고 snapshot으로 설정 왕복. 작업용17시트 및 전체/선택 제출형 Excel에도 동일 설정 전달. Excel 쪽번호는 Excel의 시트별 계산 방식임을 명시.
- 브라우저 자체 URL·날짜 머리글은 앱에서 강제 변경할 수 없으므로 인쇄창에서 해제 안내.
- Ponytail로 기존 저장/출력 구조를 재사용하고 Impeccable onboarding 원칙으로 실제 단계별 선택 안내를 적용. 새 라이브러리 없음.

## 검증

- 기존 233개 + 신규 7개 = **240/240 PASS**. 이후 특수 줄구분자 검증과 실제 UI 동작을 보강한 신규7개 재실행 PASS. CF124 제목 검증은 숫자가 span 안으로 이동함에 따라 접근 가능한 텍스트 순서를 검증하도록 변경했다.
- `corepack.cmd pnpm cf:build` TypeScript/Vite PASS. 기존 큰 번들 경고 유지.
- 신규 실제 Chromium: 작업용 Excel 내보내기→재가져오기 설정·계산 결과 일치. 17개 원본 시트의 모든 셀 데이터/병합 보존. 원본/숨김/사용자 지정 문구 검증.
- 실제 Chromium A4 페이지 분할: 17시트 43쪽, 반복영역 누락·본문 겹침·높이 초과 없음. 숨김 시 기존 반복 쪽번호 제거, 전체 쪽번호 일치.
- 생성 파일 `output/playwright/cf138/synthetic-bands-a4.pdf`: pypdf로 43쪽 모두 A4, 빈 페이지 0, 모든 쪽에 사용자 머리글/바닥글. Poppler로 붙임 표지와 본문 페이지를 시각 확인.
- 실제 React UI + **로컬 합성 읽기전용 API**: 목록→튜토리얼 1~6→닫기/재실행→목록→합성 저장본 열기. 출력 문구 입력 후 편집기 유지, dirty 표시·제출형 내보내기 차단. API 쓰기0. 데스크톱/390px 화면 및 가로 넘침 검사.
- 로컬 UI 테스트 초기에 API 기본 포트3001을 사용하여 목록 조회가 실패했다. 검수 전용 `__CLAIM_API_ORIGIN__`을 해당 로컬 서버로 지정하여 해결. 제품 네트워크 설정은 변경하지 않았다.
- 전문가 3명 읽기전용 검수 완료. 설정/저장/출력 경로에서 확인된 차단 결함 없음.
- 출력 파일·화면 증거는 로컬만 유지하고 Git에서 제외.
- 배포 턴에 `cf7a7f8`에서 관련 18/18 재실행 PASS, TypeScript/Vite 재빌드 PASS. development 설정으로만 배포(Worker 시작29ms).
- 배포 후 `node scripts/cf114-live-smoke.mjs development` PASS: health/readiness 200, Drive 연결 정상, 익명 보호401, 원격 JS/CSS 4개 SHA256가 로컬 빌드와 일치. 주 JS `index-Cynlvezl.js`, CSS `index-BELqU-wf.css`.
- ES 경로 추가 확인: `/es` 200, 비로그인 `/api/es/documents` 및 `/api/es/sources/pairs` 401.
- 실제 개발서버 로그인 UI: 튜토리얼 1~6 순차 이동, 단계별 확인 내용과 본문 전환, 닫기→작업 안내 재실행 PASS. 안내만 보는 동안 서버 산출서 저장0회. 기본입력 제목띠5개 및 머리글/바닥글 원본·직접편집·숨김 선택 UI 확인.
- 신규 합성 `CF138 안내·출력 설정 검수 — 합성자료`, ID `6830bc5b-a490-432d-9243-995bec8a2da9`를 실제 UI에서 작성. 공식자료 1회 조회45항목, 저장·계산v1 PASS. 합성 직접노무100,000원/나머지0, 총계약1,000,000,000원, K0.0599·59,900,000원.
- 머리글 `CF138 검수 머리글` 오른쪽 / 바닥글 `CF138 검수 바닥글 · {page} / {pages}` 가운데를 저장. 실제43페이지 전부 반복 및1/43~43/43 치환 확인.
- 실제 작업용 Excel 버튼으로 `ES_작업용.xlsx` 131,509bytes 다운로드 확인. 공식 filechooser 재업로드는 브라우저 도구의 `Not allowed (-32000)` 제한으로 미실행; 우회하지 않고 새 합성 직접입력으로 검수했다. 재가져오기 자체는 로컬 Chromium 왕복 PASS와 구분한다.
- v1을 목록에서 다시 열어 두 문구/직접편집모드/오른쪽·가운데 정렬 보존 PASS. 머리글·바닥글을 숨김으로 바꾸고 저장·계산v2 후41쪽에서 맞춤 문구0건, 계산값 불변. 페이지 확인 전 인쇄버튼 비활성→확인 후 활성 PASS(실제 인쇄 호출은 하지 않음).
- 맞춤 문구가 있는 v1의 전체17시트 Excel 버튼으로 `ES_전체_초안 (1).xlsx` 114,951bytes 다운로드 확인. 신규 CF138 문서 총2회 저장, 기존 CF137·사용자 문서는 저장0회.

## 변경 파일

- `apps/web/src/es/EsStudio.tsx`, `EsStudio.css`, `EsTutorial.tsx`, `EsPrintSettingsEditor.tsx`
- `apps/web/src/es/EsPrintPreview.tsx`, `es-template-print.ts`, `es-template-xlsx.ts`, `es-xlsx.ts`
- `packages/document-engine/src/es-calculation.ts`, `es-print-settings.ts`
- `scripts/cf124-es-input-layout-test.ts`, `cf138-es-tutorial-print-test.ts`

## 미완료·미검증 및 다음 시작점

1. 사용자는 테스트서버 `/es`를 새로고침하여 튜토리얼과 출력 탭의 머리글·바닥글 편집을 확인하면 된다. 문구 변경 후 저장·계산하여 출력한다.
2. 실서버의 네이티브 인쇄 대화상자 호출·실프린터 인쇄 성공·네이티브 Excel 인쇄 배치 및 브라우저 도구에서의 파일 재업로드는 미검증. 로컬 Chromium PDF/왕복 검사와 구별한다.
3. 검수용 CF138 산출서는 현재v2 숨김 상태로 남겨두었다. 기존 사용자 문서와 CF137 문서는 수정하지 않았다. 후속 배포도 `wrangler.development.jsonc`만 사용한다.
