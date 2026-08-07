# P09 검수·보정 메모

## 제출 상태

Antigravity 제출 커밋 `8db5895`에는 검수 요청서·commands.log·notes.md가 없었고 manifest의 commit 값이 `HEAD`였으며, 구현·상태·증거가 한 커밋에 섞여 있었다. 제출 설명만으로 통과시키지 않고 코드·DB·API·브라우저를 독립 확인했다.

## Codex 직접 보정

- 기존 P08 `ReportInstance`에서만 P09 스튜디오가 시작되도록 provenance를 바로잡고 standalone 가상 보고서를 제거했다.
- revision, evidence, approval, comment event, merge snapshot의 UPDATE/DELETE와 FK 우회를 DB trigger로 차단했다.
- stale 버전을 선택 입력으로 우회하던 경로, `/body` 직접 수정, 자기·교차 장 승인, 미해결 수정 요청 승인, 변조·타 사건 근거, 감사 실패 orphan을 차단했다.
- 문단 단위 근거 위치·source hash/version snapshot과 승인된 최신 VALID revision만의 결정적 merge hash를 구현했다.
- 하드코딩 `RPT-001`과 잘못된 `/api` 경로를 제거하고 P08 생성 결과에서 동적 스튜디오 route로 진입하도록 연결했다.
- 실제 1.2초 autosave, 수동 저장, lossless 409 비교·복구, 3단/1024px 탭, 100장 이동, keyboard/focus/200% 확대를 구현했다.
- HTTP-only P09 E2E를 실제 production build + Chrome 사용자 흐름으로 교체했다.
- P08 snapshot 생성 성공 알림이 즉시 route 이동으로 사라진 회귀를 보정하고 실제 P08 Chrome E2E로 재확인했다.

## 최종 상태

최종 검수 커밋 `ceadc14`에는 미해결 Critical/High가 없다. 일반 85/85, 보안 40/40, P06~P09 실제 Chrome 4/4, audit high 0건을 깨끗한 설치 환경에서 확인했다. 장문 경계는 정확히 100,000자로 검증한다. 원 제출에 대규모 보정이 필요했던 이력은 숨기지 않고 최종 판정을 `PASS_WITH_NOTES`로 기록한다.

P10 진입은 허용하지만 P09의 P10 disabled placeholder를 외부 공급자 우회 경로로 재사용해서는 안 된다. P10은 별도 브랜치와 별도 additive migration/API/UI/test/evidence로 선행 구현한다.
