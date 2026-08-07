import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  createPrismaClient, getDatabaseUrl, hashToken, verifyPassword,
  type Prisma, type PrismaClient, type User
} from '@claim-studio/database';
import {
  generateDocxBuffer, generatePdfBuffer, validateDocxBuffer, validatePdfBuffer
} from '@claim-studio/document-engine';
import { assertSafeBaseUrl, SsrfError } from './ai/ssrf-guard';
import { resolveSecretReference } from './ai/secret-resolver';
import { executeFakeAdapterCall } from './ai/fake-adapter';
import { processAiGenerationRequest, AiGatewayError } from './ai/gateway-engine';

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
const REPORT_TEMPLATE_ADMIN_ROLES = new Set(['admin']);
const REPORT_TEMPLATE_APPROVER_ROLES = new Set(['ceo', 'director']);
const REPORT_INSTANCE_CREATOR_ROLES = new Set(['ceo', 'director', 'pm', 'admin']);
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
  constructor(public readonly status: number, message: string, public readonly details: Record<string, unknown> = {}) {
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
  if (versions.length !== sourceIds.length) throw new HttpError(403, 'Source document version does not belong to the same case or is unavailable');
  for (const version of versions) {
    const storedPath = safeStoragePath(uploadDir, version.storageKey);
    if (!fs.existsSync(storedPath) || !fs.statSync(storedPath).isFile()) throw new HttpError(409, 'Source document storage object is missing');
    const stored = fs.readFileSync(storedPath);
    const storedHash = crypto.createHash('sha256').update(stored).digest('hex');
    if (stored.length !== version.fileSize || storedHash !== version.sha256) throw new HttpError(409, 'Source document integrity verification failed');
  }
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

interface ReportTemplateDraftInput {
  code: string;
  name: string;
  description: string | null;
  companyForm: string;
  primaryType: string;
  secondaryTypes: string[];
  tocStructure: string[];
  requiredSections: string[];
  requiredEvidenceRules: string[];
  blockSchemas: Record<string, { blockCode: string; config?: Record<string, unknown> }>;
  referenceFileIds: string[];
}

const FORBIDDEN_TEMPLATE_INPUT_KEYS = new Set([
  'sourcePath', 'relativePath', 'filename', 'originalFilename', 'contentBase64',
  'fileContent', 'apiKey', 'accessToken', 'refreshToken', 'secret', 'password'
]);

function assertNoForbiddenTemplateInput(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const child of value) assertNoForbiddenTemplateInput(child);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_TEMPLATE_INPUT_KEYS.has(key)) throw new HttpError(400, `Forbidden template input field: ${key}`);
    assertNoForbiddenTemplateInput(child);
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new HttpError(400, 'Template input contains a non-JSON value');
  return encoded;
}

function assertOnlyKeys(body: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new HttpError(400, `Unknown ${label} field: ${unknown[0]}`);
}

function requiredPositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new HttpError(400, `${label} must be a positive integer`);
  return value as number;
}

function normalizedBoundedText(value: unknown, label: string, max: number, required = true): string | null {
  if (value === null || value === undefined || value === '') {
    if (required) throw new HttpError(400, `${label} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new HttpError(400, `${label} must be a string`);
  const normalized = value.trim();
  if (required && normalized.length === 0) throw new HttpError(400, `${label} is required`);
  if (normalized.length > max) throw new HttpError(400, `${label} must be ${max} characters or fewer`);
  return normalized || null;
}

interface P09EvidenceInput {
  sourceType: 'DOCUMENT' | 'MEETING';
  sourceId: string;
  targetParagraphIndex: number;
  quoteText: string;
  anchorPosition: string;
}

function parseP09EvidenceInputs(value: unknown, paragraphCount: number): P09EvidenceInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) throw new HttpError(400, 'evidenceLinks must contain at most 50 entries');
  const parsed = value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new HttpError(400, `evidenceLinks[${index}] must be an object`);
    const body = entry as Record<string, unknown>;
    assertOnlyKeys(body, new Set(['sourceType', 'sourceId', 'targetParagraphIndex', 'quoteText', 'anchorPosition']), `evidenceLinks[${index}]`);
    if (body.sourceType !== 'DOCUMENT' && body.sourceType !== 'MEETING') throw new HttpError(400, `evidenceLinks[${index}].sourceType is invalid`);
    const sourceId = normalizedBoundedText(body.sourceId, `evidenceLinks[${index}].sourceId`, 200) as string;
    if (!Number.isSafeInteger(body.targetParagraphIndex) || (body.targetParagraphIndex as number) < 0 || (body.targetParagraphIndex as number) >= paragraphCount) {
      throw new HttpError(400, `evidenceLinks[${index}].targetParagraphIndex is outside the revision paragraphs`);
    }
    const sourceType: P09EvidenceInput['sourceType'] = body.sourceType;
    return {
      sourceType,
      sourceId,
      targetParagraphIndex: body.targetParagraphIndex as number,
      quoteText: normalizedBoundedText(body.quoteText, `evidenceLinks[${index}].quoteText`, 4000) as string,
      anchorPosition: normalizedBoundedText(body.anchorPosition, `evidenceLinks[${index}].anchorPosition`, 500) as string
    };
  });
  const identities = parsed.map((entry) => `${entry.sourceType}:${entry.sourceId}:${entry.targetParagraphIndex}`);
  if (new Set(identities).size !== identities.length) throw new HttpError(400, 'Duplicate evidence links are forbidden');
  return parsed;
}

function validateP09Paragraphs(content: string, evidence: P09EvidenceInput[]): {
  paragraphs: string[];
  status: 'VALID' | 'WARNING';
  errors: Array<{ code: string; paragraphIndex: number; message: string }>;
} {
  const paragraphs = content.split(/\r?\n\s*\r?\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  if (paragraphs.length === 0) throw new HttpError(400, 'Revision content must contain at least one paragraph');
  const oversized = paragraphs.findIndex((paragraph) => paragraph.length > 10_000);
  if (oversized >= 0) throw new HttpError(400, `Paragraph ${oversized + 1} exceeds 10000 characters`);
  const linked = new Set(evidence.map((entry) => entry.targetParagraphIndex));
  const evidenceSensitive = /(?:\d[\d,.]*\s*(?:원|%|㎡|m²)|법(?:률|령|원)|판결|계약(?:금액|조항)?|청구(?:액)?|손실(?:액)?|공사비)/u;
  const errors = paragraphs.flatMap((paragraph, paragraphIndex) => evidenceSensitive.test(paragraph) && !linked.has(paragraphIndex)
    ? [{ code: 'EVIDENCE_REQUIRED', paragraphIndex, message: '수치·법률·금액 단락에는 검증된 근거 연결이 필요합니다.' }]
    : []);
  return { paragraphs, status: errors.length > 0 ? 'WARNING' : 'VALID', errors };
}

function strictStringArray(value: unknown, label: string, options: { min?: number; max?: number } = {}): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.trim().length > 0)) {
    throw new HttpError(400, `${label} must be an array of non-empty strings`);
  }
  const normalized = value.map((item) => item.trim());
  if (new Set(normalized).size !== normalized.length) throw new HttpError(400, `${label} must not contain duplicates`);
  if (normalized.length < (options.min ?? 0) || normalized.length > (options.max ?? 100)) {
    throw new HttpError(400, `${label} has an invalid number of entries`);
  }
  if (normalized.some((item) => item.length > 200)) throw new HttpError(400, `${label} entries must be 200 characters or fewer`);
  return normalized;
}

function parseReportTemplateDraft(body: Record<string, unknown>, requireCode: boolean): ReportTemplateDraftInput {
  assertNoForbiddenTemplateInput(body);
  const allowed = new Set([
    'code', 'name', 'description', 'companyForm', 'primaryType', 'secondaryTypes',
    'tocStructure', 'requiredSections', 'requiredEvidenceRules', 'blockSchemas',
    'referenceFileIds', 'expectedTemplateVersion'
  ]);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new HttpError(400, `Unknown template input field: ${unknown[0]}`);

  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null;
  const companyForm = typeof body.companyForm === 'string' ? body.companyForm.trim() : '';
  const primaryType = typeof body.primaryType === 'string' ? body.primaryType.trim() : '';
  if ((requireCode && !/^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(code)) || !name || name.length > 200 || !companyForm || companyForm.length > 5000) {
    throw new HttpError(400, 'Template code, name, and companyForm are invalid');
  }
  if (!ALLOWED_CLAIM_TYPES.has(primaryType) || primaryType === 'TYPE-05') {
    throw new HttpError(400, 'primaryType must be one of TYPE-01..TYPE-04 or TYPE-06; TYPE-05 is TEMPLATE_NOT_FOUND');
  }

  const secondaryTypes = strictStringArray(body.secondaryTypes ?? [], 'secondaryTypes', { max: 5 });
  if (secondaryTypes.some((type) => !ALLOWED_CLAIM_TYPES.has(type) || type === 'TYPE-05')) {
    throw new HttpError(400, 'secondaryTypes contains an invalid or TYPE-05 value');
  }
  if (secondaryTypes.includes(primaryType)) throw new HttpError(400, 'primaryType cannot also be a secondaryType');

  const tocStructure = strictStringArray(body.tocStructure, 'tocStructure', { min: 1, max: 100 });
  const requiredSections = strictStringArray(body.requiredSections, 'requiredSections', { min: 1, max: 100 });
  if (requiredSections.some((title) => !tocStructure.includes(title))) {
    throw new HttpError(400, 'Every required section must exist in tocStructure');
  }
  const requiredEvidenceRules = strictStringArray(body.requiredEvidenceRules, 'requiredEvidenceRules', { min: 1, max: 50 });
  const referenceFileIds = strictStringArray(body.referenceFileIds ?? [], 'referenceFileIds', { max: 32 });
  if (referenceFileIds.some((fileId) => !/^TPL-REF-\d{3}$/.test(fileId))) {
    throw new HttpError(400, 'referenceFileIds must use anonymous TPL-REF-NNN identifiers');
  }

  if (!body.blockSchemas || typeof body.blockSchemas !== 'object' || Array.isArray(body.blockSchemas)) {
    throw new HttpError(400, 'blockSchemas must be an object keyed by section title');
  }
  const rawBlockSchemas = body.blockSchemas as Record<string, unknown>;
  if (Object.keys(rawBlockSchemas).length !== tocStructure.length || tocStructure.some((title) => !(title in rawBlockSchemas))) {
    throw new HttpError(400, 'blockSchemas must contain exactly one entry for every table-of-contents section');
  }
  const blockSchemas: ReportTemplateDraftInput['blockSchemas'] = {};
  for (const title of tocStructure) {
    const item = rawBlockSchemas[title];
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new HttpError(400, `Invalid block schema for section: ${title}`);
    const record = item as Record<string, unknown>;
    const blockCode = typeof record.blockCode === 'string' ? record.blockCode.trim() : '';
    const config = record.config;
    if (!blockCode || (config !== undefined && (!config || typeof config !== 'object' || Array.isArray(config)))) {
      throw new HttpError(400, `Invalid blockCode/config for section: ${title}`);
    }
    blockSchemas[title] = { blockCode, ...(config ? { config: config as Record<string, unknown> } : {}) };
  }

  return {
    code,
    name,
    description,
    companyForm,
    primaryType,
    secondaryTypes,
    tocStructure,
    requiredSections,
    requiredEvidenceRules,
    blockSchemas,
    referenceFileIds
  };
}

async function createReportTemplateVersion(
  tx: Prisma.TransactionClient,
  input: ReportTemplateDraftInput,
  templateId: string,
  versionNumber: number,
  createdById: string
) {
  const references = input.referenceFileIds.length === 0 ? [] : await tx.referenceInventory.findMany({
    where: { fileId: { in: input.referenceFileIds }, approvalStatus: 'HUMAN_APPROVED' },
    orderBy: { fileId: 'asc' }
  });
  if (references.length !== input.referenceFileIds.length) {
    throw new HttpError(409, 'All reference file IDs must exist and be HUMAN_APPROVED');
  }

  const blockCodes = [...new Set(Object.values(input.blockSchemas).map((item) => item.blockCode))];
  const blocks = await tx.blockDefinition.findMany({
    where: { code: { in: blockCodes }, status: 'ACTIVE' },
    orderBy: { version: 'desc' }
  });
  const blockByCode = new Map<string, (typeof blocks)[number]>();
  for (const block of blocks) if (!blockByCode.has(block.code)) blockByCode.set(block.code, block);
  if (blockByCode.size !== blockCodes.length) throw new HttpError(409, 'Every section must reference an ACTIVE block definition');

  const referenceProvenance = references.map((reference) => ({
    fileId: reference.fileId,
    sha256: reference.sha256,
    fileSize: reference.fileSize
  }));
  const normalizedSnapshot = {
    templateId,
    versionNumber,
    name: input.name,
    companyForm: input.companyForm,
    primaryType: input.primaryType,
    secondaryTypes: input.secondaryTypes,
    tocStructure: input.tocStructure,
    requiredSections: input.requiredSections,
    requiredEvidenceRules: input.requiredEvidenceRules,
    blockSchemas: input.blockSchemas,
    references: referenceProvenance
  };
  const contentSha256 = crypto.createHash('sha256').update(canonicalJson(normalizedSnapshot)).digest('hex');
  const versionId = `RPT-TPL-VER-${crypto.randomUUID()}`;
  const version = await tx.reportTemplateVersion.create({
    data: {
      id: versionId,
      templateId,
      versionNumber,
      rowVersion: 1,
      name: input.name,
      companyForm: input.companyForm,
      tocStructureJson: JSON.stringify(input.tocStructure),
      requiredSectionsJson: JSON.stringify(input.requiredSections),
      requiredEvidenceRulesJson: JSON.stringify(input.requiredEvidenceRules),
      blockSchemasJson: canonicalJson(input.blockSchemas),
      contentSha256,
      status: 'DRAFT',
      createdById
    }
  });

  await tx.templateTypeMapping.create({
    data: { id: `TTM-${crypto.randomUUID()}`, templateVersionId: versionId, typeId: input.primaryType, kind: 'PRIMARY' }
  });
  for (const typeId of input.secondaryTypes) {
    await tx.templateTypeMapping.create({
      data: { id: `TTM-${crypto.randomUUID()}`, templateVersionId: versionId, typeId, kind: 'SECONDARY' }
    });
  }

  for (let index = 0; index < input.tocStructure.length; index++) {
    const title = input.tocStructure[index];
    const blockRequest = input.blockSchemas[title];
    const block = blockByCode.get(blockRequest.blockCode);
    if (!block) throw new HttpError(409, `Block definition unavailable: ${blockRequest.blockCode}`);
    const sectionId = `TPL-SEC-${crypto.randomUUID()}`;
    const blockSnapshot = {
      code: block.code,
      version: block.version,
      schema: JSON.parse(block.schemaJson) as unknown,
      config: blockRequest.config ?? {}
    };
    await tx.templateSection.create({
      data: {
        id: sectionId,
        templateVersionId: versionId,
        sectionNumber: index + 1,
        title,
        isRequired: input.requiredSections.includes(title),
        description: null,
        blockSchemaSnapshotJson: canonicalJson(blockSnapshot)
      }
    });
    await tx.templateSectionBlock.create({
      data: {
        id: `TPL-SEC-BLK-${crypto.randomUUID()}`,
        templateSectionId: sectionId,
        blockDefinitionId: block.id,
        position: 1,
        blockCodeSnapshot: block.code,
        blockVersionSnapshot: block.version,
        blockSchemaSnapshotJson: block.schemaJson
      }
    });
  }

  for (const reference of references) {
    await tx.templateReference.create({
      data: {
        id: `TPL-REF-MAP-${crypto.randomUUID()}`,
        templateVersionId: versionId,
        referenceId: reference.id,
        fileIdSnapshot: reference.fileId,
        sha256Snapshot: reference.sha256,
        fileSizeSnapshot: reference.fileSize
      }
    });
  }
  return version;
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

export interface ApiServerOptions {
  databaseUrl?: string;
  db?: PrismaClient;
  allowedOrigins?: string[];
  secureCookies?: boolean;
  uploadDir?: string;
}

export function createApiServer(options: ApiServerOptions = {}): ManagedApiServer {
  const db = options.db ?? createPrismaClient(options.databaseUrl ?? getDatabaseUrl());
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

      if (pathname === '/api/proposal-templates' && req.method === 'GET') {
        const claimType = url.searchParams.get('claimType')?.trim();
        if (claimType && !ALLOWED_CLAIM_TYPES.has(claimType)) throw new HttpError(400, 'Invalid claimType filter');
        const templates = await db.proposalTemplate.findMany({
          where: claimType ? { claimType } : {},
          orderBy: [{ claimType: 'asc' }, { version: 'desc' }]
        });
        sendJson(res, 200, { templates });
        return;
      }

      // --- P08 Report Template Catalog & Immutable Report Snapshot Endpoints ---
      const canManageReportTemplates = context.roles.some((role) => ['admin', 'ceo', 'director'].includes(role));

      if (pathname === '/api/block-definitions' && req.method === 'GET') {
        const blocks = await db.blockDefinition.findMany({
          where: { status: 'ACTIVE' },
          select: { id: true, code: true, name: true, description: true, schemaJson: true, version: true, status: true },
          orderBy: [{ code: 'asc' }, { version: 'desc' }]
        });
        sendJson(res, 200, { blocks });
        return;
      }

      if (pathname === '/api/reference-inventories' && req.method === 'GET') {
        const inventory = await db.referenceInventory.findMany({
          select: { fileId: true, sha256: true, fileSize: true, scanStatus: true, approvalStatus: true, version: true },
          orderBy: { fileId: 'asc' }
        });
        sendJson(res, 200, { inventory });
        return;
      }

      const referenceReviewMatch = pathname.match(/^\/api\/reference-inventories\/(TPL-REF-\d{3})\/review$/);
      if (referenceReviewMatch && req.method === 'POST') {
        requireAnyRole(context, REPORT_TEMPLATE_APPROVER_ROLES, 'Reference approval requires CEO or Director role');
        const body = await readJson(req);
        const expectedVersion = Number(body.expectedVersion);
        const decision = typeof body.decision === 'string' ? body.decision : '';
        const unknown = Object.keys(body).filter((key) => !['expectedVersion', 'decision'].includes(key));
        if (unknown.length > 0) throw new HttpError(400, `Unknown reference review field: ${unknown[0]}`);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || decision !== 'HUMAN_APPROVE') {
          throw new HttpError(400, 'expectedVersion and HUMAN_APPROVE decision are required');
        }
        const fileId = referenceReviewMatch[1];
        const approved = await db.$transaction(async (tx) => {
          const reference = await tx.referenceInventory.findUnique({ where: { fileId } });
          if (!reference) throw new HttpError(404, 'Reference inventory item not found');
          if (reference.version !== expectedVersion || reference.approvalStatus === 'HUMAN_APPROVED') {
            throw new HttpError(409, 'Stale or already approved reference');
          }
          if (reference.scanStatus !== 'SCANNED') throw new HttpError(409, 'UNSCANNED references cannot be approved');
          const changed = await tx.referenceInventory.updateMany({
            where: { fileId, version: expectedVersion, approvalStatus: { in: ['UNCLASSIFIED', 'REVIEW_REQUIRED'] }, scanStatus: 'SCANNED' },
            data: { approvalStatus: 'HUMAN_APPROVED', version: { increment: 1 } }
          });
          if (changed.count !== 1) throw new HttpError(409, 'Stale reference approval request');
          await tx.auditLog.create({
            data: requestAudit(context, 'REFERENCE_INVENTORY_APPROVED', 'ReferenceInventory', reference.id, {
              fileId,
              sha256: reference.sha256,
              fileSize: reference.fileSize,
              fromVersion: expectedVersion,
              toVersion: expectedVersion + 1
            })
          });
          return tx.referenceInventory.findUniqueOrThrow({ where: { fileId } });
        });
        sendJson(res, 200, { reference: approved });
        return;
      }

      if (pathname === '/api/report-templates' && req.method === 'GET') {
        const claimType = url.searchParams.get('claimType')?.trim() ?? '';
        if (claimType && !ALLOWED_CLAIM_TYPES.has(claimType)) throw new HttpError(400, 'Invalid claimType filter');
        if (claimType === 'TYPE-05') {
          sendJson(res, 200, {
            claimType,
            availability: 'TEMPLATE_NOT_FOUND',
            templates: [],
            activeCounts: { 'TYPE-01': 0, 'TYPE-02': 0, 'TYPE-03': 0, 'TYPE-04': 0, 'TYPE-05': 0, 'TYPE-06': 0 }
          });
          return;
        }

        const versionVisibility: Prisma.ReportTemplateVersionWhereInput = canManageReportTemplates ? {} : { status: 'ACTIVE' };
        const templates = await db.reportTemplate.findMany({
          where: {
            organizationId: context.user.organizationId,
            status: 'ACTIVE',
            ...(claimType ? {
              versions: { some: { ...versionVisibility, typeMappings: { some: { typeId: claimType } } } }
            } : canManageReportTemplates ? {} : { versions: { some: { status: 'ACTIVE' } } })
          },
          include: {
            versions: {
              where: versionVisibility,
              orderBy: { versionNumber: 'desc' },
              include: {
                typeMappings: { orderBy: [{ kind: 'asc' }, { typeId: 'asc' }] },
                sections: { orderBy: { sectionNumber: 'asc' } },
                references: {
                  orderBy: { fileIdSnapshot: 'asc' },
                  select: { fileIdSnapshot: true, sha256Snapshot: true, fileSizeSnapshot: true }
                },
                createdBy: { select: { id: true, name: true } },
                approvedBy: { select: { id: true, name: true } }
              }
            }
          },
          orderBy: [{ code: 'asc' }]
        });

        const activeCounts: Record<string, number> = {};
        for (const typeId of ['TYPE-01', 'TYPE-02', 'TYPE-03', 'TYPE-04', 'TYPE-05', 'TYPE-06']) {
          activeCounts[typeId] = typeId === 'TYPE-05' ? 0 : await db.templateTypeMapping.count({
            where: {
              typeId,
              kind: 'PRIMARY',
              templateVersion: {
                status: 'ACTIVE',
                template: { organizationId: context.user.organizationId, status: 'ACTIVE' }
              }
            }
          });
        }
        sendJson(res, 200, {
          templates,
          activeCounts,
          availability: claimType ? (activeCounts[claimType] > 0 ? 'AVAILABLE' : 'TEMPLATE_NOT_FOUND') : 'MIXED'
        });
        return;
      }

      if (pathname === '/api/report-templates' && req.method === 'POST') {
        requireAnyRole(context, REPORT_TEMPLATE_ADMIN_ROLES, 'Report template creation requires Admin role');
        const body = await readJson(req);
        const input = parseReportTemplateDraft(body, true);
        const templateId = `RPT-TPL-${crypto.randomUUID()}`;
        const created = await db.$transaction(async (tx) => {
          const template = await tx.reportTemplate.create({
            data: {
              id: templateId,
              organizationId: context.user.organizationId,
              code: input.code,
              name: input.name,
              description: input.description,
              status: 'ACTIVE',
              version: 1,
              createdById: context.user.id
            }
          });
          const version = await createReportTemplateVersion(tx, input, templateId, 1, context.user.id);
          await tx.auditLog.create({
            data: requestAudit(context, 'REPORT_TEMPLATE_DRAFT_CREATED', 'ReportTemplateVersion', version.id, {
              templateId,
              templateCode: input.code,
              primaryType: input.primaryType,
              secondaryTypes: input.secondaryTypes,
              contentSha256: version.contentSha256
            })
          });
          return { template, version };
        });
        sendJson(res, 201, created);
        return;
      }

      const templateVersionCreateMatch = pathname.match(/^\/api\/report-templates\/([^/]+)\/versions$/);
      if (templateVersionCreateMatch && req.method === 'POST') {
        requireAnyRole(context, REPORT_TEMPLATE_ADMIN_ROLES, 'Report template version creation requires Admin role');
        const templateId = templateVersionCreateMatch[1];
        const body = await readJson(req);
        const expectedTemplateVersion = Number(body.expectedTemplateVersion);
        if (!Number.isInteger(expectedTemplateVersion) || expectedTemplateVersion < 1) {
          throw new HttpError(400, 'expectedTemplateVersion is required for optimistic locking');
        }
        const input = parseReportTemplateDraft(body, false);
        const created = await db.$transaction(async (tx) => {
          const template = await tx.reportTemplate.findFirst({
            where: { id: templateId, organizationId: context.user.organizationId, status: 'ACTIVE' },
            include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } }
          });
          if (!template) throw new HttpError(404, 'Report template not found');
          if (template.version !== expectedTemplateVersion) throw new HttpError(409, 'Stale report template version');
          const bumped = await tx.reportTemplate.updateMany({
            where: { id: templateId, organizationId: context.user.organizationId, version: expectedTemplateVersion },
            data: { version: { increment: 1 } }
          });
          if (bumped.count !== 1) throw new HttpError(409, 'Stale report template version');
          const versionNumber = (template.versions[0]?.versionNumber ?? 0) + 1;
          const version = await createReportTemplateVersion(tx, input, templateId, versionNumber, context.user.id);
          await tx.auditLog.create({
            data: requestAudit(context, 'REPORT_TEMPLATE_VERSION_CREATED', 'ReportTemplateVersion', version.id, {
              templateId,
              versionNumber,
              primaryType: input.primaryType,
              contentSha256: version.contentSha256
            })
          });
          return { version, templateVersion: expectedTemplateVersion + 1 };
        });
        sendJson(res, 201, created);
        return;
      }

      const templatePreviewMatch = pathname.match(/^\/api\/report-templates\/([^/]+)\/versions\/([^/]+)\/preview$/);
      if (templatePreviewMatch && req.method === 'GET') {
        const [, templateId, versionId] = templatePreviewMatch;
        const version = await db.reportTemplateVersion.findFirst({
          where: {
            id: versionId,
            templateId,
            template: { organizationId: context.user.organizationId },
            ...(canManageReportTemplates ? {} : { status: 'ACTIVE' })
          },
          include: {
            typeMappings: { orderBy: [{ kind: 'asc' }, { typeId: 'asc' }] },
            sections: {
              orderBy: { sectionNumber: 'asc' },
              include: { blocks: { orderBy: { position: 'asc' } } }
            },
            references: {
              orderBy: { fileIdSnapshot: 'asc' },
              select: { fileIdSnapshot: true, sha256Snapshot: true, fileSizeSnapshot: true }
            },
            approvedBy: { select: { id: true, name: true } }
          }
        });
        if (!version) throw new HttpError(404, 'Report template version not found');
        sendJson(res, 200, { version });
        return;
      }

      const templateApprovalMatch = pathname.match(/^\/api\/report-templates\/([^/]+)\/versions\/([^/]+)\/approve$/);
      if (templateApprovalMatch && req.method === 'POST') {
        requireAnyRole(context, REPORT_TEMPLATE_APPROVER_ROLES, 'Template approval requires CEO or Director role');
        const [, templateId, versionId] = templateApprovalMatch;
        const body = await readJson(req);
        const expectedRowVersion = Number(body.expectedRowVersion);
        if (!Number.isInteger(expectedRowVersion) || expectedRowVersion < 1) throw new HttpError(400, 'expectedRowVersion is required');
        const approved = await db.$transaction(async (tx) => {
          const version = await tx.reportTemplateVersion.findFirst({
            where: { id: versionId, templateId, template: { organizationId: context.user.organizationId } }
          });
          if (!version) throw new HttpError(404, 'Report template version not found');
          if (version.createdById === context.user.id) throw new HttpError(403, 'Creator self-approval is forbidden');
          if (version.status !== 'DRAFT' || version.rowVersion !== expectedRowVersion) throw new HttpError(409, 'Stale or non-draft template version');
          const changed = await tx.reportTemplateVersion.updateMany({
            where: { id: versionId, status: 'DRAFT', rowVersion: expectedRowVersion },
            data: {
              status: 'HUMAN_APPROVED',
              approvedById: context.user.id,
              approvedAt: new Date(),
              rowVersion: { increment: 1 }
            }
          });
          if (changed.count !== 1) throw new HttpError(409, 'Stale template approval request');
          await tx.auditLog.create({
            data: requestAudit(context, 'REPORT_TEMPLATE_VERSION_APPROVED', 'ReportTemplateVersion', versionId, {
              templateId,
              fromRowVersion: expectedRowVersion,
              toRowVersion: expectedRowVersion + 1
            })
          });
          return tx.reportTemplateVersion.findUniqueOrThrow({ where: { id: versionId } });
        });
        sendJson(res, 200, { version: approved });
        return;
      }

      const templateActivationMatch = pathname.match(/^\/api\/report-templates\/([^/]+)\/versions\/([^/]+)\/activate$/);
      if (templateActivationMatch && req.method === 'POST') {
        requireAnyRole(context, REPORT_TEMPLATE_APPROVER_ROLES, 'Template activation requires CEO or Director role');
        const [, templateId, versionId] = templateActivationMatch;
        const body = await readJson(req);
        const expectedRowVersion = Number(body.expectedRowVersion);
        if (!Number.isInteger(expectedRowVersion) || expectedRowVersion < 1) throw new HttpError(400, 'expectedRowVersion is required');
        const activated = await db.$transaction(async (tx) => {
          const version = await tx.reportTemplateVersion.findFirst({
            where: { id: versionId, templateId, template: { organizationId: context.user.organizationId } },
            include: { typeMappings: true }
          });
          if (!version) throw new HttpError(404, 'Report template version not found');
          if (version.status !== 'HUMAN_APPROVED' || version.rowVersion !== expectedRowVersion) {
            throw new HttpError(409, 'Stale or non-approved template version');
          }
          const primary = version.typeMappings.find((mapping) => mapping.kind === 'PRIMARY');
          if (!primary) throw new HttpError(409, 'Exactly one PRIMARY type mapping is required');

          const existingActive = await tx.reportTemplateVersion.findMany({
            where: {
              id: { not: versionId },
              status: 'ACTIVE',
              template: { organizationId: context.user.organizationId },
              typeMappings: { some: { typeId: primary.typeId, kind: 'PRIMARY' } }
            }
          });
          const archivedAt = new Date();
          for (const oldVersion of existingActive) {
            const archived = await tx.reportTemplateVersion.updateMany({
              where: { id: oldVersion.id, status: 'ACTIVE', rowVersion: oldVersion.rowVersion },
              data: { status: 'ARCHIVED', archivedAt, rowVersion: { increment: 1 } }
            });
            if (archived.count !== 1) throw new HttpError(409, 'Concurrent active template update detected');
          }
          const changed = await tx.reportTemplateVersion.updateMany({
            where: { id: versionId, status: 'HUMAN_APPROVED', rowVersion: expectedRowVersion },
            data: { status: 'ACTIVE', activatedAt: new Date(), rowVersion: { increment: 1 } }
          });
          if (changed.count !== 1) throw new HttpError(409, 'Stale template activation request');
          await tx.auditLog.create({
            data: requestAudit(context, 'REPORT_TEMPLATE_VERSION_ACTIVATED', 'ReportTemplateVersion', versionId, {
              templateId,
              primaryType: primary.typeId,
              archivedVersionIds: existingActive.map((item) => item.id)
            })
          });
          return tx.reportTemplateVersion.findUniqueOrThrow({ where: { id: versionId } });
        });
        sendJson(res, 200, { version: activated });
        return;
      }

      const templateArchiveMatch = pathname.match(/^\/api\/report-templates\/([^/]+)\/versions\/([^/]+)\/archive$/);
      if (templateArchiveMatch && req.method === 'POST') {
        requireAnyRole(context, REPORT_TEMPLATE_APPROVER_ROLES, 'Template archive requires CEO or Director role');
        const [, templateId, versionId] = templateArchiveMatch;
        const body = await readJson(req);
        const expectedRowVersion = Number(body.expectedRowVersion);
        if (!Number.isInteger(expectedRowVersion) || expectedRowVersion < 1) throw new HttpError(400, 'expectedRowVersion is required');
        const archived = await db.$transaction(async (tx) => {
          const version = await tx.reportTemplateVersion.findFirst({
            where: { id: versionId, templateId, template: { organizationId: context.user.organizationId } }
          });
          if (!version) throw new HttpError(404, 'Report template version not found');
          if (version.status !== 'ACTIVE' || version.rowVersion !== expectedRowVersion) throw new HttpError(409, 'Stale or non-active template version');
          const changed = await tx.reportTemplateVersion.updateMany({
            where: { id: versionId, status: 'ACTIVE', rowVersion: expectedRowVersion },
            data: { status: 'ARCHIVED', archivedAt: new Date(), rowVersion: { increment: 1 } }
          });
          if (changed.count !== 1) throw new HttpError(409, 'Stale template archive request');
          await tx.auditLog.create({
            data: requestAudit(context, 'REPORT_TEMPLATE_VERSION_ARCHIVED', 'ReportTemplateVersion', versionId, { templateId })
          });
          return tx.reportTemplateVersion.findUniqueOrThrow({ where: { id: versionId } });
        });
        sendJson(res, 200, { version: archived });
        return;
      }

      const reportTemplateDetailMatch = pathname.match(/^\/api\/report-templates\/([^/]+)$/);
      if (reportTemplateDetailMatch && req.method === 'GET') {
        const template = await db.reportTemplate.findFirst({
          where: { id: reportTemplateDetailMatch[1], organizationId: context.user.organizationId },
          include: {
            versions: {
              where: canManageReportTemplates ? {} : { status: 'ACTIVE' },
              orderBy: { versionNumber: 'desc' },
              include: {
                typeMappings: true,
                sections: { orderBy: { sectionNumber: 'asc' } },
                references: {
                  select: { fileIdSnapshot: true, sha256Snapshot: true, fileSizeSnapshot: true },
                  orderBy: { fileIdSnapshot: 'asc' }
                },
                createdBy: { select: { id: true, name: true } },
                approvedBy: { select: { id: true, name: true } }
              }
            }
          }
        });
        if (!template || (!canManageReportTemplates && template.versions.length === 0)) throw new HttpError(404, 'Report template not found');
        sendJson(res, 200, { template });
        return;
      }

      const caseReportInstancesMatch = pathname.match(/^\/api\/cases\/([^/]+)\/report-instances$/);
      if (caseReportInstancesMatch) {
        const caseId = caseReportInstancesMatch[1];
        const caseRow = await db.caseItem.findUnique({ where: { id: caseId } });
        if (!caseRow || caseRow.deletedAt) throw new HttpError(404, 'Case not found');
        if (caseRow.organizationId !== context.user.organizationId) throw new HttpError(403, 'Case access forbidden');
        if (!(await canAccessCase(db, context, caseId))) throw new HttpError(403, 'Case assignment required');

        if (req.method === 'GET') {
          const instances = await db.reportInstance.findMany({
            where: { caseId, organizationId: context.user.organizationId },
            include: { report: { include: { sections: { orderBy: { sectionNumber: 'asc' } } } } },
            orderBy: { createdAt: 'desc' }
          });
          sendJson(res, 200, { instances });
          return;
        }

        if (req.method === 'POST') {
          requireAnyRole(context, REPORT_INSTANCE_CREATOR_ROLES, 'Report instance creation forbidden');
          const body = await readJson(req);
          assertNoForbiddenTemplateInput(body);
          const templateVersionId = typeof body.templateVersionId === 'string' ? body.templateVersionId.trim() : '';
          const expectedCaseVersion = Number(body.expectedCaseVersion);
          const unknown = Object.keys(body).filter((key) => !['templateVersionId', 'expectedCaseVersion'].includes(key));
          if (unknown.length > 0) throw new HttpError(400, `Unknown report instance input field: ${unknown[0]}`);
          if (!templateVersionId || !Number.isInteger(expectedCaseVersion) || expectedCaseVersion < 1) {
            throw new HttpError(400, 'templateVersionId and expectedCaseVersion are required');
          }
          if (caseRow.claimType === 'TYPE-05') throw new HttpError(409, 'TYPE-05 report template is TEMPLATE_NOT_FOUND');

          const created = await db.$transaction(async (tx) => {
            const lockedCase = await tx.caseItem.findFirst({
              where: { id: caseId, organizationId: context.user.organizationId, deletedAt: null }
            });
            if (!lockedCase) throw new HttpError(404, 'Case not found');
            if (lockedCase.version !== expectedCaseVersion) throw new HttpError(409, 'Stale case version');
            const templateVersion = await tx.reportTemplateVersion.findFirst({
              where: {
                id: templateVersionId,
                status: 'ACTIVE',
                template: { organizationId: context.user.organizationId, status: 'ACTIVE' },
                typeMappings: { some: { kind: 'PRIMARY', typeId: lockedCase.claimType } }
              },
              include: {
                template: true,
                typeMappings: true,
                sections: { orderBy: { sectionNumber: 'asc' } },
                references: {
                  orderBy: { fileIdSnapshot: 'asc' },
                  select: { fileIdSnapshot: true, sha256Snapshot: true, fileSizeSnapshot: true }
                }
              }
            });
            if (!templateVersion) throw new HttpError(409, 'ACTIVE report template must match the case claim type and organization');
            const primaryMappings = templateVersion.typeMappings.filter((mapping) => mapping.kind === 'PRIMARY');
            if (primaryMappings.length !== 1 || primaryMappings[0].typeId !== lockedCase.claimType) {
              throw new HttpError(409, 'Exactly one matching PRIMARY type mapping is required');
            }
            if (templateVersion.sections.length === 0) throw new HttpError(409, 'Report template has no sections');

            const snapshot = {
              templateCode: templateVersion.template.code,
              templateName: templateVersion.name,
              templateVersionNumber: templateVersion.versionNumber,
              companyForm: templateVersion.companyForm,
              tocStructure: JSON.parse(templateVersion.tocStructureJson) as unknown,
              requiredSections: JSON.parse(templateVersion.requiredSectionsJson) as unknown,
              requiredEvidenceRules: JSON.parse(templateVersion.requiredEvidenceRulesJson) as unknown,
              blockSchemas: JSON.parse(templateVersion.blockSchemasJson) as unknown,
              referenceProvenance: templateVersion.references
            };
            const snapshotJson = canonicalJson(snapshot);
            const snapshotSha256 = crypto.createHash('sha256').update(snapshotJson).digest('hex');
            const instanceId = `RPT-INST-${crypto.randomUUID()}`;
            const reportId = `REPO-${crypto.randomUUID()}`;
            const instance = await tx.reportInstance.create({
              data: {
                id: instanceId,
                organizationId: context.user.organizationId,
                caseId,
                templateVersionId,
                createdById: context.user.id,
                version: 1,
                templateCodeSnapshot: templateVersion.template.code,
                templateNameSnapshot: templateVersion.name,
                templateVersionNumberSnapshot: templateVersion.versionNumber,
                companyFormSnapshot: templateVersion.companyForm,
                tocStructureSnapshotJson: templateVersion.tocStructureJson,
                requiredSectionsSnapshotJson: templateVersion.requiredSectionsJson,
                requiredEvidenceRulesSnapshotJson: templateVersion.requiredEvidenceRulesJson,
                blockSchemasSnapshotJson: templateVersion.blockSchemasJson,
                referenceProvenanceSnapshotJson: JSON.stringify(templateVersion.references),
                snapshotSha256
              }
            });
            const report = await tx.report.create({
              data: {
                id: reportId,
                caseId,
                reportInstanceId: instanceId,
                title: `${lockedCase.title} 보고서`,
                version: 1
              }
            });
            const sections = [];
            for (const section of templateVersion.sections) {
              sections.push(await tx.reportSection.create({
                data: {
                  id: `RPT-SEC-${crypto.randomUUID()}`,
                  reportId,
                  templateSectionIdSnapshot: section.id,
                  sectionNumber: section.sectionNumber,
                  title: section.title,
                  content: '',
                  status: 'DRAFT',
                  isRequired: section.isRequired,
                  blockSchemaSnapshotJson: section.blockSchemaSnapshotJson,
                  version: 1
                }
              }));
            }
            const bumped = await tx.caseItem.updateMany({
              where: { id: caseId, organizationId: context.user.organizationId, version: expectedCaseVersion },
              data: { version: { increment: 1 } }
            });
            if (bumped.count !== 1) throw new HttpError(409, 'Stale case version');
            await tx.auditLog.create({
              data: requestAudit(context, 'REPORT_INSTANCE_CREATED', 'ReportInstance', instanceId, {
                caseId,
                reportId,
                templateVersionId,
                snapshotSha256,
                sectionCount: sections.length
              })
            });
            return { instance, report, sections, caseVersion: expectedCaseVersion + 1 };
          });
          sendJson(res, 201, created);
          return;
        }
      }

      const reportInstanceDetailMatch = pathname.match(/^\/api\/report-instances\/([^/]+)$/);
      if (reportInstanceDetailMatch && req.method === 'GET') {
        const instance = await db.reportInstance.findFirst({
          where: { id: reportInstanceDetailMatch[1], organizationId: context.user.organizationId },
          include: {
            templateVersion: { select: { id: true, status: true, contentSha256: true } },
            report: { include: { sections: { orderBy: { sectionNumber: 'asc' } } } }
          }
        });
        if (!instance) throw new HttpError(404, 'Report instance not found');
        if (!(await canAccessCase(db, context, instance.caseId))) throw new HttpError(403, 'Case assignment required');
        sendJson(res, 200, { instance });
        return;
      }

      // --- P09 Report Studio (P08 ReportInstance only) ---
      const p09Route = pathname.match(/^\/api\/reports\/([^/]+)(?:\/(studio|merge)|\/sections\/([^/]+)\/(revisions|comments|approve|unlock|body)(?:\/([^/]+)\/(resolve))?)$/);
      if (p09Route) {
        const [, p09ReportId, reportAction, p09SectionId, sectionAction, childId, childAction] = p09Route;
        const p09Report = await db.report.findUnique({
          where: { id: p09ReportId },
          include: {
            reportInstance: true,
            case: {
              select: {
                id: true,
                organizationId: true,
                title: true,
                caseNumber: true,
                claimType: true,
                deletedAt: true,
                documents: {
                  where: { deletedAt: null },
                  orderBy: { createdAt: 'asc' },
                  select: {
                    id: true,
                    title: true,
                    category: true,
                    versions: {
                      orderBy: { versionNumber: 'desc' },
                      select: { id: true, versionNumber: true, displayName: true, sha256: true, fileSize: true, isFinal: true }
                    }
                  }
                },
                meetings: {
                  orderBy: { meetingDate: 'desc' },
                  select: { id: true, title: true, meetingDate: true, rawTextSha256: true, status: true, version: true }
                }
              }
            },
            sections: {
              where: { deletedAt: null },
              orderBy: { sectionNumber: 'asc' },
              include: {
                revisions: {
                  orderBy: { revisionNumber: 'desc' },
                  include: {
                    author: { select: { id: true, name: true, email: true } },
                    evidenceLinks: {
                      orderBy: [{ targetParagraphIndex: 'asc' }, { sourceType: 'asc' }, { sourceId: 'asc' }],
                      include: {
                        documentVersion: { select: { id: true, displayName: true, sha256: true, versionNumber: true } },
                        meeting: { select: { id: true, title: true, status: true, version: true } }
                      }
                    }
                  }
                },
                comments: {
                  orderBy: { createdAt: 'desc' },
                  include: {
                    author: { select: { id: true, name: true, email: true } },
                    resolvedBy: { select: { id: true, name: true } }
                  }
                },
                approvals: {
                  orderBy: { eventNumber: 'desc' },
                  include: {
                    approver: { select: { id: true, name: true, email: true } },
                    approvedRevision: { select: { id: true, revisionNumber: true, sha256: true } }
                  }
                }
              }
            },
            mergeSnapshots: {
              orderBy: { snapshotVersion: 'desc' },
              include: { createdBy: { select: { id: true, name: true } } }
            }
          }
        });
        if (!p09Report || p09Report.deletedAt || p09Report.case.deletedAt) throw new HttpError(404, 'Report not found');
        if (p09Report.case.organizationId !== context.user.organizationId) throw new HttpError(403, 'Report access forbidden');
        if (!(await canAccessCase(db, context, p09Report.caseId))) throw new HttpError(403, 'Case assignment required');

        if (!p09Report.reportInstanceId) {
          const p09Only = reportAction === 'studio' || sectionAction === 'revisions' || sectionAction === 'comments'
            || sectionAction === 'unlock' || childAction === 'resolve';
          if (p09Only) throw new HttpError(409, 'P09 studio requires a P08 ReportInstance snapshot');
          // P04 compatibility body/approve/merge routes intentionally fall through below.
        } else {
          if (reportAction === 'studio' && req.method === 'GET') {
            sendJson(res, 200, { report: p09Report });
            return;
          }

          if (p09SectionId && sectionAction === 'body' && req.method === 'PATCH') {
            throw new HttpError(410, 'Direct report body mutation is disabled. Create an immutable revision instead.');
          }

          if (p09SectionId && sectionAction === 'revisions' && req.method === 'POST') {
            requireAnyRole(context, new Set(['admin', 'pm', 'staff']), 'Section editing forbidden');
            const section = p09Report.sections.find((entry) => entry.id === p09SectionId);
            if (!section) throw new HttpError(404, 'Report section not found');
            if (section.status === 'APPROVED') throw new HttpError(409, 'APPROVED section is locked. An approver must unlock it first.');

            const body = await readJson(req);
            assertOnlyKeys(body, new Set(['title', 'content', 'structuredDataJson', 'expectedVersion', 'evidenceLinks', 'saveMode']), 'revision');
            const expectedVersion = requiredPositiveInteger(body.expectedVersion, 'expectedVersion');
            const title = body.title === undefined ? section.title : normalizedBoundedText(body.title, 'title', 300) as string;
            if (title !== section.title) throw new HttpError(409, 'P08 template section title is immutable');
            const content = normalizedBoundedText(body.content, 'content', 100_000) as string;
            const rawStructured = body.structuredDataJson === undefined ? '{}' : body.structuredDataJson;
            if (typeof rawStructured !== 'string' || rawStructured.length > 50_000) throw new HttpError(400, 'structuredDataJson must be a JSON string of 50000 characters or fewer');
            let structuredValue: unknown;
            try { structuredValue = JSON.parse(rawStructured); } catch { throw new HttpError(400, 'structuredDataJson is invalid JSON'); }
            if (!structuredValue || typeof structuredValue !== 'object' || Array.isArray(structuredValue)) throw new HttpError(400, 'structuredDataJson must encode an object');
            const structuredDataJson = canonicalJson(structuredValue);
            const paragraphPreview = content.split(/\r?\n\s*\r?\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
            const evidenceInputs = parseP09EvidenceInputs(body.evidenceLinks, paragraphPreview.length);
            const validation = validateP09Paragraphs(content, evidenceInputs);

            const validatedLinks: Array<P09EvidenceInput & {
              id: string;
              sourceDocumentVersionId: string | null;
              sourceMeetingId: string | null;
              sourceSha256: string;
              sourceVersion: number;
            }> = [];
            for (const evidence of evidenceInputs) {
              if (evidence.sourceType === 'DOCUMENT') {
                const version = await db.documentVersion.findUnique({ where: { id: evidence.sourceId }, include: { document: true } });
                if (!version || version.document.deletedAt || version.document.caseId !== p09Report.caseId) {
                  throw new HttpError(403, 'Document evidence does not belong to this case');
                }
                const storedPath = safeStoragePath(uploadDir, version.storageKey);
                if (!fs.existsSync(storedPath) || !fs.statSync(storedPath).isFile()) throw new HttpError(409, 'Document evidence storage object is missing');
                const stored = fs.readFileSync(storedPath);
                const storedSha256 = crypto.createHash('sha256').update(stored).digest('hex');
                if (stored.length !== version.fileSize || storedSha256 !== version.sha256) throw new HttpError(409, 'Document evidence integrity verification failed');
                validatedLinks.push({
                  ...evidence,
                  id: `EVID-${crypto.randomUUID()}`,
                  sourceDocumentVersionId: version.id,
                  sourceMeetingId: null,
                  sourceSha256: version.sha256,
                  sourceVersion: version.versionNumber
                });
              } else {
                const meeting = await db.meeting.findUnique({ where: { id: evidence.sourceId } });
                if (!meeting || meeting.caseId !== p09Report.caseId) throw new HttpError(403, 'Meeting evidence does not belong to this case');
                if (meeting.status !== 'FINAL' || !meeting.rawText || !meeting.rawTextSha256) throw new HttpError(409, 'Meeting evidence must be a finalized transcript');
                const actualSha256 = crypto.createHash('sha256').update(meeting.rawText).digest('hex');
                if (actualSha256 !== meeting.rawTextSha256) throw new HttpError(409, 'Meeting evidence integrity verification failed');
                validatedLinks.push({
                  ...evidence,
                  id: `EVID-${crypto.randomUUID()}`,
                  sourceDocumentVersionId: null,
                  sourceMeetingId: meeting.id,
                  sourceSha256: meeting.rawTextSha256,
                  sourceVersion: meeting.version
                });
              }
            }

            const evidenceMaterial = validatedLinks.map((entry) => ({
              sourceType: entry.sourceType,
              sourceId: entry.sourceId,
              sourceSha256: entry.sourceSha256,
              sourceVersion: entry.sourceVersion,
              targetParagraphIndex: entry.targetParagraphIndex,
              quoteText: entry.quoteText,
              anchorPosition: entry.anchorPosition
            })).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
            const revisionMaterial = { title, content, structuredData: structuredValue, evidence: evidenceMaterial };
            const revisionSha256 = crypto.createHash('sha256').update(canonicalJson(revisionMaterial)).digest('hex');
            const inputSha256 = crypto.createHash('sha256').update(canonicalJson({ ...revisionMaterial, expectedVersion })).digest('hex');
            const revisionId = `SECREV-${crypto.randomUUID()}`;

            const created = await db.$transaction(async (tx) => {
              const lock = await tx.reportSection.updateMany({
                where: { id: p09SectionId, reportId: p09ReportId, deletedAt: null, version: expectedVersion, status: { not: 'APPROVED' } },
                data: { version: { increment: 1 }, status: 'DRAFT', updatedAt: new Date() }
              });
              if (lock.count !== 1) {
                const current = await tx.reportSection.findUnique({
                  where: { id: p09SectionId },
                  include: { revisions: { orderBy: { revisionNumber: 'desc' }, take: 1 } }
                });
                throw new HttpError(409, 'Concurrency conflict: section has changed', {
                  currentVersion: current?.version ?? null,
                  latestRevision: current?.revisions[0] ?? null
                });
              }
              const latest = await tx.reportSectionRevision.findFirst({ where: { sectionId: p09SectionId }, orderBy: { revisionNumber: 'desc' } });
              const revisionNumber = (latest?.revisionNumber ?? 0) + 1;
              await tx.reportSectionRevision.create({
                data: {
                  id: revisionId,
                  sectionId: p09SectionId,
                  revisionNumber,
                  title,
                  content,
                  structuredDataJson,
                  validationStatus: validation.status,
                  validationErrorsJson: JSON.stringify(validation.errors),
                  inputSha256,
                  sha256: revisionSha256,
                  authorId: context.user.id
                }
              });
              for (const evidence of validatedLinks) {
                await tx.reportEvidenceLink.create({
                  data: {
                    id: evidence.id,
                    revisionId,
                    sourceType: evidence.sourceType,
                    sourceId: evidence.sourceId,
                    sourceDocumentVersionId: evidence.sourceDocumentVersionId,
                    sourceMeetingId: evidence.sourceMeetingId,
                    sourceSha256: evidence.sourceSha256,
                    sourceVersion: evidence.sourceVersion,
                    targetParagraphIndex: evidence.targetParagraphIndex,
                    quoteText: evidence.quoteText,
                    anchorPosition: evidence.anchorPosition
                  }
                });
              }
              await tx.auditLog.create({
                data: requestAudit(context, 'REPORT_SECTION_REVISION_CREATED', 'ReportSectionRevision', revisionId, {
                  reportId: p09ReportId,
                  sectionId: p09SectionId,
                  revisionNumber,
                  revisionSha256,
                  validationStatus: validation.status,
                  evidenceCount: validatedLinks.length,
                  saveMode: body.saveMode === 'AUTO' ? 'AUTO' : 'MANUAL'
                })
              });
              return tx.reportSectionRevision.findUniqueOrThrow({
                where: { id: revisionId },
                include: { author: { select: { id: true, name: true, email: true } }, evidenceLinks: true }
              });
            });
            sendJson(res, 201, { revision: created, sectionVersion: expectedVersion + 1 });
            return;
          }

          if (p09SectionId && sectionAction === 'comments' && !childId && req.method === 'POST') {
            const section = p09Report.sections.find((entry) => entry.id === p09SectionId);
            if (!section) throw new HttpError(404, 'Report section not found');
            const body = await readJson(req);
            assertOnlyKeys(body, new Set(['commentType', 'content', 'revisionId', 'expectedVersion']), 'comment');
            if (body.commentType !== 'COMMENT' && body.commentType !== 'REVISION_REQUEST') throw new HttpError(400, 'commentType is invalid');
            const commentType = body.commentType;
            const content = normalizedBoundedText(body.content, 'content', 4000) as string;
            const revisionId = body.revisionId === undefined || body.revisionId === null
              ? null
              : normalizedBoundedText(body.revisionId, 'revisionId', 200) as string;
            if (revisionId && !section.revisions.some((revision) => revision.id === revisionId)) throw new HttpError(400, 'Comment revision does not belong to the section');
            if (commentType === 'REVISION_REQUEST' && section.status === 'APPROVED') throw new HttpError(409, 'Unlock an approved section before requesting a revision');
            const expectedVersion = commentType === 'REVISION_REQUEST' ? requiredPositiveInteger(body.expectedVersion, 'expectedVersion') : null;

            const comment = await db.$transaction(async (tx) => {
              if (commentType === 'REVISION_REQUEST') {
                const updated = await tx.reportSection.updateMany({
                  where: { id: p09SectionId, reportId: p09ReportId, version: expectedVersion as number, status: { not: 'APPROVED' } },
                  data: { status: 'REJECTED', version: { increment: 1 } }
                });
                if (updated.count !== 1) throw new HttpError(409, 'Concurrency conflict while requesting revision');
              }
              const created = await tx.reportSectionComment.create({
                data: { id: `CMT-${crypto.randomUUID()}`, sectionId: p09SectionId, revisionId, authorId: context.user.id, commentType, content }
              });
              await tx.auditLog.create({
                data: requestAudit(context, 'REPORT_SECTION_COMMENT_CREATED', 'ReportSectionComment', created.id, {
                  reportId: p09ReportId, sectionId: p09SectionId, commentType, revisionId
                })
              });
              return tx.reportSectionComment.findUniqueOrThrow({
                where: { id: created.id }, include: { author: { select: { id: true, name: true, email: true } } }
              });
            });
            sendJson(res, 201, { comment, sectionVersion: expectedVersion === null ? section.version : expectedVersion + 1 });
            return;
          }

          if (p09SectionId && sectionAction === 'comments' && childId && childAction === 'resolve' && req.method === 'PATCH') {
            requireAnyRole(context, new Set(['admin', 'director', 'reviewer', 'pm', 'staff']), 'Comment resolution forbidden');
            const body = await readJson(req);
            assertOnlyKeys(body, new Set(), 'comment resolution');
            const resolved = await db.$transaction(async (tx) => {
              const updated = await tx.reportSectionComment.updateMany({
                where: { id: childId, sectionId: p09SectionId, isResolved: false },
                data: { isResolved: true, resolvedById: context.user.id, resolvedAt: new Date() }
              });
              if (updated.count !== 1) throw new HttpError(409, 'Comment is missing or already resolved');
              await tx.auditLog.create({
                data: requestAudit(context, 'REPORT_SECTION_COMMENT_RESOLVED', 'ReportSectionComment', childId, {
                  reportId: p09ReportId, sectionId: p09SectionId
                })
              });
              return tx.reportSectionComment.findUniqueOrThrow({ where: { id: childId } });
            });
            sendJson(res, 200, { comment: resolved });
            return;
          }

          if (p09SectionId && sectionAction === 'approve' && req.method === 'POST') {
            requireAnyRole(context, new Set(['admin', 'director', 'reviewer']), 'Section approval requires Reviewer, Director, or Admin role');
            const section = p09Report.sections.find((entry) => entry.id === p09SectionId);
            if (!section) throw new HttpError(404, 'Report section not found');
            if (section.status === 'APPROVED') throw new HttpError(409, 'Section is already approved');
            const body = await readJson(req);
            assertOnlyKeys(body, new Set(['revisionId', 'comment', 'expectedVersion']), 'approval');
            const expectedVersion = requiredPositiveInteger(body.expectedVersion, 'expectedVersion');
            const revisionId = normalizedBoundedText(body.revisionId, 'revisionId', 200) as string;
            const comment = normalizedBoundedText(body.comment, 'comment', 4000, false);
            const target = section.revisions.find((revision) => revision.id === revisionId);
            if (!target) throw new HttpError(400, 'Approval revision does not belong to the section');
            if (target.id !== section.revisions[0]?.id) throw new HttpError(409, 'Only the latest revision can be approved');
            if (target.authorId === context.user.id) throw new HttpError(403, 'Self-approval is strictly forbidden');
            if (target.validationStatus !== 'VALID') throw new HttpError(409, 'Only a VALID revision can be approved');
            if (section.comments.some((entry) => entry.commentType === 'REVISION_REQUEST' && !entry.isResolved)) {
              throw new HttpError(409, 'Resolve all revision requests before approval');
            }

            const approval = await db.$transaction(async (tx) => {
              const latestEvent = await tx.reportSectionApproval.findFirst({ where: { sectionId: p09SectionId }, orderBy: { eventNumber: 'desc' } });
              const eventNumber = (latestEvent?.eventNumber ?? 0) + 1;
              const created = await tx.reportSectionApproval.create({
                data: {
                  id: `APPR-${crypto.randomUUID()}`,
                  sectionId: p09SectionId,
                  approvedRevisionId: revisionId,
                  approverId: context.user.id,
                  eventNumber,
                  status: 'APPROVED',
                  comment
                }
              });
              const locked = await tx.reportSection.updateMany({
                where: { id: p09SectionId, reportId: p09ReportId, version: expectedVersion, status: { not: 'APPROVED' } },
                data: { status: 'APPROVED', version: { increment: 1 }, updatedAt: new Date() }
              });
              if (locked.count !== 1) throw new HttpError(409, 'Concurrency conflict while approving section');
              await tx.auditLog.create({
                data: requestAudit(context, 'REPORT_SECTION_APPROVED', 'ReportSectionApproval', created.id, {
                  reportId: p09ReportId, sectionId: p09SectionId, revisionId, eventNumber
                })
              });
              return tx.reportSectionApproval.findUniqueOrThrow({
                where: { id: created.id },
                include: {
                  approver: { select: { id: true, name: true, email: true } },
                  approvedRevision: { select: { id: true, revisionNumber: true, sha256: true } }
                }
              });
            });
            sendJson(res, 200, { approval, sectionStatus: 'APPROVED', sectionVersion: expectedVersion + 1 });
            return;
          }

          if (p09SectionId && sectionAction === 'unlock' && req.method === 'POST') {
            requireAnyRole(context, new Set(['admin', 'director', 'reviewer']), 'Section unlock requires Reviewer, Director, or Admin role');
            const section = p09Report.sections.find((entry) => entry.id === p09SectionId);
            if (!section) throw new HttpError(404, 'Report section not found');
            if (section.status !== 'APPROVED') throw new HttpError(409, 'Only an APPROVED section can be unlocked');
            const body = await readJson(req);
            assertOnlyKeys(body, new Set(['comment', 'expectedVersion']), 'unlock');
            const expectedVersion = requiredPositiveInteger(body.expectedVersion, 'expectedVersion');
            const comment = normalizedBoundedText(body.comment, 'comment', 4000) as string;
            const latestApproval = section.approvals[0];
            if (!latestApproval || latestApproval.status !== 'APPROVED') throw new HttpError(409, 'Latest approval event is missing');

            const unlock = await db.$transaction(async (tx) => {
              const eventNumber = latestApproval.eventNumber + 1;
              const created = await tx.reportSectionApproval.create({
                data: {
                  id: `UNLK-${crypto.randomUUID()}`,
                  sectionId: p09SectionId,
                  approvedRevisionId: latestApproval.approvedRevisionId,
                  approverId: context.user.id,
                  eventNumber,
                  status: 'UNLOCKED',
                  comment
                }
              });
              const unlocked = await tx.reportSection.updateMany({
                where: { id: p09SectionId, reportId: p09ReportId, version: expectedVersion, status: 'APPROVED' },
                data: { status: 'DRAFT', version: { increment: 1 }, updatedAt: new Date() }
              });
              if (unlocked.count !== 1) throw new HttpError(409, 'Concurrency conflict while unlocking section');
              await tx.auditLog.create({
                data: requestAudit(context, 'REPORT_SECTION_UNLOCKED', 'ReportSectionApproval', created.id, {
                  reportId: p09ReportId, sectionId: p09SectionId, eventNumber, reason: comment
                })
              });
              return tx.reportSectionApproval.findUniqueOrThrow({
                where: { id: created.id },
                include: {
                  approver: { select: { id: true, name: true, email: true } },
                  approvedRevision: { select: { id: true, revisionNumber: true, sha256: true } }
                }
              });
            });
            sendJson(res, 200, { unlock, sectionStatus: 'DRAFT', sectionVersion: expectedVersion + 1 });
            return;
          }

          if (reportAction === 'merge' && req.method === 'POST') {
            requireAnyRole(context, new Set(['admin', 'pm', 'director']), 'Report merge forbidden');
            const body = await readJson(req);
            assertOnlyKeys(body, new Set(['expectedReportVersion']), 'merge');
            const expectedReportVersion = requiredPositiveInteger(body.expectedReportVersion, 'expectedReportVersion');

            const snapshot = await db.$transaction(async (tx) => {
              const reportLock = await tx.report.updateMany({
                where: { id: p09ReportId, reportInstanceId: { not: null }, deletedAt: null, version: expectedReportVersion },
                data: { version: { increment: 1 }, updatedAt: new Date() }
              });
              if (reportLock.count !== 1) throw new HttpError(409, 'Concurrency conflict while merging report');
              const sections = await tx.reportSection.findMany({
                where: { reportId: p09ReportId, deletedAt: null },
                orderBy: { sectionNumber: 'asc' },
                include: {
                  revisions: {
                    orderBy: { revisionNumber: 'desc' },
                    include: { evidenceLinks: { orderBy: [{ targetParagraphIndex: 'asc' }, { sourceType: 'asc' }, { sourceId: 'asc' }] } }
                  },
                  approvals: { orderBy: { eventNumber: 'desc' } },
                  comments: { where: { commentType: 'REVISION_REQUEST', isResolved: false } }
                }
              });
              if (sections.length === 0) throw new HttpError(409, 'Report has no sections');
              const sectionSnapshots = sections.map((section) => {
                const latestRevision = section.revisions[0];
                const latestEvent = section.approvals[0];
                if (section.status !== 'APPROVED' || !latestRevision || latestRevision.validationStatus !== 'VALID'
                  || !latestEvent || latestEvent.status !== 'APPROVED' || latestEvent.approvedRevisionId !== latestRevision.id
                  || section.comments.length > 0) {
                  throw new HttpError(409, `Section ${section.sectionNumber} does not have a latest, valid, fully approved revision`);
                }
                const evidence = latestRevision.evidenceLinks.map((link) => ({
                  sourceType: link.sourceType,
                  sourceId: link.sourceId,
                  sourceSha256: link.sourceSha256,
                  sourceVersion: link.sourceVersion,
                  targetParagraphIndex: link.targetParagraphIndex,
                  quoteText: link.quoteText,
                  anchorPosition: link.anchorPosition
                }));
                return {
                  sectionId: section.id,
                  sectionNumber: section.sectionNumber,
                  title: section.title,
                  revisionId: latestRevision.id,
                  revisionNumber: latestRevision.revisionNumber,
                  revisionSha256: latestRevision.sha256,
                  content: latestRevision.content,
                  evidence
                };
              });
              const mergedBodyText = sectionSnapshots.map((section) => `## ${section.sectionNumber}. ${section.title}\n\n${section.content}`).join('\n\n---\n\n');
              const evidenceSnapshot = sectionSnapshots.flatMap((section) => section.evidence.map((evidence) => ({ sectionId: section.sectionId, ...evidence })));
              const latestSnapshot = await tx.reportMergeSnapshot.findFirst({ where: { reportId: p09ReportId }, orderBy: { snapshotVersion: 'desc' } });
              const snapshotVersion = (latestSnapshot?.snapshotVersion ?? 0) + 1;
              const snapshotMaterial = {
                reportId: p09ReportId,
                reportInstanceId: p09Report.reportInstanceId,
                snapshotVersion,
                sections: sectionSnapshots,
                evidence: evidenceSnapshot,
                mergedBodyText
              };
              const snapshotSha256 = crypto.createHash('sha256').update(canonicalJson(snapshotMaterial)).digest('hex');
              const created = await tx.reportMergeSnapshot.create({
                data: {
                  id: `MRGSNAP-${crypto.randomUUID()}`,
                  reportId: p09ReportId,
                  snapshotVersion,
                  mergedBodyText,
                  sectionsSnapshotJson: canonicalJson(sectionSnapshots),
                  evidenceSnapshotJson: canonicalJson(evidenceSnapshot),
                  snapshotSha256,
                  createdById: context.user.id
                }
              });
              await tx.auditLog.create({
                data: requestAudit(context, 'REPORT_MERGE_SNAPSHOT_CREATED', 'ReportMergeSnapshot', created.id, {
                  reportId: p09ReportId,
                  reportInstanceId: p09Report.reportInstanceId,
                  snapshotVersion,
                  snapshotSha256,
                  sectionCount: sectionSnapshots.length
                })
              });
              return tx.reportMergeSnapshot.findUniqueOrThrow({
                where: { id: created.id },
                include: { createdBy: { select: { id: true, name: true } } }
              });
            });
            sendJson(res, 201, { snapshot, reportVersion: expectedReportVersion + 1 });
            return;
          }

          throw new HttpError(405, 'Method not allowed for P09 studio route');
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

      // --- P07 Proposal Template & Writer Endpoints ---
      const proposalMatch = pathname.match(/^\/api\/cases\/([^/]+)\/proposals(?:\/([^/]+)(?:\/(versions|reviews|render))?)?$/);
      if (proposalMatch) {
        const [, caseId, proposalId, action] = proposalMatch;
        const caseRow = await db.caseItem.findUnique({
          where: { id: caseId },
          include: {
            assignedUser: { select: { id: true, name: true } },
            parties: { orderBy: { createdAt: 'asc' }, take: 1 }
          }
        });
        if (!caseRow || caseRow.deletedAt) throw new HttpError(404, 'Case not found');
        if (caseRow.organizationId !== context.user.organizationId) throw new HttpError(403, 'Case access forbidden');
        if (!(await canAccessCase(db, context, caseId))) throw new HttpError(403, 'Case assignment required');

        if (!proposalId && req.method === 'GET') {
          const proposals = await db.proposal.findMany({
            where: { caseId, deletedAt: null },
            include: {
              template: true,
              versions: { orderBy: { versionNumber: 'desc' } },
              reviews: {
                orderBy: { createdAt: 'desc' },
                include: { reviewer: { select: { id: true, name: true, email: true } } }
              }
            },
            orderBy: { createdAt: 'desc' }
          });
          sendJson(res, 200, { proposals });
          return;
        }

        if (!proposalId && req.method === 'POST') {
          requireAnyRole(context, PROPOSAL_EDITOR_ROLES, 'Proposal creation forbidden');
          const body = await readJson(req);
          const templateId = typeof body.templateId === 'string' ? body.templateId.trim() : '';
          const titleInput = typeof body.title === 'string' ? body.title.trim() : '';
          if (!templateId) throw new HttpError(400, 'Proposal templateId is required');
          const template = await db.proposalTemplate.findUnique({ where: { id: templateId } });
          if (!template) throw new HttpError(404, 'Proposal template not found');
          if (template.claimType !== caseRow.claimType) throw new HttpError(400, 'Proposal template claim type must match the case');
          const declaredPlaceholders = parseStringArray(template.placeholdersJson, 'Template placeholders');
          if (declaredPlaceholders.some((key) => !ALLOWED_PROPOSAL_PLACEHOLDERS.has(key))) {
            throw new HttpError(409, 'Proposal template declares an unsupported placeholder');
          }
          const title = titleInput || `${caseRow.title} 제안서`;
          if (title.length > 500) throw new HttpError(400, 'Proposal title must be 500 characters or fewer');

          const structuredInputs = { background: '', objective: '', method: '', expectedOutcome: '', exclusions: '' };
          const renderedValues: Record<string, string> = {
            CASE_NUMBER: caseRow.caseNumber,
            CASE_TITLE: caseRow.title,
            CLAIM_TYPE: caseRow.claimType,
            ASSIGNED_USER: caseRow.assignedUser?.name ?? context.user.name,
            CLIENT_NAME: caseRow.parties[0]?.name ?? '',
            CREATED_DATE: getKstDateString(new Date())
          };
          const { rendered, missing } = renderProposalTemplate(template.bodyTemplate, renderedValues);
          const proposalIdNew = `PROP-${crypto.randomUUID()}`;
          const proposalVersionId = `PROPVER-${crypto.randomUUID()}`;
          const renderedHash = crypto.createHash('sha256').update(rendered).digest('hex');

          const proposal = await db.$transaction(async (tx) => {
            await tx.proposal.create({
              data: {
                id: proposalIdNew,
                caseId,
                templateId,
                templateVersionSnapshot: template.version,
                templateBodySnapshot: template.bodyTemplate,
                templatePlaceholdersSnapshotJson: template.placeholdersJson,
                title,
                status: 'DRAFT',
                version: 1,
                createdById: context.user.id,
                updatedById: context.user.id
              }
            });
            await tx.proposalVersion.create({
              data: {
                id: proposalVersionId,
                proposalId: proposalIdNew,
                versionNumber: 1,
                bodyText: rendered,
                structuredInputsJson: JSON.stringify(structuredInputs),
                renderedValuesJson: JSON.stringify(renderedValues),
                missingFieldsJson: JSON.stringify(missing),
                generationMode: 'MANUAL',
                inputSha256: proposalInputHash({ structuredInputs, renderedValues, sourceDocumentVersionIds: [] }),
                sourceDocumentVersionIdsJson: JSON.stringify([]),
                sha256: renderedHash,
                createdById: context.user.id
              }
            });
            await tx.proposal.update({ where: { id: proposalIdNew }, data: { currentVersionId: proposalVersionId } });
            await tx.auditLog.create({
              data: requestAudit(context, 'PROPOSAL_CREATED', 'Proposal', proposalIdNew, {
                caseId, templateId, templateVersion: template.version, proposalVersionId
              })
            });
            return tx.proposal.findUniqueOrThrow({ where: { id: proposalIdNew }, include: { versions: true, template: true } });
          });
          sendJson(res, 201, { proposal });
          return;
        }

        if (proposalId && !action && req.method === 'GET') {
          const proposal = await db.proposal.findUnique({
            where: { id: proposalId },
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

        if (proposalId && action === 'versions' && req.method === 'POST') {
          requireAnyRole(context, PROPOSAL_EDITOR_ROLES, 'Proposal version creation forbidden');
          const proposal = await db.proposal.findUnique({
            where: { id: proposalId },
            include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } }
          });
          if (!proposal || proposal.caseId !== caseId || proposal.deletedAt) throw new HttpError(404, 'Proposal not found');
          if (!['DRAFT', 'REJECTED'].includes(proposal.status)) throw new HttpError(409, 'Proposal cannot be edited in its current status');

          const body = await readJson(req);
          if (['apiKey', 'token', 'secret', 'credential'].some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
            throw new HttpError(400, 'AI credentials are not accepted by the proposal API');
          }
          const structuredInputs = {
            background: typeof body.background === 'string' ? body.background.trim() : '',
            objective: typeof body.objective === 'string' ? body.objective.trim() : '',
            method: typeof body.method === 'string' ? body.method.trim() : '',
            expectedOutcome: typeof body.expectedOutcome === 'string' ? body.expectedOutcome.trim() : '',
            exclusions: typeof body.exclusions === 'string' ? body.exclusions.trim() : ''
          };
          if (Object.values(structuredInputs).some((value) => !value)) throw new HttpError(400, 'All five proposal inputs are required');
          if (Object.values(structuredInputs).some((value) => value.length > 50_000)) throw new HttpError(400, 'Proposal input exceeds the 50000 character limit');
          const generationMode = body.generationMode;
          if (generationMode !== 'MANUAL' && generationMode !== 'AI') throw new HttpError(400, 'generationMode must be MANUAL or AI');
          const expectedVersion = typeof body.version === 'number' && Number.isInteger(body.version) ? body.version : -1;
          if (expectedVersion < 1) throw new HttpError(400, 'A positive proposal version is required');
          if (body.sourceDocumentVersionIds !== undefined && !Array.isArray(body.sourceDocumentVersionIds)) {
            throw new HttpError(400, 'sourceDocumentVersionIds must be an array');
          }
          const sourceIds = (body.sourceDocumentVersionIds ?? []) as unknown[];
          if (!sourceIds.every((id) => typeof id === 'string' && id.trim().length > 0)) throw new HttpError(400, 'Source document version IDs must be non-empty strings');
          const sourceDocumentVersionIds = sourceIds.map((id) => (id as string).trim());

          let providerId: string | null = null;
          let modelId: string | null = null;
          let promptConfigVersion: string | null = null;
          let generatedAt: Date | null = null;
          if (generationMode === 'AI') {
            providerId = typeof body.providerId === 'string' ? body.providerId.trim() : '';
            modelId = typeof body.modelId === 'string' ? body.modelId.trim() : '';
            if (!ALLOWED_AI_PROVIDERS.get(providerId)?.has(modelId)) throw new HttpError(400, 'Unsupported deterministic AI provider or model');
            promptConfigVersion = 'p07-local-v1';
            generatedAt = new Date();
          } else if (body.providerId || body.modelId) {
            throw new HttpError(400, 'Manual proposal mode must not include provider or model identifiers');
          }

          await verifyProposalSources(db, uploadDir, caseId, sourceDocumentVersionIds);
          const renderedValues: Record<string, string> = {
            CASE_NUMBER: caseRow.caseNumber,
            CASE_TITLE: caseRow.title,
            CLAIM_TYPE: caseRow.claimType,
            ASSIGNED_USER: caseRow.assignedUser?.name ?? context.user.name,
            CLIENT_NAME: caseRow.parties[0]?.name ?? '',
            CREATED_DATE: getKstDateString(new Date()),
            BACKGROUND: generationMode === 'AI' ? `[AI_DRAFT] ${structuredInputs.background}` : structuredInputs.background,
            OBJECTIVE: structuredInputs.objective,
            METHOD: structuredInputs.method,
            EXPECTED_OUTCOME: structuredInputs.expectedOutcome,
            EXCLUSIONS: structuredInputs.exclusions
          };
          const { rendered, missing } = renderProposalTemplate(proposal.templateBodySnapshot, renderedValues);
          const nextVersionNumber = (proposal.versions[0]?.versionNumber ?? 0) + 1;
          const proposalVersionId = `PROPVER-${crypto.randomUUID()}`;
          const inputSha256 = proposalInputHash({
            structuredInputs, renderedValues, generationMode, providerId, modelId, promptConfigVersion, sourceDocumentVersionIds
          });
          const sha256 = crypto.createHash('sha256').update(rendered).digest('hex');

          const createdVersion = await db.$transaction(async (tx) => {
            const changed = await tx.proposal.updateMany({
              where: { id: proposalId, version: expectedVersion, status: proposal.status, deletedAt: null },
              data: { status: 'DRAFT', version: { increment: 1 }, updatedById: context.user.id }
            });
            if (changed.count !== 1) throw new HttpError(409, 'Proposal concurrency conflict');
            const created = await tx.proposalVersion.create({
              data: {
                id: proposalVersionId,
                proposalId,
                versionNumber: nextVersionNumber,
                bodyText: rendered,
                structuredInputsJson: JSON.stringify(structuredInputs),
                renderedValuesJson: JSON.stringify(renderedValues),
                missingFieldsJson: JSON.stringify(missing),
                generationMode,
                providerId,
                modelId,
                promptConfigVersion,
                inputSha256,
                generatedAt,
                sourceDocumentVersionIdsJson: JSON.stringify(sourceDocumentVersionIds),
                sha256,
                createdById: context.user.id
              }
            });
            await tx.proposal.update({ where: { id: proposalId }, data: { currentVersionId: proposalVersionId } });
            await tx.auditLog.create({
              data: requestAudit(context, 'PROPOSAL_VERSION_CREATED', 'ProposalVersion', proposalVersionId, {
                proposalId, versionNumber: nextVersionNumber, generationMode, providerId, modelId,
                inputSha256, sha256, sourceDocumentVersionIds
              })
            });
            return created;
          });
          sendJson(res, 201, { version: createdVersion, proposalVersion: expectedVersion + 1 });
          return;
        }

        if (proposalId && action === 'reviews' && req.method === 'POST') {
          const proposal = await db.proposal.findUnique({ where: { id: proposalId }, include: { versions: true } });
          if (!proposal || proposal.caseId !== caseId || proposal.deletedAt) throw new HttpError(404, 'Proposal not found');
          const body = await readJson(req);
          const reviewAction = typeof body.action === 'string' ? body.action.trim() : '';
          const targetVersionId = typeof body.versionId === 'string' ? body.versionId.trim() : '';
          const expectedVersion = typeof body.version === 'number' && Number.isInteger(body.version) ? body.version : -1;
          const comment = typeof body.comment === 'string' ? body.comment.trim() : null;
          if (expectedVersion < 1) throw new HttpError(400, 'A positive proposal version is required');
          if (!targetVersionId || targetVersionId !== proposal.currentVersionId) throw new HttpError(409, 'Review action must target the current proposal version');
          const targetVersion = proposal.versions.find((version) => version.id === targetVersionId);
          if (!targetVersion) throw new HttpError(404, 'Proposal version not found');

          if (reviewAction === 'REQUEST_REVIEW') {
            requireAnyRole(context, PROPOSAL_EDITOR_ROLES, 'Proposal review request forbidden');
            if (proposal.status !== 'DRAFT') throw new HttpError(409, 'Only a DRAFT proposal can request review');
            if (targetVersion.generationMode === 'AI' || targetVersion.bodyText.includes('[AI_DRAFT]')) {
              throw new HttpError(409, 'AI draft must be saved as a human-edited MANUAL version before review');
            }
            if (parseStringArray(targetVersion.missingFieldsJson, 'Missing fields').length > 0) throw new HttpError(409, 'Proposal has unresolved missing fields');
            if (crypto.createHash('sha256').update(targetVersion.bodyText).digest('hex') !== targetVersion.sha256) throw new HttpError(409, 'Proposal version integrity verification failed');
            await verifyProposalSources(db, uploadDir, caseId, parseStringArray(targetVersion.sourceDocumentVersionIdsJson, 'Source document IDs'));
            await db.$transaction(async (tx) => {
              const changed = await tx.proposal.updateMany({
                where: { id: proposalId, version: expectedVersion, status: 'DRAFT', currentVersionId: targetVersionId },
                data: { status: 'IN_REVIEW', version: { increment: 1 }, updatedById: context.user.id }
              });
              if (changed.count !== 1) throw new HttpError(409, 'Proposal concurrency conflict');
              await tx.proposalReview.create({
                data: { id: `PROPREV-${crypto.randomUUID()}`, proposalId, versionId: targetVersionId, reviewerId: context.user.id, action: 'REQUEST_REVIEW', comment }
              });
              await tx.auditLog.create({ data: requestAudit(context, 'PROPOSAL_REVIEW_REQUESTED', 'Proposal', proposalId, { versionId: targetVersionId }) });
            });
            sendJson(res, 200, { status: 'IN_REVIEW', version: expectedVersion + 1 });
            return;
          }

          if (reviewAction === 'APPROVE') {
            requireAnyRole(context, PROPOSAL_APPROVER_ROLES, 'Proposal approval forbidden');
            if (targetVersion.createdById === context.user.id) throw new HttpError(403, 'Proposal version creator cannot self-approve');
            if (proposal.status !== 'IN_REVIEW') throw new HttpError(409, 'Only an IN_REVIEW proposal can be approved');
            if (targetVersion.isApproved) throw new HttpError(409, 'Proposal version is already approved');
            if (targetVersion.generationMode !== 'MANUAL' || targetVersion.bodyText.includes('[AI_DRAFT]')) throw new HttpError(409, 'AI draft cannot be approved directly');
            if (parseStringArray(targetVersion.missingFieldsJson, 'Missing fields').length > 0) throw new HttpError(409, 'Proposal has unresolved missing fields');
            if (crypto.createHash('sha256').update(targetVersion.bodyText).digest('hex') !== targetVersion.sha256) throw new HttpError(409, 'Proposal version integrity verification failed');
            await verifyProposalSources(db, uploadDir, caseId, parseStringArray(targetVersion.sourceDocumentVersionIdsJson, 'Source document IDs'));
            await db.$transaction(async (tx) => {
              await tx.proposalVersion.update({ where: { id: targetVersionId }, data: { isApproved: true } });
              const changed = await tx.proposal.updateMany({
                where: { id: proposalId, version: expectedVersion, status: 'IN_REVIEW', currentVersionId: targetVersionId },
                data: { status: 'APPROVED', approvedVersionId: targetVersionId, version: { increment: 1 }, updatedById: context.user.id }
              });
              if (changed.count !== 1) throw new HttpError(409, 'Proposal concurrency conflict');
              await tx.proposalReview.create({
                data: { id: `PROPREV-${crypto.randomUUID()}`, proposalId, versionId: targetVersionId, reviewerId: context.user.id, action: 'APPROVE', comment }
              });
              await tx.auditLog.create({ data: requestAudit(context, 'PROPOSAL_APPROVED', 'Proposal', proposalId, { versionId: targetVersionId }) });
            });
            sendJson(res, 200, { status: 'APPROVED', version: expectedVersion + 1 });
            return;
          }

          if (reviewAction === 'REJECT') {
            requireAnyRole(context, PROPOSAL_APPROVER_ROLES, 'Proposal rejection forbidden');
            if (proposal.status !== 'IN_REVIEW') throw new HttpError(409, 'Only an IN_REVIEW proposal can be rejected');
            if (!comment) throw new HttpError(400, 'A rejection comment is required');
            await db.$transaction(async (tx) => {
              const changed = await tx.proposal.updateMany({
                where: { id: proposalId, version: expectedVersion, status: 'IN_REVIEW', currentVersionId: targetVersionId },
                data: { status: 'REJECTED', version: { increment: 1 }, updatedById: context.user.id }
              });
              if (changed.count !== 1) throw new HttpError(409, 'Proposal concurrency conflict');
              await tx.proposalReview.create({
                data: { id: `PROPREV-${crypto.randomUUID()}`, proposalId, versionId: targetVersionId, reviewerId: context.user.id, action: 'REJECT', comment }
              });
              await tx.auditLog.create({ data: requestAudit(context, 'PROPOSAL_REJECTED', 'Proposal', proposalId, { versionId: targetVersionId, comment }) });
            });
            sendJson(res, 200, { status: 'REJECTED', version: expectedVersion + 1 });
            return;
          }

          throw new HttpError(400, 'Review action must be REQUEST_REVIEW, APPROVE, or REJECT');
        }

        if (proposalId && action === 'render' && req.method === 'POST') {
          const proposal = await db.proposal.findUnique({
            where: { id: proposalId },
            include: {
              versions: true,
              reviews: {
                where: { action: 'APPROVE' },
                orderBy: { createdAt: 'desc' },
                include: { reviewer: { select: { id: true, name: true } } }
              }
            }
          });
          if (!proposal || proposal.caseId !== caseId || proposal.deletedAt) throw new HttpError(404, 'Proposal not found');
          if (proposal.status !== 'APPROVED' || !proposal.approvedVersionId) throw new HttpError(403, 'Proposal must be APPROVED before rendering final document');
          const body = await readJson(req);
          const format = body.format;
          if (format !== 'docx' && format !== 'pdf') throw new HttpError(400, 'Render format must be docx or pdf');
          const targetVersionId = typeof body.versionId === 'string' ? body.versionId.trim() : proposal.approvedVersionId;
          const expectedVersion = typeof body.version === 'number' && Number.isInteger(body.version) ? body.version : -1;
          if (expectedVersion < 1) throw new HttpError(400, 'A positive proposal version is required');
          if (targetVersionId !== proposal.approvedVersionId) throw new HttpError(403, 'Only the approved proposal version may be rendered');
          const targetVersion = proposal.versions.find((version) => version.id === targetVersionId);
          if (!targetVersion?.isApproved) throw new HttpError(409, 'Approved proposal version record is inconsistent');
          if (parseStringArray(targetVersion.missingFieldsJson, 'Missing fields').length > 0) throw new HttpError(409, 'Proposal has unresolved missing fields');
          if (crypto.createHash('sha256').update(targetVersion.bodyText).digest('hex') !== targetVersion.sha256) throw new HttpError(409, 'Proposal version integrity verification failed');
          await verifyProposalSources(db, uploadDir, caseId, parseStringArray(targetVersion.sourceDocumentVersionIdsJson, 'Source document IDs'));
          const approval = proposal.reviews.find((review) => review.versionId === targetVersionId);
          if (!approval) throw new HttpError(409, 'Approved proposal is missing approval history');

          const renderOptions = {
            title: proposal.title,
            caseNumber: caseRow.caseNumber,
            claimType: caseRow.claimType,
            proposalId,
            versionId: targetVersionId,
            versionNumber: targetVersion.versionNumber,
            approvedBy: approval.reviewer.name,
            approvedAt: approval.createdAt.toISOString(),
            sha256: targetVersion.sha256,
            bodyText: targetVersion.bodyText
          };
          const buffer = format === 'docx' ? generateDocxBuffer(renderOptions) : generatePdfBuffer(renderOptions);
          const parsed = format === 'docx' ? validateDocxBuffer(buffer) : validatePdfBuffer(buffer);
          if (!parsed.isValid || parsed.metadata?.ProposalId !== proposalId || parsed.metadata?.VersionId !== targetVersionId) {
            throw new HttpError(500, 'Generated document failed parser or provenance validation');
          }
          const extension = `.${format}`;
          const mimeType = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          validateFileSecurity(`proposal${extension}`, mimeType, buffer);
          const displayName = `${caseRow.caseNumber}_PROPOSAL_${sanitizeDisplayName(proposal.title)}_${getKstDateString(new Date())}_v${String(targetVersion.versionNumber).padStart(2, '0')}${extension}`;
          const storageKey = `storage-${crypto.randomUUID()}${extension}`;
          const diskPath = safeStoragePath(uploadDir, storageKey);
          fs.writeFileSync(diskPath, buffer, { flag: 'wx' });

          try {
            await db.$transaction(async (tx) => {
              const changed = await tx.proposal.updateMany({
                where: { id: proposalId, status: 'APPROVED', approvedVersionId: targetVersionId, version: expectedVersion, deletedAt: null },
                data: { version: { increment: 1 }, updatedById: context.user.id }
              });
              if (changed.count !== 1) throw new HttpError(409, 'Proposal concurrency conflict');
              const documentId = `DOC-${crypto.randomUUID()}`;
              const documentVersionId = `DOCVER-${crypto.randomUUID()}`;
              await tx.document.create({
                data: {
                  id: documentId,
                  caseId,
                  title: `${proposal.title} [승인 출력물]`,
                  category: 'PROPOSAL',
                  source: 'AUTHORED',
                  currentVersionId: null,
                  finalVersionId: null,
                  version: 1
                }
              });
              await tx.documentVersion.create({
                data: {
                  id: documentVersionId,
                  documentId,
                  versionNumber: 1,
                  originalName: `proposal${extension}`,
                  displayName,
                  storageKey,
                  fileSize: buffer.length,
                  mimeType,
                  sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
                  isFinal: true,
                  uploadedById: context.user.id
                }
              });
              await tx.document.update({
                where: { id: documentId },
                data: { currentVersionId: documentVersionId, finalVersionId: documentVersionId, proposalVersionId: targetVersionId }
              });
              await tx.proposal.update({ where: { id: proposalId }, data: { outputDocumentId: documentId } });
              await tx.auditLog.create({
                data: requestAudit(context, 'PROPOSAL_RENDERED', 'Proposal', proposalId, {
                  format, displayName, proposalVersionId: targetVersionId, outputDocumentId: documentId, documentVersionId
                })
              });
            });
          } catch (error) {
            fs.rmSync(diskPath, { force: true });
            throw error;
          }

          res.writeHead(200, {
            'Content-Type': mimeType,
            'Content-Length': buffer.length,
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(displayName)}`,
            'Cache-Control': 'no-store'
          });
          res.end(buffer);
          return;
        }
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

      // ==========================================
      // P10 AI Gateway Routes
      // ==========================================
      if (pathname === '/api/ai/providers' && req.method === 'GET') {
        if (!context.roles.includes('admin')) throw new HttpError(403, 'Admin role required');
        const configs = await db.aiProviderConfig.findMany({
          where: { organizationId: context.user.organizationId },
          orderBy: { createdAt: 'desc' }
        });
        const safeConfigs = configs.map((c) => ({
          ...c,
          secretRef: c.secretRef, // secretRef string reference only (e.g. ENV_LOCAL_FAKE_KEY)
          hasSecretConfigured: Boolean(resolveSecretReference(c.secretRef))
        }));
        sendJson(res, 200, { providers: safeConfigs });
        return;
      }

      if (pathname === '/api/ai/providers' && req.method === 'POST') {
        if (!context.roles.includes('admin')) throw new HttpError(403, 'Admin role required');
        const body = await readJson(req);
        const providerKind = String(body.providerKind || 'LOCAL_FAKE');
        const name = String(body.name || 'AI Provider');
        const baseUrl = String(body.baseUrl || 'https://localhost/fake-ai');
        const secretRef = String(body.secretRef || 'ENV_LOCAL_FAKE_KEY');
        const allowedModels = Array.isArray(body.allowedModels) ? body.allowedModels.map(String) : ['fake-claim-v1'];
        const timeoutMs = typeof body.timeoutMs === 'number' ? body.timeoutMs : 30000;
        const maxRetries = typeof body.maxRetries === 'number' ? body.maxRetries : 3;
        const dailyBudgetMicros = typeof body.dailyBudgetMicros === 'number' ? body.dailyBudgetMicros : 100000000;

        const isLocalFake = providerKind === 'LOCAL_FAKE';
        try {
          assertSafeBaseUrl(baseUrl, isLocalFake);
        } catch (err) {
          throw new HttpError(400, err instanceof Error ? err.message : 'Invalid provider base URL');
        }

        if (secretRef.startsWith('sk-') || secretRef.startsWith('key-') || secretRef.startsWith('Bearer ')) {
          throw new HttpError(400, 'Raw API key or secret cannot be stored in secretRef');
        }

        const id = typeof body.id === 'string' && body.id ? body.id : `CFG-${crypto.randomUUID()}`;
        const config = await db.aiProviderConfig.upsert({
          where: { id },
          update: {
            providerKind, name, baseUrl, secretRef,
            allowedModelsJson: JSON.stringify(allowedModels),
            timeoutMs, maxRetries, dailyBudgetMicros, version: { increment: 1 }
          },
          create: {
            id, organizationId: context.user.organizationId, providerKind, name, baseUrl, secretRef,
            status: 'ACTIVE', allowedModelsJson: JSON.stringify(allowedModels),
            timeoutMs, maxRetries, dailyBudgetMicros, version: 1
          }
        });

        await db.auditLog.create({
          data: requestAudit(context, 'AI_PROVIDER_CONFIGURED', 'AiProviderConfig', config.id, { providerKind, name })
        });

        sendJson(res, 200, { provider: config });
        return;
      }

      const aiTestMatch = pathname.match(/^\/api\/ai\/providers\/([^/]+)\/test$/);
      if (aiTestMatch && req.method === 'POST') {
        if (!context.roles.includes('admin')) throw new HttpError(403, 'Admin role required');
        const providerId = aiTestMatch[1];
        const config = await db.aiProviderConfig.findUnique({ where: { id: providerId } });
        if (!config || config.organizationId !== context.user.organizationId) throw new HttpError(404, 'Provider configuration not found');

        const secretKey = resolveSecretReference(config.secretRef);
        const testResult = await executeFakeAdapterCall(secretKey, {
          modelCode: 'fake-claim-v1',
          prompt: 'P10_PING_TEST'
        });

        await db.auditLog.create({
          data: requestAudit(context, 'AI_PROVIDER_TESTED', 'AiProviderConfig', providerId, { status: testResult.status })
        });

        sendJson(res, 200, {
          ok: testResult.status === 'SUCCESS',
          status: testResult.status,
          statusCode: testResult.statusCode,
          message: testResult.errorMessage || 'Connection test successful'
        });
        return;
      }

      if (pathname === '/api/ai/models' && req.method === 'GET') {
        const activeConfigs = await db.aiProviderConfig.findMany({
          where: { organizationId: context.user.organizationId, status: 'ACTIVE' }
        });
        const models: { providerId: string; providerKind: string; name: string; modelCode: string }[] = [];
        for (const config of activeConfigs) {
          const allowed: string[] = JSON.parse(config.allowedModelsJson || '[]');
          for (const modelCode of allowed) {
            models.push({ providerId: config.id, providerKind: config.providerKind, name: config.name, modelCode });
          }
        }
        sendJson(res, 200, { models });
        return;
      }

      const casePolicyMatch = pathname.match(/^\/api\/ai\/cases\/([^/]+)\/policy$/);
      if (casePolicyMatch) {
        const caseId = casePolicyMatch[1];
        const caseRow = await db.caseItem.findUnique({ where: { id: caseId } });
        if (!caseRow || caseRow.deletedAt) throw new HttpError(404, 'Case not found');
        if (caseRow.organizationId !== context.user.organizationId) throw new HttpError(403, 'Case access forbidden');
        if (!(await canAccessCase(db, context, caseId))) throw new HttpError(403, 'Case assignment required');

        if (req.method === 'GET') {
          const policy = await db.aiCasePolicy.findUnique({ where: { caseId } });
          sendJson(res, 200, {
            policy: policy || {
              caseId,
              externalAiAllowed: false,
              maxTokensPerRequest: 4096,
              maxCostMicrosPerRequest: 1000000,
              allowedProviderIdsJson: '[]'
            }
          });
          return;
        }

        if (req.method === 'POST' || req.method === 'PATCH') {
          if (!context.roles.some((r) => ['admin', 'pm', 'director', 'ceo'].includes(r))) {
            throw new HttpError(403, 'Policy modification forbidden');
          }
          const body = await readJson(req);
          const externalAiAllowed = Boolean(body.externalAiAllowed);
          const maxTokensPerRequest = typeof body.maxTokensPerRequest === 'number' ? body.maxTokensPerRequest : 4096;
          const maxCostMicrosPerRequest = typeof body.maxCostMicrosPerRequest === 'number' ? body.maxCostMicrosPerRequest : 1000000;

          const policy = await db.aiCasePolicy.upsert({
            where: { caseId },
            update: { externalAiAllowed, maxTokensPerRequest, maxCostMicrosPerRequest },
            create: { id: `POL-${crypto.randomUUID()}`, caseId, externalAiAllowed, maxTokensPerRequest, maxCostMicrosPerRequest }
          });

          await db.auditLog.create({
            data: requestAudit(context, 'AI_CASE_POLICY_UPDATED', 'AiCasePolicy', policy.id, { caseId, externalAiAllowed })
          });

          sendJson(res, 200, { policy });
          return;
        }
      }

      if (pathname === '/api/ai/requests' && req.method === 'POST') {
        const body = await readJson(req);
        const caseId = String(body.caseId || '');
        const providerConfigId = String(body.providerConfigId || '');
        const modelCode = String(body.modelCode || '');
        const prompt = String(body.prompt || '');
        const idempotencyKey = String(body.idempotencyKey || `IDEMP-${crypto.randomUUID()}`);
        const maxTokens = typeof body.maxTokens === 'number' ? body.maxTokens : undefined;

        if (!caseId || !providerConfigId || !modelCode || !prompt) {
          throw new HttpError(400, 'Missing required fields (caseId, providerConfigId, modelCode, prompt)');
        }

        const caseRow = await db.caseItem.findUnique({ where: { id: caseId } });
        if (!caseRow || caseRow.deletedAt) throw new HttpError(404, 'Case not found');
        if (caseRow.organizationId !== context.user.organizationId) throw new HttpError(403, 'Case access forbidden');
        if (!(await canAccessCase(db, context, caseId))) throw new HttpError(403, 'Case assignment required');

        try {
          const gatewayResult = await processAiGenerationRequest(db, {
            organizationId: context.user.organizationId,
            caseId,
            userId: context.user.id,
            providerConfigId,
            modelCode,
            prompt,
            idempotencyKey,
            maxTokens
          });

          await db.auditLog.create({
            data: requestAudit(context, 'AI_GENERATION_REQUESTED', 'AiGenerationRequest', gatewayResult.requestId, {
              status: gatewayResult.status, costMicros: gatewayResult.actualCostMicros
            })
          });

          sendJson(res, 200, { result: gatewayResult });
          return;
        } catch (err) {
          if (err instanceof AiGatewayError) {
            throw new HttpError(err.status, err.message);
          }
          if (err instanceof SsrfError) {
            throw new HttpError(400, err.message);
          }
          throw err;
        }
      }

      const aiCancelMatch = pathname.match(/^\/api\/ai\/requests\/([^/]+)\/cancel$/);
      if (aiCancelMatch && req.method === 'POST') {
        const requestId = aiCancelMatch[1];
        const reqRow = await db.aiGenerationRequest.findUnique({ where: { id: requestId } });
        if (!reqRow) throw new HttpError(404, 'Generation request not found');
        if (reqRow.organizationId !== context.user.organizationId) throw new HttpError(403, 'Request access forbidden');
        if (reqRow.userId !== context.user.id && !context.roles.includes('admin')) {
          throw new HttpError(403, 'Cannot cancel another user\'s request');
        }

        if (['COMPLETED', 'FAILED', 'CANCELED'].includes(reqRow.status)) {
          throw new HttpError(409, 'Request is already in terminal state');
        }

        await db.$transaction(async (tx) => {
          await tx.aiGenerationRequest.update({
            where: { id: requestId },
            data: { status: 'CANCELED', redactedErrorMessage: 'Canceled by user request' }
          });
          await tx.auditLog.create({
            data: requestAudit(context, 'AI_GENERATION_CANCELED', 'AiGenerationRequest', requestId, {})
          });
        });

        sendJson(res, 200, { message: 'Request canceled' });
        return;
      }

      if (pathname === '/api/ai/usage' && req.method === 'GET') {
        const ledgers = await db.aiUsageLedger.findMany({
          where: { organizationId: context.user.organizationId },
          orderBy: { createdAt: 'desc' },
          take: 100
        });

        const totalCostMicros = ledgers.reduce((acc, l) => acc + l.costMicros, 0);
        const totalTokens = ledgers.reduce((acc, l) => acc + l.totalTokens, 0);

        sendJson(res, 200, {
          ledgers,
          summary: {
            totalCostMicros,
            totalCostUsd: (totalCostMicros / 1000000).toFixed(4),
            totalTokens
          }
        });
        return;
      }

      throw new HttpError(404, 'Endpoint not found');
    })().catch((error: unknown) => {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message, ...error.details });
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
