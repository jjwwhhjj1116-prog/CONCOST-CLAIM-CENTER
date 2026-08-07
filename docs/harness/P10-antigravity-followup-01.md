# P10 Antigravity 후속 지시 01 — 구현 전 보안·비용·상태 경계 보강

## 0. 현재 상태 확인

- 분기 기준 `b2ab327`과 브랜치 `feat/P10-ai-gateway`는 정확하다.
- `phase-status.json`의 P10 `IN_PROGRESS`, `nextPhaseAllowed: false` 변경은 아직 미커밋 상태다.
- Step 1 구현 전에 이 문서와 상태 변경만 별도 시작 커밋으로 먼저 고정한다.
- 이 문서는 구현 커밋 A의 `changedFiles` 및 manifest 대상에 넣지 않는다.

## 1. 모델 설계 필수 보정

1. `AiProviderConfig`에는 원문 키 칼럼을 만들지 않는다. 허용 필드는 `providerKind`, allowlist 검증된 `baseUrl`, `secretRef`, 허용 모델, timeout/retry/budget 정책과 공개 가능한 연결 상태뿐이다.
2. 사용자 지정 URL을 그대로 호출하지 않는다. HTTPS, DNS/IP 재검증, loopback/link-local/private/metadata IP 차단, redirect 재검증, port allowlist로 SSRF를 차단한다. Local Fake adapter는 네트워크를 사용하지 않는다.
3. 비용은 SQLite `REAL`/JavaScript 부동소수점으로 누적하지 않는다. 정수 `costMicros` 또는 동등한 최소 단위와 정수 token을 사용한다.
4. idempotency uniqueness는 최소 `(organizationId, caseId, actorId, idempotencyKey)` 범위로 DB에서 보장한다. 같은 키의 payload hash가 다르면 409다.
5. budget은 외부 호출 전에 원자적으로 예약하고 성공/실패/취소 후 정산한다. 동시 요청에서 한도 초과 호출과 이중 ledger가 생기면 안 된다.
6. `AiGenerationRequest`의 현재 상태가 필요하더라도 불변 request snapshot과 append-only event/attempt/ledger를 분리한다. 허용 상태 전이만 DB trigger와 API에서 동일하게 강제한다.
7. 취소·timeout·stream abort 후 late provider response가 SUCCESS나 추가 비용으로 덮어쓰지 못하도록 terminal-state compare-and-set을 둔다.
8. provider config, policy, request, attempt, ledger, audit의 조직·사건·actor FK 경계를 DB trigger로도 검증한다. 단순 불변 trigger 3개만으로는 부족하다.

## 2. Adapter·Gateway 필수 계약

- deterministic Fake adapter mode: `SUCCESS`, `BAD_KEY`, `TIMEOUT`, `RATE_LIMIT`, `SERVER_ERROR`, `MALFORMED_SCHEMA`, `STREAM_ABORT`, `USER_CANCEL`.
- retry는 429와 명시적 transient 5xx에만 적용하고 `Retry-After` 상한, 전체 deadline, 최대 시도 수를 강제한다. 401/403, schema 오류, budget/policy 거부, 사용자 취소는 재시도하지 않는다.
- provider 오류 body/header/stack을 API나 로그로 그대로 반환하지 않는다. 공개 error code와 redacted message만 저장한다.
- 연결 테스트도 generation과 같은 secret/SSRF/timeout/redaction 경계를 사용하고 원문 key를 반환하지 않는다.
- production API가 test용 mode 문자열로 실제 provider 결과를 조작하게 만들지 않는다. Fake adapter 선택은 명시적 providerKind와 test fixture로 제한한다.

## 3. P09 연동 금지선

- P10은 P09 revision, evidence, approval, merge snapshot을 직접 UPDATE하지 않는다.
- 우측 패널은 Gateway request 상태·비용·정책만 표시한다. AI 응답을 보고서 본문에 반영하는 기능은 P11이다.
- P09의 autosave, 409 무손실 복구, Reviewer read-only, 승인 잠금, approved-only merge를 그대로 회귀 검증한다.
- 브라우저가 provider key, secretRef 내부값, provider authorization header를 받거나 provider endpoint를 직접 호출하면 즉시 FAIL이다.

## 4. 시드·API·UI 보정

- 시드는 `LOCAL_FAKE` provider와 synthetic policy만 만든다. 실제 endpoint/key/customer text는 0건이어야 한다.
- `externalAiAllowed=false` 사건은 모델 목록, 연결, 생성, 재시도 어느 경로에서도 외부 provider 호출 0회다.
- Admin config API는 strict unknown-field/size/schema 검증과 optimistic version을 사용한다.
- 사용량 조회는 조직·사건·actor 권한으로 필터링하고 타 조직 ID를 404/403으로 숨긴다.
- 기존 `AI-01` 라우트와 P09 우측 패널을 실제 API에 연결하며 loading/empty/403/429/5xx/timeout/cancel/budget-exceeded/retry 상태를 실제로 복구 가능하게 표시한다.

## 5. 테스트 추가 조건

기존 계획의 테스트에 아래 반례를 반드시 추가한다.

1. private IP, loopback, metadata IP, DNS rebinding/redirect 형태 baseUrl 차단
2. dist/source map/log/API error/browser network/localStorage/sessionStorage에서 secret 0건
3. 같은 idempotency key 동시 10요청에서 provider 호출·ledger 1회
4. 같은 idempotency key의 다른 payload hash 409
5. budget 잔액 경계 동시 요청에서 초과 호출 0, 부동소수점 오차 0
6. cancel/timeout 뒤 late success 무시 및 terminal event/ledger 불변
7. 401/403/schema/cancel은 retry 0, 429/5xx는 bounded retry만 수행
8. AuditLog 강제 실패 시 config/policy/request/attempt/reservation/ledger orphan 0
9. 타 조직 config/request/attempt/usage IDOR와 다른 사건 prompt 주입 거부
10. 실제 Chrome에서 Admin 설정·연결 테스트 → 허용 사용자 요청 → cancel/429/budget 차단 → 복구, 1024px/focus/200%

`scripts/p10-e2e.ts`는 HTTP 전용이나 요소 부재 skip이 아니라 production build를 제공한 실제 Chrome 테스트여야 한다.

## 6. 제출 통제

- 정확한 11개 게이트를 clean checkout에서 순서대로 실행한다: install, db:reset, db:migrate, db:seed, lint, typecheck, test, build, test:e2e, test:security, audit.
- P06~P09 일반 85개, 보안 40개, Chrome P06~P09를 삭제·skip·완화하지 않는다.
- 구현 커밋 A와 READY_FOR_REVIEW/증거 커밋 B를 분리한다.
- manifest `changedFiles`는 구현 커밋 A의 `git diff-tree`와 1:1이어야 한다.
- Antigravity가 스스로 PASS 판정이나 P11 브랜치를 만들지 않는다.

## 7. 즉시 실행 순서

1. `phase-status.json`과 이 후속 지시서만 P10 시작 커밋으로 생성
2. DB migration/schema/seed 구현 및 DB 적대 테스트 우선 통과
3. adapter/gateway를 별도 모듈로 구현하고 fake failure matrix 통과
4. API strict boundary와 transaction/rollback 통과
5. AI-01/P09 UI 실제 연동 및 Chrome E2E
6. clean 11-gate 증거 작성 후 구현 A/상태 B 분리 제출
