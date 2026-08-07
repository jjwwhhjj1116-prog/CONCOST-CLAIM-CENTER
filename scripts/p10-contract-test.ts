import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { type AddressInfo } from 'node:net';
import { createPrismaClient, seedDatabase, resetDatabase, type PrismaClient } from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { assertSafeBaseUrl, assertSafeRedirectUrl, assertSafeResolvedBaseUrl, SsrfError } from '../apps/api/src/ai/ssrf-guard';
import { login, requestJson, P09_TEST_ORIGIN } from './p09-test-support';

const root = path.resolve(__dirname, '..');

async function startIsolated(name: string): Promise<{ db: PrismaClient; api: ManagedApiServer; origin: string; databasePath: string; uploadDir: string }> {
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

async function runP10ContractTests(): Promise<void> {
  console.log('P10 contract: SSRF/DNS, policy allowlist, full-payload idempotency, retries, cancel, budget race, immutable state');
  assert.throws(() => assertSafeBaseUrl('http://api.openai.com/v1', false, 'OPENAI'), SsrfError);
  assert.throws(() => assertSafeBaseUrl('https://user:pass@api.openai.com/v1', false, 'OPENAI'), SsrfError);
  assert.throws(() => assertSafeBaseUrl('https://api.openai.com:8443/v1', false, 'OPENAI'), SsrfError);
  assert.throws(() => assertSafeBaseUrl('https://127.0.0.1/v1'), SsrfError);
  assert.throws(() => assertSafeBaseUrl('https://attacker.example/v1', false, 'OPENAI'), SsrfError);
  assert.doesNotThrow(() => assertSafeBaseUrl('https://local-fake.invalid/v1', true, 'LOCAL_FAKE'));
  await assert.rejects(assertSafeResolvedBaseUrl('https://api.openai.com/v1', 'OPENAI', async () => ['127.0.0.1']), SsrfError);
  await assert.doesNotReject(assertSafeResolvedBaseUrl('https://api.openai.com/v1', 'OPENAI', async () => ['203.0.114.10']));
  await assert.rejects(assertSafeRedirectUrl('https://api.openai.com/v1', 'https://attacker.example/v1', 'OPENAI', async () => ['203.0.114.10']), SsrfError);

  const ctx = await startIsolated('p10-contract-test');
  try {
    const admin = await login(ctx.origin, 'admin@example.invalid');
    const pm = await login(ctx.origin, 'pm@example.invalid');

    const providers = await requestJson(ctx.origin, '/api/ai/providers', 'GET', undefined, admin);
    assert.equal(providers.status, 200);
    assert.equal(JSON.stringify(providers.body).includes('"secretRef"'), false);
    const ping = await requestJson(ctx.origin, '/api/ai/providers/CFG-LOCAL-FAKE-01/test', 'POST', undefined, admin);
    assert.deepEqual([ping.status, ping.body.ok, ping.body.status], [200, true, 'SUCCESS']);

    const idempotencyKey = `P10-IDEMP-${Date.now()}`;
    const payload = {
      caseId: 'CASE-SYN-001', providerConfigId: 'CFG-LOCAL-FAKE-01', modelCode: 'fake-claim-v1',
      prompt: 'Synthetic transport contract', idempotencyKey, maxTokens: 512
    };
    const first = await requestJson(ctx.origin, '/api/ai/requests', 'POST', payload, pm);
    assert.equal(first.status, 200);
    assert.equal(first.body.result.status, 'COMPLETED');
    const duplicate = await requestJson(ctx.origin, '/api/ai/requests', 'POST', payload, pm);
    assert.equal(duplicate.body.result.requestId, first.body.result.requestId);
    assert.equal(await ctx.db.aiUsageLedger.count({ where: { requestId: first.body.result.requestId } }), 2);

    for (const changed of [
      { ...payload, prompt: 'changed prompt' },
      { ...payload, modelCode: 'fake-analysis-v2' },
      { ...payload, maxTokens: 513 }
    ]) {
      const conflict = await requestJson(ctx.origin, '/api/ai/requests', 'POST', changed, pm);
      assert.equal(conflict.status, 409, 'every material payload change must conflict for the same idempotency key');
    }

    await ctx.db.aiProviderConfig.create({
      data: {
        id: 'CFG-NOT-ALLOWED', organizationId: 'ORG-SYN-A', providerKind: 'LOCAL_FAKE', name: 'Not policy allowed',
        baseUrl: 'https://local-fake.invalid/v1', secretRef: 'LOCAL_FAKE', allowedModelsJson: '["fake-claim-v1"]', updatedAt: new Date()
      }
    });
    const disallowed = await requestJson(ctx.origin, '/api/ai/requests', 'POST', {
      ...payload, providerConfigId: 'CFG-NOT-ALLOWED', idempotencyKey: `P10-NOTALLOWED-${Date.now()}`
    }, pm);
    assert.equal(disallowed.status, 403);

    const rateLimited = await requestJson(ctx.origin, '/api/ai/requests', 'POST', {
      ...payload, prompt: 'TRIGGER_RATE_LIMIT', idempotencyKey: `P10-RATE-${Date.now()}`
    }, pm);
    assert.equal(rateLimited.body.result.status, 'FAILED');
    assert.equal(rateLimited.body.result.attemptsCount, 4);
    const badKey = await requestJson(ctx.origin, '/api/ai/requests', 'POST', {
      ...payload, prompt: 'TRIGGER_BAD_KEY', idempotencyKey: `P10-BADKEY-${Date.now()}`
    }, pm);
    assert.equal(badKey.body.result.attemptsCount, 1);

    for (const [trigger, expectedAttempts, expectedMinimumCost] of [
      ['TRIGGER_TIMEOUT', 4, 0],
      ['TRIGGER_SERVER_ERROR', 4, 0],
      ['TRIGGER_MALFORMED_SCHEMA', 1, 600],
      ['TRIGGER_STREAM_ABORT', 4, 4_400]
    ] as const) {
      const failed = await requestJson(ctx.origin, '/api/ai/requests', 'POST', {
        ...payload, prompt: trigger, idempotencyKey: `P10-${trigger}-${Date.now()}`
      }, pm);
      assert.equal(failed.body.result.status, 'FAILED');
      assert.equal(failed.body.result.attemptsCount, expectedAttempts);
      assert.ok(failed.body.result.actualCostMicros >= expectedMinimumCost, `${trigger} consumed cost must be ledgered across attempts`);
      assert.equal(await ctx.db.aiGenerationAttempt.count({ where: { requestId: failed.body.result.requestId } }), expectedAttempts);
    }

    await ctx.db.aiCasePolicy.update({ where: { caseId: 'CASE-SYN-001' }, data: { maxCostMicrosPerRequest: 100 } });
    const costBlocked = await requestJson(ctx.origin, '/api/ai/requests', 'POST', {
      ...payload, maxTokens: 50, idempotencyKey: `P10-COST-BLOCK-${Date.now()}`
    }, pm);
    assert.equal(costBlocked.status, 400);
    await ctx.db.aiCasePolicy.update({ where: { caseId: 'CASE-SYN-001' }, data: { maxCostMicrosPerRequest: 1_000_000 } });

    const asyncRequest = await requestJson(ctx.origin, '/api/ai/requests', 'POST', {
      ...payload, prompt: 'TRIGGER_SLOW_SUCCESS', idempotencyKey: `P10-CANCEL-${Date.now()}`, waitForCompletion: false
    }, pm);
    assert.deepEqual([asyncRequest.status, asyncRequest.body.result.status], [202, 'PROCESSING']);
    const canceled = await requestJson(ctx.origin, `/api/ai/requests/${asyncRequest.body.result.requestId}/cancel`, 'POST', undefined, pm);
    assert.equal(canceled.body.result.status, 'CANCELED');
    await new Promise((resolve) => setTimeout(resolve, 900));
    const canceledRow = await ctx.db.aiGenerationRequest.findUniqueOrThrow({ where: { id: asyncRequest.body.result.requestId } });
    assert.equal(canceledRow.status, 'CANCELED', 'late provider completion must not overwrite cancellation');
    const canceledLedger = await ctx.db.aiUsageLedger.aggregate({ where: { requestId: canceledRow.id }, _sum: { costMicros: true } });
    assert.equal(canceledLedger._sum.costMicros, 0, 'cancellation must release the full reservation');

    const usedBeforeRace = await ctx.db.aiUsageLedger.aggregate({
      where: { organizationId: 'ORG-SYN-A', providerConfigId: 'CFG-LOCAL-FAKE-01' }, _sum: { costMicros: true }
    });
    await ctx.db.aiProviderConfig.update({
      where: { id: 'CFG-LOCAL-FAKE-01' },
      data: { dailyBudgetMicros: (usedBeforeRace._sum.costMicros ?? 0) + 10_000 }
    });
    const racePayload = (suffix: string) => ({
      ...payload, prompt: `TRIGGER_SLOW_SUCCESS ${suffix}`, idempotencyKey: `P10-RACE-${suffix}-${Date.now()}`, maxTokens: 1000
    });
    const race = await Promise.all([
      requestJson(ctx.origin, '/api/ai/requests', 'POST', racePayload('A'), pm),
      requestJson(ctx.origin, '/api/ai/requests', 'POST', racePayload('B'), pm)
    ]);
    assert.deepEqual(race.map((result) => result.status).sort((a, b) => a - b), [200, 429], 'concurrent reservation must admit only one request');

    const terminalId = first.body.result.requestId as string;
    await assert.rejects(ctx.db.aiGenerationRequest.update({ where: { id: terminalId }, data: { actualCostMicros: 999 } }));
    await assert.rejects(ctx.db.aiGenerationRequest.delete({ where: { id: terminalId } }));
    const attempt = await ctx.db.aiGenerationAttempt.findFirstOrThrow({ where: { requestId: terminalId } });
    await assert.rejects(ctx.db.aiGenerationAttempt.update({ where: { id: attempt.id }, data: { durationMs: 999 } }));
    const ledger = await ctx.db.aiUsageLedger.findFirstOrThrow({ where: { requestId: terminalId } });
    await assert.rejects(ctx.db.aiUsageLedger.delete({ where: { id: ledger.id } }));

    const auditActions = new Set((await ctx.db.auditLog.findMany({ where: { action: { startsWith: 'AI_GENERATION_' } }, select: { action: true } })).map((row) => row.action));
    for (const action of [
      'AI_GENERATION_STARTED', 'AI_GENERATION_COMPLETED', 'AI_GENERATION_FAILED', 'AI_GENERATION_CANCELED',
      'AI_GENERATION_POLICY_BLOCKED', 'AI_GENERATION_BUDGET_BLOCKED'
    ]) assert.ok(auditActions.has(action), `Missing P10 audit action: ${action}`);

    console.log('P10 contract: PASSED');
  } finally {
    await closeIsolated(ctx);
  }
}

if (require.main === module) void runP10ContractTests().catch((error) => { console.error(error); process.exitCode = 1; });
