# P11 Codex 검수 보고서

## 1. 판정

`PASS_WITH_NOTES`

원 제출의 High 결함을 patch 구현 커밋 `2b883aa819888c6c58a160f2fddc7eff84354dfa`에서 모두 보정했고, 깨끗한 checkout에서 필수 11개 게이트를 재현했다. P12 검토·승인·최종 문서 출력 단계 진입을 허용한다.

## 2. 검수 대상

- 브랜치: `feat/P11-grounded-ai-authoring`
- Antigravity 원 구현: `cfc552c`
- Antigravity 제출: `0445f95`
- 최종 검수 구현 커밋: `2b883aa819888c6c58a160f2fddc7eff84354dfa`
- 검수 일시: 2026-08-07 15:55~16:37 KST
- 환경: Windows, Node v24.16.0, pnpm 9.15.0, 설치된 Chrome/Chromium headless
- 깨끗한 checkout: `work/p11-clean-review-2`

## 3. 독립 실행 결과

| 명령 | 결과 | 실측 |
|---|---:|---|
| `pnpm install --frozen-lockfile` | PASS | lockfile 고정 설치, Prisma Client 생성 |
| `pnpm db:reset` | PASS | 전체 migration 재적용 |
| `pnpm db:migrate` | PASS | migration SQL 적용 성공 |
| `pnpm db:seed` | PASS | synthetic P11 fixture 생성 |
| `pnpm lint` | PASS | zero warnings |
| `pnpm typecheck` | PASS | API/DB/web/UI/scripts 통과 |
| `pnpm test` | PASS | 88 passed, 0 failed, 0 skipped |
| `pnpm build` | PASS | production web/API/DB 산출물 확인 |
| `pnpm test:e2e` | PASS | P06~P11 실제 Chromium 전부 통과 |
| `pnpm test:security` | PASS | 42 passed, 0 failed, 0 skipped |
| `pnpm audit --audit-level high` | PASS | 알려진 취약점 0건 |

전체 stdout/stderr와 각 exit code는 `artifacts/harness/P11/commands.log`에 있다.

## 4. 인수 기준

| 기준 | 결과 | 증거 |
|---|---:|---|
| 명시 선택 source만 전송 | PASS | exact manifest와 payload 검증, P11 contract |
| source version/hash/anchor 재검증 | PASS | API loader, P11 DB triggers, source mutation 반례 |
| 주장별 citation schema와 적용 차단 | PASS | 12개 적대 모드, citation exact-match 검증 |
| P10 정책·예산·취소 경계 재사용 | PASS | Gateway 경유, ledger 0 정산, late response 차단 |
| 사람 적용만 새 미승인 revision 생성 | PASS | apply API, P09 evidence/provenance, Chromium |
| 기존 승인본·잠금·self-approval 보존 | PASS | stale/apply/approval/replay 계약 테스트 |
| 사건 배정·RBAC·IDOR | PASS | unassigned apply/discard, Reviewer read-only 보안 테스트 |
| prompt/response/secret 비저장 | PASS | hash/redacted metadata, DB/API/browser scan |
| 실제 UI와 접근성 | PASS | production bundle Chromium, 1024px/200%/focus |

## 5. 해결한 High 결함

### [HIGH/RESOLVED] 제출 상태·증거 패키지 불일치

원 제출은 `P11 IN_PROGRESS`였고 11개 게이트 원문 로그·notes·검수 요청서가 없었다. 본 검수 커밋에서 상태, manifest, 실제 로그, 요청서, 판정 문서를 생성하고 11/11 exit 0을 재현했다.

### [HIGH/RESOLVED] citation provenance 검증 부족

원 코드는 source ID/type 중심으로 비교해 version/hash/allowed anchor/text 불일치를 적용 가능 상태로 만들 수 있었다. exact source snapshot 재검증, versioned JSON output, API·DB 이중 검증과 12개 반례로 차단했다.

### [HIGH/RESOLVED] P10 Gateway·비밀·취소 경계 우회

원 구현은 P11 test mode가 사용자 입력에 노출되고 raw 결과 보존 및 실제 취소/late response 정산 경계가 불충분했다. 테스트 서버에서만 mode를 허용하고, Gateway 결과는 hash만 영속화하며 AbortController와 ledger reconcile을 연결했다.

### [HIGH/RESOLVED] 사건 배정·사람 적용·멱등성 경계

같은 조직의 미배정 사용자가 직접 apply/discard를 호출할 수 있었고 승인 후 동일 적용 요청 replay가 막혔다. 모든 P11 경로의 case assignment, apply fingerprint, 단일 적용, 승인 후 동일 replay, stale conflict 무고아성을 강제했다.

### [HIGH/RESOLVED] HTTP 중심 E2E와 실제 적용 UI 장애

실제 Chromium 검증 중 apply 응답에 작성자/evidence가 빠져 React revision 렌더링이 중단되는 결함을 발견했다. API 응답 계약을 수정하고 실제 브라우저의 생성·적용·취소·Reviewer·반응형 흐름으로 재검증했다.

## 6. 보안·데이터 무결성

- selection/item/citation 및 적용 provenance는 append-only다.
- cross-tenant/cross-case/source version/hash/anchor 공격은 API와 DB에서 거부된다.
- 원문 provider response, 전체 prompt, secret은 일반 DB·audit·browser storage에 저장되지 않는다.
- 실제 API key/token/private key/고객정보는 0건이다. 합성 `sk-raw-secret-value`는 secret 차단 반례다.
- 취소 시 reservation과 reconciliation 합계는 0이고 늦은 응답은 terminal suggestion을 되살리지 못한다.

## 7. AI 안전성

근거 없는 금액·판례·법적 결론·단위 변경, 선택 외/cross-case source, malformed/missing anchor, hash 변경, 충돌 근거를 각각 차단하거나 `REVIEW_REQUIRED`/`CONFLICT`로 격리한다. prompt injection 문구는 untrusted source data로만 처리한다.

## 8. 낮은 위험 메모

1. PDF/HWP 전체 텍스트 추출은 P11 범위에 넣지 않았다. 해당 파일은 같은 보고서에서 P09 사람이 검증한 불변 인용문이 있을 때만 그 앵커를 근거로 선택할 수 있다.
2. Node 24에서 의존성 도구가 DEP0169 경고를 출력하지만 11개 게이트는 모두 exit 0이고 audit 결과는 취약점 0건이다.

## 9. 다음 단계

`허용` — P12 검토·승인·최종 문서 출력 단계로 진입할 수 있다. 필수 수정 목록은 없다.
