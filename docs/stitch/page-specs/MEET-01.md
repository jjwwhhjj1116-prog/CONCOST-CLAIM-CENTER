# MEET-01: 회의록 관리 화면 명세서

## 1. 화면 개요 및 목적
회의 텍스트 원본 보존, AI 요약 실행 및 결정사항/할 일(Action Item)을 담당자 업무 큐에 즉시 연동하는 화면입니다.

## 2. Google Stitch Screen Metadata
- **Stitch Project ID**: `proj_claim_studio_v1`
- **Stitch Screen ID**: `screen_meet_01`
- **Stitch Official URL**: `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_meet_01`
- **Export Artifacts Path**: `docs/stitch/artifacts/MEET-01/screen.html`

## 3. 1440px 데스크톱 레이아웃 & 컴포넌트 슬롯
- **좌측 영역**: 회의 원본 텍스트 에디터, [AI 요약 및 추출] 그라데이션 버튼
- **우측 영역**: AI 추출 회의 요약 카드, 주요 결정사항 리스트, 할 일 담당자 배정 테이블

## 4. 1024px 태블릿 축약 레이아웃
- 좌우 2단 패널이 상하 수직 배치로 유연 전환.

## 5. 코너 케이스 6종 명세
- **로딩 상태 (Loading State)**: AI 분석 수행 시 우측 요약 패널에 보라색 스파클링 펄스 스켈레톤 표시.
- **빈 상태**: 회의록 텍스트 미입력 시 [AI 요약] 버튼 비활성화.
- **오류 상태**: AI Gateway 서비스 장애 시 로즈 레드 메시지 출력.
- **403 권한 없음**: 타 사건 회의록 수정 시 HTTP 403 차단.
- **긴 콘텐츠 오버플로우**: 긴 회의록 원본은 에디터 내부 스크롤바 처리.
- **접근성 및 키보드 탐색**: 스크린리더 aria-live 로 요약 완료 상태 읽기 지원.
