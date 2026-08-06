# AUD-01: 시스템 감사로그 화면 명세서

## 1. 화면 개요 및 목적
시스템 전역의 데이터 변경, 로그인, AI 생성 및 권한 거부(403) 이력을 Append-only로 보존·조회하는 보안 화면입니다.

## 2. Google Stitch Screen Metadata
- **Stitch Project ID**: `proj_claim_studio_v1`
- **Stitch Screen ID**: `screen_aud_01`
- **Stitch Official URL**: `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_aud_01`
- **Export Artifacts Path**: `docs/stitch/artifacts/AUD-01/screen.html`

## 3. 1440px 데스크톱 레이아웃 & 컴포넌트 슬롯
- **상단 필터**: 일시 기간 필터, 이벤트 유형(LOGIN, CASE_CREATE, SECTION_APPROVE, AI_GENERATE, 403_DENIED) 셀렉터
- **로그 테이블**: 타임스탬프 (UTC ISO), 사용자 ID, IP 주소, 이벤트명, 대상 엔터티, SHA-256 해시값

## 4. 1024px 태블릿 축약 레이아웃
- 테이블 스크롤러 가동, 해시 컬럼 축약 표시.

## 5. 코너 케이스 6종 명세
- **로딩 상태 (Loading State)**: 대용량 감사로그 검색 시 테이블 스켈레톤 행 표시.
- **빈 상태**: 조회 조건 로그 미존재 시 "감사로그 내역이 없습니다" 가이드.
- **오류 상태**: 감사로그 원본은 조작 및 삭제가 절대 불가능한 읽기 전용(ReadOnly) 불변조건 준수.
- **403 권한 없음**: 일반 직원의 감사로그 전체 진입 시 HTTP 403 차단.
- **긴 콘텐츠 오버플로우**: 긴 해시값 마우스 호버 시 전체 해시 툴팁.
- **접근성 및 키보드 탐색**: 키보드 방향키 테이블 셀 포커스 지원.
