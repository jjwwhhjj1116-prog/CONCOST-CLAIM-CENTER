# 보고서 작성 플랫폼 벤치마크 메모

## 적용할 제품 패턴

1. **CoCounsel Legal — Intake → Gather → Analyze → Finalize**
   - 사건 입력을 먼저 구조화하고, 신뢰 자료를 모은 뒤, 쟁점 분석과 장별 초안을 거쳐 승인 가능한 결과로 만듭니다.
   - 템플릿·플레이북을 기준으로 초안을 검토하고 변경을 사람이 승인하는 방식을 채택합니다.
   - 참고: https://legal.thomsonreuters.com/en/legal/draft-review-analysis-corp

2. **Harvey — Matter workspace, visible reasoning, source-linked drafting**
   - 사건 단위 작업공간에 자료와 작업 이력을 유지하고, 결과 문장과 근거 위치를 연결합니다.
   - 초안을 한 번에 생성하는 블랙박스가 아니라 작업 단계와 인용 근거를 검토자가 추적하게 합니다.
   - 참고: https://www.harvey.ai/blog/how-we-approach-design-at-harvey

3. **Hebbia Matrix — 문서 × 질문 매트릭스**
   - 많은 자료를 하나의 긴 프롬프트에 넣지 않고, 자료별·쟁점별 분석 셀로 분해하고 각 결과를 원문 인용에 연결합니다.
   - 클레임센터에서는 `근거 자료 × 보고서 장 × 쟁점` 매트릭스로 적용합니다.
   - 참고: https://www.hebbia.com/blog/5-ways-equity-research-teams-use-hebbia-to-drive-speed-and-insight

4. **Procore — 공통 프로젝트 데이터와 360 Reporting**
   - 현장·일정·인력·비용 데이터를 프로젝트 공통 원장에 모은 뒤 보고서와 대시보드에서 재사용합니다.
   - 클레임센터에서는 워크플로우 1~5단계 데이터를 보고서 입력 스냅샷으로 연결합니다.
   - 참고: https://www.procore.com/platform

## 클레임센터의 차별점

- 6대 클레임 유형과 9개 레퍼런스 템플릿 묶음을 논리 연결합니다.
- 제안서·수주·착수회의·현장조사·수량산출 데이터가 보고서 장의 직접 입력이 됩니다.
- 장별 전담 에이전트와 별도의 근거·수치 검수 에이전트를 둡니다.
- 근거가 없는 문장은 길게 생성하지 않고 `[확인 필요]` 상태로 남깁니다.
- 장 승인 전에는 최종 병합·납품을 차단합니다.

