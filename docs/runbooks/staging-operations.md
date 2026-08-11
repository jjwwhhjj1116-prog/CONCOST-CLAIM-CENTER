# Staging operations runbook

P16의 목표는 개발 PC가 꺼지거나 API 프로세스가 재시작돼도 사건, 보고서 본문, 업로드, 최종 출력, Google 자격 증명 및 백업이 사라지지 않는 운영 구조를 고정하는 것입니다. Cloudflare/Render 배포는 이 단계에서 수행하지 않습니다.

## 1. 단일 영속 볼륨

운영 서버는 절대 경로인 `CLAIM_VOLUME_ROOT` 하나를 마운트합니다.

```text
<CLAIM_VOLUME_ROOT>/
  database/claim-center.db
  storage/                    # 업로드와 승인된 DOCX/PDF 출력
  google-credentials/         # AES-256-GCM 암호화 OAuth 자격 증명
  google-pkce/                # 암호화 PKCE verifier
  backups/                    # 서명된 READY 백업 패키지
  restores/                   # 운영 경로와 분리된 복구 훈련 대상
```

운영 시작 시 다음 값이 모두 필요합니다.

| 환경 변수 | 용도 |
|---|---|
| `NODE_ENV=production` | fake/test 기능 비활성화와 secure cookie 강제 |
| `CLAIM_VOLUME_ROOT` | 위 구조의 절대 경로 |
| `CLAIM_ALLOWED_ORIGINS` | 쉼표로 구분한 정확한 웹 origin. 와일드카드 금지 |
| `CLAIM_BACKUP_SIGNING_KEY_REF=ENV_<NAME>` | 32바이트 백업 서명 키를 참조하는 이름 |
| `GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY_REF=ENV_<NAME>` | 32바이트 credential/PKCE 암호화 키를 참조하는 이름 |

키 원문, 고객 본문, 로컬 절대 경로는 Git·API 응답·로그에 기록하지 않습니다. 루트나 키가 하나라도 없거나 루트 밖 경로가 섞이면 서버는 시작을 거부합니다.

## 2. 시작 및 상태 확인

1. 영속 볼륨을 마운트합니다.
2. `pnpm db:migrate`를 실행합니다. 운영 데이터에 `db:reset` 또는 synthetic seed를 실행하지 않습니다.
3. API를 시작합니다.
4. `GET /health`는 프로세스 생존만 확인합니다.
5. `GET /readiness`가 HTTP 200이고 아래 5개 값이 모두 `true`인지 확인합니다.
   - `databaseWritable`
   - `migrationsUpToDate`
   - `storageWritable`
   - `backupRootWritable`
   - `restoreRootWritable`

readiness 503이면 트래픽을 연결하지 않습니다. 응답에는 경로와 비밀값이 포함되지 않습니다.

## 3. 백업·검증·격리 복구 훈련

아래 API는 Admin 세션 쿠키와 CSRF 헤더가 필요합니다. 키는 요청 본문으로 보내지 않습니다.

```bash
curl -X POST "$API_ORIGIN/api/admin/backup/create" \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF" \
  -H "Cookie: session_token=$SESSION; csrf_token=$CSRF" -d '{}'

curl -X POST "$API_ORIGIN/api/admin/backup/verify" \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF" \
  -H "Cookie: session_token=$SESSION; csrf_token=$CSRF" \
  -d '{"backupId":"BACKUP-..."}'

curl -X POST "$API_ORIGIN/api/admin/backup/restore" \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF" \
  -H "Cookie: session_token=$SESSION; csrf_token=$CSRF" \
  -d '{"backupId":"BACKUP-...","restoreName":"monthly-drill-YYYYMMDD","confirmation":"RESTORE"}'

curl -X POST "$API_ORIGIN/api/admin/backup/prune-dry-run" \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF" \
  -H "Cookie: session_token=$SESSION; csrf_token=$CSRF" -d '{"keepCount":3}'
```

복구 결과는 반드시 `restores/` 아래에서만 열고 운영 DB 위에 덮어쓰지 않습니다. 검증 항목은 manifest 서명·파일 SHA-256·SQLite `foreign_key_check`·migration ledger·핵심 사건/보고서 조회입니다.

## 4. 장애 대응

- DB 또는 디렉터리가 read-only이면 readiness 503 상태로 유지하고 마운트 권한을 복구합니다.
- migration checksum/count가 다르면 배포를 중단하고 적용 이력과 배포 커밋을 비교합니다. 기존 migration 파일을 수정하지 않습니다.
- 디스크 부족이나 백업 실패 시 기존 READY 백업을 보존하고 새 패키지를 운영 백업으로 승격하지 않습니다.
- OAuth/PKCE 키 분실 시 임의 키로 재암호화하지 않고 재동의 절차를 진행합니다.
- API 재시작 후 readiness와 최근 사건·보고서·출력 다운로드를 확인한 뒤 트래픽을 복구합니다.
