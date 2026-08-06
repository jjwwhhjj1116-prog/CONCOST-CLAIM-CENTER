# 구글 스티치 디자인 시스템 명세서 (Stitch Design System)

## 1. 개요 및 디자인 철학
**클레임 케이스 허브 & AI 보고서 스튜디오**는 대시보드 10초 인지 원칙과 프리미엄 AI 어시스턴트 감성을 전달하기 위해 **Google Stitch** 기반 디자인 시스템을 채택합니다.
단순 기본 형태를 지양하며, 세련된 HSL 다크 모드, Glassmorphism 반투명 레이어, 미세 동적 애니메이션(Micro-animations)을 조합하여 직관적이고 완성도 높은 인터페이스를 구축합니다.

## 2. 디자인 토큰 및 HSL 컬러 파렛트 (Design Tokens)

### 2.1 메인 브랜드 파렛트 (Slate Dark Theme)
```css
:root {
  /* Backgrounds */
  --bg-dark-primary: hsl(222, 47%, 11%);    /* #0f172a - 메인 어두운 배경 */
  --bg-dark-secondary: hsl(217, 33%, 17%);  /* #1e293b - 카운터/패널 배경 */
  --bg-dark-tertiary: hsl(215, 25%, 27%);   /* #334155 - 입력창/보조 배경 */

  /* Glassmorphism Surface */
  --glass-surface: hsla(217, 33%, 17%, 0.75);
  --glass-border: hsla(215, 20%, 65%, 0.15);
  --glass-blur: blur(16px);

  /* Primary Accent (Navy / Royal Blue) */
  --primary-500: hsl(217, 91%, 60%);        /* #3b82f6 - 주 액션 버튼 */
  --primary-600: hsl(221, 83%, 53%);        /* #2563eb - 호버 상태 */
  --primary-glow: hsla(217, 91%, 60%, 0.25);

  /* AI Specialty Accent (Purple / Violet Gradient) */
  --ai-accent: hsl(270, 91%, 65%);          /* #a855f7 - AI 전용 브랜드 */
  --ai-gradient: linear-gradient(135deg, hsl(270, 91%, 65%) 0%, hsl(217, 91%, 60%) 100%);
  --ai-glow: hsla(270, 91%, 65%, 0.3);

  /* Semantic Status Colors (다중 인지 보장) */
  --status-draft: hsl(215, 16%, 47%);       /* 미작성/작성중 - 슬레이트 */
  --status-ai-draft: hsl(270, 91%, 65%);    /* AI 초안 - 파퍼 */
  --status-review: hsl(38, 92%, 50%);       /* 담당자검토/수정요청 - 앰버 */
  --status-approved: hsl(142, 71%, 45%);    /* 승인 - 에메랄드 그린 */
  --status-danger: hsl(346, 87%, 60%);      /* 경고/종결차단 - 로즈 */

  /* Typography Colors */
  --text-primary: hsl(210, 40%, 98%);       /* #f8fafc - 메인 텍스트 */
  --text-secondary: hsl(215, 20%, 65%);     /* #94a3b8 - 보조 텍스트 */
  --text-muted: hsl(215, 16%, 47%);         /* #64748b - 비활성/각주 */

  /* Shadows */
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.2);
  --shadow-lg: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.4);
  --shadow-glow: 0 0 20px var(--primary-glow);
}
```

## 3. 타이포그래피 (Typography)
- **Primary Font**: `'Inter'`, `-apple-system`, `BlinkMacSystemFont`, `'Pretendard'`, sans-serif (Google Fonts 연동)
- **Code / Monospace Font**: `'Fira Code'`, `'JetBrains Mono'`, monospace

### 폰트 스케일 규격
- **Display 1 (메인 대시보드 타이틀)**: 32px / Bold (700) / Line-height 1.2
- **Heading 1 (화면 헤더)**: 24px / SemiBold (600) / Line-height 1.3
- **Heading 2 (섹션 타이틀)**: 18px / SemiBold (600) / Line-height 1.4
- **Body Large (보고서 본문)**: 15px / Regular (400) / Line-height 1.6
- **Body Medium (기본 UI 텍스트)**: 14px / Regular (400) / Line-height 1.5
- **Caption / Badge (상태 배지)**: 12px / Medium (500) / Letter-spacing 0.5px

## 4. UI 컴포넌트 가이드라인

### 4.1 버튼 시스템 (Buttons)
- **Primary Button**: Royal Blue 배경 (`--primary-500`), subtle glow hover 효과, scale(1.02) 트랜지션.
- **AI Assist Button**: Purple-Blue 사선 그라데이션, Sparkling Stars 아이콘 수록, hover 시 `--ai-glow` 확산.
- **Secondary Button**: Translucent glass border (`--glass-border`), background hover 효과.
- **Danger Button**: Crimson red (`--status-danger`), 삭제 및 승인 취소 확정 시 사용.

### 4.2 다중 시각화 상태 배지 (Multi-visual Badges)
상태는 색상뿐 아니라 **텍스트 + 전용 아이콘**을 반드시 조합하여 10초 이내에 시각적 오인을 방지합니다.
- `[미작성]`: ⚪ Gray Badge + Circle Icon
- `[작성 중]`: 🔵 Slate Badge + Edit Icon
- `[AI 초안]`: 🟣 Violet Gradient Badge + Sparkles Icon
- `[담당자 검토]`: 🟡 Amber Badge + Eye Icon
- `[수정 요청]`: 🟠 Orange Badge + AlertTriangle Icon
- `[승인]`: 🟢 Emerald Green Badge + CheckCircle Icon
- `[최종 확정]`: 💎 Cyan Lock Badge + Lock Icon

### 4.3 마이크로 애니메이션 (Micro-animations)
- **Hover Transition**: `transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);`
- **Modal Pop-in**: `transform: scale(0.95) -> scale(1)`, `opacity: 0 -> 1` (150ms)
- **AI Generation Loading**: Glowing Border Pulse & Wave Skeleton (1.5s infinite pulse)

## 5. 반응형 브레이크포인트 시스템 (Responsive Grid)
- **Desktop Grid (1440px 이상)**: 12 컬럼 레이아웃, 좌측 260px 고정 메뉴, 중앙 3단 스튜디오 패널.
- **Tablet / Laptop Grid (1024px ~ 1439px)**: 2단 접이식 축약 레이아웃, 우측 AI 패널 슬라이드 오버(Drawer) 전환.
- **Mobile Notice**: 시스템 특성상 1024px 미만 접속 시 "태블릿 이상의 큰 화면 사용 권장" 안내 메세지 제공.
