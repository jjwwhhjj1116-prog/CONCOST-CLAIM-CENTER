# P11 Antigravity 후속 지시 01 — Grounding·Citation·Human Apply 경계 강화

## 0. 적용 기준

- 이 문서는 `docs/harness/P11-antigravity-handoff.md`를 대체하지 않고 보강한다. 충돌 시 더 엄격한 조건을 따른다.
- P11 시작 커밋 `77d1c96`의 부모가 최종 P10 검수/인계 커밋 `2d9d4c7`인지 유지한다.
- 현재 로컬 P11 브랜치가 P10 원격 브랜치를 추적하고 있으므로 구현 전에 `feat/P11-grounded-ai-authoring`을 원격에 게시하고 같은 이름의 원격 브랜치를 추적한다.
- P10 보정 코드와 P06~P10 회귀 테스트를 삭제·skip·완화하지 않는다.
- P11 판정 전 P12 출력 엔진이나 실제 공급자 credential 연결을 시작하지 않는다.

## 1. Grounding manifest는 외부 호출 전에 불변 고정

서버가 생성 요청마다 `AiGroundingSelection` 또는 동등한 manifest를 먼저 고정한다. 최소 필드는 다음과 같다.

- `organizationId`, `caseId`, `reportId`, `reportSectionId`, `actorId`
- 선택 source의 `sourceType`, 정확한 `sourceId`, 불변 `sourceVersionId` 또는 회의 `version`
- 생성 시 재검증한 `sourceSha256`, 허용된 `anchor` 목록, 선택 순서
- P10 provider/model, 정책 버전/hash, 생성 instruction hash, 생성 시각
- 위 전체를 canonical JSON으로 직렬화한 `manifestSha256`

`Document.currentVersionId` 같은 변경 가능한 포인터만 저장하면 안 된다. 선택 후 source 변경·삭제·새 버전 교체·hash 불일치가 있으면 외부 호출 전에 차단하고, 기존 selection을 새 source로 다시 해석하지 않는다. 원문 전체가 아니라 사용자가 선택한 anchor/snippet만 전송한다.

현재 스키마가 문서 본문 anchor와 hash를 신뢰성 있게 표현하지 못하면 임의 문자열 anchor를 사실처럼 승인하지 말고 additive source snapshot/anchor 모델을 추가하거나 `BLOCKED`로 보고한다.

## 2. Citation 검증 계약

- provider 응답은 자유 텍스트가 아니라 versioned JSON schema로 파싱한다. suggestion의 주장 단위와 citation을 구조화한다.
- 금액·수량·날짜·고유명사·법률·판례·사실 주장은 선택 manifest 안의 source와 실제 존재하는 anchor를 참조해야 한다.
- citation의 source ID/version/hash/anchor가 manifest와 하나라도 다르면 suggestion을 적용 가능 상태로 만들지 않는다.
- 근거 없는 서술은 사실처럼 보존하지 않는다. 정책상 허용된 비사실 문구 외에는 `REVIEW_REQUIRED`/`확인 필요`로 격리하거나 전체 생성을 차단한다.
- 숫자와 단위는 원문 값을 보존한다. 환산·합산 등 파생값은 원값, 단위, 계산식, rounding policy와 모든 입력 citation이 없으면 차단한다.
- 상충하는 근거는 하나를 임의 선택하지 않고 `CONFLICT` 상태와 양쪽 citation을 함께 노출한다.
- 존재하지 않는 판례, 선택하지 않은 자료, 다른 사건 자료, malformed/missing anchor는 모두 적용 전 차단한다.

## 3. Suggestion과 P09 revision의 단방향 경계

- 생성 완료는 `AiDraftSuggestion`만 만들며 `ReportSection.content`, 최신 revision, 승인 상태, 잠금 상태를 변경하지 않는다.
- `본문에 적용`은 PM/Staff의 별도 확인 요청에서만 기존 P09 optimistic concurrency·evidence 검증 경로를 재사용해 새 `DRAFT`/미승인 `ReportSectionRevision`을 만든다.
- 적용 revision은 실제 사람 actor를 author로 기록하고 `suggestionId`, `manifestSha256`, provider/model, 적용 시각 provenance를 별도 불변 필드/관계로 보존한다.
- suggestion 하나는 최대 한 번만 적용할 수 있다. 동일 idempotency key 재시도는 같은 결과를 반환하고, 다른 section/baseVersion/content로 재사용하면 `409`로 거부한다.
- 동시에 두 번 적용하거나 base revision이 stale이면 새 revision·승인·감사·적용 표시가 하나도 부분 저장되지 않아야 한다.
- Reviewer는 suggestion 조회·검토만 가능하고 생성·적용·잠금 해제 권한을 얻지 않는다. 작성자의 self-approval은 P09 RBAC에서 계속 차단한다.

## 4. P10 Gateway와 원자적으로 연결

- P11은 `LOCAL_FAKE` adapter를 직접 호출하지 않고 P10 Gateway service 경계를 통과한다.
- P10의 default-deny 사건 정책, provider/model allowlist, SSRF, idempotency, 일일 예산 reservation/reconcile, retry, cancel을 그대로 적용한다.
- P11 생성 idempotency fingerprint에 `organizationId + caseId + actorId + sectionId + manifestSha256 + policyHash + provider/model + instructionHash`를 포함한다.
- 같은 key에 manifest나 instruction이 다르면 `409`; 취소·timeout·citation 실패·감사 실패 시 revision 0건과 정확한 예산 정산을 보장한다.
- 사용자 취소는 실제 `AbortController`까지 전달하며 늦게 도착한 provider 응답이 suggestion/revision을 생성하지 못하게 한다.

## 5. Prompt injection·출력 보안

- source 본문은 명확한 untrusted-data delimiter 안에 넣고 system/developer instruction과 분리한다.
- source 내부의 “이전 지시 무시”, secret 요청, 다른 사건 검색, 도구 호출 지시는 데이터로만 취급한다.
- raw secret, 전체 prompt/response, 고객 원문은 AuditLog·일반 로그·브라우저 storage에 남기지 않는다. hash와 redacted metadata만 저장한다.
- reference template 원본 폴더와 선택되지 않은 고객 자료를 provider payload에 포함하지 않는다.
- suggestion preview는 HTML/script/event handler/`javascript:` URI를 실행하지 않도록 text rendering 또는 검증된 sanitizer를 사용한다.
- 결정론적 failure mode는 `LOCAL_FAKE`이며 test 환경에서만 허용한다. 사용자가 prompt 문자열로 production mode를 선택하게 만들지 않는다.

## 6. DB trigger·트랜잭션 필수 조건

- selection/source snapshot/citation/applied provenance는 append-only이며 UPDATE/DELETE로 재작성할 수 없다.
- DB에서도 조직·사건·section·source 경계를 검증하고 cross-tenant/cross-case FK 조합을 거부한다.
- terminal suggestion의 재활성화, citation 없는 `READY_TO_APPLY`, suggestion 중복 적용, 승인 revision 직접 수정/삭제를 거부한다.
- cascade delete로 생성 provenance나 감사 이력이 사라지지 않게 `Restrict` 또는 보존 정책을 사용한다.
- generation requested/completed/blocked/failed/canceled, citation validation failed, suggestion applied/discarded를 AuditLog에 기록하되, 해당 업무 트랜잭션 실패 시 orphan을 남기지 않는다.

## 7. 결정론적 적대 모드와 테스트

기존 handoff의 12개 반례가 실제 결과를 검사하도록 fake adapter와 테스트 fixture를 만든다. 최소 모드는 다음을 포함한다.

1. grounded success
2. 근거 없는 금액/수량
3. 존재하지 않는 판례
4. source 내부 prompt injection
5. cross-case/cross-tenant citation
6. 선택하지 않은 source citation
7. 법적 결론 확정
8. 숫자 단위 변조 또는 파생식 누락
9. 상충 근거
10. malformed citation/schema
11. 존재하지 않는 anchor 또는 source hash 변경
12. cancel/late-response 및 동시 apply stale conflict

각 테스트는 HTTP status만 보지 말고 다음 부작용을 함께 검증한다.

- provider 호출 횟수와 외부 전송 여부
- suggestion/citation/revision/approval 행 수
- P10 reservation·ledger·attempt 정산
- AuditLog event와 redaction
- 기존 승인 revision/hash 불변성

mutation/negative assertion으로 source hash, anchor, case ID, selection 목록, role, baseVersion, idempotency payload 중 하나를 바꾸면 테스트가 실제 실패하는지 확인한다.

## 8. 실제 Chromium E2E

HTTP-only 스크립트를 E2E라고 부르지 않는다. 설치된 Chrome/Chromium을 Playwright로 실제 실행하여 다음을 검증한다.

1. 배정 사건의 P09 스튜디오 진입
2. 정확한 source version/anchor 선택
3. 외부 전송 범위·provider/model·최대 예상 비용 확인 modal 승인
4. 비동기 생성과 loading/cancel/error/success 상태
5. 주장별 citation과 원문 anchor 열기, `확인 필요`/conflict 표시
6. `본문에 적용` 확인 후 새 미승인 revision 생성
7. 기존 승인 revision과 잠금/승인 이력 불변
8. Reviewer 계정에서 생성·적용 버튼 비활성/403
9. 브라우저 network/storage/console의 raw secret·고객 원문 비노출

P06~P10 실제 브라우저 E2E도 같은 gate에서 계속 통과해야 한다.

## 9. 제출·검수 조건

- 깨끗한 checkout에서 11개 gate를 재실행하고 실제 stdout/stderr와 exit code를 `artifacts/harness/P11/commands.log`에 기록한다.
- 일반/계약 테스트는 최소 P10 기준 87건과 P11 신규 테스트가 모두 포함되어야 하고, 보안 테스트는 최소 P10 기준 41건과 P11 신규 테스트가 모두 포함되어야 한다.
- secret/token/API key와 실제 고객정보를 저장소 전체에서 검사한다.
- 구현 커밋 A와 READY_FOR_REVIEW·증거 커밋 B를 분리한다. `manifest.changedFiles`는 구현 커밋 A의 `git diff-tree`와 경로까지 1:1 일치해야 한다.
- 검수 요청서에는 12개 반례 각각의 기대/실제 부작용, 실제 Chromium 실행, P10 회귀 수, 알려진 제한을 적는다.
- 완료 후 임의로 P12를 시작하지 말고 P11 `READY_FOR_REVIEW`에서 Codex 검수를 요청한다.

## 10. 즉시 진행 순서

1. P11 원격 브랜치 게시 및 upstream 정정
2. 불변 grounding/citation/apply 데이터 계약과 additive migration
3. P10 Gateway 경유 service/API·DB trigger·AuditLog
4. P09 우측 패널의 실제 source selection/preview/human apply UI
5. 12개 적대 contract/security 테스트와 실제 Chromium E2E
6. 깨끗한 checkout 11개 gate, 구현 커밋 A, 증거/상태 커밋 B

