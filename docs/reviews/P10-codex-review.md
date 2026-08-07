# P10 Codex 검수 보고서

## 1. 판정

`PASS_WITH_NOTES`

원 제출의 High 결함을 patch 모드 구현 커밋 `d7b085d859543431d56f1776ebcb01225c17ada9`에서 모두 보정했고, 깨끗한 checkout에서 필수 11개 게이트를 재현했다. 다음 P11 단계 진입을 허용한다.

## 2. 검수 대상

- 브랜치: `feat/P10-ai-gateway`
- Antigravity 원 구현: `4158169`
- Antigravity 상태 제출: `f9234ec`
- 최종 검수 구현 커밋: `d7b085d859543431d56f1776ebcb01225c17ada9`
- 검수 일시: 2026-08-07 14:44~14:55 KST
- 검수 환경: Windows, Node v24.16.0, pnpm 9.15.0, 실제 Chrome/Chromium headless
- 깨끗한 checkout: `work/p10-clean-review-d7b085d`

## 3. 실행한 명령

| 명령 | 결과 | 로그 |
|---|---:|---|
| `pnpm install --frozen-lockfile` | PASS | lockfile 고정 설치, 215 packages, Prisma Client 생성 |
| `pnpm db:reset` | PASS | 전체 migration 재적용 |
| `pnpm db:migrate` | PASS | migration SQL 적용 성공 |
| `pnpm db:seed` | PASS | synthetic P10 fixture 생성 |
| `pnpm lint` | PASS | zero warnings |
| `pnpm typecheck` | PASS | API/DB/web/UI/scripts 통과 |
| `pnpm test` | PASS | 87 passed, 0 failed, 0 skipped |
| `pnpm build` | PASS | Vite 52 modules, API/DB/UI/web 산출물 확인 |
| `pnpm test:e2e` | PASS | P06~P10 실제 Chromium 전부 통과 |
| `pnpm test:security` | PASS | 41 passed, 0 failed, 0 skipped |
| `pnpm audit --audit-level high` | PASS | 알려진 취약점 0건 |

원문 출력 요약은 `artifacts/harness/P10/commands.log`에 기록했다.

## 4. 인수 기준 결과

| 기준 | 결과 | 증거 |
|---|---:|---|
| 정상/잘못된 키/timeout/429/5xx/schema/stream/cancel | PASS | `scripts/p10-contract-test.ts` |
| 비용 한도 및 동시 예약 경쟁 | PASS | `scripts/p10-contract-test.ts`, `apps/api/src/ai/gateway-engine.ts:199` |
| 전체 요청 멱등성과 중복 과금 방지 | PASS | `apps/api/src/ai/gateway-engine.ts:78`, 계약 테스트 |
| SSRF DNS 재바인딩·IP·port·host 경계 | PASS | `apps/api/src/ai/ssrf-guard.ts:94` |
| 사건 정책과 provider/model allowlist | PASS | `apps/api/src/ai/gateway-engine.ts:146` 이후 |
| 실제 실행 취소와 늦은 응답 차단 | PASS | `apps/api/src/server.ts:3583`, `:3699`, Chromium E2E |
| request/attempt/ledger DB 불변성 | PASS | P10 migration `:178`, `:192`, `:228` |
| 감사로그와 실패 rollback | PASS | `apps/api/src/server.ts:3613`, P10 contract/security tests |
| 실제 Admin/Report Studio UI | PASS | `scripts/p10-e2e.ts:86`, `:105` |
| 비밀·고객정보 0건 | PASS | Git/번들/로그/API/storage 정규식 및 실제 브라우저 검사 |

## 5. 발견 사항

### [HIGH/RESOLVED] P10 제출 증거 누락과 HTTP-only E2E

- 위치: 원 제출 `f9234ec`, 원 `scripts/p10-e2e.ts`
- 재현: P10 artifact/request 파일이 모두 없고 E2E에 `chromium.launch`가 없었다.
- 실제 결과: 제출 완료와 실제 브라우저 검증을 입증하지 못했다.
- 기대 결과: 실제 production UI와 Chromium 실행, manifest/notes/commands/request 제출.
- 영향: 허위 양성과 회귀 은폐 가능.
- 수정 조건: 충족. `scripts/p10-e2e.ts:86`, 본 증거 패키지 참조.

### [HIGH/RESOLVED] 정책·예산·취소·멱등성·SSRF 경계 불완전

- 위치: 원 `gateway-engine.ts`, `ssrf-guard.ts`, P10 API 경로.
- 재현: provider allowlist 무시, transaction 밖 budget check, prompt-only idempotency, 취소 시 AbortSignal 미연결, DNS 미검사.
- 실제 결과: 비용 경쟁 우회, 정책 외 공급자, late response 덮어쓰기와 DNS rebinding 가능성이 있었다.
- 기대 결과: server/DB 강제와 적대 반례.
- 영향: 비용·데이터 외부 전송·무결성 High 위험.
- 수정 조건: 충족. 보정 커밋과 87/41/Chromium 결과 참조.

### [LOW] 실공급자 live adapter는 배포 승인 전 비활성

- 위치: `apps/api/src/ai/gateway-engine.ts`
- 실제 결과: `LOCAL_FAKE`는 전체 실패 모드를 재현하지만 외부 실공급자는 명시적으로 `501`이다.
- 영향: P11 CI/검수에는 영향 없음. 운영 연결 전 별도 승인·secret provisioning·공급자별 계약 검수가 필요하다.
- 수정 조건: 운영 배포 단계에서 별도 승인 후 adapter를 추가한다. P11에서 실제 키를 넣어 우회하지 않는다.

### [LOW] pnpm audit 후 Node DEP0169 경고

- 위치: 의존성 도구 실행 경로.
- 실제 결과: audit 자체는 `No known vulnerabilities found`로 exit 0이며 종료 후 deprecation warning이 출력됐다.
- 영향: 현재 알려진 취약점은 없고 기능 영향도 없다.
- 수정 조건: 상위 도구 의존성에서 WHATWG URL 전환 시 제거한다.

## 6. 보안·권한

- Admin만 provider 설정/연결 테스트 가능하다.
- 기본 정책은 외부 전송 거부이고 case provider/model allowlist를 서버가 강제한다.
- 타 조직 provider update, 타 actor request 조회/취소, cross-tenant DB insert가 거부됨을 재현했다.
- 원문 secret은 DB/API/error/browser storage에 없고 LOCAL_FAKE에는 내장 fallback secret도 없다.

## 7. 데이터 무결성

- request identity/reservation, terminal state, attempt, ledger는 DB trigger로 불변이다.
- budget aggregate와 reservation은 SQLite write lock을 획득한 transaction 안에서 실행한다.
- cancellation reconciliation은 reservation을 반환하고 late provider response는 compare-and-set에서 탈락한다.
- 감사로그 강제 실패 시 provider/request/ledger orphan 0을 재현했다.

## 8. AI 근거성과 법률·수치 안전

P10은 전송 gateway만 제공하며 P11 본문 작성을 선행하지 않는다. UI 호출은 합성 transport diagnostic이고 승인된 P09 revision에 AI 결과를 자동 삽입하거나 승인하지 않는다.

## 9. UX·접근성

실제 Chromium에서 Admin provider ping, PM async 요청, 취소, 재실행 완료, 1024px overflow, keyboard focus, 200% 확대를 확인했다. P09 3단 편집·승인 흐름도 회귀 E2E에서 유지됐다.

## 10. 테스트 적정성

- 일반·계약 87/87, 보안 41/41.
- P10은 성공 외에 key/timeout/429/5xx/schema/stream/cancel/cost/race/IDOR/audit-failure 반례를 실행한다.
- P10 E2E는 HTTP-only가 아니라 production bundle과 실제 Chromium이다.

## 11. 회귀 위험

- P06~P10 실제 Chromium 연속 통과.
- P04~P10 보안 suite 41/41 통과.
- 운영 실공급자 adapter는 아직 승인되지 않았으므로 P11은 LOCAL_FAKE 경계에서만 진행해야 한다.

## 12. 다음 단계 진입 여부

`허용` — P11 근거 기반 AI 작성 단계로 진입할 수 있다.

## 13. 필수 수정 목록

없음.

## 14. 선택 개선 목록

1. 운영 배포 승인 시 실공급자별 live adapter와 실제 credential smoke test를 별도 보안 절차로 추가한다.
2. pnpm audit 의존성의 DEP0169 경고가 상위 버전에서 해소되는지 추적한다.
