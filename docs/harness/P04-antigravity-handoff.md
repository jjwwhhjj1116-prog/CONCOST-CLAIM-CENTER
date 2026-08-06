# Antigravity P04 실행 지시

## 기준점

- P03 Antigravity 구현 커밋: `d447a13`
- P03 Codex 보정·PASS 커밋: `ff23ae4436b43de856ae5b7c5ff3ad2dde544731`
- P03 판정: `PASS`
- P04 작업 브랜치: `feat/P04-db-auth-permissions-audit`
- 최상위 실행 지침: `01_ANTIGRAVITY_EXECUTOR_INSTRUCTIONS_v2.md`
- 권한 계약: `docs/product/permissions-matrix.md`
- 이 문서와 충돌하면 6대 유형·원본 템플릿 보호·서버 권한 불변조건이 우선한다.

P03의 역할 선택 UI는 데모용 클라이언트 상태다. P04 보안 판단에 이 값을 사용하지 말고, 서버가 발급한 세션에서 DB 사용자·역할·조직·사건 배정을 다시 조회해 모든 요청을 판정하라.

## 시작 절차

1. `ff23ae4`가 포함된 브랜치에서 `feat/P04-db-auth-permissions-audit`를 생성한다.
2. `phase-status.json`의 `currentPhase`를 `P04`, P04를 `IN_PROGRESS`로 바꾼 시작 상태 커밋을 먼저 만든다.
3. P00~P03 PASS 기록, Codex 보고서, 원본 Excel, `docs/보고서 템플릿/`을 수정하지 않는다.
4. 실제 고객정보·운영 계정·API 키·토큰을 코드, DB seed, fixture, 로그에 넣지 않는다.

## 데이터베이스 기준

1. `packages/database`에 Prisma 스키마, 최초 migration, deterministic reset/seed를 구현한다.
2. P04 local/CI 재현은 별도 서비스 없이 동작하는 SQLite 파일 DB를 사용하고 `.data/**`, `*.db*`는 Git에서 제외한다. 이는 P04 보안 하네스 기준이며 production PostgreSQL 완성으로 주장하지 않는다.
3. `docs/adr/0001-p04-database-baseline.md`에 SQLite harness 선택, PostgreSQL production 전환 필요성, 호환성 위험과 P15 이전 전환 게이트를 기록한다.
4. 최소 보안 관계를 실제 FK로 구현한다.
   - Organization, User, Role, Permission, UserRole/OrganizationMembership
   - Session(원문 토큰 저장 금지, token hash, expiresAt, revokedAt)
   - Case, CaseAssignment, Report, ReportSection
   - AuditLog
5. 역할 ID는 제품의 정확한 6개(`ceo`, `director`, `pm`, `staff`, `reviewer`, `admin`)만 사용한다.
6. `Case`, `ReportSection` 등 변경 엔터티에 `version`, `createdAt`, `updatedAt`, `deletedAt`을 두고 soft-delete 기본 필터와 낙관적 잠금(`WHERE id AND version`, 불일치 409)을 구현한다.
7. AuditLog는 append-only다. 애플리케이션 API에서 update/delete를 제공하지 않고 DB trigger로 UPDATE/DELETE도 거부한다. 주요 mutation과 감사로그는 한 transaction에서 성공/실패 경계를 유지한다.

## 인증·서버 권한 기준

1. `apps/api`에 실제 실행 가능한 HTTP API를 구현한다. 프레임워크 선택과 명령을 README/ADR에 기록한다.
2. 개발용 합성 계정 비밀번호도 평문 저장하지 않고 Node `scrypt`/동등 수준으로 hash+salt 처리한다.
3. 로그인 성공 시 cryptographically random opaque session token을 발급한다. DB에는 SHA-256 등 token hash만 저장하고 원문은 `HttpOnly`, `SameSite=Strict`, production `Secure` cookie로만 전달한다.
4. 로그인 실패, 만료, 폐기, 로그아웃, 비활성 사용자, role 변경 후 기존 세션을 처리한다. role 변경은 다음 요청부터 즉시 재평가한다.
5. 상태 변경 요청에는 Origin/CSRF 방어를 적용한다. CORS는 허용 origin allow-list로 제한한다.
6. 모든 보호 API는 서버 session에서 user/role/org를 읽고 IDOR와 조직·담당 사건 범위를 판정한다. body/header/query의 `role`, `userId`, `organizationId` 주입을 신뢰하지 않는다.
7. P03 UI는 `/auth/session` 응답으로 역할을 표시하도록 연결하되, 테스트 역할 전환 UI는 명백한 development-only 경계로 격리한다.

## 최소 API와 권한 증거

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/session`
- `GET /api/cases/:id` — 조직·담당 사건 범위 검사
- `PATCH /api/cases/:id` — 권한, soft-delete, version 충돌, audit transaction
- `DELETE /api/cases/:id` — soft delete만 허용
- `PATCH /api/reports/:reportId/sections/:sectionId/body` — Reviewer 명시적 403
- `POST /api/reports/:reportId/sections/:sectionId/approve` — Reviewer 지정 장 1차 승인 허용
- `POST /api/reports/:reportId/merge` — Reviewer 403
- `GET /api/audit-logs` — CEO/Director 범위/Admin만 허용
- admin role 관리 API — admin만 허용하고 변경 자체를 감사 기록

P05 CRUD 기능을 선행 완성하지 말고 위 보안 경계를 검증할 최소 합성 fixture와 endpoint만 구현한다.

## 필수 seed

- 조직 2개: `ORG-SYN-A`, `ORG-SYN-B`
- 각 조직의 합성 사용자와 정확한 6개 역할
- 배정 사건/미배정 사건/다른 조직 사건/soft-deleted 사건
- 정상 session, 만료 session, revoked session
- 동시성 검증용 Case/ReportSection version
- 이메일은 `example.invalid`, 사건명은 `SYNTHETIC_*`만 사용

## 필수 정상·공격 테스트

1. 정상 로그인/session/logout 및 잘못된 비밀번호/만료/폐기 session 거부
2. 다른 사건 ID 추측과 다른 조직 사건 GET/PATCH 403 또는 404
3. soft-deleted 데이터 조회·수정 거부
4. request body/header의 role/admin/user/org 변조가 권한을 바꾸지 못함
5. Reviewer: 업로드·장 승인 O, 본문 직접 편집·최종 병합 X
6. 일반 사용자의 admin API와 전체 감사로그 직접 호출 거부
7. 동일 version 동시 PATCH 두 건 중 하나만 성공하고 다른 하나 409
8. 주요 mutation 성공 시 actor/action/target/before/after/requestId/IP metadata 감사 기록
9. mutation 실패·권한 거부의 보안 감사 이벤트 정책과 민감값 마스킹
10. AuditLog UPDATE/DELETE를 Prisma/raw SQL 양쪽에서 시도해 DB가 거부
11. logout/role 변경 후 이미 열린 P03 탭의 다음 API 요청 거부 또는 즉시 권한 재평가
12. 세션 cookie 속성, CORS allow-list, Origin/CSRF 반례
13. DB reset+migration+seed를 두 번 실행해 동일하게 재현
14. `TYPE-07`과 9개 템플릿 폴더의 role/type 승격 거부, P01/P02/P03 24개 회귀 유지

각 반례는 주석·문자열 검색이 아니라 실제 DB/API 요청으로 실행한다. 서버가 없는 mock-only 테스트는 통과 증거가 아니다.

## 명령과 증거

다음 스크립트를 실제 동작하게 만든다.

```powershell
npx --yes pnpm@9.15.0 install --frozen-lockfile
npx --yes pnpm@9.15.0 db:reset
npx --yes pnpm@9.15.0 db:migrate
npx --yes pnpm@9.15.0 db:seed
npx --yes pnpm@9.15.0 lint
npx --yes pnpm@9.15.0 typecheck
npx --yes pnpm@9.15.0 test
npx --yes pnpm@9.15.0 build
npx --yes pnpm@9.15.0 test:e2e
npx --yes pnpm@9.15.0 test:security
npx --yes pnpm@9.15.0 audit --audit-level high
```

- `test:e2e`는 P03 브라우저 E2E와 실제 로그인/session 흐름을 유지한다.
- `test:security`는 위 공격 API/DB 테스트를 별도로 실행한다.
- `artifacts/harness/P04/manifest.json`, `commands.log`, `notes.md`에 stdout/stderr와 결과를 기록한다.
- 구현 커밋 A의 `git diff-tree`와 manifest `changedFiles`를 정확히 일치시킨다.
- 상태 커밋 B에서 P04를 `READY_FOR_REVIEW`로 바꾸고 `docs/reviews/requests/P04-review-request.md`를 작성한다.
- Codex 검수 보고서를 구현 커밋에 포함하지 않는다.

## 완료 보고

- 브랜치, 구현 커밋 A, 상태 커밋 B
- DB provider/ADR/migration/seed 경로와 reset 재현 결과
- API 실행 명령과 endpoint 목록
- 6개 역할·조직·담당 사건 권한표
- session/cookie/CSRF/CORS 정책
- append-only 감사로그와 soft delete/optimistic lock 증거
- 정상·공격 테스트 수 및 실제 HTTP/DB 반례 결과
- P01~P03 24개 회귀 결과
- 모든 품질·보안 게이트 결과
- 민감정보 검사 결과와 알려진 제한
- 증거 패키지와 Codex 검수 요청 경로

Antigravity 완료 후 Codex가 clean snapshot에서 DB reset, 실제 API, IDOR, 역할 변조, append-only, 동시성, cookie/CSRF를 독립 공격 검수하고 미달 부분을 직접 보정한다.
