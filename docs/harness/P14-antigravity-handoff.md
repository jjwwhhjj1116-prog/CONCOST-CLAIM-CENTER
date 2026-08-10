# P14 Antigravity 선행 구현 지시서

## 1. 진입 조건과 작업 원칙

P13 판정은 PASS_WITH_NOTES이며 P14 진입을 허용합니다.

Antigravity는 원격 feat/P13-fees-success-compensation의 최신 검수·증거 커밋을 fetch한 뒤
새 브랜치 feat/P14-google-workspace-integration을 생성해 즉시 작업을 시작합니다.
P13 구현이나 migration을 다시 작성하지 않습니다.

P14의 목표는 Google Workspace 연동을 사용자가 실제 화면에서 이해하고 통제할 수 있는
하나의 수직 슬라이스로 만드는 것입니다. 실제 Google 운영 자격증명, 실제 고객자료,
실제 메일·Drive·Calendar 데이터는 개발 및 CI에 사용하지 않습니다.
먼저 결정론적 fake adapter를 완성하고, 실제 provider 연결은 별도 환경 변수와 secret reference로만 엽니다.

## 2. 필수 사용자 흐름

1. Admin은 연결 상태, 승인 scope, 만료, 재동의 필요, 연결 해제를 UI에서 확인합니다.
2. 사건 생성 후 같은 요청을 재시도해도 Drive 사건 폴더는 하나만 만들어집니다.
3. CASE-06에서 사용자가 선택한 Gmail 첨부만 P06 자료 저장소로 가져옵니다.
4. CASE-04에서 추출된 날짜 후보를 사람이 확인한 뒤에만 Calendar 일정을 생성합니다.
5. MEET-01의 선택된 회의록 버전만 Google Docs로 내보냅니다.
6. 사용자가 명시적으로 선택한 Sheets 범위만 snapshot으로 가져오고 provenance를 보존합니다.
7. 401, 403, 429, 5xx, timeout, token 만료, 재동의, 연결 해제 실패를 화면에서 구분하고 재시도 경로를 제공합니다.
8. Google 연결을 해제해도 이미 저장된 내부 사건·자료·회의록·보고서 snapshot은 손상되지 않습니다.

## 3. 서버·DB 계약

다음 모델을 additive migration으로 설계합니다.

- GoogleWorkspaceConnection: organization, provider status, granted scopes, secretRef, token expiry, version
- GoogleOAuthState: state hash, PKCE verifier reference, redirect target, one-time usedAt, expiry
- GoogleSyncOperation: organization, case, operation kind, idempotency key, request fingerprint, status
- GoogleSyncAttempt: attempt number, redacted error, response class, retryAt, duration
- GoogleResourceLink: internal entity와 external resource ID의 immutable mapping
- GoogleImportSnapshot: 선택한 Gmail/Sheets/Docs 원본의 hash, version, provenance

원문 access token, refresh token, authorization code, client secret은 DB·API·로그·브라우저 저장소에 저장하지 않습니다.
DB에는 서버 secret provider의 reference만 저장합니다.
state는 hash로 저장하고 one-time 사용, TTL, organization, actor, redirect allowlist를 강제합니다.
모든 mutation은 Origin, CSRF, RBAC, 조직·사건 배정, strict schema, optimistic version,
scoped idempotency와 AuditLog 원자성을 적용합니다.

같은 사건·작업·payload·idempotency key의 동시 요청은 하나의 operation과 resource로 수렴해야 합니다.
Drive folder, Calendar event, Docs export를 중복 생성하면 안 됩니다.

## 4. adapter와 보안 경계

apps/api/src/google-workspace/에 provider-neutral interface와 deterministic fake adapter를 만듭니다.
fake 모드는 최소 다음을 포함합니다.

- SUCCESS
- DUPLICATE_REPLAY
- BAD_SCOPE
- TOKEN_EXPIRED
- RECONSENT_REQUIRED
- RATE_LIMIT_RETRY_AFTER
- SERVER_ERROR
- TIMEOUT
- USER_CANCEL
- MALFORMED_PROVIDER_RESPONSE
- REVOKE_FAILURE

실제 adapter의 base URL과 redirect URI는 allowlist로 제한합니다.
SSRF 방어는 P10과 같은 수준으로 적용하고 redirect chain도 매 단계 검증합니다.
provider 오류 메시지는 redaction 후 저장하며 raw response와 token을 로그로 남기지 않습니다.
retry는 429 및 일시적 5xx에만 bounded backoff를 사용하고 401, 403, 취소, validation 오류는 재시도하지 않습니다.

OAuth는 Authorization Code와 PKCE를 사용합니다.
브라우저 localStorage, sessionStorage, URL query, DOM에 token이나 secret을 노출하지 않습니다.
callback은 state, PKCE, TTL, one-time use, organization과 actor binding을 검증한 뒤
허용된 내부 경로로만 redirect합니다.

## 5. 실제 UI 요구사항

AI-01 또는 별도 Admin integration 화면에 다음을 구현합니다.

- 연결됨, 만료 임박, 재동의 필요, 해제됨 상태 badge
- 승인된 scope 목록과 필요한 최소 scope 설명
- 연결 테스트, 재동의, 연결 해제 버튼
- 진행 중, 성공, 재시도 가능, 실패 상태와 최근 동기화 이력

CASE-04, CASE-06, MEET-01 및 필요한 사건 화면에는 다음을 실제 API로 연결합니다.

- Drive 폴더 열기와 생성 상태
- Gmail 첨부 선택 목록, 선택적 가져오기, 중복 방지 결과
- 날짜 후보의 출처·신뢰도·원문 위치와 사람 확인 checkbox
- Calendar 일정 preview와 생성 결과
- 회의록 버전 선택, Google Docs export 결과
- Sheets 파일·탭·범위 선택과 snapshot provenance

1024px와 640px, 200% 확대, 키보드, focus, dialog, loading, empty, error, 403,
409, offline/retry 상태를 지원합니다. 화면에 실제 token이나 provider raw error를 표시하지 않습니다.

## 6. 필수 적대 테스트

최소 다음 반례를 자동화합니다.

1. OAuth state 재사용
2. 만료 state와 다른 actor/organization의 callback
3. redirect allowlist 우회
4. token·authorization code·client secret의 DB/API/log/browser 노출
5. 동일 Drive 폴더 동시 생성
6. 동일 Calendar 일정 응답 유실 후 재시도
7. 사용자가 선택하지 않은 Gmail 첨부 가져오기
8. 사람 확인 없는 날짜 후보 일정 생성
9. 다른 사건·조직의 Gmail/Drive/Calendar/Docs/Sheets resource IDOR
10. 429 Retry-After와 bounded retry
11. 401/403/취소의 재시도 0회
12. AuditLog 실패 시 내부 snapshot과 external operation projection rollback
13. 연결 해제 뒤 내부 데이터 보존
14. localStorage, sessionStorage, URL, DOM token 0건
15. 120개 이상 resource 검색, 100개 동기화 이력, 긴 이름 경계
16. 실제 Chromium에서 연결→폴더→첨부→일정→Docs/Sheets→해제 흐름

DB raw write로 cross-tenant mapping, 중복 resource, terminal operation 변조,
append-only snapshot 변경을 시도하는 반례도 포함합니다.

## 7. 품질 게이트와 제출 형식

다음 11개 게이트를 고정 Node 20.18.0, pnpm 9.15.0의 깨끗한 checkout에서 실행합니다.

1. install --frozen-lockfile
2. db:reset
3. db:migrate
4. db:seed
5. lint
6. typecheck
7. test
8. build
9. test:e2e
10. test:security
11. audit --audit-level high

구현 커밋 A와 증거·상태 커밋 B를 분리합니다.
구현 커밋의 git diff-tree와 artifacts/harness/P14/manifest.json changedFiles는 정확히 일치해야 합니다.

필수 제출물:

- artifacts/harness/P14/manifest.json
- artifacts/harness/P14/commands.log
- artifacts/harness/P14/notes.md
- docs/reviews/requests/P14-review-request.md
- docs/harness/phase-status.json

phase-status는 작업 시작 시 P14 IN_PROGRESS, 제출 시 P14 READY_FOR_REVIEW와 nextPhaseAllowed false로 기록합니다.
실제 API 키·토큰·고객자료가 1건이라도 발견되면 제출하지 말고 즉시 제거한 뒤 전체 게이트를 다시 실행합니다.

## 8. 완료 보고 형식

최종 보고에는 브랜치, 구현 커밋 A, 상태·증거 커밋 B, 정확한 changedFiles,
11개 게이트의 실제 수치, 적대 테스트별 결과, Chromium에서 확인한 사용자 흐름,
알려진 제한, 증거 경로를 포함합니다.

계획 승인 대기를 요청하지 말고 위 범위 안에서 구현을 진행합니다.
범위를 넓히거나 실제 Google 운영 자격증명을 사용해야 하는 경우에만 중단하고 사용자에게 권한을 요청합니다.
