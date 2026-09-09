# CF126 기본입력 필수 표시와 프로젝트 연결 안내

2026-09-09. development 테스트 서버만 대상. 계산 규칙·저장 검증·DB·권한 확대 없음.

## 구현

- 기존 28개 기본입력 필드를 보존하고 1. 공사정보 / 2. 산출기준일 / 3. 전체계약·공사기간 / 4. 금차계약·공사기간 / 5. 적용조건·공정 순서를 표시한다.
- 기본입력에서 제목(저장 필수), 입찰 기준일·조정기준일·계약금액(계산 필수) 4개만 연한 노란색과 텍스트·aria-required로 표시한다.
- 나머지 24개는 테마의 일반 입력색으로 표시하며, 선택 입력·Excel 가져오기·저장값·키보드 조작을 보존한다. 계산 필수 미입력 상태의 초안 저장을 새로 차단하지 않는다.
- 프로젝트 선택은 기존 caseId 연결만 저장한다. 계약정보 자동 채움은 구현돼 있지 않음을 안내하고, 목록 조회에 assignedOnly=true를 사용해 연결 권한 범위와 일치시킨다.
- 기본입력만으로 비목·지수·요율이 자동 채워지지 않음을 안내한다. 계산 결과는 원자료 입력 후 기존 엔진으로 산출한다.

## 판단 근거

`packages/document-engine/src/es-service.ts`: 제목 필수, 프로젝트 선택 및 접근권한 검사.
`packages/document-engine/src/es-calculation.ts`: baseDate/adjustmentDate/contractAmount 계산 필수. 계약정보 21개는 빈 값 허용 출력 메타데이터다. 원본 Excel의 노란색을 법적 필수 항목이라고 재해석한 것이 아니라 현재 웹 엔진의 입력 계약을 표시한 변경이다.

비목·3시점 원자료·기간쌍·공제 입력은 별도로 필요하다. 기본입력 4개만 채우면 전체 계산이 완료된다는 의미가 아니다. 자동조회 API 및 프로젝트 계약정보 자동 채움 미구현 범위를 이번 UI 수정으로 완료 처리하지 않는다.

## 검증과 배포

- 빌드(타입 검사 포함), development Wrangler dry-run 통과. 기존 대형 chunk 경고는 유지된다.
- 계산 24 + 저장/ACL 16 + CF124/126 UI 계약 9 + CF125 가져오기 모달 11 = 60/60 PASS. dark 후속 CSS 포함 UI 계약 9/9 재실행 PASS.
- 실제 App 격리 브라우저(API mock) 2/2 PASS: 1440/390 light/dark의 필수4/선택24, 5개 번호, 합성 프로젝트 선택·PUT 1회·재열기·다른 입력 전체 보존. 결과 `output/playwright/es-v2/cf126-results.json`. 고객 데이터 변경 없음.
- 코드 커밋 `b04a3b5`. development 배포 버전 `7fd8cdaf-268c-45ce-9789-22f1dcbb4888`.
- `node scripts/cf114-live-smoke.mjs development`: 최초 실행 PASS. health/readiness 정상, 기존 Drive 연결 유지, 보호 경로 비인증 401, 공개 HTML/JS/CSS가 최신 빌드 SHA와 일치.
- URL: https://concost-claim-center-development.jjwwhhjj1116.workers.dev/es
- 현재 in-app 로그인 브라우저 연결을 사용할 수 없어 사용자 산출서 변경을 통한 라이브 E2E는 NOT_RUN. 격리 브라우저 검수와 공개 배포 확인을 실제 사용자 저장 검수로 표현하지 않는다. 가오픈·베트남 서버 및 DB 변경 없음.
