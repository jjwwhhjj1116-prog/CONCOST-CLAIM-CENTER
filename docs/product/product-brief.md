# 제품 개요 및 감사/Provenance 계약 명세서 (Product Brief)

## 1. 프로젝트 비전 및 목적
**클레임 케이스 허브 및 AI 보고서 스튜디오 (Claim Center Report Studio)**는 복잡한 건설·손해배상·재해보상 클레임 사건의 전체 생애주기를 체계적으로 관리하고, 수집된 사건 근거 자료를 기반으로 제안서, 회의록, 법원 제출용 손해분석 보고서를 장(Section)별로 안전하게 작성·검토·승인·출력하는 업무 통합 플랫폼입니다.

## 2. 클레임 6대 고정 업무 프로세스 유형 (Single Source of Truth)
모든 사건 생성, 대시보드 KPI 집계, 템플릿 분류 및 보고서 스튜디오는 아래 6대 고정 유형 ID만을 사용합니다.
- `TYPE-01`: 현장조사 및 수량산출이 필요한 클레임(하자, 기시공, 미시공 등)
- `TYPE-02`: 분석 보고서 작성 클레임(감정보완 신청서, 항소에 대한 반박, 공사비 적정성 검토 등)
- `TYPE-03`: 일반적인 클레임
- `TYPE-04`: 재건축·재개발 공사비 협상
- `TYPE-05`: 사감정보고서
- `TYPE-06`: 물가변동

## 3. 핵심 해결 과제
1. **파편화된 사건 자료 통합 관리**: 사건별 관계자, 다중 D-day 기일, 증거 문서, 회의록을 단일 통합 허브에서 중앙 관리.
2. **근거 기반 문서 작성 자동화**: AI가 환각(Hallucination)으로 근거 없는 숫자, 날짜, 당사자명, 계약금액을 임의 작성하는 위험을 원천 차단하고 선택된 증거 자료(Source Reference 및 GenerationSource)만을 기반으로 초안 작성.
3. **엄격한 검토 및 승인 워크플로우**: 보고서를 한 번에 통째로 생성하지 않고 장(Section) 단위로 작성·수정 요청·승인하여, 사람(검토자/대표)의 확정 승인을 거친 장만 최종 DOCX/PDF로 병합 출력.
4. **투명한 감사 및 비용 관리**: 정산 성공보수 계산, 변경 이력 Append-only 감사로그, AI 모델별 토큰 비용 예측 및 소비 제한.

## 4. 33개 핵심 데이터 엔터티 카탈로그 (Complete 33 Entities)
지시서 7절에 명시된 33개 시스템 엔터티 전체입니다.
```text
1. User (사용자 계정)
2. Role (사용자 역할)
3. Permission (세부 기능 권한)
4. Case (클레임 사건)
5. CaseCategory (사건 대/중/소 분류)
6. CaseParty (사건 당사자 매핑)
7. Party (외부 당사자 신원)
8. Deadline (사건 기일 및 D-day)
9. Activity (사건 타임라인 활동 이력)
10. Document (사건 증거/첨부 문서)
11. DocumentVersion (문서 버전 이력)
12. Meeting (회의록)
13. MeetingActionItem (회의 할 일 항목)
14. Proposal (제안서)
15. ProposalVersion (제안서 버전)
16. Report (손해분석 보고서)
17. ReportSection (보고서 장)
18. ReportSectionVersion (보고서 장 버전)
19. Template (문서 템플릿)
20. TemplateSection (템플릿 장 구조)
21. TemplateBlock (템플릿 표준 본문 블록)
22. ApprovalRequest (검토 및 승인 요청)
23. ApprovalDecision (승인/수정요청 결정)
24. Contract (계약 정보)
25. SuccessFee (성공보수 정산)
26. AIProvider (AI 공급자 연동 설정)
27. AIModel (AI 모델 정보)
28. AIPolicy (AI 사용 및 보안 정책)
29. GenerationRun (AI 생성 실행 기록)
30. GenerationSource (AI 생성 시 참조된 증거/청크 출처 매핑)
31. SourceReference (문단별 근거자료 매핑)
32. AuditLog (Append-only 시스템 감사로그)
33. Notification (기일/검토/승인 알림)
```

## 5. 공통 데이터 감사 필드 계약 (Common Audit Fields Contract)
모든 주요 데이터베이스 엔터티는 데이터 변경 추적성과 책임 소재 명시를 위해 다음 공통 감사 필드를 반드시 포함해야 합니다.

```text
- id: UUID / String (기본 키)
- createdBy: String (생성자 사용자 ID)
- updatedBy: String (최종 수정자 사용자 ID)
- createdAt: DateTime (생성 일시, UTC ISO-8601)
- updatedAt: DateTime (수정 일시, UTC ISO-8601)
- deletedAt: DateTime | Null (소프트 삭제 일시, Null인 경우 활성)
- isDeleted: Boolean (소프트 삭제 여부, 기본값 false)
- version: Int (낙관적 잠금을 위한 데이터 버전 번호)
```

## 6. AI 생성 Provenance 계약 (AI Provenance Contract)
AI 비서가 생성한 모든 결과물(`GenerationRun`, `ReportSectionVersion`, `ProposalVersion` 등)은 생성 출처와 추적성을 보장하기 위해 다음 AI Provenance 메타데이터를 필수 보존해야 합니다.

```text
- runId: UUID (생성 실행 고유 ID)
- caseId: String (관련 사건 ID)
- documentType: Enum (PROPOSAL | REPORT | MINUTES)
- sectionId: String | Null (관련 장 ID)
- providerId: String (AI 공급자 ID: ollama | openai | anthropic | gemini | deepseek)
- modelId: String (사용한 AI 모델명: e.g. gpt-4o, claude-3-5-sonnet)
- systemPolicyVersion: String (적용된 시스템 프롬프트 및 금지 표현 정책 버전)
- templateVersion: String (적용된 문서 템플릿 버전)
- selectedSourceIds: String[] (사용자가 명시적으로 선택한 참조 증거 문서 ID 목록)
- generationSources: GenerationSource[] (실제 프롬프트에 포함된 청크 및 메타데이터 출처 목록)
- userInstruction: String (사용자 추가 지시문)
- promptHash: String (입력 프롬프트의 SHA-256 해시)
- sourceReferences: SourceReference[] (문단별 근거자료 매핑)
- verificationFlags: Array<{ type: string, paragraphIndex: number, flag: string }> ([확인 필요], [숫자 검증 필요] 등)
- inputTokens: Int (입력 토큰 수)
- outputTokens: Int (출력 토큰 수)
- estimatedCost: Float (추정 사용 비용 USD/KRW)
- createdBy: String (생성 요청자 사용자 ID)
- createdAt: DateTime (생성 일시)
```
