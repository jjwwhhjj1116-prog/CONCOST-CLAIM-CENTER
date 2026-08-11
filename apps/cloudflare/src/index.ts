interface D1StatementLike {
  first<T>(): Promise<T | null>;
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
    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Cloudflare application data migration is not complete', code: 'CLOUDFLARE_MIGRATION_IN_PROGRESS', phase: 'CF01_FOUNDATION' }, 503);
    }
    return env.ASSETS.fetch(request);
  }
};

export default cloudflareWorker;
