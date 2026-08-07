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

async function runP11E2ETest() {
  console.log('[P11 E2E Test] Initializing database and API server...');
  const ctx = await startIsolated('p11-e2e-test');

  try {
    const fx = await createP09Fixture(ctx.origin, ctx.db);
    const pmSession = fx.pm;
    const reportId = fx.reportId;
    const sectionId = fx.sectionIds[0];

    // 2. Create Grounding Selection
    console.log('[P11 E2E Test] 2. Create Grounding Selection Manifest...');
    const selRes = await requestJson(ctx.origin, `/api/reports/${reportId}/sections/${sectionId}/grounding/selections`, 'POST', {
      providerId: 'CFG-LOCAL-FAKE-01',
      modelCode: 'fake-claim-v1',
      sources: [
        { sourceType: 'MATERIAL', sourceId: 'DOC-SYN-001', sourceVersionId: 'DOCVER-SYN-001', allowedAnchors: [0] }
      ]
    }, pmSession);
    assert.equal(selRes.status, 201);
    const selectionId = selRes.body.selection.id;

    // 3. Generate Grounded AI Suggestion
    console.log('[P11 E2E Test] 3. Generate Grounded AI Suggestion...');
    const sugRes = await requestJson(ctx.origin, `/api/reports/${reportId}/sections/${sectionId}/ai/suggestions`, 'POST', {
      selectionId,
      promptMode: 'grounded_success',
      idempotencyKey: `IDEMP-E2E-SUGG-${Date.now()}`
    }, pmSession);
    assert.equal(sugRes.status, 201);
    assert.equal(sugRes.body.suggestion.status, 'GENERATED');
    const suggestionId = sugRes.body.suggestion.id;

    // 4. Query Suggestions List
    console.log('[P11 E2E Test] 4. Query Suggestions List...');
    const listRes = await requestJson(ctx.origin, `/api/reports/${reportId}/sections/${sectionId}/ai/suggestions`, 'GET', undefined, pmSession);
    assert.equal(listRes.status, 200);
    assert.ok(listRes.body.suggestions.length >= 1);

    // 5. Apply Suggestion to Create New Unapproved DRAFT Revision
    console.log('[P11 E2E Test] 5. Apply Suggestion to Create DRAFT Revision...');
    const applyRes = await requestJson(ctx.origin, `/api/reports/${reportId}/sections/${sectionId}/ai/suggestions/${suggestionId}/apply`, 'POST', {
      expectedVersion: 1
    }, pmSession);
    assert.equal(applyRes.status, 200);
    assert.equal(applyRes.body.suggestion.status, 'APPLIED');
    assert.equal(applyRes.body.revision.revisionNumber, 1);

    console.log('[P11 E2E Test] PASS 100%!');
  } finally {
    await closeIsolated(ctx);
  }
}

if (require.main === module) {
  runP11E2ETest().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
