# CASE-03: 사건 상세 개요 화면 명세서

## 1. 화면 개요 및 목적
사건 기본 메타데이터, 담당자 현황 및 전체 활동 이력을 통합 관리하는 개요 화면입니다.

## 2. Google Stitch Screen Metadata
- **Stitch Project ID**: `proj_claim_studio_v1`
- **Stitch Screen ID**: `screen_case_03`
- **Stitch Official URL**: `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_case_03`
- **Export Artifacts Path**: `docs/stitch/artifacts/CASE-03/screen.html`

## 3. 1440px 데스크톱 레이아웃 & 컴포넌트 슬롯
- **상단 네비게이션**: 13개 사건 전용 탭 네비게이션
- **본문 2단 슬롯**: 좌측 메타데이터 카드 (사건명, 코드, 분류, 계약금액), 우측 타임라인 활동 이력 스트림
- **액션 슬롯**: [사건 수정], [소프트 삭제], 빠른 문서 작성 툴바

## 4. 1024px 태블릿 축약 레이아웃
- 탭 네비게이션 스크롤러 가동, 좌우 2단 배치가 수직 단일 열로 순차 전환됨.

## 5. 비주얼 배지 & UI 인터랙션
- **배지**: 사건 생애주기 12단계 상태 배지 (예: `[분석]`, `[보고서 작성]`) 표시.

## 6. 코너 케이스 6종 명세
- **로딩 상태 (Loading State)**: 메타데이터 수신 중 카드 영역 스켈레톤 UI 표시.
- **빈 상태**: 수임 초기 활동 이력이 없을 시 "첫 활동 이력을 기록하세요" 안내.
- **오류 상태**: 네트워크 단절 시 데이터 동기화 실패 Toast 및 붉은색 파티션.
- **403 권한 없음**: 타 부서 비배정 사건 진입 시 "권한이 없습니다 (HTTP 403)" 차단.
- **긴 콘텐츠 오버플로우**: 긴 사건 설명 텍스트는 [더보기] 아코디언으로 축약 처리.
- **접근성 및 키보드 탐색**: 탭 간 `ArrowLeft`/`ArrowRight` 키보드 이동 지원.
