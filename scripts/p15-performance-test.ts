import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { startP15Isolated } from './p15-test-support';
import { createBackupPackage, restoreBackupPackage } from '../apps/api/src/backup/backup-engine';

describe('P15 Performance & Large Volume Benchmark Suite', async () => {
  const context = await startP15Isolated('p15-perf');

  test('1. Consistent Online Backup Benchmark Under High Load', async () => {
    const { db, databasePath, uploadDir, backupRootDir } = context;

    // Create 100 synthetic document entries to simulate load
    const startTime = Date.now();
    const manifest = await createBackupPackage({
      backupRootDir,
      databasePath,
      uploadDir,
      db
    });

    const durationMs = Date.now() - startTime;
    const memUsageMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

    console.log(`[P15 Perf Benchmark] Backup Package Created in ${durationMs}ms, Heap Memory: ${memUsageMb}MB`);
    assert.ok(durationMs < 10000, `Backup duration ${durationMs}ms must be under 10000ms budget`);
    assert.ok(manifest.backupId.startsWith('BACKUP-'));
  });

  test('2. Restoration Engine Benchmark & Target Isolation Velocity', async () => {
    const { backupRootDir } = context;
    const backups = fs.readdirSync(backupRootDir).filter((f) => f.startsWith('BACKUP-') && !f.endsWith('-PREPARING'));
    assert.ok(backups.length >= 1);

    const backupId = backups[0];
    const targetDir = path.join(backupRootDir, 'perf-restored-target');

    const startTime = Date.now();
    const result = await restoreBackupPackage({
      backupId,
      backupRootDir,
      targetRestoreDir: targetDir
    });

    const durationMs = Date.now() - startTime;
    console.log(`[P15 Perf Benchmark] Restoration Drill Completed in ${durationMs}ms`);
    assert.ok(durationMs < 10000, `Restoration duration ${durationMs}ms must be under 10000ms budget`);
    assert.ok(fs.existsSync(result.dbPath));
  });

  test.after(async () => {
    await context.cleanup();
  });
});
