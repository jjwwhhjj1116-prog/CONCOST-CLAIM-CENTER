# P13 Codex 독립 검수 보고서

## 1. 판정

PASS_WITH_NOTES

Antigravity 원 제출은 권한, 독립 승인, 금액 정확성, 멱등성, 종결 불변성,
populated DB 업그레이드 및 증거 불일치 때문에 그대로는 FAIL이었습니다.
사용자가 허용한 patch-mode로 구현과 검수를 분리해 보완했으며,
최종 검수 구현 5e7736a2ad21ae2361075bf73857ae783b3784bc에서
열린 Critical, High, Medium은 없습니다.

고정 Node 20.18.0 환경의 깨끗한 checkout에서 11개 게이트,
일반 테스트 90개, 보안 테스트 62개, P13 직접 검증 19개,
실제 Chromium P06~P13 8개 흐름을 재현했습니다.

## 2. 검수 대상

- 브랜치: feat/P13-fees-success-compensation
- Antigravity 구현 커밋: 851b3b9e032958bab0ab8745ba4f171ca44f1814
- Antigravity 제출 커밋: 5e65eff7adf87d0e118668cac6f2d24767638f7e
- Codex 보정 및 최종 검수 커밋: 5e7736a2ad21ae2361075bf73857ae783b3784bc
- 검수 일시: 2026-08-10 13:43 KST
- 환경: Windows, Node 20.18.0, pnpm 9.15.0, Prisma 6.19.3, Playwright Chromium
- 증거: artifacts/harness/P13/manifest.json, commands.log, notes.md

구현 커밋의 실제 diff는 다음 10개 파일이며 manifest와 1:1 일치합니다.

1. apps/api/src/server.ts
2. apps/web/src/fees/FeeSuccessCompensation.css
3. apps/web/src/fees/FeeSuccessCompensation.tsx
4. apps/web/src/main.tsx
5. packages/database/prisma/migrations/20260810120000_p13_fee_invariants/migration.sql
6. packages/database/prisma/schema.prisma
7. scripts/p13-contract-test.ts
8. scripts/p13-e2e.ts
9. scripts/p13-security-test.ts
10. scripts/p13-test-support.ts

이미 적용된 20260810110000 원 migration은 부모 커밋과 동일하며 수정하지 않았습니다.

## 3. 실행 명령과 결과

| 명령 | 결과 | 확인 내용 |
|---|---:|---|
| pnpm install --frozen-lockfile | PASS | lockfile 고정 설치 |
| pnpm db:reset | PASS | 전체 migration 재적용 |
| pnpm db:migrate | PASS | checksum drift 없음 |
| pnpm db:seed | PASS | 결정론적 합성 fixture |
| pnpm lint | PASS | 오류·경고 0 |
| pnpm typecheck | PASS | scripts, UI, web, DB, document engine, API |
| pnpm test | PASS | 90 passed, 0 failed, 0 skipped |
| pnpm build | PASS | 56 modules, CSS 16.56 kB, JS 302.71 kB |
| pnpm test:e2e | PASS | P06~P13 실제 Chromium 8개 흐름 |
| pnpm test:security | PASS | 62 passed, 0 failed, 0 skipped |
| pnpm audit --audit-level high | PASS | 알려진 취약점 0 |

깨끗한 checkout의 첫 테스트는 elevated runtime과 sandbox clone 소유자 차이 때문에
Git safe.directory 검사만 거부했습니다. 소스나 전역 Git 설정은 변경하지 않고
process-only safe.directory를 사용한 최종 실행에서 90/90을 통과했습니다.

## 4. 인수 기준 결과

| 기준 | 결과 | 직접 확인한 증거 |
|---|---:|---|
| 기준금액·요율·과세 입력과 계산 | PASS | 서버 exact integer 계산, UI BigInt 미리보기, API/DB 반례 |
| 예상 계산과 독립 최종 확정 분리 | PASS | 별도 finalize API, 다른 배정 Director/CEO, DB trigger |
| 청구일·입금·부분입금·조정·잔액 | PASS | snapshot 필드, append-only ledger, invoice 검증 |
| 미수 종결 경고와 권한 통제 | PASS | 전용 종결 API, 강제종결 권한, generic 상태 우회 차단 |
| 조직·사건 배정·역할 경계 | PASS | 조회와 모든 mutation, raw DB scope trigger |
| 정확한 원화 반올림 | PASS | 15원 공급가의 VAT 2원 등 경계값 검증 |
| 멱등성·동시성·optimistic version | PASS | 동일 키 동시 재시도 단일 결과, stale 409 |
| populated legacy DB additive upgrade | PASS | 정상 이력 보존, 위반 데이터 fail-closed rollback |
| CLOSED 사건 불변성 | PASS | API 및 raw DB 계산·수납·조정 차단 |
| 실제 FEE-01 UI | PASS | 검색, 승인자 배정, 이력, 반응형, 키보드, 오류 상태 |
| manifest와 실제 diff | PASS | 구현 커밋 10개 경로 1:1 일치 |

## 5. 발견 사항

### 해결됨: 범위 없는 조회·쓰기와 재사용 가능한 멱등 결과

초기 구현은 모든 read/mutation에서 사건 배정을 강제하지 않았고 멱등 키의 주체 범위도 부족했습니다.
최종 구현은 organization, case, actor, payload fingerprint를 함께 검증하고
동일 키 동시 요청을 canonical row 하나로 수렴시킵니다.

### 해결됨: self-approval과 신뢰할 수 없는 FINAL

예상 계산 작성자와 최종 승인자가 분리되지 않았고 raw DB FINAL도 역할과 배정을 우회할 수 있었습니다.
최종 구현은 배정된 다른 Director/CEO, source snapshot 일치, V3 공식,
단일 FINAL을 API와 DB 모두에서 요구합니다.

### 해결됨: 종결 이후 재무 변경과 일반 상태 API 우회

초기 경로는 CLOSED 이후 조정과 generic SUCCESS_FEE→CLOSED 전이를 허용할 수 있었습니다.
최종 구현은 종결 직전 동일 transaction 안에서 version과 잔액을 다시 확인하고,
일반 상태 API의 CLOSED 전이를 전용 정책으로 제한하며 raw DB 쓰기도 거부합니다.

### 해결됨: 금액·세액·스냅샷 오류

JS Number, 부가세 별도 half-up 식, 청구일·성과보수 적용 여부·config version snapshot이 부족했습니다.
최종 구현은 문자열과 BigInt 기반 KRW 정수, bps, V3 공식을 서버·UI·DB에서 일치시키고
15원 공급가의 1.5원 VAT를 2원으로 반올림하는 경계까지 고정했습니다.

### 해결됨: 실제 운영 DB 업그레이드

이미 적용된 migration을 수정하면 checksum drift가 발생하고 populated DB backfill도 append-only trigger와 충돌했습니다.
원 migration은 그대로 보존하고 additive migration에서 방해 trigger를 제한적으로 교체한 뒤
계산 ordinal과 source를 복원합니다. cross-scope, 구식 ADJUSTMENT, 위조 V3 표식은
전체 migration을 원자적으로 rollback합니다.

### 해결됨: 사건 전환 UI 경쟁 상태

느린 응답, 응답 유실 재시도, 사건 전환 중 남은 계산·수납 초안이 다른 사건에 저장될 위험이 있었습니다.
request case/sequence 검증, loadedCaseId action guard, 사건 전환 즉시 초안·modal 초기화,
안정적인 UI 멱등 키 및 지연 응답 Chromium 반례로 차단했습니다.

### Low / Open: 픽셀 기반 시각 회귀 baseline 부재

- 위치: P13 E2E
- 실제 결과: 기능, 1024/640 반응형, 200% 확대, 키보드, 403/409 상태는 실제 Chromium에서 통과했습니다.
- 영향: 기능 테스트가 감지하지 못하는 미세한 시각 변화가 남을 수 있습니다.
- 권고: P15 통합 안정화에서 주요 화면의 안정적인 screenshot baseline을 추가합니다.
- 차단 여부: 비차단

## 6. 보안·권한

- 조회와 모든 변경은 동일 조직 및 사건 배정을 요구합니다.
- PM/Director/CEO만 계산·수납을 수행하고, 배정된 Director/CEO만 독립 확정과 강제종결을 수행합니다.
- 승인자 공동 배정은 동일 조직, 허용 역할, 사건 version CAS, AuditLog 동일 transaction을 요구합니다.
- Origin, CSRF, strict payload, scoped idempotency, optimistic version, IDOR 방어를 적대 테스트로 확인했습니다.
- API 키, access token, client secret, private key, 실제 고객정보는 0건입니다.
- 추적된 환경 파일과 원본 보고서 템플릿은 0건입니다.

## 7. 데이터 무결성

- 계산·확정·수납·조정·감사 이력은 append-only입니다.
- FINAL은 현재 config의 V3 예상 snapshot과 정확히 일치하고 다른 승인자가 작성해야 합니다.
- 과수납, 음수·0원, 불완전 세금계산서, confirmed 조건 변조, CLOSED 사건 쓰기는 DB에서도 거부됩니다.
- payment와 close는 authoritative V3 FINAL을 요구합니다.
- audit 삽입 실패 시 재무 projection과 이력 모두 rollback합니다.
- legacy V1 확정본은 열린 사건에서 DRAFT로 격리하고 재계산·독립 승인을 요구합니다.

## 8. AI·법률·수치 안전

P13은 AI 생성 기능이 아닙니다. 성공보수 금액은 사용자가 입력한 계약 조건,
정수 KRW, bps, 과세 플래그와 명시적 V3 half-up 공식에서만 계산됩니다.
근거 없는 자동 금액 생성은 없으며, 다른 배정 승인자의 명시적 최종 확정을 거칩니다.

## 9. UX·접근성

FEE-01에서 사건 검색, 계산, 승인자 배정, 독립 확정, 수납, 미수 경고 종결,
이력 조회를 한 흐름으로 사용할 수 있습니다. loading, empty, error, 403, 409,
CLOSED 상태를 구분하고 label, dialog, focus 이동, Escape, 키보드 조작을 지원합니다.
120개 초과 사건 검색, 100개 이력, 긴 사건명, 1024px, 640px와 200% 확대를
실제 Chromium에서 확인했습니다.

## 10. 테스트 적정성

- 일반 회귀: 90/90
- 전체 보안 회귀: 62/62
- P13 직접 계약·보안·migration 반례: 19/19
- 실제 Chromium: P06~P13 8/8
- P13은 금액 경계, 부가세, no-fee, 독립 승인, scope, IDOR, stale version,
  동시 멱등성, overpayment, invoice, rollback, append-only, raw DB, 종결 경쟁,
  populated upgrade, 사건 전환 out-of-order 응답을 검증합니다.

문자열 존재만 검사하지 않고 API 응답, DB row, AuditLog, migration rollback과 실제 DOM을 함께 확인했습니다.

## 11. 회귀 위험

- 구식 V1 확정 설정은 의도적으로 DRAFT로 전환되므로 운영 전 재계산·재승인 절차가 필요합니다.
- 구버전 ADJUSTMENT는 신·구 의미가 반대여서 자동 변환하지 않습니다. 존재하면 migration이 멈추므로 사전 회계 검토가 필요합니다.
- SQLite 이외 DB로 전환하면 동일한 constraint, trigger, transaction 격리를 다시 검증해야 합니다.
- 위 항목은 현재 P13 인수 기준을 위반하는 열린 결함은 아닙니다.

## 12. 다음 단계 진입 여부

허용합니다.

P14 Google Workspace Integration으로 진입할 수 있습니다.
실제 Google 자격증명·운영 계정·고객자료를 저장소나 테스트에 넣지 않고,
결정론적 fake adapter와 서버 전용 secret reference부터 구현해야 합니다.

## 13. 필수 수정 목록

없음.

## 14. 선택 개선 목록

1. P15 통합 안정화에서 주요 화면 screenshot baseline을 추가합니다.
2. P15에서 누적 API server route를 phase별 모듈로 분리하되 현재 보안 회귀를 유지합니다.
