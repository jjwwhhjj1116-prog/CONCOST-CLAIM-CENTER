import * as crypto from 'node:crypto';
import type * as http from 'node:http';
import { hashPassword, verifyPassword, type PrismaClient } from '@claim-studio/database';
import { ES_ECOS_KEY, fetchEsEcosSources } from '../../../../packages/document-engine/src/es-ecos';

export interface ServerSettingsContext {
  user: { id: string; email: string; name: string; organizationId: string };
  roles: string[];
  tokenHash: string;
}

export interface ServerSettingsAdapterOptions {
  pathname: string;
  method: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  db: PrismaClient;
  context: ServerSettingsContext;
  masterKey: Buffer | null;
  fetcher?: typeof fetch;
}

interface SettingRow {
  valueJson: string;
  secretCiphertext: string | null;
  secretIv: string | null;
  secretTag: string | null;
  version: number;
  updatedAt: string;
}

class AdapterError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const PROVIDERS = [
  { providerKind: 'GEMINI', label: 'Google · Gemini' },
  { providerKind: 'OPENAI', label: 'OpenAI · ChatGPT' },
  { providerKind: 'ANTHROPIC', label: 'Anthropic · Claude' }
] as const;
const TUTORIAL_VERSION = 'CF79_V1';

function json(response: http.ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(status === 204 ? undefined : JSON.stringify(body));
}

async function readBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 256 * 1024) throw new AdapterError(413, 'Request body is too large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    return parsed as Record<string, unknown>;
  } catch {
    throw new AdapterError(400, 'Invalid JSON body');
  }
}

function requireAdmin(context: ServerSettingsContext): void {
  if (!context.roles.includes('admin')) throw new AdapterError(403, 'Administrator role is required');
}

function expectedVersion(body: Record<string, unknown>): number {
  const value = Number(body.expectedVersion);
  if (!Number.isSafeInteger(value) || value < 0) throw new AdapterError(400, 'expectedVersion must be a non-negative integer');
  return value;
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

async function setting(
  db: PrismaClient, organizationId: string, ownerId: string, settingKey: string
): Promise<SettingRow | null> {
  const rows = await db.$queryRawUnsafe<SettingRow[]>(
    'SELECT "valueJson", "secretCiphertext", "secretIv", "secretTag", "version", "updatedAt" FROM "ServerSetting" WHERE "organizationId"=? AND "ownerId"=? AND "settingKey"=?',
    organizationId, ownerId, settingKey
  );
  return rows[0] ?? null;
}

async function saveSetting(options: {
  db: PrismaClient; context: ServerSettingsContext; ownerId: string; settingKey: string;
  value: Record<string, unknown>; expectedVersion: number;
  secret?: { ciphertext: string; iv: string; tag: string } | null;
}): Promise<SettingRow> {
  const { db, context, ownerId, settingKey, value, expectedVersion: version } = options;
  const now = new Date().toISOString();
  const secret = options.secret === undefined ? undefined : options.secret;
  let changed = 0;
  if (version === 0) {
    changed = await db.$executeRawUnsafe(
      'INSERT OR IGNORE INTO "ServerSetting" ("organizationId","ownerId","settingKey","valueJson","secretCiphertext","secretIv","secretTag","version","updatedById","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      context.user.organizationId, ownerId, settingKey, JSON.stringify(value), secret?.ciphertext ?? null,
      secret?.iv ?? null, secret?.tag ?? null, 1, context.user.id, now, now
    );
  } else {
    const current = await setting(db, context.user.organizationId, ownerId, settingKey);
    const nextCiphertext = secret === undefined ? current?.secretCiphertext ?? null : secret?.ciphertext ?? null;
    const nextIv = secret === undefined ? current?.secretIv ?? null : secret?.iv ?? null;
    const nextTag = secret === undefined ? current?.secretTag ?? null : secret?.tag ?? null;
    changed = await db.$executeRawUnsafe(
      'UPDATE "ServerSetting" SET "valueJson"=?,"secretCiphertext"=?,"secretIv"=?,"secretTag"=?,"version"=?,"updatedById"=?,"updatedAt"=? WHERE "organizationId"=? AND "ownerId"=? AND "settingKey"=? AND "version"=?',
      JSON.stringify(value), nextCiphertext, nextIv, nextTag, version + 1, context.user.id, now,
      context.user.organizationId, ownerId, settingKey, version
    );
  }
  if (changed !== 1) throw new AdapterError(409, 'Settings changed in another session; reload before saving');
  const stored = await setting(db, context.user.organizationId, ownerId, settingKey);
  if (!stored) throw new AdapterError(500, 'Stored settings could not be reloaded');
  await db.auditLog.create({ data: {
    id: `AUD-${crypto.randomUUID()}`,
    organizationId: context.user.organizationId,
    userId: context.user.id,
    action: 'SERVER_SETTING_UPDATED', targetEntity: 'ServerSetting',
    targetId: `${ownerId}:${settingKey}`,
    metadataJson: JSON.stringify({ settingKey, ownerId, version: stored.version })
  } });
  return stored;
}

function encryptSecret(masterKey: Buffer | null, aad: string, value: string): { ciphertext: string; iv: string; tag: string } {
  if (!masterKey || masterKey.length !== 32) throw new AdapterError(503, 'Server settings encryption key is not configured');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64url'), iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
}

function decryptSecret(masterKey: Buffer | null, aad: string, row: SettingRow): string {
  if (!masterKey || !row.secretCiphertext || !row.secretIv || !row.secretTag) throw new AdapterError(400, 'Encrypted secret is not configured');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, Buffer.from(row.secretIv, 'base64url'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(row.secretTag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(row.secretCiphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch { throw new AdapterError(500, 'Encrypted setting could not be decrypted'); }
}

function credentialOwner(context: ServerSettingsContext, scope: string): string {
  return scope === 'USER' ? `USER:${context.user.id}` : `ORGANIZATION:${context.user.organizationId}`;
}

function credentialAad(context: ServerSettingsContext, ownerId: string, providerKind: string): string {
  return `${context.user.organizationId}\u0000${ownerId}\u0000AI_CREDENTIAL:${providerKind}`;
}

function credentialProjection(row: SettingRow | null, masterKeyReady: boolean): Record<string, unknown> {
  const value = row ? parseObject(row.valueJson) : {};
  const configured = Boolean(masterKeyReady && row?.secretCiphertext && row.secretIv && row.secretTag);
  return {
    configured,
    storage: configured ? 'ENCRYPTED_D1' : 'NONE',
    version: row?.version ?? 0,
    updatedAt: row?.updatedAt ?? null,
    fingerprint: configured && typeof value.fingerprint === 'string' ? value.fingerprint : null
  };
}

async function verifyProviderCredential(
  providerKind: 'GEMINI' | 'OPENAI' | 'ANTHROPIC',
  apiKey: string,
  fetcher: typeof fetch = fetch
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let url: string;
  let headers: Record<string, string> = { Accept: 'application/json' };
  if (providerKind === 'GEMINI') {
    url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  } else if (providerKind === 'OPENAI') {
    url = 'https://api.openai.com/v1/models';
    headers = { ...headers, Authorization: `Bearer ${apiKey}` };
  } else {
    url = 'https://api.anthropic.com/v1/models?limit=1';
    headers = { ...headers, 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  }
  try {
    const result = await fetcher(url, { method: 'GET', headers, redirect: 'manual', signal: controller.signal });
    if (!result.ok) throw new AdapterError(502, `${providerKind} rejected the configured credential`);
    return { source: `LIVE_${providerKind}`, checkedAt: new Date().toISOString() };
  } catch (error) {
    if (error instanceof AdapterError) throw error;
    if (controller.signal.aborted) throw new AdapterError(504, `${providerKind} credential verification timed out`);
    throw new AdapterError(502, `${providerKind} credential verification could not reach the provider`);
  } finally {
    clearTimeout(timeout);
  }
}

async function credentialsPayload(db: PrismaClient, context: ServerSettingsContext, masterKey: Buffer | null): Promise<Record<string, unknown>> {
  const personalOwner = credentialOwner(context, 'USER');
  const organizationOwner = credentialOwner(context, 'ORGANIZATION');
  const providers = await Promise.all(PROVIDERS.map(async (provider) => ({
    ...provider,
    personal: credentialProjection(await setting(db, context.user.organizationId, personalOwner, `AI_CREDENTIAL:${provider.providerKind}`), Boolean(masterKey)),
    organization: credentialProjection(await setting(db, context.user.organizationId, organizationOwner, `AI_CREDENTIAL:${provider.providerKind}`), Boolean(masterKey))
  })));
  return { personalPriority: true, masterKeyReady: Boolean(masterKey), canManageOrganization: context.roles.includes('admin'), providers };
}

function workspaceProjection(row: SettingRow | null): { settings: Record<string, unknown>; runtime: Record<string, unknown> } {
  const value = row ? parseObject(row.valueJson) : {};
  const settings = {
    organizationName: typeof value.organizationName === 'string' ? value.organizationName : 'CONCOST Claim Center',
    localAiMode: value.localAiMode === 'PRIVATE_SERVER_BRIDGE' ? 'PRIVATE_SERVER_BRIDGE' : 'DISABLED',
    memoryProvider: value.memoryProvider === 'HERMES_AGENT' ? 'HERMES_AGENT' : 'NONE',
    memoryApprovalMode: value.memoryApprovalMode === 'ADMIN_REVIEW' ? 'ADMIN_REVIEW' : 'DISABLED',
    shortTermMemoryEnabled: value.shortTermMemoryEnabled === true,
    longTermMemoryEnabled: value.longTermMemoryEnabled === true,
    version: row?.version ?? 0,
    updatedAt: row?.updatedAt ?? null
  };
  return { settings, runtime: {
    localAi: settings.localAiMode === 'PRIVATE_SERVER_BRIDGE' ? 'SERVER_BRIDGE_REQUIRED' : 'DISABLED',
    hermes: settings.memoryProvider === 'HERMES_AGENT' ? 'SQLITE_HERMES_COMPATIBLE_V1' : 'DISABLED',
    memoryLearning: settings.memoryApprovalMode === 'ADMIN_REVIEW' ? 'ADMIN_APPROVAL_REQUIRED' : 'DISABLED',
    supportedLocalProviders: ['OLLAMA', 'LM_STUDIO']
  } };
}

async function handle(options: ServerSettingsAdapterOptions): Promise<boolean> {
  const { pathname, method, request, response, db, context, masterKey } = options;
  const organizationOwner = `ORGANIZATION:${context.user.organizationId}`;

  if (pathname === '/api/settings/ecos' || pathname === '/api/settings/ecos/test' || pathname === '/api/es/sources/ecos') {
    response.setHeader('Cache-Control', 'no-store');
    const source = pathname === '/api/es/sources/ecos';
    if (source) {
      if (!context.roles.some(role => ['ceo', 'director', 'pm', 'staff', 'reviewer', 'admin'].includes(role))) throw new AdapterError(403, 'ES 접근 권한이 없습니다.');
    } else requireAdmin(context);
    const settingKey = 'ECOS_API_KEY', aad = `${context.user.organizationId}\u0000${organizationOwner}\u0000${settingKey}`;
    const current = await setting(db, context.user.organizationId, organizationOwner, settingKey);
    const projection = (row: SettingRow | null) => ({ configured: Boolean(masterKey && row?.secretCiphertext), storage: row ? 'ENCRYPTED_SERVER' : 'NONE', version: row?.version ?? 0, updatedAt: row?.updatedAt ?? null, masterKeyReady: Boolean(masterKey?.length === 32) });
    if (!source && pathname === '/api/settings/ecos' && method === 'GET') { json(response, 200, { settings: projection(current) }); return true; }
    if (source && method !== 'GET') throw new AdapterError(405, '지원하지 않는 요청입니다.');
    const testing = pathname === '/api/settings/ecos/test' && method === 'POST';
    if (!source && !testing && !(pathname === '/api/settings/ecos' && method === 'PUT')) throw new AdapterError(405, '지원하지 않는 요청입니다.');
    let body: Record<string, unknown> = {};
    if (!source) {
      // server.ts enforces configured trusted origins and cookie CSRF before this adapter.
      // Do not compare the browser host with the API host: Node supports a separate trusted web origin.
      if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw new AdapterError(415, 'JSON 요청이 필요합니다.');
      body = await readBody(request);
      const keys = testing ? ['expectedVersion'] : ['apiKey', 'expectedVersion'];
      if (Object.keys(body).some(key => !keys.includes(key)) || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0 || (!testing && (typeof body.apiKey !== 'string' || !ES_ECOS_KEY.test(body.apiKey.trim())))) throw new AdapterError(400, 'ECOS 인증키와 최신 설정 버전을 확인하세요.');
      if (body.expectedVersion !== (current?.version ?? 0)) throw new AdapterError(409, '설정이 변경되었습니다. 다시 불러오세요.');
    }
    if (source || testing) {
      if (!current) throw new AdapterError(503, '관리자 설정 → 한국은행 ECOS에서 인증키를 먼저 저장하세요.');
      let result;
      try { result = await fetchEsEcosSources(decryptSecret(masterKey, aad, current), source ? new URL(request.url ?? pathname, 'http://localhost').searchParams.getAll('date') : ['2024-06-15'], options.fetcher ?? fetch); }
      catch (error) { throw new AdapterError(error instanceof Error && error.message === 'ES_SOURCE_INVALID_DATE' ? 400 : 503, 'ECOS 인증 설정과 조회 기준일을 확인하세요. 기존값은 유지됩니다.'); }
      if (source) { json(response, 200, result); return true; }
      if (result.items.length !== 1) throw new AdapterError(502, '공식 ECOS 응답을 확인하지 못했습니다. 인증키·이용 승인·호출 제한을 확인하세요.');
      const latest = await setting(db, context.user.organizationId, organizationOwner, settingKey);
      if (latest?.version !== body.expectedVersion) throw new AdapterError(409, '연결 확인 중 설정이 변경되었습니다. 다시 불러오세요.');
      json(response, 200, { settings: projection(latest), checkedAt: result.items[0].checkedAt, month: result.items[0].month, count: 4 }); return true;
    }
    const saved = await saveSetting({ db, context, ownerId: organizationOwner, settingKey, value: {}, expectedVersion: Number(body.expectedVersion), secret: encryptSecret(masterKey, aad, (body.apiKey as string).trim()) });
    json(response, 200, { settings: projection(saved) }); return true;
  }

  if (pathname === '/api/settings/ai-credentials' && method === 'GET') {
    json(response, 200, await credentialsPayload(db, context, masterKey)); return true;
  }
  const credentialMatch = pathname.match(/^\/api\/settings\/ai-credentials\/(GEMINI|OPENAI|ANTHROPIC)(\/test)?$/u);
  if (credentialMatch) {
    const providerKind = credentialMatch[1] as 'GEMINI' | 'OPENAI' | 'ANTHROPIC';
    const body = await readBody(request);
    const scope = body.scope === 'ORGANIZATION' ? 'ORGANIZATION' : body.scope === 'USER' ? 'USER' : '';
    if (!scope) throw new AdapterError(400, 'Credential scope is invalid');
    if (scope === 'ORGANIZATION') requireAdmin(context);
    if (scope === 'USER' && providerKind !== 'GEMINI') throw new AdapterError(400, 'Only Gemini supports personal credentials');
    const ownerId = credentialOwner(context, scope);
    const settingKey = `AI_CREDENTIAL:${providerKind}`;
    if (credentialMatch[2] === '/test' && method === 'POST') {
      const row = await setting(db, context.user.organizationId, ownerId, settingKey);
      if (!row) throw new AdapterError(400, 'Credential is not configured');
      const apiKey = decryptSecret(masterKey, credentialAad(context, ownerId, providerKind), row);
      json(response, 200, await verifyProviderCredential(providerKind, apiKey, options.fetcher)); return true;
    }
    if (method === 'PUT') {
      const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
      if (apiKey.length < 12 || apiKey.length > 512) throw new AdapterError(400, 'API key format is invalid');
      const fingerprint = crypto.createHash('sha256').update(apiKey, 'utf8').digest('hex').slice(0, 12);
      await saveSetting({ db, context, ownerId, settingKey, value: { fingerprint }, expectedVersion: expectedVersion(body), secret: encryptSecret(masterKey, credentialAad(context, ownerId, providerKind), apiKey) });
      json(response, 200, await credentialsPayload(db, context, masterKey)); return true;
    }
    if (method === 'DELETE') {
      await saveSetting({ db, context, ownerId, settingKey, value: {}, expectedVersion: expectedVersion(body), secret: null });
      json(response, 200, await credentialsPayload(db, context, masterKey)); return true;
    }
    throw new AdapterError(405, 'Method is not allowed');
  }

  if (pathname === '/api/settings/admin-workspace') {
    requireAdmin(context);
    const row = await setting(db, context.user.organizationId, organizationOwner, 'ADMIN_WORKSPACE');
    if (method === 'GET') { json(response, 200, workspaceProjection(row)); return true; }
    if (method === 'PUT') {
      const body = await readBody(request);
      const value = {
        organizationName: typeof body.organizationName === 'string' ? body.organizationName.trim().slice(0, 120) : '',
        localAiMode: body.localAiMode === 'PRIVATE_SERVER_BRIDGE' ? 'PRIVATE_SERVER_BRIDGE' : 'DISABLED',
        memoryProvider: body.memoryProvider === 'HERMES_AGENT' ? 'HERMES_AGENT' : 'NONE',
        memoryApprovalMode: body.memoryApprovalMode === 'ADMIN_REVIEW' ? 'ADMIN_REVIEW' : 'DISABLED',
        shortTermMemoryEnabled: body.shortTermMemoryEnabled === true,
        longTermMemoryEnabled: body.longTermMemoryEnabled === true
      };
      const stored = await saveSetting({ db, context, ownerId: organizationOwner, settingKey: 'ADMIN_WORKSPACE', value, expectedVersion: expectedVersion(body) });
      json(response, 200, workspaceProjection(stored)); return true;
    }
    throw new AdapterError(405, 'Method is not allowed');
  }

  if (pathname === '/api/settings/ai-governance') {
    requireAdmin(context);
    const row = await setting(db, context.user.organizationId, organizationOwner, 'AI_GOVERNANCE');
    if (method === 'GET') {
      const value = row ? parseObject(row.valueJson) : {};
      json(response, 200, { governance: {
        providerKind: 'GEMINI',
        providerServiceTier: typeof value.providerServiceTier === 'string' ? value.providerServiceTier : 'UNVERIFIED_OR_FREE',
        confidentialExternalAiEnabled: value.confidentialExternalAiEnabled === true,
        minimizePersonalData: true,
        providerTermsUrl: 'https://ai.google.dev/gemini-api/terms',
        version: row?.version ?? 0, updatedAt: row?.updatedAt ?? null
      } }); return true;
    }
    if (method === 'PUT') {
      const body = await readBody(request);
      const tiers = new Set(['UNVERIFIED_OR_FREE', 'PAID_NO_PRODUCT_IMPROVEMENT', 'VERTEX_AI_ENTERPRISE']);
      const tier = typeof body.providerServiceTier === 'string' && tiers.has(body.providerServiceTier) ? body.providerServiceTier : 'UNVERIFIED_OR_FREE';
      if (body.confidentialExternalAiEnabled === true && String(body.acknowledgement ?? '').trim().length < 10) throw new AdapterError(400, 'Policy acknowledgement is required');
      const stored = await saveSetting({ db, context, ownerId: organizationOwner, settingKey: 'AI_GOVERNANCE', value: { providerServiceTier: tier, confidentialExternalAiEnabled: body.confidentialExternalAiEnabled === true }, expectedVersion: expectedVersion(body) });
      const value = parseObject(stored.valueJson);
      json(response, 200, { governance: { providerKind: 'GEMINI', ...value, minimizePersonalData: true, providerTermsUrl: 'https://ai.google.dev/gemini-api/terms', version: stored.version, updatedAt: stored.updatedAt } }); return true;
    }
    throw new AdapterError(405, 'Method is not allowed');
  }

  if (pathname === '/api/settings/hermes-bridge' || pathname === '/api/settings/hermes-bridge/test') {
    requireAdmin(context);
    const row = await setting(db, context.user.organizationId, organizationOwner, 'HERMES_BRIDGE');
    const projection = (current: SettingRow | null, status?: string) => {
      const value = current ? parseObject(current.valueJson) : {};
      return { configured: Boolean(current?.secretCiphertext), baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '', keyId: typeof value.keyId === 'string' ? value.keyId : 'claim-center-prod', version: current?.version ?? 0, updatedAt: current?.updatedAt ?? null, secretStored: Boolean(current?.secretCiphertext), status: status ?? (current?.secretCiphertext ? 'CONFIGURED_NOT_YET_TESTED' : 'NOT_CONFIGURED') };
    };
    if (pathname.endsWith('/test') && method === 'POST') {
      if (!row) throw new AdapterError(400, 'Hermes bridge is not configured');
      decryptSecret(masterKey, `${context.user.organizationId}\u0000${organizationOwner}\u0000HERMES_BRIDGE`, row);
      throw new AdapterError(501, 'Hermes bridge network verification requires the private-server health adapter');
    }
    if (method === 'GET') { json(response, 200, { bridge: projection(row) }); return true; }
    if (method === 'PUT') {
      const body = await readBody(request);
      const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
      const keyId = typeof body.keyId === 'string' ? body.keyId.trim() : '';
      const hmacKey = typeof body.hmacKey === 'string' ? body.hmacKey.trim() : '';
      let parsed: URL;
      try { parsed = new URL(baseUrl); } catch { throw new AdapterError(400, 'Hermes bridge URL is invalid'); }
      if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') throw new AdapterError(400, 'Hermes bridge requires HTTPS');
      if (!/^[A-Za-z0-9._:-]{3,120}$/u.test(keyId) || hmacKey.length < 16) throw new AdapterError(400, 'Hermes bridge key settings are invalid');
      const stored = await saveSetting({ db, context, ownerId: organizationOwner, settingKey: 'HERMES_BRIDGE', value: { baseUrl: parsed.origin, keyId }, expectedVersion: expectedVersion(body), secret: encryptSecret(masterKey, `${context.user.organizationId}\u0000${organizationOwner}\u0000HERMES_BRIDGE`, hmacKey) });
      json(response, 200, { bridge: projection(stored) }); return true;
    }
    throw new AdapterError(405, 'Method is not allowed');
  }

  if (pathname === '/api/settings/preferences') {
    const ownerId = `USER:${context.user.id}`;
    const row = await setting(db, context.user.organizationId, ownerId, 'PREFERENCES');
    if (method === 'GET') {
      const value = row ? parseObject(row.valueJson) : {};
      json(response, 200, { preferences: { theme: value.theme ?? 'LIGHT', fontFamily: value.fontFamily ?? 'PRETENDARD', fontScale: value.fontScale ?? 100, density: value.density ?? 'COMFORTABLE', reduceMotion: value.reduceMotion === true, version: row?.version ?? 0, updatedAt: row?.updatedAt ?? null }, phase: 'SERVER_SQLITE_SETTINGS' }); return true;
    }
    if (method === 'PUT') {
      const body = await readBody(request);
      const value = { theme: body.theme === 'DARK' ? 'DARK' : 'LIGHT', fontFamily: typeof body.fontFamily === 'string' ? body.fontFamily.slice(0, 60) : 'PRETENDARD', fontScale: Math.min(140, Math.max(80, Number(body.fontScale) || 100)), density: body.density === 'COMPACT' ? 'COMPACT' : 'COMFORTABLE', reduceMotion: body.reduceMotion === true };
      const stored = await saveSetting({ db, context, ownerId, settingKey: 'PREFERENCES', value, expectedVersion: expectedVersion(body) });
      json(response, 200, { preferences: { ...value, version: stored.version, updatedAt: stored.updatedAt }, phase: 'SERVER_SQLITE_SETTINGS' }); return true;
    }
    throw new AdapterError(405, 'Method is not allowed');
  }

  if (pathname === '/api/settings/tutorial') {
    const ownerId = `USER:${context.user.id}`;
    const row = await setting(db, context.user.organizationId, ownerId, 'TUTORIAL');
    const project = (current: SettingRow | null) => {
      const value = current ? parseObject(current.valueJson) : {};
      return { completedTutorialVersion: value.completedTutorialVersion ?? null, completedAt: value.completedAt ?? null, completionAction: value.completionAction ?? null, version: current?.version ?? 0, updatedAt: current?.updatedAt ?? null };
    };
    if (method === 'GET') { json(response, 200, { tutorial: project(row), currentTutorialVersion: TUTORIAL_VERSION, phase: 'SERVER_SQLITE_SETTINGS' }); return true; }
    if (method === 'PUT') {
      const body = await readBody(request);
      const action = body.action === 'SKIPPED' ? 'SKIPPED' : 'COMPLETED';
      const completedAt = new Date().toISOString();
      const stored = await saveSetting({ db, context, ownerId, settingKey: 'TUTORIAL', value: { completedTutorialVersion: String(body.tutorialVersion || TUTORIAL_VERSION), completedAt, completionAction: action }, expectedVersion: expectedVersion(body) });
      json(response, 200, { tutorial: project(stored), currentTutorialVersion: TUTORIAL_VERSION, phase: 'SERVER_SQLITE_SETTINGS' }); return true;
    }
    throw new AdapterError(405, 'Method is not allowed');
  }

  if (pathname === '/api/settings/password' && method === 'PUT') {
    const body = await readBody(request);
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    const user = await db.user.findUnique({ where: { id: context.user.id } });
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) throw new AdapterError(400, 'Current password does not match');
    if (newPassword.length < 8 || newPassword.length > 128) throw new AdapterError(400, 'New password must be 8 to 128 characters');
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(newPassword) } });
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null, tokenHash: { not: context.tokenHash } }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { id: `AUD-${crypto.randomUUID()}`, organizationId: context.user.organizationId, userId: user.id, action: 'PASSWORD_CHANGED', targetEntity: 'User', targetId: user.id, metadataJson: '{}' } });
    });
    json(response, 200, { success: true, message: 'Password changed' }); return true;
  }

  if (pathname === '/api/admin/users' && method === 'GET') {
    requireAdmin(context);
    const users = await db.user.findMany({ where: { organizationId: context.user.organizationId }, include: { roles: { include: { role: true } }, assignments: true }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
    json(response, 200, { users: users.map((user) => ({ id: user.id, loginId: user.email.split('@')[0], displayName: user.name, email: user.email, roles: user.roles.map((item) => item.role.id), active: user.isActive, version: 1, assignedCaseCount: user.assignments.length })), phase: 'SERVER_SQLITE_ADMIN_ACCOUNTS' }); return true;
  }

  if (pathname === '/api/admin/report-memory' && method === 'GET') {
    requireAdmin(context); json(response, 200, { candidates: [], phase: 'SERVER_MEMORY_NOT_IMPORTED' }); return true;
  }
  if (pathname === '/api/proposal-studio/config' && method === 'GET') {
    json(response, 200, { modules: [], sources: [], assets: [], promptProfiles: [], phase: 'SERVER_PROPOSAL_CONFIG_NOT_IMPORTED' }); return true;
  }
  return false;
}

export async function handleServerSettingsRequest(options: ServerSettingsAdapterOptions): Promise<boolean> {
  try { return await handle(options); }
  catch (error) {
    if (error instanceof AdapterError) { json(options.response, error.status, { error: error.message }); return true; }
    throw error;
  }
}
