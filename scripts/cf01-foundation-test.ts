import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudflareWorker, type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const env = (overrides: Partial<CloudflareEnv> = {}): CloudflareEnv => ({
  ASSETS: { async fetch() { return new Response('<!doctype html><title>Claim Center</title>'); } },
  DB: { prepare() { return { async first<T>() { return { ok: 1 } as T; } }; } },
  FILES: { async list() { return { objects: [] }; } },
  ...overrides
});

test('CF01 health identifies the Cloudflare foundation runtime', async () => {
  const response = await cloudflareWorker.fetch(new Request('https://preview.example/api/health'), env());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', runtime: 'cloudflare-workers', phase: 'CF01_FOUNDATION' });
});

test('CF01 readiness requires D1, R2, and static assets', async () => {
  const ready = await cloudflareWorker.fetch(new Request('https://preview.example/api/readiness'), env());
  assert.equal(ready.status, 200);
  const missingD1 = await cloudflareWorker.fetch(new Request('https://preview.example/api/readiness'), env({ DB: undefined }));
  assert.equal(missingD1.status, 503);
});

test('CF01 blocks application APIs until data migration passes', async () => {
  const response = await cloudflareWorker.fetch(new Request('https://preview.example/api/cases'), env());
  assert.equal(response.status, 503);
  assert.equal((await response.json() as { code: string }).code, 'CLOUDFLARE_MIGRATION_IN_PROGRESS');
});

test('CF01 blocks auth routes instead of serving the SPA document as session JSON', async () => {
  const response = await cloudflareWorker.fetch(new Request('https://preview.example/auth/session'), env());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal((await response.json() as { code: string }).code, 'CLOUDFLARE_MIGRATION_IN_PROGRESS');
});

test('CF01 delegates non-API routes to static assets', async () => {
  const response = await cloudflareWorker.fetch(new Request('https://preview.example/reports/studio'), env());
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Claim Center/);
});
