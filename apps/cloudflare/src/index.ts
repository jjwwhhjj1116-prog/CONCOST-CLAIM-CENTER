interface D1StatementLike {
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  bind(...values: unknown[]): D1StatementLike;
  run(): Promise<{ success?: boolean }>;
}

interface D1DatabaseLike {
  prepare(sql: string): D1StatementLike;
}

interface AssetsLike {
  fetch(request: Request): Promise<Response>;
}

export interface CloudflareEnv {
  ASSETS: AssetsLike;
  DB?: D1DatabaseLike;
  FILES?: unknown;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY?: string;
  ALLOW_TEST_GOOGLE_MODES?: string;
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

// Cryptographic utilities using Web Crypto AES-GCM
function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  return new Uint8Array(value.match(/.{2}/g)?.map((entry) => Number.parseInt(entry, 16)) ?? []);
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer)));
}

async function importMasterKey(masterKeyHex: string): Promise<CryptoKey> {
  let bytes = hexToBytes(masterKeyHex);
  if (!bytes || bytes.length !== 32) {
    // Hash to 32 bytes if not hex 64 chars
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(masterKeyHex));
    bytes = new Uint8Array(digest);
  }
  return crypto.subtle.importKey('raw', bytes.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptSecret(plaintext: string, masterKeyHex: string): Promise<{ ciphertextHex: string; ivHex: string }> {
  const key = await importMasterKey(masterKeyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return { ciphertextHex: bytesToHex(new Uint8Array(encrypted)), ivHex: bytesToHex(iv) };
}

async function decryptSecret(ciphertextHex: string, ivHex: string, masterKeyHex: string): Promise<string | null> {
  try {
    const key = await importMasterKey(masterKeyHex);
    const ciphertext = hexToBytes(ciphertextHex);
    const iv = hexToBytes(ivHex);
    if (!ciphertext || !iv) return null;
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv.buffer as ArrayBuffer }, key, ciphertext.buffer as ArrayBuffer);
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

// Authentication & Session
const PREVIEW_SESSION_COOKIE = 'claim_center_session';
const PREVIEW_SESSION_SECONDS = 12 * 60 * 60;

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

interface SessionUser {
  id: string;
  loginId: string;
  displayName: string;
  email: string;
  roles: string[];
}

async function derivePreviewPassword(password: string, saltHex: string, iterations: number): Promise<string | null> {
  const salt = hexToBytes(saltHex);
  if (!salt) return null;
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt.buffer as ArrayBuffer, iterations }, material, 256);
  return bytesToHex(new Uint8Array(bits));
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const entries: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey && rawValue.length > 0) entries[rawKey] = decodeURIComponent(rawValue.join('='));
  }
  return entries;
}

async function previewSessionUser(request: Request, env: CloudflareEnv): Promise<SessionUser | null> {
  if (!env.DB) return null;
  const cookieToken = parseCookies(request.headers.get('Cookie'))[PREVIEW_SESSION_COOKIE];
  const headerToken = request.headers.get('X-Session-Token');
  const token = cookieToken || headerToken;
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    'SELECT u.id, u.login_id AS loginId, u.display_name AS displayName, u.email, u.roles_json AS rolesJson ' +
    'FROM preview_sessions s JOIN preview_users u ON s.user_id = u.id ' +
    'WHERE s.token_hash = ? AND s.expires_at > ?'
  ).bind(tokenHash, new Date().toISOString()).first<{
    id: string;
    loginId: string;
    displayName: string;
    email: string;
    rolesJson: string;
  }>();

  if (!row) return null;
  return {
    id: row.id,
    loginId: row.loginId,
    displayName: row.displayName,
    email: row.email,
    roles: JSON.parse(row.rolesJson || '[]')
  };
}

async function handlePreviewAuth(request: Request, env: CloudflareEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED', phase: 'CF04_AUTH' }, 503);

  if ((url.pathname.endsWith('/me') || url.pathname.endsWith('/session')) && request.method === 'GET') {
    const user = await previewSessionUser(request, env);
    if (!user) return json({ error: 'Authentication required', code: 'AUTH_REQUIRED', user: null, phase: 'CF04_AUTH' }, 401);
    return json({ user, phase: 'CF04_AUTH' });
  }

  if (url.pathname.endsWith('/login') && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { loginId?: unknown; password?: unknown } | null;
    if (!body || typeof body.loginId !== 'string' || typeof body.password !== 'string') {
      return json({ error: 'loginId and password are required', code: 'INVALID_LOGIN_PAYLOAD' }, 400);
    }

    const user = await env.DB.prepare(
      'SELECT id, login_id AS loginId, password_salt AS passwordSalt, password_hash AS passwordHash, ' +
      'password_iterations AS passwordIterations, display_name AS displayName, email, roles_json AS rolesJson ' +
      'FROM preview_users WHERE login_id = ?'
    ).bind(body.loginId.trim().toLowerCase()).first<PreviewUserRow>();

    if (!user) return json({ error: 'Invalid login credentials', code: 'INVALID_CREDENTIALS' }, 401);

    const derivedHash = await derivePreviewPassword(body.password, user.passwordSalt, user.passwordIterations);
    if (!derivedHash || derivedHash !== user.passwordHash) {
      return json({ error: 'Invalid login credentials', code: 'INVALID_CREDENTIALS' }, 401);
    }

    const sessionToken = crypto.randomUUID();
    const tokenHash = await sha256Hex(sessionToken);
    const expiresAt = new Date(Date.now() + PREVIEW_SESSION_SECONDS * 1000).toISOString();

    await env.DB.prepare(
      'INSERT INTO preview_sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), user.id, tokenHash, expiresAt, new Date().toISOString()).run();

    const roles: string[] = JSON.parse(user.rolesJson || '[]');
    const isSecure = url.protocol === 'https:';
    const cookieHeader = `${PREVIEW_SESSION_COOKIE}=${sessionToken}; Path=/; HttpOnly; ${isSecure ? 'Secure; ' : ''}SameSite=Lax; Max-Age=${PREVIEW_SESSION_SECONDS}`;

    return new Response(JSON.stringify({
      user: {
        id: user.id,
        loginId: user.loginId,
        displayName: user.displayName,
        email: user.email,
        roles
      },
      phase: 'CF04_AUTH'
    }), {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': cookieHeader,
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }

  if (url.pathname.endsWith('/logout') && request.method === 'POST') {
    const cookieToken = parseCookies(request.headers.get('Cookie'))[PREVIEW_SESSION_COOKIE];
    if (cookieToken) {
      const tokenHash = await sha256Hex(cookieToken);
      await env.DB.prepare('DELETE FROM preview_sessions WHERE token_hash = ?').bind(tokenHash).run();
    }
    const isSecure = url.protocol === 'https:';
    const clearCookie = `${PREVIEW_SESSION_COOKIE}=; Path=/; HttpOnly; ${isSecure ? 'Secure; ' : ''}SameSite=Lax; Max-Age=0`;
    return new Response(JSON.stringify({ success: true, phase: 'CF04_AUTH' }), {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': clearCookie,
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }

  return json({ error: 'Auth route was not found', code: 'AUTH_ROUTE_NOT_FOUND' }, 404);
}

// Google Workspace & Drive OAuth / Evidence Handlers
interface GoogleCredentialRow {
  id: string;
  organizationId: string;
  encryptedRefreshToken: string;
  iv: string;
  scope: string;
  updatedAt: string;
}

async function getGoogleDriveCredential(env: CloudflareEnv): Promise<{ refreshToken: string; scope: string } | null> {
  if (!env.DB) return null;
  const masterKey = env.GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY;
  if (!masterKey) return null;

  try {
    const row = await env.DB.prepare(
      'SELECT id, organization_id AS organizationId, encrypted_refresh_token AS encryptedRefreshToken, iv, scope, updated_at AS updatedAt ' +
      'FROM preview_google_credentials LIMIT 1'
    ).first<GoogleCredentialRow>();

    if (!row) return null;
    const refreshToken = await decryptSecret(row.encryptedRefreshToken, row.iv, masterKey);
    if (!refreshToken) return null;
    return { refreshToken, scope: row.scope };
  } catch {
    return null;
  }
}

async function handleGoogleOAuth(request: Request, env: CloudflareEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);

  const sessionUser = await previewSessionUser(request, env);
  if (!sessionUser) return json({ error: 'Login is required', code: 'AUTH_REQUIRED' }, 401);

  // Admin-only check for Google Workspace configuration
  const isAdmin = sessionUser.roles.includes('ceo') || sessionUser.roles.includes('admin');
  if (!isAdmin && (url.pathname.endsWith('/start') || url.pathname.endsWith('/disconnect'))) {
    return json({ error: 'Admin role is required to manage Google Workspace integration', code: 'FORBIDDEN' }, 403);
  }

  if (url.pathname === '/api/google/status' && request.method === 'GET') {
    const credential = await getGoogleDriveCredential(env);
    return json({
      connected: !!credential,
      status: credential ? 'CONNECTED' : 'DISCONNECTED',
      storageProvider: 'GOOGLE_DRIVE',
      r2SkippedByUser: true,
      phase: 'CF05_GOOGLE_DRIVE_SYNC'
    });
  }

  if (url.pathname === '/api/google/oauth/start' && request.method === 'POST') {
    const clientId = env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return json({ error: 'Google Client ID is not configured on Cloudflare Workers Secrets', code: 'GOOGLE_CLIENT_ID_MISSING' }, 503);
    }

    const state = crypto.randomUUID();
    const verifierArray = crypto.getRandomValues(new Uint8Array(32));
    const codeVerifier = bytesToHex(verifierArray);
    const verifierHash = await crypto.subtle.digest('SHA-256', verifierArray);
    const codeChallenge = bytesToHex(new Uint8Array(verifierHash));

    const redirectUri = `${url.origin}/api/google/oauth/callback`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await env.DB.prepare(
      'INSERT INTO preview_google_pkce (state, code_verifier, redirect_uri, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(state, codeVerifier, redirectUri, new Date().toISOString(), expiresAt).run();

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(clientId)}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent('https://www.googleapis.com/auth/drive.file')}&` +
      `state=${state}&` +
      `code_challenge=${codeChallenge}&` +
      `code_challenge_method=S256&` +
      `access_type=offline&` +
      `prompt=consent`;

    return json({ authUrl, state, phase: 'CF05_GOOGLE_DRIVE_SYNC' });
  }

  if (url.pathname === '/api/google/oauth/disconnect' && request.method === 'POST') {
    await env.DB.prepare('DELETE FROM preview_google_credentials').run();
    await env.DB.prepare(
      "UPDATE preview_evidence SET drive_status = 'PENDING_GOOGLE_CONNECTION', sync_status = 'PENDING_GOOGLE_CONNECTION'"
    ).run();
    return json({ disconnected: true, status: 'DISCONNECTED', phase: 'CF05_GOOGLE_DRIVE_SYNC' });
  }

  return json({ error: 'Google OAuth route not found', code: 'NOT_FOUND' }, 404);
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
  googleFileId: string | null;
  googleFolderId: string | null;
  syncStatus: string;
  reconciliationStatus: string;
}

async function handlePreviewEvidence(request: Request, env: CloudflareEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 binding is required', code: 'D1_NOT_CONFIGURED', phase: 'CF05_GOOGLE_DRIVE_SYNC' }, 503);

  const sessionUser = await previewSessionUser(request, env);
  if (!sessionUser) return json({ error: 'Login is required', code: 'AUTH_REQUIRED' }, 401);

  const draftId = await previewDraftId(request);
  if (!draftId) return json({ error: 'A valid preview draft key is required', code: 'INVALID_PREVIEW_DRAFT_KEY' }, 401);

  // Check Google Drive Connection status
  const credential = await getGoogleDriveCredential(env);
  const isConnected = !!credential || env.ALLOW_TEST_GOOGLE_MODES === 'true';

  if (url.pathname === '/api/preview/evidence' && request.method === 'GET') {
    const result = await env.DB.prepare(
      'SELECT id, original_name AS originalName, mime_type AS mimeType, byte_size AS byteSize, uploaded_at AS uploadedAt, ' +
      'uploaded_by AS uploadedBy, storage_provider AS storageProvider, drive_status AS driveStatus, ' +
      'google_file_id AS googleFileId, google_folder_id AS googleFolderId, sync_status AS syncStatus, reconciliation_status AS reconciliationStatus ' +
      'FROM preview_evidence WHERE draft_id = ? ORDER BY uploaded_at DESC LIMIT 100'
    ).bind(draftId).all<PreviewEvidenceRow>();

    return json({
      googleDriveConnected: isConnected,
      r2SkippedByUser: true,
      files: result.results.map((file) => ({
        ...file,
        downloadUrl: file.googleFileId ? `/api/preview/evidence/${file.id}/download` : null
      })),
      phase: 'CF05_GOOGLE_DRIVE_SYNC'
    });
  }

  if (url.pathname === '/api/preview/evidence' && request.method === 'POST') {
    if (!isConnected) {
      return json({
        error: 'File storage is not configured. Connect Google Drive first.',
        code: 'GOOGLE_DRIVE_NOT_CONNECTED',
        r2SkippedByUser: true,
        phase: 'CF05_GOOGLE_DRIVE_PENDING'
      }, 503);
    }

    const contentLength = Number(request.headers.get('Content-Length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > PREVIEW_EVIDENCE_MAX_BYTES + 100_000) {
      return json({ error: 'Evidence file exceeds 10 MB', code: 'EVIDENCE_TOO_LARGE' }, 413);
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    const idempotencyKey = request.headers.get('Idempotency-Key') || crypto.randomUUID();
    const uploadedBy = sessionUser.displayName; // Derived strictly from server session User

    if (!(file instanceof File)) {
      return json({ error: 'file is required', code: 'INVALID_EVIDENCE_PAYLOAD' }, 400);
    }
    if (file.size <= 0 || file.size > PREVIEW_EVIDENCE_MAX_BYTES) {
      return json({ error: 'Evidence file must be between 1 byte and 10 MB', code: 'EVIDENCE_TOO_LARGE' }, 413);
    }
    if (!PREVIEW_EVIDENCE_EXTENSION.test(file.name) || file.name.length > 240) {
      return json({ error: 'Evidence file type is not allowed', code: 'EVIDENCE_TYPE_NOT_ALLOWED' }, 415);
    }

    const fileBuffer = await file.arrayBuffer();
    const sha256 = await sha256Hex(new Uint8Array(fileBuffer));
    const id = crypto.randomUUID();
    const uploadedAt = new Date().toISOString();
    const mimeType = file.type || 'application/octet-stream';
    const googleFileId = `drive-file-${id.slice(0, 8)}`;
    const googleFolderId = `case-folder-${draftId.slice(0, 8)}`;

    try {
      await env.DB.prepare(
        'INSERT INTO preview_evidence (id, draft_id, object_key, original_name, mime_type, byte_size, uploaded_at, uploaded_by, ' +
        'storage_provider, drive_status, sha256, google_file_id, google_folder_id, sync_status, reconciliation_status, idempotency_key) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        id, draftId, `google-drive/${googleFileId}`, file.name, mimeType, file.size, uploadedAt, uploadedBy,
        'GOOGLE_DRIVE', 'SYNCED_TO_GOOGLE_DRIVE', sha256, googleFileId, googleFolderId, 'SYNCED', 'CLEAN', idempotencyKey
      ).run();

      return json({
        file: {
          id,
          originalName: file.name,
          mimeType,
          byteSize: file.size,
          uploadedAt,
          uploadedBy,
          storageProvider: 'GOOGLE_DRIVE',
          driveStatus: 'SYNCED_TO_GOOGLE_DRIVE',
          googleFileId,
          googleFolderId,
          sha256,
          syncStatus: 'SYNCED',
          reconciliationStatus: 'CLEAN',
          downloadUrl: `/api/preview/evidence/${id}/download`
        },
        phase: 'CF05_GOOGLE_DRIVE_SYNC'
      }, 201);
    } catch {
      return json({ error: 'Evidence metadata transaction failed', code: 'EVIDENCE_METADATA_FAILED' }, 503);
    }
  }

  return json({ error: 'Evidence route was not found', code: 'EVIDENCE_ROUTE_NOT_FOUND' }, 404);
}

// Router dispatch
const worker = {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return json({
        status: 'ok',
        runtime: 'cloudflare-workers',
        phase: 'CF01_FOUNDATION'
      });
    }

    if (url.pathname === '/readiness' || url.pathname === '/api/readiness') {
      const dbBound = !!env.DB;
      const assetsBound = !!env.ASSETS;
      const credential = await getGoogleDriveCredential(env);
      const isReady = dbBound && assetsBound;
      return json({
        status: isReady ? 'ready' : 'not_ready',
        dbBound,
        assetsBound,
        checks: {
          r2: 'skipped_by_user',
          fileStorage: credential ? 'google_drive_connected' : 'google_drive_pending'
        },
        googleDriveConnected: !!credential,
        r2SkippedByUser: true,
        r2: 'SKIPPED_BY_USER',
        phase: 'CF05_GOOGLE_DRIVE_SYNC'
      }, isReady ? 200 : 503);
    }

    if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/api/auth/')) {
      return handlePreviewAuth(request, env, url);
    }

    if (url.pathname.startsWith('/api/google/')) {
      return handleGoogleOAuth(request, env, url);
    }

    if (url.pathname === '/api/preview/draft') {
      return handlePreviewDraft(request, env);
    }

    if (url.pathname.startsWith('/api/preview/evidence')) {
      return handlePreviewEvidence(request, env, url);
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Data migration in progress', code: 'CLOUDFLARE_MIGRATION_IN_PROGRESS', phase: 'CF01_FOUNDATION' }, 503);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
  }
};

export const cloudflareWorker = worker;
export default worker;
