import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPrismaClient, databaseUrlFor, migrateDatabase, seedDatabase } from '../packages/database/src';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';

// Reuses the Vietnam settings test's actual Node HTTP/login/settings/SQLite path.
// The only database is newly created under a validated unique temporary directory.
const allowedOrigin = 'https://cf132-node.example.invalid';
const key = 'CF132NODESYNTHETICKEY012345';
const nextKey = 'CF132NODENEWKEY01234567890';
const masterKey = createHash('sha256').update('CF132 isolated Node test only').digest('hex');
type Result = { status: number; body: Record<string, any>; headers: http.IncomingHttpHeaders };
function request(origin: string, pathname: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}): Promise<Result> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    // Simulates the public same-origin Host forwarded to this loopback-only API.
    const req = http.request(origin + pathname, { method, headers: { Host: new URL(allowedOrigin).host, ...headers, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {}) } }, res => {
      const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => { try { const text = Buffer.concat(chunks).toString('utf8'); resolve({ status: res.statusCode ?? 500, body: text ? JSON.parse(text) : {}, headers: res.headers }); } catch (error) { reject(error); } });
    });
    req.setTimeout(10000, () => req.destroy(new Error('CF132 synthetic localhost request timeout'))); req.on('error', reject);
    if (payload) req.write(payload); req.end();
  });
}
function result(response: Result, expected = 200): any { assert.equal(response.status, expected, JSON.stringify(response.body)); return response.body; }
async function listen(server: ManagedApiServer) {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function close(server: ManagedApiServer) { await new Promise<void>(resolve => server.close(() => resolve())); await server.waitForDatabaseClose(); }
async function login(origin: string, loginId = 'admin') {
  const response = await request(origin, '/auth/login', 'POST', { loginId, password: 'Password123!' }, { Origin: allowedOrigin }); result(response);
  return { Cookie: (response.headers['set-cookie'] ?? []).map(value => value.split(';')[0]).join('; '), Origin: allowedOrigin, 'X-CSRF-Token': String(response.body.csrfToken) };
}

test('CF132 actual Node save/get/test/source enforces ACL/CAS, encrypts ECOS independently and survives restart without changing other settings', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'cf132-node-ecos-')), databasePath = path.join(directory, 'synthetic.db'), databaseUrl = databaseUrlFor(databasePath);
  const calls: URL[] = []; let failure = false; let server: ManagedApiServer | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input)); calls.push(url);
    assert.equal(url.origin, 'https://ecos.bok.or.kr'); assert.equal(init?.redirect, 'manual'); assert.ok(init?.signal);
    if (failure) throw new Error('synthetic provider URL contains ' + key);
    const parts = url.pathname.split('/').filter(Boolean), code = parts[11];
    const names: Record<string, string> = { '201AA': '광산품', '3AA': '공산품', '4AA': '전력,가스,수도및폐기물', '101AA': '농림수산품' }; assert.ok(names[code]);
    return Response.json({ StatisticSearch: { list_total_count: 1, row: [{ STAT_CODE: '404Y014', ITEM_CODE1: code, ITEM_NAME1: names[code], UNIT_NAME: '2020=100', TIME: parts[9], DATA_VALUE: '123.45' }] } });
  };
  const newServer = () => createApiServer({ databaseUrl, allowedOrigins: [allowedOrigin], environment: { AI_CREDENTIAL_MASTER_KEY: masterKey }, settingsFetcher: fetcher, uploadDir: path.join(directory, 'uploads'), backupRootDir: path.join(directory, 'backups'), restoreRootDir: path.join(directory, 'restores'), credentialVaultDir: path.join(directory, 'vault'), pkceVaultDir: path.join(directory, 'pkce') });
  try {
    await migrateDatabase(databaseUrl); await seedDatabase(databaseUrl);
    const db = createPrismaClient(databaseUrl);
    try {
      await db.$executeRawUnsafe('INSERT INTO "ServerSetting"("organizationId","ownerId","settingKey","valueJson","secretCiphertext","secretIv","secretTag","version","updatedById","createdAt","updatedAt") VALUES(?,?,?,?,?,?,?,?,?,?,?)', 'ORG-SYN-A', 'ORGANIZATION:ORG-SYN-A', 'CF132_PRESERVE', '{"preserve":true}', 'synthetic-old-cipher', 'synthetic-old-iv', 'synthetic-old-tag', 1, 'USR-ADMIN', '2026-01-01', '2026-01-01');
    } finally { await db.$disconnect(); }
    server = newServer(); let origin = await listen(server);
    const admin = await login(origin), staff = await login(origin, 'staff'), endpoint = '/api/settings/ecos';
    result(await request(origin, endpoint), 401);
    for (const [pathname, method, body] of [[endpoint, 'GET', undefined], [endpoint, 'PUT', { apiKey: key, expectedVersion: 0 }], [endpoint + '/test', 'POST', { expectedVersion: 0 }]] as const) result(await request(origin, pathname, method, body, staff), 403);
    const initial = result(await request(origin, endpoint, 'GET', undefined, admin)); assert.equal(initial.settings.configured, false); assert.equal(initial.settings.version, 0);
    result(await request(origin, endpoint, 'PUT', { apiKey: key, expectedVersion: 0 }, { ...admin, Origin: 'https://foreign.invalid' }), 403);
    result(await request(origin, endpoint, 'PUT', { apiKey: key, expectedVersion: 0 }, { ...admin, 'X-CSRF-Token': 'wrong' }), 403);
    const saved = result(await request(origin, endpoint, 'PUT', { apiKey: key, expectedVersion: 0 }, admin)); assert.equal(saved.settings.version, 1); assert.equal(saved.settings.storage, 'ENCRYPTED_SERVER');
    const reloaded = result(await request(origin, endpoint, 'GET', undefined, admin)); assert.equal(reloaded.settings.version, 1); assert.equal(reloaded.settings.configured, true);
    for (const payload of [saved, reloaded]) assert.ok(!JSON.stringify(payload).includes(key));
    assert.equal(calls.length, 0, 'save/get cannot make a provider request');
    const checked = result(await request(origin, endpoint + '/test', 'POST', { expectedVersion: 1 }, admin)); assert.equal(checked.count, 4); assert.equal(checked.month, '2024-05'); assert.ok(checked.checkedAt);
    const source = result(await request(origin, '/api/es/sources/ecos?date=2024-06-15&date=2026-05-01&date=2026-04-30', 'GET', undefined, staff));
    assert.deepEqual(source.items.map((item: any) => item.month), ['2024-05', '2026-04', '2026-04']); assert.ok(calls.every(url => url.pathname.split('/')[3] === key)); assert.ok(!JSON.stringify(source).includes(key));
    const count = calls.length;
    result(await request(origin, endpoint, 'PUT', { apiKey: nextKey, expectedVersion: 0 }, admin), 409);
    result(await request(origin, endpoint + '/test', 'POST', { expectedVersion: 0 }, admin), 409); assert.equal(calls.length, count);
    result(await request(origin, '/api/es/sources/ecos?date=2026-02-29', 'GET', undefined, staff), 400); assert.equal(calls.length, count);
    failure = true; const failed = await request(origin, endpoint + '/test', 'POST', { expectedVersion: 1 }, admin); result(failed, 502); assert.ok(!JSON.stringify(failed.body).includes(key)); failure = false;
    const second = result(await request(origin, endpoint, 'PUT', { apiKey: nextKey, expectedVersion: 1 }, admin)); assert.equal(second.settings.version, 2);
    await close(server); server = newServer(); origin = await listen(server);
    const again = await login(origin), persisted = result(await request(origin, endpoint, 'GET', undefined, again)); assert.equal(persisted.settings.version, 2); assert.equal(persisted.settings.configured, true);
    const nextChecked = result(await request(origin, endpoint + '/test', 'POST', { expectedVersion: 2 }, again)); assert.equal(nextChecked.count, 4); assert.equal(calls.at(-1)?.pathname.split('/')[3], nextKey);
    const verify = createPrismaClient(databaseUrl);
    try {
      const stored = await verify.$queryRawUnsafe<any[]>('SELECT "secretCiphertext","secretIv","secretTag","valueJson" FROM "ServerSetting" WHERE "settingKey"=?', 'ECOS_API_KEY');
      assert.equal(stored.length, 1); assert.ok(stored[0].secretCiphertext); assert.ok(stored[0].secretIv); assert.ok(stored[0].secretTag); assert.ok(!JSON.stringify(stored).includes(nextKey));
      const preserved = await verify.$queryRawUnsafe<any[]>('SELECT "valueJson","secretCiphertext","secretIv","secretTag" FROM "ServerSetting" WHERE "settingKey"=?', 'CF132_PRESERVE');
      assert.deepEqual(preserved, [{ valueJson: '{"preserve":true}', secretCiphertext: 'synthetic-old-cipher', secretIv: 'synthetic-old-iv', secretTag: 'synthetic-old-tag' }]);
      assert.deepEqual(await verify.$queryRawUnsafe<any[]>('PRAGMA foreign_key_check'), []);
    } finally { await verify.$disconnect(); }
    assert.equal(readFileSync(databasePath).includes(Buffer.from(key)), false); assert.equal(readFileSync(databasePath).includes(Buffer.from(nextKey)), false);
  } finally {
    if (server?.listening) await close(server);
    const target = path.resolve(directory); assert.equal(path.dirname(target), path.resolve(tmpdir())); assert.ok(path.basename(target).startsWith('cf132-node-ecos-')); rmSync(target, { recursive: true, force: true });
  }
});
