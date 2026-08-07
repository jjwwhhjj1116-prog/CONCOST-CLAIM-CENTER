# P10 독립 재검수 요청

- 브랜치: `feat/P10-ai-gateway`
- Antigravity 원 구현 커밋: `4158169`
- Antigravity 상태 제출 커밋: `f9234ec`
- Codex 보정 구현 커밋: `d7b085d859543431d56f1776ebcb01225c17ada9`
- 검수 모드: 사용자가 승인한 `REVIEW_MODE=patch`
- 증거 경로: `artifacts/harness/P10/`

원 제출에 증거 패키지와 검수 요청서가 없고 P10 E2E가 HTTP-only였으므로 Codex가 보안·동시성·취소·감사·실제 Chromium 경로를 직접 보정했다. 구현 보정 커밋과 검수/상태 커밋은 분리한다.

## 요청 검수 범위

1. SSRF host/port/IP/DNS 재바인딩 및 redirect 경계
2. secret reference와 Git/API/오류/browser storage 원문 키 0건
3. 사건 정책 기본 거부와 provider/model allowlist
4. 전체 payload 멱등성 및 동시 budget reservation
5. bounded retry와 잘못된 키/timeout/429/5xx/schema/stream/cancel
6. request/attempt/ledger 불변성 및 tenant/actor/provider DB 경계
7. 시작/완료/실패/취소/정책·예산 차단 감사 이벤트
8. 실제 Chromium Admin 설정 및 Report Studio async/cancel/complete UI
9. P06~P09 회귀와 11개 clean gate

판정 결과는 `docs/reviews/P10-codex-review.md`와 `.json`에 기록한다.
