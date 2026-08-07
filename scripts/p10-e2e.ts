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

async function runP10E2ETest() {
  console.log('[P10 E2E Test] Initializing database and API server...');
  const ctx = await startIsolated('p10-e2e-test');

  try {
    // 1. Admin Login & Session Cookie
    console.log('[P10 E2E Test] 1. Admin Login...');
    const adminSession = await login(ctx.origin, 'admin@example.invalid');

    // 2. Query AI Providers (AI-01 Route Backend API)
    console.log('[P10 E2E Test] 2. Query AI Providers list...');
    const provRes = await requestJson(ctx.origin, '/api/ai/providers', 'GET', undefined, adminSession);
    assert.equal(provRes.status, 200);
    assert.ok(provRes.body.providers.length >= 1);

    // 3. Test Provider Connection Ping
    console.log('[P10 E2E Test] 3. Test Provider Ping...');
    const pingRes = await requestJson(ctx.origin, '/api/ai/providers/CFG-LOCAL-FAKE-01/test', 'POST', undefined, adminSession);
    assert.equal(pingRes.status, 200);
    assert.equal(pingRes.body.ok, true);

    // 4. Test Report Studio AI Gateway Integration
    console.log('[P10 E2E Test] 4. Test Report Studio AI Integration API...');
    const reqRes = await requestJson(ctx.origin, '/api/ai/requests', 'POST', {
      caseId: 'CASE-SYN-001',
      providerConfigId: 'CFG-LOCAL-FAKE-01',
      modelCode: 'fake-claim-v1',
      prompt: 'P10 E2E Report Studio Integration Test Prompt',
      idempotencyKey: `IDEMP-E2E-${Date.now()}`
    }, adminSession);
    assert.equal(reqRes.status, 200);
    assert.equal(reqRes.body.result.status, 'COMPLETED');
    assert.ok(reqRes.body.result.totalTokens > 0);

    // 5. Query Usage Ledger Summary
    console.log('[P10 E2E Test] 5. Query Usage Summary...');
    const usageRes = await requestJson(ctx.origin, '/api/ai/usage', 'GET', undefined, adminSession);
    assert.equal(usageRes.status, 200);
    assert.ok(usageRes.body.summary.totalTokens > 0);

    console.log('[P10 E2E Test] PASS 100%!');
  } finally {
    await closeIsolated(ctx);
  }
}

if (require.main === module) {
  runP10E2ETest().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
