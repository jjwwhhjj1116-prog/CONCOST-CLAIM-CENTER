# Antigravity P03 실행 지시

## 기준점

- P02 최종 구현·Codex 보정 커밋: `9ce31ac`
- P02 판정: `PASS`
- 작업 브랜치: `feat/P03-app-shell-design-system`
- 최상위 실행 지침: `01_ANTIGRAVITY_EXECUTOR_INSTRUCTIONS_v2.md`
- 제품 계약: P01의 6대 유형, 20개 화면, 33개 엔터티, Reviewer RBAC
- UI 계약: `docs/stitch/`의 디자인 토큰, 컴포넌트 맵, page-spec 20개, HTML prototype 20개

P02 결과를 단순 복사하지 말고 실제 애플리케이션 셸과 공통 UI 코드로 구현하라. P04의 실제 인증·DB·감사로그를 선행 구현하거나, 화면 가드만으로 보안을 완성했다고 주장하지 않는다.

## 시작 절차

1. 이 인계 커밋을 기준으로 `feat/P03-app-shell-design-system` 브랜치를 사용한다.
2. `docs/harness/phase-status.json`의 `currentPhase`를 `P03`, P03 상태를 `IN_PROGRESS`로 바꾼 시작 상태 커밋을 먼저 만든다.
3. P00~P02 PASS 기록, Codex 보고서, 원본 Excel과 `docs/보고서 템플릿/`을 수정·이동·복제하지 않는다.
4. 실제 고객정보·원본 파일명·API 키·토큰을 fixture, Storybook, 화면, 로그에 넣지 않는다.

## 필수 구현

1. `apps/web`에 실행 가능한 웹 앱 셸을 구현하고 `apps/api`는 P04 전까지 명확한 placeholder 경계만 둔다.
2. 기술 스택과 실행 명령을 README와 패키지 스크립트에 명시한다. 개발 서버와 production build가 모두 재현되어야 한다.
3. 공통 레이아웃을 구현한다.
   - 로그인 화면
   - 전역 사이드바
   - 상단바
   - 본문 라우트 outlet
   - 1440px 데스크톱과 1024px 태블릿 내비게이션 복구 동작
4. 정확히 20개 P01/P02 화면 ID를 실제 라우트에 매핑한다. 임의 화면 추가는 계약 변경 근거가 있을 때만 한다.
5. 6대 클레임 유형 선택 UI는 `TYPE-01`~`TYPE-06`만 노출하며, 9개 템플릿 폴더를 유형으로 표시하지 않는다.
6. `packages/ui`에 공통 컴포넌트를 구현한다.
   - Button, Input, Select, Dialog/Drawer
   - Table, Card, StatusBadge
   - DDay, Timeline
   - Loading, Empty, Error, Forbidden 상태
   - Skip link, focus-visible, 긴 텍스트 overflow 처리
7. `docs/stitch/design-tokens.json`을 코드 토큰의 단일 출처로 연결하고 임의 색상 하드코딩을 최소화한다.
8. Storybook 또는 동등한 정적 컴포넌트 카탈로그를 제공한다. 모든 공통 컴포넌트의 정상·로딩·빈 상태·오류·403·긴 텍스트 예시를 포함한다.
9. P03 권한 가드는 P01 RBAC에 따른 클라이언트 라우팅 계약을 구현하되, P04 서버/API 권한 검사가 필수임을 코드와 문서에 명확히 표시한다.
10. 가상 데이터는 명백한 synthetic fixture만 사용하고 production 경로와 분리한다.

## 필수 테스트와 반례

- 20개 라우트 전수 렌더링 및 잘못된 라우트 404
- 주소 직접 입력 시 허용 라우트 복원, 금지 라우트 Forbidden 표시
- 브라우저 뒤로가기/앞으로가기 상태 보존
- 세션 만료 시 로그인 이동과 원래 목적지 안전 보존
- 열린 탭에서 역할이 변경됐을 때 다음 내비게이션·행동 차단
- Reviewer: 업로드 O, 본문 직접 편집 X, 장 1차 승인 O, 최종 병합 X
- `TYPE-07` 주입 및 템플릿 폴더의 유형 승격 거부
- 1024px 드로어 열기/닫기와 키보드 Escape 복구
- 200% 확대에서 핵심 행동과 포커스가 사라지지 않음
- 포커스 스타일·접근성 이름·상태 텍스트 중 하나를 제거한 변이가 테스트에서 실패
- P01/P02 하네스 15개가 계속 통과하여 이전 계약 회귀가 없음

각 반례는 정상 코드에 주석만 적지 말고 자동 테스트에서 실제로 실행한다. P03 하네스도 단순 파일 존재·문자열 포함만으로 통과시키지 않는다.

## 품질·보안 게이트와 증거

```powershell
npx --yes pnpm@9.15.0 install --frozen-lockfile
npx --yes pnpm@9.15.0 lint
npx --yes pnpm@9.15.0 typecheck
npx --yes pnpm@9.15.0 test
npx --yes pnpm@9.15.0 build
npx --yes pnpm@9.15.0 test:e2e
npx --yes pnpm@9.15.0 audit --audit-level high
```

- 컴포넌트 테스트와 최소 핵심 라우팅 E2E를 모두 실행한다.
- `artifacts/harness/P03/manifest.json`, `commands.log`, `notes.md`를 생성한다.
- 구현 커밋 A의 `git diff-tree`와 manifest `changedFiles`를 정확히 일치시킨다.
- 상태 커밋 B에서 P03을 `READY_FOR_REVIEW`로 변경하고 `docs/reviews/requests/P03-review-request.md`를 작성한다.
- 구현 커밋에 Codex 검수 보고서를 포함하지 않는다.

## 완료 보고 형식

- 브랜치
- 구현 커밋 A와 상태 커밋 B
- 실행 가능한 앱 명령과 주요 라우트
- 공통 컴포넌트/카탈로그 경로
- 7개 품질·보안 게이트 결과
- 테스트 수와 독립 반례 결과
- 1440px/1024px/200% 확대 검증 증거
- 증거 경로
- 알려진 제한(P04 서버 권한 경계 포함)
- Codex 검수 요청 경로

Antigravity 완료 후 Codex가 clean snapshot, 실제 라우팅, 키보드·반응형, 권한 가드 반례를 독립 검수하고 미달 부분을 직접 보정한다.
