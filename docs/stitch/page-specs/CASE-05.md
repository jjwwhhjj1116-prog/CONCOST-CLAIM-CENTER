# CASE-05: 사건 상세 관계자 화면 명세서

## 1. 화면 개요 및 목적
원고, 피고, 참고인 등 사건 외부 관계자 신원 정보 및 연락처를 관리하는 화면입니다.

## 2. Google Stitch Screen Metadata
- **Stitch Project ID**: `proj_claim_studio_v1`
- **Stitch Screen ID**: `screen_case_05`
- **Stitch Official URL**: `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_case_05`
- **Export Artifacts Path**: `docs/stitch/artifacts/CASE-05/screen.html`

## 3. 1440px 데스크톱 레이아웃 & 컴포넌트 슬롯
- **3열 카드 레이아웃**: 1열 (원고 그룹), 2열 (피고 그룹), 3열 (참고인/감정인 그룹)
- **관계자 카드 슬롯**: 성명, 소속, 직함, 연락처, 이메일, 담당 변호사명, [수정]/[삭제] 버튼
- **상단 액션**: [+ 관계자 추가] 버튼

## 4. 1024px 태블릿 축약 레이아웃
- 3열 그리드가 탭(원고/피고/참고인) 선택 형태의 단일 열 카드로 전환됨.

## 5. 비주얼 배지 & UI 인터랙션
- **배지**: 원고 🔵 Blue, 피고 🔴 Red, 참고인 🟢 Green 역할 구분 배지.

## 6. 코너 케이스 6종 명세
- **로딩 상태 (Loading State)**: 관계자 카드 로딩 시 3열 인물 스켈레톤 타일 표시.
- **빈 상태**: 특정 당사자 그룹 미등록 시 "원고 정보를 추가하세요" 스마트 가이드.
- **오류 상태**: 연락처 유효성 검사 실패 시 입력창 경고 표시.
- **403 권한 없음**: 외부 검토자의 관계자 신원 수정 시도 시 HTTP 403 차단.
- **긴 콘텐츠 오버플로우**: 긴 소속 회사명 입력 시 말줄임표 및 툴팁.
- **접근성 및 키보드 탐색**: 카드 간 Tab 키 포커스 이동 지원.
