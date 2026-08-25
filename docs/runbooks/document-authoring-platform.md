# 클레임센터 문서 제작 플랫폼 운영·서버 브리지 지침

## 1. 현재 Cloudflare에서 바로 사용하는 기능

### 구조화 편집기

- 보고서와 제안서의 편집 원본은 Tiptap JSON입니다.
- 사용자가 보는 본문은 같은 JSON에서 렌더링하며 Markdown은 검색·기존 출력 호환용으로 함께 저장합니다.
- 제목, 목록, 표, 링크, 이미지, 정렬, 찾기·바꾸기, 전체화면, 실행 취소·다시 실행을 지원합니다.
- AI 개선은 사용자가 선택한 구간과 지시만 서버에 보내며, 결과는 비교 후 사용자가 적용해야 원본이 바뀝니다.

### 영속 저장

- Cloudflare D1의 `preview_report_drafts.editor_json`과 `preview_report_revisions.editor_json`에 보고서 JSON을 저장합니다.
- 제안서는 기존 버전 레코드의 `structuredInputsJson`에 챕터별 `editorJson`을 포함합니다.
- 저장 시 예상 버전을 검사합니다. 다른 창에서 먼저 저장했다면 최신 데이터를 다시 읽고 병합해야 합니다.
- 편집 JSON 최대 크기는 2MB입니다. 사진·첨부 원본은 JSON에 base64로 넣지 않고 Google Drive 파일 ID나 HTTPS URL을 참조합니다.

### 최종 문서·출력

- rhwp 편집창에서 HWP/HWPX 최종 확인과 편집을 수행합니다.
- 승인된 동일 문서 원본을 기준으로 DOCX·PDF·Markdown을 생성합니다.
- 프로젝트 일정표는 A4 월간 인쇄 화면을 별도로 제공합니다.
- 다운로드 파일은 화면 표시본과 동일한 확정 버전 및 SHA-256 근거를 가져야 합니다.

## 2. PostgreSQL 이전 계약

베트남 서버나 회사 DB 서버로 이전할 때도 Tiptap JSON을 문서의 정본으로 유지합니다.

필수 컬럼 예시:

```sql
document_id uuid primary key,
organization_id uuid not null,
case_id uuid not null,
document_kind text not null,
document_version integer not null,
editor_json jsonb not null,
markdown_snapshot text not null,
updated_by uuid not null,
updated_at timestamptz not null,
unique (organization_id, document_id, document_version)
```

D1에서 PostgreSQL로 옮긴 뒤에는 문서별 JSON을 다시 Markdown으로 직렬화해 두 값의 해시가 일치하는지 검증합니다. 이미 확정된 출력 파일은 새로 덮어쓰지 않고 새 버전을 발급합니다.

## 3. 회사 서버 연결 후 활성화할 기능

### Gotenberg

- 목적: 서버 폰트와 머리글·꼬리글을 고정한 고품질 PDF 및 A4 출력.
- 배치: 인터넷에 직접 노출하지 않고 사내 서버 또는 VPS의 private network에 둡니다.
- Worker는 회사 HTTPS 변환 Bridge만 호출합니다.
- 권장 환경 변수: `DOCUMENT_RENDER_BRIDGE_URL`, `DOCUMENT_RENDER_BRIDGE_KEY_ID`, 암호화된 HMAC 공유키.
- 실패 시: 현재 Worker PDF/A4 출력을 계속 제공하고, 사용자가 확정한 문서 내용은 잃지 않습니다.

### Yjs·Hocuspocus

- 목적: 여러 사용자의 동시 편집, 커서 표시, 충돌 없는 변경 병합.
- 배치: WebSocket을 장시간 유지할 수 있는 베트남 서버·VPS에 Hocuspocus를 실행합니다.
- 방 이름: `organizationId:caseId:documentKind:documentId` 형식을 사용합니다.
- 접속 토큰에는 조직·사건·문서·사용자·역할을 넣고 5분 이내 만료시킵니다.
- 저장: Yjs update log는 협업 복구용이고, 확정 시점에는 반드시 Tiptap JSON 스냅샷을 PostgreSQL/D1에 새 버전으로 저장합니다.
- 실패 시: 단독 편집 모드와 D1 자동저장으로 자동 전환합니다.

### Mem0·LangGraph

- 목적: 승인된 작성 규칙 검색과 단계별 보고서 작성 흐름 실행.
- 배치: 베트남 서버의 private AI service에 설치하고 Cloudflare Worker에는 모델·Python 런타임을 넣지 않습니다.
- Mem0에는 원문 보고서나 개인정보를 그대로 넣지 않습니다. 사람 수정 전후 차이에서 뽑은 짧은 작성 규칙만 관리자 승인 후 저장합니다.
- LangGraph 노드는 `근거 준비 → 목차 → 챕터 초안 → 사람 검수 → 확정` 순서를 강제합니다.
- 외부 모델 호출 전 조직 AI 보안정책과 사건 권한을 다시 검사합니다.
- 실패 시: 현재 Hermes/D1 승인 규칙 검색만 사용합니다.

## 4. 서버 개발자 필수 API 경계

모든 Bridge는 HTTPS와 HMAC 서명을 사용하고 다음 공통 필드를 검증합니다.

- `organizationId`, `userId`, `caseId`, `documentId`, `documentVersion`
- `requestId`, `issuedAt`, `expiresAt`, `bodySha256`
- 조직·사건 배정 권한과 문서 버전

필수 원칙:

1. 브라우저가 Gotenberg·Hocuspocus 관리 API·Mem0·LangGraph에 직접 접근하지 않습니다.
2. API 키와 HMAC 공유키는 Cloudflare Secret 또는 AES-256-GCM 암호화 D1 레코드로만 저장합니다.
3. 외부 AI 원문 응답과 개인정보를 서버 로그에 남기지 않습니다.
4. Bridge 장애가 문서 편집·D1 저장을 막아서는 안 됩니다.
5. 운영 활성화 전 재시작 복구, 권한 위조, 타 조직 IDOR, 버전 충돌, 대용량 문서 반례를 자동 테스트합니다.

## 5. 인수 검수 순서

1. 보고서와 제안서를 각각 만들고 표·이미지·링크·목록을 편집합니다.
2. 다른 메뉴로 이동한 뒤 같은 작업을 열어 Tiptap JSON이 복원되는지 확인합니다.
3. 같은 문서를 두 창에서 저장해 오래된 버전이 거부되는지 확인합니다.
4. DOCX·PDF·HWP/HWPX 미리보기와 다운로드 본문의 제목·표·이미지 순서를 비교합니다.
5. 회사 서버 Bridge를 끈 상태에서도 편집·D1 저장·기본 출력이 유지되는지 확인합니다.
6. Bridge를 켠 뒤에만 Gotenberg, 실시간 협업, Mem0·LangGraph 상태를 `CONNECTED`로 표시합니다.
