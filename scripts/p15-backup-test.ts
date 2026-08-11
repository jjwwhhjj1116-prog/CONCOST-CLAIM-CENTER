import { after, describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createPrismaClient } from '@claim-studio/database';
import {
  createBackupPackage, listBackupPackages, pruneBackupsDryRun,
  restoreBackupPackage, verifyBackupPackage
} from '../apps/api/src/backup/backup-engine';
import { startP15Isolated } from './p15-test-support';

describe('P15 signed backup and fail-closed recovery', async () => {
  const context = await startP15Isolated('p15-backup');
  let pristineBackupId = '';

  const create = async () => createBackupPackage({
    backupRootDir: context.backupRootDir,
    uploadDir: context.uploadDir,
    additionalStorageRoots: [
      { name: 'google-credentials', sourceDir: context.credentialVaultDir },
      { name: 'google-pkce', sourceDir: context.pkceVaultDir }
    ],
    signingKey: context.backupSigningKey,
    db: context.db
  });

  test('creates a signed SQLite snapshot and includes uploads plus encrypted vault roots', async () => {
    fs.mkdirSync(context.uploadDir, { recursive: true });
    fs.mkdirSync(context.credentialVaultDir, { recursive: true });
    fs.mkdirSync(context.pkceVaultDir, { recursive: true });
    fs.writeFileSync(path.join(context.uploadDir, 'storage-p15.txt'), 'document bytes', 'utf8');
    fs.writeFileSync(path.join(context.credentialVaultDir, 'SECREF_GOOGLE_SYNTHETIC.vault'), '{"ciphertext":"synthetic"}', 'utf8');
    fs.writeFileSync(path.join(context.pkceVaultDir, 'PKCE_SYNTHETIC.pkce'), '{"ciphertext":"synthetic"}', 'utf8');
    const manifest = await create();
    pristineBackupId = manifest.backupId;
    assert.equal(manifest.schemaVersion, 2);
    assert.match(manifest.signature, /^[0-9a-f]{64}$/);
    assert.match(manifest.database.sha256, /^[0-9a-f]{64}$/);
    assert.ok(manifest.database.migrations.length >= 1);
    assert.ok(manifest.database.triggers.length >= 1);
    assert.deepEqual(new Set(manifest.files.map((entry) => entry.storageRoot)), new Set(['uploads', 'google-credentials', 'google-pkce']));
    assert.equal(JSON.stringify(manifest).includes('masterKey'), false);
    assert.equal((await verifyBackupPackage(path.join(context.backupRootDir, manifest.backupId), context.backupSigningKey)).valid, true);
    assert.equal(fs.existsSync(path.join(context.backupRootDir, `${manifest.backupId}-PREPARING`)), false);
  });

  test('rejects manifest rewriting, database corruption, storage tampering, missing and extra files', async () => {
    const cases: Array<(backupDir: string) => void> = [
      (dir) => {
        const file = path.join(dir, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
        manifest.totalFilesSize += 1;
        fs.writeFileSync(file, JSON.stringify(manifest), 'utf8');
      },
      (dir) => fs.writeFileSync(path.join(dir, 'database.db'), Buffer.from('not sqlite')),
      (dir) => fs.appendFileSync(path.join(dir, 'storage', 'uploads', 'storage-p15.txt'), 'tamper'),
      (dir) => fs.rmSync(path.join(dir, 'storage', 'uploads', 'storage-p15.txt')),
      (dir) => fs.writeFileSync(path.join(dir, 'storage', 'uploads', 'unmanifested.txt'), 'extra')
    ];
    for (const mutate of cases) {
      const manifest = await create();
      const directory = path.join(context.backupRootDir, manifest.backupId);
      mutate(directory);
      const result = await verifyBackupPackage(directory, context.backupSigningKey);
      assert.equal(result.valid, false, `tamper case must fail: ${result.errors.join('; ')}`);
    }
  });

  test('restores only beneath the configured restore root and revalidates DB, files, migrations and triggers', async () => {
    const result = await restoreBackupPackage({
      backupId: pristineBackupId,
      backupRootDir: context.backupRootDir,
      restoreRootDir: context.restoreRootDir,
      restoreName: 'drill-001',
      signingKey: context.backupSigningKey
    });
    assert.equal(result.restoredDir, path.join(context.restoreRootDir, 'drill-001'));
    assert.ok(fs.existsSync(path.join(result.storageDir, 'uploads', 'storage-p15.txt')));
    assert.ok(fs.existsSync(path.join(result.storageDir, 'google-credentials', 'SECREF_GOOGLE_SYNTHETIC.vault')));
    assert.ok(fs.existsSync(path.join(result.storageDir, 'google-pkce', 'PKCE_SYNTHETIC.pkce')));
    const restored = createPrismaClient(`file:${result.dbPath}`);
    try {
      assert.equal((await restored.$queryRawUnsafe<any[]>('PRAGMA integrity_check'))[0].integrity_check, 'ok');
      assert.equal((await restored.$queryRawUnsafe<any[]>('PRAGMA foreign_key_check')).length, 0);
    } finally { await restored.$disconnect(); }
  });

  test('blocks traversal, absolute targets, duplicate targets and a wrong signing key', async () => {
    await assert.rejects(restoreBackupPackage({
      backupId: '../../../../outside', backupRootDir: context.backupRootDir,
      restoreRootDir: context.restoreRootDir, restoreName: 'safe', signingKey: context.backupSigningKey
    }), /Backup ID is invalid/);
    await assert.rejects(restoreBackupPackage({
      backupId: pristineBackupId, backupRootDir: context.backupRootDir,
      restoreRootDir: context.restoreRootDir, restoreName: '../outside', signingKey: context.backupSigningKey
    }), /Restore name is invalid/);
    await assert.rejects(restoreBackupPackage({
      backupId: pristineBackupId, backupRootDir: context.backupRootDir,
      restoreRootDir: context.restoreRootDir, restoreName: 'drill-001', signingKey: context.backupSigningKey
    }), /already exists/);
    await assert.rejects(restoreBackupPackage({
      backupId: pristineBackupId, backupRootDir: context.backupRootDir,
      restoreRootDir: context.restoreRootDir, restoreName: 'wrong-key', signingKey: Buffer.alloc(32, 7)
    }), /signature mismatch|corrupted backup/i);
  });

  test('retains at least three valid packages and never treats PREPARING/corrupt packages as ready', async () => {
    while ((await listBackupPackages(context.backupRootDir, context.backupSigningKey)).length < 4) await create();
    fs.mkdirSync(path.join(context.backupRootDir, 'BACKUP-2026-08-11T00-00-00-000Z-deadbeef-PREPARING'), { recursive: true });
    const result = await pruneBackupsDryRun(context.backupRootDir, context.backupSigningKey, 3);
    assert.equal(result.keep.length, 3);
    assert.ok(result.pruneCandidates.length >= 1);
    for (const item of result.pruneCandidates) assert.ok(fs.existsSync(path.join(context.backupRootDir, item.backupId)));
  });

  after(async () => { await context.cleanup(); });
});
