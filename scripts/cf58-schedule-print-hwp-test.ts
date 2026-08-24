import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('CF58 project schedule exposes authenticated D1-backed A4 landscape printing', () => {
  const app = read('apps/web/src/App.tsx');
  const router = read('apps/web/src/routes/Router.tsx');
  const schedule = read('apps/web/src/workflow/ProjectWorkflowSchedule.tsx');
  const print = read('apps/web/src/workflow/ProjectSchedulePrint.tsx');
  const css = read('apps/web/src/workflow/ProjectSchedulePrint.css');
  assert.match(app, /currentPath === '\/print\/projects\/month-a4'/u);
  assert.match(router, /path: '\/print\/projects\/month-a4'/u);
  assert.match(schedule, /🖨 일정표 출력/u);
  assert.match(print, /\/api\/project-workflow\/schedule/u);
  assert.match(print, /scheduleDayInfo/u);
  assert.match(print, /colorMode/u);
  assert.match(print, /window\.print\(\)/u);
  assert.match(print, /PDF로 저장/u);
  assert.match(css, /@page\{size:A4 landscape/u);
  assert.match(css, /is-korean-holiday/u);
  assert.match(css, /is-vietnam-holiday/u);
});

test('CF58 shared rhwp editor imports, edits, verifies and exports HWP/HWPX', () => {
  const component = read('apps/web/src/documents/RhwpEditorDialog.tsx');
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  const previewReport = read('apps/web/src/routes/PreviewReportStudio.tsx');
  const report = read('apps/web/src/reports/ReportStudio.tsx');
  const webPackage = read('apps/web/package.json');
  for (const marker of ['createEditor', 'loadFile', 'exportHwp()', 'exportHwpx()', 'exportHwpVerify()', 'notifySaved']) {
    assert.ok(component.includes(marker), `missing rhwp integration marker: ${marker}`);
  }
  assert.match(component, /VITE_RHWP_STUDIO_URL/u);
  assert.match(component, /\.hwp,\.hwpx,\.hml/u);
  assert.match(proposal, /HWP 가져오기·편집/u);
  assert.match(previewReport, /HWP 가져오기·편집/u);
  assert.match(report, /HWP 가져오기·편집/u);
  assert.match(webPackage, /"@rhwp\/editor": "0\.8\.4"/u);
});
