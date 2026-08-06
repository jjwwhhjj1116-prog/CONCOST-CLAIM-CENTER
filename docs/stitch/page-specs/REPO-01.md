# REPO-01: 보고서 목록 화면 명세서

## 1. 화면 개요 및 목적
작성 중인 손해배상 및 클레임 보고서 목록과 장 승인 현황을 모니터링하는 화면입니다.

## 2. Google Stitch Screen Metadata
- **Stitch Project ID**: `proj_claim_studio_v1`
- **Stitch Screen ID**: `screen_repo_01`
- **Stitch Official URL**: `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_repo_01`
- **Export Artifacts Path**: `docs/stitch/artifacts/REPO-01/screen.html`

## 3. 1440px 데스크톱 레이아웃 & 컴포넌트 슬롯
- **보고서 데이터 카드 그리드**: 보고서명, 사건코드, 장 승인 진행바 (예: 5/7 승인), 전체 상태 배지, [스튜디오 열기] 파랑 버튼

## 4. 1024px 태블릿 축약 레이아웃
- 카드 그리드가 2열로 축소됨.

## 5. 코너 케이스 6종 명세
- **로딩 상태 (Loading State)**: 보고서 데이터 로딩 중 3열 카드 스켈레톤 마스크 표시.
- **빈 상태**: 생성된 보고서 없을 시 "첫 보고서를 생성하세요" 안내.
- **오류 상태**: 데이터 수신 장애 시 Toast 경고 알림.
- **403 권한 없음**: 타 사건 보고서 진입 시 HTTP 403 차단.
- **긴 콘텐츠 오버플로우**: 보고서 제목 말줄임표 처리.
- **접근성 및 키보드 탐색**: Tab 키로 카드 순회, Enter 키로 스튜디오 진입.
