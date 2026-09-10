# CF136 ES 공식 요율·노임 자동조회

대상: development 테스트서버. 작업 시작 SHA `3fe88829951f`, 브랜치 `feat/CF123-es-v2`.

## 변경

- `/api/es/sources/public`: 로그인·ES 역할 확인 후 조달청 및 대한건설협회 공개 파일 조회. 추가 API 키·DB 변경 없음. Node 어댑터에도 같은 수집 경로 연결.
- 조달청 2023~2026년 12개 공표본, 건축/토목 24개 첨부 확인. 공종·고용등급별 산재/고용/퇴직공제/건강/연금/요양 후보. 셀 고정값이 아니라 원문 항목명·분모·공표일·요율 헤더를 검사.
- 대한건설협회 2026 하반기 HWPX의 공표 이력에서 일반공사 평균노임 조회. 원본 T열과 2019/2020/2023/2024/2025 대조. 전체직종·조사월로 대체하지 않음.
- 공표 catalog의 검증 종료일은 2026-09-10. 이후 날짜와 미연결 과거 자료는 현재값으로 추정하지 않고 수동 확인 안내. 신규 공표자료 발견·자동 catalog 갱신은 미구현.
- 공식 파일은 요청 시 메모리에서 읽고, 동일 요청 내 파일 중복 다운로드를 제거. 고정 공식 HTTPS URL, 동일 경로·쿼리의 최대 2회 주소 전환, 15초·5MB 제한. 원본 고객 Excel·비밀키·공식 첨부 원본은 커밋하지 않음.
- PPS 토목 파일의 과도한 빈 서식 셀은 공개 첫 시트 전용 경로에서 건너뜀. 기존 업로드의 20,000셀 제한과 ZIP 압축해제 크기 제한은 유지.
- 법령 연결 실패 원인이던 일괄 redirect 차단을 제한적 검증으로 변경. 날짜별 부분 실패 시 검증된 다른 날짜 결과 유지. 외부 목적지·다른 OC·중복 인증값·다른 경로 차단, 원문 오류/인증 URL 미반환.
- 확인창: 자동조회 우선 후보, 원래 값 나란히 표시, 숫자 직접 수정, 기존값 유지, 출처·적용조건, 취소/확인. 확인 전 편집·저장 없음. 산업안전 원본 C22 공통값은 세 기간 함께 수정.
- 건강보험 PPS/법령 불일치 시 자동 후보를 적용하지 않고 같은 날짜의 기존/Excel 값을 유지. 이 선택을 저장 근거에도 기록.
- Impeccable clarify/UI-UX 기준으로 조회 상태·수동 행동·오류 표시를 구별. 기존 화면 구조·금액 표기·계산식·출력은 보존.

## 검증

- 공식 PPS 건축 12개 및 토목 12개 공표본을 실제 내려받아 각 보험·부금 6항목 파싱 확인. 2023 산재3.7/요양12.81, 2024~2025 산재3.56/요양12.95, 2026 건강3.595/연금4.75/요양13.14를 대조. 고용3등급 XML 저장 잡음은 공표 두 자리1.13과 대조.
- CAK 실조회: 2024-06-15 → 공표2024-01-01 일반공사258,359원/일. 2026-05-01 → 공표2026-01-01 268,486원/일. 2026-09-01 공표270,614원/일 확인.
- 신규 자동수집/후보/Node 권한 9개 테스트, 건강보험 25개 테스트 통과. 합성 정상/오류 ZIP, 업로드 제한 보존, 부분 실패, 공표·분모·소수·날짜·빈근거·출처 검증, 후보 우선/원본 불변/0 보존 포함.
- 웹 TypeScript+Vite build PASS. 기존 대형 번들 경고 유지. UI detector는 기존 색상·폰트/좌측 강조선 advisory를 보고했으며 이번 범위 밖 전체 재디자인은 하지 않음.
- 건강 연결 수정 초기 배포 `93e3e591-b0fb-440e-b2b3-52ae9fbf909e`: 실제 기존 탭에서 건강3시점 조회 확인 후 취소, 적용/저장0회, 원본 미저장 상태 보존.
- 공개 수집·새 확인창 첫 배포 `ee7e560e-742c-427b-bc09-11819e0904b0`: 서버 health/readiness, Drive 연결 유지, 익명 보호, 로컬/원격 자산 일치 PASS.
- 첫 공개 수집의 실제 Worker 요청에서는 PPS HTTP 404/CAK HTTP 500이 발생했다. 고정된 안전 오류코드로 진단 후 프로그램 식별·한국어·공식 게시글 출처 헤더를 명시한 배포 `c4639732-03dd-408a-8b2f-c41b8df57235`에서 자동조회 33항목 성공을 확인했다. 어느 개별 헤더가 원인인지 분리 검증하지 않았으며 기관의 필수 요청 규격이라고 단정하지 않는다.
- 최종 배포 `917c1dff-8477-4632-81d7-1a988227182e`: health/readiness, Google Drive 연결 유지, 익명 보호, 로컬/원격 자산 해시 일치 PASS. 최종 웹 빌드 PASS.
- 회귀 18파일 222/222 PASS(신규·건강 34개 포함), 별도 strict TypeScript 검사 PASS. 최종 공개 요청 헤더 변경 후 관련 34/34 재실행 PASS.
- 최종 전문 검수에서도 관련 34/34 및 확장 strict TypeScript PASS. 요청 헤더 식별/공식 출처, 인증·쿠키 미전송, 고정 HTTP/네트워크 오류코드 및 원문 비노출 추가 합성 2사례 PASS. 전체 222개를 이 최종 단계에서 다시 실행한 것은 아님.
- 실제 최종 확인창: 기준 2024-06-15/현재 2026-05-01/직전 2026-04-30, 건축·7등급에서 자동 33항목 성공. 첫 패스에서 음수 오류·적용 차단, 기존값 유지·취소 보존 확인. 최종 패스에서 실제 키보드 Ctrl+A 교체로 노임 123,456 입력, 사용자 선택 근거 기록, 적용→입력 취소→재실행 정상 확인.
- 별도 합성 `CF136 자동자료 연동 검수`만 저장 1회(v1). 목록에서 재열기 후 값·날짜·근거 42항목이 저장 전과 모두 일치. 검수 레코드 ID `1761cba0-6f69-481f-9ee5-5d037d3187f6`은 확인용으로 유지. 기존 사용자 산출서 v6/CF124 v1 및 원본 미저장 탭은 변경하지 않음. 브라우저 fill 도구가 기존 숫자 뒤에 붙인 경우는 실제 키보드 교체로 재검증했으며 일반 입력 오류로 확정하지 않음.
- 실제 화면 증거: 로컬 `output/cf136-pass1-results.json`, `output/cf136-pass2-results.json`, `output/cf136-pass2-auto33.png`, `output/cf136-pass2-applied-manual.png`, `output/cf136-pass2-reopened.png`. 고객 원본이 아닌 합성 검수이며 화면 증거는 Git에 넣지 않음.

## 적용 한계

재현 명령(저장소 루트):

```powershell
node node_modules/tsx/dist/cli.mjs --test scripts/cf123-es-calculation-test.ts scripts/cf123-es-storage-test.ts scripts/cf123-es-output-test.ts scripts/cf124-es-input-layout-test.ts scripts/cf125-es-import-dialog-test.ts scripts/cf127-es-health-test.ts scripts/cf127-es-money-test.ts scripts/cf128-es-print-test.ts scripts/cf129-es-source-sync-test.ts scripts/cf129-es-print-test.ts scripts/cf130-es-workbench-test.ts scripts/cf131-es-delete-test.ts scripts/cf132-es-ecos-test.ts scripts/cf132-ecos-settings-test.ts scripts/cf132-node-ecos-test.ts scripts/cf134-settings-layout-test.ts scripts/cf135-ecos-diagnostics-test.ts scripts/cf136-es-public-test.ts
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module CommonJS --moduleResolution Node --esModuleInterop --skipLibCheck --strict apps/cloudflare/src/asset-modules.d.ts apps/cloudflare/src/es-public-sources.ts apps/cloudflare/src/es-health-source.ts packages/document-engine/src/es-source-candidates.ts scripts/cf127-es-health-test.ts scripts/cf132-es-ecos-test.ts scripts/cf132-ecos-settings-test.ts scripts/cf132-node-ecos-test.ts scripts/cf135-ecos-diagnostics-test.ts scripts/cf136-es-public-test.ts
corepack.cmd pnpm cf:build
node scripts/cf114-live-smoke.mjs development
```

### 남은 범위

- PPS는 공사 원가계산 공표 요율 후보. 입찰공고/기초금액 발표일 조건과 ES 계약 적용을 혼동하지 말고 검토해야 한다. 건강/연금/요양 30일, 퇴직 추정금액1억 등 공표 조건 표시. 임의로 계약금액을 모든 적용 대상액으로 간주하지 않는다.
- 산업안전보건관리비 조건표 자동 결정, 기계경비·표준시장단가 공통품목 기간쌍 자동 수집은 남음. 기존 Excel·수동값 사용 가능.
- 계산식과 17시트 출력 템플릿은 변경하지 않았다. 새 요율을 적용하면 계산값이 바뀌는 것은 정상이며, 외부 제출 승인/계약상 최종 적용률 확정은 아님.
- 이번 실제 브라우저 검수는 자료조회·입력·저장 범위이다. 계산/출력 관련 자동 회귀는 통과했지만 새 자료로 전체 계산·17시트 출력 파일을 생성해 원본과 다시 대조하지는 않았다.
- Node 서버는 코드·합성 경로 검사만 수행, 배포하지 않음. 운영 서버 배포·DB migration·암호화 키 변경 없음.

## 다음 시작점

1. 사용자는 기존 입력을 저장한 뒤 development 새로고침 → 공종·등급·기준일 확인 → ES 요율정보 가져오기 → 값·출처·조건 검토 → 입력에 적용 → 저장·계산 순서로 사용한다.
2. 산업안전 조건표·기계경비·표준시장단가 기간쌍은 위 미구현 범위를 확인하고 별도 검증 후 연결한다. 원본 계산식이나 대상액을 추정해 대체하지 않는다.
3. 새 공식 공표본 연결 시 `es-public-sources.ts` catalog/검증 종료일 갱신과 원문 6개 요율·노임 범주·날짜 경계 회귀 실행.

롤백: 작업 전 `3fe8882` 소스로 development 재배포 가능. DB 복구 불필요. 건강 연결 오류도 되돌아갈 수 있으므로 적용 범위를 검토한다.

## CF142 · 2026-09-10 과거 퇴직공제와 출처 링크 보완

### 원인 및 변경

- 시작 `feat/CF123-es-v2`, `360f227`. 제품 커밋 `02eb217`.
- 2020-12-15 기준 퇴직공제 누락은 PPS catalog가 2023-01-02부터 시작해 과거 공표본을 요청하지 않은 문제. ‘공표 이력 미연결’은 출처에서 값이 없다는 뜻이 아니다.
- 검증 범위 **2020-09-08~2020-12-31**에 퇴직공제만 연결했다. 12월 31일은 법적 효력 종료일이 아닌 이번 자동조회 확인 범위다. 2021~2022 및 그 이전 미검증 시점은 임의로 연장하지 않는다.
- 공식 게시글: https://www.pps.go.kr/kor/bbs/view.do?bbsSn=0001213031&key=00038 (게시2020-09-11, 적용2020-09-08 입찰공고).
- 공식 토목 Excel: https://www.pps.go.kr/common/fileDown.do?key=200001213031&sn=1 . 적용시기 B2·제목 AL2·퇴직공제 B103·직접노무비×2.3 B107. 기존 원문 파서를 재사용하여 매 요청 재조회한다.
- 공식 건축 HWP: https://www.pps.go.kr/common/fileDown.do?key=200001213031&sn=2 . 29,184bytes; SHA256 `cb56eb19fe31bfecd515ee77f93a8ce0b9fe10b25015a57b20e5fba8fd082f90`.
- 건축 HWP 구조 조사: 동일 0-based 8열에서 0행 ‘퇴직공제/부 금 비’, 1행 ‘(직노)/×율’, 4행 ‘2.3’. 주석 ‘퇴직공제부금비 : 추정금액 1억원 이상 건설공사(국토교통부 고시 제2015-610호)’. 공식 고시 https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000027570 에도 직접노무비×2.30%를 확인했다.
- 건축은 위 HWP의 정확한 SHA256 일치와 토목 Excel의 동일 퇴직공제 2.3 추출 성공을 모두 요구한다. 원문 변경/분모·값 불일치/다운로드 실패 시 후보 없이 기존값 유지. 다른 토목 요율을 건축에 적용하지 않는다. 신규 HWP 파서나 의존성 없음.
- 출처 URL을 ‘출처·조건’ 접기 밖에서 바로 누를 수 있도록 표시. 공공 요율·ECOS·법령·기계경비/표준시장단가 기간쌍 및 저장 근거의 공식 URL에 적용. 없는 원문 URL을 추측하지 않는다. 미매칭 이력에는 조달청 공표 목록, 선택 공표본 조회 실패에는 해당 게시글을 제공한다.
- HTTPS 공식기관 자체 호스트만 허용, 사용자정보/다른 포트/키 쿼리/ECOS 인증키 포함 API 경로는 링크 제외. 새 탭 `noopener noreferrer`, 키보드 포커스 표시. `constructor`/`__proto__` 상속 속성 우회는 `Object.hasOwn`으로 차단.
- Ponytail 최소 변경과 Impeccable의 읽기 쉬운 출처·상태 구분을 적용했다. 계산식/계약 적용 판단/입력 적용·저장 동작은 변경하지 않았다.

### 검증과 배포

- ES 회귀 306/306 PASS, 추가 설정·진단·실제 React 흐름 25/25 PASS(React 5개는 앞 집합과 중복). 실패/skip0. 최종 React 테스트는 합성 공식페이지로 실제 링크 클릭→새 탭 URL 일치→닫기→취소·미저장 보존까지 실행했다.
- 신규 역사 경계·중복 다운로드·직접노무비 분모·건축 지문 불일치·타 공종/다른 요율 제외·링크 안전 테스트 통과. 별도 전문 QA 19/19 및 빈값/명시0/수동값/원본 보존 3사례 통과.
- 웹 TypeScript, 공개자료 모듈 strict TypeScript, `pnpm cf:build` PASS. 기존 큰 번들 경고는 유지.
- 루트 실공식 조회: `fetchEsPublicSources(['2020-12-15'], '건축', '7')`가 retirement2.3, effectiveDate2020-09-08 반환. 합성 SHA 실패 검사와 별개로 실제 건축 HWP SHA 일치 성공을 확인했다.
- 개발 Worker `30314703-c789-4c83-bf27-9b51b480c55c`. root asset `index-DaiEl8bj.js`, CSS `index-CQH-WD6I.css`.
- `node scripts/cf114-live-smoke.mjs development` PASS: health/readiness 정상, Drive 연결 유지, 익명401, 5개 로컬/원격 자산 SHA 일치.
- 실제 배포 브라우저 검수 PASS: 최신 자산 확인, 사용자 산출서 v10 별도 탭에서 조회1회. 자동후보 28→29개, 기준2020-12-15 퇴직공제2.3. 설명 접힘 상태에서 조달청 원문·첨부자료 2개 링크가 보임. 원문 링크 실제 클릭→새 탭 공식 게시글 도달, 제목 ‘2020년 조달청 시설공사 원가계산 간접공사비 적용기준 내용 일부 변경’·적용시기2020.9.8·건축 HWP 첨부 확인, 차단 없음. 취소 후 저장됨v10·입력취소 비활성·원래 기준퇴직공제 빈값 유지. 검수 탭2개 닫음. 사용자 원래 미저장 탭 미조작, 입력/적용/저장0회.
- Node 코드는 공용 provider 재사용하지만 해당 서버 배포는 하지 않았다. 운영 서버·DB·migration·인증키 변경 없음. 새 후보로 전체 계산·17개 출력물을 재생성하지 않았으며 기존 출력은 자동 회귀로 확인했다.

다음 시작점: 미저장 작업을 먼저 보존한 뒤 개발 화면 새로고침 → ES 요율정보 가져오기 → 기준 퇴직공제2.3 및 원문·조건 확인 → 사용자가 직접 적용·저장·계산. 다른 역사기간은 당시 공표 원문을 별도 확인한 뒤 범위를 확장한다.

CF142 롤백: 직전 `360f227` 소스로 development 재배포. DB 복구 불필요. 과거 퇴직공제와 새 출처 링크만 이전 상태로 돌아간다.
