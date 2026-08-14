import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('CF20 exposes a persisted accessible light and dark theme toggle', () => {
  const shell = read('apps/web/src/layout/AppShell.tsx');
  const html = read('apps/web/index.html');
  const theme = read('apps/web/src/theme-system.css');

  assert.match(html, /<html lang="ko" data-theme="light">/u);
  assert.match(shell, /claim-center-theme/u);
  assert.match(shell, /aria-pressed=\{theme === 'dark'\}/u);
  assert.match(shell, /라이트 모드로 전환/u);
  assert.match(shell, /다크 모드로 전환/u);
  assert.match(theme, /:root\[data-theme='light'\]/u);
  assert.match(theme, /prefers-reduced-motion/u);
});

test('CF20 gives proposal, project workflow, and report authoring steps distinct hierarchy', () => {
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  const workflow = read('apps/web/src/workflow/WorkflowOperations.tsx');
  const report = read('apps/web/src/routes/PreviewReportStudio.tsx');
  const theme = read('apps/web/src/theme-system.css');

  assert.match(proposal, /proposal-step-button/u);
  assert.match(workflow, /--step-color/u);
  for (const step of ['1', '2', '3', '4', '5']) assert.match(report, new RegExp(`report-step-card--${step}`));
  for (const color of ['#f97316', '#2563eb', '#7c3aed', '#059669']) assert.match(theme, new RegExp(color));
  assert.match(theme, /--report-step-number/u);
  assert.match(theme, /\.case-create-number strong/u);
});
