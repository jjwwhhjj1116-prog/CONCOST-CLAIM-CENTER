# P12 Antigravity 선행 구현 지시서 — 검토·승인·최종 문서 출력

## 0. 진입 조건

- P11 판정: `PASS_WITH_NOTES`
- P11 검수 기준 구현: `2b883aa819888c6c58a160f2fddc7eff84354dfa`와 이 문서를 포함하는 검수·인계 커밋
- 원격 `feat/P11-grounded-ai-authoring`을 fetch/pull한 뒤 `feat/P12-review-approval-final-output` 브랜치를 만든다.
- 시작 커밋에서 `currentPhase: P12`, `P12.status: IN_PROGRESS`, `nextPhaseAllowed: false`로 변경한다.
- Codex P12 판정 전 P13 비용·성공보수, P14 Google Workspace, 운영 실공급자 credential 연결을 시작하지 않는다.

## 1. 고정 범위

P09 revision/approval, P11 suggestion provenance, P06 secure document storage, P07 document engine을 재사용해 다음만 구현한다.

1. 검토 요청, 수정 요청, 반려, 재검토, 승인, 최종 확정 상태와 독립 검토자 이력
2. 모든 필수 장의 최종 승인 revision을 순서대로 고정한 불변 finalization snapshot
3. 승인 장만 병합한 parser-valid DOCX/PDF
4. 표지, 머리말, 바닥글, 쪽번호, 목차, 장 제목과 provenance metadata
5. 출력 version/hash/storage/download audit와 동일 snapshot 재출력의 byte 결정성

P07 제안서 출력물을 보고서 최종본으로 재사용하거나 P11 AI suggestion을 직접 출력하지 않는다. 반드시 P09의 사람 승인 revision snapshot을 통과한다.

## 2. 데이터 모델·불변성

- additive migration으로 `ReportReviewRequest`, `ReportFinalization`, `ReportFinalizationSection`, `ReportOutputArtifact`, `ReportOutputDownload` 또는 동등 모델을 추가한다.
- finalization은 report/template/version, ordered section ID, approved revision ID/hash, approver/time, evidence count, unresolved flag count, 생성 actor/time, canonical snapshot hash를 보존한다.
- finalization section과 output artifact는 append-only다. 승인 revision이나 순서를 current pointer로 나중에 다시 해석하지 않는다.
- DOCX/PDF artifact는 snapshot ID, format, output version, byte size, SHA-256, secure storage key, generator version을 기록한다.
- 같은 finalization+format 재출력은 같은 bytes/hash를 반환한다. 새 내용은 기존 artifact 수정이 아니라 새 finalization/version을 만든다.
- DB trigger로 cross-tenant/cross-case/report/revision, 미승인 revision, 중복 section order, artifact hash/size/storage 변경, UPDATE/DELETE를 거부한다.

## 3. 검토·승인 정책

- PM/Staff는 배정 사건에서 검토 요청·수정만 가능하고 자기 작성 revision을 승인/최종 확정하지 못한다.
- Reviewer/Director는 배정 또는 조직 정책에 따라 검토·승인하되 본문 작성·AI 적용·잠금 해제 권한을 얻지 않는다.
- 반려/수정 요청은 사유가 필수이며 이력은 append-only다.
- 모든 필수 장에 최신 VALID 승인 revision이 있어야 finalization 가능하다.
- `REVIEW_REQUIRED`, `CONFLICT`, citation invalid, 미확인 중요 플래그, 누락 근거, stale section version이 하나라도 있으면 최종 확정과 출력 모두 차단한다.
- P11 suggestion의 `GENERATED`/`APPLIED`만으로 승인으로 간주하지 않는다. P09 독립 승인 이벤트가 필요하다.
- finalization과 audit가 같은 transaction에서 실패하면 snapshot/artifact/storage orphan 0이어야 한다.

## 4. DOCX/PDF 출력

- P07 `packages/document-engine`을 확장하되 proposal 전용 템플릿과 report finalization 입력을 분리한다.
- DOCX는 실제 OOXML ZIP parser로 `[Content_Types].xml`, 관계, `word/document.xml`, header/footer, page numbering을 검증한다.
- PDF는 실제 header/xref/EOF와 텍스트 추출로 표지·목차·장 순서·쪽번호를 검증한다. 확장자 변경 텍스트는 실패다.
- 출력 장 순서는 P08 template snapshot order와 정확히 같아야 하고 각 장 본문은 finalization의 approved revision hash와 일치해야 한다.
- 생성 시각·random ID·ZIP entry timestamp·PDF document ID 등 비결정 요소는 finalization snapshot 값으로 고정한다.
- 출력 실패 또는 audit 실패 시 DB artifact, P06 Document/DocumentVersion, 디스크 파일을 모두 롤백한다.
- filename/path는 서버가 생성하며 path traversal, double extension, MIME/signature mismatch, unauthorized download를 차단한다.

## 5. API·감사

- report 검토 요청/반려/재검토/최종 확정, finalization 조회, DOCX/PDF 생성·상태·다운로드 API를 분리한다.
- mutation은 Origin/CSRF/RBAC/case assignment/tenant/optimistic version을 모두 검증한다.
- `REPORT_REVIEW_REQUESTED`, `REPORT_CHANGES_REQUESTED`, `REPORT_FINALIZED`, `REPORT_OUTPUT_CREATED`, `REPORT_OUTPUT_DOWNLOADED`, 실패/차단 이벤트를 원문 고객 본문 없이 기록한다.
- 다운로드는 P06 authenticated stream/hash 검증을 재사용하고 `Content-Disposition`을 안전하게 생성한다.
- 같은 idempotency key와 snapshot은 같은 finalization/artifact를 반환하며 다른 payload 재사용은 409다.

## 6. 실제 UI

- P09 studio에 장별 검토 진행률, 미승인/수정요청/승인/중요 플래그 요약과 최종 확정 readiness를 표시한다.
- 차단 항목을 클릭하면 해당 장·revision·citation/flag로 이동할 수 있어야 한다.
- 최종 확정 modal은 장 수, 승인 revision/hash, 승인자, 출력 format, 예상 파일명을 보여 주고 재확인한다.
- 생성 중/성공/실패/재출력/403/409/빈 상태와 DOCX/PDF 다운로드 이력을 실제 API로 표시한다.
- 1440px/1024px, keyboard/focus, 200% 확대, 긴 장 제목/100개 장을 보존한다.

## 7. 필수 적대 테스트

1. 미승인 장 또는 누락 필수 장
2. `REVIEW_REQUIRED`/`CONFLICT`/invalid citation/중요 플래그 잔존
3. 작성자 self-approval과 Reviewer 본문 변경
4. 다른 조직·사건·report·section·revision IDOR
5. stale section/report version과 동시 finalization
6. 승인 후 revision/hash 교체 시도
7. template order와 output order 불일치
8. 동일 snapshot 재출력 byte/hash 비결정성
9. DOCX ZIP/XML 또는 PDF xref/EOF 변조
10. path traversal/MIME mismatch/무단 다운로드
11. output/audit/storage 실패 rollback과 orphan 파일
12. 100개 장, 긴 제목·긴 표·빈 선택 장의 경계

각 반례는 HTTP status뿐 아니라 finalization/artifact/document/version/audit/file 행 수와 기존 승인 hash 불변성을 검사한다.

## 8. 회귀·제출

- P11의 88 일반·계약, 42 보안, P06~P11 실제 Chromium E2E를 삭제·skip·완화하지 않는다.
- `scripts/p12-contract-test.ts`, `p12-security-test.ts`, `p12-e2e.ts`를 package scripts에 누적한다.
- 깨끗한 checkout에서 install, db:reset, db:migrate, db:seed, lint, typecheck, test, build, test:e2e, test:security, audit 11개를 모두 실행한다.
- `artifacts/harness/P12/{manifest.json,notes.md,commands.log}`와 `docs/reviews/requests/P12-review-request.md`를 만든다.
- 구현 커밋 A와 READY_FOR_REVIEW·증거 커밋 B를 분리하고 manifest `changedFiles`를 구현 커밋 A `git diff-tree`와 1:1 일치시킨다.
- 실제 API key/token/private key/고객정보와 생성된 DB/output 파일이 Git에 추적되지 않았는지 검사한다.

## 9. 즉시 진행 순서

1. P11 원격 동기화와 P12 시작 상태 커밋
2. finalization/output 불변 모델과 additive migration
3. 검토·최종 확정 정책/API·DB trigger·AuditLog
4. deterministic DOCX/PDF engine과 P06 secure storage/download
5. P09 studio 최종 확정·출력 UI
6. 12개 적대 contract/security 테스트와 실제 Chromium E2E
7. 깨끗한 checkout 11개 게이트, 구현 커밋 A, 증거/상태 커밋 B

Antigravity가 먼저 구현하고, Codex가 독립 검수 후 필요한 보정을 별도 구현 커밋으로 수행한다.
