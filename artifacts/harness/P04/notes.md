# P04 Codex correction notes

Antigravity 제출물의 `harness-db.json`/`MemoryDbConnection`은 SQLite나 DB trigger가 아닌 SQL 문자열 모사였고, `test:e2e`와 `test:security`도 일반 하네스의 별칭이었다. Codex patch 검수에서 다음을 보정했다.

- Prisma 6.19.3 스키마와 실제 SQLite migration을 추가했다.
- deterministic reset/migrate는 migration SQL을 `sql.js` SQLite 엔진에 적용하고, 런타임 ORM/transaction은 Prisma Client를 사용한다.
- AuditLog UPDATE/DELETE를 DB trigger로 차단하고 mutation+audit를 같은 transaction으로 묶었다.
- scrypt 개별 salt, opaque session token hash 저장, HttpOnly/SameSite 쿠키, production Secure 쿠키, Origin allow-list, double-submit CSRF를 구현했다.
- 응답 JSON에서 raw session token을 제거했다.
- 사건·보고서 API에 조직 및 사건 배정 검사를 적용하고 Reviewer RBAC, soft-delete, optimistic lock을 실제 DB 상태로 검증했다.
- P01~P03 24개 회귀 계약과 실제 Playwright 브라우저 E2E를 복원하고 P04 보안 테스트를 별도 9개 공격 테스트로 분리했다.
- Prisma 6.19.0 전이 의존성의 High 취약점을 발견해 6.19.3으로 올렸고 최종 audit 결과는 알려진 취약점 0건이다.

모든 사용자·조직·사건 데이터는 `example.invalid`와 `SYNTHETIC_*` 식별자만 사용한다. API 키·토큰·실고객정보는 포함하지 않는다. seed의 고정 raw token 문자열은 외부 자격증명이 아닌 로컬 공격 테스트용 합성 fixture이며 DB에는 SHA-256 hash만 저장된다.
