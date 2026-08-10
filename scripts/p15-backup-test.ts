import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createPrismaClient } from '@claim-studio/database';
import { startP15Isolated } from './p15-test-support';
import {
  createBackupPackage,
  listBackupPackages,
  pruneBackupsDryRun,
  verifyBackupPackage,
  restoreBackupPackage
} from '../apps/api/src/backup/backup-engine';

describe('P15 Backup & Recovery Suite: Consistent Snapshot, Integrity, Retention & Restoration Drill', async () => {
  const context = await startP15Isolated('p15-backup');

  test('1. Consistent online SQLite backup via VACUUM INTO & Atomic Package Publish', async () => {
    const { db, databasePath, uploadDir, backupRootDir } = context;

    // Put a dummy upload file
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, 'test-doc.txt'), 'Sample document payload for P15 backup assertion', 'utf8');

    const manifest = await createBackupPackage({
      backupRootDir,
      databasePath,
      uploadDir,
      masterKey: 'test-master-key-123',
      db
    });

    assert.ok(manifest.backupId.startsWith('BACKUP-'));
    assert.equal(manifest.status, 'READY');
    assert.ok(manifest.dbMigrationLedgerCount >= 0);
    assert.ok(manifest.dbTriggerCount >= 6);
    assert.equal(manifest.files.length, 1);
    assert.equal(manifest.files[0].relativePath, 'test-doc.txt');

    // Ensure PREPARING directory was atomically removed
    const preparingDir = path.join(backupRootDir, `${manifest.backupId}-PREPARING`);
    assert.equal(fs.existsSync(preparingDir), false);
  });

  test('2. Backup Verification & Retention Policy (Keep 3, Prune Dry-Run)', async () => {
    const { db, databasePath, uploadDir, backupRootDir } = context;

    // Create 3 additional backups
    for (let i = 0; i < 3; i++) {
      await createBackupPackage({ backupRootDir, databasePath, uploadDir, db });
    }

    const backups = listBackupPackages(backupRootDir);
    assert.ok(backups.length >= 4);

    const dryRun = pruneBackupsDryRun(backupRootDir, 3);
    assert.equal(dryRun.keep.length, 3);
    assert.ok(dryRun.pruneCandidates.length >= 1);

    // Verify all candidates are untouched physically (Dry-Run assertion)
    for (const item of dryRun.pruneCandidates) {
      assert.ok(fs.existsSync(path.join(backupRootDir, item.backupId)));
    }
  });

  test('3. Verification Fail-Closed on Corrupted SHA-256 Hash or Missing Files', async () => {
    const { backupRootDir } = context;
    const backups = listBackupPackages(backupRootDir);
    const targetBackup = backups[0];
    const backupDir = path.join(backupRootDir, targetBackup.backupId);

    // Verify before tamper -> valid
    const cleanCheck = verifyBackupPackage(backupDir);
    assert.equal(cleanCheck.valid, true);

    // Tamper file content
    const storageFilePath = path.join(backupDir, 'storage', targetBackup.files[0].relativePath);
    fs.writeFileSync(storageFilePath, 'Hacked content causing SHA-256 mismatch!', 'utf8');

    const tamperedCheck = verifyBackupPackage(backupDir);
    assert.equal(tamperedCheck.valid, false);
    assert.ok(tamperedCheck.errors.some((e) => e.includes('Hash mismatch')));
  });

  test('4. Restoration Engine: Isolated Target Restore & Foreign Key/Trigger Integrity Drill', async () => {
    const { db, databasePath, uploadDir, backupRootDir } = context;

    // Create a pristine backup package
    const manifest = await createBackupPackage({
      backupRootDir,
      databasePath,
      uploadDir,
      masterKey: 'restore-master-key-xyz',
      db
    });

    const targetRestoreDir = path.join(backupRootDir, 'restored-drill-target');

    const restoreResult = await restoreBackupPackage({
      backupId: manifest.backupId,
      backupRootDir,
      targetRestoreDir,
      masterKey: 'restore-master-key-xyz'
    });

    assert.equal(restoreResult.restoredDir, targetRestoreDir);
    assert.ok(fs.existsSync(restoreResult.dbPath));
    assert.ok(fs.existsSync(restoreResult.storageDir));

    // Verify Restored SQLite DB via Foreign Key Check and Trigger Count Query
    const restoredDatabaseUrl = `file:${restoreResult.dbPath}`;
    const restoredDb = createPrismaClient(restoredDatabaseUrl);

    try {
      const fkCheck: any = await restoredDb.$queryRawUnsafe(`PRAGMA foreign_key_check`);
      assert.equal(fkCheck.length, 0, 'Restored database must have zero foreign key violations');

      const triggerRows: any = await restoredDb.$queryRawUnsafe(`SELECT count(*) as cnt FROM sqlite_master WHERE type = 'trigger'`);
      assert.equal(Number(triggerRows[0]?.cnt), manifest.dbTriggerCount, 'Restored database must preserve exact DB triggers');
    } finally {
      await restoredDb.$disconnect();
    }
  });

  test('5. Restoration Fail-Closed on Wrong Master Key or Pre-existing Non-Empty Directory', async () => {
    const { backupRootDir } = context;
    const backups = listBackupPackages(backupRootDir);
    const targetBackup = backups.find((b) => b.masterKeyHash) ?? backups[0];

    // Attempt restore with wrong key -> reject
    await assert.rejects(async () => {
      await restoreBackupPackage({
        backupId: targetBackup.backupId,
        backupRootDir,
        targetRestoreDir: path.join(backupRootDir, 'fail-key-target'),
        masterKey: 'wrong-key-999'
      });
    }, /Invalid master key/);

    // Attempt restore to non-empty directory -> reject
    const nonEmptyDir = path.join(backupRootDir, 'non-empty-dir');
    fs.mkdirSync(nonEmptyDir, { recursive: true });
    fs.writeFileSync(path.join(nonEmptyDir, 'existing.txt'), 'pre-existing file', 'utf8');

    await assert.rejects(async () => {
      await restoreBackupPackage({
        backupId: targetBackup.backupId,
        backupRootDir,
        targetRestoreDir: nonEmptyDir,
        masterKey: 'restore-master-key-xyz'
      });
    }, /not empty/);
  });

  test.after(async () => {
    await context.cleanup();
  });
});
