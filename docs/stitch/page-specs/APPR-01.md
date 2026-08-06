# APPR-01: 검토 및 승인함 화면 명세서

## 1. 화면 개요 및 목적
검토자와 본부장/대표가 작성된 보고서 장을 검토하고 문단별 댓글 작성, inline 수정 요청, 1차 승인 및 승인 취소를 수행하는 결재 전용 화면입니다.

## 2. Google Stitch Screen Metadata
- **Stitch Project ID**: `proj_claim_studio_v1`
- **Stitch Screen ID**: `screen_appr_01`
- **Stitch Official URL**: `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_appr_01`
- **Export Artifacts Path**: `docs/stitch/artifacts/APPR-01/screen.html`

## 3. 1440px 데스크톱 레이아웃 & 컴포넌트 슬롯
- **좌측 영역**: 검토 대기 장(Section) 리스트, 상태 배지
- **중앙 영역**: Inline Diff 변경 사항 비교 패널 (수정 전 vs 수정 후 초안)
- **우측 영역**: 문단별 댓글 작성 사이드바, [수정 요청] (Orange), [1차 승인] (Green) 버튼

## 4. 1024px 태블릿 축약 레이아웃
- Diff 비교와 댓글 사이드바가 탭 선택 뷰로 유연 전환.

## 5. 코너 케이스 6종 명세
- **로딩 상태 (Loading State)**: Diff 비교 데이터 불러오는 동안 중앙 패널 펄스 스켈레톤 비교 마스크 로더 표시.
- **빈 상태**: 검토 대기 항목이 없을 시 "대기 중인 검토 항목이 없습니다" 가이드.
- **오류 상태**: 승인 결재 실패 시 🔴 Rose Red Toast 메시지.
- **403 권한 없음**: 검토자가 본문 직접 수정 시도 시 "검토자는 직접 수정할 수 없으며 수정 요청만 가능합니다" 403 차단.
- **긴 콘텐츠 오버플로우**: 긴 댓글 텍스트 세로 스크롤바 가동.
- **접근성 및 키보드 탐색**: Tab 키로 결재 버튼 간 포커스 이동 지원.
