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
  for (const color of ['#c8794d', '#4a86c5', '#766bb5', '#4b967f']) assert.match(theme, new RegExp(color));
  assert.match(theme, /--report-step-number/u);
  assert.match(theme, /\.case-create-number strong/u);
});

test('CF21 keeps active navigation legible and harmonizes light workspace surfaces', () => {
  const shell = read('apps/web/src/layout/AppShell.tsx');
  const theme = read('apps/web/src/theme-system.css');

  assert.match(shell, /navigation-group\$\{isCurrentGroup \? ' is-current' : ''\}/u);
  assert.match(theme, /\.navigation-group\.is-current header/u);
  assert.match(theme, /box-shadow: inset 3px 0 #4a86c5/u);
  assert.doesNotMatch(theme, /\.navigation-group \.navigation-link\[aria-current='page'\] \{ background: linear-gradient/u);
  assert.match(theme, /:root\[data-theme='light'\] \.schedule-board/u);
  assert.match(theme, /:root\[data-theme='light'\] \.case-evidence-categories button/u);
  assert.match(theme, /:root\[data-theme='light'\] \.litigation-kpis article/u);
});

test('CF22 applies the pastel overlay system and project-specific work tags', () => {
  const html = read('apps/web/index.html');
  const theme = read('apps/web/src/theme-system.css');
  const model = read('apps/web/src/workflow/workflow-model.ts');
  const schedule = read('apps/web/src/workflow/ProjectWorkflowSchedule.tsx');
  const scheduleCss = read('apps/web/src/workflow/ProjectWorkflowSchedule.css');

  assert.match(html, /family=Noto\+Sans\+KR/u);
  assert.match(html, /family=DM\+Mono/u);
  assert.match(theme, /--page-bg: #f4f7fb/u);
  assert.match(theme, /0 6px 18px rgba\(34, 62, 94, \.04\)/u);
  assert.match(theme, /\.navigation-group \.navigation-link\[aria-current='page'\].*background: #e5f0f8/u);
  assert.match(model, /highlights: readonly/u);
  assert.match(model, /마감팀 · 마감 물량 산출/u);
  assert.match(schedule, /project-brief-board/u);
  assert.match(schedule, /project\.highlights\.map/u);
  for (const tone of ['finish', 'structure', 'civil', 'report', 'survey', 'pending']) {
    assert.match(scheduleCss, new RegExp(`data-tone='${tone}'`));
  }
});

test('CF23 opens project workflow as a contextual schedule dialog without a duplicate sidebar category', () => {
  const app = read('apps/web/src/App.tsx');
  const shell = read('apps/web/src/layout/AppShell.tsx');
  const schedule = read('apps/web/src/workflow/ProjectWorkflowSchedule.tsx');
  const scheduleCss = read('apps/web/src/workflow/ProjectWorkflowSchedule.css');

  assert.match(app, /currentBrowserLocation/u);
  assert.match(app, /currentSearch=\{currentSearch\}/u);
  assert.doesNotMatch(shell, /routeIds: \[[^\]]*'PROJ-02'/u);
  assert.match(shell, /sidebar-project-context/u);
  assert.match(shell, /CURRENT PROJECT/u);
  assert.match(shell, /selectedStage \? `\$\{selectedStage\.id\}단계/u);
  assert.match(shell, /상세 팝업/u);
  assert.match(schedule, /project-context-strip/u);
  assert.match(schedule, /전체 단계 워크플로우/u);
  assert.match(schedule, /projectId=\$\{projectId\}/u);
  assert.match(schedule, /project-detail-modal/u);
  assert.match(schedule, /role="dialog"/u);
  assert.match(schedule, /aria-modal="true"/u);
  assert.match(schedule, /D1 LIVE PROJECTS · 신규 의뢰 자동 반영/u);
  assert.match(schedule, /apiRequest<\{ projects: WorkflowProject\[\]; dataBasis: string \}>\('\/api\/project-workflow\/schedule'\)/u);
  assert.doesNotMatch(schedule, /WORKFLOW_PROJECTS/u);
  assert.match(scheduleCss, /\.project-context-strip \{/u);
  assert.match(scheduleCss, /\.project-detail-modal-backdrop \{/u);
});

test('CF24 renders report authoring as a gated one-step-at-a-time wizard', () => {
  const studio = read('apps/web/src/routes/PreviewReportStudio.tsx');
  const css = read('apps/web/src/routes/PreviewReportStudio.css');

  assert.match(studio, /type ReportWizardStep = 1 \| 2 \| 3 \| 4 \| 5/u);
  assert.match(studio, /REPORT_WIZARD_STEPS/u);
  assert.match(studio, /이번 단계에서 할 일/u);
  assert.match(studio, /완료 기준/u);
  assert.match(studio, /이 단계 완료 · 다음 단계/u);
  assert.match(studio, /stepUnlocked/u);
  assert.match(css, /data-wizard-step='1'.*report-step-card--1/u);
  assert.match(css, /data-wizard-step='5'.*report-step-card--final/u);
  assert.match(css, /\.report-wizard-footer/u);
});
