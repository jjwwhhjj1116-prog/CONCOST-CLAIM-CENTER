import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { scheduleDayInfo } from '../apps/web/src/workflow/schedule-holidays.js';

const read = (path:string) => readFileSync(path,'utf8');

test('CF72 uses real weekday classes and a horizontally scrollable 31-day calendar', () => {
  assert.match(scheduleDayInfo(2026,7,1).className,/is-saturday/u);
  assert.match(scheduleDayInfo(2026,7,2).className,/is-sunday/u);
  assert.doesNotMatch(scheduleDayInfo(2026,7,3).className,/is-saturday|is-sunday/u);
  const css=read('apps/web/src/workflow/ProjectWorkflowSchedule.css');
  assert.match(css,/grid-template-columns: 330px 1364px/u);
  assert.match(css,/repeat\(31, 44px\)/u);
  assert.match(css,/scrollbar-gutter: stable/u);
  assert.doesNotMatch(css,/nth-child\(7n/u);
});

test('CF72 preserves original award records and appends reversible effective-state corrections', () => {
  const migration=read('apps/cloudflare/migrations/0047_cf72_project_members_calendar.sql');
  const worker=read('apps/cloudflare/src/index.ts');
  const ui=read('apps/web/src/workflow/ProposalAwardWorkflow.tsx');
  assert.match(migration,/preview_award_effective_states/u);
  assert.match(migration,/preview_award_adjustments/u);
  assert.match(migration,/award adjustments are append-only/u);
  assert.doesNotMatch(migration,/DROP TABLE|DELETE FROM preview_award/u);
  assert.match(worker,/CF72_AWARD_ADJUSTMENT/u);
  assert.match(worker,/COALESCE\(effective\.effective_status,link\.award_status/u);
  assert.match(ui,/수주 취소/u);
  assert.match(ui,/Google Drive 보관/u);
  assert.match(ui,/ADMIN_DELETE/u);
  assert.match(read('apps/web/src/workflow/ProposalAwardWorkflow.css'),/white-space:nowrap/u);
});

test('CF72 signup requests are PBKDF2 protected and require an admin decision', () => {
  const migration=read('apps/cloudflare/migrations/0047_cf72_project_members_calendar.sql');
  const worker=read('apps/cloudflare/src/index.ts');
  const login=read('apps/web/src/App.tsx');
  const admin=read('apps/web/src/routes/PreviewAdminUsers.tsx');
  assert.match(migration,/preview_user_registration_requests/u);
  assert.match(migration,/status IN \('PENDING','APPROVED','REJECTED'\)/u);
  assert.match(worker,/derivePreviewPassword\(body\.password,salt,iterations\)/u);
  assert.match(worker,/310_000/u);
  assert.match(worker,/\/api\/admin\/registration-requests/u);
  assert.match(login,/회원가입 신청하기/u);
  assert.match(admin,/승인·계정 생성/u);
  assert.doesNotMatch(worker,/password\s*:\s*body\.password/u);
});

test('CF72 additive migration preserves populated award rows and is repeatable', async () => {
  const SQL=await initSqlJs();const db=new SQL.Database();db.run('PRAGMA foreign_keys=ON');
  db.exec(`CREATE TABLE preview_users(id TEXT PRIMARY KEY);CREATE TABLE preview_cases(id TEXT PRIMARY KEY);CREATE TABLE preview_proposal_links(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,award_status TEXT NOT NULL,award_decided_by TEXT,award_decided_at TEXT);`);
  const userId='00000000-0000-4000-8000-000000000001';const caseId='00000000-0000-4000-8000-000000000002';const linkId='00000000-0000-4000-8000-000000000003';
  db.run('INSERT INTO preview_users VALUES (?)',[userId]);db.run('INSERT INTO preview_cases VALUES (?)',[caseId]);db.run('INSERT INTO preview_proposal_links VALUES (?,?,?,?,?)',[linkId,caseId,'WON',userId,'2026-08-31T00:00:00.000Z']);
  const migration=read('apps/cloudflare/migrations/0047_cf72_project_members_calendar.sql');db.exec(migration);db.exec(migration);
  assert.equal(db.exec('SELECT COUNT(*) FROM preview_proposal_links')[0].values[0][0],1);
  assert.equal(db.exec('SELECT effective_status FROM preview_award_effective_states WHERE proposal_link_id=?'.replace('?',`'${linkId}'`))[0].values[0][0],'WON');
  assert.equal(db.exec('PRAGMA integrity_check')[0].values[0][0],'ok');
  assert.equal(db.exec('PRAGMA foreign_key_check').length,0);
});
