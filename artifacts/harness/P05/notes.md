# P05 Codex 독립 검증 및 보정 기록

## 판정

- 최종 판정: `PASS`
- 검수 기준 커밋: `92bce5c` (Antigravity 제출 상태 커밋)
- Codex 보정 커밋: `719ecbc0ba81d98bd47ed14662e599f7da6f98f1`
- 깨끗한 검증 체크아웃: `p05-clean-719ecbc`
- 다음 단계 진입: 허용

## 독립 검수에서 확인된 주요 결함

Antigravity 제출물은 명령 성공 주장과 달리 P05 제품 계약을 충족하지 못했다. 정확한 12단계 사건 상태 대신 7개 임의 상태를 사용했고, Staff/Reviewer 및 PM 삭제 권한이 제품 권한표보다 넓었다. `StatusHistory`는 DB 수준 append-only가 아니었고, P05 마이그레이션은 기존 `CaseItem` 재생성 과정에서 P04 하위 데이터가 유실될 수 있었다. 3단 사건 분류가 없었으며, 프론트엔드는 실제 세션/API 대신 P03 합성 역할 선택기와 정적 화면을 유지했다. 기존 `test:e2e`와 `test:security`도 P05 경로를 실행하지 않았다.

## Codex 보정 내용

- 제품 계약의 12개 상태(`INQUIRY`부터 `CLOSED`까지)와 순차 전이를 DB/API/UI/테스트에 통일했다.
- 사건 작성 권한을 CEO/Director/PM/Admin, 삭제 권한을 CEO/Director/Admin으로 서버에서 강제했다.
- `StatusHistory` UPDATE/DELETE 금지 트리거, 사건 상태·6대 유형·동일 조직 배정 검증 트리거를 추가했다.
- P04 데이터가 존재하는 상태에서 P05를 적용해도 배정·보고서·섹션·감사로그가 보존되도록 손실 없는 ALTER 기반 마이그레이션으로 교체했다.
- `CaseCategory` 대/중/소 분류를 스키마, 생성 API, UI와 E2E에 추가했다.
- 실제 서버 세션, CSRF 포함 API 요청, 대시보드 KPI, 사건 목록/등록/상세, 관계자, 기일, 상태 이력 UI를 연결했다. 클라이언트 임의 역할 전환기는 제거했다.
- P05 브라우저 E2E를 현재 production `dist`만 제공하는 격리 서버와 전용 포트로 구성했다.
- P04 보안 회귀 9개에 P05 공격 테스트 7개를 추가해 총 16개로 확장했다.
- 시드와 테스트 데이터는 `SYNTHETIC_*`, `example.invalid`만 사용하도록 정리했다.

## 검증 결과

- 11대 게이트 전부 통과
- 계약·통합 테스트: 46 passed, 0 failed, 0 skipped
- 보안 테스트: 16 passed, 0 failed, 0 skipped
- 실제 Chromium E2E: 로그인, 사건 생성, 3단 분류, 관계자, 기일, 12단계 전이, 검색, KPI, RBAC, 브라우저 이력, 1024px 드로어, 키보드 포커스, 200% 확대 통과
- 설치 후 working tree: clean
- 고위험 이상 패키지 취약점: 0
- API 키·토큰·개인키·DB/.env 추적: 0
- 실제 고객정보: 발견되지 않음. `user@company.com`과 `010-0000-0000`은 기존 명세의 명시적 placeholder이며 P05 신규 픽스처에는 포함하지 않았다.

보안 테스트 출력의 Prisma 외래키 오류 두 건은 감사로그 삽입 실패를 의도적으로 유발해 업무 변경이 함께 롤백되는지 확인한 적대 테스트의 기대 출력이다.
