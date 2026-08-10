# P15 Antigravity 선행 구현 지시서

## 1. 진입 조건과 브랜치

P14 판정은 `PASS_WITH_NOTES`이며 P15 진입을 허용합니다.

1. 원격 `feat/P14-google-workspace-integration`의 최신 Codex 증거 커밋을 fetch합니다.
2. 새 브랜치 `feat/P15-integrated-quality`를 생성합니다.
3. `docs/harness/phase-status.json`의 P15를 `IN_PROGRESS`, `nextPhaseAllowed`를 `false`로 바꾸고 시작 커밋을 만듭니다.
4. P00-P14의 승인된 migration·snapshot·감사 이력을 다시 쓰거나 squash하지 않습니다.
5. 실제 고객자료, 실제 Google credential, 운영 API key는 사용하지 않습니다.

P15의 목적은 기능을 더 넓히는 것이 아니라 현재 제품 전체가 장애·대량 데이터·권한 공격·접근성 경계에서도 보존되고 복구되는지를 실제로 증명하는 것입니다.

## 2. 최우선 작업: 작업 중 데이터 보존·백업·복구

사용자가 작업 도중 PC·서버가 종료돼 보고서가 사라지는 상황을 우선 차단합니다.

### 2.1 영속 데이터 범위

다음을 하나의 recovery contract로 정의합니다.

- SQLite DB와 migration ledger
- 업로드 원본 및 DocumentVersion storage
- DOCX/PDF output artifacts
- 조직 범위 Google encrypted credential vault
- 보고서 autosave revision, 승인 snapshot, 최종화 artifact, AuditLog

### 2.2 구현 요구사항

- DB는 SQLite online backup 또는 `VACUUM INTO` 기반 consistent snapshot을 사용합니다. 실행 중 DB 파일의 단순 복사는 금지합니다.
- 파일 저장소와 vault는 manifest(`relativePath`, size, SHA-256, createdAt)를 생성합니다.
- backup set은 DB snapshot과 file manifest가 같은 backup ID를 사용하고 `PREPARING -> READY` 상태로 원자 게시합니다.
- restore는 새 빈 경로에서만 수행하고 기존 운영 경로를 덮어쓰지 않습니다.
- restore 전·후 migration ledger, FK, trigger 수, hash, report/revision/version/pointer를 검증합니다.
- backup 중 강제 종료, 파일 누락, hash 변조, DB snapshot 손상, 잘못된 master key, 부분 restore를 fail-closed 처리합니다.
- 최소 3개 시점의 backup retention과 명시적 prune dry-run을 제공합니다. 자동 삭제는 P15 범위에서 실행하지 않습니다.
- README에 로컬/Node 서버의 영속 디스크 경로, backup, restore, 복구 검증 절차를 적습니다.

Cloudflare 전환은 이번 단계의 실제 배포 대상이 아닙니다. D1은 현재 Prisma callback transaction과 SQLite trigger 의미를 그대로 보존하지 않으므로, 별도 adapter/원자성 재설계 없이 DB만 교체하지 않습니다. P15에는 Cloudflare 향후 전환 ADR과 검증 체크리스트만 작성합니다.

## 3. 통합 품질 매트릭스

다음 자동화 수트를 추가합니다.

- `scripts/p15-integration-test.ts`: P04-P14 핵심 API/DB 연결, rollback, snapshot, backup/restore
- `scripts/p15-security-test.ts`: 권한·tenant·secret·upload·AI prompt injection·provenance·동시성
- `scripts/p15-accessibility-test.ts`: keyboard, focus, dialog, landmark, label, contrast, 200%
- `scripts/p15-performance-test.ts`: 데이터 경계와 근거 있는 시간/메모리/query budget
- `scripts/p15-e2e.ts`: 신규 사건부터 최종 산출·성공보수·Google fake 연동·backup/restore까지 실제 Chromium

정상 사례만 세지 말고 각 기능에 최소 하나의 실패 반례를 포함합니다.

## 4. 보안·권한 필수 반례

1. 다른 조직·사건 URL 직접 접근
2. 배정 해제와 provider 호출 사이 TOCTOU
3. Admin/PM/Staff/Reviewer/Director/CEO 역할별 허용·거부 행렬
4. CSRF/Origin 누락, stale version, 동시 mutation, idempotency mismatch
5. raw access token, refresh token, authorization code, client secret, private key의 DB/API/log/DOM/URL/storage 노출
6. 다른 조직 Google `secretRef` 교체, revoke, purge 시도
7. 업로드 MIME/signature/double extension/path/oversize/hash 변조
8. AI prompt injection, 외부 전송 금지 사건, 잘못된 citation, 다른 사건 source
9. 승인 전 revision의 최종화·출력, 승인 snapshot 수정, 다운로드 hash 변조
10. 성공보수 반올림·부분입금·중복수납·미수 종결·종결 후 수정
11. backup archive path traversal, manifest 변조, 잘못된 vault key, partial restore

Critical/High 재현이 하나라도 있으면 P15를 제출하지 않습니다.

## 5. 접근성·브라우저

- Chrome과 Edge 계열 Chromium을 실제 실행합니다.
- 1440px, 1024px, 640px, 200% 확대에서 body horizontal overflow 0을 검증합니다.
- 모든 주요 작업을 키보드만으로 수행하고 focus가 dialog open/close, 오류, route change 후 예측 가능한 위치에 남는지 확인합니다.
- input label/name, button accessible name, table header, landmark, live region, error association을 검사합니다.
- automated accessibility scanner 결과의 Critical 0, Serious 0을 목표로 하고 예외는 근거와 수동 검증을 기록합니다.
- 120개 자료, 100개 이력, 200개 보고서 장, 180자 이름에서 ellipsis뿐 아니라 전체값 접근 경로를 검증합니다.

## 6. 성능·대량 데이터

synthetic fixture로 최소 다음을 측정합니다.

- 사건 1,000건
- 기일 10,000건
- 문서/버전 10,000건
- 보고서 장 200개
- Google resource 1,000개 및 sync history 1,000개
- 긴 표·이미지를 포함한 DOCX/PDF
- AI streaming 중 편집기 입력·autosave

각 측정은 장비, Node/DB 버전, warm/cold 조건, p50/p95, peak memory, DB query 수를 기록합니다. 근거 없는 `PASS`나 임의 수치 하향은 금지합니다. 성능 목표 미달은 severity와 사용자 영향에 따라 수정하거나 명시적 note로 남깁니다.

## 7. P14 notes 해소

- PKCE verifier를 organization/actor/state/TTL에 바인딩된 durable encrypted store로 이전합니다.
- 재시작과 2개 API 인스턴스 사이 callback 성공, state reuse 실패를 테스트합니다.
- 실제 Google staging 계정 테스트는 credential 권한이 별도로 제공될 때만 수행합니다. 권한이 없으면 synthetic transport 검증을 유지하고 명확한 운영 runbook을 작성합니다.
- Node file vault의 persistent disk 경로와 master-key rotation/restore 절차를 검증합니다.

## 8. 품질 게이트

깨끗한 Node 20.18.0 / pnpm 9.15.0 checkout에서 다음 11개를 순서대로 실행합니다.

1. `pnpm install --frozen-lockfile`
2. `pnpm db:reset`
3. `pnpm db:migrate`
4. `pnpm db:seed`
5. `pnpm lint`
6. `pnpm typecheck`
7. `pnpm test`
8. `pnpm build`
9. `pnpm test:e2e`
10. `pnpm test:security`
11. `pnpm audit --audit-level high`

P15 전용 focused 수트와 backup/restore drill 결과도 별도로 기록합니다.

## 9. 제출물과 커밋 분리

구현 커밋 A에는 실행 코드·migration·테스트·runbook만 포함합니다.

증거/상태 커밋 B에는 다음만 포함합니다.

- `artifacts/harness/P15/manifest.json`
- `artifacts/harness/P15/commands.log`
- `artifacts/harness/P15/notes.md`
- `docs/reviews/requests/P15-review-request.md`
- `docs/reviews/requests/P15-review-request.json`
- `docs/harness/phase-status.json`

`manifest.changedFiles`는 구현 커밋 A의 `git diff-tree --no-commit-id --name-only -r` 결과와 정확히 일치해야 합니다. 증거 커밋에 실행 코드나 테스트 수정이 들어가면 제출 무효입니다.

P15 완료 시 상태는 `READY_FOR_REVIEW`, `nextPhaseAllowed: false`로 제출합니다. Codex의 PASS/PASS_WITH_NOTES 전에는 P16에 진입하지 않습니다.
