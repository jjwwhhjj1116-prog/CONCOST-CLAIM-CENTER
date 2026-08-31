import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string): string => readFileSync(path, 'utf8');

test('CF74 keeps password hashing inside the proven Cloudflare Worker budget', () => {
  const worker = read('apps/cloudflare/src/index.ts');
  assert.match(worker, /PREVIEW_PASSWORD_ITERATIONS\s*=\s*100_000/u);
  assert.doesNotMatch(worker, /310_000/u);
  assert.equal((worker.match(/const iterations\s*=\s*PREVIEW_PASSWORD_ITERATIONS/gu) ?? []).length, 4);
});

test('CF74 admin deletion hides a proposal everywhere and explicit restore clears deletion', () => {
  const worker = read('apps/cloudflare/src/index.ts');
  const view = read('apps/web/src/proposals/ProposalLibraryView.tsx');
  assert.match(worker, /COALESCE\(cr\.db_deleted,0\)=0/u);
  assert.match(worker, /nextHidden=action==='ADMIN_DELETE'\?1:/u);
  assert.match(worker, /nextDeleted=action==='RESTORE_TO_LIST'\?0:action==='ADMIN_DELETE'\?1:/u);
  assert.match(view, /확정 파일 링크 없음/u);
  assert.doesNotMatch(view, />원문 미연결</u);
});

test('CF74 project detail timeline spans every saved stage through its completion month', () => {
  const schedule = read('apps/web/src/workflow/ProjectWorkflowSchedule.tsx');
  const css = read('apps/web/src/workflow/ProjectWorkflowSchedule.css');
  assert.match(schedule, /buildProjectTimeline\(project/u);
  assert.match(schedule, /project\.stages\.map\(\(stage\) => stage\.endDate\)/u);
  assert.match(schedule, /timeline\.months\.map/u);
  assert.match(schedule, /\$\{day\.year\}년 \$\{day\.monthIndex \+ 1\}월/u);
  assert.match(schedule, /timelineBarStyle\(item\.startDate, item\.endDate, timeline\.days\)/u);
  assert.match(css, /--detail-timeline-width/u);
  assert.match(css, /\.schedule-months/u);
  assert.match(css, /overflow-x: auto/u);
});
