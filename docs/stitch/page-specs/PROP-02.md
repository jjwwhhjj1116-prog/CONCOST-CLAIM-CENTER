# PROP-02: 제안서 단계형 작성기 화면 명세서

## 1. 화면 개요 및 목적
사건 데이터를 제안서 양식에 자동 치환하고 누락 필드를 검증하는 작성기 화면입니다.

## 2. Google Stitch Screen Metadata
- **Stitch Project ID**: `proj_claim_studio_v1`
- **Stitch Screen ID**: `screen_prop_02`
- **Stitch Official URL**: `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_prop_02`
- **Export Artifacts Path**: `docs/stitch/artifacts/PROP-02/screen.html`

## 3. 1440px 데스크톱 레이아웃 & 컴포넌트 슬롯
- **좌측 영역**: 자동 치환 폼 필드, 미입력 누락 필드 주황색 배지 목록
- **우측 영역**: 실시간 제안서 라이브 미리보기 뷰어, [DOCX 출력] 버튼

## 4. 1024px 태블릿 축약 레이아웃
- 폼 입력과 미리보기 패널이 탭 전환 구조로 바뀜.

## 5. 코너 케이스 6종 명세
- **로딩 상태 (Loading State)**: 실시간 렌더링 중 우측 라이브 미리보기 패널 펄스 스켈레톤 표시.
- **빈 상태**: 치환 데이터 미존재 시 주황색 미입력 배지 표시.
- **오류 상태**: 누락 필드 존재 시 [DOCX 출력] 버튼 클릭 시 차단 팝업.
- **403 권한 없음**: 권한 없는 자의 제안서 출력 시도 시 HTTP 403 차단.
- **긴 콘텐츠 오버플로우**: 긴 텍스트 치환 시 미리보기 문서 세로 스크롤.
- **접근성 및 키보드 탐색**: 누락 필드로 이동하는 숏컷 키보드 지원.
