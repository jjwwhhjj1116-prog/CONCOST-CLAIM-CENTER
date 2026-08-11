import { after, describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { requestJson, startP15Isolated } from './p15-test-support';

describe('P15 backup API integration and audit atomicity', async () => {
  const context = await startP15Isolated('p15-integration');
  let backupId = '';

  test('Admin creates, lists and verifies a signed backup without supplying a key', async () => {
    fs.mkdirSync(context.uploadDir, { recursive: true });
    fs.writeFileSync(path.join(context.uploadDir, 'integration.txt'), 'persistent bytes', 'utf8');
    const created = await requestJson(context.origin, '/api/admin/backup/create', 'POST', {}, context.adminSession);
    assert.equal(created.status, 201);
    backupId = created.body.manifest.backupId;
    assert.match(created.body.manifest.signature, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(created.body).includes('masterKey'), false);
    const listed = await requestJson(context.origin, '/api/admin/backup/list', 'GET', undefined, context.adminSession);
    assert.equal(listed.status, 200);
    assert.ok(listed.body.backups.some((item: any) => item.backupId === backupId));
    const verified = await requestJson(context.origin, '/api/admin/backup/verify', 'POST', { backupId }, context.adminSession);
    assert.deepEqual({ status: verified.status, valid: verified.body.valid }, { status: 200, valid: true });
  });

  test('restore accepts a safe logical name only, requires explicit confirmation and records audit', async () => {
    const missingConfirmation = await requestJson(context.origin, '/api/admin/backup/restore', 'POST', { backupId, restoreName: 'api-drill', confirmation: 'NO' }, context.adminSession);
    assert.equal(missingConfirmation.status, 400);
    const traversal = await requestJson(context.origin, '/api/admin/backup/restore', 'POST', { backupId, restoreName: '../outside', confirmation: 'RESTORE' }, context.adminSession);
    assert.equal(traversal.status, 400);
    const restored = await requestJson(context.origin, '/api/admin/backup/restore', 'POST', { backupId, restoreName: 'api-drill', confirmation: 'RESTORE' }, context.adminSession);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.restoreName, 'api-drill');
    assert.equal('restoredDir' in restored.body, false);
    assert.equal(await context.db.auditLog.count({ where: { action: 'BACKUP_RESTORED', targetId: backupId } }), 1);
  });

  test('all backup endpoints are Admin-only and request schemas reject unknown secrets/paths', async () => {
    for (const session of [context.directorSession, context.pmSession, context.staffSession]) {
      assert.equal((await requestJson(context.origin, '/api/admin/backup/create', 'POST', {}, session)).status, 403);
      assert.equal((await requestJson(context.origin, '/api/admin/backup/list', 'GET', undefined, session)).status, 403);
    }
    assert.equal((await requestJson(context.origin, '/api/admin/backup/create', 'POST', { masterKey: 'browser-secret' }, context.adminSession)).status, 400);
    assert.equal((await requestJson(context.origin, '/api/admin/backup/restore', 'POST', { backupId, targetRestoreDir: 'C:/outside', masterKey: 'x' }, context.adminSession)).status, 400);
    assert.equal((await requestJson(context.origin, '/api/admin/backup/prune-dry-run', 'POST', { keepCount: 2 }, context.adminSession)).status, 400);
    assert.equal((await requestJson(context.origin, '/api/admin/backup/prune-dry-run', 'POST', { keepCount: 3, extra: true }, context.adminSession)).status, 400);
  });

  test('audit failure removes a newly-created package instead of leaving an unaudited backup', async () => {
    const before = fs.existsSync(context.backupRootDir) ? fs.readdirSync(context.backupRootDir).filter((name) => /^BACKUP-/.test(name)).length : 0;
    await context.db.$executeRawUnsafe(`CREATE TRIGGER "p15_fail_backup_audit" BEFORE INSERT ON "AuditLog" WHEN NEW."action" = 'BACKUP_CREATED' BEGIN SELECT RAISE(ABORT, 'forced backup audit failure'); END`);
    try {
      const response = await requestJson(context.origin, '/api/admin/backup/create', 'POST', {}, context.adminSession);
      assert.equal(response.status, 500);
    } finally {
      await context.db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "p15_fail_backup_audit"');
    }
    const afterCount = fs.readdirSync(context.backupRootDir).filter((name) => /^BACKUP-/.test(name)).length;
    assert.equal(afterCount, before);
  });

  after(async () => { await context.cleanup(); });
});
