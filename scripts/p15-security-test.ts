import { after, before, describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EncryptedFileGooglePkceVerifierVault } from '../apps/api/src/google-workspace/GoogleCredentialVault';
import { restoreBackupPackage } from '../apps/api/src/backup/backup-engine';
import { requestJson, startP15Isolated, type P15TestContext } from './p15-test-support';

describe('P15 fail-closed backup and volatile-state security', () => {
  let context: P15TestContext;

  before(async () => { context = await startP15Isolated('p15-security'); });
  after(async () => { await context.cleanup(); });

  test('backup and restore endpoints require an authenticated Admin', async () => {
    const anonymous = await requestJson(context.origin, '/api/admin/backup/list');
    assert.equal(anonymous.status, 401);

    for (const session of [context.pmSession, context.staffSession, context.directorSession]) {
      const create = await requestJson(context.origin, '/api/admin/backup/create', 'POST', {}, session);
      assert.equal(create.status, 403);
      const restore = await requestJson(context.origin, '/api/admin/backup/restore', 'POST', {
        backupId: 'BACKUP-2026-08-11T00-00-00-000Z-deadbeef',
        restoreName: 'forbidden',
        confirmation: 'RESTORE'
      }, session);
      assert.equal(restore.status, 403);
    }
  });

  test('client-controlled keys and filesystem destinations are rejected before work starts', async () => {
    const create = await requestJson(context.origin, '/api/admin/backup/create', 'POST', {
      masterKey: 'client-must-not-control-signing'
    }, context.adminSession);
    assert.equal(create.status, 400);

    const restore = await requestJson(context.origin, '/api/admin/backup/restore', 'POST', {
      backupId: 'BACKUP-2026-08-11T00-00-00-000Z-deadbeef',
      restoreName: 'safe-name',
      confirmation: 'RESTORE',
      targetRestoreDir: 'C:\\Windows\\Temp'
    }, context.adminSession);
    assert.equal(restore.status, 400);
    assert.equal(fs.existsSync(context.restoreRootDir) ? fs.readdirSync(context.restoreRootDir, { withFileTypes: true }).length : 0, 0);
  });

  test('backup responses and manifests expose no signing key, verifier, token, or host path', async () => {
    const verifier = 'A'.repeat(64);
    const stateHash = crypto.createHash('sha256').update('p15-response-scan').digest('hex');
    const vault = new EncryptedFileGooglePkceVerifierVault({
      directory: context.pkceVaultDir,
      masterKey: crypto.createHash('sha256').update('response-scan-key').digest()
    });
    await vault.createVerifier({ organizationId: 'ORG-SYN-A', actorId: 'USR-ADMIN', stateHash, verifier, expiresAt: new Date(Date.now() + 60_000) });

    const created = await requestJson(context.origin, '/api/admin/backup/create', 'POST', {}, context.adminSession);
    assert.equal(created.status, 201);
    const serialized = JSON.stringify(created.body);
    for (const forbidden of [verifier, context.backupSigningKey.toString('hex'), context.databasePath, context.pkceVaultDir, 'access_token', 'refresh_token', 'client_secret']) {
      assert.equal(serialized.includes(forbidden), false, `response leaked ${forbidden}`);
    }
    assert.match(serialized, /google-pkce/);
  });

  test('encrypted PKCE verifier survives process replacement but remains scope-bound and one-time', async () => {
    const durableDir = path.join(context.pkceVaultDir, 'restart-boundary');
    const masterKey = crypto.createHash('sha256').update('P15 durable verifier key').digest();
    const scope = {
      organizationId: 'ORG-SYN-A',
      actorId: 'USR-ADMIN',
      stateHash: crypto.createHash('sha256').update('durable-state').digest('hex')
    };
    const verifier = `${'v'.repeat(42)}A`;
    const firstProcess = new EncryptedFileGooglePkceVerifierVault({ directory: durableDir, masterKey });
    const secretRef = await firstProcess.createVerifier({ ...scope, verifier, expiresAt: new Date(Date.now() + 60_000) });

    const fileText = fs.readFileSync(path.join(durableDir, `${secretRef}.pkce`), 'utf8');
    assert.equal(fileText.includes(verifier), false);
    assert.equal(fileText.includes(scope.organizationId), false);

    const restartedProcess = new EncryptedFileGooglePkceVerifierVault({ directory: durableDir, masterKey });
    assert.equal(await restartedProcess.resolveVerifier(secretRef, scope), verifier);
    assert.equal(await restartedProcess.resolveVerifier(secretRef, { ...scope, organizationId: 'ORG-OTHER' }), null);
    assert.equal(await restartedProcess.resolveVerifier(secretRef, { ...scope, actorId: 'USR-OTHER' }), null);
    assert.equal(await restartedProcess.resolveVerifier(secretRef, { ...scope, stateHash: '0'.repeat(64) }), null);

    const wrongKey = new EncryptedFileGooglePkceVerifierVault({ directory: durableDir, masterKey: crypto.randomBytes(32) });
    await assert.rejects(wrongKey.resolveVerifier(secretRef, scope), /corrupt|decrypt/i);
    await restartedProcess.deleteVerifier(secretRef);
    assert.equal(await restartedProcess.resolveVerifier(secretRef, scope), null);
  });

  test('engine rejects traversal and an untrusted signing key without creating a restore', async () => {
    await assert.rejects(restoreBackupPackage({
      backupId: '../../../../Windows/System32',
      backupRootDir: context.backupRootDir,
      restoreRootDir: context.restoreRootDir,
      restoreName: 'traversal',
      signingKey: context.backupSigningKey
    }), /backup identifier|invalid/i);

    const created = await requestJson(context.origin, '/api/admin/backup/create', 'POST', {}, context.adminSession);
    assert.equal(created.status, 201);
    await assert.rejects(restoreBackupPackage({
      backupId: created.body.manifest.backupId,
      backupRootDir: context.backupRootDir,
      restoreRootDir: context.restoreRootDir,
      restoreName: 'wrong-key',
      signingKey: crypto.randomBytes(32)
    }), /signature|corrupt/i);
    assert.equal(fs.existsSync(path.join(context.restoreRootDir, 'wrong-key')), false);
  });
});
