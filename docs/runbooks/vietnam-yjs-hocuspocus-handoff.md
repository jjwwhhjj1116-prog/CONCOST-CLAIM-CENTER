# 베트남 서버 Yjs/Hocuspocus 실시간 협업 연결 지시서

목적: 베트남 개발팀이 회사 서버를 연결할 때 별도의 프론트 재설계 없이 **제안서와 보고서를 여러 승인 계정이 동시에 편집**하도록 만드는 실행 계약이다.

기준일: 2026-08-25. Hocuspocus v4는 Node.js 22 이상이 필요하다. 공식 v4 계약에 맞춰 `sessionAwareness`, 비동기 토큰, `onAuthenticate`, `onLoadDocument`, `onStoreDocument`를 사용한다.

## 1. 현재 저장소에 이미 구현된 범위

| 항목 | 현재 상태 |
|---|---|
| Tiptap 구조화 편집기 | 구현 완료 |
| Y.Doc + HocuspocusProvider 연결 | 구현 완료 |
| Collaboration/Caret, 사용자 이름·색상·접속 인원 | 구현 완료 |
| 제안서 room | `claim-center:{organizationId}:proposal-{proposalId}-{chapterNumber}` |
| 보고서 room | `claim-center:{organizationId}:report-{caseId}`; 3·4단계가 같은 문서를 공유 |
| 세션 사용자 표시 | 로그인 세션의 이름·이메일 자동 사용 |
| 인증 토큰 요청 | `POST /api/collaboration/token` |
| 서버 미연결 폴백 | 기존 단독 편집과 DB 저장 유지 |
| Hocuspocus 서버·PostgreSQL Yjs 저장 | 베트남 서버에서 이 문서대로 연결 |

프론트 활성화 조건은 `window.__CLAIM_CENTER_COLLABORATION_URL__` 존재 여부다. 값이 없으면 WebSocket을 만들지 않으므로 현재 Cloudflare Preview에는 영향을 주지 않는다.

## 2. 서버 패키지와 버전

회사 서버 monorepo에 `apps/collaboration`을 만들고 다음을 고정한다.

```bash
pnpm add @hocuspocus/server@4.6.0 @hocuspocus/extension-database@4.6.0 yjs@13.6.27 jose pg zod
```

- Node.js: `>=22`
- Hocuspocus server/provider: 같은 `4.6.0`
- Yjs: `13.6.27`
- PostgreSQL: 16 이상 권장
- Redis는 다중 Hocuspocus 인스턴스의 fan-out/presence 용도다. 문서 원본 저장소로 사용하지 않는다.

## 3. 공개 런타임 설정

웹 빌드 결과의 `/runtime-config.js`를 서버 배포 시 다음 내용으로 교체하거나 bind mount한다.

```js
window.__CLAIM_CENTER_COLLABORATION_URL__ = 'wss://claim.company.example/collaboration';
window.__CLAIM_CENTER_COLLABORATION_TOKEN_ENDPOINT__ = '/api/collaboration/token';
window.__CLAIM_CENTER_RHWP_STUDIO_URL__ = 'https://claim.company.example/rhwp-studio';
```

이 파일에는 주소만 넣는다. JWT, API key, DB 비밀번호, OAuth Secret은 절대 넣지 않는다. `runtime-config.js`는 React bundle보다 먼저 로드되도록 이미 `apps/web/index.html`에 연결되어 있다.

## 4. 협업 토큰 API 계약

### 요청

```http
POST /api/collaboration/token
Content-Type: application/json
Cookie: claim_center_session=<HttpOnly session>

{"documentName":"claim-center:concost:report-40000000-0000-4000-8000-000000000010"}
```

### 서버 검증 순서

1. HttpOnly 세션이 유효하고 사용자가 활성 계정인지 확인한다.
2. `documentName`을 클라이언트가 보낸 값 그대로 신뢰하지 않는다.
3. `proposal-{id}-{chapter}`이면 제안서·프로젝트·조직을 DB에서 역조회하고 1~3장만 편집을 허용한다.
4. `report-{caseId}`이면 사건 조직과 배정 권한을 DB에서 역조회한다.
5. 작성자/PM/관리자에게 `write`, 조회 권한자에게 `read`만 부여한다.
6. 타 조직·미배정 사건·삭제 문서는 `403`으로 거부하고, 확정 잠금 문서는 `read` 토큰만 발급한다.
7. 토큰 만료는 최대 5분, 1회성 `jti`를 사용한다. 원문과 API key는 claim에 넣지 않는다.

### JWT claim

```json
{
  "iss": "claim-center-api",
  "aud": "claim-center-hocuspocus",
  "sub": "user-uuid",
  "organizationId": "organization-uuid",
  "documentName": "claim-center:organization-uuid:report-case-uuid",
  "permission": "write",
  "name": "사용자 이름",
  "email": "user@con-cost.com",
  "jti": "random-uuid",
  "iat": 1787590000,
  "exp": 1787590300
}
```

### 성공 응답

```json
{"token":"eyJ..."}
```

실패 응답은 `401 SESSION_REQUIRED`, `403 DOCUMENT_ACCESS_DENIED`처럼 상태와 코드를 함께 반환한다. 확정 문서는 정상 조회하되 `permission=read`만 발급한다. 토큰과 쿠키는 로그에 남기지 않는다.

## 5. Hocuspocus 인증 계약

`onAuthenticate`에서 반드시 다음을 다시 검사한다.

1. 서명, `iss`, `aud`, `exp`, `jti`.
2. WebSocket이 요청한 `documentName`과 JWT의 `documentName`이 완전히 같은지.
3. 조직 ID와 문서 소유 조직이 같은지.
4. 계정 활성 상태와 문서 잠금 상태. 확정 전 발급된 write 토큰의 연결도 승인 이벤트에서 즉시 종료해 read 토큰으로 재연결시킨다.
5. `read` 사용자는 `connectionConfig.readOnly = true`로 update 메시지를 보낼 수 없도록 한다.

성공하면 `{ userId, organizationId, permission, name, email }`을 hook context로 반환한다. 실패하면 즉시 throw하여 연결을 닫는다. 인증은 `onConnect`가 아니라 보안 전용 `onAuthenticate`에서 수행한다.

## 6. PostgreSQL Yjs 저장 계약

```sql
CREATE TABLE collaboration_documents (
  organization_id uuid NOT NULL,
  document_name text NOT NULL,
  yjs_state bytea NOT NULL,
  state_sha256 char(64) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  PRIMARY KEY (organization_id, document_name)
);

CREATE TABLE collaboration_audit (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  document_name text NOT NULL,
  actor_user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('CONNECT','DISCONNECT','STORE','SNAPSHOT','AUTH_DENIED')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
```

- 저장키는 `(JWT organizationId, documentName)`으로 만든다.
- `onLoadDocument`는 DB에서 저장했던 **동일한 Yjs Uint8Array**를 반환한다.
- `onStoreDocument`는 `Y.encodeStateAsUpdate(document)` 결과를 transaction으로 UPSERT한다.
- JSON/HTML을 매번 Y.Doc으로 다시 만드는 방식을 금지한다. 최초 기존 문서 migration에서 한 번만 Tiptap JSON을 Y.Doc으로 변환한다.
- Hocuspocus `debounce`는 2초, `maxDebounce`는 10초를 시작값으로 한다. 종료 신호에서 pending store를 flush한 뒤 프로세스를 내린다.
- 별도로 사용자가 `저장`/`단계 완료`를 누르면 현재 Tiptap JSON과 Markdown snapshot을 업무 문서 버전 테이블에 저장한다. Yjs binary만으로 승인본을 대체하지 않는다.

## 7. Reverse proxy

Nginx 예시:

```nginx
location /collaboration {
  proxy_pass http://hocuspocus:1234;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 3600s;
}
```

브라우저에는 `wss://`만 노출한다. Hocuspocus 1234, PostgreSQL 5432, Redis 6379는 private network에서만 허용한다. `APP_ORIGIN` 이외 Origin은 WebSocket upgrade 전에 거부한다.

## 8. 문서 잠금·버전 정책

- 제안서: 1~3장만 공동 편집. 4~11장 회사 고정 모듈은 관리자 DB에서 개정하며 제안서 화면에서는 read-only다.
- 보고서: 작성/사람 검수 중 공동 편집. 최종 승인 시 room을 잠그고 새 update를 거부한다.
- HWP/HWPX는 binary 파일 동시편집 대상으로 쓰지 않는다. 공동 작업 정본은 Tiptap/Yjs이며 HWP/HWPX는 승인 템플릿을 불러와 최종 확인·내보내는 결과물이다.
- 확정 취소/수정 재개는 관리자 감사 기록과 새 문서 버전으로 처리한다.
- 최종 승인 API는 같은 transaction에서 문서를 잠그고 내부 서비스 호출/메시지로 해당 room 연결을 종료한다. 기존 write 연결이 5분 만료 때까지 남아 있게 두지 않는다.

## 9. HWP 서버 연결 추가 계약

현재 rhwp 브라우저 편집기는 **기존 HWP/HWPX를 가져온 뒤** 본문 편집과 같은 형식 내보내기가 가능하다. 빈 화면에서 새 HWP binary를 만드는 API는 rhwp v0.8.4에 없으므로 다음을 지킨다.

1. 회사 승인 템플릿 목록 API는 로그인·문서 권한을 검사하고 1회성 protected download URL을 반환한다.
2. 프론트는 그 원본을 `RhwpEditorDialog`의 `sourceFile`로 넘긴다.
3. 원본이 없는 상태에서는 HWP/HWPX 내보내기를 활성화하지 않는다.
4. 사내 rhwp runtime을 운영하면 `__CLAIM_CENTER_RHWP_STUDIO_URL__`에 동일 출처 URL을 넣는다.
5. HWP 템플릿 파일과 결과물은 Google Drive/사내 저장소에 보관하고 PostgreSQL에는 파일 ID, 버전, SHA-256, 작성자, 시각만 저장한다.

## 10. 필수 2계정 E2E 검수

서버 연결 완료 판정은 다음을 모두 녹화/캡처하여 제출할 때만 가능하다.

1. 서로 다른 브라우저에서 서로 다른 승인 계정 A/B로 로그인한다.
2. 같은 제안서 같은 1장을 열고 A 입력이 B에 1초 내 표시되는지 확인한다.
3. B의 커서·이름·색상이 A에 표시되는지 확인한다.
4. 같은 보고서에서 A/B가 다른 문단을 동시에 수정하고 조용한 덮어쓰기가 0건인지 확인한다.
5. 네트워크를 30초 끊었다가 재연결해 변경이 병합되는지 확인한다.
6. 브라우저 새로고침과 Hocuspocus 재시작 후 내용이 PostgreSQL에서 복원되는지 확인한다.
7. 타 조직/미배정 계정이 room 이름을 직접 추측해도 `403/인증 실패`인지 확인한다.
8. read-only 계정은 커서/조회만 되고 수정 update는 거부되는지 확인한다.
9. 보고서 최종 승인 후 기존 열린 탭에서도 새 수정이 거부되는지 확인한다.
10. Hocuspocus 중단 시 화면에 오프라인 상태가 보이고 기존 DB 저장 기능이 유지되는지 확인한다.

## 11. 배포 순서

1. PostgreSQL migration 적용.
2. `POST /api/collaboration/token` 구현 및 권한 반례 테스트.
3. Hocuspocus private service 배포와 DB persistence 연결.
4. Nginx `/collaboration` WebSocket proxy 설정.
5. `/runtime-config.js` 주소 주입.
6. 두 계정 실시간 E2E 수행.
7. 백업/복구 시험 후에만 협업 기능 운영 완료 표시.

완료 기준은 “WebSocket 연결됨”이 아니다. **서로 다른 승인 계정의 동시 편집, 재접속 복원, 권한 차단, 최종본 잠금, 장애 폴백**이 모두 통과해야 한다.
