# P16 Antigravity 선행 구현 지시서

## 단계명

Release Candidate UX & Persistent Staging Readiness

## 진입 규칙

1. feat/P15-integrated-quality 최신 Codex 증거 커밋에서 feat/P16-staging-readiness 브랜치를 만듭니다.
2. phase-status의 P16을 IN_PROGRESS, nextPhaseAllowed를 false로 설정한 시작 커밋을 먼저 만듭니다.
3. P15 backup·restore·vault·autosave 계약을 약화하거나 migration 역사를 수정하지 않습니다.
4. 완료를 스스로 PASS로 기록하지 않습니다. 구현 완료 상태는 READY_FOR_REVIEW, nextPhaseAllowed false입니다.

## 우선순위 1: 사용자가 보는 화면부터 완성

- Dashboard → 사건 → 자료/회의 → Report Studio → 검토/승인 → 최종 출력의 실제 사용자 동선을 브라우저에서 먼저 확인합니다.
- 빈 상태, loading, 오류, 403, 409, offline/retry가 임시 문구가 아니라 일관된 제품 UI로 보이도록 정리합니다.
- 1440, 1024, 640, 200%에서 주요 행동이 보이고 키보드와 포커스가 끊기지 않아야 합니다.
- 실제 화면 캡처와 Chromium 시나리오를 증거로 남깁니다. API/DB만 구현하고 UI를 뒤로 미루지 않습니다.

## 우선순위 2: 현재 서버의 영속 운영 준비

- SQLite DB, uploads, outputs, Google credential vault, PKCE vault, backups를 하나의 영속 volume root 아래 구성하는 production env matrix를 작성합니다.
- ephemeral 경로 또는 필수 master/signing key가 누락된 production 시작은 fail-closed 해야 합니다.
- health/readiness가 DB writeability, storage writeability, migration 상태, backup root를 비밀 없이 보고해야 합니다.
- 수동 backup 생성·검증·격리 restore drill과 최소 3개 retention을 운영 runbook대로 실행합니다.
- 복구 연습은 기존 운영 경로를 덮어쓰지 않고 별도 logical restore target만 사용합니다.

## 우선순위 3: Release Candidate 운영 안전

- production에서 synthetic seed, fake provider mode, test-only endpoint가 기본 비활성인지 검증합니다.
- 로그의 token, secret, 고객 문서 본문, 로컬 절대경로 노출 0건을 검사합니다.
- 프로세스 재시작, 저장 중 종료, backup 중 종료, disk-full/readonly 모사, 잘못된 key, 손상 package를 적대 테스트에 포함합니다.
- 모니터링·오류 안내·관리자 복구 절차를 문서화합니다.

## Cloudflare 보류

- 이번 P16에서 Cloudflare D1/R2로 전환하거나 Render에 배포하지 않습니다.
- Cloudflare는 현재 Prisma callback transaction, SQLite trigger, 파일 저장소를 그대로 대체할 수 없으므로 별도 승인된 migration phase에서만 진행합니다.
- 사용자의 별도 배포 승인이 있기 전 외부 production deploy, DNS 변경, 실제 Google credential 등록을 하지 않습니다.

## 필수 게이트와 제출

- P15와 동일한 11개 게이트를 clean checkout에서 모두 통과합니다.
- P16 전용 실제 Chromium E2E, restart/recovery drill, production-config negative tests를 추가합니다.
- 구현 커밋 A와 증거/상태 커밋 B를 분리하고 manifest.changedFiles를 A의 diff-tree와 1:1 일치시킵니다.
- 제출 상태는 READY_FOR_REVIEW, nextPhaseAllowed false입니다.
