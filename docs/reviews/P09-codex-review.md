# P09 Codex 검수 보고서

## 1. 판정

`PASS_WITH_NOTES`

Antigravity 제출 커밋 `8db5895` 자체는 필수 증거 누락과 DB/API/UI/E2E의 High 결함 때문에 통과할 수 없었다. 사용자가 허용한 patch 검수 모드에서 구현 보정 커밋과 검수·증거 커밋을 분리했고, 최종 검수 대상 `ceadc14`에는 미해결 Critical/High가 없다.

## 2. 검수 대상

- 브랜치: `feat/P09-report-studio`
- Antigravity 제출 커밋: `8db5895c357a6716fa112f132240ce9333a16e28`
- Codex 보정 커밋: `e2f1efaba9081d8b4d0f37e559b6034fb9444fcd`, `edc9f8a847e83ad73665c549fcd543c6ff55f63d`, `ceadc14e2cceba18697d6eacc62391b4218b3f8f`
- 최종 검수 커밋: `ceadc14e2cceba18697d6eacc62391b4218b3f8f`
- 검수 일시: `2026-08-07T12:58:55+09:00`
- 검수 환경: Windows, Node `v24.16.0`, pnpm `9.15.0`, 설치 전 node_modules가 없는 별도 clone `p09-clean-verify`

## 3. 실행한 명령

| 명령 | 결과 | 로그 |
|---|---:|---|
| `npx --yes pnpm@9.15.0 install --frozen-lockfile` | PASS | lockfile 고정 설치, Prisma 생성 |
| `npx --yes pnpm@9.15.0 db:reset` | PASS | reset 및 전체 migration 적용 |
| `npx --yes pnpm@9.15.0 db:migrate` | PASS | additive migration 재적용 확인 |
| `npx --yes pnpm@9.15.0 db:seed` | PASS | deterministic synthetic fixture |
| `npx --yes pnpm@9.15.0 lint` | PASS | warning 0, JSON 검증 포함 |
| `npx --yes pnpm@9.15.0 typecheck` | PASS | scripts/UI/web/database/API |
| `npx --yes pnpm@9.15.0 test` | PASS | 85/85, 실패·skip 0 |
| `npx --yes pnpm@9.15.0 build` | PASS | production Vite/Prisma 산출물 |
| `npx --yes pnpm@9.15.0 test:e2e` | PASS | 실제 Chrome P06~P09 4/4 |
| `npx --yes pnpm@9.15.0 test:security` | PASS | 40/40, 실패·skip 0 |
| `npx --yes pnpm@9.15.0 audit --audit-level high` | PASS | 알려진 취약점 0 |

전체 터미널 결과 요약은 `artifacts/harness/P09/commands.log`에 기록했다.

## 4. 인수 기준 결과

| 기준 | 결과 | 증거 |
|---|---:|---|
| P08 ACTIVE template에서 생성된 실제 ReportInstance만 편집 | PASS | production seed 및 P09 contract |
| 3단 스튜디오와 동적 case/report URL | PASS | Router, ReportStudio, Chrome E2E |
| 자동·수동 저장과 immutable monotonic revision | PASS | API transaction, DB trigger, E2E |
| stale 저장 409와 양쪽 본문 무손실 비교·복구 | PASS | P09 contract/security/Chrome |
| 실제 DocumentVersion/FINAL Meeting 근거와 문단 위치 snapshot | PASS | API provenance validation, DB trigger |
| 댓글·수정 요청·해결 및 독립 승인 | PASS | P09 contract/security |
| 승인 장 잠금·명시적 unlock·self approval 차단 | PASS | API + DB 양층 검사 |
| 승인된 최신 VALID revision만 결정적 merge | PASS | snapshot SHA-256 및 merge tests |
| 0/1/100장, 장문 정확히 100,000자, 긴·중복 제목 | PASS | P09 contract 4 tests |
| 1024px, 100장 이동, keyboard/focus, 200% | PASS | 실제 Chrome P09 E2E |
| P08/P07/P06 회귀 유지 | PASS | 전체 test/e2e/security |
| P10/P12 범위 선행 금지 | PASS | AI disabled placeholder, DOCX/PDF는 P12 명시 |

## 5. 발견 사항

최종 검수 커밋의 미해결 발견 사항은 없다.

검수 중 다음 High 결함을 재현하고 보정했다.

1. 이력·근거·승인·merge의 UPDATE/DELETE 및 cascade 우회가 가능했다. DB immutable/restrict/tenant/actor/provenance trigger를 추가했다.
2. `/body` 직접 수정, optional expectedVersion, 자기·교차 장 승인, 미해결 수정 요청 승인, 미승인/비최신 merge 우회가 가능했다. API strict transaction 경계를 재작성했다.
3. 가상 `RPT-001` seed가 P08 provenance를 우회했고 근거가 실제 파일/FINAL 회의록인지 검증하지 않았다. production seed와 source 검증을 바로잡았다.
4. 프론트가 하드코딩 report, 잘못된 경로, 수동 저장만 사용했고 409가 손실 가능했다. 동적 route, autosave, 무손실 conflict recovery를 구현했다.
5. P09 E2E가 브라우저가 아닌 HTTP 스크립트였다. production UI를 실제 Chrome에서 역할 전환·responsive·접근성까지 검증하도록 교체했다.
6. P09 연결 후 P08 snapshot 성공 알림이 즉시 사라지는 회귀가 생겼다. 명시적 `보고서 스튜디오 열기` 동작으로 보정하고 P08 Chrome E2E를 재통과했다.

## 6. 보안·권한

- PM/Admin과 사건 작성권 Staff만 revision 작성·merge가 가능하고 Reviewer/Director는 검토·승인 경계로 제한된다.
- Origin, double-submit CSRF, session, 조직·사건 배정, soft-delete가 모든 mutation 전에 검사된다.
- 타 조직·타 사건 report/section/revision/comment/evidence/merge ID 바꿔치기는 거부된다.
- 승인 actor와 revision author의 동일성은 API와 DB 양쪽에서 차단된다.
- tracked credential, API key/token/private key 패턴, 원본 템플릿 Git 추적, 주민등록번호 패턴은 모두 0건이다.

## 7. 데이터 무결성

- immutable revision/evidence/approval/merge snapshot은 UPDATE/DELETE가 DB에서 거부된다.
- comment는 해결 이벤트 외 임의 mutation이 차단되고 승인 이력은 eventNumber로 append된다.
- expectedVersion은 필수이며 한 경쟁 저장만 성공한다. stale 응답은 서버 최신본과 사용자 초안을 모두 보존한다.
- evidence는 source id/hash/version/문단 위치를 동결하며 변조·삭제·다른 사건 source를 거부한다.
- mutation과 AuditLog는 같은 transaction이며 주입된 audit 실패 후 orphan 0을 확인했다.

## 8. AI 근거성과 법률·수치 안전

P09에는 외부 AI 공급자 호출이 없다. 우측 AI 영역은 P10 disabled placeholder이며 브라우저나 API에 공급자 키가 존재하지 않는다. 보고서 근거는 실제 P06 source provenance로만 연결된다. P10 공급자 실패·비용·외부 전송 통제는 다음 단계에서 별도 구현·검수한다.

## 9. UX·접근성

- 1440px 3단, 1024px 복구 가능한 탭 전환, 100장 목차 이동을 실제 Chrome에서 확인했다.
- 자동 저장 상태는 저장 중/저장됨/충돌/오류로 구분되고 수동 저장과 충돌 복구가 제공된다.
- Reviewer read-only, 승인 잠금, revision 비교, evidence 위치, 댓글·수정 요청이 화면에 실제 반영된다.
- keyboard focus와 200% 확대에서 핵심 동작을 수행했다.

## 10. 테스트 적정성

일반 85개, 보안 40개, 실제 Chrome 4개 phase 회귀가 모두 통과했다. P09 테스트는 100장·100KB, 두 사용자 저장 race, autosave/manual save, 승인·unlock·merge, source integrity, IDOR, AuditLog rollback을 실제 DB/API로 검증한다. skip이나 요소 부재 시 통과하는 분기는 없다.

## 11. 회귀 위험

P09는 단일 대형 API 모듈과 UI 컴포넌트에 변화가 집중되어 향후 P10 통합 때 우회 경로가 생길 수 있다. P10은 P09 revision/evidence/approval API를 수정하지 말고 AI Gateway 결과를 별도 provenance generation record로 append해야 한다. 현재 회귀 suite는 P06~P09를 모두 통과한다.

## 12. 다음 단계 진입 여부

`허용` — P10 AI Gateway 선행 구현 가능.

## 13. 필수 수정 목록

없음.

## 14. 선택 개선 목록

1. P10 작업에서 ReportStudio의 큰 컴포넌트를 상태·근거·검토 패널 단위로 분리할 수 있다. 단, 동작과 회귀 테스트를 먼저 유지한다.
2. CI에서 동일한 pnpm 9.15.0 clean gate를 자동 실행할 수 있다.
