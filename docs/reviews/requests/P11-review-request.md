# P11 검수 요청서 — Codex 보정본

## 제출 정보

- 브랜치: `feat/P11-grounded-ai-authoring`
- 원 구현: `cfc552c`
- 원 제출: `0445f95`
- Codex 보정 구현: `2b883aa819888c6c58a160f2fddc7eff84354dfa`
- 검수 모드: patch
- 증거: `artifacts/harness/P11/`

## 12개 필수 적대 반례

| # | 반례 | 기대 부작용 | 실제 결과 |
|---:|---|---|---|
| 1 | 근거 없는 금액·수량 | 적용 revision 0, BLOCKED | `REVIEW_REQUIRED`, 적용 불가 |
| 2 | 존재하지 않는 판례 | 적용 revision 0, BLOCKED | `REVIEW_REQUIRED`, 적용 불가 |
| 3 | source prompt injection | policy 변경·secret 출력 0 | untrusted data로 격리, cited draft만 생성 |
| 4 | cross-case/cross-tenant citation | 외부 전송·citation 0 | API/DB 거부 또는 BLOCKED |
| 5 | 선택하지 않은 source | foreign citation 저장 0 | BLOCKED, invalid citation 미저장 |
| 6 | 법적 결론 확정 | 사실 확정 출력 0 | `REVIEW_REQUIRED` |
| 7 | 숫자 단위 변경 | 변조 적용 0 | `REVIEW_REQUIRED` |
| 8 | 상충 근거 | 임의 선택 0 | `CONFLICT`, 적용 불가 |
| 9 | source hash/삭제/새 버전 | provider 호출 0 | manifest 재검증 409 |
| 10 | malformed/missing anchor | VALID citation 0 | BLOCKED, 적용 불가 |
| 11 | 자동 승인·기존 승인본 변경·self approval | 승인/잠금 변경 0 | 별도 DRAFT만 생성, P09 승인 RBAC 유지 |
| 12 | 동시 apply stale conflict/cancel late response | orphan·이중 비용 0 | 409/단일 revision, ledger 합계 0 |

추가로 미배정 Staff apply/discard, 승인 후 동일 apply replay, PDF 사람 검증 인용문 grounding, raw response/audit/browser storage redaction을 검증했다.

## 실제 브라우저

production bundle과 설치된 Chromium에서 PM 로그인 → P09 studio → FINAL 회의록 exact version 선택 → 전송 범위/최대 비용 확인 → 비동기 생성 → citation anchor 확인 → 사람 적용 → 새 미승인 revision/evidence 확인 → slow 요청 취소 → Reviewer read-only → 1024px/200%/keyboard focus를 실행했다.

## 품질 게이트

- 11/11 exit 0
- 일반·계약 88 passed
- 보안 42 passed
- P06~P11 실제 Chromium 전부 통과
- audit high/critical 0
- actual secret/customer data 0

## 알려진 제한

- PDF/HWP 전체 추출은 하지 않는다. P09에서 사람이 검증한 불변 quote가 있는 binary document만 선택 가능하다.
- 실공급자 live credential은 별도 배포 승인 전 비활성이다.
