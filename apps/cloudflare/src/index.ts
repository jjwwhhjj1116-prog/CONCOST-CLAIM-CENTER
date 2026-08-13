import {
  GOOGLE_DRIVE_SCOPE,
  GoogleDriveError,
  bytesToHex,
  buildAuthorizationUrl,
  createPkce,
  decryptSecret,
  downloadEvidenceFromDrive,
  encryptSecret,
  exchangeAuthorizationCode,
  getDriveAccount,
  isAllowedGoogleAccountEmail,
  refreshAccessToken,
  revokeGoogleCredential,
  sha256Hex,
  uploadEvidenceToDrive,
  validateEvidenceFile,
  verifyDriveFolder,
  type GoogleFetch
} from './google-drive';
import { generateFinalDocx, generateFinalPdf, type FinalReportDocument } from './final-output';

interface D1StatementLike {
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  bind(...values: unknown[]): D1StatementLike;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
}

interface D1DatabaseLike {
  prepare(sql: string): D1StatementLike;
  batch?(statements: D1StatementLike[]): Promise<unknown[]>;
}

interface AssetsLike {
  fetch(request: Request): Promise<Response>;
}

export interface CloudflareEnv {
  ASSETS?: AssetsLike;
  DB?: D1DatabaseLike;
  FILES?: unknown;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY?: string;
  GOOGLE_OAUTH_REDIRECT_ORIGIN?: string;
  GOOGLE_ALLOWED_DOMAIN?: string;
  ALLOW_TEST_GOOGLE_MODES?: string;
  GOOGLE_TEST_FETCH?: GoogleFetch;
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

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  return new Uint8Array(value.match(/.{2}/g)?.map((entry) => Number.parseInt(entry, 16)) ?? []);
}

// Authentication & Session
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

interface SessionUser {
  id: string;
  loginId: string;
  displayName: string;
  email: string;
  roles: string[];
}

function constantTimeHexEqual(left: string | null, right: string): boolean {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function parsePreviewRoles(value: string): string[] {
  try {
    const roles = JSON.parse(value);
    return Array.isArray(roles) ? roles.filter((role): role is string => typeof role === 'string' && PREVIEW_ROLES.has(role)) : [];
  } catch {
    return [];
  }
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
    'FROM preview_sessions s JOIN preview_users u ON u.id = s.user_id ' +
    'WHERE s.id_hash = ? AND s.expires_at > ? AND u.is_active = 1'
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
    roles: parsePreviewRoles(row.rolesJson)
  };
}

async function handlePreviewAuth(request: Request, env: CloudflareEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED', phase: 'CF04_AUTH' }, 503);

  if ((url.pathname.endsWith('/me') || url.pathname.endsWith('/session')) && request.method === 'GET') {
    const user = await previewSessionUser(request, env);
    if (!user) return json({ error: 'Authentication required', code: 'AUTH_REQUIRED', user: null, phase: 'CF04_AUTH' }, 401);
    return json({
      id: user.id,
      email: user.email,
      name: user.displayName,
      organizationId: 'concost',
      roles: user.roles,
      previewMode: true
    });
  }

  if (url.pathname.endsWith('/login') && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { loginId?: unknown; password?: unknown } | null;
    if (!body || typeof body.loginId !== 'string' || typeof body.password !== 'string') {
      return json({ error: 'loginId and password are required', code: 'INVALID_LOGIN_PAYLOAD' }, 400);
    }

    const user = await env.DB.prepare(
      'SELECT id, login_id AS loginId, password_salt AS passwordSalt, password_hash AS passwordHash, ' +
      'password_iterations AS passwordIterations, display_name AS displayName, email, roles_json AS rolesJson ' +
      'FROM preview_users WHERE login_id = ? COLLATE NOCASE AND is_active = 1'
    ).bind(body.loginId.trim()).first<PreviewUserRow>();

    if (!user) return json({ error: 'Invalid login credentials', code: 'INVALID_CREDENTIALS' }, 401);

    const derivedHash = await derivePreviewPassword(body.password, user.passwordSalt, user.passwordIterations);
    if (!constantTimeHexEqual(derivedHash, user.passwordHash)) {
      return json({ error: 'Invalid login credentials', code: 'INVALID_CREDENTIALS' }, 401);
    }

    const sessionToken = [...crypto.getRandomValues(new Uint8Array(32))].map((value) => value.toString(16).padStart(2, '0')).join('');
    const tokenHash = await sha256Hex(sessionToken);
    const expiresAt = new Date(Date.now() + PREVIEW_SESSION_SECONDS * 1000).toISOString();

    const createdAt = new Date().toISOString();
    await env.DB.prepare('DELETE FROM preview_sessions WHERE expires_at <= ?').bind(createdAt).run();
    await env.DB.prepare(
      'INSERT INTO preview_sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).bind(tokenHash, user.id, createdAt, expiresAt).run();

    const roles = parsePreviewRoles(user.rolesJson);
    const isSecure = url.protocol === 'https:';
    const cookieHeader = `${PREVIEW_SESSION_COOKIE}=${sessionToken}; Path=/; HttpOnly; ${isSecure ? 'Secure; ' : ''}SameSite=Lax; Max-Age=${PREVIEW_SESSION_SECONDS}`;

    return new Response(JSON.stringify({
      user: {
        id: user.id,
        email: user.email,
        name: user.displayName,
        organizationId: 'concost',
        roles,
        previewMode: true
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
      await env.DB.prepare('DELETE FROM preview_sessions WHERE id_hash = ?').bind(tokenHash).run();
    }
    const isSecure = url.protocol === 'https:';
    const clearCookie = `${PREVIEW_SESSION_COOKIE}=; Path=/; HttpOnly; ${isSecure ? 'Secure; ' : ''}SameSite=Lax; Max-Age=0`;
    return new Response(JSON.stringify({ ok: true, phase: 'CF04_AUTH' }), {
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

// CF06 D1-backed case operations. This intentionally implements the core
// operational slice before report, approval, and binary-document migration.
const PREVIEW_CLAIM_TYPES = new Set(['TYPE-01', 'TYPE-02', 'TYPE-03', 'TYPE-04', 'TYPE-05', 'TYPE-06']);
const PREVIEW_CASE_STATUSES = [
  'INQUIRY', 'PROPOSAL', 'ESTIMATE', 'CONTRACT', 'MATERIAL_RECEIVED', 'ANALYSIS',
  'REPORT_DRAFTING', 'SUBMITTED', 'LITIGATION', 'JUDGEMENT', 'SUCCESS_FEE', 'CLOSED'
] as const;
const PREVIEW_CASE_MUTATION_ROLES = new Set(['admin', 'ceo', 'director', 'pm']);
const PREVIEW_CASE_CREATE_KEY = /^[A-Za-z0-9._:-]{8,128}$/u;

interface PreviewCaseRow {
  id: string;
  caseNumber: string;
  title: string;
  description: string | null;
  claimType: string;
  status: string;
  version: number;
  categoryMajor: string;
  categoryMiddle: string;
  categoryMinor: string;
  createdAt: string;
  updatedAt: string;
}

function canMutatePreviewCases(user: SessionUser): boolean {
  return user.roles.some((role) => PREVIEW_CASE_MUTATION_ROLES.has(role));
}

function previewCaseProjection(row: PreviewCaseRow): Record<string, unknown> {
  return {
    id: row.id,
    caseNumber: row.caseNumber,
    title: row.title,
    description: row.description,
    claimType: row.claimType,
    status: row.status,
    version: row.version,
    category: { major: row.categoryMajor, middle: row.categoryMiddle, minor: row.categoryMinor },
    parties: [],
    schedules: [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function kstDateKey(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}

function previewDDay(value: string): { dDayStr: string; isOverdue: boolean; isToday: boolean; diffDays: number } {
  const target = new Date(value);
  const todayKey = kstDateKey(new Date());
  const targetKey = kstDateKey(target);
  const diffDays = Math.round((Date.parse(`${targetKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86_400_000);
  return { dDayStr: diffDays === 0 ? 'D-DAY' : diffDays > 0 ? `D-${diffDays}` : `D+${Math.abs(diffDays)}`, isOverdue: diffDays < 0, isToday: diffDays === 0, diffDays };
}

function exactObjectKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

async function accessiblePreviewCase(env: CloudflareEnv, user: SessionUser, caseId: string): Promise<PreviewCaseRow | null> {
  if (!env.DB) return null;
  return env.DB.prepare(
    'SELECT c.id, c.case_number AS caseNumber, c.title, c.description, c.claim_type AS claimType, c.status, c.version, ' +
    'c.category_major AS categoryMajor, c.category_middle AS categoryMiddle, c.category_minor AS categoryMinor, c.created_at AS createdAt, c.updated_at AS updatedAt ' +
    'FROM preview_cases c WHERE c.id = ? AND c.organization_id = ? AND c.deleted_at IS NULL ' +
    'AND (? = 1 OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id = c.id AND a.user_id = ?))'
  ).bind(caseId, PREVIEW_ORGANIZATION_ID, user.roles.includes('admin') ? 1 : 0, user.id).first<PreviewCaseRow>();
}

async function previewCaseDetail(env: CloudflareEnv, user: SessionUser, caseId: string): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  const row = await accessiblePreviewCase(env, user, caseId);
  if (!row) return json({ error: 'Case was not found or is not assigned to this user', code: 'CASE_NOT_FOUND' }, 404);
  const [parties, schedules, activities] = await Promise.all([
    env.DB.prepare('SELECT id, name, role, contact FROM preview_case_parties WHERE case_id = ? ORDER BY created_at ASC LIMIT 100').bind(caseId).all<{ id: string; name: string; role: string; contact: string | null }>(),
    env.DB.prepare('SELECT id, title, type, scheduled_at AS date, location FROM preview_case_schedules WHERE case_id = ? ORDER BY scheduled_at ASC LIMIT 100').bind(caseId).all<{ id: string; title: string; type: string; date: string; location: string | null }>(),
    env.DB.prepare(
      'SELECT a.id, a.title, a.description, a.created_at AS createdAt, u.id AS actorId, u.display_name AS actorName ' +
      'FROM preview_case_activities a JOIN preview_users u ON u.id = a.actor_id WHERE a.case_id = ? ORDER BY a.created_at DESC LIMIT 100'
    ).bind(caseId).all<{ id: string; title: string; description: string | null; createdAt: string; actorId: string; actorName: string }>()
  ]);
  return json({
    case: {
      ...previewCaseProjection(row),
      parties: parties.results,
      schedules: schedules.results.map((schedule) => ({ ...schedule, dDayInfo: previewDDay(schedule.date) })),
      activityTimeline: activities.results.map((activity) => ({
        id: activity.id, title: activity.title, description: activity.description, createdAt: activity.createdAt,
        actor: { id: activity.actorId, name: activity.actorName }
      }))
    },
    phase: 'CF06_D1_CASE_OPERATIONS'
  });
}

async function handlePreviewDashboard(request: Request, env: CloudflareEnv): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  if (request.method !== 'GET') return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405);
  const user = await previewSessionUser(request, env);
  if (!user) return json({ error: 'Login is required', code: 'AUTH_REQUIRED' }, 401);
  const admin = user.roles.includes('admin') ? 1 : 0;
  const visibility = '(? = 1 OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id = c.id AND a.user_id = ?))';
  const summary = await env.DB.prepare(
    `SELECT COUNT(*) AS totalCases, SUM(CASE WHEN c.status <> 'CLOSED' THEN 1 ELSE 0 END) AS inProgressCount ` +
    `FROM preview_cases c WHERE c.organization_id = ? AND c.deleted_at IS NULL AND ${visibility}`
  ).bind(PREVIEW_ORGANIZATION_ID, admin, user.id).first<{ totalCases: number; inProgressCount: number }>();
  const recent = await env.DB.prepare(
    `SELECT c.id, c.case_number AS caseNumber, c.title, c.claim_type AS claimType, c.status, c.updated_at AS updatedAt ` +
    `FROM preview_cases c WHERE c.organization_id = ? AND c.deleted_at IS NULL AND ${visibility} ORDER BY c.updated_at DESC LIMIT 8`
  ).bind(PREVIEW_ORGANIZATION_ID, admin, user.id).all<{ id: string; caseNumber: string; title: string; claimType: string; status: string; updatedAt: string }>();
  const schedules = await env.DB.prepare(
    `SELECT s.id, s.title, s.type, s.scheduled_at AS date, s.location, c.id AS caseId, c.case_number AS caseNumber, c.title AS caseTitle ` +
    `FROM preview_case_schedules s JOIN preview_cases c ON c.id = s.case_id ` +
    `WHERE c.organization_id = ? AND c.deleted_at IS NULL AND s.scheduled_at >= ? AND ${visibility} ORDER BY s.scheduled_at ASC LIMIT 8`
  ).bind(PREVIEW_ORGANIZATION_ID, new Date().toISOString(), admin, user.id).all<{ id: string; title: string; type: string; date: string; location: string | null; caseId: string; caseNumber: string; caseTitle: string }>();
  const today = kstDateKey(new Date());
  const allVisibleSchedules = await env.DB.prepare(
    `SELECT s.scheduled_at AS date FROM preview_case_schedules s JOIN preview_cases c ON c.id = s.case_id ` +
    `WHERE c.organization_id = ? AND c.deleted_at IS NULL AND ${visibility} LIMIT 1000`
  ).bind(PREVIEW_ORGANIZATION_ID, admin, user.id).all<{ date: string }>();
  return json({
    totalCases: Number(summary?.totalCases ?? 0),
    inProgressCount: Number(summary?.inProgressCount ?? 0),
    reviewingDocsCount: 0,
    todayTasksCount: allVisibleSchedules.results.filter((entry) => kstDateKey(new Date(entry.date)) === today).length,
    delayedCount: allVisibleSchedules.results.filter((entry) => new Date(entry.date).getTime() < Date.now() && kstDateKey(new Date(entry.date)) !== today).length,
    recentCases: recent.results,
    upcomingSchedules: schedules.results.map((schedule) => ({
      id: schedule.id, title: schedule.title, type: schedule.type, date: schedule.date, location: schedule.location,
      dDayInfo: previewDDay(schedule.date), case: { id: schedule.caseId, caseNumber: schedule.caseNumber, title: schedule.caseTitle }
    })),
    phase: 'CF06_D1_CASE_OPERATIONS'
  });
}

async function handlePreviewCases(request: Request, env: CloudflareEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  const user = await previewSessionUser(request, env);
  if (!user) return json({ error: 'Login is required', code: 'AUTH_REQUIRED' }, 401);
  const casePath = url.pathname.match(/^\/api\/cases\/([0-9a-f-]{36})(?:\/(status|parties|schedules))?$/iu);

  if (url.pathname === '/api/cases' && request.method === 'GET') {
    const query = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
    const limitRaw = Number(url.searchParams.get('limit') ?? 50);
    if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 100) return json({ error: 'limit must be between 1 and 100', code: 'INVALID_PAGINATION' }, 400);
    const admin = user.roles.includes('admin') ? 1 : 0;
    const like = `%${query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    const where = "c.organization_id = ? AND c.deleted_at IS NULL AND (? = 1 OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id = c.id AND a.user_id = ?)) AND (? = '' OR c.title LIKE ? ESCAPE '\\' OR c.case_number LIKE ? ESCAPE '\\')";
    const rows = await env.DB.prepare(
      `SELECT c.id, c.case_number AS caseNumber, c.title, c.description, c.claim_type AS claimType, c.status, c.version, c.category_major AS categoryMajor, c.category_middle AS categoryMiddle, c.category_minor AS categoryMinor, c.created_at AS createdAt, c.updated_at AS updatedAt FROM preview_cases c WHERE ${where} ORDER BY c.updated_at DESC LIMIT ?`
    ).bind(PREVIEW_ORGANIZATION_ID, admin, user.id, query, like, like, limitRaw).all<PreviewCaseRow>();
    const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM preview_cases c WHERE ${where}`).bind(PREVIEW_ORGANIZATION_ID, admin, user.id, query, like, like).first<{ total: number }>();
    return json({ cases: rows.results.map(previewCaseProjection), total: Number(count?.total ?? 0), phase: 'CF06_D1_CASE_OPERATIONS' });
  }

  if (url.pathname === '/api/cases' && request.method === 'POST') {
    if (!canMutatePreviewCases(user)) return json({ error: 'Role cannot create cases', code: 'FORBIDDEN' }, 403);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !exactObjectKeys(body, ['title', 'claimType', 'description', 'category'])) return json({ error: 'Case payload is invalid', code: 'INVALID_CASE_PAYLOAD' }, 400);
    const category = body.category as Record<string, unknown> | null;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const claimType = typeof body.claimType === 'string' ? body.claimType : '';
    if (!title || title.length > 500 || description.length > 5000 || !PREVIEW_CLAIM_TYPES.has(claimType) || !category || !exactObjectKeys(category, ['major', 'middle', 'minor'])) return json({ error: 'Case title, type, description, or category is invalid', code: 'INVALID_CASE_PAYLOAD' }, 400);
    const major = typeof category.major === 'string' ? category.major.trim() : '';
    const middle = typeof category.middle === 'string' ? category.middle.trim() : '';
    const minor = typeof category.minor === 'string' ? category.minor.trim() : '';
    if (![major, middle, minor].every((entry) => entry.length >= 1 && entry.length <= 100)) return json({ error: 'All three category levels are required', code: 'INVALID_CASE_CATEGORY' }, 400);
    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (idempotencyKey && !PREVIEW_CASE_CREATE_KEY.test(idempotencyKey)) return json({ error: 'Idempotency-Key is invalid', code: 'INVALID_IDEMPOTENCY_KEY' }, 400);
    const fingerprint = idempotencyKey ? await sha256Hex(JSON.stringify({ title, description, claimType, major, middle, minor })) : null;
    if (idempotencyKey) {
      const existing = await env.DB.prepare(
        'SELECT id, request_fingerprint AS requestFingerprint FROM preview_cases WHERE organization_id = ? AND idempotency_key = ?'
      ).bind(PREVIEW_ORGANIZATION_ID, idempotencyKey).first<{ id: string; requestFingerprint: string }>();
      if (existing) return existing.requestFingerprint === fingerprint ? previewCaseDetail(env, user, existing.id) : json({ error: 'Idempotency key was used for different case data', code: 'IDEMPOTENCY_MISMATCH' }, 409);
    }
    const caseId = crypto.randomUUID();
    const sequence = await env.DB.prepare('INSERT INTO preview_case_sequences (case_id) VALUES (?)').bind(caseId).run();
    const ordinal = Number(sequence.meta?.last_row_id ?? 0);
    if (!ordinal) return json({ error: 'Case number allocation failed', code: 'CASE_SEQUENCE_FAILED' }, 503);
    const now = new Date().toISOString();
    const caseNumber = `CC-${new Date().getUTCFullYear()}-${String(ordinal).padStart(5, '0')}`;
    if (!env.DB.batch) return json({ error: 'D1 batch is unavailable', code: 'D1_BATCH_REQUIRED' }, 503);
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO preview_cases (id, organization_id, case_number, title, description, claim_type, status, version, category_major, category_middle, category_minor, created_by, idempotency_key, request_fingerprint, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, NULL)').bind(caseId, PREVIEW_ORGANIZATION_ID, caseNumber, title, description || null, claimType, 'INQUIRY', major, middle, minor, user.id, idempotencyKey, fingerprint, now, now),
        env.DB.prepare('INSERT INTO preview_case_assignments (case_id, user_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?)').bind(caseId, user.id, user.id, now),
        env.DB.prepare('INSERT INTO preview_case_activities (id, case_id, actor_id, event_type, title, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), caseId, user.id, 'CASE_CREATED', '사건 등록', `${claimType} · ${caseNumber}`, now)
      ]);
      const response = await previewCaseDetail(env, user, caseId);
      return new Response(response.body, { status: 201, headers: response.headers });
    } catch {
      if (idempotencyKey) {
        const existing = await env.DB.prepare('SELECT id, request_fingerprint AS requestFingerprint FROM preview_cases WHERE organization_id = ? AND idempotency_key = ?').bind(PREVIEW_ORGANIZATION_ID, idempotencyKey).first<{ id: string; requestFingerprint: string }>();
        if (existing?.requestFingerprint === fingerprint) return previewCaseDetail(env, user, existing.id);
      }
      return json({ error: 'Case could not be created', code: 'CASE_CREATE_FAILED' }, 409);
    }
  }

  if (!casePath) return json({ error: 'Case route was not found', code: 'CASE_ROUTE_NOT_FOUND' }, 404);
  const [, caseId, action] = casePath;
  if (!action && request.method === 'GET') return previewCaseDetail(env, user, caseId);
  if (!canMutatePreviewCases(user)) return json({ error: 'Role cannot mutate cases', code: 'FORBIDDEN' }, 403);
  const row = await accessiblePreviewCase(env, user, caseId);
  if (!row) return json({ error: 'Case was not found or is not assigned to this user', code: 'CASE_NOT_FOUND' }, 404);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: 'JSON body is required', code: 'INVALID_CASE_PAYLOAD' }, 400);
  const now = new Date().toISOString();

  if (action === 'status' && request.method === 'POST') {
    if (!exactObjectKeys(body, ['toStatus', 'reason', 'version']) || typeof body.toStatus !== 'string' || typeof body.reason !== 'string' || !Number.isInteger(body.version)) return json({ error: 'Status payload is invalid', code: 'INVALID_STATUS_PAYLOAD' }, 400);
    const currentIndex = PREVIEW_CASE_STATUSES.indexOf(row.status as typeof PREVIEW_CASE_STATUSES[number]);
    const expectedNext = PREVIEW_CASE_STATUSES[currentIndex + 1];
    if (body.toStatus !== expectedNext) return json({ error: `Status must advance from ${row.status} to ${expectedNext ?? 'no further state'}`, code: 'INVALID_STATUS_TRANSITION' }, 409);
    if (body.version !== row.version) return json({ error: 'Case was updated in another session', code: 'VERSION_CONFLICT', currentVersion: row.version }, 409);
    if (!env.DB.batch) return json({ error: 'D1 batch is unavailable', code: 'D1_BATCH_REQUIRED' }, 503);
    const results = await env.DB.batch([
      env.DB.prepare('UPDATE preview_cases SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND organization_id = ? AND version = ? AND status = ?').bind(body.toStatus, now, caseId, PREVIEW_ORGANIZATION_ID, body.version, row.status),
      env.DB.prepare('INSERT INTO preview_case_activities (id, case_id, actor_id, event_type, title, description, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM preview_cases WHERE id = ? AND version = ? AND status = ?)').bind(crypto.randomUUID(), caseId, user.id, 'STATUS_CHANGED', `상태 변경 · ${body.toStatus}`, body.reason.trim().slice(0, 2000) || null, now, caseId, row.version + 1, body.toStatus)
    ]) as Array<{ meta?: { changes?: number } }>;
    if (results[0]?.meta?.changes !== 1) return json({ error: 'Case was updated in another session', code: 'VERSION_CONFLICT' }, 409);
    return previewCaseDetail(env, user, caseId);
  }

  if (action === 'parties' && request.method === 'POST') {
    if (!exactObjectKeys(body, ['name', 'role', 'contact']) || typeof body.name !== 'string') return json({ error: 'Party payload is invalid', code: 'INVALID_PARTY_PAYLOAD' }, 400);
    const name = body.name.trim();
    const role = typeof body.role === 'string' ? body.role.trim() : 'OTHER';
    const contact = typeof body.contact === 'string' ? body.contact.trim() : '';
    if (!name || name.length > 200 || !role || role.length > 80 || contact.length > 300) return json({ error: 'Party fields exceed limits', code: 'INVALID_PARTY_PAYLOAD' }, 400);
    if (!env.DB.batch) return json({ error: 'D1 batch is unavailable', code: 'D1_BATCH_REQUIRED' }, 503);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO preview_case_parties (id, case_id, name, role, contact, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), caseId, name, role, contact || null, user.id, now),
      env.DB.prepare('INSERT INTO preview_case_activities (id, case_id, actor_id, event_type, title, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), caseId, user.id, 'PARTY_ADDED', '관계자 추가', name, now)
    ]);
    return previewCaseDetail(env, user, caseId);
  }

  if (action === 'schedules' && request.method === 'POST') {
    if (!exactObjectKeys(body, ['title', 'type', 'date', 'location']) || typeof body.title !== 'string' || typeof body.type !== 'string' || typeof body.date !== 'string') return json({ error: 'Schedule payload is invalid', code: 'INVALID_SCHEDULE_PAYLOAD' }, 400);
    const title = body.title.trim();
    const scheduledAt = new Date(body.date);
    const location = typeof body.location === 'string' ? body.location.trim() : '';
    if (!title || title.length > 300 || !['COURT', 'CLIENT', 'INTERNAL'].includes(body.type) || Number.isNaN(scheduledAt.getTime()) || location.length > 300) return json({ error: 'Schedule fields are invalid', code: 'INVALID_SCHEDULE_PAYLOAD' }, 400);
    if (!env.DB.batch) return json({ error: 'D1 batch is unavailable', code: 'D1_BATCH_REQUIRED' }, 503);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO preview_case_schedules (id, case_id, title, type, scheduled_at, location, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), caseId, title, body.type, scheduledAt.toISOString(), location || null, user.id, now),
      env.DB.prepare('INSERT INTO preview_case_activities (id, case_id, actor_id, event_type, title, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), caseId, user.id, 'SCHEDULE_ADDED', '일정 추가', title, now)
    ]);
    return previewCaseDetail(env, user, caseId);
  }

  return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405);
}

// CF07 report authoring persistence. Binary exports and approvals remain later
// phases; this slice protects the user's active text and every saved revision.
const PREVIEW_REPORT_EDIT_ROLES = new Set(['admin', 'ceo', 'director', 'pm', 'staff']);

interface PreviewReportDraftRow {
  caseId: string;
  title: string;
  content: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedById: string;
  updatedByName: string;
}

async function previewReportPayload(env: CloudflareEnv, caseId: string): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  const draft = await env.DB.prepare(
    'SELECT d.case_id AS caseId, d.title, d.content, d.version, d.created_at AS createdAt, d.updated_at AS updatedAt, ' +
    'u.id AS updatedById, u.display_name AS updatedByName FROM preview_report_drafts d ' +
    'JOIN preview_users u ON u.id = d.updated_by WHERE d.case_id = ? AND d.organization_id = ?'
  ).bind(caseId, PREVIEW_ORGANIZATION_ID).first<PreviewReportDraftRow>();
  const revisions = await env.DB.prepare(
    'SELECT r.id, r.version, r.title, r.content_sha256 AS contentSha256, r.saved_at AS savedAt, u.id AS savedById, u.display_name AS savedByName ' +
    'FROM preview_report_revisions r JOIN preview_users u ON u.id = r.saved_by WHERE r.case_id = ? ORDER BY r.version DESC LIMIT 20'
  ).bind(caseId).all<{ id: string; version: number; title: string; contentSha256: string; savedAt: string; savedById: string; savedByName: string }>();
  return json({
    draft: draft ? {
      caseId: draft.caseId,
      title: draft.title,
      content: draft.content,
      version: Number(draft.version),
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      updatedBy: { id: draft.updatedById, name: draft.updatedByName }
    } : null,
    revisions: revisions.results.map((revision) => ({
      id: revision.id,
      version: Number(revision.version),
      title: revision.title,
      contentSha256: revision.contentSha256,
      savedAt: revision.savedAt,
      savedBy: { id: revision.savedById, name: revision.savedByName }
    })),
    phase: 'CF07_D1_REPORT_AUTOSAVE'
  });
}

async function handlePreviewReportDraft(request: Request, env: CloudflareEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  const user = await previewSessionUser(request, env);
  if (!user) return json({ error: 'Login is required', code: 'AUTH_REQUIRED' }, 401);
  if (url.pathname !== '/api/report-drafts') return json({ error: 'Report draft route was not found', code: 'REPORT_ROUTE_NOT_FOUND' }, 404);
  const caseId = url.searchParams.get('caseId') ?? '';
  if (!PREVIEW_DRAFT_KEY.test(caseId)) return json({ error: 'A valid caseId is required', code: 'INVALID_CASE_ID' }, 400);
  const caseRow = await accessiblePreviewCase(env, user, caseId);
  if (!caseRow) return json({ error: 'Case was not found or is not assigned to this user', code: 'CASE_NOT_FOUND' }, 404);

  if (request.method === 'GET') return previewReportPayload(env, caseId);
  if (request.method !== 'PUT') return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405);
  if (!user.roles.some((role) => PREVIEW_REPORT_EDIT_ROLES.has(role))) return json({ error: 'Role cannot edit report drafts', code: 'FORBIDDEN' }, 403);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !exactObjectKeys(body, ['title', 'content', 'expectedVersion']) || typeof body.title !== 'string' || typeof body.content !== 'string' || !Number.isInteger(body.expectedVersion)) {
    return json({ error: 'Report draft payload is invalid', code: 'INVALID_REPORT_PAYLOAD' }, 400);
  }
  const title = body.title.trim();
  const content = body.content;
  const expectedVersion = Number(body.expectedVersion);
  if (!title || title.length > 300 || content.length > 500_000 || expectedVersion < 0) return json({ error: 'Report draft exceeds field limits', code: 'INVALID_REPORT_PAYLOAD' }, 400);
  if (!env.DB.batch) return json({ error: 'D1 batch is unavailable', code: 'D1_BATCH_REQUIRED' }, 503);

  const existing = await env.DB.prepare('SELECT version, updated_at AS updatedAt FROM preview_report_drafts WHERE case_id = ? AND organization_id = ?').bind(caseId, PREVIEW_ORGANIZATION_ID).first<{ version: number; updatedAt: string }>();
  const contentSha256 = await sha256Hex(content);
  if (!existing) {
    if (expectedVersion !== 0) return json({ error: 'Report version changed in another session', code: 'VERSION_CONFLICT', currentVersion: 0 }, 409);
    const now = new Date().toISOString();
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO preview_report_drafts (case_id, organization_id, title, content, version, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)').bind(caseId, PREVIEW_ORGANIZATION_ID, title, content, user.id, user.id, now, now),
        env.DB.prepare('INSERT INTO preview_report_revisions (id, case_id, version, title, content, content_sha256, saved_by, saved_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), caseId, title, content, contentSha256, user.id, now),
        env.DB.prepare('INSERT INTO preview_case_activities (id, case_id, actor_id, event_type, title, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), caseId, user.id, 'REPORT_AUTOSAVED', '보고서 초안 저장 · v1', title, now)
      ]);
    } catch {
      const canonical = await env.DB.prepare('SELECT version FROM preview_report_drafts WHERE case_id = ?').bind(caseId).first<{ version: number }>();
      return json({ error: 'Report version changed in another session', code: 'VERSION_CONFLICT', currentVersion: Number(canonical?.version ?? 0) }, 409);
    }
    return previewReportPayload(env, caseId);
  }

  if (expectedVersion !== Number(existing.version)) return json({ error: 'Report version changed in another session', code: 'VERSION_CONFLICT', currentVersion: Number(existing.version) }, 409);
  const nextVersion = Number(existing.version) + 1;
  const now = new Date(Math.max(Date.now(), Date.parse(existing.updatedAt) + 1)).toISOString();
  const results = await env.DB.batch([
    env.DB.prepare('UPDATE preview_report_drafts SET title = ?, content = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE case_id = ? AND organization_id = ? AND version = ?').bind(title, content, user.id, now, caseId, PREVIEW_ORGANIZATION_ID, expectedVersion),
    env.DB.prepare('INSERT INTO preview_report_revisions (id, case_id, version, title, content, content_sha256, saved_by, saved_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM preview_report_drafts WHERE case_id = ? AND version = ?)').bind(crypto.randomUUID(), caseId, nextVersion, title, content, contentSha256, user.id, now, caseId, nextVersion),
    env.DB.prepare('INSERT INTO preview_case_activities (id, case_id, actor_id, event_type, title, description, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM preview_report_drafts WHERE case_id = ? AND version = ?)').bind(crypto.randomUUID(), caseId, user.id, 'REPORT_AUTOSAVED', `보고서 초안 저장 · v${nextVersion}`, title, now, caseId, nextVersion)
  ]) as Array<{ meta?: { changes?: number } }>;
  if (results[0]?.meta?.changes !== 1) return json({ error: 'Report version changed in another session', code: 'VERSION_CONFLICT' }, 409);
  return previewReportPayload(env, caseId);
}

// CF08 report review and approval. Each request points to one immutable CF07
// revision; a different active user must make the terminal decision.
const PREVIEW_REVIEW_DECISION_ROLES = new Set(['admin', 'ceo', 'director', 'reviewer']);
const PREVIEW_REVIEW_KEY = /^[A-Za-z0-9._:-]{8,128}$/u;

interface PreviewReportReviewRow {
  id: string;
  caseId: string;
  caseNumber: string;
  caseTitle: string;
  reportRevisionId: string;
  reportVersion: number;
  reportTitle: string;
  status: 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED';
  requestedById: string;
  requestedByName: string;
  requestNote: string | null;
  requestedAt: string;
  reviewedById: string | null;
  reviewedByName: string | null;
  decisionNote: string | null;
  reviewedAt: string | null;
}

function previewReviewProjection(row: PreviewReportReviewRow): Record<string, unknown> {
  return {
    id: row.id,
    caseId: row.caseId,
    caseNumber: row.caseNumber,
    caseTitle: row.caseTitle,
    reportRevisionId: row.reportRevisionId,
    reportVersion: Number(row.reportVersion),
    reportTitle: row.reportTitle,
    status: row.status,
    requestedBy: { id: row.requestedById, name: row.requestedByName },
    requestNote: row.requestNote,
    requestedAt: row.requestedAt,
    reviewedBy: row.reviewedById ? { id: row.reviewedById, name: row.reviewedByName } : null,
    decisionNote: row.decisionNote,
    reviewedAt: row.reviewedAt
  };
}

async function previewReportReviewList(env: CloudflareEnv, user: SessionUser, caseId = ''): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  const rows = await env.DB.prepare(
    'SELECT v.id, v.case_id AS caseId, c.case_number AS caseNumber, c.title AS caseTitle, v.report_revision_id AS reportRevisionId, ' +
    'v.report_version AS reportVersion, r.title AS reportTitle, v.status, v.requested_by AS requestedById, requester.display_name AS requestedByName, ' +
    'v.request_note AS requestNote, v.requested_at AS requestedAt, v.reviewed_by AS reviewedById, reviewer.display_name AS reviewedByName, ' +
    'v.decision_note AS decisionNote, v.reviewed_at AS reviewedAt FROM preview_report_reviews v ' +
    'JOIN preview_cases c ON c.id = v.case_id JOIN preview_report_revisions r ON r.id = v.report_revision_id ' +
    'JOIN preview_users requester ON requester.id = v.requested_by LEFT JOIN preview_users reviewer ON reviewer.id = v.reviewed_by ' +
    'WHERE v.organization_id = ? AND (? = \'\' OR v.case_id = ?) ' +
    'AND (? = 1 OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id = v.case_id AND a.user_id = ?)) ' +
    'ORDER BY CASE v.status WHEN \'PENDING\' THEN 0 ELSE 1 END, v.requested_at DESC LIMIT 100'
  ).bind(PREVIEW_ORGANIZATION_ID, caseId, caseId, user.roles.includes('admin') ? 1 : 0, user.id).all<PreviewReportReviewRow>();
  return json({ reviews: rows.results.map(previewReviewProjection), phase: 'CF08_D1_REPORT_APPROVAL' });
}

async function handlePreviewReportReviews(request: Request, env: CloudflareEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  const user = await previewSessionUser(request, env);
  if (!user) return json({ error: 'Login is required', code: 'AUTH_REQUIRED' }, 401);

  if (url.pathname === '/api/report-reviews' && request.method === 'GET') {
    const caseId = url.searchParams.get('caseId') ?? '';
    if (caseId && !PREVIEW_DRAFT_KEY.test(caseId)) return json({ error: 'A valid caseId is required', code: 'INVALID_CASE_ID' }, 400);
    return previewReportReviewList(env, user, caseId);
  }

  if (url.pathname === '/api/report-reviews' && request.method === 'POST') {
    if (!user.roles.some((role) => PREVIEW_REPORT_EDIT_ROLES.has(role))) return json({ error: 'Role cannot request report review', code: 'FORBIDDEN' }, 403);
    const idempotencyKey = request.headers.get('Idempotency-Key') ?? '';
    if (!PREVIEW_REVIEW_KEY.test(idempotencyKey)) return json({ error: 'A valid Idempotency-Key is required', code: 'INVALID_IDEMPOTENCY_KEY' }, 400);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !exactObjectKeys(body, ['caseId', 'expectedVersion', 'note']) || typeof body.caseId !== 'string' || !Number.isInteger(body.expectedVersion) || typeof body.note !== 'string') {
      return json({ error: 'Review request payload is invalid', code: 'INVALID_REVIEW_PAYLOAD' }, 400);
    }
    const caseId = body.caseId;
    const expectedVersion = Number(body.expectedVersion);
    const note = body.note.trim();
    if (!PREVIEW_DRAFT_KEY.test(caseId) || expectedVersion < 1 || note.length > 2000) return json({ error: 'Review request exceeds field limits', code: 'INVALID_REVIEW_PAYLOAD' }, 400);
    if (!await accessiblePreviewCase(env, user, caseId)) return json({ error: 'Case was not found or is not assigned to this user', code: 'CASE_NOT_FOUND' }, 404);

    const fingerprint = await sha256Hex(JSON.stringify({ caseId, expectedVersion, note }));
    const replay = await env.DB.prepare('SELECT id, request_fingerprint AS requestFingerprint FROM preview_report_reviews WHERE organization_id = ? AND request_key = ?').bind(PREVIEW_ORGANIZATION_ID, idempotencyKey).first<{ id: string; requestFingerprint: string }>();
    if (replay) return replay.requestFingerprint === fingerprint ? previewReportReviewList(env, user, caseId) : json({ error: 'Idempotency key was used for a different review request', code: 'IDEMPOTENCY_MISMATCH' }, 409);

    const source = await env.DB.prepare(
      'SELECT d.version, d.content, r.id AS revisionId FROM preview_report_drafts d JOIN preview_report_revisions r ON r.case_id = d.case_id AND r.version = d.version ' +
      'WHERE d.case_id = ? AND d.organization_id = ?'
    ).bind(caseId, PREVIEW_ORGANIZATION_ID).first<{ version: number; content: string; revisionId: string }>();
    if (!source) return json({ error: 'Save the report before requesting review', code: 'REPORT_NOT_SAVED' }, 409);
    if (Number(source.version) !== expectedVersion) return json({ error: 'The report version changed before review submission', code: 'VERSION_CONFLICT', currentVersion: Number(source.version) }, 409);
    if (!source.content.trim()) return json({ error: 'An empty report cannot be submitted for review', code: 'EMPTY_REPORT' }, 409);
    if (!env.DB.batch) return json({ error: 'D1 batch is unavailable', code: 'D1_BATCH_REQUIRED' }, 503);

    const reviewId = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO preview_report_reviews (id, organization_id, case_id, report_revision_id, report_version, status, requested_by, request_note, request_key, request_fingerprint, requested_at, reviewed_by, decision_note, reviewed_at) VALUES (?, ?, ?, ?, ?, \'PENDING\', ?, ?, ?, ?, ?, NULL, NULL, NULL)').bind(reviewId, PREVIEW_ORGANIZATION_ID, caseId, source.revisionId, expectedVersion, user.id, note || null, idempotencyKey, fingerprint, now),
        env.DB.prepare('INSERT INTO preview_report_review_events (id, review_id, event_type, actor_id, note, created_at) VALUES (?, ?, \'REVIEW_REQUESTED\', ?, ?, ?)').bind(crypto.randomUUID(), reviewId, user.id, note || null, now),
        env.DB.prepare('INSERT INTO preview_case_activities (id, case_id, actor_id, event_type, title, description, created_at) VALUES (?, ?, ?, \'REPORT_REVIEW_REQUESTED\', ?, ?, ?)').bind(crypto.randomUUID(), caseId, user.id, `보고서 검토 요청 · v${expectedVersion}`, note || null, now)
      ]);
    } catch {
      const canonical = await env.DB.prepare('SELECT request_fingerprint AS requestFingerprint FROM preview_report_reviews WHERE organization_id = ? AND request_key = ?').bind(PREVIEW_ORGANIZATION_ID, idempotencyKey).first<{ requestFingerprint: string }>();
      if (canonical?.requestFingerprint === fingerprint) return previewReportReviewList(env, user, caseId);
      return json({ error: 'This report version already has a review request', code: 'REVIEW_ALREADY_EXISTS' }, 409);
    }
    const payload = await previewReportReviewList(env, user, caseId);
    return new Response(payload.body, { status: 201, headers: payload.headers });
  }

  const decisionMatch = url.pathname.match(/^\/api\/report-reviews\/([0-9a-f-]{36})\/decision$/iu);
  if (decisionMatch && request.method === 'POST') {
    if (!user.roles.some((role) => PREVIEW_REVIEW_DECISION_ROLES.has(role))) return json({ error: 'Role cannot decide report reviews', code: 'FORBIDDEN' }, 403);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !exactObjectKeys(body, ['decision', 'note', 'expectedStatus']) || !['APPROVED', 'CHANGES_REQUESTED'].includes(String(body.decision)) || typeof body.note !== 'string' || body.expectedStatus !== 'PENDING') {
      return json({ error: 'Review decision payload is invalid', code: 'INVALID_DECISION_PAYLOAD' }, 400);
    }
    const status = String(body.decision) as 'APPROVED' | 'CHANGES_REQUESTED';
    const note = body.note.trim();
    if (note.length > 4000 || (status === 'CHANGES_REQUESTED' && !note)) return json({ error: 'A changes-requested decision requires a note', code: 'DECISION_NOTE_REQUIRED' }, 400);
    const review = await env.DB.prepare('SELECT id, case_id AS caseId, report_version AS reportVersion, status, requested_by AS requestedBy FROM preview_report_reviews WHERE id = ? AND organization_id = ?').bind(decisionMatch[1], PREVIEW_ORGANIZATION_ID).first<{ id: string; caseId: string; reportVersion: number; status: string; requestedBy: string }>();
    if (!review) return json({ error: 'Review request was not found', code: 'REVIEW_NOT_FOUND' }, 404);
    if (!await accessiblePreviewCase(env, user, review.caseId)) return json({ error: 'Case was not found or is not assigned to this user', code: 'CASE_NOT_FOUND' }, 404);
    if (review.requestedBy === user.id) return json({ error: 'The requester cannot decide their own report review', code: 'SELF_APPROVAL_FORBIDDEN' }, 403);
    if (review.status !== 'PENDING') return previewReportReviewList(env, user, review.caseId);
    const current = await env.DB.prepare('SELECT version FROM preview_report_drafts WHERE case_id = ? AND organization_id = ?').bind(review.caseId, PREVIEW_ORGANIZATION_ID).first<{ version: number }>();
    if (status === 'APPROVED' && Number(current?.version ?? 0) !== Number(review.reportVersion)) return json({ error: 'The report changed after this review was requested', code: 'REVIEW_OUTDATED', currentVersion: Number(current?.version ?? 0) }, 409);
    if (!env.DB.batch) return json({ error: 'D1 batch is unavailable', code: 'D1_BATCH_REQUIRED' }, 503);
    const now = new Date(Math.max(Date.now(), Date.now() + 1)).toISOString();
    const eventType = status === 'APPROVED' ? 'REPORT_APPROVED' : 'CHANGES_REQUESTED';
    const results = await env.DB.batch([
      env.DB.prepare('UPDATE preview_report_reviews SET status = ?, reviewed_by = ?, decision_note = ?, reviewed_at = ? WHERE id = ? AND organization_id = ? AND status = \'PENDING\' AND requested_by <> ?').bind(status, user.id, note || null, now, review.id, PREVIEW_ORGANIZATION_ID, user.id),
      env.DB.prepare('INSERT INTO preview_report_review_events (id, review_id, event_type, actor_id, note, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM preview_report_reviews WHERE id = ? AND status = ? AND reviewed_by = ?)').bind(crypto.randomUUID(), review.id, eventType, user.id, note || null, now, review.id, status, user.id),
      env.DB.prepare('INSERT INTO preview_case_activities (id, case_id, actor_id, event_type, title, description, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM preview_report_reviews WHERE id = ? AND status = ? AND reviewed_by = ?)').bind(crypto.randomUUID(), review.caseId, user.id, eventType, status === 'APPROVED' ? `보고서 승인 · v${review.reportVersion}` : `보고서 수정 요청 · v${review.reportVersion}`, note || null, now, review.id, status, user.id)
    ]) as Array<{ meta?: { changes?: number } }>;
    if (results[0]?.meta?.changes !== 1) return json({ error: 'Review was already decided in another session', code: 'REVIEW_STATUS_CONFLICT' }, 409);
    return previewReportReviewList(env, user, review.caseId);
  }

  return json({ error: 'Report review route was not found', code: 'REVIEW_ROUTE_NOT_FOUND' }, 404);
}

// CF09 final output. D1 keeps the immutable approval/finalization/output ledger;
// DOCX/PDF bytes are deterministically regenerated from that exact revision.
const PREVIEW_FINALIZE_ROLES = new Set(['admin', 'ceo', 'director', 'pm']);

interface PreviewFinalizationRow {
  id: string; caseId: string; caseNumber: string; caseTitle: string; reviewId: string;
  reportRevisionId: string; reportVersion: number; reportTitle: string; finalizedById: string;
  finalizedByName: string; finalizedAt: string; approvedByName: string; approvedAt: string;
}

function finalizationProjection(row: PreviewFinalizationRow, outputs: Array<Record<string, unknown>> = []): Record<string, unknown> {
  return {
    id: row.id, caseId: row.caseId, caseNumber: row.caseNumber, caseTitle: row.caseTitle,
    reviewId: row.reviewId, reportRevisionId: row.reportRevisionId, reportVersion: Number(row.reportVersion), reportTitle: row.reportTitle,
    finalizedBy: { id: row.finalizedById, name: row.finalizedByName }, finalizedAt: row.finalizedAt,
    approvedBy: row.approvedByName, approvedAt: row.approvedAt, outputs
  };
}

async function finalizationList(env: CloudflareEnv, user: SessionUser, caseId = ''): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  const rows = await env.DB.prepare(
    'SELECT f.id, f.case_id AS caseId, c.case_number AS caseNumber, c.title AS caseTitle, f.review_id AS reviewId, f.report_revision_id AS reportRevisionId, ' +
    'f.report_version AS reportVersion, r.title AS reportTitle, f.finalized_by AS finalizedById, finalizer.display_name AS finalizedByName, f.finalized_at AS finalizedAt, ' +
    'reviewer.display_name AS approvedByName, v.reviewed_at AS approvedAt FROM preview_report_finalizations f ' +
    'JOIN preview_cases c ON c.id=f.case_id JOIN preview_report_revisions r ON r.id=f.report_revision_id JOIN preview_report_reviews v ON v.id=f.review_id ' +
    'JOIN preview_users finalizer ON finalizer.id=f.finalized_by JOIN preview_users reviewer ON reviewer.id=v.reviewed_by ' +
    'WHERE f.organization_id=? AND (?=\'\' OR f.case_id=?) AND (?=1 OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=f.case_id AND a.user_id=?)) ' +
    'ORDER BY f.finalized_at DESC LIMIT 100'
  ).bind(PREVIEW_ORGANIZATION_ID, caseId, caseId, user.roles.includes('admin') ? 1 : 0, user.id).all<PreviewFinalizationRow>();
  const projections: Record<string, unknown>[] = [];
  for (const row of rows.results) {
    const outputs = await env.DB.prepare('SELECT id, format, file_name AS fileName, content_sha256 AS contentSha256, byte_size AS byteSize, created_at AS createdAt FROM preview_report_outputs WHERE finalization_id=? ORDER BY format').bind(row.id).all<Record<string, unknown>>();
    projections.push(finalizationProjection(row, outputs.results));
  }
  return json({ finalizations: projections, phase: 'CF09_D1_FINAL_OUTPUT' });
}

async function finalDocument(env: CloudflareEnv, finalizationId: string): Promise<(FinalReportDocument & { finalization: PreviewFinalizationRow }) | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    'SELECT f.id, f.case_id AS caseId, c.case_number AS caseNumber, c.title AS caseTitle, f.review_id AS reviewId, f.report_revision_id AS reportRevisionId, ' +
    'f.report_version AS reportVersion, r.title AS reportTitle, r.content, r.content_sha256 AS contentSha256, f.finalized_by AS finalizedById, ' +
    'finalizer.display_name AS finalizedByName, f.finalized_at AS finalizedAt, reviewer.display_name AS approvedByName, v.reviewed_at AS approvedAt ' +
    'FROM preview_report_finalizations f JOIN preview_cases c ON c.id=f.case_id JOIN preview_report_revisions r ON r.id=f.report_revision_id ' +
    'JOIN preview_report_reviews v ON v.id=f.review_id JOIN preview_users finalizer ON finalizer.id=f.finalized_by JOIN preview_users reviewer ON reviewer.id=v.reviewed_by ' +
    'WHERE f.id=? AND f.organization_id=?'
  ).bind(finalizationId, PREVIEW_ORGANIZATION_ID).first<PreviewFinalizationRow & { content: string; contentSha256: string }>();
  if (!row) return null;
  return {
    finalization: row, caseNumber: row.caseNumber, caseTitle: row.caseTitle, reportTitle: row.reportTitle,
    reportVersion: Number(row.reportVersion), content: row.content, contentSha256: row.contentSha256,
    approvedBy: row.approvedByName, approvedAt: row.approvedAt, finalizedBy: row.finalizedByName, finalizedAt: row.finalizedAt
  };
}

async function handlePreviewFinalOutput(request: Request, env: CloudflareEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  const user = await previewSessionUser(request, env);
  if (!user) return json({ error: 'Login is required', code: 'AUTH_REQUIRED' }, 401);
  if (url.pathname === '/api/report-finalizations' && request.method === 'GET') {
    const caseId = url.searchParams.get('caseId') ?? '';
    if (caseId && !PREVIEW_DRAFT_KEY.test(caseId)) return json({ error: 'A valid caseId is required', code: 'INVALID_CASE_ID' }, 400);
    return finalizationList(env, user, caseId);
  }
  if (url.pathname === '/api/report-finalizations' && request.method === 'POST') {
    if (!user.roles.some((role) => PREVIEW_FINALIZE_ROLES.has(role))) return json({ error: 'Role cannot finalize reports', code: 'FORBIDDEN' }, 403);
    const key = request.headers.get('Idempotency-Key') ?? '';
    if (!PREVIEW_REVIEW_KEY.test(key)) return json({ error: 'A valid Idempotency-Key is required', code: 'INVALID_IDEMPOTENCY_KEY' }, 400);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !exactObjectKeys(body, ['caseId', 'reviewId']) || typeof body.caseId !== 'string' || typeof body.reviewId !== 'string' || !PREVIEW_DRAFT_KEY.test(body.caseId) || !PREVIEW_DRAFT_KEY.test(body.reviewId)) return json({ error: 'Finalization payload is invalid', code: 'INVALID_FINALIZATION_PAYLOAD' }, 400);
    if (!await accessiblePreviewCase(env, user, body.caseId)) return json({ error: 'Case was not found or is not assigned to this user', code: 'CASE_NOT_FOUND' }, 404);
    const fingerprint = await sha256Hex(JSON.stringify({ caseId: body.caseId, reviewId: body.reviewId }));
    const replay = await env.DB.prepare('SELECT request_fingerprint AS fingerprint FROM preview_report_finalizations WHERE organization_id=? AND request_key=?').bind(PREVIEW_ORGANIZATION_ID, key).first<{ fingerprint: string }>();
    if (replay) return replay.fingerprint === fingerprint ? finalizationList(env, user, body.caseId) : json({ error: 'Idempotency key was used for a different finalization', code: 'IDEMPOTENCY_MISMATCH' }, 409);
    const source = await env.DB.prepare('SELECT v.report_revision_id AS revisionId, v.report_version AS reportVersion FROM preview_report_reviews v JOIN preview_report_drafts d ON d.case_id=v.case_id AND d.version=v.report_version WHERE v.id=? AND v.case_id=? AND v.organization_id=? AND v.status=\'APPROVED\'').bind(body.reviewId, body.caseId, PREVIEW_ORGANIZATION_ID).first<{ revisionId: string; reportVersion: number }>();
    if (!source) return json({ error: 'Only the currently approved report version can be finalized', code: 'APPROVED_REVISION_REQUIRED' }, 409);
    if (!env.DB.batch) return json({ error: 'D1 batch is unavailable', code: 'D1_BATCH_REQUIRED' }, 503);
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO preview_report_finalizations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, PREVIEW_ORGANIZATION_ID, body.caseId, body.reviewId, source.revisionId, source.reportVersion, user.id, now, key, fingerprint),
        env.DB.prepare('INSERT INTO preview_report_output_events VALUES (?, ?, NULL, \'REPORT_FINALIZED\', ?, ?)').bind(crypto.randomUUID(), id, user.id, now),
        env.DB.prepare('INSERT INTO preview_case_activities (id,case_id,actor_id,event_type,title,description,created_at) VALUES (?, ?, ?, \'REPORT_FINALIZED\', ?, NULL, ?)').bind(crypto.randomUUID(), body.caseId, user.id, `보고서 최종 확정 · v${source.reportVersion}`, now)
      ]);
    } catch {
      const canonical = await env.DB.prepare('SELECT request_fingerprint AS fingerprint FROM preview_report_finalizations WHERE organization_id=? AND request_key=?').bind(PREVIEW_ORGANIZATION_ID, key).first<{ fingerprint: string }>();
      if (canonical?.fingerprint !== fingerprint) return json({ error: 'Report finalization conflict', code: 'FINALIZATION_CONFLICT' }, 409);
    }
    const payload = await finalizationList(env, user, body.caseId);
    return new Response(payload.body, { status: 201, headers: payload.headers });
  }
  const outputMatch = url.pathname.match(/^\/api\/report-finalizations\/([0-9a-f-]{36})\/outputs$/iu);
  if (outputMatch && request.method === 'POST') {
    if (!user.roles.some((role) => PREVIEW_FINALIZE_ROLES.has(role))) return json({ error: 'Role cannot generate final outputs', code: 'FORBIDDEN' }, 403);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !exactObjectKeys(body, ['format']) || !['DOCX', 'PDF'].includes(String(body.format))) return json({ error: 'Output format is invalid', code: 'INVALID_OUTPUT_FORMAT' }, 400);
    const document = await finalDocument(env, outputMatch[1]);
    if (!document || !await accessiblePreviewCase(env, user, document.finalization.caseId)) return json({ error: 'Finalization was not found', code: 'FINALIZATION_NOT_FOUND' }, 404);
    const format = String(body.format) as 'DOCX' | 'PDF';
    const bytes = format === 'DOCX' ? generateFinalDocx(document) : generateFinalPdf(document);
    const digest = await sha256Hex(bytes);
    const safeName = document.reportTitle.replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 180) || 'final-report';
    const fileName = `${safeName}-v${document.reportVersion}.${format.toLowerCase()}`;
    const existing = await env.DB.prepare('SELECT id,content_sha256 AS contentSha256,byte_size AS byteSize FROM preview_report_outputs WHERE finalization_id=? AND format=?').bind(outputMatch[1], format).first<{ id: string; contentSha256: string; byteSize: number }>();
    if (existing && (existing.contentSha256 !== digest || Number(existing.byteSize) !== bytes.byteLength)) return json({ error: 'Deterministic output verification failed', code: 'OUTPUT_HASH_MISMATCH' }, 500);
    if (!existing) {
      if (!env.DB.batch) return json({ error: 'D1 batch is unavailable', code: 'D1_BATCH_REQUIRED' }, 503);
      const outputId = crypto.randomUUID(); const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare('INSERT INTO preview_report_outputs VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(outputId, outputMatch[1], format, fileName, digest, bytes.byteLength, user.id, now),
        env.DB.prepare('INSERT INTO preview_report_output_events VALUES (?, ?, ?, \'OUTPUT_GENERATED\', ?, ?)').bind(crypto.randomUUID(), outputMatch[1], outputId, user.id, now)
      ]);
    }
    return finalizationList(env, user, document.finalization.caseId);
  }
  const downloadMatch = url.pathname.match(/^\/api\/report-outputs\/([0-9a-f-]{36})\/download$/iu);
  if (downloadMatch && request.method === 'GET') {
    const output = await env.DB.prepare('SELECT o.id,o.finalization_id AS finalizationId,o.format,o.file_name AS fileName,o.content_sha256 AS contentSha256,o.byte_size AS byteSize,f.case_id AS caseId FROM preview_report_outputs o JOIN preview_report_finalizations f ON f.id=o.finalization_id WHERE o.id=?').bind(downloadMatch[1]).first<{ id: string; finalizationId: string; format: 'DOCX'|'PDF'; fileName: string; contentSha256: string; byteSize: number; caseId: string }>();
    if (!output || !await accessiblePreviewCase(env, user, output.caseId)) return json({ error: 'Output was not found', code: 'OUTPUT_NOT_FOUND' }, 404);
    const document = await finalDocument(env, output.finalizationId);
    if (!document) return json({ error: 'Finalization was not found', code: 'FINALIZATION_NOT_FOUND' }, 404);
    const bytes = output.format === 'DOCX' ? generateFinalDocx(document) : generateFinalPdf(document);
    if (await sha256Hex(bytes) !== output.contentSha256 || bytes.byteLength !== Number(output.byteSize)) return json({ error: 'Output integrity verification failed', code: 'OUTPUT_HASH_MISMATCH' }, 500);
    await env.DB.prepare('INSERT INTO preview_report_output_events VALUES (?, ?, ?, \'OUTPUT_DOWNLOADED\', ?, ?)').bind(crypto.randomUUID(), output.finalizationId, output.id, user.id, new Date().toISOString()).run();
    return new Response(bytes.buffer as ArrayBuffer, { headers: { 'Cache-Control': 'no-store', 'Content-Type': output.format === 'DOCX' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(output.fileName)}`, 'X-Content-SHA256': output.contentSha256, 'X-Content-Type-Options': 'nosniff' } });
  }
  return json({ error: 'Final output route was not found', code: 'FINAL_OUTPUT_ROUTE_NOT_FOUND' }, 404);
}

// Google Drive OAuth and evidence storage. The organization is intentionally
// fixed for this single-tenant preview; raw credentials never cross this file.
const PREVIEW_ORGANIZATION_ID = 'concost';
const GOOGLE_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/u;

interface GoogleCredentialRow {
  encryptedRefreshToken: string;
  iv: string;
  scope: string;
}

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

function googleFetch(env: CloudflareEnv): GoogleFetch {
  if (env.ALLOW_TEST_GOOGLE_MODES === 'true' && env.GOOGLE_TEST_FETCH) return env.GOOGLE_TEST_FETCH;
  return fetch;
}

function googleConfig(env: CloudflareEnv): { clientId: string; clientSecret: string; masterKey: string; redirectOrigin: string; allowedDomain: string } | null {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY: masterKey, GOOGLE_OAUTH_REDIRECT_ORIGIN: redirectOrigin, GOOGLE_ALLOWED_DOMAIN: allowedDomainRaw } = env;
  const allowedDomain = allowedDomainRaw?.trim().toLowerCase();
  if (!clientId || !clientSecret || !masterKey || !redirectOrigin || !allowedDomain || !/^[a-z0-9.-]+\.[a-z]{2,}$/u.test(allowedDomain)) return null;
  try {
    const origin = new URL(redirectOrigin);
    if (origin.protocol !== 'https:' || origin.origin !== redirectOrigin || origin.pathname !== '/') return null;
  } catch {
    return null;
  }
  return { clientId, clientSecret, masterKey, redirectOrigin, allowedDomain };
}

function googleFailure(reason: unknown): Response {
  if (reason instanceof GoogleDriveError) {
    return json({ error: reason.message, code: reason.code, retryAfterSeconds: reason.retryAfterSeconds, reconciliationRequired: reason.uncertain }, reason.status);
  }
  return json({ error: 'Google Drive operation failed safely', code: 'GOOGLE_OPERATION_FAILED' }, 502);
}

async function getGoogleDriveCredential(env: CloudflareEnv): Promise<{ refreshToken: string; scope: string } | null> {
  if (!env.DB) return null;
  const config = googleConfig(env);
  if (!config) return null;
  try {
    const row = await env.DB.prepare(
      'SELECT encrypted_refresh_token AS encryptedRefreshToken, iv, scope FROM preview_google_credentials WHERE organization_id = ?'
    ).bind(PREVIEW_ORGANIZATION_ID).first<GoogleCredentialRow>();
    if (!row || row.scope !== GOOGLE_DRIVE_SCOPE) return null;
    const refreshToken = await decryptSecret(row.encryptedRefreshToken, row.iv, config.masterKey, `${PREVIEW_ORGANIZATION_ID}:google-refresh`);
    return refreshToken ? { refreshToken, scope: row.scope } : null;
  } catch {
    return null;
  }
}

async function accessToken(env: CloudflareEnv): Promise<string> {
  const config = googleConfig(env);
  const credential = await getGoogleDriveCredential(env);
  if (!config || !credential) throw new GoogleDriveError('GOOGLE_DRIVE_NOT_CONNECTED', 503, 'Connect Google Drive before using file storage');
  return refreshAccessToken(googleFetch(env), { clientId: config.clientId, clientSecret: config.clientSecret, refreshToken: credential.refreshToken });
}

async function handleGoogleOAuth(request: Request, env: CloudflareEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  const sessionUser = await previewSessionUser(request, env);
  if (!sessionUser) return json({ error: 'Login is required', code: 'AUTH_REQUIRED' }, 401);
  const isAdmin = sessionUser.roles.includes('admin');

  if (url.pathname === '/api/google/status' && request.method === 'GET') {
    const config = googleConfig(env);
    const credential = await getGoogleDriveCredential(env);
    let accountEmail: string | null = null;
    if (config && credential && isAdmin) {
      try {
        const token = await refreshAccessToken(googleFetch(env), { clientId: config.clientId, clientSecret: config.clientSecret, refreshToken: credential.refreshToken });
        accountEmail = (await getDriveAccount(googleFetch(env), token)).email;
      } catch {
        accountEmail = null;
      }
    }
    const connected = Boolean(credential);
    return json({ connected, status: connected ? 'CONNECTED' : 'DISCONNECTED', configured: Boolean(config), accountEmail, allowedDomain: isAdmin ? config?.allowedDomain ?? null : null, storageProvider: 'GOOGLE_DRIVE', r2SkippedByUser: true, phase: 'CF05_GOOGLE_DRIVE_SYNC' });
  }

  if (!isAdmin) return json({ error: 'Admin role is required to manage Google Drive', code: 'FORBIDDEN' }, 403);
  const config = googleConfig(env);
  if (!config) return json({ error: 'Google OAuth secrets and exact redirect origin are not configured', code: 'GOOGLE_OAUTH_NOT_CONFIGURED' }, 503);
  if (url.origin !== config.redirectOrigin) return json({ error: 'OAuth request origin is not allowed', code: 'GOOGLE_REDIRECT_ORIGIN_MISMATCH' }, 400);
  const redirectUri = `${config.redirectOrigin}/api/google/oauth/callback`;

  if (url.pathname === '/api/google/oauth/start' && request.method === 'POST') {
    const pkce = await createPkce();
    const encrypted = await encryptSecret(pkce.verifier, config.masterKey, `${PREVIEW_ORGANIZATION_ID}:pkce:${pkce.stateHash}`);
    const now = new Date();
    await env.DB.prepare('DELETE FROM preview_google_pkce WHERE expires_at <= ? OR consumed_at IS NOT NULL').bind(now.toISOString()).run();
    await env.DB.prepare(
      'INSERT INTO preview_google_pkce (state_hash, encrypted_code_verifier, iv, redirect_uri, actor_id, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)'
    ).bind(pkce.stateHash, encrypted.ciphertextHex, encrypted.ivHex, redirectUri, sessionUser.id, now.toISOString(), new Date(now.getTime() + 10 * 60_000).toISOString()).run();
    return json({ authorizationUrl: buildAuthorizationUrl(config.clientId, redirectUri, pkce.state, pkce.challenge), phase: 'CF05_GOOGLE_DRIVE_SYNC' });
  }

  if (url.pathname === '/api/google/oauth/callback' && request.method === 'GET') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || code.length > 2048 || !state || state.length > 256) return json({ error: 'OAuth callback is invalid', code: 'INVALID_OAUTH_CALLBACK' }, 400);
    const stateHash = await sha256Hex(state);
    const now = new Date().toISOString();
    const pkce = await env.DB.prepare(
      'UPDATE preview_google_pkce SET consumed_at = ? WHERE state_hash = ? AND actor_id = ? AND redirect_uri = ? AND consumed_at IS NULL AND expires_at > ? ' +
      'RETURNING encrypted_code_verifier AS encryptedCodeVerifier, iv'
    ).bind(now, stateHash, sessionUser.id, redirectUri, now).first<{ encryptedCodeVerifier: string; iv: string }>();
    if (!pkce) return json({ error: 'OAuth state is invalid, expired, or already used', code: 'INVALID_OAUTH_STATE' }, 409);
    const verifier = await decryptSecret(pkce.encryptedCodeVerifier, pkce.iv, config.masterKey, `${PREVIEW_ORGANIZATION_ID}:pkce:${stateHash}`);
    if (!verifier) return json({ error: 'OAuth verifier could not be decrypted', code: 'INVALID_OAUTH_VERIFIER' }, 409);
    let newlyIssuedRefreshToken: string | null = null;
    try {
      const previousCredential = await getGoogleDriveCredential(env);
      const exchanged = await exchangeAuthorizationCode(googleFetch(env), { clientId: config.clientId, clientSecret: config.clientSecret, code, verifier, redirectUri });
      newlyIssuedRefreshToken = exchanged.refreshToken;
      const account = await getDriveAccount(googleFetch(env), exchanged.accessToken);
      if (!isAllowedGoogleAccountEmail(account.email, config.allowedDomain)) {
        await revokeGoogleCredential(googleFetch(env), exchanged.refreshToken).catch(() => undefined);
        return json({ error: `Only ${config.allowedDomain} company accounts may be connected`, code: 'GOOGLE_COMPANY_ACCOUNT_REQUIRED' }, 403);
      }
      const encrypted = await encryptSecret(exchanged.refreshToken, config.masterKey, `${PREVIEW_ORGANIZATION_ID}:google-refresh`);
      if (!env.DB.batch) throw new Error('D1 batch unavailable');
      await env.DB.batch([env.DB.prepare(
        'INSERT INTO preview_google_credentials (organization_id, encrypted_refresh_token, iv, scope, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(organization_id) DO UPDATE SET encrypted_refresh_token = excluded.encrypted_refresh_token, iv = excluded.iv, scope = excluded.scope, created_by = excluded.created_by, updated_at = excluded.updated_at'
      ).bind(PREVIEW_ORGANIZATION_ID, encrypted.ciphertextHex, encrypted.ivHex, exchanged.scope, sessionUser.id, now, now), env.DB.prepare(
        'DELETE FROM preview_google_case_folders WHERE organization_id = ?'
      ).bind(PREVIEW_ORGANIZATION_ID)]);
      if (previousCredential && previousCredential.refreshToken !== exchanged.refreshToken) {
        await revokeGoogleCredential(googleFetch(env), previousCredential.refreshToken).catch(() => undefined);
      }
      return Response.redirect(`${config.redirectOrigin}/integrations/google?google=connected&folder=rebind-required`, 303);
    } catch (reason) {
      if (newlyIssuedRefreshToken) {
        await revokeGoogleCredential(googleFetch(env), newlyIssuedRefreshToken).catch(() => undefined);
      }
      return googleFailure(reason);
    }
  }

  if (url.pathname === '/api/google/oauth/disconnect' && request.method === 'POST') {
    const credential = await getGoogleDriveCredential(env);
    if (!credential) return json({ disconnected: true, status: 'DISCONNECTED', phase: 'CF05_GOOGLE_DRIVE_SYNC' });
    try {
      await revokeGoogleCredential(googleFetch(env), credential.refreshToken);
      if (!env.DB.batch) throw new Error('D1 batch unavailable');
      await env.DB.batch([
        env.DB.prepare('DELETE FROM preview_google_credentials WHERE organization_id = ?').bind(PREVIEW_ORGANIZATION_ID),
        env.DB.prepare('DELETE FROM preview_google_case_folders WHERE organization_id = ?').bind(PREVIEW_ORGANIZATION_ID)
      ]);
      return json({ disconnected: true, status: 'DISCONNECTED', phase: 'CF05_GOOGLE_DRIVE_SYNC' });
    } catch (reason) {
      return googleFailure(reason);
    }
  }

  if (url.pathname === '/api/google/folders/bind' && request.method === 'POST') {
    const draftId = await previewDraftId(request);
    if (!draftId) return json({ error: 'A valid preview draft key is required', code: 'INVALID_PREVIEW_DRAFT_KEY' }, 401);
    const body = await request.json().catch(() => null) as { folderId?: unknown } | null;
    if (!body || typeof body.folderId !== 'string') return json({ error: 'folderId is required', code: 'INVALID_FOLDER_PAYLOAD' }, 400);
    try {
      const folder = await verifyDriveFolder(googleFetch(env), await accessToken(env), body.folderId);
      const now = new Date().toISOString();
      await env.DB.prepare(
        'INSERT INTO preview_google_case_folders (draft_id, organization_id, google_folder_id, bound_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(draft_id) DO UPDATE SET google_folder_id = excluded.google_folder_id, bound_by = excluded.bound_by, updated_at = excluded.updated_at'
      ).bind(draftId, PREVIEW_ORGANIZATION_ID, folder.id, sessionUser.id, now, now).run();
      return json({ folder: { id: folder.id, name: folder.name }, phase: 'CF05_GOOGLE_DRIVE_SYNC' });
    } catch (reason) {
      return googleFailure(reason);
    }
  }

  return json({ error: 'Google OAuth route not found', code: 'NOT_FOUND' }, 404);
}

async function replayEvidence(env: CloudflareEnv, draftId: string, idempotencyKey: string, fingerprint: string): Promise<Response | null> {
  if (!env.DB) return null;
  const operation = await env.DB.prepare(
    'SELECT status, request_fingerprint AS requestFingerprint, google_file_id AS googleFileId FROM preview_google_operations WHERE draft_id = ? AND idempotency_key = ?'
  ).bind(draftId, idempotencyKey).first<{ status: string; requestFingerprint: string; googleFileId: string | null }>();
  if (!operation) return null;
  if (operation.requestFingerprint !== fingerprint) return json({ error: 'Idempotency key was used for a different file', code: 'IDEMPOTENCY_MISMATCH' }, 409);
  if (operation.status !== 'SUCCEEDED') return json({ error: 'Previous upload requires reconciliation before retry', code: operation.status === 'RECONCILIATION_REQUIRED' ? 'RECONCILIATION_REQUIRED' : 'UPLOAD_IN_PROGRESS_OR_FAILED' }, 409);
  const file = await env.DB.prepare(
    'SELECT id, original_name AS originalName, mime_type AS mimeType, byte_size AS byteSize, uploaded_at AS uploadedAt, uploaded_by AS uploadedBy, storage_provider AS storageProvider, drive_status AS driveStatus, google_file_id AS googleFileId, google_folder_id AS googleFolderId, sync_status AS syncStatus, reconciliation_status AS reconciliationStatus FROM preview_evidence WHERE draft_id = ? AND idempotency_key = ?'
  ).bind(draftId, idempotencyKey).first<PreviewEvidenceRow>();
  return file ? json({ file: { ...file, downloadUrl: `/api/preview/evidence/${file.id}/download` }, replay: true, phase: 'CF05_GOOGLE_DRIVE_SYNC' }) : json({ error: 'Upload metadata requires reconciliation', code: 'RECONCILIATION_REQUIRED' }, 409);
}

async function handlePreviewEvidence(request: Request, env: CloudflareEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 binding is required', code: 'D1_NOT_CONFIGURED', phase: 'CF05_GOOGLE_DRIVE_SYNC' }, 503);
  const sessionUser = await previewSessionUser(request, env);
  if (!sessionUser) return json({ error: 'Login is required', code: 'AUTH_REQUIRED' }, 401);
  const draftId = await previewDraftId(request);
  if (!draftId) return json({ error: 'A valid preview draft key is required', code: 'INVALID_PREVIEW_DRAFT_KEY' }, 401);
  const connected = Boolean(await getGoogleDriveCredential(env));

  const downloadMatch = url.pathname.match(/^\/api\/preview\/evidence\/([0-9a-f-]{36})\/download$/iu);
  if (downloadMatch && request.method === 'GET') {
    const file = await env.DB.prepare(
      'SELECT google_file_id AS googleFileId, original_name AS originalName, mime_type AS mimeType FROM preview_evidence WHERE id = ? AND draft_id = ? AND storage_provider = ?'
    ).bind(downloadMatch[1], draftId, 'GOOGLE_DRIVE').first<{ googleFileId: string; originalName: string; mimeType: string }>();
    if (!file?.googleFileId) return json({ error: 'Evidence file was not found', code: 'EVIDENCE_NOT_FOUND' }, 404);
    try {
      const providerResponse = await downloadEvidenceFromDrive(googleFetch(env), await accessToken(env), file.googleFileId);
      return new Response(providerResponse.body, { headers: { 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`, 'Content-Type': file.mimeType, 'X-Content-Type-Options': 'nosniff' } });
    } catch (reason) {
      return googleFailure(reason);
    }
  }

  if (url.pathname !== '/api/preview/evidence') return json({ error: 'Evidence route was not found', code: 'EVIDENCE_ROUTE_NOT_FOUND' }, 404);
  if (request.method === 'GET') {
    const result = await env.DB.prepare(
      'SELECT id, original_name AS originalName, mime_type AS mimeType, byte_size AS byteSize, uploaded_at AS uploadedAt, uploaded_by AS uploadedBy, storage_provider AS storageProvider, drive_status AS driveStatus, google_file_id AS googleFileId, google_folder_id AS googleFolderId, sync_status AS syncStatus, reconciliation_status AS reconciliationStatus FROM preview_evidence WHERE draft_id = ? ORDER BY uploaded_at DESC LIMIT 100'
    ).bind(draftId).all<PreviewEvidenceRow>();
    return json({ googleDriveConnected: connected, r2SkippedByUser: true, files: result.results.map((file) => ({ ...file, downloadUrl: file.googleFileId ? `/api/preview/evidence/${file.id}/download` : null })), phase: 'CF05_GOOGLE_DRIVE_SYNC' });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405);
  if (!connected) return json({ error: 'Connect Google Drive before uploading evidence', code: 'GOOGLE_DRIVE_NOT_CONNECTED', r2SkippedByUser: true }, 503);

  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (!idempotencyKey || !GOOGLE_IDEMPOTENCY_KEY.test(idempotencyKey)) return json({ error: 'A valid Idempotency-Key is required', code: 'INVALID_IDEMPOTENCY_KEY' }, 400);
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return json({ error: 'file is required', code: 'INVALID_EVIDENCE_PAYLOAD' }, 400);

  try {
    const validated = await validateEvidenceFile(file);
    const fingerprint = await sha256Hex(`${draftId}:${file.name}:${validated.mimeType}:${file.size}:${validated.sha256}`);
    const replay = await replayEvidence(env, draftId, idempotencyKey, fingerprint);
    if (replay) return replay;
    const operationId = crypto.randomUUID();
    const evidenceId = crypto.randomUUID();
    const now = new Date().toISOString();
    const reserved = await env.DB.prepare(
      'INSERT OR IGNORE INTO preview_google_operations (id, draft_id, idempotency_key, request_fingerprint, status, google_file_id, error_code, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)'
    ).bind(operationId, draftId, idempotencyKey, fingerprint, 'PENDING', sessionUser.id, now, now).run();
    if (reserved.meta?.changes === 0) return (await replayEvidence(env, draftId, idempotencyKey, fingerprint)) ?? json({ error: 'Concurrent upload reservation failed', code: 'UPLOAD_CONFLICT' }, 409);
    const folder = await env.DB.prepare('SELECT google_folder_id AS googleFolderId FROM preview_google_case_folders WHERE draft_id = ? AND organization_id = ?').bind(draftId, PREVIEW_ORGANIZATION_ID).first<{ googleFolderId: string }>();
    if (!folder) {
      await env.DB.prepare("UPDATE preview_google_operations SET status = 'FAILED', error_code = 'GOOGLE_FOLDER_NOT_BOUND', updated_at = ? WHERE id = ? AND status = 'PENDING'").bind(new Date().toISOString(), operationId).run();
      return json({ error: 'Bind a Google Drive folder before uploading', code: 'GOOGLE_FOLDER_NOT_BOUND' }, 409);
    }
    let uploaded: { fileId: string };
    try {
      uploaded = await uploadEvidenceToDrive(googleFetch(env), { accessToken: await accessToken(env), folderId: folder.googleFolderId, evidenceId, fileName: file.name, mimeType: validated.mimeType, sha256: validated.sha256, bytes: validated.bytes });
    } catch (reason) {
      const uncertain = reason instanceof GoogleDriveError && reason.uncertain;
      await env.DB.prepare('UPDATE preview_google_operations SET status = ?, error_code = ?, updated_at = ? WHERE id = ? AND status = ?').bind(uncertain ? 'RECONCILIATION_REQUIRED' : 'FAILED', reason instanceof GoogleDriveError ? reason.code : 'GOOGLE_OPERATION_FAILED', new Date().toISOString(), operationId, 'PENDING').run();
      return googleFailure(reason);
    }
    const uploadedAt = new Date().toISOString();
    const insertEvidence = env.DB.prepare(
      'INSERT INTO preview_evidence (id, draft_id, object_key, original_name, mime_type, byte_size, uploaded_at, uploaded_by, storage_provider, drive_status, sha256, google_file_id, google_folder_id, sync_status, reconciliation_status, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(evidenceId, draftId, `google-drive/${uploaded.fileId}`, file.name, validated.mimeType, file.size, uploadedAt, sessionUser.displayName, 'GOOGLE_DRIVE', 'SYNCED_TO_GOOGLE_DRIVE', validated.sha256, uploaded.fileId, folder.googleFolderId, 'SYNCED', 'CLEAN', idempotencyKey);
    const completeOperation = env.DB.prepare("UPDATE preview_google_operations SET status = 'SUCCEEDED', google_file_id = ?, updated_at = ? WHERE id = ? AND status = 'PENDING'").bind(uploaded.fileId, uploadedAt, operationId);
    try {
      if (!env.DB.batch) throw new Error('D1 batch unavailable');
      await env.DB.batch([insertEvidence, completeOperation]);
    } catch {
      await env.DB.prepare("UPDATE preview_google_operations SET status = 'RECONCILIATION_REQUIRED', google_file_id = ?, error_code = 'D1_COMMIT_FAILED', updated_at = ? WHERE id = ? AND status = 'PENDING'").bind(uploaded.fileId, new Date().toISOString(), operationId).run().catch(() => undefined);
      return json({ error: 'Google upload succeeded but metadata needs reconciliation', code: 'RECONCILIATION_REQUIRED' }, 503);
    }
    return json({ file: { id: evidenceId, originalName: file.name, mimeType: validated.mimeType, byteSize: file.size, uploadedAt, uploadedBy: sessionUser.displayName, storageProvider: 'GOOGLE_DRIVE', driveStatus: 'SYNCED_TO_GOOGLE_DRIVE', googleFileId: uploaded.fileId, googleFolderId: folder.googleFolderId, sha256: validated.sha256, syncStatus: 'SYNCED', reconciliationStatus: 'CLEAN', downloadUrl: `/api/preview/evidence/${evidenceId}/download` }, replay: false, phase: 'CF05_GOOGLE_DRIVE_SYNC' }, 201);
  } catch (reason) {
    return googleFailure(reason);
  }
}

// Router dispatch
const worker = {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return json({
        status: 'ok',
        runtime: 'cloudflare-workers',
        phase: 'CF06_D1_CASE_OPERATIONS'
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
          caseStorage: dbBound ? 'd1_active' : 'd1_missing',
          r2: 'skipped_by_user',
          fileStorage: credential ? 'google_drive_connected' : 'google_drive_pending'
        },
        googleDriveConnected: !!credential,
        r2SkippedByUser: true,
        r2: 'SKIPPED_BY_USER',
        phase: 'CF06_D1_CASE_OPERATIONS'
      }, isReady ? 200 : 503);
    }

    if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/api/auth/')) {
      return handlePreviewAuth(request, env, url);
    }

    if (url.pathname === '/api/dashboard/kpi') {
      return handlePreviewDashboard(request, env);
    }

    if (url.pathname === '/api/cases' || url.pathname.startsWith('/api/cases/')) {
      return handlePreviewCases(request, env, url);
    }

    if (url.pathname === '/api/report-drafts') {
      return handlePreviewReportDraft(request, env, url);
    }

    if (url.pathname === '/api/report-reviews' || url.pathname.startsWith('/api/report-reviews/')) {
      return handlePreviewReportReviews(request, env, url);
    }

    if (url.pathname === '/api/report-finalizations' || url.pathname.startsWith('/api/report-finalizations/') || url.pathname.startsWith('/api/report-outputs/')) {
      return handlePreviewFinalOutput(request, env, url);
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
