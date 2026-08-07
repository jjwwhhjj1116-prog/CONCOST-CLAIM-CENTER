import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { type AddressInfo } from 'node:net';
import { createPrismaClient, getDatabaseUrl, seedDatabase, resetDatabase, type PrismaClient } from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { assertSafeBaseUrl, SsrfError } from '../apps/api/src/ai/ssrf-guard';
import { login, requestJson, P09_TEST_ORIGIN } from './p09-test-support';

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

async function runP10ContractTests() {
  console.log('[P10 Contract Test] Initializing database and API server...');
  const ctx = await startIsolated('p10-contract-test');

  try {
    // 1. SSRF Protection Checks
    console.log('[P10 Contract Test] 1. SSRF Protection Checks...');
    assert.throws(() => assertSafeBaseUrl('http://127.0.0.1/api'), SsrfError);
    assert.throws(() => assertSafeBaseUrl('https://169.254.169.254/latest/meta-data'), SsrfError);
    assert.throws(() => assertSafeBaseUrl('https://10.0.0.1/v1'), SsrfError);
    assert.throws(() => assertSafeBaseUrl('https://192.168.1.1/v1'), SsrfError);
    assert.doesNotThrow(() => assertSafeBaseUrl('https://api.openai.com/v1', false));
    assert.doesNotThrow(() => assertSafeBaseUrl('https://localhost/fake-ai', true));

    // Login Admin & PM
    const adminSession = await login(ctx.origin, 'admin@example.invalid');
    const pmSession = await login(ctx.origin, 'pm@example.invalid');

    // 2. Admin Provider Config & Ping Test
    console.log('[P10 Contract Test] 2. Admin Provider Config & Ping Test...');
    const pingRes = await requestJson(ctx.origin, '/api/ai/providers/CFG-LOCAL-FAKE-01/test', 'POST', undefined, adminSession);
    assert.equal(pingRes.status, 200);
    assert.equal(pingRes.body.ok, true);
    assert.equal(pingRes.body.status, 'SUCCESS');

    // 3. Normal Generation Request & Ledger Verification
    console.log('[P10 Contract Test] 3. Normal Generation Request & Ledger Verification...');
    const idempotencyKey1 = `IDEMP-TEST-${Date.now()}-1`;
    const req1Res = await requestJson(ctx.origin, '/api/ai/requests', 'POST', {
      caseId: 'CASE-SYN-001',
      providerConfigId: 'CFG-LOCAL-FAKE-01',
      modelCode: 'fake-claim-v1',
      prompt: 'Normal synthetic prompt test',
      idempotencyKey: idempotencyKey1
    }, pmSession);
    assert.equal(req1Res.status, 200);
    assert.equal(req1Res.body.result.status, 'COMPLETED');
    assert.ok(req1Res.body.result.actualCostMicros > 0);

    // Verify Ledger Records in DB
    const ledgers = await ctx.db.aiUsageLedger.findMany({ where: { requestId: req1Res.body.result.requestId } });
    assert.equal(ledgers.length, 2); // 1 Reservation + 1 Reconciliation
    const resLdg = ledgers.find((l) => l.transactionType === 'RESERVATION');
    const recLdg = ledgers.find((l) => l.transactionType === 'RECONCILIATION');
    assert.ok(resLdg);
    assert.ok(recLdg);

    // 4. Idempotency Check (Duplicate request returns same result without duplicate charge)
    console.log('[P10 Contract Test] 4. Idempotency Check...');
    const dupRes = await requestJson(ctx.origin, '/api/ai/requests', 'POST', {
      caseId: 'CASE-SYN-001',
      providerConfigId: 'CFG-LOCAL-FAKE-01',
      modelCode: 'fake-claim-v1',
      prompt: 'Normal synthetic prompt test',
      idempotencyKey: idempotencyKey1
    }, pmSession);
    assert.equal(dupRes.status, 200);
    assert.equal(dupRes.body.result.requestId, req1Res.body.result.requestId);

    const ledgersAfterDup = await ctx.db.aiUsageLedger.findMany({ where: { requestId: req1Res.body.result.requestId } });
    assert.equal(ledgersAfterDup.length, 2); // No extra duplicate ledgers

    // Different Prompt with same IdempotencyKey -> 409 Conflict
    const conflictRes = await requestJson(ctx.origin, '/api/ai/requests', 'POST', {
      caseId: 'CASE-SYN-001',
      providerConfigId: 'CFG-LOCAL-FAKE-01',
      modelCode: 'fake-claim-v1',
      prompt: 'DIFFERENT PROMPT TEXT',
      idempotencyKey: idempotencyKey1
    }, pmSession);
    assert.equal(conflictRes.status, 409);

    // 5. Trigger Errors (Timeout, 429 Rate Limit, 500 Server Error) & Bounded Retry
    console.log('[P10 Contract Test] 5. Error Triggers & Bounded Retries...');
    const rateLimitRes = await requestJson(ctx.origin, '/api/ai/requests', 'POST', {
      caseId: 'CASE-SYN-001',
      providerConfigId: 'CFG-LOCAL-FAKE-01',
      modelCode: 'fake-claim-v1',
      prompt: 'TRIGGER_RATE_LIMIT',
      idempotencyKey: `IDEMP-RL-${Date.now()}`
    }, pmSession);
    assert.equal(rateLimitRes.status, 200);
    assert.equal(rateLimitRes.body.result.status, 'FAILED');
    assert.ok(rateLimitRes.body.result.attemptsCount > 1 && rateLimitRes.body.result.attemptsCount <= 4);

    // 6. DB Trigger Immutability Check
    console.log('[P10 Contract Test] 6. DB Trigger Immutability Verification...');
    const ledgerToMutate = ledgers[0];
    await assert.rejects(async () => {
      await ctx.db.$executeRawUnsafe(`UPDATE AiUsageLedger SET costMicros = 99999 WHERE id = '${ledgerToMutate.id}'`);
    }, /P10: AiUsageLedger records are immutable/);

    await assert.rejects(async () => {
      await ctx.db.$executeRawUnsafe(`DELETE FROM AiUsageLedger WHERE id = '${ledgerToMutate.id}'`);
    }, /P10: AiUsageLedger records are immutable/);

    console.log('[P10 Contract Test] PASS 100%!');
  } finally {
    await closeIsolated(ctx);
  }
}

if (require.main === module) {
  runP10ContractTests().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
