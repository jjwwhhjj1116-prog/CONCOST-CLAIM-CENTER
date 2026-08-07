# P08 Antigravity 보정 지시 01 — Task 1 착수 전 필수 경계

P08 시작 커밋 `f5b39bf`는 유효하다. 아래 사항을 Task 1~4 설계에 먼저 반영한 뒤 구현한다. 기존 `P08-antigravity-handoff.md`와 충돌하면 이 보정 지시가 우선한다.

## 1. 6개 유형과 6개 템플릿을 혼동하지 말 것

- 고정 업무 유형은 정확히 `TYPE-01`~`TYPE-06` 6개다.
- 이것이 production seed에 ACTIVE 보고서 템플릿 6개를 만들라는 뜻은 아니다.
- 현재 9개 reference mapping은 모두 `REVIEW_REQUIRED`이며 폴더명만으로 `HUMAN_APPROVED`/`ACTIVE`를 만들 수 없다.
- `TYPE-05`에는 `TEMPLATE_NOT_FOUND` availability 행만 둔다. `ReportTemplate`, `ReportTemplateVersion`, primary mapping, fallback template를 생성하지 않는다.
- 나머지 유형도 사람 승인 전에는 ACTIVE template가 0개여야 한다.
- E2E에 필요한 template는 격리 DB에서 API/UI를 통해 DRAFT 생성→별도 actor 승인→활성화한다. production seed의 사전 활성화로 흐름을 우회하지 않는다.

## 2. 상태 모델을 분리할 것

하나의 status enum에 모든 의미를 섞지 않는다.

- reference/classification 상태: `UNCLASSIFIED | REVIEW_REQUIRED | HUMAN_APPROVED`
- template version lifecycle: `DRAFT | HUMAN_APPROVED | ACTIVE | ARCHIVED`
- 유형 availability: `AVAILABLE | TEMPLATE_NOT_FOUND`
- `TEMPLATE_NOT_FOUND`는 ReportTemplateVersion 상태가 아니다.
- 잘못된 상태 전이와 creator self-approval은 API뿐 아니라 DB trigger에서도 거부한다.

## 3. 유형 mapping은 정규화할 것

- `secondaryTypes`를 검증 불가능한 JSON 배열 하나로 저장하지 않는다.
- `TemplateTypeMapping(templateVersionId, typeId, kind)` 형태의 join row를 사용한다.
- `kind`는 `PRIMARY | SECONDARY`; typeId는 정확히 6개 값만 허용한다.
- version당 PRIMARY 정확히 1개, 같은 type 중복 0개, primary-secondary 중복 0개를 DB unique index/trigger로 강제한다.
- 하나의 reference를 여러 유형에 연결해도 reference file/blob/row를 물리 복제하지 않는다.

## 4. 원본 32개 검증은 운영 API에서 분리할 것

- `docs/보고서 템플릿/` 파일 접근은 read-only 오프라인 harness/검수 명령에서만 허용한다.
- API 서버 시작, request handler, seed, migration에서 원본 경로를 열거나 hash를 다시 계산하지 않는다.
- API 입력/응답/DB/AuditLog에는 원본 절대경로, 실제 파일명, 추출 본문, base64/blob가 들어가면 안 된다.
- DB provenance에는 익명 `fileId`, SHA-256, size, scanStatus/approvalStatus만 저장한다.
- harness는 로컬 원본이 존재할 때 32/32 size/hash를 검증하고, clean clone처럼 원본이 없을 때는 Git 추적 0과 고정 inventory 구조/해시맵 무결성을 검증한다. 원본 부재를 임의 PASS로 숨기지 말고 검증 모드를 evidence에 명시한다.

## 5. 승인 역할과 사건 흐름

- Admin은 시스템 템플릿 DRAFT/버전/목차를 관리한다.
- CEO/Director를 사람 승인·활성화 역할로 사용하고, 작성 actor와 승인 actor가 같으면 거부한다.
- Staff/PM/Reviewer는 템플릿 관리·승인·활성화 mutation을 직접 호출해도 403이어야 한다.
- case 생성 자체를 template 부재 때문에 실패시키지 않는다.
- ReportInstance는 사건에서 ACTIVE version을 명시적으로 선택할 때 생성한다.
- TYPE-05 또는 ACTIVE version 0개이면 `TEMPLATE_NOT_AVAILABLE` 빈 상태를 반환하고 report instance/section을 한 건도 만들지 않는다.

## 6. snapshot과 삭제 경계

- ReportInstance/ReportSection은 생성 시 templateVersionId뿐 아니라 회사양식·목차·순서·required·requiredEvidenceRules·block schema를 snapshot으로 보존한다.
- template v2 수정/활성화/archive 이후 v1 instance의 snapshot hash가 byte-for-byte 같아야 한다.
- 사용된 version과 reference provenance는 UPDATE/DELETE 불가다.
- DRAFT 편집은 기존 version UPDATE가 아니라 새 version snapshot 생성으로 처리한다.

## 7. 제출 전 필수 반례

아래 변조가 각각 실제 test 실패를 일으키는지 확인한다.

1. TYPE-05에 template/version/mapping 강제 삽입
2. REVIEW_REQUIRED candidate를 바로 ACTIVE로 변경
3. secondaryTypes JSON 배열 또는 PRIMARY 2개 삽입
4. primary와 secondary에 같은 type 삽입
5. API에 `sourcePath`, `filename`, `contentBase64`, `apiKey` 전달
6. Admin 자기 승인, PM/Reviewer 활성화
7. inactive version으로 ReportInstance 생성
8. template v2 변경 후 v1 ReportInstance snapshot 변경
9. AuditLog 강제 실패 후 template/instance/section orphan 생성
10. 원본 32개 중 하나의 SHA-256 변조 또는 원본 Git add

이 보정 경계를 반영한 뒤 Task 1 데이터 모델부터 진행하고, 최종 보고에는 production seed의 ACTIVE template 수와 TYPE-05 template/version/mapping 수를 명시한다. 사람 승인 전 기대값은 모두 `0`이다.
