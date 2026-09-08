# CF123 ES 테스트 서버 릴리스 — 2026-09-08

후속 UI 배포·로그인 후 기본입력 저장/재진입 검수는 [CF124 기록](cf124-es-input-layout.md)을 참조한다. 아래 로그인 미실행 상태는 최초 CF123 배포 당시 기록이다.

## 대상 / 코드

- 테스트 전용: https://concost-claim-center-development.jjwwhhjj1116.workers.dev/es
- 구현 commit: `fee70dc` (본체 `8fe5788`). 가오픈/베트남 서버 변경 없음.
- 테스트 서버 배포 완료. 최종 Worker `be8a7dfa-2e67-46c3-8f80-7db9fdd0e9df`.

## 실제 배포 후 확인

- 서명된 최신 백업을 짧은 격리 경로 `tmp/e123live`에 복원 → 실제 Wrangler0063 runner → 두 번째 no-op → 전체 비교 PASS. 긴 중첩 경로에서 local D1 초기화 internal error가 발생해 그 사본은 사용하지 않았다.
- 테스트 원격0063 적용 후 새 SQL export와 비교 PASS: 기존116테이블의 모든 값/스키마/기존원장 보존, 새 ES5테이블만 추가(빈 상태 확인).
- 배포 전후 암호화키·secret·Drive 원본을 교체하지 않았다.
- 점검 해제 직후 첫 readiness503은 재확인에서200으로 전환됐다. 이후 실제 smoke PASS: health200/readiness200/Driveconnected, 비로그인ES401, /es200.
- 실제 배포 JS/CSS4개 SHA256이 로컬 최종 dist와 일치했다. 기존 보고서 보호 endpoint도 비로그인401 유지.
- 이 공개 smoke는 로그인 후 실제 사용자 문서 생성 검증이 아니다. 로그인된 브라우저 기능검수는 별도 구분한다.
- 실제 브라우저 새 탭에서 테스트 /es 진입 후 시스템 로그인 화면을 확인했다. 인증된 ES 업무 화면 E2E는 NOT_RUN이며 세션·쿠키·토큰 우회는 하지 않았다.
- 최종 실제 App 로컬 UI 16/16 PASS(API mock), pageerror/unmocked API 0. 실제 print iframe srcdoc 기반 PDF 재개봉: 전체41쪽 / 1,3,5–8 선택6쪽, 각 페이지 원본 푸터번호 정확히1개, 빈 페이지0. 실물 프린터 성공을 의미하지 않는다.
- 수용60항목 판정: PASS21 / PARTIAL32 / BLOCKED3 / NOT_RUN4. 수용 기준 전체 완료는 아니며 미완료를 별도 CSV에 유지한다.

## 백업 검증 pin (비밀키 아님)

- 원격 적용 전 버전: `26d309d7-537e-4721-8e8c-76f6d5841e3b`.
- 유지보수 버전: `8f5e3833-824d-4e25-ae62-b794dfd4d705`; health/API 503 점검 응답 확인.
- 적용 전 D1 bookmark: `000000f0-00000000-000050e0-9d84601b80192a7f313848b7459373f4`.
- 서명 공개키 pin SHA256: `aed62368158cee1b21d3d9ebc2e11476304ae9468d1ff5253805055d1e84beca`.
- SQL 백업 SHA256: `a2fde2dcb61f8c65aa8dd7109a51d7b705761887c4ed1b670c67b691bc944537`.
- migration SHA256: `6e4f9360c58dec6e6f4cdd1ae2172af9b41f19b7c4b1102055d919607fa3b96c`.
- 민감 백업은 추적하지 않는 `tmp/cf123-release-20260908-live/`에만 보관한다. SQL/서명봉투/다운로드 URL은 Git에 포함하지 않는다.

## 검수 / 제한

- 계산 24, 저장/ACL 16, 출력 8, 원본/작업용 가져오기 30, 기존 CF122 회귀 13 통과.
- 실제 컴포넌트/API mock의 최신 원본 grid 회귀: 전체41페이지, 선택4. 13페이지, 각443행 누락/중복0, pageerror0. 실제 로그인 업무 서버 검증과는 다르다.
- 17개 전체/선택 값고정 XLSX 및 작업용20시트 파일을 생성했다. 작업용17결과 시트는 내보낸 시점 값이므로 입력 편집 후 웹 재가져오기·재계산이 필요하다.
- 신규비목 다중 구간/후속차수/복수 선금/교정 규칙 승인/API 운영 연결은 미완료다. 출처 미확인은 —, 모든 출력은 LEGACY_REPLAY 검토용이다.
- 원본 목록 장식 도형, 네이티브 Excel 재계산, 실물 프린터는 미검수/미재현이다. 전체60개 수용 항목 완료 선언은 하지 않는다.
- Web/API/engine 개별 타입 및 실제 배포 Vite 빌드 통과. 기존 루트 harness 타입 오류와 큰 bundle 경고는 별도 남아 있다.
