# CF123 ES v2 엄격 수용 판정 및 잔여 격차

판정 갱신일: 2026-09-08. 상태: **최신 로컬 증거 반영 / 전체 수용 불가**. 대상: 로컬 `feat/CF123-es-v2` 작업본. 배포·실제 업무 데이터 변경·공식 산정 승인을 뜻하지 않는다.

원본 `ES_Codex_v2_Package/qa/acceptance_tests.csv`의 60개 ID, 그룹, 우선순위(P0), 시험 조건, 기대 결과, 요구 증거를 그대로 유지한 판정은 [cf123-es-acceptance.csv](cf123-es-acceptance.csv)에 있다. 새 열은 판정일·증거 참조·남은 격차·검증 범위이다. 부분 구현을 원본 요구의 PASS로 올리지 않았다.

## 결론

| 판정 | 개수 | 의미 |
| --- | ---: | --- |
| PASS | 19 | 해당 행의 좁은 요구를 현 증거로 충족. 전체 v2 또는 실제 운영 승인 아님 |
| PARTIAL | 32 | 일부 구현/시험은 있지만 요구의 나머지 조건 또는 최신 통합 증거가 부족 |
| BLOCKED | 5 | 필요한 구현·자료판/규칙 전제가 없어 원래 기대 결과를 충족할 수 없음 |
| NOT_RUN | 4 | 요구된 방식의 시험을 실제로 실행하지 않음. 코드 존재만으로 승격하지 않음 |
| 합계 | 60 | 모든 원본 행 유지. 미완료 41개 |

계산 24 + 저장/권한 16 + 출력 6 = **ES 자동 회귀 46/46 PASS**와 기존 보고서 삭제/경합 **CF122 13/13 PASS**를 함께 재실행했다(59/59). 별도로 실제 DOMParser 파서 **30/30 사례 PASS**를 재실행했다(Node test 1개 내부의 30개 시나리오). 최신 portal/6탭 UI는 담당 검수자의 **10/10 PASS** 결과와 코드를 확인했다. 시험 묶음과 60개 업무 수용 기준은 일대일 대응하지 않으며 통과 개수를 합쳐 업무 완료율로 표시하지 않는다.

정확한 `표지+3+4.`와 단독 `2.2(선금)`/`4.`는 최신 시험에서 실제 파일로 생성되었다. 이 검수자도 디스크에 저장된 세 XLSX를 ZIP/OOXML로 다시 열어 시트 이름·순서·수식 0·외부 링크 0을 확인했다. 이는 Microsoft Excel 실행/렌더 검수가 아니다.

별도 독립 재현은 원본 호환 계산 **234/234 값 및 변경 시나리오 9/9 값 일치**이다. 이것은 원본의 오류까지 명시적으로 재현하는 `LEGACY_REPLAY` 검증이며, 원본 오류 교정이나 공식 제출 계산의 정확성을 승인한 것이 아니다. 민감한 원본 숫자·고객 입력은 이 문서나 저장소 테스트에 옮기지 않았다.

## 1. 우선 해결해야 하는 구현 격차

현재 BLOCKED인 원본 행은 **ES2-009, ES2-016, ES2-025, ES2-030, ES2-055**다.

1. **입력·계약 분기 완전성 — ES2-009/016.** 28개 비목, 기간별 원자료와 일부 공제·단일 선금을 지원한다. C7/C8/C9의 발주자·공사명·시공자 직접 입력 연계와 캐시 독립성도 수정·검증했다. 그러나 선행 분석의 68개 매핑 항목 전체, 신규비목 다중 구간, 후속 차수, 복수 선금 배분은 미구현이다. 일부 원본 분기는 가져오기에서 거부하고 미지원 경고를 표시한다. 해당없음 상태가 없으며 원본의 일부 공란은 0으로 변환한다. 비용이 0인 비활성 비목의 지수·요율·표준단가 쌍까지 필수로 요구하는 점도 남아 있다.

2. **원본 오류와 교정 규칙 — ES2-014/015/016.** 기간 문맥 자체는 나뉘지만 직전일 Z, 일부 안전관리비 표준단가, 장기요양의 건강요율은 원본의 현재일 참조를 의도적으로 유지한다. 사급자재가 양수일 때 기타경비 잔차가 이를 빼지 않는 원본 결함도 재현한다. 경고는 적절하지만 `오참조 없음` 요구의 충족은 아니다. 승인된 교정 모드·적용 조건·원본/교정 차이표가 없으므로 검토용을 유지해야 한다.

3. **원본 17개 출력 내용·서식 — ES2-025/030/046.** 이름·순서·stable ID·정확한 부분 선택과 값 고정 출력은 구현되었지만, 웹/PDF/XLSX는 일반 표로 재구성한 초안이다. 특히 `4`/`4.`의 실제 M443까지의 원본 상세 내용과 셀 구조가 없다. `printArea=A1:M443`을 쓰고 남는 행을 숨기는 것은 원본 내용 재현이 아니다. 원본 병합, 표 선, 행열 크기, 금액 표시, 여백과 인쇄 배치 대조도 필요하다. 27 A4, overflow 0, 빈 페이지 0은 현재 재구성 표에 대한 제한적 증거다.

4. **작업용 Excel의 남은 범위 — ES2-048/049/050.** 최신 `CHAIN_1`은 입력·원자료에서 지수, Z/안전, 현재/직전 K, 공제와 금액으로 이어지는 280개 초과 수식을 포함한다. 의존 그래프의 순환/누락 참조, 주요 캐시 대조, 변경 입력의 웹 재가져오기 계산을 검증했다. 이전의 기본 SUM/단순 계수만 있다는 판정은 철회한다. 다만 여전히 3개 작업 시트이며 **원본 17개 출력 시트와의 수식 연결·전체 계약 분기·실제 Excel 재계산은 미완료**다. 수식 캐시가 웹 결과와 일치하는 것은 Excel이 그 수식을 실행했다는 증거가 아니다. ES2-048은 BLOCKED에서 PARTIAL로 변경했다.

5. **승인·외부 자료판 변경 — ES2-055.** immutable revision/run은 구현·검증했다. 반면 외부 자료판 API 정정, 승인본, 새 산정안으로 변경, 과거 승인본 재출력의 전체 흐름은 존재하지 않는다. 수동 원자료 입력 및 출처 문자열 저장과 자료판 승인/개정 관리는 다르다.

원본 수식 변경 감지는 최신 27시트 SHA 지문과 실제 변조 fixture로 검증되어 ES2-041을 PASS로 변경했다. 지문은 수식 텍스트·구성의 차이를 경고하는 장치이며, 내용의 업무 적합성·공식 승인이나 수식의 의미적 동등성을 판정하지 않는다. Excel 재저장으로 표현이 달라져도 경고될 수 있다.

## 2. 출력·저장 경계의 잔여 위험

- **서버의 페이지 범위:** `es-service.ts`는 클라이언트가 보낸 `pageCount`가 양의 정수이고 상한 이하인지 확인한 뒤 그 수 안에서 범위를 검사한다. 실제 출력 모델의 장수를 서버에서 재산정하거나 생성 파일의 페이지 manifest와 결합하지 않는다. S13은 이름 그대로 *declared bundle bounds* 검증이지, 임의로 부풀린 실제 페이지 수를 판별한 시험이 아니다. ES2-026은 PARTIAL이다.
- **이어하기:** 입력과 자료 입력값은 복원되나 문서 GET은 저장된 계산 run을 화면에 복원하지 않는다. 다시 저장·계산해야 출력 가능한 상태가 된다. ES2-006은 PARTIAL이다.
- **가져오기 비교:** 적용 전 확인과 취소는 있으나 전후 비교는 일부 요약값과 변경 비목 수 중심이다. 모든 입력·지수·요율의 전후 값/좌표 비교표가 아니다. ES2-039는 PARTIAL이다.
- **선택 0개:** 최신 코드에서 선택 Excel과 전체 17시트 Excel 모두 선택이 없으면 비활성화한다. UI 10검사에는 선택 Excel 단언만 있어 전체 버튼의 정확한 재검수 증거는 없다. 코드 수정은 반영하되 ES2-022는 PARTIAL을 유지한다.
- **불완전 계산:** 숫자 보고서 금지와 표지·붙임·목록 검토용/입력 백업의 구분은 검증했다. 이것을 정식 제출용 산출서 생성 가능으로 표현하면 안 된다.
- **출력 생성 경합:** DB의 revision/run 변조와 stale 저장은 검증했다. 실제 UI의 비동기 렌더링·다운로드 중 편집, 탭 이동, 다중 출력의 전 시나리오는 미실행이다.
- **렌더 실패:** 최신 코드에 폰트/iframe 준비 15초 timeout, 취소된 준비 작업의 뒤늦은 실행을 막는 attempt 확인, 재시도가 추가되었다. 해당 코드를 읽었으나 폰트 실패·차단·시간초과를 강제한 실제 시험은 없다. 긴 단일 행의 오류 안내와 복구도 경계 시험이 필요하다.
- **출력 상태:** REQUESTED/RENDERED/FAILED/DIALOG_CLOSED만 기록하고 `printerSuccessVerified=false`를 유지한다. 이 검증을 실제 인쇄 완료·납품 완료 증거로 사용하면 안 된다.

## 3. UI·가져오기·네이티브 증거의 정확한 범위

`output/playwright/es-v2/QA_NOTES.md`와 `results.json`의 최신 **PORTAL_MODAL_SIX_TABS_UNDO_PASTE / 10개 PASS**는 실제 AppShell·Router·EsStudio·계산/Excel 모듈을 렌더한 **격리 Chromium + 인메모리 API mock** 검수다. 실제 업무 DB, 로그인 세션 또는 Cloudflare 배포 검증이 아니다. 저장 시험의 실제 Node HTTP와 혼합해서 하나의 전체 서버 E2E라고 부르지 않는다.

이전 인라인·4탭 지적은 최신 실제 UI에서 해결된 것을 확인했다. 94vw×92vh portal 모달, 모바일 전체화면, 6개 탭, root inert/스크롤 잠금, 실제 Tab/Shift+Tab 초점 순환, 미저장 Escape 확인·취소와 닫기, 제목 undo/redo, 단일 열 숫자 붙여넣기와 묶음 취소를 검사했다. 브라우저 뒤로가기 전체 시나리오와 실제 125%/150% 확대는 여전히 미실행이다. 낮은 viewport는 확대 검사를 대신하지 않는다.

파서 검수는 별도 `scripts/cf123-es-import-test.ts`가 실제 Chromium DOMParser에서 프로덕션 importer와 엔진을 호출한 **30개 사례**다. 원본 수식 지문/변조 경고, 모든 수식 캐시 소실·오염, 역순 시트, 1904 날짜(발표일과 O/T 기간쌍 포함), C7/C8/C9 문자 입력, CHAIN_1 왕복·변경 입력·빈 셀, metadata 변조와 악성 입력 거부를 확인했다. 이 검수자가 같은 명령을 재실행해 30/30 PASS, 원본 SHA 불변, 외부 요청 0을 확인했다. 원본 수정은 브라우저 메모리 안에서만 이뤄졌고 복사본·고객값 로그·업로드·DB 저장을 남기지 않았다. UI 파일 선택창, 서버 저장과 네이티브 Excel 실행 검수는 아니다.

**실제 Excel 재계산 최종 결과: NOT_RUN.** UI 검수자가 기존 Excel 2013 창의 존재만 확인했다. 이어진 읽기 전용 창/상태 조회가 응답하지 않아 중단했다. 합성 파일 열기, activate/click/키보드 입력, 수식 재계산, 저장은 전혀 호출하지 않았으며 C35/D35/B67의 실제 Excel 확인값도 없다. 사용자 문서는 변경하지 않았다. 창이 존재한다는 사실이나 CHAIN_1 수식·캐시·웹 왕복 PASS를 ES2-049의 PASS로 사용하지 않는다.

최신 인쇄 준비 timeout/취소 방어 및 0개 선택의 전체 Excel 차단은 UI 10검사 이후 확인된 코드 변경이다. 해당 변경의 정확한 유도·버튼 단언 시험이 없는 부분은 CSV에서 PARTIAL로 유지했다.

## 4. 미실행·부분 검수로 남긴 내용

- 기존 업무 메뉴/하위 기능의 실제 진입 회귀 E2E (ES2-002).
- 네이티브 브라우저·시스템 인쇄 대화상자 (ES2-033), 실제 종이 인쇄 전체/부분 (ES2-034), 실제 인쇄창 취소/닫기 이벤트.
- Microsoft Excel에서 합성 파일 열기·입력 수정·수식 연쇄 재계산·앱 비교 (ES2-049). 창 조회만 시도했으며 실제 계산 증거는 없다.
- 원본 68개 입력의 완전 매핑, 승인된 교정 규칙, 신규비목·후속 차수·다회 선금, 원본 17시트 내용·서식.
- 1904=1 및 시트 역순은 PASS 사례가 있으나 날짜 셀 형식/속성 표현의 추가 변형은 부족하다.
- 매크로/VBA·손상 ZIP·XML·외부 수식 공격은 실제 검증했다. 실제 암호화 Excel/BIFF .xls, 파일 선택창 확장자 UX는 별도 미실행이다.
- 캐시 소실·오염의 영향 제거는 검증했으나 오래됨/없음의 구체적 대상별 상태 진단은 없다. 경고는 캐시 미사용의 일반 안내다.
- 인쇄영역 밖 숨김 개인정보·주석·메모가 있는 원본 fixture의 제출용/작업용 전체 content scan.
- 빈 양식 직접 작성부터 가져오기까지, 제출용 파일 재가져오기 오류 UI와 기존 입력 유지, 네트워크 종료 중 가져오기→저장, 출력 중 편집/탭 이동의 통합 경합.
- 실제 사용자 로그인 서버의 전 과정, 브라우저 뒤로가기, 실제 125%/150% 확대, 전체 Excel 버튼의 선택 0개 단언, 폰트/iframe 실패 유도.
- 기존 타모듈 HWP 전체 회귀. CF122 삭제/경합 13개는 이를 대체하지 않는다.

### 타입 검사·빌드 범위

root의 최신 [구현 기록](cf123-es-v2-progress.md)을 확인했다. Web/API/document-engine 개별 TypeScript 검사, Vite production build, Worker 개발환경 dry-run은 PASS로 보고되었다. Worker는 업로드/배포가 아닌 dry-run이며 기록은 `outputs/cf123-es/worker-dry-run.log`다. **전체 repo `harness-check.ts typecheck`는 기존 CF102 및 CF108~122 테스트 파일 등의 타입/모듈 오류로 실패**했다. 개별 통과를 전체 타입 검사 통과로 바꾸지 않았다. 이 검수자가 직접 재실행한 것은 아래 59개 회귀와 파서 30개이며, 타입/빌드 결과는 root의 실행 기록 확인 범위다.

## 5. 증거 인덱스

### 재실행 명령과 파일

```powershell
.\node_modules\.bin\tsx.cmd --test scripts/cf123-es-calculation-test.ts scripts/cf123-es-storage-test.ts scripts/cf123-es-output-test.ts scripts/cf122-report-delete-test.ts
.\node_modules\.bin\tsx.cmd --test scripts/cf123-es-import-test.ts
```

2026-09-08 최신 코드에서 재실행: ES 46 + CF122 13 = tests 59, pass 59, fail 0, skipped 0. 별도 importer는 Node test 1개 안의 30개 사례 모두 PASS. Node HTTP는 합성 데이터의 임시 로컬 SQLite 복사본과 localhost 서버만 사용했다. 운영 설정/키를 추출하거나 변경하지 않았다. D1은 합성 SQLite + Worker 어댑터 경로 검증이며 실제 배포 D1 접근이 아니다.

CSV의 C/S/O는 아래 파일 안 `test()` 선언 순서이다. 반복 선언되는 D1/Node 검사는 각각 별도 번호를 부여했다. 테스트 이름은 코드의 실제 이름이며 `CF123 ` 접두사는 표에서 생략했다.

- C: [scripts/cf123-es-calculation-test.ts](../../scripts/cf123-es-calculation-test.ts)
- S: [scripts/cf123-es-storage-test.ts](../../scripts/cf123-es-storage-test.ts)
- O: [scripts/cf123-es-output-test.ts](../../scripts/cf123-es-output-test.ts)

| ID | 실제 테스트 이름 |
| --- | --- |
| C01 | decimal: exact rational arithmetic and large integer precision |
| C02 | decimal: Excel round ties and truncation toward zero at positive/negative places |
| C03 | decimal: reject malformed, non-finite and unsupported precision inputs |
| C04 | blank new document is incomplete, never a fake zero estimate |
| C05 | validation whitelists ownership, approval, results and unknown cost IDs |
| C06 | validation rejects malformed schema, arrays, missing fields and oversized collections |
| C07 | dates: leap year, month/year end and invalid calendar days |
| C08 | context dates must match base/current/actual previous calendar day |
| C09 | synthetic baseline: 28 stable rows and independently known current/previous totals |
| C10 | exact zero cost is allowed while an empty cost is not silently zero |
| C11 | required active wage and material values never fall back to zero or 100 |
| C12 | amount validation: negative and zero denominator cannot yield a report amount |
| C13 | input changes recompute current labor and derived Z instead of reusing stored results |
| C14 | same base date may use different selected standard common-item pairs per comparison |
| C15 | long-term care derives from health rate as well as care rate and labor index |
| C16 | source private-material residual defect is visible and never labeled approved |
| C17 | direct-paid labor excludes only the portion not already in excluded work |
| C18 | excluded work above contract cannot create negative applicable consideration |
| C19 | advance uses full ratio before rounding instead of the displayed four-decimal rate |
| C20 | advance payment cannot exceed its own target contract |
| C21 | final amount truncates after other deductions and preserves negative adjustment direction |
| C22 | structural limits: 28 distinct IDs despite repeated expense codes; source provenance retained |
| C23 | validation blocks a negative advance remainder instead of increasing the final amount |
| C24 | common-item count must be an integer, not a fractional item |
| S01 | d1 migration preserves populated rows, settings, PKs and is idempotent |
| S02 | node migration preserves populated rows, settings, PKs and is idempotent |
| S03 | owner/company ACL applies to create/list/get/save/calculate and untrusted ownership is discarded |
| S04 | optional project links require server permission; forged links and invalid payloads cannot mutate storage |
| S05 | stale and interleaved writes produce one revision and one audit event, preserving the winner |
| S06 | failed storage rolls back document, revision and audit and hides internal exception details |
| S07 | server calculates from immutable saved input and later revisions cannot alter an existing run |
| S08 | d1 database rejects revision/run/audit rewrites, ownership transfers and foreign revision runs |
| S09 | node database rejects revision/run/audit rewrites, ownership transfers and foreign revision runs |
| S10 | outputs enforce document/run/actor/company scope and reject internal or forged sheet IDs |
| S11 | outputs block incomplete numeric reports but allow explicit cover, contents and divider drafts |
| S12 | outputs preserve all 17 distinct source IDs and canonical order; XLSX ignores print-page filtering |
| S13 | PRINT validates page syntax and declared bundle bounds without writing rejected jobs |
| S14 | output lifecycle reports only persisted state and never claims physical printer success |
| S15 | Worker route retains authentication and same-origin JSON mutation guards |
| S16 | actual Node migration runner and HTTP ES routes preserve settings, numeric revisions, ACL and project lifecycle |
| O01 | exact 17 sheet names/order; internal sheets and numeric name coercion rejected |
| O02 | page ranges: original order, deduplication, empty means all; invalid ranges reject |
| O03 | selection never changes calculation; fatal permits only cover/contents/dividers |
| O04 | real full/selected XLSX are values-only, exact scope, no support data/secrets/external links |
| O05 | working XLSX contains editable input, guarded snapshot and supported Excel formulas; blank backup exports |
| O06 | formula-like user text is encoded as text, never a formula |

### 로컬 브라우저 및 산출물

UI 검수자가 갱신한 [QA_NOTES.md](../../output/playwright/es-v2/QA_NOTES.md), [results.json](../../output/playwright/es-v2/results.json), [ui-test.ts](../../output/playwright/es-v2/ui-test.ts)를 직접 읽었다. CSV U 번호는 **아래 이름 매핑**을 사용한다. 추가 검사 때문에 최신 results 배열 위치와 번호가 다를 수 있다.

| ID | 실제 결과명 / 확인 범위 |
| --- | --- |
| U01 | navigation + independent list + owner/admin notice |
| U02 | local original xlsx DOMParser import and cancel/apply; no API upload |
| U03 | save conflict retains input, retry and reload restore document URL |
| U04 | 17 sheet selection + multi-page measured A4 + page range validation |
| U05 | headless PDF from actual generated pages, full and selected physical pages — PDF 페이지 검사이며 물리 프린터 또는 앱의 native iframe 호출 검수가 아님 |
| U06 | working xlsx client-only roundtrip |
| U07 | report download records requested/rendered only and no print success claim |
| U08 | short desktop modal and mobile fullscreen, fixed summary and restored sidebar footer |
| U09 | portal modal dimensions, six tabs, focus trap, root inert and Escape guard |
| U10 | native single-column clipboard paste, atomic undo/redo and invalid multi-column rejection |

- UI 산출물: `output/playwright/es-v2/synthetic-all-pages.pdf` (27페이지), `synthetic-selected-pages.pdf` (6페이지), `synthetic-report.xlsx`; 레이아웃 표본 `pdf-first.png`, `pdf-longtable.png`. 실제 PDF 재열기와 화면 검수는 UI 에이전트 수행이며 이 검수자는 결과/시험 코드를 확인했다.
- 출력 단위시험: `outputs/cf123-es/synthetic-full-17.xlsx`, `synthetic-selected-cover-3-4dot.xlsx`, `synthetic-single-advance.xlsx`, `synthetic-single-4dot.xlsx`, `synthetic-working.xlsx`, `blank-working-template.xlsx`. 모두 합성 입력. 정확한 3시트/단독 파일은 이 검수자도 디스크에서 ZIP/OOXML로 다시 열어 확인했다.
- R234/R9: 작업공간 `tmp/es-v2-analysis/compare_runtime.ts`, `runtime_comparison.json`, `independent_reproduction.json`, `INDEPENDENT_REVIEW.md`. 원본 결과 234개 + 변경값 9개 독립 대조. 원본 고객 수치를 포함하므로 저장소/배포에 추가하지 않는다.
- 매핑 근거: 같은 로컬 분석 디렉터리의 `input_origins.json`, `prior_input_mapping.json`, `categories.csv`. 전체 매핑 완료 승인이 아니라 조사 결과다.
- NATIVE_EXCEL_NOT_RUN: 2026-09-08 UI 에이전트의 최종 회신 및 root의 중단 확인. 기존 Excel 2013 창 존재 외에 파일 열기·입력·재계산·저장·셀 값 증거는 없다.

### 파서 30개 사례

실제 시험: [scripts/cf123-es-import-test.ts](../../scripts/cf123-es-import-test.ts). 실행 결과: [parser-qa.json](../../outputs/cf123-es/parser-qa.json), [parser-qa.md](../../outputs/cf123-es/parser-qa.md). JSON의 사례 순서가 아래 P 번호다. 이 검수자가 재실행했고 외부 요청 0 및 원본 SHA 불변을 확인했다.

| ID | 실제 사례 ID |
| --- | --- |
| P01 | original_exact_27_formula_fingerprints |
| P02 | original_one_formula_change_warns_without_execution |
| P03 | original_literal_identity_fields_are_mapped_without_title_formula_cache |
| P04 | original_stale_formula_caches_not_used |
| P05 | original_absent_formula_caches_not_used |
| P06 | original_sheet_order_is_not_mapping_identity |
| P07 | original_1904_epoch_preserves_calendar_dates_and_results |
| P08 | working_chain_1_exact_round_trip |
| P09 | working_chain_1_edited_input_recalculates_on_import |
| P10 | working_stale_formula_caches_not_used |
| P11 | working_absent_formula_caches_not_used |
| P12 | working_blank_cells_removed_by_excel_remain_blank |
| P13 | working_row_labels_cannot_be_rebound |
| P14 | working_supported_formula_change_rejected |
| P15 | working_extra_formula_outside_chain_rejected |
| P16 | working_metadata_integrity_change_rejected |
| P17 | working_forged_acl_even_with_recomputed_hash_is_discarded |
| P18 | submission_workbook_is_not_an_editable_source |
| P19 | wrong_zip_header_rejected |
| P20 | truncated_zip_rejected |
| P21 | zip_path_traversal_rejected |
| P22 | malformed_xml_rejected |
| P23 | xml_doctype_entity_rejected |
| P24 | external_worksheet_relationship_rejected |
| P25 | unsafe_formula_DDE |
| P26 | unsafe_formula_WEBSERVICE |
| P27 | unsafe_formula_pipe |
| P28 | xlsm_vba_payload_rejected |
| P29 | macro_enabled_container_without_vba_payload_rejected |
| P30 | duplicate_sheet_names_rejected |

## 6. 판정 갱신 조건

변경된 코드 범위와 해당 요구를 함께 재검수하고 실제 증거를 갱신해야 PARTIAL/BLOCKED/NOT_RUN을 변경할 수 있다. 이 문서의 날짜나 통과 개수만 바꾸지 않는다. 특히 원본 출력물과 Microsoft Excel/프린터 시험이 남은 상태에서는 **가오픈·테스트 공통 배포 완료**, **원본과 동일한 결과물**, **ES v2 전체 완료**, **오류 없음**으로 보고하지 않는다.

이번 갱신은 Ponytail 지침에 따라 기존 코드·시험·분석 증거를 재사용했다. 스프레드시트 검수 지침대로 수식·캐시·웹 파서와 네이티브 실행 증거를 구분했다. 기능 재설계나 프로덕션 수정 없이 판정 문서 두 개만 갱신했다.
