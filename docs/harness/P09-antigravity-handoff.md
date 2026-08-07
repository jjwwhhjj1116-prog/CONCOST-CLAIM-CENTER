# P09 Antigravity 실행 지시서 (Interactive Report Generator & Auto Calculation Engine)

- **선행 단계**: P08 (Report Template Catalog & Approval System) `PASS`
- **시작 커밋**: PASS & P09 인계 커밋
- **목표 단계**: P09 (대화형 보고서 생성기 및 자동 산출/계산 엔진 구현)

---

## 1. P09 핵심 개발 요구사항

1. **대화형 보고서 작성 엔진 (Interactive Report Generator UI)**
   - P08에서 승인 활성화된 `ACTIVE` `ReportTemplateVersion`의 스냅샷 카탈로그를 기반으로 대화형 폼/위자드 UI를 구성합니다.
   - 각 블록 스키마 및 수식 규칙에 따라 동적으로 입력을 받아 보고서 섹션 본문을 구성합니다.

2. **자동 산출/계산 엔진 (Auto Calculation Engine)**
   - 클레임 보고서 전용 계산 로직(손해액 산정, 이자 계산, 비율 배분, 과실상계, 세액 및 공제액 계산 등)을 결정론적 순수 함수로 구현합니다.
   - 부동 소수점 오차 방지를 위해 정확한 정밀도(Decimal/BigNumber 패턴)를 보장합니다.

3. **증빙 문서 및 회의록 자동 연동 (Evidence & Transcript Binding)**
   - P06 자료(Material Documents) 및 회의록(Meeting Transcripts/Action Items)을 보고서 각 단락의 증빙 인용 표기(`[증거: DOCVER-xxx]`)로 바인딩합니다.

4. **실시간 검증 및 미입력 항목 추적**
   - 템플릿의 `requiredSections`, `requiredEvidenceRules` 조건 충족 여부를 실시간 검증하고, 미충족 시 사유를 명시합니다.

---

## 2. 엄격한 규칙 및 금지 사항

1. **가짜 JSON Mock 및 메모리 임시 저장 절대 금지**
   - 모든 보고서 생성본, 계산 결과, 증빙 바인딩은 Prisma/SQLite real DB에 영구 저장되어야 합니다.

2. **기존 P00~P08 품질 게이트 파괴 금지**
   - `pnpm install`, `pnpm db:reset`, `pnpm db:seed`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm test:security`, `pnpm audit` 11대 품질 게이트가 모두 PASS를 유지해야 합니다.

3. **원본 템플릿 Excel 및 32개 Reference Markdown 파일 보존**
   - 원본 하드웨어 자산 및 템플릿 문서를 절대로 수정하거나 훼손하지 마십시오.

---

## 3. P09 시작 방법

```bash
git checkout feat/P08-report-template-catalog
git checkout -b feat/P09-report-generator-calc-engine
```

위 안내서에 따라 P09 구현을 선행해 주시기 바랍니다.
