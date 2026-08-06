# RESP-01: 태블릿 축약 화면 (1024px) 명세서

## 1. 화면 개요 및 목적
1440px 데스크톱 환경에서 1024px 태블릿 해상도 환경으로 이동 시, 3단 보고서 스튜디오를 2단 슬라이드 오버 Drawer로 응답성이 유지되도록 처리하는 축약 화면 명세입니다.

## 2. Google Stitch Screen Metadata
- **Stitch Project ID**: `proj_claim_studio_v1`
- **Stitch Screen ID**: `screen_resp_01`
- **Stitch Official URL**: `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_resp_01`
- **Export Artifacts Path**: `docs/stitch/artifacts/RESP-01/screen.html`

## 3. 1440px 데스크톱 대비 1024px 태블릿 축약 레이아웃 & 컴포넌트 슬롯
- **좌측 목차 바**: 1440px 데스크톱의 260px 패널이 64px 아이콘 툴바로 접힘 (클릭 시 아코디언 드로어 슬라이드)
- **중앙 에디터**: 100% 가로 폭으로 확장되어 리치 에디팅 영역 확보
- **우측 AI 패널**: 바텀 시트 슬라이드 오버 (Bottom Sheet Drawer) 모달로 전환되어 필요한 순간에만 팝업

## 4. 코너 케이스 6종 명세
- **로딩 상태 (Loading State)**: 화면 전환 시 스켈레톤 레이아웃 및 스피너 표시.
- **빈 상태**: Drawer 미활성화 상태 시 하단 floating AI 비서 버튼 배치.
- **오류 상태**: 1024px 미만(스마트폰 해상도) 접근 시 "태블릿 이상 권장" 안내 팝업.
- **403 권한 없음**: 권한 없음 페이지 역시 반응형 슬레이트 다크 카드 유지.
- **긴 콘텐츠 오버플로우**: 터치 기반 스와이프 스크롤 가동.
- **접근성 및 키보드 탐색**: 모달 닫기 터치/Esc 키 지원.
