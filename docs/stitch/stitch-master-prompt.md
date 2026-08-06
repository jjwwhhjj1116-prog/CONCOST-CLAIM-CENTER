# 구글 스티치 마스터 프롬프트 명세서 (Stitch Master Prompt)

## 1. 개요 및 마스터 스타일 가이드
본 지침은 Google Stitch AI 플랫폼에서 **클레임 케이스 허브 및 AI 보고서 스튜디오**의 20개 화면 mock-up 및 변형(Variants)을 일관되게 생성하기 위한 최상위 마스터 프롬프트 체계입니다.

## 2. 6대 클레임 고정 업무 프로세스 유형 (Single Source of Truth)
모든 화면 생성 프롬프트 및 UI 분류는 아래 6대 고정 클레임 유형 ID를 엄격히 준수합니다.
- `TYPE-01`: 현장조사 및 수량산출이 필요한 클레임(하자, 기시공, 미시공 등)
- `TYPE-02`: 분석 보고서 작성 클레임(감정보완 신청서, 항소에 대한 반박, 공사비 적정성 검토 등)
- `TYPE-03`: 일반적인 클레임
- `TYPE-04`: 재건축·재개발 공사비 협상
- `TYPE-05`: 사감정보고서
- `TYPE-06`: 물가변동

`docs/보고서 템플릿/`의 9개 하위 폴더는 **업무 유형이 아니라 레퍼런스 템플릿 묶음**입니다. 화면 분류값으로 폴더명을 사용하거나 7번째 업무 유형으로 승격하지 않으며, 템플릿 연결은 P01의 `primaryType` 1개와 `secondaryTypes` 배열을 통한 논리 참조만 사용합니다.

## 3. 공통 마스터 프롬프트 접두사 (System Master Prompt Prefix)
Stitch AI에 전달되는 모든 화면 프롬프트는 아래 공통 마스터 설정을 전제로 합니다.

```text
[SYSTEM MASTER PROMPT]
Act as a Principal Enterprise UI/UX Designer for "Claim Center Report Studio".
Generate high-fidelity web app interfaces matching the following system design specifications:
- Theme: Slate Dark Theme (Primary Background hsl(222, 47%, 11%), Card Surface hsla(217, 33%, 17%, 0.75) Glassmorphism with 16px blur).
- Color Palette: Primary Royal Blue (hsl(217, 91%, 60%)), AI Assist Purple (hsl(270, 91%, 65%)), Emerald Approved Green (hsl(142, 71%, 45%)), Amber Warning (hsl(38, 92%, 50%)), Rose Red Danger (hsl(346, 87%, 60%)).
- Typography: Inter font, high contrast text (hsl(210, 40%, 98%)).
- Micro-animations: Smooth hover transitions, 150ms modal pop-ins, glowing loading skeleton for AI tasks.
- Navigation: Left 260px fixed sidebar with easy middle-school Korean menu names.
- Accessibility: Minimum 4.5:1 WCAG AA contrast ratio, clear keyboard focus rings, and explicit empty/error/403 states.
```

## 4. 화면 생성 및 변형(Variants) 제어 규칙
1. **Primary Screen Generation**: 기본 데스크톱 (1440px) 뷰포트 기반으로 메인 화면 생성.
2. **State Variants Generation**: 각 화면당 정상(Normal), 빈 상태(Empty), 오류(Error), 403 권한 없음(Forbidden), 긴 콘텐츠 오버플로우(Overflow) 5가지 파생 변형 생성.
3. **Responsive Variant**: 1024px 태블릿 축약 슬라이드 오버 뷰포트 변형 생성.
