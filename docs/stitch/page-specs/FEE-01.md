# FEE-01: 성공보수 정산 화면 명세서

## 1. 화면 개요 및 목적
계약 조건에 따른 산출액 정산, 성공보수 요율 계산 및 미수 수금 상태를 관리하는 재무 화면입니다.

## 2. Google Stitch Screen Metadata
- **Stitch Project ID**: `proj_claim_studio_v1`
- **Stitch Screen ID**: `screen_fee_01`
- **Stitch Official URL**: `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_fee_01`
- **Export Artifacts Path**: `docs/stitch/artifacts/FEE-01/screen.html`

## 3. 1440px 데스크톱 레이아웃 & 컴포넌트 슬롯
- **상단 요약**: 기본 수임료, 성공보수 요율(%), 총 청구액, 수금 완료액, 미수금액 카운터
- **정산 위젯**: 자동 요율 산출 계산기, 청구일/입금일 지정 폼
- **하단 테이블**: 수금 이력 및 미수 경고 목록

## 4. 1024px 태블릿 축약 레이아웃
- 수금 요약 카드가 2열 그리드로 전환됨.

## 5. 코너 케이스 6종 명세
- **로딩 상태 (Loading State)**: 성공보수 계산 중 카운터 영역 스켈레톤 로더 및 계산 중 스피너 표시.
- **빈 상태**: 수금 정산 이력이 없을 시 "정산 내역을 작성하세요" 안내.
- **오류 상태**: 미수금이 남아있는 상태에서 사건 종결 처리 시도 시 시스템 미수 경고 모달 출력 및 종결 차단.
- **403 권한 없음**: 실무자의 성공보수 금액 수정 시도 시 HTTP 403 차단.
- **긴 콘텐츠 오버플로우**: 대형 금액 수치 표기 시 쉼표 천단위 포맷 및 툴팁.
- **접근성 및 키보드 탐색**: 입력 폼 키보드 포커스 링 표시.
