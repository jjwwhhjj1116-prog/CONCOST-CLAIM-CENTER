# P08 Antigravity 선행 구현 지시서 — 보고서 템플릿·블록 카탈로그

## 0. 진입 조건과 기준 커밋

- P07 최종 판정: `PASS_WITH_NOTES` (`phase-status.json` 상태는 `PASS`)
- P07 구현 커밋: `186449b120953f39fa0941761f2c24e3e89d908a`
- P07 판정·증거 커밋: `b3de7bed4f5adda4497ecc987bbea5f0df949d4f`
- 원본 E 저장소에서 위 커밋을 포함한 최신 커밋을 확인한 뒤 `feat/P08-report-template-catalog` 브랜치를 만든다.
- 시작 커밋에서 `currentPhase: P08`, `P08.status: IN_PROGRESS`, `nextPhaseAllowed: false`로 바꾼다.
- P07 일반 71개·보안 30개·P06/P07 실제 Chrome E2E를 삭제·완화·skip하지 않는다.
- P09는 Codex의 P08 PASS 전까지 시작하지 않는다.

## 1. 고정 범위

v2 지시서의 P08 범위만 구현한다.

1. 고정 회사 보고서 양식과 버전
2. 정확히 6개 클레임 유형별 목차의 논리 배치
3. 표준 블록 카탈로그: 검토 개요, 계약 현황, 사실관계, 사진 분석, 산출근거, 법률 검토, 의견, 결론
4. 필수 자료 규칙과 필수 장 경고
5. 장 추가·삭제·순서 변경 및 미리보기
6. 사건 생성 시 선택된 템플릿 버전 snapshot으로 ReportInstance/Section 인스턴스화
7. `primaryType` 단일 값과 `secondaryTypes` 복수 논리 참조
8. `UNCLASSIFIED`, `REVIEW_REQUIRED`, `HUMAN_APPROVED`, `ACTIVE`, `ARCHIVED`, `TEMPLATE_NOT_FOUND` 상태 경계
9. reference file ID/SHA-256와 template version의 provenance 연결
10. 원본이 아닌 사건용 작업 snapshot 생성

P09의 3단 편집기·자동저장·동시 편집, P10 외부 AI Gateway, P12 최종 문서 병합은 앞당기지 않는다.

## 2. 레퍼런스 원본 절대 보호

- `docs/보고서 템플릿/`의 32개 원본은 이동·삭제·이름변경·덮어쓰기·Git add·DB blob 저장·외부 AI 전송을 금지한다.
- 검증 시작 시 로컬 원본의 크기/SHA-256을 다시 계산해 `docs/templates/reference-inventory.json`과 32/32 비교한다. 불일치는 즉시 중단하고 manifest에 기록한다.
- 원본 파일 전체 경로나 실제 파일명, 추출 본문, 고객명·현장명·사건번호를 API/UI/AuditLog/test fixture/증거에 복사하지 않는다. DB에는 익명 `fileId`, SHA-256, size, scan/approval 상태만 저장한다.
- `template-classification.yaml`의 현재 9개 mapping은 모두 `REVIEW_REQUIRED`다. 폴더명만으로 `HUMAN_APPROVED`나 `ACTIVE`로 승격하지 않는다.
- HWP 14건 `UNSCANNED`를 자동 승인하지 않는다. 파서가 없으면 그대로 검토 필요 상태를 유지한다.
- TYPE-05는 `TEMPLATE_NOT_FOUND`를 유지하며 다른 유형 template/reference를 자동 배정·추천·fallback하지 않는다.
- 한 원본을 여러 유형에 연결할 때 물리 복제하지 않고 join/reference 행만 만든다.

## 3. 데이터 모델과 DB 불변조건

- 최소 `ReportTemplate`, `ReportTemplateVersion`, `TemplateTypeMapping`, `TemplateSection`, `BlockDefinition`, `ReportInstance`, `ReportSection` 또는 동등 모델을 additive migration으로 구현한다.
- `ReportTemplateVersion`은 회사양식, 목차, section/block snapshot, 필수자료 규칙, reference fileId/hash 목록, 작성/승인 actor·time을 보존하는 immutable snapshot이다.
- `primaryType`은 정확히 하나의 `TYPE-01`~`TYPE-06`; secondary는 0..N의 서로 다른 고정 유형이며 primary와 중복 불가다.
- version 상태 전이는 `DRAFT/REVIEW_REQUIRED -> HUMAN_APPROVED -> ACTIVE -> ARCHIVED`만 허용하고 creator self-approval을 막는다. 활성 버전은 유형·유효기간 기준 하나만 허용한다.
- `TEMPLATE_NOT_FOUND`는 TYPE-05용 명시적 빈 상태이며 template/version 외래키를 위조해 연결할 수 없어야 한다.
- ReportInstance 생성 시 template/version, 회사양식, 목차 순서, required flag/rules, block schema를 snapshot으로 복사한다. 이후 template 수정·archive/delete가 기존 report/section을 바꾸지 않아야 한다.
- 사용 중인 version/section/block/reference provenance와 기존 ReportInstance snapshot은 UPDATE/DELETE 불가를 DB trigger로 강제한다.
- 모든 mutation과 AuditLog를 같은 transaction에 두고 optimistic `version` stale 요청은 409로 거부한다.
- 기존 P04~P07 데이터를 DROP/rename/재작성하지 않고 populated P07→P08 migration을 보존한다.

## 4. API·권한

- 템플릿/버전/유형 mapping/section/block/preview/review/activate/archive와 사건별 report instance 생성·조회 API를 실제 DB에 연결한다.
- 목록/미리보기는 인증된 조직 사용자에게 제공하되 관리 mutation은 Admin, 사람 승인·활성화는 명시된 결재 역할로 분리하고 작성자 자기 승인을 차단한다.
- 세션·Origin·CSRF·조직·사건 배정·soft-delete·AuditLog·낙관적 잠금을 P07 수준으로 유지한다.
- 타 조직 template/version/report IDOR, 비활성/미승인 version 선택, TYPE-05 fallback, 다른 유형으로의 위조 mapping을 서버에서 차단한다.
- API 입력으로 로컬 파일 경로, 원본 body/base64, API key/token을 받지 않는다.

## 5. 실제 UI

- `TPL-01`을 실제 API 기반 템플릿 관리 화면으로 교체한다.
- 정확히 6개 유형 그룹과 상태 badge를 표시한다. 9개 원본 폴더를 9개 유형처럼 표시하지 않는다.
- TYPE-05에는 `템플릿 미확보` 빈 상태와 검토 요청 경로만 보이고 자동 추천/선택 버튼이 없어야 한다.
- 템플릿 버전, primary/secondary, reference `fileId`/hash 확인 상태, 승인자/승인시각, 목차/필수 장/필수 자료, 미리보기를 표시한다.
- Admin 편집과 승인 역할의 검토/활성화를 UI에서 분리하되 API 권한을 보조하는 수준이어야 한다.
- 사건에서 ACTIVE 버전을 선택해 report instance를 생성하고 snapshot 버전/목차를 확인한다.
- Empty, Loading, Error, 403, stale 409, REVIEW_REQUIRED, TEMPLATE_NOT_FOUND 상태를 실제로 표시한다.
- 1440px/1024px, keyboard/focus, label/ARIA, 200% 확대, 긴 목차/긴 유형명 회귀를 실제 Chrome에서 검증한다.

## 6. 필수 자동화·적대 테스트

1. 정확히 TYPE-01~06, TYPE-07 및 9-folder-as-type 거부
2. 로컬 원본 32/32 크기·SHA 일치와 원본 Git 미추적
3. hash 변조, fileId 중복/누락, HWP UNSCANNED 자동승인 거부
4. primaryType 배열/중복/무단 값, primary-secondary 중복, 물리 복제 거부
5. TYPE-05 TEMPLATE_NOT_FOUND 및 fallback/추천/활성 template 부재
6. REVIEW_REQUIRED를 폴더명만으로 HUMAN_APPROVED/ACTIVE 승격 거부
7. self-approval, Staff/PM/Reviewer 무단 관리, 비활성 version 사건 선택 거부
8. 타 조직 template/version/report 및 타 사건 instance IDOR
9. version/section/block/reference provenance 불변과 잘못된 pointer DB 거부
10. template v1로 만든 report가 v2 변경·archive 뒤에도 byte-for-byte 동일 snapshot 유지
11. 필수 장 삭제, 중복 순서, 빈 목차, 필수자료 규칙 누락 거부
12. Audit 실패 시 template/version/instance/section 전체 rollback, orphan 0
13. populated P07→P08 lossless migration
14. 실제 Chrome: Admin draft→별도 역할 승인/활성→6유형 필터/미리보기→사건 instance→snapshot 확인→TYPE-05 empty→권한 차단→1024/keyboard/200%

`test:e2e`에는 기존 P06/P07 뒤에 `p08-e2e.ts`, `test:security`에는 기존 P04~P07 뒤에 `p08-security-test.ts`를 추가한다. 문자열 존재 검사만으로 통과시키지 않는다.

## 7. 11대 게이트와 제출

clean checkout에서 다음을 실행한다.

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

- `artifacts/harness/P08/manifest.json`, `notes.md`, `commands.log`를 실제 stdout/stderr 기반으로 만든다.
- 구현 커밋 A와 `READY_FOR_REVIEW` 상태·증거 커밋 B를 분리한다.
- manifest `changedFiles`는 구현 커밋 A의 `git show --name-only`와 경로·개수 1:1이어야 한다.
- `docs/reviews/requests/P08-review-request.md`를 만들고 `nextPhaseAllowed: false`로 제출한다.
- 최종 보고에는 원본 32개 해시 비교 결과, 원본 Git 추적 0, 유형/mapping/상태 수, snapshot·승인·권한·rollback·migration 결과, 일반/보안/E2E 수를 포함한다.

구현 설명은 증거가 아니다. Antigravity가 먼저 구현한 뒤 Codex가 독립 재검수하고 필요한 경우 사용자 승인 patch 모드에 따라 직접 보정한다.
