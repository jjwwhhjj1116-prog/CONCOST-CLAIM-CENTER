# P03 App Shell & Design System 구현 노트

## 주요 구현 내역
1. **`packages/ui` 디자인 시스템 공통 컴포넌트 구축**:
   - Button, Input, Select, Dialog, Drawer, Card, Table, StatusBadge, DDay, Timeline, SkipLink 구현.
   - `docs/stitch/design-tokens.json`을 단일 진실 소스로 `tokens.ts`에 연결하여 토큰 하드코딩 최소화.
   - Normal, Loading, Empty, Error, Forbidden 5가지 표준 UI 상태 렌더러 (`StateView.tsx`) 제공.
   - 동등 정적 컴포넌트 카탈로그 (`ComponentCatalog.tsx`) 제공.

2. **`apps/web` 실행 가능 웹 애플리케이션 셸 구축**:
   - Vite + React 18 기반 웹 앱 셸 구성.
   - 20개 P01/P02 화면 ID (`AUTH-01` ~ `RESP-01`) 전수 1:1 라우트 매핑 (`Router.tsx`).
   - 미인식 주소 입력 시 404 Not Found 처리.
   - Reviewer 역할의 보고서 초안 본문 직접 편집 접근 시 클라이언트 RBAC 가드 (HTTP 403 Forbidden) 적용.
   - 6대 고정 클레임 유형 (`TYPE-01` ~ `TYPE-06`) 전용 선택기 UI 제공.

3. **반응형 셸 및 접근성 보장**:
   - 1440px 데스크톱 260px 사이드바 & 1024px 태블릿 복구 슬라이드 오버 Drawer 토글 지원.
   - 200% 확대에서도 레이아웃 및 본문 파손 방지.
   - `SkipLink` (본문 영역으로 바로가기), 포커스 링(`focus-visible`), 엘립시스 텍스트 오버플로우 지원.
