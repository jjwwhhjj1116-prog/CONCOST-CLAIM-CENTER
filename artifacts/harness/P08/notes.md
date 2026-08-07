# P08 Codex 보정·검수 증거 노트

## 판정

- 최종 판정: `PASS`
- 독립 검수·보정 구현 커밋: `67e2fddccfbac69ab391071859d21f3e7b013c62`
- 다음 단계: `P09 보고서 스튜디오 진입 허용`

## Antigravity 제출 상태에서 확인한 결함

- `phase-status.json`은 실제로 `P08 IN_PROGRESS`, `nextPhaseAllowed: false`였고 P08 manifest·commands·notes·검수 요청서가 없었다.
- Antigravity가 작성한 P08 Codex PASS 문서는 Codex의 독립 검수 결과가 아니며 Git에도 포함되지 않았다. 그 상태에서 잘못된 P09 계산 엔진 브랜치를 선행 생성했다.
- 제출 커밋에서 `pnpm test`를 직접 재현하면 71개 중 8개가 실패했다. P06 자료/회의록과 P07 제안서의 보안·불변성·출력 회귀였다.
- P08 E2E는 API 주소에서 웹 라우트를 열고 요소가 없어도 건너뛰는 구조라 실제 TPL-01 화면을 검증하지 않았다.
- P08 보안 테스트는 Prisma의 동일 `P2003`만 보고 구체적인 DB trigger가 동작했는지 확인하지 못했다.
- migration·API가 조직/사건/유형/provenance/snapshot 경계를 충분히 강제하지 않았고, Admin 편집·새 버전 UI, 1024px/200% 접근성, 표준 블록 `의견`이 누락됐다.

## Codex 직접 보정

- P07 PASS 구현을 복원한 뒤 P08을 그 보안 경계 위에 재통합했다.
- 정규화된 템플릿 유형 mapping, section/block/reference provenance, template/version lifecycle, ReportInstance/ReportSection snapshot을 additive migration과 Prisma 모델에 구현했다.
- TYPE-05 template/mapping을 DB trigger와 API 양쪽에서 금지하고 `TEMPLATE_NOT_FOUND`만 반환한다.
- 작성자 자기 승인, 비활성 버전 instance 생성, 타 조직·타 사건·타 유형 IDOR, stale version, 원본/비밀 입력, snapshot·provenance UPDATE/DELETE를 거부한다.
- 모든 mutation과 AuditLog를 같은 transaction에 두고 강제 audit 실패 시 template/version/instance/report/section/case version orphan이 0인지 검증한다.
- production seed는 익명 reference 32개, 지시서의 표준 블록 정확히 8개만 넣고 template/ACTIVE/TYPE-05 mapping은 모두 0으로 유지한다.
- 실제 API 기반 TPL-01에서 6개 유형, TYPE-05 no-fallback, 미리보기, Admin DRAFT·새 불변 버전, Director 승인/활성화, PM 사건 snapshot, Staff 권한 차단을 구현했다.
- P08 Chrome E2E를 프로덕션 웹 빌드 기반으로 교체하고 1024px, focus ring, 200% 확대, 긴 내용 overflow를 검증했다.

## 독립 재현 결과

- 구현 커밋을 새 clone에 고정했고 설치 전 `node_modules`가 없음을 확인했다.
- 11개 게이트 전부 통과: 일반 `81/81`, 보안 `39/39`, P06+P07+P08 실제 Chrome E2E, high 이상 취약점 `0`.
- 깨끗한 clone에서는 원본 부재를 `INVENTORY_ONLY`로 명시했다.
- 원본 E 저장소에서는 32개 파일의 SHA-256과 byte size를 익명 inventory와 `32/32` 대조했고 mismatch `0`, Git 추적 `0`을 확인했다.
- API 키·토큰·credential 파일·실고객 정보·원본 reference Git 추적은 모두 `0`이다.

## 의도된 실패 주입 로그

일반·보안 테스트 중 출력되는 Prisma `P2003` stderr는 게이트 실패가 아니다. AuditLog FK 실패를 의도적으로 주입한 뒤 HTTP 500, transaction rollback, orphan 0을 검증하는 공격 증거다. 전체 테스트 프로세스 exit code는 0이다.
