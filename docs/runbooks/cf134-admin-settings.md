# CF134 관리자 설정 정리

## 적용 범위

- 관리자 설정 상단에 제안서 작성 지침 → 보고서 작성 지침 순서로 배치. 기본 접힘이며 native details로 펼치고 접는다. 컴포넌트를 제거하지 않아 접었다 펼쳐도 편집 중인 입력이 보존된다.
- 보고서는 기존 PreviewAiAdmin의 유형별 지침·챕터 편집기를 그대로 재사용한다. 조직 AI와 중복되는 모델 라우팅은 embedded 모드에서 제외한다. 기존 /ai-config의 고급 설정·원본 템플릿 라이브러리는 유지한다.
- 조직 공용 AI 카드 안에 국가법령 OC·한국은행 ECOS 입력 행을 통합한다. 기관별 저장, 연결 확인, 버전 충돌, 비밀키 마스킹은 변경하지 않는다.
- 관리자 설정의 Hermes Bridge, 로컬 AI/Memory 정책, Memory 승인 목록 및 관련 미사용 상태·조회·저장 함수를 제거한다. 백엔드·기존 정책·메모리 이력·비밀키는 삭제하거나 비활성화하지 않는다.
- 중복 Google Drive 상세 설정 바로가기를 제거하고 기존 회사 Drive 연결 UI 한 곳을 유지한다. 사용자·권한 메뉴는 유지하며 문서 제작 플랫폼 상태를 마지막으로 이동한다.

## 검증

- 웹 TypeScript + Vite build PASS. 기존 대형 번들 경고는 남아 있다.
- 신규 CF134 8건 포함 focused 회귀 66/66 PASS. strict TypeScript PASS.
- 보존된 PreviewSettings 함수 14개의 AST 및 PreviewAiAdmin의 JSX 이전 상태/효과/처리 로직이 9d90938과 동일하다.
- 별도 역사 회귀 초기 16건: 11 PASS, 5 FAIL. CF28/29/60의 제거 대상 UI 존재 단언은 새 요구에 맞춰 부재 검사로 갱신했고, 해당 세 파일 10/10 재실행 PASS. 백엔드 검사는 변경하지 않았다. 최종 focused+역사 검사는 80/82 PASS이며 CF30의 folder-id-3000/5000 불일치와 오래된 보고서 선택·열람 문구 2건은 변경 전에도 실패했다. 전체 테스트 통과로 해석하지 않는다.
- 실제 App + 전체 전역 CSS, 합성 API 브라우저 검수 7/7 PASS. 기본 접힘/순서, 제안서·보고서 실제 편집기, 초안 유지, Enter/Space, 1440px/375px 넘침 없음, 그룹 통합, 삭제 대상 부재, 플랫폼 마지막, 예외/예상 밖 요청 없음.
- 화면 증거와 실행 harness: output/playwright/es-v2/cf134-browser-results.json 및 cf134-ui-test.ts. 실제 키·문서·지침의 저장 요청은 실행하지 않았다.

## 보고서 지침 확인 범위

CF84 마이그레이션 테스트 3/3 PASS. 마이그레이션 0024→0025→0054를 메모리 SQLite에 적용해 6유형, 60챕터, 11모듈, 9출력 프로필을 확인했다. 패키지 config_json의 유형 지시, 챕터 지시, 필수 입력/출력, 검증 조건과 실제 저장 본문을 452항목 대조해 누락 0건이다. Worker의 목차 생성, 본문 생성, 문장개선 경로에서 각 지침이 소비되는 것도 확인했다.

현재 CF84 패키지는 이전 CF33 TYPE 문서 seed를 대체한 버전이며 이전 버전은 이력으로 보존된다. 개별 TYPE 원문 파일은 현재 저장소에 없으므로 사용자가 제공했던 원문과 바이트 단위로 동일하다고 단정할 수 없다. Node API에는 이 보고서 지침 경로가 없으므로 개발 Cloudflare 구현의 검증 결과를 Node 서버에 확대 적용하지 않는다.

배포 후 로그인된 실제 관리자 화면에서 TYPE-01~06을 각각 선택해 유형당 10챕터, 전체 60챕터의 현재 프롬프트 v1과 6유형 지침 v1을 확인했다. 화면의 적용 패키지는 v1.0.0, 11모듈/9출력 프로필, SHA prefix 37a53a68e36c5855이다. 원문은 로그/캡처에 기록하지 않았고 실제 지침 저장 요청도 실행하지 않았다. 직접 API 페이지는 브라우저에서 차단되어 우회하지 않고 실제 편집기 선택 목록과 버전 표기를 확인했다.

## 배포

- 개발 서버만: https://concost-claim-center-development.jjwwhhjj1116.workers.dev/settings?section=admin
- 배포 버전: 2339f20b-f2d4-4ea3-b33f-cb669b3e3237
- 명령: `corepack.cmd pnpm cf:build`, `node node_modules/wrangler/bin/wrangler.js deploy --config wrangler.development.jsonc --var RELEASE_MAINTENANCE:0`
- `node scripts/cf114-live-smoke.mjs development` PASS: health/readiness 200, Google Drive 연결 유지, 익명 문서 접근 401, 로컬/원격 자산 SHA-256 일치.
- 자산: index-B6j69P9I.js / index-Cyh3Yh7R.css.
- 로그인된 개발 관리자 UI에서도 제안서/보고서 접힘·순서, 조직 AI 내 국가법령 v2/ECOS v1 암호화 저장 상태, Hermes 부재, 플랫폼 마지막, 브라우저 오류 없음 확인. 실제 키 입력값은 빈칸 유지.
- DB migration 없음. 기존 데이터·암호화키·인증키 변경 없음. 실서비스 배포 없음.
- UI 롤백 시 직전 CF133 버전 0a32ab0d-ab2c-4f7e-8c34-08da35b04f39 또는 소스 9d90938을 사용한다. DB 복구는 필요하지 않다.
