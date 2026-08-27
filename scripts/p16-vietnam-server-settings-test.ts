import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createPrismaClient, databaseUrlFor, resetDatabase, seedDatabase } from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';

const allowedOrigin = 'https://claimcenterstudio.con-cost.co.kr';
const databasePath = path.join(process.cwd(), 'packages/database/.data', `p16-vietnam-settings-${process.pid}.db`);
const databaseUrl = databaseUrlFor(databasePath);
const apiKey = 'AIza-synthetic-server-settings-key-123456789';
const masterKey = crypto.createHash('sha256').update('p16 vietnam settings adapter').digest('hex');
const providerCheckUrls: string[] = [];
const settingsFetcher = (async (input: string | URL | Request) => {
  providerCheckUrls.push(String(input));
  return new Response('{"models":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;

interface Result { status: number; body: Record<string, any>; headers: http.IncomingHttpHeaders }

async function listen(server: ManagedApiServer): Promise<string> {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: ManagedApiServer): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await server.waitForDatabaseClose();
}

function request(origin: string, pathname: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}): Promise<Result> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request(origin + pathname, { method, headers: { ...headers, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {}) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode ?? 500, body: text ? JSON.parse(text) : {}, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function createServer(): ManagedApiServer {
  return createApiServer({
    databaseUrl,
    allowedOrigins: [allowedOrigin],
    environment: {
      AI_CREDENTIAL_MASTER_KEY: masterKey
    },
    settingsFetcher
  });
}

async function login(origin: string): Promise<{ cookie: string; csrf: string }> {
  const response = await request(origin, '/auth/login', 'POST', { loginId: 'admin', password: 'Password123!' }, { Origin: allowedOrigin });
  assert.equal(response.status, 200);
  const setCookies = response.headers['set-cookie'] ?? [];
  return { cookie: setCookies.map((value) => value.split(';')[0]).join('; '), csrf: String(response.body.csrfToken) };
}

function mutation(session: { cookie: string; csrf: string }): Record<string, string> {
  return { Cookie: session.cookie, Origin: allowedOrigin, 'X-CSRF-Token': session.csrf };
}

test('Vietnam Node server keeps official-domain CORS and Admin settings in encrypted SQLite rows across restart', async () => {
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  let server = createServer();
  try {
    let origin = await listen(server);
    const preflight = await request(origin, '/api/settings/admin-workspace', 'OPTIONS', undefined, {
      Origin: allowedOrigin,
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type,x-csrf-token,idempotency-key'
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], allowedOrigin);
    assert.match(String(preflight.headers['access-control-allow-headers']), /Idempotency-Key/u);

    const hostile = await request(origin, '/auth/login', 'POST', { loginId: 'admin', password: 'Password123!' }, { Origin: 'https://evil.invalid' });
    assert.equal(hostile.status, 403);

    const session = await login(origin);
    const initial = await request(origin, '/api/settings/ai-credentials', 'GET', undefined, { Cookie: session.cookie });
    assert.equal(initial.status, 200);
    assert.equal(initial.body.masterKeyReady, true);

    const savedWorkspace = await request(origin, '/api/settings/admin-workspace', 'PUT', {
      organizationName: 'CONCOST Claim Center', localAiMode: 'PRIVATE_SERVER_BRIDGE', memoryProvider: 'HERMES_AGENT',
      memoryApprovalMode: 'ADMIN_REVIEW', shortTermMemoryEnabled: true, longTermMemoryEnabled: true, expectedVersion: 0
    }, mutation(session));
    assert.equal(savedWorkspace.status, 200);
    assert.equal(savedWorkspace.body.settings.version, 1);

    const savedCredential = await request(origin, '/api/settings/ai-credentials/GEMINI', 'PUT', {
      scope: 'ORGANIZATION', apiKey, expectedVersion: 0
    }, mutation(session));
    assert.equal(savedCredential.status, 200);
    assert.equal(savedCredential.body.providers.find((provider: any) => provider.providerKind === 'GEMINI').organization.configured, true);
    assert.doesNotMatch(JSON.stringify(savedCredential.body), new RegExp(apiKey, 'u'));

    const verifiedCredential = await request(origin, '/api/settings/ai-credentials/GEMINI/test', 'POST', {
      scope: 'ORGANIZATION'
    }, mutation(session));
    assert.equal(verifiedCredential.status, 200);
    assert.equal(verifiedCredential.body.source, 'LIVE_GEMINI');
    assert.equal(providerCheckUrls.length, 1);
    assert.equal(new URL(providerCheckUrls[0]).origin, 'https://generativelanguage.googleapis.com');

    await close(server);
    server = createServer();
    origin = await listen(server);
    const secondSession = await login(origin);
    const reloaded = await request(origin, '/api/settings/admin-workspace', 'GET', undefined, { Cookie: secondSession.cookie });
    assert.equal(reloaded.status, 200);
    assert.equal(reloaded.body.settings.organizationName, 'CONCOST Claim Center');
    assert.equal(reloaded.body.settings.version, 1);
    const credentials = await request(origin, '/api/settings/ai-credentials', 'GET', undefined, { Cookie: secondSession.cookie });
    assert.equal(credentials.body.providers.find((provider: any) => provider.providerKind === 'GEMINI').organization.configured, true);

    const db = createPrismaClient(databaseUrl);
    const rows = await db.$queryRawUnsafe<Array<{ secretCiphertext: string; valueJson: string }>>(
      'SELECT "secretCiphertext","valueJson" FROM "ServerSetting" WHERE "settingKey"=?', 'AI_CREDENTIAL:GEMINI'
    );
    await db.$disconnect();
    assert.equal(rows.length, 1);
    assert.ok(rows[0].secretCiphertext.length > 20);
    assert.doesNotMatch(JSON.stringify(rows), new RegExp(apiKey, 'u'));
  } finally {
    if (server.listening) await close(server);
    for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});
