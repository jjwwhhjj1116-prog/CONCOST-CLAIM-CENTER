import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { type AddressInfo } from 'node:net';
import { createPrismaClient, seedDatabase, resetDatabase, type PrismaClient } from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { login, requestJson, P09_TEST_ORIGIN } from './p09-test-support';

const root = path.resolve(__dirname, '..');

async function suppressExpectedServerError<T>(task: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => undefined;
  try { return await task(); } finally { console.error = original; }
}

async function fixture(): Promise<{ db: PrismaClient; api: ManagedApiServer; origin: string; databasePath: string; uploadDir: string }> {
  const databasePath = path.join(root, 'packages/database/.data', `p10-security-${process.pid}-${Date.now()}.db`);
  const uploadDir = `${databasePath}-uploads`;
  const databaseUrl = `file:${databasePath}`;
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const db = createPrismaClient(databaseUrl);
  const api = createApiServer({ databaseUrl, allowedOrigins: [P09_TEST_ORIGIN], secureCookies: false, uploadDir });
  await new Promise<void>((resolve, reject) => api.once('error', reject).listen(0, '127.0.0.1', resolve));
  return { db, api, origin: `http://127.0.0.1:${(api.address() as AddressInfo).port}`, databasePath, uploadDir };
}

async function main(): Promise<void> {
  console.log('P10 security: RBAC/IDOR, zero-secret, default deny, tenant integrity, audit rollback');
  const ctx = await fixture();
  try {
    const admin = await login(ctx.origin, 'admin@example.invalid');
    const pm = await login(ctx.origin, 'pm@example.invalid');
    const staff = await login(ctx.origin, 'staff@example.invalid');
    assert.equal((await requestJson(ctx.origin, '/api/ai/providers', 'GET', undefined, staff)).status, 403);
    const adminProviders = await requestJson(ctx.origin, '/api/ai/providers', 'GET', undefined, admin);
    const providerText = JSON.stringify(adminProviders.body);
    assert.equal(/"secretRef"\s*:/.test(providerText), false);
    assert.equal(/(?:sk-|Bearer\s|fake-synthetic-local-key)/i.test(providerText), false);

    const rawSecret = ['sk', 'proj', 'THIS_IS_A_RAW_SECRET_123456789'].join('-');
    const rawResponse = await requestJson(ctx.origin, '/api/ai/providers', 'POST', {
      providerKind: 'OPENAI', name: 'Bad', baseUrl: 'https://api.openai.com/v1', secretRef: rawSecret,
      allowedModels: ['gpt-test'], dailyBudgetMicros: 1000
    }, admin);
    assert.equal(rawResponse.status, 400);
    assert.equal(JSON.stringify(rawResponse.body).includes(rawSecret), false);
    await assert.rejects(ctx.db.aiProviderConfig.create({
      data: {
        id: 'CFG-RAW', organizationId: 'ORG-SYN-A', providerKind: 'OPENAI', name: 'Raw', baseUrl: 'https://api.openai.com/v1',
        secretRef: rawSecret, allowedModelsJson: '[]', updatedAt: new Date()
      }
    }));

    const blocked = await requestJson(ctx.origin, '/api/ai/requests', 'POST', {
      caseId: 'CASE-SYN-003', providerConfigId: 'CFG-LOCAL-FAKE-01', modelCode: 'fake-claim-v1', prompt: 'forbidden', idempotencyKey: 'P10-BLOCKED'
    }, admin);
    assert.equal(blocked.status, 403);
    await ctx.db.aiCasePolicy.delete({ where: { caseId: 'CASE-SYN-001' } });
    const defaultDenied = await requestJson(ctx.origin, '/api/ai/requests', 'POST', {
      caseId: 'CASE-SYN-001', providerConfigId: 'CFG-LOCAL-FAKE-01', modelCode: 'fake-claim-v1', prompt: 'no policy', idempotencyKey: 'P10-NO-POLICY'
    }, pm);
    assert.equal(defaultDenied.status, 403);
    await ctx.db.aiCasePolicy.create({
      data: { id: 'POL-RESTORED', caseId: 'CASE-SYN-001', externalAiAllowed: true, maxTokensPerRequest: 4096, maxCostMicrosPerRequest: 1_000_000, allowedProviderIdsJson: '["CFG-LOCAL-FAKE-01"]' }
    });

    await ctx.db.aiProviderConfig.create({
      data: {
        id: 'CFG-ORG-B', organizationId: 'ORG-SYN-B', providerKind: 'LOCAL_FAKE', name: 'Other tenant',
        baseUrl: 'https://local-fake.invalid/v1', secretRef: 'LOCAL_FAKE', allowedModelsJson: '["fake-claim-v1"]', updatedAt: new Date()
      }
    });
    const crossTenantUpdate = await requestJson(ctx.origin, '/api/ai/providers', 'POST', {
      id: 'CFG-ORG-B', providerKind: 'LOCAL_FAKE', name: 'Hijacked', baseUrl: 'https://local-fake.invalid/v1', secretRef: 'LOCAL_FAKE', allowedModels: ['fake-claim-v1']
    }, admin);
    assert.equal(crossTenantUpdate.status, 403);
    assert.equal((await ctx.db.aiProviderConfig.findUniqueOrThrow({ where: { id: 'CFG-ORG-B' } })).name, 'Other tenant');

    const created = await requestJson(ctx.origin, '/api/ai/requests', 'POST', {
      caseId: 'CASE-SYN-001', providerConfigId: 'CFG-LOCAL-FAKE-01', modelCode: 'fake-claim-v1', prompt: 'actor scoped', idempotencyKey: 'P10-ACTOR-SCOPE'
    }, pm);
    const requestId = created.body.result.requestId as string;
    assert.equal((await requestJson(ctx.origin, `/api/ai/requests/${requestId}`, 'GET', undefined, staff)).status, 403);
    assert.equal((await requestJson(ctx.origin, `/api/ai/requests/${requestId}/cancel`, 'POST', undefined, staff)).status, 403);

    await ctx.db.$executeRawUnsafe(`CREATE TRIGGER P10_TEST_FAIL_PROVIDER_AUDIT BEFORE INSERT ON AuditLog WHEN NEW.action = 'AI_PROVIDER_CONFIGURED' BEGIN SELECT RAISE(FAIL, 'forced audit failure'); END`);
    const auditProviderId = `CFG-AUDIT-${Date.now()}`;
    const failedProvider = await suppressExpectedServerError(() => requestJson(ctx.origin, '/api/ai/providers', 'POST', {
      id: auditProviderId, providerKind: 'LOCAL_FAKE', name: 'Must rollback', baseUrl: 'https://local-fake.invalid/v1',
      secretRef: 'LOCAL_FAKE', allowedModels: ['fake-claim-v1'], dailyBudgetMicros: 10000
    }, admin));
    assert.equal(failedProvider.status, 500);
    assert.equal(await ctx.db.aiProviderConfig.count({ where: { id: auditProviderId } }), 0);
    await ctx.db.$executeRawUnsafe('DROP TRIGGER P10_TEST_FAIL_PROVIDER_AUDIT');

    await ctx.db.$executeRawUnsafe(`CREATE TRIGGER P10_TEST_FAIL_REQUEST_AUDIT BEFORE INSERT ON AuditLog WHEN NEW.action = 'AI_GENERATION_STARTED' BEGIN SELECT RAISE(FAIL, 'forced request audit failure'); END`);
    const failedIdempotency = `P10-AUDIT-REQUEST-${Date.now()}`;
    const failedRequest = await suppressExpectedServerError(() => requestJson(ctx.origin, '/api/ai/requests', 'POST', {
      caseId: 'CASE-SYN-001', providerConfigId: 'CFG-LOCAL-FAKE-01', modelCode: 'fake-claim-v1', prompt: 'must rollback', idempotencyKey: failedIdempotency
    }, pm));
    assert.equal(failedRequest.status, 500);
    assert.equal(await ctx.db.aiGenerationRequest.count({ where: { idempotencyKey: failedIdempotency } }), 0);
    assert.equal(await ctx.db.aiUsageLedger.count({ where: { request: { idempotencyKey: failedIdempotency } } }), 0);

    await assert.rejects(ctx.db.$executeRawUnsafe(
      `INSERT INTO AiGenerationRequest (id, organizationId, caseId, userId, providerConfigId, modelCode, status, promptSha256, requestFingerprintSha256, idempotencyKey, reservedCostMicros, actualCostMicros, totalTokens, responseMetadataJson, createdAt, updatedAt) VALUES ('CROSS-TENANT', 'ORG-SYN-B', 'CASE-SYN-001', 'USR-PM', 'CFG-ORG-B', 'fake-claim-v1', 'PROCESSING', 'x', 'y', 'z', 1, 0, 0, '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ));
    console.log('P10 security: PASSED');
  } finally {
    await new Promise<void>((resolve) => ctx.api.close(() => resolve()));
    await ctx.api.waitForDatabaseClose();
    await ctx.db.$disconnect();
    fs.rmSync(ctx.uploadDir, { recursive: true, force: true });
    for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${ctx.databasePath}${suffix}`, { force: true });
  }
}

if (require.main === module) void main().catch((error) => { console.error(error); process.exitCode = 1; });
