# P05 Antigravity 실행 지시서 — 사건관리 코어

P04는 원본 저장소 Codex 보정 커밋 `c50d4f2` 기준 `PASS`다. Antigravity는 이 커밋과 P04 PASS 상태 커밋을 포함한 `feat/P04-db-auth-permissions-audit` 브랜치에서 P05를 시작한다. Codex가 P04에서 구축한 실제 DB·인증·권한·감사 경계를 우회하거나 모의 구현으로 되돌리면 안 된다.

## 1. 시작 절차

1. 원격 최신 상태를 가져오고 P04 PASS 상태 커밋을 확인한다.
2. `feat/P05-case-management-core` 브랜치를 새로 만든다.
3. `docs/harness/phase-status.json`의 `currentPhase`를 `P05`, P05 상태를 `IN_PROGRESS`, `nextPhaseAllowed`를 `false`로 설정한다.
4. 시작 상태 변경은 구현 커밋과 분리해 커밋한다.
5. P04 마이그레이션 파일을 수정하지 말고 P05 변경은 새 마이그레이션으로만 추가한다.

## 2. 필수 구현 범위

### 2.1 사건 데이터와 CRUD

- 실제 Prisma/SQLite 관계로 사건 생성·조회·수정·소프트 삭제를 구현한다.
- 사건 유형은 정확히 `TYPE-01`부터 `TYPE-06`까지만 허용한다. `TYPE-07` 또는 9개 템플릿 폴더명을 유형으로 승격시키지 않는다.
- 사건명, 사건번호, 설명, 조직, 담당자, 상태, 유형, 버전, 생성·수정·삭제 시각을 저장한다.
- 같은 이름의 사건을 허용하되 ID와 사건번호로 구분한다.
- 수정은 `version` 기반 낙관적 잠금을 사용하고 오래된 요청은 `409`로 거절한다.
- 소프트 삭제된 사건은 일반 조회·검색·KPI에서 제외한다.

### 2.2 관계자·기일·상태 이력

- 한 사건에 관계자 0명, 1명, 10명을 저장·조회할 수 있어야 한다.
- 관계자는 역할과 연락처 메타데이터를 가지며 동명이인을 별도 ID로 구분한다.
- 한 사건에 기일 0건, 1건, 100건을 지원한다.
- 기일은 `COURT`, `CLIENT`, `INTERNAL` 유형을 구분하고 Asia/Seoul 기준 D-day를 계산한다.
- 오늘 자정 경계, 과거 기일, 윤일과 월 경계에서 오프바이원 오류가 없어야 한다.
- 상태 변경은 허용된 전이만 가능하며 모든 이전/이후 상태, 수행자, 시각, 사유를 append-only 이력과 AuditLog에 남긴다.
- 보고서 제출 이후에도 판결·성공보수·종결 단계가 유지되는 상태 모델을 사용한다.

### 2.3 검색·대시보드

- 사건명, 사건번호, 관계자명에 대한 통합 검색을 서버에서 구현한다.
- 검색 결과는 로그인 사용자의 조직과 사건 배정 범위를 반드시 적용한다.
- 대시보드 KPI와 목록은 동일한 DB 쿼리 기준을 사용한다. 오늘 할 일, 지연, 진행 사건, 검토 문서 수치가 실제 목록과 일치해야 한다.
- 빈 상태, 로딩, 오류, 403, 긴 사건명, 동일 이름 사건을 UI에 실제 데이터로 연결한다.
- 기존 P03 20개 라우트와 P02 접근성·반응형 계약을 유지한다.

## 3. 보안·트랜잭션 불변조건

- 권한은 클라이언트 역할 값이 아니라 P04 세션과 DB 역할·조직·배정 관계로 서버에서 판정한다.
- 모든 변경 API는 Origin allow-list와 double-submit CSRF를 적용한다.
- 다른 조직 ID, 미배정 사건 ID, 삭제된 사건 ID, 추측한 관계자·기일 ID에 대한 IDOR를 차단한다.
- 관리자 API도 같은 조직 경계를 적용한다.
- 사건/관계자/기일/상태 변경과 AuditLog 기록은 하나의 Prisma 트랜잭션으로 처리한다. 감사 기록 실패 시 업무 변경도 롤백돼야 한다.
- AuditLog의 DB trigger와 P04 마이그레이션 불변성을 유지한다.
- 운영 키·토큰·실제 고객정보를 소스, 로그, fixture, DB 파일에 넣지 않는다. fixture는 `example.invalid` 기반 합성 데이터만 사용한다.

## 4. 필수 테스트

기존 30개 회귀 테스트를 모두 유지하고 P05 전용 계약·통합·보안 테스트를 별도 파일로 추가한다. 단순 문자열 확인이나 기존 테스트 별칭으로 대체하지 않는다.

- 사건 CRUD와 정확히 6개 유형
- 관계자 0/1/10명
- 기일 0/1/100건
- Asia/Seoul 오늘 자정, 과거 기일, 월·연도 경계
- 긴 사건명과 동일 이름 사건
- 상태 정상 전이와 불법 전이
- 상태 이력 및 AuditLog 원자성
- 낙관적 잠금 `409`
- 소프트 삭제 `404`와 검색/KPI 제외
- 교차 조직, 미배정, 하위 리소스 IDOR
- 클라이언트 역할 위조와 관리자 API 직접 호출
- 대시보드 KPI와 실제 목록의 수치 일치
- 실제 브라우저에서 사건 생성→관계자/기일 추가→상태 변경→검색→대시보드 반영

## 5. 품질·보안 게이트

깨끗한 설치 환경에서 아래 11개를 모두 실행한다.

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

`test:e2e`는 실제 브라우저와 실제 API/DB를 사용하고, `test:security`는 P04 및 P05 공격 사례를 실행해야 한다. 실패·skip·High/Critical 취약점은 허용하지 않는다.

## 6. 증거와 커밋 분리

1. `artifacts/harness/P05/manifest.json`, `notes.md`, `commands.log`를 만든다.
2. manifest `changedFiles`는 순수 구현 커밋 A의 `git diff-tree --no-commit-id --name-only -r <commit>`와 경로 집합이 정확히 일치해야 한다.
3. 순수 구현 커밋 A에는 Codex 검수 보고서와 phase 상태 변경을 넣지 않는다.
4. 상태 커밋 B에서 `P05.status: READY_FOR_REVIEW`, `nextPhaseAllowed: false`를 기록하고 `docs/reviews/requests/P05-review-request.md`를 만든다.
5. 구현 설명 대신 실제 명령 출력, 테스트 수, 실패 반례, 브라우저·DB 증거를 보고한다.

Antigravity가 먼저 구현하고 READY_FOR_REVIEW로 넘기면 Codex가 독립 검수한다. 필수 기준의 누락은 Codex가 patch 모드에서 별도 보정 커밋으로 수정한 뒤 다시 전체 게이트를 검증한다.
