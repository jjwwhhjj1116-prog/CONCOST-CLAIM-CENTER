# P10 독립 검수 및 보정 메모

## 제출 상태 대조

- Antigravity 제출 커밋 `f9234ec`은 상태를 `SUBMITTED`로 변경했지만 `artifacts/harness/P10/{manifest.json,notes.md,commands.log}`와 `docs/reviews/requests/P10-review-request.md`가 없었다.
- 원 구현 커밋 `4158169`의 `scripts/p10-e2e.ts`는 Chromium을 실행하지 않는 HTTP API 테스트였다.
- 사용자가 허용한 `REVIEW_MODE=patch`에 따라 구현 보정은 `d7b085d859543431d56f1776ebcb01225c17ada9`에, 검수 문서와 상태는 후속 검수 커밋에 분리한다.

## 보정한 High 결함

1. DNS 재바인딩, private/link-local/metadata IP, userinfo, 비표준 포트, 공급자 host allowlist를 검증하는 SSRF 방어를 추가했다.
2. 사건 정책의 기본 거부와 `allowedProviderIds`를 서버에서 강제했다.
3. 프롬프트뿐 아니라 provider/model/maxTokens를 포함한 전체 요청 fingerprint로 멱등성 충돌을 판정했다.
4. SQLite write lock 안에서 일일 budget을 재검사해 동시 요청의 이중 예약을 차단했다.
5. 비동기 요청 ID, 실제 `AbortController`, 상태 조회, 취소 시 예약 전액 반환, 늦은 응답의 터미널 상태 덮어쓰기 차단을 구현했다.
6. 공급자 실패 시 각 attempt의 token/cost를 누적하고 request/attempt/ledger의 tenant·불변성 DB trigger를 강화했다.
7. 시작·완료·실패·취소·정책 차단·예산 차단 감사 이벤트를 원문 prompt/secret 없이 기록했다.
8. P10 E2E를 production bundle과 실제 Chromium의 Admin 연결 테스트, Report Studio 비동기 요청, 실제 취소·완료 흐름으로 교체했다.

## 최종 검증

- 깨끗한 detached checkout: `d7b085d859543431d56f1776ebcb01225c17ada9`
- 11/11 게이트 통과
- 일반·계약 테스트: 87 passed, 0 failed, 0 skipped
- 보안 테스트: 41 passed, 0 failed, 0 skipped
- P06~P10 실제 Chromium E2E 전부 통과
- `pnpm audit --audit-level high`: 알려진 취약점 0건
- 원문 API key/token/고객정보/원본 템플릿 Git 추적: 0건

## 남은 낮은 위험 메모

- 외부 실공급자 네트워크 호출은 별도 배포 승인과 실 secret이 없으므로 의도적으로 `501`이다. P11 검수·CI는 결정론적 `LOCAL_FAKE`만 사용한다.
- pnpm audit 종료 후 Node `DEP0169` 경고가 출력되지만 감사 결과는 알려진 취약점 0건이다.
