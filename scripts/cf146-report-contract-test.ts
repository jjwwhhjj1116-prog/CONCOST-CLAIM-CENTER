import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeReportAiContent, validateReportAiImprovement } from '../packages/document-engine/src/report-ai-content';
import { joinReportPresentation, splitReportPresentation } from '../packages/document-engine/src/report-presentation';

test('CF146 newly generated Markdown is unwrapped, missing evidence is not converted to zero', () => {
  assert.equal(normalizeReportAiContent('```markdown\n## 검토 결과\n\n|항목|수량|\n|---|---|\n|철근|12|\n```'), '## 검토 결과\n\n|항목|수량|\n|---|---|\n|철근|12|');
  assert.equal(normalizeReportAiContent('UNREVIEWABLE'), '자료 부족으로 검토 불가');
  assert.equal(normalizeReportAiContent('~~~~markdown\n## 검토\n본문\n~~~~'), '## 검토\n본문');
  assert.equal(normalizeReportAiContent('````md\n## 검토\n본문\n````'), '## 검토\n본문');
  const code = '본문\n\n```text\n원문 인용\n```';
  assert.equal(normalizeReportAiContent(code), code);
});
test('CF146 internal data, raw JSON and chapter control tokens never become new report body', () => {
  for (const value of ['case.caseNumber', 'workflow.verifiedProcessDocuments', 'source_locator:123', '{"key":"value"}', '[{"key":"value"}]', '<!-- AI-CHAPTER:CH-02:END -->', 'WHOLE_DOCUMENT', '']) assert.throws(() => normalizeReportAiContent(value));
});

test('CF148 actual memory and evidence keys cannot leak into new AI prose', () => {
  for (const key of ['shortTermMemory.currentChapter.text','evidenceCatalog','approved_previous_chapters','baseline_date','source_excerpts','proposalWorkflow.verifiedProposalSnapshots']) {
    assert.throws(() => normalizeReportAiContent(`## 검토\n${key} 자료가 제공되지 않았습니다.`), key);
  }
  const prose = '## 검토\n기준일과 앞선 장의 검토 결과가 없어 산정할 수 없습니다. 확인된 금액 123,456원은 원문과 대조해야 합니다.';
  assert.equal(normalizeReportAiContent(prose), prose);
});
test('CF146 front matter metadata round trips without mutating confirmed body or other attributes', () => {
  const body = { type: 'doc', attrs: { custom: 'keep' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '확정 12,345원' }] }] };
  const before = JSON.stringify(body);
  const frontMatter = { enabled: false, date: '2026. 9.', author: '검수 담당자', subtitle:'수정 부제', tocTitle:'수정 목차', tocTitles:{'1:사건 개요#1':'직접 수정한 목차 문구'} };
  const header = { enabled: false, text: null };
  const restored = splitReportPresentation(joinReportPresentation(body, header, frontMatter));
  assert.deepEqual(restored, { body, header, frontMatter });
  assert.equal(JSON.stringify(body), before);
  assert.equal(splitReportPresentation(null).frontMatter.enabled, true);
});

test('CF148 improvements preserve existing chapter boundaries and reject leaked diagnostics', () => {
  const source = '<!-- AI-CHAPTER:CH-01:START -->\n원문 123원\n<!-- AI-CHAPTER:CH-01:END -->';
  const proposed = source.replace('원문', '확인 금액');
  assert.equal(validateReportAiImprovement(source, proposed), proposed);
  assert.equal(validateReportAiImprovement('선택 문장', '수정한 문장'), '수정한 문장');
  for (const invalid of [source.replace('원문', 'evidenceCatalog'), source.replace('CH-01:END','CH-02:END'), proposed + '\n<!-- MANUAL-CHAPTER:CH-03:START -->', '']) {
    assert.throws(() => validateReportAiImprovement(source, invalid));
  }
});
