import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  createPrismaClient, databaseUrlFor, getDatabaseUrl, hashToken, verifyPassword,
  type Prisma, type PrismaClient, type User
} from '@claim-studio/database';
import {
  generateDocxBuffer, generatePdfBuffer, validateDocxBuffer, validatePdfBuffer,
  generateReportDocxBuffer, generateReportPdfBuffer, validateReportDocxBuffer, validateReportPdfBuffer
} from '@claim-studio/document-engine';
import { assertSafeBaseUrl, assertSafeResolvedBaseUrl, SsrfError, type AiProviderKind } from './ai/ssrf-guard';
import { assertSecretReference, resolveSecretReference, secretReferenceHint } from './ai/secret-resolver';
import { executeFakeAdapterCall } from './ai/fake-adapter';
import { processAiGenerationRequest, AiGatewayError, type AiAuditEvent } from './ai/gateway-engine';
import { GoogleWorkspaceFakeAdapter } from './google-workspace/GoogleWorkspaceFakeAdapter';
import { GoogleWorkspaceRealAdapter } from './google-workspace/GoogleWorkspaceRealAdapter';
import {
  createBackupPackage, listBackupPackages, pruneBackupsDryRun,
  verifyBackupPackage, restoreBackupPackage, removeBackupPackage, removeRestoredPackage,
  type BackupStorageRoot
} from './backup/backup-engine';
import {
  decodeGoogleCredentialMasterKey,
  EncryptedFileGoogleCredentialProvider
} from './google-workspace/GoogleCredentialProvider';
import {
  EncryptedFileGooglePkceVerifierVault, MemoryGooglePkceVerifierVault,
  type GooglePkceVerifierVault
} from './google-workspace/GoogleCredentialVault';
import {
  REQUIRED_GOOGLE_SCOPES,
  type GoogleAdapterMode,
  type GoogleAdapterResponse,
  type GoogleWorkspaceAdapter
} from './google-workspace/GoogleWorkspaceAdapter';
import { handleServerSettingsRequest } from './settings/server-settings-adapter';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
  'http://claimcenterstudio.con-cost.co.kr',
  'https://claimcenterstudio.con-cost.co.kr'
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
const GOOGLE_ADMIN_ROLES = new Set(['admin']);
const GOOGLE_CASE_MATERIAL_ROLES = new Set(['ceo', 'director', 'pm', 'staff', 'reviewer', 'admin']);
const GOOGLE_CASE_SCHEDULE_ROLES = new Set(['ceo', 'director', 'pm', 'admin']);
const GOOGLE_REDIRECT_TARGETS = new Set(['/integrations/google']);
const GOOGLE_SUCCESS_CLASSES = new Set<GoogleAdapterMode>(['SUCCESS', 'DUPLICATE_REPLAY']);
const GOOGLE_RETRYABLE_CLASSES = new Set<GoogleAdapterMode>(['RATE_LIMIT_RETRY_AFTER', 'SERVER_ERROR']);
const GOOGLE_MUTATION_RETRYABLE_CLASSES = new Set<GoogleAdapterMode>(['RATE_LIMIT_RETRY_AFTER']);
const GOOGLE_TEST_PROVIDER_TIMEOUT_MS = 2_000;
const GOOGLE_RECONCILIATION_STALE_MS = 5 * 60 * 1000;
const GOOGLE_RECONCILIATION_RESOLUTION = 'CONFIRMED_NO_EXTERNAL_SIDE_EFFECT';
const GOOGLE_RECONCILIATION_CONFIRMATION = 'NO_EXTERNAL_RESOURCE_CONFIRMED';
const GOOGLE_FAKE_MODES = new Set<GoogleAdapterMode>([
  'SUCCESS', 'DUPLICATE_REPLAY', 'BAD_SCOPE', 'TOKEN_EXPIRED', 'RECONSENT_REQUIRED',
  'RATE_LIMIT_RETRY_AFTER', 'SERVER_ERROR', 'TIMEOUT', 'USER_CANCEL',
  'MALFORMED_PROVIDER_RESPONSE', 'REVOKE_FAILURE'
]);
const ALLOWED_PROPOSAL_PLACEHOLDERS = new Set([
  'CASE_NUMBER', 'CASE_TITLE', 'CLAIM_TYPE', 'ASSIGNED_USER', 'CLIENT_NAME', 'CREATED_DATE',
  'BACKGROUND', 'OBJECTIVE', 'METHOD', 'EXPECTED_OUTCOME', 'EXCLUSIONS'
]);
const ALLOWED_AI_PROVIDERS = new Map([['local-fake-ai', new Set(['fake-claim-v1'])]]);
const P11_OUTPUT_SCHEMA_VERSION = 'P11_SUGGESTION_V1';
const P11_TEST_MODES = new Set([
  'GROUNDED_SUCCESS', 'UNGROUNDED_VALUE', 'NONEXISTENT_CASE_LAW', 'PROMPT_INJECTION',
  'CROSS_CASE', 'UNSELECTED_SOURCE', 'LEGAL_CONCLUSION', 'UNIT_MUTATION', 'CONFLICT',
  'MALFORMED_SCHEMA', 'MISSING_ANCHOR', 'HASH_MISMATCH', 'SLOW_SUCCESS'
]);

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

function assertReportOutputSignature(format: string, bytes: Buffer): void {
  const valid = format === 'DOCX'
    ? bytes.length >= 4 && bytes.subarray(0, 2).toString('ascii') === 'PK'
    : format === 'PDF' && bytes.length >= 8 && bytes.subarray(0, 5).toString('ascii') === '%PDF-' && bytes.subarray(-6).toString('ascii').includes('%%EOF');
  if (!valid) throw new HttpError(409, 'Output artifact MIME/signature verification failed');
}

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

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number, label: string): number {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new HttpError(400, `${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return candidate;
}

interface SessionContext {
  user: Pick<User, 'id' | 'email' | 'name' | 'organizationId'>;
  roles: string[];
  tokenHash: string;
}

export interface ApiServerOptions {
  databaseUrl?: string;
  db?: PrismaClient;
  environment?: NodeJS.ProcessEnv;
  allowedOrigins?: string[];
  secureCookies?: boolean;
  uploadDir?: string;
  allowTestAiModes?: boolean;
  allowTestGoogleModes?: boolean;
  googleWorkspaceProviderTimeoutMs?: number;
  googlePkceVerifierVault?: GooglePkceVerifierVault;
  backupRootDir?: string;
  restoreRootDir?: string;
  backupSigningKey?: Buffer;
  serverSettingsMasterKey?: Buffer;
  settingsFetcher?: typeof fetch;
  backupStorageRoots?: BackupStorageRoot[];
  databasePath?: string;
  volumeRootDir?: string;
  credentialVaultDir?: string;
  pkceVaultDir?: string;
  migrationsDir?: string;
  /**
   * Production Google Workspace access is explicit and injected. When omitted,
   * Google endpoints fail closed unless allowTestGoogleModes enables the
   * deterministic fake adapter for an isolated test server.
   */
  googleWorkspaceAdapterFactory?: (organizationId: string) => GoogleWorkspaceAdapter;
}

export interface ManagedApiServer extends http.Server {
  waitForDatabaseClose(): Promise<void>;
}


function sanitizeDisplayName(rawName: string): string {
  if (!rawName) return 'unnamed_file';
  let clean = rawName.replace(/[\0\r\n]/g, '').replace(/[\/\\]/g, '_').replace(/\.\.+/g, '.');
  clean = path.basename(clean);
  clean = clean.replace(/[^a-zA-Z0-9가-힣._-]/g, '_');
  return clean || 'unnamed_file';
}

function asciiDownloadFilename(safeName: string): string {
  const extension = path.extname(safeName).replace(/[^a-zA-Z0-9.]/g, '');
  const stem = path.basename(safeName, path.extname(safeName))
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\.]+|[_\.]+$/g, '');
  return `${stem || 'report_output'}${extension}`;
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
  if (!/^storage-[0-9a-zA-Z_-]+\.[a-z0-9]+$/i.test(storageKey)) throw new HttpError(409, 'Stored file key is invalid');
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

export function createGoogleWorkspaceAdapterFactoryFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): ((organizationId: string) => GoogleWorkspaceAdapter) | undefined {
  const mode = (environment.GOOGLE_WORKSPACE_PROVIDER_MODE ?? '').trim().toUpperCase();
  if (!mode) return undefined;
  if (mode !== 'REAL') throw new Error('GOOGLE_WORKSPACE_PROVIDER_MODE must be REAL when configured');

  const resolveEnvironmentReference = (name: string): string => {
    const secretRef = environment[name];
    if (!secretRef) throw new Error(`${name} must contain an ENV_* secret reference`);
    assertSecretReference(secretRef);
    const value = environment[secretRef.slice(4)];
    if (!value) throw new Error(`${name} could not be resolved`);
    return value;
  };

  const clientId = resolveEnvironmentReference('GOOGLE_WORKSPACE_CLIENT_ID_REF');
  const clientSecret = resolveEnvironmentReference('GOOGLE_WORKSPACE_CLIENT_SECRET_REF');
  const masterKey = decodeGoogleCredentialMasterKey(resolveEnvironmentReference('GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY_REF'));
  const redirectUri = environment.GOOGLE_WORKSPACE_REDIRECT_URI;
  if (!redirectUri) throw new Error('GOOGLE_WORKSPACE_REDIRECT_URI is required for REAL Google Workspace mode');
  const redirectOrigin = new URL(redirectUri).origin;
  const allowedRedirectOrigins = (environment.GOOGLE_WORKSPACE_REDIRECT_ORIGINS ?? redirectOrigin)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (!allowedRedirectOrigins.includes(redirectOrigin)) throw new Error('Google Workspace redirect URI origin is not allowlisted');
  if (!/^[A-Za-z0-9._-]{3,255}$/.test(clientId) || clientSecret.length < 8 || clientSecret.length > 4096) {
    throw new Error('Google Workspace OAuth client configuration is invalid');
  }
  const vaultDirectory = path.resolve(
    environment.GOOGLE_WORKSPACE_CREDENTIAL_VAULT_DIR
      ?? path.join(process.cwd(), 'packages/database/.data/google-credentials')
  );
  const credentialProvider = new EncryptedFileGoogleCredentialProvider({ directory: vaultDirectory, masterKey });
  return (organizationId) => new GoogleWorkspaceRealAdapter({
    credentialProvider,
    organizationId,
    clientId,
    clientSecret,
    redirectUri,
    allowedRedirectOrigins
  });
}

function assertExactJsonFields(body: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = []): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(body).find((key) => !allowedSet.has(key));
  if (unknown) throw new HttpError(400, `Unknown request field: ${unknown}`);
  const missing = required.find((key) => !(key in body));
  if (missing) throw new HttpError(400, `Missing required request field: ${missing}`);
}

function strictString(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string') throw new HttpError(400, `${label} must be a string`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new HttpError(400, `${label} must be between ${minimum} and ${maximum} characters`);
  }
  return normalized;
}

function strictIdempotencyKey(value: unknown): string {
  const key = strictString(value, 'idempotencyKey', 8, 120);
  if (!/^[A-Za-z0-9._:-]+$/.test(key)) throw new HttpError(400, 'idempotencyKey contains forbidden characters');
  return key;
}

function googleResponseStatus(responseClass: GoogleAdapterMode): number {
  switch (responseClass) {
    case 'TOKEN_EXPIRED': return 401;
    case 'BAD_SCOPE': return 403;
    case 'RECONSENT_REQUIRED': return 409;
    case 'RATE_LIMIT_RETRY_AFTER': return 429;
    case 'TIMEOUT': return 504;
    case 'USER_CANCEL': return 409;
    case 'SERVER_ERROR':
    case 'MALFORMED_PROVIDER_RESPONSE':
    case 'REVOKE_FAILURE': return 502;
    default: return 400;
  }
}

function safeGoogleProviderError(responseClass: GoogleAdapterMode): string {
  switch (responseClass) {
    case 'TOKEN_EXPIRED': return 'Google authorization expired';
    case 'BAD_SCOPE': return 'Google authorization scope is insufficient';
    case 'RECONSENT_REQUIRED': return 'Google authorization requires renewed consent';
    case 'RATE_LIMIT_RETRY_AFTER': return 'Google request rate limit was reached';
    case 'TIMEOUT': return 'Google provider request timed out';
    case 'USER_CANCEL': return 'Google operation was cancelled by the user';
    case 'MALFORMED_PROVIDER_RESPONSE': return 'Google provider returned an invalid response';
    case 'REVOKE_FAILURE': return 'Google authorization revocation failed';
    case 'SERVER_ERROR': return 'Google provider request failed';
    default: return 'Google provider operation failed';
  }
}

function sha256Hex(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function base64UrlSha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('base64url');
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
  return hasCaseAssignment(db, context, caseId);
}

async function hasCaseAssignment(db: PrismaClient, context: SessionContext, caseId: string): Promise<boolean> {
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

function sha256Text(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function splitGroundingParagraphs(value: string): string[] {
  return value.replace(/\r\n/g, '\n').split(/\n\s*\n|\n/).map((item) => item.trim()).filter(Boolean);
}

function parseGroundingAnchors(value: unknown, paragraphCount: number): number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    throw new HttpError(400, 'allowedAnchors must contain between 1 and 50 paragraph indices');
  }
  const anchors = [...new Set(value.map((item) => {
    if (!Number.isSafeInteger(item) || (item as number) < 0) throw new HttpError(400, 'allowedAnchors must contain non-negative integers');
    return item as number;
  }))].sort((left, right) => left - right);
  if (anchors.some((index) => index >= paragraphCount)) throw new HttpError(409, 'A selected grounding anchor does not exist in the exact source version');
  return anchors;
}

interface P11GroundingSnapshot {
  sourceType: 'MATERIAL' | 'MEETING';
  sourceId: string;
  sourceVersionId: string;
  sourceVersionNumber: number;
  sourceSha256: string;
  allowedAnchors: number[];
  paragraphs: string[];
}

async function loadP11GroundingSource(
  db: PrismaClient,
  uploadDir: string,
  caseId: string,
  reportId: string,
  input: { sourceType: 'MATERIAL' | 'MEETING'; sourceId: string; sourceVersionId: string; allowedAnchors: unknown }
): Promise<P11GroundingSnapshot> {
  if (input.sourceType === 'MEETING') {
    const meeting = await db.meeting.findUnique({ where: { id: input.sourceId } });
    if (!meeting || meeting.caseId !== caseId) throw new HttpError(403, 'Cross-case or unauthorized grounding meeting source');
    if (meeting.status !== 'FINAL' || !meeting.rawText || !meeting.rawTextSha256) throw new HttpError(409, 'Grounding meeting must be a finalized transcript');
    const sourceVersionId = `${meeting.id}:v${meeting.version}`;
    if (input.sourceVersionId !== sourceVersionId) throw new HttpError(409, 'Grounding meeting version changed; create a new selection');
    const sourceSha256 = sha256Text(meeting.rawText);
    if (sourceSha256 !== meeting.rawTextSha256) throw new HttpError(409, 'Grounding meeting integrity verification failed');
    const paragraphs = splitGroundingParagraphs(meeting.rawText);
    const allowedAnchors = parseGroundingAnchors(input.allowedAnchors, paragraphs.length);
    return { sourceType: 'MEETING', sourceId: meeting.id, sourceVersionId, sourceVersionNumber: meeting.version, sourceSha256, allowedAnchors, paragraphs };
  }

  const version = await db.documentVersion.findUnique({ where: { id: input.sourceVersionId }, include: { document: true } });
  if (!version || version.document.id !== input.sourceId || version.document.caseId !== caseId || version.document.deletedAt) {
    throw new HttpError(403, 'Cross-case or unauthorized grounding document source');
  }
  const storedPath = safeStoragePath(uploadDir, version.storageKey);
  if (!fs.existsSync(storedPath) || !fs.statSync(storedPath).isFile()) throw new HttpError(409, 'Grounding document storage object is missing');
  const bytes = fs.readFileSync(storedPath);
  const sourceSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== version.fileSize || sourceSha256 !== version.sha256) throw new HttpError(409, 'Grounding document integrity verification failed');
  const supportedMime = version.mimeType === 'text/plain' || version.mimeType === 'text/csv' || version.mimeType === 'application/json';
  const evidenceAnchors = supportedMime ? [] : await db.reportEvidenceLink.findMany({
    where: { sourceDocumentVersionId: version.id, revision: { section: { reportId } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { quoteText: true }
  });
  const paragraphs = supportedMime
    ? splitGroundingParagraphs(bytes.toString('utf8'))
    : evidenceAnchors.map((entry) => entry.quoteText?.trim() ?? '').filter(Boolean);
  if (paragraphs.length === 0) {
    throw new HttpError(409, 'Binary document grounding requires a verified P09 evidence quote for this report; full PDF/HWP extraction is not available in P11');
  }
  const allowedAnchors = parseGroundingAnchors(input.allowedAnchors, paragraphs.length);
  return {
    sourceType: 'MATERIAL', sourceId: version.document.id, sourceVersionId: version.id,
    sourceVersionNumber: version.versionNumber, sourceSha256, allowedAnchors, paragraphs
  };
}

interface P11ProviderClaim {
  claimIndex: number;
  claimText: string;
  sourceType: 'MATERIAL' | 'MEETING';
  sourceId: string;
  sourceVersionId: string;
  sourceSha256: string;
  anchorIndex: number;
  anchorText: string;
  status: 'VALID' | 'REVIEW_REQUIRED' | 'CONFLICT';
  conflictSourceId?: string;
}

interface P11ProviderOutput {
  schemaVersion: typeof P11_OUTPUT_SCHEMA_VERSION;
  summary: string;
  claims: P11ProviderClaim[];
}

function parseP11ProviderOutput(value: string): P11ProviderOutput {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new HttpError(422, 'Provider returned unparseable suggestion output'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(422, 'Provider suggestion output must be an object');
  const row = parsed as Record<string, unknown>;
  if (row.schemaVersion !== P11_OUTPUT_SCHEMA_VERSION) throw new HttpError(422, 'Provider suggestion schema version is invalid');
  if (typeof row.summary !== 'string' || row.summary.trim().length < 1 || row.summary.length > 100_000) throw new HttpError(422, 'Provider suggestion summary is invalid');
  if (!Array.isArray(row.claims) || row.claims.length < 1 || row.claims.length > 200) throw new HttpError(422, 'Provider suggestion must contain cited claims');
  const seen = new Set<number>();
  const claims = row.claims.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new HttpError(422, 'Provider claim is invalid');
    const claim = candidate as Record<string, unknown>;
    if (!Number.isSafeInteger(claim.claimIndex) || (claim.claimIndex as number) < 0 || seen.has(claim.claimIndex as number)) throw new HttpError(422, 'Provider claim index is invalid');
    seen.add(claim.claimIndex as number);
    if (typeof claim.claimText !== 'string' || claim.claimText.length < 1 || claim.claimText.length > 20_000) throw new HttpError(422, 'Provider claim text is invalid');
    if (claim.sourceType !== 'MATERIAL' && claim.sourceType !== 'MEETING') throw new HttpError(422, 'Provider citation source type is invalid');
    for (const field of ['sourceId', 'sourceVersionId', 'sourceSha256', 'anchorText'] as const) {
      if (typeof claim[field] !== 'string' || (claim[field] as string).length < 1) throw new HttpError(422, `Provider citation ${field} is invalid`);
    }
    if (!Number.isSafeInteger(claim.anchorIndex) || (claim.anchorIndex as number) < 0) throw new HttpError(422, 'Provider citation anchor is invalid');
    if (!['VALID', 'REVIEW_REQUIRED', 'CONFLICT'].includes(String(claim.status))) throw new HttpError(422, 'Provider citation status is invalid');
    return claim as unknown as P11ProviderClaim;
  });
  return { schemaVersion: P11_OUTPUT_SCHEMA_VERSION, summary: row.summary.trim(), claims };
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

function resolveReferencedEnvironmentValue(
  referenceVariable: string,
  environment: NodeJS.ProcessEnv = process.env
): string | undefined {
  const reference = environment[referenceVariable];
  if (!reference || !reference.startsWith('ENV_')) return undefined;
  return environment[reference.slice(4)];
}

function resolveOptional32ByteKey(
  referenceVariable: string,
  environment: NodeJS.ProcessEnv = process.env
): Buffer | undefined {
  const encoded = resolveReferencedEnvironmentValue(referenceVariable, environment);
  if (!encoded) return undefined;
  return decodeOptional32ByteKeyValue(referenceVariable, encoded);
}

function decodeOptional32ByteKeyValue(label: string, encoded: string | undefined): Buffer | undefined {
  if (!encoded) return undefined;
  const key = /^[0-9a-fA-F]{64}$/.test(encoded.trim())
    ? Buffer.from(encoded.trim(), 'hex')
    : Buffer.from(encoded.trim(), 'base64url');
  if (key.length !== 32) throw new Error(label + ' must resolve to exactly 32 bytes');
  return key;
}

function productionAllowedOrigins(environment: NodeJS.ProcessEnv): string[] {
  const raw = environment.CLAIM_ALLOWED_ORIGINS;
  if (!raw) throw new Error('CLAIM_ALLOWED_ORIGINS is required in production');
  const origins = raw.split(',').map((value) => value.trim()).filter(Boolean);
  if (origins.length === 0) throw new Error('CLAIM_ALLOWED_ORIGINS must contain at least one exact origin');
  return origins.map((origin) => {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !['https:', 'http:'].includes(parsed.protocol) || origin.includes('*')) {
      throw new Error('CLAIM_ALLOWED_ORIGINS entries must be exact HTTP(S) origins without wildcards');
    }
    return origin;
  });
}

function assertPathInsideVolume(volumeRootDir: string, candidate: string, label: string): void {
  const root = path.resolve(volumeRootDir);
  const resolved = path.resolve(candidate);
  if (resolved === root || !resolved.startsWith(root + path.sep)) {
    throw new Error(label + ' must be located beneath CLAIM_VOLUME_ROOT');
  }
}

function writableDirectoryProbe(directory: string): boolean {
  let probePath = '';
  try {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return false;
    probePath = path.join(directory, '.readiness-' + process.pid + '-' + crypto.randomBytes(8).toString('hex'));
    fs.writeFileSync(probePath, 'ok', { encoding: 'utf8', flag: 'wx' });
    return fs.readFileSync(probePath, 'utf8') === 'ok';
  } catch {
    return false;
  } finally {
    if (probePath) {
      try { fs.unlinkSync(probePath); } catch { /* best-effort cleanup */ }
    }
  }
}

async function migrationLedgerMatches(db: PrismaClient, migrationsDir: string): Promise<boolean> {
  try {
    const expected = fs.readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(migrationsDir, entry.name, 'migration.sql')))
      .map((entry) => ({
        name: entry.name,
        checksum: crypto.createHash('sha256')
          .update(fs.readFileSync(path.join(migrationsDir, entry.name, 'migration.sql'), 'utf8'))
          .digest('hex')
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const applied = await db.$queryRawUnsafe<Array<{ name: string; checksum: string }>>(
      'SELECT "name", "checksum" FROM "_P04Migration" ORDER BY "name" ASC'
    );
    if (applied.length !== expected.length) return false;
    return expected.every((migration, index) => (
      applied[index]?.name === migration.name && applied[index]?.checksum === migration.checksum
    ));
  } catch {
    return false;
  }
}

export function createApiServerFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): ManagedApiServer {
  if (environment.NODE_ENV !== 'production') return createApiServer({ environment });

  const configuredRoot = environment.CLAIM_VOLUME_ROOT;
  if (!configuredRoot || !path.isAbsolute(configuredRoot)) {
    throw new Error('Production requires an absolute CLAIM_VOLUME_ROOT');
  }
  const volumeRootDir = path.resolve(configuredRoot);
  const databasePath = path.join(volumeRootDir, 'database', 'claim-center.db');
  const uploadDir = path.join(volumeRootDir, 'storage');
  const credentialVaultDir = path.join(volumeRootDir, 'google-credentials');
  const pkceVaultDir = path.join(volumeRootDir, 'google-pkce');
  const backupRootDir = path.join(volumeRootDir, 'backups');
  const restoreRootDir = path.join(volumeRootDir, 'restores');
  for (const directory of [
    path.dirname(databasePath), uploadDir, credentialVaultDir, pkceVaultDir, backupRootDir, restoreRootDir
  ]) fs.mkdirSync(directory, { recursive: true });

  const backupSigningKey = resolveOptional32ByteKey('CLAIM_BACKUP_SIGNING_KEY_REF', environment);
  const credentialMasterKey = resolveOptional32ByteKey('GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY_REF', environment);
  if (!backupSigningKey) throw new Error('Production requires CLAIM_BACKUP_SIGNING_KEY_REF');
  if (!credentialMasterKey) throw new Error('Production requires GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY_REF');

  const scopedEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    GOOGLE_WORKSPACE_CREDENTIAL_VAULT_DIR: credentialVaultDir,
    GOOGLE_WORKSPACE_PKCE_VAULT_DIR: pkceVaultDir
  };
  return createApiServer({
    environment: scopedEnvironment,
    databaseUrl: databaseUrlFor(databasePath),
    databasePath,
    volumeRootDir,
    uploadDir,
    credentialVaultDir,
    pkceVaultDir,
    backupRootDir,
    restoreRootDir,
    backupSigningKey,
    allowedOrigins: productionAllowedOrigins(scopedEnvironment),
    secureCookies: true,
    allowTestAiModes: false,
    allowTestGoogleModes: false
  });
}

export function createApiServer(options: ApiServerOptions = {}): ManagedApiServer {
  const environment = options.environment ?? process.env;
  const isProduction = environment.NODE_ENV === 'production';
  const databaseUrl = options.databaseUrl ?? getDatabaseUrl();
  const db = options.db ?? createPrismaClient(databaseUrl);
  const allowedOrigins = new Set(options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);
  const secureCookie = options.secureCookies ?? isProduction;
  const uploadDir = path.resolve(options.uploadDir ?? DEFAULT_UPLOAD_DIR);
  const allowTestAiModes = options.allowTestAiModes === true;
  const allowTestGoogleModes = options.allowTestGoogleModes === true;
  if (isProduction && (allowTestAiModes || allowTestGoogleModes)) {
    throw new Error('Test and fake provider modes are forbidden in production');
  }
  const googleWorkspaceAdapterFactory = options.googleWorkspaceAdapterFactory
    ?? createGoogleWorkspaceAdapterFactoryFromEnvironment(environment);
  const configuredGoogleTimeout = options.googleWorkspaceProviderTimeoutMs
    ?? (environment.GOOGLE_WORKSPACE_PROVIDER_TIMEOUT_MS ? Number(environment.GOOGLE_WORKSPACE_PROVIDER_TIMEOUT_MS) : undefined)
    ?? (googleWorkspaceAdapterFactory ? 30_000 : GOOGLE_TEST_PROVIDER_TIMEOUT_MS);
  if (!Number.isSafeInteger(configuredGoogleTimeout) || configuredGoogleTimeout < 1_000 || configuredGoogleTimeout > 60_000) {
    throw new Error('Google Workspace provider timeout must be an integer between 1000 and 60000 milliseconds');
  }
  const googleProviderTimeoutMs = configuredGoogleTimeout;
  const backupRootDir = path.resolve(options.backupRootDir ?? path.join(process.cwd(), 'packages/database/.data/backups'));
  const restoreRootDir = path.resolve(options.restoreRootDir ?? path.join(process.cwd(), 'packages/database/.data/restores'));
  const backupSigningKey = options.backupSigningKey ?? resolveOptional32ByteKey('CLAIM_BACKUP_SIGNING_KEY_REF', environment);
  const credentialVaultDir = path.resolve(options.credentialVaultDir
    ?? environment.GOOGLE_WORKSPACE_CREDENTIAL_VAULT_DIR
    ?? path.join(process.cwd(), 'packages/database/.data/google-credentials'));
  const pkceVaultDir = path.resolve(options.pkceVaultDir
    ?? environment.GOOGLE_WORKSPACE_PKCE_VAULT_DIR
    ?? path.join(process.cwd(), 'packages/database/.data/google-pkce'));
  const migrationsDir = path.resolve(options.migrationsDir ?? path.join(process.cwd(), 'packages/database/prisma/migrations'));
  const configuredPkceKey = resolveOptional32ByteKey('GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY_REF', environment);
  const configuredSettingsKey = options.serverSettingsMasterKey
    ?? resolveOptional32ByteKey('AI_CREDENTIAL_MASTER_KEY_REF', environment)
    ?? decodeOptional32ByteKeyValue('AI_CREDENTIAL_MASTER_KEY', environment.AI_CREDENTIAL_MASTER_KEY)
    ?? configuredPkceKey;
  if (isProduction) {
    if (!options.volumeRootDir || !options.databasePath || !backupSigningKey || !configuredPkceKey) {
      throw new Error('Production requires a persistent volume root, database path, backup key, and credential key');
    }
    for (const [label, candidate] of [
      ['databasePath', options.databasePath],
      ['uploadDir', uploadDir],
      ['backupRootDir', backupRootDir],
      ['restoreRootDir', restoreRootDir],
      ['credentialVaultDir', credentialVaultDir],
      ['pkceVaultDir', pkceVaultDir]
    ] as const) assertPathInsideVolume(options.volumeRootDir, candidate, label);
  }
  for (const directory of [uploadDir, backupRootDir, restoreRootDir, credentialVaultDir, pkceVaultDir]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  const backupStorageRoots = options.backupStorageRoots ?? [
    { name: 'google-credentials', sourceDir: credentialVaultDir },
    { name: 'google-pkce', sourceDir: pkceVaultDir }
  ];
  const googlePkceVerifierVault = options.googlePkceVerifierVault ?? (configuredPkceKey
    ? new EncryptedFileGooglePkceVerifierVault({ directory: pkceVaultDir, masterKey: configuredPkceKey })
    : new MemoryGooglePkceVerifierVault());
  const requireBackupSigningKey = (): Buffer => {
    if (!backupSigningKey) throw new HttpError(503, 'Backup signing key is not configured');
    return backupSigningKey;
  };
  const inFlightAiRequests = new Map<string, AbortController>();
  type GoogleFakeModeController = Pick<GoogleWorkspaceFakeAdapter, 'setMode' | 'getMode'>;
  const googleFakeAdapters = new Map<string, GoogleWorkspaceFakeAdapter>();
  const googleAdapterFor = (organizationId: string): GoogleWorkspaceAdapter => {
    // Real adapters are request-scoped so an active credential reference cannot
    // bleed across concurrent requests or a concurrent OAuth reconnect.
    if (googleWorkspaceAdapterFactory) return googleWorkspaceAdapterFactory(organizationId);
    if (!allowTestGoogleModes) throw new HttpError(503, 'Google Workspace provider is not configured');
    let adapter = googleFakeAdapters.get(organizationId);
    if (!adapter) {
      adapter = new GoogleWorkspaceFakeAdapter('SUCCESS');
      googleFakeAdapters.set(organizationId, adapter);
    }
    return adapter;
  };
  const fakeModeController = (adapter: GoogleWorkspaceAdapter): GoogleFakeModeController | null => (
    adapter instanceof GoogleWorkspaceFakeAdapter ? adapter : null
  );

  const server = http.createServer((req, res) => {
    void (async () => {
      const origin = req.headers.origin;
      const originAllowed = !origin || allowedOrigins.has(origin);
      if (!originAllowed) throw new HttpError(403, 'Origin is not allowed');
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, Idempotency-Key, X-Request-Id');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
        res.setHeader('Access-Control-Max-Age', '600');
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

      if ((pathname === '/health' || pathname === '/api/health') && req.method === 'GET') {
        sendJson(res, 200, {
          status: 'ok',
          service: 'claim-center-report-studio',
          timestamp: new Date().toISOString()
        });
        return;
      }

      if ((pathname === '/readiness' || pathname === '/api/readiness') && req.method === 'GET') {
        let databaseWritable = false;
        try {
          if (!options.databasePath || !fs.existsSync(options.databasePath)) throw new Error('database file is missing');
          const descriptor = fs.openSync(options.databasePath, 'r+');
          fs.closeSync(descriptor);
          await db.$queryRawUnsafe('SELECT 1');
          databaseWritable = true;
        } catch {
          databaseWritable = false;
        }
        const migrationsUpToDate = await migrationLedgerMatches(db, migrationsDir);
        const storageWritable = writableDirectoryProbe(uploadDir);
        const backupRootWritable = writableDirectoryProbe(backupRootDir);
        const restoreRootWritable = writableDirectoryProbe(restoreRootDir);
        const isReady = databaseWritable && migrationsUpToDate && storageWritable
          && backupRootWritable && restoreRootWritable;

        sendJson(res, isReady ? 200 : 503, {
          status: isReady ? 'ready' : 'not_ready',
          checks: {
            databaseWritable,
            migrationsUpToDate,
            storageWritable,
            backupRootWritable,
            restoreRootWritable
          },
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (pathname === '/auth/login' && req.method === 'POST') {
        const body = await readJson(req);
        const loginId = typeof body.loginId === 'string' && body.loginId.trim()
          ? body.loginId.trim().toLowerCase()
          : typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        const emailCandidates = loginId.includes('@')
          ? [loginId]
          : [loginId, `${loginId}@con-cost.com`, `${loginId}@example.invalid`];
        const idCandidates = [loginId, loginId.toUpperCase(), `USR-${loginId.toUpperCase()}`];
        const user = loginId ? await db.user.findFirst({ where: {
          OR: [{ email: { in: emailCandidates } }, { id: { in: idCandidates } }]
        } }) : null;
        if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
          await db.auditLog.create({ data: requestAudit(null, 'LOGIN_FAILED', 'User', loginId || 'UNKNOWN', { reason: 'invalid_credentials' }) });
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
        sendJson(res, 200, { ...context.user, roles: context.roles, previewMode: true });
        return;
      }

      if (await handleServerSettingsRequest({
        pathname,
        method: req.method ?? 'GET',
        request: req,
        response: res,
        db,
        context,
        masterKey: configuredSettingsKey ?? null,
        fetcher: options.settingsFetcher
      })) return;

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
                      select: { id: true, versionNumber: true, displayName: true, sha256: true, fileSize: true, mimeType: true, isFinal: true }
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

        const [schedules, recentCases] = await Promise.all([
          db.schedule.findMany({
            where: { case: caseWhere },
            include: { case: { select: { id: true, caseNumber: true, title: true } } },
            orderBy: { date: 'asc' }
          }),
          db.caseItem.findMany({
            where: caseWhere,
            select: { id: true, caseNumber: true, title: true, claimType: true, status: true, updatedAt: true },
            orderBy: { updatedAt: 'desc' },
            take: 5
          })
        ]);

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
          delayedCount,
          recentCases,
          upcomingSchedules: schedules
            .filter((schedule) => schedule.date >= now)
            .slice(0, 5)
            .map((schedule) => ({
              id: schedule.id,
              title: schedule.title,
              type: schedule.type,
              date: schedule.date,
              case: schedule.case,
              dDayInfo: calculateDDay(schedule.date, now)
            }))
        });
        return;
      }

      // --- Usable report workspace list (REPO-01) ---
      if (pathname === '/api/reports' && req.method === 'GET') {
        const isAdminOrExec = context.roles.some((role) => ['admin', 'ceo', 'director'].includes(role));
        const query = url.searchParams.get('q')?.trim() ?? '';
        const caseScope: Prisma.CaseItemWhereInput = {
          organizationId: context.user.organizationId,
          deletedAt: null,
          ...(!isAdminOrExec ? { assignments: { some: { userId: context.user.id } } } : {})
        };
        const reports = await db.report.findMany({
          where: {
            deletedAt: null,
            case: caseScope,
            ...(query ? {
              OR: [
                { title: { contains: query } },
                { case: { title: { contains: query } } },
                { case: { caseNumber: { contains: query } } }
              ]
            } : {})
          },
          include: {
            case: { select: { id: true, caseNumber: true, title: true, claimType: true, status: true } },
            reportInstance: { select: { templateNameSnapshot: true, templateVersionNumberSnapshot: true } },
            sections: {
              where: { deletedAt: null },
              select: { id: true, status: true, isRequired: true }
            },
            finalizations: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, createdAt: true } },
            outputArtifacts: { select: { id: true, format: true } }
          },
          orderBy: { updatedAt: 'desc' },
          take: 100
        });
        sendJson(res, 200, {
          reports: reports.map((report) => ({
            id: report.id,
            title: report.title,
            version: report.version,
            updatedAt: report.updatedAt,
            case: report.case,
            templateName: report.reportInstance?.templateNameSnapshot ?? '사용자 정의 보고서',
            templateVersion: report.reportInstance?.templateVersionNumberSnapshot ?? null,
            sectionCount: report.sections.length,
            requiredSectionCount: report.sections.filter((section) => section.isRequired).length,
            approvedSectionCount: report.sections.filter((section) => section.status === 'APPROVED').length,
            finalized: report.finalizations.length > 0,
            outputFormats: [...new Set(report.outputArtifacts.map((artifact) => artifact.format))]
          }))
        });
        return;
      }

      // --- Actionable review and approval inbox (APPR-01) ---
      if (pathname === '/api/review-requests' && req.method === 'GET') {
        const allowedStatuses = new Set(['PENDING', 'CHANGES_REQUESTED', 'RESUBMITTED', 'APPROVED']);
        const requestedStatus = url.searchParams.get('status')?.trim().toUpperCase() ?? '';
        const query = url.searchParams.get('q')?.trim() ?? '';
        if (requestedStatus && !allowedStatuses.has(requestedStatus)) throw new HttpError(400, 'Invalid review request status');

        const isAdminOrExec = context.roles.some((role) => ['admin', 'ceo', 'director'].includes(role));
        const events = await db.reportReviewRequest.findMany({
          where: {
            organizationId: context.user.organizationId,
            case: {
              deletedAt: null,
              ...(!isAdminOrExec ? { assignments: { some: { userId: context.user.id } } } : {})
            },
            ...(query ? {
              OR: [
                { report: { title: { contains: query } } },
                { case: { title: { contains: query } } },
                { case: { caseNumber: { contains: query } } },
                { requestedBy: { name: { contains: query } } },
                { assignedReviewer: { name: { contains: query } } }
              ]
            } : {})
          },
          include: {
            case: { select: { id: true, caseNumber: true, title: true, claimType: true } },
            report: {
              select: {
                id: true,
                title: true,
                version: true,
                sections: { where: { deletedAt: null }, select: { id: true, status: true, isRequired: true } }
              }
            },
            requestedBy: { select: { id: true, name: true, email: true } },
            assignedReviewer: { select: { id: true, name: true, email: true } }
          },
          orderBy: [{ createdAt: 'desc' }, { eventNumber: 'desc' }],
          take: 500
        });

        const seenReports = new Set<string>();
        const latestEvents = events.filter((event) => {
          if (seenReports.has(event.reportId)) return false;
          seenReports.add(event.reportId);
          return true;
        });
        const visibleEvents = requestedStatus
          ? latestEvents.filter((event) => event.status === requestedStatus)
          : latestEvents;
        const summary = Object.fromEntries([...allowedStatuses].map((status) => [
          status,
          latestEvents.filter((event) => event.status === status).length
        ]));

        sendJson(res, 200, {
          summary: { total: latestEvents.length, ...summary },
          reviewRequests: visibleEvents.map((event) => ({
            id: event.id,
            eventNumber: event.eventNumber,
            status: event.status,
            comment: event.comment,
            createdAt: event.createdAt,
            requestedBy: event.requestedBy,
            assignedReviewer: event.assignedReviewer,
            case: event.case,
            report: {
              id: event.report.id,
              title: event.report.title,
              version: event.report.version,
              sectionCount: event.report.sections.length,
              requiredSectionCount: event.report.sections.filter((section) => section.isRequired).length,
              approvedSectionCount: event.report.sections.filter((section) => section.status === 'APPROVED').length
            }
          }))
        });
        return;
      }

      // --- P05 Cases List & Creation Endpoint ---
      if (pathname === '/api/cases' && req.method === 'GET') {
        const q = url.searchParams.get('q')?.trim() ?? '';
        const claimType = url.searchParams.get('claimType')?.trim();
        const status = url.searchParams.get('status')?.trim();
        const assignedOnly = url.searchParams.get('assignedOnly') === 'true';
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
          ...(!isAdminOrExec || assignedOnly ? { assignments: { some: { userId: context.user.id } } } : {}),
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

        if (toStatus === 'CLOSED') {
          throw new HttpError(409, 'Use /api/cases/:caseId/close-with-unpaid-check for fee-governed closure');
        }

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
        const safeConfigs = configs.map(({ secretRef, ...config }) => ({
          ...config,
          secretRefHint: secretReferenceHint(secretRef),
          hasSecretConfigured: config.providerKind === 'LOCAL_FAKE' || Boolean(resolveSecretReference(secretRef))
        }));
        sendJson(res, 200, { providers: safeConfigs });
        return;
      }

      if (pathname === '/api/ai/providers' && req.method === 'POST') {
        if (!context.roles.includes('admin')) throw new HttpError(403, 'Admin role required');
        const body = await readJson(req);
        const providerKind = String(body.providerKind || 'LOCAL_FAKE') as AiProviderKind;
        if (!['LOCAL_FAKE', 'OPENAI', 'ANTHROPIC', 'GEMINI'].includes(providerKind)) throw new HttpError(400, 'Unsupported providerKind');
        const name = String(body.name || 'AI Provider').trim();
        if (!name || name.length > 120) throw new HttpError(400, 'Provider name is required and must not exceed 120 characters');
        const isLocalFake = providerKind === 'LOCAL_FAKE';
        const baseUrl = String(body.baseUrl || (isLocalFake ? 'https://local-fake.invalid/v1' : ''));
        const secretRef = String(body.secretRef || (isLocalFake ? 'LOCAL_FAKE' : ''));
        const allowedModels = Array.isArray(body.allowedModels) ? [...new Set(body.allowedModels.map(String).map((item) => item.trim()).filter(Boolean))] : [];
        if (allowedModels.length === 0 || allowedModels.length > 50 || allowedModels.some((model) => model.length > 100)) {
          throw new HttpError(400, 'allowedModels must contain 1 to 50 bounded model identifiers');
        }
        const timeoutMs = boundedInteger(body.timeoutMs, 30000, 1000, 120000, 'timeoutMs');
        const maxRetries = boundedInteger(body.maxRetries, 3, 0, 3, 'maxRetries');
        const dailyBudgetMicros = boundedInteger(body.dailyBudgetMicros, 100000000, 1, 2_000_000_000, 'dailyBudgetMicros');

        try {
          assertSafeBaseUrl(baseUrl, isLocalFake, providerKind);
          assertSecretReference(secretRef, isLocalFake);
        } catch (err) {
          throw new HttpError(400, err instanceof Error ? err.message : 'Invalid provider configuration');
        }

        const id = typeof body.id === 'string' && body.id ? body.id : `CFG-${crypto.randomUUID()}`;
        const current = await db.aiProviderConfig.findUnique({ where: { id } });
        if (current && current.organizationId !== context.user.organizationId) throw new HttpError(403, 'Cross-organization provider update forbidden');
        const config = await db.$transaction(async (tx) => {
          const stored = await tx.aiProviderConfig.upsert({
            where: { id },
            update: {
              providerKind, name, baseUrl, secretRef,
              allowedModelsJson: JSON.stringify(allowedModels), timeoutMs, maxRetries, dailyBudgetMicros, version: { increment: 1 }
            },
            create: {
              id, organizationId: context.user.organizationId, providerKind, name, baseUrl, secretRef,
              status: 'ACTIVE', allowedModelsJson: JSON.stringify(allowedModels), timeoutMs, maxRetries, dailyBudgetMicros, version: 1
            }
          });
          await tx.auditLog.create({ data: requestAudit(context, 'AI_PROVIDER_CONFIGURED', 'AiProviderConfig', stored.id, { providerKind, name }) });
          return stored;
        });
        const { secretRef: storedSecretRef, ...safeConfig } = config;
        sendJson(res, 200, { provider: { ...safeConfig, secretRefHint: secretReferenceHint(storedSecretRef), hasSecretConfigured: isLocalFake || Boolean(resolveSecretReference(storedSecretRef)) } });
        return;
      }

      const aiTestMatch = pathname.match(/^\/api\/ai\/providers\/([^/]+)\/test$/);
      if (aiTestMatch && req.method === 'POST') {
        if (!context.roles.includes('admin')) throw new HttpError(403, 'Admin role required');
        const providerId = aiTestMatch[1];
        const config = await db.aiProviderConfig.findUnique({ where: { id: providerId } });
        if (!config || config.organizationId !== context.user.organizationId) throw new HttpError(404, 'Provider configuration not found');

        let testResult;
        if (config.providerKind === 'LOCAL_FAKE') {
          testResult = await executeFakeAdapterCall('LOCAL_FAKE', { modelCode: 'fake-claim-v1', prompt: 'P10_PING_TEST' });
        } else {
          await assertSafeResolvedBaseUrl(config.baseUrl, config.providerKind as AiProviderKind);
          assertSecretReference(config.secretRef);
          if (!resolveSecretReference(config.secretRef)) throw new HttpError(400, 'Configured provider secret reference is unavailable');
          throw new HttpError(501, 'Live provider connection tests require a separately authorized adapter deployment');
        }

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
        const requestedCaseId = url.searchParams.get('caseId');
        let policyProviderIds: string[] | null = null;
        if (requestedCaseId) {
          const caseRow = await db.caseItem.findUnique({ where: { id: requestedCaseId } });
          if (!caseRow || caseRow.deletedAt) throw new HttpError(404, 'Case not found');
          if (caseRow.organizationId !== context.user.organizationId || !(await canAccessCase(db, context, requestedCaseId))) throw new HttpError(403, 'Case access forbidden');
          const policy = await db.aiCasePolicy.findUnique({ where: { caseId: requestedCaseId } });
          if (!policy?.externalAiAllowed) {
            sendJson(res, 200, { models: [] });
            return;
          }
          policyProviderIds = JSON.parse(policy.allowedProviderIdsJson) as string[];
        }
        const activeConfigs = await db.aiProviderConfig.findMany({
          where: {
            organizationId: context.user.organizationId,
            status: 'ACTIVE',
            ...(policyProviderIds ? { id: { in: policyProviderIds } } : {})
          }
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
          const currentPolicy = await db.aiCasePolicy.findUnique({ where: { caseId } });
          const maxTokensPerRequest = boundedInteger(body.maxTokensPerRequest, currentPolicy?.maxTokensPerRequest ?? 4096, 1, 100_000, 'maxTokensPerRequest');
          const maxCostMicrosPerRequest = boundedInteger(body.maxCostMicrosPerRequest, currentPolicy?.maxCostMicrosPerRequest ?? 1_000_000, 1, 2_000_000_000, 'maxCostMicrosPerRequest');
          const allowedProviderIds = Array.isArray(body.allowedProviderIds)
            ? [...new Set(body.allowedProviderIds.map(String))]
            : currentPolicy ? JSON.parse(currentPolicy.allowedProviderIdsJson) as string[] : [];
          const ownedProviderCount = await db.aiProviderConfig.count({ where: { organizationId: context.user.organizationId, id: { in: allowedProviderIds } } });
          if (ownedProviderCount !== allowedProviderIds.length) throw new HttpError(400, 'Policy provider allowlist contains an unknown provider');

          const policy = await db.$transaction(async (tx) => {
            const stored = await tx.aiCasePolicy.upsert({
              where: { caseId },
              update: { externalAiAllowed, maxTokensPerRequest, maxCostMicrosPerRequest, allowedProviderIdsJson: JSON.stringify(allowedProviderIds) },
              create: { id: `POL-${crypto.randomUUID()}`, caseId, externalAiAllowed, maxTokensPerRequest, maxCostMicrosPerRequest, allowedProviderIdsJson: JSON.stringify(allowedProviderIds) }
            });
            await tx.auditLog.create({ data: requestAudit(context, 'AI_CASE_POLICY_UPDATED', 'AiCasePolicy', stored.id, { caseId, externalAiAllowed, allowedProviderIds }) });
            return stored;
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
        const idempotencyKey = String(body.idempotencyKey || '');
        const maxTokens = typeof body.maxTokens === 'number' ? body.maxTokens : undefined;
        const waitForCompletion = body.waitForCompletion !== false;

        if (!caseId || !providerConfigId || !modelCode || !prompt || !idempotencyKey) {
          throw new HttpError(400, 'Missing required fields (caseId, providerConfigId, modelCode, prompt, idempotencyKey)');
        }
        if (idempotencyKey.length > 128 || prompt.length > 200_000) throw new HttpError(400, 'Request field length exceeds the P10 limit');

        const caseRow = await db.caseItem.findUnique({ where: { id: caseId } });
        if (!caseRow || caseRow.deletedAt) throw new HttpError(404, 'Case not found');
        if (caseRow.organizationId !== context.user.organizationId) throw new HttpError(403, 'Case access forbidden');
        if (!(await canAccessCase(db, context, caseId))) throw new HttpError(403, 'Case assignment required');

        try {
          const controller = new AbortController();
          let resolveKnown!: (value: { requestId: string; status: string }) => void;
          let rejectKnown!: (error: unknown) => void;
          const knownRequest = new Promise<{ requestId: string; status: string }>((resolve, reject) => { resolveKnown = resolve; rejectKnown = reject; });
          void knownRequest.catch(() => undefined);
          const execution = processAiGenerationRequest(db, {
            organizationId: context.user.organizationId,
            caseId,
            userId: context.user.id,
            providerConfigId,
            modelCode,
            prompt,
            idempotencyKey,
            maxTokens,
            auditLogFactory: (event: AiAuditEvent, targetId, metadata) => requestAudit(
              context,
              {
                STARTED: 'AI_GENERATION_STARTED', COMPLETED: 'AI_GENERATION_COMPLETED', FAILED: 'AI_GENERATION_FAILED',
                CANCELED: 'AI_GENERATION_CANCELED', POLICY_BLOCKED: 'AI_GENERATION_POLICY_BLOCKED', BUDGET_BLOCKED: 'AI_GENERATION_BUDGET_BLOCKED'
              }[event],
              event === 'STARTED' || event === 'COMPLETED' || event === 'FAILED' || event === 'CANCELED' ? 'AiGenerationRequest' : 'CaseItem',
              targetId,
              { caseId, providerConfigId, modelCode, ...metadata }
            )
          }, {
            abortSignal: controller.signal,
            onRequestKnown: (requestId, status) => resolveKnown({ requestId, status })
          });
          void execution.catch(rejectKnown);

          if (waitForCompletion) {
            sendJson(res, 200, { result: await execution });
            return;
          }

          const known = await knownRequest;
          if (known.status !== 'PROCESSING') {
            sendJson(res, 200, { result: await execution });
            return;
          }
          inFlightAiRequests.set(known.requestId, controller);
          void execution.catch((error: unknown) => console.error('Background AI request failed', error)).finally(() => inFlightAiRequests.delete(known.requestId));
          sendJson(res, 202, { result: { requestId: known.requestId, status: 'PROCESSING' } });
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

      const aiRequestMatch = pathname.match(/^\/api\/ai\/requests\/([^/]+)$/);
      if (aiRequestMatch && req.method === 'GET') {
        const requestRow = await db.aiGenerationRequest.findUnique({ where: { id: aiRequestMatch[1] }, include: { attempts: true } });
        if (!requestRow || requestRow.organizationId !== context.user.organizationId) throw new HttpError(404, 'Generation request not found');
        if (requestRow.userId !== context.user.id && !context.roles.includes('admin')) throw new HttpError(403, 'Request access forbidden');
        let resultText: string | undefined;
        try { resultText = (JSON.parse(requestRow.responseMetadataJson) as { resultText?: string }).resultText; } catch { resultText = undefined; }
        sendJson(res, 200, {
          result: {
            requestId: requestRow.id, status: requestRow.status, reservedCostMicros: requestRow.reservedCostMicros,
            actualCostMicros: requestRow.actualCostMicros, totalTokens: requestRow.totalTokens, resultText,
            redactedErrorMessage: requestRow.redactedErrorMessage, attemptsCount: requestRow.attempts.length
          }
        });
        return;
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
          const changed = await tx.aiGenerationRequest.updateMany({
            where: { id: requestId, status: { in: ['PENDING', 'PROCESSING'] } },
            data: { status: 'CANCELED', actualCostMicros: 0, totalTokens: 0, redactedErrorMessage: 'Canceled by user request' }
          });
          if (changed.count === 0) throw new HttpError(409, 'Request is already in terminal state');
          await tx.aiUsageLedger.create({
            data: {
              id: `LDG-${crypto.randomUUID()}`, organizationId: reqRow.organizationId, caseId: reqRow.caseId,
              userId: reqRow.userId, providerConfigId: reqRow.providerConfigId, modelCode: reqRow.modelCode,
              requestId, transactionType: 'RECONCILIATION', costMicros: -reqRow.reservedCostMicros
            }
          });
          await tx.auditLog.create({
            data: requestAudit(context, 'AI_GENERATION_CANCELED', 'AiGenerationRequest', requestId, {})
          });
        });
        inFlightAiRequests.get(requestId)?.abort();
        inFlightAiRequests.delete(requestId);
        sendJson(res, 200, { message: 'Request canceled', result: { requestId, status: 'CANCELED' } });
        return;
      }

      if (pathname === '/api/ai/usage' && req.method === 'GET') {
        const canViewOrganizationUsage = context.roles.some((role) => ['admin', 'ceo', 'director'].includes(role));
        const ledgers = await db.aiUsageLedger.findMany({
          where: { organizationId: context.user.organizationId, ...(!canViewOrganizationUsage ? { userId: context.user.id } : {}) },
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

      // ====================================================
      // P11 Grounded AI Authoring Endpoints
      // ====================================================

      // 1. POST /api/reports/:reportId/sections/:sectionId/grounding/selections
      const groundingSelectionMatch = pathname.match(/^\/api\/reports\/([^/]+)\/sections\/([^/]+)\/grounding\/selections$/);
      if (groundingSelectionMatch && req.method === 'POST') {
        const reportId = groundingSelectionMatch[1];
        const sectionId = groundingSelectionMatch[2];

        const reportRow = await db.report.findUnique({
          where: { id: reportId },
          include: { case: true, sections: { where: { id: sectionId } } }
        });
        if (!reportRow || reportRow.case.deletedAt || reportRow.sections.length === 0) {
          throw new HttpError(404, 'Report or Section not found');
        }
        if (reportRow.case.organizationId !== context.user.organizationId) {
          throw new HttpError(403, 'Cross-tenant access forbidden');
        }
        if (!(await canAccessCase(db, context, reportRow.caseId))) throw new HttpError(403, 'Case assignment required');
        if (!reportRow.reportInstanceId) throw new HttpError(409, 'P11 grounding requires a P08 ReportInstance snapshot');

        const canCreate = context.roles.some((role) => ['admin', 'pm', 'staff'].includes(role));
        if (!canCreate) throw new HttpError(403, 'User does not have authoring permission');

        const body = await readJson(req);
        assertOnlyKeys(body, new Set(['providerId', 'modelCode', 'instruction', 'sources']), 'grounding selection');
        const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : '';
        const modelCode = typeof body.modelCode === 'string' ? body.modelCode.trim() : '';
        const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
        const sourcesInput = Array.isArray(body.sources) ? body.sources : [];

        if (!providerId || !modelCode) throw new HttpError(400, 'providerId and modelCode are required');
        if (!instruction || instruction.length > 4_000) throw new HttpError(400, 'instruction must contain between 1 and 4000 characters');
        if (sourcesInput.length === 0 || sourcesInput.length > 20) throw new HttpError(400, 'Between 1 and 20 grounding sources must be selected');

        const provider = await db.aiProviderConfig.findUnique({ where: { id: providerId } });
        if (!provider || provider.organizationId !== context.user.organizationId || provider.status !== 'ACTIVE') throw new HttpError(404, 'Active provider configuration not found');
        const allowedModels = parseStringArray(provider.allowedModelsJson, 'provider model allowlist');
        if (!allowedModels.includes(modelCode)) throw new HttpError(400, 'Model is not allowed for the selected provider');

        const sectionRow = reportRow.sections[0];
        const validatedItems: Array<{
          id: string;
          sourceType: 'MATERIAL' | 'MEETING';
          sourceId: string;
          sourceVersionId: string;
          sourceVersionNumber: number;
          sourceSha256: string;
          allowedAnchorsJson: string;
          orderIndex: number;
        }> = [];

        for (let idx = 0; idx < sourcesInput.length; idx++) {
          const src = sourcesInput[idx] as Record<string, unknown> | null;
          if (!src || typeof src !== 'object' || Array.isArray(src)) throw new HttpError(400, 'Invalid source specification');
          const sourceType = src.sourceType === 'MEETING' ? 'MEETING' : src.sourceType === 'MATERIAL' ? 'MATERIAL' : null;
          const sourceId = typeof src.sourceId === 'string' ? src.sourceId.trim() : '';
          const sourceVersionId = typeof src.sourceVersionId === 'string' ? src.sourceVersionId.trim() : '';
          if (!sourceType || !sourceId || !sourceVersionId) throw new HttpError(400, 'Invalid source specification');
          const snapshot = await loadP11GroundingSource(db, uploadDir, reportRow.caseId, reportId, {
            sourceType, sourceId, sourceVersionId, allowedAnchors: src.allowedAnchors
          });
          validatedItems.push({
            id: `GITM-${crypto.randomUUID()}`,
            sourceType: snapshot.sourceType,
            sourceId: snapshot.sourceId,
            sourceVersionId: snapshot.sourceVersionId,
            sourceVersionNumber: snapshot.sourceVersionNumber,
            sourceSha256: snapshot.sourceSha256,
            allowedAnchorsJson: JSON.stringify(snapshot.allowedAnchors),
            orderIndex: idx
          });
        }
        const sourceKeys = validatedItems.map((item) => `${item.sourceType}:${item.sourceId}:${item.sourceVersionId}`);
        if (new Set(sourceKeys).size !== sourceKeys.length) throw new HttpError(400, 'Duplicate grounding sources are not allowed');

        const casePolicy = await db.aiCasePolicy.findUnique({ where: { caseId: reportRow.caseId } });
        const policyHash = sha256Text(canonicalJson({
          caseId: reportRow.caseId,
          externalAiAllowed: casePolicy?.externalAiAllowed ?? false,
          maxTokens: casePolicy?.maxTokensPerRequest ?? 4096,
          maxCostMicros: casePolicy?.maxCostMicrosPerRequest ?? 1000000,
          allowedProviderIds: casePolicy ? parseStringArray(casePolicy.allowedProviderIdsJson, 'case provider allowlist') : []
        }));
        if (!casePolicy?.externalAiAllowed) throw new HttpError(403, 'External AI transmission is not explicitly allowed for this case');
        if (!parseStringArray(casePolicy.allowedProviderIdsJson, 'case provider allowlist').includes(providerId)) throw new HttpError(403, 'Provider is not allowlisted by the case AI policy');

        const instructionHash = sha256Text(instruction);

        const manifestPayload = {
          organizationId: context.user.organizationId,
          caseId: reportRow.caseId,
          reportId: reportRow.id,
          sectionId: sectionRow.id,
          actorId: context.user.id,
          providerId,
          modelCode,
          policyHash,
          instructionHash,
          items: validatedItems.map((item) => ({
            sourceType: item.sourceType,
            sourceId: item.sourceId,
            sourceVersionId: item.sourceVersionId,
            sourceSha256: item.sourceSha256,
            sourceVersionNumber: item.sourceVersionNumber,
            allowedAnchors: JSON.parse(item.allowedAnchorsJson) as number[]
          }))
        };
        const manifestSha256 = sha256Text(canonicalJson(manifestPayload));

        const selectionId = `GSEL-${crypto.randomUUID()}`;
        const selection = await db.$transaction(async (tx) => {
          const created = await tx.aiGroundingSelection.create({
            data: {
              id: selectionId,
              organizationId: context.user.organizationId,
              caseId: reportRow.caseId,
              reportId: reportRow.id,
              sectionId: sectionRow.id,
              actorId: context.user.id,
              status: 'LOCKED',
              policyHash,
              providerId,
              modelCode,
              instructionHash,
              manifestSha256,
              items: {
                create: validatedItems.map((item) => ({
                  id: item.id,
                  sourceType: item.sourceType,
                   sourceId: item.sourceId,
                   sourceVersionId: item.sourceVersionId,
                   sourceVersionNumber: item.sourceVersionNumber,
                   sourceSha256: item.sourceSha256,
                  allowedAnchorsJson: item.allowedAnchorsJson,
                  orderIndex: item.orderIndex
                }))
              }
            },
            include: { items: true }
          });

          await tx.auditLog.create({
            data: requestAudit(context, 'AI_GROUNDING_SELECTED', 'AiGroundingSelection', selectionId, {
              caseId: reportRow.caseId,
              manifestSha256,
              itemCount: validatedItems.length
            })
          });

          return created;
        });

        sendJson(res, 201, { selection });
        return;
      }

      // 2. POST /api/reports/:reportId/sections/:sectionId/ai/suggestions
      const suggestionCreateMatch = pathname.match(/^\/api\/reports\/([^/]+)\/sections\/([^/]+)\/ai\/suggestions$/);
      if (suggestionCreateMatch && req.method === 'POST') {
        const reportId = suggestionCreateMatch[1];
        const sectionId = suggestionCreateMatch[2];

        const reportRow = await db.report.findUnique({
          where: { id: reportId },
          include: { case: true, sections: { where: { id: sectionId } } }
        });
        if (!reportRow || reportRow.case.deletedAt || reportRow.sections.length === 0) {
          throw new HttpError(404, 'Report or Section not found');
        }
        if (reportRow.case.organizationId !== context.user.organizationId) {
          throw new HttpError(403, 'Cross-tenant access forbidden');
        }
        if (!(await canAccessCase(db, context, reportRow.caseId))) throw new HttpError(403, 'Case assignment required');

        const canCreate = context.roles.some((role) => ['admin', 'pm', 'staff'].includes(role));
        if (!canCreate) throw new HttpError(403, 'User does not have authoring permission');

        const body = await readJson(req);
        assertOnlyKeys(body, new Set(['selectionId', 'instruction', 'idempotencyKey', 'waitForCompletion', 'testMode']), 'AI suggestion');
        const selectionId = String(body.selectionId ?? '').trim();
        const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
        const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
        const waitForCompletion = body.waitForCompletion !== false;
        const requestedTestMode = body.testMode === undefined ? null : String(body.testMode).trim();

        if (!selectionId || !idempotencyKey || idempotencyKey.length > 128) throw new HttpError(400, 'selectionId and an idempotencyKey of at most 128 characters are required');
        if (!instruction || instruction.length > 4_000) throw new HttpError(400, 'instruction must contain between 1 and 4000 characters');

        const selection = await db.aiGroundingSelection.findUnique({
          where: { id: selectionId },
          include: { items: true }
        });
        if (!selection || selection.reportId !== reportId || selection.sectionId !== sectionId || selection.caseId !== reportRow.caseId
          || selection.organizationId !== context.user.organizationId || selection.actorId !== context.user.id || selection.status !== 'LOCKED') {
          throw new HttpError(404, 'Grounding selection not found');
        }
        if (selection.instructionHash !== sha256Text(instruction)) throw new HttpError(409, 'Instruction changed after the grounding manifest was locked');

        const policy = await db.aiCasePolicy.findUnique({ where: { caseId: reportRow.caseId } });
        const currentPolicyHash = sha256Text(canonicalJson({
          caseId: reportRow.caseId,
          externalAiAllowed: policy?.externalAiAllowed ?? false,
          maxTokens: policy?.maxTokensPerRequest ?? 4096,
          maxCostMicros: policy?.maxCostMicrosPerRequest ?? 1_000_000,
          allowedProviderIds: policy ? parseStringArray(policy.allowedProviderIdsJson, 'case provider allowlist') : []
        }));
        if (selection.policyHash !== currentPolicyHash) throw new HttpError(409, 'AI policy changed after selection; lock a new grounding manifest');

        const provider = await db.aiProviderConfig.findUnique({ where: { id: selection.providerId } });
        if (!provider || provider.organizationId !== context.user.organizationId) throw new HttpError(404, 'Provider configuration not found');
        if (requestedTestMode && (!allowTestAiModes || provider.providerKind !== 'LOCAL_FAKE' || !P11_TEST_MODES.has(requestedTestMode))) {
          throw new HttpError(400, 'P11 deterministic testMode is unavailable outside an explicitly enabled LOCAL_FAKE test server');
        }

        const sourceSnapshots: P11GroundingSnapshot[] = [];
        for (const item of [...selection.items].sort((left, right) => left.orderIndex - right.orderIndex)) {
          let rawAnchors: unknown;
          try { rawAnchors = JSON.parse(item.allowedAnchorsJson); } catch { throw new HttpError(409, 'Stored grounding anchor manifest is corrupt'); }
          const snapshot = await loadP11GroundingSource(db, uploadDir, reportRow.caseId, reportId, {
            sourceType: item.sourceType as 'MATERIAL' | 'MEETING', sourceId: item.sourceId,
            sourceVersionId: item.sourceVersionId, allowedAnchors: rawAnchors
          });
          if (snapshot.sourceVersionNumber !== item.sourceVersionNumber || snapshot.sourceSha256 !== item.sourceSha256) {
            throw new HttpError(409, 'Grounding source changed after selection; lock a new manifest');
          }
          sourceSnapshots.push(snapshot);
        }

        const idempotencyFingerprint = sha256Text(canonicalJson({
          organizationId: context.user.organizationId, caseId: reportRow.caseId, actorId: context.user.id,
          reportId, sectionId, manifestSha256: selection.manifestSha256, policyHash: selection.policyHash,
          providerId: selection.providerId, modelCode: selection.modelCode, instructionHash: selection.instructionHash
        }));
        const existingSuggestion = await db.aiDraftSuggestion.findUnique({
          where: { organizationId_caseId_sectionId_idempotencyKey: { organizationId: context.user.organizationId, caseId: reportRow.caseId, sectionId, idempotencyKey } },
          include: { citations: true, selection: { include: { items: true } }, appliedRevision: true }
        });
        if (existingSuggestion) {
          if (existingSuggestion.idempotencyFingerprint !== idempotencyFingerprint) throw new HttpError(409, 'Idempotency key reused with a different P11 request payload');
          sendJson(res, existingSuggestion.status === 'PROCESSING' ? 202 : 200, { suggestion: existingSuggestion });
          return;
        }

        const promptPayload = {
          schemaVersion: 'P11_PROMPT_V1',
          testMode: requestedTestMode ?? 'GROUNDED_SUCCESS',
          manifestSha256: selection.manifestSha256,
          instruction,
          untrustedSources: true,
          sources: sourceSnapshots.map((source) => ({
            sourceType: source.sourceType, sourceId: source.sourceId, sourceVersionId: source.sourceVersionId,
            sourceSha256: source.sourceSha256,
            anchors: source.allowedAnchors.map((index) => ({ index, text: source.paragraphs[index] }))
          }))
        };
        const promptText = `P11_GROUNDED_PAYLOAD:${canonicalJson(promptPayload)}`;
        const gatewayIdempotencyKey = `P11-${sha256Text(`${idempotencyKey}:${idempotencyFingerprint}`).slice(0, 80)}`;
        const controller = new AbortController();
        let resolveKnown!: (value: { requestId: string; status: string }) => void;
        let rejectKnown!: (error: unknown) => void;
        const knownRequest = new Promise<{ requestId: string; status: string }>((resolve, reject) => { resolveKnown = resolve; rejectKnown = reject; });
        void knownRequest.catch(() => undefined);
        const execution = processAiGenerationRequest(db, {
          organizationId: context.user.organizationId,
          caseId: reportRow.caseId,
          userId: context.user.id,
          providerConfigId: selection.providerId,
          modelCode: selection.modelCode,
          prompt: promptText,
          idempotencyKey: gatewayIdempotencyKey,
          auditLogFactory: (event: AiAuditEvent, targetId, metadata) => requestAudit(
            context,
            {
              STARTED: 'AI_SUGGESTION_REQUESTED', COMPLETED: 'AI_SUGGESTION_GATEWAY_COMPLETED', FAILED: 'AI_SUGGESTION_GATEWAY_FAILED',
              CANCELED: 'AI_SUGGESTION_GATEWAY_CANCELED', POLICY_BLOCKED: 'AI_SUGGESTION_POLICY_BLOCKED', BUDGET_BLOCKED: 'AI_SUGGESTION_BUDGET_BLOCKED'
            }[event],
            event === 'POLICY_BLOCKED' || event === 'BUDGET_BLOCKED' ? 'CaseItem' : 'AiGenerationRequest',
            targetId,
            { caseId: reportRow.caseId, selectionId, ...metadata }
          )
        }, { abortSignal: controller.signal, persistResultText: false, onRequestKnown: (requestId, status) => resolveKnown({ requestId, status }) });
        void execution.catch(rejectKnown);

        let known: { requestId: string; status: string };
        try { known = await knownRequest; } catch (error) {
          if (error instanceof AiGatewayError) throw new HttpError(error.status, error.message);
          throw error;
        }

        const suggestionId = `SUGG-${crypto.randomUUID()}`;
        let processingSuggestion;
        try {
          processingSuggestion = await db.aiDraftSuggestion.create({
            data: {
              id: suggestionId, selectionId: selection.id, requestId: known.requestId,
              organizationId: context.user.organizationId, caseId: reportRow.caseId, reportId, sectionId,
              actorId: context.user.id, status: 'PROCESSING', schemaVersion: P11_OUTPUT_SCHEMA_VERSION,
              summaryText: '', outputSha256: null, promptMode: requestedTestMode ?? 'PRODUCTION',
              idempotencyKey, idempotencyFingerprint
            },
            include: { citations: true, selection: { include: { items: true } }, appliedRevision: true }
          });
        } catch (error) {
          if (typeof error !== 'object' || error === null || (error as { code?: unknown }).code !== 'P2002') throw error;
          const raced = await db.aiDraftSuggestion.findUnique({
            where: { organizationId_caseId_sectionId_idempotencyKey: { organizationId: context.user.organizationId, caseId: reportRow.caseId, sectionId, idempotencyKey } },
            include: { citations: true, selection: { include: { items: true } }, appliedRevision: true }
          });
          if (!raced || raced.idempotencyFingerprint !== idempotencyFingerprint) throw new HttpError(409, 'Idempotency key concurrently reused with a different payload');
          sendJson(res, raced.status === 'PROCESSING' ? 202 : 200, { suggestion: raced });
          return;
        }

        const finalizeSuggestion = async () => {
          let gatewayResult;
          try { gatewayResult = await execution; } catch (error) {
            await db.aiDraftSuggestion.updateMany({ where: { id: suggestionId, status: 'PROCESSING' }, data: { status: 'FAILED' } });
            if (error instanceof AiGatewayError) throw new HttpError(error.status, error.message);
            throw error;
          }
          if (gatewayResult.status !== 'COMPLETED' || !gatewayResult.resultText) {
            const terminalStatus = gatewayResult.status === 'CANCELED' ? 'CANCELED' : 'FAILED';
            await db.$transaction(async (tx) => {
              const changed = await tx.aiDraftSuggestion.updateMany({ where: { id: suggestionId, status: 'PROCESSING' }, data: { status: terminalStatus } });
              if (changed.count === 1) {
                await tx.auditLog.create({ data: requestAudit(context, terminalStatus === 'CANCELED' ? 'AI_SUGGESTION_CANCELED' : 'AI_SUGGESTION_FAILED', 'AiDraftSuggestion', suggestionId, { caseId: reportRow.caseId, requestId: gatewayResult.requestId }) });
              }
            });
            return db.aiDraftSuggestion.findUniqueOrThrow({ where: { id: suggestionId }, include: { citations: true, selection: { include: { items: true } }, appliedRevision: true } });
          }

          const rawOutputSha256 = sha256Text(gatewayResult.resultText);
          let parsedOutput: P11ProviderOutput;
          try { parsedOutput = parseP11ProviderOutput(gatewayResult.resultText); } catch {
            await db.$transaction(async (tx) => {
              await tx.aiDraftSuggestion.update({ where: { id: suggestionId }, data: { status: 'BLOCKED', summaryText: '공급자 응답 스키마 또는 인용 구조가 유효하지 않아 차단되었습니다.', outputSha256: rawOutputSha256 } });
              await tx.auditLog.create({ data: requestAudit(context, 'AI_CITATION_FAILED', 'AiDraftSuggestion', suggestionId, { caseId: reportRow.caseId, requestId: gatewayResult.requestId, reasonCode: 'OUTPUT_SCHEMA_INVALID' }) });
            });
            return db.aiDraftSuggestion.findUniqueOrThrow({ where: { id: suggestionId }, include: { citations: true, selection: { include: { items: true } }, appliedRevision: true } });
          }

          const secretLike = /(?:\bsk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|api[_-]?key\s*[:=])/i;
          const validatedCitations: Array<P11ProviderClaim & { id: string }> = [];
          let allClaimsValid = !secretLike.test(parsedOutput.summary);
          const failureCodes: string[] = [];
          for (const claim of parsedOutput.claims) {
            const source = sourceSnapshots.find((candidate) => candidate.sourceType === claim.sourceType && candidate.sourceId === claim.sourceId
              && candidate.sourceVersionId === claim.sourceVersionId && candidate.sourceSha256 === claim.sourceSha256);
            const anchorAllowed = source?.allowedAnchors.includes(claim.anchorIndex) ?? false;
            const anchorMatches = Boolean(source && source.paragraphs[claim.anchorIndex] === claim.anchorText);
            const conflictValid = claim.status !== 'CONFLICT' || Boolean(claim.conflictSourceId && claim.conflictSourceId !== claim.sourceId
              && sourceSnapshots.some((candidate) => candidate.sourceId === claim.conflictSourceId));
            const exact = Boolean(source && anchorAllowed && anchorMatches && conflictValid && !secretLike.test(`${claim.claimText} ${claim.anchorText}`));
            if (!exact) failureCodes.push('CITATION_PROVENANCE_INVALID');
            if (claim.status !== 'VALID') failureCodes.push(claim.status);
            allClaimsValid = allClaimsValid && exact && claim.status === 'VALID';
            if (exact) validatedCitations.push({ ...claim, id: `CIT-${crypto.randomUUID()}` });
          }
          const suggestionStatus = allClaimsValid ? 'GENERATED' : 'BLOCKED';
          const safeSummary = secretLike.test(parsedOutput.summary)
            ? '공급자 출력에서 비밀정보 형태의 문자열이 탐지되어 차단되었습니다.'
            : parsedOutput.summary;
          await db.$transaction(async (tx) => {
            await tx.aiDraftSuggestion.update({ where: { id: suggestionId }, data: { status: suggestionStatus, summaryText: safeSummary, outputSha256: rawOutputSha256 } });
            for (const citation of validatedCitations) {
              await tx.aiCitation.create({ data: {
                id: citation.id, suggestionId, targetClaimIndex: citation.claimIndex, claimText: citation.claimText,
                sourceType: citation.sourceType, sourceId: citation.sourceId, sourceVersionId: citation.sourceVersionId,
                sourceSha256: citation.sourceSha256, anchorIndex: citation.anchorIndex, anchorText: citation.anchorText,
                status: citation.status, conflictSourceId: citation.conflictSourceId ?? null
              } });
            }
            await tx.auditLog.create({ data: requestAudit(context, suggestionStatus === 'GENERATED' ? 'AI_SUGGESTION_GENERATED' : 'AI_CITATION_FAILED', 'AiDraftSuggestion', suggestionId, {
              caseId: reportRow.caseId, requestId: gatewayResult.requestId, citationCount: validatedCitations.length,
              failureCodes: [...new Set(failureCodes)]
            }) });
          });
          return db.aiDraftSuggestion.findUniqueOrThrow({ where: { id: suggestionId }, include: { citations: true, selection: { include: { items: true } }, appliedRevision: true } });
        };

        if (known.status === 'PROCESSING') inFlightAiRequests.set(known.requestId, controller);
        if (!waitForCompletion && known.status === 'PROCESSING') {
          void finalizeSuggestion().catch(async () => {
            await db.aiDraftSuggestion.updateMany({ where: { id: suggestionId, status: 'PROCESSING' }, data: { status: 'FAILED' } }).catch(() => undefined);
          }).finally(() => inFlightAiRequests.delete(known.requestId));
          sendJson(res, 202, { suggestion: processingSuggestion });
          return;
        }

        try {
          const finalized = await finalizeSuggestion();
          sendJson(res, 201, { suggestion: finalized });
        } finally {
          inFlightAiRequests.delete(known.requestId);
        }
        return;
      }

      // 3. GET /api/reports/:reportId/sections/:sectionId/ai/suggestions
      const suggestionListMatch = pathname.match(/^\/api\/reports\/([^/]+)\/sections\/([^/]+)\/ai\/suggestions$/);
      if (suggestionListMatch && req.method === 'GET') {
        const reportId = suggestionListMatch[1];
        const sectionId = suggestionListMatch[2];

        const reportRow = await db.report.findUnique({ where: { id: reportId }, include: { case: true, sections: { where: { id: sectionId }, select: { id: true } } } });
        if (!reportRow || reportRow.case.organizationId !== context.user.organizationId) {
          throw new HttpError(404, 'Report not found');
        }
        if (!(await canAccessCase(db, context, reportRow.caseId))) throw new HttpError(403, 'Case assignment required');
        if (reportRow.sections.length !== 1) throw new HttpError(404, 'Report section not found');

        const suggestions = await db.aiDraftSuggestion.findMany({
          where: { reportId, sectionId, caseId: reportRow.caseId, organizationId: context.user.organizationId },
          include: { citations: true, selection: { include: { items: true } }, appliedRevision: true },
          orderBy: { createdAt: 'desc' }
        });

        sendJson(res, 200, { suggestions });
        return;
      }

      // 4. POST /api/reports/:reportId/sections/:sectionId/ai/suggestions/:suggestionId/apply
      const suggestionApplyMatch = pathname.match(/^\/api\/reports\/([^/]+)\/sections\/([^/]+)\/ai\/suggestions\/([^/]+)\/apply$/);
      if (suggestionApplyMatch && req.method === 'POST') {
        const reportId = suggestionApplyMatch[1];
        const sectionId = suggestionApplyMatch[2];
        const suggestionId = suggestionApplyMatch[3];

        const reportRow = await db.report.findUnique({
          where: { id: reportId },
          include: { case: true, sections: { where: { id: sectionId } } }
        });
        if (!reportRow || reportRow.case.deletedAt || reportRow.sections.length === 0) {
          throw new HttpError(404, 'Report or Section not found');
        }
        if (reportRow.case.organizationId !== context.user.organizationId) {
          throw new HttpError(403, 'Cross-tenant access forbidden');
        }
        if (!(await canAccessCase(db, context, reportRow.caseId))) throw new HttpError(403, 'Case assignment required');

        const canApply = context.roles.some((role) => ['admin', 'pm', 'staff'].includes(role));
        if (!canApply) throw new HttpError(403, 'User does not have authoring permission to apply suggestions');

        const body = await readJson(req);
        assertOnlyKeys(body, new Set(['expectedVersion', 'idempotencyKey']), 'suggestion apply');
        const expectedVersion = requiredPositiveInteger(body.expectedVersion, 'expectedVersion');
        const applyIdempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
        if (!applyIdempotencyKey || applyIdempotencyKey.length > 128) throw new HttpError(400, 'Apply idempotencyKey is required and must not exceed 128 characters');

        const sectionRow = reportRow.sections[0];
        const suggestionRow = await db.aiDraftSuggestion.findUnique({
          where: { id: suggestionId },
          include: {
            citations: true,
            selection: { include: { items: true } },
            appliedRevision: { include: { author: true, evidenceLinks: true } }
          }
        });
        if (!suggestionRow || suggestionRow.reportId !== reportId || suggestionRow.caseId !== reportRow.caseId
          || suggestionRow.sectionId !== sectionId || suggestionRow.organizationId !== context.user.organizationId) {
          throw new HttpError(404, 'Draft suggestion not found');
        }
        const applyFingerprint = sha256Text(canonicalJson({ suggestionId, reportId, sectionId, actorId: context.user.id, expectedVersion }));
        if (suggestionRow.status === 'APPLIED') {
          if (suggestionRow.applyIdempotencyKey !== applyIdempotencyKey || suggestionRow.applyFingerprint !== applyFingerprint || !suggestionRow.appliedRevision) {
            throw new HttpError(409, 'Suggestion was already applied with a different request payload');
          }
          sendJson(res, 200, { revision: suggestionRow.appliedRevision, suggestion: suggestionRow, sectionVersion: expectedVersion + 1, idempotentReplay: true });
          return;
        }
        if (sectionRow.status === 'APPROVED') {
          throw new HttpError(400, 'Approved section must be unlocked before applying a new revision');
        }
        if (suggestionRow.status !== 'GENERATED') {
          throw new HttpError(400, `Cannot apply suggestion in ${suggestionRow.status} state`);
        }
        if (sectionRow.version !== expectedVersion) throw new HttpError(409, 'Stale section version conflict');
        if (suggestionRow.citations.length < 1 || suggestionRow.citations.some((citation) => citation.status !== 'VALID')) {
          throw new HttpError(409, 'Only a fully grounded suggestion with VALID citations can be applied');
        }

        const newRevisionId = `REV-${crypto.randomUUID()}`;
        const newContent = suggestionRow.summaryText;
        const evidenceRows = suggestionRow.citations.map((citation) => {
          const item = suggestionRow.selection.items.find((candidate) => candidate.sourceType === citation.sourceType
            && candidate.sourceId === citation.sourceId && candidate.sourceVersionId === citation.sourceVersionId
            && candidate.sourceSha256 === citation.sourceSha256);
          if (!item) throw new HttpError(409, 'Suggestion citation provenance is incomplete');
          return {
            id: `EVID-${crypto.randomUUID()}`,
            sourceType: citation.sourceType === 'MATERIAL' ? 'DOCUMENT' as const : 'MEETING' as const,
            sourceId: citation.sourceType === 'MATERIAL' ? citation.sourceVersionId : citation.sourceId,
            sourceDocumentVersionId: citation.sourceType === 'MATERIAL' ? citation.sourceVersionId : null,
            sourceMeetingId: citation.sourceType === 'MEETING' ? citation.sourceId : null,
            sourceSha256: citation.sourceSha256,
            sourceVersion: item.sourceVersionNumber,
            targetParagraphIndex: 0,
            quoteText: citation.anchorText,
            anchorPosition: `paragraph:${citation.anchorIndex + 1}`
          };
        }).filter((entry, index, rows) => rows.findIndex((candidate) => `${candidate.sourceType}:${candidate.sourceId}:${candidate.targetParagraphIndex}` === `${entry.sourceType}:${entry.sourceId}:${entry.targetParagraphIndex}`) === index);
        const evidenceMaterial = evidenceRows.map((entry) => ({
          sourceType: entry.sourceType, sourceId: entry.sourceId, sourceSha256: entry.sourceSha256,
          sourceVersion: entry.sourceVersion, targetParagraphIndex: entry.targetParagraphIndex,
          quoteText: entry.quoteText, anchorPosition: entry.anchorPosition
        }));
        const structuredValue = {
          aiSuggestionId: suggestionId,
          groundingManifestSha256: suggestionRow.selection.manifestSha256,
          providerId: suggestionRow.selection.providerId,
          modelCode: suggestionRow.selection.modelCode,
          outputSha256: suggestionRow.outputSha256
        };
        const validation = validateP09Paragraphs(newContent, evidenceRows);
        const revisionMaterial = { title: sectionRow.title, content: newContent, structuredData: structuredValue, evidence: evidenceMaterial };
        const sha256 = sha256Text(canonicalJson(revisionMaterial));
        const inputSha256 = sha256Text(canonicalJson({ ...revisionMaterial, expectedVersion }));

        const result = await db.$transaction(async (tx) => {
          const updatedSection = await tx.reportSection.updateMany({
            where: { id: sectionId, reportId, deletedAt: null, version: expectedVersion, status: { not: 'APPROVED' } },
            data: { version: { increment: 1 }, status: 'DRAFT', updatedAt: new Date() }
          });
          if (updatedSection.count !== 1) {
            throw new HttpError(409, 'Stale section version conflict during apply transaction');
          }
          const lastRev = await tx.reportSectionRevision.findFirst({ where: { sectionId }, orderBy: { revisionNumber: 'desc' } });
          const newRevisionNumber = lastRev ? lastRev.revisionNumber + 1 : 1;

          const createdRevision = await tx.reportSectionRevision.create({
            data: {
              id: newRevisionId, sectionId, revisionNumber: newRevisionNumber, title: sectionRow.title,
              content: newContent, structuredDataJson: canonicalJson(structuredValue), validationStatus: validation.status,
              validationErrorsJson: JSON.stringify(validation.errors), inputSha256, sha256, authorId: context.user.id,
              evidenceLinks: { create: evidenceRows }
            },
            include: { author: true, evidenceLinks: true }
          });

          const updatedSuggestion = await tx.aiDraftSuggestion.update({
            where: { id: suggestionId },
            data: {
              status: 'APPLIED',
              appliedRevisionId: newRevisionId,
              appliedAt: new Date(),
              appliedActorId: context.user.id,
              applyIdempotencyKey,
              applyFingerprint
            }
          });

          await tx.auditLog.create({
            data: requestAudit(context, 'AI_SUGGESTION_APPLIED', 'AiDraftSuggestion', suggestionId, {
              caseId: reportRow.caseId,
              revisionId: newRevisionId,
              revisionNumber: newRevisionNumber,
              manifestSha256: suggestionRow.selection.manifestSha256,
              evidenceCount: evidenceRows.length
            })
          });

          await tx.auditLog.create({ data: requestAudit(context, 'REPORT_SECTION_REVISION_CREATED', 'ReportSectionRevision', newRevisionId, {
            reportId, sectionId, revisionNumber: newRevisionNumber, revisionSha256: sha256,
            validationStatus: validation.status, evidenceCount: evidenceRows.length, saveMode: 'AI_HUMAN_APPLY', suggestionId
          }) });

          return { revision: createdRevision, suggestion: updatedSuggestion };
        });

        sendJson(res, 200, { revision: result.revision, suggestion: result.suggestion, sectionVersion: expectedVersion + 1, idempotentReplay: false });
        return;
      }

      // 5. POST /api/reports/:reportId/sections/:sectionId/ai/suggestions/:suggestionId/cancel
      const suggestionCancelMatch = pathname.match(/^\/api\/reports\/([^/]+)\/sections\/([^/]+)\/ai\/suggestions\/([^/]+)\/cancel$/);
      if (suggestionCancelMatch && req.method === 'POST') {
        const [, reportId, sectionId, suggestionId] = suggestionCancelMatch;
        const reportRow = await db.report.findUnique({ where: { id: reportId }, include: { case: true, sections: { where: { id: sectionId }, select: { id: true } } } });
        if (!reportRow || reportRow.sections.length !== 1 || reportRow.case.organizationId !== context.user.organizationId) throw new HttpError(404, 'Report or section not found');
        if (!(await canAccessCase(db, context, reportRow.caseId))) throw new HttpError(403, 'Case assignment required');
        const suggestion = await db.aiDraftSuggestion.findUnique({ where: { id: suggestionId }, include: { request: true } });
        if (!suggestion || suggestion.organizationId !== context.user.organizationId || suggestion.caseId !== reportRow.caseId
          || suggestion.reportId !== reportId || suggestion.sectionId !== sectionId) throw new HttpError(404, 'Suggestion not found');
        if (suggestion.actorId !== context.user.id && !context.roles.includes('admin')) throw new HttpError(403, 'Cannot cancel another user\'s suggestion');
        if (suggestion.status !== 'PROCESSING' || suggestion.request.status !== 'PROCESSING') throw new HttpError(409, 'Suggestion is already in a terminal state');

        await db.$transaction(async (tx) => {
          const requestChanged = await tx.aiGenerationRequest.updateMany({
            where: { id: suggestion.requestId, status: 'PROCESSING' },
            data: { status: 'CANCELED', actualCostMicros: 0, totalTokens: 0, redactedErrorMessage: 'Canceled by user request' }
          });
          const suggestionChanged = await tx.aiDraftSuggestion.updateMany({ where: { id: suggestionId, status: 'PROCESSING' }, data: { status: 'CANCELED' } });
          if (requestChanged.count !== 1 || suggestionChanged.count !== 1) throw new HttpError(409, 'Suggestion is already in a terminal state');
          await tx.aiUsageLedger.create({ data: {
            id: `LDG-${crypto.randomUUID()}`, organizationId: suggestion.organizationId, caseId: suggestion.caseId,
            userId: suggestion.actorId, providerConfigId: suggestion.request.providerConfigId, modelCode: suggestion.request.modelCode,
            requestId: suggestion.requestId, transactionType: 'RECONCILIATION', costMicros: -suggestion.request.reservedCostMicros
          } });
          await tx.auditLog.create({ data: requestAudit(context, 'AI_SUGGESTION_CANCELED', 'AiDraftSuggestion', suggestionId, { caseId: suggestion.caseId, requestId: suggestion.requestId }) });
        });
        inFlightAiRequests.get(suggestion.requestId)?.abort();
        inFlightAiRequests.delete(suggestion.requestId);
        sendJson(res, 200, { suggestion: { id: suggestionId, status: 'CANCELED', requestId: suggestion.requestId } });
        return;
      }

      // 6. DELETE /api/reports/:reportId/sections/:sectionId/ai/suggestions/:suggestionId
      const suggestionDiscardMatch = pathname.match(/^\/api\/reports\/([^/]+)\/sections\/([^/]+)\/ai\/suggestions\/([^/]+)$/);
      if (suggestionDiscardMatch && req.method === 'DELETE') {
        const reportId = suggestionDiscardMatch[1];
        const sectionId = suggestionDiscardMatch[2];
        const suggestionId = suggestionDiscardMatch[3];

        const reportRow = await db.report.findUnique({ where: { id: reportId }, include: { case: true } });
        if (!reportRow || reportRow.case.organizationId !== context.user.organizationId) {
          throw new HttpError(404, 'Report not found');
        }
        if (!(await canAccessCase(db, context, reportRow.caseId))) throw new HttpError(403, 'Case assignment required');

        const canDiscard = context.roles.some((role) => ['admin', 'pm', 'staff'].includes(role));
        if (!canDiscard) throw new HttpError(403, 'User does not have permission to discard suggestions');

        const suggestionRow = await db.aiDraftSuggestion.findUnique({ where: { id: suggestionId } });
        if (!suggestionRow || suggestionRow.organizationId !== context.user.organizationId || suggestionRow.caseId !== reportRow.caseId
          || suggestionRow.reportId !== reportId || suggestionRow.sectionId !== sectionId) {
          throw new HttpError(404, 'Suggestion not found');
        }

        if (!['GENERATED', 'BLOCKED', 'FAILED', 'CANCELED'].includes(suggestionRow.status)) throw new HttpError(409, `Cannot discard a suggestion in ${suggestionRow.status} state`);
        if (suggestionRow.actorId !== context.user.id && !context.roles.includes('admin')) throw new HttpError(403, 'Only the suggestion creator or an admin may discard it');

        const updated = await db.$transaction(async (tx) => {
          const sug = await tx.aiDraftSuggestion.update({
            where: { id: suggestionId },
            data: { status: 'DISCARDED' }
          });
          await tx.auditLog.create({
            data: requestAudit(context, 'AI_SUGGESTION_DISCARDED', 'AiDraftSuggestion', suggestionId, {
              caseId: reportRow.caseId
            })
          });
          return sug;
        });

        sendJson(res, 200, { suggestion: updated });
        return;
      }

      // ----------------------------------------------------
      // P12 Review, Approval & Final Output API Routes
      // ----------------------------------------------------

      // 1. POST /api/reports/:reportId/review-requests
      const reviewRequestCreateMatch = pathname.match(/^\/api\/reports\/([^/]+)\/review-requests$/);
      if (reviewRequestCreateMatch && req.method === 'POST') {
        const reportId = reviewRequestCreateMatch[1];
        const reportRow = await db.report.findUnique({
          where: { id: reportId },
          include: { case: true }
        });
        if (!reportRow || reportRow.case.deletedAt || reportRow.deletedAt) {
          throw new HttpError(404, 'Report not found');
        }
        if (reportRow.case.organizationId !== context.user.organizationId) {
          throw new HttpError(403, 'Cross-tenant access forbidden');
        }
        if (!(await canAccessCase(db, context, reportRow.caseId))) throw new HttpError(403, 'Case assignment required');

        const canRequest = context.roles.some((role) => ['admin', 'pm', 'staff', 'ceo'].includes(role));
        if (!canRequest) throw new HttpError(403, 'User does not have permission to request review');

        const body = await readJson(req);
        assertOnlyKeys(body, new Set(['assignedReviewerId', 'comment', 'idempotencyKey']), 'review request');
        const assignedReviewerId = typeof body.assignedReviewerId === 'string' ? body.assignedReviewerId.trim() : undefined;
        const comment = typeof body.comment === 'string' ? body.comment.trim() : undefined;
        const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined;

        if (assignedReviewerId) {
          const reviewer = await db.user.findUnique({ where: { id: assignedReviewerId }, include: { roles: true } });
          if (!reviewer || reviewer.organizationId !== context.user.organizationId || !reviewer.isActive) {
            throw new HttpError(404, 'Assigned reviewer not found in organization');
          }
          if (!reviewer.roles.some((entry) => ['admin', 'reviewer', 'director', 'ceo'].includes(entry.roleId))) {
            throw new HttpError(400, 'Assigned user does not have a reviewer role');
          }
        }

        const idempotencyFingerprint = idempotencyKey
          ? sha256Text(canonicalJson({ reportId, requestedById: context.user.id, assignedReviewerId: assignedReviewerId || null, comment: comment || null }))
          : null;
        if (idempotencyKey) {
          const existing = await db.reportReviewRequest.findFirst({
            where: { reportId, requestedById: context.user.id, idempotencyKey },
            include: { requestedBy: true, assignedReviewer: true }
          });
          if (existing) {
            if (existing.idempotencyFingerprint !== idempotencyFingerprint) throw new HttpError(409, 'Idempotency key payload mismatch');
            sendJson(res, 200, { reviewRequest: existing, idempotentReplay: true });
            return;
          }
        }

        const reviewRequestId = `REVREQ-${crypto.randomUUID()}`;

        const reviewRequest = await db.$transaction(async (tx) => {
          const lastReq = await tx.reportReviewRequest.findFirst({ where: { reportId }, orderBy: { eventNumber: 'desc' } });
          const eventNumber = lastReq ? lastReq.eventNumber + 1 : 1;
          const reqItem = await tx.reportReviewRequest.create({
            data: {
              id: reviewRequestId,
              organizationId: context.user.organizationId,
              caseId: reportRow.caseId,
              reportId,
              requestedById: context.user.id,
              assignedReviewerId: assignedReviewerId || null,
              status: 'PENDING',
              comment: comment || null,
              idempotencyKey: idempotencyKey || null,
              idempotencyFingerprint,
              eventNumber
            },
            include: { requestedBy: true, assignedReviewer: true }
          });

          await tx.auditLog.create({
            data: requestAudit(context, 'REPORT_REVIEW_REQUESTED', 'ReportReviewRequest', reviewRequestId, {
              caseId: reportRow.caseId,
              reportId,
              assignedReviewerId: assignedReviewerId || null,
              eventNumber
            })
          });

          return reqItem;
        });

        sendJson(res, 201, { reviewRequest });
        return;
      }

      // 2. POST /api/reports/:reportId/review-requests/:requestId/changes-requested
      const reviewRequestChangesMatch = pathname.match(/^\/api\/reports\/([^/]+)\/review-requests\/([^/]+)\/changes-requested$/);
      if (reviewRequestChangesMatch && req.method === 'POST') {
        const [, reportId, requestId] = reviewRequestChangesMatch;
        const reportRow = await db.report.findUnique({ where: { id: reportId }, include: { case: true } });
        if (!reportRow || reportRow.case.organizationId !== context.user.organizationId) {
          throw new HttpError(404, 'Report not found');
        }
        if (!(await canAccessCase(db, context, reportRow.caseId))) throw new HttpError(403, 'Case assignment required');

        const canReview = context.roles.some((role) => ['admin', 'reviewer', 'director', 'ceo'].includes(role));
        if (!canReview) throw new HttpError(403, 'User does not have reviewer permission to request changes');

        const body = await readJson(req);
        assertOnlyKeys(body, new Set(['comment']), 'changes requested');
        const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
        if (!comment) throw new HttpError(400, 'Comment is required when requesting changes');

        const reqRow = await db.reportReviewRequest.findUnique({ where: { id: requestId } });
        if (!reqRow || reqRow.reportId !== reportId || reqRow.organizationId !== context.user.organizationId) {
          throw new HttpError(404, 'Review request not found');
        }
        if (!['PENDING', 'RESUBMITTED'].includes(reqRow.status)) {
          throw new HttpError(409, `Cannot request changes on review request in status ${reqRow.status}`);
        }
        const latestReviewEvent = await db.reportReviewRequest.findFirst({ where: { reportId }, orderBy: { eventNumber: 'desc' } });
        if (!latestReviewEvent || latestReviewEvent.id !== requestId) throw new HttpError(409, 'Review request is not the latest event');
        if (reqRow.assignedReviewerId && reqRow.assignedReviewerId !== context.user.id && !context.roles.includes('admin')) {
          throw new HttpError(403, 'Review request is assigned to another reviewer');
        }

        const updatedReq = await db.$transaction(async (tx) => {
          const updated = await tx.reportReviewRequest.create({
            data: {
              id: `REVREQ-${crypto.randomUUID()}`,
              organizationId: reqRow.organizationId,
              caseId: reqRow.caseId,
              reportId,
              requestedById: reqRow.requestedById,
              assignedReviewerId: context.user.id,
              status: 'CHANGES_REQUESTED',
              comment,
              eventNumber: reqRow.eventNumber + 1
            },
            include: { requestedBy: true, assignedReviewer: true }
          });

          await tx.auditLog.create({
            data: requestAudit(context, 'REPORT_CHANGES_REQUESTED', 'ReportReviewRequest', updated.id, {
              caseId: reportRow.caseId,
              reportId,
              reviewerId: context.user.id,
              previousEventId: requestId
            })
          });

          return updated;
        });

        sendJson(res, 200, { reviewRequest: updatedReq });
        return;
      }

      // 3. POST /api/reports/:reportId/review-requests/:requestId/resubmit
      const reviewRequestResubmitMatch = pathname.match(/^\/api\/reports\/([^/]+)\/review-requests\/([^/]+)\/resubmit$/);
      if (reviewRequestResubmitMatch && req.method === 'POST') {
        const [, reportId, requestId] = reviewRequestResubmitMatch;
        const reportRow = await db.report.findUnique({ where: { id: reportId }, include: { case: true } });
        if (!reportRow || reportRow.case.organizationId !== context.user.organizationId) {
          throw new HttpError(404, 'Report not found');
        }
        if (!(await canAccessCase(db, context, reportRow.caseId))) throw new HttpError(403, 'Case assignment required');

        const canResubmit = context.roles.some((role) => ['admin', 'pm', 'staff', 'ceo'].includes(role));
        if (!canResubmit) throw new HttpError(403, 'User does not have permission to resubmit review request');

        const reqRow = await db.reportReviewRequest.findUnique({ where: { id: requestId } });
        if (!reqRow || reqRow.reportId !== reportId || reqRow.organizationId !== context.user.organizationId) {
          throw new HttpError(404, 'Review request not found');
        }
        if (reqRow.status !== 'CHANGES_REQUESTED') {
          throw new HttpError(409, `Cannot resubmit review request in status ${reqRow.status}`);
        }
        const latestReviewEvent = await db.reportReviewRequest.findFirst({ where: { reportId }, orderBy: { eventNumber: 'desc' } });
        if (!latestReviewEvent || latestReviewEvent.id !== requestId) throw new HttpError(409, 'Review request is not the latest event');
        if (reqRow.requestedById !== context.user.id && !context.roles.some((role) => ['admin', 'pm', 'staff', 'ceo'].includes(role))) {
          throw new HttpError(403, 'Only the requester or a case manager may resubmit review');
        }

        const body = await readJson(req);
        assertOnlyKeys(body, new Set(['comment']), 'resubmit review request');
        const comment = typeof body.comment === 'string' ? body.comment.trim() : undefined;

        const updatedReq = await db.$transaction(async (tx) => {
          const updated = await tx.reportReviewRequest.create({
            data: {
              id: `REVREQ-${crypto.randomUUID()}`,
              organizationId: reqRow.organizationId,
              caseId: reqRow.caseId,
              reportId,
              requestedById: context.user.id,
              assignedReviewerId: reqRow.assignedReviewerId,
              status: 'RESUBMITTED',
              comment: comment || reqRow.comment,
              eventNumber: reqRow.eventNumber + 1
            },
            include: { requestedBy: true, assignedReviewer: true }
          });

          await tx.auditLog.create({
            data: requestAudit(context, 'REPORT_REVIEW_RESUBMITTED', 'ReportReviewRequest', updated.id, {
              caseId: reportRow.caseId,
              reportId,
              previousEventId: requestId
            })
          });

          return updated;
        });

        sendJson(res, 200, { reviewRequest: updatedReq });
        return;
      }

      // 4. GET /api/reports/:reportId/review-requests
      const reviewRequestListMatch = pathname.match(/^\/api\/reports\/([^/]+)\/review-requests$/);
      if (reviewRequestListMatch && req.method === 'GET') {
        const reportId = reviewRequestListMatch[1];
        const reportRow = await db.report.findUnique({ where: { id: reportId }, include: { case: true } });
        if (!reportRow || reportRow.case.organizationId !== context.user.organizationId) {
          throw new HttpError(404, 'Report not found');
        }
        if (!(await canAccessCase(db, context, reportRow.caseId))) throw new HttpError(403, 'Case assignment required');

        const reviewRequests = await db.reportReviewRequest.findMany({
          where: { reportId },
          include: { requestedBy: true, assignedReviewer: true },
          orderBy: { eventNumber: 'desc' }
        });

        sendJson(res, 200, { reviewRequests });
        return;
      }

      // 5. POST /api/reports/:reportId/finalizations
      const finalizationCreateMatch = pathname.match(/^\/api\/reports\/([^/]+)\/finalizations$/);
      if (finalizationCreateMatch && req.method === 'POST') {
        const reportId = finalizationCreateMatch[1];
        const reportRow = await db.report.findUnique({
          where: { id: reportId },
          include: {
            case: true,
            reportInstance: true,
            sections: {
              where: { deletedAt: null },
              include: {
                revisions: {
                  orderBy: { revisionNumber: 'desc' },
                  take: 1,
                  include: { author: true, evidenceLinks: true, appliedSuggestion: { include: { citations: true } } }
                },
                approvals: { where: { status: 'APPROVED' }, orderBy: { eventNumber: 'desc' }, take: 1, include: { approver: true } },
                comments: { where: { isResolved: false } },
                draftSuggestions: { where: { status: { in: ['GENERATED', 'PROCESSING'] } } }
              },
              orderBy: { sectionNumber: 'asc' }
            }
          }
        });

        if (!reportRow || reportRow.case.deletedAt || reportRow.deletedAt) {
          throw new HttpError(404, 'Report not found');
        }
        if (reportRow.case.organizationId !== context.user.organizationId) {
          throw new HttpError(403, 'Cross-tenant access forbidden');
        }
        if (!(await canAccessCase(db, context, reportRow.caseId))) throw new HttpError(403, 'Case assignment required');

        const canFinalize = context.roles.some((role) => ['admin', 'director', 'reviewer', 'ceo'].includes(role));
        if (!canFinalize) throw new HttpError(403, 'User does not have permission to finalize report');

        const body = await readJson(req);
        assertOnlyKeys(body, new Set(['idempotencyKey', 'expectedVersion']), 'report finalization');
        const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined;
        const expectedVersion = boundedInteger(body.expectedVersion, reportRow.version, 1, Number.MAX_SAFE_INTEGER, 'expectedVersion');
        if (expectedVersion !== reportRow.version) throw new HttpError(409, 'Stale report version', { currentVersion: reportRow.version });

        // Perform strict readiness validations
        if (!reportRow.reportInstance) throw new HttpError(409, 'Report must be linked to a ReportInstance');

        const requiredSections = reportRow.sections.filter((s) => s.isRequired);
        if (requiredSections.length === 0) throw new HttpError(409, 'Report has no required sections');

        const blockers: string[] = [];
        const canonicalSectionsData: Array<{
          sectionId: string;
          sectionNumber: number;
          title: string;
          content: string;
          approvedRevisionId: string;
          approvedRevisionHash: string;
          approvedByUserId: string;
          approvedAt: string;
          evidence: Array<{ sourceType: string; sourceId: string; sourceSha256: string; sourceVersion: number; targetParagraphIndex: number }>;
        }> = [];

        let evidenceCountTotal = 0;
        let unresolvedFlagCountTotal = 0;

        for (const sec of reportRow.sections) {
          if (sec.isRequired && sec.status !== 'APPROVED') {
            blockers.push(`Section ${sec.sectionNumber} (${sec.title}) is required but not approved (status: ${sec.status})`);
          }

          const latestApproval = sec.approvals[0];
          const latestRevision = sec.revisions[0];

          if (sec.status === 'APPROVED') {
            if (!latestApproval) {
              blockers.push(`Section ${sec.sectionNumber} marked APPROVED but lacks approval record`);
              continue;
            }
            if (!latestRevision) {
              blockers.push(`Section ${sec.sectionNumber} has no revisions`);
              continue;
            }
            if (latestApproval.approvedRevisionId !== latestRevision.id) {
              blockers.push(`Section ${sec.sectionNumber} latest revision (REV-${latestRevision.revisionNumber}) does not match approved revision (${latestApproval.approvedRevisionId})`);
            }
            if (latestRevision.validationStatus !== 'VALID') {
              blockers.push(`Section ${sec.sectionNumber} approved revision is invalid (${latestRevision.validationStatus})`);
            }
            try {
              const validationErrors = JSON.parse(latestRevision.validationErrorsJson) as unknown;
              if (!Array.isArray(validationErrors) || validationErrors.length > 0) {
                blockers.push(`Section ${sec.sectionNumber} approved revision has validation errors`);
              }
            } catch {
              blockers.push(`Section ${sec.sectionNumber} approved revision validation payload is malformed`);
            }
            if (latestRevision.appliedSuggestion) {
              if (latestRevision.appliedSuggestion.status !== 'APPLIED'
                || latestRevision.appliedSuggestion.citations.some((citation) => citation.status !== 'VALID')) {
                blockers.push(`Section ${sec.sectionNumber} contains unresolved AI provenance or citations`);
              }
            }
            if (sec.comments.length > 0) {
              blockers.push(`Section ${sec.sectionNumber} has ${sec.comments.length} unresolved comments/revision requests`);
              unresolvedFlagCountTotal += sec.comments.length;
            }
            if (sec.draftSuggestions.length > 0) {
              blockers.push(`Section ${sec.sectionNumber} has pending/unapplied AI suggestions`);
              unresolvedFlagCountTotal += sec.draftSuggestions.length;
            }

            // Self-approval check: Author and Approver must be different!
            if (latestRevision.authorId === latestApproval.approverId) {
              blockers.push(`Section ${sec.sectionNumber} author (${latestRevision.author.name}) self-approved their own revision`);
            }
            if (latestRevision.authorId === context.user.id) {
              blockers.push(`Finalizing user (${context.user.name}) cannot finalize a report containing their own authored section (${sec.sectionNumber}) without independent approval`);
            }

            evidenceCountTotal += latestRevision.evidenceLinks.length;

            canonicalSectionsData.push({
              sectionId: sec.id,
              sectionNumber: sec.sectionNumber,
              title: latestRevision.title,
              content: latestRevision.content,
              approvedRevisionId: latestRevision.id,
              approvedRevisionHash: latestRevision.sha256,
              approvedByUserId: latestApproval.approverId,
              approvedAt: latestApproval.createdAt.toISOString(),
              evidence: latestRevision.evidenceLinks
                .map((link) => ({
                  sourceType: link.sourceType,
                  sourceId: link.sourceId,
                  sourceSha256: link.sourceSha256,
                  sourceVersion: link.sourceVersion,
                  targetParagraphIndex: link.targetParagraphIndex
                }))
                .sort((a, b) => `${a.sourceType}:${a.sourceId}:${a.targetParagraphIndex}`.localeCompare(`${b.sourceType}:${b.sourceId}:${b.targetParagraphIndex}`))
            });
          }
        }

        if (blockers.length > 0) {
          throw new HttpError(409, `Finalization blocked by ${blockers.length} issues: ${blockers.join('; ')}`, { blockers });
        }

        canonicalSectionsData.sort((a, b) => a.sectionNumber - b.sectionNumber);

        const canonicalSnapshotPayload = {
          reportId,
          caseId: reportRow.caseId,
          organizationId: context.user.organizationId,
          reportTemplateVersionId: reportRow.reportInstance.templateVersionId,
          sections: canonicalSectionsData
        };

        const canonicalSnapshotHash = sha256Text(canonicalJson(canonicalSnapshotPayload));
        const readinessFingerprintFor = (sections: typeof reportRow.sections): string => sha256Text(canonicalJson(sections.map((section) => ({
          id: section.id,
          version: section.version,
          sectionNumber: section.sectionNumber,
          title: section.title,
          status: section.status,
          isRequired: section.isRequired,
          revision: section.revisions[0] ? {
            id: section.revisions[0].id,
            revisionNumber: section.revisions[0].revisionNumber,
            title: section.revisions[0].title,
            content: section.revisions[0].content,
            sha256: section.revisions[0].sha256,
            validationStatus: section.revisions[0].validationStatus,
            validationErrorsJson: section.revisions[0].validationErrorsJson,
            authorId: section.revisions[0].authorId,
            evidence: section.revisions[0].evidenceLinks.map((link) => ({ id: link.id, sourceSha256: link.sourceSha256 })),
            suggestion: section.revisions[0].appliedSuggestion ? {
              id: section.revisions[0].appliedSuggestion.id,
              status: section.revisions[0].appliedSuggestion.status,
              citations: section.revisions[0].appliedSuggestion.citations.map((citation) => ({ id: citation.id, status: citation.status }))
            } : null
          } : null,
          approval: section.approvals[0] ? {
            id: section.approvals[0].id,
            eventNumber: section.approvals[0].eventNumber,
            approvedRevisionId: section.approvals[0].approvedRevisionId,
            approverId: section.approvals[0].approverId
          } : null,
          unresolvedCommentIds: section.comments.map((comment) => comment.id).sort(),
          pendingSuggestionIds: section.draftSuggestions.map((suggestion) => suggestion.id).sort()
        }))));
        const observedReadinessFingerprint = readinessFingerprintFor(reportRow.sections);

        // Check existing finalization
        const existingFinalization = await db.reportFinalization.findUnique({
          where: { reportId_canonicalSnapshotHash: { reportId, canonicalSnapshotHash } },
          include: { sections: true, finalizedBy: true }
        });

        if (existingFinalization) {
          sendJson(res, 200, { finalization: existingFinalization, idempotentReplay: true });
          return;
        }

        const finalizationId = `FIN-${crypto.randomUUID()}`;

        const finalizationResult = await db.$transaction(async (tx) => {
          const currentReport = await tx.report.findUnique({ where: { id: reportId }, select: { version: true, deletedAt: true, reportInstanceId: true, case: { select: { organizationId: true, deletedAt: true } } } });
          if (!currentReport || currentReport.deletedAt || currentReport.case.deletedAt
            || currentReport.case.organizationId !== context.user.organizationId
            || currentReport.version !== reportRow.version || currentReport.reportInstanceId !== reportRow.reportInstanceId) {
            throw new HttpError(409, 'Report changed while finalization was being prepared');
          }
          const currentSections = await tx.reportSection.findMany({
            where: { reportId, deletedAt: null },
            include: {
              revisions: {
                orderBy: { revisionNumber: 'desc' },
                take: 1,
                include: { author: true, evidenceLinks: true, appliedSuggestion: { include: { citations: true } } }
              },
              approvals: { where: { status: 'APPROVED' }, orderBy: { eventNumber: 'desc' }, take: 1, include: { approver: true } },
              comments: { where: { isResolved: false } },
              draftSuggestions: { where: { status: { in: ['GENERATED', 'PROCESSING'] } } }
            },
            orderBy: { sectionNumber: 'asc' }
          });
          if (readinessFingerprintFor(currentSections) !== observedReadinessFingerprint) {
            throw new HttpError(409, 'Section approval state changed during finalization');
          }
          const concurrentExisting = await tx.reportFinalization.findUnique({
            where: { reportId_canonicalSnapshotHash: { reportId, canonicalSnapshotHash } },
            include: { sections: true, finalizedBy: true }
          });
          if (concurrentExisting) return { finalization: concurrentExisting, created: false };
          const fin = await tx.reportFinalization.create({
            data: {
              id: finalizationId,
              organizationId: context.user.organizationId,
              caseId: reportRow.caseId,
              reportId,
              reportTemplateVersionId: reportRow.reportInstance!.templateVersionId,
              finalizedById: context.user.id,
              status: 'FINALIZED',
              canonicalSnapshotHash,
              sectionCount: canonicalSectionsData.length,
              evidenceCount: evidenceCountTotal,
              unresolvedFlagCount: unresolvedFlagCountTotal,
              idempotencyKey: idempotencyKey || null,
              idempotencyFingerprint: idempotencyKey ? sha256Text(`${reportId}:${canonicalSnapshotHash}`) : null,
              sections: {
                create: canonicalSectionsData.map((sec) => ({
                  id: `FINSEC-${crypto.randomUUID()}`,
                  sectionId: sec.sectionId,
                  sectionNumber: sec.sectionNumber,
                  title: sec.title,
                  content: sec.content,
                  approvedRevisionId: sec.approvedRevisionId,
                  approvedRevisionHash: sec.approvedRevisionHash,
                  approvedByUserId: sec.approvedByUserId,
                  approvedAt: new Date(sec.approvedAt)
                }))
              }
            },
            include: { sections: true, finalizedBy: true }
          });

          await tx.auditLog.create({
            data: requestAudit(context, 'REPORT_FINALIZED', 'ReportFinalization', finalizationId, {
              caseId: reportRow.caseId,
              reportId,
              canonicalSnapshotHash,
              sectionCount: canonicalSectionsData.length,
              evidenceCount: evidenceCountTotal
            })
          });

          return { finalization: fin, created: true };
        });

        sendJson(res, finalizationResult.created ? 201 : 200, {
          finalization: finalizationResult.finalization,
          idempotentReplay: !finalizationResult.created
        });
        return;
      }

      // 6. GET /api/reports/:reportId/finalizations
      const finalizationListMatch = pathname.match(/^\/api\/reports\/([^/]+)\/finalizations$/);
      if (finalizationListMatch && req.method === 'GET') {
        const reportId = finalizationListMatch[1];
        const reportRow = await db.report.findUnique({ where: { id: reportId }, include: { case: true } });
        if (!reportRow || reportRow.case.organizationId !== context.user.organizationId) {
          throw new HttpError(404, 'Report not found');
        }
        if (!(await canAccessCase(db, context, reportRow.caseId))) throw new HttpError(403, 'Case assignment required');

        const finalizations = await db.reportFinalization.findMany({
          where: { reportId },
          include: { sections: true, finalizedBy: true, artifacts: true },
          orderBy: { createdAt: 'desc' }
        });

        sendJson(res, 200, { finalizations });
        return;
      }

      // 7. POST /api/reports/:reportId/finalizations/:finalizationId/outputs
      const outputCreateMatch = pathname.match(/^\/api\/reports\/([^/]+)\/finalizations\/([^/]+)\/outputs$/);
      if (outputCreateMatch && req.method === 'POST') {
        const [, reportId, finalizationId] = outputCreateMatch;
        const reportRow = await db.report.findUnique({ where: { id: reportId }, include: { case: true } });
        if (!reportRow || reportRow.case.organizationId !== context.user.organizationId) {
          throw new HttpError(404, 'Report not found');
        }
        if (!(await canAccessCase(db, context, reportRow.caseId))) throw new HttpError(403, 'Case assignment required');
        if (!context.roles.some((role) => ['admin', 'director', 'reviewer', 'ceo'].includes(role))) {
          throw new HttpError(403, 'User does not have permission to generate final report outputs');
        }

        const body = await readJson(req);
        assertOnlyKeys(body, new Set(['format', 'idempotencyKey']), 'report output creation');
        const format = String(body.format ?? '').trim().toUpperCase();
        const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined;

        if (!['DOCX', 'PDF'].includes(format)) throw new HttpError(400, 'Format must be either DOCX or PDF');

        const finalization = await db.reportFinalization.findUnique({
          where: { id: finalizationId },
          include: { sections: { orderBy: { sectionNumber: 'asc' } }, finalizedBy: true }
        });
        if (!finalization || finalization.reportId !== reportId || finalization.organizationId !== context.user.organizationId) {
          throw new HttpError(404, 'Finalization snapshot not found');
        }

        // Check if output artifact already exists for this finalization + format
        const existingArtifact = await db.reportOutputArtifact.findUnique({
          where: { finalizationId_format: { finalizationId, format } },
          include: { documentVersion: true }
        });
        if (existingArtifact) {
          const existingPath = safeStoragePath(uploadDir, existingArtifact.storageKey);
          if (!fs.existsSync(existingPath) || !fs.statSync(existingPath).isFile()) throw new HttpError(409, 'Existing output artifact storage file is missing');
          const existingBytes = fs.readFileSync(existingPath);
          assertReportOutputSignature(existingArtifact.format, existingBytes);
          if (existingBytes.length !== existingArtifact.byteSize || sha256Text(existingBytes) !== existingArtifact.sha256) {
            throw new HttpError(409, 'Existing output artifact integrity verification failed');
          }
          sendJson(res, 200, { artifact: existingArtifact, idempotentReplay: true });
          return;
        }

        // Render document buffer deterministically
        let buffer: Buffer;
        if (format === 'DOCX') {
          buffer = generateReportDocxBuffer({
            finalizationId,
            canonicalSnapshotHash: finalization.canonicalSnapshotHash,
            title: reportRow.title,
            caseNumber: reportRow.case.caseNumber,
            claimType: reportRow.case.claimType,
            finalizedBy: finalization.finalizedBy.name,
            finalizedAt: finalization.createdAt.toISOString(),
            sections: finalization.sections.map((s: any) => ({
              sectionId: s.sectionId,
              sectionNumber: s.sectionNumber,
              title: s.title,
              content: s.content,
              approvedRevisionId: s.approvedRevisionId,
              approvedRevisionHash: s.approvedRevisionHash,
              approvedByUserId: s.approvedByUserId,
              approvedAt: s.approvedAt.toISOString()
            }))
          });

          const val = validateReportDocxBuffer(buffer);
          if (!val.isValid) throw new HttpError(500, 'Generated DOCX document validation failed');
        } else {
          buffer = generateReportPdfBuffer({
            finalizationId,
            canonicalSnapshotHash: finalization.canonicalSnapshotHash,
            title: reportRow.title,
            caseNumber: reportRow.case.caseNumber,
            claimType: reportRow.case.claimType,
            finalizedBy: finalization.finalizedBy.name,
            finalizedAt: finalization.createdAt.toISOString(),
            sections: finalization.sections.map((s: any) => ({
              sectionId: s.sectionId,
              sectionNumber: s.sectionNumber,
              title: s.title,
              content: s.content,
              approvedRevisionId: s.approvedRevisionId,
              approvedRevisionHash: s.approvedRevisionHash,
              approvedByUserId: s.approvedByUserId,
              approvedAt: s.approvedAt.toISOString()
            }))
          });

          const val = validateReportPdfBuffer(buffer);
          if (!val.isValid) throw new HttpError(500, 'Generated PDF document validation failed');
        }

        const sha256 = sha256Text(buffer);
        const byteSize = buffer.length;
        const mimeType = format === 'DOCX'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'application/pdf';
        const fileExt = format === 'DOCX' ? '.docx' : '.pdf';
        const storageKey = `storage-report-${sha256}${fileExt}`;
        const targetPath = safeStoragePath(uploadDir, storageKey);

        // Claim the content-addressed path exclusively. Concurrent requests never delete another request's file.
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        let createdStorageFile = false;
        try {
          fs.writeFileSync(targetPath, buffer, { flag: 'wx' });
          createdStorageFile = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          const concurrentArtifact = await db.reportOutputArtifact.findUnique({
            where: { finalizationId_format: { finalizationId, format } },
            include: { documentVersion: true }
          });
          if (!concurrentArtifact) throw new HttpError(409, 'Output generation is already in progress');
          const existingBytes = fs.readFileSync(targetPath);
          assertReportOutputSignature(concurrentArtifact.format, existingBytes);
          if (existingBytes.length !== concurrentArtifact.byteSize || sha256Text(existingBytes) !== concurrentArtifact.sha256) {
            throw new HttpError(409, 'Concurrent output artifact integrity verification failed');
          }
          sendJson(res, 200, { artifact: concurrentArtifact, idempotentReplay: true });
          return;
        }

        // Atomic DB insertion & P06 Document / DocumentVersion creation
        try {
          const resultArtifact = await db.$transaction(async (tx) => {
            // Find or create parent Document for report outputs
            const docId = `DOC-${crypto.randomUUID()}`;
            const document = await tx.document.create({
              data: {
                id: docId,
                caseId: reportRow.caseId,
                title: `${reportRow.title} Output (${format})`,
                category: 'REPORT',
                source: 'AUTHORED',
                version: 1
              }
            });

            const docVersionId = `DOCVER-${crypto.randomUUID()}`;
            await tx.documentVersion.create({
              data: {
                id: docVersionId,
                documentId: document.id,
                versionNumber: (document.version || 1),
                originalName: `${sanitizeDisplayName(reportRow.title)}_${format.toLowerCase()}${fileExt}`,
                displayName: `${reportRow.title} (${format})`,
                storageKey,
                fileSize: byteSize,
                mimeType,
                sha256,
                isFinal: true,
                uploadedById: context.user.id
              }
            });

            const artifactId = `ART-${crypto.randomUUID()}`;
            const artifact = await tx.reportOutputArtifact.create({
              data: {
                id: artifactId,
                organizationId: context.user.organizationId,
                caseId: reportRow.caseId,
                reportId,
                finalizationId,
                format,
                outputVersion: 1,
                documentVersionId: docVersionId,
                byteSize,
                sha256,
                storageKey,
                generatorVersion: 'P12_GENERATOR_V1',
                idempotencyKey: idempotencyKey || null,
                idempotencyFingerprint: idempotencyKey ? sha256Text(`${finalizationId}:${format}`) : null
              },
              include: { documentVersion: true }
            });

            await tx.auditLog.create({
              data: requestAudit(context, 'REPORT_OUTPUT_CREATED', 'ReportOutputArtifact', artifactId, {
                caseId: reportRow.caseId,
                reportId,
                finalizationId,
                format,
                sha256,
                byteSize
              })
            });

            return artifact;
          });

          sendJson(res, 201, { artifact: resultArtifact, idempotentReplay: false });
          return;
        } catch (error) {
          // Clean up disk file on DB rollback
          if (createdStorageFile && fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
          }
          throw error;
        }
      }

      // 8. GET /api/reports/:reportId/outputs
      const outputListMatch = pathname.match(/^\/api\/reports\/([^/]+)\/outputs$/);
      if (outputListMatch && req.method === 'GET') {
        const reportId = outputListMatch[1];
        const reportRow = await db.report.findUnique({ where: { id: reportId }, include: { case: true } });
        if (!reportRow || reportRow.case.organizationId !== context.user.organizationId) {
          throw new HttpError(404, 'Report not found');
        }
        if (!(await canAccessCase(db, context, reportRow.caseId))) throw new HttpError(403, 'Case assignment required');

        const artifacts = await db.reportOutputArtifact.findMany({
          where: { reportId },
          include: { documentVersion: true, downloads: true },
          orderBy: { createdAt: 'desc' }
        });

        sendJson(res, 200, { artifacts });
        return;
      }

      // 9. GET /api/reports/outputs/:artifactId/download or /api/reports/:reportId/outputs/:artifactId/download
      const outputDownloadMatch = pathname.match(/^\/api\/reports(?:|\/([^/]+))\/outputs\/([^/]+)\/download$/);
      if (outputDownloadMatch && req.method === 'GET') {
        const artifactId = outputDownloadMatch[2];
        const artifact = await db.reportOutputArtifact.findUnique({
          where: { id: artifactId },
          include: { report: true, case: true, documentVersion: true }
        });

        if (!artifact || artifact.case.deletedAt || artifact.case.organizationId !== context.user.organizationId) {
          throw new HttpError(404, 'Output artifact not found');
        }
        if (!(await canAccessCase(db, context, artifact.caseId))) throw new HttpError(403, 'Case assignment required');

        const filePath = safeStoragePath(uploadDir, artifact.storageKey);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          throw new HttpError(409, 'Output artifact storage file is missing');
        }

        const fileBytes = fs.readFileSync(filePath);
        assertReportOutputSignature(artifact.format, fileBytes);
        const actualSha256 = sha256Text(fileBytes);
        if (fileBytes.length !== artifact.byteSize || actualSha256 !== artifact.sha256) {
          throw new HttpError(409, 'Output artifact integrity verification failed');
        }

        // Record download audit & history
        const downloadId = `DL-${crypto.randomUUID()}`;
        await db.$transaction(async (tx) => {
          await tx.reportOutputDownload.create({
            data: {
              id: downloadId,
              organizationId: context.user.organizationId,
              caseId: artifact.caseId,
              artifactId,
              downloadedById: context.user.id,
              clientIp: req.socket.remoteAddress || '127.0.0.1',
              userAgent: req.headers['user-agent'] || 'unknown'
            }
          });

          await tx.auditLog.create({
            data: requestAudit(context, 'REPORT_OUTPUT_DOWNLOADED', 'ReportOutputArtifact', artifactId, {
              caseId: artifact.caseId,
              reportId: artifact.reportId,
              format: artifact.format,
              sha256: artifact.sha256
            })
          });
        });

        const safeFilename = sanitizeDisplayName(artifact.documentVersion.originalName);
        const fallbackFilename = asciiDownloadFilename(safeFilename);
        const encodedFilename = encodeURIComponent(safeFilename);

        res.statusCode = 200;
        res.setHeader('Content-Type', artifact.documentVersion.mimeType);
        res.setHeader('Content-Length', artifact.byteSize);
        res.setHeader('Content-Disposition', `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`);
        res.end(fileBytes);
        return;
      }

      // -----------------------------------------------------------------------
      // P13 Fee & Success Compensation API Endpoints
      // -----------------------------------------------------------------------
      const MAX_KRW_AMOUNT = 9_000_000_000_000_000n;
      const FEE_RATE_BPS_MAX = 10_000;
      const FEE_FORMULA_VERSION = 'KRW_INTEGER_HALF_UP_BPS_TAX_V3';
      const PAYMENT_TYPES = new Set(['PARTIAL', 'FULL', 'ADJUSTMENT']);
      const INVOICE_STATUSES = new Set(['NOT_ISSUED', 'ISSUED', 'EXEMPT']);

      function parseKrwInteger(value: unknown, label: string, allowZero = true): bigint {
        const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
        if (!/^(0|[1-9]\d*)$/.test(text)) throw new HttpError(400, `${label} must be a non-negative KRW integer string`);
        const parsed = BigInt(text);
        if ((!allowZero && parsed === 0n) || parsed > MAX_KRW_AMOUNT) {
          throw new HttpError(400, `${label} must be between ${allowZero ? '0' : '1'} and ${MAX_KRW_AMOUNT.toString()}`);
        }
        return parsed;
      }

      function parseFeeRateBps(value: unknown): number {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > FEE_RATE_BPS_MAX) {
          throw new HttpError(400, `Fee rate bps must be an integer between 0 and ${FEE_RATE_BPS_MAX}`);
        }
        return value;
      }

      function parseExpectedVersion(value: unknown, label: string): number {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new HttpError(400, `${label} is required`);
        return value;
      }

      function parseIdempotencyKey(value: unknown): string | null {
        if (value === undefined || value === null || value === '') return null;
        if (typeof value !== 'string' || value.length < 8 || value.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
          throw new HttpError(400, 'Invalid idempotency key');
        }
        return value;
      }

      function parseIsoDate(value: unknown, label: string): Date {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `${label} must be YYYY-MM-DD`);
        const parsed = new Date(`${value}T00:00:00.000Z`);
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new HttpError(400, `${label} is invalid`);
        return parsed;
      }

      const signedPaymentAmount = (payment: { paymentType: string; amount: bigint }) => payment.paymentType === 'ADJUSTMENT' ? -payment.amount : payment.amount;

      async function resolveScopedIdempotencyRace<T extends { idempotencyFingerprint: string | null }>(
        idempotencyKey: string | null,
        expectedFingerprint: string,
        lookup: () => Promise<T | null>
      ): Promise<T | null> {
        if (!idempotencyKey) return null;
        for (let attempt = 0; attempt < 7; attempt += 1) {
          const canonical = await lookup();
          if (canonical) {
            if (canonical.idempotencyFingerprint !== expectedFingerprint) throw new HttpError(409, 'Idempotency key payload mismatch');
            return canonical;
          }
          if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, Math.min(5 * (2 ** attempt), 40)));
        }
        return null;
      }

      function calculateFeeHalfUp(baseAmount: bigint, feeRateBps: number, isTaxInclusive: boolean) {
        if (baseAmount < 0n) throw new HttpError(400, 'Base amount cannot be negative');
        if (feeRateBps < 0 || feeRateBps > FEE_RATE_BPS_MAX) throw new HttpError(400, 'Fee rate bps is out of range');

        const roundedFee = (baseAmount * BigInt(feeRateBps) + 5000n) / 10000n;
        let calculatedFee = roundedFee;
        let taxAmount = 0n;
        let totalClaimFee = 0n;

        if (isTaxInclusive) {
          totalClaimFee = roundedFee;
          calculatedFee = (roundedFee * 10n + 5n) / 11n;
          taxAmount = totalClaimFee - calculatedFee;
        } else {
          taxAmount = (calculatedFee + 5n) / 10n;
          totalClaimFee = calculatedFee + taxAmount;
        }
        return { calculatedFee, taxAmount, totalClaimFee };
      }

      // P13 approver assignment is an explicit workflow step. A case author who
      // is already assigned may add an active Director/CEO from the same tenant;
      // this prevents the independent-approval policy from deadlocking real
      // UI-created cases that initially assign only their creator.
      const feeApproverMatch = pathname.match(/^\/api\/cases\/([^/]+)\/fee-approvers$/);
      if (feeApproverMatch && req.method === 'GET') {
        const caseId = feeApproverMatch[1];
        const caseRow = await db.caseItem.findUnique({ where: { id: caseId } });
        if (!caseRow || caseRow.organizationId !== context.user.organizationId || caseRow.deletedAt) {
          throw new HttpError(404, 'Case not found');
        }
        if (!(await hasCaseAssignment(db, context, caseId))) throw new HttpError(403, 'Case assignment required');
        requireAnyRole(context, new Set(['pm', 'director', 'ceo']), 'Approver assignment requires PM or higher role');

        const query = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase();
        const tenantUsers = await db.user.findMany({
          where: { organizationId: context.user.organizationId, isActive: true },
          include: {
            roles: { include: { role: true } },
            assignments: { where: { caseId }, select: { caseId: true } }
          },
          orderBy: [{ name: 'asc' }, { id: 'asc' }]
        });
        const approvers = tenantUsers
          .map((user) => ({
            id: user.id,
            name: user.name,
            email: user.email,
            roles: user.roles.map((item) => item.role.name.toLowerCase()),
            assigned: user.assignments.length > 0
          }))
          .filter((user) => user.roles.some((role) => role === 'director' || role === 'ceo'))
          .filter((user) => !query || `${user.name} ${user.email}`.toLocaleLowerCase().includes(query))
          .slice(0, 50);
        sendJson(res, 200, { approvers });
        return;
      }

      if (feeApproverMatch && req.method === 'POST') {
        const caseId = feeApproverMatch[1];
        const caseRow = await db.caseItem.findUnique({ where: { id: caseId } });
        if (!caseRow || caseRow.organizationId !== context.user.organizationId || caseRow.deletedAt) {
          throw new HttpError(404, 'Case not found');
        }
        if (!(await hasCaseAssignment(db, context, caseId))) throw new HttpError(403, 'Case assignment required');
        requireAnyRole(context, new Set(['pm', 'director', 'ceo']), 'Approver assignment requires PM or higher role');
        if (caseRow.status === 'CLOSED') throw new HttpError(409, 'Approvers cannot be assigned to a closed case');

        const body = await readJson(req) as { userId?: string; expectedCaseVersion?: number };
        const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
        if (!userId) throw new HttpError(400, 'userId is required');
        const expectedCaseVersion = parseExpectedVersion(body.expectedCaseVersion, 'expectedCaseVersion');
        const target = await db.user.findUnique({
          where: { id: userId },
          include: { roles: { include: { role: true } } }
        });
        const targetRoles = target?.roles.map((item) => item.role.name.toLowerCase()) ?? [];
        if (!target || target.organizationId !== context.user.organizationId || !target.isActive || !targetRoles.some((role) => role === 'director' || role === 'ceo')) {
          throw new HttpError(400, 'An active Director or CEO in the same organization is required');
        }

        let idempotentReplay = Boolean(await db.caseAssignment.findUnique({ where: { caseId_userId: { caseId, userId } } }));
        if (!idempotentReplay) {
          try {
            await db.$transaction(async (tx) => {
              const updated = await tx.caseItem.updateMany({
                where: { id: caseId, organizationId: context.user.organizationId, version: expectedCaseVersion, status: { not: 'CLOSED' }, deletedAt: null },
                data: { version: { increment: 1 } }
              });
              if (updated.count !== 1) throw new HttpError(409, 'Stale case version for approver assignment');
              await tx.caseAssignment.create({ data: { caseId, userId } });
              await tx.auditLog.create({
                data: requestAudit(context, 'FEE_APPROVER_ASSIGNED', 'CaseAssignment', `${caseId}:${userId}`, {
                  caseId,
                  approverId: userId,
                  approverRoles: targetRoles.filter((role) => role === 'director' || role === 'ceo')
                })
              });
            });
          } catch (reason) {
            idempotentReplay = Boolean(await db.caseAssignment.findUnique({ where: { caseId_userId: { caseId, userId } } }));
            if (!idempotentReplay) throw reason;
          }
        }
        const currentCase = await db.caseItem.findUniqueOrThrow({ where: { id: caseId } });
        sendJson(res, idempotentReplay ? 200 : 201, {
          assignment: { caseId, userId, name: target.name, email: target.email, roles: targetRoles },
          idempotentReplay,
          caseVersion: currentCase.version
        });
        return;
      }

      // 1. GET /api/cases/:caseId/fee-compensation
      const feeGetMatch = pathname.match(/^\/api\/cases\/([^/]+)\/fee-compensation$/);
      if (feeGetMatch && req.method === 'GET') {
        const caseId = feeGetMatch[1];
        const caseRow = await db.caseItem.findUnique({ where: { id: caseId } });
        if (!caseRow || caseRow.organizationId !== context.user.organizationId || caseRow.deletedAt) {
          throw new HttpError(404, 'Case not found');
        }
        if (!(await hasCaseAssignment(db, context, caseId))) throw new HttpError(403, 'Case assignment required');

        const config = await db.caseFeeConfig.findFirst({ where: { caseId, organizationId: context.user.organizationId } });
        const calculations = await db.caseFeeCalculation.findMany({
          where: { caseId, organizationId: context.user.organizationId },
          include: { actor: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: 'desc' }
        });
        const payments = await db.caseFeePayment.findMany({
          where: { caseId, organizationId: context.user.organizationId },
          include: { actor: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: 'desc' }
        });
        const audits = await db.caseFeeAudit.findMany({
          where: { caseId, organizationId: context.user.organizationId },
          include: { actor: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: 'desc' }
        });

        const authoritativeFinal = calculations.find((c) =>
          c.calcType === 'FINAL' && c.formulaVersion === FEE_FORMULA_VERSION && c.sourceCalculationId !== null
        );
        const finalCalc = authoritativeFinal ?? (
          caseRow.status === 'CLOSED' ? calculations.find((c) => c.calcType === 'FINAL') : undefined
        );
        const estCalc = calculations.find((c) => c.calcType === 'ESTIMATED');
        const activeCalc = finalCalc || estCalc;

        const totalClaimFee = activeCalc ? activeCalc.totalClaimFee : 0n;
        const totalPaid = payments.reduce((acc, p) => acc + signedPaymentAmount(p), 0n);
        const rawUnpaid = totalClaimFee - totalPaid;
        const unpaidBalance = rawUnpaid > 0n ? rawUnpaid : 0n;

        sendJson(res, 200, {
          config: config ? {
            ...config,
            contractAmount: config.contractAmount.toString(),
            baseAmount: config.baseAmount.toString()
          } : null,
          calculations: calculations.map((c) => ({
            ...c,
            contractAmount: c.contractAmount.toString(),
            baseAmount: c.baseAmount.toString(),
            calculatedFee: c.calculatedFee.toString(),
            taxAmount: c.taxAmount.toString(),
            totalClaimFee: c.totalClaimFee.toString()
          })),
          payments: payments.map((p) => ({
            ...p,
            amount: p.amount.toString()
          })),
          audits: audits.map((a) => ({
            ...a,
            unpaidBalance: a.unpaidBalance.toString()
          })),
          summary: {
            contractAmount: (config?.contractAmount ?? 0n).toString(),
            billingDate: config?.billingDate.toISOString().slice(0, 10) ?? '',
            baseAmount: (config?.baseAmount ?? 0n).toString(),
            feeRateBps: config?.feeRateBps ?? 0,
            hasSuccessFee: config?.hasSuccessFee ?? true,
            isTaxInclusive: config?.isTaxInclusive ?? false,
            confirmedFee: (finalCalc?.totalClaimFee ?? 0n).toString(),
            estimatedFee: (estCalc?.totalClaimFee ?? 0n).toString(),
            totalPaid: totalPaid.toString(),
            unpaidBalance: unpaidBalance.toString(),
            status: config?.status ?? 'DRAFT',
            version: config?.version ?? 0,
            caseVersion: caseRow.version,
            caseStatus: caseRow.status,
            latestEstimateId: estCalc?.id ?? null,
            latestEstimateActorId: estCalc?.actorId ?? null
          }
        });
        return;
      }

      // 2. POST /api/cases/:caseId/fee-compensation/calculate (estimate only)
      const feeCalcMatch = pathname.match(/^\/api\/cases\/([^/]+)\/fee-compensation\/calculate$/);
      if (feeCalcMatch && req.method === 'POST') {
        const caseId = feeCalcMatch[1];
        const caseRow = await db.caseItem.findUnique({ where: { id: caseId } });
        if (!caseRow || caseRow.organizationId !== context.user.organizationId || caseRow.deletedAt) {
          throw new HttpError(404, 'Case not found');
        }
        if (!(await hasCaseAssignment(db, context, caseId))) throw new HttpError(403, 'Case assignment required');
        const canWrite = context.roles.some((r) => ['pm', 'director', 'ceo'].includes(r.toLowerCase()));
        if (!canWrite) throw new HttpError(403, 'Fee compensation entry requires PM or higher role');
        if (caseRow.status === 'CLOSED') throw new HttpError(409, 'Closed cases cannot accept fee mutations');

        const body = (await readJson(req)) as {
          contractAmount?: string | number;
          hasSuccessFee?: boolean;
          billingDate?: string;
          baseAmount?: string | number;
          feeRateBps?: number;
          isTaxInclusive?: boolean;
          calcType?: 'ESTIMATED' | 'FINAL';
          expectedVersion?: number;
          idempotencyKey?: string;
        };

        if (body.calcType === 'FINAL') throw new HttpError(400, 'Use the independent /finalize endpoint for final approval');
        const expectedVersion = parseExpectedVersion(body.expectedVersion, 'expectedVersion');
        const idempotencyKey = parseIdempotencyKey(body.idempotencyKey);
        const contractAmount = parseKrwInteger(body.contractAmount, 'Contract amount');
        const baseAmount = parseKrwInteger(body.baseAmount, 'Base amount');
        if (typeof body.hasSuccessFee !== 'boolean' || typeof body.isTaxInclusive !== 'boolean') {
          throw new HttpError(400, 'hasSuccessFee and isTaxInclusive must be booleans');
        }
        const hasSuccessFee = body.hasSuccessFee;
        const billingDate = parseIsoDate(body.billingDate, 'billingDate');
        const feeRateBps = hasSuccessFee ? parseFeeRateBps(body.feeRateBps) : 0;
        const isTaxInclusive = hasSuccessFee ? body.isTaxInclusive : false;
        const idempotencyFingerprint = sha256Text(JSON.stringify({ contractAmount: contractAmount.toString(), hasSuccessFee, billingDate: body.billingDate, baseAmount: baseAmount.toString(), feeRateBps, isTaxInclusive, expectedVersion }));

        if (idempotencyKey) {
          const existingCalc = await db.caseFeeCalculation.findFirst({ where: { organizationId: context.user.organizationId, caseId, actorId: context.user.id, idempotencyKey } });
          if (existingCalc) {
            if (existingCalc.idempotencyFingerprint !== idempotencyFingerprint) throw new HttpError(409, 'Idempotency key payload mismatch');
            sendJson(res, 200, {
              calculation: {
                ...existingCalc,
                contractAmount: existingCalc.contractAmount.toString(),
                baseAmount: existingCalc.baseAmount.toString(),
                calculatedFee: existingCalc.calculatedFee.toString(),
                taxAmount: existingCalc.taxAmount.toString(),
                totalClaimFee: existingCalc.totalClaimFee.toString()
              },
              idempotentReplay: true
            });
            return;
          }
        }

        const currentConfig = await db.caseFeeConfig.findUnique({ where: { caseId } });
        if (currentConfig?.status === 'CONFIRMED' || (currentConfig?.version ?? 0) !== expectedVersion) {
          const canonical = await resolveScopedIdempotencyRace(idempotencyKey, idempotencyFingerprint, () => db.caseFeeCalculation.findFirst({
            where: { organizationId: context.user.organizationId, caseId, actorId: context.user.id, idempotencyKey }
          }));
          if (canonical) {
            sendJson(res, 200, {
              calculation: {
                ...canonical,
                contractAmount: canonical.contractAmount.toString(),
                baseAmount: canonical.baseAmount.toString(),
                calculatedFee: canonical.calculatedFee.toString(),
                taxAmount: canonical.taxAmount.toString(),
                totalClaimFee: canonical.totalClaimFee.toString()
              },
              idempotentReplay: true
            });
            return;
          }
          if (currentConfig?.status === 'CONFIRMED') throw new HttpError(409, 'Confirmed fee terms are immutable; record a separate adjustment event');
          throw new HttpError(409, 'Stale fee configuration version');
        }
        const { calculatedFee, taxAmount, totalClaimFee } = hasSuccessFee ? calculateFeeHalfUp(baseAmount, feeRateBps, isTaxInclusive) : { calculatedFee: 0n, taxAmount: 0n, totalClaimFee: 0n };

        let calcResult;
        try {
          calcResult = await db.$transaction(async (tx) => {
          let config = await tx.caseFeeConfig.findUnique({ where: { caseId } });
          const configId = config ? config.id : `FEECFG-${crypto.randomUUID()}`;

          if (!config) {
            config = await tx.caseFeeConfig.create({
              data: {
                id: configId,
                organizationId: context.user.organizationId,
                caseId,
                contractAmount,
                hasSuccessFee,
                billingDate,
                baseAmount,
                feeRateBps,
                isTaxInclusive,
                status: 'DRAFT',
                version: 1
              }
            });
          } else {
            const updated = await tx.caseFeeConfig.updateMany({
              where: { id: configId, version: expectedVersion, status: 'DRAFT' },
              data: {
                contractAmount,
                hasSuccessFee,
                billingDate,
                baseAmount,
                feeRateBps,
                isTaxInclusive,
                version: { increment: 1 }
              }
            });
            if (updated.count !== 1) throw new HttpError(409, 'Concurrent fee configuration update');
            config = await tx.caseFeeConfig.findUniqueOrThrow({ where: { id: configId } });
          }

          const calcId = `FEECALC-${crypto.randomUUID()}`;
          const calcRecord = await tx.caseFeeCalculation.create({
            data: {
              id: calcId,
              organizationId: context.user.organizationId,
              caseId,
              feeConfigId: configId,
              calcType: 'ESTIMATED',
              contractAmount,
              hasSuccessFee,
              billingDate,
              baseAmount,
              feeRateBps,
              isTaxInclusive,
              calculatedFee,
              taxAmount,
              totalClaimFee,
              formulaVersion: FEE_FORMULA_VERSION,
              feeConfigVersion: config.version,
              actorId: context.user.id,
              idempotencyKey,
              idempotencyFingerprint
            }
          });

          await tx.caseFeeAudit.create({
            data: {
              id: `FEEAUDIT-${crypto.randomUUID()}`,
              organizationId: context.user.organizationId,
              caseId,
              action: 'CALCULATED',
              unpaidBalance: totalClaimFee,
              detailsJson: JSON.stringify({ calcId, calculatedFee: calculatedFee.toString(), totalClaimFee: totalClaimFee.toString() }),
              actorId: context.user.id
            }
          });

          await tx.auditLog.create({
            data: requestAudit(context, 'FEE_CALCULATED', 'CaseFeeCalculation', calcId, {
              caseId,
              calcType: 'ESTIMATED',
              totalClaimFee: totalClaimFee.toString()
            })
          });

            return calcRecord;
          });
        } catch (reason) {
          const canonical = await resolveScopedIdempotencyRace(idempotencyKey, idempotencyFingerprint, () => db.caseFeeCalculation.findFirst({
            where: { organizationId: context.user.organizationId, caseId, actorId: context.user.id, idempotencyKey }
          }));
          if (!canonical) throw reason;
          sendJson(res, 200, {
            calculation: {
              ...canonical,
              contractAmount: canonical.contractAmount.toString(),
              baseAmount: canonical.baseAmount.toString(),
              calculatedFee: canonical.calculatedFee.toString(),
              taxAmount: canonical.taxAmount.toString(),
              totalClaimFee: canonical.totalClaimFee.toString()
            },
            idempotentReplay: true
          });
          return;
        }

        sendJson(res, 201, {
          calculation: {
            ...calcResult,
            contractAmount: calcResult.contractAmount.toString(),
            baseAmount: calcResult.baseAmount.toString(),
            calculatedFee: calcResult.calculatedFee.toString(),
            taxAmount: calcResult.taxAmount.toString(),
            totalClaimFee: calcResult.totalClaimFee.toString()
          },
          idempotentReplay: false
        });
        return;
      }

      // 3. POST /api/cases/:caseId/fee-compensation/finalize
      const feeFinalizeMatch = pathname.match(/^\/api\/cases\/([^/]+)\/fee-compensation\/finalize$/);
      if (feeFinalizeMatch && req.method === 'POST') {
        const caseId = feeFinalizeMatch[1];
        const caseRow = await db.caseItem.findUnique({ where: { id: caseId } });
        if (!caseRow || caseRow.organizationId !== context.user.organizationId || caseRow.deletedAt) throw new HttpError(404, 'Case not found');
        if (!(await hasCaseAssignment(db, context, caseId))) throw new HttpError(403, 'Case assignment required');
        requireAnyRole(context, new Set(['director', 'ceo']), 'Final fee approval requires Director or CEO role');
        if (caseRow.status === 'CLOSED') throw new HttpError(409, 'Closed cases cannot accept fee mutations');

        const body = await readJson(req) as { calculationId?: string; expectedVersion?: number; idempotencyKey?: string };
        const calculationId = typeof body.calculationId === 'string' ? body.calculationId : '';
        if (!calculationId) throw new HttpError(400, 'calculationId is required');
        const expectedVersion = parseExpectedVersion(body.expectedVersion, 'expectedVersion');
        const idempotencyKey = parseIdempotencyKey(body.idempotencyKey);
        const idempotencyFingerprint = sha256Text(JSON.stringify({ calculationId, expectedVersion }));

        if (idempotencyKey) {
          const replay = await db.caseFeeCalculation.findFirst({ where: { organizationId: context.user.organizationId, caseId, actorId: context.user.id, idempotencyKey, calcType: 'FINAL' } });
          if (replay) {
            if (replay.idempotencyFingerprint !== idempotencyFingerprint) throw new HttpError(409, 'Idempotency key payload mismatch');
            sendJson(res, 200, { calculation: { ...replay, contractAmount: replay.contractAmount.toString(), baseAmount: replay.baseAmount.toString(), calculatedFee: replay.calculatedFee.toString(), taxAmount: replay.taxAmount.toString(), totalClaimFee: replay.totalClaimFee.toString() }, idempotentReplay: true });
            return;
          }
        }

        const config = await db.caseFeeConfig.findUnique({ where: { caseId } });
        if (!config || config.status !== 'DRAFT' || config.version !== expectedVersion) {
          const canonical = await resolveScopedIdempotencyRace(idempotencyKey, idempotencyFingerprint, () => db.caseFeeCalculation.findFirst({
            where: { organizationId: context.user.organizationId, caseId, actorId: context.user.id, idempotencyKey, calcType: 'FINAL' }
          }));
          if (canonical) {
            sendJson(res, 200, { calculation: { ...canonical, contractAmount: canonical.contractAmount.toString(), baseAmount: canonical.baseAmount.toString(), calculatedFee: canonical.calculatedFee.toString(), taxAmount: canonical.taxAmount.toString(), totalClaimFee: canonical.totalClaimFee.toString() }, idempotentReplay: true });
            return;
          }
          if (!config || config.status !== 'DRAFT') throw new HttpError(409, 'Only a draft fee configuration can be finalized');
          throw new HttpError(409, 'Stale fee configuration version');
        }
        const estimate = await db.caseFeeCalculation.findFirst({ where: { id: calculationId, caseId, organizationId: context.user.organizationId, feeConfigId: config.id, calcType: 'ESTIMATED' } });
        if (!estimate) throw new HttpError(404, 'Estimated calculation not found');
        const latestEstimate = await db.caseFeeCalculation.findFirst({ where: { caseId, calcType: 'ESTIMATED' }, orderBy: { createdAt: 'desc' } });
        if (latestEstimate?.id !== estimate.id) throw new HttpError(409, 'Only the latest estimate can be finalized');
        if (estimate.formulaVersion !== FEE_FORMULA_VERSION) {
          throw new HttpError(409, 'Legacy fee estimates must be recalculated with the current formula before final approval');
        }
        if (estimate.actorId === context.user.id) throw new HttpError(403, 'Self-approval is forbidden');

        let finalRecord;
        try {
          finalRecord = await db.$transaction(async (tx) => {
            const finalId = `FEECALC-${crypto.randomUUID()}`;
            const created = await tx.caseFeeCalculation.create({ data: {
              id: finalId, organizationId: context.user.organizationId, caseId, feeConfigId: config.id, calcType: 'FINAL',
              contractAmount: estimate.contractAmount, hasSuccessFee: estimate.hasSuccessFee, billingDate: estimate.billingDate,
              baseAmount: estimate.baseAmount, feeRateBps: estimate.feeRateBps,
              isTaxInclusive: estimate.isTaxInclusive, calculatedFee: estimate.calculatedFee, taxAmount: estimate.taxAmount,
              totalClaimFee: estimate.totalClaimFee, formulaVersion: estimate.formulaVersion,
              feeConfigVersion: estimate.feeConfigVersion, sourceCalculationId: estimate.id,
              actorId: context.user.id, idempotencyKey, idempotencyFingerprint
            } });
            const confirmed = await tx.caseFeeConfig.findUniqueOrThrow({ where: { id: config.id } });
            if (confirmed.status !== 'CONFIRMED' || confirmed.version !== expectedVersion + 1) {
              throw new HttpError(409, 'Final approval did not atomically confirm fee terms');
            }
            await tx.caseFeeAudit.create({ data: { id: `FEEAUDIT-${crypto.randomUUID()}`, organizationId: context.user.organizationId, caseId, action: 'FINALIZED', unpaidBalance: estimate.totalClaimFee, detailsJson: JSON.stringify({ finalId, sourceCalculationId: estimate.id, totalClaimFee: estimate.totalClaimFee.toString() }), actorId: context.user.id } });
            await tx.auditLog.create({ data: requestAudit(context, 'FEE_FINALIZED', 'CaseFeeCalculation', finalId, { caseId, sourceCalculationId: estimate.id, totalClaimFee: estimate.totalClaimFee.toString() }) });
            return created;
          });
        } catch (reason) {
          const canonical = await resolveScopedIdempotencyRace(idempotencyKey, idempotencyFingerprint, () => db.caseFeeCalculation.findFirst({
            where: { organizationId: context.user.organizationId, caseId, actorId: context.user.id, idempotencyKey, calcType: 'FINAL' }
          }));
          if (!canonical) throw reason;
          sendJson(res, 200, { calculation: { ...canonical, contractAmount: canonical.contractAmount.toString(), baseAmount: canonical.baseAmount.toString(), calculatedFee: canonical.calculatedFee.toString(), taxAmount: canonical.taxAmount.toString(), totalClaimFee: canonical.totalClaimFee.toString() }, idempotentReplay: true });
          return;
        }
        sendJson(res, 201, { calculation: { ...finalRecord, contractAmount: finalRecord.contractAmount.toString(), baseAmount: finalRecord.baseAmount.toString(), calculatedFee: finalRecord.calculatedFee.toString(), taxAmount: finalRecord.taxAmount.toString(), totalClaimFee: finalRecord.totalClaimFee.toString() }, idempotentReplay: false });
        return;
      }

      // 4. POST /api/cases/:caseId/fee-compensation/payments
      const feePayMatch = pathname.match(/^\/api\/cases\/([^/]+)\/fee-compensation\/payments$/);
      if (feePayMatch && req.method === 'POST') {
        const caseId = feePayMatch[1];
        const caseRow = await db.caseItem.findUnique({ where: { id: caseId } });
        if (!caseRow || caseRow.organizationId !== context.user.organizationId || caseRow.deletedAt) {
          throw new HttpError(404, 'Case not found');
        }
        if (!(await hasCaseAssignment(db, context, caseId))) throw new HttpError(403, 'Case assignment required');
        const canWrite = context.roles.some((r) => ['pm', 'director', 'ceo'].includes(r.toLowerCase()));
        if (!canWrite) throw new HttpError(403, 'Payment recording requires PM or higher role');
        if (caseRow.status === 'CLOSED') throw new HttpError(409, 'Closed cases cannot accept fee mutations');

        const body = (await readJson(req)) as {
          amount?: string | number;
          paymentDate?: string;
          paymentType?: 'PARTIAL' | 'FULL' | 'ADJUSTMENT';
          invoiceStatus?: 'NOT_ISSUED' | 'ISSUED' | 'EXEMPT';
          invoiceIssuedAt?: string;
          invoiceNumber?: string;
          note?: string;
          expectedVersion?: number;
          idempotencyKey?: string;
        };

        const expectedVersion = parseExpectedVersion(body.expectedVersion, 'expectedVersion');
        const idempotencyKey = parseIdempotencyKey(body.idempotencyKey);
        const amount = parseKrwInteger(body.amount, 'Payment amount', false);
        const paymentType = typeof body.paymentType === 'string' && PAYMENT_TYPES.has(body.paymentType) ? body.paymentType : '';
        const invoiceStatus = typeof body.invoiceStatus === 'string' && INVOICE_STATUSES.has(body.invoiceStatus) ? body.invoiceStatus : '';
        if (!paymentType) throw new HttpError(400, 'Invalid payment type');
        if (!invoiceStatus) throw new HttpError(400, 'Invalid invoice status');
        const paymentDate = parseIsoDate(body.paymentDate, 'paymentDate');
        const invoiceIssuedAt = body.invoiceIssuedAt ? parseIsoDate(body.invoiceIssuedAt, 'invoiceIssuedAt') : null;
        const invoiceNumber = typeof body.invoiceNumber === 'string' ? body.invoiceNumber.trim() : '';
        const note = typeof body.note === 'string' ? body.note.trim() : '';
        if (invoiceNumber.length > 120 || note.length > 1000) throw new HttpError(400, 'Invoice number or note is too long');
        if (invoiceStatus === 'ISSUED' && (!invoiceNumber || !invoiceIssuedAt)) throw new HttpError(400, 'Issued invoice requires number and issue date');
        const idempotencyFingerprint = sha256Text(JSON.stringify({ amount: amount.toString(), paymentType, paymentDate: body.paymentDate, invoiceStatus, invoiceIssuedAt: body.invoiceIssuedAt ?? null, invoiceNumber, note, expectedVersion }));

        if (idempotencyKey) {
          const existingPayment = await db.caseFeePayment.findFirst({ where: { organizationId: context.user.organizationId, caseId, actorId: context.user.id, idempotencyKey } });
          if (existingPayment) {
            if (existingPayment.idempotencyFingerprint !== idempotencyFingerprint) throw new HttpError(409, 'Idempotency key payload mismatch');
            sendJson(res, 200, {
              payment: {
                ...existingPayment,
                amount: existingPayment.amount.toString()
              },
              idempotentReplay: true
            });
            return;
          }
        }

        const config = await db.caseFeeConfig.findUnique({ where: { caseId } });
        if (!config || config.status !== 'CONFIRMED' || config.version !== expectedVersion) {
          const canonical = await resolveScopedIdempotencyRace(idempotencyKey, idempotencyFingerprint, () => db.caseFeePayment.findFirst({
            where: { organizationId: context.user.organizationId, caseId, actorId: context.user.id, idempotencyKey }
          }));
          if (canonical) {
            sendJson(res, 200, { payment: { ...canonical, amount: canonical.amount.toString() }, idempotentReplay: true });
            return;
          }
          if (!config || config.status !== 'CONFIRMED') throw new HttpError(409, 'Final fee approval is required before recording payment');
          throw new HttpError(409, 'Stale fee configuration version');
        }
        const finalCalc = await db.caseFeeCalculation.findFirst({
          where: {
            caseId,
            organizationId: context.user.organizationId,
            feeConfigId: config.id,
            calcType: 'FINAL',
            formulaVersion: FEE_FORMULA_VERSION,
            sourceCalculationId: { not: null }
          },
          orderBy: { createdAt: 'desc' }
        });
        if (!finalCalc) throw new HttpError(409, 'A current independently sourced final fee calculation is required');
        const existingPayments = await db.caseFeePayment.findMany({ where: { caseId, organizationId: context.user.organizationId } });
        const currentPaid = existingPayments.reduce((acc, payment) => acc + signedPaymentAmount(payment), 0n);
        const outstanding = finalCalc.totalClaimFee - currentPaid;
        const paymentConflict = paymentType === 'ADJUSTMENT'
          ? (amount > currentPaid ? 'Adjustment cannot exceed recorded payments' : null)
          : (outstanding <= 0n || amount > outstanding
              ? 'Payment exceeds unpaid balance'
              : (paymentType === 'FULL' && amount !== outstanding ? 'FULL payment must equal the unpaid balance' : null));
        if (paymentConflict) {
          const canonical = await resolveScopedIdempotencyRace(idempotencyKey, idempotencyFingerprint, () => db.caseFeePayment.findFirst({
            where: { organizationId: context.user.organizationId, caseId, actorId: context.user.id, idempotencyKey }
          }));
          if (canonical) {
            sendJson(res, 200, { payment: { ...canonical, amount: canonical.amount.toString() }, idempotentReplay: true });
            return;
          }
          throw new HttpError(409, paymentConflict);
        }

        let payResult;
        try {
          payResult = await db.$transaction(async (tx) => {
          const updated = await tx.caseFeeConfig.updateMany({ where: { id: config.id, version: expectedVersion, status: 'CONFIRMED' }, data: { version: { increment: 1 } } });
          if (updated.count !== 1) throw new HttpError(409, 'Concurrent payment conflict');
          const payId = `FEEPAY-${crypto.randomUUID()}`;
          const payRecord = await tx.caseFeePayment.create({
            data: {
              id: payId,
              organizationId: context.user.organizationId,
              caseId,
              feeConfigId: config.id,
              paymentType,
              amount,
              paymentDate,
              invoiceStatus,
              invoiceIssuedAt,
              invoiceNumber: invoiceNumber || null,
              note: note || null,
              actorId: context.user.id,
              idempotencyKey,
              idempotencyFingerprint
            }
          });

          const allPayments = await tx.caseFeePayment.findMany({ where: { caseId } });
          const totalPaid = allPayments.reduce((acc, p) => acc + signedPaymentAmount(p), 0n);
          const totalClaimFee = finalCalc.totalClaimFee;
          const rawUnpaid = totalClaimFee - totalPaid;
          const unpaidBalance = rawUnpaid > 0n ? rawUnpaid : 0n;

          await tx.caseFeeAudit.create({
            data: {
              id: `FEEAUDIT-${crypto.randomUUID()}`,
              organizationId: context.user.organizationId,
              caseId,
              action: 'PAYMENT_ADDED',
              unpaidBalance,
              detailsJson: JSON.stringify({ payId, amount: amount.toString(), totalPaid: totalPaid.toString() }),
              actorId: context.user.id
            }
          });

          await tx.auditLog.create({
            data: requestAudit(context, 'FEE_PAYMENT_RECORDED', 'CaseFeePayment', payId, {
              caseId,
              amount: amount.toString(),
              unpaidBalance: unpaidBalance.toString()
            })
          });

            return payRecord;
          });
        } catch (reason) {
          const canonical = await resolveScopedIdempotencyRace(idempotencyKey, idempotencyFingerprint, () => db.caseFeePayment.findFirst({
            where: { organizationId: context.user.organizationId, caseId, actorId: context.user.id, idempotencyKey }
          }));
          if (!canonical) throw reason;
          sendJson(res, 200, { payment: { ...canonical, amount: canonical.amount.toString() }, idempotentReplay: true });
          return;
        }

        sendJson(res, 201, {
          payment: {
            ...payResult,
            amount: payResult.amount.toString()
          },
          idempotentReplay: false
        });
        return;
      }

      // 5. POST /api/cases/:caseId/close-with-unpaid-check
      const closeCheckMatch = pathname.match(/^\/api\/cases\/([^/]+)\/close-with-unpaid-check$/);
      if (closeCheckMatch && req.method === 'POST') {
        const caseId = closeCheckMatch[1];
        const caseRow = await db.caseItem.findUnique({ where: { id: caseId } });
        if (!caseRow || caseRow.organizationId !== context.user.organizationId || caseRow.deletedAt) {
          throw new HttpError(404, 'Case not found');
        }
        if (!(await hasCaseAssignment(db, context, caseId))) throw new HttpError(403, 'Case assignment required');

        const canWrite = context.roles.some((r) => ['pm', 'director', 'ceo'].includes(r.toLowerCase()));
        if (!canWrite) throw new HttpError(403, 'Case closure requires PM or higher role');

        const body = await readJson(req) as { forceClose?: boolean; caseVersion?: number; feeVersion?: number };
        if (body.forceClose !== undefined && typeof body.forceClose !== 'boolean') throw new HttpError(400, 'forceClose must be a boolean');
        const forceClose = body.forceClose === true;
        const caseVersion = parseExpectedVersion(body.caseVersion, 'caseVersion');
        const feeVersion = parseExpectedVersion(body.feeVersion, 'feeVersion');
        if (caseRow.status !== 'SUCCESS_FEE') throw new HttpError(409, 'Case must be in SUCCESS_FEE before closure');
        if (caseRow.version !== caseVersion) throw new HttpError(409, 'Stale case version');
        if (forceClose && !context.roles.some((role) => ['director', 'ceo'].includes(role.toLowerCase()))) throw new HttpError(403, 'Forced unpaid closure requires Director or CEO role');

        const config = await db.caseFeeConfig.findUnique({ where: { caseId } });
        if (!config || config.version !== feeVersion) throw new HttpError(409, 'Stale or missing fee configuration');
        if (config.status !== 'CONFIRMED') throw new HttpError(409, 'Independent final fee approval is required before closure');
        const finalCalc = await db.caseFeeCalculation.findFirst({
          where: {
            caseId,
            organizationId: context.user.organizationId,
            feeConfigId: config.id,
            calcType: 'FINAL',
            formulaVersion: FEE_FORMULA_VERSION,
            sourceCalculationId: { not: null }
          },
          orderBy: { createdAt: 'desc' }
        });
        if (!finalCalc) throw new HttpError(409, 'Final fee approval is required before closure');
        const payments = await db.caseFeePayment.findMany({ where: { caseId, organizationId: context.user.organizationId } });
        const totalClaimFee = finalCalc?.totalClaimFee ?? 0n;
        const totalPaid = payments.reduce((acc, p) => acc + signedPaymentAmount(p), 0n);
        const rawUnpaid = totalClaimFee - totalPaid;
        if (rawUnpaid < 0n) throw new HttpError(409, 'Payment ledger exceeds the approved fee and must be reconciled before closure');
        const unpaidBalance = rawUnpaid > 0n ? rawUnpaid : 0n;

        if (unpaidBalance > 0n && !forceClose) {
          await db.$transaction(async (tx) => {
            await tx.caseFeeAudit.create({ data: {
              id: `FEEAUDIT-${crypto.randomUUID()}`,
              organizationId: context.user.organizationId,
              caseId,
              action: 'UNPAID_CLOSE_ATTEMPTED',
              unpaidBalance,
              detailsJson: JSON.stringify({ rejected: true, reason: 'Unpaid balance remains' }),
              actorId: context.user.id
            } });
            await tx.auditLog.create({ data: requestAudit(context, 'CASE_CLOSE_BLOCKED_UNPAID', 'CaseItem', caseId, { unpaidBalance: unpaidBalance.toString() }) });
          });
          throw new HttpError(409, 'Unpaid balance remains for this case', {
            unpaidBalance: unpaidBalance.toString(),
            requiresConfirmation: true
          });
        }

        const closure = await db.$transaction(async (tx) => {
          const lockedFee = await tx.caseFeeConfig.updateMany({
            where: { id: config.id, caseId, organizationId: context.user.organizationId, version: feeVersion, status: 'CONFIRMED' },
            data: { version: { increment: 1 } }
          });
          if (lockedFee.count !== 1) throw new HttpError(409, 'Concurrent fee mutation prevented case closure');

          const currentFinal = await tx.caseFeeCalculation.findFirst({
            where: {
              caseId,
              organizationId: context.user.organizationId,
              feeConfigId: config.id,
              calcType: 'FINAL',
              formulaVersion: FEE_FORMULA_VERSION,
              sourceCalculationId: { not: null }
            },
            orderBy: { createdAt: 'desc' }
          });
          if (!currentFinal) throw new HttpError(409, 'Final fee approval is required before closure');
          const currentPayments = await tx.caseFeePayment.findMany({ where: { caseId, organizationId: context.user.organizationId } });
          const currentPaid = currentPayments.reduce((acc, payment) => acc + signedPaymentAmount(payment), 0n);
          const currentRawUnpaid = currentFinal.totalClaimFee - currentPaid;
          if (currentRawUnpaid < 0n) throw new HttpError(409, 'Payment ledger exceeds the approved fee and must be reconciled before closure');
          const currentUnpaid = currentRawUnpaid > 0n ? currentRawUnpaid : 0n;
          if (currentUnpaid > 0n && !forceClose) {
            throw new HttpError(409, 'Unpaid balance changed during case closure', {
              unpaidBalance: currentUnpaid.toString(),
              requiresConfirmation: true
            });
          }

          const changed = await tx.caseItem.updateMany({ where: { id: caseId, version: caseVersion, status: 'SUCCESS_FEE', deletedAt: null }, data: { status: 'CLOSED', version: { increment: 1 } } });
          if (changed.count !== 1) throw new HttpError(409, 'Concurrent case closure conflict');
          const updated = await tx.caseItem.findUniqueOrThrow({ where: { id: caseId } });

          await tx.statusHistory.create({ data: { id: `STHIST-${crypto.randomUUID()}`, caseId, fromStatus: 'SUCCESS_FEE', toStatus: 'CLOSED', changedById: context.user.id, reason: currentUnpaid > 0n ? 'Director-approved closure with unpaid balance' : 'Fee settlement complete' } });

          await tx.caseFeeAudit.create({
            data: {
              id: `FEEAUDIT-${crypto.randomUUID()}`,
              organizationId: context.user.organizationId,
              caseId,
              action: currentUnpaid > 0n ? 'UNPAID_CLOSED' : 'CLOSED',
              unpaidBalance: currentUnpaid,
              detailsJson: JSON.stringify({ forced: forceClose }),
              actorId: context.user.id
            }
          });

          await tx.auditLog.create({
            data: requestAudit(context, 'CASE_CLOSED', 'CaseItem', caseId, {
              unpaidBalance: currentUnpaid.toString(),
              forced: forceClose
            })
          });

          return { updated, unpaidBalance: currentUnpaid };
        });

        sendJson(res, 200, { case: closure.updated, unpaidBalance: closure.unpaidBalance.toString() });
        return;
      }

      // -----------------------------------------------------------------------
      // P15 Backup, Data Preservation & Restore API Endpoints
      // -----------------------------------------------------------------------
      if (pathname === '/api/admin/backup/create' && req.method === 'POST') {
        requireAnyRole(context, new Set(['admin']), 'Backup management requires Admin role');
        const body = await readJson(req); assertExactJsonFields(body, []);
        const manifest = await createBackupPackage({ backupRootDir, uploadDir, additionalStorageRoots: backupStorageRoots, signingKey: requireBackupSigningKey(), db });
        try {
          await db.auditLog.create({ data: auditData(context, 'BACKUP_CREATED', 'BackupPackage', manifest.backupId, {
            backupId: manifest.backupId, fileCount: manifest.files.length, totalFilesSize: manifest.totalFilesSize, databaseSha256: manifest.database.sha256
          }) });
        } catch (error) { removeBackupPackage(backupRootDir, manifest.backupId); throw error; }
        sendJson(res, 201, { manifest }); return;
      }
      if (pathname === '/api/admin/backup/list' && req.method === 'GET') {
        requireAnyRole(context, new Set(['admin']), 'Backup listing requires Admin role');
        const manifests = await listBackupPackages(backupRootDir, requireBackupSigningKey());
        sendJson(res, 200, { backups: manifests, count: manifests.length, retentionPolicy: 'Minimum 3 ready backup sets preserved' }); return;
      }
      if (pathname === '/api/admin/backup/prune-dry-run' && req.method === 'POST') {
        requireAnyRole(context, new Set(['admin']), 'Backup prune dry-run requires Admin role');
        const body = await readJson(req); assertExactJsonFields(body, ['keepCount']);
        const keepCount = boundedInteger(body.keepCount, 3, 3, 100, 'keepCount');
        const result = await pruneBackupsDryRun(backupRootDir, requireBackupSigningKey(), keepCount);
        sendJson(res, 200, { keepCount, retainedCount: result.keep.length, pruneCandidatesCount: result.pruneCandidates.length, retained: result.keep, pruneCandidates: result.pruneCandidates, dryRunNote: 'No backups were deleted during this dry-run assertion' }); return;
      }
      if (pathname === '/api/admin/backup/verify' && req.method === 'POST') {
        requireAnyRole(context, new Set(['admin']), 'Backup verification requires Admin role');
        const body = await readJson(req); assertExactJsonFields(body, ['backupId'], ['backupId']);
        const backupId = strictString(body.backupId, 'backupId', 20, 100);
        if (!/^BACKUP-[0-9TZ-]{20,40}-[0-9a-f]{8}$/.test(backupId)) throw new HttpError(400, 'Backup ID is invalid');
        const verification = await verifyBackupPackage(path.join(backupRootDir, backupId), requireBackupSigningKey());
        sendJson(res, 200, { backupId, valid: verification.valid, errors: verification.errors }); return;
      }
      if (pathname === '/api/admin/backup/restore' && req.method === 'POST') {
        requireAnyRole(context, new Set(['admin']), 'Restoration requires Admin role');
        const body = await readJson(req); assertExactJsonFields(body, ['backupId', 'restoreName', 'confirmation'], ['backupId', 'restoreName', 'confirmation']);
        const backupId = strictString(body.backupId, 'backupId', 20, 100);
        const restoreName = strictString(body.restoreName, 'restoreName', 1, 80);
        const confirmation = strictString(body.confirmation, 'confirmation', 7, 7);
        if (!/^BACKUP-[0-9TZ-]{20,40}-[0-9a-f]{8}$/.test(backupId) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(restoreName)) throw new HttpError(400, 'Backup or restore identifier is invalid');
        if (confirmation !== 'RESTORE') throw new HttpError(400, 'Explicit RESTORE confirmation is required');
        const result = await restoreBackupPackage({ backupId, backupRootDir, restoreRootDir, restoreName, signingKey: requireBackupSigningKey() });
        try {
          await db.auditLog.create({ data: auditData(context, 'BACKUP_RESTORED', 'BackupPackage', backupId, { backupId, restoreName, databaseSha256: result.manifest.database.sha256 }) });
        } catch (error) { removeRestoredPackage(restoreRootDir, restoreName); throw error; }
        sendJson(res, 200, { message: 'Backup restored to isolated target directory successfully', restoreName, manifest: result.manifest }); return;
      }

      // -----------------------------------------------------------------------
      // P14 Google Workspace Integration API Endpoints
      // -----------------------------------------------------------------------

      if (pathname === '/api/google-workspace/fake-mode' && req.method === 'POST' && !allowTestGoogleModes) {
        requireAnyRole(context, GOOGLE_ADMIN_ROLES, 'Google Workspace administration requires Admin role');
        throw new HttpError(404, 'Endpoint not found');
      }
      const googleAdapter = googleAdapterFor(context.user.organizationId);
      const googleProviderMode = fakeModeController(googleAdapter) ? 'FAKE' as const : 'REAL' as const;
      type GoogleAttemptProjection = {
        attemptNumber: number;
        responseClass: GoogleAdapterMode;
        redactedError?: string;
        retryAt: Date | null;
        durationMs: number;
      };
      type GoogleOperationRow = NonNullable<Awaited<ReturnType<typeof db.googleSyncOperation.findFirst>>>;
      type GoogleOperationReservation = {
        operation: GoogleOperationRow;
        owner: boolean;
        replay: null | { httpStatus: number; body: Record<string, unknown> };
      };

      const requireGoogleAdmin = (): void => {
        requireAnyRole(context, GOOGLE_ADMIN_ROLES, 'Google Workspace administration requires Admin role');
      };

      const hasExactGoogleScopes = (scopes: string[]): boolean => (
        scopes.length === REQUIRED_GOOGLE_SCOPES.length
        && new Set(scopes).size === REQUIRED_GOOGLE_SCOPES.length
        && scopes.every((scope) => (REQUIRED_GOOGLE_SCOPES as readonly string[]).includes(scope))
      );

      const publicConnection = (connection: {
        id: string; status: string; grantedScopesJson: string; tokenExpiresAt: Date | null;
        lastSyncedAt: Date | null; version: number; createdAt: Date;
      }) => {
        let grantedScopes: string[] = [];
        try {
          const parsed: unknown = JSON.parse(connection.grantedScopesJson);
          grantedScopes = Array.isArray(parsed) && parsed.every((scope) => typeof scope === 'string') ? parsed : [];
        } catch { /* malformed legacy rows expose no scopes */ }
        const effectiveStatus = connection.status === 'CONNECTED'
          && (!connection.tokenExpiresAt || connection.tokenExpiresAt <= new Date())
          && !googleAdapter.getCredentialMetadata
          ? 'EXPIRED'
          : connection.status === 'CONNECTED' && !hasExactGoogleScopes(grantedScopes)
            ? 'RECONSENT_REQUIRED'
            : connection.status;
        return {
          id: connection.id,
          status: effectiveStatus,
          grantedScopes,
          tokenExpiresAt: connection.tokenExpiresAt?.toISOString() ?? null,
          lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
          version: connection.version,
          createdAt: connection.createdAt.toISOString(),
          hasSecretConfigured: true
        };
      };

      const requireConnectedGoogle = async () => {
        const connection = await db.googleWorkspaceConnection.findUnique({ where: { organizationId: context.user.organizationId } });
        if (!connection || connection.status === 'DISCONNECTED') throw new HttpError(409, 'Google Workspace is not connected');
        if (connection.tokenExpiresAt && connection.tokenExpiresAt <= new Date() && !googleAdapter.getCredentialMetadata) {
          throw new HttpError(401, 'Google Workspace token has expired');
        }
        if (connection.status === 'EXPIRED') throw new HttpError(401, 'Google Workspace token has expired');
        if (connection.status === 'RECONSENT_REQUIRED') throw new HttpError(409, 'Google Workspace re-consent is required');
        if (connection.status !== 'CONNECTED') throw new HttpError(409, 'Google Workspace connection is unavailable');
        let scopes: string[] = [];
        try {
          const parsed: unknown = JSON.parse(connection.grantedScopesJson);
          scopes = Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === 'string') : [];
        } catch { /* rejected below */ }
        if (!hasExactGoogleScopes(scopes)) throw new HttpError(403, 'Google Workspace scopes do not match the approved least-privilege set');
        googleAdapter.useCredential?.(connection.secretRef);
        return { connection, scopes };
      };

      const requireGoogleCase = async (caseId: string, allowedRoles = GOOGLE_CASE_MATERIAL_ROLES) => {
        requireAnyRole(context, allowedRoles, 'This Google case operation is not permitted for the current role');
        const caseRow = await db.caseItem.findUnique({ where: { id: caseId } });
        if (!caseRow || caseRow.organizationId !== context.user.organizationId || caseRow.deletedAt) throw new HttpError(404, 'Case not found');
        if (!(await hasCaseAssignment(db, context, caseId))) throw new HttpError(403, 'Case assignment is required for Google operations');
        await requireConnectedGoogle();
        return caseRow;
      };

      const projectGoogleDateCandidate = (item: {
        id: string;
        title: string;
        dueDate: Date | null;
        updatedAt: Date;
        meeting: { id: string; version: number; rawTextSha256: string | null };
      }) => {
        if (!item.dueDate) throw new HttpError(409, 'Selected date candidate no longer has a due date');
        const startDateTime = item.dueDate.toISOString();
        const endDateTime = new Date(item.dueDate.getTime() + 60 * 60 * 1000).toISOString();
        const originalLocation = `meeting:${item.meeting.id}:action-item:${item.id}`;
        const excerpt = item.title.slice(0, 500);
        const binding = {
          id: item.id,
          meetingId: item.meeting.id,
          meetingVersion: item.meeting.version,
          meetingRawTextSha256: item.meeting.rawTextSha256,
          actionUpdatedAt: item.updatedAt.toISOString(),
          startDateTime,
          endDateTime,
          originalLocation,
          excerpt
        };
        return {
          id: item.id,
          candidateHash: sha256Hex(canonicalJson(binding)),
          version: item.meeting.version,
          startDateTime,
          endDateTime,
          confidence: 0.95,
          sourceType: 'MEETING_ACTION_ITEM',
          sourceEntityId: item.id,
          originalLocation,
          excerpt,
          summary: item.title
        };
      };

      const loadGoogleDateCandidates = async (caseId: string) => {
        const actionItems = await db.meetingActionItem.findMany({
          where: { dueDate: { not: null }, meeting: { caseId } },
          include: { meeting: true },
          orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
          take: 100
        });
        return actionItems.map(projectGoogleDateCandidate);
      };

      const malformedGoogleProviderEnvelope = <T>(startedAt: number): GoogleAdapterResponse<T> => ({
        responseClass: 'MALFORMED_PROVIDER_RESPONSE',
        redactedError: safeGoogleProviderError('MALFORMED_PROVIDER_RESPONSE'),
        durationMs: Math.max(0, Math.min(Date.now() - startedAt, 2_147_483_647))
      });

      const invokeGoogleProvider = async <T>(call: (signal: AbortSignal) => Promise<GoogleAdapterResponse<T>>): Promise<GoogleAdapterResponse<T>> => {
        const startedAt = Date.now();
        const controller = new AbortController();
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        try {
          const timeoutResponse = new Promise<GoogleAdapterResponse<T>>((resolve) => {
            timeoutId = setTimeout(() => {
              controller.abort();
              resolve({
                responseClass: 'TIMEOUT',
                redactedError: safeGoogleProviderError('TIMEOUT'),
                durationMs: Date.now() - startedAt
              });
            }, googleProviderTimeoutMs);
          });
          const rawResponse: unknown = await Promise.race([
            Promise.resolve().then(() => call(controller.signal)),
            timeoutResponse
          ]);
          if (!rawResponse || typeof rawResponse !== 'object' || Array.isArray(rawResponse)) {
            return malformedGoogleProviderEnvelope<T>(startedAt);
          }

          const envelope = rawResponse as Record<string, unknown>;
          if (typeof envelope.responseClass !== 'string' || !GOOGLE_FAKE_MODES.has(envelope.responseClass as GoogleAdapterMode)) {
            return malformedGoogleProviderEnvelope<T>(startedAt);
          }
          if (typeof envelope.durationMs !== 'number' || !Number.isFinite(envelope.durationMs)
            || envelope.durationMs < 0 || envelope.durationMs > 2_147_483_647) {
            return malformedGoogleProviderEnvelope<T>(startedAt);
          }
          if (envelope.retryAfterSeconds !== undefined
            && (typeof envelope.retryAfterSeconds !== 'number' || !Number.isFinite(envelope.retryAfterSeconds)
              || envelope.retryAfterSeconds < 0 || envelope.retryAfterSeconds > 30)) {
            return malformedGoogleProviderEnvelope<T>(startedAt);
          }

          const responseClass = envelope.responseClass as GoogleAdapterMode;
          const durationMs = Math.trunc(envelope.durationMs);
          if (GOOGLE_SUCCESS_CLASSES.has(responseClass)) {
            if (!Object.prototype.hasOwnProperty.call(envelope, 'data') || envelope.data === undefined) {
              return malformedGoogleProviderEnvelope<T>(startedAt);
            }
            return { responseClass, data: envelope.data as T, durationMs };
          }

          const normalized: GoogleAdapterResponse<T> = {
            responseClass,
            redactedError: safeGoogleProviderError(responseClass),
            durationMs
          };
          if (responseClass === 'RATE_LIMIT_RETRY_AFTER' && typeof envelope.retryAfterSeconds === 'number') {
            normalized.retryAfterSeconds = Math.ceil(envelope.retryAfterSeconds);
          }
          return normalized;
        } catch {
          return {
            responseClass: 'SERVER_ERROR',
            redactedError: safeGoogleProviderError('SERVER_ERROR'),
            durationMs: Date.now() - startedAt
          };
        } finally {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
        }
      };

      const syncGoogleCredentialMetadata = async (): Promise<void> => {
        if (!googleAdapter.getCredentialMetadata) return;
        try {
          const connection = await db.googleWorkspaceConnection.findUnique({ where: { organizationId: context.user.organizationId } });
          if (!connection || connection.status !== 'CONNECTED') return;
          const metadata = await googleAdapter.getCredentialMetadata(connection.secretRef);
          if (!metadata || !Number.isFinite(metadata.expiresAt.getTime()) || !hasExactGoogleScopes(metadata.grantedScopes)) return;
          const scopesJson = JSON.stringify(metadata.grantedScopes);
          if (connection.tokenExpiresAt?.getTime() === metadata.expiresAt.getTime() && connection.grantedScopesJson === scopesJson) return;
          await db.$transaction(async (tx) => {
            const changed = await tx.googleWorkspaceConnection.updateMany({
              where: { id: connection.id, version: connection.version, secretRef: connection.secretRef, status: 'CONNECTED' },
              data: {
                tokenExpiresAt: metadata.expiresAt,
                grantedScopesJson: scopesJson,
                lastSyncedAt: new Date(),
                version: { increment: 1 }
              }
            });
            if (changed.count === 1) {
              await tx.auditLog.create({ data: requestAudit(context, 'GOOGLE_CREDENTIAL_METADATA_REFRESHED', 'GoogleWorkspaceConnection', connection.id, {
                previousTokenExpiresAt: connection.tokenExpiresAt?.toISOString() ?? null,
                tokenExpiresAt: metadata.expiresAt.toISOString()
              }) });
            }
          });
        } catch {
          // Credential material stays opaque. A later successful provider call can
          // retry this non-authoritative metadata projection without data loss.
        }
      };

      const executeGoogleCall = async <T>(
        call: (signal: AbortSignal) => Promise<GoogleAdapterResponse<T>>,
        retryableClasses: ReadonlySet<GoogleAdapterMode> = GOOGLE_RETRYABLE_CLASSES
      ) => {
        const attempts: GoogleAttemptProjection[] = [];
        let response: GoogleAdapterResponse<T> | undefined;
        for (let attemptNumber = 1; attemptNumber <= 3; attemptNumber += 1) {
          response = await invokeGoogleProvider(call);
          attempts.push({
            attemptNumber,
            responseClass: response.responseClass,
            redactedError: response.redactedError,
            retryAt: response.retryAfterSeconds ? new Date(Date.now() + response.retryAfterSeconds * 1000) : null,
            durationMs: Math.max(0, Math.min(response.durationMs, 2_147_483_647))
          });
          if (GOOGLE_SUCCESS_CLASSES.has(response.responseClass) || !retryableClasses.has(response.responseClass) || attemptNumber === 3) break;
          const providerDelayMs = typeof response.retryAfterSeconds === 'number' && Number.isFinite(response.retryAfterSeconds)
            ? Math.max(0, Math.ceil(response.retryAfterSeconds * 1000))
            : null;
          const delayMs = providerDelayMs === null
            ? Math.min(1000, 100 * (2 ** (attemptNumber - 1)))
            : Math.min(30_000, providerDelayMs);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        if (!response) throw new HttpError(502, 'Google provider produced no response');
        if (GOOGLE_SUCCESS_CLASSES.has(response.responseClass)) await syncGoogleCredentialMetadata();
        return { response, attempts };
      };

      const writeGoogleAttempts = async (tx: Prisma.TransactionClient, operationId: string, attempts: GoogleAttemptProjection[]): Promise<void> => {
        for (const attempt of attempts) {
          await tx.googleSyncAttempt.create({
            data: {
              id: `GATT-${crypto.randomUUID()}`,
              operationId,
              attemptNumber: attempt.attemptNumber,
              responseClass: attempt.responseClass,
              redactedError: attempt.redactedError,
              retryAt: attempt.retryAt,
              durationMs: attempt.durationMs
            }
          });
        }
      };

      const deletePendingGoogleOperation = async (operationId: string): Promise<void> => {
        await db.googleSyncOperation.deleteMany({ where: { id: operationId, status: 'PENDING' } });
      };

      const parseStoredOperation = (resultJson: string | null): { httpStatus: number; body: Record<string, unknown> } => {
        if (!resultJson) throw new HttpError(409, 'Idempotent operation has no terminal result');
        try {
          const parsed = JSON.parse(resultJson) as { httpStatus?: unknown; body?: unknown };
          if (!Number.isInteger(parsed.httpStatus) || !parsed.body || typeof parsed.body !== 'object' || Array.isArray(parsed.body)) throw new Error('invalid');
          return { httpStatus: parsed.httpStatus as number, body: parsed.body as Record<string, unknown> };
        } catch {
          throw new HttpError(409, 'Stored Google operation result is invalid');
        }
      };

      const reserveGoogleOperation = async (caseId: string, operationKind: string, idempotencyKey: string, fingerprint: string): Promise<GoogleOperationReservation> => {
        const scope = {
          organizationId: context.user.organizationId,
          caseId,
          actorId: context.user.id,
          operationKind,
          idempotencyKey
        };
        let existing = await db.googleSyncOperation.findFirst({ where: scope });
        if (!existing) {
          const unresolved = await db.googleSyncOperation.findFirst({
            where: {
              organizationId: context.user.organizationId,
              caseId,
              operationKind,
              status: { in: ['PENDING', 'RECONCILIATION_REQUIRED'] }
            },
            select: { id: true, status: true }
          });
          if (unresolved?.status === 'RECONCILIATION_REQUIRED') {
            throw new HttpError(409, 'A prior Google operation requires manual reconciliation before this action can be retried');
          }
          if (unresolved) throw new HttpError(409, 'A Google operation of this kind is already in progress for the case');
          try {
            const operation = await db.googleSyncOperation.create({
              data: {
                id: `GSYNC-${crypto.randomUUID()}`,
                ...scope,
                requestFingerprint: fingerprint,
                status: 'PENDING'
              }
            });
            return { operation, owner: true, replay: null };
          } catch {
            existing = await db.googleSyncOperation.findFirst({ where: scope });
            if (!existing) {
              const concurrent = await db.googleSyncOperation.findFirst({
                where: {
                  organizationId: context.user.organizationId,
                  caseId,
                  operationKind,
                  status: { in: ['PENDING', 'RECONCILIATION_REQUIRED'] }
                },
                select: { status: true }
              });
              if (concurrent?.status === 'RECONCILIATION_REQUIRED') {
                throw new HttpError(409, 'A prior Google operation requires manual reconciliation before this action can be retried');
              }
              throw new HttpError(409, concurrent
                ? 'A Google operation of this kind is already in progress for the case'
                : 'Concurrent Google operation reservation conflict');
            }
          }
        }
        if (!existing) throw new HttpError(409, 'Concurrent Google operation reservation conflict');
        let canonical: GoogleOperationRow = existing;
        if (canonical.requestFingerprint !== fingerprint) throw new HttpError(409, 'Idempotency key was already used with a different request');
        for (let poll = 0; canonical.status === 'PENDING' && poll < 100; poll += 1) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          const refreshed: GoogleOperationRow | null = await db.googleSyncOperation.findUnique({ where: { id: canonical.id } });
          if (!refreshed) throw new HttpError(409, 'Concurrent Google operation was rolled back');
          canonical = refreshed;
        }
        if (canonical.status === 'PENDING') throw new HttpError(409, 'Google operation is already in progress');
        const stored = parseStoredOperation(canonical.resultJson);
        if (canonical.status !== 'SUCCESS') {
          throw new HttpError(stored.httpStatus, String(stored.body.error ?? 'Google operation failed'), {
            responseClass: stored.body.responseClass
          });
        }
        return {
          operation: canonical,
          owner: false,
          replay: { httpStatus: 200, body: { ...stored.body, idempotentReplay: true } }
        };
      };

      const failGoogleOperation = async (
        operationId: string,
        response: GoogleAdapterResponse<unknown>,
        attempts: GoogleAttemptProjection[],
        action: string
      ): Promise<HttpError> => {
        const status = googleResponseStatus(response.responseClass);
        const body = {
          error: response.redactedError ?? 'Google provider request failed',
          responseClass: response.responseClass,
          retryAfterSeconds: response.retryAfterSeconds ?? null
        };
        try {
          await db.$transaction(async (tx) => {
            await writeGoogleAttempts(tx, operationId, attempts);
            const changed = await tx.googleSyncOperation.updateMany({
              where: { id: operationId, status: 'PENDING' },
              data: {
                status: response.responseClass === 'USER_CANCEL' ? 'CANCELLED' : 'FAILED',
                resultJson: JSON.stringify({ httpStatus: status, body }),
                completedAt: new Date()
              }
            });
            if (changed.count !== 1) throw new HttpError(409, 'Google operation terminal transition conflict');
            if (response.responseClass === 'TOKEN_EXPIRED' || response.responseClass === 'RECONSENT_REQUIRED') {
              const connection = await tx.googleWorkspaceConnection.findUnique({ where: { organizationId: context.user.organizationId } });
              if (connection) {
                await tx.googleWorkspaceConnection.update({
                  where: { id: connection.id },
                  data: {
                    status: response.responseClass === 'TOKEN_EXPIRED' ? 'EXPIRED' : 'RECONSENT_REQUIRED',
                    version: { increment: 1 }
                  }
                });
              }
            }
            await tx.auditLog.create({ data: requestAudit(context, action, 'GoogleSyncOperation', operationId, {
              status: 'FAILED', responseClass: response.responseClass, attemptCount: attempts.length
            }) });
          });
        } catch (error) {
          await deletePendingGoogleOperation(operationId);
          throw error;
        }
        return new HttpError(status, body.error, { responseClass: body.responseClass, retryAfterSeconds: body.retryAfterSeconds });
      };

      const markGoogleReconciliationRequired = async (
        operationId: string,
        attempts: GoogleAttemptProjection[],
        externalResourceId: string
      ): Promise<void> => {
        const body = {
          error: 'Google accepted the operation but local persistence did not complete; manual reconciliation is required',
          responseClass: 'SERVER_ERROR',
          reconciliationRequired: true,
          externalResourceFingerprint: sha256Hex(externalResourceId).slice(0, 24)
        };
        try {
          await db.$transaction(async (tx) => {
            await writeGoogleAttempts(tx, operationId, attempts);
            const changed = await tx.googleSyncOperation.updateMany({
              where: { id: operationId, status: 'PENDING' },
              data: {
                status: 'RECONCILIATION_REQUIRED',
                resultJson: JSON.stringify({ httpStatus: 503, body }),
                completedAt: new Date()
              }
            });
            if (changed.count !== 1) throw new HttpError(409, 'Google reconciliation state transition conflict');
          });
        } catch {
          // Leave the reservation PENDING if durable quarantine also fails. A retry then
          // returns "in progress" without repeating the external mutation.
        }
      };

      const failGoogleMutationOperation = async (
        operationId: string,
        response: GoogleAdapterResponse<unknown>,
        attempts: GoogleAttemptProjection[],
        action: string,
        uncertaintyKey: string
      ): Promise<HttpError> => {
        if (response.responseClass === 'TIMEOUT' || response.responseClass === 'SERVER_ERROR' || response.responseClass === 'MALFORMED_PROVIDER_RESPONSE') {
          await markGoogleReconciliationRequired(operationId, attempts, uncertaintyKey);
          return new HttpError(googleResponseStatus(response.responseClass), safeGoogleProviderError(response.responseClass), {
            responseClass: response.responseClass,
            reconciliationRequired: true
          });
        }
        return failGoogleOperation(operationId, response, attempts, action);
      };

      const validateGoogleProviderId = (value: unknown, label: string): string => {
        if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(value)) {
          throw new HttpError(502, `Google provider returned an invalid ${label}`);
        }
        return value;
      };

      const validateGoogleProviderText = (value: unknown, label: string, maximum = 500): string => {
        if (typeof value !== 'string' || value.length < 1 || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
          throw new HttpError(502, `Google provider returned invalid ${label}`);
        }
        return value;
      };

      const validateGoogleProviderUrl = (value: unknown, service: 'drive' | 'calendar' | 'docs'): string => {
        if (typeof value !== 'string' || value.length > 2000) throw new HttpError(502, 'Google provider returned an invalid resource URL');
        try {
          const parsed = new URL(value);
          const allowedHosts = new Set([`${service}.google.com`, `${service}.google.invalid`]);
          if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname) || parsed.username || parsed.password) throw new Error('invalid');
          return parsed.toString();
        } catch {
          throw new HttpError(502, 'Google provider returned an invalid resource URL');
        }
      };

      const hasExactProviderKeys = (value: Record<string, unknown>, expected: string[]): boolean => (
        canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort())
      );

      const projectGmailCandidates = (value: unknown) => {
        if (!Array.isArray(value) || value.length > 100) throw new HttpError(502, 'Google Gmail candidate response is invalid');
        const projected = value.map((candidate) => {
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new HttpError(502, 'Google Gmail candidate response is invalid');
          const item = candidate as Record<string, unknown>;
          if (!hasExactProviderKeys(item, ['attachmentId', 'filename', 'mimeType', 'sizeBytes'])) throw new HttpError(502, 'Google Gmail candidate response contains unexpected data');
          const attachmentId = validateGoogleProviderId(item.attachmentId, 'Gmail attachment ID');
          const filename = validateGoogleProviderText(item.filename, 'Gmail attachment filename', 240);
          const mimeType = validateGoogleProviderText(item.mimeType, 'Gmail attachment MIME type', 100).toLowerCase();
          if (!Number.isInteger(item.sizeBytes) || Number(item.sizeBytes) < 1 || Number(item.sizeBytes) > UPLOAD_MAX_BYTES) {
            throw new HttpError(502, 'Google Gmail attachment size is invalid');
          }
          return { attachmentId, filename, mimeType, sizeBytes: Number(item.sizeBytes) };
        });
        if (new Set(projected.map((item) => item.attachmentId)).size !== projected.length) throw new HttpError(502, 'Google Gmail candidate IDs are not unique');
        return projected;
      };

      const projectSheetSources = (value: unknown) => {
        if (!Array.isArray(value) || value.length > 100) throw new HttpError(502, 'Google Sheets source response is invalid');
        const projected = value.map((candidate) => {
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new HttpError(502, 'Google Sheets source response is invalid');
          const item = candidate as Record<string, unknown>;
          if (!hasExactProviderKeys(item, ['spreadsheetId', 'sheetName', 'allowedRange', 'displayName'])) throw new HttpError(502, 'Google Sheets source response contains unexpected data');
          const spreadsheetId = validateGoogleProviderId(item.spreadsheetId, 'Sheets spreadsheet ID');
          const sheetName = validateGoogleProviderText(item.sheetName, 'Sheets tab name', 100);
          const allowedRange = validateGoogleProviderText(item.allowedRange, 'Sheets allowed range', 40).toUpperCase();
          if (!/^[A-Z]{1,3}[1-9][0-9]{0,5}:[A-Z]{1,3}[1-9][0-9]{0,5}$/.test(allowedRange)) throw new HttpError(502, 'Google Sheets allowed range is invalid');
          const displayName = validateGoogleProviderText(item.displayName, 'Sheets display name', 200);
          return { spreadsheetId, sheetName, allowedRange, displayName };
        });
        if (new Set(projected.map((item) => `${item.spreadsheetId}:${item.sheetName}`)).size !== projected.length) throw new HttpError(502, 'Google Sheets source IDs are not unique');
        return projected;
      };

      const bumpGoogleCaseVersion = async (tx: Prisma.TransactionClient, caseId: string, expectedVersion: number): Promise<number> => {
        const changed = await tx.caseItem.updateMany({
          where: { id: caseId, organizationId: context.user.organizationId, version: expectedVersion, deletedAt: null },
          data: { version: { increment: 1 } }
        });
        if (changed.count !== 1) throw new HttpError(409, 'Case version conflict');
        return expectedVersion + 1;
      };

      // Test-only deterministic mode. It is disabled by default and tenant-scoped.
      if (pathname === '/api/google-workspace/fake-mode' && req.method === 'POST') {
        requireGoogleAdmin();
        const controller = fakeModeController(googleAdapter);
        if (!allowTestGoogleModes || !controller) throw new HttpError(404, 'Endpoint not found');
        const body = await readJson(req);
        assertExactJsonFields(body, ['mode'], ['mode']);
        if (typeof body.mode !== 'string' || !GOOGLE_FAKE_MODES.has(body.mode as GoogleAdapterMode)) throw new HttpError(400, 'Invalid fake Google mode');
        controller.setMode(body.mode as GoogleAdapterMode);
        sendJson(res, 200, { currentMode: controller.getMode() });
        return;
      }

      if (pathname === '/api/google-workspace/connection' && req.method === 'GET') {
        requireGoogleAdmin();
        const connection = await db.googleWorkspaceConnection.findUnique({ where: { organizationId: context.user.organizationId } });
        const history = await db.googleSyncOperation.findMany({
          where: { organizationId: context.user.organizationId },
          include: { attempts: { orderBy: { attemptNumber: 'desc' }, take: 1 } },
          orderBy: { createdAt: 'desc' },
          take: 100
        });
        const safeHistory = history.map((operation) => ({
          id: operation.id,
          operationKind: operation.operationKind,
          status: operation.status,
          responseClass: operation.attempts[0]?.responseClass ?? null,
          redactedError: operation.attempts[0]?.redactedError ?? null,
          createdAt: operation.createdAt.toISOString(),
          completedAt: operation.completedAt?.toISOString() ?? null
        }));
        if (!connection) {
          sendJson(res, 200, { connection: null, status: 'DISCONNECTED', providerMode: googleProviderMode, requiredScopes: REQUIRED_GOOGLE_SCOPES, history: safeHistory });
          return;
        }
        const safeConnection = publicConnection(connection);
        sendJson(res, 200, { connection: safeConnection, status: safeConnection.status, providerMode: googleProviderMode, requiredScopes: REQUIRED_GOOGLE_SCOPES, history: safeHistory });
        return;
      }

      if (pathname === '/api/google-workspace/reconciliation' && req.method === 'GET') {
        requireGoogleAdmin();
        const staleBefore = new Date(Date.now() - GOOGLE_RECONCILIATION_STALE_MS);
        const operations = await db.googleSyncOperation.findMany({
          where: {
            organizationId: context.user.organizationId,
            caseId: { not: null },
            OR: [
              { status: 'RECONCILIATION_REQUIRED' },
              { status: 'PENDING', updatedAt: { lte: staleBefore } }
            ]
          },
          orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
          take: 100
        });
        sendJson(res, 200, {
          resolution: GOOGLE_RECONCILIATION_RESOLUTION,
          confirmation: GOOGLE_RECONCILIATION_CONFIRMATION,
          stalePendingAfterSeconds: GOOGLE_RECONCILIATION_STALE_MS / 1000,
          operations: operations.map((operation) => ({
            id: operation.id,
            caseId: operation.caseId,
            operationKind: operation.operationKind,
            status: operation.status,
            createdAt: operation.createdAt.toISOString(),
            updatedAt: operation.updatedAt.toISOString(),
            expectedUpdatedAt: operation.updatedAt.toISOString()
          }))
        });
        return;
      }

      const googleReconciliationResolveMatch = pathname.match(/^\/api\/google-workspace\/reconciliation\/([^/]+)\/resolve$/);
      if (googleReconciliationResolveMatch && req.method === 'POST') {
        requireGoogleAdmin();
        const operationId = googleReconciliationResolveMatch[1];
        const body = await readJson(req);
        assertExactJsonFields(
          body,
          ['resolution', 'confirmation', 'verificationReference', 'expectedUpdatedAt'],
          ['resolution', 'confirmation', 'verificationReference', 'expectedUpdatedAt']
        );
        if (body.resolution !== GOOGLE_RECONCILIATION_RESOLUTION) {
          throw new HttpError(400, `resolution must equal ${GOOGLE_RECONCILIATION_RESOLUTION}`);
        }
        if (body.confirmation !== GOOGLE_RECONCILIATION_CONFIRMATION) {
          throw new HttpError(400, `confirmation must equal ${GOOGLE_RECONCILIATION_CONFIRMATION}`);
        }
        const verificationReference = strictString(body.verificationReference, 'verificationReference', 8, 300);
        if (/[\u0000-\u001f\u007f]/.test(verificationReference)
          || /ya29\.|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization[_-]?code|-----BEGIN/i.test(verificationReference)) {
          throw new HttpError(400, 'verificationReference contains forbidden credential-like data');
        }
        const expectedUpdatedAtText = strictString(body.expectedUpdatedAt, 'expectedUpdatedAt', 20, 40);
        const expectedUpdatedAt = new Date(expectedUpdatedAtText);
        if (Number.isNaN(expectedUpdatedAt.getTime()) || expectedUpdatedAt.toISOString() !== expectedUpdatedAtText) {
          throw new HttpError(400, 'expectedUpdatedAt must be a canonical ISO timestamp');
        }
        const operation = await db.googleSyncOperation.findFirst({
          where: { id: operationId, organizationId: context.user.organizationId }
        });
        if (!operation) throw new HttpError(404, 'Google reconciliation operation not found');
        if (!operation.caseId) throw new HttpError(409, 'Only case-scoped Google operations can be reconciled');
        if (operation.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
          throw new HttpError(409, 'Google reconciliation operation version conflict');
        }
        if (operation.status !== 'RECONCILIATION_REQUIRED' && operation.status !== 'PENDING') {
          throw new HttpError(409, 'Google operation is no longer eligible for reconciliation');
        }
        if (operation.status === 'PENDING' && operation.updatedAt.getTime() > Date.now() - GOOGLE_RECONCILIATION_STALE_MS) {
          throw new HttpError(409, 'Pending Google operation is not old enough for manual reconciliation');
        }

        const verificationReferenceHash = sha256Hex(verificationReference);
        const completedAt = new Date();
        const resultBody = {
          error: 'Operation was reconciled with no external side effect; submit a fresh idempotency key to retry',
          responseClass: 'RECONCILED_NO_SIDE_EFFECT',
          status: 'RECONCILED_NO_SIDE_EFFECT',
          resolution: GOOGLE_RECONCILIATION_RESOLUTION,
          confirmation: GOOGLE_RECONCILIATION_CONFIRMATION,
          verificationReferenceHash,
          resolvedById: context.user.id,
          previousResultSha256: sha256Hex(operation.resultJson ?? 'PENDING')
        };
        const resolved = await db.$transaction(async (tx) => {
          await tx.auditLog.create({ data: requestAudit(
            context,
            'GOOGLE_RECONCILIATION_RESOLVED',
            'GoogleSyncOperation',
            operation.id,
            {
              caseId: operation.caseId,
              operationKind: operation.operationKind,
              priorStatus: operation.status,
              resolution: GOOGLE_RECONCILIATION_RESOLUTION,
              confirmation: GOOGLE_RECONCILIATION_CONFIRMATION,
              verificationReferenceHash,
              verificationReferenceLength: verificationReference.length
            }
          ) });
          const changed = await tx.googleSyncOperation.updateMany({
            where: {
              id: operation.id,
              organizationId: context.user.organizationId,
              status: operation.status,
              updatedAt: expectedUpdatedAt
            },
            data: {
              status: 'RECONCILED_NO_SIDE_EFFECT',
              resultJson: JSON.stringify({ httpStatus: 409, body: resultBody }),
              completedAt
            }
          });
          if (changed.count !== 1) throw new HttpError(409, 'Google reconciliation operation version conflict');
          return tx.googleSyncOperation.findUniqueOrThrow({ where: { id: operation.id } });
        });
        sendJson(res, 200, {
          operation: {
            id: resolved.id,
            caseId: resolved.caseId,
            operationKind: resolved.operationKind,
            status: resolved.status,
            completedAt: resolved.completedAt?.toISOString() ?? null
          },
          resolution: GOOGLE_RECONCILIATION_RESOLUTION,
          verificationReferenceHash
        });
        return;
      }

      if (pathname === '/api/google-workspace/connect/init' && req.method === 'POST') {
        requireGoogleAdmin();
        const body = await readJson(req);
        assertExactJsonFields(body, ['redirectTarget', 'expectedVersion'], ['expectedVersion']);
        const redirectTarget = body.redirectTarget === undefined ? '/integrations/google' : strictString(body.redirectTarget, 'redirectTarget', 1, 100);
        if (!GOOGLE_REDIRECT_TARGETS.has(redirectTarget) || !redirectTarget.startsWith('/') || redirectTarget.startsWith('//') || redirectTarget.includes('\\')) {
          throw new HttpError(400, 'Redirect target is not an approved internal path');
        }
        const requestedConnectionVersion = body.expectedVersion === null
          ? null
          : boundedInteger(body.expectedVersion, -1, 1, 2_147_483_647, 'expectedVersion');
        const connectionSnapshot = await db.googleWorkspaceConnection.findUnique({ where: { organizationId: context.user.organizationId } });
        if ((connectionSnapshot?.version ?? null) !== requestedConnectionVersion) throw new HttpError(409, 'Google connection version conflict');
        const verifier = crypto.randomBytes(48).toString('base64url');
        const challenge = base64UrlSha256(verifier);
        const state = crypto.randomBytes(32).toString('base64url');
        const stateHash = sha256Hex(state);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        const stateId = `GOAUTH-${crypto.randomUUID()}`;
        let authorizationUrl: string;
        try {
          authorizationUrl = googleAdapter.createAuthorizationUrl({
            state,
            codeChallenge: challenge,
            scopes: REQUIRED_GOOGLE_SCOPES
          });
        } catch {
          throw new HttpError(503, 'Google Workspace authorization provider is unavailable');
        }
        const verifierRef = await googlePkceVerifierVault.createVerifier({
          organizationId: context.user.organizationId, actorId: context.user.id, stateHash, verifier, expiresAt
        });
        try {
          await db.$transaction(async (tx) => {
            await tx.googleOAuthState.create({ data: {
              id: stateId,
              stateHash,
              pkceVerifierRef: verifierRef,
              pkceChallenge: challenge,
              connectionVersion: connectionSnapshot?.version ?? null,
              organizationId: context.user.organizationId,
              actorId: context.user.id,
              redirectTarget,
              expiresAt
            } });
            await tx.auditLog.create({ data: requestAudit(context, 'GOOGLE_OAUTH_INITIATED', 'GoogleOAuthState', stateId, {
              expiresAt: expiresAt.toISOString(), redirectTarget, pkceMethod: 'S256'
            }) });
          });
        } catch (error) {
          await googlePkceVerifierVault.deleteVerifier(verifierRef);
          throw error;
        }
        sendJson(res, 201, { state, authorizationUrl, expiresAt: expiresAt.toISOString(), redirectTarget, providerMode: googleProviderMode });
        return;
      }

      if (pathname === '/api/google-workspace/connect/callback' && req.method === 'POST') {
        requireGoogleAdmin();
        const body = await readJson(req);
        assertExactJsonFields(body, ['state', 'code'], ['state', 'code']);
        const rawState = strictString(body.state, 'state', 32, 200);
        const code = strictString(body.code, 'code', 8, 200);
        const stateHash = sha256Hex(rawState);
        const stateRecord = await db.googleOAuthState.findUnique({ where: { stateHash } });
        if (!stateRecord) throw new HttpError(400, 'Invalid OAuth state');
        if (stateRecord.organizationId !== context.user.organizationId || stateRecord.actorId !== context.user.id) throw new HttpError(403, 'OAuth state binding violation');
        if (stateRecord.usedAt) throw new HttpError(409, 'OAuth state has already been used');
        if (stateRecord.expiresAt <= new Date()) throw new HttpError(400, 'OAuth state has expired');
        if (!GOOGLE_REDIRECT_TARGETS.has(stateRecord.redirectTarget)) throw new HttpError(400, 'Stored OAuth redirect target is invalid');
        const verifier = await googlePkceVerifierVault.resolveVerifier(stateRecord.pkceVerifierRef, {
          organizationId: context.user.organizationId, actorId: context.user.id, stateHash
        });
        if (!verifier || base64UrlSha256(verifier) !== stateRecord.pkceChallenge) throw new HttpError(400, 'PKCE verifier is unavailable or invalid');
        const exchange = await invokeGoogleProvider((signal) => googleAdapter.exchangeAuthorizationCode(code, verifier, signal));
        if (!GOOGLE_SUCCESS_CLASSES.has(exchange.responseClass) || !exchange.data) {
          throw new HttpError(googleResponseStatus(exchange.responseClass), safeGoogleProviderError(exchange.responseClass), { responseClass: exchange.responseClass });
        }
        const rawExchangeData: unknown = exchange.data;
        const exchangeRecord = rawExchangeData && typeof rawExchangeData === 'object' && !Array.isArray(rawExchangeData)
          ? rawExchangeData as Record<string, unknown>
          : null;
        const fakeAdapter = fakeModeController(googleAdapter);
        const rawSecretRef = exchangeRecord?.secretRef;
        const validSecretReference = typeof rawSecretRef === 'string' && (
          (fakeAdapter !== null && allowTestGoogleModes && rawSecretRef === 'LOCAL_FAKE_GOOGLE')
          || (fakeAdapter === null && /^SECREF_GOOGLE_[A-Z0-9_-]{16,120}$/.test(rawSecretRef))
        );
        const validExchange = exchangeRecord !== null
          && hasExactProviderKeys(exchangeRecord, ['grantedScopes', 'secretRef', 'expiresInSeconds'])
          && Array.isArray(exchangeRecord.grantedScopes)
          && exchangeRecord.grantedScopes.every((scope) => typeof scope === 'string')
          && validSecretReference
          && Number.isSafeInteger(exchangeRecord.expiresInSeconds)
          && Number(exchangeRecord.expiresInSeconds) >= 60
          && Number(exchangeRecord.expiresInSeconds) <= 86_400;
        if (!validExchange) {
          if (typeof rawSecretRef === 'string') {
            try { await googleAdapter.discardCredentialReference?.(rawSecretRef); } catch { /* fail closed */ }
          }
          await googlePkceVerifierVault.deleteVerifier(stateRecord.pkceVerifierRef);
          throw new HttpError(502, 'Google OAuth provider returned an invalid response');
        }
        const exchangeData = {
          grantedScopes: [...exchangeRecord.grantedScopes as string[]],
          secretRef: rawSecretRef as string,
          expiresInSeconds: Number(exchangeRecord.expiresInSeconds)
        };
        const exchangedSecretRef = exchangeData.secretRef;
        let connection;
        let previousSecretRef: string | null = null;
        try {
          if (!hasExactGoogleScopes(exchangeData.grantedScopes)) {
            throw new HttpError(403, 'OAuth response scopes do not match the approved least-privilege set');
          }
          const missingScope = REQUIRED_GOOGLE_SCOPES.find((scope) => !exchangeData.grantedScopes.includes(scope));
          if (missingScope) throw new HttpError(403, 'OAuth response did not grant all required scopes');
          const now = new Date();
          const tokenExpiresAt = new Date(now.getTime() + exchangeData.expiresInSeconds * 1000);
          connection = await db.$transaction(async (tx) => {
          const consumed = await tx.googleOAuthState.updateMany({
            where: { id: stateRecord.id, usedAt: null, expiresAt: { gt: now } },
            data: { usedAt: now }
          });
          if (consumed.count !== 1) throw new HttpError(409, 'OAuth state was already consumed');
          const current = await tx.googleWorkspaceConnection.findUnique({ where: { organizationId: context.user.organizationId } });
          let stored;
          if (current) {
            previousSecretRef = current.secretRef;
            if (stateRecord.connectionVersion === null || current.version !== stateRecord.connectionVersion) throw new HttpError(409, 'Google connection changed after OAuth initiation');
            const changed = await tx.googleWorkspaceConnection.updateMany({
              where: { id: current.id, version: current.version },
              data: {
                status: 'CONNECTED',
                grantedScopesJson: JSON.stringify(exchangeData.grantedScopes),
                secretRef: exchangeData.secretRef,
                tokenExpiresAt,
                lastSyncedAt: now,
                version: { increment: 1 }
              }
            });
            if (changed.count !== 1) throw new HttpError(409, 'Google connection version conflict');
            stored = await tx.googleWorkspaceConnection.findUniqueOrThrow({ where: { id: current.id } });
          } else {
            if (stateRecord.connectionVersion !== null) throw new HttpError(409, 'Google connection changed after OAuth initiation');
            stored = await tx.googleWorkspaceConnection.create({ data: {
              id: `GCONN-${crypto.randomUUID()}`,
              organizationId: context.user.organizationId,
              status: 'CONNECTED',
              grantedScopesJson: JSON.stringify(exchangeData.grantedScopes),
              secretRef: exchangeData.secretRef,
              tokenExpiresAt,
              lastSyncedAt: now,
              createdById: context.user.id
            } });
          }
          await tx.auditLog.create({ data: requestAudit(context, 'GOOGLE_WORKSPACE_CONNECTED', 'GoogleWorkspaceConnection', stored.id, {
            redirectTarget: stateRecord.redirectTarget, grantedScopeCount: exchangeData.grantedScopes.length
          }) });
            return stored;
          });
        } catch (error) {
          try {
            await googleAdapter.discardCredentialReference?.(exchangedSecretRef);
          } catch { /* local persistence still fails closed; never expose credential material */ }
          await googlePkceVerifierVault.deleteVerifier(stateRecord.pkceVerifierRef);
          throw error;
        }
        await googlePkceVerifierVault.deleteVerifier(stateRecord.pkceVerifierRef);
        let previousCredentialRetired = true;
        if (previousSecretRef && previousSecretRef !== exchangeData.secretRef) {
          const retired = await invokeGoogleProvider((signal) => googleAdapter.revokeConnection(previousSecretRef!, signal));
          let localCredentialDiscarded = true;
          try { await googleAdapter.discardCredentialReference?.(previousSecretRef); }
          catch { localCredentialDiscarded = false; }
          previousCredentialRetired = GOOGLE_SUCCESS_CLASSES.has(retired.responseClass)
            && retired.data?.revoked === true
            && localCredentialDiscarded;
          if (!previousCredentialRetired) {
            await db.auditLog.create({ data: requestAudit(context, 'GOOGLE_OLD_CREDENTIAL_PURGED_AFTER_REVOKE_FAILURE', 'GoogleWorkspaceConnection', connection.id, {
              responseClass: retired.responseClass,
              previousSecretRefHash: sha256Hex(previousSecretRef),
              localCredentialDiscarded
            }) }).catch(() => undefined);
          }
        }
        sendJson(res, 200, {
          connection: publicConnection(connection),
          redirectTarget: stateRecord.redirectTarget,
          previousCredentialRetired
        });
        return;
      }

      if (pathname === '/api/google-workspace/disconnect' && req.method === 'POST') {
        requireGoogleAdmin();
        const body = await readJson(req);
        assertExactJsonFields(body, ['expectedVersion'], ['expectedVersion']);
        const expectedVersion = boundedInteger(body.expectedVersion, -1, 1, 2_147_483_647, 'expectedVersion');
        const connection = await db.googleWorkspaceConnection.findUnique({ where: { organizationId: context.user.organizationId } });
        if (!connection) throw new HttpError(404, 'Google Workspace connection not found');
        if (connection.version !== expectedVersion) throw new HttpError(409, 'Google connection version conflict');
        const revoked = await invokeGoogleProvider((signal) => googleAdapter.revokeConnection(connection.secretRef, signal));
        if (!GOOGLE_SUCCESS_CLASSES.has(revoked.responseClass) || revoked.data?.revoked !== true) {
          await db.auditLog.create({ data: requestAudit(context, 'GOOGLE_WORKSPACE_DISCONNECT_FAILED', 'GoogleWorkspaceConnection', connection.id, {
            responseClass: revoked.responseClass
          }) });
          throw new HttpError(googleResponseStatus(revoked.responseClass), safeGoogleProviderError(revoked.responseClass), { responseClass: revoked.responseClass });
        }
        const updated = await db.$transaction(async (tx) => {
          const changed = await tx.googleWorkspaceConnection.updateMany({
            // Refresh metadata may legitimately advance version while the
            // provider revoke is in flight. The opaque reference is the
            // authoritative identity of the credential that was revoked.
            where: {
              id: connection.id,
              organizationId: context.user.organizationId,
              secretRef: connection.secretRef,
              status: { not: 'DISCONNECTED' }
            },
            data: { status: 'DISCONNECTED', version: { increment: 1 } }
          });
          const latest = await tx.googleWorkspaceConnection.findUniqueOrThrow({ where: { id: connection.id } });
          if (changed.count === 0) {
            if (latest.secretRef === connection.secretRef && latest.status === 'DISCONNECTED') return latest;
            throw new HttpError(409, 'Google connection changed while revocation was in progress');
          }
          await tx.auditLog.create({ data: requestAudit(context, 'GOOGLE_WORKSPACE_DISCONNECTED', 'GoogleWorkspaceConnection', connection.id, {
            previousStatus: connection.status,
            requestedVersion: expectedVersion,
            appliedVersion: latest.version,
            internalDataPreserved: true
          }) });
          return latest;
        });
        let credentialPurged = true;
        try { await googleAdapter.discardCredentialReference?.(connection.secretRef); }
        catch {
          credentialPurged = false;
          await db.auditLog.create({ data: requestAudit(context, 'GOOGLE_CREDENTIAL_PURGE_FAILED', 'GoogleWorkspaceConnection', connection.id, {
            secretRefHash: sha256Hex(connection.secretRef)
          }) }).catch(() => undefined);
        }
        sendJson(res, 200, {
          connection: publicConnection(updated),
          status: updated.status,
          internalDataPreserved: true,
          credentialPurged
        });
        return;
      }

      if (pathname === '/api/google-workspace/test' && req.method === 'POST') {
        requireGoogleAdmin();
        const body = await readJson(req);
        assertExactJsonFields(body, ['expectedVersion'], ['expectedVersion']);
        const { connection, scopes } = await requireConnectedGoogle();
        const expectedVersion = boundedInteger(body.expectedVersion, -1, 1, 2_147_483_647, 'expectedVersion');
        if (connection.version !== expectedVersion) throw new HttpError(409, 'Google connection version conflict');
        const operation = await db.googleSyncOperation.create({ data: {
          id: `GSYNC-${crypto.randomUUID()}`,
          organizationId: context.user.organizationId,
          operationKind: 'CONNECTION_TEST',
          requestFingerprint: sha256Hex(`CONNECTION_TEST:${connection.id}:${connection.version}`),
          status: 'PENDING',
          actorId: context.user.id
        } });
        const { response, attempts } = await executeGoogleCall((signal) => googleAdapter.testConnection({
          organizationId: connection.organizationId,
          status: connection.status as 'CONNECTED' | 'EXPIRED' | 'RECONSENT_REQUIRED' | 'DISCONNECTED',
          grantedScopes: scopes,
          secretRef: connection.secretRef,
          tokenExpiresAt: connection.tokenExpiresAt
        }, signal));
        if (!GOOGLE_SUCCESS_CLASSES.has(response.responseClass) || !response.data?.ok) throw await failGoogleOperation(operation.id, response, attempts, 'GOOGLE_CONNECTION_TEST_FAILED');
        const resultBody = { ok: true, responseClass: response.responseClass, attemptCount: attempts.length };
        try {
          await db.$transaction(async (tx) => {
            await writeGoogleAttempts(tx, operation.id, attempts);
            await tx.googleSyncOperation.update({ where: { id: operation.id }, data: {
              status: 'SUCCESS', resultJson: JSON.stringify({ httpStatus: 200, body: resultBody }), completedAt: new Date()
            } });
            await tx.auditLog.create({ data: requestAudit(context, 'GOOGLE_CONNECTION_TESTED', 'GoogleSyncOperation', operation.id, {
              responseClass: response.responseClass, attemptCount: attempts.length
            }) });
          });
        } catch (error) {
          await deletePendingGoogleOperation(operation.id);
          throw error;
        }
        sendJson(res, 200, resultBody);
        return;
      }

      const workspaceMatch = pathname.match(/^\/api\/cases\/([^/]+)\/google\/workspace$/);
      if (workspaceMatch && req.method === 'GET') {
        const caseId = workspaceMatch[1];
        requireAnyRole(context, GOOGLE_CASE_MATERIAL_ROLES, 'Google case workspace requires a material-access role');
        const caseRow = await db.caseItem.findUnique({ where: { id: caseId } });
        if (!caseRow || caseRow.organizationId !== context.user.organizationId || caseRow.deletedAt) throw new HttpError(404, 'Case not found');
        if (!(await hasCaseAssignment(db, context, caseId))) throw new HttpError(403, 'Case assignment is required');
        const resourceQuery = (url.searchParams.get('resourceQuery') ?? '').trim();
        if (resourceQuery.length > 100) throw new HttpError(400, 'resourceQuery must be at most 100 characters');
        const rawLimit = url.searchParams.get('resourceLimit');
        const resourceLimit = rawLimit === null ? 100 : boundedInteger(Number(rawLimit), 100, 1, 200, 'resourceLimit');
        const connection = await db.googleWorkspaceConnection.findUnique({ where: { organizationId: context.user.organizationId } });
        const safeConnection = connection ? publicConnection(connection) : null;
        const resources = await db.googleResourceLink.findMany({
          where: {
            organizationId: context.user.organizationId,
            caseId,
            ...(resourceQuery ? { OR: [
              { entityType: { contains: resourceQuery } },
              { externalResourceId: { contains: resourceQuery } },
              { internalEntityId: { contains: resourceQuery } },
              { resourceMetadataJson: { contains: resourceQuery } }
            ] } : {})
          },
          orderBy: { createdAt: 'desc' },
          take: resourceLimit
        });
        const history = await db.googleSyncOperation.findMany({
          where: { organizationId: context.user.organizationId, caseId },
          include: { attempts: { orderBy: { attemptNumber: 'desc' }, take: 1 } },
          orderBy: { createdAt: 'desc' },
          take: 100
        });
        const meetings = await db.meeting.findMany({ where: { caseId }, select: {
          id: true, title: true, meetingDate: true, status: true, version: true
        }, orderBy: { meetingDate: 'desc' }, take: 100 });
        const dateCandidates = await loadGoogleDateCandidates(caseId);
        let gmailAttachments: unknown[] = [];
        let sheetSources: unknown[] = [];
        let gmailSourceStatus: { responseClass: GoogleAdapterMode; retryAfterSeconds: number | null } | null = null;
        let sheetSourceStatus: { responseClass: GoogleAdapterMode; retryAfterSeconds: number | null } | null = null;
        if (safeConnection?.status === 'CONNECTED') {
          // Real adapters are intentionally request-scoped. Bind this request to
          // the exact opaque reference stored on the tenant connection before
          // listing any provider-owned source data.
          await requireConnectedGoogle();
          const [gmail, sheets] = await Promise.all([
            invokeGoogleProvider((signal) => googleAdapter.listGmailAttachments(caseId, signal)),
            invokeGoogleProvider((signal) => googleAdapter.listSheetSources(caseId, signal))
          ]);
          if (GOOGLE_SUCCESS_CLASSES.has(gmail.responseClass) || GOOGLE_SUCCESS_CLASSES.has(sheets.responseClass)) {
            await syncGoogleCredentialMetadata();
          }
          gmailSourceStatus = { responseClass: gmail.responseClass, retryAfterSeconds: gmail.retryAfterSeconds ?? null };
          sheetSourceStatus = { responseClass: sheets.responseClass, retryAfterSeconds: sheets.retryAfterSeconds ?? null };
          if (GOOGLE_SUCCESS_CLASSES.has(gmail.responseClass) && gmail.data) {
            try { gmailAttachments = projectGmailCandidates(gmail.data); }
            catch { gmailSourceStatus = { responseClass: 'MALFORMED_PROVIDER_RESPONSE', retryAfterSeconds: null }; }
          }
          if (GOOGLE_SUCCESS_CLASSES.has(sheets.responseClass) && sheets.data) {
            try { sheetSources = projectSheetSources(sheets.data); }
            catch { sheetSourceStatus = { responseClass: 'MALFORMED_PROVIDER_RESPONSE', retryAfterSeconds: null }; }
          }
        }
        sendJson(res, 200, {
          caseVersion: caseRow.version,
          connectionStatus: safeConnection?.status ?? 'DISCONNECTED',
          resources: resources.map((resource) => {
            let metadata: Record<string, unknown> = {};
            try {
              const parsed: unknown = JSON.parse(resource.resourceMetadataJson);
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
            } catch { /* malformed legacy metadata is presented as empty */ }
            return {
              id: resource.id,
              organizationId: resource.organizationId,
              caseId: resource.caseId,
              operationId: resource.operationId,
              entityType: resource.entityType,
              internalEntityId: resource.internalEntityId,
              externalResourceId: resource.externalResourceId,
              createdAt: resource.createdAt,
              name: metadata.name ?? metadata.folderName ?? metadata.filename ?? metadata.summary ?? metadata.title ?? resource.entityType,
              webViewLink: metadata.webViewLink ?? metadata.htmlLink ?? null,
              provenance: metadata.provenance ?? null,
              metadata
            };
          }),
          history: history.map((operation) => ({
            id: operation.id,
            operationKind: operation.operationKind,
            status: operation.status,
            responseClass: operation.attempts[0]?.responseClass ?? null,
            redactedError: operation.attempts[0]?.redactedError ?? null,
            createdAt: operation.createdAt.toISOString(),
            completedAt: operation.completedAt?.toISOString() ?? null
          })),
          gmailAttachments,
          gmailSourceStatus,
          meetings,
          sheetSources,
          sheetSourceStatus,
          dateCandidates
        });
        return;
      }

      const driveMatch = pathname.match(/^\/api\/cases\/([^/]+)\/google\/drive-folder$/);
      if (driveMatch && req.method === 'POST') {
        const caseId = driveMatch[1];
        const body = await readJson(req);
        assertExactJsonFields(body, ['idempotencyKey', 'expectedCaseVersion'], ['idempotencyKey', 'expectedCaseVersion']);
        const idempotencyKey = strictIdempotencyKey(body.idempotencyKey);
        const expectedVersion = boundedInteger(body.expectedCaseVersion, -1, 1, 2_147_483_647, 'expectedCaseVersion');
        const caseRow = await requireGoogleCase(caseId);
        const fingerprint = sha256Hex(canonicalJson({ caseId, expectedVersion }));
        const reservation = await reserveGoogleOperation(caseId, 'DRIVE_FOLDER', idempotencyKey, fingerprint);
        if (reservation.replay) { sendJson(res, reservation.replay.httpStatus, reservation.replay.body); return; }
        const existingLink = await db.googleResourceLink.findFirst({ where: {
          organizationId: context.user.organizationId, caseId, entityType: 'CASE_DRIVE_FOLDER', internalEntityId: caseId
        } });
        if (existingLink) {
          await deletePendingGoogleOperation(reservation.operation.id);
          sendJson(res, 200, { resourceLink: existingLink, folderId: existingLink.externalResourceId, isExisting: true, caseVersion: caseRow.version, idempotentReplay: true });
          return;
        }
        if (caseRow.version !== expectedVersion) { await deletePendingGoogleOperation(reservation.operation.id); throw new HttpError(409, 'Case version conflict'); }
        const { response, attempts } = await executeGoogleCall(
          (signal) => googleAdapter.createDriveFolder(caseId, caseRow.title.slice(0, 100), idempotencyKey, signal),
          GOOGLE_MUTATION_RETRYABLE_CLASSES
        );
        if (!GOOGLE_SUCCESS_CLASSES.has(response.responseClass) || !response.data) {
          throw await failGoogleMutationOperation(
            reservation.operation.id,
            response,
            attempts,
            'GOOGLE_DRIVE_FOLDER_FAILED',
            `${caseId}:DRIVE_FOLDER:${fingerprint}`
          );
        }
        const rawData = response.data as unknown as Record<string, unknown>;
        let data: { folderId: string; folderName: string; webViewLink: string; isExisting: boolean };
        try {
          if (!hasExactProviderKeys(rawData, ['folderId', 'folderName', 'webViewLink', 'isExisting'])) throw new HttpError(502, 'Google Drive provider response contains unexpected data');
          if (typeof rawData.isExisting !== 'boolean') throw new HttpError(502, 'Google provider returned an invalid Drive folder status');
          data = {
            folderId: validateGoogleProviderId(rawData.folderId, 'Drive folder ID'),
            folderName: validateGoogleProviderText(rawData.folderName, 'Drive folder name', 200),
            webViewLink: validateGoogleProviderUrl(rawData.webViewLink, 'drive'),
            isExisting: rawData.isExisting
          };
        } catch (error) {
          await markGoogleReconciliationRequired(reservation.operation.id, attempts, typeof rawData.folderId === 'string' ? rawData.folderId : 'INVALID_DRIVE_RESOURCE');
          throw error;
        }
        try {
          const result = await db.$transaction(async (tx) => {
            const caseVersion = await bumpGoogleCaseVersion(tx, caseId, expectedVersion);
            await writeGoogleAttempts(tx, reservation.operation.id, attempts);
            const link = await tx.googleResourceLink.create({ data: {
              id: `GRLINK-${crypto.randomUUID()}`,
              organizationId: context.user.organizationId,
              caseId,
              operationId: reservation.operation.id,
              entityType: 'CASE_DRIVE_FOLDER',
              internalEntityId: caseId,
              externalResourceId: data.folderId,
              resourceMetadataJson: JSON.stringify({ folderName: data.folderName, webViewLink: data.webViewLink })
            } });
            const resultBody = { resourceLink: link, folderId: data.folderId, isExisting: false, caseVersion };
            await tx.googleSyncOperation.update({ where: { id: reservation.operation.id }, data: {
              status: 'SUCCESS', resultJson: JSON.stringify({ httpStatus: 201, body: resultBody }), completedAt: new Date()
            } });
            await tx.auditLog.create({ data: requestAudit(context, 'GOOGLE_DRIVE_FOLDER_CREATED', 'GoogleResourceLink', link.id, {
              caseId, operationId: reservation.operation.id, attemptCount: attempts.length
            }) });
            return resultBody;
          });
          sendJson(res, 201, result);
          return;
        } catch (error) {
          const canonical = await db.googleResourceLink.findFirst({ where: { organizationId: context.user.organizationId, caseId, entityType: 'CASE_DRIVE_FOLDER', internalEntityId: caseId } });
          if (canonical) { sendJson(res, 200, { resourceLink: canonical, folderId: canonical.externalResourceId, isExisting: true, idempotentReplay: true }); return; }
          await markGoogleReconciliationRequired(reservation.operation.id, attempts, data.folderId);
          throw error;
        }
      }

      const gmailMatch = pathname.match(/^\/api\/cases\/([^/]+)\/google\/import-gmail$/);
      if (gmailMatch && req.method === 'POST') {
        const caseId = gmailMatch[1];
        const body = await readJson(req);
        assertExactJsonFields(body, ['attachmentIds', 'idempotencyKey', 'expectedCaseVersion'], ['attachmentIds', 'idempotencyKey', 'expectedCaseVersion']);
        if (!Array.isArray(body.attachmentIds) || body.attachmentIds.length < 1 || body.attachmentIds.length > 10 || !body.attachmentIds.every((id) => typeof id === 'string')) {
          throw new HttpError(400, 'attachmentIds must contain between 1 and 10 selected IDs');
        }
        const selectedIds = body.attachmentIds.map((id) => strictString(id, 'attachmentId', 1, 100));
        if (new Set(selectedIds).size !== selectedIds.length) throw new HttpError(400, 'attachmentIds must be unique');
        const idempotencyKey = strictIdempotencyKey(body.idempotencyKey);
        const expectedVersion = boundedInteger(body.expectedCaseVersion, -1, 1, 2_147_483_647, 'expectedCaseVersion');
        const caseRow = await requireGoogleCase(caseId);
        const fingerprint = sha256Hex(canonicalJson({ caseId, selectedIds: [...selectedIds].sort(), expectedVersion }));
        const reservation = await reserveGoogleOperation(caseId, 'GMAIL_IMPORT', idempotencyKey, fingerprint);
        if (reservation.replay) { sendJson(res, reservation.replay.httpStatus, reservation.replay.body); return; }
        if (caseRow.version !== expectedVersion) { await deletePendingGoogleOperation(reservation.operation.id); throw new HttpError(409, 'Case version conflict'); }
        const { response: candidates, attempts: candidateAttempts } = await executeGoogleCall((signal) => googleAdapter.listGmailAttachments(caseId, signal));
        if (!GOOGLE_SUCCESS_CLASSES.has(candidates.responseClass) || !candidates.data) {
          throw await failGoogleOperation(reservation.operation.id, candidates, candidateAttempts, 'GMAIL_IMPORT_FAILED');
        }
        let safeCandidates: ReturnType<typeof projectGmailCandidates>;
        try {
          safeCandidates = projectGmailCandidates(candidates.data);
        } catch {
          const malformed: GoogleAdapterResponse<unknown> = { responseClass: 'MALFORMED_PROVIDER_RESPONSE', redactedError: safeGoogleProviderError('MALFORMED_PROVIDER_RESPONSE'), durationMs: candidates.durationMs };
          const projectedAttempts = candidateAttempts.map((attempt, index) => index === candidateAttempts.length - 1
            ? { ...attempt, responseClass: 'MALFORMED_PROVIDER_RESPONSE' as const, redactedError: malformed.redactedError }
            : attempt);
          throw await failGoogleOperation(reservation.operation.id, malformed, projectedAttempts, 'GMAIL_IMPORT_FAILED');
        }
        const candidateIds = new Set(safeCandidates.map((candidate) => candidate.attachmentId));
        if (selectedIds.some((id) => !candidateIds.has(id))) { await deletePendingGoogleOperation(reservation.operation.id); throw new HttpError(400, 'An attachment was not selected from the current Gmail candidate list'); }
        const duplicate = await db.googleImportSnapshot.findFirst({ where: {
          organizationId: context.user.organizationId, caseId, sourceType: 'GMAIL_ATTACHMENT', externalResourceId: { in: selectedIds }
        } });
        if (duplicate) { await deletePendingGoogleOperation(reservation.operation.id); throw new HttpError(409, 'A selected Gmail attachment was already imported'); }
        const { response, attempts } = await executeGoogleCall((signal) => googleAdapter.importGmailAttachments(caseId, selectedIds, signal));
        if (!GOOGLE_SUCCESS_CLASSES.has(response.responseClass) || !response.data) throw await failGoogleOperation(reservation.operation.id, response, attempts, 'GMAIL_IMPORT_FAILED');
        const providerAttachmentIds = response.data.items.map((item) => item.attachmentId);
        const selectedAttachmentSet = [...selectedIds].sort();
        const providerAttachmentSet = [...providerAttachmentIds].sort();
        if (
          response.data.importedCount !== selectedIds.length
          || response.data.items.length !== selectedIds.length
          || new Set(providerAttachmentIds).size !== providerAttachmentIds.length
          || canonicalJson(providerAttachmentSet) !== canonicalJson(selectedAttachmentSet)
        ) {
          const malformedResponse: GoogleAdapterResponse<unknown> = {
            responseClass: 'MALFORMED_PROVIDER_RESPONSE',
            redactedError: 'Google Gmail provider response did not match the selected attachment set',
            durationMs: response.durationMs
          };
          const malformedAttempts = attempts.map((attempt, index) => index === attempts.length - 1
            ? { ...attempt, responseClass: 'MALFORMED_PROVIDER_RESPONSE' as const, redactedError: malformedResponse.redactedError }
            : attempt);
          throw await failGoogleOperation(reservation.operation.id, malformedResponse, malformedAttempts, 'GMAIL_IMPORT_FAILED');
        }
        const writtenPaths: string[] = [];
        try {
          const prepared = response.data.items.map((item) => {
            const buffer = Buffer.from(item.contentBase64, 'base64');
            const verified = validateFileSecurity(item.filename, item.mimeType, buffer);
            if (buffer.length !== item.sizeBytes || sha256Hex(buffer) !== item.sha256) throw new HttpError(502, 'Gmail attachment integrity verification failed');
            const documentId = `DOC-GMAIL-${crypto.randomUUID()}`;
            const versionId = `DOCVER-${crypto.randomUUID()}`;
            const storageKey = `storage-${crypto.randomUUID()}${verified.extension}`;
            const diskPath = safeStoragePath(uploadDir, storageKey);
            return { item, buffer, verified, documentId, versionId, storageKey, diskPath };
          });
          for (const file of prepared) {
            fs.writeFileSync(file.diskPath, file.buffer, { flag: 'wx' });
            writtenPaths.push(file.diskPath);
          }
          const result = await db.$transaction(async (tx) => {
            const caseVersion = await bumpGoogleCaseVersion(tx, caseId, expectedVersion);
            await writeGoogleAttempts(tx, reservation.operation.id, attempts);
            const snapshots = [];
            const documents = [];
            for (const file of prepared) {
              const title = `Gmail 첨부: ${file.verified.cleanFilename}`.slice(0, 200);
              await tx.document.create({ data: {
                id: file.documentId, caseId, title, category: 'EVIDENCE', source: 'RECEIVED', version: 1
              } });
              await tx.documentVersion.create({ data: {
                id: file.versionId,
                documentId: file.documentId,
                versionNumber: 1,
                originalName: file.verified.cleanFilename,
                displayName: `${caseRow.caseNumber}_GMAIL_${sanitizeDisplayName(file.verified.cleanFilename)}`.slice(0, 240),
                storageKey: file.storageKey,
                fileSize: file.buffer.length,
                mimeType: file.verified.mimeType,
                sha256: file.item.sha256,
                uploadedById: context.user.id
              } });
              const document = await tx.document.update({ where: { id: file.documentId }, data: { currentVersionId: file.versionId } });
              const snapshot = await tx.googleImportSnapshot.create({ data: {
                id: `GSNAP-${crypto.randomUUID()}`,
                organizationId: context.user.organizationId,
                caseId,
                operationId: reservation.operation.id,
                sourceType: 'GMAIL_ATTACHMENT',
                externalResourceId: file.item.attachmentId,
                sha256: file.item.sha256,
                provenanceJson: JSON.stringify({
                  attachmentId: file.item.attachmentId,
                  filename: file.verified.cleanFilename,
                  mimeType: file.verified.mimeType,
                  fileSize: file.buffer.length,
                  documentId: file.documentId,
                  documentVersionId: file.versionId,
                  importedBy: context.user.id
                }),
                createdById: context.user.id
              } });
              await tx.googleResourceLink.create({ data: {
                id: `GRLINK-${crypto.randomUUID()}`,
                organizationId: context.user.organizationId,
                caseId,
                operationId: reservation.operation.id,
                entityType: 'GMAIL_ATTACHMENT',
                internalEntityId: file.versionId,
                externalResourceId: file.item.attachmentId,
                resourceMetadataJson: JSON.stringify({ filename: file.verified.cleanFilename, documentVersionId: file.versionId })
              } });
              await tx.auditLog.create({ data: requestAudit(context, 'DOCUMENT_CREATED', 'Document', file.documentId, {
                source: 'GMAIL_ATTACHMENT', sha256: file.item.sha256, operationId: reservation.operation.id
              }) });
              documents.push(document);
              snapshots.push(snapshot);
            }
            const resultBody = { importedCount: snapshots.length, snapshots, documents, caseVersion };
            await tx.googleSyncOperation.update({ where: { id: reservation.operation.id }, data: {
              status: 'SUCCESS', resultJson: JSON.stringify({ httpStatus: 201, body: resultBody }), completedAt: new Date()
            } });
            await tx.auditLog.create({ data: requestAudit(context, 'GMAIL_ATTACHMENTS_IMPORTED', 'GoogleSyncOperation', reservation.operation.id, {
              caseId, importedCount: snapshots.length, attachmentIds: selectedIds
            }) });
            return resultBody;
          });
          sendJson(res, 201, result);
          return;
        } catch (error) {
          for (const diskPath of writtenPaths) fs.rmSync(diskPath, { force: true });
          await deletePendingGoogleOperation(reservation.operation.id);
          throw error;
        }
      }

      const calendarMatch = pathname.match(/^\/api\/cases\/([^/]+)\/google\/calendar-event$/);
      if (calendarMatch && req.method === 'POST') {
        const caseId = calendarMatch[1];
        const body = await readJson(req);
        assertExactJsonFields(body, ['dateCandidateId', 'candidateHash', 'humanConfirmed', 'idempotencyKey', 'expectedCaseVersion'],
          ['dateCandidateId', 'candidateHash', 'humanConfirmed', 'idempotencyKey', 'expectedCaseVersion']);
        if (body.humanConfirmed !== true) throw new HttpError(400, 'Human confirmation is required before Calendar creation');
        const dateCandidateId = strictString(body.dateCandidateId, 'dateCandidateId', 1, 100);
        const candidateHash = strictString(body.candidateHash, 'candidateHash', 64, 64);
        if (!/^[0-9a-f]{64}$/.test(candidateHash)) throw new HttpError(400, 'candidateHash must be a lowercase SHA-256 value');
        const idempotencyKey = strictIdempotencyKey(body.idempotencyKey);
        const expectedVersion = boundedInteger(body.expectedCaseVersion, -1, 1, 2_147_483_647, 'expectedCaseVersion');
        const caseRow = await requireGoogleCase(caseId, GOOGLE_CASE_SCHEDULE_ROLES);
        const candidate = (await loadGoogleDateCandidates(caseId)).find((entry) => entry.id === dateCandidateId);
        if (!candidate) throw new HttpError(400, 'Date candidate was not selected from this case');
        if (candidate.candidateHash !== candidateHash) throw new HttpError(409, 'Date candidate changed; review the refreshed provenance before confirming');
        const internalEntityId = `CAL-${sha256Hex(canonicalJson({ caseId, dateCandidateId, candidateHash })).slice(0, 24)}`;
        const fingerprint = sha256Hex(canonicalJson({ caseId, dateCandidateId, candidateHash, expectedVersion }));
        const reservation = await reserveGoogleOperation(caseId, 'CALENDAR_EVENT', idempotencyKey, fingerprint);
        if (reservation.replay) { sendJson(res, reservation.replay.httpStatus, reservation.replay.body); return; }
        const existing = await db.googleResourceLink.findFirst({ where: { organizationId: context.user.organizationId, caseId, entityType: 'CALENDAR_EVENT', internalEntityId } });
        if (existing) { await deletePendingGoogleOperation(reservation.operation.id); sendJson(res, 200, { resourceLink: existing, eventId: existing.externalResourceId, caseVersion: caseRow.version, idempotentReplay: true }); return; }
        if (caseRow.version !== expectedVersion) { await deletePendingGoogleOperation(reservation.operation.id); throw new HttpError(409, 'Case version conflict'); }
        const { response, attempts } = await executeGoogleCall(
          (signal) => googleAdapter.createCalendarEvent(caseId, {
            summary: candidate.summary,
            description: `Confirmed from ${candidate.originalLocation}`,
            startDateTime: candidate.startDateTime,
            endDateTime: candidate.endDateTime,
            humanConfirmed: true,
            sourceParagraphText: candidate.excerpt
          }, idempotencyKey, signal),
          GOOGLE_MUTATION_RETRYABLE_CLASSES
        );
        if (!GOOGLE_SUCCESS_CLASSES.has(response.responseClass) || !response.data) {
          throw await failGoogleMutationOperation(
            reservation.operation.id,
            response,
            attempts,
            'GOOGLE_CALENDAR_EVENT_FAILED',
            `${caseId}:CALENDAR_EVENT:${fingerprint}`
          );
        }
        const rawData = response.data as unknown as Record<string, unknown>;
        let data: { eventId: string; htmlLink: string; summary: string };
        try {
          if (!hasExactProviderKeys(rawData, ['eventId', 'htmlLink', 'summary'])) throw new HttpError(502, 'Google Calendar provider response contains unexpected data');
          data = {
            eventId: validateGoogleProviderId(rawData.eventId, 'Calendar event ID'),
            htmlLink: validateGoogleProviderUrl(rawData.htmlLink, 'calendar'),
            summary: validateGoogleProviderText(rawData.summary, 'Calendar summary', 500)
          };
          if (data.summary !== candidate.summary) throw new HttpError(502, 'Google provider Calendar summary did not match the confirmed candidate');
        } catch (error) {
          await markGoogleReconciliationRequired(reservation.operation.id, attempts, typeof rawData.eventId === 'string' ? rawData.eventId : 'INVALID_CALENDAR_RESOURCE');
          throw error;
        }
        try {
          const result = await db.$transaction(async (tx) => {
            const currentSource = await tx.meetingActionItem.findUnique({ where: { id: dateCandidateId }, include: { meeting: true } });
            if (!currentSource || currentSource.meeting.caseId !== caseId) throw new HttpError(409, 'Date candidate source changed during Calendar creation');
            const currentCandidate = projectGoogleDateCandidate(currentSource);
            if (currentCandidate.candidateHash !== candidateHash) throw new HttpError(409, 'Date candidate source changed during Calendar creation');
            const caseVersion = await bumpGoogleCaseVersion(tx, caseId, expectedVersion);
            await writeGoogleAttempts(tx, reservation.operation.id, attempts);
            const link = await tx.googleResourceLink.create({ data: {
              id: `GRLINK-${crypto.randomUUID()}`,
              organizationId: context.user.organizationId,
              caseId,
              operationId: reservation.operation.id,
              entityType: 'CALENDAR_EVENT',
              internalEntityId,
              externalResourceId: data.eventId,
              resourceMetadataJson: JSON.stringify({
                summary: data.summary,
                htmlLink: data.htmlLink,
                startDateTime: candidate.startDateTime,
                endDateTime: candidate.endDateTime,
                provenance: {
                  dateCandidateId,
                  candidateHash,
                  confidence: candidate.confidence,
                  sourceType: candidate.sourceType,
                  sourceEntityId: candidate.sourceEntityId,
                  originalLocation: candidate.originalLocation,
                  excerpt: candidate.excerpt
                },
                humanConfirmedBy: context.user.id
              })
            } });
            const resultBody = { event: data, resourceLink: link, caseVersion };
            await tx.googleSyncOperation.update({ where: { id: reservation.operation.id }, data: {
              status: 'SUCCESS', resultJson: JSON.stringify({ httpStatus: 201, body: resultBody }), completedAt: new Date()
            } });
            await tx.auditLog.create({ data: requestAudit(context, 'GOOGLE_CALENDAR_EVENT_CREATED', 'GoogleResourceLink', link.id, {
              caseId, operationId: reservation.operation.id, dateCandidateId, candidateHash, humanConfirmed: true
            }) });
            return resultBody;
          });
          sendJson(res, 201, result);
          return;
        } catch (error) {
          await markGoogleReconciliationRequired(reservation.operation.id, attempts, data.eventId);
          throw error;
        }
      }

      const docsMatch = pathname.match(/^\/api\/cases\/([^/]+)\/google\/export-docs$/);
      if (docsMatch && req.method === 'POST') {
        const caseId = docsMatch[1];
        const body = await readJson(req);
        assertExactJsonFields(body, ['meetingId', 'versionNumber', 'idempotencyKey', 'expectedCaseVersion'], ['meetingId', 'versionNumber', 'idempotencyKey', 'expectedCaseVersion']);
        const meetingId = strictString(body.meetingId, 'meetingId', 1, 100);
        const versionNumber = boundedInteger(body.versionNumber, -1, 1, 2_147_483_647, 'versionNumber');
        const idempotencyKey = strictIdempotencyKey(body.idempotencyKey);
        const expectedVersion = boundedInteger(body.expectedCaseVersion, -1, 1, 2_147_483_647, 'expectedCaseVersion');
        const caseRow = await requireGoogleCase(caseId);
        const meeting = await db.meeting.findUnique({ where: { id: meetingId } });
        if (!meeting || meeting.caseId !== caseId) throw new HttpError(404, 'Selected meeting does not belong to this case');
        if (meeting.version !== versionNumber) throw new HttpError(409, 'Selected meeting version is stale');
        const internalEntityId = `${meeting.id}:v${versionNumber}`;
        const content = [meeting.rawText, meeting.summary, meeting.decisions].filter((part): part is string => Boolean(part)).join('\n\n');
        if (!content) throw new HttpError(409, 'Selected meeting version has no exportable content');
        const contentSha256 = sha256Hex(content);
        const fingerprint = sha256Hex(canonicalJson({ caseId, meetingId, versionNumber, contentSha256, expectedVersion }));
        const reservation = await reserveGoogleOperation(caseId, 'DOCS_EXPORT', idempotencyKey, fingerprint);
        if (reservation.replay) { sendJson(res, reservation.replay.httpStatus, reservation.replay.body); return; }
        const existing = await db.googleResourceLink.findFirst({ where: { organizationId: context.user.organizationId, caseId, entityType: 'DOCS_EXPORT', internalEntityId } });
        if (existing) { await deletePendingGoogleOperation(reservation.operation.id); sendJson(res, 200, { resourceLink: existing, documentId: existing.externalResourceId, caseVersion: caseRow.version, idempotentReplay: true }); return; }
        if (caseRow.version !== expectedVersion) { await deletePendingGoogleOperation(reservation.operation.id); throw new HttpError(409, 'Case version conflict'); }
        const { response, attempts } = await executeGoogleCall(
          (signal) => googleAdapter.exportDocs(caseId, meetingId, versionNumber, meeting.title.slice(0, 200), content, idempotencyKey, signal),
          GOOGLE_MUTATION_RETRYABLE_CLASSES
        );
        if (!GOOGLE_SUCCESS_CLASSES.has(response.responseClass) || !response.data) {
          throw await failGoogleMutationOperation(
            reservation.operation.id,
            response,
            attempts,
            'GOOGLE_DOCS_EXPORT_FAILED',
            `${caseId}:DOCS_EXPORT:${fingerprint}`
          );
        }
        const rawData = response.data as unknown as Record<string, unknown>;
        let data: { documentId: string; title: string; webViewLink: string; version: number };
        try {
          if (!hasExactProviderKeys(rawData, ['documentId', 'title', 'webViewLink', 'version'])) throw new HttpError(502, 'Google Docs provider response contains unexpected data');
          data = {
            documentId: validateGoogleProviderId(rawData.documentId, 'Docs document ID'),
            title: validateGoogleProviderText(rawData.title, 'Docs title', 200),
            webViewLink: validateGoogleProviderUrl(rawData.webViewLink, 'docs'),
            version: Number(rawData.version)
          };
          if (!Number.isInteger(rawData.version) || data.version !== versionNumber || data.title !== meeting.title.slice(0, 200)) {
            throw new HttpError(502, 'Google provider Docs response did not match the selected meeting version');
          }
        } catch (error) {
          await markGoogleReconciliationRequired(reservation.operation.id, attempts, typeof rawData.documentId === 'string' ? rawData.documentId : 'INVALID_DOCS_RESOURCE');
          throw error;
        }
        try {
          const result = await db.$transaction(async (tx) => {
            const currentMeeting = await tx.meeting.findUnique({ where: { id: meetingId } });
            if (!currentMeeting || currentMeeting.caseId !== caseId || currentMeeting.version !== versionNumber) throw new HttpError(409, 'Meeting changed during Docs export');
            const caseVersion = await bumpGoogleCaseVersion(tx, caseId, expectedVersion);
            await writeGoogleAttempts(tx, reservation.operation.id, attempts);
            const snapshot = await tx.googleImportSnapshot.create({ data: {
              id: `GSNAP-${crypto.randomUUID()}`,
              organizationId: context.user.organizationId,
              caseId,
              operationId: reservation.operation.id,
              sourceType: 'DOCS_TEXT',
              externalResourceId: data.documentId,
              sha256: contentSha256,
              version: versionNumber,
              provenanceJson: JSON.stringify({
                meetingId,
                meetingVersion: versionNumber,
                contentSha256,
                exportedDocumentId: data.documentId,
                exportedBy: context.user.id
              }),
              createdById: context.user.id
            } });
            const link = await tx.googleResourceLink.create({ data: {
              id: `GRLINK-${crypto.randomUUID()}`,
              organizationId: context.user.organizationId,
              caseId,
              operationId: reservation.operation.id,
              entityType: 'DOCS_EXPORT',
              internalEntityId,
              externalResourceId: data.documentId,
              resourceMetadataJson: JSON.stringify({
                title: data.title,
                webViewLink: data.webViewLink,
                meetingId,
                versionNumber,
                contentSha256,
                snapshotId: snapshot.id
              })
            } });
            const resultBody = { exportResult: data, snapshot, resourceLink: link, caseVersion };
            await tx.googleSyncOperation.update({ where: { id: reservation.operation.id }, data: {
              status: 'SUCCESS', resultJson: JSON.stringify({ httpStatus: 201, body: resultBody }), completedAt: new Date()
            } });
            await tx.auditLog.create({ data: requestAudit(context, 'GOOGLE_DOCS_EXPORTED', 'GoogleResourceLink', link.id, {
              caseId, meetingId, versionNumber, operationId: reservation.operation.id
            }) });
            return resultBody;
          });
          sendJson(res, 201, result);
          return;
        } catch (error) {
          await markGoogleReconciliationRequired(reservation.operation.id, attempts, data.documentId);
          throw error;
        }
      }

      const sheetsMatch = pathname.match(/^\/api\/cases\/([^/]+)\/google\/import-sheets$/);
      if (sheetsMatch && req.method === 'POST') {
        const caseId = sheetsMatch[1];
        const body = await readJson(req);
        assertExactJsonFields(body, ['spreadsheetId', 'sheetName', 'rangeA1', 'idempotencyKey', 'expectedCaseVersion'], ['spreadsheetId', 'sheetName', 'rangeA1', 'idempotencyKey', 'expectedCaseVersion']);
        const spreadsheetId = strictString(body.spreadsheetId, 'spreadsheetId', 1, 100);
        const sheetName = strictString(body.sheetName, 'sheetName', 1, 100);
        const rangeA1 = strictString(body.rangeA1, 'rangeA1', 5, 40).toUpperCase();
        const rangeMatch = rangeA1.match(/^([A-Z]{1,3})([1-9][0-9]{0,5}):([A-Z]{1,3})([1-9][0-9]{0,5})$/);
        const columnNumber = (letters: string): number => letters.split('').reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
        if (!rangeMatch) throw new HttpError(400, 'rangeA1 must be a bounded A1 rectangle');
        const startColumn = columnNumber(rangeMatch[1]);
        const startRow = Number(rangeMatch[2]);
        const endColumn = columnNumber(rangeMatch[3]);
        const endRow = Number(rangeMatch[4]);
        const rows = endRow - startRow + 1;
        const columns = endColumn - startColumn + 1;
        if (rows < 1 || columns < 1 || rows > 200 || columns > 26 || rows * columns > 1000) throw new HttpError(400, 'Sheets range exceeds the 200-row, 26-column, or 1000-cell limit');
        const idempotencyKey = strictIdempotencyKey(body.idempotencyKey);
        const expectedVersion = boundedInteger(body.expectedCaseVersion, -1, 1, 2_147_483_647, 'expectedCaseVersion');
        const caseRow = await requireGoogleCase(caseId);
        const fingerprint = sha256Hex(canonicalJson({ caseId, spreadsheetId, sheetName, rangeA1, expectedVersion }));
        const reservation = await reserveGoogleOperation(caseId, 'SHEETS_IMPORT', idempotencyKey, fingerprint);
        if (reservation.replay) { sendJson(res, reservation.replay.httpStatus, reservation.replay.body); return; }
        if (caseRow.version !== expectedVersion) { await deletePendingGoogleOperation(reservation.operation.id); throw new HttpError(409, 'Case version conflict'); }
        const { response: sources, attempts: sourceAttempts } = await executeGoogleCall((signal) => googleAdapter.listSheetSources(caseId, signal));
        if (!GOOGLE_SUCCESS_CLASSES.has(sources.responseClass) || !sources.data) {
          throw await failGoogleOperation(reservation.operation.id, sources, sourceAttempts, 'GOOGLE_SHEETS_IMPORT_FAILED');
        }
        let safeSources: ReturnType<typeof projectSheetSources>;
        try {
          safeSources = projectSheetSources(sources.data);
        } catch {
          const malformed: GoogleAdapterResponse<unknown> = { responseClass: 'MALFORMED_PROVIDER_RESPONSE', redactedError: safeGoogleProviderError('MALFORMED_PROVIDER_RESPONSE'), durationMs: sources.durationMs };
          const projectedAttempts = sourceAttempts.map((attempt, index) => index === sourceAttempts.length - 1
            ? { ...attempt, responseClass: 'MALFORMED_PROVIDER_RESPONSE' as const, redactedError: malformed.redactedError }
            : attempt);
          throw await failGoogleOperation(reservation.operation.id, malformed, projectedAttempts, 'GOOGLE_SHEETS_IMPORT_FAILED');
        }
        const source = safeSources.find((candidate) => candidate.spreadsheetId === spreadsheetId && candidate.sheetName === sheetName);
        if (!source) { await deletePendingGoogleOperation(reservation.operation.id); throw new HttpError(400, 'Sheets source was not selected from the current allowlist'); }
        const allowed = source.allowedRange.match(/^([A-Z]{1,3})([1-9][0-9]{0,5}):([A-Z]{1,3})([1-9][0-9]{0,5})$/);
        if (!allowed || startColumn < columnNumber(allowed[1]) || startRow < Number(allowed[2]) || endColumn > columnNumber(allowed[3]) || endRow > Number(allowed[4])) {
          await deletePendingGoogleOperation(reservation.operation.id);
          throw new HttpError(400, 'Sheets range is outside the selected source allowlist');
        }
        const { response, attempts } = await executeGoogleCall((signal) => googleAdapter.importSheets(caseId, { spreadsheetId, sheetName, rangeA1 }, signal));
        if (!GOOGLE_SUCCESS_CLASSES.has(response.responseClass) || !response.data) throw await failGoogleOperation(reservation.operation.id, response, attempts, 'GOOGLE_SHEETS_IMPORT_FAILED');
        const data = response.data;
        let parsedValues: Record<string, unknown> | null = null;
        let providerRows: unknown[][] = [];
        let providerHeaders: unknown[] = [];
        try {
          const valueBytes = Buffer.byteLength(data.valuesJson, 'utf8');
          if (valueBytes < 2 || valueBytes > 1_000_000) throw new Error('valuesJson size is outside the accepted boundary');
          const parsed: unknown = JSON.parse(data.valuesJson);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('valuesJson must be an object');
          parsedValues = parsed as Record<string, unknown>;
          const allowedKeys = ['headers', 'range', 'rows', 'sheetName', 'spreadsheetId'];
          if (canonicalJson(Object.keys(parsedValues).sort()) !== canonicalJson(allowedKeys)) throw new Error('valuesJson contains unexpected fields');
          if (parsedValues.spreadsheetId !== spreadsheetId || parsedValues.sheetName !== sheetName || parsedValues.range !== rangeA1) {
            throw new Error('valuesJson source binding mismatch');
          }
          if (!Array.isArray(parsedValues.headers) || !parsedValues.headers.every((value) => typeof value === 'string')) throw new Error('invalid header row');
          if (!Array.isArray(parsedValues.rows) || !parsedValues.rows.every((row) => Array.isArray(row))) throw new Error('invalid sheet rows');
          providerHeaders = parsedValues.headers;
          providerRows = parsedValues.rows as unknown[][];
          const validCell = (value: unknown): boolean => value === null || ['string', 'number', 'boolean'].includes(typeof value);
          if (!providerRows.every((row) => row.every(validCell))) throw new Error('invalid sheet cell type');
          const observedColumnCount = Math.max(providerHeaders.length, ...providerRows.map((row) => row.length));
          if (!Number.isInteger(data.rowCount) || !Number.isInteger(data.columnCount)
            || data.rowCount !== providerRows.length || data.columnCount !== observedColumnCount
            || data.rowCount < 0 || data.rowCount > rows || data.columnCount < 1 || data.columnCount > columns
            || providerHeaders.length !== data.columnCount || providerRows.some((row) => row.length > data.columnCount)) {
            throw new Error('sheet dimensions do not match the selected range');
          }
          if (!/^[0-9a-f]{64}$/.test(data.sha256) || sha256Hex(Buffer.from(data.valuesJson, 'utf8')) !== data.sha256) {
            throw new Error('sheet snapshot hash mismatch');
          }
          if (!/^[A-Za-z0-9._:-]{1,200}$/.test(data.snapshotId)) throw new Error('invalid provider snapshot identifier');
        } catch {
          const malformedResponse: GoogleAdapterResponse<unknown> = {
            responseClass: 'MALFORMED_PROVIDER_RESPONSE',
            redactedError: 'Google Sheets provider response failed integrity and range validation',
            durationMs: response.durationMs
          };
          const malformedAttempts = attempts.map((attempt, index) => index === attempts.length - 1
            ? { ...attempt, responseClass: 'MALFORMED_PROVIDER_RESPONSE' as const, redactedError: malformedResponse.redactedError }
            : attempt);
          throw await failGoogleOperation(reservation.operation.id, malformedResponse, malformedAttempts, 'GOOGLE_SHEETS_IMPORT_FAILED');
        }
        try {
          const result = await db.$transaction(async (tx) => {
            const caseVersion = await bumpGoogleCaseVersion(tx, caseId, expectedVersion);
            await writeGoogleAttempts(tx, reservation.operation.id, attempts);
            const externalResourceId = `${spreadsheetId}!${sheetName}:${rangeA1}`;
            const snapshot = await tx.googleImportSnapshot.create({ data: {
              id: `GSNAP-${crypto.randomUUID()}`,
              organizationId: context.user.organizationId,
              caseId,
              operationId: reservation.operation.id,
              sourceType: 'SHEETS_RANGE',
              externalResourceId,
              sha256: data.sha256,
              provenanceJson: JSON.stringify({
                spreadsheetId,
                sheetName,
                rangeA1,
                allowedRange: source.allowedRange,
                rowCount: data.rowCount,
                columnCount: data.columnCount,
                providerSnapshotId: data.snapshotId,
                importedBy: context.user.id
              }),
              createdById: context.user.id
            } });
            const link = await tx.googleResourceLink.create({ data: {
              id: `GRLINK-${crypto.randomUUID()}`,
              organizationId: context.user.organizationId,
              caseId,
              operationId: reservation.operation.id,
              entityType: 'SHEETS_RANGE',
              internalEntityId: snapshot.id,
              externalResourceId,
              resourceMetadataJson: JSON.stringify({ snapshotId: snapshot.id, providerSnapshotId: data.snapshotId, rowCount: data.rowCount, columnCount: data.columnCount })
            } });
            const resultBody = { snapshot, resourceLink: link, valuesJson: data.valuesJson, caseVersion };
            await tx.googleSyncOperation.update({ where: { id: reservation.operation.id }, data: {
              status: 'SUCCESS', resultJson: JSON.stringify({ httpStatus: 201, body: resultBody }), completedAt: new Date()
            } });
            await tx.auditLog.create({ data: requestAudit(context, 'GOOGLE_SHEETS_IMPORTED', 'GoogleImportSnapshot', snapshot.id, {
              caseId, operationId: reservation.operation.id, spreadsheetId, sheetName, rangeA1
            }) });
            return resultBody;
          });
          sendJson(res, 201, result);
          return;
        } catch (error) { await deletePendingGoogleOperation(reservation.operation.id); throw error; }
      }

      throw new HttpError(404, 'Endpoint not found');
    })().catch((error: unknown) => {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message, ...error.details });
        return;
      }
      console.error('API request failed', {
        kind: error instanceof Error ? error.name : typeof error
      });
      sendJson(res, 500, { error: 'Internal server error' });
    });
  }) as ManagedApiServer;

  let databaseClose = Promise.resolve();
  server.on('close', () => {
    for (const controller of inFlightAiRequests.values()) controller.abort();
    inFlightAiRequests.clear();
    databaseClose = db.$disconnect();
  });
  server.waitForDatabaseClose = () => databaseClose;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3001);
  const host = process.env.HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
  createApiServerFromEnvironment().listen(port, host, () => {
    console.log('API server listening on ' + host + ':' + port);
  });
}
