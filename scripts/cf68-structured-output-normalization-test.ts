import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizedDocumentTextLines } from '../apps/cloudflare/src/document-content-normalizer.js';
import { generateFinalDocx, generateFinalPdf, type FinalReportDocument } from '../apps/cloudflare/src/final-output.js';
import { generateProposalDocx, generateProposalPdf, type ProposalExportDocument } from '../apps/cloudflare/src/proposal-docx.js';

const content = `## 검토 결과
<span style="color:#f00">강조 본문</span>
<table style="width:100%"><tr><th>구분</th><th>값</th></tr><tr><td>공종</td><td><p>철근</p></td></tr></table>`;

const utf16Hex = (value: string): string => Array.from(value).map((character) => character.charCodeAt(0).toString(16).padStart(4, '0')).join('').toUpperCase();

test('CF68 mixed editor HTML becomes DOCX table and PDF text without literal markup', () => {
  assert.deepEqual(normalizedDocumentTextLines(content), ['검토 결과', '강조 본문', '구분 | 값', '공종 | 철근']);

  const finalDocument: FinalReportDocument = {
    caseNumber: 'CC-2026-00001', caseTitle: '출력 정규화', reportTitle: '최종 보고서', reportVersion: 1,
    content, contentSha256: 'a'.repeat(64), approvedBy: '검토자', approvedAt: '2026-08-28T01:00:00.000Z',
    finalizedBy: '관리자', finalizedAt: '2026-08-28T02:00:00.000Z'
  };
  const proposalDocument: ProposalExportDocument = {
    proposalId: 'proposal-1', versionId: 'version-1', versionNumber: 1, projectTitle: '기술제안서',
    clientName: '발주처', subtitle: '출력 정규화', submissionDate: '2026-08-28', caseNumber: 'CC-2026-00001',
    claimType: 'TYPE-03', preparedBy: '담당자', contentSha256: 'b'.repeat(64),
    chapters: [{ number: 1, title: '검토 결과', body: content }]
  };

  for (const docx of [generateFinalDocx(finalDocument), generateProposalDocx(proposalDocument)]) {
    const packageText = new TextDecoder().decode(docx);
    assert.match(packageText, /<w:tbl>/u);
    assert.match(packageText, /공종/u);
    assert.doesNotMatch(packageText, /&lt;\/?(?:table|tr|th|td|span)\b/iu);
  }

  for (const pdf of [generateFinalPdf(finalDocument), generateProposalPdf(proposalDocument)]) {
    const pdfText = new TextDecoder().decode(pdf);
    assert.match(pdfText, new RegExp(`(?:FEFF)?${utf16Hex('공종 | 철근')}`, 'u'));
    assert.doesNotMatch(pdfText, new RegExp(`(?:FEFF)?${utf16Hex('<table')}`, 'iu'));
  }
});
