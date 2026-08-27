import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

test('CF67 required fields, dirty navigation, and authoring step gates are explicit', () => {
  const input = read('packages/ui/src/components/Input.tsx');
  const select = read('packages/ui/src/components/Select.tsx');
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  const report = read('apps/web/src/routes/PreviewReportStudio.tsx');
  const app = read('apps/web/src/App.tsx');
  const theme = read('apps/web/src/theme-system.css');
  assert.match(input, /ui-field--required/u);
  assert.match(input, /aria-required/u);
  assert.match(select, /ui-field--required/u);
  assert.match(theme, /#fff7cf/u);
  assert.match(proposal, /goToProposalStep/u);
  assert.match(proposal, /1단계 필수 입력을 완료하세요/u);
  assert.match(proposal, /registerNavigationBlocker/u);
  assert.match(proposal, /if\(dirty\)event\.preventDefault/u);
  assert.match(report, /<Input required label="보고서 제목"/u);
  assert.match(report, /if \(dirty \|\| outlineDirty\) event\.preventDefault/u);
  assert.doesNotMatch(report, /dirty \|\| outlineDirty \|\| saving/u);
  assert.match(app, /popstate/u);
  assert.match(app, /requestNavigation/u);
});

test('CF67 document-form library exposes working proposal and meeting templates', () => {
  const router = read('apps/web/src/routes/Router.tsx');
  const shell = read('apps/web/src/layout/AppShell.tsx');
  const library = read('apps/web/src/routes/PreviewDocumentTemplates.tsx');
  assert.match(router, /CASE-09'.*\/cases\/files\/templates.*문서 양식/u);
  assert.match(shell, /routeIds: \['CASE-06', 'CASE-09'\]/u);
  assert.match(library, /proposalStudioWorkbook/u);
  assert.match(library, /CONCOST_회의록_양식\.xlsx/u);
  assert.match(library, /작성 Excel 가져오기/u);
  assert.equal(router.includes('<small>({currentRoute.id})</small>'), false);
});
