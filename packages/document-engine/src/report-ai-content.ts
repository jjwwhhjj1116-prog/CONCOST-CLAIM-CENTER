export const REPORT_AUTHORING_OUTPUT_CONTRACT = `
[제출용 본문 출력 계약 — 내부 진단 형식보다 우선]
현재 장의 본문만 Markdown 제목·문단·표로 작성한다. 전체 응답을 코드블록으로 감싸지 않는다.
JSON 키, 객체 경로(case.caseNumber, workflow.* 등), 코드 정책, 시스템 처리 상태, 자체검증 PASS/FAIL 표는 제출용 본문에 쓰지 않는다.
사건번호·날짜·금액·출처는 제공된 근거만 사용한다. 등록된 파일 목록은 파일 내용 확인을 의미하지 않는다. 본문이나 사진을 읽지 못한 자료는 검토했다고 쓰지 않는다.
자료가 부족하면 한국어로 부족한 자료와 검토할 수 없는 범위를 명확히 쓴다. UNREVIEWABLE은 '자료 부족으로 검토 불가'로 표현하고 금액 0이나 기각으로 바꾸지 않는다.
시스템의 CH-01 같은 장 식별자나 '작성 범위/본문' 포장 제목을 추가하지 않는다. 사용자가 정한 장 제목 아래에 들어갈 실제 내용만 작성한다.
`;

export const REPORT_IMPROVEMENT_OUTPUT_CONTRACT = REPORT_AUTHORING_OUTPUT_CONTRACT.replace('현재 장의 본문만', '제공된 전체 본문 또는 선택 범위만') + '\n제공된 범위와 장 구성을 유지하십시오. 원문에 이미 있는 문서·장 경계 주석은 순서와 내용 그대로 유지하고 새 구분자는 추가하지 마십시오.';

/** Only for newly generated AI output, never a blanket migration of reviewed content. */
export function normalizeReportAiContent(raw: string): string {
  let content = raw.trim();
  const fenced = /^(`{3,}|~{3,})(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n\1\s*$/iu.exec(content);
  if (fenced) content = fenced[2].trim();
  if (!content || content.length > 200_000) throw new Error('AI 본문이 비어 있거나 허용 길이를 넘었습니다. 기존 원고는 유지합니다.');
  assertReportBodyFormat(content);
  return content.replace(/\bUNREVIEWABLE\b/gu, '자료 부족으로 검토 불가');
}

function assertReportBodyFormat(content: string): void {
  if (/AI-CHAPTER:|MANUAL-CHAPTER:|MANUAL-WHOLE-DOCUMENT:|WHOLE_DOCUMENT/iu.test(content)
    || /^(?:(?:`{3,}|~{3,})(?:json|markdown|md)\b|[\[{]\s*[\{"\[]|\\#{1,6}\s)/imu.test(content)
    || /\b(?:case|workflow|processWorkflow|proposalWorkflow|shortTermMemory|longTermMemory|outlinePlanning|caseLawGrounding|codePolicy)\.[A-Za-z_][\w.]*/u.test(content)
    || /\b(?:verifiedProcessDocuments|sourcePolicy|source_register|source_locator|source_excerpts|evidenceCatalog|approved_previous_chapters|baseline_date)\b/u.test(content)) {
    throw new Error('AI가 제출용 본문 대신 내부 데이터·코드 형식을 반환하여 반영을 중단했습니다. 기존 원고는 유지됩니다. 자료 연결과 작성 지침을 확인한 뒤 다시 작성해 주세요.');
  }
}

/** Improvements may retain existing editor boundaries, never introduce new ones. */
export function validateReportAiImprovement(source: string, proposed: string): string {
  if (!proposed.trim() || proposed.length > 500_000) throw new Error('AI 개선 본문이 비어 있거나 허용 길이를 넘었습니다. 기존 원고는 유지합니다.');
  const markers = /<!--\s*(?:(?:AI|MANUAL)-CHAPTER:[^:]+:(?:START|END)|MANUAL-WHOLE-DOCUMENT:(?:START|END))\s*-->/gu;
  if (JSON.stringify(source.match(markers) ?? []) !== JSON.stringify(proposed.match(markers) ?? [])) {
    throw new Error('AI 개선 결과의 장 구분자가 변경되어 반영하지 않았습니다. 기존 원고는 유지합니다.');
  }
  assertReportBodyFormat(proposed.replace(markers, ''));
  return proposed;
}
