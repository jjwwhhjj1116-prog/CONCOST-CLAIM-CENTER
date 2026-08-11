interface D1StatementLike {
  first<T>(): Promise<T | null>;
  bind(...values: unknown[]): D1StatementLike;
  run(): Promise<{ success?: boolean }>;
}

interface D1DatabaseLike {
  prepare(sql: string): D1StatementLike;
}

interface R2BucketLike {
  list(options: { limit: number }): Promise<{ objects: unknown[] }>;
}

interface AssetsLike {
  fetch(request: Request): Promise<Response>;
}

export interface CloudflareEnv {
  ASSETS: AssetsLike;
  DB?: D1DatabaseLike;
  FILES?: R2BucketLike;
}

const json = (payload: Record<string, unknown>, status = 200): Response => new Response(JSON.stringify(payload), {
  status,
  headers: {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  }
});

const PREVIEW_DRAFT_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PreviewDraftRow {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

async function previewDraftId(request: Request): Promise<string | null> {
  const key = request.headers.get('X-Preview-Draft-Key');
  if (!key || !PREVIEW_DRAFT_KEY.test(key)) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function handlePreviewDraft(request: Request, env: CloudflareEnv): Promise<Response> {
  if (!env.DB) {
    return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED', phase: 'CF02_D1_DRAFTS' }, 503);
  }

  const id = await previewDraftId(request);
  if (!id) return json({ error: 'A valid preview draft key is required', code: 'INVALID_PREVIEW_DRAFT_KEY' }, 401);

  try {
    if (request.method === 'GET') {
      const draft = await env.DB.prepare(
        'SELECT id, title, content, updated_at AS updatedAt FROM preview_drafts WHERE id = ?'
      ).bind(id).first<PreviewDraftRow>();
      return json({ draft: draft ?? { id, title: '', content: '', updatedAt: null }, phase: 'CF02_D1_DRAFTS' });
    }

    if (request.method === 'PUT') {
      const body = await request.json().catch(() => null) as { title?: unknown; content?: unknown } | null;
      if (!body || typeof body.title !== 'string' || typeof body.content !== 'string') {
        return json({ error: 'title and content must be strings', code: 'INVALID_DRAFT_PAYLOAD' }, 400);
      }
      if (body.title.length > 200 || body.content.length > 65_536) {
        return json({ error: 'Preview draft exceeds size limits', code: 'DRAFT_TOO_LARGE' }, 413);
      }

      const updatedAt = new Date().toISOString();
      await env.DB.prepare(
        'INSERT INTO preview_drafts (id, title, content, updated_at) ' +
        'VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content, updated_at = excluded.updated_at'
      ).bind(id, body.title, body.content, updatedAt).run();
      return json({ draft: { id, title: body.title, content: body.content, updatedAt }, phase: 'CF02_D1_DRAFTS' });
    }

    return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405);
  } catch {
    return json({ error: 'D1 draft storage is not ready', code: 'D1_MIGRATION_REQUIRED', phase: 'CF02_D1_DRAFTS' }, 503);
  }
}

async function readiness(env: CloudflareEnv): Promise<Response> {
  const checks = { d1: false, r2: false, assets: Boolean(env.ASSETS) };

  try {
    if (env.DB) {
      const row = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
      checks.d1 = row?.ok === 1;
    }
  } catch {
    checks.d1 = false;
  }

  try {
    if (env.FILES) {
      await env.FILES.list({ limit: 1 });
      checks.r2 = true;
    }
  } catch {
    checks.r2 = false;
  }

  const ready = checks.d1 && checks.r2 && checks.assets;
  return json({ status: ready ? 'ready' : 'not_ready', runtime: 'cloudflare-workers', phase: 'CF01_FOUNDATION', checks }, ready ? 200 : 503);
}

export const cloudflareWorker = {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return json({ status: 'ok', runtime: 'cloudflare-workers', phase: 'CF01_FOUNDATION' });
    }
    if (url.pathname === '/readiness' || url.pathname === '/api/readiness') return readiness(env);
    if (url.pathname === '/api/preview/draft') return handlePreviewDraft(request, env);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
      return json({ error: 'Cloudflare application data migration is not complete', code: 'CLOUDFLARE_MIGRATION_IN_PROGRESS', phase: 'CF01_FOUNDATION' }, 503);
    }
    return env.ASSETS.fetch(request);
  }
};

export default cloudflareWorker;
