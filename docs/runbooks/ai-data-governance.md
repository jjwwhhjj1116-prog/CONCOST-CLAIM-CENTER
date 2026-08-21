# 외부 AI 자료 보안 운영 가이드

## 결론

클레임센터의 내부·기밀 원문을 **무료 Gemini API로 보내지 않는다**. 기본 정책은 `UNVERIFIED_OR_FREE`이며, 이 상태에서는 `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED` 자료의 AI 전송을 서버와 D1이 함께 차단한다.

관리자는 Google Cloud Billing이 실제로 활성화된 유료 Gemini API 또는 회사가 승인한 Vertex AI 계약을 확인한 뒤에만 관리자 설정에서 내부자료 전송을 켤 수 있다. Google의 Gemini API 추가 약관은 무료 서비스 제출물을 제품 개선에 사용할 수 있고 사람 검토가 있을 수 있다고 설명한다. 반면 유료 서비스는 제출 콘텐츠를 제품 개선에 사용하지 않는다고 명시한다.

- 공식 추가 약관: https://ai.google.dev/gemini-api/terms
- Zero Data Retention 안내: https://ai.google.dev/gemini-api/docs/zdr
- 과금 설정 안내: https://ai.google.dev/gemini-api/docs/billing

## 앱의 강제 경계

1. 원본은 프로젝트별 회사 Google Drive에 먼저 저장한다.
2. 자료 등급을 `GENERAL`, `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED`로 지정한다.
3. 무료 또는 결제상태 미확인 계정은 `GENERAL`만 AI로 전송할 수 있다.
4. 텍스트 자료는 주민번호, 전화번호, 이메일, API 키, 계좌번호 패턴을 전송 전에 마스킹한다.
5. 공급자의 원문 응답, API 키, 원문 본문은 `preview_workflow_ai_imports`에 저장하지 않는다. 파일명·SHA-256·크기·등급·모델·결과 상태만 감사 이력으로 남긴다.
6. AI가 채운 회의·현장조사 값은 `DRAFTED` 초안이다. 담당자가 원문과 대조하고 저장해야 업무 기록이 된다.
7. AI가 모르는 내용은 추정하지 않고 빈 값과 `missingFields`로 반환한다.

## “우리 모델 학습”과 외부 LLM 호출은 다르다

유료 API를 호출한다고 회사 전용 모델이 자동 학습되는 것은 아니다. 반복 업무 학습은 다음의 내부 메모리 계층으로 분리한다.

- 단기 기억: 현재 프로젝트의 승인된 회의록, 현장조사, 산출 근거, 보고서 초안.
- 장기 기억: 사람이 승인한 유형별 작성 지침, 수정 전후의 일반화 가능한 규칙, 금지 표현, 품질 피드백.
- 외부 LLM: 위 기억에서 해당 요청에 필요한 최소 자료만 받아 초안을 생성하는 도구.

베트남 서버 연결 시에는 D1의 `preview_report_memory_*`, `preview_hermes_*` 계약을 PostgreSQL/벡터 저장소로 치환하되, `organization_id`, `case_id`, 승인 상태, 보존기간, 삭제 정책을 유지한다. 원문이나 다른 사건의 기억을 모델 파인튜닝 데이터로 자동 전환하지 않는다.

## 운영 체크리스트

- [ ] Cloud Billing 활성 프로젝트와 실제 Gemini API 키의 프로젝트가 동일하다.
- [ ] 회사 개인정보·소송자료 처리 승인을 받았다.
- [ ] 관리자 설정의 서비스 등급을 실제 계약과 동일하게 선택했다.
- [ ] “유료 서비스의 비학습 조건과 회사 보안정책을 확인했습니다” 확인을 기록했다.
- [ ] 고위험 자료는 가능한 경우 Vertex AI/Zero Data Retention 적격 여부를 별도로 확인했다.
- [ ] 유료 할당량 소진·429·5xx 시 자동으로 무료 키로 폴백하지 않는다.
- [ ] API 키는 브라우저, 로그, D1 평문, Git에 노출하지 않고 AES-GCM 암호문 또는 Cloudflare Secret으로만 보관한다.

## 사고 대응

잘못된 키·등급·계약을 발견하면 관리자 설정에서 내부자료 전송을 즉시 끄고, 해당 키를 Google Cloud에서 폐기·재발급한다. `preview_workflow_ai_imports`의 SHA-256·시각·사용자·상태로 영향 범위를 확인하되 공급자 원문은 저장하지 않으므로 원본 확인은 회사 Drive의 승인된 파일로만 수행한다.
