# Vietnam Primary Server Migration Handoff

문서 목적: 베트남 개발팀이 GitHub 소스를 받아 **Cloudflare Worker/D1을 운영 서버로 사용하지 않고**, 회사 서버를 클레임센터의 주 서버로 배포하기 위한 필수 구현·검수 지시서다.

상태 기준: 2026-08-25 Cloudflare Preview에서 검증된 UI와 API 계약을 기준으로 한다.

> 현재 베트남 서버가 `dev.db` SQLite를 유지하는 주간 소스 업데이트는 이 문서의 PostgreSQL 목표 구조를 바로 실행하지 말고 `vietnam-weekly-sqlite-update.md`를 우선 적용한다. SQLite와 PostgreSQL 이전은 서로 다른 작업이며 같은 배포에서 임의로 혼합하지 않는다.

## 1. 가장 중요한 전제

1. 이번 작업은 단순한 DNS 변경이나 `apps/api` 실행 작업이 아니다.
2. 현재 최신 로그인·프로젝트 의뢰·제안서·일정·Google Drive·보고서·법원·관리자 설정 API의 기준 구현은 `apps/cloudflare/src/index.ts`와 `apps/cloudflare/migrations/0001~0046`에 있다.
3. `apps/api/src/server.ts`는 기존 P04~P16 Node/SQLite 서버다. 최신 Cloudflare 기능을 전부 포함한 대체 서버가 아니므로 **이 파일만 실행하고 완료 처리하면 안 된다**.
4. 프론트엔드는 같은 Origin의 `/api/*`를 호출한다. 새 서버에서도 브라우저가 다른 주소의 API를 직접 호출하게 만들지 말고, 단일 HTTPS 도메인 아래에서 웹과 API를 제공한다.
5. Tiptap JSON이 보고서·제안서의 편집 정본이다. PostgreSQL 이전 후에도 Markdown만 저장하거나 HTML만 저장하지 않는다.

## 2. 목표 운영 구조

```text
User Browser
   │ HTTPS
   ▼
Nginx or Caddy
   ├─ /, /assets/*        -> apps/web/dist (SPA)
   ├─ /api/*, /auth/*     -> claim-center-api (Node.js/TypeScript)
   └─ /collaboration/*    -> Hocuspocus WebSocket

Private Docker Network
   ├─ PostgreSQL          -> application source of truth
   ├─ Redis               -> nonce, bounded jobs, presence (not document source of truth)
   ├─ Gotenberg           -> DOCX/HTML to high-fidelity PDF
   ├─ Hocuspocus + Yjs    -> real-time collaboration
   ├─ Memory/AI Service   -> Mem0 + LangGraph + optional Hermes adapter
   └─ Backup Service      -> encrypted PostgreSQL backup and restore verification

Google Drive
   └─ private original evidence and final delivery files
```

Gotenberg, PostgreSQL, Redis, Hocuspocus, Mem0, LangGraph, Hermes 관리 API는 공개 인터넷에 직접 노출하지 않는다. Reverse proxy 또는 API 서버만 접근할 수 있는 private network에 둔다.

## 3. 현재 기능 중 그대로 보존할 것

- `apps/web`: Tiptap 편집기, rhwp HWP/HWPX 편집기, 보고서·제안서 단계형 UI, 일정표와 A4 인쇄 UI.
- 동일 Origin `/api/*` 호출 방식과 기존 JSON 응답·오류 코드.
- `HttpOnly`, `Secure`, `SameSite` 세션 쿠키와 역할 기반 접근제어.
- 조직·사용자·사건·문서 범위 검증 및 관리자 전용 DB 관리 화면.
- 문서 낙관적 버전 검사. 오래된 화면에서 저장하면 `409`로 거부하고 최신본을 다시 불러오게 한다.
- Tiptap JSON + Markdown snapshot + 작성자 + 저장 시각 + 버전 이력.
- Google Drive private 원본 저장, 업로더·업로드 시각·SHA-256 메타데이터.
- 확정 제안서·보고서의 DOCX/PDF/HWP/HWPX 출력 및 감사 이력.
- 관리자 승인 전 장기기억 사용 금지와 AI 원문 로그 금지.

## 4. 백엔드 이전 필수 작업

### 4.1 Worker API를 Node 서버로 포팅

`apps/cloudflare/src/index.ts`의 현재 API 라우트를 Node.js/TypeScript 서버 모듈로 분리한다. Express/Fastify/Hono Node adapter 중 하나를 사용할 수 있지만 외부 API 계약은 바꾸지 않는다.

필수 모듈 경계:

- auth/session/users/roles
- case intake and proposal award
- proposal authoring/templates/prompts/exports
- project workflow/schedule/PM/change requests
- kickoff/site survey/evidence/Google Drive
- report authoring/prompts/revisions/approval/final output
- litigation/court schedule
- settings/AI credentials/tutorial/audit
- ERP bridge and notification bridge

완료 조건은 화면이 뜨는 것이 아니라 기존 Preview에서 사용하던 모든 `/api/*` 요청이 서버 API로 통과하는 것이다.

### 4.2 D1을 PostgreSQL로 이전

1. `apps/cloudflare/migrations/0001~0046`을 순서대로 분석한다.
2. 초기 이전에서는 `preview_*` 테이블명을 유지해 API 포팅 위험을 줄인다.
3. D1 SQL을 PostgreSQL 문법으로 변환한다.
   - `?` bind placeholder -> `$1`, `$2` 또는 ORM parameter
   - `INSERT OR IGNORE` -> `INSERT ... ON CONFLICT DO NOTHING`
   - `group_concat` -> `string_agg`
   - SQLite boolean/integer -> PostgreSQL boolean 변환 규칙 고정
   - JSON 문자열 컬럼은 검증 후 `jsonb` 사용
4. D1의 `batch()`가 보장하던 원자 작업은 PostgreSQL transaction으로 묶는다.
5. 모든 외래키, unique key, version guard, soft-delete 조건을 보존한다.
6. 보고서 `editor_json`, 제안서 챕터별 `editorJson`, 프롬프트 버전, 감사 이력은 누락 없이 옮긴다.

Cloudflare Preview 데이터를 운영 서버로 가져올지 여부는 배포 전에 회사 담당자에게 확인한다. 가져오는 경우 테이블별 row count, 문서 버전 수, SHA-256을 이전 전후 비교한 migration report를 제출한다.

### 4.3 정적 웹 배포

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter claim-center-report-studio-web build
```

`apps/web/dist`를 Nginx/Caddy가 제공하고 SPA fallback을 `index.html`로 설정한다. `/api/*`, `/auth/*`, `/health`, `/readiness`, WebSocket 경로는 SPA fallback에서 제외한다.

## 5. 서버 연결 후 활성화할 기능

### 5.1 Gotenberg — 서버 이후 적용

- 최종 보고서·제안서와 월간 일정표를 회사 글꼴·여백·머리말·꼬리말 기준으로 PDF 변환한다.
- API 서버가 확정된 문서 버전만 Gotenberg에 전달한다.
- 출력 성공 후 파일 SHA-256, 문서 버전, 생성자, 생성 시각을 PostgreSQL에 기록한다.
- 장애 시 문서 편집·저장은 계속 가능하고 기본 출력으로 폴백한다.

### 5.2 Yjs + Hocuspocus — 서버 이후 적용

- 프론트 연결부는 이미 `StructuredDocumentEditor.tsx`에 구현되어 있다. 서버가 런타임 주소와 토큰 API를 제공하면 제안서 1~3장과 보고서 본문에서 자동 활성화된다.
- WebSocket 인증 토큰은 API 서버가 발급하며 5분 이내 만료시킨다.
- 프론트 room key는 `claim-center:{organizationId}:proposal-{proposalId}-{chapterNumber}`와 `claim-center:{organizationId}:report-{caseId}`이다. 서버는 세션에서 확인한 조직과 room의 조직이 같은지 다시 검사한다.
- 토큰의 조직·사건 배정·문서 권한을 Hocuspocus가 다시 검사한다.
- Yjs update log는 복구용이다. 확정 정본은 항상 Tiptap JSON 새 버전으로 PostgreSQL에 저장한다.
- 연결 실패 시 기존 단독 편집 + 자동저장 모드로 전환한다.
- 정확한 설치·JWT·PostgreSQL·Nginx·2인 동시편집 계약은 `docs/runbooks/vietnam-yjs-hocuspocus-handoff.md`를 그대로 따른다.

### 5.3 Mem0 + LangGraph + Hermes — 서버 이후 적용

- LangGraph 흐름: `근거 준비 -> 목차 -> 챕터 초안 -> 사람 검수 -> 확정`.
- Mem0에는 고객 원문·보고서 전체·개인정보를 넣지 않는다.
- 사람 수정 전후에서 추출한 짧은 작성 규칙만 후보로 만들고 관리자 `APPROVED` 후 검색에 사용한다.
- namespace에는 `organizationId`, `userId`, `caseId`, `claimType`, `chapterCode`를 반드시 포함한다.
- Hermes는 선택적 분석 adapter다. 승인 원장과 권한 판단은 애플리케이션 PostgreSQL이 담당한다.
- 관련 세부 계약은 `docs/runbooks/vietnam-hermes-private-bridge.md`를 따르되, D1 관련 표현은 PostgreSQL 승인 원장으로 치환한다.

### 5.4 서버를 기다릴 필요가 없는 항목

- `docx-preview`는 브라우저 프론트 라이브러리다. 필요하면 서버 이전과 독립적으로 추가할 수 있다.
- rhwp 편집기는 이미 브라우저에서 실행된다. 서버에서는 승인 템플릿과 결과 파일을 안전하게 저장·전달하면 된다.
- Claude의 Microsoft Office 플러그인을 웹에 그대로 삽입할 수는 없다. 필요하면 별도 Anthropic API와 승인된 Tiptap 선택 영역 도구로 구현해야 한다.

## 6. Google Drive 재연결

새 운영 도메인으로 OAuth 설정을 다시 등록한다.

1. Google Cloud에서 회사 전용 프로젝트와 Drive API를 사용한다.
2. OAuth redirect URI를 정확히 등록한다.
   - `https://<new-company-domain>/api/google/oauth/callback`
3. JavaScript origin은 `https://<new-company-domain>`만 등록한다.
4. Client ID/Secret은 서버 Secret에 저장하고 Git·프론트 번들·로그에 넣지 않는다.
5. Refresh token과 개인/조직 AI key는 AES-256-GCM으로 암호화해 저장한다.
6. 계정 교체·연결 해제·재연결·권한 취소를 관리자 화면에서 검증한다.
7. 자료 업로드 후 Drive 폴더, 업로더, 날짜, 파일 SHA-256과 DB 메타데이터가 일치해야 한다.

## 7. 환경 변수 계약

실제 값은 Git에 커밋하지 않는다. `.env.example`에는 이름과 설명만 둔다.

```dotenv
APP_ORIGIN=https://claim.<company-domain>
CLAIM_ALLOWED_ORIGINS=https://claimcenterstudio.con-cost.co.kr
PORT=8080
NODE_ENV=production
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
SESSION_COOKIE_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY=...
GOOGLE_ALLOWED_DOMAIN=con-cost.com
GOOGLE_ALLOWED_ACCOUNT=...
AI_CREDENTIAL_MASTER_KEY=... # 32-byte hex/base64url; 관리자 설정에 저장한 AI/Hermes secret 암호화
GEMINI_API_KEY=...
GEMINI_DATA_GOVERNANCE_MODE=...
GOTENBERG_URL=http://gotenberg:3000
HOCUSPOCUS_URL=ws://hocuspocus:1234
COLLABORATION_JWT_SECRET=...
MEMORY_SERVICE_URL=http://memory-ai:8000
MEMORY_BRIDGE_HMAC_KEY=...
ERP_PROJECT_WEBHOOK_URL=...
ERP_PROJECT_WEBHOOK_SECRET=...
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
BACKUP_ENCRYPTION_KEY=...
```

현재 Node/SQLite 전환 단계에서는 `pnpm db:migrate`를 실행해 `ServerSetting` 테이블을 먼저 생성한다. 관리자 설정 API는 빈 성공값을 반환하는 mock으로 대체하지 않으며, 워크스페이스·AI 정책·튜토리얼·사용자 설정과 암호화된 API key 메타데이터를 SQLite에 저장한다. `AI_CREDENTIAL_MASTER_KEY`는 32바이트 키를 사용하며 운영 중 변경하면 기존 secret을 복호화할 수 없으므로 비밀 저장소와 백업 절차에 포함한다. 미설정 시 기존 Google credential master key로 호환되지만, 운영에서는 키 분리를 권장한다. `CLAIM_ALLOWED_ORIGINS`에는 경로가 아닌 정확한 프론트 origin만 기록하고, reverse proxy에서 CORS 헤더를 임의로 덮어쓰지 않는다.

AI 공급자 연결 확인은 저장 여부만 보고 성공 처리하지 않고 Gemini/OpenAI/Anthropic의 고정 공식 API endpoint에 실제 검증 요청을 보낸다. Hermes는 사설 주소에 대한 무제한 서버 요청을 허용하지 않으며, 베트남 서버가 allowlist 기반 health adapter를 주입하기 전에는 `501`로 명확히 응답한다.

## 8. 보안 필수 조건

1. 모든 외부 통신은 TLS 1.2 이상을 사용한다.
2. PostgreSQL/Redis/Gotenberg/Hocuspocus/Mem0/LangGraph/Hermes 포트는 방화벽에서 외부 차단한다.
3. 비밀번호는 평문 저장·로그 출력·초기 비밀번호 Git 커밋을 금지한다.
4. 세션은 서버 저장형이며 로그아웃·비밀번호 변경·계정 비활성화 시 즉시 revoke한다.
5. 업로드 파일은 크기, 확장자, MIME, magic byte, SHA-256을 검사한다.
6. 조직·사건·프로젝트 ID를 브라우저가 보냈다는 이유만으로 신뢰하지 않는다.
7. AI 공급자에 보낼 자료는 회사 정책과 사용자의 사건 권한을 검사하고 최소 범위만 전송한다.
8. API key, OAuth token, cookie, HMAC key, 고객 원문을 로그에 남기지 않는다.
9. 관리자 삭제는 soft-delete와 감사 이력을 우선하며, 영구삭제는 별도 승인 절차를 둔다.

## 9. 백업·복구

- PostgreSQL 일일 암호화 full backup과 지속 WAL 보관을 구성한다.
- Google Drive OAuth 암호화 레코드, AI credential 암호화 레코드, 감사 로그도 백업 범위에 포함한다.
- 최소 월 1회 빈 서버에서 복구 훈련을 수행한다.
- `/health`는 프로세스 생존만, `/readiness`는 PostgreSQL·필수 migration·저장공간 상태를 확인한다.
- 백업 생성 성공이 아니라 restore 후 로그인, 프로젝트 조회, 보고서 이어쓰기까지 성공해야 복구 성공이다.

## 10. 단계별 작업 순서

1. `feat/server-primary-migration` 브랜치 생성 및 현재 Preview API inventory 작성.
2. Docker Compose와 reverse proxy, PostgreSQL migration baseline 구성.
3. Worker API를 Node 서버로 포팅하고 기존 웹을 동일 Origin으로 연결.
4. 로그인·권한·프로젝트 의뢰·제안서·수주 확정·일정표부터 E2E 통과.
5. Google Drive OAuth와 전체 자료 업로드를 새 도메인으로 재연결.
6. 보고서·제안서 Tiptap JSON 저장, 이어쓰기, HWP/HWPX/DOCX/PDF 검증.
7. Gotenberg 연결.
8. Yjs/Hocuspocus 연결과 동시 편집 충돌 테스트.
9. Mem0/LangGraph/Hermes 승인 기반 기억 연결.
10. ERP·메일 알림 연결, 백업/복구 훈련 후 production cutover.

## 11. 필수 E2E 인수 시나리오

- 다른 PC에서 승인된 계정 로그인, 미승인/비활성 계정 로그인 거부.
- 프로젝트 의뢰 자료 업로드 -> Gemini 정리 -> 의뢰서 저장 -> 제안서에서 조회.
- 제안서 1~3장 AI 초안 -> 사람 편집 -> 전체 미리보기 -> 확정 -> 다운로드.
- 제안서 수주 확정 전에는 프로젝트 일정표에 나타나지 않음.
- 수주 확정 후 일정표로 이동하고 PM·6단계 시작/종료일 저장 및 양방향 반영.
- 착수회의·현장조사별 허용 자료만 업로드되고 Google Drive 프로젝트 폴더에 저장.
- 보고서 목차 -> 챕터 AI 초안 -> 사람 수정 -> 저장 후 다른 메뉴 이동 -> 이어쓰기 복원.
- 동일 보고서를 두 브라우저에서 수정했을 때 조용한 덮어쓰기 0건.
- HWP/HWPX import/edit/export와 DOCX/PDF의 제목·표·이미지 순서 일치.
- Gotenberg 중단 중에도 편집과 PostgreSQL 저장 정상.
- Hocuspocus 중단 시 단독 편집 폴백 정상.
- PENDING/DISABLED 기억이 AI 프롬프트에 포함되지 않음.
- 타 조직·타 사건·미배정 사용자의 직접 URL/API 접근 403.
- PostgreSQL 복구 후 사용자·프로젝트·문서 버전·감사 이력 일치.

## 12. 완료 제출물

개발팀은 다음을 함께 제출한다.

- architecture diagram과 Docker Compose/배포 manifest
- PostgreSQL schema 및 D1-to-PostgreSQL mapping 표
- API inventory와 포팅 완료 체크리스트
- Secret 목록(값 제외)과 운영자 설정 가이드
- 자동 테스트 결과와 브라우저 E2E 증거
- 데이터 이전 row count/SHA-256 검증 보고서
- 백업·복구 훈련 보고서
- 장애 폴백 결과(Gotenberg, Hocuspocus, AI memory 각각)
- 알려진 미완료 기능과 운영 위험 목록

위 인수 시나리오가 모두 통과하기 전에는 Cloudflare Preview를 종료하거나 새 서버를 운영 완료로 표시하지 않는다.
