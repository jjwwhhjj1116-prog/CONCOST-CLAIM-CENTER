# CF123 ES v2 — 테스트 서버 배포 절차

이 문서는 실행 절차이며 배포 완료 증거가 아니다. 총괄만 원격 변경·배포를 실행한다. 이번 대상은 **테스트 서버 하나**이며 가오픈, 베트남 Node 서버, 기존 사용자 문서와 인증값은 변경하지 않는다.

## 고정 대상과 실제 배포 게이트

| 구분 | 값 |
| --- | --- |
| config | `wrangler.development.jsonc` |
| Worker | `concost-claim-center-development` |
| D1 binding / ID | `DB` / `16d1f25b-60c8-4489-95ed-4fa7de161c9f` |
| URL | `https://concost-claim-center-development.jjwwhhjj1116.workers.dev` |
| 유일한 새 migration | `0063_cf123_es_documents.sql` |
| Node 대응 파일 | `packages/database/prisma/migrations/20260908090000_cf123_es_documents/migration.sql` |

`cf:deploy:development`는 `cf:build` → web의 `tsc --noEmit && vite build` → Wrangler deploy 순서다. 전체 루트 `typecheck`/`build` harness는 호출하지 않는다. 반면 `pnpm build`는 루트 테스트 파일까지 포함한 전체 타입 검사를 먼저 실행한다. 기존 CF102/108~122/39 타입 오류 때문에 전체 검사가 실패한 상태를 PASS라고 기록하지 않는다. 실제 배포 스크립트의 게이트와 별개로 AGENTS의 타입 검수 결과·남은 기존 오류를 함께 기록해야 한다.

직접 `wrangler deploy`는 web을 다시 빌드하지 않는다. 최종 코드 SHA를 고정하고 개별 web/API/engine/Worker 타입 검사, 관련 회귀, `corepack.cmd pnpm cf:build`, development Worker dry-run을 먼저 통과시킨다. 단계 사이에 코드나 migration이 바뀌면 해당 검증을 다시 실행한다. 마이그레이션/백업 실패를 피하려고 검증 옵션을 생략하지 않는다.

## 1. 범위 확인과 사전 상태 기록 — 읽기 전용

명령은 저장소 루트에서 실행한다. Wrangler `4.120.1`의 로컬 도움말로 아래 명령을 확인했다. 작업 중 Wrangler 업그레이드는 하지 않는다.

```powershell
$cf123Repo = (Get-Location).Path
$cf123Db = '16d1f25b-60c8-4489-95ed-4fa7de161c9f'
$cf123Origin = 'https://concost-claim-center-development.jjwwhhjj1116.workers.dev'
$cf123Release = Join-Path $cf123Repo ('tmp/cf123-release-' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $cf123Release -ErrorAction Stop
$env:WRANGLER_LOG_PATH = Join-Path $cf123Release 'wrangler.log'
$env:WRANGLER_SEND_METRICS = 'false'
git status --short
git rev-parse HEAD
node node_modules/wrangler/bin/wrangler.js deployments list --config wrangler.development.jsonc --json
node node_modules/wrangler/bin/wrangler.js d1 migrations list DB --remote --config wrangler.development.jsonc
node node_modules/wrangler/bin/wrangler.js d1 execute DB --remote --config wrangler.development.jsonc --command "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 3; SELECT count(*) AS existing_table_count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'; SELECT name FROM sqlite_master WHERE name IN ('es_documents','es_revisions','es_runs','es_outputs','es_audit_events');" --json
```

모든 CLI 실행 직후 `$LASTEXITCODE`를 검사하고 0이 아니면 중단한다. 비대화형 `migrations apply`는 확인 질문 없이 **모든 pending migration**을 적용하므로, 목록이 정확히 0063 하나일 때만 다음 단계로 진행한다. 0063이 이미 적용되었거나 다른 migration/ES 테이블이 있으면 기존 배포 상태를 조사하고 이 최초 적용 절차를 재사용하지 않는다.

2026-09-08 읽기 전용 확인 결과: 현재 Worker 버전 `26d309d7-537e-4721-8e8c-76f6d5841e3b` 100%, 마지막 migration 0062, 기존 테이블 116개, ES 5개 테이블 없음, pending 0063 한 개. SELECT 모두 `changed_db:false`, `rows_written:0`이었다. 이 기록은 배포 직전에 갱신해야 한다.

## 2. 유지보수와 백업 — 총괄 실행, 원격 변경 포함

현재 Worker의 `RELEASE_MAINTENANCE=1`은 fetch 시작에서 **health/readiness·로그인·API·정적 페이지를 포함한 모든 요청을 503**으로 막는다. 배포 점검 중 health 503은 예상 결과다. Node API 프로세스 정지 대신 기존 CF121 D1 절차의 이 전면 차단을 사용한다. 현재 Worker 진입점에는 별도 scheduled/queue 핸들러가 없다.

단, 이미 시작된 옛 Worker 요청을 점검 플래그가 취소하지는 않는다. 사용자 작업 종료·저장 완료를 확인하고 진행 중 업로드/AI/저장을 안정화한 후 백업한다. 임의의 몇 초 대기만으로 완전한 쓰기 중지라고 주장하지 않는다. 이후 compare에서 기존 값이 달라지면 서비스 재개를 중단하고 유입 요청을 조사한다.

```powershell
corepack.cmd pnpm cf:build
node node_modules/wrangler/bin/wrangler.js deploy --config wrangler.development.jsonc --dry-run
node node_modules/wrangler/bin/wrangler.js deploy --config wrangler.development.jsonc --var RELEASE_MAINTENANCE:1
node node_modules/wrangler/bin/wrangler.js d1 time-travel info DB --config wrangler.development.jsonc --json
$cf123Before = Join-Path $cf123Release 'development-before.sql'
$cf123Manifest = Join-Path $cf123Release 'development-manifest.json'
node node_modules/wrangler/bin/wrangler.js d1 export DB --remote --config wrangler.development.jsonc --output $cf123Before
node scripts/cf123-backup-check.mjs sign $cf123Db $cf123Before $cf123Manifest
```

점검 배포 뒤 실제 `/health` 및 API가 `503 / RELEASE_MAINTENANCE`인지 읽기 전용으로 확인한다. export 대상 파일은 존재하지 않는 새 경로를 사용한다. 서명 출력의 `publicKeySha256`을 백업/manifest와 분리된 릴리스 기록에 보관하고 다음 명령에 그대로 넣는다. 이는 비밀키가 아니라 공개 검증 pin이다. 검증 시 같은 manifest에서 pin을 다시 읽어 신뢰를 순환시키지 않는다.

```powershell
$cf123Pin = '<앞서 별도로 기록한 64자리 publicKeySha256>'
node scripts/cf123-backup-check.mjs verify $cf123Db $cf123Before $cf123Manifest $cf123Pin
node scripts/cf123-backup-check.mjs preflight $cf123Db $cf123Before $cf123Manifest $cf123Pin
```

SQL export는 암호화된 AI/Google/국가법령정보 인증 레코드와 업무 데이터를 포함하는 **민감 백업**이다. 원문·SQL·복호화 결과를 콘솔/대화/Git/전달 ZIP에 넣지 않는다. 작업 디렉터리는 기존 접근 제한을 유지하고 backup/로그/격리 DB도 동일하게 취급한다. `cf123-backup-check.mjs`는 원격 통신 없이 counts/hash/고정 오류 코드만 출력한다. Ed25519 일회용 서명 개인키는 파일로 남기지 않는다. 기존 Worker master key·secret·Drive 파일을 교체하거나 동기화하지 않는다.

## 3. 격리 복원본에서 실제 Wrangler runner 적용 — 로컬만

`preflight`는 검증된 사본에서 로컬 SQLite 트랜잭션으로 예상 결과를 계산하는 검사다. **실제 Wrangler runner 검증을 대체하지 않는다.** 아래는 Wrangler로 빈 D1을 초기화한 뒤 서명된 백업을 Node SQLite로 복원하고 실제 runner로 첫 적용과 두 번째 no-op을 확인한다. 기존 CF121 복원 패턴과 같다. 전체 SQL을 `wrangler d1 execute --file`로 넘기는 방식은 로컬 검수에서 수 분 동안 완료되지 않아 중단했으며, 검증된 아래 방식을 사용한다. `--local`과 절대 `--persist-to`를 모두 유지한다.

```powershell
$cf123State = Join-Path $cf123Release 'isolated-runner'
if (Test-Path -LiteralPath $cf123State) { throw '격리 경로가 이미 존재합니다.' }
node node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config wrangler.development.jsonc --persist-to $cf123State --command "SELECT 1 AS initialized" --json
$cf123RestoredFiles = @(Get-ChildItem -LiteralPath $cf123State -Recurse -File -Filter '*.sqlite' | Where-Object Name -ne 'metadata.sqlite')
if ($cf123RestoredFiles.Count -ne 1) { throw '격리 D1 SQLite 파일을 하나로 특정하지 못했습니다.' }
node scripts/cf123-backup-check.mjs restore $cf123Db $cf123Before $cf123Manifest $cf123Pin $cf123RestoredFiles[0].FullName
node node_modules/wrangler/bin/wrangler.js d1 migrations list DB --local --config wrangler.development.jsonc --persist-to $cf123State
node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local --config wrangler.development.jsonc --persist-to $cf123State
# 적용 성공 및 pending 없음 확인 후 두 번째 실행: No migrations to apply.
node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local --config wrangler.development.jsonc --persist-to $cf123State
node scripts/cf123-backup-check.mjs compare $cf123Db $cf123Before $cf123Manifest $cf123Pin $cf123RestoredFiles[0].FullName
```

`restore`는 저장소 `tmp` 아래 실제 경로의 빈 `.sqlite`만 허용하고 기존 테이블이 있으면 쓰기 전에 거부한다. 부분 복원 실패 시 그 사본을 재사용하지 말고 새 격리 경로에서 다시 시작한다. `compare`는 integrity/FK, 기존 모든 행·값·스키마, 기존 migration 행, 새 원장 1행, 빈 ES 테이블 정확히 5개, 승인된 인덱스 1개·트리거 8개를 검사한다. application timestamp 이외의 원장 차이는 허용하지 않는다. Node/D1 migration 파일 내용도 동일해야 한다. 이 도구는 가오픈 DB ID를 거부한다.

## 4. 테스트 D1 적용과 배포 후 보존 검사 — 총괄 실행

```powershell
node node_modules/wrangler/bin/wrangler.js d1 migrations list DB --remote --config wrangler.development.jsonc
# pending이 정확히 0063 하나임을 다시 확인한 뒤에만 실행.
node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --remote --config wrangler.development.jsonc
node node_modules/wrangler/bin/wrangler.js d1 migrations list DB --remote --config wrangler.development.jsonc
$cf123After = Join-Path $cf123Release 'development-after.sql'
node node_modules/wrangler/bin/wrangler.js d1 export DB --remote --config wrangler.development.jsonc --output $cf123After
node scripts/cf123-backup-check.mjs compare $cf123Db $cf123Before $cf123Manifest $cf123Pin $cf123After
```

현재 새 테이블은 기존 구조를 변경하지 않는 additive migration이다. `d1 execute --file migration.sql`로 수동 우회 적용하지 않는다. 미적용 목록 검사와 실제 migration runner 원장을 유지한다. 실제 원격 compare가 실패하거나 수행되지 않았으면 모든 값 보존을 확인했다고 표시하지 않는다.

백업 검증이 통과한 **동일 코드/동일 dist**만 점검 해제 배포한다.

```powershell
node node_modules/wrangler/bin/wrangler.js deploy --config wrangler.development.jsonc --var RELEASE_MAINTENANCE:0
node node_modules/wrangler/bin/wrangler.js deployments list --config wrangler.development.jsonc --json
node scripts/cf114-live-smoke.mjs development
```

추가 실제 확인: `/es` 메뉴 → 문서 선택/독립 문서 → ES 편집 화면, `/health` 200, `/readiness` 200 및 Drive 연결 상태 유지, 비로그인 `/api/es/documents` 401, 관리자 AI/Google/국가법령정보 저장 여부·버전 메타데이터 유지. smoke의 공개 페이지/asset hash 일치는 로그인된 기능 검증이 아니다. 사용자 승인 범위 안의 별도 합성 ES 문서에서 생성·수정·저장·재진입·계산 실행·결과 재조회·선택 Excel/인쇄 대화상자를 검수한다. 실제 기존 업무 문서를 덮어쓰지 않는다.

## 실패와 롤백

어느 보존/무결성/권한 검사라도 실패하면 점검을 유지한다. `DROP`, 역방향 SQL, seed/reset, 기존 DB 교체, master key 교체를 실행하지 않는다. additive 테이블만 생성되고 기존 데이터가 보존됐다면 이전 **CF122 삭제 차단을 포함한** 코드로 되돌리거나 전진 수정하되 새 테이블/기록은 유지한다. CF122 이전 Worker는 이미 삭제된 보고서를 다시 노출할 수 있어 무조건 롤백하지 않는다.

데이터 훼손 시는 별도 복구 승인과 검증된 직전 backup/bookmark·동일 master key·이전 코드를 기준으로 복구 계획을 확정한다. Time Travel/DB restore는 업무 데이터를 되돌릴 수 있으므로 여기서 자동 실행하지 않는다. 배포 후 사용자 신규 입력이 있었다면 무조건 과거 시점으로 돌리지 않는다.

`cf:deploy:gaopen`, `cf:env:sync:*`, `wrangler secret bulk`, 가오픈 config 및 원격 `db:reset`/seed는 이 절차에 없다. 베트남 Node에는 대응 migration만 소스에 포함하며 실제 dev.db에는 적용하지 않는다.

## 로컬 도구 검수 기록

- 새 스크립트는 기존 `cf117-backup-check.mjs`의 서명·전체 값 보존 패턴을 사용하되 테스트 D1/0063/ES 5개 테이블로 제한한다. 기존 도구의 허용 범위를 넓히지 않았다.
- 0062 직후의 보존된 테스트 SQL 사본에서 sign/verify/preflight 통과: 기존 116개 테이블, 신규 5개 빈 테이블, 두 번째 적용 no-op. 이 사본은 현재 라이브 DB 백업이 아니므로 실제 배포 직후 새 백업 검증을 생략할 근거가 아니다.
- 별도 빈 로컬 D1 → 서명 복원 → 실제 Wrangler 4.120.1 runner의 0063 적용(15 commands) → 두 번째 `No migrations to apply!` → 실제 `.sqlite` compare를 모두 통과했다. 기존 116개 테이블의 모든 값·스키마 및 원장 보존, 신규 빈 ES 5개 테이블을 확인했다.
- 잘못된 pin, 가오픈 DB ID, migration 미적용 after 사본은 각각 `PUBLIC_KEY_PIN_MISMATCH`, `DEVELOPMENT_DATABASE_ONLY`, `EXACT_FIVE_NEW_TABLES`로 차단했다. 실패 출력에 SQL/업무 데이터/키 원문은 없다.
- 이번 담당 에이전트는 원격 SELECT·migration 목록·deployment 목록·Time Travel 정보만 조회했다. 원격 DB 변경·export·배포·secret 변경은 수행하지 않았다.
