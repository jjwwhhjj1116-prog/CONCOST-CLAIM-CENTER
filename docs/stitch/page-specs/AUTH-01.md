# AUTH-01: 로그인 화면 명세서

## 1. 화면 개요 및 목적
Enterprise SSO 및 로컬 이메일/비밀번호 인증을 처리하는 보안 관문 화면입니다.

## 2. Google Stitch Screen Metadata
- **Stitch Project ID**: `proj_claim_studio_v1`
- **Stitch Screen ID**: `screen_auth_01`
- **Stitch Official URL**: `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_auth_01`
- **Export Artifacts Path**: `docs/stitch/artifacts/AUTH-01/screen.html`

## 3. 1440px 데스크톱 레이아웃 & 컴포넌트 슬롯
- **중앙 카드 (480px)**: HSL Dark Glassmorphic Surface (`--glass-surface`, `--glass-blur: 16px`)
- **브랜드 헤더**: 스튜디오 로고, 시스템 타이틀 (Inter 24px Bold)
- **입력 슬롯**: 이메일 주소 입력창, 비밀번호 입력창 (마스크 토글 버튼 수록), 로그인 상태 유지 체크박스
- **액션 슬롯**: [SSO 로그인] (Primary Royal Blue `--primary-500`), [비밀번호 재설정] 링크

## 4. 1024px 태블릿 축약 레이아웃
- 카드 폭 420px로 유연 축소, 상하 패딩 32px 조율, 배경 그라데이션 광원 조절.

## 5. 비주얼 배지 & UI 인터랙션
- **인터랙션**: 호버 시 카드 Glow 효과 (`--primary-glow`), 버튼 클릭 시 150ms scale(0.98) 트랜지션.

## 6. 코너 케이스 6종 명세
- **로딩 상태 (Loading State)**: SSO 인증 진행 중 스피너 애니메이션 및 "안전하게 로그인 중입니다..." 스켈레톤 마스크 표시.
- **빈 상태**: 필수 필드 미입력 시 전송 버튼 비활성화.
- **오류 상태**: 인증 실패 시 로즈 레드 쉐이크 애니메이션 (`--status-danger`) 및 Toast 경고.
- **403 권한 없음**: 차단 계정 로그인 시 "접근이 거부되었습니다 (HTTP 403)" 모달 출력.
- **긴 콘텐츠 오버플로우**: 긴 이메일 주소 입력 시 text-ellipsis 및 마우스 호버 툴팁 출력.
- **접근성 및 키보드 탐색**: WCAG AA 명암비 15.2:1 준수, Tab 키 포커스 링 (2px Royal Blue) 활성화.
