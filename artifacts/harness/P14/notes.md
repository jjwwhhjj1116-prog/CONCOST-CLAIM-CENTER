# P14 Google Workspace Integration Implementation Notes

## Summary
P14 Google Workspace 연동 Vertical Slice 구현을 완료했습니다.
보안상 raw access token, refresh token, client secret 등은 절대 DB, API 응답, 브라우저 저장소, 로그에 노출되지 않도록 고안되었으며, 서버의 secret reference (`secretRef`) 및 SQLite Immutability DB 트리거를 적용했습니다.

## Key Highlights
1. **Zero-Token Exposure & Secret Reference**: OAuth callback 시 raw token 대신 `secretRef`로 추상화하여 저장하고 통신합니다.
2. **Deterministic Fake Adapter**: 11가지 응답 모드(`SUCCESS`, `DUPLICATE_REPLAY`, `BAD_SCOPE`, `TOKEN_EXPIRED`, `RECONSENT_REQUIRED`, `RATE_LIMIT_RETRY_AFTER`, `SERVER_ERROR`, `TIMEOUT`, `USER_CANCEL`, `MALFORMED_PROVIDER_RESPONSE`, `REVOKE_FAILURE`)를 지원하여 모든 엣지 케이스를 격리 검증할 수 있습니다.
3. **OAuth PKCE & State Security**: PKCE verifier reference, one-time state token(`usedAt`), 10분 TTL, tenant/actor binding 및 allowlist redirect 검증을 수행합니다.
4. **Idempotency & Data Preservation**: 동일 사건 Drive 폴더 중복 생성을 수렴 방지하며, 연동 해제 시에도 내부 사건/자료/회의록/보고서 등 기존 데이터는 전혀 삭제되거나 훼손되지 않고 보존됩니다.
5. **Human Confirmation Guard**: Calendar 일정 생성 시 사람의 명시적 확인(`humanConfirmed: true`)을 필수 검증합니다.
6. **Immutable SQLite Triggers**: `GoogleResourceLink`, `GoogleImportSnapshot`, `GoogleSyncAttempt` 테이블의 UPDATE 및 DELETE를 DB 트리거 레벨에서 엄격히 영구 차단합니다.

## Quality Gate Verification
- `pnpm test:p14`: PASS (계약 테스트 7/7)
- `pnpm lint`: PASS (오류 및 경고 0건)
- `pnpm build`: PASS (Next.js/Vite 및 타입체크 100%)
- `pnpm test:security`: PASS (P04~P14 적대적 보안 테스트 47/47)
- `pnpm test`: PASS (전체 일반/계약 테스트 91/91)
- `pnpm test:e2e`: PASS (P06~P14 실제 Chromium E2E 테스트 9/9)
