import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { startP16Isolated, requestJson } from './p16-test-support';

describe('P16 persistent restart, readiness, backup, and restore', async () => {
  const context = await startP16Isolated('p16-recovery');

  test('1. liveness is secret-free and readiness verifies all persistent stores', async () => {
    const health = await requestJson(context.origin, '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');

    const readiness = await requestJson(context.origin, '/api/readiness');
    assert.equal(readiness.status, 200);
    assert.deepEqual(readiness.body.checks, {
      databaseWritable: true,
      migrationsUpToDate: true,
      storageWritable: true,
      backupRootWritable: true,
      restoreRootWritable: true
    });
    assert.doesNotMatch(JSON.stringify(readiness.body), /password|secret|token|\\|[A-Z]:\//i);
  });

  test('2. a real API mutation survives a full API server restart', async () => {
    const title = `P16 재시작 보존 사건 ${Date.now()}`;
    const created = await requestJson(context.origin, '/api/cases', 'POST', {
      title,
      claimType: 'TYPE-03',
      description: '재시작 후에도 유지되어야 하는 영속 데이터',
      category: { major: '건설', middle: '클레임', minor: '재시작 검증' }
    }, context.fixture.pm);
    assert.equal(created.status, 201);
    const createdId = created.body.case.id;

    await context.restartApi();
    const afterRestart = await requestJson(
      context.origin,
      `/api/cases?limit=100&q=${encodeURIComponent(title)}`,
      'GET',
      undefined,
      context.fixture.pm
    );
    assert.equal(afterRestart.status, 200);
    assert.equal(afterRestart.body.cases.some((entry: { id: string }) => entry.id === createdId), true);
  });

  test('3. readiness fails closed when migration ledger is stale and recovers after repair', async () => {
    const rows = await context.db.$queryRawUnsafe<Array<{ name: string; checksum: string; appliedAt: string }>>(
      'SELECT "name", "checksum", "appliedAt" FROM "_P04Migration" ORDER BY "name" DESC LIMIT 1'
    );
    const row = rows[0];
    assert.ok(row);
    await context.db.$executeRawUnsafe('UPDATE "_P04Migration" SET "checksum" = ? WHERE "name" = ?', '0'.repeat(64), row.name);
    const stale = await requestJson(context.origin, '/api/readiness');
    assert.equal(stale.status, 503);
    assert.equal(stale.body.checks.migrationsUpToDate, false);
    await context.db.$executeRawUnsafe('UPDATE "_P04Migration" SET "checksum" = ? WHERE "name" = ?', row.checksum, row.name);
    const repaired = await requestJson(context.origin, '/api/readiness');
    assert.equal(repaired.status, 200);
  });

  test('4. backup verify and isolated restore drill preserve an operational snapshot', async () => {
    const created = await requestJson(context.origin, '/api/admin/backup/create', 'POST', {}, context.fixture.admin);
    assert.equal(created.status, 201);
    const backupId = created.body.manifest.backupId as string;
    const verified = await requestJson(context.origin, '/api/admin/backup/verify', 'POST', { backupId }, context.fixture.admin);
    assert.equal(verified.status, 200);
    assert.equal(verified.body.valid, true);
    const restored = await requestJson(context.origin, '/api/admin/backup/restore', 'POST', {
      backupId,
      restoreName: 'p16-isolated-drill',
      confirmation: 'RESTORE'
    }, context.fixture.admin);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.restoreName, 'p16-isolated-drill');
    assert.equal(fs.existsSync(context.restoreRootDir), true);
  });

  test('5. storage, backup, and restore root failures independently return 503', async () => {
    for (const [directory, check] of [
      [context.uploadDir, 'storageWritable'],
      [context.backupRootDir, 'backupRootWritable'],
      [context.restoreRootDir, 'restoreRootWritable']
    ] as const) {
      const moved = directory + '-saved';
      fs.renameSync(directory, moved);
      fs.writeFileSync(directory, 'blocking-file', 'utf8');
      try {
        const failed = await requestJson(context.origin, '/api/readiness');
        assert.equal(failed.status, 503);
        assert.equal(failed.body.checks[check], false);
      } finally {
        fs.unlinkSync(directory);
        fs.renameSync(moved, directory);
      }
    }
  });

  test.after(async () => { await context.cleanup(); });
});
