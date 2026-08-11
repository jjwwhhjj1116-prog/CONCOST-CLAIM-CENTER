interface D1StatementLike {
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  bind(...values: unknown[]): D1StatementLike;
  run(): Promise<{ success?: boolean }>;
}

interface D1DatabaseLike {
  prepare(sql: string): D1StatementLike;
}

interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | ReadableStream<Uint8Array>,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    }
  ): Promise<unknown>;
  get(key: string): Promise<{
    body: ArrayBuffer | ReadableStream<Uint8Array>;
  } | null>;
  delete(key: string): Promise<void>;
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

const PREVIEW_EVIDENCE_MAX_BYTES = 10_000_000;
const PREVIEW_EVIDENCE_EXTENSION = /\.(pdf|docx?|xlsx?|pptx?|hwp|hwpx|txt|csv|png|jpe?g|webp)$/i;

interface PreviewEvidenceRow {
  id: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  uploadedAt: string;
  uploadedBy: string;
  storageProvider: string;
  driveStatus: string;
}

async function handlePreviewEvidence(request: Request, env: CloudflareEnv, url: URL): Promise<Response> {
  if (!env.DB || !env.FILES) {
    return json({ error: 'D1 and R2 bindings are required', code: 'EVIDENCE_STORAGE_NOT_CONFIGURED', phase: 'CF03_EVIDENCE_HUB' }, 503);
  }

  const sessionUser = await previewSessionUser(request, env);
  if (!sessionUser) return json({ error: 'Login is required', code: 'AUTH_REQUIRED' }, 401);

  const draftId = await previewDraftId(request);
  if (!draftId) return json({ error: 'A valid preview draft key is required', code: 'INVALID_PREVIEW_DRAFT_KEY' }, 401);

  const downloadMatch = url.pathname.match(/^\/api\/preview\/evidence\/([0-9a-f-]{36})\/download$/i);
  if (downloadMatch && request.method === 'GET') {
    const row = await env.DB.prepare(
      'SELECT object_key AS objectKey, original_name AS originalName, mime_type AS mimeType FROM preview_evidence WHERE id = ? AND draft_id = ?'
    ).bind(downloadMatch[1], draftId).first<{ objectKey: string; originalName: string; mimeType: string }>();
    if (!row) return json({ error: 'Evidence file was not found', code: 'EVIDENCE_NOT_FOUND' }, 404);
    const object = await env.FILES.get(row.objectKey);
    if (!object) return json({ error: 'Evidence object was not found', code: 'EVIDENCE_OBJECT_NOT_FOUND' }, 404);
    return new Response(object.body, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.originalName)}`,
        'Content-Type': row.mimeType || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }

  if (url.pathname !== '/api/preview/evidence') {
    return json({ error: 'Evidence route was not found', code: 'EVIDENCE_ROUTE_NOT_FOUND' }, 404);
  }

  if (request.method === 'GET') {
    const result = await env.DB.prepare(
      'SELECT id, original_name AS originalName, mime_type AS mimeType, byte_size AS byteSize, uploaded_at AS uploadedAt, ' +
      'uploaded_by AS uploadedBy, storage_provider AS storageProvider, drive_status AS driveStatus ' +
      'FROM preview_evidence WHERE draft_id = ? ORDER BY uploaded_at DESC LIMIT 100'
    ).bind(draftId).all<PreviewEvidenceRow>();
    return json({
      files: result.results.map((file) => ({ ...file, downloadUrl: `/api/preview/evidence/${file.id}/download` })),
      phase: 'CF03_EVIDENCE_HUB'
    });
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405);

  const contentLength = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > PREVIEW_EVIDENCE_MAX_BYTES + 100_000) {
    return json({ error: 'Evidence file exceeds 10 MB', code: 'EVIDENCE_TOO_LARGE' }, 413);
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const uploadedBy = sessionUser.displayName;
  if (!(file instanceof File)) {
    return json({ error: 'file is required', code: 'INVALID_EVIDENCE_PAYLOAD' }, 400);
  }
  if (file.size <= 0 || file.size > PREVIEW_EVIDENCE_MAX_BYTES) {
    return json({ error: 'Evidence file must be between 1 byte and 10 MB', code: 'EVIDENCE_TOO_LARGE' }, 413);
  }
  if (!PREVIEW_EVIDENCE_EXTENSION.test(file.name) || file.name.length > 240) {
    return json({ error: 'Evidence file type is not allowed', code: 'EVIDENCE_TYPE_NOT_ALLOWED' }, 415);
  }

  const id = crypto.randomUUID();
  const uploadedAt = new Date().toISOString();
  const mimeType = file.type || 'application/octet-stream';
  const objectKey = `preview-evidence/${draftId}/${id}`;
  await env.FILES.put(objectKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: mimeType },
    customMetadata: { originalName: file.name, uploadedAt, uploadedBy }
  });

  try {
    await env.DB.prepare(
      'INSERT INTO preview_evidence (id, draft_id, object_key, original_name, mime_type, byte_size, uploaded_at, uploaded_by, storage_provider, drive_status) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, draftId, objectKey, file.name, mimeType, file.size, uploadedAt, uploadedBy, 'CLOUDFLARE_R2', 'PENDING_GOOGLE_CONNECTION').run();
  } catch {
    await env.FILES.delete(objectKey).catch(() => undefined);
    return json({ error: 'Evidence metadata could not be saved', code: 'EVIDENCE_METADATA_FAILED' }, 503);
  }

  return json({
    file: {
      id,
      originalName: file.name,
      mimeType,
      byteSize: file.size,
      uploadedAt,
      uploadedBy,
      storageProvider: 'CLOUDFLARE_R2',
      driveStatus: 'PENDING_GOOGLE_CONNECTION',
      downloadUrl: `/api/preview/evidence/${id}/download`
    },
    phase: 'CF03_EVIDENCE_HUB'
  }, 201);
}

const PREVIEW_SESSION_COOKIE = 'claim_center_session';
const PREVIEW_SESSION_SECONDS = 12 * 60 * 60;
const PREVIEW_ROLES = new Set(['ceo', 'director', 'pm', 'staff', 'reviewer', 'admin']);

interface PreviewUserRow {
  id: string;
  loginId: string;
  passwordSalt: string;
  passwordHash: string;
  passwordIterations: number;
  displayName: string;
  email: string;
  rolesJson: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  return new Uint8Array(value.match(/.{2}/g)?.map((entry) => Number.parseInt(entry, 16)) ?? []);
}

async function sha256Hex(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

async function derivePreviewPassword(password: string, saltHex: string, iterations: number): Promise<string | null> {
  const salt = hexToBytes(saltHex);
  if (!salt) return null;
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt.buffer as ArrayBuffer, iterations }, material, 256);
  return bytesToHex(new Uint8Array(bits));
}

function constantTimeHexEqual(left: string | null, right: string): boolean {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function requestCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get('Cookie') ?? '';
  for (const part of cookies.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function sessionCookie(token: string, maxAge: number): string {
  return `${PREVIEW_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function parsePreviewRoles(value: string): string[] {
  try {
    const roles = JSON.parse(value);
    return Array.isArray(roles) ? roles.filter((role): role is string => typeof role === 'string' && PREVIEW_ROLES.has(role)) : [];
  } catch {
    return [];
  }
}

interface PreviewSessionUser {
  id: string;
  loginId: string;
  displayName: string;
  email: string;
  rolesJson: string;
}

async function previewSessionUser(request: Request, env: CloudflareEnv): Promise<PreviewSessionUser | null> {
  if (!env.DB) return null;
  const token = requestCookie(request, PREVIEW_SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  return env.DB.prepare(
    'SELECT u.id, u.login_id AS loginId, u.display_name AS displayName, u.email, u.roles_json AS rolesJson ' +
    'FROM preview_sessions s JOIN preview_users u ON u.id = s.user_id ' +
    'WHERE s.id_hash = ? AND s.expires_at > ? AND u.is_active = 1'
  ).bind(tokenHash, new Date().toISOString()).first<PreviewSessionUser>();
}

async function handlePreviewAuth(request: Request, env: CloudflareEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);

  if (url.pathname === '/auth/login' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { loginId?: unknown; password?: unknown } | null;
    if (!body || typeof body.loginId !== 'string' || typeof body.password !== 'string') {
      return json({ error: '아이디와 비밀번호를 입력해 주세요.', code: 'INVALID_LOGIN_PAYLOAD' }, 400);
    }
    const loginId = body.loginId.trim();
    if (!loginId || loginId.length > 100 || !body.password || body.password.length > 200) {
      return json({ error: '아이디 또는 비밀번호를 확인해 주세요.', code: 'INVALID_CREDENTIALS' }, 401);
    }

    const user = await env.DB.prepare(
      'SELECT id, login_id AS loginId, password_salt AS passwordSalt, password_hash AS passwordHash, ' +
      'password_iterations AS passwordIterations, display_name AS displayName, email, roles_json AS rolesJson ' +
      'FROM preview_users WHERE login_id = ? COLLATE NOCASE AND is_active = 1'
    ).bind(loginId).first<PreviewUserRow>();
    const derived = user ? await derivePreviewPassword(body.password, user.passwordSalt, user.passwordIterations) : null;
    if (!user || !constantTimeHexEqual(derived, user.passwordHash)) {
      return json({ error: '아이디 또는 비밀번호를 확인해 주세요.', code: 'INVALID_CREDENTIALS' }, 401);
    }

    const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await sha256Hex(token);
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + PREVIEW_SESSION_SECONDS * 1000);
    await env.DB.prepare('DELETE FROM preview_sessions WHERE expires_at <= ?').bind(createdAt.toISOString()).run();
    await env.DB.prepare(
      'INSERT INTO preview_sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).bind(tokenHash, user.id, createdAt.toISOString(), expiresAt.toISOString()).run();

    const response = json({
      user: {
        id: user.id,
        email: user.email,
        name: user.displayName,
        organizationId: 'concost',
        roles: parsePreviewRoles(user.rolesJson),
        previewMode: true
      }
    });
    response.headers.set('Set-Cookie', sessionCookie(token, PREVIEW_SESSION_SECONDS));
    return response;
  }

  const token = requestCookie(request, PREVIEW_SESSION_COOKIE);
  const tokenHash = token ? await sha256Hex(token) : null;

  if (url.pathname === '/auth/logout' && request.method === 'POST') {
    if (tokenHash) await env.DB.prepare('DELETE FROM preview_sessions WHERE id_hash = ?').bind(tokenHash).run();
    const response = json({ ok: true });
    response.headers.set('Set-Cookie', sessionCookie('', 0));
    return response;
  }

  if (url.pathname === '/auth/session' && request.method === 'GET') {
    if (!tokenHash) return json({ error: '로그인이 필요합니다.', code: 'AUTH_REQUIRED' }, 401);
    const user = await previewSessionUser(request, env);
    if (!user) {
      const response = json({ error: '세션이 만료되었습니다. 다시 로그인해 주세요.', code: 'AUTH_REQUIRED' }, 401);
      response.headers.set('Set-Cookie', sessionCookie('', 0));
      return response;
    }
    return json({
      id: user.id,
      email: user.email,
      name: user.displayName,
      organizationId: 'concost',
      roles: parsePreviewRoles(user.rolesJson),
      previewMode: true
    });
  }

  return json({ error: 'Authentication route was not found', code: 'AUTH_ROUTE_NOT_FOUND' }, 404);
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
    if (url.pathname === '/api/preview/evidence' || url.pathname.startsWith('/api/preview/evidence/')) return handlePreviewEvidence(request, env, url);
    if (url.pathname.startsWith('/auth/')) return handlePreviewAuth(request, env, url);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
      return json({ error: 'Cloudflare application data migration is not complete', code: 'CLOUDFLARE_MIGRATION_IN_PROGRESS', phase: 'CF01_FOUNDATION' }, 503);
    }
    return env.ASSETS.fetch(request);
  }
};

export default cloudflareWorker;
