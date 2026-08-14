import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync('apps/web/src/layout/AppShell.tsx', 'utf8');
const router = readFileSync('apps/web/src/routes/Router.tsx', 'utf8');
const studio = readFileSync('apps/web/src/routes/PreviewReportStudio.tsx', 'utf8');

test('CF15 sidebar follows the five requested business categories without duplicate intake links', () => {
  for (const label of ['CLAIM CENTER HOME', '프로젝트 제안 및 수주', '프로젝트 워크', '클레임센터 자료실', '법원 자료', '검토·납품·품질관리']) {
    assert.match(shell, new RegExp(label, 'u'));
  }
  assert.match(shell, /routeIds: \['CASE-02', 'PROP-02', 'WF-02'\]/u);
  assert.match(shell, /routeIds: \['PROJ-01', 'WF-03', 'WF-04', 'WF-05', 'REPO-02'\]/u);
  assert.doesNotMatch(shell, /routeIds: \['PROP-02', 'CASE-01', 'CASE-02'\]/u);
  assert.match(shell, /icon: 'proposal'/u);
  assert.match(shell, /icon: 'library'/u);
  assert.doesNotMatch(shell, /01 ·|02 ·|03 ·|04 ·|05 ·/u);
  assert.match(router, /CASE-02'.*'프로젝트 의뢰'/u);
  assert.match(router, /PROP-02'.*'제안서 작성'/u);
  assert.match(router, /WF-02'.*'프로젝트 접수'/u);
});

test('CF15 report writing menu opens the real studio with template, outline, tutorial and admin prompt boundaries', () => {
  assert.match(router, /REPO-02'.*'보고서 작성'/u);
  assert.match(router, /previewMode && currentRoute\.id === 'REPO-02'.*PreviewReportStudio/u);
  assert.match(studio, /처음이라면 아래 5단계만 차례대로 진행하세요/u);
  assert.match(studio, /TABLE OF CONTENTS · 2단계 목차 기획/u);
  assert.match(studio, /authoring\.chapters\.map/u);
  assert.match(studio, /프롬프트 원문은 관리자만 열람·수정/u);
  assert.match(studio, /roles\.includes\('admin'\).*onNavigate\('\/ai-config'\)/u);
  assert.match(router, /AI-01'.*allowedRoles: ADMIN_ONLY/u);
});
