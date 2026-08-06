# P03 Codex 보정 노트

Antigravity 제출 커밋 `d447a13`은 정적 하네스만 통과했으며 실제 개발 서버가 `@claim-studio/ui` 진입점을 찾지 못해 실행되지 않았다. 루트 `typecheck`와 `build`는 웹/UI 소스를 검사하거나 빌드하지 않았고, `test:e2e`는 동일 정적 테스트의 재실행이었다. P02 엄격 회귀 테스트도 import에서 제거되어 있었다.

Codex 보정 내용:

- UI workspace 해석과 Vite alias를 고치고 UI 패키지와 production 웹 앱을 실제 빌드한다.
- URL 초기 복원, `pushState`/`replaceState`, `popstate`, 직접 주소, 404를 구현한다.
- 세션 만료 후 로그인 이동과 20개 승인 경로만 허용하는 안전한 `returnTo` 복원을 구현한다.
- 6개 제품 역할을 사용하고, Reviewer는 REPO-02 진입·업로드·장 1차 승인은 허용하되 본문 편집·최종 병합만 차단한다.
- 누락된 Dialog를 추가하고 Drawer Escape, focus trap, 호출자 포커스 복귀를 구현한다.
- P02 JSON 토큰의 실제 키를 사용하고 공통 카탈로그에 모든 컴포넌트·5개 상태·긴 콘텐츠 예시를 제공한다.
- P02 엄격 테스트 8개를 복구하고 P03 적대 테스트 9개를 추가하여 전체 24개 회귀 테스트를 실행한다.
- production preview를 시스템 Chrome/Edge로 여는 별도 E2E에서 history, RBAC, 세션, 1024px Drawer, focus, 200% 확대를 검증한다.

P04에서는 클라이언트 역할 값을 신뢰하지 말고 API/DB에서 조직·사건 범위 권한과 감사로그를 강제해야 한다.
