import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string): string => readFileSync(path, 'utf8');

test('CF69 proposals and reports export the reviewed preview directly as DOCX PDF and HWP', () => {
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  const report = read('apps/web/src/routes/PreviewReportStudio.tsx');
  const exporter = read('apps/web/src/documents/final-document-export.ts');
  const icon = read('apps/web/src/documents/FileFormatIcon.tsx');

  assert.match(proposal, /ref=\{finalPreviewRef\}/u);
  assert.match(proposal, /downloadFinalDocument/u);
  assert.match(proposal, /download\('docx'\)/u);
  assert.match(proposal, /download\('pdf'\)/u);
  assert.match(proposal, /download\('hwp'\)/u);
  assert.match(report, /ref=\{finalReportPreviewRef\}/u);
  assert.match(report, /downloadFinalReport\('docx'\)/u);
  assert.match(report, /downloadFinalReport\('pdf'\)/u);
  assert.match(report, /downloadFinalReport\('hwp'\)/u);
  assert.match(proposal, /activeProposal\?\.status!==['"]DRAFT['"]/u);
  assert.match(icon, /FileFormatIcon/u);
  assert.match(icon, /docx: 'W'/u);
  assert.match(icon, /pdf: 'PDF'/u);
  assert.match(icon, /hwp: '한'/u);

  assert.match(exporter, /querySelectorAll<HTMLElement>\('\[data-export-page\]'\)/u);
  assert.match(exporter, /미리보기에 HTML 코드가 노출되어 내보내기를 중단/u);
  assert.match(exporter, /createDocx\(pages\)/u);
  assert.match(exporter, /createPdf\(pages\)/u);
  assert.match(exporter, /createHwp\(pages/u);
  assert.match(exporter, /exportHwpVerify/u);
  assert.match(exporter, /oleSignature/u);
  assert.match(exporter, /clonedPage\.style\.width = '794px'/u);
  assert.match(exporter, /scale: 1\.5/u);
  assert.match(exporter, /imageTimeout: 15_000/u);
  assert.match(exporter, /removeContainer: true/u);
  assert.match(exporter, /expectedSignature/u);
  assert.doesNotMatch(exporter, /dataUrl: string/u);
  assert.match(proposal, /onChange=\{\(next,json\)=>\{setChapters[\s\S]*?setDirty\(true\)/u);
});

test('CF69 reception lists remain searchable scrollable and visibly selected', () => {
  const workflow = read('apps/web/src/workflow/ProposalAwardWorkflow.tsx');
  const css = read('apps/web/src/workflow/ProposalAwardWorkflow.css');
  assert.match(workflow, /reception-list-search/u);
  assert.match(workflow, /reception-status-list__body/u);
  assert.match(workflow, /aria-pressed=\{active\}/u);
  assert.match(workflow, /✓ 선택됨/u);
  assert.match(css, /max-height: 360px; overflow-y: auto/u);
  assert.match(css, /is-ready \.reception-status-list__body > button\.is-active/u);
  assert.match(css, /is-won \.reception-status-list__body > button\.is-active/u);
  assert.match(css, /focus-visible/u);
  assert.match(workflow, /if \(!selectedItem \|\| !searchable\.includes\(needle\)\) setSelectedReceptionId\(''\)/u);
});

test('CF69 approved proposal assets resolve immutable versions', () => {
  const worker = read('apps/cloudflare/src/index.ts');
  const migration = read('apps/cloudflare/migrations/0046_cf69_proposal_asset_versions.sql');
  const docx = read('apps/cloudflare/src/proposal-docx.ts');
  assert.match(migration, /preview_proposal_company_asset_versions/u);
  assert.match(migration, /PRIMARY KEY \(organization_id, asset_key, version\)/u);
  assert.match(worker, /url\.searchParams\.get\('v'\)/u);
  assert.match(worker, /FROM preview_proposal_company_asset_versions/u);
  assert.match(worker, /INSERT INTO preview_proposal_company_asset_versions/u);
  assert.doesNotMatch(docx, /paragraph\(block\.text, 'Normal', '<w:jc w:val="both"\/>'\)/u);
});
