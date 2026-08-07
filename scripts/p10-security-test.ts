import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { type AddressInfo } from 'node:net';
import { createPrismaClient, seedDatabase, resetDatabase, type PrismaClient } from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
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

async function runP10SecurityTests() {
  console.log('[P10 Security Test] Initializing database and API server...');
  const ctx = await startIsolated('p10-security-test');

  try {
    const adminSession = await login(ctx.origin, 'admin@example.invalid');
    const staffSession = await login(ctx.origin, 'staff@example.invalid');

    // 1. Admin API Authorization Boundary (/api/ai/providers)
    console.log('[P10 Security Test] 1. Admin RBAC Guard Verification...');
    const staffAccessRes = await requestJson(ctx.origin, '/api/ai/providers', 'GET', undefined, staffSession);
    assert.equal(staffAccessRes.status, 403);

    const adminAccessRes = await requestJson(ctx.origin, '/api/ai/providers', 'GET', undefined, adminSession);
    assert.equal(adminAccessRes.status, 200);

    // 2. Raw Secret Key Leakage Check in API Response & DB
    console.log('[P10 Security Test] 2. Raw Secret Zero-Leakage Verification...');
    const provBody = JSON.stringify(adminAccessRes.body);
    assert.equal(provBody.includes('sk-'), false);
    assert.equal(provBody.includes('key-'), false);
    assert.equal(provBody.includes('Bearer '), false);

    // Verify DB secretRef does not store raw secrets
    const dbConfigs = await ctx.db.aiProviderConfig.findMany();
    for (const cfg of dbConfigs) {
      assert.equal(cfg.secretRef.startsWith('sk-'), false);
      assert.equal(cfg.secretRef.startsWith('key-'), false);
    }

    // DB Trigger Block Raw Secret Insertion
    await assert.rejects(async () => {
      await ctx.db.$executeRawUnsafe(
        `INSERT INTO AiProviderConfig (id, organizationId, providerKind, name, baseUrl, secretRef, status, allowedModelsJson, timeoutMs, maxRetries, dailyBudgetMicros, version, createdAt, updatedAt) ` +
        `VALUES ('CFG-BAD-${Date.now()}', 'ORG-SYN-A', 'OPENAI', 'Bad Config', 'https://api.openai.com/v1', 'sk-proj-raw-secret-key-that-must-be-blocked', 'ACTIVE', '[]', 30000, 3, 100000000, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      );
    }, /P10: Raw secret or API key string cannot be stored/);

    // 3. externalAiAllowed=false Case Security Enforcement
    console.log('[P10 Security Test] 3. External AI Forbidden Policy Enforcement...');
    // CASE-SYN-003 has externalAiAllowed=false
    const reqBlockedRes = await requestJson(ctx.origin, '/api/ai/requests', 'POST', {
      caseId: 'CASE-SYN-003',
      providerConfigId: 'CFG-LOCAL-FAKE-01',
      modelCode: 'fake-claim-v1',
      prompt: 'Attempting external transmission on forbidden case',
      idempotencyKey: `IDEMP-BLOCKED-${Date.now()}`
    }, adminSession);
    assert.equal(reqBlockedRes.status, 403);

    console.log('[P10 Security Test] PASS 100%!');
  } finally {
    await closeIsolated(ctx);
  }
}

if (require.main === module) {
  runP10SecurityTests().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
