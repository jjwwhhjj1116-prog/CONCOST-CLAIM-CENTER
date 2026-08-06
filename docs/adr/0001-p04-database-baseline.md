# ADR 0001: P04 데이터베이스 기준선과 PostgreSQL 전환 게이트

## 상태

Accepted — P04 local/CI harness 전용

## 결정

1. P04의 기준 데이터베이스는 실제 SQLite 파일이다. Prisma 6.19.3 스키마는 `packages/database/prisma/schema.prisma`, 최초 migration은 `packages/database/prisma/migrations/20260806070000_p04_baseline/migration.sql`에 둔다.
2. reset/migrate 실행기는 migration SQL을 `sql.js` SQLite 엔진에 적용한다. 이 선택은 Windows·Node 20·CI에서 별도 DB 서비스나 native addon 없이 동일한 SQLite 파일을 생성하기 위한 것이다. 애플리케이션 쿼리와 transaction은 Prisma Client가 실행한다.
3. `Organization`, `User`, `Role`, `UserRole`, `Session`, `CaseItem`, `CaseAssignment`, `Report`, `ReportSection`, `AuditLog`의 외래키 관계를 DB에 둔다.
4. `AuditLog` UPDATE/DELETE는 migration의 SQLite trigger가 거부한다. 주요 mutation과 감사로그 INSERT는 한 Prisma transaction에서 처리하여 감사기록 실패 시 본 mutation도 rollback한다.
5. 사건·보고서 조회 및 변경은 서버가 세션에서 복원한 조직·역할·배정 정보를 기준으로 판정한다. `version`은 optimistic lock, `deletedAt`은 soft-delete 필터로 사용한다.
6. `.data/**`, `*.db*`는 Git에서 제외하며 seed는 `example.invalid` 계정과 합성 데이터만 사용한다.

## PostgreSQL 전환 게이트

SQLite는 P04~P14의 로컬/CI 보안 하네스 기준이지 production DB 결정이 아니다. P15 이전에 다음을 완료하지 못하면 production 진입을 차단한다.

- PostgreSQL용 Prisma migration을 새로 생성하고 SQLite migration과 schema drift를 비교한다.
- SQLite의 동시 쓰기 잠금, DateTime 표현, boolean 표현, trigger 문법 차이를 제거한다.
- transaction isolation과 optimistic lock 부하 시험을 PostgreSQL에서 반복한다.
- PostgreSQL 권한 계정, TLS, 백업·복구, migration rollback, connection pool을 검증한다.
- append-only 감사로그 trigger를 PostgreSQL 문법으로 재구현하고 raw SQL 공격 테스트를 반복한다.

## 결과

P04는 실제 관계형 DB·외래키·trigger·transaction을 검증할 수 있다. 반면 SQLite 결과를 production 확장성이나 PostgreSQL 호환성의 증거로 사용해서는 안 된다.
