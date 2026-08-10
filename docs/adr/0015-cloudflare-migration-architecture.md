# ADR 0015: Cloudflare D1/R2 Migration Architecture & Invariant Preservation Plan

- **Status**: Proposed / Evaluation Only (Non-breaking for P15)
- **Deciders**: Technical Lead, Security Auditor, AI Systems Architect
- **Date**: 2026-08-10

## 1. Context and Problem Statement

클레임센터 보고서 스튜디오 서비스의 고가용성 및 엣지 서비스 확장을 위해 Cloudflare D1 (Database) 및 Cloudflare R2 (Object Storage)로의 이전을 검토하고 있습니다.
그러나 현재 본 프로젝트는 SQLite 수준의 불변성(Immutability) DB 트리거 (`BEFORE UPDATE`, `BEFORE DELETE` RAISE FAIL), Prisma 인터랙티브 콜백 트랜잭션(`db.$transaction(async (tx) => ...)`), 및 바이트 수준 DOCX/PDF 파서 검증을 핵심 보안 보장 계약으로 준수하고 있습니다.

따라서 단품 DB 교체는 기존 트랜잭션 원자성 및 트리거 가드 무결성을 파괴할 위험이 있으므로, P15에서는 실제 D1 전환을 보류하고 향후 전환을 위한 아키텍처 가이드라인 및 검증 체크리스트를 정립합니다.

## 2. Technical Invariant Analysis & Gaps

### 2.1 SQLite DB Triggers & D1 Invariants
- **현재 구조**: SQLite `BEFORE UPDATE` 및 `BEFORE DELETE` 트리거를 통해 `AuditLog`, `StatusHistory`, `DocumentVersion`, `GoogleResourceLink`, `GoogleImportSnapshot`, `GoogleSyncAttempt` 테이블의 영구 수정 및 삭제를 DB 엔진 레벨에서 원천 차단.
- **D1 제약 사항**: Cloudflare D1은 SQLite 기반이나 특정 미들웨어 레이어 및 다중 인스턴스 복제 과정에서 커스텀 C-Extension 기반 트리거 구문(e.g., `RAISE(FAIL, ...)`)의 동작 방식이 다를 수 있음.
- **대응 설계**: D1 적용 시 엣지 Worker 미들웨어 레벨의 Strict App-level Immutability Guard와 D1 Batch SQL Transaction을 병행 검증해야 함.

### 2.2 Prisma Interactive Callback Transactions vs D1 Batch SQL
- **현재 구조**: `db.$transaction(async (tx) => { ... })` 패턴으로 AI Gateway 토큰 정산, 검토-승인 상태 변경, 성공보수 수납 및 잔액 계산 시 원자적 격리 보장.
- **D1 제약 사항**: Cloudflare D1 HTTP API는 인터랙티브 트랜잭션(long-lived connection state) 대신 일괄 SQL Batch 실행(`env.DB.batch([...])`)을 권장함.
- **대응 설계**: 복잡한 비즈니스 로직을 원자적 D1 Batch 명령어 체인으로 변환하는 Adapter Abstraction Layer 구현 필수.

### 2.3 Object Storage Migration (Local File System -> Cloudflare R2)
- **현재 구조**: 로컬 영속 디스크 및 SHA-256 바이트 무결성 검증, `VACUUM INTO` consistent online backup.
- **대응 설계**: Cloudflare R2 버킷 전환 시 Multipart Upload 및 S3-compatible SHA-256 Checksum validation 적용.

## 3. Migration Readiness Checklist

- [ ] **Checklist 1**: SQLite Immutability DB 트리거 18개 전체의 D1 호환성 검증 스크립트 통과
- [ ] **Checklist 2**: Prisma Client D1 Driver Adapter (`@prisma/adapter-d1`) 원자적 트랜잭션 회귀 테스트 100% 통과
- [ ] **Checklist 3**: Cloudflare R2 S3-Compatible Storage Adapter 무결성 및 SHA-256 검증
- [ ] **Checklist 4**: 엣지 환경에서의 Node.js `crypto` / `stream` 버퍼 파싱 호환성 검증 (OOXML/PDF Parsers)
- [ ] **Checklist 5**: Backup & Restore 툴의 D1 Export / R2 Snapshot 연동 검증

## 4. Decision Outcome

P15 단계에서는 현재 검증된 SQLite online backup (`VACUUM INTO`) 및 로컬 영속 스토리지 백업/복구 시스템을 운용하며, D1/R2 전환은 상기 체크리스트 5종이 모두 완비되는 후속 단계에서 원자적으로 진행합니다.
