# P09 Antigravity 선행 구현 지시서 — 보고서 스튜디오

## 0. 진입 조건과 브랜치

- P08 최종 판정: `PASS`
- P08 구현 기준: `67e2fddccfbac69ab391071859d21f3e7b013c62`와 이 문서를 포함하는 후속 PASS 증거 커밋
- 기존 `feat/P09-report-generator-calc-engine`는 P08 PASS 전에 잘못 생성됐고 범위도 틀렸으므로 작업·merge·재사용하지 않는다.
- `feat/P08-report-template-catalog` 최신 원격을 fetch/pull한 뒤 새 `feat/P09-report-studio` 브랜치를 만든다.
- 시작 커밋에서 `currentPhase: P09`, `P09.status: IN_PROGRESS`, `nextPhaseAllowed: false`로 변경한다.
- Codex P09 PASS 전에는 P10을 시작하지 않는다.

## 1. P09 고정 범위

v2 지시서의 P09만 구현한다.

1. 왼쪽: 목차, 장 상태, 담당자, 승인 상태
2. 중앙: 구조화 본문 편집기
3. 오른쪽: 사건정보, 근거자료, AI 비서 자리, 검증 상태
4. 장별 상태와 승인된 장 잠금
5. 자동 저장과 수동 저장
6. 낙관적 잠금 기반 동시 수정 충돌 감지와 버전 비교
7. P06 DocumentVersion/Meeting provenance 근거 선택과 깨지지 않는 위치 참조
8. 문단별 검증 상태, 댓글, 수정 요청
9. 승인된 장만 포함하는 결정적 최종 병합 snapshot
10. 대용량 목차의 빠른 이동, 1440px/1024px, keyboard/focus, 200% 확대

P10 외부 AI Gateway·공급자 호출, 계산 엔진, P12 최종 DOCX/PDF 출력은 앞당기지 않는다. AI 비서 영역은 disabled/local placeholder와 명시적 상태만 제공한다.

## 2. 데이터·DB 불변조건

- P08 `ReportInstance`/`ReportSection` snapshot을 수정하지 않고 P09 편집용 version/paragraph/comment/evidence/review/merge 모델을 additive migration으로 추가한다.
- 최소 경계: section working version, immutable revision, evidence link, comment/revision request, section approval, merge snapshot 또는 동등 모델.
- 자동/수동 저장은 기존 revision UPDATE가 아니라 새 immutable revision append로 구현한다.
- section별 monotonic version과 `expectedVersion`; stale 저장은 409이며 양쪽 내용을 비교할 수 있어야 한다.
- 승인 actor는 작성 actor와 분리하고 self-approval을 DB/API 양쪽에서 차단한다.
- APPROVED section의 본문·근거·검증 상태는 UPDATE/DELETE 불가다. 재작업은 명시적 unlock/revision-request 상태 전이와 AuditLog를 거친다.
- merge snapshot은 승인된 section revision만 순서대로 복사하고 이후 편집·승인 변경에 영향받지 않는다.
- evidence link는 같은 조직·같은 사건의 P06 DocumentVersion/Meeting 등 실제 immutable source만 가리키며 source ID/hash/version을 snapshot으로 보존한다.
- 모든 mutation과 AuditLog를 같은 transaction에 두고 audit 실패 시 revision/comment/approval/merge orphan이 0이어야 한다.

## 3. API·권한

- 사건 배정·조직·soft-delete·Origin·CSRF·session·낙관적 잠금을 P08 수준으로 유지한다.
- PM/Admin은 작성·저장, Staff는 명시된 사건 작성, Reviewer/Director는 검토·댓글·승인 역할로 제한한다. 실제 `permissions-matrix.md`와 정확히 대조한다.
- 타 조직 instance/section/revision/comment/evidence/merge IDOR와 URL ID 바꿔치기를 각각 거부한다.
- 승인 장 수정, 미승인 장 merge, 끊어진/변조된 근거, stale autosave, 자기 승인, 이중 승인 race를 서버와 DB에서 차단한다.
- 자동 저장은 debounce하되 unload 손실 경계와 명시적 저장 상태(`저장 중/저장됨/충돌/오류`)를 제공한다.

## 4. 실제 UI

- `REPO-02`를 P08 API/DB와 연결된 실제 3단 보고서 스튜디오로 교체한다.
- 왼쪽 목차는 100장 이상에서도 현재 장·상태·담당자·승인을 식별하고 keyboard로 이동 가능해야 한다.
- 중앙 편집기는 장/문단 구조, 수동 저장, 자동 저장 상태, revision 비교, 충돌 해결을 보여준다.
- 오른쪽은 같은 사건의 근거 목록, 선택한 source 위치·hash/version, 검증 상태, disabled AI placeholder를 보여준다.
- Normal, Loading, Empty, Error, 403, 409 conflict, read-only approved 상태를 실제로 전환·복구할 수 있어야 한다.
- 1024px에서 좌/우 패널을 각각 복구 가능한 drawer로 축약하고, focus trap/Escape/aria-expanded를 구현한다.

## 5. 필수 적대·회귀 테스트

1. P08 81개 일반·39개 보안·P06~P08 Chrome E2E 삭제/skip/완화 금지
2. 두 사용자의 같은 expectedVersion 동시 저장에서 한쪽만 성공, 다른 쪽 409와 lossless 비교
3. 자동 저장과 수동 저장 race에서 revision 순서·본문 손실 0
4. 승인 장 직접 UPDATE/DELETE, 승인 근거 변경, 자기 승인 DB/API 차단
5. 미승인 장이 하나라도 있는 merge 거부 및 merge orphan 0
6. 승인 장만 순서대로 merge되고 이후 working revision이 merge snapshot을 바꾸지 않음
7. 타 조직·타 사건 evidence/section/revision/comment/merge IDOR
8. 삭제·변조·다른 사건 source 근거 연결 거부, 정상 source hash/location snapshot 보존
9. AuditLog 실패 시 save/comment/approval/merge 전체 rollback
10. 0장, 1장, 100장, 장문 100KB, 긴 장 제목, 중복 제목·서로 다른 ID
11. 실제 Chrome 역할 전환: PM 작성/자동저장 → Reviewer 댓글/수정 요청 → Director 승인 → 승인 잠금 → merge
12. 실제 Chrome 1440/1024 drawer, keyboard, focus, 200%, offline/error→재시도, 409 conflict UI

## 6. 제출 절차

깨끗한 checkout에서 다음 11개 게이트를 실행한다.

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

- `artifacts/harness/P09/manifest.json`, `notes.md`, `commands.log`, `docs/reviews/requests/P09-review-request.md`를 만든다.
- 구현 커밋 A와 READY_FOR_REVIEW 상태·증거 커밋 B를 분리한다.
- manifest `changedFiles`는 구현 커밋 A의 실제 diff와 경로·개수 1:1이어야 한다.
- 최종 보고에는 revision/충돌/승인 잠금/merge/evidence/rollback/tenant 결과와 일반·보안·E2E 수를 기록한다.
- Antigravity가 먼저 구현하고 Codex가 독립 재검수한다. Codex 판정 전 스스로 PASS 보고서나 P10 브랜치를 만들지 않는다.
