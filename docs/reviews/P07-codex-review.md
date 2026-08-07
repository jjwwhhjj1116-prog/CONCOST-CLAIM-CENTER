# P07 Codex 검수 보고서

## 1. 판정

`PASS_WITH_NOTES`

필수 기준, 보안 경계, 데이터 무결성, 실제 DOCX/PDF, 실제 Chrome E2E를 모두 통과했다. 잔여 Critical/High/Medium 결함은 없으며 낮은 위험의 PDF 글꼴 이식성 메모만 있다.

## 2. 검수 대상

- 브랜치: `feat/P07-proposal-template-writer`
- Antigravity 시작 커밋: `dc5a8f6`
- Antigravity 구현 커밋: 없음(작업트리 제출)
- Codex 보정·검수 E 커밋: `b9fb97eef4961a5a309d731f122b61b831802863`
- 깨끗한 검증 source 커밋: `186449b120953f39fa0941761f2c24e3e89d908a` (동일 tree)
- 검수 일시: `2026-08-07T09:53:21+09:00`
- 검수 환경: Windows, Node 20 계열, pnpm 9.15.0, SQLite/Prisma 6.19.3, 실제 Google Chrome, 새 로컬 clone
- 검수 모드: 사용자 승인 `REVIEW_MODE=patch`에 준하는 직접 보정. 구현 커밋 A와 검수·증거 커밋을 분리했다.

## 3. 실행한 명령

| 명령 | 결과 | 로그 |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | 새 `node_modules`, lockfile 일치, 215 packages |
| `pnpm db:reset` | PASS | 전체 migration 적용 |
| `pnpm db:migrate` | PASS | additive migration 성공 |
| `pnpm db:seed` | PASS | 합성 P07 fixture와 6개 템플릿 |
| `pnpm lint` | PASS | warning 0 |
| `pnpm typecheck` | PASS | 전 workspace 통과 |
| `pnpm test` | PASS | 71/71, failed 0, skipped 0 |
| `pnpm build` | PASS | Prisma 및 production web build |
| `pnpm test:e2e` | PASS | P06+P07 실제 Chrome |
| `pnpm test:security` | PASS | 30/30, failed 0, skipped 0 |
| `pnpm audit --audit-level high` | PASS | 알려진 취약점 0 |

원문 기반 요약은 `artifacts/harness/P07/commands.log`에 있다.

## 4. 인수 기준 결과

| 기준 | 결과 | 증거 |
|---|---|---|
| 정확히 6개 유형/템플릿, TYPE-07 거부 | PASS | `packages/database/src/seed.ts`, `scripts/p07-proposal-test.ts:80` |
| 사건/템플릿 snapshot, 누락값 명시 | PASS | `apps/api/src/server.ts:856`, `scripts/p07-proposal-test.ts:118` |
| 5개 필수 입력과 수동/결정적 fake AI | PASS | `apps/api/src/server.ts:32`, `scripts/p07-proposal-test.ts:133` |
| 작성/승인 분리, 자기 승인 차단, stale 409 | PASS | `scripts/p07-proposal-test.ts:188`, `scripts/p07-security-test.ts:108` |
| immutable version/review/output와 상태 전이 | PASS | migration `:92-167`, `scripts/p07-proposal-test.ts:238` |
| 타 조직/사건/근거 IDOR 및 변조 차단 | PASS | `scripts/p07-security-test.ts:78-105` |
| 승인 버전만 실제 DOCX/PDF 출력 | PASS | `apps/api/src/server.ts:1215`, `scripts/p07-proposal-test.ts:205` |
| 출력/Audit 실패 원자 롤백, orphan 0 | PASS | `scripts/p07-proposal-test.ts:248` |
| 실제 PROP-01/PROP-02 UI | PASS | `apps/web/src/proposals/ProposalView.tsx` |
| 실제 Chrome 전체 흐름/권한/접근성 회귀 | PASS | `scripts/p07-e2e.ts:101-184` |
| P05/P06 populated migration 보존 | PASS | `scripts/p07-security-test.ts` migration subtest |
| 비밀·실고객·원본 템플릿 미추적 | PASS | hygiene scan, manifest |

## 5. 발견 사항

### 제출 시점의 High 결함 — 모두 해결됨

- P06 파일 보안 회귀, P07 권한/승인/DB 불변조건 누락, 실출력 검증 부족, P07 E2E 부재, 실패 테스트 통과 오보고를 재현했다.
- P06 PASS 경계를 복원하고 P07을 재통합했으며 source 커밋 `186449b`의 독립 재실행과 내용이 같은 E 커밋 `b9fb97e`로 해결을 확인했다.

### [LOW] PDF 글꼴 이식성

- 위치: `packages/document-engine/src/pdf-engine.ts`
- 실제 결과: `UniKS-UCS2-H` CMap과 한국어 CID font를 사용하며 현재 Windows/Chrome 및 파서에서 한글 title/author/body round-trip이 통과한다. 글꼴 자체는 임베드하지 않는다.
- 영향: 한국어 CJK font 대체가 전혀 없는 특수 PDF 뷰어에서 모양이 달라질 수 있다.
- 수정 조건: P12 배포 출력 고도화 시 라이선스가 확인된 한국어 글꼴을 부분 임베드한다. 현재 P07 필수 기준 및 다음 단계는 차단하지 않는다.

## 6. 보안·권한

- Origin, CSRF, 세션, 조직, 사건 배정, 역할 검사를 mutation에 적용했다.
- Reviewer는 승인할 수 있지만 작성할 수 없고, Director도 자신이 작성한 버전을 승인할 수 없다.
- credential 필드, 타 사건 근거, 변조된 저장 파일, 타 조직 proposal IDOR를 거부한다.
- 추적 API key/token/private key 및 운영 데이터는 없다.

## 7. 데이터 무결성

- P07 migration은 기존 P04~P06 데이터를 보존하는 additive migration이다.
- current/approved/output pointer, 상태 전이, review-version 관계, self-approval, snapshot/review/output 불변을 SQLite 트리거가 강제한다.
- mutation과 AuditLog는 transaction으로 결합되고 파일 저장 실패/감사 실패는 보상 삭제된다.

## 8. AI 근거성과 법률·수치 안전

- 실제 외부 AI와 비밀키를 사용하지 않고 allow-list된 `local-fake-ai/fake-claim-v1`만 허용한다.
- AI 초안은 provenance가 기록되고 직접 검토 요청/승인할 수 없다. 사람이 수정한 MANUAL 버전이 필요하다.
- 사건정보와 5개 사용자 입력만 치환하며 unknown placeholder는 `누락: FIELD`로 남긴다.
- 근거 DocumentVersion의 사건, 크기, SHA-256을 생성 전에 재검증한다.

## 9. UX·접근성

- PROP-01 템플릿 선택과 PROP-02 4단 작성·검토·승인·출력·이력 화면이 실제 API에 연결된다.
- 역할별 비활성 상태, 오류/성공 메시지, AI provenance, 근거 및 review history를 표시한다.
- 실제 Chrome에서 1024px 수평 reflow, 키보드 focus ring, 200% 확대 시 핵심 Step 4 접근을 검증했다.

## 10. 테스트 적정성

- 전체 71개 하네스는 P02~P06 회귀와 P07 10개 통합 흐름을 실행한다.
- 보안 30개는 P04~P06 공격 회귀와 P07 8개 하위 테스트를 함께 실행한다.
- E2E는 current production build에서 P06과 P07을 실제 Chrome으로 순차 실행한다.
- DOCX/PDF는 문자열 존재만 보지 않고 ZIP CRC/OOXML 관계/XML, PDF xref/object/stream byte offset/Unicode text를 파싱하며 변조 반례를 거부한다.

## 11. 회귀 위험

- P06 실파일 업로드·다운로드·FINAL 회의 흐름과 P04~P06 보안 수트를 그대로 실행한다.
- P08은 P07 ProposalTemplate를 보고서 템플릿과 혼동하거나 변경하면 안 된다.
- P08에서 원본 32개 파일을 DB/Git/외부 AI로 복제하지 않도록 별도 handoff에서 강제한다.

## 12. 다음 단계 진입 여부

`허용` — P08 보고서 템플릿·블록 카탈로그로 진행할 수 있다.

## 13. 필수 수정 목록

없음.

## 14. 선택 개선 목록

1. P12 문서 출력 단계에서 라이선스가 확인된 한국어 글꼴 부분 임베딩을 검토한다.
2. 적대적 AuditLog rollback 테스트의 예상 stderr를 명시적 `[EXPECTED_FAILURE]` 로그로 감싸 증거 가독성을 높인다.
