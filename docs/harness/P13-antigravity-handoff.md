# P13 Antigravity 선행 구현 지시서 — 비용·성공보수

## 0. 진입 조건

- P12 판정: `PASS_WITH_NOTES`
- 기준 구현: `0d5e563bd26dc3b16f1e434d13bdb85daa697eb3`와 P12 검수·인계 커밋
- 원격 `feat/P12-review-approval-final-output`을 fetch/pull한 뒤 `feat/P13-fees-success-compensation` 브랜치를 만든다.
- 시작 커밋에서 `currentPhase: P13`, `P13.status: IN_PROGRESS`, `nextPhaseAllowed: false`로 변경한다.
- Codex P13 판정 전 P14 Google Workspace 또는 운영 credential 연동을 시작하지 않는다.

## 1. UI 우선 원칙 — 첫 번째 완료 산출물

이번 단계는 DB만 먼저 쌓고 화면을 마지막에 붙이지 않는다. 첫 구현 묶음에서 다음 수직 흐름을 실제 브라우저로 보여야 한다.

1. 기존 공통 placeholder인 `FEE-01 /success-fee`를 제거한다.
2. 로그인 → 성공보수 메뉴 → 사건 선택 → 계산 입력 → 예상 성공보수 → 입금·미수 현황 → 계산 이력까지 실제 API로 연결한다.
3. 1440px와 1024px에서 금액 카드, 입력 폼, 수납 내역, 미수 경고, 이력 표가 잘리지 않아야 한다.
4. loading/empty/error/403/stale 409/미수 종결 경고를 버튼으로 흉내 내지 말고 실제 API 상태로 표시한다.
5. 첫 기능 커밋 전에 production build를 띄워 실제 Chrome 화면을 확인하고 P13 E2E에 그 흐름을 고정한다.

## 2. 고정 업무 범위

- 계약금액
- 성공보수 적용 여부
- 기준 금액
- 요율
- 예상 성공보수와 최종 확정 성공보수
- 청구일, 입금일, 부분 입금
- 세금계산서 발행 상태·일자·식별번호의 안전한 메타데이터
- 미수금과 종결 가능 여부/경고
- 모든 입력값·계산 결과·승인·취소 이력

P14 Google Drive/Gmail/Calendar/Docs/Sheets 연동이나 회계 시스템 실제 전송은 범위 밖이다.

## 3. 금액·계산 계약

- 금액은 JavaScript floating number로 계산하지 않는다. DB와 API에서 원(KRW) 정수 또는 명시적 decimal을 사용한다.
- 요율 저장 단위를 고정한다. 권장: basis points 또는 millionths 정수. 표시값과 저장값 변환을 테스트한다.
- 공식, 과세 포함 여부, 반올림 단위와 방식(예: 원 단위 half-up)을 문서·API 응답·UI 도움말에 동일하게 명시한다.
- 예상값과 확정값을 구분하며 확정 후 기존 계산 row를 UPDATE하지 않는다.
- 0원, 음수, 매우 큰 금액, 소수 요율, 경계 반올림, 부분 입금, 초과 입금, 요율 변경, 취소를 처리한다.
- 동일 idempotency key와 동일 payload는 같은 결과, 다른 payload 재사용은 409다.

## 4. 데이터 모델·불변성

- additive migration으로 계약/성공보수 현재 projection과 append-only 계산·승인·수납 이력을 추가한다.
- 모든 row는 organizationId/caseId와 연결하고 cross-tenant/cross-case FK/trigger를 적용한다.
- calculation history, approval event, payment/adjustment event는 UPDATE/DELETE 불가다.
- 현재 합계는 이력에서 재구성 가능해야 하며 입력값, 공식 버전, 반올림 규칙, 결과, actor, timestamp를 보존한다.
- 취소·정정은 기존 row 변경이 아니라 반대 event 또는 새 version으로 남긴다.

## 5. 권한·종결 정책

- 성공보수 입력/수정: CEO, Director, PM만 가능하다.
- 최종 확정/승인: CEO, Director만 가능하다. 작성자 self-approval은 금지한다.
- Staff/Reviewer는 허용된 조회 외 금액 변경 API를 호출할 수 없다.
- 사건 배정, 조직 경계, Origin/CSRF, optimistic version을 모든 mutation에 적용한다.
- 미수금이 남은 사건의 `CLOSED` 전이는 서버에서 명시적 경고/확인 정책을 강제하고 AuditLog를 남긴다. UI 경고만으로 끝내지 않는다.

## 6. 실제 UI

- 상단: 계약금액, 기준금액, 적용 요율, 예상/확정 성공보수, 입금액, 미수금 KPI
- 본문: 사건 선택/검색, 계산식 미리보기, 권한별 편집/승인 버튼, 청구·세금계산서 정보
- 하단: append-only 계산 이력과 입금/정정 타임라인
- 금액은 한국어 locale과 원 단위로 표시하되 API raw 정수와 혼동하지 않는다.
- 긴 사건명, 100개 수납 이력, 0원, 매우 큰 금액, 200% 확대, keyboard/focus를 보존한다.
- primary nav에 노출되는 화면은 placeholder 상태로 제출하지 않는다.

## 7. 필수 적대 테스트

1. 음수 계약/기준/입금 금액과 0 미만·상한 초과 요율
2. 0원, 최대 허용 금액, 소수 요율, 반올림 경계
3. 부분 입금·초과 입금·중복 입금 idempotency
4. 요율 변경 후 이전 계산 이력 보존
5. 계산/승인/수납 row UPDATE·DELETE 시도
6. PM self-approval과 Staff/Reviewer 직접 mutation
7. 다른 조직·사건·계약·입금 IDOR
8. stale version과 동시 계산/승인/입금
9. 미수 상태 사건 종결 우회
10. AuditLog 실패 시 계산·수납·현재 projection 전부 rollback
11. API integer/decimal과 UI 표시값 불일치
12. 100개 이력, 긴 사건명, 1024px/200%/keyboard 브라우저 경계

## 8. 검증·제출

- 누적 11개 게이트: install, db:reset, db:migrate, db:seed, lint, typecheck, test, build, test:e2e, test:security, audit
- 기존 P06~P12 Chromium과 89 일반/43 보안 회귀를 삭제·skip·완화하지 않는다.
- `scripts/p13-contract-test.ts`, `p13-security-test.ts`, `p13-e2e.ts`를 누적 package script에 등록한다.
- `p13-e2e.ts`는 실제 production bundle에서 FEE-01 계산·승인·부분입금·미수 경고·권한 거부를 수행한다.
- 구현 커밋 A와 증거/READY_FOR_REVIEW 커밋 B를 분리하고 manifest `changedFiles`를 A의 `git diff-tree`와 1:1 일치시킨다.
- API key/token/private key/실고객정보와 DB/output/screenshot 임시 파일을 Git에 포함하지 않는다.

## 9. 실행 순서

1. P12 원격 동기화, P13 브랜치·시작 상태 커밋
2. FEE-01 최소 수직 흐름(API + 실제 화면 + production Chrome) 완성
3. additive 모델·migration·append-only 이력과 계산 엔진 강화
4. 승인·수납·미수·종결 경고와 RBAC/tenant/idempotency
5. 적대 contract/security와 실제 Chromium E2E
6. 깨끗한 checkout 11개 게이트, 구현 커밋 A, 증거/상태 커밋 B

Antigravity가 먼저 실제 화면이 보이는 수직 흐름을 구현하고, Codex가 독립 검수 후 남은 결함을 별도 보완 커밋으로 수정한다.
