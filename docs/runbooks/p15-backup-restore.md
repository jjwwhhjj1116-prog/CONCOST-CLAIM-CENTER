# P15 데이터 보존·백업·복구 운영 절차

## 목적과 보장 범위

보고서 스튜디오는 본문을 약 1.2초 디바운스 후 서버 DB에 자동 저장한다. 저장 완료 응답(HTTP 201)을 받은 개정본은 API 프로세스를 종료하고 같은 SQLite DB로 재시작해도 유지된다. P15 백업은 다음 항목을 하나의 서명된 복구 세트로 묶는다.

- SQLite 전체 스냅샷(`VACUUM INTO`)
- 업로드 원본 파일
- Google OAuth credential vault 파일
- Google PKCE verifier vault 파일
- 적용 migration ledger와 DB trigger SQL 해시

아직 자동 저장 요청을 보내기 전인 마지막 약 1.2초 이내 키 입력은 프로세스가 즉시 강제 종료되면 유실될 수 있다. 화면의 저장 완료 상태를 확인하거나 명시적 저장 버튼을 누른 뒤 종료한다.

## 운영 전 필수 설정

서명키와 credential master key는 요청 본문·DB·Git에 넣지 않는다. 서버 환경변수에는 실제 값이 아니라 `ENV_` 참조만 둔다.

```powershell
$env:CLAIM_BACKUP_SIGNING_KEY_REF='ENV_CLAIM_BACKUP_SIGNING_KEY'
$env:CLAIM_BACKUP_SIGNING_KEY='<64자리 hex 또는 32-byte base64url>'
$env:GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY_REF='ENV_GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY'
$env:GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY='<64자리 hex 또는 32-byte base64url>'
$env:GOOGLE_WORKSPACE_CREDENTIAL_VAULT_DIR='<영속 볼륨의 절대 경로>'
$env:GOOGLE_WORKSPACE_PKCE_VAULT_DIR='<영속 볼륨의 절대 경로>'
```

기본 백업 경로는 `packages/database/.data/backups`, 격리 복구 경로는 `packages/database/.data/restores`이다. 운영 배포에서는 DB·업로드·두 vault·백업 경로를 모두 같은 서버의 휘발성 디스크가 아닌 영속 볼륨에 둔다. 서명키를 잃으면 기존 백업은 검증·복구할 수 없으므로 별도 secret manager에 보관한다.

## 백업 절차

모든 엔드포인트는 로그인한 Admin만 호출할 수 있고 CSRF 보호를 적용한다.

1. `POST /api/admin/backup/create`에 빈 JSON `{}`을 전송한다.
2. 응답의 `backupId`, DB SHA-256, 파일 수를 기록한다. 클라이언트는 서명키나 파일 경로를 전달하지 않는다.
3. `POST /api/admin/backup/verify`에 `{ "backupId": "..." }`를 전송해 `valid: true`를 확인한다.
4. `GET /api/admin/backup/list`에서 최소 3개의 READY 백업이 유지되는지 확인한다.
5. 정리 전에는 `POST /api/admin/backup/prune-dry-run`으로 삭제 후보만 확인한다. `keepCount`는 3 미만일 수 없다.

백업 생성 중 실패한 `*-PREPARING` 디렉터리는 READY 백업으로 취급하지 않는다. manifest HMAC, DB/file 크기·SHA-256, 누락/추가 파일, migration/trigger 집합 중 하나라도 다르면 검증은 실패한다.

## 복구 훈련

운영 DB를 제자리에서 덮어쓰지 않는다.

1. 원본 서버를 쓰기 중지 또는 점검 모드로 전환한다.
2. `POST /api/admin/backup/restore`에 아래와 같이 논리 이름과 명시적 확인을 보낸다.

```json
{
  "backupId": "BACKUP-...",
  "restoreName": "drill-2026-08-11",
  "confirmation": "RESTORE"
}
```

3. 서버는 설정된 restore root 하위에만 새 디렉터리를 만들고, 기존 대상은 덮어쓰지 않는다.
4. 복구 DB에서 `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, migration ledger와 trigger 해시 검증이 모두 통과해야 한다.
5. 격리 API를 복구 DB와 `storage/uploads`, `storage/google-credentials`, `storage/google-pkce`에 연결한다.
6. 합성 계정으로 로그인하여 사건·보고서 개정본·업로드·Google 연결 메타데이터를 확인한다.
7. 승인 후에만 서비스 전환한다. 실패하면 복구 디렉터리를 폐기하고 기존 운영 경로를 유지한다.

## 장애 판단과 에스컬레이션

- `Backup signing key is not configured`: 배포 secret 참조 누락. 백업을 실행하지 말고 환경 구성을 복구한다.
- 서명/해시/파일 집합 불일치: 해당 백업을 사용하지 않는다. 다른 READY 세트를 검증한다.
- DB integrity/FK/migration/trigger 불일치: 서비스 전환 금지, incident로 기록한다.
- AuditLog 기록 실패: 생성 백업 또는 복구 디렉터리는 자동 제거된다. 원인을 고친 뒤 새 작업으로 재시도한다.
- OAuth 진행 중 서버 재시작: durable PKCE vault와 DB state가 같은 백업 세트에 있어야 한다. scope/state/TTL이 다르면 fail-closed로 재동의한다.

## 정기 검증

- 매일: 서명된 백업 생성 및 verify
- 매주: 최소 3세트 보존 확인 및 prune dry-run
- 매월: 별도 restore root에서 전체 복구 훈련
- 릴리스 전: `pnpm test:p15`, `pnpm test:security`, `pnpm test:e2e` 실행

