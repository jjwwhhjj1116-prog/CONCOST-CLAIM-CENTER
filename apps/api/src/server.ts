import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  createPrismaClient, getDatabaseUrl, hashToken, verifyPassword,
  type Prisma, type PrismaClient, type User
} from '@claim-studio/database';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://localhost:4173'
];
const FIXED_ROLES = new Set(['ceo', 'director', 'pm', 'staff', 'reviewer', 'admin']);
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

const ALLOWED_CLAIM_TYPES = new Set(['TYPE-01', 'TYPE-02', 'TYPE-03', 'TYPE-04', 'TYPE-05', 'TYPE-06']);
const ALLOWED_SCHEDULE_TYPES = new Set(['COURT', 'CLIENT', 'INTERNAL']);
const CASE_EDITOR_ROLES = new Set(['ceo', 'director', 'pm', 'admin']);
const CASE_DELETE_ROLES = new Set(['ceo', 'director', 'admin']);

const ALLOWED_DOC_SOURCES = new Set(['RECEIVED', 'AUTHORED', 'SUBMITTED']);
const ALLOWED_DOC_CATEGORIES = new Set(['PROPOSAL', 'EVIDENCE', 'CONTRACT', 'REPORT', 'MEETING', 'ETC']);
const FORBIDDEN_FILE_EXTENSIONS = new Set(['.exe', '.bat', '.sh', '.js', '.vbs', '.php', '.py', '.cmd', '.ps1', '.jar', '.scr', '.msi']);
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const MAX_JSON_BODY_BYTES = Math.ceil(UPLOAD_MAX_BYTES * 4 / 3) + 1024 * 1024;
const DEFAULT_UPLOAD_DIR = path.resolve(__dirname, '../../database/.data/uploads');
const FILE_POLICIES: Record<string, readonly string[]> = {
  '.pdf': ['application/pdf'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.txt': ['text/plain'],
  '.hwp': ['application/x-hwp', 'application/haansofthwp']
};

export const CASE_STATUSES = [
  'INQUIRY', 'PROPOSAL', 'ESTIMATE', 'CONTRACT', 'MATERIAL_RECEIVED', 'ANALYSIS',
  'REPORT_DRAFTING', 'SUBMITTED', 'LITIGATION', 'JUDGEMENT', 'SUCCESS_FEE', 'CLOSED'
] as const;

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  INQUIRY: ['PROPOSAL'],
  PROPOSAL: ['ESTIMATE'],
  ESTIMATE: ['CONTRACT'],
  CONTRACT: ['MATERIAL_RECEIVED'],
  MATERIAL_RECEIVED: ['ANALYSIS'],
  ANALYSIS: ['REPORT_DRAFTING'],
  REPORT_DRAFTING: ['SUBMITTED'],
  SUBMITTED: ['LITIGATION'],
  LITIGATION: ['JUDGEMENT'],
  JUDGEMENT: ['SUCCESS_FEE'],
  SUCCESS_FEE: ['CLOSED'],
  CLOSED: []
};

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

interface SessionContext {
  user: Pick<User, 'id' | 'email' | 'name' | 'organizationId'>;
  roles: string[];
  tokenHash: string;
}

export interface ApiServerOptions {
  databaseUrl?: string;
  allowedOrigins?: string[];
  secureCookies?: boolean;
  uploadDir?: string;
}

export interface ManagedApiServer extends http.Server {
  waitForDatabaseClose(): Promise<void>;
}

function ensureUploadDir(uploadDir: string): void {
  fs.mkdirSync(uploadDir, { recursive: true });
}

function sanitizeDisplayName(rawName: string): string {
  if (!rawName) return 'unnamed_file';
  let clean = rawName.replace(/[\0\r\n]/g, '').replace(/[\/\\]/g, '_').replace(/\.\.+/g, '.');
  clean = path.basename(clean);
  clean = clean.replace(/[^a-zA-Z0-9가-힣._-]/g, '_');
  return clean || 'unnamed_file';
}

function validateOriginalFilename(filename: string): string {
  if (!filename || filename.includes('\0') || filename.includes('/') || filename.includes('\\') || filename.includes('..') || path.basename(filename) !== filename) {
    throw new HttpError(400, 'Unsafe file name');
  }
  const clean = sanitizeDisplayName(filename);
  const segments = clean.toLowerCase().split('.');
  if (segments.length < 2 || segments.slice(1, -1).some((segment) => FORBIDDEN_FILE_EXTENSIONS.has(`.${segment}`))) {
    throw new HttpError(400, 'Double extension or executable disguise is forbidden');
  }
  return clean;
}

function decodeStrictBase64(value: string): Buffer {
  const compact = value.replace(/\s/g, '');
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) throw new HttpError(400, 'Invalid base64 file content');
  const decoded = Buffer.from(compact, 'base64');
  if (decoded.toString('base64') !== compact) throw new HttpError(400, 'Invalid base64 file content');
  return decoded;
}

export function validateFileSecurity(filename: string, mimeType: string, buffer: Buffer): { extension: string; cleanFilename: string; mimeType: string } {
  const cleanFilename = validateOriginalFilename(filename);
  if (buffer.length === 0) throw new HttpError(400, 'Empty files are not allowed');
  if (buffer.length > UPLOAD_MAX_BYTES) {
    throw new HttpError(400, 'File size exceeds maximum 10MB limit');
  }

  const ext = path.extname(cleanFilename).toLowerCase();
  if (FORBIDDEN_FILE_EXTENSIONS.has(ext)) {
    throw new HttpError(400, `Forbidden executable file extension: ${ext}`);
  }
  const normalizedMime = mimeType.split(';', 1)[0].trim().toLowerCase();
  const allowedMimes = FILE_POLICIES[ext];
  if (!allowedMimes) {
    throw new HttpError(400, `Unsupported file extension: ${ext}`);
  }
  if (!allowedMimes.includes(normalizedMime)) throw new HttpError(400, 'MIME type does not match the file extension');

  // Magic Byte Check
  if (ext === '.pdf') {
    if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new HttpError(400, 'Invalid PDF magic bytes');
    }
  } else if (ext === '.png') {
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(pngMagic)) {
      throw new HttpError(400, 'Invalid PNG magic bytes');
    }
  } else if (ext === '.jpg' || ext === '.jpeg') {
    const jpgMagic = Buffer.from([0xff, 0xd8, 0xff]);
    if (buffer.length < 3 || !buffer.subarray(0, 3).equals(jpgMagic)) {
      throw new HttpError(400, 'Invalid JPEG magic bytes');
    }
  } else if (['.docx', '.xlsx', '.pptx'].includes(ext)) {
    const zipMagic = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    if (buffer.length < 4 || !buffer.subarray(0, 4).equals(zipMagic)) {
      throw new HttpError(400, 'Invalid Office OpenXML magic bytes');
    }
    const marker = ext === '.docx' ? 'word/' : ext === '.xlsx' ? 'xl/' : 'ppt/';
    const archiveHeader = buffer.subarray(0, Math.min(buffer.length, 1_000_000)).toString('latin1');
    if (!archiveHeader.includes('[Content_Types].xml') || !archiveHeader.includes(marker)) throw new HttpError(400, 'Office archive content does not match its extension');
  } else if (ext === '.hwp') {
    const oleMagic = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    if (buffer.length < oleMagic.length || !buffer.subarray(0, oleMagic.length).equals(oleMagic)) throw new HttpError(400, 'Invalid HWP magic bytes');
  } else if (ext === '.txt') {
    if (buffer.includes(0) || buffer.toString('utf8').includes('\uFFFD')) throw new HttpError(400, 'Text upload must be valid UTF-8 without NUL bytes');
  }

  return { extension: ext, cleanFilename, mimeType: normalizedMime };
}

function safeStoragePath(uploadDir: string, storageKey: string): string {
  if (!/^storage-[0-9a-f-]+\.[a-z0-9]+$/i.test(storageKey)) throw new HttpError(409, 'Stored file key is invalid');
  const resolvedRoot = path.resolve(uploadDir);
  const resolved = path.resolve(resolvedRoot, storageKey);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new HttpError(409, 'Stored file path escaped the upload root');
  return resolved;
}

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const entry of (req.headers.cookie ?? '').split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 1) continue;
    cookies[entry.slice(0, separator).trim()] = decodeURIComponent(entry.slice(separator + 1).trim());
  }
  return cookies;
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_JSON_BODY_BYTES) throw new HttpError(413, 'Request body too large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function auditData(
  context: SessionContext | null,
  action: string,
  targetEntity: string,
  targetId: string,
  metadata: Record<string, unknown>
): Prisma.AuditLogCreateInput {
  return {
    id: `AUD-${crypto.randomUUID()}`,
    action,
    targetEntity,
    targetId,
    metadataJson: JSON.stringify(metadata),
    ...(context ? { organization: { connect: { id: context.user.organizationId } }, user: { connect: { id: context.user.id } } } : {})
  };
}

async function authenticate(db: PrismaClient, req: http.IncomingMessage, cookies: Record<string, string>): Promise<SessionContext | null> {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const rawToken = cookies.session_token || bearer;
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const session = await db.session.findUnique({
    where: { tokenHash },
    include: { user: { include: { roles: true } } }
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.isActive) return null;
  return {
    tokenHash,
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      organizationId: session.user.organizationId
    },
    roles: session.user.roles.map((entry) => entry.roleId)
  };
}

async function canAccessCase(db: PrismaClient, context: SessionContext, caseId: string): Promise<boolean> {
  if (context.roles.some((role) => ['admin', 'ceo', 'director'].includes(role))) return true;
  return Boolean(await db.caseAssignment.findUnique({ where: { caseId_userId: { caseId, userId: context.user.id } } }));
}

function requireAnyRole(context: SessionContext, roles: Set<string>, message: string): void {
  if (!context.roles.some((role) => roles.has(role))) throw new HttpError(403, message);
}

export function getKstDateString(date: Date): string {
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstDate = new Date(date.getTime() + kstOffsetMs);
  return kstDate.toISOString().slice(0, 10).replace(/-/g, '');
}

export function calculateDDay(targetDate: Date, nowDate = new Date()): { dDayStr: string; isOverdue: boolean; isToday: boolean; diffDays: number } {
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const targetKstStr = new Date(targetDate.getTime() + kstOffsetMs).toISOString().slice(0, 10);
  const todayKstStr = new Date(nowDate.getTime() + kstOffsetMs).toISOString().slice(0, 10);

  const targetUtcMidnight = new Date(`${targetKstStr}T00:00:00.000Z`).getTime();
  const todayUtcMidnight = new Date(`${todayKstStr}T00:00:00.000Z`).getTime();

  const diffDays = Math.round((targetUtcMidnight - todayUtcMidnight) / 86_400_000);

  if (diffDays === 0) {
    return { dDayStr: 'D-0', isOverdue: false, isToday: true, diffDays: 0 };
  } else if (diffDays < 0) {
    return { dDayStr: `D+${Math.abs(diffDays)}`, isOverdue: true, isToday: false, diffDays };
  } else {
    return { dDayStr: `D-${diffDays}`, isOverdue: false, isToday: false, diffDays };
  }
}

export function createApiServer(options: ApiServerOptions = {}): ManagedApiServer {
  const db = createPrismaClient(options.databaseUrl ?? getDatabaseUrl());
  const allowedOrigins = new Set(options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);
  const secureCookie = options.secureCookies ?? process.env.NODE_ENV === 'production';
  const uploadDir = path.resolve(options.uploadDir ?? DEFAULT_UPLOAD_DIR);
  ensureUploadDir(uploadDir);

  const server = http.createServer((req, res) => {
    void (async () => {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) throw new HttpError(403, 'Origin is not allowed');
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      }
      if (req.method === 'OPTIONS') {
        sendJson(res, 204, {});
        return;
      }

      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = url.pathname;
      const cookies = parseCookies(req);
      const requestAudit = (
        actor: SessionContext | null, action: string, targetEntity: string, targetId: string, metadata: Record<string, unknown>
      ): Prisma.AuditLogCreateInput => auditData(actor, action, targetEntity, targetId, {
        ...metadata,
        ip: req.socket.remoteAddress ?? null,
        userAgent: req.headers['user-agent'] ?? null
      });

      if (pathname === '/health' && req.method === 'GET') {
        sendJson(res, 200, { status: 'ok' });
        return;
      }

      if (pathname === '/auth/login' && req.method === 'POST') {
        const body = await readJson(req);
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        const user = email ? await db.user.findUnique({ where: { email } }) : null;
        if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
          await db.auditLog.create({ data: requestAudit(null, 'LOGIN_FAILED', 'User', email || 'UNKNOWN', { reason: 'invalid_credentials' }) });
          throw new HttpError(401, 'Invalid email or password');
        }

        const rawToken = crypto.randomBytes(32).toString('base64url');
        const csrfToken = crypto.randomBytes(24).toString('base64url');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await db.$transaction(async (tx) => {
          await tx.session.create({
            data: { id: `SESS-${crypto.randomUUID()}`, userId: user.id, tokenHash: hashToken(rawToken), expiresAt }
          });
          const context: SessionContext = {
            user: { id: user.id, email: user.email, name: user.name, organizationId: user.organizationId }, roles: [], tokenHash: hashToken(rawToken)
          };
          await tx.auditLog.create({ data: requestAudit(context, 'LOGIN_SUCCESS', 'User', user.id, { email: user.email }) });
        });

        const secure = secureCookie ? '; Secure' : '';
        res.setHeader('Set-Cookie', [
          `session_token=${rawToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secure}`,
          `csrf_token=${csrfToken}; Path=/; SameSite=Strict; Max-Age=86400${secure}`
        ]);
        sendJson(res, 200, { userId: user.id, csrfToken, expiresAt: expiresAt.toISOString() });
        return;
      }

      const context = await authenticate(db, req, cookies);
      if (!context) throw new HttpError(401, 'Authentication required');

      if (MUTATING_METHODS.has(req.method ?? '') && cookies.session_token) {
        if (!origin || !allowedOrigins.has(origin)) throw new HttpError(403, 'A trusted Origin is required');
        const csrfHeader = req.headers['x-csrf-token'];
        const cookieCsrf = Buffer.from(cookies.csrf_token ?? '');
        const headerCsrf = Buffer.from(typeof csrfHeader === 'string' ? csrfHeader : '');
        if (!cookies.csrf_token || cookieCsrf.length !== headerCsrf.length || !crypto.timingSafeEqual(cookieCsrf, headerCsrf)) {
          throw new HttpError(403, 'CSRF validation failed');
        }
      }

      if (pathname === '/auth/logout' && req.method === 'POST') {
        await db.$transaction(async (tx) => {
          await tx.session.updateMany({ where: { tokenHash: context.tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
          await tx.auditLog.create({ data: requestAudit(context, 'LOGOUT', 'User', context.user.id, {}) });
        });
        res.setHeader('Set-Cookie', [
          'session_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
          'csrf_token=; Path=/; SameSite=Strict; Max-Age=0'
        ]);
        sendJson(res, 200, { message: 'Logged out' });
        return;
      }

      if (pathname === '/auth/session' && req.method === 'GET') {
        sendJson(res, 200, { ...context.user, roles: context.roles });
        return;
      }

      // --- P05 Dashboard KPI Endpoint ---
      if (pathname === '/api/dashboard/kpi' && req.method === 'GET') {
        const isAdminOrExec = context.roles.some((role) => ['admin', 'ceo', 'director'].includes(role));
        const orgId = context.user.organizationId;
        const now = new Date();

        const caseWhere: Prisma.CaseItemWhereInput = {
          organizationId: orgId,
          deletedAt: null,
          ...(!isAdminOrExec ? { assignments: { some: { userId: context.user.id } } } : {})
        };

        const totalCases = await db.caseItem.count({ where: caseWhere });
        const inProgressCount = await db.caseItem.count({
          where: { ...caseWhere, status: { in: CASE_STATUSES.filter((status) => !['INQUIRY', 'CLOSED'].includes(status)) } }
        });
        const reviewingDocsCount = await db.reportSection.count({
          where: {
            deletedAt: null,
            status: { in: ['review', 'review_pending', 'reviewer_review'] },
            report: { deletedAt: null, case: caseWhere }
          }
        });

        const schedules = await db.schedule.findMany({
          where: { case: caseWhere }
        });

        let todayTasksCount = 0;
        let delayedCount = 0;

        for (const s of schedules) {
          const dDayInfo = calculateDDay(s.date, now);
          if (dDayInfo.isToday) {
            todayTasksCount++;
          } else if (dDayInfo.isOverdue) {
            delayedCount++;
          }
        }

        sendJson(res, 200, {
          totalCases,
          inProgressCount,
          reviewingDocsCount,
          todayTasksCount,
          delayedCount
        });
        return;
      }

      // --- P05 Cases List & Creation Endpoint ---
      if (pathname === '/api/cases' && req.method === 'GET') {
        const q = url.searchParams.get('q')?.trim() ?? '';
        const claimType = url.searchParams.get('claimType')?.trim();
        const status = url.searchParams.get('status')?.trim();
        const requestedPage = Number(url.searchParams.get('page') || 1);
        const requestedLimit = Number(url.searchParams.get('limit') || 50);
        const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
        const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(100, requestedLimit) : 50;

        if (claimType && !ALLOWED_CLAIM_TYPES.has(claimType)) throw new HttpError(400, 'Invalid claimType filter');
        if (status && !CASE_STATUSES.includes(status as (typeof CASE_STATUSES)[number])) throw new HttpError(400, 'Invalid status filter');

        const isAdminOrExec = context.roles.some((role) => ['admin', 'ceo', 'director'].includes(role));
        const where: Prisma.CaseItemWhereInput = {
          organizationId: context.user.organizationId,
          deletedAt: null,
          ...(!isAdminOrExec ? { assignments: { some: { userId: context.user.id } } } : {}),
          ...(claimType ? { claimType } : {}),
          ...(status ? { status } : {}),
          ...(q
            ? {
                OR: [
                  { title: { contains: q } },
                  { caseNumber: { contains: q } },
                  { parties: { some: { name: { contains: q } } } }
                ]
              }
            : {})
        };

        const [cases, total] = await Promise.all([
          db.caseItem.findMany({
            where,
            include: {
              assignments: { include: { user: { select: { id: true, name: true, email: true } } } },
              category: true,
              parties: true,
              schedules: true,
              statusHistories: { orderBy: { createdAt: 'desc' }, take: 1 }
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit
          }),
          db.caseItem.count({ where })
        ]);

        sendJson(res, 200, { cases, total, page, limit });
        return;
      }

      if (pathname === '/api/cases' && req.method === 'POST') {
        requireAnyRole(context, CASE_EDITOR_ROLES, 'Case creation forbidden');
        const body = await readJson(req);
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const claimType = typeof body.claimType === 'string' ? body.claimType.trim() : '';
        const description = typeof body.description === 'string' ? body.description.trim() : null;
        const assignedUserId = typeof body.assignedUserId === 'string' ? body.assignedUserId : context.user.id;
        const category = body.category && typeof body.category === 'object' && !Array.isArray(body.category)
          ? body.category as Record<string, unknown>
          : {};
        const major = typeof category.major === 'string' ? category.major.trim() : '';
        const middle = typeof category.middle === 'string' ? category.middle.trim() : '';
        const minor = typeof category.minor === 'string' ? category.minor.trim() : '';

        if (!title) throw new HttpError(400, 'Title is required');
        if (title.length > 500) throw new HttpError(400, 'Title must be 500 characters or fewer');
        if (!ALLOWED_CLAIM_TYPES.has(claimType)) throw new HttpError(400, 'Invalid claimType. Must be TYPE-01 to TYPE-06');
        if (!major || !middle || !minor) throw new HttpError(400, 'Major, middle, and minor category values are required');

        const assignee = await db.user.findUnique({ where: { id: assignedUserId } });
        if (!assignee || !assignee.isActive || assignee.organizationId !== context.user.organizationId) {
          throw new HttpError(403, 'Assignee must be an active user in the same organization');
        }

        const caseId = `CASE-${crypto.randomUUID()}`;
        const caseNumber = `CASE-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        const createdCase = await db.$transaction(async (tx) => {
          const item = await tx.caseItem.create({
            data: {
              id: caseId,
              organizationId: context.user.organizationId,
              caseNumber,
              title,
              description,
              claimType,
              status: 'INQUIRY',
              assignedUserId,
              version: 1
            }
          });

          await tx.caseCategory.create({
            data: { id: `CAT-${crypto.randomUUID()}`, caseId, major, middle, minor }
          });

          await tx.statusHistory.create({
            data: {
              id: `STHIST-${crypto.randomUUID()}`,
              caseId,
              fromStatus: null,
              toStatus: 'INQUIRY',
              changedById: context.user.id,
              reason: '신규 사건 등록'
            }
          });

          await tx.caseAssignment.create({
            data: { caseId, userId: context.user.id }
          });
          if (assignedUserId && assignedUserId !== context.user.id) {
            await tx.caseAssignment.create({
              data: { caseId, userId: assignedUserId }
            });
          }

          await tx.auditLog.create({
            data: requestAudit(context, 'CASE_CREATED', 'CaseItem', caseId, { title, claimType, caseNumber })
          });

          return { ...item, category: { major, middle, minor } };
        });

        sendJson(res, 201, { case: createdCase });
        return;
      }

      // --- P05 Parties Endpoint ---
      const partyMatch = pathname.match(/^\/api\/cases\/([^/]+)\/parties(?:\/([^/]+))?$/);
      if (partyMatch) {
        const [, caseId, partyId] = partyMatch;
        const caseRow = await db.caseItem.findUnique({ where: { id: caseId } });
        if (!caseRow || caseRow.deletedAt) throw new HttpError(404, 'Case not found');
        if (caseRow.organizationId !== context.user.organizationId) throw new HttpError(403, 'Case access forbidden');
        if (!(await canAccessCase(db, context, caseId))) throw new HttpError(403, 'Case assignment required');

        if (req.method === 'POST') {
          requireAnyRole(context, CASE_EDITOR_ROLES, 'Party modification forbidden');
          const body = await readJson(req);
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          const role = typeof body.role === 'string' ? body.role.trim() : 'OTHER';
          const contact = typeof body.contact === 'string' ? body.contact.trim() : null;

          if (!name) throw new HttpError(400, 'Party name is required');

          const newPartyId = `PARTY-${crypto.randomUUID()}`;
          const party = await db.$transaction(async (tx) => {
            const created = await tx.party.create({
              data: { id: newPartyId, caseId, name, role, contact }
            });
            await tx.auditLog.create({
              data: requestAudit(context, 'PARTY_ADDED', 'Party', newPartyId, { caseId, name, role })
            });
            return created;
          });

          sendJson(res, 201, { party });
          return;
        }

        if (partyId && req.method === 'PATCH') {
          requireAnyRole(context, CASE_EDITOR_ROLES, 'Party modification forbidden');
          const partyRow = await db.party.findUnique({ where: { id: partyId } });
          if (!partyRow || partyRow.caseId !== caseId) throw new HttpError(404, 'Party not found');

          const body = await readJson(req);
          const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : partyRow.name;
          const role = typeof body.role === 'string' && body.role.trim() ? body.role.trim() : partyRow.role;
          const contact = typeof body.contact === 'string' ? body.contact.trim() : partyRow.contact;

          const updated = await db.$transaction(async (tx) => {
            const item = await tx.party.update({
              where: { id: partyId },
              data: { name, role, contact }
            });
            await tx.auditLog.create({
              data: requestAudit(context, 'PARTY_UPDATED', 'Party', partyId, { caseId, name, role })
            });
            return item;
          });

          sendJson(res, 200, { party: updated });
          return;
        }

        if (partyId && req.method === 'DELETE') {
          requireAnyRole(context, CASE_EDITOR_ROLES, 'Party modification forbidden');
          const partyRow = await db.party.findUnique({ where: { id: partyId } });
          if (!partyRow || partyRow.caseId !== caseId) throw new HttpError(404, 'Party not found');

          await db.$transaction(async (tx) => {
            await tx.party.delete({ where: { id: partyId } });
            await tx.auditLog.create({
              data: requestAudit(context, 'PARTY_DELETED', 'Party', partyId, { caseId })
            });
          });

          sendJson(res, 200, { message: 'Party deleted' });
          return;
        }
      }

      // --- P05 Schedules Endpoint ---
      const scheduleMatch = pathname.match(/^\/api\/cases\/([^/]+)\/schedules(?:\/([^/]+))?$/);
      if (scheduleMatch) {
        const [, caseId, scheduleId] = scheduleMatch;
        const caseRow = await db.caseItem.findUnique({ where: { id: caseId } });
        if (!caseRow || caseRow.deletedAt) throw new HttpError(404, 'Case not found');
        if (caseRow.organizationId !== context.user.organizationId) throw new HttpError(403, 'Case access forbidden');
        if (!(await canAccessCase(db, context, caseId))) throw new HttpError(403, 'Case assignment required');

        if (req.method === 'POST') {
          requireAnyRole(context, CASE_EDITOR_ROLES, 'Schedule modification forbidden');
          const body = await readJson(req);
          const title = typeof body.title === 'string' ? body.title.trim() : '';
          const type = typeof body.type === 'string' ? body.type.trim() : '';
          const dateStr = typeof body.date === 'string' ? body.date : '';
          const location = typeof body.location === 'string' ? body.location.trim() : null;
          const description = typeof body.description === 'string' ? body.description.trim() : null;

          if (!title) throw new HttpError(400, 'Schedule title is required');
          if (!ALLOWED_SCHEDULE_TYPES.has(type)) throw new HttpError(400, 'Invalid schedule type. Must be COURT, CLIENT, or INTERNAL');
          const date = new Date(dateStr);
          if (isNaN(date.getTime())) throw new HttpError(400, 'Invalid schedule date');

          const newSchedId = `SCHED-${crypto.randomUUID()}`;
          const schedule = await db.$transaction(async (tx) => {
            const created = await tx.schedule.create({
              data: { id: newSchedId, caseId, title, type, date, location, description }
            });
            await tx.auditLog.create({
              data: requestAudit(context, 'SCHEDULE_ADDED', 'Schedule', newSchedId, { caseId, title, type, date: date.toISOString() })
            });
            return created;
          });

          sendJson(res, 201, { schedule });
          return;
        }

        if (scheduleId && req.method === 'PATCH') {
          requireAnyRole(context, CASE_EDITOR_ROLES, 'Schedule modification forbidden');
          const schedRow = await db.schedule.findUnique({ where: { id: scheduleId } });
          if (!schedRow || schedRow.caseId !== caseId) throw new HttpError(404, 'Schedule not found');

          const body = await readJson(req);
          if (typeof body.type === 'string' && !ALLOWED_SCHEDULE_TYPES.has(body.type.trim())) throw new HttpError(400, 'Invalid schedule type');
          if (typeof body.date === 'string' && isNaN(new Date(body.date).getTime())) throw new HttpError(400, 'Invalid schedule date');
          const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : schedRow.title;
          const type = typeof body.type === 'string' && ALLOWED_SCHEDULE_TYPES.has(body.type.trim()) ? body.type.trim() : schedRow.type;
          const date = typeof body.date === 'string' && !isNaN(new Date(body.date).getTime()) ? new Date(body.date) : schedRow.date;
          const location = typeof body.location === 'string' ? body.location.trim() : schedRow.location;
          const description = typeof body.description === 'string' ? body.description.trim() : schedRow.description;

          const updated = await db.$transaction(async (tx) => {
            const item = await tx.schedule.update({
              where: { id: scheduleId },
              data: { title, type, date, location, description }
            });
            await tx.auditLog.create({
              data: requestAudit(context, 'SCHEDULE_UPDATED', 'Schedule', scheduleId, { caseId, title, type })
            });
            return item;
          });

          sendJson(res, 200, { schedule: updated });
          return;
        }

        if (scheduleId && req.method === 'DELETE') {
          requireAnyRole(context, CASE_EDITOR_ROLES, 'Schedule modification forbidden');
          const schedRow = await db.schedule.findUnique({ where: { id: scheduleId } });
          if (!schedRow || schedRow.caseId !== caseId) throw new HttpError(404, 'Schedule not found');

          await db.$transaction(async (tx) => {
            await tx.schedule.delete({ where: { id: scheduleId } });
            await tx.auditLog.create({
              data: requestAudit(context, 'SCHEDULE_DELETED', 'Schedule', scheduleId, { caseId })
            });
          });

          sendJson(res, 200, { message: 'Schedule deleted' });
          return;
        }
      }

      // --- P05 Case Status Transition Endpoint ---
      const statusMatch = pathname.match(/^\/api\/cases\/([^/]+)\/status$/);
      if (statusMatch && req.method === 'POST') {
        requireAnyRole(context, CASE_EDITOR_ROLES, 'Case status modification forbidden');
        const caseId = decodeURIComponent(statusMatch[1]);
        const caseRow = await db.caseItem.findUnique({ where: { id: caseId } });
        if (!caseRow || caseRow.deletedAt) throw new HttpError(404, 'Case not found');
        if (caseRow.organizationId !== context.user.organizationId) throw new HttpError(403, 'Case access forbidden');
        if (!(await canAccessCase(db, context, caseId))) throw new HttpError(403, 'Case assignment required');

        const body = await readJson(req);
        const toStatus = typeof body.toStatus === 'string' ? body.toStatus.trim() : '';
        const reason = typeof body.reason === 'string' ? body.reason.trim() : null;
        const version = typeof body.version === 'number' ? body.version : -1;

        const allowedNext = VALID_STATUS_TRANSITIONS[caseRow.status] ?? [];
        if (!allowedNext.includes(toStatus)) {
          throw new HttpError(400, `Invalid status transition from ${caseRow.status} to ${toStatus}`);
        }

        const updatedCase = await db.$transaction(async (tx) => {
          const result = await tx.caseItem.updateMany({
            where: { id: caseId, version, status: caseRow.status, deletedAt: null },
            data: { status: toStatus, version: { increment: 1 } }
          });
          if (result.count !== 1) throw new HttpError(409, 'Concurrency conflict');

          await tx.statusHistory.create({
            data: {
              id: `STHIST-${crypto.randomUUID()}`,
              caseId,
              fromStatus: caseRow.status,
              toStatus,
              changedById: context.user.id,
              reason
            }
          });

          await tx.auditLog.create({
            data: requestAudit(context, 'CASE_STATUS_TRANSITION', 'CaseItem', caseId, {
              fromStatus: caseRow.status,
              toStatus,
              reason
            })
          });

          return tx.caseItem.findUniqueOrThrow({ where: { id: caseId } });
        });

        sendJson(res, 200, { case: updatedCase });
        return;
      }

      // --- P06 Documents Endpoints ---
      const docMatch = pathname.match(/^\/api\/cases\/([^/]+)\/documents(?:\/([^/]+)(?:\/(versions|finalize)(?:\/([^/]+)\/download)?)?)?$/);
      if (docMatch) {
        const [, caseId, docId, action, versionId] = docMatch;
        const caseRow = await db.caseItem.findUnique({ where: { id: caseId } });
        if (!caseRow || caseRow.deletedAt) throw new HttpError(404, 'Case not found');
        if (caseRow.organizationId !== context.user.organizationId) throw new HttpError(403, 'Case access forbidden');
        if (!(await canAccessCase(db, context, caseId))) throw new HttpError(403, 'Case assignment required');

        // GET /api/cases/:id/documents
        if (!docId && req.method === 'GET') {
          const documents = await db.document.findMany({
            where: { caseId, deletedAt: null },
            include: {
              versions: {
                orderBy: { versionNumber: 'desc' },
                include: { uploadedBy: { select: { id: true, name: true, email: true } } }
              }
            },
            orderBy: { createdAt: 'desc' }
          });
          sendJson(res, 200, { documents });
          return;
        }

        // POST /api/cases/:id/documents (Upload new document)
        if (!docId && req.method === 'POST') {
          requireAnyRole(context, CASE_EDITOR_ROLES, 'Document upload forbidden for Staff or Reviewer');
          const body = await readJson(req);
          const title = typeof body.title === 'string' ? body.title.trim() : '';
          const source = typeof body.source === 'string' ? body.source.trim() : '';
          const category = typeof body.category === 'string' ? body.category.trim() : 'ETC';
          const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
          const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : '';
          const requestedMime = typeof body.mimeType === 'string' ? body.mimeType : '';
          const scheduleId = typeof body.scheduleId === 'string' && body.scheduleId ? body.scheduleId : null;
          const reportSectionId = typeof body.reportSectionId === 'string' && body.reportSectionId ? body.reportSectionId : null;

          if (!title || title.length > 200) throw new HttpError(400, 'Document title is required and must be at most 200 characters');
          if (!ALLOWED_DOC_SOURCES.has(source)) throw new HttpError(400, 'Invalid document source. Must be RECEIVED, AUTHORED, or SUBMITTED');
          if (!ALLOWED_DOC_CATEGORIES.has(category)) throw new HttpError(400, 'Invalid document category');
          if (!filename || !fileBase64 || !requestedMime) throw new HttpError(400, 'File filename, MIME type and content are required');
          if (scheduleId) {
            const linkedSchedule = await db.schedule.findUnique({ where: { id: scheduleId } });
            if (!linkedSchedule || linkedSchedule.caseId !== caseId) throw new HttpError(400, 'Linked schedule must belong to the same case');
          }
          if (reportSectionId) {
            const section = await db.reportSection.findUnique({ where: { id: reportSectionId }, include: { report: true } });
            if (!section || section.report.caseId !== caseId) throw new HttpError(400, 'Linked report section must belong to the same case');
          }

          const buffer = decodeStrictBase64(fileBase64);
          const { extension, cleanFilename, mimeType } = validateFileSecurity(filename, requestedMime, buffer);
          const cleanTitle = sanitizeDisplayName(title);

          // Check for duplicate filename or duplicate title in same case
          const existingDocs = await db.document.findMany({
            where: { caseId, deletedAt: null },
            include: { versions: true }
          });
          const isDuplicateFilename = existingDocs.some((d) => {
            if (d.title.toLowerCase() === title.toLowerCase()) return true;
            return d.versions.some((v) => v.originalName.toLowerCase() === cleanFilename.toLowerCase());
          });
          if (isDuplicateFilename) {
            throw new HttpError(409, 'A file with the exact same name already exists in this case');
          }

          const newDocId = `DOC-${crypto.randomUUID()}`;
          const newVersionId = `DOCVER-${crypto.randomUUID()}`;
          const storageKey = `storage-${crypto.randomUUID()}${extension}`;
          const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
          const dateStr = getKstDateString(new Date());
          const displayName = `${caseRow.caseNumber}_${category}_${cleanTitle}_${dateStr}_v01${extension}`;
          const diskPath = safeStoragePath(uploadDir, storageKey);

          fs.writeFileSync(diskPath, buffer);

          try {
            const document = await db.$transaction(async (tx) => {
              await tx.document.create({
                data: {
                  id: newDocId,
                  caseId,
                  scheduleId,
                  reportSectionId,
                  title,
                  category,
                  source,
                  currentVersionId: null,
                  finalVersionId: null,
                  version: 1
                }
              });

              await tx.documentVersion.create({
                data: {
                  id: newVersionId,
                  documentId: newDocId,
                  versionNumber: 1,
                  originalName: cleanFilename,
                  displayName,
                  storageKey,
                  fileSize: buffer.length,
                  mimeType,
                  sha256,
                  isFinal: false,
                  uploadedById: context.user.id
                }
              });

              const docItem = await tx.document.update({ where: { id: newDocId }, data: { currentVersionId: newVersionId } });

              await tx.auditLog.create({
                data: requestAudit(context, 'DOCUMENT_CREATED', 'Document', newDocId, {
                  title, source, category, versionNumber: 1, sha256, scheduleId, reportSectionId
                })
              });

              return docItem;
            });

            sendJson(res, 201, { document, versionId: newVersionId });
            return;
          } catch (err) {
            fs.rmSync(diskPath, { force: true });
            throw err;
          }
        }

        // POST /api/cases/:id/documents/:docId/versions
        if (docId && action === 'versions' && !versionId && req.method === 'POST') {
          requireAnyRole(context, CASE_EDITOR_ROLES, 'Document version upload forbidden for Staff or Reviewer');
          const docRow = await db.document.findUnique({
            where: { id: docId },
            include: { versions: { orderBy: { versionNumber: 'desc' } } }
          });
          if (!docRow || docRow.caseId !== caseId || docRow.deletedAt) throw new HttpError(404, 'Document not found');

          const body = await readJson(req);
          const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
          const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : '';
          const requestedMime = typeof body.mimeType === 'string' ? body.mimeType : '';
          const expectedVersion = typeof body.version === 'number' ? body.version : -1;

          if (!filename || !fileBase64 || !requestedMime) throw new HttpError(400, 'File filename, MIME type and content are required');

          const buffer = decodeStrictBase64(fileBase64);
          const { extension, cleanFilename, mimeType } = validateFileSecurity(filename, requestedMime, buffer);
          const cleanTitle = sanitizeDisplayName(docRow.title);

          const nextVersionNum = (docRow.versions[0]?.versionNumber ?? 0) + 1;
          const paddedVer = String(nextVersionNum).padStart(2, '0');
          const dateStr = getKstDateString(new Date());
          const displayName = `${caseRow.caseNumber}_${docRow.category ?? 'GEN'}_${cleanTitle}_${dateStr}_v${paddedVer}${extension}`;
          const newVersionId = `DOCVER-${crypto.randomUUID()}`;
          const storageKey = `storage-${crypto.randomUUID()}${extension}`;
          const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
          const diskPath = safeStoragePath(uploadDir, storageKey);

          fs.writeFileSync(diskPath, buffer);

          try {
            const version = await db.$transaction(async (tx) => {
              const createdVersion = await tx.documentVersion.create({
                data: {
                  id: newVersionId,
                  documentId: docId,
                  versionNumber: nextVersionNum,
                  originalName: cleanFilename,
                  displayName,
                  storageKey,
                  fileSize: buffer.length,
                  mimeType,
                  sha256,
                  isFinal: false,
                  uploadedById: context.user.id
                }
              });

              const changed = await tx.document.updateMany({
                where: { id: docId, version: expectedVersion, deletedAt: null },
                data: { currentVersionId: newVersionId, version: { increment: 1 }, updatedAt: new Date() }
              });
              if (changed.count !== 1) throw new HttpError(409, 'Document version conflict');

              await tx.auditLog.create({
                data: requestAudit(context, 'DOCUMENT_VERSION_CREATED', 'DocumentVersion', newVersionId, {
                  docId, versionNumber: nextVersionNum, sha256
                })
              });

              return createdVersion;
            });

            sendJson(res, 201, { version });
            return;
          } catch (err) {
            fs.rmSync(diskPath, { force: true });
            throw err;
          }
        }

        // POST /api/cases/:id/documents/:docId/finalize
        if (docId && action === 'finalize' && req.method === 'POST') {
          requireAnyRole(context, CASE_EDITOR_ROLES, 'Document finalization forbidden for Staff or Reviewer');
          const docRow = await db.document.findUnique({ where: { id: docId } });
          if (!docRow || docRow.caseId !== caseId || docRow.deletedAt) throw new HttpError(404, 'Document not found');

          const body = await readJson(req);
          const targetVersionId = typeof body.versionId === 'string' ? body.versionId : '';
          const expectedVersion = typeof body.version === 'number' ? body.version : -1;
          const targetVer = await db.documentVersion.findUnique({ where: { id: targetVersionId } });
          if (!targetVer || targetVer.documentId !== docId) throw new HttpError(404, 'Document version not found');

          await db.$transaction(async (tx) => {
            const changed = await tx.document.updateMany({
              where: { id: docId, version: expectedVersion, deletedAt: null },
              data: { version: { increment: 1 } }
            });
            if (changed.count !== 1) throw new HttpError(409, 'Document finalization conflict');
            await tx.documentVersion.updateMany({
              where: { documentId: docId },
              data: { isFinal: false }
            });
            await tx.documentVersion.update({
              where: { id: targetVersionId },
              data: { isFinal: true }
            });
            await tx.document.update({
              where: { id: docId },
              data: { finalVersionId: targetVersionId }
            });
            await tx.auditLog.create({
              data: requestAudit(context, 'DOCUMENT_FINALIZED', 'Document', docId, { versionId: targetVersionId, versionNumber: targetVer.versionNumber })
            });
          });

          sendJson(res, 200, { message: 'Document version finalized', versionId: targetVersionId });
          return;
        }

        // GET /api/cases/:id/documents/:docId/versions/:versionId/download
        if (docId && action === 'versions' && versionId && req.url?.endsWith('/download') && req.method === 'GET') {
          const versionRow = await db.documentVersion.findUnique({
            where: { id: versionId },
            include: { document: true }
          });
          if (!versionRow || versionRow.documentId !== docId || versionRow.document.caseId !== caseId || versionRow.document.deletedAt) {
            throw new HttpError(404, 'Document file not found');
          }

          const diskPath = safeStoragePath(uploadDir, versionRow.storageKey);
          if (!fs.existsSync(diskPath)) {
            throw new HttpError(404, 'File on disk not found');
          }

          const stat = fs.statSync(diskPath);
          const storedBytes = fs.readFileSync(diskPath);
          const storedSha = crypto.createHash('sha256').update(storedBytes).digest('hex');
          if (stat.size !== versionRow.fileSize || storedSha !== versionRow.sha256) throw new HttpError(409, 'Stored file integrity check failed');
          await db.auditLog.create({
            data: requestAudit(context, 'DOCUMENT_DOWNLOADED', 'DocumentVersion', versionId, { displayName: versionRow.displayName })
          });
          res.writeHead(200, {
            'Content-Type': versionRow.mimeType || 'application/octet-stream',
            'Content-Length': stat.size,
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(versionRow.displayName)}`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "sandbox"
          });
          fs.createReadStream(diskPath).pipe(res);
          return;
        }

        // DELETE /api/cases/:id/documents/:docId
        if (docId && !action && req.method === 'DELETE') {
          requireAnyRole(context, CASE_DELETE_ROLES, 'Document deletion forbidden for PM or Staff');
          const docRow = await db.document.findUnique({
            where: { id: docId },
            include: { versions: true }
          });
          if (!docRow || docRow.caseId !== caseId || docRow.deletedAt) throw new HttpError(404, 'Document not found');

          const hasFinalVersion = docRow.versions.some((v) => v.isFinal);
          if (hasFinalVersion) {
            throw new HttpError(400, 'Finalized documents cannot be deleted');
          }

          const body = await readJson(req);
          const expectedVersion = typeof body.version === 'number' ? body.version : -1;
          await db.$transaction(async (tx) => {
            const changed = await tx.document.updateMany({
              where: { id: docId, version: expectedVersion, deletedAt: null },
              data: { deletedAt: new Date(), version: { increment: 1 } }
            });
            if (changed.count !== 1) throw new HttpError(409, 'Document deletion conflict');
            await tx.auditLog.create({
              data: requestAudit(context, 'DOCUMENT_SOFT_DELETED', 'Document', docId, {})
            });
          });

          sendJson(res, 200, { message: 'Document soft deleted' });
          return;
        }
      }

      // --- P06 Meetings Endpoints ---
      const meetingMatch = pathname.match(/^\/api\/cases\/([^/]+)\/meetings(?:\/([^/]+)(?:\/(finalize|action-items))?)?$/);
      if (meetingMatch) {
        const [, caseId, meetingId, action] = meetingMatch;
        const caseRow = await db.caseItem.findUnique({ where: { id: caseId } });
        if (!caseRow || caseRow.deletedAt) throw new HttpError(404, 'Case not found');
        if (caseRow.organizationId !== context.user.organizationId) throw new HttpError(403, 'Case access forbidden');
        if (!(await canAccessCase(db, context, caseId))) throw new HttpError(403, 'Case assignment required');

        // GET /api/cases/:id/meetings
        if (!meetingId && req.method === 'GET') {
          const meetings = await db.meeting.findMany({
            where: { caseId },
            include: {
              createdBy: { select: { id: true, name: true, email: true } },
              actionItems: {
                include: {
                  assignee: { select: { id: true, name: true, email: true } },
                  schedule: true
                }
              }
            },
            orderBy: { meetingDate: 'desc' }
          });
          sendJson(res, 200, { meetings });
          return;
        }

        // POST /api/cases/:id/meetings
        if (!meetingId && req.method === 'POST') {
          requireAnyRole(context, CASE_EDITOR_ROLES, 'Meeting creation forbidden');
          const body = await readJson(req);
          const title = typeof body.title === 'string' ? body.title.trim() : '';
          const dateStr = typeof body.meetingDate === 'string' ? body.meetingDate : '';
          const location = typeof body.location === 'string' ? body.location.trim() : null;
          const attendees = typeof body.attendees === 'string' ? body.attendees.trim() : null;
          const rawText = typeof body.rawText === 'string' ? body.rawText.trim() : null;
          const rawTextSha256 = rawText ? crypto.createHash('sha256').update(rawText).digest('hex') : null;
          const summary = typeof body.summary === 'string' ? body.summary.trim() : null;
          const decisions = typeof body.decisions === 'string' ? body.decisions.trim() : null;
          const actionItemsInput = Array.isArray(body.actionItems) ? body.actionItems : [];

          if (!title) throw new HttpError(400, 'Meeting title is required');
          const meetingDate = new Date(dateStr);
          if (isNaN(meetingDate.getTime())) throw new HttpError(400, 'Invalid meeting date');

          const newMeetingId = `MEET-${crypto.randomUUID()}`;

          const createdMeeting = await db.$transaction(async (tx) => {
            await tx.meeting.create({
              data: {
                id: newMeetingId,
                caseId,
                title,
                meetingDate,
                location,
                attendees,
                rawText,
                rawTextSha256,
                summary,
                decisions,
                status: 'DRAFT',
                version: 1,
                createdById: context.user.id
              }
            });

            for (const ai of actionItemsInput) {
              if (typeof ai === 'object' && ai && typeof ai.title === 'string' && ai.title.trim()) {
                const assigneeId = typeof ai.assigneeId === 'string' ? ai.assigneeId : null;
                const scheduleId = typeof ai.scheduleId === 'string' ? ai.scheduleId : null;
                if (assigneeId) {
                  const assigneeUser = await tx.user.findUnique({ where: { id: assigneeId } });
                  if (!assigneeUser || assigneeUser.organizationId !== context.user.organizationId) {
                    throw new HttpError(403, 'Action item assignee must belong to the same organization');
                  }
                }
                if (scheduleId) {
                  const linkedSchedule = await tx.schedule.findUnique({ where: { id: scheduleId } });
                  if (!linkedSchedule || linkedSchedule.caseId !== caseId) throw new HttpError(403, 'Action item schedule must belong to the same case');
                }
                const dueDate = ai.dueDate ? new Date(String(ai.dueDate)) : null;
                if (dueDate && isNaN(dueDate.getTime())) throw new HttpError(400, 'Invalid action item due date');
                await tx.meetingActionItem.create({
                  data: {
                    id: `ACT-${crypto.randomUUID()}`,
                    meetingId: newMeetingId,
                    title: ai.title.trim(),
                    assigneeId,
                    scheduleId,
                    dueDate,
                    status: 'PENDING'
                  }
                });
              }
            }

            await tx.auditLog.create({
              data: requestAudit(context, 'MEETING_CREATED', 'Meeting', newMeetingId, { title, meetingDate: meetingDate.toISOString() })
            });

            return tx.meeting.findUniqueOrThrow({
              where: { id: newMeetingId },
              include: { actionItems: true }
            });
          });

          sendJson(res, 201, { meeting: createdMeeting });
          return;
        }

        // GET /api/cases/:id/meetings/:meetingId
        if (meetingId && !action && req.method === 'GET') {
          const meeting = await db.meeting.findUnique({
            where: { id: meetingId },
            include: {
              createdBy: { select: { id: true, name: true, email: true } },
              actionItems: {
                include: {
                  assignee: { select: { id: true, name: true, email: true } },
                  schedule: true
                }
              }
            }
          });
          if (!meeting || meeting.caseId !== caseId) throw new HttpError(404, 'Meeting not found');
          sendJson(res, 200, { meeting });
          return;
        }

        // PATCH /api/cases/:id/meetings/:meetingId
        if (meetingId && !action && req.method === 'PATCH') {
          requireAnyRole(context, CASE_EDITOR_ROLES, 'Meeting modification forbidden');
          const meetingRow = await db.meeting.findUnique({ where: { id: meetingId } });
          if (!meetingRow || meetingRow.caseId !== caseId) throw new HttpError(404, 'Meeting not found');
          if (meetingRow.status === 'FINAL') {
            throw new HttpError(400, 'Finalized meeting cannot be updated');
          }

          const body = await readJson(req);
          const version = typeof body.version === 'number' ? body.version : -1;
          const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : meetingRow.title;
          const location = typeof body.location === 'string' ? body.location.trim() : meetingRow.location;
          const attendees = typeof body.attendees === 'string' ? body.attendees.trim() : meetingRow.attendees;
          const rawText = typeof body.rawText === 'string' ? body.rawText.trim() : meetingRow.rawText;
          const summary = typeof body.summary === 'string' ? body.summary.trim() : meetingRow.summary;
          const decisions = typeof body.decisions === 'string' ? body.decisions.trim() : meetingRow.decisions;
          if (meetingRow.rawText !== null && rawText !== meetingRow.rawText) throw new HttpError(400, 'Original meeting transcript cannot be changed');
          const rawTextSha256 = rawText ? crypto.createHash('sha256').update(rawText).digest('hex') : null;

          const updated = await db.$transaction(async (tx) => {
            const result = await tx.meeting.updateMany({
              where: { id: meetingId, status: 'DRAFT', version },
              data: { title, location, attendees, rawText, rawTextSha256, summary, decisions, version: { increment: 1 } }
            });
            if (result.count !== 1) throw new HttpError(409, 'Concurrency conflict or meeting already finalized');

            await tx.auditLog.create({
              data: requestAudit(context, 'MEETING_UPDATED', 'Meeting', meetingId, { title, version: version + 1 })
            });

            return tx.meeting.findUniqueOrThrow({ where: { id: meetingId } });
          });

          sendJson(res, 200, { meeting: updated });
          return;
        }

        // POST /api/cases/:id/meetings/:meetingId/finalize
        if (meetingId && action === 'finalize' && req.method === 'POST') {
          requireAnyRole(context, CASE_EDITOR_ROLES, 'Meeting finalization forbidden');
          const meetingRow = await db.meeting.findUnique({ where: { id: meetingId } });
          if (!meetingRow || meetingRow.caseId !== caseId) throw new HttpError(404, 'Meeting not found');
          if (meetingRow.status === 'FINAL') {
            sendJson(res, 200, { meeting: meetingRow });
            return;
          }
          const body = await readJson(req);
          const expectedVersion = typeof body.version === 'number' ? body.version : -1;

          const finalized = await db.$transaction(async (tx) => {
            const changed = await tx.meeting.updateMany({
              where: { id: meetingId, status: 'DRAFT', version: expectedVersion },
              data: { status: 'FINAL', version: { increment: 1 } }
            });
            if (changed.count !== 1) throw new HttpError(409, 'Meeting finalization conflict');

            await tx.auditLog.create({
              data: requestAudit(context, 'MEETING_FINALIZED', 'Meeting', meetingId, { title: meetingRow.title })
            });

            return tx.meeting.findUniqueOrThrow({ where: { id: meetingId } });
          });

          sendJson(res, 200, { meeting: finalized });
          return;
        }

        // POST /api/cases/:id/meetings/:meetingId/action-items
        if (meetingId && action === 'action-items' && req.method === 'POST') {
          requireAnyRole(context, CASE_EDITOR_ROLES, 'Action item creation forbidden');
          const meetingRow = await db.meeting.findUnique({ where: { id: meetingId } });
          if (!meetingRow || meetingRow.caseId !== caseId) throw new HttpError(404, 'Meeting not found');
          if (meetingRow.status === 'FINAL') throw new HttpError(400, 'Finalized meeting action items cannot be changed');

          const body = await readJson(req);
          const title = typeof body.title === 'string' ? body.title.trim() : '';
          const assigneeId = typeof body.assigneeId === 'string' ? body.assigneeId : null;
          const scheduleId = typeof body.scheduleId === 'string' ? body.scheduleId : null;
          const dueDateStr = typeof body.dueDate === 'string' ? body.dueDate : null;

          if (!title) throw new HttpError(400, 'Action item title is required');
          const dueDate = dueDateStr ? new Date(dueDateStr) : null;
          if (dueDate && isNaN(dueDate.getTime())) throw new HttpError(400, 'Invalid action item due date');

          const actionItem = await db.$transaction(async (tx) => {
            if (assigneeId) {
              const assigneeUser = await tx.user.findUnique({ where: { id: assigneeId } });
              if (!assigneeUser || assigneeUser.organizationId !== context.user.organizationId) {
                throw new HttpError(403, 'Action item assignee must belong to the same organization');
              }
            }
            if (scheduleId) {
              const schedRow = await tx.schedule.findUnique({ where: { id: scheduleId } });
              if (!schedRow || schedRow.caseId !== caseId) {
                throw new HttpError(403, 'Schedule must belong to the same case');
              }
            }

            const created = await tx.meetingActionItem.create({
              data: {
                id: `ACT-${crypto.randomUUID()}`,
                meetingId,
                title,
                assigneeId,
                scheduleId,
                dueDate,
                status: 'PENDING'
              }
            });

            await tx.auditLog.create({
              data: requestAudit(context, 'ACTION_ITEM_CREATED', 'MeetingActionItem', created.id, { meetingId, title })
            });

            return created;
          });

          sendJson(res, 201, { actionItem });
          return;
        }
      }

      // --- P05 Case Detail Endpoint ---
      const caseMatch = pathname.match(/^\/api\/cases\/([^/]+)$/);
      if (caseMatch) {
        const caseId = decodeURIComponent(caseMatch[1]);
        const caseRow = await db.caseItem.findUnique({
          where: { id: caseId },
          include: {
            assignments: { include: { user: { select: { id: true, name: true, email: true } } } },
            category: true,
            parties: true,
            schedules: { orderBy: { date: 'asc' } },
            statusHistories: { orderBy: { createdAt: 'desc' }, include: { changedBy: { select: { id: true, name: true } } } }
          }
        });
        if (!caseRow || caseRow.deletedAt) throw new HttpError(404, 'Case not found');
        if (caseRow.organizationId !== context.user.organizationId) {
          await db.auditLog.create({ data: requestAudit(context, 'IDOR_ATTEMPT_BLOCKED', 'CaseItem', caseId, { boundary: 'organization' }) });
          throw new HttpError(403, 'Case access forbidden');
        }
        if (!(await canAccessCase(db, context, caseId))) throw new HttpError(403, 'Case assignment required');

        if (req.method === 'GET') {
          const schedulesWithDDay = caseRow.schedules.map((s) => ({
            ...s,
            dDayInfo: calculateDDay(s.date)
          }));
          const activityTimeline = caseRow.statusHistories.map((history) => ({
            id: history.id,
            type: 'STATUS_CHANGE',
            title: `${history.fromStatus ?? 'START'} → ${history.toStatus}`,
            description: history.reason,
            actor: history.changedBy,
            createdAt: history.createdAt
          }));
          sendJson(res, 200, { case: { ...caseRow, schedules: schedulesWithDDay, activityTimeline } });
          return;
        }
        if (req.method === 'PATCH') {
          requireAnyRole(context, CASE_EDITOR_ROLES, 'Case modification forbidden');
          const body = await readJson(req);
          const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : caseRow.title;
          const description = typeof body.description === 'string' ? body.description.trim() : caseRow.description;
          const version = typeof body.version === 'number' ? body.version : -1;
          const category = body.category && typeof body.category === 'object' && !Array.isArray(body.category)
            ? body.category as Record<string, unknown>
            : null;

          await db.$transaction(async (tx) => {
            const result = await tx.caseItem.updateMany({
              where: { id: caseId, organizationId: context.user.organizationId, deletedAt: null, version },
              data: { title, description, version: { increment: 1 } }
            });
            if (result.count !== 1) throw new HttpError(409, 'Concurrency conflict');
            if (category) {
              const major = typeof category.major === 'string' ? category.major.trim() : '';
              const middle = typeof category.middle === 'string' ? category.middle.trim() : '';
              const minor = typeof category.minor === 'string' ? category.minor.trim() : '';
              if (!major || !middle || !minor) throw new HttpError(400, 'Major, middle, and minor category values are required');
              await tx.caseCategory.upsert({
                where: { caseId },
                update: { major, middle, minor },
                create: { id: `CAT-${crypto.randomUUID()}`, caseId, major, middle, minor }
              });
            }
            await tx.auditLog.create({ data: requestAudit(context, 'CASE_UPDATED', 'CaseItem', caseId, { fromVersion: version, toVersion: version + 1 }) });
          });
          sendJson(res, 200, { version: version + 1 });
          return;
        }
        if (req.method === 'DELETE') {
          requireAnyRole(context, CASE_DELETE_ROLES, 'Case deletion forbidden');
          const body = await readJson(req);
          const version = typeof body.version === 'number' ? body.version : -1;
          await db.$transaction(async (tx) => {
            const result = await tx.caseItem.updateMany({
              where: { id: caseId, deletedAt: null, version },
              data: { deletedAt: new Date(), version: { increment: 1 } }
            });
            if (result.count !== 1) throw new HttpError(409, 'Concurrency conflict');
            await tx.auditLog.create({ data: requestAudit(context, 'CASE_SOFT_DELETED', 'CaseItem', caseId, {}) });
          });
          sendJson(res, 200, { message: 'Case soft deleted' });
          return;
        }
      }

      const reportMatch = pathname.match(/^\/api\/reports\/([^/]+)(?:\/sections\/([^/]+)\/(body|approve)|\/(merge))$/);
      if (reportMatch) {
        const [, reportId, sectionId, sectionAction, reportAction] = reportMatch;
        const report = await db.report.findUnique({
          where: { id: reportId },
          include: { case: { include: { assignments: true } } }
        });
        if (!report || report.deletedAt || report.case.deletedAt) throw new HttpError(404, 'Report not found');
        if (report.case.organizationId !== context.user.organizationId) throw new HttpError(403, 'Report access forbidden');
        if (!(await canAccessCase(db, context, report.caseId))) throw new HttpError(403, 'Case assignment required');

        if (sectionAction === 'body' && req.method === 'PATCH') {
          if (context.roles.includes('reviewer')) {
            await db.auditLog.create({ data: requestAudit(context, 'REVIEWER_DIRECT_EDIT_BLOCKED', 'ReportSection', sectionId, {}) });
            throw new HttpError(403, 'Reviewer cannot edit report body');
          }
          const body = await readJson(req);
          const content = typeof body.content === 'string' ? body.content : '';
          const version = typeof body.version === 'number' ? body.version : -1;
          await db.$transaction(async (tx) => {
            const result = await tx.reportSection.updateMany({
              where: { id: sectionId, reportId, deletedAt: null, version },
              data: { content, version: { increment: 1 } }
            });
            if (result.count !== 1) throw new HttpError(409, 'Concurrency conflict');
            await tx.auditLog.create({ data: requestAudit(context, 'REPORT_SECTION_UPDATED', 'ReportSection', sectionId, { reportId, version }) });
          });
          sendJson(res, 200, { version: version + 1 });
          return;
        }

        if (sectionAction === 'approve' && req.method === 'POST') {
          if (!context.roles.some((role) => ['reviewer', 'pm', 'admin'].includes(role))) throw new HttpError(403, 'Approval forbidden');
          await db.$transaction(async (tx) => {
            const result = await tx.reportSection.updateMany({ where: { id: sectionId, reportId, deletedAt: null }, data: { status: 'approved' } });
            if (result.count !== 1) throw new HttpError(404, 'Section not found');
            await tx.auditLog.create({ data: requestAudit(context, 'SECTION_APPROVED', 'ReportSection', sectionId, { reportId }) });
          });
          sendJson(res, 200, { status: 'approved' });
          return;
        }

        if (reportAction === 'merge' && req.method === 'POST') {
          if (!context.roles.some((role) => ['ceo', 'director', 'pm', 'admin'].includes(role))) {
            await db.auditLog.create({ data: requestAudit(context, 'REPORT_MERGE_BLOCKED', 'Report', reportId, {}) });
            throw new HttpError(403, 'Final merge forbidden');
          }
          await db.$transaction(async (tx) => {
            await tx.report.update({ where: { id: reportId }, data: { version: { increment: 1 } } });
            await tx.auditLog.create({ data: requestAudit(context, 'REPORT_MERGED', 'Report', reportId, {}) });
          });
          sendJson(res, 200, { message: 'Report merged' });
          return;
        }
      }

      if (pathname === '/api/audit-logs' && req.method === 'GET') {
        if (!context.roles.some((role) => ['ceo', 'director', 'admin'].includes(role))) throw new HttpError(403, 'Audit access forbidden');
        const logs = await db.auditLog.findMany({
          where: { organizationId: context.user.organizationId }, orderBy: { createdAt: 'desc' }, take: 200
        });
        sendJson(res, 200, { auditLogs: logs });
        return;
      }

      if (pathname === '/api/admin/roles' && req.method === 'POST') {
        if (!context.roles.includes('admin')) throw new HttpError(403, 'Admin role required');
        const body = await readJson(req);
        const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId : '';
        const roleId = typeof body.roleId === 'string' ? body.roleId : '';
        if (!FIXED_ROLES.has(roleId)) throw new HttpError(400, 'Unknown role');
        const target = await db.user.findUnique({ where: { id: targetUserId } });
        if (!target || target.organizationId !== context.user.organizationId) throw new HttpError(403, 'Cross-organization role change forbidden');
        await db.$transaction(async (tx) => {
          await tx.userRole.upsert({
            where: { userId_roleId: { userId: targetUserId, roleId } }, update: {}, create: { userId: targetUserId, roleId }
          });
          await tx.auditLog.create({ data: requestAudit(context, 'ADMIN_ROLE_CHANGED', 'UserRole', targetUserId, { roleId }) });
        });
        sendJson(res, 200, { message: 'Role assigned' });
        return;
      }

      throw new HttpError(404, 'Endpoint not found');
    })().catch((error: unknown) => {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      console.error('API request failed', error);
      sendJson(res, 500, { error: 'Internal server error' });
    });
  }) as ManagedApiServer;

  let databaseClose = Promise.resolve();
  server.on('close', () => { databaseClose = db.$disconnect(); });
  server.waitForDatabaseClose = () => databaseClose;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3001);
  createApiServer().listen(port, '127.0.0.1', () => {
    console.log(`API server listening at http://127.0.0.1:${port}`);
  });
}
