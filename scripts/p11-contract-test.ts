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

async function runP11ContractTests() {
  console.log('[P11 Contract Test] Initializing database and API server...');
  const ctx = await startIsolated('p11-contract-test');

  try {
    const fx = await createP09Fixture(ctx.origin, ctx.db);
    const pmSession = fx.pm;
    const staffSession = fx.staff;
    const reportId = fx.reportId;
    const sectionId = fx.sectionIds[0];

    // 1. Grounding Selection Manifest locking & re-validation
    console.log('[P11 Contract Test] 1. Grounding Selection Manifest Creation...');
    const selRes = await requestJson(ctx.origin, `/api/reports/${reportId}/sections/${sectionId}/grounding/selections`, 'POST', {
      providerId: 'CFG-LOCAL-FAKE-01',
      modelCode: 'fake-claim-v1',
      sources: [
        { sourceType: 'MATERIAL', sourceId: 'DOC-SYN-001', sourceVersionId: 'DOCVER-SYN-001', allowedAnchors: [0, 1] }
      ]
    }, pmSession);
    assert.equal(selRes.status, 201);
    assert.ok(selRes.body.selection.manifestSha256);
    const selectionId = selRes.body.selection.id;

    // 2. Scenario 1: Ungrounded Value / Amount -> UNGROUNDED & [확인 필요]
    console.log('[P11 Contract Test] 2. Scenario 1: Ungrounded Value Enforcement...');
    const ungRes = await requestJson(ctx.origin, `/api/reports/${reportId}/sections/${sectionId}/ai/suggestions`, 'POST', {
      selectionId,
      promptMode: 'TRIGGER_P11_UNGROUNDED',
      idempotencyKey: `IDEMP-UNG-${Date.now()}`
    }, pmSession);
    assert.equal(ungRes.status, 201);
    assert.equal(ungRes.body.suggestion.status, 'GENERATED');
    assert.ok(ungRes.body.suggestion.summaryText.includes('[확인 필요]'));
    assert.equal(ungRes.body.suggestion.citations[0].status, 'UNGROUNDED');

    // 3. Scenario 3: Prompt Injection Isolation
    console.log('[P11 Contract Test] 3. Scenario 3: Prompt Injection Isolation...');
    const injRes = await requestJson(ctx.origin, `/api/reports/${reportId}/sections/${sectionId}/ai/suggestions`, 'POST', {
      selectionId,
      promptMode: 'TRIGGER_P11_PROMPT_INJECTION',
      idempotencyKey: `IDEMP-INJ-${Date.now()}`
    }, pmSession);
    assert.equal(injRes.status, 201);
    assert.equal(injRes.body.suggestion.status, 'GENERATED');

    // 4. Scenario 8: Conflicting Sources Warning
    console.log('[P11 Contract Test] 4. Scenario 8: Conflicting Sources Handling...');
    const cnfRes = await requestJson(ctx.origin, `/api/reports/${reportId}/sections/${sectionId}/ai/suggestions`, 'POST', {
      selectionId,
      promptMode: 'TRIGGER_P11_CONFLICT',
      idempotencyKey: `IDEMP-CNF-${Date.now()}`
    }, pmSession);
    assert.equal(cnfRes.status, 201);
    assert.equal(cnfRes.body.suggestion.citations[0].status, 'CONFLICT');

    // 5. Scenario 10: Malformed Citation / Missing Anchor -> BLOCKED & Audit
    console.log('[P11 Contract Test] 5. Scenario 10: Malformed Citation Handling...');
    const malRes = await requestJson(ctx.origin, `/api/reports/${reportId}/sections/${sectionId}/ai/suggestions`, 'POST', {
      selectionId,
      promptMode: 'TRIGGER_P11_MALFORMED_CITATION',
      idempotencyKey: `IDEMP-MAL-${Date.now()}`
    }, pmSession);
    assert.equal(malRes.status, 201);
    assert.equal(malRes.body.suggestion.status, 'BLOCKED');

    const auditFailed = await ctx.db.auditLog.findFirst({ where: { action: 'AI_CITATION_FAILED' } });
    assert.ok(auditFailed);

    // 6. Scenario 11: Grounded Suggestion Apply -> Human 1-time Apply to DRAFT Revision
    console.log('[P11 Contract Test] 6. Scenario 11: Grounded Suggestion Human Apply...');
    const gndRes = await requestJson(ctx.origin, `/api/reports/${reportId}/sections/${sectionId}/ai/suggestions`, 'POST', {
      selectionId,
      promptMode: 'grounded_success',
      idempotencyKey: `IDEMP-GND-${Date.now()}`
    }, pmSession);
    assert.equal(gndRes.status, 201);
    const suggestionId = gndRes.body.suggestion.id;

    // Apply Suggestion (human explicit trigger)
    const applyRes = await requestJson(ctx.origin, `/api/reports/${reportId}/sections/${sectionId}/ai/suggestions/${suggestionId}/apply`, 'POST', {
      expectedVersion: 1
    }, pmSession);
    assert.equal(applyRes.status, 200);
    assert.equal(applyRes.body.suggestion.status, 'APPLIED');
    assert.equal(applyRes.body.revision.revisionNumber, 1);

    // Re-apply same suggestion -> 409 Conflict
    const reapplyRes = await requestJson(ctx.origin, `/api/reports/${reportId}/sections/${sectionId}/ai/suggestions/${suggestionId}/apply`, 'POST', {
      expectedVersion: 2
    }, pmSession);
    assert.equal(reapplyRes.status, 409);

    // Check AuditLog for AI_SUGGESTION_APPLIED
    const auditApplied = await ctx.db.auditLog.findFirst({ where: { action: 'AI_SUGGESTION_APPLIED' } });
    assert.ok(auditApplied);

    console.log('[P11 Contract Test] PASS 100%!');
  } finally {
    await closeIsolated(ctx);
  }
}

if (require.main === module) {
  runP11ContractTests().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
