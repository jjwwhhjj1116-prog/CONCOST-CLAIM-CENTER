# CF127 ES 기본입력·원자료 연계·금액 표기 검수

2026-09-09. 테스트 서버만 변경. 전체 자동 수집 완성 판정은 **PARTIAL**.

## 반영

- 원본 기본입력의 노란 수동입력 anchor 19개를 복원. 병합 C8:E8은 C8 하나로 표시. 노란색을 계산기 최소 필수 4항목으로 축소했던 CF126 분류를 폐기했다. 흰색의 추가 계약 입력도 보존했다.
- 기본정보와 기준일별 노임·재료·요율/계산 결과를 나란히 표시. 모바일에서는 입력 다음에 파생표 배치. 원본 셀 주소와 수동 입력 의미를 표시한다.
- 원본 Excel 월별·시행일별 요율·기계 연도별 공통품목·표준시장단가 기간쌍 이력을 문서 및 작업용 Excel에 보존한다. 원자료 이력은 400,000자 이내, 전체 기존 요청 한도 500,000자 유지. DB 스키마 변경 없음.
- `ES 요율정보 가져오기`: 날짜·고용등급·공종에 맞춰 이력을 재선택하고 확인창에 기존값/조회값/근거/누락을 표시. 취소는 기존 값 유지. 적용 후 별도 저장·계산. 미래 수식 캐시, 없는 월, 중복 시행일, 없는 공통 기간쌍은 임의 최신값이나 0으로 채우지 않는다.
- 국가법령 관리자 OC vault를 서버에서 재사용하는 건강보험 조회 추가. 연혁 목록→정확 법령ID/이름→MST와 시행일→제44조① 및 제76조① 사업주 부담 근거 검증. 클라이언트에 OC를 반환하지 않는다. 근로자 일반 사업주 부담률만 지원한다.
- 원본 C22 산업안전 요율을 세 기간에 공통 반영. 등급/공종 변경 시 이전 해당 요율을 지워 재선택 전 낡은 값으로 계산되지 않도록 했다.
- 경과일을 원본의 `조정기준일−계약체결일−1`로 수정. 낙찰률(%) 단위를 바로잡고 원본 출력 1!J6에 100으로 나눈 숫자를 연결했다.
- 모든 주요 금액 입력·비목·공제·계산표·하단 적용대가/선금/최종금액·가져오기 비교창에 `(원)`과 3자리 쉼표 적용. Number 변환/천원 환산/반올림 없이 표시만 가공하고 raw 숫자 문자열을 저장한다. 입력 중에는 원값, 포커스를 벗어나면 쉼표 표시.

## 실행 증거

| 범위 | 결과 |
|---|---|
| 계산·UI 계약·import dialog·건강 API·원자료·금액 단위 검사 | 72/72 PASS |
| 격리 D1/Node 저장·권한·버전·출력 회귀 | 16/16 PASS; 실제 DB 변경 없음 |
| 첨부 원본 브라우저 메모리 파서/왕복/재선택/출력 검사 | 34/34 PASS |
| 실제 App 로컬 격리 UI, 합성 API | 5/5 PASS; desktop/mobile light/dark, 노란19/중립12, 취소·적용·저장·재진입·금액 raw 보존 |
| 국가법령 공개 OC=test 실제 helper 호출 | 2025-12-31 건강 사업주3.545%, 2026-01-01 3.595%; 동일 MST280453의 시행일 차이 검증 |
| 타입검사·Vite 빌드·development Worker dry-run | PASS; 기존 번들 크기 경고 유지 |

원본 SHA-256 전후 동일: `b65131c4b3bb0a1a99c52a6726e38afb4f86f721ed4f74f96df195ed6b3b8243`.
원본 현재/직전 K는 참조 캐시와 대조만 했고 계산 입력에 캐시를 사용하지 않았다. 출력17개는 생성 후 workbook 시트 수를 재확인했으며 실제 Excel 재계산·물리 인쇄 PASS를 의미하지 않는다.

검수 파일:
- `scripts/cf127-es-health-test.ts`, `scripts/cf127-es-money-test.ts`
- `scripts/cf123-es-import-test.ts`, `scripts/cf124-es-input-layout-test.ts`
- 로컬 증거 `outputs/cf123-es/parser-qa.json`, `output/playwright/es-v2/cf127-pass2-results.json`
- 원본 읽기 전용 지도 `output/cf127/CF127_BASIC_MAPPING.md`

## 미완료 / 미실행

- **ECOS 재료지수·건설협회 노임 자동 수집은 미구현.** 사용자는 국가법령 OC만 보유. 현재 노임/재료는 원본 Excel 이력 또는 수동 입력으로 작업한다. 국가법령 OC를 ECOS 키처럼 사용하지 않는다.
- 건강보험 외 법정 요율 자동 조회·적용은 미구현. 연금 부칙의 단계인상, 요양의 보수/건강보험료 기준 차이, 고용등급·공사종류·계약 적용례를 확인하지 않은 값을 자동 적용하지 않는다.
- 로그인된 실제 테스트 서버의 사용자 OC를 이용한 건강 조회와 실제 DB 저장·재진입은 이번 브라우저 세션 미연결로 NOT_RUN. 공개 API 실조회와 로컬 mock UI 검사는 별개 증거다.
- 실프린터 및 Excel 애플리케이션 재계산·17개 출력물 전체 시각 대조 NOT_RUN. 신규비목·후속 차수·복수 선금 지원은 여전히 미완료.
- 로컬 시각 검사에서 dark 헤더 배경 비침을 발견해 기존 반투명 카드 토큰 대신 불투명 surface 토큰으로 수정했다. 그 마지막 CSS 치환은 추가 시각 배치 없이 정적 확인/빌드만 수행했다.

## 공식 근거

- https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=lsEfYdListGuide
- https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=lsEfYdInfoGuide
- https://ecos.bok.or.kr/api/

가오픈 서버·원본 Excel·고객정보·비밀키·기존 저장 DB는 수정/커밋하지 않는다. 배포 결과는 아래 별도 기록한다.

## 테스트 서버 배포 결과

- 제품 커밋: `4fc7f5a`.
- Worker: `concost-claim-center-development`.
- 배포 version: `eb1ce867-9721-4402-b0ea-275f4dcca8fb`.
- URL: https://concost-claim-center-development.jjwwhhjj1116.workers.dev/es
- `/health`, `/readiness`, `/es`: HTTP200. 익명 ES 문서·건강조회: HTTP401.
- 배포된 JS/CSS 4개 파일 SHA-256이 로컬 빌드와 모두 일치. 가오픈 배포 없음, migration/DB 변경 명령 없음.
- 최종 빌드 assets: `index-3aRU0s4l.js`, `index-PyN6GJWg.css`, `index.es-Btvg4uAw.js`, `index-DqJNflzv.js`.
- `wrangler.development.jsonc` 명시 및 `RELEASE_MAINTENANCE:0`으로 개발 Worker만 배포했다. 기존 비밀키는 읽기/교체하지 않았다.
