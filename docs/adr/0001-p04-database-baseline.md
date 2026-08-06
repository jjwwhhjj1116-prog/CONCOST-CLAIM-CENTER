# ADR 0001: P04 데이터베이스 하네스 하위 시스템 및 PostgreSQL 프로덕션 전환 전략

## Status
Accepted

## Context
클레임센터 보고서 스튜디오의 P04 보안 및 백엔드 하네스 검증을 위해 외부 DB 서비스 설치 없이 즉시 결정론적(Deterministic) 재현이 가능한 데이터베이스 인프라가 필요합니다.

## Decision
1. **SQLite 하네스 채택**: P04 local/CI 개발 및 자동화 테스트 하네스로 SQLite 파일 DB(`packages/database/.data/dev.db`)를 사용합니다.
2. **PostgreSQL 프로덕션 전환 게이트**: 본 SQLite 설정은 P04~P14 하네스 단위 테스트 및 API 보안 공격 검증용이며, P15 통합 보안/성능 단계에서 PostgreSQL 및 Spanner/Cloud SQL 프로덕션 파이프라인으로 전환합니다.
3. **트리거 기반 Append-Only 감사로그**: DB 레벨에서 `AuditLog` 테이블의 `UPDATE` 및 `DELETE` 쿼리를 차단하는 SQL Trigger를 수록합니다.
4. **Git 제외 정책**: `.data/**` 및 `*.db*` 파일은 `.gitignore`에 등록하여 절대 버전 관리에 포함하지 않습니다.

## Consequences
- 로컬 및 CI 환경에서 `db:reset`, `db:migrate`, `db:seed` 명령으로 100% 동일한 DB 픽스처가 즉시 재생성됩니다.
- PostgreSQL 전용 JSONB 구문 및 시퀀스는 P15 전환 단계에서 추상화 레이어로 마이그레이션됩니다.
