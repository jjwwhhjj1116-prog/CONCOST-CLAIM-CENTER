import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { type AddressInfo } from 'node:net';
import { createPrismaClient, seedDatabase, resetDatabase, type PrismaClient } from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { login, requestJson, createP09Fixture, P09_TEST_ORIGIN } from './p09-test-support';

const root = path.resolve(__dirname, '..');

async function startIsolated(name: string): Promise<{
  db: PrismaClient;
  api: ManagedApiServer;
  origin: string;
  databasePath: string;
  uploadDir: string;
}> {
  const databasePath = path.join(root, 'packages/database/.data', `${name}-${process.pid}-${Date.now()}.db`);
  const uploadDir = path.join(root, 'packages/database/.data', `${name}-uploads-${process.pid}-${Date.now()}`);
  const databaseUrl = `file:${databasePath}`;
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const db = createPrismaClient(databaseUrl);
  const api = createApiServer({ databaseUrl, allowedOrigins: [P09_TEST_ORIGIN], secureCookies: false, uploadDir });
  await new Promise<void>((resolve, reject) => api.once('error', reject).listen(0, '127.0.0.1', resolve));
  return { db, api, origin: `http://127.0.0.1:${(api.address() as AddressInfo).port}`, databasePath, uploadDir };
}

async function closeIsolated(context: Awaited<ReturnType<typeof startIsolated>>): Promise<void> {
  await new Promise<void>((resolve) => context.api.close(() => resolve()));
  await context.api.waitForDatabaseClose();
  await context.db.$disconnect();
  fs.rmSync(context.uploadDir, { recursive: true, force: true });
  for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${context.databasePath}${suffix}`, { force: true });
}

async function runP11SecurityTests() {
  console.log('[P11 Security Test] Initializing database and API server...');
  const ctx = await startIsolated('p11-security-test');

  try {
    const fx = await createP09Fixture(ctx.origin, ctx.db);
    const pmSession = fx.pm;
    const reviewerSession = fx.reviewer;
    const reportId = fx.reportId;
    const sectionId = fx.sectionIds[0];

    // 1. Scenario 4 & Cross-Case / Cross-Tenant Source Selection Check
    console.log('[P11 Security Test] 1. Cross-Case Grounding Source Injection Block...');
    const crossCaseRes = await requestJson(ctx.origin, `/api/reports/${reportId}/sections/${sectionId}/grounding/selections`, 'POST', {
      providerId: 'CFG-LOCAL-FAKE-01',
      modelCode: 'fake-claim-v1',
      sources: [
        { sourceType: 'MATERIAL', sourceId: 'DOC-SYN-003', sourceVersionId: 'DOCVER-SYN-003', allowedAnchors: [0] } // DOC-SYN-003 belongs to another case
      ]
    }, pmSession);
    assert.equal(crossCaseRes.status, 403);

    // 2. Reviewer Authoring Block (Scenario 11: Reviewer cannot create or apply suggestion)
    console.log('[P11 Security Test] 2. Reviewer Authoring Privilege Guard...');
    const reviewerCreateRes = await requestJson(ctx.origin, `/api/reports/${reportId}/sections/${sectionId}/grounding/selections`, 'POST', {
      providerId: 'CFG-LOCAL-FAKE-01',
      modelCode: 'fake-claim-v1',
      sources: [
        { sourceType: 'MATERIAL', sourceId: 'DOC-SYN-001', sourceVersionId: 'DOCVER-SYN-001', allowedAnchors: [0] }
      ]
    }, reviewerSession);
    assert.equal(reviewerCreateRes.status, 403);

    // 3. DB Trigger Raw Secret Guard in Suggestion Summary
    console.log('[P11 Security Test] 3. DB Trigger Block Raw Secret in Suggestion...');
    await assert.rejects(async () => {
      await ctx.db.$executeRawUnsafe(
        `INSERT INTO AiDraftSuggestion (id, selectionId, requestId, organizationId, caseId, reportId, sectionId, actorId, status, summaryText, promptMode, idempotencyKey, idempotencyFingerprint, createdAt, updatedAt) ` +
        `VALUES ('SUGG-BAD-${Date.now()}', 'GSEL-001', 'REQ-001', 'ORG-SYN-A', 'CASE-SYN-001', 'RPT-001', 'SEC-001', 'USR-PM', 'GENERATED', 'Leaked key sk-proj-raw-secret-key-12345', 'grounded_success', 'IDEMP-BAD', 'FINGERPRINT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      );
    }, /P11: Raw secret or API key string cannot be stored in suggestion summaryText/);

    // 4. DB Trigger Immutability of Selection and Citation
    console.log('[P11 Security Test] 4. DB Trigger Immutability of Selection and Citation...');
    await assert.rejects(async () => {
      await ctx.db.$executeRawUnsafe(`UPDATE AiGroundingSelection SET status = 'DISCARDED' WHERE id = 'GSEL-SYN-001'`);
    }, /P11: AiGroundingSelection records are immutable/);

    await assert.rejects(async () => {
      await ctx.db.$executeRawUnsafe(`DELETE FROM AiGroundingSelection WHERE id = 'GSEL-SYN-001'`);
    }, /P11: AiGroundingSelection records are immutable/);

    console.log('[P11 Security Test] PASS 100%!');
  } finally {
    await closeIsolated(ctx);
  }
}

if (require.main === module) {
  runP11SecurityTests().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
