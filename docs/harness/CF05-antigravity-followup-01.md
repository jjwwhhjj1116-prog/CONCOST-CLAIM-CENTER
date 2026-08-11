# CF05 Antigravity Follow-up 01 — R2 제외 및 Google Drive 직접 저장

## 1. 사용자 결정

- 결정일: 2026-08-11
- Cloudflare R2 카드 등록, 결제 수단 등록, 구독 활성화: **수행하지 않음**
- 상태: `SKIPPED_BY_USER`
- 이 결정은 장애나 대기가 아니다. 기존 CF05 문서의 R2 Task A와 모든 `FILES` binding 지시는 폐기한다.
- 이후 R2 활성화를 다시 요청하거나 결제 화면으로 이동하지 않는다.

## 2. 현재 유지할 서비스

- 공개 Preview: `https://concost-claim-center-preview.jjwwhhjj1116.workers.dev`
- Cloudflare D1:
  - 회원 로그인 및 세션
  - 보고서 초안 자동 저장
  - 향후 파일 메타데이터와 동기화 상태
- 사용자 명단 원본, 평문 비밀번호, OAuth 비밀값은 Git·D1 평문·브라우저 DOM·로그에 기록하지 않는다.

## 3. 즉시 적용할 정직한 UI 계약

- Google Drive OAuth가 완료되기 전 파일 드래그앤드롭과 파일 선택 버튼은 비활성화한다.
- 화면에는 `Google Drive 연결 필요`와 `R2 미사용`을 명시한다.
- D1에 파일 원본을 BLOB 또는 base64로 저장하지 않는다.
- 저장소가 없는데 업로드 성공처럼 보이는 fake UI, 임시 성공 응답, 로컬 브라우저 영구 저장을 만들지 않는다.
- D1 로그인과 보고서 초안 저장은 계속 정상 제공한다.

## 4. 다음 구현 목표

Google Drive를 사건 자료의 원본 저장소로 직접 사용한다.

### Task A — 관리자 전용 Google OAuth 설정

- 설정 메뉴는 Admin만 조회·변경할 수 있다.
- Google OAuth 2.0 Authorization Code + PKCE(S256), 1회용 state, 짧은 TTL, exact redirect allowlist를 사용한다.
- 최소 권한 scope를 사용한다. 기본은 `https://www.googleapis.com/auth/drive.file`이다.
- Client Secret, token 암호화 키, access/refresh token은 Cloudflare Secret 또는 암호화된 서버 저장 경계 밖으로 노출하지 않는다.
- 동적 refresh token은 Web Crypto AES-GCM으로 암호화하고, 암호화 키는 Cloudflare Secret에만 둔다.
- OAuth 자격증명이 없으면 production endpoint는 503으로 fail-closed하고 fake 연결을 표시하지 않는다.

### Task B — 사건별 Drive 폴더 연결

- Admin이 조직 루트 폴더를 지정하고 사건별 하위 폴더를 만든다.
- 파일 경로는 표시 이름만 신뢰하지 말고 Google folder ID로 고정한다.
- 기본 분류는 `organization / case / YYYY / MM`이며 실제 사용자·조직·사건 권한을 서버에서 다시 검증한다.
- 사건 미배정 사용자와 타 조직 사용자는 목록, 업로드, 다운로드 모두 거부한다.

### Task C — 직접 업로드와 메타데이터

- 브라우저 → Cloudflare Worker → Google Drive 순서로 업로드한다.
- 파일당 최대 10MB, 허용 확장자와 magic-byte/MIME 일치, 빈 파일 거부, SHA-256 검증을 적용한다.
- D1에는 다음 메타데이터만 저장한다:
  - organizationId, caseId, evidenceId
  - originalName, mimeType, byteSize, sha256
  - uploadedAt(Asia/Seoul 표시), uploadedBy
  - googleFileId, googleFolderId
  - syncStatus, reconciliationStatus, createdAt
- 사용자가 요청한 날짜·시간·사용자 기록은 세션에서 서버가 채운다. 클라이언트 body 값은 신뢰하지 않는다.

### Task D — 원자성·재시도·복구

- Google Drive와 D1은 하나의 트랜잭션이 아니므로 idempotency key와 reconciliation 상태를 둔다.
- 응답 유실 시 같은 key로 재시도하고 Google file ID를 조회하여 중복 파일 0건으로 수렴한다.
- Google 성공 후 D1 실패는 `RECONCILIATION_REQUIRED`로 남기고 Admin 복구 화면을 제공한다.
- 401/403, 409, 429 Retry-After, timeout, 5xx를 구분한다.
- 외부 side effect가 불확실한 timeout은 자동으로 새 업로드를 반복하지 않는다.

### Task E — 자료실 UX

- 연결 완료 뒤에만 드래그앤드롭과 파일 선택을 활성화한다.
- 업로드 진행률, 완료, 오류, 재동기화, 파일명 말줄임, 날짜·시간·사용자를 표시한다.
- 1440/1024/640px, 키보드, 포커스, 200% 확대, 긴 파일명, 100개 이력을 검증한다.
- 성공보수 메뉴는 계속 숨기고, 관리자 설정은 Admin에게만 보인다.

## 5. 필수 보안 반례

1. OAuth state 재사용·만료·변조 차단
2. redirect URI open redirect 차단
3. OAuth secret/token의 API·DOM·URL·storage·로그·Git 노출 0건
4. 타 조직·미배정 사건 IDOR 차단
5. MIME 위조, 이중 확장자, 0B, 10MB 초과 차단
6. 같은 idempotency key 동시 업로드 중복 0건
7. Google 성공/D1 audit 실패 시 고아 상태 추적
8. 429 Retry-After bounded retry
9. timeout 뒤 늦은 provider 성공의 중복 방지
10. Admin이 아닌 사용자의 OAuth 설정·연결·해제 403
11. 파일 metadata의 uploadedBy/시간 클라이언트 위조 차단
12. Google Drive 연결 전 업로드 API와 UI fail-closed

## 6. 실행 및 제출 규칙

- 먼저 로컬 fake adapter와 결정론적 테스트로 구현한다.
- 실제 배포 직전 필요한 Google Cloud OAuth Client ID/Secret은 Git이나 채팅에 붙이지 않는다.
- 사용자가 Cloudflare Secrets 등록 단계에 도달했을 때만 정확한 등록 절차를 안내한다.
- 구현 완료 후 `lint`, `typecheck`, `test`, `cf:build`, security test, Chromium E2E, `wrangler deploy --dry-run`을 통과한다.
- 구현 커밋 A와 증거/상태 커밋 B를 분리하고 manifest changedFiles를 A의 diff-tree와 1:1 일치시킨다.
- R2 관련 리소스 생성, binding, 요금제 선택, 결제 요청은 금지한다.

## 7. Antigravity 다음 행동

1. 이 문서를 읽고 기존 R2 TODO를 전부 취소한다.
