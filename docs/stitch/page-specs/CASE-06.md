# CASE-06: 사건 상세 자료실 화면 명세서

## 1. 화면 개요 및 목적
사건 증거 문서, 사진, 현장 조사 파일의 업로드, 표준 파일명 규칙 검증 및 개정 버전(v01, v02)을 관리하는 자료실 화면입니다.

## 2. Google Stitch Screen Metadata
- **Stitch Project ID**: `proj_claim_studio_v1`
- **Stitch Screen ID**: `screen_case_06`
- **Stitch Official URL**: `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_case_06`
- **Export Artifacts Path**: `docs/stitch/artifacts/CASE-06/screen.html`

## 3. 1440px 데스크톱 레이아웃 & 컴포넌트 슬롯
- **상단 드롭존**: 파일 Drag-and-Drop 업로드 영역 (최대 100MB 지원)
- **문서 매니저 테이블**: 파일명, 버전 배지(v01/v02), 용량, 업로드 일시/작성자, 파일명 검증 배지, [미리보기]/[다운로드] 버튼

## 4. 1024px 태블릿 축약 레이아웃
- 드롭존 높이 축소, 테이블이 썸네일 파일 리스트 뷰로 유연 전환.

## 5. 비주얼 배지 & UI 인터랙션
- **배지**: 표준 파일명 준수 🟢 Compliance Badge, 버전 태그 (v01, v02).

## 6. 코너 케이스 6종 명세
- **로딩 상태 (Loading State)**: 대용량 파일 업로드 진행 시 % 프로그레스 바 및 펄스 스켈레톤 행 표시.
- **빈 상태**: 파일 없을 시 "자료를 드래그하거나 선택하여 업로드하세요" 가이드.
- **오류 상태**: 미지원 확장자 업로드 시 🔴 Rose Red Toast ("PDF, DOCX만 지원됩니다").
- **403 권한 없음**: 비배정 사용자의 무단 파일 업로드/삭제 시도 시 HTTP 403 차단.
- **긴 콘텐츠 오버플로우**: 긴 파일명 호버 시 전체 파일명 툴팁 출력.
- **접근성 및 키보드 탐색**: 파일 선택창 `Space`/`Enter` 조작 지원.
