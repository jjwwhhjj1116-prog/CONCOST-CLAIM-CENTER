# P10 Antigravity 선행 구현 지시서 — AI Gateway

## 0. 진입 조건과 브랜치

- P09 최종 판정: `PASS_WITH_NOTES`
- P09 검수 기준 커밋: `ceadc14e2cceba18697d6eacc62391b4218b3f8f`와 이 문서를 포함하는 후속 검수 증거 커밋
- 원격 `feat/P09-report-studio`를 fetch/pull한 뒤 새 `feat/P10-ai-gateway` 브랜치를 만든다.
- 시작 커밋에서 `currentPhase: P10`, `P10.status: IN_PROGRESS`, `nextPhaseAllowed: false`로 변경한다.
- Codex P10 판정 전에는 P11 브랜치·구현·PASS 문서를 만들지 않는다.

## 1. P10 고정 범위

v2 검수 지시서의 P10 AI Gateway만 구현한다.

1. 공급자 adapter와 server-side 연결 설정
2. 공급자별 연결 테스트, 모델 목록/선택, timeout/cancel
3. 사건 보안 등급과 외부 전송 허용 정책
4. 사용자·역할별 공급자/모델 사용 권한
5. 요청별 비용·token 한도와 누적 budget 통제
6. 생성 요청/응답 상태·사용량·비용·오류·취소 이력
7. bounded retry/backoff와 429/5xx/stream abort 복구
8. P09 우측 AI placeholder를 실제 Gateway 상태 UI에 연결하되 P11 근거 기반 본문 생성은 선행하지 않음

P11의 근거 기반 AI 작성, P12 DOCX/PDF 출력, 계산 엔진은 앞당기지 않는다.

## 2. 비밀정보·외부 전송 경계

- 공급자 키는 서버 환경/secret provider에서만 읽고 DB에는 암호화 또는 secret reference만 저장한다. 원문 키를 Git, DB 평문, 로그, AuditLog, 오류 스택, API 응답, 브라우저 bundle/source map/localStorage/sessionStorage에 남기지 않는다.
- 클라이언트가 공급자 endpoint/key/header를 직접 구성하거나 공급자 API를 직접 호출하면 실패다.
- 사건의 `externalAiAllowed=false` 또는 상응하는 보안 등급에서는 외부 모델 선택·연결·전송을 API와 DB 양쪽에서 거부한다.
- P01의 익명 inventory와 Git 제외 원본 32개를 공급자에게 자동 전송하지 않는다. 실제 고객정보·원본 document body의 default 전송도 금지하고 최소 필드 allowlist를 사용한다.
- 생성 로그에는 prompt/response 원문 대신 정책상 허용된 redacted metadata, hash, provider/model, actor, case, status, usage, cost, timestamps를 기록한다.

## 3. 데이터·DB 불변조건

- additive migration으로 provider configuration metadata, user/role permission, case AI policy, budget/usage ledger, generation request/attempt/event 모델 또는 동등 구조를 추가한다.
- 원문 secret 저장 칼럼을 만들지 않는다. secret reference의 조직 경계와 provider allowlist를 DB에서 검증한다.
- generation request와 각 attempt/event는 append-only이고 상태 전이는 유효한 순서만 허용한다.
- token/cost ledger와 AuditLog는 요청 상태 전이와 같은 transaction에 둔다. 비용 한도 초과·audit 실패 시 외부 호출 전 거부하거나 내부 orphan 0을 보장한다.
- idempotency key와 optimistic version으로 중복 제출·race·이중 비용 반영을 차단한다.
- P09 revision/evidence/approval/merge 모델을 UPDATE하여 AI 결과를 끼워 넣지 않는다.

## 4. 공급자 adapter 계약

최소한 mock/fake adapter를 포함한 공통 인터페이스로 다음을 동일하게 처리한다.

- connect/test credentials
- list/validate model
- generate 또는 stream
- timeout과 AbortSignal 사용자 취소
- 정상 usage/cost normalization
- 401/403 잘못된 키
- 429 + Retry-After
- 5xx 일시 장애
- 잘못된 응답 schema
- streaming 중단

실공급자 테스트는 실제 키를 증거 패키지에 넣지 않는다. CI/검수는 deterministic local fake provider로 모든 실패를 재현할 수 있어야 한다.

## 5. API·권한·감사

- Admin만 조직 공급자 설정·연결 테스트·model allowlist·budget을 관리한다.
- 일반 사용자는 자기 조직, 배정 사건, 허용 모델, 남은 budget 안에서만 generation request를 만들고 자기 권한 범위 이력을 조회한다.
- Reviewer/Director의 P09 승인 권한을 AI 공급자 설정 권한으로 확장하지 않는다.
- Origin, CSRF, session, tenant, assignment, soft-delete, strict unknown-field/size/schema 검증을 P09 수준으로 유지한다.
- provider configuration, model selection, policy 거부, 연결 테스트, generation start/finish/fail/cancel, budget 차단을 AuditLog에 남긴다. key/prompt/customer body는 기록하지 않는다.
- 타 조직 config/request/attempt/usage IDOR와 URL/body ID 바꿔치기를 각각 거부한다.

## 6. 실제 UI

- Admin 설정 화면에서 provider 상태, secret configured 여부(값 미표시), 연결 테스트, 허용 model, timeout/retry/budget을 실제 API로 관리한다.
- P09 우측 패널은 사건 정책, 허용 provider/model, 예상·누적 비용, 생성 상태를 표시한다.
- disabled/no-key/not-allowed/loading/streaming/success/429/5xx/timeout/cancel/budget-exceeded 상태를 실제 API 결과로 전환·복구한다.
- 브라우저 네트워크와 저장소에서 원문 key가 0건인지 실제 Chrome으로 검사한다.
- 1440px/1024px, keyboard/focus, 200% 확대와 P09 3단·autosave·승인 흐름을 보존한다.

## 7. 필수 적대·회귀 테스트

1. 정상 연결과 정상 generation usage/cost 기록
2. 잘못된 키, timeout, 429, 5xx, 응답 schema 오류, stream 중단, 사용자 취소
3. Retry-After/지수 backoff 상한과 무한 재시도 0
4. 요청·일일·사건·조직 비용 한도 초과 및 동시 race에서 외부 호출/과금 0 또는 1회
5. `externalAiAllowed=false` 사건과 권한 없는 사용자/모델의 외부 전송 0
6. Git, dist, source map, 로그, API JSON, 오류 stack, local/session storage, browser network response의 원문 secret 0
7. 타 조직 config/generation/usage IDOR와 다른 사건 자료 주입 거부
8. AuditLog 실패·adapter 실패·client disconnect 시 상태/ledger/idempotency orphan 0
9. 중복 idempotency key는 같은 결과를 반환하고 비용을 두 번 반영하지 않음
10. 실제 Chrome Admin 설정→연결 테스트→허용 사용자 요청→cancel/429/예산 초과→복구
11. P06~P09 일반 85개·보안 40개·실제 Chrome 회귀 삭제/skip/완화 금지

## 8. 제출 절차

깨끗한 checkout에서 다음 11개 게이트를 실행한다.

```powershell
npx --yes pnpm@9.15.0 install --frozen-lockfile
npx --yes pnpm@9.15.0 db:reset
npx --yes pnpm@9.15.0 db:migrate
npx --yes pnpm@9.15.0 db:seed
npx --yes pnpm@9.15.0 lint
npx --yes pnpm@9.15.0 typecheck
npx --yes pnpm@9.15.0 test
npx --yes pnpm@9.15.0 build
npx --yes pnpm@9.15.0 test:e2e
npx --yes pnpm@9.15.0 test:security
npx --yes pnpm@9.15.0 audit --audit-level high
```

- `artifacts/harness/P10/manifest.json`, `notes.md`, `commands.log`, `docs/reviews/requests/P10-review-request.md`를 만든다.
- 구현 커밋 A와 READY_FOR_REVIEW 상태·증거 커밋 B를 분리한다.
- manifest `changedFiles`는 구현 커밋 A의 `git diff-tree`와 경로·개수 1:1이어야 한다.
- 명령 출력은 요약 문구가 아니라 실제 exit code와 test 수를 기록한다.
- 실제 key·고객정보·원본 템플릿을 fixture나 증거에 넣지 않는다.
- Antigravity가 먼저 구현하고 Codex가 독립 재현·보정·판정한다.
