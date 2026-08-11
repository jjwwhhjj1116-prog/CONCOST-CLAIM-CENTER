# Staging & Production Single-Volume Operations Runbook

## 1. Single Volume Root Directory Structure Matrix

P16 Release Candidate 운영 환경에서는 SQLite DB, 업로드 원본 스토리지, 최종 출력물, Google 암호화 Credential Vault, PKCE Vault, 및 백업 패키지를 단일 영속 Volume Root 아래 통합 관리합니다.

```
/var/data/claim-center-root (or packages/database/.data/production-root)
├── database/
│   ├── dev.db                          # SQLite Operational DB
│   └── dev.db-wal                      # WAL File
├── uploads/                            # User Upload Document Storage
├── outputs/                            # Final Approved DOCX/PDF Output Artifacts
├── google-credentials/                 # Encrypted Google Credential Vault
├── google-pkce/                        # Encrypted Google PKCE Verifier Vault
├── backups/                            # Production Backup Packages (READY state)
└── restores/                           # Isolated Target Restoration Test Area
```

## 2. Mandatory Production Environment Matrix & Secrets

| 환경변수 명 | 필수 여부 | 혜택 및 설명 | Fail-Closed 동작 |
|:---|:---:|:---|:---|
| `NODE_ENV` | **필수** | `production`으로 설정 시 Synthetic Seed, Fake Provider Mode, Test-only endpoint 비활성화 | 필수 가드 활성화 |
| `CLAIM_BACKUP_SIGNING_KEY_REF` | **필수** | 백업 패키지 HMAC-SHA256 마스터 서명키 32바이트 | 키 누락 시 백업 API 503 거부 |
| `GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY_REF` | **필수** | Google Credential & PKCE Vault AES-256-GCM 암호화 키 32바이트 | 키 누락 시 OAuth 기능 503 거부 |
| `DATABASE_URL` | 선택 | SQLite DB 접속 URL (`file:database/dev.db`) | 미설정 시 기본 경로 사용 |
| `UPLOAD_DIR` | 선택 | 업로드 저장 디렉터리 (`uploads/`) | 미설정 시 기본 경로 사용 |

## 3. Manual Backup, Verification & Recovery Drill Procedures

### Step 1: Manual Backup Package Creation
관리자는 API 엔드포인트를 호출하거나 CLI 스크립트를 통해 일관성 있는 원자적 백업 패키지를 생성합니다.
```bash
curl -X POST http://127.0.0.1:3001/api/admin/backup/create \
  -H "Content-Type: application/json" \
  -H "Cookie: session_token=<ADMIN_TOKEN>" \
  -H "X-CSRF-Token: <CSRF_TOKEN>" \
  -d '{"masterKey": "<BACKUP_MASTER_KEY>"}'
```
*결과*: `VACUUM INTO` 스냅샷 생성 후 `PREPARING` -> `READY` 원자 게시 완료.

### Step 2: SHA-256 Manifest Verification
생성된 백업 세트의 DB 및 파일 SHA-256 해시 무결성을 검증합니다.
```bash
curl -X POST http://127.0.0.1:3001/api/admin/backup/verify \
  -H "Content-Type: application/json" \
  -H "Cookie: session_token=<ADMIN_TOKEN>" \
  -H "X-CSRF-Token: <CSRF_TOKEN>" \
  -d '{"backupId": "BACKUP-20260811-xxx"}'
```

### Step 3: Isolated Target Restore Drill
**주의: 기존 운영 경로를 절대로 덮어쓰지 않습니다.** 복구는 반드시 별도의 독립된 디렉터리(`restores/isolated-restore-target`)에만 수행합니다.
```bash
curl -X POST http://127.0.0.1:3001/api/admin/backup/restore \
  -H "Content-Type: application/json" \
  -H "Cookie: session_token=<ADMIN_TOKEN>" \
  -H "X-CSRF-Token: <CSRF_TOKEN>" \
  -d '{
    "backupId": "BACKUP-20260811-xxx",
    "targetRestoreDir": "/var/data/claim-center-root/restores/drill-20260811",
    "masterKey": "<BACKUP_MASTER_KEY>"
  }'
```
*무결성 확인*: 복원된 DB에 대한 `PRAGMA foreign_key_check` 및 trigger 수, migration ledger 일치 확인.

### Step 4: Minimum 3 Retention Policy assertions
최소 3개 시점 이상의 READY 백업 세트가 보존되고 있는지 조회하며, 초과분에 대해 명시적 dry-run 조회를 수행합니다.
```bash
curl -X POST http://127.0.0.1:3001/api/admin/backup/prune-dry-run \
  -H "Content-Type: application/json" \
  -H "Cookie: session_token=<ADMIN_TOKEN>" \
  -H "X-CSRF-Token: <CSRF_TOKEN>" \
  -d '{"keepCount": 3}'
```

## 4. Monitoring & Fail-Closed Emergency Response

1. **Readiness Probe**: `/api/readiness`를 통해 DB writeability, Storage writeability, Backup Root 가용성을 주기적 헬스체크.
2. **Fail-Closed Strategy**: 필수 키 누락, DB 무결성 훼손, 스토리지 권한 누락 시 자동으로 `503 Service Unavailable`을 반환하여 훼손된 데이터의 2차 전파 차단.
