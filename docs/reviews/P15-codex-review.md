# P15 Codex 검수 보고서

## 판정

PASS_WITH_NOTES

구현 커밋 3869f6ce3a179e232c5bf47f3c04dcaf392051d6에서 필수 11개 게이트가 모두 통과했습니다. Critical/High 미해결 결함은 없습니다.

## 핵심 검증

- 보고서 autosave 성공 후 API 프로세스를 종료하고 같은 SQLite DB로 재시작했을 때 본문이 유지됐습니다.
- 서버 전용 HMAC으로 서명한 백업에 DB, 업로드, credential vault, PKCE vault를 포함했습니다.
- 백업 이후 본문을 변경한 뒤 별도 복원 경로에 복원했을 때 백업 당시 본문과 업로드가 정확히 돌아왔습니다.
- 누락·추가·변조 파일, 잘못된 서명키, traversal, 기존 대상 덮어쓰기, migration/trigger/FK 불일치를 모두 fail-closed 처리합니다.
- 1,000 사건, 10,000 일정, 10,000 문서/버전, 200 보고서 장, 1,000 Google history 조건에서 p50 10.80ms, p95 14.76ms를 기록했습니다.
- Chromium 복원 화면에서 axe-core WCAG 2.0/2.1 A·AA Critical 0, Serious 0을 확인했습니다.

## 검증 수치

- 일반·계약: 128/128
- 보안: 95/95
- P14 real provider 회귀: 22/22
- 빌드: 59 modules, CSS 24.18 kB, JS 337.04 kB
- 의존성 감사: 알려진 취약점 0

## Notes

1. 약 1.2초의 클라이언트 debounce 안에서 아직 전송되지 않은 키 입력은 즉시 강제 종료 시 유실될 수 있습니다. 서버에 저장된 autosave revision은 재시작·복원에서 보존됩니다.
2. Cloudflare 전환은 사용자의 지시에 따라 보류했습니다. 현재는 영속 볼륨을 가진 Node/SQLite 서버 운영 계약을 검증했으며 D1/R2는 별도 원자성 재설계 후 진행해야 합니다.
3. 실제 Google staging 계정 대신 synthetic transport를 사용했습니다. 실제 고객 데이터와 실제 credential은 포함하지 않았습니다.

## 다음 단계

P16은 외부 배포를 강행하지 않고, 기존 Node/SQLite 영속 서버의 release candidate 운영 준비와 사용자 화면 완성도를 먼저 검증합니다.
