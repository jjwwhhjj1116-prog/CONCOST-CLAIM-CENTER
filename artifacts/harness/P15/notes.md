# P15 Codex 보정 및 검증 메모

## 결과

- 판정: PASS_WITH_NOTES
- 구현 커밋: 3869f6ce3a179e232c5bf47f3c04dcaf392051d6
- 필수 게이트: 11/11 PASS
- 일반·계약 테스트: 128/128
- 보안 테스트: 95/95
- axe 자동 접근성 검사: Critical 0, Serious 0

## Codex가 직접 보완한 내용

1. VACUUM INTO 기반 SQLite 일관 백업과 서버 서명 manifest를 구현했습니다.
2. DB, 업로드, Google credential vault, PKCE vault를 하나의 PREPARING → READY 패키지로 묶었습니다.
3. 복원은 빈 격리 경로에서만 허용하며 파일 집합, SHA-256, migration ledger, trigger, FK를 재검증합니다.
4. OAuth PKCE verifier를 조직·사용자·state·TTL에 묶인 AES-256-GCM 영속 vault로 이전했습니다.
5. 실제 보고서 자동저장 후 API 종료·재시작, 서명 백업, 이후 변경, 격리 복원을 Chromium으로 검증했습니다.
6. axe-core를 실제 복원 화면에 적용하고 색상 대비 문제를 수정해 Critical/Serious 0건을 만들었습니다.
7. 기존 전체 테스트에서 빠졌던 P14 real-adapter 22개 회귀를 다시 전체 test 명령에 포함했습니다.
8. 운영 README, backup/restore runbook, 데이터 보존 ADR을 작성했습니다.

## 운영 메모

- 약 1.2초 debounce 동안 아직 서버에 전송되지 않은 마지막 키 입력은 즉시 강제 종료 시 유실될 수 있습니다. 한번 autosave API가 성공한 개정은 동일 DB로 서버를 재시작해도 보존됩니다.
- 현재 보존 계약은 Node/SQLite 영속 볼륨 기준입니다. 사용자가 보류한 Cloudflare D1/R2 이전은 transaction·trigger를 재설계하는 별도 단계이며 이번 P15에서 배포하지 않았습니다.
- 실제 고객자료나 실제 Google credential은 사용하지 않았습니다.
