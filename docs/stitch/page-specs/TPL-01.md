# TPL-01: 양식 템플릿 관리 화면 명세서

## 1. 화면 개요 및 목적
제안서 및 보고서의 표준 템플릿 장 구조와 본문 블록을 관리하는 시스템 관리자 화면입니다.

## 2. Google Stitch Screen Metadata
- **Stitch Project ID**: `proj_claim_studio_v1`
- **Stitch Screen ID**: `screen_tpl_01`
- **Stitch Official URL**: `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_tpl_01`
- **Export Artifacts Path**: `docs/stitch/artifacts/TPL-01/screen.html`

## 3. 1440px 데스크톱 레이아웃 & 컴포넌트 슬롯
- **좌측 트리**: 템플릿 장 구조 drag-and-drop 트리
- **우측 영역**: 표준 블록 라이브러리 (헤더, 사실관계, 손해산출표, 법령인용)
- **액션**: [새 블록 추가], [템플릿 저장] 버튼

## 4. 1024px 태블릿 축약 레이아웃
- 2단 패널이 상하 수직으로 배치 전환.

## 5. 코너 케이스 6종 명세
- **로딩 상태 (Loading State)**: 템플릿 트리 수신 중 트리 영역 스켈레톤 라인 로더 표시.
- **빈 상태**: 템플릿 블록 미존재 시 블록 드래그 안내.
- **오류 상태**: 템플릿 수정이 기존에 이미 생성된 보고서를 훼손하려 할 시 변경 차단 팝업.
- **403 권한 없음**: 일반 사용자 템플릿 수정 시 HTTP 403 차단.
- **긴 콘텐츠 오버플로우**: 블록 내용 세로 스크롤바 가동.
- **접근성 및 키보드 탐색**: 트리 항목 키보드 방향키 이동 지원.
