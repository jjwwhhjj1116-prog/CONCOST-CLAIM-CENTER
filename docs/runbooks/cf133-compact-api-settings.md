# CF133 외부자료 API 설정 간소화

국가법령·ECOS의 큰 카드 2개를 관리자 설정의 `외부자료 API 연결` 카드 하나로 통합했다. 기관별 독립 form은 유지하고 기관명/저장상태, password 입력, 저장·연결 확인을 같은 행에 배치했다. 발급 안내·다시 불러오기는 기관별 닫힌 details로 이동했다. 좁은 화면은 세로 배치한다.

저장/조회 handler, 버전 충돌, 미저장 입력 시 연결 확인 차단, 성공 후 입력 제거는 변경하지 않았다. 키·API·DB·권한·ES 계산을 변경하지 않았다. 두 기관의 키를 한 값으로 합치거나 다른 기관에 재사용하지 않는다.

- 기존 ECOS35 + 법령12 회귀 47/47 PASS.
- TypeScript AST 비교: 두 컴포넌트의 JSX 전 처리 함수와 form/input/Button의 동작 바인딩 동일.
- web TypeScript/Vite build PASS. 기존 대형 번들 경고 유지.
- 브라우저 증거: `output/playwright/es-v2/cf133-browser-results.json`, 합성 API를 사용하는 실제 App harness `cf133-ui-test.ts`. 실제 키 저장·문서 쓰기 없음.
- 개발 서버만 배포 대상. migration 없음, 기존 인증키와 데이터 유지.
