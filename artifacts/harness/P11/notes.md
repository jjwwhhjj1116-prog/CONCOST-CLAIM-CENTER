# P11 독립 검수 및 직접 보정 메모

## 원 제출 대조

- Antigravity 구현 커밋은 `cfc552c`, 제출 커밋은 `0445f95`였다.
- 제출 당시 `phase-status.json`은 `P11 IN_PROGRESS`였고 `commands.log`, `notes.md`, `P11-review-request.md`가 없었다.
- manifest는 11개 게이트라고 주장했지만 4개 범주만 기록했고 `changedFiles`도 없었다.
- 원 P11 E2E는 실제 브라우저 사용자 흐름과 비동기 취소·사람 적용 경계를 충분히 검증하지 못했다.

## Codex 보정

1. exact source ID/version/hash/anchor/text를 API와 SQLite trigger 양쪽에서 검증하고 selection/item/citation/apply provenance를 append-only로 고정했다.
2. P10 Gateway를 경유하면서 raw provider response를 DB에 저장하지 않고 request/result hash와 redacted metadata만 보존했다.
3. 12개 적대 provider 모드, prompt injection 격리, source 변경 전송 전 차단, default-deny 정책, 취소·late response·ledger 정산을 구현했다.
4. 같은 조직이라도 사건 미배정 사용자의 생성·조회·적용·취소·폐기를 막고 Reviewer 작성 권한을 차단했다.
5. 사람의 별도 적용만 새 미승인 P09 DRAFT revision과 evidence link를 원자적으로 만들고, stale 충돌·중복 적용·승인 후 멱등 replay를 검증했다.
6. text 문서는 원본 bytes hash로, PDF/HWP는 동일 보고서의 불변 P09 사람 검증 인용문이 있을 때만 선택 anchor로 사용한다.
7. production bundle과 실제 Chromium에서 source 선택, 전송 범위 확인, 생성, citation preview, 사람 적용, 취소, Reviewer RBAC, 1024px/200%를 검증했다.

## 최종 검증

- 깨끗한 checkout: `2b883aa819888c6c58a160f2fddc7eff84354dfa`
- 11/11 게이트 exit 0
- 일반·계약: 88 passed, 0 failed, 0 skipped
- 보안: 42 passed, 0 failed, 0 skipped
- P06~P11 실제 Chromium E2E 전부 통과
- `pnpm audit --audit-level high`: 알려진 취약점 0건
- 실제 API key/token/private key/고객정보: 0건
- `sk-raw-secret-value` 1건은 DB 차단을 검증하는 합성 적대 테스트 문자열이며 실제 credential이 아니다.

## 남은 낮은 위험

- PDF/HWP 전체 본문 추출기는 P11에 포함하지 않았다. 현재는 P09에서 사람이 검증한 불변 인용문만 전송할 수 있다.
- Node 24에서 의존성 도구의 `url.parse()` DEP0169 경고가 출력되지만 모든 게이트는 exit 0이고 audit은 취약점 0건이다.
