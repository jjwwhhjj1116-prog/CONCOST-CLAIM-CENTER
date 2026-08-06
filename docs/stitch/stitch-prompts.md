# 구글 스티치 화면 생성 프롬프트 명세서 (Stitch Screen Prompts)

## 1. 개요
본 문서는 Google Stitch AI 플랫폼에서 20개 필수 화면의 UI/UX 디자인 mock-up을 프롬프트 기반으로 즉시 생성하고 변형(Variants)을 생성하기 위한 최적의 프롬프트 카탈로그입니다.

## 2. 20개 필수 화면별 Google Stitch 프롬프트 카탈로그 (20 Screens Prompts)

### 01. AUTH-01: 로그인 화면
- **Prompt**:
  ```text
  Create a modern enterprise login interface for "Claim Center Report Studio". Slate dark background (hsl 222 47% 11%) with a glassmorphism central card. Include company logo, email input, password input with toggle visibility, "Keep me logged in" checkbox, and a prominent primary action button "Login with SSO". Subtle purple-blue gradient glow in the background. Clean Inter typography.
  ```

### 02. DASH-01: 메인 대시보드
- **Prompt**:
  ```text
  Design a high-density executive dashboard for claim center management. Top search bar with global filter. 6 KPI summary cards with glowing HSL badges (Active Cases, Due Today, Delayed Tasks, Pending Reviews, Approved Reports, Unpaid Fees). Timeline widget for upcoming deadlines (D-day). Case distribution bar chart. Interactive task queue table for logged-in user. Dark slate glassmorphism layout.
  ```

### 03. CASE-01: 사건 목록
- **Prompt**:
  ```text
  Design a data table view for insurance claim cases. Filter bar with search, case category tree dropdown (Construction/Defect/Underground Crack), and status pills. Table columns: Case Code, Case Title, Category, Assignee, D-day Badge, Section Status Summary, and Actions. Include pagination and a top right "+ New Case" primary button. Dark theme.
  ```

### 04. CASE-02: 새 사건 등록
- **Prompt**:
  ```text
  Design a multi-step modal form for creating a new claim case. Step 1: Basic Info (Case Name, Code). Step 2: 3-tier Category Selection (Large/Medium/Small cascading dropdowns). Step 3: Initial Assignee & Client Info. Include clear progress stepper header, required field indicators, cancel button, and "Create Case" glowing button.
  ```

### 05. CASE-03: 사건 상세 - 개요
- **Prompt**:
  ```text
  Design a case detail overview page with horizontal tab navigation (13 tabs). Left side: Case metadata card (Code, Status, Category, Created Date, Assignee). Center: Activity timeline stream with system audit log entries. Right side: Quick stats widget and quick actions (+ Upload Doc, + Write Report). Slate dark styling.
  ```

### 06. CASE-04: 사건 상세 - 일정 및 기일
- **Prompt**:
  ```text
  Design a calendar and D-day timeline view for case deadlines. List of court submission dates, site inspection dates, and client response targets. Color-coded D-day badges (Red for D-3, Orange for D-7, Slate for normal). "+ Add Deadline" button and toggle for automatic email/in-app notification alerts.
  ```

### 07. CASE-05: 사건 상세 - 관계자
- **Prompt**:
  ```text
  Design a stakeholder management list for a legal claim case. Grouped cards into Plaintiff (원고), Defendant (피고), and Third-party Witnesses. Show contact details, role, organization, and action buttons (Edit, Call, Email). Dark card UI with subtle border dividers.
  ```

### 08. CASE-06: 사건 상세 - 자료실
- **Prompt**:
  ```text
  Design a file repository interface for claim evidence documents. Drag-and-drop upload zone at top. File list with version tags (v01, v02), file type icons (PDF, DOCX, XLSX, JPG), standardized naming compliance badges, upload timestamp, and preview/download action buttons.
  ```

### 09. MEET-01: 회의록 관리
- **Prompt**:
  ```text
  Design a meeting minutes workspace. Left side: Raw audio transcript or text input area with an "AI Summarize" gradient button. Right side: Extracted AI summary card, Key Decisions list, and Action Items table with assignee selector and sync to task queue toggle.
  ```

### 10. PROP-01: 제안서 템플릿 선택
- **Prompt**:
  ```text
  Design a template selector grid for proposal creation. Grid of template cards (Standard Claim Proposal, Loss Analysis Proposal, Short Estimate). Show template thumbnail, section count, tag badges, and "Use Template" hover button. Search and category filter bar at top.
  ```

### 11. PROP-02: 제안서 단계형 작성기
- **Prompt**:
  ```text
  Design a wizard-style proposal generator. Top step progress bar. Form inputs for case data auto-substitution. Missing field warnings highlighted with orange badges. Live side-by-side preview panel showing generated document. Export button disabled until all mandatory fields are approved.
  ```

### 12. REPO-01: 보고서 목록
- **Prompt**:
  ```text
  Design a list view of damage assessment reports. Cards or table showing Report Title, Related Case, Total Sections, Section Approval Progress Bar (e.g. 5/7 Sections Approved), Overall Status Badge, and "Open in Studio" primary button. Dark mode.
  ```

### 13. REPO-02: 보고서 스튜디오 (3단 구조)
- **Prompt**:
  ```text
  Design a 3-column Report Studio workspace for legal/loss reports. Left Column (260px): Section Outline Tree with 7 status badges (Unwritten, Writing, AI Draft, Review, Revision Requested, Approved, Finalized). Center Column (Flex): Rich text block editor with paragraph-level source links and floating AI inline assistant toolbar. Right Column (320px): Evidence Document Selector, AI Generation Controls with model dropdown, and Verification Flags panel ([Check Required], [Verify Number]). Slate dark glassmorphism theme.
  ```

### 14. APPR-01: 검토 및 승인함
- **Prompt**:
  ```text
  Design a reviewer dashboard for legal experts and department heads. List of pending section approval requests. Inline diff view showing proposed text vs previous draft. Inline commenting sidebar. Action buttons: "Request Revision" (Orange) and "Approve 1st Pass" (Green). Clear warning: "Reviewer cannot edit text directly".
  ```

### 15. FEE-01: 성공보수 정산
- **Prompt**:
  ```text
  Design a success fee and financial settlement dashboard. Contract summary card (Base Fee, Contingency Rate %, Total Damage Claim Amount). Interactive fee calculator widget. Payment tracking table (Billed Date, Received Date, Outstanding Balance). System alert modal warning when closing a case with unpaid fees.
  ```

### 16. TPL-01: 양식 템플릿 관리
- **Prompt**:
  ```text
  Design an administrative template builder page. Drag-and-drop section tree manager. Standard block library (Header, Fact Finding, Loss Calculation Table, Legal Citation, Sign-off Block). Version history tab and "+ Add Section Block" button.
  ```

### 17. AI-01: AI 공급자 및 비용 설정
- **Prompt**:
  ```text
  Design an AI Gateway configuration dashboard. Cards for connected providers (Ollama Local, OpenAI, Anthropic, Google Gemini, DeepSeek). Connection status badge (Connected/Disconnected), API key masked input with test connection button, model selector, and monthly cost cap limit slider per user.
  ```

### 18. USER-01: 사용자 및 권한 관리
- **Prompt**:
  ```text
  Design an RBAC user management table. Columns: User Name, Email, Organization/Center, Role (CEO, Director, PM, Staff, Reviewer, Admin), Active Status toggle, and Edit Permissions button. Include role permission matrix modal drawer.
  ```

### 19. AUD-01: 시스템 감사로그
- **Prompt**:
  ```text
  Design an immutable append-only audit log viewer. Table columns: Timestamp (UTC ISO), User, IP Address, Event Type (LOGIN, CASE_CREATE, SECTION_APPROVE, AI_GENERATE, 403_DENIED), Target Entity, and SHA-256 Hash. Filter by date range and severity level.
  ```

### 20. RESP-01: 태블릿 축약 화면 (1024px)
- **Prompt**:
  ```text
  Design a responsive 1024px tablet collapsed view of the 3-column Report Studio. Left sidebar auto-collapsed to icon bar with drawer expand. Center editor expands full width. Right AI assistant panel converted to a floating bottom drawer / side drawer overlay button. All core functionality retained without horizontal scroll.
  ```
