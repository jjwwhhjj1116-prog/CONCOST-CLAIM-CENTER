import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudflareWorker, type CloudflareEnv } from '../apps/cloudflare/src/index.js';

interface StoredDraft {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

function createD1() {
  const drafts = new Map<string, StoredDraft>();
  const database: NonNullable<CloudflareEnv['DB']> = {
    prepare(query: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) {
          values = next;
          return statement;
        },
        async first<T>() {
          if (query === 'SELECT 1 AS ok') return { ok: 1 } as T;
          if (query.includes('FROM preview_drafts')) return (drafts.get(String(values[0])) ?? null) as T | null;
          return null;
        },
        async all<T>() {
          return { results: [] as T[] };
        },
        async run() {
          if (query.startsWith('INSERT INTO preview_drafts')) {
            const [id, title, draftContent, updatedAt] = values.map(String);
            drafts.set(id, { id, title, content: draftContent, updatedAt });
          }
          return { success: true };
        }
      };
      return statement;
    }
  };
  return { database, drafts };
}

const env = (overrides: Partial<CloudflareEnv> = {}): CloudflareEnv => ({
  ASSETS: { async fetch() { return new Response('<!doctype html><title>Claim Center</title>'); } },
  DB: createD1().database,
  FILES: {
    async put() {
      return {};
    },
    async get() {
      return null;
    },
    async delete() {
      return undefined;
    },
    async list() {
      return { objects: [] };
    }
  },
  ...overrides
});

test('CF06 health identifies the active Cloudflare case-operations runtime', async () => {
  const response = await cloudflareWorker.fetch(new Request('https://preview.example/api/health'), env());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', runtime: 'cloudflare-workers', phase: 'CF06_D1_CASE_OPERATIONS' });
});

test('CF05 readiness requires D1 and static assets while R2 remains skipped', async () => {
  const ready = await cloudflareWorker.fetch(new Request('https://preview.example/api/readiness'), env({ FILES: undefined }));
  assert.equal(ready.status, 200);
  const readyBody = await ready.json() as { checks: { r2: string; fileStorage: string } };
  assert.equal(readyBody.checks.r2, 'skipped_by_user');
  assert.equal(readyBody.checks.fileStorage, 'google_drive_pending');

  const missingD1 = await cloudflareWorker.fetch(new Request('https://preview.example/api/readiness'), env({ DB: undefined }));
  assert.equal(missingD1.status, 503);

  const missingAssets = await cloudflareWorker.fetch(new Request('https://preview.example/api/readiness'), env({ ASSETS: undefined }));
  assert.equal(missingAssets.status, 503);
});

test('CF06 case APIs require an authenticated member session', async () => {
  const response = await cloudflareWorker.fetch(new Request('https://preview.example/api/cases'), env());
  assert.equal(response.status, 401);
  assert.equal((await response.json() as { code: string }).code, 'AUTH_REQUIRED');
});

test('CF04 returns JSON authentication-required for a missing member session', async () => {
  const response = await cloudflareWorker.fetch(new Request('https://preview.example/auth/session'), env());
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal((await response.json() as { code: string }).code, 'AUTH_REQUIRED');
});

test('CF01 delegates non-API routes to static assets', async () => {
  const response = await cloudflareWorker.fetch(new Request('https://preview.example/reports/studio'), env());
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Claim Center/);
});
test('CF02 rejects draft access without a browser-bound key', async () => {
  const response = await cloudflareWorker.fetch(new Request('https://preview.example/api/preview/draft'), env());
  assert.equal(response.status, 401);
  assert.equal((await response.json() as { code: string }).code, 'INVALID_PREVIEW_DRAFT_KEY');
});

test('CF02 persists and reloads a draft using only the hashed browser key', async () => {
  const memory = createD1();
  const cloud = env({ DB: memory.database });
  const key = '11111111-1111-4111-8111-111111111111';
  const headers = { 'Content-Type': 'application/json', 'X-Preview-Draft-Key': key };

  const saved = await cloudflareWorker.fetch(new Request('https://preview.example/api/preview/draft', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ title: '클레임 검토 초안', content: '작업 중인 보고서 내용' })
  }), cloud);
  assert.equal(saved.status, 200);
  assert.equal(memory.drafts.size, 1);
  assert.equal([...memory.drafts.keys()][0]?.length, 64);
  assert.equal([...memory.drafts.keys()][0]?.includes(key), false);

  const loaded = await cloudflareWorker.fetch(new Request('https://preview.example/api/preview/draft', {
    headers: { 'X-Preview-Draft-Key': key }
  }), cloud);
  assert.equal(loaded.status, 200);
  const payload = await loaded.json() as { draft: StoredDraft };
  assert.equal(payload.draft.title, '클레임 검토 초안');
  assert.equal(payload.draft.content, '작업 중인 보고서 내용');
});

test('CF02 rejects oversized draft content before D1 mutation', async () => {
  const memory = createD1();
  const response = await cloudflareWorker.fetch(new Request('https://preview.example/api/preview/draft', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Preview-Draft-Key': '22222222-2222-4222-8222-222222222222'
    },
    body: JSON.stringify({ title: 'oversized', content: 'x'.repeat(65_537) })
  }), env({ DB: memory.database }));
  assert.equal(response.status, 413);
  assert.equal(memory.drafts.size, 0);
});
