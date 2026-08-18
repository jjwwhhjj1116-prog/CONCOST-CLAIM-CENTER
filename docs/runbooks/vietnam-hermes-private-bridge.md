# 베트남 공유 서버 · Hermes Private Bridge 개발 지시서

상태: **서버 위치 확정 전 구현 계약 고정**  
현재 운영: Cloudflare Worker + D1 `D1_HERMES_COMPATIBLE_V2`  
목표: 베트남 공유 서버가 준비되면 공식 Hermes Agent를 선택적으로 연결하되 D1 승인·감사·범위 통제를 유지한다.

## 1. 절대 놓치면 안 되는 원칙

1. Cloudflare D1이 기억 후보, 관리자 승인, 비활성화, 사용 이력의 **유일한 기준 원장**이다.
2. Hermes 서버는 승인 권한을 갖지 않는다. 후보 분석·규칙 제안·검색 점수 계산만 수행한다.
3. 보고서 원문 전체, 다른 사건 내용, 채팅 기록 전체를 장기기억으로 보내지 않는다.
4. `organizationId + userId + caseId + claimType + chapterCode` 범위를 모든 요청에 명시한다.
5. 개인 기억은 동일 `userId`에서만 반환한다. 조직 기억도 관리자 `APPROVED` 상태만 생성 프롬프트에 들어간다.
6. Bridge 장애 시 보고서 저장·사람 편집은 계속 가능해야 한다. AI 생성은 D1 엔진으로 안전하게 폴백하거나 명확히 `BRIDGE_UNAVAILABLE`로 중단한다.
7. API 키, OAuth 토큰, 원본 파일, 주민번호·연락처 등 민감정보는 Bridge 요청·로그·벡터 메타데이터에 넣지 않는다.

## 2. 권장 배치 구조

```text
Cloudflare Worker
  ├─ D1: candidate / approval / usage / retrieval ledger (authoritative)
  ├─ Google Drive: source files (private)
  └─ HTTPS Private Bridge client
         │ mTLS 또는 Cloudflare Access Service Token + HMAC
         ▼
Vietnam Shared Server
  ├─ claim-memory-bridge (thin API, stateless)
  ├─ Hermes Agent runtime (Python, pinned release)
  └─ encrypted vector/index store (derived data only)
```

공식 Hermes Agent 소스는 별도 Python 서비스로 설치한다. Worker 번들에 Python 런타임이나 임의의 Hermes 소스를 복사하지 않는다.

- 공식 저장소: https://github.com/NousResearch/hermes-agent
- 공식 문서: https://hermes-agent.nousresearch.com/docs/

## 3. Cloudflare Secret·환경 변수

운영 값은 `wrangler.jsonc` 평문에 쓰지 말고 Secret으로 등록한다.

| 이름 | 위치 | 설명 |
|---|---|---|
| `MEMORY_BRIDGE_MODE` | Worker env | `D1_ONLY` 또는 `PRIVATE_SERVER_BRIDGE` |
| `MEMORY_BRIDGE_BASE_URL` | Worker env | 예: `https://memory-bridge.internal.con-cost.com` |
| `MEMORY_BRIDGE_KEY_ID` | Worker Secret | HMAC 키 식별자 |
| `MEMORY_BRIDGE_HMAC_KEY` | Worker Secret | 32바이트 이상 무작위 키 |
| `MEMORY_BRIDGE_ACCESS_CLIENT_ID` | Worker Secret | Cloudflare Access 사용 시 |
| `MEMORY_BRIDGE_ACCESS_CLIENT_SECRET` | Worker Secret | Cloudflare Access 사용 시 |
| `MEMORY_BRIDGE_TIMEOUT_MS` | Worker env | 권장 3,000ms, 최대 10,000ms |

베트남 서버에는 동일 HMAC 키의 현재·이전 버전만 두고 90일 이내 회전한다. 키 원문을 D1, Git, Docker image, `.env.example`에 넣지 않는다.

## 4. Bridge API 계약

모든 응답은 JSON이며 알 수 없는 필드는 거부한다. 최대 본문 64KB, 규칙 20개, 규칙당 800자, 후보 피드백 2,000자다.

### `GET /v1/health`

응답:

```json
{
  "status": "ready",
  "serviceVersion": "1.0.0",
  "hermesRuntime": "pinned-release-or-disabled",
  "schemaVersion": "CLAIM_MEMORY_V1",
  "time": "2026-08-18T00:00:00.000Z"
}
```

### `POST /v1/memory/analyze-feedback`

입력은 현재 `apps/cloudflare/src/memory-service.ts`의 `FeedbackAnalysisInput`과 일치시킨다.

```json
{
  "requestId": "uuid",
  "organizationId": "concost",
  "userId": "uuid",
  "caseId": "uuid",
  "claimType": "TYPE-03",
  "chapterCode": "CH-02",
  "scope": "CHAPTER",
  "scopeKey": "TYPE-03:CH-02",
  "feedback": "책임 표현을 단정하지 말 것",
  "beforeText": "redacted chapter excerpt",
  "afterText": "redacted human revision"
}
```

응답은 `{problem, rule, confidence, tags, diff, analyzer}`만 허용한다. `rule`은 지시문 한 문장으로 정규화하고 사실·숫자·개인정보를 새로 만들어내면 폐기한다.

### `POST /v1/memory/rank`

입력에는 D1에서 이미 `APPROVED`로 필터링한 규칙 ID·본문·범위만 보낸다. Bridge는 ID와 점수만 반환한다. Worker가 다시 D1 상태와 범위를 확인한 뒤 최대 8개를 사용한다.

### `POST /v1/memory/forget-derived`

관리자가 D1 규칙을 `DISABLED` 처리한 뒤 파생 인덱스를 삭제하기 위한 비동기 요청이다. D1 원장 삭제 API가 아니다.

## 5. 요청 서명

각 요청 헤더:

- `X-Claim-Key-Id`
- `X-Claim-Timestamp` (UTC epoch seconds, ±60초)
- `X-Claim-Nonce` (UUID, 10분간 재사용 거부)
- `X-Claim-Content-SHA256`
- `X-Claim-Signature = base64url(HMAC-SHA256(key, method + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + bodySha256))`

서버는 서명 검증 전에 본문을 처리하지 않는다. 실패 사유는 외부에 상세 노출하지 않고 `401 INVALID_BRIDGE_SIGNATURE`로 통일한다.

## 6. Cloudflare 코드 연결 지점

1. `apps/cloudflare/src/memory-service.ts`
   - 기존 `HermesCompatibleMemoryAgent`를 D1 로컬 폴백으로 보존한다.
   - 새 비동기 `MemoryBridgeClient` 인터페이스를 추가한다.
2. `apps/cloudflare/src/index.ts`
   - 관리자 정책이 `PRIVATE_SERVER_BRIDGE`이고 health check가 성공한 경우에만 Bridge를 호출한다.
   - 후보 저장 전 결과 스키마·길이·금칙어를 서버에서 재검증한다.
   - 생성 전 D1의 승인 상태·범위·사용자 일치를 다시 확인한다.
3. `preview_memory_retrieval_runs`
   - `engine_code`는 Bridge 사용 시 `HERMES_PRIVATE_BRIDGE_V1`, 폴백 시 `D1_HERMES_COMPATIBLE_V2`로 남긴다.
4. 관리자 설정
   - `연결 확인`, `최근 성공 시각`, `지연시간`, `폴백 상태`만 표시한다.
   - URL·키 원문은 브라우저에 반환하지 않는다.

## 7. 서버 구현 순서

1. 고정 버전 Python/컨테이너 런타임과 비루트 계정 생성.
2. `/v1/health`와 HMAC/nonce 미들웨어 구현.
3. strict JSON schema와 크기 제한 구현.
4. Hermes adapter를 thin service 뒤에 연결.
5. 암호화 저장소와 조직·사용자·사건 namespace 분리.
6. Cloudflare Access 또는 VPN으로 공개 인터넷 직접 접근 차단.
7. Worker preview 환경 연결 후 synthetic 데이터로만 검증.
8. 관리자 승인·비활성화·사용 이력 D1 정합성 확인 후 production 전환.

## 8. 필수 적대 테스트

- 다른 조직의 규칙·벡터 조회 403/0건.
- 다른 사용자의 `USER_FEEDBACK` 규칙 반환 0건.
- 다른 사건 원문이 short-term context에 섞이지 않음.
- PENDING/DISABLED 후보가 생성 프롬프트에 들어가지 않음.
- 서명 변조, timestamp 재사용, nonce 재사용 모두 401.
- 64KB 초과, unknown field, rule 800자 초과 모두 400.
- Bridge timeout에서 외부 호출은 bounded 1회, 무한 재시도 0.
- Bridge 장애 중 D1 초안 저장과 사람 편집은 정상.
- 로그·응답·D1·vector metadata에서 API key/OAuth token/raw secret 0건.
- 관리자가 규칙 비활성화 후 다음 생성부터 사용 0건.
- 동일 idempotency key 재요청 결과 동일, 다른 payload는 409.

## 9. 인수인계 완료 기준

- `GET /v1/health` 30회 연속 성공, p95 300ms 이하.
- Worker→Bridge TLS·Access·HMAC 3중 경계 검증.
- D1 `preview_memory_retrieval_runs.engine_code='HERMES_PRIVATE_BRIDGE_V1'` 증거 생성.
- 10개 적대 테스트와 실제 보고서 챕터 5단계 E2E 통과.
- 장애 시 D1 폴백 또는 명시적 중단 동작을 운영자가 재현.
- 비밀값·실고객 데이터가 Git/로그/테스트 fixture에 없음을 스캔.

위 조건이 완료되기 전에는 관리자 화면에 `외부 Hermes 연결 완료`라고 표시하지 않는다.
