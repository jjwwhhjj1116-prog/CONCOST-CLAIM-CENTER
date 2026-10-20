import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { databaseFixture, createSavedReport, submitReview, worker, request, ADMIN_ID, REVIEWER_ID, REVIEWER_TOKEN, ADMIN_TOKEN } from './cf221-approval-fixture.js';

for (const [label, email, hasOutbox] of [['legacy contact', 'PM contact', false], ['blank contact', '', false], ['valid email', 'pm@example.invalid', true]] as const) {
  test(`CF237 approval preserves account and in-app notification with ${label}`, async () => {
    const { sql, env } = await databaseFixture();
    try {
      sql.exec(readFileSync('apps/cloudflare/migrations/0067_cf221_assigned_report_approval.sql', 'utf8'));
      sql.run("UPDATE preview_users SET department_code='TECHNICAL_HQ',version=version+1 WHERE id=?", [REVIEWER_ID]);
      sql.run('UPDATE preview_users SET email=?,version=version+1 WHERE id=?', [email, ADMIN_ID]);
      const accounts = JSON.stringify(sql.exec('SELECT * FROM preview_users ORDER BY id'));
      const caseId = await createSavedReport(env, sql);
      const key = label.replaceAll(' ', '-');
      const submitted = await submitReview(env, caseId, 'cf237-email-' + key);
      const decide = () => worker.fetch(request(`/api/report-reviews/${submitted.id}/decision`, REVIEWER_TOKEN, {
        method: 'POST', body: JSON.stringify({ decision: 'APPROVED', expectedStatus: 'PENDING', note: 'Synthetic QA approval' })
      }), env);
      const response = await decide();
      assert.equal(response.status, 200);
      const body = await response.json() as any;
      const approved = body.reviews.find((r: any) => r.id === submitted.id);
      assert.equal(approved.status, 'APPROVED');
      assert.equal(approved.deliveryNotification.emailStatus, hasOutbox ? 'CONFIG_REQUIRED' : 'RECIPIENT_REQUIRED');
      assert.equal(sql.exec('SELECT count(*) FROM preview_notifications')[0].values[0][0], 1);
      assert.equal(sql.exec('SELECT count(*) FROM preview_email_outbox')[0].values[0][0], hasOutbox ? 1 : 0);
      assert.equal(JSON.stringify(sql.exec('SELECT * FROM preview_users ORDER BY id')), accounts);
      assert.equal((await decide()).status, 200);
      assert.equal(sql.exec('SELECT count(*) FROM preview_notifications')[0].values[0][0], 1, 'Retry must not duplicate notification');
      const finalized = await worker.fetch(request('/api/report-finalizations', ADMIN_TOKEN, {
        method: 'POST', headers: { 'Idempotency-Key': 'cf237-final-' + key }, body: JSON.stringify({ caseId, reviewId: submitted.id })
      }), env);
      assert.equal(finalized.status, 201, 'Approved report may be finalized even without an email address');
      assert.equal(sql.exec('PRAGMA foreign_key_check').length, 0);
    } finally { sql.close(); }
  });
}
