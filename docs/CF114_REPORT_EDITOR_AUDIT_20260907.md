# CF114 보고서 편집·출력 전수 흐름 점검 / 2026-09-07

## 최신 인수인계: 2026-09-14 Word 실제 출력 재검수

- 사용자 인증창 해소 후 합성 DOCX를 Word2010에서 실제 열어4쪽/PDF 변환/전 페이지 대조했다. 줄간격 단위, 블록사진 상하18px 여백 누락, Word 제목 탐색, 목차 첫행20px 간격을 수정했다. 최종 실제 Word 비교본은 `output/cf146/cf148-word-visual-v3.pdf` 및 `word-v3-1.png`~`word-v3-4.png`다.
- 합성4쪽의 내용·사진6개·캡션·병합표·갑지·목차·하단쪽번호와 큰 배치차이 해결을 확인했다. 실제 모든 템플릿/HWP 편집성/업무왕복 전체PASS가 아니다. CF146 최종9검사, 웹타입/빌드 통과. main `index-CSLlpQuB.js`, rhwp27파일 승인SHA 재staging 완료.
- CF148 미커밋/미배포, development CF147 유지. 고객원본/Chrome 미저장제안서/DB/승인 변경 없음. 32번 현장조사 양식은 보류 유지. 상세 최신 판정과 다음 시작은 `CF148_END_TO_END_SELF_AUDIT_20260914.md`의 마지막 절을 따른다. 아래 배포/검수 결과는 각 시점의 이력이다.

## 최신 인수인계: 2026-09-14 Word 실제 출력 재검수

- 사용자 인증창 해소 후 합성 DOCX를 Word2010에서 실제 열어4쪽/PDF 변환/전 페이지 대조했다. 줄간격 단위, 블록사진 상하18px 여백 누락, Word 제목 탐색, 목차 첫행20px 간격을 수정했다. 최종 실제 Word 비교본은 `output/cf146/cf148-word-visual-v3.pdf` 및 `word-v3-1.png`~`word-v3-4.png`다.
- 합성4쪽의 내용·사진6개·캡션·병합표·갑지·목차·하단쪽번호와 큰 배치차이 해결을 확인했다. 실제 모든 템플릿/HWP 편집성/업무왕복 전체PASS가 아니다. CF146 최종9검사, 웹타입/빌드 통과. main `index-CSLlpQuB.js`, rhwp27파일 승인SHA 재staging 완료.
- CF148 미커밋/미배포, development CF147 유지. 고객원본/Chrome 미저장제안서/DB/승인 변경 없음. 32번 현장조사 양식은 보류 유지. 상세 최신 판정과 다음 시작은 `CF148_END_TO_END_SELF_AUDIT_20260914.md`의 마지막 절을 따른다. 아래 배포/검수 결과는 각 시점의 이력이다.

## 배포 범위와 결과

- 기준 소스: `b57a6bf`에서 시작한 `fix/CF73-workflow-minutes-parity` 브랜치. 이 문서와 함께 커밋한 CF114 소스가 배포 대상이다.
- 가오픈 Worker: https://concost-claim-center-preview.jjwwhhjj1116.workers.dev
- 테스트 Worker: https://concost-claim-center-development.jjwwhhjj1116.workers.dev
- 두 서버에 동일한 웹 번들 및 Worker 소스를 적용했다. DB, OAuth redirect, 기존 암호화 키와 secret은 분리·보존했다. 데이터 복제/초기화는 하지 않았다.
- 가오픈 배포 버전: `8c8a60d2-fe59-4116-b6d7-bdb7b143fa6c`
- 테스트 배포 버전: `dbc2a7f8-8b6c-4c6e-9278-7bf3385bdcdf`
- 두 서버 `/health` 및 `/readiness` 200, Drive 연결 메타데이터 유지, 익명 확정 문서 API 401, 대기 migration 0 확인.
- `index-DSg9cklF.js` SHA-256: `c0afabea2773ca23b70b4202ff4edc4244c70b55c348b335acfac01bff175cdd`
- `index-C7245YNn.css` SHA-256: `523b397fa51306506a901f2a614719f6feab7d5d579f7313da9bfcb70dd3d3a2`
- 동적 JS 두 파일까지 로컬 빌드와 양 서버의 바이트 해시가 일치한다. `scripts/cf114-live-smoke.mjs`로 재검증할 수 있다.

## 확인한 오류와 수정

| 분야 | 원인 / 수정 |
| --- | --- |
| 승인 버전 | 단계·챕터 이동 메타데이터까지 새 본문 버전으로 저장하던 문제를 수정. 실제 제목·본문·서식 변경만 새 버전·이력을 생성하며, 오래된 expectedVersion은 그대로 409 거부 |
| 자동저장 반복 | 읽기전용 변경이 편집 변경 이벤트를 발생시켜 저장→dirty→저장을 반복. 문서 변경 transaction만 처리하고 setEditable 갱신 이벤트를 억제 |
| 협업 원고 | 일반 담당자 미저장 원고도 이동·창닫기 보호. 저장 실패 시 원고와 화면 유지, 재시도 성공 후 이동. PM 반영 시 저장된 원고·버전이 일치하는지 검사하고 원자적 갱신 |
| 서식 손실 | 수동 검수 전환·챕터 가져오기·협업 반영 때 전체 JSON을 버리던 경로 제거. 대상 챕터만 병합하고 다른 챕터, 표, 이미지, 머리글 보존 |
| AI 덮어쓰기 | 선택 원문이 바뀌면 대체 거부. 전체 개선은 요청 중 원고 변경 및 구조·서식 변경을 검사하고 안전하게 거부 |
| 편집 공간 | 전역 form-stack 최대 폭 때문에 검수 화면이 좁아짐. 보고서 검수 영역만 전체 폭 사용, 협업·판례·피드백 접기, 고정 단계 바의 편집기 가림 제거 |
| 편집 도구 | 본문/제목1~3, 글머리·번호 목록 추가. 밑줄·강조·정렬의 구조화 편집→문자열 변환 보존. 전체화면의 스크롤 및 Escape 개선 |
| 페이지 | 중첩·이어지는 번호 목록, 연속 강제 쪽 나눔의 빈 페이지 및 중첩 쪽 나눔 처리 보완 |
| 실제 출력 | DOCX 라이브러리가 가로 치수를 다시 뒤집던 문제 수정. html2canvas 복제 문서의 CSS reset으로 사라지는 목록 번호·들여쓰기를 원본 계산 스타일로 복원 |
| 확정본 | 납품센터에서 현재 초안이 아닌 확정 당시 revision의 JSON·본문을 조회해 공통 미리보기·출력 사용. 기존 보관 파일 다운로드는 그대로 유지 |
| Excel | 긴 본문을 셀 문자·줄바꿈 제한 이내 FIELD_CODE 조각으로 저장하고 손실 없이 결합. 조각 누락·중복은 명시적 오류 |
| DOCX 가져오기 | 줄바꿈·탭·표 병합·지원 서식 보존. 지원하지 않는 그림/개체/수식/주석 등은 조용히 삭제하지 않고 가져오기 실패 안내 |

## 업데이트 팝업

- 날짜: **2026년 9월 7일**. 범위: **8월 31일 가오픈 이후 누적 개선사항**.
- 저장·협업, AI 초안, 편집·A4, 출력·파일, 제안서, 일정·PM·업무 화면, 회의록 XLSX, Drive·명함 등 8개 항목.
- 계정·브라우저·릴리스별 한 번 표시하고 상단 업데이트 버튼으로 다시 열 수 있다.
- 관리자 연결/권한 필요 및 메일 준비 화면은 실제 발송 기능이 아니라는 기존 제한도 명시했다.

## 검증 결과

- 관련 23개 파일의 회귀 테스트 **86/86 통과**. 계약 검사뿐 아니라 실제 SQLite/D1 route 실행, XLSX 재읽기, React/Tiptap 브라우저 이벤트 검증 포함.
- 실제 편집기: 읽기전용 4회 왕복 변경 이벤트 0, 문자 입력 정상 이벤트, AI stale 원문 대체 거부/일치 원문 대체 성공.
- 실제 보고서 UI + synthetic API: 제목·본문·서식 편집당 한 번 저장, 추가 입력 없는 27초 동안 반복 저장 없음. 저장 503 시 담당자 원고 보존, 재시도 후 이동. 협업 대상 외 JSON 불변.
- 이미지 8방향 크기 조절, 표 행 편집, 실행 취소, 찾기/바꾸기, 제목·목록, 수동 검수 전환, 전체화면/모바일/Escape 확인.
- 실제 파일 출력: 한글·3/4번 상위 목록·9~12번 중첩 목록·병합 표·이미지를 포함한 3페이지 보고서. PDF 모든 페이지를 이미지로 렌더해 문장/쪽번호/잘림 확인.
- DOCX `16838×11906` twip landscape, PDF `841.89×595.28` pt, HWPX 가로 A4 3페이지. 세 형식의 각 페이지 JPEG 스트림이 동일. HWPX는 최종 HWP 변환 전 중간 포맷 검증이다.
- 장문 XLSX: 85,511자, 4,502개 줄바꿈 및 이모지 재읽기 일치. 구버전 단일 셀 호환 및 조각 오류 검증.
- 알림 팝업: 데스크톱 2열 / 모바일 1열, 가로 넘침 없음, 본문 내부 스크롤, 닫기/확인/Escape/재열기/포커스 복원 확인.
- 납품센터 실제 UI의 synthetic 확정 v7이 현재 초안 v1과 구분되어 표시됨. 로고 누락 시 출력 오류·버튼 복원, 고정 합성 로고 제공 후 DOCX 생성 성공까지 확인.
- 웹 typecheck+production build, Worker typecheck, 환경 계약 검사, diff whitespace 검사 통과. 기존 대형 JS chunk 경고는 남아 있다.

반복 실행:

```powershell
$cf114Tests = Get-ChildItem scripts -File | Where-Object { $_.Name -match '^cf(60|66|67|68|69|77|83|93|94|95|96|100|102|103|106|107|108|110|111|113|114).*-test\.ts$' } | ForEach-Object { $_.FullName }
node node_modules/tsx/dist/cli.mjs --test @cf114Tests
corepack pnpm cf:build
node node_modules/typescript/bin/tsc --noEmit --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM apps/cloudflare/src/asset-modules.d.ts apps/cloudflare/src/index.ts
node scripts/cf114-live-smoke.mjs development gaopen
```

출력 검수 재현은 `scripts/cf114-final-output-README.md` 참조. `apps/web/qa/cf114-studio.*`와 `cf114-output-export.*`는 로컬 synthetic QA 전용이며 production 빌드 진입점에 포함되지 않는다.

## 데이터 보존 / migration

새 파일: `apps/cloudflare/migrations/0059_cf114_report_workspace_version_guard.sql`

- 이미 적용된 migration은 수정하지 않았다. report workspace version trigger만 교체하며 테이블·행·열을 삭제하지 않는다.
- Node/Prisma의 Report/ReportSection 모델에는 Cloudflare 전용 `preview_report_drafts` 및 해당 trigger가 없다. 이 변경에 대응할 Node 스키마 변경이 없으므로 의미 없는 Node migration을 추가하지 않았다. 베트남 서버 포팅 시 API의 본문/메타데이터 버전 계약을 별도로 이식해야 한다.
- 각 서버 유지보수 503 확인 → D1 export → Ed25519 서명/외부 공개키 해시 pin 검증 → 격리 SQLite 복원 → integrity/FK 및 기존 모든 행 비교 → 실제 0059 적용/재실행 no-op → 원격 적용 → 적용 후 export와 전후 비교 → 서비스 재개 순서.
- 기존 업무 데이터와 Google/AI 설정 등은 테스트 **115개**, 가오픈 **114개** 전체 테이블에서 동일하게 유지됨. 두 DB의 원래 테이블 수 차이는 동기화하지 않았다.
- backup SQL은 비공개 운영 데이터이므로 Git/배포/소스 전달물에서 제외. 로컬 `artifacts/backups/cf114-*-20260907.*`에 보관.

| 검증 항목 | 테스트 | 가오픈 |
| --- | --- | --- |
| 적용 전 SQL SHA256 | 1e9ebeefcc1225978e8411dfb333bf6a5e2874783f1881aa7a3aeabc9f7521bd | c52e0dae6afd172ed331799f3155d812177f211b2f1e70265b6e29de30a99752 |
| 적용 후 SQL SHA256 | 3a964e3dde58a21ee27a67d45298decd378a60de5af4fa8a5190e4cf421b58db | ef94f9ddaac5ed7b62b384e27a0962468f13d1a3a1ce75d5efc589ff6122974c |
| 서명 공개키 SHA256 pin | cc55f884669ed11a64857e6a327f246ff8eecd959b03ad35fb95003450282320 | c80d745d4ade83c0b74204ce9ee21e3861590a50d25fcfc0721886691a0843d7 |
| 직전 Worker 버전 | 5a698dbf-c50b-4d9a-9363-04ffe63a9ed1 | ca006acc-e1c4-45ee-9f36-b4fc1cdad31e |

0059 SHA256: `8b8cfcb6897afc2e93915d95309436912710e6c95229814fbdc097347f85da5b`

복원/재검증 명령은 `scripts/cf114-backup-check.mjs`의 sign/verify/preflight/compare 사용. 원격 적용 명령은 `wrangler d1 migrations apply <정확한 DB명> --remote --config <해당 config>`이며 Node 업무 DB에 D1 SQL을 실행하지 않는다.

롤백 필요 시 새 쓰기를 막고 당시/현재 백업과 secret을 보존한 후 검증된 직전 Worker와 해당 DB 백업으로 복구한다. 운영 중 생긴 신규 데이터를 버리는 DB 복원을 임의로 실행하지 않는다. reverse SQL/DB reset/샘플 DB 덮어쓰기는 금지.

`--keep-vars`로 기존 환경값과 secret을 보존했다. 가오픈에만 존재하던 GEMINI_API_KEY는 기존 환경 차이이므로 삭제하거나 테스트 서버로 복제하지 않았다. strict secret-name parity는 이 차이를 포함하므로 일치했다고 주장하지 않는다.

## 검수 한계 / 별도 확인 항목

- 업무 계정의 로그인된 세션이 없어 실제 운영 레코드 저장·AI 제공자 호출·Drive 파일 전송은 이번에 실행하지 않았다. 로컬에서는 실제 UI/API 함수와 합성 데이터를 사용했고 라이브에서는 공개 응답, 인증 차단, 연결 상태, 배포 해시를 확인했다.
- native Microsoft Word·한컴 앱에서 최종 재열기와 HWP binary 변환은 미검증. 출력 DOCX/PDF는 기존 설계대로 페이지 이미지형이며 편집 가능한 원문/검색 가능한 PDF라고 주장하지 않는다.
- 나눌 수 없는 초대형 병합 셀/이미지 등은 자동 분할 대신 넘침 오류로 차단한다. 미지원 DOCX 기능은 원고 손실 대신 가져오기를 거부한다.
- 별도 회사 도메인 `https://claimcenterstudio.con-cost.co.kr`은 베트남 Node 서버 전달 문서의 도메인이다. 이번 두 Worker와 다른 이전 JS/CSS를 제공하며 2026-09-07 확인 시 `/api/health`, `/api/readiness`가 502였다. 이 서버의 파일·DB·DNS·인증 설정은 변경하지 않았다. 별도 서버 접근 및 운영 담당자 확인이 필요하다.
- 발견한 문제와 명시한 회귀 범위는 해결했으나 모든 입력·브라우저·외부 서비스에서 오류가 전혀 없다는 보증은 아니다.

## CF146 후속 작업 / 2026-09-11 — 로컬 후보, HWP 원본 동일성 FAIL

### 현재 상태와 보존 범위

- 작업 저장소 `work/p16-codex-review`, 브랜치 `feat/CF123-es-v2`, 시작 HEAD `41e82d7`. 아래 변경은 미커밋 로컬 후보이며 배포하지 않았다. 앞 절의 CF114 배포 정보는 과거 기록이다.
- 실제 원본은 기존 E: 보고서 스튜디오의 `docs/보고서 템플릿`에서 확인했다. 32개 파일(HWP 13, HWPX 3, PDF 15, XLSX 1)이다. Git 추적 파일 검색에서 빠졌을 뿐 원본이 없는 것이 아니므로 사용자에게 재첨부를 요구하지 않는다.
- 원본은 읽기 전용으로 검사했으며 검사 전후 해시가 같다. 고객 원문, SVG/JPEG 렌더, 다운로드 파일은 Git/배포에 포함하지 않는다. DB, 키, OAuth, Node 서버, 유료 AI, 업무 레코드는 변경하지 않았다.

### 구현한 범위

- 보고서 화면의 유형을 업무 명칭으로 표시하고 A4 세로 갑지→실제 쪽번호 목차→본문으로 구성했다. 자동 CH 머리글·회사 바닥글을 보고서에서 제거하고 본문 하단 쪽번호를 적용했다. 갑지 사용 여부·작성일·작성자를 저장/복구/협업 반영에서 보존한다.
- 사진·근거자료 삽입창: 프로젝트 자료 선택, 다중 업로드, 쟁점 제목, 사진 1/2열, 설명과 원문 위치를 지원한다. 사진은 표에 넣고 비이미지 자료는 원본 링크와 위치를 넣는다. XLSX 셀이나 PDF 페이지의 자동 표 추출까지 구현한 것은 아니다.
- 신규 AI 결과의 바깥 Markdown 코드펜스를 정규화하고 내부 JSON/메타데이터/챕터 제어문을 차단한다. 기존 원고의 코드블록 복구는 담당자가 명시적으로 실행한다. API 호출 성공만으로 원문 근거를 읽었거나 사실 검증이 끝난 것으로 보지 않는다.
- 저장 자료의 HWP/HWPX에 `저장 원본을 HWP에서 열기`를 추가했다. 다시 업로드하지 않고 기존 인증 다운로드 경로를 사용한다.
- 보고서 HWP 반영은 텍스트만 추출하던 방식 대신 전체 페이지 이미지 방식으로 변경했다. 미저장 기존 원고 백업 성공 후에만 진행하고, 변환 도중 원고/프로젝트가 바뀌면 덮어쓰지 않는다. 중복 갑지/목차/쪽번호·빈 페이지를 방지한다. 페이지 이미지는 문장·표를 개별 편집하는 원문 구조가 아니다.

### 검증한 것

- 전문 검수의 관련 16개 테스트 파일 64/64 통과. 신규 AI 정규화, 편집기 저장 보호, 협업 갑지 메타데이터 보존, 사진 표의 실제 Markdown→JSON→HTML 왕복, 원본 페이지 표시를 포함한다.
- `corepack pnpm cf:build`의 웹 타입 검사 및 빌드 통과. `git diff --check` 통과.
- `CF146_EXPORT_QA=1`로 실제 다운로드 함수 실행: 합성 보고서 PDF/DOCX 각각 4쪽, HWPX 중간 파일 생성. PDF는 4쪽 모두 A4 세로(595.28×841.89 pt)이며 Poppler로 모든 페이지를 렌더하여 갑지·목차·병합 표·6장 사진대지·하단 쪽번호를 시각 확인했다.
- 실제 HWP/HWPX 16개를 현재 설치 SDK로 모두 열었다. 05 유형의 102쪽 HWP에서 29쪽은 사용자 스크린샷의 첨부사진 9~14, 하단 -16-와 대응한다. 전체 문서의 동일성 통과를 뜻하지 않는다.
- `scripts/cf146-report-contract-test.ts`, `scripts/cf146-report-browser-test.ts`가 회귀 진입점이다. 원본 검사는 `CF146_SOURCE_ROOT`를 해당 PC 원본 폴더로 설정하고 `scripts/cf146-hwp-reference-check.ts`를 실행한다. `CF146_CATEGORIES=07,09`, `CF146_ALL_PAGES=1`로 문제 문서 전체 쪽 검사를 재현한다. 소스에는 PC 원본 절대 경로를 하드코딩하지 않는다.

### 원본 동일성 실패와 미검증 — 배포 게이트 미통과

- 동명 PDF 대비 쪽수가 다른 원본 3개: 06 유형 HWPX 44쪽/PDF 45쪽, 07 유형 HWP 28쪽/PDF 29쪽, 09 유형 HWP 40쪽/PDF 39쪽.
- 07: 원문 PDF 12쪽 내용 일부가 웹 11쪽으로 당겨지고, 마지막 PDF 29쪽의 독립 `Ⅱ. 감정내역서`가 웹 28쪽 표 아래에 합쳐진다. 전체 13,206자와 그림 10개는 대응하므로 쪽 나눔/배치 문제로 확인했다.
- 09: PDF 12쪽 마지막 표 제목이 웹에서 표와 겹치고 설명 한 줄이 다음 쪽으로 밀려 불필요한 13쪽이 생성된다. 이후 +1쪽 밀림, 일부 앞쪽 하단 쪽번호 누락도 확인했다. 그림 54개는 대응하지만 배치 동일성은 FAIL이다.
- 증거는 비공개 `tmp/cf146-reference`의 원본 PDF 렌더와 SDK SVG/JPEG다. `results.json`은 마지막 실행의 결과로 덮어써지므로 현재는 07/09 전체 검사 결과이며 전체 16개 목록으로 오인하지 않는다.
- 현 공개 Rhwp 엔진의 배치 결과를 이미지화해도 기존 배치 오류가 그대로 남는다. 원문별 하드코딩 보정이나 동일 쪽수만으로 통과 처리하지 않는다. 06 불일치 상세 원인과 전체 16개 모든 페이지 시각 대조는 미완료다.
- Worker 단독 타입 검사에는 기존 ES `EsPairSourceResult`→JSON 타입 오류가 남아 있다(`apps/cloudflare/src/index.ts`, `/api/es/sources/pairs`). 이번 보고서 변경으로 도입한 오류로 확인한 것은 아니다.
- 로그인된 보고서 세션이 없어 실제 계정 저장/재진입·Drive 업로드·유료 AI 호출은 미검증. DOCX는 XML/이미지 매체를 검사했지만 번들 LibreOffice가 없어 네이티브 렌더는 못 했다. HWP 바이너리 최종 변환 및 한컴 재열기도 미검증.
- 출력 PDF/DOCX/HWPX는 페이지 이미지형이다. 편집 가능한 원문 또는 검색 가능한 PDF라고 안내하지 않는다. PC에서 큰 HWP를 일반 자료 API로 재업로드하는 10MB 제한은 별도이며 저장 원본 열기와 혼동하지 않는다.

### 다음 시작 지점

1. 저장된 원본과 대응 PDF를 계속 사용한다. 우선 06 불일치 확인 및 Rhwp의 표/문단/쪽 나눔 처리 수정 가능성을 검토한다. 외부 호스팅 엔진 변경·사내 한컴 변환기 신규 도입은 서버/라이선스/배포 범위를 확인한 뒤 결정한다.
2. 사진 삽입창의 실제 계정 업로드→저장→재진입 및 원본 이미지 페이지 반영 전체 경로를 검증한다. 원문을 추출하지 않은 자료를 AI가 읽은 것처럼 작성하지 않는지도 실제 응답으로 확인한다.
3. 원본 동일성 실패를 해결하고 회귀·빌드·실제 사용자 경로를 통과한 후에만 명시적 변경 파일을 커밋하고 승인된 개발 서버에 배포한다. 현재 후보를 완료/배포됨으로 보고하지 않는다.

### CF146 계속 수정 / 2026-09-11 후속 검증

- 저장 템플릿에서 `PDF 원본 페이지 가져오기`를 별도로 선택할 수 있게 했다. 기존 설치된 `unpdf 1.8.1`을 웹의 직접 의존성으로 명시하고 지연 로딩한다. 선택한 PDF를 브라우저에서 페이지 단위로 렌더하며 HWP로 재변환하지 않는다. 다른 이름의 파일을 자동 짝짓거나 HWP 동일성 통과로 간주하지 않는다.
- PDF 전체 용지를 먼저 검사한 뒤 전체 교체 확인을 받고 기존 미저장 원고 저장 성공 후 진행한다. 가져오기 중 원고/프로젝트가 바뀌면 중단하며 전 페이지 성공 전에는 본문을 교체하지 않는다. 이미 업로드한 페이지를 오류 시 자동 삭제하지 않는다.
- 실물 PDF 07/09의 전체 68쪽을 직접 렌더했다: 29→29, 39→39, 오류/경고 0, 원본 해시 불변. 07 마지막 독립 제목 및 09의 표·설명 문제쪽을 시각 대조했다. 비공개 결과 `tmp/cf146-pdf-direct/results.json`; 재현 `CF146_SOURCE_ROOT` 설정 후 `node --import tsx scripts/cf146-pdf-reference-test.ts`. 모든 쪽을 개별 시각 검수한 것 또는 실제 계정 저장/최종 재출력 검증이라고 확장하지 않는다.
- `완제품 템플릿 열람`이 웹 구조 예시 부재 때문에 비활성화되던 조건을 수정했다. 실제 원본 카테고리가 있으면 단계 이동/저장 없이 열람 가능하다.
- 실제 삽입창→자료 선택→Tiptap 커서 위치 삽입→JSON 재마운트→읽기전용 거부 회귀를 추가했다(`cf146-evidence-editor-test.ts`). 사진 3장, 문서 링크/쪽·셀 위치, 기존 앞뒤 문단 순서를 확인했다. 서버 저장을 흉내 낸 것 또는 실제 Drive 업로드 시험은 아니다.
- 추가로 실제 이미지 노드가 높이 지정 시 무조건 `object-fit:fill`을 주어 사진을 늘리던 원인을 발견했다. 새 사진대지의 `reportPhoto` 속성을 JSON/Markdown/HTML에 보존하고 해당 사진만 `contain`을 사용한다. 기존 일반 이미지/제안서의 수동 비율 편집은 변경하지 않는다. 계산 스타일 검사는 수정 전 fill로 실패, 수정 후 contain으로 통과했다.
- 사진 비율 수정까지 포함하여 관련 17파일 65검사를 최종 재실행했고 모두 통과했다(실패/건너뜀 0). 웹 타입 검사와 프로덕션 빌드 및 `git diff --check`도 통과했다. 최종 로컬 웹 번들은 `index-ChsX3mWj.js`이며 배포 산출물로 전송하지 않았다. 번들 크기 경고는 남아 있다. 기존 단독 Worker ES 타입 오류는 HEAD 소스를 compiler host에 가상 주입하여도 재현됨을 전문 검수가 확인했다.
- 앞의 로그인 제한 기록은 후속 상태로 갱신한다: 이번 Chrome 읽기 검수에서는 로그인된 실제 보고서 4단계 접근이 가능했다. 다만 현재 페이지가 받은 원본 라이브러리는 REF-01~09가 모두 0/기대수로 표시되어, 로컬 원본 보유와 서버 등록 상태를 같다고 가정할 수 없다. 단계 변경은 자동저장을 유발하므로 실행하지 않았고 업무 원고·Drive 원본 등록도 변경하지 않았다.
- 06 HWPX45→44쪽 불일치도 추가 확정했다. PDF11/12 합침과 쪽번호만 있는 웹12쪽, PDF34~36 재배치가 있다. 상세 비공개 증거 `tmp/cf146-reference-06/QA.md`. 원본 본문 문자와 HWPX 그림 개수는 대응하나 배치 동일성은 FAIL이다.
- HWP 근본 수정 후보는 upstream #6943 고정 커밋 `c3bc96a6cc5aa852228ce157c2aa5104014a539e`의 통합 교정이다. SDK0.8.4는 iframe 래퍼이며 현재 공개 Studio0.8.6의 WASM은 이 교정 이전이다. SDK 번호만 올리거나 CanvasKit로 바꾸거나 LineSeg를 삭제하는 방법은 해결책이 아니다. 포함된 미리빌드 npm/Release/Actions 산출물도 찾지 못했다.
- 공개 소스를 `tmp/cf146-rhwp-engine`에 no-checkout으로 복제하고 해당 고정 커밋을 fetch하여 빌드 지침을 확인했다. 새 복제본만 Git OpenSSL 백엔드를 사용했고 시스템 Git/SSL 검증 설정은 변경하지 않았다. 아직 체크아웃/엔진 빌드/Studio 교체를 하지 않았다.
- 현재 PC에는 Rust/Cargo/wasm-pack 및 MSVC 빌드 도구가 확인되지 않는다. Docker Desktop은 설치되어 있으나 서비스가 중지돼 API에 연결되지 않는다. 빌드 환경을 임의 시작/설치하지 않고 Docker Desktop 실행·빌드 도구 다운로드 승인을 요청했다. 기존 컨테이너/업무 데이터/운영 배포를 변경하는 승인은 포함하지 않는다.
- 다음 실행: Docker 실행 승인 후 고정 커밋의 격리 WASM/Studio 빌드→06/07/09 및 나머지 원본 대조. PDF 직접 경로 통과를 근거로 HWP 경로를 완료 처리하지 않는다. 현재 배포 게이트는 계속 미통과다.
- 후속 Docker 승인 수신: 2026-09-11 사용자 승인으로 Docker Desktop 실행을 시도했다. 실제 사용자 환경에서도 Desktop 4.79.0 backend가 `initializing Inference manager` 중 기존 `run/dockerInference` 항목 접근 오류로 종료했다. 해당 항목은 2026-06-24 생성/07-27 수정된 ReparsePoint이며 이번 작업 생성 파일이 아니다. 정확한 항목 하나의 백업 이름 변경도 Windows가 `시스템에서 파일에 액세스할 수 없습니다`로 거부했다. 삭제·공장 초기화·WSL 초기화·설정/볼륨 변경은 하지 않았다. 엔진 API가 열리지 않아 빌드 도구 다운로드와 WASM 빌드는 아직 시작하지 못했다. Docker 자체의 파일 접근 문제 복구가 필요하며, 실행 승인 미수신 상태로 재안내하지 않는다.
- 추가 복구 성공: 사용자의 복구·빌드 계속 요청 후, Docker가 종료된 상태에서 일반 디렉터리인 런타임 폴더를 검증하고 이름을 변경해 보존했다. `Docker/run.cf146-backup`(기존 소켓 3개), `docker-secrets-engine.cf146-backup`(engine.sock만), `Docker/run.cf146-retry-backup`(실패 재시작 중 생성된 소켓 1개)이 남아 있다. Docker 전용 실패 프로세스와 docker-desktop WSL만 종료 후 양쪽 소켓 경로를 함께 재생성했으며, Engine 29.5.3 / Compose 5.1.4 응답을 확인했다. 기존 컨테이너 5개는 모두 종료 상태로 유지됐고 설정·볼륨·업무 파일 삭제는 없었다. 공개 동일 증상 참고: https://github.com/docker/desktop-feedback/issues/448 .
- 후보는 `tmp/cf146-rhwp-engine`에서 `c3bc96a6cc5aa852228ce157c2aa5104014a539e` detached checkout, LF 보존 설정 및 빌드 관련 sparse checkout으로 준비했다. 중단한 최초 전체 checkout의 고아 index.lock만 실행 중 Git 프로세스 부재 확인 후 제거했다. `cf146-rhwp-c3bc96a` 전용 Compose 프로젝트/볼륨으로 빌드 중이며 기존 Docker 프로젝트와 분리했다. 기반 Rust 이미지 digest는 `sha256:bf5a9aa29062a6cb03c49bd59a46eb55e3cc770caf598a221a7866e500be3082`, wasm-pack 0.15.0, 프로젝트 toolchain 1.93.1이다. 최초 Cargo metadata의 sparse 누락을 workspace 선언에 맞춰 보완한 뒤 실제 WASM 컴파일에 진입했다.
- 검사기에는 `CF146_STUDIO_URL`(localhost HTTP만), `CF146_RUN_NAME`(tmp 아래 단순 폴더명)을 추가했다. 후보/공개 엔진 출력 분리, 빈 대상 거부, 모든 네트워크 쓰기 거부를 유지한다. 외부 후보 URL 거부는 실제 실행으로 확인했다. 후보 검사 명령: `CF146_CATEGORIES=06,07,09`, `CF146_ALL_PAGES=1`, `CF146_STUDIO_URL=http://127.0.0.1:7700/`, `CF146_RUN_NAME=cf146-reference-c3bc96a` 및 기존 원본 root를 설정하여 동일 검사기를 실행한다. 빌드 결과와 실물 동일성은 별도 기록한다.
- Docker 최종 빌드 PASS: 기본 빈 HWP 자산까지 sparse checkout에 추가한 뒤 공식 Compose WASM 빌드가 종료코드 0, `Done in 5m 46s`로 완료됐다. `pkg/rhwp_bg.wasm` SHA-256 `c57d4fac08266c74f6efc7c50d2a2f42fdb9b313db45fbada8bd57e562e70eed`, `pkg/rhwp.js` SHA-256 `ad01e939079e3518bc76c442bf395ab058a912991ccb54c8b0be7f5a9a760153`. Studio 타입 검사 및 `RHWP_WITHOUT_HWPCTRL=1` Vite 배포용 빌드도 통과했으며 후보 `dist/assets/index-DrJbit69.js`와 `rhwp_bg-mGG8J0O8.wasm`을 생성했다. 실제 배포는 하지 않았다.
- 후보 실물 검사는 개발 서버의 초기 누락 경로 캐시를 피하여 최종 빌드의 `vite preview --host 127.0.0.1 --port 7701 --strictPort` 및 `CF146_STUDIO_URL=http://127.0.0.1:7701/`로 수행했다. 06/07/09 유형에 속한 실제 8개 파일 전 페이지 렌더를 완료했다. 검사기에는 서비스워커 차단과 렌더 실패/원본 해시 변경 시 비정상 종료도 추가했다. 외부 URL·출력 경로 탈출 거부 2검사, 보고서 관련 회귀 8검사 및 diff 공백 검사가 통과했다.
- 배치 동일성은 여전히 FAIL이다. 고정 후보 c3bc96a에서도 오류동 HWPX 44쪽(원본 PDF45), 나래 HWP28쪽(PDF29), 두산 HWP40쪽(PDF39)이며 종전과 같다. root가 새 출력의 06-5 11/12쪽 합침·빈쪽, 07-6 28쪽 독립 제목 합침, 09-7 12쪽 하단 표 제목 겹침을 직접 확인했다. 결과는 비공개 `tmp/cf146-reference-c3bc96a/results.json`; 이미지가 남아도 이번 results.json에 포함된 페이지만 판정한다. 현재 Docker/빌드 차단은 해소됐으며 다음 대상은 변환 엔진의 쪽 나눔 로직이다. 새 엔진 업그레이드만으로 해결됐다고 안내하거나 배포하지 않는다. 다음에는 이 고정 빌드를 대조군으로 보존하고 후속 엔진 수정의 실제 효과를 비교한다.

### CF146 엔진 직접 수정 / 2026-09-11 — 쪽수·본문 경계 복구, 전체 동일성 승인 전

- 위 미수정 c3bc96a 결과는 대조군으로 보존했다(`tmp/cf146-engine-baseline-c3bc96a/pkg`, `dist`). 이번 수정은 그 커밋의 `float_placement.rs`, `layout.rs`, `typeset.rs` 세 파일에만 적용했다. 초기 HWPX LineSeg 재계산 가설은 실제 자료에서 효과가 없어 제거했으며, 진단용 로그·임시 native 테스트도 최종 소스에서 제거했다.
- 원인 1: 저장된 그림 높이 안에 이미 포함된 host 문단 높이를 조판과 렌더에서 다시 더했다. 단일 native HWP 그림, 원래 저장된 다음 문단 좌표 차이=그림 높이, 별도 캡션·여백·합성 줄 없음이 확인되는 경우만 중복 진행량을 제거했다. 임의 그림별 좌표나 템플릿 이름을 하드코딩하지 않았다.
- 원인 2: 작은 표 continuation 뒤 저장 페이지 리셋을 무시하는 기존 #5918 예외가 본문 자리차지 표에도 적용됐다. 정확한 para/control 인덱스의 non-TAC `InFrontOfText` 표에만 예외를 유지하고, `TopAndBottom` 표의 원본 페이지 경계를 보존했다. 기존 30% 한계·빈 필러·실제 본문 포함 검사는 유지한다. native 계측으로 실제 오류동 p111/p442 및 나래 마지막 경계가 이 예외에 걸리는 것을 확인했다.
- 원인 3: 그림 뒤 정상 빈 줄→하단 설명→다음 쪽 패턴을 #1733 공백 제거가 숨겼다. 앞 그림의 저장 높이 관계가 확정되고 바로 뒤 빈 줄과 한 줄 설명이 연속되며 본문 안에 들어가는 경우만 빈 줄을 보존했다. 두산 12·36쪽 설명의 누락된 1100HU(14.6667px)를 복구했다. 12쪽 마지막 설명 baseline은 992.08px, 36쪽은 981.293333px로 원본 저장 좌표와 일치한다.
- 최소 변경 원칙(ponytail)에 따라 공통 포맷 재계산이나 전면 엔진 교체 대신 위 세 원인의 조건만 변경했다. 재현용 `patches/cf146-rhwp-layout.patch`로 내보냈고 수정 clone의 reverse-check 및 고정 커밋의 깨끗한 해당 세 파일에 forward `git apply --check`를 모두 통과했다. 앞서 만든 사진 전용 중간 patch는 이 통합 patch로 대체했다. 실제 고객 원본/렌더는 patch에 포함하지 않는다.
- Docker 최종 WASM 빌드 PASS(6m02s). `pkg/rhwp_bg.wasm` SHA-256 `0bb234fb446ec4e7a230e12967f1c61e418de0d313df59fe6926e5fe5fcd741b`. Studio 타입 검사 및 `RHWP_WITHOUT_HWPCTRL=1` Vite 빌드 PASS. 산출물 `dist/assets/index-CZ31ymFh.js`, `rhwp_bg-CT7EJuE3.wasm`. 번들 크기 및 CanvasKit fs/path 외부화 경고는 남아 있다. 운영/개발 Worker에 전송하지 않았다.
- 실제 WASM 쪽수 검증 8/8 PASS: 06-0=22, 06-1=47, 06-2=11, 06-3=11, 06-4=38, **06-5=45(기존44), 07-6=29(기존28), 09-7=39(기존40)**. `scripts/cf146-engine-page-regression.mjs`는 외부 원본 root, 기존 manifest, 명시적 기대 쪽수를 받아 전 페이지 SVG와 해시 불변을 검사한다. 누락·중복 대상/잘못된 기대값은 실패한다. 결과 `tmp/cf146-engine-layout-node/regression.json`은 쪽수 게이트이지 서식 동일성 승인이 아니다.
- 최종 Studio를 localhost7701에서 실제 SDK로 읽어 8종 **242쪽 전 페이지 SVG→JPEG 변환 PASS**, 차단된 외부 요청 0, 원본 해시 불변. 증거 `tmp/cf146-reference-layout-fix/results.json`. root는 06의 11/12쪽 분리, 07의 마지막 29쪽 독립 갑지, 09의 12쪽 표·제목·설명 정합을 직접 시각 확인했다. `RENDERED_NOT_FIDELITY_APPROVED` 상태는 의도적으로 유지한다.
- 관련 기존 회귀도 실제 공개 원본으로 실행했다: #1733 HWP/HWPX 각각242쪽 및 fragment 소유(2 PASS), #5918 46쪽·29쪽 표578/612 공존(1 PASS), #683 세 그림 간격(1 PASS). 새 조건의 양방향 unit 2 PASS. 초기 suite 실행의 sparse fixture 누락은 공개 고정 커밋 자료를 보완한 후 재실행해 해결했다. 단순 missing-fixture skip을 통과로 세지 않았다. 보고서 실제 브라우저/근거자료 삽입/AI 내용 계약 8검사도 재실행 PASS(실패·skip0).
- 독립 대조: 06 본문21,700자·그림48개, 07 본문13,206자·그림10개와 전체 순서 보존. PDF의06 이미지51객체 중3개는 다른 RGB 이미지가 참조하는 ImageMask이므로 실제 본문 그림48개와 대응한다. 06의11/12·34~36, 07의28/29는 해당 PDF 본문 순서까지 일치하며 밀린 쪽/쪽번호만 남은 빈 쪽이 해소됐다. 두산 본문9,774자·그림54개도 보존됐다.
- 사진 높이 수정이 영향을 준 추가 3쪽(06-2 p5/p6,06-4 p26)은 기존22pt 세로 오차가 각각 -0.01/0.00/+0.01pt로 줄어 원본 PDF에 가까워졌고 새 겹침·잘림은 없었다. 사진 전용 후보에서 최종 후보로의 두산 변경은12·36쪽뿐이며 나머지37쪽 SVG는 byte 동일하다.
> **2026-09-11 재검수로 아래 기대값 철회:** 남은 동일성 문제: 두산 물리2·3쪽의 원래 `-2-`, `-3-`가 아직 누락된다. 1쪽은 원래 번호 없고4~39쪽은 원본 `-1-`~`-36-`와 일치한다. 오류동 일부 제목/표의 mm 단위 좌표·간격 차이도 별도로 대조 중이므로 쪽수와 본문 순서 복구를 완전한 서식 일치로 확대하지 않는다. 나머지8종 전체 브라우저 검사는 별도 `tmp/cf146-reference-layout-other`에서 진행하며 완료 결과를 후속 기록한다. 아래 후속 정정 기록을 우선한다.
- 다음 시작은 남은 번호·서식 차이 대조, 저장 템플릿 전체 검수, 실제 보고서 편집기의 후보 엔진 연결 및 계정 저장/재진입/출력 검증이다. 현재 앱은 여전히 기존 엔진을 사용하며 새 Studio를 배포하거나 API/DB/Drive/업무 원고를 변경하지 않았다. 로컬 엔진 개선과 실제 서비스 반영을 구분한다.
- 후속 전체 검사 완료: 나머지8종은32/25/9/17/41/364/102/23쪽, 합613쪽이며 수정 전 c3bc96a WASM과 **전 페이지 SVG byte 동일**하다. 최종 실제 브라우저 검사는 두 결과 폴더 합계 **16개·855쪽**, 실패0·외부 차단요청0·원본해시불변으로 완료됐다. 모든 쪽을 원본 PDF와 개별 시각 승인했다는 뜻은 아니다. root가05유형102쪽 감정서의29쪽 사진9~14·설명·하단-16-도 사용자 예시와 대조했다.
- 최종 빌드를 `tmp/cf146-engine-layout-verified/{pkg,dist}`에 별도 보존했다(WASM 해시 위와 동일). 통합 patch SHA-256 `57b552a1e334b6456090a972fd9b0609e5ca2009a23ca06353af7d540536744d`. 검사기의 기대 문서 누락 음성 시험은 결과 폴더 생성 전에 실패함을 확인했다. 새 PC에서는 고정 커밋에 patch를 적용한 뒤 기존 공식 Docker WASM/Studio 명령으로 재빌드하고, 해당 PC의 `CF146_SOURCE_ROOT`를 설정해 검사한다. 기존 고객 자료를 코드 패키지에 넣거나 PC 경로를 공통 코드에 박지 않는다.
> **2026-09-11 재검수로 아래 기대값 철회:** 잔여 두산 번호 원인도 분리했다: 실제 페이지 카운터는 `[1,2,3,1,2,…]`로 정상이고 첫 문단부터 pgnp 위치 설정이 활성화되며 표지만 pghd로 숨겨져 있다. `PageNumberAssigner::should_hide_page_number`가 첫 NewNumber 이전을 일괄 숨겨2·3쪽의 표시 위치를 비운다. 다음 수정은 `page_number.rs`, `TypesetEngine::finalize_pages`, `pagination/engine.rs`의 표시 조건만 대상으로 하며 카운터/구역/명시적 PageHide는 보존해야 한다. `should_hide_before_first_new_number`, `page_number_propagation.rs`, `page_controls_in_split_paragraph.rs` 회귀와 활성 위치 유무 양방향 검사가 필요하다. 이 번호 조건은 이번 빌드에서 아직 수정하지 않았다. 아래 후속 정정 기록을 우선한다.
- 오류동 좌표 잔차 정밀 대조: A4 높이 정규화 기준 p11 +3.03~3.21mm, p12 +3.83~4.09mm, p34 +2.97~3.24mm, p35 +3.20~4.60mm, p36 +3.85~4.09mm 세로 차이. 가로도 표 문단 약+3.06mm·본문 약+4.19mm. 동명 HWPX/PDF의 실제 저장 여백이 같은지도 확인해야 하므로 전역 평행이동으로 덮지 않는다. 07 마지막 갑지는 y−0.04mm/x+0.47mm. 페이지 경계 복구와 완전 서식 동일성을 계속 구분한다.
- 위 오류동 차이의 후속 원인 분리: **검사한 p111 제목·p112 첫 표는 원본 HWPX 저장 좌표와 최종 SVG가 정확히 일치**한다. 원본 left5669HU, top4252HU+header2835HU이고 제목 vpos0/baseline1530HU → x75.586667px/baseline114.893333px가 실제 SVG와 같다. 표도 저장 vpos3640HU·outerMargin283HU → x79.36/y146.8/w634.9867/h116.7067px와 일치한다. 따라서 이 구간의 PDF 대비 약4mm 차이는 전역 엔진 여백 오류로 간주하지 않는다. 동명 PDF가 HWPX 저장 좌표와 다르게 제작된 근거이며 구체 제작 설정은 미확정이다. 다른 모든 요소까지 자동 승인하지 않고, 향후 원본 HWPX 좌표와 native 한컴 표시를 우선 대조한다.
- 검사 종료 후 root가 시작한 localhost7701 미리보기만 정상 종료했다. Docker 엔진·기존 컨테이너·볼륨·복구 백업은 건드리지 않았다. 현재 브랜치/HEAD는 그대로 `feat/CF123-es-v2` / `41e82d79d10cf88d2292a8e47aa1fca61501023a`, 변경은 미커밋·미배포다.

### CF146 다음 단계 / 2026-09-11 원본 가시성 정정과 실제 가져오기 연결 검증

- **쪽번호 기대값 정정:** 09 동명 PDF의 물리2·3쪽에는 추출 가능한 `-2-`/`-3-` 텍스트가 있지만 최종 표시에는 없다. 번호 bbox x284.97~309.87 / y788.03~797.98pt를 흰색 사각형 x265.897~330.662 / y771.236~815.228pt가 완전히 덮는다. 2쪽 번호 TJ op1040 뒤 흰색 채움 op1050, 3쪽 TJ421 뒤 채움431로 그리기 순서도 확인했다. 4쪽의 `-1-`에는 덮개가 없다. PDF SHA256 `017b8fb3aac57469b51ee8cc43cca7c58a56e58e49f31c6a38f9beaa42a9f707`. 텍스트 추출/pgnp 존재를 가시성으로 오인했던 이전 누락 판단은 철회한다. native 한컴 원본 화면은 이 PC에서 미검증이다.
- 첫 NewNumber 이전 pgnp 활성화 실험은 unit/회귀20검사와 Docker WASM 빌드가 통과했지만 위 원본 기대값과 충돌하여 **제품 패치에서 제외**했다. root가 이번에 추가한 page_number/pagination/typeset 번호 변경만 되돌렸다. 비공개 진단용 `tmp/cf146-numbering-UNAPPROVED.patch`, `tmp/cf146-numbering-UNAPPROVED-pkg`는 승인 빌드가 아니며 배포하지 않는다.
- 유지할 변환기: `tmp/cf146-engine-layout-verified/{pkg,dist}`. candidate/pkg도 동일 검증본으로 복원했다. WASM SHA256 `0bb234fb446ec4e7a230e12967f1c61e418de0d313df59fe6926e5fe5fcd741b`. 배포용 private patch `patches/cf146-rhwp-layout.patch`는 이전과 동일한 3파일이며 SHA256 `57b552a1e334b6456090a972fd9b0609e5ca2009a23ca06353af7d540536744d`로 재확인했다.
- 실제 수정: `PreviewReportStudio.reportDraftMethod`가 전체 문서 수동 가져오기 시작/끝 마커를 인식하도록 수정했다. 기존에는 MANUAL-CHAPTER만 검사하여 AI 연결 계정에서 HWP 전체 원고 재진입시 작성 방식이 AI로 표시됐다. 본문/저장 버전/작성 권한은 변경하지 않는다.
- 기존 브라우저 검증기에 opt-in `CF146_STUDIO_URL`, `CF146_DIALOG_SOURCE`, `CF146_DIALOG_EXPECTED`를 추가했다. 실제 RhwpEditorDialog의 파일 선택→9쪽 로드→HWP 내보내기 자기 재열기→페이지 적용→격리 저장→페이지 새로고침→실제 보고서 출력 컴포넌트의9쪽/순서/사진/추가 갑지·번호 없음 PASS. 저장은 로컬 메모리 서버이며 실제 보고서 DB/Drive/API를 호출하지 않는다. 파일 자체의 HWP 재열기 검증과 전 페이지 편집 가능성/픽셀 동일성은 구분한다. 결과 `output/cf146/dialog-roundtrip.json`, 비공개 HWP와 페이지 캡처도 같은 폴더.
- 최종 관련 브라우저/근거자료/내용 계약 10검사 PASS(실패·skip0). 작성방식5경우도 실제 웹 모듈 함수를 실행하여 확인했다. 웹 타입 검사·프로덕션 빌드 PASS (`index-BSobB-SD.js`; 기존 큰 번들 경고 유지). `git diff --check` PASS. 초기 PDF 검사 실행의 SOURCE_ROOT 누락, native suite의 공개 clipboard-model.json 누락은 각각 올바른 경로/고정 커밋 공개 fixture로 보완해 재실행했다.
- 현재 유지할 WASM으로16원본855쪽을 다시 렌더: `tmp/cf146-number-final-main`, `tmp/cf146-number-final-other`. 원본해시/기대쪽수 모두 PASS, 이전 검증본 대비855쪽 SVG가 모두 byte 동일하다. PDF07/09 직접 읽기도68쪽/원본해시불변 PASS. 이는 전체855쪽을 native HWP와 시각 승인했다는 뜻이 아니다.
- 실제 Chrome 개발 사이트 로그인 상태는 확인했으나 업무원고·자료실·서버 설정은 변경하지 않았다. 로컬 Studio 설정은 기존 `__CLAIM_CENTER_RHWP_STUDIO_URL__`를 재사용했다. 현재 원본 보존은 페이지 이미지 방식이며 적용 후 개별 문장/표 수정은 원본에서 수정 후 재가져오기다.
- 남은 작업: 사내 Studio 배포·서버 연결, 실제 테스트 보고서의 업로드→DB 저장→재진입→최종 HWP/PDF 출력 검증. Step5의 미저장 수정본 출력 경계도 확정 snapshot 기준과 대조할 필요가 있으며 이번에는 변경하지 않았다. native HWP 서식 동일성 미검증을 PDF 텍스트·쪽수 통과로 대체하지 않는다. 현재 브랜치/HEAD 유지, 미커밋·미배포.

### CF146 다음 단계 / 2026-09-11 개발 서버 내부 변환기 배포

- 개발 서버에 실제 배포 완료: `2dbe41ba-5c5f-4e16-b04f-83435436e6ce`, 복구 기준 직전 버전 `e6a84c01-4ede-41c2-97af-45ac78afc236`. URL은 기존 development이며 내부 변환기는 `/rhwp/`. gaopen/베트남 서버/DB migration/고객 원본/비밀키 변경 없음. 브랜치 `feat/CF123-es-v2`, HEAD `41e82d79d10cf88d2292a8e47aa1fca61501023a` 그대로이며 이번 배포는 미커밋 CF146 작업본이다.
- 승인 WASM을 바꾸지 않고 Studio를 `--base=/rhwp/`로 재묶었다. `scripts/cf146-stage-rhwp.mjs`는 WASM SHA 확인, fresh web dist 확인, 허용 실행파일만 복사, 샘플·서비스워커 제외, MIT/CanvasKit/제3자 고지 및 `print.html` 포함을 수행한다. Windows의 `public/fonts`가 심볼릭 링크 대신 18바이트 텍스트로 체크아웃돼 글꼴이 빠졌음을 확인했다. canonical `assets/fonts`를 sparse checkout에 추가하고, 라이선스 고지가 확보된 Noto Sans KR 3종/Noto Serif KR 2종/Source Han 옛한글 subset 총6종만 명시적으로 동봉했다. 다른 서체 및 한컴 설치 글꼴과의 시각 동일성은 별도 미검증이다.
- runtime URL은 소스 공통 설정을 바꾸지 않고 staged `dist/runtime-config.js`에 같은 출처 `/rhwp/`로 주입한다. **일반 web build는 dist를 비우므로 staging 후 재빌드하면 안 된다.** 재배포 순서: 승인 engine/pkg 확인 → rhwp-studio에서 `RHWP_WITHOUT_HWPCTRL=1`을 설정하고 `node node_modules/typescript/bin/tsc`, `node node_modules/vite/bin/vite.js build --base=/rhwp/ --outDir ../../cf146-studio-hosted-dist` → main web typecheck/build → repo에서 `node scripts/cf146-stage-rhwp.mjs tmp/cf146-studio-hosted-dist tmp/cf146-rhwp-engine` → 직접 `node node_modules/wrangler/bin/wrangler.js deploy --config wrangler.development.jsonc`. 기존 `cf:deploy:development`는 web을 다시 빌드하므로 staged runtime 배포에는 사용하지 않는다. `scripts/licenses/NotoSerifKR-OFL.txt`는 Google Fonts 공식 저장소의 OFL 원문이다.
- 최종 stage의 실제 RhwpEditorDialog 9쪽 로드/HWP export 자기 재열기/전체 페이지 적용/격리 저장/재진입을 포함해 관련10검사 PASS(실패·skip0). typecheck/build, Worker dry-run, diff 공백 검사 PASS. stale dist에 재staging하는 음성 검사도 의도대로 거부했다. 첫 실행의 sourceRoot 속성 오류로 문서 opt-in 검사가 제외된9검사 결과는 최종 검증으로 쓰지 않고, 명시적 원본 root를 설정한10검사를 다시 통과했다.
- 배포 후 `node scripts/cf114-live-smoke.mjs development` PASS: health/readiness 정상, 익명 확정문서 접근401, main web8개 JS/CSS SHA 일치. `node scripts/cf146-hosted-smoke.mjs` PASS: manifest27파일 SHA,6개 WOFF2 magic, 내부 runtime URL, 인쇄페이지 확인. Cloudflare의 `/index.html` 및 `.html` 정규화 redirect만 정확한 동일출처 주소일 때 허용한다. 결과 `output/cf146/hosted-smoke.json`. Chrome 실제 `/rhwp/`에서 새 문서1쪽 준비 완료, 수집된 warn/error0. 이는 실물 HWP 최종 출력 승인과 다르다.
- 읽기전용 독립검수: manifest 누락/중복/해시불일치0; 폰트6개 upstream blob과 동일; 확인한 고객원본8종 SHA·파일명 및 비밀키 패턴 유입 없음. 원본 템플릿/샘플/DB는 배포에 넣지 않았다.
- 실제 로그인한 보고서 목록은 업무보고서2건만 표시됐다(버전11/1, 합12). 배포 후 재접속에도 동일하다. 별도 테스트 프로젝트 없이 `새 보고서 작성`을 누르면 최근 업무프로젝트 초안을 선택하며 caseId당1초안이므로 저장 테스트를 진행하지 않았다. 합성 프로젝트 신규 수주 처리는 ERP 연계 가능성이 있어 임의 실행하지 않는다. 사용자에게 사용할 테스트 프로젝트명을 요청했다. 기존 보고서 내용/단계/업로드/승인/알림은 변경하지 않았다.
- 다음 시작: 사용자가 지정한 테스트 프로젝트의 권한·기존 초안 유무 확인 → 합성 문서로 실제 업로드/DB 저장/재진입 → 승인·알림 범위가 허용되면 확정 출력 검수. native HWP/원본과 전 페이지 동일성, 타 PC 글꼴, Step5 snapshot 경계는 여전히 미검증이다. 현재 whole-document 가져오기는 페이지 이미지 보존 방식이며 원문 전체를 웹에서 문장별로 편집하는 기능으로 설명하지 않는다.

### CF146 실제 테스트 프로젝트 검수 / 2026-09-11

- 사용자가 기존 테스트 프로젝트 사용을 승인하여 CC-2026-00004에서 진행했다. SELECT 전용 `scripts/cf146-test-project-snapshot.mjs`로 v11 초안을 비공개 tmp에 백업했다. 실제 화면에서 제목에 검수 접미사를 붙여 저장(v12), 새로고침으로 유지 확인 후 원래 제목으로 복원 저장(v13)했다. 승인·확정·메일 발송·DB 직접 수정은 하지 않았다.
- 세 버전의 본문 123349자와 SHA256 `bf7283e40459058550d3c45141b6c0a31890fe4542d122353a79c240af0f0094`가 동일하다. editor_json.content도 동일하며 기존 저장 경로가 루트 attrs에 기본 reportHeader/reportFrontMatter를 추가했으므로 JSON 전체 바이트가 동일하다는 뜻은 아니다. 실제 편집 화면 본문과 표19개는 저장·재접속·배포 후 동일했고 이미지0개다. 백업 파일은 `tmp/cf146-test-project-before-live-save.json`, 성공 저장은 `after-title-save`, 복원은 `restored-title` 접미사다. `after-live-save`는 초기 선택자 실패로 v11이며 성공 근거로 쓰지 않는다.
- 실제 출력 본문이343쪽으로 늘어나는 원인은 pre/code의 white-space:pre 때문에 긴 근거 문장이 A4 너비를 초과하고 쪽 나눔 검사가 한 줄씩 분할하는 것이었다. DocumentReviewWorkspace.css의 최종 출력 범위에만 pre-wrap/overflow-wrap:anywhere를 추가했다. 기존 본문·산식·저장 구조는 바꾸지 않았다. UI 관련 스킬은 출력 넘침 수정에만 적용했고 화면 재설계는 하지 않았다.
- 새 긴 근거문 회귀는 수정 전57쪽으로 실패, 수정 후 원문 전체 보존·가로 넘침 없음으로 통과했다. 보고서 브라우저/내용 계약/근거자료10검사 모두 PASS(실패·skip0). 이 실행에는 opt-in HWP 실제 대화상자 검사는 포함하지 않았다. 웹 타입 검사·빌드·diff 공백 검사 PASS, 기존 큰 번들 경고는 유지된다.
- 개발 배포 버전 `c30ab643-9e4c-439a-8007-7cee3fe45303`, 복구 기준 `2dbe41ba-5c5f-4e16-b04f-83435436e6ce`. 웹 빌드 후 승인 rhwp 재staging 및 직접 Wrangler 배포, cf114-live-smoke와 cf146-hosted-smoke PASS. 승인 WASM/엔진 패치는 변경하지 않았다. 실제 테스트 프로젝트 재접속에서 본문343→59쪽, 페이지 fit overflow0, 긴 pre의 너비/scrollWidth630/630 확인. 59는 갑지·목차를 제외한 본문 쪽수다.
- 합성4쪽 `output/cf146/cf146-report.hwpx`를 실제 가져오기 경로로 검수하려 했으나 브라우저 filechooser 대기가 시간 초과돼 setFiles가 실행되지 않았다. 업로드·Drive 연결·실서버 HWP 변환은 미검증이며 기존59쪽 원고에 전체 적용하지 않았다. 확장 프로그램의 파일 URL 접근 허용 설정 확인을 사용자에게 안내한다. 시간 초과만으로 해당 설정이 원인이라고 확정하지 않는다.
- 다음 시작: 파일 선택 연결 복구 후 같은 프로젝트에서 합성 HWPX 업로드→내부 변환기 로드 확인(기존 원고 전체 교체 금지). 이후 별도 승인 범위에서 적용·확정 출력 검수. 기존 AI 원고에 남은 코드형 근거/내부 필드 표현은 이번 줄바꿈 수정으로 의미나 문장이 교정된 것이 아니다. native HWP 전 페이지 동일성 및 최종 확정 PDF는 계속 미검증이다. 브랜치/HEAD 유지, 작업본 미커밋.

### CF148 전 과정 회귀 검수 / 2026-09-14

#### 최신 인수인계 — 공통양식·일괄투입·DOCX 추가 수정

- 최종 실제 앱 확인에서 Word2010을 발견·실행했다. 앞선 Office16 경로 확인은 설치부재 근거로 사용하지 않는다. 현재 새 빈 Word 문서1 앞에 Office인증오류0xC004F074 창이 표시되어 사용자가 직접 처리해야 한다. 인증창 조작은 하지 않았고 합성DOCX조차 아직 열리지 않았다. 다음 시작은 이 창 처리 후 실제DOCX쪽배치 검수다.

- 최종 실제 앱 확인에서 Word2010을 발견·실행했다. 앞선 Office16 경로 확인은 설치부재 근거로 사용하지 않는다. 현재 새 빈 Word 문서1 앞에 Office인증오류0xC004F074 창이 표시되어 사용자가 직접 처리해야 한다. 인증창 조작은 하지 않았고 합성DOCX조차 아직 열리지 않았다. 다음 시작은 이 창 처리 후 실제DOCX쪽배치 검수다.

- 최신 상세 기록은 CF148_END_TO_END_SELF_AUDIT_20260914.md의 `최신 추가 구현·독립 재검사` 이후다. 아래 초기 DOCX raster/로그인대기/다중인원 미구현 기록은 당시 결과로 남기며 현재 상태로 사용하지 않는다.
- 모든 template catalog×6유형의4~12장 동일 기본값, 공통V1→V2 변경 시 기존제안서 불변/신규제안서 최신이미지 적용 검수. 관리자 신규 학위·자격·실적 이미지 등록(현재4~10장), 공통본문 적용 후 dirty, 프로젝트전환 보호, 페이지 선택/이전/다음 이동 추가. 기존 승인본 자동 덮어쓰기 없음.
- #33 다중PERSON/TEAM 및 일정 합본 원자저장 구현. cf11 API 실패/충돌/재시도, 실제React4명선택, local D1 changes조건/rollback 검사 통과. 기존 단일API호환 유지, migration 없음.
- 실제 DOCX 다운로드는 본문·표·개별이미지 방식. 목차 오른쪽탭점선, 갑지상단간격, 목록value/reversed/none/roman/alpha, native 바닥글 보존 수정. 최종CF1468검사에서 본문28텍스트노드/표2/그림6/구역4/footer4 확인. Word 전페이지렌더는 bundled변환기 부재로 실패했고 HWP는 raster 그대로이므로 출력전체PASS 아님.
- root 최종 회귀: 넓은 업무9파일79PASS, cf11/cf72/cf107/cf69 20PASS, cf118+cf148allocation-browser 9PASS, CF1468PASS, localD1 1PASS. 서로 다른 실행의 중복을 합산하지 않는다. 웹typecheck/build와 Worker dry-run PASS. main index-BzpdI_Vf.js, CSS index-urXHw3u5.css, 승인rhwp27파일/WASM SHA 재staging 유지.
- HEAD/branch 유지, 미커밋·CF148미배포. 실제development CF147 유지, 원본XLSX/업무DB/승인/메일/AI호출 변경 없음. 현장조사양식 #32 보류 유지. 전체판정FAIL, 직원가이드촬영/preview승격 미실행.
- 다음: 문서렌더 환경과HWP편집성 해결→같은시험프로젝트의실제출력대조→37의견별development재검증→전체PASS후preview반영. 100건조회한도/11~12신규공통이미지/공통본문과거버전복원/실Claude시간초과는 미완료다.

#### 최신 인수인계 — 공통양식·일괄투입·DOCX 추가 수정

- 최신 상세 기록은 CF148_END_TO_END_SELF_AUDIT_20260914.md의 `최신 추가 구현·독립 재검사` 이후다. 아래 초기 DOCX raster/로그인대기/다중인원 미구현 기록은 당시 결과로 남기며 현재 상태로 사용하지 않는다.
- 모든 template catalog×6유형의4~12장 동일 기본값, 공통V1→V2 변경 시 기존제안서 불변/신규제안서 최신이미지 적용 검수. 관리자 신규 학위·자격·실적 이미지 등록(현재4~10장), 공통본문 적용 후 dirty, 프로젝트전환 보호, 페이지 선택/이전/다음 이동 추가. 기존 승인본 자동 덮어쓰기 없음.
- #33 다중PERSON/TEAM 및 일정 합본 원자저장 구현. cf11 API 실패/충돌/재시도, 실제React4명선택, local D1 changes조건/rollback 검사 통과. 기존 단일API호환 유지, migration 없음.
- 실제 DOCX 다운로드는 본문·표·개별이미지 방식. 목차 오른쪽탭점선, 갑지상단간격, 목록value/reversed/none/roman/alpha, native 바닥글 보존 수정. 최종CF1468검사에서 본문28텍스트노드/표2/그림6/구역4/footer4 확인. Word 전페이지렌더는 bundled변환기 부재로 실패했고 HWP는 raster 그대로이므로 출력전체PASS 아님.
- root 최종 회귀: 넓은 업무9파일79PASS, cf11/cf72/cf107/cf69 20PASS, cf118+cf148allocation-browser 9PASS, CF1468PASS, localD1 1PASS. 서로 다른 실행의 중복을 합산하지 않는다. 웹typecheck/build와 Worker dry-run PASS. main index-BzpdI_Vf.js, CSS index-urXHw3u5.css, 승인rhwp27파일/WASM SHA 재staging 유지.
- HEAD/branch 유지, 미커밋·CF148미배포. 실제development CF147 유지, 원본XLSX/업무DB/승인/메일/AI호출 변경 없음. 현장조사양식 #32 보류 유지. 전체판정FAIL, 직원가이드촬영/preview승격 미실행.
- 다음: 문서렌더 환경과HWP편집성 해결→같은시험프로젝트의실제출력대조→37의견별development재검증→전체PASS후preview반영. 100건조회한도/11~12신규공통이미지/공통본문과거버전복원/실Claude시간초과는 미완료다.

- 로그인 후 재개: Chrome CC4 실제 의뢰→승인 제안서v3→일정 전체출력9~11월3쪽→착수/현장/산출→보고서v13→검토/납품/판결 메뉴 조회. 승인/업로드/AI/본문 수정 없음, 보고서4→5단계 이동. 최종 기존 보고서v13 123,349자 유지 확인. 로그인은 더 이상 blocker가 아니다.
- 실제 제안서3장 끝 `<p></p>` 백지 재현 후 출력 분할만 수정. 공통모듈70% 길이 기준 대체 제거, mixed/legacy 저장4~12 snapshot보존, 서버 출력 제출처는 승인 snapshot 사용으로 수정. cf42+cf114 10검사 및 cf147browser+cf107 7검사 root PASS; 제출처 수정 뒤 cf42 6검사 재PASS(중복).
- 웹 타입/빌드 PASS main index-CWrtA4dm.js, rhwp27파일 승인SHA 재staging. CF148 미배포, development CF147 그대로. 실제 빈페이지 수정 후 서버 화면 대조는 미검증이다.
- 전체 FAIL 유지: 기존 보고서 내부 코드 문구, native 편집 가능 DOCX/HWP, 여러 명 일괄 배정, 실제 승인/납품 왕복 및 원본 전 페이지 일치. 상세 상태는 CF148 문서 로그인 후 표가 최신이며 아래 초기 로그인대기 기록을 대체한다.

- 로그인 후 재개: Chrome CC4 실제 의뢰→승인 제안서v3→일정 전체출력9~11월3쪽→착수/현장/산출→보고서v13→검토/납품/판결 메뉴 조회. 승인/업로드/AI/본문 수정 없음, 보고서4→5단계 이동. 최종 기존 보고서v13 123,349자 유지 확인. 로그인은 더 이상 blocker가 아니다.
- 실제 제안서3장 끝 `<p></p>` 백지 재현 후 출력 분할만 수정. 공통모듈70% 길이 기준 대체 제거, mixed/legacy 저장4~12 snapshot보존, 서버 출력 제출처는 승인 snapshot 사용으로 수정. cf42+cf114 10검사 및 cf147browser+cf107 7검사 root PASS; 제출처 수정 뒤 cf42 6검사 재PASS(중복).
- 웹 타입/빌드 PASS main index-CWrtA4dm.js, rhwp27파일 승인SHA 재staging. CF148 미배포, development CF147 그대로. 실제 빈페이지 수정 후 서버 화면 대조는 미검증이다.
- 전체 FAIL 유지: 기존 보고서 내부 코드 문구, native 편집 가능 DOCX/HWP, 여러 명 일괄 배정, 실제 승인/납품 왕복 및 원본 전 페이지 일치. 상세 상태는 CF148 문서 로그인 후 표가 최신이며 아래 초기 로그인대기 기록을 대체한다.

- 상세 체크리스트: `docs/CF148_END_TO_END_SELF_AUDIT_20260914.md`. 11개 범주의 로컬 통과/실제 미검증/출력 FAIL을 구분한다. 현장조사 양식 32번은 계속 보류.
- 제안서 4~12장 신규 기본 이미지 URL을 첫 저장 버전에 포함. 재진입 자동복구 3경로가 저장 본문·editorJson·조직도 이미지를 지우는 문제를 제거. 서버 재저장 시 중앙 모듈 비활성/포함목록 누락으로 기존 본문을 지우지 않는다.
- 7파일 51검사 PASS, 마지막 수정 뒤 cf42 5검사 재검사 PASS(중복). 템플릿 원본23종 고정장/이미지 URL 저장 검사 포함. cf116/cf119 로컬 브라우저12검사, cf117 재검사3검사 PASS. 실제 사용자 템플릿 전 페이지 출력 통과로 해석하지 않는다.
- 이전 CF146 합성 PDF4쪽 A4 세로·표·사진대지 육안 확인. DOCX는 텍스트0/표0/그림4로 편집 요구 FAIL. 실제 development는 로그인 화면이므로 전체 사용자 흐름 검증 대기. CF148 미배포, development CF147 유지. 운영 DB/승인/AI/메일 변경 없음.
- 다음 시작: 로그인된 development 기존 테스트 프로젝트 확인 → CH06/CH10 실제 출력과 원본 비교 → 실제 버튼의 편집 가능한 출력 수정 → 구형12장/중앙 모듈 정책 확인 → 카테고리 체크리스트 잔여 검수. preview 승격은 전체 통과 전 보류.

### CF148 전 과정 회귀 검수 / 2026-09-14

- 상세 체크리스트: `docs/CF148_END_TO_END_SELF_AUDIT_20260914.md`. 11개 범주의 로컬 통과/실제 미검증/출력 FAIL을 구분한다. 현장조사 양식 32번은 계속 보류.
- 제안서 4~12장 신규 기본 이미지 URL을 첫 저장 버전에 포함. 재진입 자동복구 3경로가 저장 본문·editorJson·조직도 이미지를 지우는 문제를 제거. 서버 재저장 시 중앙 모듈 비활성/포함목록 누락으로 기존 본문을 지우지 않는다.
- 7파일 51검사 PASS, 마지막 수정 뒤 cf42 5검사 재검사 PASS(중복). 템플릿 원본23종 고정장/이미지 URL 저장 검사 포함. cf116/cf119 로컬 브라우저12검사, cf117 재검사3검사 PASS. 실제 사용자 템플릿 전 페이지 출력 통과로 해석하지 않는다.
- 이전 CF146 합성 PDF4쪽 A4 세로·표·사진대지 육안 확인. DOCX는 텍스트0/표0/그림4로 편집 요구 FAIL. 실제 development는 로그인 화면이므로 전체 사용자 흐름 검증 대기. CF148 미배포, development CF147 유지. 운영 DB/승인/AI/메일 변경 없음.
- 다음 시작: 로그인된 development 기존 테스트 프로젝트 확인 → CH06/CH10 실제 출력과 원본 비교 → 실제 버튼의 편집 가능한 출력 수정 → 구형12장/중앙 모듈 정책 확인 → 카테고리 체크리스트 잔여 검수. preview 승격은 전체 통과 전 보류.

### CF147 사용자 검토 1차 수정 / 2026-09-11

- 원본 `클레임 그룹웨어 검토2.xlsx`의 37개 코멘트 묶음을 추적한다. 사용자는 preview 검토 의견을 development에서 수정한 뒤 월요일 preview로 옮기기로 명시했다. 32번 현장조사 양식만 의견 확인까지 보류; 17번 현장조사 대상 목록은 수정 범위다. preview는 이번에 변경하지 않았다.
- 수정: 공통 프로젝트 검색 결과/현재 선택 구분 및 결과 없는 이어쓰기 차단(13/28), 저장한 제안서 제출처 보존(1), 긴 제안서 문단 쪽 나눔 fallback(7/8 일부), 착수회의 보관 XLSX와 자동작성/최종확정 시트명 구분(16/31), AI 제안 내부 영역 분리 및 원문 메모 출력(29), 유사도만으로 최신본 교체 제안 제거와 이전 검토 토큰 검증(35), Excel 빈 서식 셀 제한/실패 파일 구분(36). 현장조사 양식과 기존 TXT 자료는 유지했다.
- `cf104-drive-versioning`, `cf47-intake-source`, `cf147-user-review-browser`, `cf114-report-save`, `cf118-proposal-finalization`, `cf83-practitioner-review`, `cf91-proposal-workflow-portrait`, `cf103-minutes-export`, `cf115-workflow-import-parser` 9개 테스트 파일 총54검사 PASS. 웹 타입/빌드/공백 검사 PASS. CF147 실제 로컬 브라우저는 검색 불일치·선택 불변, 생성 XLSX 재추출과 종료시각/AI제안 제외, 자동작성/확정 bytes 차이, 긴 문단 1천 반복의 전체 원문 보존을 검사한다. 배포 사전 검사에는 로그 경로 EPERM 경고가 있어 배포 때 workspace 내 WRANGLER_LOG_PATH로 전환했다.
- development `2d6e3f37-0653-42c8-b1c8-473e2865e9d8`, 복구 기준 `c30ab643-9e4c-439a-8007-7cee3fe45303`. main `index-rt57gwAE.js`. web 빌드 후 승인 rhwp 27파일 재staging, 직접 Wrangler development 배포. cf114-live-smoke와 cf146-hosted-smoke PASS, WASM 승인 SHA 유지, native6폰트 유지. DB 마이그레이션/운영 자료/승인/메일 변경 없음.
- 미완료: 20/21 보고서 실제 저장·이탈·단계 이동, 37 Claude 시간 초과와 부분 저장/재시도, 6/9/22 편집 가능한 HWP/DOCX, 실제 양식/표지/증빙 이미지 대조, 일정 상세·인원 일괄 지정·막대 일정 등. 기존 소스 검사에 ‘editable’라고 쓰여 있어도 현재 페이지 이미지 출력의 실무 편집 요구가 충족된 것은 아니다. 이번 partial fix를 36개 완료로 보고하지 않는다.
- 다음 시작: workspace 기존 `output/user-review-20260911/클레임_그룹웨어_사용자검토_정리.md` 진행표와 Chrome before/after 근거를 확인 → 20/21/37 우선 재현 → 출력 및 나머지 번호별 검수 → 월요일 preview 승격 전 변경/검사/복구 기준 점검. 브랜치 feat/CF123-es-v2, HEAD 41e82d79 유지, 기존 CF146 작업과 이번 변경은 미커밋 상태다.
