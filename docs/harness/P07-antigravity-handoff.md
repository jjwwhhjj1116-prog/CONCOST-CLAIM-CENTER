# P07 Antigravity 선행 구현 지시서 — 제안서 템플릿과 작성기

## 0. 진입 조건

- P06 최종 판정: `PASS`
- P06 Codex 보정·검수 커밋: `7ae66f2845712c1f6b4c5fa3012dd5f82c0d4ebc`
- 원본 E 저장소에 이 P06 PASS 기록·증거·handoff가 통합된 최신 커밋에서 새 브랜치를 만든다.
- 권장 브랜치: `feat/P07-proposal-template-writer`
- 먼저 `phase-status.json`을 `currentPhase: P07`, `P07.status: IN_PROGRESS`, `nextPhaseAllowed: false`로 바꾸는 시작 커밋을 만든다.
- P06의 일반 60개·보안 22개·실제 Chrome E2E를 삭제·완화·skip하지 않는다.
- P08은 Codex의 P07 PASS 전까지 시작하지 않는다.

## 1. 고정 구현 범위

v2 지시서 P07 범위만 구현한다.

1. 사건 선택
2. 제안서 템플릿 선택
3. 사건번호·사건명·6대 유형·관계자 등 사건정보 자동 치환
4. 의뢰 배경·수행 목적·수행 방법·예상 성과물·제외사항 입력
5. AI 공급자·모델 선택과 `AI 미사용` 수동 모드
6. 초안 생성 또는 수동 작성
7. 사용자 수정과 버전 저장
8. 검토 요청·승인·반려
9. 승인 후 실제 DOCX/PDF 출력
10. 버전·생성 이력·근거자료·승인 이력 추적

P08 보고서 템플릿/블록 카탈로그, P09 보고서 스튜디오, 실제 외부 AI 키/OAuth 호출은 P07로 앞당기지 않는다. P07 제안서 템플릿은 합성 fixture와 결정적 로컬 provider로 검증한다.

## 2. 데이터 모델·마이그레이션

- 최소 `ProposalTemplate`, `Proposal`, `ProposalVersion`, `ProposalReview`(또는 동등한 승인 이력)를 Prisma와 additive migration으로 구현한다.
- P04~P06의 조직·사용자·사건·Document/DocumentVersion/AuditLog 관계를 보존한다. 기존 테이블 DROP/재생성은 금지한다.
- Proposal은 caseId, templateId/version snapshot, status, currentVersionId, approvedVersionId, optimistic `version`, created/updated actor·time을 가진다.
- ProposalVersion은 변경 불가 snapshot이어야 하며 본문/구조화 입력, 렌더링된 치환 값, 누락 필드 목록, generation mode(`MANUAL`/`AI`), provider/model, prompt/config version, 근거 DocumentVersion ID 목록, SHA-256을 기록한다.
- 승인 상태는 최소 `DRAFT -> IN_REVIEW -> APPROVED`와 `IN_REVIEW -> REJECTED -> DRAFT`를 명시하고 DB/API가 잘못된 전이를 거부한다.
- 승인된 버전의 본문·치환값·근거·출력 연결은 UPDATE/DELETE 불가로 DB에서 강제한다.
- 모든 mutation과 AuditLog는 같은 transaction에 있고 stale version은 409여야 한다.
- P06 `Document`/`DocumentVersion` 저장·다운로드 보안 경계를 재사용한다. 출력 파일을 사용자 파일명 경로에 직접 저장하거나 별도 무보안 저장소를 만들지 않는다.

## 3. 템플릿·치환 계약

- P07 전용 합성 제안서 템플릿 fixture를 만들고 6대 고정 유형 `TYPE-01`~`TYPE-06`만 선택 가능하게 한다.
- 허용 placeholder를 명시적 allow-list로 정의한다. 예: 사건번호, 사건명, 유형, 담당자, 의뢰인, 작성일.
- 서버가 template text를 임의 코드/HTML로 실행하지 않게 하고 unknown placeholder는 자동 삭제하지 말고 `누락: FIELD_NAME`으로 표시한다.
- 사건 간 템플릿·제안서·근거 문서 IDOR, 타 조직 template/actor 연결을 차단한다.
- 사건정보 변경 후 기존 ProposalVersion snapshot이 바뀌지 않아야 한다.
- `docs/보고서 템플릿/` 원본 32개와 실제 고객 파일은 P07 fixture나 외부 AI에 사용하지 않는다.

## 4. AI·수동 작성·근거성

- `AI 미사용` 모드는 provider/model/key 없이 전 기능(작성·수정·검토·승인·출력)이 가능해야 한다.
- AI 선택 UI는 provider/model ID만 다루고 비밀키를 브라우저·DB·AuditLog·오류·증거에 기록하지 않는다.
- P07 테스트는 네트워크를 호출하지 않는 결정적 fake provider를 사용한다. 실제 OpenAI/Google/Anthropic 키나 호출은 금지한다.
- AI 초안은 항상 `AI_DRAFT`로 명확히 표시하고 사람이 수정·검토·승인하기 전 APPROVED/최종 출력이 될 수 없다.
- 생성 source, provider, model, prompt/config version, 입력 hash, 생성 시각, actor, 근거 DocumentVersion IDs를 provenance로 기록한다.
- 근거 문서가 다른 사건/조직이거나 삭제·변조된 경우 생성을 거부한다.

## 5. API·권한·승인

- 사건별 제안서 생성·조회·수정·버전 생성·검토 요청·승인/반려·출력·다운로드 API를 실제 DB에 연결한다.
- 조직·사건 배정·세션·Origin·CSRF 경계를 모든 mutation에서 유지한다.
- 작성 권한과 승인 권한을 분리한다. 작성자가 자기 버전을 임의 승인하지 못하게 하고 제품 권한표의 Reviewer/관리 역할을 서버에서 강제한다.
- Staff/Reviewer/PM/Director/CEO/Admin 역할별 허용·거부 표를 테스트에 고정하며 클라이언트 숨김만으로 권한을 구현하지 않는다.
- 승인 전 DOCX/PDF 생성/다운로드는 403 또는 정책 오류로 차단한다.
- 승인 취소나 승인 버전 교체는 별도 감사 이력과 낙관적 잠금을 요구한다.

## 6. 실제 DOCX/PDF 출력

- `packages/document-engine`에 결정적 renderer 계약을 구현한다.
- DOCX는 유효한 OOXML ZIP이며 `[Content_Types].xml`, `word/document.xml`을 실제 parser로 열 수 있어야 한다.
- PDF는 유효한 PDF 헤더/EOF와 텍스트 추출 검증을 통과해야 한다. 확장자만 바꾼 텍스트 파일은 실패다.
- 출력에는 승인된 ProposalVersion ID, 버전, 승인자, 승인 시각, 생성 hash가 추적 가능한 메타데이터로 포함돼야 한다.
- 누락 필드가 있으면 최종 승인/출력을 차단하거나 명시적 정책에 따라 워터마크된 검토본만 허용한다.
- 생성 실패 시 Proposal 출력 행·P06 DocumentVersion·디스크 파일·AuditLog가 원자적으로 롤백되어 orphan 0이어야 한다.

## 7. 실제 UI

- `PROP-01`을 실제 사건/템플릿 선택 화면, `PROP-02`를 단계형 작성기로 연결한다.
- 단계: 사건/템플릿 → 자동 치환 확인 → 5개 필수 입력 → 수동/AI 모드 → 초안 → 편집 → 검토/승인 상태 → 출력/버전 이력.
- 누락 placeholder, 저장 중, 생성 중, 빈 상태, API 오류, 403, stale 409, 승인 전 출력 차단을 실제 UI에 표시한다.
- 버전 비교, 현재/승인 버전, 생성 provenance, 근거 문서, 승인/반려 사유를 확인할 수 있어야 한다.
- 1440px/1024px, 키보드, focus, label/ARIA, 200% 확대 회귀를 유지한다.
- `dangerouslySetInnerHTML`로 사용자/AI 텍스트를 렌더링하지 않는다.

## 8. 필수 자동화 테스트

- 6대 유형 사건과 템플릿 선택, TYPE-07 거부
- 사건정보 placeholder 정확 치환, unknown/missing placeholder 명시
- 사건정보 변경 후 과거 ProposalVersion snapshot 불변
- AI 미사용 수동 작성의 전체 흐름
- 결정적 fake AI 초안 provenance 및 AI_DRAFT 표시
- 타 사건·타 조직 템플릿/근거/제안서 IDOR 차단
- 작성자 자기 승인, Staff 무단 수정, 승인 전 출력 차단
- DRAFT/IN_REVIEW/APPROVED/REJECTED 전이와 stale 409
- 승인 버전과 review history UPDATE/DELETE DB 차단
- 실제 DOCX/PDF parser 검증과 승인 메타데이터
- 출력/Audit 실패 시 DB/문서/디스크 rollback 및 orphan 0
- P05 populated DB → P06 → P07 lossless migration 보존
- 실제 Chrome: 로그인→사건/템플릿→자동 치환→수동 초안→수정→검토/승인 역할 전환→DOCX/PDF 다운로드→버전 이력→권한 차단

`test:e2e`는 `p07-e2e.ts`, `test:security`는 P04/P05/P06 회귀에 `p07-security-test.ts`를 추가한다. 문자열 존재 검사만으로 통과시키지 않는다.

## 9. 11대 게이트와 증거

clean checkout에서 다음을 모두 실행한다.

```powershell
npx --yes pnpm@9.15.0 install --frozen-lockfile
npx --yes pnpm@9.15.0 db:reset
npx --yes pnpm@9.15.0 db:migrate
npx --yes pnpm@9.15.0 db:seed
npx --yes pnpm@9.15.0 lint
npx --yes pnpm@9.15.0 typecheck
npx --yes pnpm@9.15.0 test
npx --yes pnpm@9.15.0 build
npx --yes pnpm@9.15.0 test:e2e
npx --yes pnpm@9.15.0 test:security
npx --yes pnpm@9.15.0 audit --audit-level high
```

- `artifacts/harness/P07/manifest.json`, `notes.md`, `commands.log`를 실제 stdout/stderr 기반으로 생성한다.
- 구현 커밋 A와 상태·증거 커밋 B를 분리한다.
- manifest `changedFiles`는 구현 커밋 A의 `git show --name-only`와 경로·개수 1:1이어야 한다.
- API 키·토큰·개인키·DB·출력 파일·실제 고객정보 추적 여부를 검사한다.
- `docs/reviews/requests/P07-review-request.md`를 만들고 `P07.status: READY_FOR_REVIEW`, `nextPhaseAllowed: false`로 제출한다.

## 10. Antigravity 최종 보고 형식

- 기준 P06 PASS 커밋과 P07 시작/구현/상태 커밋
- 변경 파일 목록
- 템플릿/placeholder/버전/승인/provenance 모델
- 수동/AI 작성 경계와 비밀정보 보호
- 실제 DOCX/PDF parser 검증
- 일반/보안/E2E 테스트 수
- 11대 게이트 결과
- 증거 경로와 알려진 제한

구현 설명은 증거가 아니다. Antigravity가 먼저 구현한 뒤 Codex가 저장소·DB·파일·브라우저를 독립 검수하고 필요한 경우 다시 직접 보정한다.
