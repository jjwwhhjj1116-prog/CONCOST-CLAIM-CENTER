# CF123 ES 산출프로그램 v2 구현·검수 기록

## 9월 8일 후속 실행 — 아래 초기 기록보다 우선

- 사용자 지시에 따라 테스트 서버 배포까지 진행한다. 가오픈/베트남 서버는 제외한다.
- 계약·금차·담당부서/담당자/보고일 metadata와 기간쌍 실제 합계·라벨을 입력/가져오기/왕복에 추가했다.
- 저장한 현재 revision의 계산 run을 재조회하며 새 revision에는 오래된 run을 표시하지 않는다. 실제 App 뒤로가기 승인 후 URL이 잘못 복구되던 경로를 수정했다.
- 개인정보·수식 캐시·외부 경로를 제거한 17개 원본 grid 계약을 통합했다. 16개는 원본 셀·병합·행/열·서식으로 출력하고 목록은 선택 묶음에 맞춰 생성한다. 4/4.은 각 443행을 유지한다. 원본 목록의 장식 도형은 재현하지 않는다.
- 계산 24 / 저장·ACL 16 / 출력 8 / 가져오기 30 / CF122 회귀 13 통과. 원본 셀 좌표 336개 수치 매핑 대조 일치. UI 최신 grid 검수와 배포 증거는 별도 릴리스 기록으로 확정한다.
- 작업용 XLSX는 입력/계산/작업정보 + 17개 출력 시트(20개)다. ES_계산의 지원 수식은 연결되지만 17개 결과 시트는 내보낸 시점 값이다. Excel 편집 후 웹 재가져오기·재계산이 필요하며 완전한 17시트 Excel 연쇄계산은 미완료다.
- 신규비목 다중 구간, 후속차수 규칙, 복수 선금, 승인된 교정 계산, API 공급자 운영 연결은 여전히 미완료다. 미확인 근거/검토 의견은 —이며 합격 문구를 만들지 않는다. 네이티브 Excel 재계산·실물 프린터 검수도 미실행이다.
- 아래 27페이지 PDF/10건 UI/dry-run만이라는 내용은 첫 구현 당시의 이력이며 최신 상태가 아니다. 최신 실제 배포 결과는 cf123-es-release.md를 참조한다.

## 작업 경계

- 브랜치: `feat/CF123-es-v2`, 시작점 `125841a`.
- 실제 기존 클레임센터 React/Vite 및 Cloudflare Worker에 통합한다. TYPE-01~06은 유지한다.
- 사용자 최신 지시에 따라 가오픈 서버는 변경하지 않는다. 이번 작업은 로컬 구현/격리 검수 우선이며 실서비스 배포 및 파괴적 DB 변경은 승인 없이 하지 않는다.
- 첨부 ZIP은 저장소 밖 작업 폴더에 보관한다. 원본 XLSX·스크린샷·수식 원장·고객값·비밀키는 커밋하지 않는다. 테스트는 비식별 입력만 사용한다.

## 요구사항과 검증 산출물

| 범위 | 구현/검증 대상 | 상태 |
| --- | --- | --- |
| 기존 구조 확인 | 인증·회사/문서 ACL·DB·라우트·출력 재사용 경계 | 기존 Node/Prisma와 Worker/D1에 같은 서비스 연결, 격리 DB 검사 통과 |
| 메뉴/문서 | 독립 ES 메뉴, 설정 하단, 선택적 프로젝트 연결, 저장/충돌 | 구현. 최신 대형 모달/6탭/모바일/undo/paste UI 10개 통과 |
| 계산 | 십진 정밀도, 원본 호환/알려진 쟁점, 입력 변경 전파 | 초회 단일 구간 LEGACY_REPLAY 구현, 원본 234값/변경9값 대조. 전체 계약 분기는 미완료 |
| 엑셀 입력 | 원본/작업용 식별, 변경 미리보기, 원자적 새 revision | 원본/작업용 파서 및 확인 후 적용 구현. 전체 68개 입력과 전후 세부 비교는 미완료 |
| 출력 | 정확한 17시트, 페이지 모델, 부분 선택, 브라우저 인쇄 | 17시트 선택·A4 페이지화·인쇄 호출 구현. 원본 내용/서식 충실도 및 실제 프린터는 미검증 |
| 엑셀 출력 | 작업용 수식/왕복, 전체·선택 값고정 제출용 | 실제 XLSX 생성. CHAIN_1 입력→지수→K→공제→금액 수식 추가. 원본 17시트 연결·Excel 재계산은 별도 검수 |
| 외부자료 | 수동 snapshot 우선, 미연결 API 사실 표시 | 키 없이 수동/원본 가져오기 가능. API 커넥터·승인 자료판은 미구현 |
| 인수 검수 | acceptance_tests.csv 60개 실행 결과, 계산 diff, 실제 파일 | 60행 엄격 판정 별도 CSV. 부분/미구현/미실행을 PASS로 합치지 않음 |

## 초기 확인

패키지 검증 스크립트 실행: 파일 해시/17개 이름·순서·인쇄영역/60개 초기 NOT_RUN 검증 PASS. 이는 앱·계산·Excel 재계산·실프린터 검증이 아니다.

원본에는 27개 시트가 있으며 출력 대상은 `표지, 목록, 붙1, 1, 붙2, 2, 2.1, 2.2(선금), 붙3, 3, 붙4, 4, 붙5, 2., 2.1., 3., 4.`이다. 마지막 점을 제거하지 않는다. 17시트를 17페이지로 가정하지 않는다.

기존 D1은 서버 고정 회사 ID와 session user를 사용하며, 기존 보고서·문서는 사건 필수다. ES 독립 문서를 가짜 사건으로 만들지 않는다. 기존 단순 XLSX 문자열 parser와 래스터 보고서 출력은 ES 전체 계산/인쇄 대체품으로 사용하지 않는다.

## 실제 검수 범위 (2026-09-08)

- 계산 24 + 저장/권한 16 + 출력 6 = 46/46 자동검사 통과. 기존 보고서 삭제/경합 회귀 CF122 13/13 통과.
- 실제 Chromium XML 파서 독립 검사 30/30 통과. 원본 수식 캐시 변경/제거, 날짜 체계, 공사명·수요기관·시공사 매핑, 작업용 왕복, 수식/metadata 변조, 외부 관계·매크로 형식 차단을 검사했다. 원본 SHA 전후 동일, 외부 요청 0건이며 상세 증거는 `outputs/cf123-es/parser-qa.md`에 있다.
- Web, API, document-engine 개별 TypeScript 검사 통과. Vite production build 통과(기존 큰 bundle 경고). Worker 개발환경 설정 **dry-run만** 통과, 업로드/배포 없음.
- 전체 repo `harness-check.ts typecheck`는 CF102 및 CF108~122 등 기존 테스트 파일의 타입/모듈 오류로 실패. 신규 ES 파일 오류는 이 실행에서 나오지 않았으나 전체 통과라고 표시하지 않는다. 이 작업에서 무관한 테스트 파일은 수정하지 않았다.
- 격리 Chromium에서 실제 React 컴포넌트 최신 UI 10검사 통과. API는 **in-memory mock**이고 실제 로그인 서버 브라우저 E2E가 아니다. 별도 storage 검사는 실제 로컬 Node HTTP와 임시 SQLite에 실행했다.
- 합성 17시트 출력은 27 A4 페이지, 지정 `1,3,5-8`은 6페이지. PDF 전 페이지 텍스트 검사에서 빈 페이지 0. 원본 443행 상세 배치와 일치한다는 증거가 아니다.
- 원본은 로컬 read-only로 독립 계산 및 브라우저 파싱만 했다. 원본/고객값을 테스트 서버나 AI에 보내거나 DB에 저장하지 않았다.
- `es-original-formulas.ts`는 원본 수식 텍스트가 아닌 27시트 SHA-256 지문만 담는다. 다른 수식 구성은 경고하고 외부/사용자 수식은 실행하지 않는다. Excel 재저장으로 수식 표현이 바뀐 경우도 경고 대상이다.
- 최신 작업용 수식은 CHAIN_1로 식별하며 수식 전체·입력 행 라벨을 검사한다. 권한/승인/회사/문서 ID를 복원하지 않는다. 백업 캐시와 웹 엔진 재계산을 구분한다.
- 실제 Excel 재계산은 **NOT_RUN**이다. Computer Use의 읽기 전용 화면 조회가 응답하지 않아 중단했다. 합성 파일 열기·입력·재계산·저장은 호출하지 않았으며 C35/D35/B67을 Excel에서 관찰한 값도 없다. 사용자 원본 문서 변경 동작은 없었다. 네이티브 인쇄 대화상자·실제 종이 출력도 미실행이다.
- 마지막 전체 해제 시 전체 17개 내보내기 차단 및 폰트/iframe 15초 timeout·취소 처리는 코드/타입/빌드 검사 범위다. 최신 UI에서 해당 오류를 강제하는 회귀 시험은 미실행이다.

### 실행 명령

```powershell
node node_modules/tsx/dist/cli.mjs --test scripts/cf123-es-calculation-test.ts scripts/cf123-es-storage-test.ts scripts/cf123-es-output-test.ts
node node_modules/tsx/dist/cli.mjs --test scripts/cf123-es-import-test.ts
node node_modules/tsx/dist/cli.mjs --test scripts/cf122-report-delete-test.ts
node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p packages/document-engine/tsconfig.json
# apps/web 디렉터리에서 실행
node node_modules/vite/bin/vite.js build
```

Worker dry-run은 `wrangler.development.jsonc`에 `deploy --dry-run`을 사용한다. 로그는 작업 폴더 `outputs/cf123-es/worker-dry-run.log`에만 저장했다. 원격 migrate/deploy 명령은 실행하지 않았다.

## 실제 생성한 합성 파일

| 경로 | 내용 / 제한 |
| --- | --- |
| `outputs/cf123-es/synthetic-full-17.xlsx` | 17시트 값고정 초안, 원본 배치 미재현 |
| `outputs/cf123-es/synthetic-selected-cover-3-4dot.xlsx` | 수용 조합 정확히 표지+3+4. |
| `outputs/cf123-es/synthetic-single-advance.xlsx` | 2.2(선금) 단독, 강제 표지 없음 |
| `outputs/cf123-es/synthetic-single-4dot.xlsx` | 4. 단독 |
| `outputs/cf123-es/synthetic-working.xlsx` | 입력·원자료·CHAIN_1 지원 수식·작업 metadata |
| `outputs/cf123-es/blank-working-template.xlsx` | 빈 작업용 양식, 필수값 미입력은 정상 계산으로 보이지 않음 |
| `output/playwright/es-v2/synthetic-all-pages.pdf` | headless 출력 27쪽, 실제 프린터 출력 아님 |
| `output/playwright/es-v2/synthetic-selected-pages.pdf` | headless 지정 6쪽 |
| `output/playwright/es-v2/results.json`, `QA_NOTES.md` | UI 실행 및 미실행 증거 |

## 변경 파일

- 메뉴/라우팅: `apps/web/src/layout/AppShell.tsx`, `routes/Router.tsx`, `theme-system.css`.
- ES 웹: `apps/web/src/es/EsStudio.tsx`, `EsStudio.css`, `EsPrintPreview.tsx`, `es-xlsx.ts`, `es-working-formulas.ts`, `es-original-formulas.ts`.
- 공통 계산/저장/출력 모델: `packages/document-engine/src/es-decimal.ts`, `es-calculation.ts`, `es-service.ts`, `es-output.ts`.
- 서버 연결: `apps/api/src/server.ts`, `apps/cloudflare/src/index.ts`.
- DB: `packages/database/prisma/schema.prisma`, `packages/database/prisma/migrations/20260908090000_cf123_es_documents/migration.sql`, `apps/cloudflare/migrations/0063_cf123_es_documents.sql`.
- 검수: `scripts/cf123-es-{calculation,storage,output,import}-test.ts`, `scripts/cf123-es-formula-manifest.py`, 이 문서와 acceptance/gaps/UI 기록. 원본 패키지 및 개별 민감 분석 파일은 제외.

## DB·배포 경계

새 migration은 ES 전용 5테이블과 무결성 trigger만 추가하며 기존 업무테이블/설정/키를 교체하지 않는다. 적용된 migration을 수정한 것이 아니며 아직 두 서버 어디에도 적용하지 않았다. 테스트는 식별자·설정이 들어 있는 격리 사본에서 이중 적용과 integrity/FK/행 보존을 검수했다.

테스트 서버 반영 전에도 저장소 AGENTS의 유지보수/서명백업/복원사본 migration 검증 절차가 필요하다. 미완료 P0 때문에 지금 작업본을 가오픈 서비스에 배포하지 않는다. 실서비스·파괴적 DB 변경은 별도 승인 범위다.

## 미완료 판정

현재는 **전체 v2 수용 불가**다. 원본 17시트 내용·서식, 전체 기본 입력/신규비목/후속 차수/복수 선금, 공식 승인·자료판 정정, 작업용 Excel의 원본 출력 연결이 남아 있다. 서버의 인쇄 pageCount는 클라이언트 선언 범위만 검사한다. 실제 Excel 재계산·네이티브 인쇄/종이 검수 결과는 실행 여부를 별도 기록한다.

세부 60행 판정은 `cf123-es-acceptance.csv`와 `cf123-es-gaps.md`를 기준으로 한다. 스크립트 통과 수를 업무 요구사항 통과 수로 보고하지 않는다.

최종 로컬 수용 판정: **PASS 19 / PARTIAL 32 / BLOCKED 5 / NOT_RUN 4**. 원본 60개 ID의 누락·중복이 없음을 별도 확인했다. BLOCKED 행은 ES2-009·016·025·030·055이며 사용자 승인이 필요한 외부 절차뿐 아니라 아직 작성되지 않은 구현도 포함한다.
