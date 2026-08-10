# P14 Google Workspace Integration — Codex 보정 및 검수 메모

## 결과

- 판정: `PASS_WITH_NOTES`
- 구현 커밋: `5554f6c5187b698faebccfbc13956eeb1e794889`
- 깨끗한 Node 20.18.0 / pnpm 9.15.0 체크아웃에서 11개 필수 게이트 전부 통과
- 일반·계약 테스트 113/113, 보안 테스트 90/90, P14 real-adapter 22/22, Chromium P14 10개 흐름 통과

## Codex가 직접 보완한 핵심

1. OAuth Authorization Code + PKCE, one-time state, TTL, actor/organization/version CAS를 실제 서버 계약으로 구현했습니다.
2. 운영용 Google adapter와 환경 기반 bootstrap을 추가하고, 고정 Google host·redirect allowlist·bounded timeout·안전한 응답 projection을 강제했습니다.
3. access/refresh token은 조직 범위 AES-256-GCM vault에만 암호화 저장하고 DB에는 opaque `SECREF_*`만 저장합니다. 다른 조직 ref는 resolve/revoke/delete 전에 차단됩니다.
4. Drive/Gmail/Calendar/Docs/Sheets를 CASE-04·CASE-06·MEET-01 실제 UI와 연결했습니다. Gmail은 P06 저장소, Docs/Sheets는 immutable provenance snapshot으로 연결됩니다.
5. 동일 payload 재시도, 동시 요청, 외부 응답 유실, 429/5xx/timeout, stale version, audit rollback, 교차 사건·교차 조직 IDOR를 fail-closed 처리합니다.
6. 불확실한 외부 mutation은 `RECONCILIATION_REQUIRED`로 격리하고 Admin 확인·감사 후에만 새 작업을 허용합니다.
7. 1440/1024/640px, 200% 확대, 키보드·focus, 121개 resource, 100개 이력, 긴 이름, 401/403/409/offline/retry를 실제 Chromium으로 검증했습니다.
8. 기존 `20260810140000` migration은 수정하지 않고 `20260810141000` additive invariant migration만 추가했습니다.

## 알려진 제한 / P15 이관

1. 실 Google 운영 계정과 고객자료는 지시대로 사용하지 않았습니다. 실제 provider는 주입 transport와 synthetic credential로 검증했으며, 운영 배포 전 별도 staging 계정 실증이 필요합니다.
2. PKCE verifier는 현재 프로세스 메모리에 있으므로 서버 재시작·다중 인스턴스 중 callback 가용성이 떨어질 수 있습니다. P15에서 durable encrypted state store로 이전합니다.
3. 현재 Node/SQLite/파일 vault 운영에는 영속 디스크와 검증된 백업·복구가 필요합니다. 사용자가 언급한 Cloudflare 전환은 D1 트랜잭션 재설계가 필요하므로 별도 배포 단계로 유지하고, P15에서 우선 로컬/Node 운영의 crash-safe backup·restore를 실증합니다.

## 데이터 및 비밀정보

- 실제 API key/token/customer data: 0건
- 테스트 문자열: `.invalid` 도메인 및 `synthetic-*` credential fixture만 사용
- 브라우저 DOM, URL, localStorage, sessionStorage, API 응답에 credential 원문: 0건
