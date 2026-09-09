# CF132 한국은행 ECOS 관리자 설정 및 ES 연결

## 사용자 경로

테스트 서버 설정 → 관리자 설정 → **한국은행 ECOS · ES 재료지수 연결**에서 인증키 저장 → ECOS 연결 확인.
ES 산출서 기본입력의 기준일·조정일 설정 → ES 요율정보 가져오기 → 결과 비교 → 확인·입력에 적용 → 저장·계산.
확인 전과 취소 시 입력은 바뀌지 않는다. API 호출은 서버에서만 하며 키는 브라우저 조회 응답·Git·로그에 반환하지 않는다.

## 공식 데이터 계약

한국은행 `404Y014` 생산자물가지수 기본분류, 월별 M, 기준 `2020=100`.

| 배열 순서 | 항목 코드 | 공식 항목명 |
|---|---|---|
| 1 | 201AA | 광산품 |
| 2 | 3AA | 공산품 |
| 3 | 4AA | 전력,가스,수도및폐기물 |
| 4 | 101AA | 농림수산품 |

자료월은 기존 원본 규칙 `esMaterialMonth`를 그대로 사용한다. 월말일은 해당 월, 나머지는 전월. 예: 2024-06-15 → 202405, 2026-05-01 → 202604. 동일 자료월 호출은 중복 제거한다. 공개 sample 응답으로 항목·자료월·단위 확인. 실제 사용자 키의 등록/승인 여부는 별도 연결 확인 결과로 판단한다.

기간별 4개 응답의 표·항목·명칭·자료월·단위·숫자·행 수를 모두 검증한 경우에만 반영. 하나라도 없거나 다른 분류이면 그 월 전체를 미반영하며 최신 월로 대체하지 않는다. 과거 자료도 현재 제공되는 개정 수치이지 당시 발표본 재현은 아니다.
ECOS는 노임, 보험 요율, 기계경비, 표준시장단가 전체를 제공하지 않는다. 건강보험은 기존 국가법령 API를 유지하고 나머지는 Excel 이력/수동입력을 유지한다.

같은 적용일의 기존 검수값은 재조회 실패 시 보존한다. ECOS 성공 시 재료 4종만 교체하고 원본 이력 해시와 노임·기계·단가를 바꾸지 않는다. 기준일 변경은 이전 날짜 값을 재사용하지 않는다. 고용등급·퇴직공종만 변경하면 해당 요율만 갱신하고 재료는 유지한다.

## 저장소 및 권한

- GET/PUT `/api/settings/ecos`, POST `/api/settings/ecos/test`: 관리자 전용. GET은 저장 여부·버전·시각·암호화 준비 상태만 반환.
- PUT: `{apiKey, expectedVersion}`. POST test: `{expectedVersion}`. 저장/연결 확인 중 버전 변경은 409. JSON과 동일 출처 검사.
- GET `/api/es/sources/ecos?date=...`: 로그인한 ES 업무 역할 전용, 최대 날짜 3개. 키 미설정이면 입력 안내, 기존 입력 보존.
- Worker: migration `0064_cf132_ecos_api_settings.sql`의 전용 D1 테이블, 기존 AES-GCM master key 재사용, ECOS 전용 AAD. 기존 법령/AI/Google 키 변경 없음.
- Node: 이미 설치된 `20260827090000_server_settings_adapter`의 `ServerSetting`에 조직 소유 `ECOS_API_KEY` 저장. **새 Node DB 구조 변경이 없어 추가 Node migration 불필요.** Worker 암호문 직접 공유 금지. Node 배포는 이번 작업 범위 아님.

## 개발 서버 배포·보존 절차

정확한 대상: `wrangler.development.jsonc`, D1 `16d1f25b-60c8-4489-95ed-4fa7de161c9f`. 가오픈/실서비스 배포 금지.
CF123 배포 절차의 유지보수 전체 요청 차단 → 새 SQL export → 서명/검증/격리 복원 → 실제 Wrangler migration runner → 두 번째 no-op → 원격 적용 → 재export 비교 → 점검 해제를 따른다.
이번 전용 도구는 `scripts/cf132-backup-check.mjs`, migration은 **0064 하나**이다. 기존 모든 테이블의 모든 값·스키마, migration 원장과 integrity/FK를 비교하며 새 설정 테이블은 빈 상태여야 한다.
실패 시 점검을 유지하고 직전 코드 및 검증된 백업으로 복구한다. reverse SQL, 기존 DB 교체, master key 교체는 하지 않는다. 백업과 로컬 복원 DB는 민감 데이터로 Git/전달 ZIP에 포함하지 않는다.

## 2026-09-09 실행 결과

- 신규 단위/Worker/Node 실제 HTTP·SQLite 테스트 35/35 PASS. 기존 ES165 + 법령설정12를 포함한 통합 회귀 212/212 PASS, 실패·skip 0.
- 신규 테스트 strict TypeScript, document-engine/API project build, web tsc/Vite production build, Worker dry-run PASS. 기존 대형 bundle 경고는 유지.
- 격리된 실제 App 브라우저 합성 API 검수 8/8 PASS: 저장 후 키 입력 제거, 중복 방지, 연결 확인, 409/503 복구, 세 날짜 조회, 확인 전/취소 불변, 12개 재료 필드와 출처만 적용, undo, 실패/잘못된 월 보존. 업무 문서 쓰기 0.
- 개발 DB 서명 백업 생성·검증·복원 후 실제 Wrangler 0064 적용, 2회차 no-op, 전체 비교 PASS. 원격 0064 적용 후 다시 export하여 기존 121개 테이블의 모든 값·스키마·기존 원장 보존과 신규 빈 테이블 1개 확인. integrity/FK PASS.
- 백업 SHA-256: `007930b9bc9212bade7d83a7ae14c0df9cec621166fde4540cddb8df6c1748ca`.
- 별도 기록 서명 public key pin: `7581488ad677e031a5800755b08c0f732147eae5c32e047b5c8b38d1009f6f94`.
- migration SHA-256: `dfa47568d5fbd9b6c13c6538813e270fa2a7a9fb70069648257066098b251ab8`.
- 직전 버전 `6d2c0526-11b6-48e1-81c8-1f1f5096afab`, 점검 버전 `ea2732a2-3e5a-42e0-bb50-9b159d59db0e`, 공개 버전 `a54e0d30-e9d6-41a7-bb9e-f9ad7dcd61a5`.
- 개발 health/readiness PASS, Google Drive connected 유지, 새 API 비로그인 401, index/JS/CSS/chunk 원격 SHA와 빌드 일치.
- 실제 로그인 Chrome에서 ECOS 빈 password 입력란·미설정 상태, 기존 법령 OC v2, 기존 산출서 2건(v6/v1), ES 새 안내 문구 확인. 키 입력·연결 버튼·문서 저장은 실행하지 않음.
- 공통 `fetchEsEcosSources`를 한국은행 공개 sample API에 실제 연결하여 202405 `[135.38,123.97,143.63,114.93]`, 202604 `[124.86,138.35,149.76,119.28]` 검증 PASS, warnings 0. 인증 부분만 공개 sample로 대체했으며 데이터 응답은 mock이 아님. 사용자 발급 키 성공을 의미하지 않음.
- 기존 합성 산출서의 로드 시 날짜 정규화가 저장하지 않은 변경 표시를 만드는 현상을 확인. 입력·API 조회·저장 없이 발생했고 라이브 데이터는 변경하지 않음. 이 기존 문서 정규화 표시의 별도 개선은 이번 ECOS 연결 범위에 포함하지 않음.
- 관리자 실제 키 등록·외부 인증 성공은 아직 미실행. 사용자 키는 코드·DB에 임의 삽입하지 않았으며 관리자 입력을 기다린다. 노임/다른 요율 전체 자동수집·Node 서버 배포·실서비스 배포는 미실행.

브라우저 증거는 로컬 `output/playwright/es-v2/cf132-browser-results.json`과 `cf132-ui-test.ts`, 마스킹 캡처에 있다. 민감 백업과 브라우저 산출물은 Git에 포함하지 않는다.
