# P12 Antigravity 후속 지시 01 — 승인 스냅샷·결정적 출력·독립 파서 경계 강화

## 0. 계획 검토 결과와 즉시 진행

- P12 시작 커밋 `47deac6`의 부모가 최종 P11 검수/인계 커밋 `67ea024`인 것을 확인했다.
- `currentPhase: P12`, `P12.status: IN_PROGRESS`, `nextPhaseAllowed: false`도 정상이다.
- 외부 brain 경로의 구현 계획은 방향상 승인한다. 이 문서의 보정 조건을 반영해 사용자 재승인을 기다리지 말고 P12 선행 구현을 시작한다.
- 기존 handoff와 충돌하면 더 엄격한 조건을 따른다. P13 이후 기능과 운영 credential 연결은 금지한다.

## 1. 기존 P09 승인 계약을 중복 구현하지 않는다

- `POST /api/reports/:id/sections/:sectionId/approve`와 unlock/comment/revision optimistic-lock 경계는 P09 구현을 그대로 재사용한다. 동일 역할의 두 번째 approve 경로를 만들지 않는다.
- P12가 새로 추가할 것은 report-level review cycle과 finalization이다. 권장 경계는 다음과 같다.
  - `POST /api/reports/:id/review-requests`
  - `POST /api/reports/:id/review-requests/:requestId/changes-requested`
  - `POST /api/reports/:id/review-requests/:requestId/resubmit`
  - `POST /api/reports/:id/finalizations`
  - `GET /api/reports/:id/finalizations`
  - `POST /api/reports/:id/finalizations/:finalizationId/outputs`
  - `GET /api/reports/:id/outputs`
  - `GET /api/reports/:id/outputs/:artifactId/download`
- review 상태를 임의 문자열 하나로 덮어쓰지 않는다. 요청과 상태 이벤트를 append-only로 보존하거나 동등한 불변 이력을 둔다.
- 모든 mutation은 `organization + case + report + assignment + role + Origin/CSRF + expectedVersion + idempotency fingerprint`를 검증한다.

## 2. finalization readiness의 정확한 기준

finalization 직전 한 transaction에서 다음을 다시 읽고 고정한다.

1. report가 P08 `ReportInstance` snapshot에서 생성된 동일 조직·사건 보고서인지 확인
2. 삭제되지 않은 모든 required section이 존재하고 `section.status === APPROVED`인지 확인
3. 각 section의 최신 revision이 최신 `APPROVED` event의 `approvedRevisionId`와 동일한지 확인
4. 승인 뒤 `UNLOCKED`, 새 DRAFT, 새 comment/revision이 생긴 section은 과거 승인본이 있어도 차단
5. revision `validationStatus === VALID`, `validationErrorsJson`이 빈 배열인지 확인
6. unresolved `REVISION_REQUEST`, 중요 확인 플래그, 근거 규칙 누락이 0인지 확인
7. P11 AI provenance가 있는 revision은 suggestion이 `APPLIED`이고 모든 citation이 `VALID`인지 확인
8. 작성자와 해당 승인자는 달라야 하며 최종 확정 actor도 자신이 작성한 revision을 우회 승인하지 못함

- snapshot은 `sectionNumber` 오름차순으로 exact revision ID/hash/title/content/evidence hash/approver/time을 canonical JSON에 담아 SHA-256을 계산한다.
- `ReportMergeSnapshot`의 mutable pointer나 현재 section content를 출력 시 다시 읽지 않는다. finalization section snapshot만 출력 입력으로 사용한다.
- finalization 이후 새 revision/unlock이 발생해도 기존 finalization과 artifact bytes/hash는 변하지 않아야 한다.

## 3. DB 모델과 trigger 필수 조건

- output artifact는 P06 secure storage의 `Document`/`DocumentVersion`과 실제 FK로 연결한다. 별도 무보안 파일 저장소나 DB BLOB/base64 저장을 만들지 않는다.
- 최소 unique/guard:
  - review request의 report별 event/order 또는 version uniqueness
  - finalization의 `(reportId, snapshotVersion)`과 idempotency key/fingerprint
  - finalization section의 `(finalizationId, sectionNumber)` 및 revision 중복 방지
  - artifact의 `(finalizationId, format)` 단일 성공 결과 또는 명시적 artifact version
  - download의 artifact/actor tenant 경계
- DB trigger가 section/revision/approval/report/organization/case 일치를 직접 검증한다.
- finalization/finalization section/artifact/download 이력은 UPDATE/DELETE 불가다. cascade delete로 사라지지 않게 `Restrict`를 사용한다.
- terminal review/finalization/output 상태 역행, artifact size/hash/storage/documentVersion 변경, 미승인 revision 직접 삽입을 DB에서도 거부한다.
- concurrent finalization/output 두 요청 중 하나만 성공하고 나머지는 동일 idempotent result 또는 409여야 한다.

## 4. 결정적 DOCX는 실제 OOXML 패키지여야 한다

- 기존 P07 proposal 엔진 함수를 깨뜨리지 말고 report 전용 입력/함수를 분리한다.
- ZIP entry timestamp는 `0` 같은 비표준 값이 아니라 고정된 유효 DOS timestamp(예: 1980-01-01)를 사용한다. entry order, compression level, XML attribute/order도 고정한다.
- 필수 parts와 관계를 실제로 만든다.
  - `[Content_Types].xml`, `_rels/.rels`
  - `word/document.xml`, `word/_rels/document.xml.rels`
  - `word/header1.xml`, `word/footer1.xml`, `word/styles.xml`, `word/settings.xml`
  - `docProps/core.xml`, 필요 시 app/custom properties
- `sectPr`, header/footer relationship, `PAGE`/`NUMPAGES` field, deterministic 표지·목차·장 구분을 XML 구조로 검증한다.
- 100개 장, 긴 제목, 한글, XML 특수문자, 빈 선택 장, 긴 표/문단을 잘리지 않게 보존한다. 단순 `<w:t>` 연결이나 제목 문자열 존재만으로 통과시키지 않는다.
- 생성 함수와 독립된 ZIP/XML 검사 또는 별도 parser path로 central directory, CRC, relationship target, XML well-formedness, 장 순서와 provenance를 검증한다.

## 5. 결정적 PDF는 다중 페이지 문서여야 한다

- 현재 P07 한 페이지 PDF 함수를 복사해 제목만 바꾸는 구현은 실패다.
- content 길이에 따라 실제 page objects/content streams/page tree를 여러 개 생성하고 표지·목차·각 장·쪽번호를 검증한다.
- xref offset, stream length, page count, font/encoding, trailer, `startxref`, `%%EOF`, deterministic document ID/CreationDate/ModDate를 검증한다.
- 100개 장과 긴 본문에서 전체 text/order가 보존되고 page number가 증가해야 한다. 한 페이지 밖으로 흘려 그린 텍스트는 허용하지 않는다.
- generator가 반환한 자체 boolean만 신뢰하지 말고 독립 parser/추출 경로에서 PDF 구조와 텍스트를 다시 읽는다. header/EOF만 있는 가짜 PDF와 xref/stream/page 변조를 반드시 실패시킨다.

## 6. 동일 snapshot byte 결정성과 출력 원자성

- 동일 `finalizationId + format` 재요청은 기존 성공 artifact를 반환한다. generator 버전이 바뀌었다고 같은 finalization을 새 bytes로 덮어쓰지 않는다.
- 다음 값을 바꾸어도 snapshot이 같으면 bytes/hash가 같아야 한다: 실행 시각, process ID, temp path, 요청 순서, 재시도 횟수.
- snapshot/revision/order/generator-version이 달라지면 새 version/artifact로 명확히 분리한다.
- 파일은 검증된 임시 경로에 먼저 만들고 SHA-256/size/parser 검증 후 DB transaction과 연결한다. DB/audit 실패 시 임시·최종 파일, Document/DocumentVersion, artifact를 모두 제거한다.
- storage path는 `safeStoragePath`와 서버 생성 key를 재사용한다. 사용자 filename, `..`, 절대경로, double extension을 storage key로 사용하지 않는다.
- 다운로드 직전 storage bytes의 size/hash/MIME/signature를 다시 검증하고 RFC 5987 filename과 안전한 ASCII fallback을 제공한다.

## 7. 감사·다운로드 개인정보 경계

- AuditLog에는 report/finalization/artifact/revision hash, format, actor, 결과 코드만 기록하고 고객 본문·인용문·파일 bytes·로컬 경로를 넣지 않는다.
- `ReportOutputDownload`와 `REPORT_OUTPUT_DOWNLOADED`를 동일 권한 경계에서 기록한다. 타 조직/미배정 사건/soft-deleted 사건은 존재 여부도 노출하지 않는다.
- 스트리밍 실패와 성공을 구분할 수 있는 정책을 정하고 테스트한다. 최소한 권한·hash 검증 전에 download 성공 이력을 남기지 않는다.
- 생성·다운로드 오류 응답에 storage path, SQL, raw content, token이 노출되지 않아야 한다.

## 8. UI와 실제 Chromium E2E

- readiness 숫자를 하드코딩하지 말고 실제 API의 exact blocker 목록을 렌더링한다.
- blocker 클릭 시 해당 100-section navigator item으로 이동하고 focus가 보이며, drawer가 닫힌 1024px에서도 복구 가능해야 한다.
- 최종 확정 modal에서 section 수, exact approved revision/hash 축약값, approver, finalization snapshot hash, format과 파일명을 확인한다.
- 실제 Chromium에서 다음을 한 흐름으로 실행한다.
  1. PM/Staff 작성 및 review request
  2. Reviewer/Director 독립 승인 또는 changes requested
  3. 수정·재요청·재승인
  4. unresolved blocker의 finalization 차단
  5. finalization 후 DOCX/PDF 생성·실제 download bytes 획득
  6. 브라우저가 받은 bytes를 parser로 검증하고 DB/storage hash와 비교
  7. 동일 artifact 재요청 hash 동일
  8. Reviewer 본문 변경, 작성자 self-approval, Staff finalization, IDOR 403
  9. 1024px, keyboard focus, 200% 확대, 100개 장
- HTTP-only 스크립트나 API 응답 JSON만 확인하는 테스트를 E2E로 보고하지 않는다.

## 9. 적대 테스트의 부작용 검증

기존 handoff의 12개 반례마다 HTTP status와 함께 아래를 검사한다.

- review event/finalization/finalization section/artifact/download 행 수
- P06 Document/DocumentVersion 및 실제 storage file 수
- AuditLog event 수와 redaction
- 기존 approved revision/hash와 기존 artifact bytes 불변성
- 동시 요청의 idempotency/409 결과

mutation 반례로 section order, revision ID/hash, approval actor/status, unresolved flag, MIME/signature, xref/CRC, storage bytes 중 하나를 바꾸면 해당 테스트가 실제 실패해야 한다.

## 10. 게이트·증거·커밋 규칙 정정

- 구현 계획의 `npm`, `npm run`, `npx ts-node` 명령은 사용하지 않는다. 저장소 고정 도구는 Node 24 + `pnpm@9.15.0` + `tsx`다.
- package scripts에 P12를 누적하고 다음 11개를 깨끗한 checkout에서 실행한다.
  1. `pnpm install --frozen-lockfile`
  2. `pnpm db:reset`
  3. `pnpm db:migrate`
  4. `pnpm db:seed`
  5. `pnpm lint`
  6. `pnpm typecheck`
  7. `pnpm test`
  8. `pnpm build`
  9. `pnpm test:e2e`
  10. `pnpm test:security`
  11. `pnpm audit --audit-level high`
- P11 기준 88 일반·계약, 42 보안, P06~P11 Chromium을 삭제·skip·완화하지 않는다.
- `commands.log`에는 실제 stdout/stderr, 시작·종료 시각, 각 exit code를 기록한다.
- 구현 커밋 A에는 P12 코드·migration·tests만 넣고, 증거/READY_FOR_REVIEW 커밋 B를 분리한다. manifest `changedFiles`는 A의 `git diff-tree`와 경로까지 1:1이어야 한다.
- 실제 API key/token/private key/고객정보, DB, temp/output 파일, 원본 템플릿은 Git 추적 0건이어야 한다.

## 11. 완료 보고

- 구현 커밋 A와 증거/상태 커밋 B
- 11개 gate exit code, 일반/보안 테스트 수, P06~P12 Chromium 결과
- 12개 반례의 기대/실제 부작용
- 동일 snapshot DOCX/PDF 각각 2회 byte hash
- 100개 장 DOCX/PDF parser 결과와 page/order 증거
- secret/customer/output-file scan 결과
- 알려진 제한과 `docs/reviews/requests/P12-review-request.md`

위 조건으로 P12 선행 구현을 즉시 진행하고, `READY_FOR_REVIEW` 이후 Codex 검수를 요청한다.
