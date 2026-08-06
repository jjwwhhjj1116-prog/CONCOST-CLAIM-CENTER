# P03 검수 요청 (App Shell & Design System)

## 구현 커밋
- Implementation Commit: `d447a13`

## 실행 가능 웹 앱 명령 및 주요 라우트
- 개발 서버 실행: `npx --yes pnpm@9.15.0 --filter claim-center-report-studio-web dev` (http://localhost:3000)
- 프로덕션 빌드: `npx --yes pnpm@9.15.0 build`
- 20개 라우트 mapping: `/login` (AUTH-01), `/dashboard` (DASH-01), `/cases` (CASE-01~06), `/meetings` (MEET-01), `/proposals/*` (PROP-01~02), `/reports` (REPO-01~02), `/approval` (APPR-01), `/success-fee` (FEE-01), `/templates` (TPL-01), `/ai-config` (AI-01), `/users` (USER-01), `/audit-logs` (AUD-01), `/tablet-responsive` (RESP-01)
- 404 handler & Reviewer RBAC 403 Forbidden 클라이언트 라우트 가드 적용

## 공통 컴포넌트 & 카탈로그 경로
- 패키지: `packages/ui` (`@claim-studio/ui`)
- 디자인 토큰 연결: `packages/ui/src/tokens.ts` (`docs/stitch/design-tokens.json` 단일 진실 소스 바인딩)
- 컴포넌트 목록: Button, Input, Select (6대 클레임 유형 TYPE-01~06 바인딩), Dialog, Drawer, Card, Table, StatusBadge, DDay, Timeline, StateView (Normal, Loading, Empty, Error, Forbidden), SkipLink
- 정적 카탈로그: `packages/ui/src/catalog/ComponentCatalog.tsx`

## 실행 명령 및 7대 품질·보안 게이트 결과
```powershell
npx --yes pnpm@9.15.0 install --frozen-lockfile
npx --yes pnpm@9.15.0 lint
npx --yes pnpm@9.15.0 typecheck
npx --yes pnpm@9.15.0 test
npx --yes pnpm@9.15.0 build
npx --yes pnpm@9.15.0 test:e2e
npx --yes pnpm@9.15.0 audit --audit-level high
```
- `install --frozen-lockfile`: PASSED
- `lint`: PASSED
- `typecheck`: PASSED
- `test`: PASSED (7 tests passed including P00~P03 assertions)
- `build`: PASSED
- `test:e2e`: PASSED
- `audit --audit-level high`: PASSED (0 high vulnerability)
- 총 테스트: 7 passed, 0 failed, 0 skipped

## 1440px / 1024px / 200% 확대 대응 검증
- 1440px 데스크톱: 260px 고정 내비게이션 사이드바 및 레이아웃 셸 렌더링.
- 1024px 태블릿: 슬라이드 오버 Drawer 토글 버튼 (`#drawerToggleBtn`, `#closeDrawerBtn`) 및 반응형 렌더링.
- 200% 확대: SkipLink 및 본문 영역 파손 방지.

## 증거 경로
- `/artifacts/harness/P03/manifest.json`
- `/artifacts/harness/P03/commands.log`
- `/artifacts/harness/P03/notes.md`

## 알려진 제한
- P03은 클라이언트 사이드 웹 앱 셸, 20개 라우팅, RBAC 가드, UI 디자인 시스템 구축을 완료했습니다. 서버 사이드 DB, Auth, 감사로그 보안 연동은 P04에서 이어집니다.

## 인수 기준 자체 판정
- [x] apps/web 실행 가능 웹 앱 셸 및 라우팅 구축: PASS
- [x] packages/ui 디자인 시스템 패키지 및 design-tokens.json 연결: PASS
- [x] 20개 전수 라우트 매핑 및 미인식 주소 404 핸들러 작동: PASS
- [x] Reviewer 역할 직접 편집 라우트 클라이언트 RBAC 가드 (HTTP 403) 작동: PASS
- [x] 6대 고정 클레임 유형(TYPE-01~06) 선택기 UI 적용: PASS
- [x] 1440px 데스크톱 & 1024px 반응형 드로어 내비게이션 지원: PASS
- [x] SkipLink, focus-visible, 엘립시스 텍스트 오버플로우 지원: PASS
- [x] 7대 품질·보안 게이트 통과 (install, lint, typecheck, test, build, test:e2e, audit): PASS
- [x] git diff-tree 30개 파일 목록과 manifest changedFiles 1:1 완벽 일치: PASS
- [x] 구현 커밋 해시 (d447a13) 동기화: PASS

## 검수자가 집중할 위험
- `apps/web/src/routes/Router.tsx` 20개 라우트 매핑 및 Reviewer 역할 변경 시 `/reports/studio` (REPO-02) HTTP 403 Forbidden 차단 작동 여부
- `packages/ui/src/catalog/ComponentCatalog.tsx` 정적 카탈로그의 5대 UI 상태 시각적 표현
- `git diff-tree --no-commit-id --name-only -r d447a13`와 `manifest.json` `changedFiles` 30개 파일의 100% 동일성
