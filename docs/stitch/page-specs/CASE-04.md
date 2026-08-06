# CASE-04: 사건 상세 일정 및 기일 화면 명세서

## 1. 화면 개요 및 목적
법원 제출기일, 현장 감정일 등 다중 D-day 일정을 관리하고 자동 알림을 발송하는 일정 화면입니다.

## 2. Google Stitch Screen Metadata
- **Stitch Project ID**: `proj_claim_studio_v1`
- **Stitch Screen ID**: `screen_case_04`
- **Stitch Official URL**: `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_case_04`
- **Export Artifacts Path**: `docs/stitch/artifacts/CASE-04/screen.html`

## 3. 1440px 데스크톱 레이아웃 & 컴포넌트 슬롯
- **상단 헤더**: [+ 새 기일 등록] 버튼, 자동 알림 (Notification) 토글 스위치
- **기일 리스트 슬롯**: D-day 계산기 배지 (🔴 D-3, 🟠 D-7), 기일명, 일시, 법원/장소, 담당자
- **알림 설정**: 이메일/앱 알림 수신자 체크박스

## 4. 1024px 태블릿 축약 레이아웃
- 타임라인 카드가 타일 형태에서 컴팩트 수직 카드 리스트로 전환됨.

## 5. 비주얼 배지 & UI 인터랙션
- **D-day 배지**: 마감 3일 이내 🔴 Rose Red, 7일 이내 🟠 Amber, 일반 🔵 Slate.

## 6. 코너 케이스 6종 명세
- **로딩 상태 (Loading State)**: 일정 데이터 조회 시 타임라인 스켈레톤 애니메이션 표시.
- **빈 상태**: "등록된 기일이 없습니다" 안내 및 기일 등록 파랑 버튼.
- **오류 상태**: 날짜 포맷 유효성 실패 시 붉은 텍스트 메시지 표시.
- **403 권한 없음**: 수정 권한 없는 자의 기일 변경 시도 시 403 인터셉트.
- **긴 콘텐츠 오버플로우**: 장소/기일 비고가 길 시 말줄임표 및 툴팁.
- **접근성 및 키보드 탐색**: Tab 키로 기일 항목 순회, Space 키로 알림 토글 조작.
