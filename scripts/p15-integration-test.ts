import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { startP15Isolated, requestJson } from './p15-test-support';

describe('P15 Integration Suite: End-to-End API Connections, Backup/Restore Endpoints & Snapshot Integrity', async () => {
  const context = await startP15Isolated('p15-integration');

  test('1. POST /api/admin/backup/create & GET /api/admin/backup/list', async () => {
    const { origin, adminSession } = context;

    const createRes = await requestJson(origin, '/api/admin/backup/create', 'POST', { masterKey: 'p15-master-pass' }, adminSession);
    assert.equal(createRes.status, 201);
    assert.ok(createRes.body.manifest.backupId);

    const listRes = await requestJson(origin, '/api/admin/backup/list', 'GET', undefined, adminSession);
    assert.equal(listRes.status, 200);
    assert.ok(listRes.body.backups.length >= 1);
  });

  test('2. POST /api/admin/backup/prune-dry-run & POST /api/admin/backup/verify', async () => {
    const { origin, adminSession } = context;

    // Prune dry run
    const pruneRes = await requestJson(origin, '/api/admin/backup/prune-dry-run', 'POST', { keepCount: 3 }, adminSession);
    assert.equal(pruneRes.status, 200);
    assert.equal(pruneRes.body.keepCount, 3);

    // List backups to get backupId
    const listRes = await requestJson(origin, '/api/admin/backup/list', 'GET', undefined, adminSession);
    const backupId = listRes.body.backups[0].backupId;

    // Verify endpoint
    const verifyRes = await requestJson(origin, '/api/admin/backup/verify', 'POST', { backupId }, adminSession);
    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.valid, true);
  });

  test('3. RBAC Access Control for Backup Endpoints (Staff/PM vs Admin)', async () => {
    const { origin, staffSession, pmSession } = context;

    // Staff cannot create backup -> 403
    const staffRes = await requestJson(origin, '/api/admin/backup/create', 'POST', {}, staffSession);
    assert.equal(staffRes.status, 403);

    // PM cannot restore backup (Admin only) -> 403
    const pmRestoreRes = await requestJson(origin, '/api/admin/backup/restore', 'POST', { backupId: 'b', targetRestoreDir: 't' }, pmSession);
    assert.equal(pmRestoreRes.status, 403);
  });

  test.after(async () => {
    await context.cleanup();
  });
});
