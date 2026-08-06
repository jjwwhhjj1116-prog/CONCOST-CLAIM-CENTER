# CASE-01: 사건 목록 화면 명세서

## 1. 화면 개요 및 목적
전체 클레임 사건을 검색하고 대/중/소분류 카테고리 트리 및 상태 필터로 정밀 조회하는 메인 사건 데이터 테이블 화면입니다.

## 2. Google Stitch Screen Metadata
- **Stitch Project ID**: `proj_claim_studio_v1`
- **Stitch Screen ID**: `screen_case_01`
- **Stitch Official URL**: `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_case_01`
- **Export Artifacts Path**: `docs/stitch/artifacts/CASE-01/screen.html`

## 3. 1440px 데스크톱 레이아웃 & 컴포넌트 슬롯
- **상단 필터바**: 사건명/코드 검색창, 대/중/소분류 카스케이딩 드롭다운, 진행 상태 셀렉터
- **메인 데이터 테이블**: 사건코드, 사건명, 대/중/소분류, 담당 PM, D-day 배지, 장 승인 상태 요약 진행바
- **액션 슬롯**: Top-right [+ 새 사건 등록] 버튼 (Royal Blue `--primary-500`)

## 4. 1024px 태블릿 축약 레이아웃
- 카테고리 필터가 아코디언 드롭다운으로 축소되며, 테이블 컬럼 중 일부 보조 컬럼(생성일 등)이 숨김 처리됨.

## 5. 비주얼 배지 & UI 인터랙션
- **상태 배지**: ⚪ 미작성, 🔵 작성중, 🟣 AI초안, 🟡 검토, 🟠 수정요청, 🟢 승인 배지 수록.

## 6. 코너 케이스 6종 명세
- **로딩 상태 (Loading State)**: 사건 목록 조회 시 데이터 테이블 행에 펄스 스켈레톤 로더 표시.
- **빈 상태**: "검색 조건에 맞는 사건이 없습니다" 스마트 가이드 텍스트 및 초기화 버튼.
- **오류 상태**: 서버 통신 장애 발생 시 🔴 Rose Red Toast 및 재시도 버튼.
- **403 권한 없음**: 타 조직 사건으로 접근 시 "권한이 없습니다 (HTTP 403)" 인터셉트.
- **긴 콘텐츠 오버플로우**: 사건명이 40자를 초과할 시 text-ellipsis 적용 및 Hover 툴팁 출력.
- **접근성 및 키보드 탐색**: Tab 키로 테이블 행 포커스 이동 가능, Enter 키 진입 지원.
