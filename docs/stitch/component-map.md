# 구글 스티치 UI 컴포넌트 매핑 명세서 (Component Map)

## 1. 개요
본 명세서는 Google Stitch 디자인 시스템과 애플리케이션 프론트엔드 UI 컴포넌트 간의 1:1 매핑 카탈로그입니다.

## 2. 핵심 UI 컴포넌트 매핑 표

| 컴포넌트 ID | 스티치 컴포넌트명 | 디자인 토큰 바인딩 | 주요 용도 및 역할 |
| :--- | :--- | :--- | :--- |
| `COMP-BTN-PRI` | PrimaryButton | `--primary-500`, `--primary-glow` | 주요 저장, 승인, 등록 버튼 |
| `COMP-BTN-AI` | AIAssistButton | `--ai-accent`, `--ai-gradient` | AI 초안 생성, 요약 버튼 |
| `COMP-BTN-SEC` | SecondaryButton | `--glass-border`, `--bg-dark-tertiary` | 취소, 닫기, 보조 버튼 |
| `COMP-BDG-STAT` | StatusBadge | `--status-*` | 7대 표준 장 상태 및 12대 사건 상태 배지 |
| `COMP-CARD-KPI` | KPICard | `--glass-surface`, `--glass-blur` | 대시보드 6대 질문 핵심 수치 카운터 |
| `COMP-STUDIO-OUT`| StudioOutlineTree | `--bg-dark-secondary` | 보고서 스튜디오 260px 좌측 목차 패널 |
| `COMP-STUDIO-EDT`| StudioRichEditor | `--bg-dark-primary`, `--text-primary` | 중앙 문단별 리치 에디터 |
| `COMP-STUDIO-PAN`| StudioAIPanel | `--glass-surface`, `--ai-glow` | 우측 320px 증거 선택 & AI 제어 패널 |
| `COMP-MODAL-STEP`| StepperModal | `--glass-surface`, `--shadow-lg` | 단계형 입력 모달 (새 사건 등록) |
| `COMP-DIFF-VIEW` | InlineDiffViewer | `--status-approved`, `--status-danger`| 검토 승인함 변경 사항 비교 패널 |
