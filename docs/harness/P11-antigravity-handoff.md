# P11 Antigravity 선행 구현 지시서 — 근거 기반 AI 작성

## 0. 진입 조건

- P10 판정: `PASS_WITH_NOTES`
- P10 검수 기준 구현: `d7b085d859543431d56f1776ebcb01225c17ada9`와 이 문서를 포함하는 후속 검수 커밋
- 원격 `feat/P10-ai-gateway`를 fetch/pull한 뒤 `feat/P11-grounded-ai-authoring` 브랜치를 만든다.
- 시작 커밋에서 `currentPhase: P11`, `P11.status: IN_PROGRESS`, `nextPhaseAllowed: false`로 변경한다.
- Codex P11 판정 전에는 P12 구현·PASS 문서·출력 엔진 확장을 시작하지 않는다.

## 1. P11 고정 범위

P09 승인 편집기와 P10 Gateway 위에 근거 기반 draft suggestion만 추가한다.

1. 같은 조직·배정 사건의 사용자가 명시적으로 선택한 자료만 grounding source로 사용
2. source snapshot hash, 문서/회의/버전/문단 anchor, 생성 정책, model/provider, actor, timestamp provenance 저장
3. AI 결과는 별도 suggestion으로 저장하고 사람의 명시적 적용 동작만 새 P09 revision을 생성
4. AI suggestion은 자동 승인·병합·잠금 해제·기존 승인본 변경을 절대 하지 않음
5. 근거 없는 숫자·날짜·금액·법률·판례는 거부하거나 `확인 필요`로 표시
6. 충돌 근거와 선택 범위 밖 질문은 명시적으로 제한 표시

P12 DOCX/PDF 최종 출력과 실공급자 live credential 연결은 선행하지 않는다.

## 2. 데이터·보안 경계

- additive migration으로 `AiGroundingSelection`, `AiDraftSuggestion`, `AiCitation` 또는 동등한 불변 모델을 추가한다.
- suggestion에는 raw provider secret, 원본 prompt 전체, 브라우저 생성 instruction을 저장하지 않고 hash/redacted metadata만 기록한다.
- citation은 실제 source version/hash와 anchor를 FK/trigger로 검증한다. 다른 사건·다른 조직·선택하지 않은 source ID는 API와 DB에서 거부한다.
- 생성 당시 source snapshot과 citation은 append-only다. source 변경 후 기존 suggestion의 provenance를 다시 쓰지 않는다.
- 문서 안의 prompt injection은 데이터로 취급하고 system policy를 변경하지 못한다.
- `externalAiAllowed=false`, budget 초과, 허용되지 않은 provider/model은 P10 경계에서 외부 호출 0건을 유지한다.

## 3. 생성 정책

- 생성 전 서버가 선택 자료 manifest를 고정하고 source hash를 재검증한다.
- 생성 후 모든 사실 주장, 숫자, 날짜, 법률 인용에 source citation 또는 `확인 필요` 상태를 요구한다.
- 존재하지 않는 판례, 근거 없는 금액, 단위 변경, 법적 결론 확정 요청은 사실처럼 출력하지 않는다.
- 서로 충돌하는 근거는 하나를 임의 선택하지 말고 충돌 source와 사람 확인 필요를 표시한다.
- 다른 사건 자료, 선택하지 않은 자료, reference template 원본, 고객정보 전체를 자동 전송하지 않는다.
- P10의 결정론적 `LOCAL_FAKE` adapter에 grounded success/ungrounded value/injection/cross-case/conflict malformed citation 모드를 추가한다. 실제 키는 사용하지 않는다.

## 4. API·권한·감사

- source 선택/manifest 고정, suggestion 생성/조회/폐기, 사람 적용 API를 분리한다.
- PM/Staff는 배정 사건에서만 suggestion을 생성·적용한다. Reviewer는 읽기/검토만 하고 본문 작성 권한을 얻지 않는다.
- suggestion 작성자 본인이 승인하지 못하며 P09 approval RBAC를 그대로 유지한다.
- generation requested/completed/blocked, citation validation failed, suggestion applied/discarded를 AuditLog에 기록한다.
- 감사 실패, Gateway 실패, citation 실패, revision optimistic conflict에서 suggestion/revision/audit orphan 0을 보장한다.

## 5. 실제 UI

- P09 우측 패널에서 자료를 명시적으로 선택하고 선택 수·버전·hash 상태를 확인할 수 있어야 한다.
- 생성 전 외부 전송 범위와 예상 비용을 보여 주고 사용자가 확인해야 한다.
- 결과는 주장별 citation, 근거 열기, `확인 필요`, 충돌 표시와 함께 preview한다.
- `본문에 적용`은 즉시 승인본을 바꾸지 않고 새 미승인 revision을 만든다는 문구와 확인 절차를 제공한다.
- loading/empty/policy-blocked/budget/timeout/429/5xx/cancel/citation-error/conflict/success 상태를 실제 API로 전환한다.
- 1440px/1024px, keyboard/focus, 200% 확대와 P09 autosave/conflict/approval을 보존한다.

## 6. 필수 적대 테스트

1. 근거자료에 없는 금액을 쓰라는 사용자 지시
2. 존재하지 않는 판례 인용 지시
3. source 문서 내부의 prompt injection
4. 다른 사건 source ID 주입
5. 선택하지 않은 자료의 내용 질문
6. 법적 결론 확정 지시
7. 숫자 단위 변경 지시
8. 서로 충돌하는 자료
9. source hash 변조·삭제·새 버전 교체 후 기존 selection 재사용
10. citation이 없는 provider 응답과 존재하지 않는 anchor
11. AI suggestion 자동 승인/기존 승인본 수정/작성자 self-approval 시도
12. 동시 suggestion 적용으로 인한 stale revision 충돌과 데이터 유실

각 반례는 외부 전송·revision 생성·승인·비용 반영·감사 이벤트의 기대값까지 검증한다.

## 7. 회귀·제출

- P10의 87 일반·계약 테스트, 41 보안 테스트, P06~P10 실제 Chromium E2E를 삭제·skip·완화하지 않는다.
- P11 contract/security/E2E를 package scripts에 추가하고 실제 Chromium에서 source 선택→생성→citation 확인→사람 적용→미승인 revision을 검증한다.
- 깨끗한 checkout에서 P10과 동일한 11개 게이트를 모두 통과한다.
- `artifacts/harness/P11/{manifest.json,notes.md,commands.log}`와 `docs/reviews/requests/P11-review-request.md`를 만든다.
- 구현 커밋 A와 READY_FOR_REVIEW 상태·증거 커밋 B를 분리하고 manifest `changedFiles`를 구현 커밋 A `git diff-tree`와 1:1 일치시킨다.

## 8. Antigravity 보고 형식

- 브랜치, 구현 커밋 A, 상태/증거 커밋 B
- 변경 파일과 migration 목록
- 11개 gate 실제 exit code와 test 수
- 12개 적대 반례 결과
- 실제 Chromium 시나리오
- secret/customer data scan 결과
- 알려진 제한
- P11 검수 요청 경로

Antigravity가 먼저 구현하고, Codex가 독립 검수 후 필요한 보정을 별도 구현 커밋으로 수행한다.
