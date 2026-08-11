# P16 Antigravity 후속 지시 01

## 현재 상태

Codex가 안티그래비티의 P16 초안을 별도 worktree에서 보완하고 구현 커밋 `4bb68f7e9bd1e57954905df93e588dd9187432f4`을 생성했습니다. 기존 로컬 미커밋 파일은 덮어쓰지 않았습니다.

## 안티그래비티가 다음에 할 일

1. 기존 dirty 작업 폴더를 덮어쓰거나 reset하지 말고, 필요하면 별도 clean worktree에서 원격 `feat/P16-staging-readiness`를 확인합니다.
2. `artifacts/harness/P16/manifest.json`의 implementationCommit과 `git diff-tree` 12개 파일이 일치하는지만 읽기 전용으로 확인합니다.
3. 사용자에게 local release-candidate 화면을 보여줄 때는 synthetic 데이터만 사용하고, P16 Chrome 동선(대시보드→사건→자료/회의→Studio→승인→출력)을 그대로 시연합니다.
4. Cloudflare D1/R2, Render, DNS, 원격 서버 배포, 실제 Google credential 등록은 수행하지 않습니다.
5. 사용자가 명시적으로 배포를 승인하면 새 단계 제안서를 먼저 작성합니다. Node/SQLite 영속 볼륨 staging 배포와 Cloudflare D1/R2 migration은 서로 다른 선택지로 분리합니다.

## 금지 사항

- 기존 migration 파일 수정
- 운영 DB에 `db:reset` 또는 synthetic seed 실행
- 키·token·고객 본문·서버 절대 경로를 Git/API/log에 기록
- P16 이후 단계 또는 production deploy를 자체 승인
