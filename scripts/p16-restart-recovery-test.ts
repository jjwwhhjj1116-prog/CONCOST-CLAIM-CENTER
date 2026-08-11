import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { startP16Isolated, requestJson } from './p16-test-support';

describe('P16 Server Restart, Recovery Drill & Health/Readiness Suite', async () => {
  const context = await startP16Isolated('p16-recovery');

  test('1. GET /api/health & GET /api/readiness Probes (Secret-Free & Writable Checks)', async () => {
    const { origin } = context;

    const healthRes = await requestJson(origin, '/api/health');
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.body.status, 'ok');
    assert.ok(healthRes.body.timestamp);

    const readinessRes = await requestJson(origin, '/api/readiness');
    assert.equal(readinessRes.status, 200);
    assert.equal(readinessRes.body.status, 'ready');
    assert.equal(readinessRes.body.checks.databaseWritable, true);
    assert.equal(readinessRes.body.checks.storageWritable, true);
    assert.equal(readinessRes.body.checks.backupRootAvailable, true);

    const text = JSON.stringify(readinessRes.body);
    assert.equal(text.includes('password'), false);
    assert.equal(text.includes('secret'), false);
    assert.equal(text.includes('token'), false);
  });

  test('2. Backup Package Creation & Isolated Target Restore Drill (Runbook Compliance)', async () => {
    const { origin, fixture } = context;
    const adminSession = fixture.admin;

    // Create backup via API (strict schema: {})
    const createRes = await requestJson(origin, '/api/admin/backup/create', 'POST', {}, adminSession);
    assert.equal(createRes.status, 201);
    const backupId = createRes.body.manifest.backupId;
    assert.ok(backupId.startsWith('BACKUP-'));

    // Verify manifest
    const verifyRes = await requestJson(origin, '/api/admin/backup/verify', 'POST', { backupId }, adminSession);
    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.valid, true);

    // Isolated restore drill to safe logical name with confirmation: 'RESTORE'
    const restoreRes = await requestJson(origin, '/api/admin/backup/restore', 'POST', {
      backupId,
      restoreName: 'p16-drill-restore',
      confirmation: 'RESTORE'
    }, adminSession);

    assert.equal(restoreRes.status, 200);
    assert.equal(restoreRes.body.restoreName, 'p16-drill-restore');
  });

  test('3. Readiness Fail-Closed Probe on Storage Writable Failure', async () => {
    const { origin, uploadDir } = context;

    // Temporarily rename uploadDir or make it invalid
    const backupUploadDir = `${uploadDir}-temp-bak`;
    if (fs.existsSync(uploadDir)) fs.renameSync(uploadDir, backupUploadDir);

    try {
      // Create a dummy file with no write permissions to test failure scenario
      fs.writeFileSync(uploadDir, 'blocking-file-not-dir', 'utf8');

      const readinessFail = await requestJson(origin, '/api/readiness');
      assert.equal(readinessFail.status, 503);
      assert.equal(readinessFail.body.status, 'not_ready');
      assert.equal(readinessFail.body.checks.storageWritable, false);
    } finally {
      if (fs.existsSync(uploadDir)) fs.unlinkSync(uploadDir);
      if (fs.existsSync(backupUploadDir)) fs.renameSync(backupUploadDir, uploadDir);
    }
  });

  test.after(async () => {
    await context.cleanup();
  });
});
