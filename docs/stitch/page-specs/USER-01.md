# USER-01: 사용자 및 권한 관리 화면 명세서

## 1. 화면 개요 및 목적
6대 사용자 역할(대표, 본부장, PM, 실무자, 검토자, 관리자) 계정 및 RBAC 세부 권한을 관리하는 화면입니다.

## 2. Google Stitch Screen Metadata
- **Stitch Project ID**: `proj_claim_studio_v1`
- **Stitch Screen ID**: `screen_user_01`
- **Stitch Official URL**: `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_user_01`
- **Export Artifacts Path**: `docs/stitch/artifacts/USER-01/screen.html`

## 3. 1440px 데스크톱 레이아웃 & 컴포넌트 슬롯
- **사용자 데이터 테이블**: 사용자명, 이메일, 센터/본부, 역할 드롭다운, 활성화 토글
- **액션**: [+ 사용자 초대] 버튼, RBAC 세부 권한 매트릭스 팝업 모달

## 4. 1024px 태블릿 축약 레이아웃
- 사용자 테이블 반응형 스크롤바 가동.

## 5. 코너 케이스 6종 명세
- **로딩 상태 (Loading State)**: 사용자 목록 조회 시 테이블 행 스켈레톤 로더 표시.
- **빈 상태**: 소속 계정 미존재 시 사용자 초대 가이드.
- **오류 상태**: 중복 이메일 계정 생성 시 붉은 경고 메시지.
- **403 권한 없음**: 관리자 권한 없는 자의 역할 변경 시 HTTP 403 차단.
- **긴 콘텐츠 오버플로우**: 긴 이메일 말줄임표 처리.
- **접근성 및 키보드 탐색**: 스위치 토글 Space키 조작 지원.
