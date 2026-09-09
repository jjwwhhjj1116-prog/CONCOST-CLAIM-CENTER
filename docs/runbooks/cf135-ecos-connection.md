# CF135 ECOS 연결 오류 수정

## 원인과 수정

- 실제 개발 서버의 저장 키 연결 확인은 NETWORK_REDIRECT로 실패했다. 기존 `redirect: error`가 한국은행의 주소 전환을 차단했고, API가 진단 정보를 버려 인증키·승인·호출 제한을 포괄하는 문구만 표시했다.
- 주소 전환은 직접 검사하여 최대 2회만 허용한다. 목적지는 한국은행 공식 HTTPS origin, 동일 인증키의 StatisticSearch 경로로 제한한다. HTTP 강등·외부 호스트·다른 키·로그인 경로·userinfo는 차단한다. 전체 요청은 동일한 12초 제한을 사용한다.
- 성공 응답도 통계표 404Y014, 2020=100, 정확한 자료월과 4개 항목을 검증한다. 다른 월이나 최신 값으로 대체하지 않으며 한 항목이라도 실패하면 해당 월 4종은 반영하지 않는다.
- 네트워크·timeout·HTTP·ECOS 오류 코드는 안전한 자체 문구로 구분한다. 공급자 원문 메시지, 인증키, 요청/전환 URL은 반환하지 않는다. Worker와 Node API에 동일한 진단 전달을 적용했다.
- 응답 본문 timeout과 null 통계행도 각각 TIMEOUT, RESPONSE_MISMATCH로 표시한다.

## 기존 회귀 실패 수정

- CF30의 오래된 순번 ID 기대를 실제 6단계 Drive 폴더 계층, provenance, 재호출 시 ID 재사용·중복 생성 없음 검사로 교체했다. 기존 폴더 이동·삭제가 일어나면 실패한다.
- 템플릿 열람 테스트는 현재 버튼, 선택 조건, 열기·닫기 상태, 실제 Dialog 및 원본 열람 경로를 검증한다. 제품 Drive/템플릿 동작은 변경하지 않았다.

## 검증과 범위

- CF05/26/28/29/30/54/60/79/82/85/86/132/134/135 관련 회귀 107/107 PASS, 실패·스킵 0. CF135 진단 테스트 내부 18개 오류 사례 및 허용/차단 redirect 사례 포함.
- 웹 TypeScript + Vite build PASS. 기존 대형 번들 경고는 남아 있다.
- 확장 strict TypeScript PASS: `node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module CommonJS --moduleResolution Node --esModuleInterop --skipLibCheck --strict apps/cloudflare/src/asset-modules.d.ts scripts/cf30-settings-template-preview-test.ts scripts/cf134-settings-layout-test.ts scripts/cf135-ecos-diagnostics-test.ts scripts/cf132-es-ecos-test.ts scripts/cf132-ecos-settings-test.ts scripts/cf132-node-ecos-test.ts`.
- 로그인된 실제 개발 관리자 화면에서 저장 키 v3를 변경하지 않고 연결 확인: `연결 정상 · 2024-05 재료지수 4종 검증 완료. ES 기준일에 맞춰 조회할 수 있습니다.`
- 실제 키 원문 열람·로그·저장 없이 검증했다. 합성 테스트용 키만 테스트 소스에 사용한다.
- 이 실조회 증거는 ECOS 재료지수 4종이다. 노임·다른 기관 요율 전체가 ECOS에서 조회된다는 의미는 아니다. 실제 산출서 입력은 변경하지 않았다.
- 개발 서버만 배포. Node 서버는 코드·HTTP 회귀 검증만 수행했으며 배포하지 않았다. DB migration, 기존 업무 데이터/암호화 키 변경, 실서비스 배포 없음.

## 배포

- URL: https://concost-claim-center-development.jjwwhhjj1116.workers.dev/settings?section=admin
- 연결 수정 실조회 성공 버전: `1a6ae731-58ab-46ae-8816-811ae64851da`.
- timeout/null 응답 진단까지 보완한 최종 배포 버전: `6c120d1f-4828-4b9b-9c10-91ba336cffdb`.
- 최종 버전에서도 관리자 연결 확인 1회 성공: 2024-05 재료지수 4종 검증 완료, 저장 v3 유지, 오류 0. 성공 화면을 사용자 확인용으로 유지했다.
- 최종 배포 후 `node scripts/cf114-live-smoke.mjs development` PASS: health/readiness 정상, Drive 연결 유지, 익명 문서 접근 401, 로컬/원격 자산 SHA-256 일치.
- 명령: `corepack.cmd pnpm cf:build`, `node node_modules/wrangler/bin/wrangler.js deploy --config wrangler.development.jsonc --var RELEASE_MAINTENANCE:0`.
- API 코드 롤백 시 CF134 소스 `a258300`을 사용한다. DB 복구는 필요 없으며 이전 연결 오류도 돌아올 수 있다.
