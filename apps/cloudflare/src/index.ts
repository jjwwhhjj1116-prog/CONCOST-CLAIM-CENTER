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
  OPENAI_API_KEY?: string;
  OPENAI_TEST_FETCH?: typeof fetch;
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
  'REPORT_DRAFTING', 'SUBMITTED', 'LITIGATION', 'JUDGEMENT', 'CLOSED'
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
  let reviewingDocsCount = 0;
  try {
    const pendingReviews = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM preview_report_reviews r JOIN preview_cases c ON c.id = r.case_id ` +
      `WHERE c.organization_id = ? AND c.deleted_at IS NULL AND r.status = 'PENDING' AND ${visibility}`
    ).bind(PREVIEW_ORGANIZATION_ID, admin, user.id).first<{ total: number }>();
    reviewingDocsCount = Number(pendingReviews?.total ?? 0);
  } catch {
    // A CF06-only database has not applied the later review migration yet.
    reviewingDocsCount = 0;
  }
  return json({
    totalCases: Number(summary?.totalCases ?? 0),
    inProgressCount: Number(summary?.inProgressCount ?? 0),
    reviewingDocsCount,
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

async function handlePreviewAdminUsers(request: Request, env: CloudflareEnv): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  if (request.method !== 'GET') return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405);
  const user = await previewSessionUser(request, env);
  if (!user) return json({ error: 'Login is required', code: 'AUTH_REQUIRED' }, 401);
  if (!user.roles.includes('admin')) return json({ error: 'Admin role is required', code: 'FORBIDDEN' }, 403);
  const rows = await env.DB.prepare(
    `SELECT u.id, u.login_id AS loginId, u.display_name AS displayName, u.email, u.roles_json AS rolesJson, u.is_active AS active, ` +
    `(SELECT COUNT(*) FROM preview_case_assignments a WHERE a.user_id = u.id) AS assignedCaseCount ` +
    `FROM preview_users u ORDER BY u.is_active DESC, u.display_name COLLATE NOCASE`
  ).all<{ id: string; loginId: string; displayName: string; email: string; rolesJson: string; active: number; assignedCaseCount: number }>();
  return json({ users: rows.results.map((entry) => ({ id: entry.id, loginId: entry.loginId, displayName: entry.displayName, email: entry.email, roles: parsePreviewRoles(entry.rolesJson), active: entry.active === 1, assignedCaseCount: Number(entry.assignedCaseCount ?? 0) })), phase: 'CF10_PRODUCT_EXPERIENCE' });
}

interface PreviewKickoffRow {
  caseId: string;
  meetingAt: string;
  location: string | null;
  agenda: string;
  participantUnitsJson: string;
  rawNotes: string;
  summaryText: string;
  timelineJson: string;
  status: string;
  version: number;
  updatedAt: string;
  updatedByName: string;
}

function workflowJsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function normalizedWorkflowText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum ? normalized : null;
}

function validWorkflowDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function kickoffDraft(agenda: string, notes: string, meetingAt: string): { summary: string; timeline: Array<{ order: number; title: string; detail: string }> } {
  const sentences = notes
    .split(/(?:\r?\n|[.!?]\s+)/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 8);
  const timeline = (sentences.length > 0 ? sentences : [agenda]).map((detail, index) => ({
    order: index + 1,
    title: index === 0 ? '회의 핵심 안건' : index < 4 ? '확인·결정 사항' : '후속 업무',
    detail: detail.slice(0, 500)
  }));
  const summary = [
    `회의 일시: ${meetingAt}`,
    `핵심 안건: ${agenda}`,
    '',
    '회의 요약',
    ...timeline.map((item) => `${item.order}. ${item.detail}`),
    '',
    '※ 외부 AI 연결 전 생성된 구조화 초안입니다. 담당자가 원문과 대조한 뒤 확정해야 합니다.'
  ].join('\n').slice(0, 30000);
  return { summary, timeline };
}

async function previewWorkflowPayload(env: CloudflareEnv, caseRow: PreviewCaseRow): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  const [kickoff, surveys, allocations, events] = await Promise.all([
    env.DB.prepare(
      'SELECT k.case_id AS caseId, k.meeting_at AS meetingAt, k.location, k.agenda, k.participant_units_json AS participantUnitsJson, ' +
      'k.raw_notes AS rawNotes, k.summary_text AS summaryText, k.timeline_json AS timelineJson, k.status, k.version, k.updated_at AS updatedAt, ' +
      'u.display_name AS updatedByName FROM preview_workflow_kickoffs k JOIN preview_users u ON u.id = k.updated_by WHERE k.case_id = ? AND k.organization_id = ?'
    ).bind(caseRow.id, PREVIEW_ORGANIZATION_ID).first<PreviewKickoffRow>(),
    env.DB.prepare(
      'SELECT s.id, s.survey_date AS surveyDate, s.location, s.scope_text AS scopeText, s.lead_unit AS leadUnit, s.folder_path AS folderPath, ' +
      's.photo_count AS photoCount, s.audio_count AS audioCount, s.document_count AS documentCount, s.status, s.version, s.updated_at AS updatedAt, ' +
      'u.display_name AS updatedByName FROM preview_site_surveys s JOIN preview_users u ON u.id = s.updated_by WHERE s.case_id = ? AND s.organization_id = ? ORDER BY s.survey_date DESC LIMIT 100'
    ).bind(caseRow.id, PREVIEW_ORGANIZATION_ID).all<Record<string, unknown>>(),
    env.DB.prepare(
      'SELECT a.id, a.unit_key AS unitKey, a.unit_label AS unitLabel, a.office, a.scheduling_mode AS schedulingMode, a.discipline, ' +
      'a.scope_text AS scopeText, a.basis_text AS basisText, a.start_date AS startDate, a.end_date AS endDate, a.created_at AS createdAt, ' +
      'u.display_name AS createdByName FROM preview_workforce_allocations a JOIN preview_users u ON u.id = a.created_by WHERE a.case_id = ? AND a.organization_id = ? ORDER BY a.start_date, a.unit_label LIMIT 100'
    ).bind(caseRow.id, PREVIEW_ORGANIZATION_ID).all<Record<string, unknown>>(),
    env.DB.prepare(
      'SELECT e.id, e.event_type AS eventType, e.entity_id AS entityId, e.detail_json AS detailJson, e.created_at AS createdAt, u.display_name AS actorName ' +
      'FROM preview_workflow_events e JOIN preview_users u ON u.id = e.actor_id WHERE e.case_id = ? ORDER BY e.created_at DESC LIMIT 100'
    ).bind(caseRow.id).all<{ id: string; eventType: string; entityId: string; detailJson: string; createdAt: string; actorName: string }>()
  ]);
  return json({
    case: previewCaseProjection(caseRow),
    kickoff: kickoff ? {
      ...kickoff,
      participantUnits: workflowJsonArray<string>(kickoff.participantUnitsJson),
      timeline: workflowJsonArray<{ order: number; title: string; detail: string }>(kickoff.timelineJson),
      participantUnitsJson: undefined,
      timelineJson: undefined
    } : null,
    siteSurveys: surveys.results,
    allocations: allocations.results,
    events: events.results.map((event) => ({ ...event, detail: JSON.parse(event.detailJson) as unknown, detailJson: undefined })),
    googleDrive: { connected: false, deferredByUser: true, uploadEnabled: false },
    phase: 'CF11_PROJECT_WORKFLOW'
  });
}

async function handlePreviewCaseWorkflow(request: Request, env: CloudflareEnv, url: URL, user: SessionUser, caseId: string, action?: string): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  const caseRow = await accessiblePreviewCase(env, user, caseId);
  if (!caseRow) return json({ error: 'Case was not found or is not assigned to this user', code: 'CASE_NOT_FOUND' }, 404);
  if (!action && request.method === 'GET') return previewWorkflowPayload(env, caseRow);
  if (!canMutatePreviewCases(user)) return json({ error: 'Role cannot modify project workflow', code: 'FORBIDDEN' }, 403);
  if (!env.DB.batch) return json({ error: 'D1 batch is unavailable', code: 'D1_BATCH_REQUIRED' }, 503);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: 'Workflow payload is invalid', code: 'INVALID_WORKFLOW_PAYLOAD' }, 400);
  const now = new Date().toISOString();

  if (action === 'kickoff' && request.method === 'PUT') {
    if (!exactObjectKeys(body, ['meetingAt', 'location', 'agenda', 'participantUnits', 'rawNotes', 'status', 'expectedVersion'])) return json({ error: 'Kickoff payload is invalid', code: 'INVALID_KICKOFF_PAYLOAD' }, 400);
    const meetingAt = typeof body.meetingAt === 'string' && !Number.isNaN(Date.parse(body.meetingAt)) ? new Date(body.meetingAt).toISOString() : null;
    const location = typeof body.location === 'string' ? body.location.trim() : '';
    const agenda = normalizedWorkflowText(body.agenda, 12000);
    const rawNotes = typeof body.rawNotes === 'string' && body.rawNotes.length <= 50000 ? body.rawNotes.trim() : null;
    const participants = Array.isArray(body.participantUnits) ? body.participantUnits.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0 && entry.trim().length <= 120).map((entry) => entry.trim()).slice(0, 30) : null;
    const status = typeof body.status === 'string' && ['PLANNED', 'COMPLETED', 'DRAFTED', 'CONFIRMED'].includes(body.status) ? body.status : null;
    const expectedVersion = Number(body.expectedVersion);
    if (!meetingAt || location.length > 300 || !agenda || rawNotes === null || !participants || !status || !Number.isInteger(expectedVersion) || expectedVersion < 0) return json({ error: 'Kickoff fields are invalid', code: 'INVALID_KICKOFF_PAYLOAD' }, 400);
    const current = await env.DB.prepare('SELECT version FROM preview_workflow_kickoffs WHERE case_id = ?').bind(caseId).first<{ version: number }>();
    if (Number(current?.version ?? 0) !== expectedVersion) return json({ error: 'Kickoff has changed. Reload the latest version.', code: 'VERSION_CONFLICT' }, 409);
    const nextVersion = expectedVersion + 1;
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO preview_workflow_kickoffs (case_id, organization_id, meeting_at, location, agenda, participant_units_json, raw_notes, summary_text, timeline_json, status, version, updated_by, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, \'\', \'[]\', ?, 1, ?, ?, ?) ON CONFLICT(case_id) DO UPDATE SET meeting_at=excluded.meeting_at, location=excluded.location, agenda=excluded.agenda, participant_units_json=excluded.participant_units_json, raw_notes=excluded.raw_notes, status=excluded.status, version=preview_workflow_kickoffs.version+1, updated_by=excluded.updated_by, updated_at=excluded.updated_at WHERE preview_workflow_kickoffs.version=?'
      ).bind(caseId, PREVIEW_ORGANIZATION_ID, meetingAt, location || null, agenda, JSON.stringify(participants), rawNotes, status, user.id, now, now, expectedVersion),
      env.DB.prepare('INSERT INTO preview_workflow_events (id, case_id, actor_id, event_type, entity_id, detail_json, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM preview_workflow_kickoffs WHERE case_id=? AND version=? AND updated_at=?)')
        .bind(crypto.randomUUID(), caseId, user.id, 'KICKOFF_SAVED', caseId, JSON.stringify({ status, participantCount: participants.length }), now, caseId, nextVersion, now)
    ]);
    const canonical = await env.DB.prepare('SELECT version, updated_at AS updatedAt FROM preview_workflow_kickoffs WHERE case_id=?').bind(caseId).first<{ version: number; updatedAt: string }>();
    if (canonical?.version !== nextVersion || canonical.updatedAt !== now) return json({ error: 'Concurrent kickoff update detected', code: 'VERSION_CONFLICT' }, 409);
    return previewWorkflowPayload(env, caseRow);
  }

  if (action === 'kickoff-summary' && request.method === 'POST') {
    if (!exactObjectKeys(body, ['expectedVersion'])) return json({ error: 'Summary payload is invalid', code: 'INVALID_SUMMARY_PAYLOAD' }, 400);
    const expectedVersion = Number(body.expectedVersion);
    const kickoff = await env.DB.prepare('SELECT meeting_at AS meetingAt, agenda, raw_notes AS rawNotes, version FROM preview_workflow_kickoffs WHERE case_id=?').bind(caseId).first<{ meetingAt: string; agenda: string; rawNotes: string; version: number }>();
    if (!kickoff || !Number.isInteger(expectedVersion) || kickoff.version !== expectedVersion) return json({ error: 'Kickoff has changed. Reload before generating the draft.', code: 'VERSION_CONFLICT' }, 409);
    const draft = kickoffDraft(kickoff.agenda, kickoff.rawNotes, kickoff.meetingAt);
    const nextVersion = expectedVersion + 1;
    await env.DB.batch([
      env.DB.prepare('UPDATE preview_workflow_kickoffs SET summary_text=?, timeline_json=?, status=\'DRAFTED\', version=version+1, updated_by=?, updated_at=? WHERE case_id=? AND version=?')
        .bind(draft.summary, JSON.stringify(draft.timeline), user.id, now, caseId, expectedVersion),
      env.DB.prepare('INSERT INTO preview_workflow_events (id, case_id, actor_id, event_type, entity_id, detail_json, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM preview_workflow_kickoffs WHERE case_id=? AND version=? AND updated_at=?)')
        .bind(crypto.randomUUID(), caseId, user.id, 'KICKOFF_DRAFT_GENERATED', caseId, JSON.stringify({ generator: 'LOCAL_STRUCTURED_DRAFT', timelineCount: draft.timeline.length }), now, caseId, nextVersion, now)
    ]);
    const canonical = await env.DB.prepare('SELECT version FROM preview_workflow_kickoffs WHERE case_id=?').bind(caseId).first<{ version: number }>();
    if (canonical?.version !== nextVersion) return json({ error: 'Concurrent kickoff update detected', code: 'VERSION_CONFLICT' }, 409);
    return previewWorkflowPayload(env, caseRow);
  }

  if (action === 'site-survey' && request.method === 'PUT') {
    if (!exactObjectKeys(body, ['surveyDate', 'location', 'scopeText', 'leadUnit', 'status', 'expectedVersion'])) return json({ error: 'Site survey payload is invalid', code: 'INVALID_SITE_SURVEY_PAYLOAD' }, 400);
    const surveyDate = validWorkflowDate(body.surveyDate) ? body.surveyDate : null;
    const location = typeof body.location === 'string' ? body.location.trim() : '';
    const scopeText = normalizedWorkflowText(body.scopeText, 12000);
    const leadUnit = normalizedWorkflowText(body.leadUnit, 120);
    const status = typeof body.status === 'string' && ['PLANNED', 'IN_PROGRESS', 'COMPLETED'].includes(body.status) ? body.status : null;
    const expectedVersion = Number(body.expectedVersion);
    if (!surveyDate || location.length > 300 || !scopeText || !leadUnit || !status || !Number.isInteger(expectedVersion) || expectedVersion < 0) return json({ error: 'Site survey fields are invalid', code: 'INVALID_SITE_SURVEY_PAYLOAD' }, 400);
    const current = await env.DB.prepare('SELECT id, version FROM preview_site_surveys WHERE case_id=? AND survey_date=?').bind(caseId, surveyDate).first<{ id: string; version: number }>();
    if (Number(current?.version ?? 0) !== expectedVersion) return json({ error: 'Site survey has changed. Reload the latest version.', code: 'VERSION_CONFLICT' }, 409);
    const surveyId = current?.id ?? crypto.randomUUID();
    const folderPath = `${caseRow.caseNumber}_${caseRow.title}/04_현장조사/${surveyDate.slice(2).replaceAll('-', '.')}`.slice(0, 600);
    const nextVersion = expectedVersion + 1;
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO preview_site_surveys (id, case_id, organization_id, survey_date, location, scope_text, lead_unit, folder_path, photo_count, audio_count, document_count, status, version, updated_by, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 1, ?, ?, ?) ON CONFLICT(case_id, survey_date) DO UPDATE SET location=excluded.location, scope_text=excluded.scope_text, lead_unit=excluded.lead_unit, folder_path=excluded.folder_path, status=excluded.status, version=preview_site_surveys.version+1, updated_by=excluded.updated_by, updated_at=excluded.updated_at WHERE preview_site_surveys.version=?'
      ).bind(surveyId, caseId, PREVIEW_ORGANIZATION_ID, surveyDate, location || null, scopeText, leadUnit, folderPath, status, user.id, now, now, expectedVersion),
      env.DB.prepare('INSERT INTO preview_workflow_events (id, case_id, actor_id, event_type, entity_id, detail_json, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM preview_site_surveys WHERE id=? AND version=? AND updated_at=?)')
        .bind(crypto.randomUUID(), caseId, user.id, 'SITE_SURVEY_SAVED', surveyId, JSON.stringify({ surveyDate, leadUnit, folderPath }), now, surveyId, nextVersion, now)
    ]);
    const canonical = await env.DB.prepare('SELECT version FROM preview_site_surveys WHERE id=?').bind(surveyId).first<{ version: number }>();
    if (canonical?.version !== nextVersion) return json({ error: 'Concurrent site survey update detected', code: 'VERSION_CONFLICT' }, 409);
    return previewWorkflowPayload(env, caseRow);
  }

  if (action === 'allocations' && request.method === 'POST') {
    if (!exactObjectKeys(body, ['unitKey', 'unitLabel', 'office', 'schedulingMode', 'discipline', 'scopeText', 'basisText', 'startDate', 'endDate'])) return json({ error: 'Allocation payload is invalid', code: 'INVALID_ALLOCATION_PAYLOAD' }, 400);
    const unitKey = normalizedWorkflowText(body.unitKey, 120);
    const unitLabel = normalizedWorkflowText(body.unitLabel, 160);
    const scopeText = normalizedWorkflowText(body.scopeText, 12000);
    const basisText = normalizedWorkflowText(body.basisText, 12000);
    const office = typeof body.office === 'string' && ['CONCOST', 'VIETQS'].includes(body.office) ? body.office : null;
    const schedulingMode = typeof body.schedulingMode === 'string' && ['PERSON', 'TEAM'].includes(body.schedulingMode) ? body.schedulingMode : null;
    const discipline = typeof body.discipline === 'string' && ['FINISH', 'STRUCTURE', 'CIVIL_LANDSCAPE'].includes(body.discipline) ? body.discipline : null;
    const startDate = validWorkflowDate(body.startDate) ? body.startDate : null;
    const endDate = validWorkflowDate(body.endDate) ? body.endDate : null;
    const key = request.headers.get('Idempotency-Key');
    if (!unitKey || !unitLabel || !scopeText || !basisText || !office || !schedulingMode || !discipline || !startDate || !endDate || endDate < startDate || !key || !PREVIEW_CASE_CREATE_KEY.test(key)) return json({ error: 'Allocation fields or Idempotency-Key are invalid', code: 'INVALID_ALLOCATION_PAYLOAD' }, 400);
    if ((office === 'VIETQS') !== (schedulingMode === 'TEAM')) return json({ error: 'VIETQS must use team scheduling; CONCOST must use person scheduling', code: 'INVALID_SCHEDULING_MODE' }, 400);
    const fingerprint = await sha256Hex(JSON.stringify({ caseId, unitKey, unitLabel, office, schedulingMode, discipline, scopeText, basisText, startDate, endDate }));
    const existing = await env.DB.prepare('SELECT id, request_fingerprint AS requestFingerprint FROM preview_workforce_allocations WHERE case_id=? AND idempotency_key=?').bind(caseId, key).first<{ id: string; requestFingerprint: string }>();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) return json({ error: 'Idempotency-Key was used for a different allocation', code: 'IDEMPOTENCY_MISMATCH' }, 409);
      return previewWorkflowPayload(env, caseRow);
    }
    const allocationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO preview_workforce_allocations (id, case_id, organization_id, unit_key, unit_label, office, scheduling_mode, discipline, scope_text, basis_text, start_date, end_date, idempotency_key, request_fingerprint, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(allocationId, caseId, PREVIEW_ORGANIZATION_ID, unitKey, unitLabel, office, schedulingMode, discipline, scopeText, basisText, startDate, endDate, key, fingerprint, user.id, now),
      env.DB.prepare('INSERT INTO preview_workflow_events (id, case_id, actor_id, event_type, entity_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), caseId, user.id, 'WORKFORCE_ALLOCATED', allocationId, JSON.stringify({ unitKey, unitLabel, office, schedulingMode, startDate, endDate }), now)
    ]);
    return previewWorkflowPayload(env, caseRow);
  }

  return json({ error: 'Workflow route or method was not found', code: 'WORKFLOW_ROUTE_NOT_FOUND' }, 404);
}

const PROPOSAL_AWARD_STATUSES = new Set(['PENDING', 'WON', 'LOST']);
const PROPOSAL_VERIFICATION_STATUSES = new Set(['UNVERIFIED', 'VERIFIED', 'CONFLICT']);

interface PreviewProposalRow {
  id: string;
  caseId: string;
  caseNumber: string;
  caseTitle: string;
  caseStatus: string;
  caseVersion: number;
  proposalNumber: string;
  proposalTitle: string;
  revisionLabel: string;
  clientName: string;
  sentAt: string;
  responseDueOn: string | null;
  proposedAmountKrw: number | null;
  documentUrl: string | null;
  documentSha256: string | null;
  verificationStatus: string;
  awardStatus: string;
  awardDecidedAt: string | null;
  awardDecidedBy: string | null;
  awardDecidedByName: string | null;
  contractAmountKrw: number | null;
  projectStartOn: string | null;
  projectEndOn: string | null;
  version: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

function proposalText(value: unknown, maximum: number, optional = false): string | null {
  if ((value === null || value === undefined || value === '') && optional) return null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized && optional) return null;
  return normalized.length > 0 && normalized.length <= maximum ? normalized : null;
}

function proposalDate(value: unknown, dateOnly = false, optional = false): string | null {
  if ((value === null || value === undefined || value === '') && optional) return null;
  if (typeof value !== 'string') return null;
  if (dateOnly) return validWorkflowDate(value) ? value : null;
  return Number.isNaN(Date.parse(value)) ? null : new Date(value).toISOString();
}

function proposalMoney(value: unknown, optional = false): number | null {
  if ((value === null || value === undefined || value === '') && optional) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= 100_000_000_000_000 ? amount : null;
}

function proposalDocumentUrl(value: unknown, optional = false): string | null {
  if ((value === null || value === undefined || value === '') && optional) return null;
  if (typeof value !== 'string' || value.length > 1200) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function proposalProjection(row: PreviewProposalRow): Record<string, unknown> {
  return {
    ...row,
    proposedAmountKrw: row.proposedAmountKrw === null ? null : Number(row.proposedAmountKrw),
    contractAmountKrw: row.contractAmountKrw === null ? null : Number(row.contractAmountKrw),
    version: Number(row.version),
    caseVersion: Number(row.caseVersion),
    isPerformanceProject: row.awardStatus === 'WON',
    reportEvidenceEligible: row.verificationStatus === 'VERIFIED'
  };
}

const previewProposalSelect =
  'SELECT p.id,p.case_id AS caseId,c.case_number AS caseNumber,c.title AS caseTitle,c.status AS caseStatus,c.version AS caseVersion,' +
  'p.proposal_number AS proposalNumber,p.proposal_title AS proposalTitle,p.revision_label AS revisionLabel,p.client_name AS clientName,' +
  'p.sent_at AS sentAt,p.response_due_on AS responseDueOn,p.proposed_amount_krw AS proposedAmountKrw,p.document_url AS documentUrl,' +
  'p.document_sha256 AS documentSha256,p.verification_status AS verificationStatus,p.award_status AS awardStatus,' +
  'p.award_decided_at AS awardDecidedAt,p.award_decided_by AS awardDecidedBy,decider.display_name AS awardDecidedByName,' +
  'p.contract_amount_krw AS contractAmountKrw,p.project_start_on AS projectStartOn,p.project_end_on AS projectEndOn,p.version,' +
  'creator.display_name AS createdByName,p.created_at AS createdAt,p.updated_at AS updatedAt ' +
  'FROM preview_proposal_links p JOIN preview_cases c ON c.id=p.case_id AND c.organization_id=p.organization_id ' +
  'JOIN preview_users creator ON creator.id=p.created_by LEFT JOIN preview_users decider ON decider.id=p.award_decided_by ';

async function previewProposalDetail(env: CloudflareEnv, user: SessionUser, id: string): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  const admin = user.roles.includes('admin') ? 1 : 0;
  const record = await env.DB.prepare(
    previewProposalSelect +
    'WHERE p.id=? AND p.organization_id=? AND c.deleted_at IS NULL AND (?=1 OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=c.id AND a.user_id=?))'
  ).bind(id, PREVIEW_ORGANIZATION_ID, admin, user.id).first<PreviewProposalRow>();
  if (!record) return json({ error: 'Proposal link was not found or is outside your assigned projects', code: 'PROPOSAL_NOT_FOUND' }, 404);
  const decisions = await env.DB.prepare(
    'SELECT d.id,d.decision,d.decision_note AS decisionNote,d.decided_at AS decidedAt,d.contract_amount_krw AS contractAmountKrw,' +
    'd.project_start_on AS projectStartOn,d.project_end_on AS projectEndOn,d.expected_link_version AS expectedLinkVersion,' +
    'd.created_at AS createdAt,u.display_name AS decidedByName FROM preview_award_decisions d JOIN preview_users u ON u.id=d.decided_by ' +
    'WHERE d.proposal_link_id=? ORDER BY d.created_at DESC LIMIT 100'
  ).bind(id).all<Record<string, unknown>>();
  return json({ proposal: proposalProjection(record), decisions: decisions.results, phase: 'CF14_PROPOSAL_AWARD_WORKFLOW' });
}

async function handlePreviewProposalWorkflow(request: Request, env: CloudflareEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  const user = await previewSessionUser(request, env);
  if (!user) return json({ error: 'Login is required', code: 'AUTH_REQUIRED' }, 401);
  const detailMatch = url.pathname.match(/^\/api\/proposal-workflow\/links\/([0-9a-f-]{36})(?:\/(decision))?$/iu);

  if (url.pathname === '/api/proposal-workflow' && request.method === 'GET') {
    const awardStatus = url.searchParams.get('awardStatus') ?? '';
    if (awardStatus && !PROPOSAL_AWARD_STATUSES.has(awardStatus)) return json({ error: 'awardStatus is invalid', code: 'INVALID_AWARD_STATUS' }, 400);
    const caseId = url.searchParams.get('caseId') ?? '';
    if (caseId && !PREVIEW_DRAFT_KEY.test(caseId)) return json({ error: 'caseId is invalid', code: 'INVALID_CASE_ID' }, 400);
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
    const requestedLimit = Number(url.searchParams.get('limit') ?? 100);
    const limit = Number.isInteger(requestedLimit) ? Math.min(200, Math.max(1, requestedLimit)) : 100;
    const admin = user.roles.includes('admin') ? 1 : 0;
    const like = `%${q}%`;
    const rows = await env.DB.prepare(
      previewProposalSelect +
      'WHERE p.organization_id=? AND c.deleted_at IS NULL AND (?=1 OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=c.id AND a.user_id=?)) ' +
      'AND (?=\'\' OR p.award_status=?) AND (?=\'\' OR p.case_id=?) ' +
      'AND (?=\'\' OR p.proposal_number LIKE ? OR p.proposal_title LIKE ? OR p.client_name LIKE ? OR c.case_number LIKE ? OR c.title LIKE ?) ' +
      'ORDER BY CASE p.award_status WHEN \'PENDING\' THEN 0 WHEN \'WON\' THEN 1 ELSE 2 END,p.response_due_on,p.sent_at DESC LIMIT ?'
    ).bind(PREVIEW_ORGANIZATION_ID, admin, user.id, awardStatus, awardStatus, caseId, caseId, q, like, like, like, like, like, limit).all<PreviewProposalRow>();
    return json({ proposals: rows.results.map(proposalProjection), phase: 'CF14_PROPOSAL_AWARD_WORKFLOW' });
  }

  if (url.pathname === '/api/proposal-workflow/links' && request.method === 'POST') {
    if (!canMutatePreviewCases(user)) return json({ error: 'Role cannot link proposal snapshots', code: 'FORBIDDEN' }, 403);
    if (!env.DB.batch) return json({ error: 'D1 batch is unavailable', code: 'D1_BATCH_REQUIRED' }, 503);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !exactObjectKeys(body, ['caseId','proposalNumber','proposalTitle','revisionLabel','clientName','sentAt','responseDueOn','proposedAmountKrw','documentUrl','documentSha256','verificationStatus','expectedCaseVersion'])) return json({ error: 'Proposal link payload is invalid', code: 'INVALID_PROPOSAL_PAYLOAD' }, 400);
    const caseId = typeof body.caseId === 'string' ? body.caseId : '';
    const project = PREVIEW_DRAFT_KEY.test(caseId) ? await accessiblePreviewCase(env, user, caseId) : null;
    const proposalNumber = proposalText(body.proposalNumber, 100);
    const proposalTitle = proposalText(body.proposalTitle, 500);
    const revisionLabel = proposalText(body.revisionLabel, 80);
    const clientName = proposalText(body.clientName, 300);
    const sentAt = proposalDate(body.sentAt);
    const responseDueOn = proposalDate(body.responseDueOn, true, true);
    const proposedAmountKrw = proposalMoney(body.proposedAmountKrw, true);
    const documentUrl = proposalDocumentUrl(body.documentUrl, true);
    const documentSha256 = typeof body.documentSha256 === 'string' && /^[0-9a-f]{64}$/i.test(body.documentSha256.trim()) ? body.documentSha256.trim().toLowerCase() : null;
    const verificationStatus = typeof body.verificationStatus === 'string' && PROPOSAL_VERIFICATION_STATUSES.has(body.verificationStatus) ? body.verificationStatus : null;
    const expectedCaseVersion = Number(body.expectedCaseVersion);
    if (!project || !proposalNumber || !proposalTitle || !revisionLabel || !clientName || !sentAt || proposedAmountKrw === null || !verificationStatus || !Number.isInteger(expectedCaseVersion) || expectedCaseVersion < 1 || (verificationStatus === 'VERIFIED' && (!documentUrl || !documentSha256))) return json({ error: 'Proposal fields are invalid', code: 'INVALID_PROPOSAL_PAYLOAD' }, 400);
    const requestKey = request.headers.get('Idempotency-Key') ?? '';
    if (!PREVIEW_CASE_CREATE_KEY.test(requestKey)) return json({ error: 'A valid Idempotency-Key is required', code: 'INVALID_IDEMPOTENCY_KEY' }, 400);
    const fingerprint = await sha256Hex(JSON.stringify({ caseId,proposalNumber,proposalTitle,revisionLabel,clientName,sentAt,responseDueOn,proposedAmountKrw,documentUrl,documentSha256,verificationStatus,expectedCaseVersion }));
    const replay = await env.DB.prepare('SELECT id,request_fingerprint AS fingerprint FROM preview_proposal_links WHERE request_key=?').bind(requestKey).first<{id:string;fingerprint:string}>();
    if (replay) return replay.fingerprint === fingerprint ? previewProposalDetail(env,user,replay.id) : json({ error: 'Idempotency-Key was used for another proposal link', code: 'IDEMPOTENCY_MISMATCH' }, 409);
    if (project.version !== expectedCaseVersion) return json({ error: 'Project changed. Reload before linking the proposal.', code: 'VERSION_CONFLICT', currentVersion: project.version }, 409);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const nextCaseStatus = project.status === 'INQUIRY' ? 'PROPOSAL' : project.status;
    await env.DB.batch([
      env.DB.prepare('INSERT INTO preview_proposal_links (id,organization_id,case_id,proposal_number,proposal_title,revision_label,client_name,sent_at,response_due_on,proposed_amount_krw,document_url,document_sha256,verification_status,award_status,version,request_key,request_fingerprint,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,\'PENDING\',1,?,?,?,?,?)')
        .bind(id,PREVIEW_ORGANIZATION_ID,caseId,proposalNumber,proposalTitle,revisionLabel,clientName,sentAt,responseDueOn,proposedAmountKrw,documentUrl,documentSha256,verificationStatus,requestKey,fingerprint,user.id,now,now),
      env.DB.prepare('UPDATE preview_cases SET status=?,version=version+1,updated_at=? WHERE id=? AND organization_id=? AND version=? AND deleted_at IS NULL')
        .bind(nextCaseStatus,now,caseId,PREVIEW_ORGANIZATION_ID,expectedCaseVersion),
      env.DB.prepare('INSERT INTO preview_case_activities (id,case_id,actor_id,event_type,title,description,created_at) SELECT ?,?,?,\'PROPOSAL_LINKED\',?,?,? WHERE EXISTS (SELECT 1 FROM preview_cases WHERE id=? AND version=? AND updated_at=?)')
        .bind(crypto.randomUUID(),caseId,user.id,'제안서 연동',`${proposalNumber} · ${revisionLabel} · ${clientName}`,now,caseId,expectedCaseVersion+1,now)
    ]);
    const canonical = await env.DB.prepare('SELECT version FROM preview_cases WHERE id=?').bind(caseId).first<{version:number}>();
    if (Number(canonical?.version) !== expectedCaseVersion + 1) return json({ error: 'Concurrent project update detected', code: 'VERSION_CONFLICT' }, 409);
    return previewProposalDetail(env,user,id);
  }

  if (detailMatch && !detailMatch[2] && request.method === 'GET') return previewProposalDetail(env,user,detailMatch[1]);

  if (detailMatch?.[2] === 'decision' && request.method === 'POST') {
    if (!canMutatePreviewCases(user)) return json({ error: 'Role cannot decide proposal awards', code: 'FORBIDDEN' }, 403);
    if (!env.DB.batch) return json({ error: 'D1 batch is unavailable', code: 'D1_BATCH_REQUIRED' }, 503);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !exactObjectKeys(body, ['decision','decisionNote','decidedAt','contractAmountKrw','projectStartOn','projectEndOn','expectedLinkVersion','expectedCaseVersion'])) return json({ error: 'Award decision payload is invalid', code: 'INVALID_AWARD_PAYLOAD' }, 400);
    const current = await env.DB.prepare(previewProposalSelect + 'WHERE p.id=? AND p.organization_id=?').bind(detailMatch[1],PREVIEW_ORGANIZATION_ID).first<PreviewProposalRow>();
    if (!current || !await accessiblePreviewCase(env,user,current.caseId)) return json({ error: 'Proposal link was not found or is outside your assigned projects', code: 'PROPOSAL_NOT_FOUND' }, 404);
    const decision = typeof body.decision === 'string' && ['WON','LOST'].includes(body.decision) ? body.decision : null;
    const decisionNote = proposalText(body.decisionNote,5000);
    const decidedAt = proposalDate(body.decidedAt);
    const expectedLinkVersion = Number(body.expectedLinkVersion);
    const expectedCaseVersion = Number(body.expectedCaseVersion);
    const contractAmountKrw = decision === 'WON' ? proposalMoney(body.contractAmountKrw) : null;
    const projectStartOn = decision === 'WON' ? proposalDate(body.projectStartOn,true) : null;
    const projectEndOn = decision === 'WON' ? proposalDate(body.projectEndOn,true) : null;
    if (!decision || !decisionNote || !decidedAt || (decision === 'WON' && (contractAmountKrw === null || !projectStartOn || !projectEndOn || projectEndOn < projectStartOn))) return json({ error: 'Award decision fields are invalid', code: 'INVALID_AWARD_PAYLOAD' }, 400);
    const requestKey = request.headers.get('Idempotency-Key') ?? '';
    if (!PREVIEW_CASE_CREATE_KEY.test(requestKey)) return json({ error: 'A valid Idempotency-Key is required', code: 'INVALID_IDEMPOTENCY_KEY' }, 400);
    const fingerprint = await sha256Hex(JSON.stringify({ proposalLinkId:current.id,decision,decisionNote,decidedAt,contractAmountKrw,projectStartOn,projectEndOn,expectedLinkVersion,expectedCaseVersion }));
    const replay = await env.DB.prepare('SELECT proposal_link_id AS proposalLinkId,request_fingerprint AS fingerprint FROM preview_award_decisions WHERE request_key=?').bind(requestKey).first<{proposalLinkId:string;fingerprint:string}>();
    if (replay) return replay.fingerprint === fingerprint ? previewProposalDetail(env,user,replay.proposalLinkId) : json({ error: 'Idempotency-Key was used for another award decision', code: 'IDEMPOTENCY_MISMATCH' }, 409);
    const versionConflict = current.awardStatus !== 'PENDING' || current.version !== expectedLinkVersion || current.caseVersion !== expectedCaseVersion;
    if (versionConflict) return json({ error: 'Proposal or project changed. Reload before deciding.', code: 'VERSION_CONFLICT', currentLinkVersion: current.version, currentCaseVersion: current.caseVersion }, 409);
    const now = new Date().toISOString();
    const nextCaseStatus = decision === 'WON' && ['INQUIRY','PROPOSAL','ESTIMATE'].includes(current.caseStatus) ? 'CONTRACT' : current.caseStatus;
    await env.DB.batch([
      env.DB.prepare('INSERT INTO preview_award_decisions (id,proposal_link_id,case_id,decision,decision_note,decided_at,contract_amount_krw,project_start_on,project_end_on,expected_link_version,request_key,request_fingerprint,decided_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(crypto.randomUUID(),current.id,current.caseId,decision,decisionNote,decidedAt,contractAmountKrw,projectStartOn,projectEndOn,expectedLinkVersion,requestKey,fingerprint,user.id,now),
      env.DB.prepare('UPDATE preview_proposal_links SET award_status=?,award_decided_at=?,award_decided_by=?,contract_amount_krw=?,project_start_on=?,project_end_on=?,version=version+1,updated_at=? WHERE id=? AND version=? AND award_status=\'PENDING\'')
        .bind(decision,decidedAt,user.id,contractAmountKrw,projectStartOn,projectEndOn,now,current.id,expectedLinkVersion),
      env.DB.prepare('UPDATE preview_cases SET status=?,version=version+1,updated_at=? WHERE id=? AND organization_id=? AND version=? AND deleted_at IS NULL')
        .bind(nextCaseStatus,now,current.caseId,PREVIEW_ORGANIZATION_ID,expectedCaseVersion),
      env.DB.prepare('INSERT INTO preview_case_activities (id,case_id,actor_id,event_type,title,description,created_at) SELECT ?,?,?,\'AWARD_DECIDED\',?,?,? WHERE EXISTS (SELECT 1 FROM preview_cases WHERE id=? AND version=? AND updated_at=?)')
        .bind(crypto.randomUUID(),current.caseId,user.id,decision === 'WON' ? '수주 확정' : '미수주 결정',decisionNote,now,current.caseId,expectedCaseVersion+1,now)
    ]);
    const canonical = await env.DB.prepare('SELECT award_status AS awardStatus,version FROM preview_proposal_links WHERE id=?').bind(current.id).first<{awardStatus:string;version:number}>();
    const canonicalCase = await env.DB.prepare('SELECT version FROM preview_cases WHERE id=?').bind(current.caseId).first<{version:number}>();
    if (canonical?.awardStatus !== decision || Number(canonical.version) !== expectedLinkVersion + 1 || Number(canonicalCase?.version) !== expectedCaseVersion + 1) return json({ error: 'Concurrent award update detected', code: 'VERSION_CONFLICT' }, 409);
    return previewProposalDetail(env,user,current.id);
  }

  return json({ error: 'Proposal workflow route was not found', code: 'PROPOSAL_ROUTE_NOT_FOUND' }, 404);
}

const LITIGATION_STAGES = new Set(['FILED', 'PLEADING', 'APPRAISAL', 'HEARING', 'JUDGEMENT', 'APPEAL', 'CLOSED']);
const LITIGATION_EVENT_TYPES = new Set(['FILED', 'SERVICE', 'BRIEF', 'APPRAISAL', 'HEARING', 'JUDGEMENT', 'APPEAL', 'CORRECTION', 'OTHER']);
const LITIGATION_VERIFICATION = new Set(['UNVERIFIED', 'VERIFIED', 'CONFLICT']);

interface PreviewLitigationRow {
  id: string;
  caseId: string;
  projectCaseNumber: string;
  projectTitle: string;
  courtName: string;
  courtCaseNumber: string;
  caseTitle: string;
  divisionName: string | null;
  partiesText: string;
  filedOn: string | null;
  currentStage: string;
  nextHearingAt: string | null;
  verificationStatus: string;
  officialSourceUrl: string | null;
  sourceCheckedAt: string | null;
  sourceCheckedByName: string | null;
  version: number;
  eventCount: number;
  verifiedEventCount: number;
  createdAt: string;
  updatedAt: string;
}

function officialCourtSource(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1200) return null;
  try {
    const parsed = new URL(value.trim());
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || (hostname !== 'scourt.go.kr' && !hostname.endsWith('.scourt.go.kr'))) return null;
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function litigationText(value: unknown, maximum: number, optional = false): string | null {
  if (value === null && optional) return null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized && optional) return null;
  return normalized.length > 0 && normalized.length <= maximum ? normalized : null;
}

function optionalIso(value: unknown, dateOnly = false): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return null;
  if (dateOnly) return validWorkflowDate(value) ? value : null;
  return Number.isNaN(Date.parse(value)) ? null : new Date(value).toISOString();
}

function litigationProjection(row: PreviewLitigationRow): Record<string, unknown> {
  return {
    ...row,
    version: Number(row.version),
    eventCount: Number(row.eventCount ?? 0),
    verifiedEventCount: Number(row.verifiedEventCount ?? 0),
    reportEvidenceEligible: row.verificationStatus === 'VERIFIED'
  };
}

async function accessibleLitigationRecord(env: CloudflareEnv, user: SessionUser, id: string): Promise<PreviewLitigationRow | null> {
  if (!env.DB) return null;
  return env.DB.prepare(
    'SELECT l.id,l.case_id AS caseId,c.case_number AS projectCaseNumber,c.title AS projectTitle,l.court_name AS courtName,l.court_case_number AS courtCaseNumber,' +
    'l.case_title AS caseTitle,l.division_name AS divisionName,l.parties_text AS partiesText,l.filed_on AS filedOn,l.current_stage AS currentStage,' +
    'l.next_hearing_at AS nextHearingAt,l.verification_status AS verificationStatus,l.official_source_url AS officialSourceUrl,l.source_checked_at AS sourceCheckedAt,' +
    'checker.display_name AS sourceCheckedByName,l.version,(SELECT COUNT(*) FROM preview_litigation_events e WHERE e.litigation_case_id=l.id) AS eventCount,' +
    '(SELECT COUNT(*) FROM preview_litigation_events e WHERE e.litigation_case_id=l.id AND e.verification_status=\'VERIFIED\') AS verifiedEventCount,' +
    'l.created_at AS createdAt,l.updated_at AS updatedAt FROM preview_litigation_cases l JOIN preview_cases c ON c.id=l.case_id ' +
    'LEFT JOIN preview_users checker ON checker.id=l.source_checked_by WHERE l.id=? AND l.organization_id=? AND c.deleted_at IS NULL ' +
    'AND (?=1 OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=l.case_id AND a.user_id=?))'
  ).bind(id, PREVIEW_ORGANIZATION_ID, user.roles.includes('admin') ? 1 : 0, user.id).first<PreviewLitigationRow>();
}

async function litigationDetail(env: CloudflareEnv, user: SessionUser, id: string): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  const record = await accessibleLitigationRecord(env, user, id);
  if (!record) return json({ error: 'Litigation record was not found or is not assigned', code: 'LITIGATION_NOT_FOUND' }, 404);
  const events = await env.DB.prepare(
    'SELECT e.id,e.event_type AS eventType,e.occurred_at AS occurredAt,e.title,e.detail_text AS detailText,e.verification_status AS verificationStatus,' +
    'e.official_source_url AS officialSourceUrl,e.source_sha256 AS sourceSha256,e.schedule_id AS scheduleId,e.created_at AS createdAt,u.display_name AS createdByName ' +
    'FROM preview_litigation_events e JOIN preview_users u ON u.id=e.created_by WHERE e.litigation_case_id=? ORDER BY e.occurred_at DESC,e.created_at DESC LIMIT 100'
  ).bind(id).all<Record<string, unknown>>();
  return json({ record: litigationProjection(record), events: events.results, officialLookupAutomated: false, phase: 'CF13_LITIGATION_RECORDS' });
}

async function handlePreviewLitigation(request: Request, env: CloudflareEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  const user = await previewSessionUser(request, env);
  if (!user) return json({ error: 'Login is required', code: 'AUTH_REQUIRED' }, 401);
  const detailMatch = url.pathname.match(/^\/api\/litigation-records\/([0-9a-f-]{36})(?:\/(events))?$/iu);

  if (url.pathname === '/api/litigation-records' && request.method === 'GET') {
    const query = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
    const caseId = (url.searchParams.get('caseId') ?? '').trim();
    const stage = (url.searchParams.get('stage') ?? '').trim();
    const limit = Number(url.searchParams.get('limit') ?? 100);
    if ((caseId && !/^[0-9a-f-]{36}$/iu.test(caseId)) || (stage && !LITIGATION_STAGES.has(stage)) || !Number.isInteger(limit) || limit < 1 || limit > 100) return json({ error: 'Litigation search parameters are invalid', code: 'INVALID_LITIGATION_SEARCH' }, 400);
    const like = `%${query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    const rows = await env.DB.prepare(
      'SELECT l.id,l.case_id AS caseId,c.case_number AS projectCaseNumber,c.title AS projectTitle,l.court_name AS courtName,l.court_case_number AS courtCaseNumber,' +
      'l.case_title AS caseTitle,l.division_name AS divisionName,l.parties_text AS partiesText,l.filed_on AS filedOn,l.current_stage AS currentStage,' +
      'l.next_hearing_at AS nextHearingAt,l.verification_status AS verificationStatus,l.official_source_url AS officialSourceUrl,l.source_checked_at AS sourceCheckedAt,' +
      'checker.display_name AS sourceCheckedByName,l.version,(SELECT COUNT(*) FROM preview_litigation_events e WHERE e.litigation_case_id=l.id) AS eventCount,' +
      '(SELECT COUNT(*) FROM preview_litigation_events e WHERE e.litigation_case_id=l.id AND e.verification_status=\'VERIFIED\') AS verifiedEventCount,' +
      'l.created_at AS createdAt,l.updated_at AS updatedAt FROM preview_litigation_cases l JOIN preview_cases c ON c.id=l.case_id LEFT JOIN preview_users checker ON checker.id=l.source_checked_by ' +
      'WHERE l.organization_id=? AND c.deleted_at IS NULL AND (?=1 OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=l.case_id AND a.user_id=?)) ' +
      'AND (?=\'\' OR l.case_id=?) AND (?=\'\' OR l.current_stage=?) AND (?=\'\' OR l.court_case_number LIKE ? ESCAPE \'\\\' OR l.court_name LIKE ? ESCAPE \'\\\' OR l.parties_text LIKE ? ESCAPE \'\\\' OR c.title LIKE ? ESCAPE \'\\\') ' +
      'ORDER BY COALESCE(l.next_hearing_at,\'9999-12-31T00:00:00.000Z\'),l.updated_at DESC LIMIT ?'
    ).bind(PREVIEW_ORGANIZATION_ID, user.roles.includes('admin') ? 1 : 0, user.id, caseId, caseId, stage, stage, query, like, like, like, like, limit).all<PreviewLitigationRow>();
    return json({ records: rows.results.map(litigationProjection), officialLookupAutomated: false, phase: 'CF13_LITIGATION_RECORDS' });
  }

  if (url.pathname === '/api/litigation-records' && request.method === 'POST') {
    if (!canMutatePreviewCases(user)) return json({ error: 'Role cannot create litigation records', code: 'FORBIDDEN' }, 403);
    const requestKey = request.headers.get('Idempotency-Key');
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!requestKey || !PREVIEW_CASE_CREATE_KEY.test(requestKey) || !body || !exactObjectKeys(body, ['caseId','courtName','courtCaseNumber','caseTitle','divisionName','partiesText','filedOn','currentStage','nextHearingAt','verificationStatus','officialSourceUrl'])) return json({ error: 'Litigation payload or Idempotency-Key is invalid', code: 'INVALID_LITIGATION_PAYLOAD' }, 400);
    const caseId = litigationText(body.caseId, 36);
    const project = caseId ? await accessiblePreviewCase(env, user, caseId) : null;
    const courtName = litigationText(body.courtName, 200);
    const courtCaseNumber = litigationText(body.courtCaseNumber, 80);
    const caseTitle = litigationText(body.caseTitle, 500);
    const divisionName = litigationText(body.divisionName, 200, true);
    const partiesText = litigationText(body.partiesText, 2000);
    const filedOn = optionalIso(body.filedOn, true);
    const nextHearingAt = optionalIso(body.nextHearingAt);
    const currentStage = typeof body.currentStage === 'string' && LITIGATION_STAGES.has(body.currentStage) ? body.currentStage : null;
    const verificationStatus = typeof body.verificationStatus === 'string' && LITIGATION_VERIFICATION.has(body.verificationStatus) ? body.verificationStatus : null;
    const officialSourceUrl = body.officialSourceUrl ? officialCourtSource(body.officialSourceUrl) : null;
    if (!project || !courtName || !courtCaseNumber || !caseTitle || !partiesText || !currentStage || !verificationStatus || (body.filedOn && !filedOn) || (body.nextHearingAt && !nextHearingAt) || (body.officialSourceUrl && !officialSourceUrl) || (verificationStatus === 'VERIFIED' && !officialSourceUrl)) return json({ error: 'Litigation fields or official court URL are invalid', code: 'INVALID_LITIGATION_PAYLOAD' }, 400);
    const fingerprint = await sha256Hex(JSON.stringify({ caseId,courtName,courtCaseNumber,caseTitle,divisionName,partiesText,filedOn,currentStage,nextHearingAt,verificationStatus,officialSourceUrl }));
    const replay = await env.DB.prepare('SELECT id,request_fingerprint AS fingerprint FROM preview_litigation_cases WHERE create_request_key=?').bind(requestKey).first<{id:string;fingerprint:string}>();
    if (replay) {
      if (replay.fingerprint !== fingerprint) return json({ error: 'Idempotency-Key was used for another litigation record', code: 'IDEMPOTENCY_MISMATCH' }, 409);
      return litigationDetail(env,user,replay.id);
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      if (!env.DB.batch) return json({ error: 'D1 batch is unavailable', code: 'D1_BATCH_REQUIRED' }, 503);
      await env.DB.batch([
        env.DB.prepare('INSERT INTO preview_litigation_cases (id,organization_id,case_id,court_name,court_case_number,case_title,division_name,parties_text,filed_on,current_stage,next_hearing_at,verification_status,official_source_url,source_checked_at,source_checked_by,version,create_request_key,request_fingerprint,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)')
          .bind(id,PREVIEW_ORGANIZATION_ID,caseId,courtName,courtCaseNumber,caseTitle,divisionName,partiesText,filedOn,currentStage,nextHearingAt,verificationStatus,officialSourceUrl,verificationStatus === 'VERIFIED' ? now : null,verificationStatus === 'VERIFIED' ? user.id : null,requestKey,fingerprint,user.id,now,now),
        env.DB.prepare('INSERT INTO preview_case_activities (id,case_id,actor_id,event_type,title,description,created_at) VALUES (?,?,?,?,?,?,?)')
          .bind(crypto.randomUUID(),caseId,user.id,'LITIGATION_LINKED','법원 사건 연결',`${courtName} · ${courtCaseNumber}`,now)
      ]);
    } catch {
      return json({ error: 'Court case number is already linked or persistence failed', code: 'LITIGATION_CONFLICT' }, 409);
    }
    const response = await litigationDetail(env, user, id);
    return new Response(response.body, { status: 201, headers: response.headers });
  }

  if (detailMatch && !detailMatch[2] && request.method === 'GET') return litigationDetail(env, user, detailMatch[1]);

  if (detailMatch && !detailMatch[2] && request.method === 'PUT') {
    if (!canMutatePreviewCases(user)) return json({ error: 'Role cannot update litigation records', code: 'FORBIDDEN' }, 403);
    const current = await accessibleLitigationRecord(env, user, detailMatch[1]);
    if (!current) return json({ error: 'Litigation record was not found or is not assigned', code: 'LITIGATION_NOT_FOUND' }, 404);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !exactObjectKeys(body, ['caseId','courtName','courtCaseNumber','caseTitle','divisionName','partiesText','filedOn','currentStage','nextHearingAt','verificationStatus','officialSourceUrl','expectedVersion'])) return json({ error: 'Litigation payload is invalid', code: 'INVALID_LITIGATION_PAYLOAD' }, 400);
    const expectedVersion = Number(body.expectedVersion);
    const courtName = litigationText(body.courtName, 200); const courtCaseNumber = litigationText(body.courtCaseNumber, 80); const caseTitle = litigationText(body.caseTitle, 500);
    const divisionName = litigationText(body.divisionName, 200, true); const partiesText = litigationText(body.partiesText, 2000);
    const filedOn = optionalIso(body.filedOn, true); const nextHearingAt = optionalIso(body.nextHearingAt);
    const currentStage = typeof body.currentStage === 'string' && LITIGATION_STAGES.has(body.currentStage) ? body.currentStage : null;
    const verificationStatus = typeof body.verificationStatus === 'string' && LITIGATION_VERIFICATION.has(body.verificationStatus) ? body.verificationStatus : null;
    const officialSourceUrl = body.officialSourceUrl ? officialCourtSource(body.officialSourceUrl) : null;
    if (!Number.isInteger(expectedVersion) || expectedVersion !== current.version || body.caseId !== current.caseId || !courtName || !courtCaseNumber || !caseTitle || !partiesText || !currentStage || !verificationStatus || (body.filedOn && !filedOn) || (body.nextHearingAt && !nextHearingAt) || (body.officialSourceUrl && !officialSourceUrl) || (verificationStatus === 'VERIFIED' && !officialSourceUrl)) return json({ error: expectedVersion !== current.version ? 'Litigation record has changed' : 'Litigation fields are invalid', code: expectedVersion !== current.version ? 'VERSION_CONFLICT' : 'INVALID_LITIGATION_PAYLOAD' }, expectedVersion !== current.version ? 409 : 400);
    const now = new Date().toISOString(); const nextVersion = expectedVersion + 1;
    if (!env.DB.batch) return json({ error: 'D1 batch is unavailable', code: 'D1_BATCH_REQUIRED' }, 503);
    try {
      await env.DB.batch([
        env.DB.prepare('UPDATE preview_litigation_cases SET court_name=?,court_case_number=?,case_title=?,division_name=?,parties_text=?,filed_on=?,current_stage=?,next_hearing_at=?,verification_status=?,official_source_url=?,source_checked_at=?,source_checked_by=?,version=version+1,updated_at=? WHERE id=? AND version=?')
          .bind(courtName,courtCaseNumber,caseTitle,divisionName,partiesText,filedOn,currentStage,nextHearingAt,verificationStatus,officialSourceUrl,verificationStatus === 'VERIFIED' ? now : null,verificationStatus === 'VERIFIED' ? user.id : null,now,current.id,expectedVersion),
        env.DB.prepare('INSERT INTO preview_case_activities (id,case_id,actor_id,event_type,title,description,created_at) SELECT ?,?,?,\'LITIGATION_UPDATED\',?,?,? WHERE EXISTS (SELECT 1 FROM preview_litigation_cases WHERE id=? AND version=? AND updated_at=?)')
          .bind(crypto.randomUUID(),current.caseId,user.id,'법원 사건 정보 갱신',`${courtName} · ${courtCaseNumber} · ${currentStage}`,now,current.id,nextVersion,now)
      ]);
    } catch { return json({ error: 'Litigation record update conflicted', code: 'LITIGATION_CONFLICT' }, 409); }
    const canonical = await accessibleLitigationRecord(env,user,current.id);
    if (canonical?.version !== nextVersion) return json({ error: 'Litigation record has changed', code: 'VERSION_CONFLICT' }, 409);
    return litigationDetail(env,user,current.id);
  }

  if (detailMatch?.[2] === 'events' && request.method === 'POST') {
    if (!canMutatePreviewCases(user)) return json({ error: 'Role cannot add litigation events', code: 'FORBIDDEN' }, 403);
    const record = await accessibleLitigationRecord(env,user,detailMatch[1]);
    if (!record) return json({ error: 'Litigation record was not found or is not assigned', code: 'LITIGATION_NOT_FOUND' }, 404);
    const key = request.headers.get('Idempotency-Key');
    const body = await request.json().catch(() => null) as Record<string,unknown> | null;
    if (!key || !PREVIEW_CASE_CREATE_KEY.test(key) || !body || !exactObjectKeys(body,['eventType','occurredAt','title','detailText','verificationStatus','officialSourceUrl','sourceSha256','createCourtSchedule'])) return json({ error: 'Event payload or Idempotency-Key is invalid', code: 'INVALID_LITIGATION_EVENT' }, 400);
    const eventType = typeof body.eventType === 'string' && LITIGATION_EVENT_TYPES.has(body.eventType) ? body.eventType : null;
    const occurredAt = optionalIso(body.occurredAt); const title = litigationText(body.title,300); const detailText = litigationText(body.detailText,5000);
    const verificationStatus = typeof body.verificationStatus === 'string' && LITIGATION_VERIFICATION.has(body.verificationStatus) ? body.verificationStatus : null;
    const officialSourceUrl = body.officialSourceUrl ? officialCourtSource(body.officialSourceUrl) : null;
    const sourceSha256 = typeof body.sourceSha256 === 'string' && /^[0-9a-f]{64}$/iu.test(body.sourceSha256) ? body.sourceSha256.toLowerCase() : null;
    const createCourtSchedule = body.createCourtSchedule === true;
    if (!eventType || !occurredAt || !title || !detailText || !verificationStatus || (body.officialSourceUrl && !officialSourceUrl) || (body.sourceSha256 && !sourceSha256) || (verificationStatus === 'VERIFIED' && (!officialSourceUrl || !sourceSha256)) || (createCourtSchedule && eventType !== 'HEARING')) return json({ error: 'Event fields or verification evidence are invalid', code: 'INVALID_LITIGATION_EVENT' }, 400);
    const fingerprint = await sha256Hex(JSON.stringify({ litigationId:record.id,eventType,occurredAt,title,detailText,verificationStatus,officialSourceUrl,sourceSha256,createCourtSchedule }));
    const existing = await env.DB.prepare('SELECT id,request_fingerprint AS fingerprint FROM preview_litigation_events WHERE request_key=?').bind(key).first<{id:string;fingerprint:string}>();
    if (existing) {
      if (existing.fingerprint !== fingerprint) return json({ error: 'Idempotency-Key was used for another litigation event', code: 'IDEMPOTENCY_MISMATCH' }, 409);
      return litigationDetail(env,user,record.id);
    }
    const eventId=crypto.randomUUID(); const scheduleId=createCourtSchedule?crypto.randomUUID():null; const now=new Date().toISOString();
    if (!env.DB.batch) return json({ error: 'D1 batch is unavailable', code: 'D1_BATCH_REQUIRED' }, 503);
    const statements:D1StatementLike[]=[];
    if (scheduleId) statements.push(env.DB.prepare('INSERT INTO preview_case_schedules (id,case_id,title,type,scheduled_at,location,created_by,created_at) VALUES (?,?,?,\'COURT\',?,?,?,?)').bind(scheduleId,record.caseId,`${record.courtName} ${title}`,occurredAt,record.divisionName,user.id,now));
    statements.push(env.DB.prepare('INSERT INTO preview_litigation_events (id,litigation_case_id,case_id,event_type,occurred_at,title,detail_text,verification_status,official_source_url,source_sha256,schedule_id,request_key,request_fingerprint,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(eventId,record.id,record.caseId,eventType,occurredAt,title,detailText,verificationStatus,officialSourceUrl,sourceSha256,scheduleId,key,fingerprint,user.id,now));
    statements.push(env.DB.prepare('INSERT INTO preview_case_activities (id,case_id,actor_id,event_type,title,description,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),record.caseId,user.id,'LITIGATION_EVENT_ADDED',title,`${record.courtCaseNumber} · ${eventType}`,now));
    try { await env.DB.batch(statements); } catch { return json({ error: 'Litigation event could not be recorded atomically', code: 'LITIGATION_EVENT_CONFLICT' }, 409); }
    return litigationDetail(env,user,record.id);
  }

  return json({ error: 'Litigation route was not found', code: 'LITIGATION_ROUTE_NOT_FOUND' }, 404);
}

async function handlePreviewCases(request: Request, env: CloudflareEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  const user = await previewSessionUser(request, env);
  if (!user) return json({ error: 'Login is required', code: 'AUTH_REQUIRED' }, 401);
  const workflowPath = url.pathname.match(/^\/api\/cases\/([0-9a-f-]{36})\/workflow(?:\/(kickoff|kickoff-summary|site-survey|allocations))?$/iu);
  if (workflowPath) return handlePreviewCaseWorkflow(request, env, url, user, workflowPath[1], workflowPath[2]);
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

// CF12 report-authoring prompts. Prompt bodies are Admin-only and are never
// included in the writer-facing configuration response.
const PREVIEW_OPENAI_MODELS = new Set(['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
const PREVIEW_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

interface PreviewPromptRow {
  id: string;
  claimType: string;
  typeName: string;
  setStatus: string;
  chapterCode: string;
  title: string;
  agentCode: string;
  rolePrompt: string;
  instructionPrompt: string;
  ordinal: number;
  version: number;
  updatedAt: string;
  updatedByName: string;
  systemPrompt: string;
}

interface PreviewAiSettingsRow {
  providerKind: string;
  modelCode: string;
  reasoningEffort: string;
  version: number;
  updatedAt: string;
  updatedByName: string;
}

interface PreviewOutlineItem {
  chapterId: string;
  chapterCode: string;
  promptVersion: number;
  planningNote: string;
}

interface PreviewOutlineRow {
  outlineJson: string;
  status: 'DRAFT' | 'CONFIRMED';
  version: number;
  updatedAt: string;
  updatedByName: string;
}

function defaultPreviewOutline(prompts: PreviewPromptRow[]): PreviewOutlineItem[] {
  return prompts.filter((row) => Boolean(row.id)).map((row) => ({
    chapterId: row.id,
    chapterCode: row.chapterCode,
    promptVersion: Number(row.version),
    planningNote: ''
  }));
}

function parsePreviewOutline(value: string): PreviewOutlineItem[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PreviewOutlineItem => Boolean(
      item && typeof item === 'object' && typeof (item as PreviewOutlineItem).chapterId === 'string'
      && typeof (item as PreviewOutlineItem).chapterCode === 'string'
      && Number.isInteger((item as PreviewOutlineItem).promptVersion)
      && typeof (item as PreviewOutlineItem).planningNote === 'string'
    ));
  } catch { return []; }
}

async function previewOutlinePlan(env: CloudflareEnv, caseId: string, prompts: PreviewPromptRow[]): Promise<{ persistenceAvailable: boolean; status: 'DRAFT' | 'CONFIRMED'; version: number; updatedAt: string | null; updatedBy: string | null; items: PreviewOutlineItem[] }> {
  if (!env.DB) return { persistenceAvailable: false, status: 'DRAFT', version: 0, updatedAt: null, updatedBy: null, items: defaultPreviewOutline(prompts) };
  try {
    const row = await env.DB.prepare(
      'SELECT o.outline_json AS outlineJson, o.status, o.version, o.updated_at AS updatedAt, u.display_name AS updatedByName ' +
      'FROM preview_report_outline_plans o JOIN preview_users u ON u.id=o.updated_by WHERE o.case_id=? AND o.organization_id=?'
    ).bind(caseId, PREVIEW_ORGANIZATION_ID).first<PreviewOutlineRow>();
    if (!row) return { persistenceAvailable: true, status: 'DRAFT', version: 0, updatedAt: null, updatedBy: null, items: defaultPreviewOutline(prompts) };
    const items = parsePreviewOutline(row.outlineJson);
    return { persistenceAvailable: true, status: row.status, version: Number(row.version), updatedAt: row.updatedAt, updatedBy: row.updatedByName, items: items.length ? items : defaultPreviewOutline(prompts) };
  } catch {
    // Old isolated test fixtures may intentionally stop before the additive
    // outline migration. Production always applies migrations before deploy.
    return { persistenceAvailable: false, status: 'DRAFT', version: 0, updatedAt: null, updatedBy: null, items: defaultPreviewOutline(prompts) };
  }
}

async function previewReportSourceGroups(env: CloudflareEnv, caseRow: PreviewCaseRow): Promise<Array<Record<string, unknown>>> {
  if (!env.DB) return [];
  const count = async (sql: string): Promise<number> => {
    try { return Number((await env.DB?.prepare(sql).bind(caseRow.id, PREVIEW_ORGANIZATION_ID).first<{ total: number }>())?.total ?? 0); }
    catch { return 0; }
  };
  const [proposalCount, kickoffCount, surveyCount, allocationCount, evidenceCount, takeoffCount, costCount, litigationCount] = await Promise.all([
    count("SELECT COUNT(*) AS total FROM preview_proposal_links WHERE case_id=? AND organization_id=? AND verification_status='VERIFIED'"),
    count("SELECT COUNT(*) AS total FROM preview_workflow_kickoffs WHERE case_id=? AND organization_id=? AND status IN ('COMPLETED','DRAFTED','CONFIRMED')"),
    count("SELECT COUNT(*) AS total FROM preview_site_surveys WHERE case_id=? AND organization_id=?"),
    count("SELECT COUNT(*) AS total FROM preview_workforce_allocations WHERE case_id=? AND organization_id=?"),
    count('SELECT COUNT(*) AS total FROM preview_case_evidence WHERE case_id=? AND organization_id=?'),
    count("SELECT COUNT(*) AS total FROM preview_case_evidence WHERE case_id=? AND organization_id=? AND category='TAKEOFF_SOURCE'"),
    count("SELECT COUNT(*) AS total FROM preview_case_evidence WHERE case_id=? AND organization_id=? AND category='COST_BREAKDOWN'"),
    count("SELECT COUNT(*) AS total FROM preview_litigation_cases WHERE case_id=? AND organization_id=? AND verification_status='VERIFIED'")
  ]);
  const status = (items: number, partial = false): 'READY' | 'PARTIAL' | 'EMPTY' => items > 0 ? (partial ? 'PARTIAL' : 'READY') : 'EMPTY';
  return [
    { code: 'PROJECT', label: '프로젝트 기본정보', status: 'READY', itemCount: 1, detail: `${caseRow.caseNumber} · ${caseRow.claimType}`, route: '/cases/detail' },
    { code: 'PROPOSAL', label: '제안서·수주', status: status(proposalCount), itemCount: proposalCount, detail: proposalCount ? '검증된 제안서 연동본' : '검증된 제안서 연동 필요', route: '/proposals/editor' },
    { code: 'KICKOFF', label: '착수회의·회의록', status: status(kickoffCount), itemCount: kickoffCount, detail: kickoffCount ? '회의 기록과 요약 준비' : '착수회의 기록 필요', route: '/workflow/kickoff' },
    { code: 'SITE_SURVEY', label: '현장조사', status: status(surveyCount, surveyCount > 0 && evidenceCount === 0), itemCount: surveyCount, detail: surveyCount ? `조사 ${surveyCount}건 · 첨부 ${evidenceCount}건` : '현장조사 계획·결과 필요', route: '/workflow/site-survey' },
    { code: 'QUANTITY', label: '물량산출·내역', status: status(allocationCount + takeoffCount + costCount, allocationCount === 0 || takeoffCount === 0 || costCount === 0), itemCount: allocationCount + takeoffCount + costCount, detail: `팀 일정 ${allocationCount} · 산출자료 ${takeoffCount} · 내역자료 ${costCount}`, route: '/workflow/quantity' },
    { code: 'EVIDENCE', label: '클레임센터 자료실', status: status(evidenceCount), itemCount: evidenceCount, detail: evidenceCount ? `SHA-256 확인 파일 ${evidenceCount}건` : '프로젝트 근거 파일 필요', route: `/cases/files?caseId=${encodeURIComponent(caseRow.id)}` },
    { code: 'LITIGATION', label: '법원·소송 자료', status: status(litigationCount), itemCount: litigationCount, detail: litigationCount ? `공식 출처 확인 ${litigationCount}건` : '해당 시 공식 자료를 연결', route: '/after-delivery' }
  ];
}

async function previewAiSettings(env: CloudflareEnv): Promise<PreviewAiSettingsRow | null> {
  if (!env.DB) return null;
  return env.DB.prepare(
    'SELECT s.provider_kind AS providerKind, s.model_code AS modelCode, s.reasoning_effort AS reasoningEffort, s.version, s.updated_at AS updatedAt, u.display_name AS updatedByName ' +
    'FROM preview_report_ai_settings s JOIN preview_users u ON u.id = s.updated_by WHERE s.organization_id = ?'
  ).bind(PREVIEW_ORGANIZATION_ID).first<PreviewAiSettingsRow>();
}

async function previewPromptRows(env: CloudflareEnv, claimType = ''): Promise<PreviewPromptRow[]> {
  if (!env.DB) return [];
  const rows = await env.DB.prepare(
    'SELECT p.id, s.claim_type AS claimType, s.name AS typeName, s.status AS setStatus, p.chapter_code AS chapterCode, p.title, p.agent_code AS agentCode, ' +
    'p.role_prompt AS rolePrompt, p.instruction_prompt AS instructionPrompt, p.ordinal, p.version, p.updated_at AS updatedAt, u.display_name AS updatedByName, s.system_prompt AS systemPrompt ' +
    'FROM preview_report_prompt_sets s LEFT JOIN preview_report_chapter_prompts p ON p.prompt_set_id = s.id ' +
    'LEFT JOIN preview_users u ON u.id = p.updated_by WHERE s.organization_id = ? AND (? = \'\' OR s.claim_type = ?) ORDER BY s.claim_type, p.ordinal'
  ).bind(PREVIEW_ORGANIZATION_ID, claimType, claimType).all<PreviewPromptRow>();
  return rows.results;
}

async function handlePreviewPromptAdmin(request: Request, env: CloudflareEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  const user = await previewSessionUser(request, env);
  if (!user) return json({ error: 'Login is required', code: 'AUTH_REQUIRED' }, 401);
  if (!user.roles.includes('admin')) return json({ error: 'Only Admin can view or modify report prompts', code: 'FORBIDDEN' }, 403);

  if (url.pathname === '/api/admin/report-prompts' && request.method === 'GET') {
    const settings = await previewAiSettings(env);
    const rows = await previewPromptRows(env);
    const typeMap = new Map<string, { claimType: string; name: string; status: string; systemPrompt: string; chapters: Array<Record<string, unknown>> }>();
    for (const row of rows) {
      if (!typeMap.has(row.claimType)) typeMap.set(row.claimType, { claimType: row.claimType, name: row.typeName, status: row.setStatus, systemPrompt: row.systemPrompt, chapters: [] });
      if (row.id) typeMap.get(row.claimType)?.chapters.push({ id: row.id, chapterCode: row.chapterCode, title: row.title, agentCode: row.agentCode, rolePrompt: row.rolePrompt, instructionPrompt: row.instructionPrompt, ordinal: Number(row.ordinal), version: Number(row.version), updatedAt: row.updatedAt, updatedBy: row.updatedByName });
    }
    return json({ settings: settings ? { ...settings, version: Number(settings.version), apiKeyConfigured: Boolean(env.OPENAI_API_KEY) } : null, promptSets: [...typeMap.values()], phase: 'CF12_ADMIN_REPORT_PROMPTS' });
  }

  if (url.pathname === '/api/admin/report-prompts/settings' && request.method === 'PUT') {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !exactObjectKeys(body, ['modelCode', 'reasoningEffort', 'expectedVersion']) || typeof body.modelCode !== 'string' || typeof body.reasoningEffort !== 'string' || !Number.isInteger(body.expectedVersion)) {
      return json({ error: 'AI settings payload is invalid', code: 'INVALID_AI_SETTINGS' }, 400);
    }
    if (!PREVIEW_OPENAI_MODELS.has(body.modelCode) || !PREVIEW_REASONING_EFFORTS.has(body.reasoningEffort)) return json({ error: 'Model or reasoning effort is not allowed', code: 'UNSUPPORTED_MODEL' }, 400);
    const current = await previewAiSettings(env);
    if (!current || Number(current.version) !== Number(body.expectedVersion)) return json({ error: 'AI settings changed in another session', code: 'VERSION_CONFLICT', currentVersion: Number(current?.version ?? 0) }, 409);
    const now = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString();
    const result = await env.DB.prepare('UPDATE preview_report_ai_settings SET model_code = ?, reasoning_effort = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE organization_id = ? AND version = ?')
      .bind(body.modelCode, body.reasoningEffort, user.id, now, PREVIEW_ORGANIZATION_ID, body.expectedVersion).run();
    if (result.meta?.changes !== 1) return json({ error: 'AI settings changed in another session', code: 'VERSION_CONFLICT' }, 409);
    const settings = await previewAiSettings(env);
    return json({ settings: settings ? { ...settings, version: Number(settings.version), apiKeyConfigured: Boolean(env.OPENAI_API_KEY) } : null, phase: 'CF12_ADMIN_REPORT_PROMPTS' });
  }

  const promptMatch = url.pathname.match(/^\/api\/admin\/report-prompts\/(TYPE-0[1-6])\/(CH-[0-9]{2})$/u);
  if (promptMatch && request.method === 'PUT') {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !exactObjectKeys(body, ['rolePrompt', 'instructionPrompt', 'expectedVersion']) || typeof body.rolePrompt !== 'string' || typeof body.instructionPrompt !== 'string' || !Number.isInteger(body.expectedVersion)) {
      return json({ error: 'Chapter prompt payload is invalid', code: 'INVALID_PROMPT_PAYLOAD' }, 400);
    }
    const rolePrompt = body.rolePrompt.trim();
    const instructionPrompt = body.instructionPrompt.trim();
    if (rolePrompt.length < 20 || rolePrompt.length > 5000 || instructionPrompt.length < 20 || instructionPrompt.length > 10000) return json({ error: 'Chapter prompt length is invalid', code: 'INVALID_PROMPT_PAYLOAD' }, 400);
    const current = await env.DB.prepare(
      'SELECT p.id, p.version, p.updated_at AS updatedAt FROM preview_report_chapter_prompts p JOIN preview_report_prompt_sets s ON s.id = p.prompt_set_id WHERE s.organization_id = ? AND s.claim_type = ? AND p.chapter_code = ?'
    ).bind(PREVIEW_ORGANIZATION_ID, promptMatch[1], promptMatch[2]).first<{ id: string; version: number; updatedAt: string }>();
    if (!current) return json({ error: 'Chapter prompt was not found', code: 'PROMPT_NOT_FOUND' }, 404);
    if (Number(current.version) !== Number(body.expectedVersion)) return json({ error: 'Chapter prompt changed in another session', code: 'VERSION_CONFLICT', currentVersion: Number(current.version) }, 409);
    if (!env.DB.batch) return json({ error: 'D1 batch is unavailable', code: 'D1_BATCH_REQUIRED' }, 503);
    const nextVersion = Number(current.version) + 1;
    const now = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString();
    const results = await env.DB.batch([
      env.DB.prepare('UPDATE preview_report_chapter_prompts SET role_prompt = ?, instruction_prompt = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND version = ?').bind(rolePrompt, instructionPrompt, user.id, now, current.id, current.version),
      env.DB.prepare('INSERT INTO preview_report_prompt_history (id, prompt_id, version, role_prompt, instruction_prompt, changed_by, changed_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM preview_report_chapter_prompts WHERE id = ? AND version = ?)').bind(crypto.randomUUID(), current.id, nextVersion, rolePrompt, instructionPrompt, user.id, now, current.id, nextVersion)
    ]) as Array<{ meta?: { changes?: number } }>;
    if (results[0]?.meta?.changes !== 1) return json({ error: 'Chapter prompt changed in another session', code: 'VERSION_CONFLICT' }, 409);
    return json({ prompt: { claimType: promptMatch[1], chapterCode: promptMatch[2], rolePrompt, instructionPrompt, version: nextVersion, updatedAt: now }, phase: 'CF12_ADMIN_REPORT_PROMPTS' });
  }

  return json({ error: 'Report prompt route was not found', code: 'PROMPT_ROUTE_NOT_FOUND' }, 404);
}

function extractOpenAiText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === 'string' && record.output_text.trim()) return record.output_text.trim();
  if (!Array.isArray(record.output)) return null;
  const pieces: string[] = [];
  for (const item of record.output) {
    if (!item || typeof item !== 'object' || !Array.isArray((item as Record<string, unknown>).content)) continue;
    for (const content of (item as { content: unknown[] }).content) {
      if (content && typeof content === 'object' && typeof (content as Record<string, unknown>).text === 'string') pieces.push(String((content as Record<string, unknown>).text));
    }
  }
  return pieces.join('\n').trim() || null;
}

async function previewReportAuthoringContext(env: CloudflareEnv, caseRow: PreviewCaseRow): Promise<Record<string, unknown>> {
  if (!env.DB) return {};
  let verifiedLitigation: Record<string, unknown>[] = [];
  let verifiedLitigationEvents: Record<string, unknown>[] = [];
  let verifiedProposals: Record<string, unknown>[] = [];
  let proposalAwardDecisions: Record<string, unknown>[] = [];
  let evidenceCatalog: Record<string, unknown>[] = [];
  try {
    const [records, events] = await Promise.all([
      env.DB.prepare(
        'SELECT id,court_name AS courtName,court_case_number AS courtCaseNumber,case_title AS caseTitle,division_name AS divisionName,parties_text AS partiesText,filed_on AS filedOn,current_stage AS currentStage,next_hearing_at AS nextHearingAt,official_source_url AS officialSourceUrl,source_checked_at AS sourceCheckedAt,version FROM preview_litigation_cases WHERE case_id=? AND organization_id=? AND verification_status=\'VERIFIED\' ORDER BY updated_at DESC'
      ).bind(caseRow.id, PREVIEW_ORGANIZATION_ID).all<Record<string, unknown>>(),
      env.DB.prepare(
        'SELECT e.id,e.litigation_case_id AS litigationCaseId,e.event_type AS eventType,e.occurred_at AS occurredAt,e.title,e.detail_text AS detailText,e.official_source_url AS officialSourceUrl,e.source_sha256 AS sourceSha256 FROM preview_litigation_events e JOIN preview_litigation_cases l ON l.id=e.litigation_case_id WHERE e.case_id=? AND l.organization_id=? AND e.verification_status=\'VERIFIED\' ORDER BY e.occurred_at'
      ).bind(caseRow.id, PREVIEW_ORGANIZATION_ID).all<Record<string, unknown>>()
    ]);
    verifiedLitigation = records.results;
    verifiedLitigationEvents = events.results;
  } catch {
    // Older local CF12 fixtures may not have the additive CF13 table yet.
    // Production applies migrations before code deployment.
  }
  try {
    const [proposals, decisions] = await Promise.all([
      env.DB.prepare(
        'SELECT id,proposal_number AS proposalNumber,proposal_title AS proposalTitle,revision_label AS revisionLabel,client_name AS clientName,sent_at AS sentAt,response_due_on AS responseDueOn,proposed_amount_krw AS proposedAmountKrw,document_url AS documentUrl,document_sha256 AS documentSha256,award_status AS awardStatus,contract_amount_krw AS contractAmountKrw,project_start_on AS projectStartOn,project_end_on AS projectEndOn,version FROM preview_proposal_links WHERE case_id=? AND organization_id=? AND verification_status=\'VERIFIED\' ORDER BY sent_at DESC'
      ).bind(caseRow.id, PREVIEW_ORGANIZATION_ID).all<Record<string, unknown>>(),
      env.DB.prepare(
        'SELECT d.id,d.proposal_link_id AS proposalLinkId,d.decision,d.decision_note AS decisionNote,d.decided_at AS decidedAt,d.contract_amount_krw AS contractAmountKrw,d.project_start_on AS projectStartOn,d.project_end_on AS projectEndOn,u.display_name AS decidedByName FROM preview_award_decisions d JOIN preview_proposal_links p ON p.id=d.proposal_link_id JOIN preview_users u ON u.id=d.decided_by WHERE d.case_id=? AND p.organization_id=? ORDER BY d.created_at DESC'
      ).bind(caseRow.id, PREVIEW_ORGANIZATION_ID).all<Record<string, unknown>>()
    ]);
    verifiedProposals = proposals.results;
    proposalAwardDecisions = decisions.results;
  } catch {
    // Older fixtures remain readable until the additive CF14 migration is applied.
  }
  try {
    const evidence = await env.DB.prepare(
      'SELECT id, category, original_name AS originalName, mime_type AS mimeType, byte_size AS byteSize, sha256, storage_provider AS storageProvider, uploaded_by_name AS uploadedBy, uploaded_at AS uploadedAt ' +
      'FROM preview_case_evidence WHERE case_id=? AND organization_id=? ORDER BY uploaded_at DESC LIMIT 100'
    ).bind(caseRow.id, PREVIEW_ORGANIZATION_ID).all<Record<string, unknown>>();
    evidenceCatalog = evidence.results;
  } catch {
    // The additive project evidence library may be absent in older fixtures.
  }
  const [kickoff, surveys, allocations, parties, schedules] = await Promise.all([
    env.DB.prepare('SELECT meeting_at AS meetingAt, location, agenda, participant_units_json AS participantUnitsJson, raw_notes AS rawNotes, summary_text AS summaryText, timeline_json AS timelineJson, status, version FROM preview_workflow_kickoffs WHERE case_id = ? AND organization_id = ?').bind(caseRow.id, PREVIEW_ORGANIZATION_ID).first<Record<string, unknown>>(),
    env.DB.prepare('SELECT survey_date AS surveyDate, location, scope_text AS scopeText, lead_unit AS leadUnit, folder_path AS folderPath, status, version FROM preview_site_surveys WHERE case_id = ? AND organization_id = ? ORDER BY survey_date').bind(caseRow.id, PREVIEW_ORGANIZATION_ID).all<Record<string, unknown>>(),
    env.DB.prepare('SELECT unit_label AS unitLabel, office, scheduling_mode AS schedulingMode, discipline, scope_text AS scopeText, basis_text AS basisText, start_date AS startDate, end_date AS endDate FROM preview_workforce_allocations WHERE case_id = ? AND organization_id = ? ORDER BY start_date').bind(caseRow.id, PREVIEW_ORGANIZATION_ID).all<Record<string, unknown>>(),
    env.DB.prepare('SELECT name, role FROM preview_case_parties WHERE case_id = ? ORDER BY created_at').bind(caseRow.id).all<Record<string, unknown>>(),
    env.DB.prepare('SELECT title, type, scheduled_at AS scheduledAt, location FROM preview_case_schedules WHERE case_id = ? ORDER BY scheduled_at').bind(caseRow.id).all<Record<string, unknown>>()
  ]);
  return {
    case: previewCaseProjection(caseRow),
    workflow: { kickoff, siteSurveys: surveys.results, quantityAndWorkforce: allocations.results },
    parties: parties.results,
    schedules: schedules.results,
    proposalWorkflow: { verifiedProposalSnapshots: verifiedProposals, awardDecisions: proposalAwardDecisions },
    litigation: { verifiedCases: verifiedLitigation, verifiedEvents: verifiedLitigationEvents },
    evidenceCatalog,
    sourcePolicy: 'Only these same-case D1 snapshots may be treated as facts. Proposal facts require VERIFIED document URL plus SHA-256. Litigation facts require VERIFIED official-source rows with source URL (and event SHA-256). Evidence catalog rows prove file identity, category, uploader, time, size and SHA-256 only; binary file contents must not be inferred unless separately extracted. Missing or conflicting fields must be marked [확인 필요].'
  };
}

async function handlePreviewReportAuthoring(request: Request, env: CloudflareEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  const user = await previewSessionUser(request, env);
  if (!user) return json({ error: 'Login is required', code: 'AUTH_REQUIRED' }, 401);

  if (url.pathname === '/api/report-authoring/config' && request.method === 'GET') {
    const caseId = url.searchParams.get('caseId') ?? '';
    if (!PREVIEW_DRAFT_KEY.test(caseId)) return json({ error: 'A valid caseId is required', code: 'INVALID_CASE_ID' }, 400);
    const caseRow = await accessiblePreviewCase(env, user, caseId);
    if (!caseRow) return json({ error: 'Case was not found or is not assigned to this user', code: 'CASE_NOT_FOUND' }, 404);
    const settings = await previewAiSettings(env);
    const prompts = await previewPromptRows(env, caseRow.claimType);
    const unavailable = caseRow.claimType === 'TYPE-05' || prompts.length === 0 || prompts[0]?.setStatus !== 'ACTIVE';
    const [outlinePlan, sourceGroups] = await Promise.all([
      previewOutlinePlan(env, caseRow.id, prompts),
      previewReportSourceGroups(env, caseRow)
    ]);
    return json({
      claimType: caseRow.claimType,
      available: !unavailable,
      unavailableReason: unavailable ? '승인된 유형별 보고서 템플릿과 챕터 프롬프트가 필요합니다.' : null,
      aiConnected: Boolean(env.OPENAI_API_KEY),
      modelLabel: settings?.modelCode ?? 'gpt-5.6',
      chapters: prompts.filter((row) => Boolean(row.id)).map((row) => ({ id: row.id, chapterCode: row.chapterCode, title: row.title, agentCode: row.agentCode, ordinal: Number(row.ordinal), promptVersion: Number(row.version) })),
      outlinePlan,
      sourceGroups,
      phase: 'CF12_WRITER_REPORT_AUTHORING'
    });
  }

  if (url.pathname === '/api/report-authoring/outline' && request.method === 'PUT') {
    if (!user.roles.some((role) => PREVIEW_REPORT_EDIT_ROLES.has(role))) return json({ error: 'Role cannot plan report outlines', code: 'FORBIDDEN' }, 403);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !exactObjectKeys(body, ['caseId', 'items', 'status', 'expectedVersion']) || typeof body.caseId !== 'string' || !Array.isArray(body.items) || !['DRAFT', 'CONFIRMED'].includes(String(body.status)) || !Number.isInteger(body.expectedVersion)) {
      return json({ error: 'Report outline payload is invalid', code: 'INVALID_OUTLINE_PAYLOAD' }, 400);
    }
    const caseRow = await accessiblePreviewCase(env, user, body.caseId);
    if (!caseRow) return json({ error: 'Case was not found or is not assigned to this user', code: 'CASE_NOT_FOUND' }, 404);
    const prompts = await previewPromptRows(env, caseRow.claimType);
    if (caseRow.claimType === 'TYPE-05' || !prompts.length || prompts[0]?.setStatus !== 'ACTIVE') return json({ error: 'Approved report template is unavailable', code: 'PROMPT_NOT_AVAILABLE' }, 409);
    const allowed = new Map(prompts.filter((row) => Boolean(row.id)).map((row) => [row.id, row]));
    const items: PreviewOutlineItem[] = [];
    for (const item of body.items) {
      if (!item || typeof item !== 'object' || !exactObjectKeys(item as Record<string, unknown>, ['chapterId', 'chapterCode', 'promptVersion', 'planningNote'])) return json({ error: 'Outline item is invalid', code: 'INVALID_OUTLINE_PAYLOAD' }, 400);
      const row = item as Record<string, unknown>;
      const prompt = typeof row.chapterId === 'string' ? allowed.get(row.chapterId) : undefined;
      if (!prompt || row.chapterCode !== prompt.chapterCode || Number(row.promptVersion) !== Number(prompt.version) || typeof row.planningNote !== 'string' || row.planningNote.length > 2000) return json({ error: 'Outline does not match the approved template', code: 'OUTLINE_TEMPLATE_MISMATCH' }, 409);
      items.push({ chapterId: prompt.id, chapterCode: prompt.chapterCode, promptVersion: Number(prompt.version), planningNote: row.planningNote.trim() });
    }
    if (items.length !== allowed.size || new Set(items.map((item) => item.chapterId)).size !== allowed.size) return json({ error: 'Every approved chapter must appear exactly once', code: 'OUTLINE_TEMPLATE_MISMATCH' }, 409);
    let current: { status: string; version: number; updatedAt: string } | null;
    try {
      current = await env.DB.prepare('SELECT status, version, updated_at AS updatedAt FROM preview_report_outline_plans WHERE case_id=? AND organization_id=?').bind(caseRow.id, PREVIEW_ORGANIZATION_ID).first<{ status: string; version: number; updatedAt: string }>();
    } catch {
      return json({ error: 'Report outline migration is not available', code: 'OUTLINE_STORAGE_NOT_READY' }, 503);
    }
    if (Number(current?.version ?? 0) !== Number(body.expectedVersion)) return json({ error: 'Report outline changed in another session', code: 'VERSION_CONFLICT', currentVersion: Number(current?.version ?? 0) }, 409);
    if (current?.status === 'CONFIRMED' && body.status !== 'CONFIRMED') return json({ error: 'Confirmed outline cannot return to draft', code: 'OUTLINE_ALREADY_CONFIRMED' }, 409);
    const now = new Date(Math.max(Date.now(), Date.parse(current?.updatedAt ?? '1970-01-01') + 1)).toISOString();
    const nextVersion = Number(body.expectedVersion) + 1;
    const outlineJson = JSON.stringify(items);
    if (!env.DB.batch) return json({ error: 'D1 batch is unavailable', code: 'D1_BATCH_REQUIRED' }, 503);
    const write = current
      ? env.DB.prepare('UPDATE preview_report_outline_plans SET outline_json=?, status=?, version=version+1, updated_by=?, updated_at=? WHERE case_id=? AND organization_id=? AND version=?').bind(outlineJson, body.status, user.id, now, caseRow.id, PREVIEW_ORGANIZATION_ID, body.expectedVersion)
      : env.DB.prepare('INSERT INTO preview_report_outline_plans (case_id, organization_id, claim_type, outline_json, status, version, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)').bind(caseRow.id, PREVIEW_ORGANIZATION_ID, caseRow.claimType, outlineJson, body.status, user.id, now, now);
    const results = await env.DB.batch([
      write,
      env.DB.prepare('INSERT INTO preview_case_activities (id, case_id, actor_id, event_type, title, description, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM preview_report_outline_plans WHERE case_id=? AND version=?)')
        .bind(crypto.randomUUID(), caseRow.id, user.id, body.status === 'CONFIRMED' ? 'REPORT_OUTLINE_CONFIRMED' : 'REPORT_OUTLINE_SAVED', `보고서 목차 ${body.status === 'CONFIRMED' ? '기획 확정' : '계획 저장'} · v${nextVersion}`, `${items.length}개 챕터`, now, caseRow.id, nextVersion)
    ]) as Array<{ meta?: { changes?: number } }>;
    if (results[0]?.meta?.changes !== 1 || results[1]?.meta?.changes !== 1) return json({ error: 'Report outline changed in another session', code: 'VERSION_CONFLICT' }, 409);
    return json({ outlinePlan: { persistenceAvailable: true, status: body.status, version: nextVersion, updatedAt: now, updatedBy: user.displayName, items }, phase: 'CF18_REPORT_OUTLINE_EVIDENCE' });
  }

  if (url.pathname === '/api/report-authoring/generate' && request.method === 'POST') {
    if (!user.roles.some((role) => PREVIEW_REPORT_EDIT_ROLES.has(role))) return json({ error: 'Role cannot generate report chapters', code: 'FORBIDDEN' }, 403);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !exactObjectKeys(body, ['caseId', 'chapterId', 'expectedDraftVersion']) || typeof body.caseId !== 'string' || typeof body.chapterId !== 'string' || !Number.isInteger(body.expectedDraftVersion)) return json({ error: 'Authoring request is invalid', code: 'INVALID_AUTHORING_PAYLOAD' }, 400);
    if (!env.OPENAI_API_KEY) return json({ error: '관리자가 Cloudflare 서버 Secret에 OPENAI_API_KEY를 연결해야 합니다.', code: 'OPENAI_NOT_CONFIGURED' }, 503);
    const caseRow = await accessiblePreviewCase(env, user, body.caseId);
    if (!caseRow) return json({ error: 'Case was not found or is not assigned to this user', code: 'CASE_NOT_FOUND' }, 404);
    const draft = await env.DB.prepare('SELECT version FROM preview_report_drafts WHERE case_id = ? AND organization_id = ?').bind(caseRow.id, PREVIEW_ORGANIZATION_ID).first<{ version: number }>();
    const currentVersion = Number(draft?.version ?? 0);
    if (currentVersion !== Number(body.expectedDraftVersion)) return json({ error: 'Report draft changed in another session', code: 'VERSION_CONFLICT', currentVersion }, 409);
    const prompt = await env.DB.prepare(
      'SELECT p.id, p.chapter_code AS chapterCode, p.title, p.agent_code AS agentCode, p.role_prompt AS rolePrompt, p.instruction_prompt AS instructionPrompt, p.version, s.system_prompt AS systemPrompt, s.status AS setStatus, s.claim_type AS claimType ' +
      'FROM preview_report_chapter_prompts p JOIN preview_report_prompt_sets s ON s.id = p.prompt_set_id WHERE p.id = ? AND s.organization_id = ? AND s.claim_type = ?'
    ).bind(body.chapterId, PREVIEW_ORGANIZATION_ID, caseRow.claimType).first<PreviewPromptRow>();
    if (!prompt || prompt.setStatus !== 'ACTIVE') return json({ error: 'Approved chapter prompt is unavailable', code: 'PROMPT_NOT_AVAILABLE' }, 409);
    const outlinePlan = await previewOutlinePlan(env, caseRow.id, [prompt]);
    if (outlinePlan.persistenceAvailable && (outlinePlan.status !== 'CONFIRMED' || !outlinePlan.items.some((item) => item.chapterId === prompt.id && item.promptVersion === Number(prompt.version)))) {
      return json({ error: 'Confirm the current report outline before AI authoring', code: 'OUTLINE_CONFIRMATION_REQUIRED' }, 409);
    }
    const settings = await previewAiSettings(env);
    if (!settings || !PREVIEW_OPENAI_MODELS.has(settings.modelCode)) return json({ error: 'Admin AI model setting is unavailable', code: 'AI_SETTINGS_NOT_READY' }, 503);
    const context = await previewReportAuthoringContext(env, caseRow);
    const chapterPlanningNote = outlinePlan.items.find((item) => item.chapterId === prompt.id)?.planningNote ?? '';
    context.outlinePlanning = { chapterCode: prompt.chapterCode, planningNote: chapterPlanningNote, outlineVersion: outlinePlan.version, outlineStatus: outlinePlan.status };
    const contextJson = JSON.stringify(context).slice(0, 80_000);
    const inputSha256 = await sha256Hex(contextJson);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    let response: Response;
    try {
      response = await (env.OPENAI_TEST_FETCH ?? fetch)('https://api.openai.com/v1/responses', {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings.modelCode,
          store: false,
          safety_identifier: await sha256Hex(`${PREVIEW_ORGANIZATION_ID}:${user.id}`),
          reasoning: { effort: settings.reasoningEffort },
          text: { verbosity: 'high' },
          instructions: `${prompt.systemPrompt}\n\n[장별 역할]\n${prompt.rolePrompt}\n\n[장별 작성 지시]\n${prompt.instructionPrompt}`,
          input: `다음 JSON은 현재 사건의 승인된 내부 작업 데이터입니다. ${prompt.chapterCode} ${prompt.title} 장만 작성하십시오.\n${contextJson}`
        })
      });
    } catch {
      clearTimeout(timeout);
      return json({ error: 'AI 공급자 응답 시간이 초과되었거나 연결에 실패했습니다.', code: 'OPENAI_UNAVAILABLE' }, 504);
    }
    clearTimeout(timeout);
    if (!response.ok) return json({ error: 'AI 공급자가 요청을 처리하지 못했습니다. 관리자 연결 상태와 예산을 확인해 주세요.', code: 'OPENAI_REQUEST_FAILED', providerStatus: response.status }, response.status === 401 ? 503 : 502);
    const providerPayload = await response.json().catch(() => null);
    const content = extractOpenAiText(providerPayload);
    if (!content || content.length > 200_000) return json({ error: 'AI 공급자 응답 형식이 올바르지 않습니다.', code: 'OPENAI_MALFORMED_RESPONSE' }, 502);
    const outputSha256 = await sha256Hex(content);
    const now = new Date().toISOString();
    if (!env.DB.batch) return json({ error: 'D1 batch is unavailable', code: 'D1_BATCH_REQUIRED' }, 503);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO preview_report_ai_generations (id, organization_id, case_id, prompt_id, prompt_version, model_code, actor_id, input_sha256, output_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), PREVIEW_ORGANIZATION_ID, caseRow.id, prompt.id, prompt.version, settings.modelCode, user.id, inputSha256, outputSha256, now),
      env.DB.prepare('INSERT INTO preview_case_activities (id, case_id, actor_id, event_type, title, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), caseRow.id, user.id, 'REPORT_CHAPTER_AI_DRAFTED', `AI 장 초안 · ${prompt.chapterCode}`, `${prompt.title} · prompt v${prompt.version}`, now)
    ]);
    return json({ chapter: { chapterCode: prompt.chapterCode, title: prompt.title, content, promptVersion: Number(prompt.version), generatedAt: now }, phase: 'CF12_WRITER_REPORT_AUTHORING' });
  }

  return json({ error: 'Report authoring route was not found', code: 'AUTHORING_ROUTE_NOT_FOUND' }, 404);
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
  const outputs = await env.DB.prepare(
    'SELECT o.id,o.finalization_id AS finalizationId,o.format,o.file_name AS fileName,o.content_sha256 AS contentSha256,o.byte_size AS byteSize,o.created_at AS createdAt ' +
    'FROM preview_report_outputs o JOIN preview_report_finalizations f ON f.id=o.finalization_id ' +
    'WHERE f.organization_id=? AND (?=\'\' OR f.case_id=?) AND (?=1 OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=f.case_id AND a.user_id=?)) ORDER BY o.format'
  ).bind(PREVIEW_ORGANIZATION_ID, caseId, caseId, user.roles.includes('admin') ? 1 : 0, user.id).all<Record<string, unknown> & { finalizationId: string }>();
  const projections = rows.results.map((row) => finalizationProjection(row, outputs.results.filter((output) => output.finalizationId === row.id)));
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

const CASE_EVIDENCE_CATEGORIES = new Set(['TAKEOFF_SOURCE', 'COST_BREAKDOWN']);
const CASE_EVIDENCE_UPLOAD_ROLES = new Set(['admin', 'ceo', 'director', 'pm', 'staff', 'reviewer']);
const CASE_EVIDENCE_CHUNK_BYTES = 450_000;

interface CaseEvidenceRow {
  id: string;
  category: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  chunkCount: number;
  storageProvider: string;
  uploadedBy: string;
  uploadedAt: string;
  requestFingerprint?: string;
}

function caseEvidenceProjection(row: CaseEvidenceRow): Record<string, unknown> {
  return {
    id: row.id,
    category: row.category,
    originalName: row.originalName,
    mimeType: row.mimeType,
    byteSize: Number(row.byteSize),
    sha256: row.sha256,
    storageProvider: row.storageProvider,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt,
    downloadUrl: `/api/cases/evidence/${row.id}/download`
  };
}

async function handleCaseEvidence(request: Request, env: CloudflareEnv, url: URL): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ error: 'D1 database is not bound', code: 'D1_NOT_CONFIGURED' }, 503);
  const user = await previewSessionUser(request, env);
  if (!user) return json({ error: 'Login is required', code: 'AUTH_REQUIRED' }, 401);

  const downloadMatch = url.pathname.match(/^\/api\/cases\/evidence\/([0-9a-f-]{36})\/download$/iu);
  if (downloadMatch && request.method === 'GET') {
    const evidence = await db.prepare(
      'SELECT e.id,e.case_id AS caseId,e.original_name AS originalName,e.mime_type AS mimeType,e.byte_size AS byteSize,e.sha256,e.chunk_count AS chunkCount ' +
      'FROM preview_case_evidence e WHERE e.id=? AND e.organization_id=?'
    ).bind(downloadMatch[1], PREVIEW_ORGANIZATION_ID).first<{ id: string; caseId: string; originalName: string; mimeType: string; byteSize: number; sha256: string; chunkCount: number }>();
    if (!evidence || !await accessiblePreviewCase(env, user, evidence.caseId)) return json({ error: 'Evidence file was not found', code: 'EVIDENCE_NOT_FOUND' }, 404);
    const chunks = await db.prepare('SELECT chunk_index AS chunkIndex,payload FROM preview_case_evidence_chunks WHERE evidence_id=? ORDER BY chunk_index ASC')
      .bind(evidence.id).all<{ chunkIndex: number; payload: ArrayBuffer | Uint8Array | number[] }>();
    if (chunks.results.length !== Number(evidence.chunkCount)) return json({ error: 'Evidence chunks are incomplete', code: 'EVIDENCE_INTEGRITY_FAILED' }, 503);
    const bytes = new Uint8Array(Number(evidence.byteSize));
    let offset = 0;
    for (const chunk of chunks.results) {
      const value = chunk.payload instanceof Uint8Array ? chunk.payload : chunk.payload instanceof ArrayBuffer ? new Uint8Array(chunk.payload) : new Uint8Array(chunk.payload);
      if (offset + value.byteLength > bytes.byteLength) return json({ error: 'Evidence size is invalid', code: 'EVIDENCE_INTEGRITY_FAILED' }, 503);
      bytes.set(value, offset); offset += value.byteLength;
    }
    if (offset !== bytes.byteLength || !constantTimeHexEqual(await sha256Hex(bytes), evidence.sha256)) return json({ error: 'Evidence integrity verification failed', code: 'EVIDENCE_INTEGRITY_FAILED' }, 503);
    return new Response(bytes.buffer as ArrayBuffer, { headers: { 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(evidence.originalName)}`, 'Content-Type': evidence.mimeType, 'X-Content-Type-Options': 'nosniff' } });
  }

  const collectionMatch = url.pathname.match(/^\/api\/cases\/([0-9a-f-]{36})\/evidence$/iu);
  if (!collectionMatch) return json({ error: 'Case evidence route was not found', code: 'EVIDENCE_ROUTE_NOT_FOUND' }, 404);
  const caseId = collectionMatch[1];
  if (!await accessiblePreviewCase(env, user, caseId)) return json({ error: 'Case was not found or is not assigned to this user', code: 'CASE_NOT_FOUND' }, 404);

  if (request.method === 'GET') {
    const category = url.searchParams.get('category') ?? '';
    if (category && !CASE_EVIDENCE_CATEGORIES.has(category)) return json({ error: 'Evidence category is invalid', code: 'INVALID_EVIDENCE_CATEGORY' }, 400);
    const rows = await db.prepare(
      'SELECT id,category,original_name AS originalName,mime_type AS mimeType,byte_size AS byteSize,sha256,chunk_count AS chunkCount,storage_provider AS storageProvider,uploaded_by_name AS uploadedBy,uploaded_at AS uploadedAt ' +
      'FROM preview_case_evidence WHERE case_id=? AND organization_id=? AND (?=\'\' OR category=?) ORDER BY uploaded_at DESC LIMIT 100'
    ).bind(caseId, PREVIEW_ORGANIZATION_ID, category, category).all<CaseEvidenceRow>();
    return json({ files: rows.results.map(caseEvidenceProjection), temporaryStorage: true, migrationTarget: 'GOOGLE_DRIVE', phase: 'CF15_CASE_EVIDENCE_LIBRARY' });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405);
  if (!user.roles.some((role) => CASE_EVIDENCE_UPLOAD_ROLES.has(role))) return json({ error: 'Role cannot upload project evidence', code: 'FORBIDDEN' }, 403);
  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (!idempotencyKey || !GOOGLE_IDEMPOTENCY_KEY.test(idempotencyKey)) return json({ error: 'A valid Idempotency-Key is required', code: 'INVALID_IDEMPOTENCY_KEY' }, 400);
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const category = form?.get('category');
  if (!(file instanceof File) || typeof category !== 'string' || !CASE_EVIDENCE_CATEGORIES.has(category)) return json({ error: 'file and a valid category are required', code: 'INVALID_EVIDENCE_PAYLOAD' }, 400);

  try {
    const validated = await validateEvidenceFile(file);
    const fingerprint = await sha256Hex(`${caseId}:${category}:${file.name}:${validated.mimeType}:${file.size}:${validated.sha256}`);
    const existing = await db.prepare(
      'SELECT id,category,original_name AS originalName,mime_type AS mimeType,byte_size AS byteSize,sha256,chunk_count AS chunkCount,storage_provider AS storageProvider,uploaded_by_name AS uploadedBy,uploaded_at AS uploadedAt,request_fingerprint AS requestFingerprint ' +
      'FROM preview_case_evidence WHERE organization_id=? AND case_id=? AND idempotency_key=?'
    ).bind(PREVIEW_ORGANIZATION_ID, caseId, idempotencyKey).first<CaseEvidenceRow>();
    if (existing) return existing.requestFingerprint === fingerprint ? json({ file: caseEvidenceProjection(existing), replay: true, phase: 'CF15_CASE_EVIDENCE_LIBRARY' }) : json({ error: 'Idempotency key belongs to another file', code: 'IDEMPOTENCY_MISMATCH' }, 409);
    const chunks: Uint8Array[] = [];
    for (let offset = 0; offset < validated.bytes.length; offset += CASE_EVIDENCE_CHUNK_BYTES) chunks.push(validated.bytes.slice(offset, Math.min(validated.bytes.length, offset + CASE_EVIDENCE_CHUNK_BYTES)));
    if (!db.batch) return json({ error: 'D1 batch is unavailable', code: 'D1_BATCH_REQUIRED' }, 503);
    const evidenceId = crypto.randomUUID();
    const uploadedAt = new Date().toISOString();
    const statements = [
      db.prepare('INSERT INTO preview_case_evidence (id,organization_id,case_id,category,original_name,mime_type,byte_size,sha256,chunk_count,storage_provider,uploaded_by_id,uploaded_by_name,uploaded_at,idempotency_key,request_fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(evidenceId, PREVIEW_ORGANIZATION_ID, caseId, category, file.name, validated.mimeType, file.size, validated.sha256, chunks.length, 'D1_TEMPORARY', user.id, user.displayName, uploadedAt, idempotencyKey, fingerprint),
      ...chunks.map((chunk, index) => db.prepare('INSERT INTO preview_case_evidence_chunks (evidence_id,chunk_index,byte_size,payload) VALUES (?,?,?,?)').bind(evidenceId, index, chunk.byteLength, chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength))),
      db.prepare('INSERT INTO preview_case_activities (id,case_id,actor_id,event_type,title,description,created_at) VALUES (?,?,?,?,?,?,?)')
        .bind(crypto.randomUUID(), caseId, user.id, 'EVIDENCE_UPLOADED', `${category === 'TAKEOFF_SOURCE' ? '산출자료' : '내역자료'} 업로드`, file.name, uploadedAt)
    ];
    await db.batch(statements);
    return json({ file: caseEvidenceProjection({ id: evidenceId, category, originalName: file.name, mimeType: validated.mimeType, byteSize: file.size, sha256: validated.sha256, chunkCount: chunks.length, storageProvider: 'D1_TEMPORARY', uploadedBy: user.displayName, uploadedAt }), replay: false, phase: 'CF15_CASE_EVIDENCE_LIBRARY' }, 201);
  } catch (reason) {
    return reason instanceof GoogleDriveError ? json({ error: reason.message, code: reason.code }, reason.status) : json({ error: 'Evidence upload failed safely', code: 'EVIDENCE_UPLOAD_FAILED' }, 500);
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

    if (url.pathname === '/api/admin/users') {
      return handlePreviewAdminUsers(request, env);
    }

    if (url.pathname === '/api/admin/report-prompts' || url.pathname.startsWith('/api/admin/report-prompts/')) {
      return handlePreviewPromptAdmin(request, env, url);
    }

    if (url.pathname === '/api/litigation-records' || url.pathname.startsWith('/api/litigation-records/')) {
      return handlePreviewLitigation(request, env, url);
    }

    if (url.pathname === '/api/proposal-workflow' || url.pathname.startsWith('/api/proposal-workflow/')) {
      return handlePreviewProposalWorkflow(request, env, url);
    }

    if (/^\/api\/cases\/(?:[0-9a-f-]{36}\/evidence|evidence\/[0-9a-f-]{36}\/download)$/iu.test(url.pathname)) {
      return handleCaseEvidence(request, env, url);
    }

    if (url.pathname === '/api/cases' || url.pathname.startsWith('/api/cases/')) {
      return handlePreviewCases(request, env, url);
    }

    if (url.pathname === '/api/report-drafts') {
      return handlePreviewReportDraft(request, env, url);
    }

    if (url.pathname === '/api/report-authoring/config' || url.pathname === '/api/report-authoring/generate' || url.pathname === '/api/report-authoring/outline') {
      return handlePreviewReportAuthoring(request, env, url);
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
