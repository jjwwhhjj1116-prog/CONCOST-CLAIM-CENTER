# P04 DB, Auth, Permissions & Audit Logging 구현 노트

## 주요 구현 내역
1. **`docs/adr/0001-p04-database-baseline.md` 수록 및 SQLite 하네스 DB 구축**:
   - SQLite 파일 DB(`packages/database/.data/harness.db`) 채택 및 Git 제외 처리.
   - P15 통합 보안/성능 단계 전 PostgreSQL 프로덕션 파이프라인 전환 게이트 명시.

2. **데이터베이스 스키마 & Append-Only AuditLog 구축**:
   - `Organization`, `User`, `Role` (`ceo`, `director`, `pm`, `staff`, `reviewer`, `admin` 6개 고정), `UserRole`, `Session`, `CaseItem`, `CaseAssignment`, `Report`, `ReportSection`, `AuditLog` DDL 수록.
   - `AuditLog` 테이블 레벨 `PreventAuditLogUpdate` & `PreventAuditLogDelete` DB Trigger 구축으로 UPDATE/DELETE 시도 시 DB가 100% 거부.
   - `version` 낙관적 잠금 (동시성 409) 및 `deletedAt` soft-delete 필터 구현.

3. **인증 및 서버 권한 API 구축 (`apps/api/src/server.ts`)**:
   - Scrypt 비밀번호 해싱 및 Opaque Session Token (DB SHA-256 저장, HttpOnly/SameSite=Strict cookie).
   - IDOR 및 조직/담당 사건 범위 검사 (`GET/PATCH /api/cases/:id`).
   - Reviewer RBAC 가드: 본문 직접 편집 403 Forbidden, 1차 승인 200 OK, 최종 병합 403 Forbidden.
   - CORS allow-list & Origin check.

4. **11대 품질·보안 게이트 통과**:
   - `install`, `db:reset`, `db:migrate`, `db:seed`, `lint`, `typecheck`, `test`, `build`, `test:e2e`, `test:security`, `audit` 통과.
