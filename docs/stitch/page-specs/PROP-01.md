# PROP-01: 제안서 템플릿 선택 화면 명세서

## 1. 화면 개요 및 목적
사건 수임 및 계약용 제안서 템플릿을 탐색하고 선택하는 카탈로그 화면입니다.

## 2. Google Stitch Screen Metadata
- **Stitch Project ID**: `proj_claim_studio_v1`
- **Stitch Screen ID**: `screen_prop_01`
- **Stitch Official URL**: `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_prop_01`
- **Export Artifacts Path**: `docs/stitch/artifacts/PROP-01/screen.html`

## 3. 1440px 데스크톱 레이아웃 & 컴포넌트 슬롯
- **상단 필터**: 검색창, 카테고리 태그 버튼
- **템플릿 그리드**: 표준 제안서, 손해분석 제안서, 간이 견적서 카드 (썸네일, 장 수 배지, [템플릿 적용] 버튼)

## 4. 1024px 태블릿 축약 레이아웃
- 3열 그리드가 2열 그리드로 축소됨.

## 5. 코너 케이스 6종 명세
- **로딩 상태 (Loading State)**: 템플릿 카드 수신 중 3열 썸네일 스켈레톤 타일 표시.
- **빈 상태**: 검색 결과 없을 시 "조건에 맞는 템플릿이 없습니다" 가이드.
- **오류 상태**: 템플릿 로딩 실패 시 붉은 Toast 알림.
- **403 권한 없음**: 비배정 사건에 템플릿 적용 시 HTTP 403 차단.
- **긴 콘텐츠 오버플로우**: 긴 템플릿 설명글 말줄임표 처리.
- **접근성 및 키보드 탐색**: 카드 간 Tab 키 포커스 이동 지원.
