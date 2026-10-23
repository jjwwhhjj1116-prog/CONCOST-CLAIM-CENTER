import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path:string) => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const release = read('apps/web/src/layout/ReleaseNotice.tsx');
const shell = read('apps/web/src/layout/AppShell.tsx');
test('CF113 dated cumulative notice describes actual feature updates and connection limitations', () => {
  assert.match(release,/RELEASE_DATE = '2026-10-23'/);
  for(const label of ['긴 한글 프로젝트 제목','입력한 문자 그대로','수정한 새 버전은 다시 상신'])assert.ok(release.includes(label),label);
  assert.match(release,/테스트서버와 가오픈서버에 동일 소스를 반영했습니다/);
  assert.doesNotMatch(release,/가오픈 서버는 이번 배포 대상이 아닙니다/);
  for (const label of ['보고서 AI 초안 작성','보고서 편집·A4 페이지','제안서 작성·편집','프로젝트 일정·업무 화면','회의록 양식·Excel 출력','Drive 자료실·명함 관리','전체 업무·출력 검수가 모두 완료됐다는 의미는 아닙니다','실제 메일 발송 기능이 아닙니다']) assert.ok(release.includes(label),label);
  for(const label of ['마지막 보관 후 7일','HWP·DOCX 가져오기와 편집','지정 결재와 최종 출력','담당자 승인 이메일','서버 접수는 실제 받은함 도착·열람과 다릅니다','제안서의 메일 발송 준비 화면'])assert.ok(release.includes(label),label);
  const help=read('apps/web/src/layout/workspace-help-content.ts'),notice=read('apps/web/src/layout/SoftLaunchNotice.tsx');
  for(const label of ['이전 작업 복구','선택한 결재자에게 상신','승인본 확정·출력 준비','수신 담당자','확정 당시 본문'])assert.ok(help.includes(label),label);
  assert.doesNotMatch(notice,/확정본은 미리보기 페이지를 A4 이미지로 보존|추가 개발 예정/);
});
test('CF113 announcement persists by release and authenticated account, with permanent reopen', () => {
  assert.match(release,/RELEASE_DATE\}-v\d+:\$\{userId\}/);
  assert.match(release,/try \{ return localStorage.getItem[\s\S]+catch \{ return false;/);
  assert.match(release,/try \{ localStorage.setItem[\s\S]+catch/);
  assert.match(shell,/markReleaseSeen\(userId\); setReleaseOpen\(false\)/);
  assert.match(shell,/onClick=\{\(\) => openUtility\(\(\) => setReleaseOpen\(true\)\)\}/);
  assert.match(read('apps/web/src/App.tsx'),/<AppShell key=\{session.id\} userId=\{session.id\}/);
});
test('CF113 native modal traps focus, restores focus and leaves business alert reads untouched', () => {
  assert.match(release,/dialog.showModal\(\)/); assert.match(release,/previousFocus.focus\(\)/);
  assert.match(release,/onCancel=\{\(event\) => \{ event.preventDefault\(\); onClose\(\);/);
  assert.match(shell,/isOpen=\{alertsOpen && !releaseOpen\}/);
  assert.match(shell,/suspended=\{releaseOpen \|\| alertsOpen \|\| isDrawerOpen\}/);
  const help = read('apps/web/src/layout/WorkspaceHelpCenter.tsx');
  assert.match(help,/if \(!previewMode \|\| suspended \|\| tutorialLoadedRef.current\) return/);
  assert.match(help,/tutorialOpen && !suspended && createPortal/);
  assert.doesNotMatch(release,/apiRequest|fetch\(/);
});
test('CF113 modal scrolls internally and fits mobile without clipping close/confirm controls', () => {
  const css=read('apps/web/src/layout/ReleaseNotice.css');
  assert.match(css,/100dvh - 32px/); assert.match(css,/overflow-y: auto/);
  assert.match(css,/max-width:600px/); assert.match(css,/grid-template-columns: 1fr/);
  assert.match(css,/:focus-visible/);
});
test('CF113 backup gate binds gaopen target and seven immutable migration checksums', () => {
  const validator = read('scripts/cf113-gaopen-backup-check.mjs');
  assert.match(validator,/78094a1c-abe0-451d-bc12-68d0d37166d8/);
  assert.match(validator,/assert.equal\(migrations.length, 7\)/);
  assert.match(validator,/independent public key pin/);
  assert.match(validator,/preserve every existing value/);
  assert.match(validator,/preserve complete history/);
  assert.match(validator,/runner second pass is a no-op/);
  assert.doesNotMatch(validator,/fetch\(|spawn\(|wrangler.*execute/);
});
