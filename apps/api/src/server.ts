import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  createPrismaClient, getDatabaseUrl, hashToken, verifyPassword,
  type Prisma, type PrismaClient, type User
} from '@claim-studio/database';
import {
  generateDocxBuffer, generatePdfBuffer
} from '@claim-studio/document-engine';

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
const PROPOSAL_EDITOR_ROLES = new Set(['ceo', 'director', 'pm', 'admin']);
const PROPOSAL_APPROVER_ROLES = new Set(['reviewer', 'director', 'ceo', 'admin']);
const TEMPLATE_APPROVER_ROLES = new Set(['ceo', 'director']);
const TEMPLATE_ADMIN_ROLES = new Set(['admin']);

const ALLOWED_PROPOSAL_PLACEHOLDERS = new Set([
  'CASE_NUMBER', 'CASE_TITLE', 'CLAIM_TYPE', 'ASSIGNED_USER', 'CLIENT_NAME', 'CREATED_DATE',
  'BACKGROUND', 'OBJECTIVE', 'METHOD', 'EXPECTED_OUTCOME', 'EXCLUSIONS'
]);
const ALLOWED_AI_PROVIDERS = new Map([['local-fake-ai', new Set(['fake-claim-v1'])]]);

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

export function renderProposalTemplate(
  templateText: string,
  values: Record<string, string>
): { rendered: string; missing: string[] } {
  const missing: string[] = [];
  let rendered = templateText;
  const matches = templateText.match(/\{\{([A-Z0-9_]+)\}\}/g) ?? [];
  for (const key of new Set(matches.map((match) => match.slice(2, -2)))) {
    const value = values[key]?.trim();
    if (ALLOWED_PROPOSAL_PLACEHOLDERS.has(key) && value) {
      rendered = rendered.replaceAll(`{{${key}}}`, value);
    } else {
      missing.push(key);
      rendered = rendered.replaceAll(`{{${key}}}`, `누락: ${key}`);
    }
  }
  return { rendered, missing };
}

function proposalInputHash(value: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parseStringArray(value: string | null, label: string): string[] {
  if (value === null) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) throw new Error('invalid');
    return parsed;
  } catch {
    throw new HttpError(409, `${label} is corrupt`);
  }
}

async function verifyProposalSources(
  db: PrismaClient,
  uploadDir: string,
  caseId: string,
  sourceIds: string[]
): Promise<void> {
  if (new Set(sourceIds).size !== sourceIds.length) throw new HttpError(400, 'Duplicate source document versions are forbidden');
  if (sourceIds.length === 0) return;
  const versions = await db.documentVersion.findMany({
    where: { id: { in: sourceIds }, document: { caseId, deletedAt: null } },
    include: { document: true }
  });
  if (versions.length !== sourceIds.length) throw new HttpError(403, 'Source document version must belong to the target case');
  for (const version of versions) {
    const diskPath = path.join(uploadDir, version.storageKey);
    if (!fs.existsSync(diskPath)) throw new HttpError(409, 'Source document file is missing on disk');
    const digest = crypto.createHash('sha256').update(fs.readFileSync(diskPath)).digest('hex');
    if (digest !== version.sha256) throw new HttpError(409, 'Source document file has been tampered with');
  }
}

export function validateFileSecurity(filename: string, mimeType: string, buffer: Buffer): { extension: string } {
  if (buffer.length > UPLOAD_MAX_BYTES) throw new HttpError(400, 'File size exceeds maximum 10MB limit');
  if (!filename || filename.includes('\0') || filename.includes('\\') || filename.includes('/')) throw new HttpError(400, 'Invalid filename or path semantics');
  if (filename.split('.').length > 2) throw new HttpError(400, 'Double file extensions are strictly forbidden');

  const ext = path.extname(filename).toLowerCase();
  if (FORBIDDEN_FILE_EXTENSIONS.has(ext)) throw new HttpError(400, `Forbidden executable file extension: ${ext}`);

  const allowedMimes = FILE_POLICIES[ext];
  if (!allowedMimes || !allowedMimes.includes(mimeType.toLowerCase())) {
    throw new HttpError(400, `MIME type ${mimeType} does not match allowed policy for ${ext}`);
  }

  if (ext === '.pdf' && (buffer.length < 5 || buffer.subarray(0, 5).toString('utf8') !== '%PDF-')) {
    throw new HttpError(400, 'File content does not match PDF magic header');
  }
  if (ext === '.png' && (buffer.length < 8 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')) {
    throw new HttpError(400, 'File content does not match PNG magic header');
  }
  if ((ext === '.jpg' || ext === '.jpeg') && (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff)) {
    throw new HttpError(400, 'File content does not match JPEG magic header');
  }
  if (['.docx', '.xlsx', '.pptx'].includes(ext) && (buffer.length < 4 || buffer.subarray(0, 4).readUInt32LE(0) !== 0x04034b50)) {
    throw new HttpError(400, 'File content does not match Zip magic header');
  }
  if (ext === '.hwp' && (buffer.length < 8 || buffer.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1')) {
    throw new HttpError(400, 'File content does not match HWP OLE magic header');
  }

  return { extension: ext };
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
  const uploadDir = options.uploadDir ?? DEFAULT_UPLOAD_DIR;
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

      // --- P08 Block Definitions & Reference Inventory Endpoints ---
      if (pathname === '/api/block-definitions' && req.method === 'GET') {
        const blocks = await db.blockDefinition.findMany({ orderBy: { code: 'asc' } });
        sendJson(res, 200, { blocks });
        return;
      }

      if (pathname === '/api/reference-inventories' && req.method === 'GET') {
        const inventory = await db.referenceInventory.findMany({ orderBy: { fileId: 'asc' } });
        sendJson(res, 200, { inventory });
        return;
      }

      // --- P08 Report Templates Endpoints ---
      if (pathname === '/api/report-templates' && req.method === 'GET') {
        const claimType = url.searchParams.get('claimType')?.trim();
        if (claimType && !ALLOWED_CLAIM_TYPES.has(claimType)) {
          throw new HttpError(400, 'Invalid claimType filter');
        }

        // TYPE-05 availability는 TEMPLATE_NOT_AVAILABLE로 빈 목록 반환!
        if (claimType === 'TYPE-05') {
          sendJson(res, 200, { templates: [], availability: 'TEMPLATE_NOT_AVAILABLE', claimType: 'TYPE-05' });
          return;
        }

        const templates = await db.reportTemplate.findMany({
          where: claimType
            ? { versions: { some: { typeMappings: { some: { typeId: claimType } } } } }
            : {},
          include: {
            versions: {
              orderBy: { versionNumber: 'desc' },
              include: {
                typeMappings: true,
                createdBy: { select: { id: true, name: true, email: true } },
                approvedBy: { select: { id: true, name: true, email: true } }
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        });

        // 6개 클레임 유형 각각에 대해 ACTIVE 템플릿 버전 존재 여부 계산
        const activeCounts: Record<string, number> = {};
        for (const type of ['TYPE-01', 'TYPE-02', 'TYPE-03', 'TYPE-04', 'TYPE-05', 'TYPE-06']) {
          if (type === 'TYPE-05') {
            activeCounts[type] = 0;
          } else {
            activeCounts[type] = await db.templateTypeMapping.count({
              where: { typeId: type, kind: 'PRIMARY', templateVersion: { status: 'ACTIVE' } }
            });
          }
        }

        const availability = claimType ? (activeCounts[claimType] > 0 ? 'AVAILABLE' : 'TEMPLATE_NOT_AVAILABLE') : 'MIXED';

        sendJson(res, 200, { templates, activeCounts, availability });
        return;
      }

      if (pathname === '/api/report-templates' && req.method === 'POST') {
        requireAnyRole(context, TEMPLATE_ADMIN_ROLES, 'Template creation requires Admin role');
        const body = await readJson(req);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
        const description = typeof body.description === 'string' ? body.description.trim() : null;
        const companyForm = typeof body.companyForm === 'string' ? body.companyForm.trim() : '';
        const primaryType = typeof body.primaryType === 'string' ? body.primaryType.trim() : '';
        const secondaryTypes = Array.isArray(body.secondaryTypes)
          ? body.secondaryTypes.filter((t): t is string => typeof t === 'string')
          : [];
        const tocStructure = Array.isArray(body.tocStructure) ? body.tocStructure : [];
        const requiredSections = Array.isArray(body.requiredSections) ? body.requiredSections : [];
        const requiredEvidenceRules = Array.isArray(body.requiredEvidenceRules) ? body.requiredEvidenceRules : [];
        const blockSchemas = typeof body.blockSchemas === 'object' && body.blockSchemas !== null ? body.blockSchemas : {};
        const referenceFileIds = Array.isArray(body.referenceFileIds)
          ? body.referenceFileIds.filter((f): f is string => typeof f === 'string')
          : [];

        if (!name || !code || !companyForm || !primaryType) {
          throw new HttpError(400, 'Name, code, companyForm, and primaryType are required');
        }

        if (primaryType === 'TYPE-05') {
          throw new HttpError(400, 'TYPE-05 does not allow report template creation (TEMPLATE_NOT_FOUND state)');
        }

        if (!ALLOWED_CLAIM_TYPES.has(primaryType)) {
          throw new HttpError(400, `Invalid primaryType ${primaryType}. Must be TYPE-01 to TYPE-06.`);
        }

        if (secondaryTypes.includes(primaryType)) {
          throw new HttpError(400, 'primaryType cannot be included in secondaryTypes');
        }

        for (const secType of secondaryTypes) {
          if (!ALLOWED_CLAIM_TYPES.has(secType) || secType === 'TYPE-05') {
            throw new HttpError(400, `Invalid secondaryType ${secType}`);
          }
        }

        const templateId = `RPT-TPL-${crypto.randomUUID()}`;
        const versionId = `RPT-TPL-VER-${crypto.randomUUID()}`;

        const created = await db.$transaction(async (tx) => {
          const template = await tx.reportTemplate.create({
            data: { id: templateId, code, name, description, status: 'ACTIVE', version: 1 }
          });

          const versionRow = await tx.reportTemplateVersion.create({
            data: {
              id: versionId,
              templateId,
              versionNumber: 1,
              name: `${name} v1`,
              companyForm,
              tocStructureJson: JSON.stringify(tocStructure),
              requiredSectionsJson: JSON.stringify(requiredSections),
              requiredEvidenceRulesJson: JSON.stringify(requiredEvidenceRules),
              blockSchemasJson: JSON.stringify(blockSchemas),
              referenceFileIdsJson: JSON.stringify(referenceFileIds),
              status: 'DRAFT',
              createdById: context.user.id
            }
          });

          // Primary mapping
          await tx.templateTypeMapping.create({
            data: { id: `TTM-${crypto.randomUUID()}`, templateVersionId: versionId, typeId: primaryType, kind: 'PRIMARY' }
          });

          // Secondary mappings
          for (const secType of secondaryTypes) {
            await tx.templateTypeMapping.create({
              data: { id: `TTM-${crypto.randomUUID()}`, templateVersionId: versionId, typeId: secType, kind: 'SECONDARY' }
            });
          }

          await tx.auditLog.create({
            data: requestAudit(context, 'REPORT_TEMPLATE_CREATED', 'ReportTemplate', templateId, { code, primaryType, versionId })
          });

          return { template, version: versionRow };
        });

        sendJson(res, 201, created);
        return;
      }

      // GET /api/report-templates/:id
      const tplDetailMatch = pathname.match(/^\/api\/report-templates\/([^/]+)$/);
      if (tplDetailMatch && req.method === 'GET') {
        const tplId = tplDetailMatch[1];
        const template = await db.reportTemplate.findUnique({
          where: { id: tplId },
          include: {
            versions: {
              orderBy: { versionNumber: 'desc' },
              include: {
                typeMappings: true,
                sections: { orderBy: { sectionNumber: 'asc' } },
                createdBy: { select: { id: true, name: true, email: true } },
                approvedBy: { select: { id: true, name: true, email: true } }
              }
            }
          }
        });
        if (!template) throw new HttpError(404, 'Report template not found');
        sendJson(res, 200, { template });
        return;
      }

      // POST /api/report-templates/:id/versions/:versionId/approve (CEO/Director 전용 사람 승인)
      const approveMatch = pathname.match(/^\/api\/report-templates\/([^/]+)\/versions\/([^/]+)\/approve$/);
      if (approveMatch && req.method === 'POST') {
        requireAnyRole(context, TEMPLATE_APPROVER_ROLES, 'Template approval requires CEO or Director role');
        const [, tplId, versionId] = approveMatch;

        const versionRow = await db.reportTemplateVersion.findUnique({ where: { id: versionId } });
        if (!versionRow || versionRow.templateId !== tplId) throw new HttpError(404, 'Template version not found');

        // Creator self-approval prohibition
        if (versionRow.createdById === context.user.id) {
          throw new HttpError(403, 'Creator self-approval of template version is forbidden');
        }

        if (versionRow.status !== 'DRAFT') {
          throw new HttpError(400, `Cannot approve version with status ${versionRow.status}`);
        }

        const approved = await db.$transaction(async (tx) => {
          const updated = await tx.reportTemplateVersion.update({
            where: { id: versionId },
            data: { status: 'HUMAN_APPROVED', approvedById: context.user.id, approvedAt: new Date() }
          });

          await tx.auditLog.create({
            data: requestAudit(context, 'TEMPLATE_VERSION_APPROVED', 'ReportTemplateVersion', versionId, { templateId: tplId })
          });

          return updated;
        });

        sendJson(res, 200, { version: approved });
        return;
      }

      // POST /api/report-templates/:id/versions/:versionId/activate (CEO/Director 전용 활성화)
      const activateMatch = pathname.match(/^\/api\/report-templates\/([^/]+)\/versions\/([^/]+)\/activate$/);
      if (activateMatch && req.method === 'POST') {
        requireAnyRole(context, TEMPLATE_APPROVER_ROLES, 'Template activation requires CEO or Director role');
        const [, tplId, versionId] = activateMatch;

        const versionRow = await db.reportTemplateVersion.findUnique({
          where: { id: versionId },
          include: { typeMappings: true }
        });
        if (!versionRow || versionRow.templateId !== tplId) throw new HttpError(404, 'Template version not found');

        if (versionRow.status !== 'HUMAN_APPROVED') {
          throw new HttpError(400, `Version must be HUMAN_APPROVED before activation. Current status: ${versionRow.status}`);
        }

        const primaryMapping = versionRow.typeMappings.find((m) => m.kind === 'PRIMARY');
        if (!primaryMapping) throw new HttpError(400, 'Template version has no PRIMARY type mapping');

        const activated = await db.$transaction(async (tx) => {
          // Archive existing ACTIVE versions for this primary type
          const existingActive = await tx.reportTemplateVersion.findMany({
            where: {
              status: 'ACTIVE',
              typeMappings: { some: { typeId: primaryMapping.typeId, kind: 'PRIMARY' } }
            }
          });

          for (const oldVer of existingActive) {
            await tx.reportTemplateVersion.update({
              where: { id: oldVer.id },
              data: { status: 'ARCHIVED' }
            });
          }

          const updated = await tx.reportTemplateVersion.update({
            where: { id: versionId },
            data: { status: 'ACTIVE' }
          });

          await tx.auditLog.create({
            data: requestAudit(context, 'TEMPLATE_VERSION_ACTIVATED', 'ReportTemplateVersion', versionId, {
              templateId: tplId, primaryType: primaryMapping.typeId
            })
          });

          return updated;
        });

        sendJson(res, 200, { version: activated });
        return;
      }

      // --- P08 Report Instances Endpoints ---
      // POST /api/cases/:id/report-instances (사건별 ACTIVE 템플릿 기반 snapshot 생성)
      const instanceMatch = pathname.match(/^\/api\/cases\/([^/]+)\/report-instances(?:\/([^/]+))?$/);
      if (instanceMatch) {
        const [, caseId, instanceId] = instanceMatch;
        const caseRow = await db.caseItem.findUnique({ where: { id: caseId } });
        if (!caseRow || caseRow.deletedAt) throw new HttpError(404, 'Case not found');
        if (caseRow.organizationId !== context.user.organizationId) throw new HttpError(403, 'Case access forbidden');
        if (!(await canAccessCase(db, context, caseId))) throw new HttpError(403, 'Case assignment required');

        if (!instanceId && req.method === 'GET') {
          const instances = await db.reportInstance.findMany({
            where: { caseId },
            include: { templateVersion: true, createdBy: { select: { id: true, name: true, email: true } }, reports: true },
            orderBy: { createdAt: 'desc' }
          });
          sendJson(res, 200, { instances });
          return;
        }

        if (!instanceId && req.method === 'POST') {
          requireAnyRole(context, CASE_EDITOR_ROLES, 'ReportInstance creation forbidden for Staff/Reviewer');
          const body = await readJson(req);
          const templateVersionId = typeof body.templateVersionId === 'string' ? body.templateVersionId.trim() : '';

          if (!templateVersionId) throw new HttpError(400, 'templateVersionId is required');

          if (caseRow.claimType === 'TYPE-05') {
            throw new HttpError(400, 'TYPE-05 cases have no available report templates (TEMPLATE_NOT_FOUND state)');
          }

          const versionRow = await db.reportTemplateVersion.findUnique({
            where: { id: templateVersionId },
            include: { typeMappings: true, sections: { orderBy: { sectionNumber: 'asc' } } }
          });

          if (!versionRow) throw new HttpError(404, 'Report template version not found');

          if (versionRow.status !== 'ACTIVE') {
            throw new HttpError(400, `Cannot create ReportInstance with non-ACTIVE template version (status: ${versionRow.status})`);
          }

          const newInstanceId = `RPT-INST-${crypto.randomUUID()}`;
          const newReportId = `REPO-${crypto.randomUUID()}`;
          const instTitle = `${caseRow.title} 전문보고서`;

          const createdInstance = await db.$transaction(async (tx) => {
            const instance = await tx.reportInstance.create({
              data: {
                id: newInstanceId,
                caseId,
                templateVersionId,
                templateVersionNumberSnapshot: versionRow.versionNumber,
                companyFormSnapshot: versionRow.companyForm,
                tocStructureSnapshotJson: versionRow.tocStructureJson,
                requiredSectionsSnapshotJson: versionRow.requiredSectionsJson,
                requiredEvidenceRulesSnapshotJson: versionRow.requiredEvidenceRulesJson,
                blockSchemasSnapshotJson: versionRow.blockSchemasJson,
                title: instTitle,
                status: 'DRAFT',
                version: 1,
                createdById: context.user.id
              }
            });

            await tx.report.create({
              data: {
                id: newReportId,
                caseId,
                reportInstanceId: newInstanceId,
                title: instTitle,
                version: 1
              }
            });

            // Parse TOC structure for sections
            const tocItems: Array<{ title: string; isRequired?: boolean }> = parseStringArray(versionRow.tocStructureJson, 'tocStructureJson')
              .map((title) => ({ title, isRequired: true }));

            let secNum = 1;
            for (const item of tocItems) {
              await tx.reportSection.create({
                data: {
                  id: `SEC-${crypto.randomUUID()}`,
                  reportId: newReportId,
                  sectionNumber: secNum++,
                  title: item.title,
                  content: `[${item.title} 기본 작성 영역]`,
                  status: 'draft',
                  isRequired: Boolean(item.isRequired),
                  version: 1
                }
              });
            }

            await tx.auditLog.create({
              data: requestAudit(context, 'REPORT_INSTANCE_CREATED', 'ReportInstance', newInstanceId, {
                caseId, templateVersionId, reportId: newReportId
              })
            });

            return instance;
          });

          sendJson(res, 201, { instance: createdInstance, reportId: newReportId });
          return;
        }
      }

      // --- P07 Proposal Templates Endpoint ---
      if (pathname === '/api/proposal-templates' && req.method === 'GET') {
        const claimType = url.searchParams.get('claimType')?.trim();
        if (claimType && !ALLOWED_CLAIM_TYPES.has(claimType)) {
          throw new HttpError(400, 'Invalid claimType filter');
        }
        const templates = await db.proposalTemplate.findMany({
          where: claimType ? { claimType } : {},
          orderBy: { claimType: 'asc' }
        });
        sendJson(res, 200, { templates });
        return;
      }

      // --- P04 Reports & Sections Endpoint ---
      const reportMatch = pathname.match(/^\/api\/reports\/([^/]+)(?:\/(merge|sections\/([^/]+)\/(body|approve)))?$/);
      if (reportMatch) {
        const [, reportId, reportAction, sectionId, sectionAction] = reportMatch;
        const report = await db.report.findUnique({ where: { id: reportId }, include: { case: true } });
        if (!report || report.deletedAt || report.case.deletedAt) throw new HttpError(404, 'Report not found');
        if (report.case.organizationId !== context.user.organizationId) throw new HttpError(403, 'Report access forbidden');
        if (!(await canAccessCase(db, context, report.caseId))) throw new HttpError(403, 'Case assignment required');

        if (sectionAction === 'body' && req.method === 'PATCH') {
          if (context.roles.includes('reviewer')) throw new HttpError(403, 'Reviewer cannot edit report body');
          const body = await readJson(req);
          const content = typeof body.content === 'string' ? body.content.trim() : '';
          const version = typeof body.version === 'number' ? body.version : -1;
          await db.$transaction(async (tx) => {
            const result = await tx.reportSection.updateMany({
              where: { id: sectionId, reportId, version, deletedAt: null },
              data: { content, version: { increment: 1 } }
            });
            if (result.count !== 1) throw new HttpError(409, 'Concurrency conflict');
            await tx.auditLog.create({ data: requestAudit(context, 'REPORT_SECTION_UPDATED', 'ReportSection', sectionId, { reportId, version }) });
          });
          sendJson(res, 200, { message: 'Section body updated' });
          return;
        }

        if (sectionAction === 'approve' && req.method === 'POST') {
          if (!context.roles.some((role) => ['reviewer', 'pm', 'director', 'ceo', 'admin'].includes(role))) throw new HttpError(403, 'Approval forbidden');
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

        const schedules = await db.schedule.findMany({ where: { case: caseWhere } });
        let todayTasksCount = 0;
        let delayedCount = 0;

        for (const s of schedules) {
          const dDayInfo = calculateDDay(s.date, now);
          if (dDayInfo.isToday) todayTasksCount++;
          else if (dDayInfo.isOverdue) delayedCount++;
        }

        sendJson(res, 200, { totalCases, inProgressCount, reviewingDocsCount, todayTasksCount, delayedCount });
        return;
      }

      // --- P05 Cases List & Creation ---
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
              id: caseId, organizationId: context.user.organizationId, caseNumber, title, description, claimType, status: 'INQUIRY', assignedUserId, version: 1
            }
          });
          await tx.caseCategory.create({ data: { id: `CAT-${crypto.randomUUID()}`, caseId, major, middle, minor } });
          await tx.statusHistory.create({ data: { id: `STHIST-${crypto.randomUUID()}`, caseId, fromStatus: null, toStatus: 'INQUIRY', changedById: context.user.id, reason: '신규 사건 등록' } });
          await tx.caseAssignment.create({ data: { caseId, userId: context.user.id } });
          if (assignedUserId && assignedUserId !== context.user.id) {
            await tx.caseAssignment.create({ data: { caseId, userId: assignedUserId } });
          }
          await tx.auditLog.create({ data: requestAudit(context, 'CASE_CREATED', 'CaseItem', caseId, { title, claimType, caseNumber }) });
          return { ...item, category: { major, middle, minor } };
        });

        sendJson(res, 201, { case: createdCase });
        return;
      }

      // --- P07 Proposal Endpoints ---
      const proposalMatch = pathname.match(/^\/api\/cases\/([^/]+)\/proposals(?:\/([^/]+)(?:\/(versions|reviews|render))?)?$/);
      if (proposalMatch) {
        const [, caseId, propId, action] = proposalMatch;
        const caseRow = await db.caseItem.findUnique({
          where: { id: caseId },
          include: { assignedUser: true }
        });
        if (!caseRow || caseRow.deletedAt) throw new HttpError(404, 'Case not found');
        if (caseRow.organizationId !== context.user.organizationId) throw new HttpError(403, 'Case access forbidden');
        if (!(await canAccessCase(db, context, caseId))) throw new HttpError(403, 'Case assignment required');

        // GET /api/cases/:id/proposals
        if (!propId && req.method === 'GET') {
          const proposals = await db.proposal.findMany({
            where: { caseId, deletedAt: null },
            include: {
              template: true,
              versions: { orderBy: { versionNumber: 'desc' } },
              reviews: { orderBy: { createdAt: 'desc' }, include: { reviewer: { select: { id: true, name: true, email: true } } } }
            },
            orderBy: { createdAt: 'desc' }
          });
          sendJson(res, 200, { proposals });
          return;
        }

        // POST /api/cases/:id/proposals (Create proposal)
        if (!propId && req.method === 'POST') {
          requireAnyRole(context, PROPOSAL_EDITOR_ROLES, 'Proposal creation forbidden for Staff or Reviewer');
          const body = await readJson(req);
          const templateId = typeof body.templateId === 'string' ? body.templateId.trim() : '';
          const title = typeof body.title === 'string' ? body.title.trim() : '';

          if (!templateId) throw new HttpError(400, 'Proposal templateId is required');
          const template = await db.proposalTemplate.findUnique({ where: { id: templateId } });
          if (!template) {
            console.error('Proposal template not found in DB:', templateId);
            throw new HttpError(404, 'Proposal template not found');
          }
          if (template.claimType !== caseRow.claimType) {
            throw new HttpError(400, `Template claimType (${template.claimType}) does not match case claimType (${caseRow.claimType})`);
          }

          const propTitle = title || `${caseRow.title} 제안서`;
          const newPropId = `PROP-${crypto.randomUUID()}`;
          const newVerId = `PROPVER-${crypto.randomUUID()}`;

          const caseValues: Record<string, string> = {
            CASE_NUMBER: caseRow.caseNumber,
            CASE_TITLE: caseRow.title,
            CLAIM_TYPE: caseRow.claimType,
            ASSIGNED_USER: caseRow.assignedUser?.name || context.user.name,
            CLIENT_NAME: '원청/의뢰인',
            CREATED_DATE: getKstDateString(new Date())
          };

          const { rendered, missing } = renderProposalTemplate(template.bodyTemplate, caseValues);
          const sha256 = crypto.createHash('sha256').update(rendered).digest('hex');
          const inputSha = proposalInputHash({ background: '', objective: '', method: '', expectedOutcome: '', exclusions: '' });

          const proposal = await db.$transaction(async (tx) => {
            await tx.proposal.create({
              data: {
                id: newPropId,
                caseId,
                templateId,
                templateVersionSnapshot: template.version,
                templateBodySnapshot: template.bodyTemplate,
                templatePlaceholdersSnapshotJson: template.placeholdersJson,
                title: propTitle,
                status: 'DRAFT',
                currentVersionId: null,
                version: 1,
                createdById: context.user.id,
                updatedById: context.user.id
              }
            });

            await tx.proposalVersion.create({
              data: {
                id: newVerId,
                proposalId: newPropId,
                versionNumber: 1,
                bodyText: rendered,
                structuredInputsJson: JSON.stringify({ background: '', objective: '', method: '', expectedOutcome: '', exclusions: '' }),
                renderedValuesJson: JSON.stringify(caseValues),
                missingFieldsJson: JSON.stringify(missing),
                generationMode: 'MANUAL',
                inputSha256: inputSha,
                sha256,
                isApproved: false,
                createdById: context.user.id
              }
            });

            await tx.proposal.update({
              where: { id: newPropId },
              data: { currentVersionId: newVerId }
            });

            await tx.auditLog.create({
              data: requestAudit(context, 'PROPOSAL_CREATED', 'Proposal', newPropId, { templateId, title: propTitle, versionNumber: 1 })
            });

            return tx.proposal.findUniqueOrThrow({
              where: { id: newPropId },
              include: { template: true, versions: { orderBy: { versionNumber: 'desc' } }, reviews: true }
            });
          });

          sendJson(res, 201, { proposal, versionId: newVerId });
          return;
        }

        // GET /api/cases/:id/proposals/:propId
        if (propId && !action && req.method === 'GET') {
          const proposal = await db.proposal.findUnique({
            where: { id: propId },
            include: {
              template: true,
              versions: {
                orderBy: { versionNumber: 'desc' },
                include: { createdBy: { select: { id: true, name: true, email: true } } }
              },
              reviews: {
                orderBy: { createdAt: 'desc' },
                include: { reviewer: { select: { id: true, name: true, email: true } } }
              }
            }
          });
          if (!proposal || proposal.caseId !== caseId || proposal.deletedAt) throw new HttpError(404, 'Proposal not found');
          sendJson(res, 200, { proposal });
          return;
        }

        // POST /api/cases/:id/proposals/:propId/versions
        if (propId && action === 'versions' && req.method === 'POST') {
          requireAnyRole(context, PROPOSAL_EDITOR_ROLES, 'Proposal version creation forbidden for Staff or Reviewer');
          const proposal = await db.proposal.findUnique({
            where: { id: propId },
            include: { template: true, versions: { orderBy: { versionNumber: 'desc' } } }
          });
          if (!proposal || proposal.caseId !== caseId || proposal.deletedAt) throw new HttpError(404, 'Proposal not found');

          const body = await readJson(req);
          const background = typeof body.background === 'string' ? body.background.trim() : '';
          const objective = typeof body.objective === 'string' ? body.objective.trim() : '';
          const method = typeof body.method === 'string' ? body.method.trim() : '';
          const expectedOutcome = typeof body.expectedOutcome === 'string' ? body.expectedOutcome.trim() : '';
          const exclusions = typeof body.exclusions === 'string' ? body.exclusions.trim() : '';
          const generationMode = body.generationMode === 'AI' ? 'AI' : 'MANUAL';
          const reqVersion = typeof body.version === 'number' ? body.version : -1;
          const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : null;
          const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : null;

          const sourceDocumentVersionIds = Array.isArray(body.sourceDocumentVersionIds)
            ? body.sourceDocumentVersionIds.filter((id): id is string => typeof id === 'string')
            : [];

          if (body.apiKey !== undefined || body.sourcePath !== undefined || body.filename !== undefined || body.contentBase64 !== undefined) {
            throw new HttpError(400, 'Forbidden parameters in proposal version body');
          }

          if (!background || !objective || !method || !expectedOutcome) {
            throw new HttpError(400, 'Background, objective, method, and expectedOutcome are required inputs');
          }

          if (generationMode === 'AI') {
            if (!providerId || !modelId) throw new HttpError(400, 'AI generation requires providerId and modelId');
            const allowedModels = ALLOWED_AI_PROVIDERS.get(providerId);
            if (!allowedModels || !allowedModels.has(modelId)) {
              throw new HttpError(400, `Unsupported AI provider/model: ${providerId}/${modelId}`);
            }
          }

          await verifyProposalSources(db, uploadDir, caseId, sourceDocumentVersionIds);

          const caseValues: Record<string, string> = {
            CASE_NUMBER: caseRow.caseNumber,
            CASE_TITLE: caseRow.title,
            CLAIM_TYPE: caseRow.claimType,
            ASSIGNED_USER: caseRow.assignedUser?.name || context.user.name,
            CLIENT_NAME: '원청/의뢰인',
            CREATED_DATE: getKstDateString(new Date()),
            BACKGROUND: generationMode === 'AI' ? `[AI_DRAFT] ${background}` : background,
            OBJECTIVE: objective,
            METHOD: method,
            EXPECTED_OUTCOME: expectedOutcome,
            EXCLUSIONS: exclusions || '없음'
          };

          const { rendered, missing } = renderProposalTemplate(proposal.templateBodySnapshot, caseValues);
          const nextVerNum = (proposal.versions[0]?.versionNumber ?? 0) + 1;
          const newVerId = `PROPVER-${crypto.randomUUID()}`;
          const sha256 = crypto.createHash('sha256').update(rendered).digest('hex');
          const inputSha = proposalInputHash({ background, objective, method, expectedOutcome, exclusions, sourceDocumentVersionIds });

          const newVersion = await db.$transaction(async (tx) => {
            if (reqVersion > 0 && proposal.version !== reqVersion) {
              throw new HttpError(409, 'Concurrency conflict (stale version)');
            }

            const created = await tx.proposalVersion.create({
              data: {
                id: newVerId,
                proposalId: propId,
                versionNumber: nextVerNum,
                bodyText: rendered,
                structuredInputsJson: JSON.stringify({ background, objective, method, expectedOutcome, exclusions }),
                renderedValuesJson: JSON.stringify(caseValues),
                missingFieldsJson: JSON.stringify(missing),
                generationMode,
                providerId: generationMode === 'AI' ? providerId : null,
                modelId: generationMode === 'AI' ? modelId : null,
                promptConfigVersion: generationMode === 'AI' ? 'v1.0' : null,
                inputSha256: inputSha,
                generatedAt: generationMode === 'AI' ? new Date() : null,
                sourceDocumentVersionIdsJson: JSON.stringify(sourceDocumentVersionIds),
                sha256,
                isApproved: false,
                createdById: context.user.id
              }
            });

            await tx.proposal.update({
              where: { id: propId },
              data: { currentVersionId: newVerId, version: { increment: 1 }, updatedById: context.user.id }
            });

            await tx.auditLog.create({
              data: requestAudit(context, 'PROPOSAL_VERSION_CREATED', 'ProposalVersion', newVerId, {
                proposalId: propId, versionNumber: nextVerNum, generationMode, sha256
              })
            });

            return created;
          });

          sendJson(res, 201, { version: newVersion });
          return;
        }

        // POST /api/cases/:id/proposals/:propId/reviews
        if (propId && action === 'reviews' && req.method === 'POST') {
          const proposal = await db.proposal.findUnique({
            where: { id: propId },
            include: { versions: true }
          });
          if (!proposal || proposal.caseId !== caseId || proposal.deletedAt) throw new HttpError(404, 'Proposal not found');

          const body = await readJson(req);
          const versionId = typeof body.versionId === 'string' ? body.versionId : (proposal.currentVersionId ?? '');
          const reviewAction = typeof body.action === 'string' ? body.action.trim() : '';
          const comment = typeof body.comment === 'string' ? body.comment.trim() : null;

          const targetVer = proposal.versions.find((v) => v.id === versionId);
          if (!targetVer) throw new HttpError(404, 'Target proposal version not found');

          if (reviewAction === 'REQUEST_REVIEW') {
            if (proposal.status !== 'DRAFT' && proposal.status !== 'REJECTED') {
              throw new HttpError(400, `Cannot request review from status ${proposal.status}`);
            }
            if (targetVer.generationMode === 'AI') {
              throw new HttpError(409, 'AI generated proposal version cannot be submitted directly for review. A manual human version must be created first.');
            }
            const sourceDocVerIds: string[] = JSON.parse(targetVer.sourceDocumentVersionIdsJson || '[]');
            await verifyProposalSources(db, uploadDir, caseId, sourceDocVerIds);
            await db.$transaction(async (tx) => {
              await tx.proposal.update({ where: { id: propId }, data: { status: 'IN_REVIEW', updatedById: context.user.id } });
              await tx.proposalReview.create({
                data: { id: `PROPREV-${crypto.randomUUID()}`, proposalId: propId, versionId, reviewerId: context.user.id, action: 'REQUEST_REVIEW', comment }
              });
              await tx.auditLog.create({ data: requestAudit(context, 'PROPOSAL_REVIEW_REQUESTED', 'Proposal', propId, { versionId }) });
            });
            sendJson(res, 200, { message: 'Review requested', status: 'IN_REVIEW' });
            return;
          }

          if (reviewAction === 'APPROVE') {
            if (targetVer.createdById === context.user.id) {
              throw new HttpError(403, 'Creator cannot self-approve proposal');
            }
            requireAnyRole(context, PROPOSAL_APPROVER_ROLES, 'Proposal approval forbidden for PM or Staff');

            if (proposal.status !== 'IN_REVIEW') {
              throw new HttpError(400, `Cannot approve proposal from status ${proposal.status}. Proposal must be IN_REVIEW.`);
            }

            await db.$transaction(async (tx) => {
              await tx.proposalVersion.update({
                where: { id: versionId },
                data: { isApproved: true }
              });
              await tx.proposal.update({
                where: { id: propId },
                data: { status: 'APPROVED', approvedVersionId: versionId, updatedById: context.user.id }
              });
              await tx.proposalReview.create({
                data: { id: `PROPREV-${crypto.randomUUID()}`, proposalId: propId, versionId, reviewerId: context.user.id, action: 'APPROVE', comment }
              });
              await tx.auditLog.create({ data: requestAudit(context, 'PROPOSAL_APPROVED', 'Proposal', propId, { versionId }) });
            });
            sendJson(res, 200, { message: 'Proposal approved', status: 'APPROVED' });
            return;
          }

          if (reviewAction === 'REJECT') {
            requireAnyRole(context, PROPOSAL_APPROVER_ROLES, 'Proposal rejection forbidden for PM or Staff');

            if (proposal.status !== 'IN_REVIEW') {
              throw new HttpError(400, `Cannot reject proposal from status ${proposal.status}`);
            }

            await db.$transaction(async (tx) => {
              await tx.proposal.update({ where: { id: propId }, data: { status: 'REJECTED', updatedById: context.user.id } });
              await tx.proposalReview.create({
                data: { id: `PROPREV-${crypto.randomUUID()}`, proposalId: propId, versionId, reviewerId: context.user.id, action: 'REJECT', comment }
              });
              await tx.auditLog.create({ data: requestAudit(context, 'PROPOSAL_REJECTED', 'Proposal', propId, { versionId }) });
            });
            sendJson(res, 200, { message: 'Proposal rejected', status: 'REJECTED' });
            return;
          }

          throw new HttpError(400, 'Invalid review action. Must be REQUEST_REVIEW, APPROVE, or REJECT');
        }

        // POST /api/cases/:id/proposals/:propId/render
        if (propId && action === 'render' && req.method === 'POST') {
          const proposal = await db.proposal.findUnique({
            where: { id: propId },
            include: { versions: true, template: true }
          });
          if (!proposal || proposal.caseId !== caseId || proposal.deletedAt) throw new HttpError(404, 'Proposal not found');

          if (proposal.status !== 'APPROVED') {
            throw new HttpError(403, 'Proposal must be APPROVED before rendering final document');
          }

          const body = await readJson(req);
          const format = body.format === 'pdf' ? 'pdf' : 'docx';
          const versionId = typeof body.versionId === 'string' ? body.versionId : (proposal.approvedVersionId ?? proposal.currentVersionId ?? '');

          const targetVer = proposal.versions.find((v) => v.id === versionId);
          if (!targetVer) throw new HttpError(404, 'Target approved proposal version not found');

          const dateStr = getKstDateString(new Date());
          const ext = format === 'pdf' ? '.pdf' : '.docx';
          const mimeType = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          const displayName = `${caseRow.caseNumber}_PROPOSAL_${sanitizeDisplayName(proposal.title)}_${dateStr}_v${String(targetVer.versionNumber).padStart(2, '0')}${ext}`;

          let buffer: Buffer;
          if (format === 'pdf') {
            buffer = generatePdfBuffer({
              title: proposal.title,
              caseNumber: caseRow.caseNumber,
              claimType: caseRow.claimType,
              proposalId: propId,
              versionId: targetVer.id,
              versionNumber: targetVer.versionNumber,
              approvedBy: context.user.name,
              approvedAt: new Date().toISOString(),
              sha256: targetVer.sha256,
              bodyText: targetVer.bodyText
            });
          } else {
            buffer = generateDocxBuffer({
              title: proposal.title,
              caseNumber: caseRow.caseNumber,
              claimType: caseRow.claimType,
              proposalId: propId,
              versionId: targetVer.id,
              versionNumber: targetVer.versionNumber,
              approvedBy: context.user.name,
              approvedAt: new Date().toISOString(),
              sha256: targetVer.sha256,
              bodyText: targetVer.bodyText
            });
          }

          const storageKey = `storage-${crypto.randomUUID()}${ext}`;
          const diskPath = path.join(uploadDir, storageKey);

          fs.writeFileSync(diskPath, buffer);

          try {
            await db.$transaction(async (tx) => {
              const docId = `DOC-${crypto.randomUUID()}`;
              const docVerId = `DOCVER-${crypto.randomUUID()}`;

              await tx.document.create({
                data: {
                  id: docId,
                  caseId,
                  proposalVersionId: targetVer.id,
                  title: `${proposal.title} [최종 출력물]`,
                  category: 'PROPOSAL',
                  source: 'AUTHORED',
                  currentVersionId: docVerId,
                  finalVersionId: docVerId
                }
              });

              await tx.documentVersion.create({
                data: {
                  id: docVerId,
                  documentId: docId,
                  versionNumber: 1,
                  originalName: `${proposal.title}${ext}`,
                  displayName,
                  storageKey,
                  fileSize: buffer.length,
                  mimeType,
                  sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
                  isFinal: true,
                  uploadedById: context.user.id
                }
              });

              await tx.proposal.update({
                where: { id: propId },
                data: { outputDocumentId: docId, updatedById: context.user.id }
              });

              await tx.auditLog.create({
                data: requestAudit(context, 'PROPOSAL_RENDERED', 'Proposal', propId, {
                  format, displayName, storageKey, outputDocumentId: docId
                })
              });
            });

            res.writeHead(200, {
              'Content-Type': mimeType,
              'Content-Length': buffer.length,
              'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(displayName)}`,
              'Cache-Control': 'no-store'
            });
            res.end(buffer);
            return;
          } catch (err) {
            fs.rmSync(diskPath, { force: true });
            throw err;
          }
        }
      }

      // --- P06 Documents Endpoints ---
      const docMatch = pathname.match(/^\/api\/cases\/([^/]+)\/documents(?:\/([^/]+)(?:\/(versions(?:\/([^/]+)\/download)?|finalize))?)?$/);
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

        // POST /api/cases/:id/documents
        if (!docId && req.method === 'POST') {
          requireAnyRole(context, CASE_EDITOR_ROLES, 'Document upload forbidden for Staff or Reviewer');
          const body = await readJson(req);
          const title = typeof body.title === 'string' ? body.title.trim() : '';
          const source = typeof body.source === 'string' ? body.source.trim() : '';
          const category = typeof body.category === 'string' ? body.category.trim() : 'GENERAL';
          const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
          const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : '';
          const mimeType = typeof body.mimeType === 'string' ? body.mimeType.trim() : 'application/octet-stream';
          const scheduleId = typeof body.scheduleId === 'string' ? body.scheduleId : null;
          const reportSectionId = typeof body.reportSectionId === 'string' ? body.reportSectionId : null;

          if (!title) throw new HttpError(400, 'Document title is required');
          if (!ALLOWED_DOC_SOURCES.has(source)) throw new HttpError(400, 'Invalid document source. Must be RECEIVED, AUTHORED, or SUBMITTED');
          if (!ALLOWED_DOC_CATEGORIES.has(category)) throw new HttpError(400, 'Invalid document category');
          if (!filename || !fileBase64) throw new HttpError(400, 'File filename and content (fileBase64) are required');

          if (scheduleId) {
            const sched = await db.schedule.findUnique({ where: { id: scheduleId } });
            if (!sched || sched.caseId !== caseId) throw new HttpError(400, 'Schedule does not belong to case');
          }
          if (reportSectionId) {
            const sec = await db.reportSection.findUnique({ where: { id: reportSectionId }, include: { report: true } });
            if (!sec || sec.report.caseId !== caseId) throw new HttpError(400, 'Report section does not belong to case');
          }

          let buffer: Buffer;
          try {
            buffer = Buffer.from(fileBase64, 'base64');
            if (buffer.length === 0 && fileBase64.length > 0) throw new Error('invalid base64');
          } catch {
            throw new HttpError(400, 'Malformed Base64 file content');
          }

          const { extension } = validateFileSecurity(filename, mimeType, buffer);
          const cleanTitle = sanitizeDisplayName(title);
          const cleanFilename = sanitizeDisplayName(filename);

          const existingDocs = await db.document.findMany({
            where: { caseId, deletedAt: null },
            include: { versions: true }
          });
          const isDuplicateFilename = existingDocs.some((d) => {
            if (d.title.toLowerCase() === title.toLowerCase()) return true;
            return d.versions.some((v) => v.displayName.toLowerCase().includes(cleanFilename.toLowerCase()));
          });
          if (isDuplicateFilename) {
            throw new HttpError(409, 'A file with the exact same name already exists in this case');
          }

          const newDocId = `DOC-${crypto.randomUUID()}`;
          const newVersionId = `DOCVER-${crypto.randomUUID()}`;
          const storageKey = `storage-${crypto.randomUUID()}${extension}`;
          const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
          const dateStr = getKstDateString(new Date());
          const displayName = `${caseRow.caseNumber}_${category}_${cleanTitle}_${cleanFilename}_${dateStr}_v01${extension}`;
          const diskPath = path.join(uploadDir, storageKey);

          fs.writeFileSync(diskPath, buffer);

          try {
            const document = await db.$transaction(async (tx) => {
              const docItem = await tx.document.create({
                data: {
                  id: newDocId, caseId, scheduleId, reportSectionId, title, category, source, currentVersionId: null, finalVersionId: null
                }
              });

              await tx.documentVersion.create({
                data: {
                  id: newVersionId, documentId: newDocId, versionNumber: 1, originalName: filename,
                  displayName, storageKey, fileSize: buffer.length,
                  mimeType, sha256, isFinal: false, uploadedById: context.user.id
                }
              });

              await tx.document.update({
                where: { id: newDocId },
                data: { currentVersionId: newVersionId }
              });

              await tx.auditLog.create({
                data: requestAudit(context, 'DOCUMENT_CREATED', 'Document', newDocId, { title, source, category, versionNumber: 1, storageKey })
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
          const doc = await db.document.findUnique({
            where: { id: docId },
            include: { versions: { orderBy: { versionNumber: 'desc' } } }
          });
          if (!doc || doc.caseId !== caseId || doc.deletedAt) throw new HttpError(404, 'Document not found');

          const body = await readJson(req);
          const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
          const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : '';
          const mimeType = typeof body.mimeType === 'string' ? body.mimeType.trim() : 'application/octet-stream';
          const reqVersion = typeof body.version === 'number' ? body.version : -1;

          if (reqVersion > 0 && doc.version !== reqVersion) {
            throw new HttpError(409, 'Concurrency conflict (stale document version)');
          }

          let buffer: Buffer;
          try {
            buffer = Buffer.from(fileBase64, 'base64');
          } catch {
            throw new HttpError(400, 'Malformed Base64 file content');
          }

          const { extension } = validateFileSecurity(filename, mimeType, buffer);
          const cleanTitle = sanitizeDisplayName(doc.title);
          const cleanFilename = sanitizeDisplayName(filename);
          const nextVerNum = (doc.versions[0]?.versionNumber ?? 0) + 1;

          const newVersionId = `DOCVER-${crypto.randomUUID()}`;
          const storageKey = `storage-${crypto.randomUUID()}${extension}`;
          const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
          const dateStr = getKstDateString(new Date());
          const displayName = `${caseRow.caseNumber}_${doc.category || 'DOC'}_${cleanTitle}_${cleanFilename}_${dateStr}_v${String(nextVerNum).padStart(2, '0')}${extension}`;
          const diskPath = path.join(uploadDir, storageKey);

          fs.writeFileSync(diskPath, buffer);

          try {
            const versionRow = await db.$transaction(async (tx) => {
              const createdVer = await tx.documentVersion.create({
                data: {
                  id: newVersionId, documentId: docId, versionNumber: nextVerNum, originalName: filename,
                  displayName, storageKey, fileSize: buffer.length,
                  mimeType, sha256, isFinal: false, uploadedById: context.user.id
                }
              });

              await tx.document.update({
                where: { id: docId },
                data: { currentVersionId: newVersionId, version: { increment: 1 }, updatedAt: new Date() }
              });

              await tx.auditLog.create({
                data: requestAudit(context, 'DOCUMENT_VERSION_CREATED', 'DocumentVersion', newVersionId, { documentId: docId, versionNumber: nextVerNum, storageKey })
              });

              return createdVer;
            });

            sendJson(res, 201, { version: versionRow });
            return;
          } catch (err) {
            fs.rmSync(diskPath, { force: true });
            throw err;
          }
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

          const diskPath = path.join(uploadDir, versionRow.storageKey);
          if (!fs.existsSync(diskPath)) {
            throw new HttpError(404, 'File on disk not found');
          }

          const currentDiskBuffer = fs.readFileSync(diskPath);
          const currentDiskSha = crypto.createHash('sha256').update(currentDiskBuffer).digest('hex');
          if (currentDiskSha !== versionRow.sha256) {
            throw new HttpError(409, 'File integrity validation failed. Storage file has been tampered with.');
          }

          await db.auditLog.create({
            data: requestAudit(context, 'DOCUMENT_DOWNLOADED', 'DocumentVersion', versionId, { displayName: versionRow.displayName })
          });

          res.writeHead(200, {
            'Content-Type': versionRow.mimeType || 'application/octet-stream',
            'Content-Length': currentDiskBuffer.length,
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(versionRow.displayName)}`,
            'Cache-Control': 'no-store'
          });
          res.end(currentDiskBuffer);
          return;
        }

        // POST /api/cases/:id/documents/:docId/finalize
        if (docId && action === 'finalize' && req.method === 'POST') {
          requireAnyRole(context, CASE_EDITOR_ROLES, 'Document finalize forbidden');
          const doc = await db.document.findUnique({ where: { id: docId } });
          if (!doc || doc.caseId !== caseId || doc.deletedAt) throw new HttpError(404, 'Document not found');
          const currentVerId = doc.currentVersionId;
          if (!currentVerId) throw new HttpError(400, 'Document has no current version');

          await db.$transaction(async (tx) => {
            await tx.documentVersion.update({
              where: { id: currentVerId },
              data: { isFinal: true }
            });
            await tx.document.update({
              where: { id: docId },
              data: { finalVersionId: currentVerId }
            });
            await tx.auditLog.create({
              data: requestAudit(context, 'DOCUMENT_FINALIZED', 'Document', docId, { finalVersionId: currentVerId })
            });
          });

          sendJson(res, 200, { message: 'Document finalized' });
          return;
        }

        // DELETE /api/cases/:id/documents/:docId
        if (docId && !action && req.method === 'DELETE') {
          requireAnyRole(context, CASE_DELETE_ROLES, 'Document delete forbidden');
          const doc = await db.document.findUnique({ where: { id: docId } });
          if (!doc || doc.caseId !== caseId || doc.deletedAt) throw new HttpError(404, 'Document not found');

          await db.$transaction(async (tx) => {
            await tx.document.update({
              where: { id: docId },
              data: { deletedAt: new Date() }
            });
            await tx.auditLog.create({
              data: requestAudit(context, 'DOCUMENT_DELETED', 'Document', docId, { caseId })
            });
          });

          sendJson(res, 200, { message: 'Document deleted' });
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
            include: { createdBy: { select: { id: true, name: true, email: true } }, actionItems: true },
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
          const meetingDateStr = typeof body.meetingDate === 'string' ? body.meetingDate : '';
          const location = typeof body.location === 'string' ? body.location.trim() : undefined;
          const attendees = typeof body.attendees === 'string' ? body.attendees.trim() : undefined;
          const rawText = typeof body.rawText === 'string' ? body.rawText : undefined;
          const summary = typeof body.summary === 'string' ? body.summary.trim() : undefined;
          const decisions = typeof body.decisions === 'string' ? body.decisions.trim() : undefined;
          const actionItemsInput = Array.isArray(body.actionItems) ? body.actionItems : [];

          if (!title) throw new HttpError(400, 'Meeting title is required');
          const meetingDate = new Date(meetingDateStr);
          if (isNaN(meetingDate.getTime())) throw new HttpError(400, 'Invalid meeting date');

          const newMeetingId = `MEET-${crypto.randomUUID()}`;
          const rawTextSha256 = rawText ? crypto.createHash('sha256').update(rawText).digest('hex') : undefined;

          const meeting = await db.$transaction(async (tx) => {
            await tx.meeting.create({
              data: {
                id: newMeetingId,
                caseId,
                title,
                meetingDate,
                location: location ?? undefined,
                attendees: attendees ?? undefined,
                rawText: rawText ?? undefined,
                rawTextSha256: rawTextSha256 ?? undefined,
                summary: summary ?? undefined,
                decisions: decisions ?? undefined,
                status: 'DRAFT',
                version: 1,
                createdById: context.user.id
              }
            });

            for (const item of actionItemsInput) {
              if (item && typeof item === 'object' && typeof item.title === 'string' && item.title.trim()) {
                const assigneeId = typeof item.assigneeId === 'string' ? item.assigneeId : undefined;
                if (assigneeId) {
                  const assignee = await tx.user.findUnique({ where: { id: assigneeId } });
                  if (!assignee || assignee.organizationId !== context.user.organizationId) {
                    throw new HttpError(403, 'Assignee must belong to the same organization');
                  }
                }
                const scheduleId = typeof item.scheduleId === 'string' ? item.scheduleId : undefined;
                if (scheduleId) {
                  const sched = await tx.schedule.findUnique({ where: { id: scheduleId } });
                  if (!sched || sched.caseId !== caseId) {
                    throw new HttpError(403, 'Schedule must belong to the same case');
                  }
                }
                await tx.meetingActionItem.create({
                  data: {
                    id: `ACT-${crypto.randomUUID()}`,
                    meetingId: newMeetingId,
                    title: item.title.trim(),
                    assigneeId,
                    scheduleId,
                    dueDate: typeof item.dueDate === 'string' && !isNaN(new Date(item.dueDate).getTime()) ? new Date(item.dueDate) : undefined,
                    status: 'PENDING'
                  }
                });
              }
            }

            await tx.auditLog.create({
              data: requestAudit(context, 'MEETING_CREATED', 'Meeting', newMeetingId, { title, meetingDate: meetingDate.toISOString() })
            });

            return tx.meeting.findUniqueOrThrow({ where: { id: newMeetingId }, include: { actionItems: true } });
          });

          sendJson(res, 201, { meeting });
          return;
        }

        // PATCH /api/cases/:id/meetings/:meetingId
        if (meetingId && !action && req.method === 'PATCH') {
          requireAnyRole(context, CASE_EDITOR_ROLES, 'Meeting edit forbidden');
          const meetingRow = await db.meeting.findUnique({ where: { id: meetingId } });
          if (!meetingRow || meetingRow.caseId !== caseId) throw new HttpError(404, 'Meeting not found');
          if (meetingRow.status === 'FINAL') throw new HttpError(400, 'FINAL meeting records are frozen and cannot be updated');

          const body = await readJson(req);
          const reqVersion = typeof body.version === 'number' ? body.version : -1;
          if (reqVersion > 0 && meetingRow.version !== reqVersion) {
            throw new HttpError(409, 'Concurrency conflict (stale meeting version)');
          }

          if (body.rawText !== undefined && body.rawText !== meetingRow.rawText) {
            throw new HttpError(400, 'Raw meeting transcript is immutable and cannot be updated');
          }

          const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : meetingRow.title;
          const summary = typeof body.summary === 'string' ? body.summary.trim() : meetingRow.summary;
          const decisions = typeof body.decisions === 'string' ? body.decisions.trim() : meetingRow.decisions;

          const updated = await db.$transaction(async (tx) => {
            const result = await tx.meeting.updateMany({
              where: { id: meetingId, version: meetingRow.version, status: 'DRAFT' },
              data: { title, summary, decisions, version: { increment: 1 } }
            });
            if (result.count !== 1) throw new HttpError(409, 'Concurrency conflict or meeting finalized');

            await tx.auditLog.create({
              data: requestAudit(context, 'MEETING_UPDATED', 'Meeting', meetingId, { title, summary })
            });

            return tx.meeting.findUniqueOrThrow({ where: { id: meetingId }, include: { actionItems: true } });
          });

          sendJson(res, 200, { meeting: updated });
          return;
        }

        // POST /api/cases/:id/meetings/:meetingId/finalize
        if (meetingId && action === 'finalize' && req.method === 'POST') {
          requireAnyRole(context, CASE_EDITOR_ROLES, 'Meeting finalize forbidden');
          const meetingRow = await db.meeting.findUnique({ where: { id: meetingId } });
          if (!meetingRow || meetingRow.caseId !== caseId) throw new HttpError(404, 'Meeting not found');

          const body = await readJson(req);
          const reqVersion = typeof body.version === 'number' ? body.version : -1;
          if (reqVersion > 0 && meetingRow.version !== reqVersion) {
            throw new HttpError(409, 'Concurrency conflict (stale meeting version)');
          }

          const finalized = await db.$transaction(async (tx) => {
            const result = await tx.meeting.updateMany({
              where: { id: meetingId, version: meetingRow.version },
              data: { status: 'FINAL', version: { increment: 1 } }
            });
            if (result.count !== 1) throw new HttpError(409, 'Concurrency conflict');

            await tx.auditLog.create({
              data: requestAudit(context, 'MEETING_FINALIZED', 'Meeting', meetingId, {})
            });

            return tx.meeting.findUniqueOrThrow({ where: { id: meetingId }, include: { actionItems: true } });
          });

          sendJson(res, 200, { meeting: finalized });
          return;
        }

        // POST /api/cases/:id/meetings/:meetingId/action-items
        if (meetingId && action === 'action-items' && req.method === 'POST') {
          requireAnyRole(context, CASE_EDITOR_ROLES, 'Meeting action items forbidden');
          const meetingRow = await db.meeting.findUnique({ where: { id: meetingId } });
          if (!meetingRow || meetingRow.caseId !== caseId) throw new HttpError(404, 'Meeting not found');
          if (meetingRow.status === 'FINAL') throw new HttpError(400, 'Cannot add action items to a FINAL meeting record');

          const body = await readJson(req);
          const title = typeof body.title === 'string' ? body.title.trim() : '';
          if (!title) throw new HttpError(400, 'Action item title is required');

          const assigneeId = typeof body.assigneeId === 'string' ? body.assigneeId : undefined;
          if (assigneeId) {
            const assignee = await db.user.findUnique({ where: { id: assigneeId } });
            if (!assignee || assignee.organizationId !== context.user.organizationId) {
              throw new HttpError(403, 'Cross-organization assignee is forbidden');
            }
          }

          const scheduleId = typeof body.scheduleId === 'string' ? body.scheduleId : undefined;
          if (scheduleId) {
            const sched = await db.schedule.findUnique({ where: { id: scheduleId } });
            if (!sched || sched.caseId !== caseId) {
              throw new HttpError(403, 'Cross-case schedule is forbidden');
            }
          }

          const actionItem = await db.$transaction(async (tx) => {
            const created = await tx.meetingActionItem.create({
              data: {
                id: `ACT-${crypto.randomUUID()}`,
                meetingId,
                title,
                assigneeId,
                scheduleId,
                dueDate: typeof body.dueDate === 'string' && !isNaN(new Date(body.dueDate).getTime()) ? new Date(body.dueDate) : undefined,
                status: 'PENDING'
              }
            });

            await tx.auditLog.create({
              data: requestAudit(context, 'ACTION_ITEM_ADDED', 'MeetingActionItem', created.id, { meetingId, title })
            });

            return created;
          });

          sendJson(res, 201, { actionItem });
          return;
        }
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
          const contact = typeof body.contact === 'string' ? body.contact.trim() : undefined;

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
          const location = typeof body.location === 'string' ? body.location.trim() : undefined;
          const description = typeof body.description === 'string' ? body.description.trim() : undefined;

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
        const reason = typeof body.reason === 'string' ? body.reason.trim() : undefined;
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

      // --- P05 Case Detail Endpoint & P04 PATCH Case Endpoint ---
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
        if (caseRow.organizationId !== context.user.organizationId) throw new HttpError(403, 'Case access forbidden');
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
          const version = typeof body.version === 'number' ? body.version : -1;
          const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : caseRow.title;
          const description = typeof body.description === 'string' ? body.description.trim() : caseRow.description;

          const updatedCase = await db.$transaction(async (tx) => {
            const result = await tx.caseItem.updateMany({
              where: { id: caseId, version, deletedAt: null },
              data: { title, description, version: { increment: 1 } }
            });
            if (result.count !== 1) throw new HttpError(409, 'Concurrency conflict');

            await tx.auditLog.create({
              data: requestAudit(context, 'CASE_UPDATED', 'CaseItem', caseId, { title, version })
            });

            return tx.caseItem.findUniqueOrThrow({ where: { id: caseId } });
          });

          sendJson(res, 200, { case: updatedCase });
          return;
        }

        if (req.method === 'DELETE') {
          requireAnyRole(context, CASE_DELETE_ROLES, 'Case deletion forbidden');
          await db.$transaction(async (tx) => {
            await tx.caseItem.update({ where: { id: caseId }, data: { deletedAt: new Date() } });
            await tx.auditLog.create({ data: requestAudit(context, 'CASE_DELETED', 'CaseItem', caseId, {}) });
          });
          sendJson(res, 200, { message: 'Case deleted' });
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
