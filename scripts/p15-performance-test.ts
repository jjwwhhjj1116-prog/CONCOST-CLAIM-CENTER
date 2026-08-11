import { after, before, describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createPrismaClient } from '@claim-studio/database';
import { createBackupPackage, restoreBackupPackage } from '../apps/api/src/backup/backup-engine';
import { startP15Isolated, type P15TestContext } from './p15-test-support';

const CASE_COUNT = 1_000;
const SCHEDULE_COUNT = 10_000;
const DOCUMENT_COUNT = 10_000;
const REPORT_SECTION_COUNT = 200;
const GOOGLE_HISTORY_COUNT = 1_000;

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

describe('P15 explicit-volume persistence and recovery benchmark', () => {
  let context: P15TestContext;
  let organizationId = '';
  let pmId = '';
  let caseIds: string[] = [];

  before(async () => {
    context = await startP15Isolated('p15-performance');
    const pm = await context.db.user.findUniqueOrThrow({ where: { email: 'pm@example.invalid' } });
    organizationId = pm.organizationId;
    pmId = pm.id;
  });
  after(async () => { await context.cleanup(); });

  test('loads the mandated large-volume fixture without bypassing relational constraints', async () => {
    const startedAt = performance.now();
    caseIds = Array.from({ length: CASE_COUNT }, (_, index) => `P15-PERF-CASE-${String(index + 1).padStart(4, '0')}`);
    await context.db.caseItem.createMany({ data: caseIds.map((id, index) => ({
      id,
      organizationId,
      caseNumber: `P15-PERF-${String(index + 1).padStart(5, '0')}`,
      title: `P15 volume case ${String(index + 1).padStart(4, '0')} ${'긴 사건명 '.repeat(8)}`,
      claimType: `TYPE-0${(index % 6) + 1}`,
      status: 'INQUIRY',
      assignedUserId: pmId
    })) });
    await context.db.caseAssignment.createMany({ data: caseIds.map((caseId) => ({ caseId, userId: pmId })) });

    const schedules = Array.from({ length: SCHEDULE_COUNT }, (_, index) => ({
      id: `P15-PERF-SCH-${String(index + 1).padStart(5, '0')}`,
      caseId: caseIds[index % caseIds.length],
      title: `Volume schedule ${index + 1}`,
      type: index % 2 === 0 ? 'COURT' : 'INTERNAL',
      date: new Date(Date.UTC(2026, 0, 1 + (index % 365)))
    }));
    for (const batch of chunks(schedules, 1_000)) await context.db.schedule.createMany({ data: batch });

    const documents = Array.from({ length: DOCUMENT_COUNT }, (_, index) => ({
      id: `P15-PERF-DOC-${String(index + 1).padStart(5, '0')}`,
      caseId: caseIds[index % caseIds.length],
      title: `Volume document ${index + 1}`,
      category: 'EVIDENCE',
      source: 'RECEIVED'
    }));
    for (const batch of chunks(documents, 1_000)) await context.db.document.createMany({ data: batch });
    const hash = crypto.createHash('sha256').update('P15 deterministic performance content').digest('hex');
    const versions = documents.map((document, index) => ({
      id: `P15-PERF-VER-${String(index + 1).padStart(5, '0')}`,
      documentId: document.id,
      versionNumber: 1,
      originalName: `volume-${index + 1}.txt`,
      displayName: `Volume ${index + 1}`,
      storageKey: `p15-perf-${index + 1}.txt`,
      fileSize: 35,
      mimeType: 'text/plain',
      sha256: hash,
      uploadedById: pmId
    }));
    for (const batch of chunks(versions, 1_000)) await context.db.documentVersion.createMany({ data: batch });

    const existingSections = await context.db.reportSection.count({ where: { reportId: context.fixture.reportId } });
    await context.db.reportSection.createMany({ data: Array.from({ length: REPORT_SECTION_COUNT - existingSections }, (_, index) => ({
      id: `P15-PERF-SECTION-${String(index + existingSections + 1).padStart(3, '0')}`,
      reportId: context.fixture.reportId,
      sectionNumber: index + existingSections + 1,
      title: `Volume section ${index + existingSections + 1}`,
      content: `Autosaved report content ${index + 1} ${'근거 기반 본문 '.repeat(40)}`,
      status: 'DRAFT',
      isRequired: false,
      blockSchemaSnapshotJson: '{}'
    })) });

    const operations = caseIds.slice(0, GOOGLE_HISTORY_COUNT).map((caseId, index) => ({
      id: `P15-PERF-GOP-${String(index + 1).padStart(4, '0')}`,
      organizationId,
      caseId,
      operationKind: 'DRIVE_FOLDER',
      idempotencyKey: `p15-perf-${String(index + 1).padStart(4, '0')}`,
      requestFingerprint: crypto.createHash('sha256').update(`p15-google-${index}`).digest('hex'),
      status: 'PENDING',
      actorId: pmId
    }));
    await context.db.googleSyncOperation.createMany({ data: operations });
    await context.db.googleSyncOperation.updateMany({
      where: { id: { in: operations.map((operation) => operation.id) } },
      data: { status: 'FAILED', resultJson: JSON.stringify({ responseClass: 'SERVER_ERROR', redacted: true }), completedAt: new Date() }
    });

    assert.equal(await context.db.caseItem.count({ where: { id: { in: caseIds } } }), CASE_COUNT);
    assert.equal(await context.db.schedule.count({ where: { id: { startsWith: 'P15-PERF-SCH-' } } }), SCHEDULE_COUNT);
    assert.equal(await context.db.document.count({ where: { id: { startsWith: 'P15-PERF-DOC-' } } }), DOCUMENT_COUNT);
    assert.equal(await context.db.documentVersion.count({ where: { id: { startsWith: 'P15-PERF-VER-' } } }), DOCUMENT_COUNT);
    assert.equal(await context.db.reportSection.count({ where: { reportId: context.fixture.reportId } }), REPORT_SECTION_COUNT);
    assert.equal(await context.db.googleSyncOperation.count({ where: { id: { startsWith: 'P15-PERF-GOP-' } } }), GOOGLE_HISTORY_COUNT);
    const fixtureMs = Math.round(performance.now() - startedAt);
    console.log(`[P15 performance] fixture cases=${CASE_COUNT} schedules=${SCHEDULE_COUNT} documents=${DOCUMENT_COUNT} versions=${DOCUMENT_COUNT} sections=${REPORT_SECTION_COUNT} googleHistory=${GOOGLE_HISTORY_COUNT} loadMs=${fixtureMs}`);
    assert.ok(fixtureMs < 120_000, `fixture load ${fixtureMs}ms exceeded 120s`);
  });

  test('records p50/p95 query latency and bounded memory on the explicit fixture', async () => {
    const samples: number[] = [];
    for (let iteration = 0; iteration < 10; iteration += 1) {
      const start = performance.now();
      await context.db.caseItem.findMany({ where: { organizationId, deletedAt: null }, orderBy: { updatedAt: 'desc' }, take: 100, include: { _count: { select: { schedules: true, documents: true } } } });
      await context.db.schedule.findMany({ where: { caseId: caseIds[iteration] }, orderBy: { date: 'asc' }, take: 100 });
      await context.db.documentVersion.findMany({ where: { document: { caseId: caseIds[iteration] } }, orderBy: { createdAt: 'desc' }, take: 100 });
      await context.db.reportSection.findMany({ where: { reportId: context.fixture.reportId }, orderBy: { sectionNumber: 'asc' }, take: REPORT_SECTION_COUNT });
      await context.db.googleSyncOperation.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 100 });
      samples.push(performance.now() - start);
    }
    const p50 = percentile(samples, 0.5);
    const p95 = percentile(samples, 0.95);
    const heapMb = process.memoryUsage().heapUsed / 1024 / 1024;
    console.log(`[P15 performance] queryBatch=5 samples=10 p50Ms=${p50.toFixed(2)} p95Ms=${p95.toFixed(2)} heapMb=${heapMb.toFixed(2)}`);
    assert.ok(p95 < 5_000, `query p95 ${p95}ms exceeded 5s`);
    assert.ok(heapMb < 1_024, `heap ${heapMb}MB exceeded 1GB`);
  });

  test('backs up and restores the populated database with exact DB integrity', async () => {
    fs.mkdirSync(context.uploadDir, { recursive: true });
    fs.writeFileSync(path.join(context.uploadDir, 'p15-persistence-proof.txt'), 'durable upload proof', 'utf8');
    const backupStart = performance.now();
    const manifest = await createBackupPackage({
      backupRootDir: context.backupRootDir,
      uploadDir: context.uploadDir,
      additionalStorageRoots: [
        { name: 'google-credentials', sourceDir: context.credentialVaultDir },
        { name: 'google-pkce', sourceDir: context.pkceVaultDir }
      ],
      signingKey: context.backupSigningKey,
      db: context.db
    });
    const backupMs = performance.now() - backupStart;
    const restoreStart = performance.now();
    const restored = await restoreBackupPackage({
      backupId: manifest.backupId,
      backupRootDir: context.backupRootDir,
      restoreRootDir: context.restoreRootDir,
      restoreName: 'performance-drill',
      signingKey: context.backupSigningKey
    });
    const restoreMs = performance.now() - restoreStart;
    const restoredDb = createPrismaClient(`file:${restored.dbPath}`);
    try {
      assert.equal(await restoredDb.caseItem.count({ where: { id: { startsWith: 'P15-PERF-CASE-' } } }), CASE_COUNT);
      assert.equal(await restoredDb.schedule.count({ where: { id: { startsWith: 'P15-PERF-SCH-' } } }), SCHEDULE_COUNT);
      assert.equal(await restoredDb.documentVersion.count({ where: { id: { startsWith: 'P15-PERF-VER-' } } }), DOCUMENT_COUNT);
      assert.equal(await restoredDb.reportSection.count({ where: { reportId: context.fixture.reportId } }), REPORT_SECTION_COUNT);
      assert.equal(await restoredDb.googleSyncOperation.count({ where: { id: { startsWith: 'P15-PERF-GOP-' } } }), GOOGLE_HISTORY_COUNT);
    } finally {
      await restoredDb.$disconnect();
    }
    console.log(`[P15 performance] databaseBytes=${manifest.database.size} backupMs=${backupMs.toFixed(2)} restoreMs=${restoreMs.toFixed(2)} files=${manifest.files.length}`);
    assert.ok(backupMs < 30_000, `backup ${backupMs}ms exceeded 30s`);
    assert.ok(restoreMs < 30_000, `restore ${restoreMs}ms exceeded 30s`);
  });
});
