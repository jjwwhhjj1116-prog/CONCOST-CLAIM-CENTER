# P14 Codex 검수 보고서

## 1. 판정

`PASS_WITH_NOTES`

P14 필수 기능과 보안 경계가 구현되었고, 깨끗한 고정 런타임에서 11개 필수 게이트를 모두 통과했습니다. 잔여 사항은 운영 staging 및 다중 인스턴스 가용성에 관한 후속 개선으로, P15 진입을 차단하지 않습니다.

## 2. 검수 대상

- 브랜치: `review/P14-codex`
- 원격 제출 브랜치: `feat/P14-google-workspace-integration`
- 구현 커밋: `5554f6c5187b698faebccfbc13956eeb1e794889`
- 검수 일시: `2026-08-10T17:03:54+09:00`
- 검수 환경: Windows, clean detached checkout, Node 20.18.0, pnpm 9.15.0

## 3. 실행한 명령

| 명령 | 결과 | 로그 |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | 215 packages, Prisma generated |
| `pnpm db:reset` | PASS | migrations applied |
| `pnpm db:migrate` | PASS | migrations applied |
| `pnpm db:seed` | PASS | deterministic synthetic fixtures |
| `pnpm lint` | PASS | 0 errors, 0 warnings |
| `pnpm typecheck` | PASS | 0 errors |
| `pnpm test` | PASS | 113/113 |
| `pnpm build` | PASS | 59 modules, JS 337.02 kB |
| `pnpm test:e2e` | PASS | P06-P14, P14 10 flows |
| `pnpm test:security` | PASS | 90/90 |
| `pnpm audit --audit-level high` | PASS | no known vulnerabilities |

전체 실행 기록은 `artifacts/harness/P14/commands.log`에 있습니다.

## 4. 인수 기준 결과

| 기준 | 결과 | 증거 |
|---|---|---|
| OAuth 서버 처리 | PASS | Authorization Code + PKCE, state hash/TTL/one-time/actor/org/version binding |
| Drive 폴더 중복 방지 | PASS | scoped reservation, semantic concurrency convergence |
| Gmail 선택 첨부 | PASS | provider exact-set 검증, P06 DocumentVersion/storage 연동 |
| Calendar 사람 확인 | PASS | 서버 소유 dateCandidate/hash/version 및 human confirmation |
| Docs 선택 회의록 | PASS | FINAL meeting version + DOCS_TEXT immutable snapshot |
| Sheets 선택 범위 | PASS | allowlisted source, bounded A1, provider range/hash/dimension 검증 |
| 토큰 만료·재연결·해제 | PASS | refresh metadata sync, re-consent, revoke fail-closed, 내부 데이터 보존 |
| 비밀정보 0건 | PASS | encrypted org-scoped vault, API/DOM/URL/storage scan |
| UI/접근성 경계 | PASS | 1440/1024/640, 200%, keyboard/focus, loading/error/retry |
| DB 불변성·마이그레이션 | PASS | additive `141000`, populated upgrade/invalid rollback, original `140000` unchanged |

## 5. 발견 사항

### [MEDIUM] 실제 Google staging 계정 실증 미수행

- 위치: 운영 provider 전체
- 재현: 없음. 지시대로 실제 Google credential·고객자료를 사용하지 않음
- 실제 결과: injected transport와 synthetic credential로 host, OAuth, refresh, revoke, 5개 API 경로를 검증
- 기대 결과: 배포 전 전용 staging Google Workspace에서 승인·revocation·quota를 한 차례 실증
- 영향: 코드 경계는 검증됐으나 Google 운영 정책/콘솔 설정 차이는 아직 확인되지 않음
- 수정 조건: P15/P16 staging runbook과 별도 테스트 계정으로 확인

### [MEDIUM] OAuth PKCE verifier의 단일 프로세스 가용성

- 위치: `apps/api/src/server.ts`의 PKCE vault
- 재현: OAuth init 후 서버 재시작 또는 callback이 다른 인스턴스로 라우팅
- 실제 결과: verifier를 찾지 못해 callback이 안전하게 실패
- 기대 결과: 암호화된 TTL state store를 공유하여 재시작·다중 인스턴스에서도 callback 가능
- 영향: credential 유출은 없으나 운영 가용성이 저하될 수 있음
- 수정 조건: P15 배포·복구 작업에서 durable encrypted state store 도입

## 6. 보안·권한

- Admin 전용 연결 관리, 사건 역할·배정·tenant boundary, Origin/CSRF, strict schema를 서버에서 강제합니다.
- credential provider CRUD와 AES-GCM AAD가 organization ID에 바인딩됩니다. DB에서 다른 조직 `secretRef`로 바꿔도 provider 호출·revoke·삭제 전에 차단됩니다.
- provider envelope와 알려진 필드만 서버 소유 projection으로 재구성하며 raw provider 오류·추가 필드를 API/DB에 전달하지 않습니다.
- 실제 API 키, 토큰, 고객자료는 발견되지 않았습니다.

## 7. 데이터 무결성

- 원래 적용된 `20260810140000` migration을 변경하지 않고 additive `20260810141000` migration으로 기존 데이터 검증과 트리거를 강화했습니다.
- operation/snapshot/resource/audit가 같은 DB 경계에서 수렴하고, 불확실한 외부 side effect는 `RECONCILIATION_REQUIRED`로 격리됩니다.
- Gmail은 P06 storage와 hash를 검증하며 Docs/Sheets provenance가 immutable snapshot으로 보존됩니다.
- disconnect는 외부 revoke, DB 상태·감사, local vault purge 순서를 분리하여 경합/rollback 시 DB가 삭제된 ref를 가리키지 않습니다.

## 8. AI 근거성과 법률·수치 안전

P14는 AI 본문 생성을 추가하지 않습니다. 기존 P10/P11 provenance·외부 전송 정책 회귀 테스트가 전체 수트에서 유지됐습니다.

## 9. UX·접근성

- Admin 운영/Fake provider 상태를 구분하고 만료 임박, timeout, 5xx, revoke 실패, reconciliation을 명확히 표시합니다.
- CASE-04/CASE-06/MEET-01에서 5개 Google 작업을 실제 API로 수행합니다.
- Chromium에서 키보드, focus 복귀, 200% 확대, 1024/640px, 긴 이름, 121개 resource, 100개 이력을 검증했습니다.

## 10. 테스트 적정성

- 일반·계약 113개, 보안 90개, real adapter 22개, P14 Chromium 10개 흐름을 실행했습니다.
- OAuth 재사용·만료·교차 actor/org, raw token, provider over-response, audit failure, concurrency, timeout late-result, version race, cross-org vault ref 등 반례가 포함됩니다.
- 구현 커밋의 19개 `diff-tree` 경로와 manifest `changedFiles`가 일치합니다.

## 11. 회귀 위험

- P03 승인 route extension을 명시적으로 허용하면서 필수 20개 route를 그대로 검증합니다.
- P04-P14 전체 보안 90개 및 P06-P14 전체 Chromium E2E가 통과했습니다.
- Cloudflare/D1 전환은 현재 Prisma transaction과 SQLite trigger 의미를 그대로 보존하지 못하므로 별도 migration phase 없이 진행하면 안 됩니다.

## 12. 다음 단계 진입 여부

`허용` — P15 통합 품질 단계로 진입할 수 있습니다.

## 13. 필수 수정 목록

없음.

## 14. 선택 개선 목록

1. PKCE verifier를 durable encrypted state store로 이전합니다.
2. 전용 staging Google Workspace 계정으로 OAuth와 quota/revoke 운영 실증을 수행합니다.
3. Node/SQLite/file vault 영속 디스크의 backup·restore·crash recovery를 P15에서 자동화합니다.
