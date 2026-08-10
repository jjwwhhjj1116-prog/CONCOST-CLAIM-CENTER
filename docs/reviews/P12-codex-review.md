# P12 Codex 검수 보고서

## 1. 판정

`PASS_WITH_NOTES`

Antigravity 원 제출은 실제 UI 장애, 깨끗한 설치 실패, append-only·권한·출력 무결성 결함과 불완전한 증거 때문에 그대로는 `FAIL`이었다. Codex 보완 구현 커밋 `0d5e563bd26dc3b16f1e434d13bdb85daa697eb3`에서 확인된 Critical/High 문제를 모두 해결했고, 새 checkout에서 필수 11개 게이트를 재현했다. P13 비용·성공보수 단계 진입을 허용한다.

## 2. 검수 대상

- 브랜치: `feat/P12-review-approval-final-output`
- Antigravity 원 구현: `1741bda7d35368a42e569947aaefaa57317769cf`
- Antigravity 제출·상태: `18093d5`
- Codex 최종 검수 구현: `0d5e563bd26dc3b16f1e434d13bdb85daa697eb3`
- 검수 일시: 2026-08-10 09:23~10:44 KST
- 환경: Windows, Node v24.16.0, pnpm 9.15.0, 설치된 Chrome headless
- 깨끗한 checkout: `work/p12-clean-verify4`

## 3. 독립 실행 결과

| 명령 | 결과 | 실측 |
|---|---:|---|
| `pnpm install --frozen-lockfile` | PASS | 신규 checkout, lockfile 고정, Prisma Client 생성 |
| `pnpm db:reset` | PASS | 전체 migration 재적용 |
| `pnpm db:migrate` | PASS | additive migration 적용 |
| `pnpm db:seed` | PASS | synthetic fixture 생성 |
| `pnpm lint` | PASS | zero warnings |
| `pnpm typecheck` | PASS | scripts/UI/web/DB/document/API 통과 |
| `pnpm test` | PASS | 89 passed, 0 failed, 0 skipped |
| `pnpm build` | PASS | 54 modules, production web/API/DB 산출물 확인 |
| `pnpm test:e2e` | PASS | P06~P12 실제 Chromium 전부 통과 |
| `pnpm test:security` | PASS | 43 passed, 0 failed, 0 skipped |
| `pnpm audit --audit-level high` | PASS | 알려진 취약점 0건 |

실제 exit code와 요약은 `artifacts/harness/P12/commands.log`에 기록했다.

## 4. 실제 UI 검증과 보완

원 제출의 브라우저 UI를 직접 실행하자 로그인은 `Failed to fetch`로 막혔고, 보고서 목록과 검토·승인함은 실데이터 없는 공통 화면이었다. 최종 출력 다운로드도 Vite origin의 상대 링크를 사용해 인증 API에 도달하지 않았다.

Codex 보완 후 다음 흐름을 실제 production bundle과 Chromium으로 확인했다.

1. 로그인 후 최근 사건·다가오는 일정·빠른 실행이 있는 대시보드 표시
2. `REPO-01`에서 사건별 보고서, 템플릿, 장 승인 진행률, 최종 확정·출력 상태 조회
3. Staff가 검토 요청 제출
4. Reviewer가 `APPR-01`에서 최신 요청·요청자·진행률을 확인하고 정확한 보고서 스튜디오로 이동
5. 3개 필수 장 승인, 최종 확정, DOCX/PDF 생성
6. 인증된 Blob 다운로드 후 DOCX 9 entries와 PDF 5 pages 독립 파서 검증

## 5. 해결한 High 결함

### [HIGH/RESOLVED] 웹앱 핵심 경로가 실제 사용자에게 동작하지 않음

127.0.0.1 Vite origin CORS 누락, REPO-01/APPR-01 플레이스홀더, 잘못된 다운로드 origin을 수정했다. 실제 API 기반 대시보드·보고서 작업공간·승인함과 인증 Blob 다운로드를 구현하고 Chromium 경로에 포함했다.

### [HIGH/RESOLVED] 깨끗한 설치·DB 명령 재현 실패

루트 스크립트의 bare pnpm 중첩 호출이 pnpm 버전 혼용과 재귀 설치를 일으켰다. postinstall은 Prisma CLI를 직접 호출하고 DB 명령은 root `tsx`로 실행하도록 변경해 완전 신규 checkout에서 설치와 DB 3개 게이트를 통과시켰다.

### [HIGH/RESOLVED] 검토 이력 변조와 약한 담당자 경계

수정 요청·재검토가 기존 row를 UPDATE했고 담당 Reviewer 역할·배정·idempotency payload가 충분히 강제되지 않았다. 검토 이벤트를 append-only로 전환하고 DB UPDATE trigger, event number unique, payload fingerprint, 최신 이벤트·담당자 검증을 적용했다.

### [HIGH/RESOLVED] 최종 확정 snapshot의 stale/race 검증 부족

transaction 밖 readiness 결과를 신뢰하고 validation error, citation, 최신 승인 revision의 전체 상태를 충분히 재확인하지 않았다. transaction 안에서 전체 readiness fingerprint를 다시 읽고 DB trigger가 title/content/hash/approval/validation/latest revision을 고정하도록 강화했다.

### [HIGH/RESOLVED] 출력 권한·동시성·파일 무결성 결함

Staff도 artifact를 만들 수 있었고 동시 생성 실패가 다른 요청의 파일을 삭제할 수 있었다. 승인 역할만 생성 가능하게 하고 exclusive file create, 소유 파일 rollback, 서명·크기·SHA 재검증, 안전한 UTF-8 filename을 적용했다.

### [HIGH/RESOLVED] 긴 문서 PDF 손실과 약한 독립 검증기

긴 목차·본문이 단일 페이지 범위를 넘으면 잘렸고 xref 검증도 느슨했다. 줄바꿈·페이지 분할·전 페이지 marker를 구현하고 xref offset/object/page tree/stream length를 독립 검증한다. 100개 장·긴 본문 반례를 추가했다.

### [HIGH/RESOLVED] 제출 증거와 실제 실행 범위 불일치

원 commands.log는 11개 게이트를 포함하지 않았고 manifest도 implementation diff와 테스트 수를 기록하지 않았다. Codex가 새 checkout의 11개 결과, 89 일반, 43 보안, P06~P12 Chromium, 실제 출력 구조를 증거 패키지에 다시 기록했다.

## 6. 보안·데이터 무결성

- Review/finalization/output snapshot과 download audit의 조직·사건·보고서 경계를 확인했다.
- self-approval, Staff output, stale event, cross-scope revision, artifact tamper, review event UPDATE를 거부한다.
- 실제 API key/token/private key/고객정보는 0건이다.
- DB/SQLite/DOCX/PDF 생성 파일은 Git 추적 0건이다.
- 원본 보고서 템플릿과 local reference 제외 규칙은 유지된다.

## 7. 낮은 위험 메모

1. Node 24에서 의존성 도구가 `DEP0169` 경고를 출력하지만 모든 게이트는 exit 0이고 audit은 알려진 취약점 0건이다.
2. 실제 기능·반응형·200%·키보드 흐름은 Chromium으로 검증했지만 이미지 기반 시각 회귀 baseline은 아직 없다. P13부터 단계 시작 즉시 실제 화면을 먼저 완성하고 이를 E2E로 고정한다.

## 8. 다음 단계

`허용` — P13 비용·성공보수 단계로 진입할 수 있다. `FEE-01`을 공통 placeholder에서 실제 금액·요율·수납·미수·계산 이력 화면으로 교체하는 것을 첫 번째 산출물로 한다.
