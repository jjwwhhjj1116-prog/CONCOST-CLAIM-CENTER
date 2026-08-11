# ADR-0016: 서명된 SQLite 스냅샷과 격리 복구

- 상태: Accepted
- 결정일: 2026-08-11
- 범위: P15 통합 품질·데이터 보존

## 배경

보고서 본문, 근거 자료, 승인 이력과 Google Workspace 연결 상태는 API 프로세스 수명보다 오래 유지되어야 한다. SQLite DB 파일을 실행 중 단순 복사하거나 업로드와 credential vault를 따로 복사하면 시점 불일치와 복구 불가능한 패키지가 생긴다. 클라이언트가 백업 키나 복구 경로를 선택하게 하는 것도 권한 상승과 경로 탈출 위험이 있다.

## 결정

1. DB 스냅샷은 Prisma가 연결한 같은 DB에서 `VACUUM INTO`로 생성한다.
2. DB, 업로드, credential vault, PKCE vault를 하나의 staging 디렉터리에 복사한 뒤 검증 완료 시 READY 이름으로 원자 rename한다.
3. manifest에는 DB·파일 크기/SHA-256, migration ledger, trigger SQL 해시를 기록하고 서버 전용 32-byte 키로 HMAC-SHA256 서명한다.
4. 복구는 설정된 restore root 아래 새 논리 이름으로만 허용하며 기존 경로를 덮어쓰지 않는다.
5. 복구 전에 서명, 정확한 파일 집합, DB integrity/FK, migration/trigger 집합을 모두 검증한다.
6. 백업·복구·정리 API는 Admin 전용이며 AuditLog 실패 시 생성물을 제거한다.
7. 최소 3개 READY 세트를 보존하고 자동 삭제 전 dry-run만 제공한다.
8. OAuth PKCE verifier는 프로세스 메모리 Map 대신 scope·state·TTL에 바인딩된 AES-256-GCM 파일 vault에 저장한다.

## 기각한 대안

- 실행 중 DB 파일 단순 복사: WAL/쓰기 시점 불일치 가능성이 있어 기각한다.
- unsigned JSON manifest: 파일과 manifest를 함께 바꾸는 변조를 탐지하지 못해 기각한다.
- 요청 body의 master key/절대 복구 경로: 비밀 유출과 임의 파일 쓰기 위험 때문에 기각한다.
- 운영 DB 제자리 복원: 복구 실패 시 원본까지 손상할 수 있어 기각한다.
- PKCE verifier 메모리 Map: 재시작 즉시 OAuth가 실패하므로 운영 구성에서 사용하지 않는다.

## 결과

백업은 DB 파일보다 크고 검증 비용이 추가되지만 복구 가능성을 자동 검증할 수 있다. Cloudflare/D1/R2 같은 원격 인프라 이전은 별도 ADR-0015에 따르며, 그 전까지는 DB·파일·vault·백업 경로를 영속 볼륨에 배치해야 한다.
