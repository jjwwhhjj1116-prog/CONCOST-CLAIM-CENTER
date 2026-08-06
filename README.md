# 클레임 케이스 허브 및 AI 보고서 스튜디오 (Claim Center Report Studio)

## 프로젝트 개요
본 프로젝트는 클레임 사건을 관리하고, 사건 자료를 근거로 제안서·회의록·법원 제출용 보고서를 장별로 작성·검토·승인·출력하는 업무 플랫폼입니다.

- **작업 루트**: `E:\■ 개발_TF팀\클레임센터 보고서 스튜디오\`
- **UX/UI 설계 도구**: Google Stitch
- **구현 실행자**: Google Antigravity
- **독립 검수자**: Codex

## 모노레포 폴더 구조
```text
claim-center-report-studio/
  apps/
    web/                   # React 18 + Vite Web 프론트엔드
    api/                   # P04에서 구현할 Node.js API 경계
  packages/
    ui/                    # 공통 디자인 시스템 UI 컴포넌트
    domain/                # 핵심 데이터 모델 및 비즈니스 로직
    database/              # Prisma / PostgreSQL 스키마 및 DB 어댑터
    ai-gateway/            # AI 공급자 멀티 어댑터 (Local, OpenAI, Anthropic, Gemini, DeepSeek)
    document-engine/       # DOCX / PDF 보고서 생성 엔진
    google-workspace/      # Google Drive / Calendar / Gmail 연동 어댑터
    test-fixtures/         # 개발 및 테스트용 가상 데이터 픽스처
  docs/
    product/               # 제품 기획, 요구사항, 페르소나, 권한 매트릭스
    architecture/          # 아키텍처 설계 문서
    adr/                   # 기술/제품 결정 기록 (ADR)
    harness/               # 품질 하네스 및 단계별 상태 관리
    reviews/               # Codex 검수 요청 및 검수 리포트
    stitch/                # Google Stitch 마스터 프롬프트 및 정규화 명세
  artifacts/
    harness/               # 단계별 하네스 증거 패키지
  scripts/                 # 관리 및 CI/하네스 검증 스크립트
```

## 개발 및 품질 게이트 명령
```powershell
# pnpm 9.15.0 고정 실행
npx --yes pnpm@9.15.0 install --frozen-lockfile
npx --yes pnpm@9.15.0 lint
npx --yes pnpm@9.15.0 typecheck
npx --yes pnpm@9.15.0 test
npx --yes pnpm@9.15.0 build
npx --yes pnpm@9.15.0 test:e2e
npx --yes pnpm@9.15.0 audit --audit-level high

# 로컬 개발 서버 (http://localhost:3000)
npx --yes pnpm@9.15.0 --filter claim-center-report-studio-web dev
```

`test:e2e`는 production Vite 빌드를 로컬 preview 서버로 띄운 뒤 설치된 Chrome/Edge를 headless로 실행한다. 비표준 설치 위치에서는 `CHROME_PATH`로 브라우저 실행 파일을 지정한다.

## 단계 진행 상태
현재 상태는 `docs/harness/phase-status.json`에서 확인 및 관리됩니다.
