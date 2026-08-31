import * as crypto from 'node:crypto';
import type {
  CalendarEventInput,
  CalendarEventResult,
  DocsExportResult,
  DriveFolderResult,
  GmailAttachmentCandidate,
  GmailImportResult,
  GoogleAdapterMode,
  GoogleAdapterResponse,
  GoogleWorkspaceAdapter,
  GoogleWorkspaceConnectionInfo,
  SheetSourceCandidate,
  SheetsImportInput,
  SheetsImportResult
} from './GoogleWorkspaceAdapter';
import { ALLOWED_REDIRECT_DOMAINS, REQUIRED_GOOGLE_SCOPES } from './GoogleWorkspaceAdapter';
import type { GoogleCredentialProvider, GoogleOAuthCredential } from './GoogleCredentialProvider';

const GOOGLE_ENDPOINT_HOSTS = new Set([
  'oauth2.googleapis.com',
  'www.googleapis.com',
  'drive.googleapis.com',
  'gmail.googleapis.com',
  'calendar.googleapis.com',
  'docs.googleapis.com',
  'sheets.googleapis.com'
]);

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECT_HOPS = 3;
const MAX_PROVIDER_BODY_BYTES = 30 * 1024 * 1024;
const MAX_GMAIL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface GoogleHttpRequest {
  url: string;
  method: 'GET' | 'POST' | 'PATCH';
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface GoogleHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type GoogleHttpTransport = (request: GoogleHttpRequest) => Promise<GoogleHttpResponse>;

export interface GoogleWorkspaceRealAdapterOptions {
  credentialProvider: GoogleCredentialProvider;
  organizationId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowedRedirectOrigins?: readonly string[];
  defaultSecretRef?: string;
  transport?: GoogleHttpTransport;
  now?: () => Date;
}

class ProviderFailure extends Error {
  public constructor(
    public readonly responseClass: GoogleAdapterMode,
    public readonly retryAfterSeconds?: number
  ) {
    super('Google provider request failed');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, maximum = 2_000): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string, maximum = 2_000): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
  }
  return value;
}

function requiredInteger(record: Record<string, unknown>, key: string, minimum: number, maximum: number): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
  }
  return Number(value);
}

function parseJson(body: string): Record<string, unknown> {
  if (Buffer.byteLength(body, 'utf8') > MAX_PROVIDER_BODY_BYTES) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
  try {
    const parsed: unknown = JSON.parse(body);
    if (!isRecord(parsed)) throw new Error('not an object');
    return parsed;
  } catch (error) {
    if (error instanceof ProviderFailure) throw error;
    throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
  }
}

function normalizedHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => { result[key.toLowerCase()] = value; });
  return result;
}

export const fetchGoogleTransport: GoogleHttpTransport = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
    redirect: 'manual'
  });
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_PROVIDER_BODY_BYTES) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
  return { status: response.status, headers: normalizedHeaders(response.headers), body };
};

function assertGoogleEndpoint(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
  }
  if (
    url.protocol !== 'https:'
    || url.port
    || url.username
    || url.password
    || !GOOGLE_ENDPOINT_HOSTS.has(url.hostname)
  ) {
    throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
  }
  return url;
}

function classifyStatus(status: number, body: string, headers: Record<string, string>): ProviderFailure {
  if (status === 401) return new ProviderFailure('TOKEN_EXPIRED');
  if (status === 403) return new ProviderFailure('BAD_SCOPE');
  if (status === 429) {
    const retryAfter = Number(headers['retry-after']);
    return new ProviderFailure(
      'RATE_LIMIT_RETRY_AFTER',
      Number.isFinite(retryAfter) ? Math.max(0, Math.min(30, Math.ceil(retryAfter))) : undefined
    );
  }
  if (status >= 500) return new ProviderFailure('SERVER_ERROR');
  if (status >= 400 && body.includes('invalid_grant')) return new ProviderFailure('RECONSENT_REQUIRED');
  return new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
}

function safeErrorMessage(responseClass: GoogleAdapterMode): string {
  const messages: Partial<Record<GoogleAdapterMode, string>> = {
    BAD_SCOPE: 'Google Workspace permission is insufficient',
    TOKEN_EXPIRED: 'Google Workspace access token expired',
    RECONSENT_REQUIRED: 'Google Workspace consent must be renewed',
    RATE_LIMIT_RETRY_AFTER: 'Google Workspace rate limit was reached',
    SERVER_ERROR: 'Google Workspace service is temporarily unavailable',
    TIMEOUT: 'Google Workspace request timed out',
    USER_CANCEL: 'Google Workspace request was cancelled',
    MALFORMED_PROVIDER_RESPONSE: 'Google Workspace returned an invalid response',
    REVOKE_FAILURE: 'Google Workspace credential revocation failed'
  };
  return messages[responseClass] ?? 'Google Workspace request failed';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Google provider request was aborted');
  error.name = 'AbortError';
  throw error;
}

function sha256(value: Buffer | string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseScopes(scopeText: string | undefined): string[] {
  if (!scopeText) return [];
  return [...new Set(scopeText.split(/\s+/).filter(Boolean))].sort();
}

function exactRequiredScopes(scopes: string[]): boolean {
  return JSON.stringify([...scopes].sort()) === JSON.stringify([...REQUIRED_GOOGLE_SCOPES].sort());
}

function validateResourceId(value: string): string {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(value)) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
  return value;
}

function validateDisplayText(value: string, maximum: number): string {
  if (!value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
  return value;
}

function columnNumber(letters: string): number {
  return letters.split('').reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
}

function parseA1Rectangle(value: string): { startColumn: number; startRow: number; endColumn: number; endRow: number } {
  const match = value.match(/^([A-Z]{1,3})([1-9][0-9]{0,5}):([A-Z]{1,3})([1-9][0-9]{0,5})$/);
  if (!match) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
  const rectangle = {
    startColumn: columnNumber(match[1]),
    startRow: Number(match[2]),
    endColumn: columnNumber(match[3]),
    endRow: Number(match[4])
  };
  if (rectangle.startColumn > rectangle.endColumn || rectangle.startRow > rectangle.endRow) {
    throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
  }
  return rectangle;
}

function parseProviderSheetRange(value: string): { sheetName: string; rectangle: ReturnType<typeof parseA1Rectangle> } {
  const bang = value.lastIndexOf('!');
  if (bang < 1) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
  const rawName = value.slice(0, bang);
  const sheetName = rawName.startsWith("'") && rawName.endsWith("'")
    ? rawName.slice(1, -1).replace(/''/g, "'")
    : rawName;
  return { sheetName, rectangle: parseA1Rectangle(value.slice(bang + 1)) };
}

function validateRedirectUri(raw: string, configuredOrigins?: readonly string[]): string {
  const url = new URL(raw);
  const localHttp = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  const allowedOrigins = new Set(configuredOrigins ?? [
    'https://claim-center.invalid',
    'http://localhost',
    'http://127.0.0.1'
  ]);
  for (const origin of allowedOrigins) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('Google OAuth redirect origin allowlist is invalid');
    }
  }
  if (
    (!localHttp && url.protocol !== 'https:')
    || !ALLOWED_REDIRECT_DOMAINS.has(url.hostname) && configuredOrigins === undefined
    || !allowedOrigins.has(url.origin)
    || url.username
    || url.password
    || url.hash
    || url.search
  ) {
    throw new Error('Google OAuth redirect URI is not allowed');
  }
  return url.toString();
}

export class GoogleWorkspaceRealAdapter implements GoogleWorkspaceAdapter {
  #credentialProvider: GoogleCredentialProvider;
  #organizationId: string;
  #clientId: string;
  #clientSecret: string;
  #redirectUri: string;
  #transport: GoogleHttpTransport;
  #now: () => Date;
  #activeSecretRef?: string;

  public constructor(options: GoogleWorkspaceRealAdapterOptions) {
    if (!options.clientId || !options.clientSecret) throw new Error('Google OAuth client configuration is incomplete');
    if (!/^[A-Za-z0-9._:-]{1,200}$/.test(options.organizationId)) throw new Error('Google Workspace organization is invalid');
    this.#credentialProvider = options.credentialProvider;
    this.#organizationId = options.organizationId;
    this.#clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.#redirectUri = validateRedirectUri(options.redirectUri, options.allowedRedirectOrigins);
    this.#transport = options.transport ?? fetchGoogleTransport;
    this.#now = options.now ?? (() => new Date());
    this.#activeSecretRef = options.defaultSecretRef;
  }

  public useCredential(secretRef: string): void {
    if (!/^SECREF_GOOGLE_[A-Z0-9_-]{16,120}$/.test(secretRef)) throw new Error('Google credential reference is invalid');
    this.#activeSecretRef = secretRef;
  }

  public async discardCredentialReference(secretRef: string): Promise<void> {
    if (!/^SECREF_GOOGLE_[A-Z0-9_-]{16,120}$/.test(secretRef)) return;
    await this.#credentialProvider.deleteCredential(this.#organizationId, secretRef);
    if (this.#activeSecretRef === secretRef) this.#activeSecretRef = undefined;
  }

  public async getCredentialMetadata(secretRef: string): Promise<{ expiresAt: Date; grantedScopes: string[] } | null> {
    if (!/^SECREF_GOOGLE_[A-Z0-9_-]{16,120}$/.test(secretRef)) return null;
    const credential = await this.#credentialProvider.resolveCredential(this.#organizationId, secretRef);
    return credential ? {
      expiresAt: new Date(credential.expiresAt.getTime()),
      grantedScopes: [...credential.grantedScopes]
    } : null;
  }

  public createAuthorizationUrl(input: { state: string; codeChallenge: string; scopes: readonly string[] }): string {
    if (!input.state || input.state.length > 512 || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeChallenge)) {
      throw new Error('Google OAuth authorization parameters are invalid');
    }
    if (JSON.stringify([...input.scopes].sort()) !== JSON.stringify([...REQUIRED_GOOGLE_SCOPES].sort())) {
      throw new Error('Google OAuth scopes do not match the approved least-privilege set');
    }
    const query = new URLSearchParams({
      client_id: this.#clientId,
      redirect_uri: this.#redirectUri,
      response_type: 'code',
      access_type: 'offline',
      include_granted_scopes: 'false',
      prompt: 'consent',
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
      scope: input.scopes.join(' ')
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
  }

  private async request(request: GoogleHttpRequest): Promise<GoogleHttpResponse> {
    let current = assertGoogleEndpoint(request.url);
    let method = request.method;
    let body = request.body;
    let headers = { ...request.headers };

    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
      const response = await this.#transport({
        url: current.toString(), method, headers, body, signal: request.signal
      });
      if (!REDIRECT_CODES.has(response.status)) return response;
      if (hop === MAX_REDIRECT_HOPS) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
      const location = response.headers.location ?? response.headers.Location;
      if (!location) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
      const next = assertGoogleEndpoint(new URL(location, current).toString());
      if (next.hostname !== current.hostname) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
      current = next;
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
        headers = Object.fromEntries(Object.entries(headers).filter(([key]) => key.toLowerCase() !== 'content-type'));
      }
    }
    throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
  }

  private async requestJson(request: GoogleHttpRequest): Promise<Record<string, unknown>> {
    const response = await this.request(request);
    if (response.status < 200 || response.status >= 300) throw classifyStatus(response.status, response.body, response.headers);
    return parseJson(response.body);
  }

  private async tokenRequest(parameters: URLSearchParams, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.requestJson({
      url: 'https://oauth2.googleapis.com/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: parameters.toString(),
      signal
    });
  }

  private async resolveCredential(signal?: AbortSignal): Promise<{ secretRef: string; credential: GoogleOAuthCredential }> {
    const secretRef = this.#activeSecretRef;
    if (!secretRef) throw new ProviderFailure('RECONSENT_REQUIRED');
    let credential = await this.#credentialProvider.resolveCredential(this.#organizationId, secretRef);
    if (!credential) throw new ProviderFailure('RECONSENT_REQUIRED');
    if (credential.expiresAt.getTime() <= this.#now().getTime() + 60_000) {
      const refreshed = await this.tokenRequest(new URLSearchParams({
        client_id: this.#clientId,
        client_secret: this.#clientSecret,
        refresh_token: credential.refreshToken,
        grant_type: 'refresh_token'
      }), signal);
      const accessToken = requiredString(refreshed, 'access_token', 8_192);
      const expiresIn = requiredInteger(refreshed, 'expires_in', 60, 86_400);
      const tokenType = optionalString(refreshed, 'token_type', 32) ?? 'Bearer';
      if (tokenType.toLowerCase() !== 'bearer') throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
      const refreshedScopes = parseScopes(optionalString(refreshed, 'scope', 8_192));
      const grantedScopes = refreshedScopes.length ? refreshedScopes : credential.grantedScopes;
      if (!exactRequiredScopes(grantedScopes)) throw new ProviderFailure('BAD_SCOPE');
      credential = {
        accessToken,
        refreshToken: optionalString(refreshed, 'refresh_token', 8_192) || credential.refreshToken,
        expiresAt: new Date(this.#now().getTime() + expiresIn * 1_000),
        grantedScopes,
        tokenType: 'Bearer'
      };
      await this.#credentialProvider.replaceCredential(this.#organizationId, secretRef, credential);
    }
    return { secretRef, credential };
  }

  private async authorizedJson(url: string, signal?: AbortSignal, method: 'GET' | 'POST' | 'PATCH' = 'GET', body?: unknown, extraHeaders: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const { credential } = await this.resolveCredential(signal);
    return this.requestJson({
      url,
      method,
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...extraHeaders
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal
    });
  }

  private async respond<T>(operation: () => Promise<T>): Promise<GoogleAdapterResponse<T>> {
    const startedAt = Date.now();
    try {
      return { responseClass: 'SUCCESS', data: await operation(), durationMs: Date.now() - startedAt };
    } catch (error) {
      let failure: ProviderFailure;
      if (error instanceof ProviderFailure) failure = error;
      else if (error instanceof Error && error.name === 'AbortError') failure = new ProviderFailure('USER_CANCEL');
      else failure = new ProviderFailure('SERVER_ERROR');
      return {
        responseClass: failure.responseClass,
        redactedError: safeErrorMessage(failure.responseClass),
        retryAfterSeconds: failure.retryAfterSeconds,
        durationMs: Date.now() - startedAt
      };
    }
  }

  public async exchangeAuthorizationCode(code: string, pkceVerifier: string, signal?: AbortSignal): Promise<GoogleAdapterResponse<{ grantedScopes: string[]; secretRef: string; expiresInSeconds: number }>> {
    return this.respond(async () => {
      if (!code || code.length > 4_096 || !/^[A-Za-z0-9._~-]{43,128}$/.test(pkceVerifier)) {
        throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
      }
      const token = await this.tokenRequest(new URLSearchParams({
        code,
        client_id: this.#clientId,
        client_secret: this.#clientSecret,
        redirect_uri: this.#redirectUri,
        code_verifier: pkceVerifier,
        grant_type: 'authorization_code'
      }), signal);
      const accessToken = requiredString(token, 'access_token', 8_192);
      const refreshToken = requiredString(token, 'refresh_token', 8_192);
      const expiresInSeconds = requiredInteger(token, 'expires_in', 60, 86_400);
      const tokenType = optionalString(token, 'token_type', 32) ?? 'Bearer';
      if (tokenType.toLowerCase() !== 'bearer') throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
      const grantedScopes = parseScopes(optionalString(token, 'scope', 8_192));
      if (!exactRequiredScopes(grantedScopes)) throw new ProviderFailure('BAD_SCOPE');
      // A transport supplied by an SDK may ignore AbortSignal and resolve after
      // the server timeout. Never mint a durable credential for that late result.
      throwIfAborted(signal);
      const secretRef = await this.#credentialProvider.createCredential(this.#organizationId, {
        accessToken,
        refreshToken,
        expiresAt: new Date(this.#now().getTime() + expiresInSeconds * 1_000),
        grantedScopes,
        tokenType: 'Bearer'
      });
      if (signal?.aborted) {
        await this.#credentialProvider.deleteCredential(this.#organizationId, secretRef);
        throwIfAborted(signal);
      }
      this.#activeSecretRef = secretRef;
      return { grantedScopes, secretRef, expiresInSeconds };
    });
  }

  public async testConnection(connection: GoogleWorkspaceConnectionInfo, signal?: AbortSignal): Promise<GoogleAdapterResponse<{ ok: boolean }>> {
    this.useCredential(connection.secretRef);
    return this.respond(async () => {
      await this.authorizedJson('https://www.googleapis.com/drive/v3/about?fields=user(permissionId)', signal);
      return { ok: true };
    });
  }

  public async listGmailAttachments(caseId: string, signal?: AbortSignal): Promise<GoogleAdapterResponse<GmailAttachmentCandidate[]>> {
    return this.respond(async () => {
      const query = new URLSearchParams({ q: `has:attachment "${caseId.replace(/["\\]/g, '')}"`, maxResults: '20' });
      const listing = await this.authorizedJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${query.toString()}`, signal);
      const messages = listing.messages;
      if (messages !== undefined && !Array.isArray(messages)) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
      const candidates: GmailAttachmentCandidate[] = [];
      for (const rawMessage of (messages ?? []).slice(0, 20)) {
        if (!isRecord(rawMessage)) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
        const messageId = validateResourceId(requiredString(rawMessage, 'id', 200));
        const message = await this.authorizedJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`, signal);
        this.collectGmailParts(messageId, message.payload, candidates);
        if (candidates.length > 100) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
      }
      return candidates;
    });
  }

  private collectGmailParts(messageId: string, rawPart: unknown, target: GmailAttachmentCandidate[]): void {
    if (!isRecord(rawPart)) return;
    const body = isRecord(rawPart.body) ? rawPart.body : {};
    const attachmentIdValue = body.attachmentId;
    const filenameValue = rawPart.filename;
    if (typeof attachmentIdValue === 'string' && typeof filenameValue === 'string' && filenameValue) {
      const attachmentId = validateResourceId(`${messageId}:${attachmentIdValue}`);
      const sizeBytes = requiredInteger(body, 'size', 1, MAX_GMAIL_ATTACHMENT_BYTES);
      target.push({
        attachmentId,
        filename: validateDisplayText(filenameValue, 240),
        mimeType: validateDisplayText(typeof rawPart.mimeType === 'string' ? rawPart.mimeType.toLowerCase() : 'application/octet-stream', 100),
        sizeBytes
      });
    }
    if (rawPart.parts !== undefined) {
      if (!Array.isArray(rawPart.parts)) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
      for (const nested of rawPart.parts) this.collectGmailParts(messageId, nested, target);
    }
  }

  public async importGmailAttachments(caseId: string, selectedAttachmentIds: string[], signal?: AbortSignal): Promise<GoogleAdapterResponse<GmailImportResult>> {
    return this.respond(async () => {
      const safeCaseId = validateResourceId(caseId);
      if (selectedAttachmentIds.length < 1 || selectedAttachmentIds.length > 10 || new Set(selectedAttachmentIds).size !== selectedAttachmentIds.length) {
        throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
      }
      const items: GmailImportResult['items'] = [];
      for (const selectedId of selectedAttachmentIds) {
        validateResourceId(selectedId);
        const separator = selectedId.indexOf(':');
        if (separator < 1 || separator === selectedId.length - 1) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
        const messageId = selectedId.slice(0, separator);
        const attachmentId = selectedId.slice(separator + 1);
        const response = await this.authorizedJson(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
          signal
        );
        const encoded = requiredString(response, 'data', MAX_PROVIDER_BODY_BYTES);
        const content = Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        const sizeBytes = response.size === undefined ? content.length : requiredInteger(response, 'size', 1, MAX_GMAIL_ATTACHMENT_BYTES);
        if (content.length < 1 || content.length > MAX_GMAIL_ATTACHMENT_BYTES || content.length !== sizeBytes) {
          throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
        }
        const metadata = await this.authorizedJson(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
          signal
        );
        const candidate: GmailAttachmentCandidate[] = [];
        this.collectGmailParts(messageId, metadata.payload, candidate);
        const selected = candidate.find((item) => item.attachmentId === selectedId);
        if (!selected || selected.sizeBytes !== sizeBytes) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
        items.push({
          attachmentId: selectedId,
          documentId: `DOC-GMAIL-${sha256(`${safeCaseId}:${selectedId}`).slice(0, 32)}`,
          filename: selected.filename,
          mimeType: selected.mimeType,
          sizeBytes,
          contentBase64: content.toString('base64'),
          sha256: sha256(content)
        });
      }
      return { importedCount: items.length, items };
    });
  }

  public async listSheetSources(caseId: string, signal?: AbortSignal): Promise<GoogleAdapterResponse<SheetSourceCandidate[]>> {
    return this.respond(async () => {
      const q = `mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and fullText contains '${caseId.replace(/'/g, '')}'`;
      const params = new URLSearchParams({ q, spaces: 'drive', pageSize: '20', fields: 'files(id,name)' });
      const listing = await this.authorizedJson(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, signal);
      const files = listing.files;
      if (files !== undefined && !Array.isArray(files)) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
      const sources: SheetSourceCandidate[] = [];
      for (const rawFile of files ?? []) {
        if (!isRecord(rawFile)) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
        const spreadsheetId = validateResourceId(requiredString(rawFile, 'id', 200));
        const displayName = validateDisplayText(requiredString(rawFile, 'name', 200), 200);
        const spreadsheet = await this.authorizedJson(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(title,gridProperties(rowCount,columnCount)))`,
          signal
        );
        if (!Array.isArray(spreadsheet.sheets)) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
        for (const rawSheet of spreadsheet.sheets.slice(0, 20)) {
          if (!isRecord(rawSheet) || !isRecord(rawSheet.properties)) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
          const sheetName = validateDisplayText(requiredString(rawSheet.properties, 'title', 100), 100);
          const grid = isRecord(rawSheet.properties.gridProperties) ? rawSheet.properties.gridProperties : {};
          const rowCount = Math.min(requiredInteger(grid, 'rowCount', 1, 100_000), 100_000);
          const columnCount = Math.min(requiredInteger(grid, 'columnCount', 1, 18_278), 18_278);
          sources.push({ spreadsheetId, sheetName, allowedRange: `A1:${this.columnName(columnCount)}${rowCount}`, displayName });
          if (sources.length > 100) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
        }
      }
      return sources;
    });
  }

  private columnName(columnNumber: number): string {
    let value = columnNumber;
    let name = '';
    while (value > 0) {
      value -= 1;
      name = String.fromCharCode(65 + (value % 26)) + name;
      value = Math.floor(value / 26);
    }
    return name;
  }

  public async createDriveFolder(caseId: string, caseTitle: string, idempotencyKey = sha256(caseId).slice(0, 32), signal?: AbortSignal): Promise<GoogleAdapterResponse<DriveFolderResult>> {
    return this.respond(async () => {
      const safeCaseId = validateResourceId(caseId);
      const safeTitle = validateDisplayText(caseTitle, 100);
      const safeKey = validateResourceId(idempotencyKey);
      const ensureFolder = async (name: string, kind: 'ORGANIZATION_ROOT' | 'DEPARTMENT_ROOT', department: 'ROOT' | 'CLAIM_CENTER', parentId?: string): Promise<string> => {
        const queryParts = [
          "mimeType='application/vnd.google-apps.folder'",
          'trashed=false',
          `appProperties has { key='concostFolderKind' and value='${kind}' }`,
          `appProperties has { key='concostDepartment' and value='${department}' }`
        ];
        if (parentId) queryParts.push(`'${parentId}' in parents`);
        const search = new URLSearchParams({ q: queryParts.join(' and '), spaces: 'drive', pageSize: '10', fields: 'files(id,name,parents)' });
        const listing = await this.authorizedJson(`https://www.googleapis.com/drive/v3/files?${search.toString()}`, signal);
        if (listing.files !== undefined && !Array.isArray(listing.files)) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
        const existing = Array.isArray(listing.files) ? listing.files.find(isRecord) : undefined;
        if (isRecord(existing)) return validateResourceId(requiredString(existing, 'id', 200));
        const created = await this.authorizedJson(
          'https://www.googleapis.com/drive/v3/files?fields=id,name,parents',
          signal,
          'POST',
          {
            name,
            mimeType: 'application/vnd.google-apps.folder',
            ...(parentId ? { parents: [parentId] } : {}),
            appProperties: { concostFolderKind: kind, concostDepartment: department }
          }
        );
        return validateResourceId(requiredString(created, 'id', 200));
      };

      const organizationRootId = await ensureFolder('CONCOST ERP 그룹웨어', 'ORGANIZATION_ROOT', 'ROOT');
      const departmentRootId = await ensureFolder('02_클레임센터', 'DEPARTMENT_ROOT', 'CLAIM_CENTER', organizationRootId);
      const query = `mimeType='application/vnd.google-apps.folder' and trashed=false and appProperties has { key='claimCenterCaseId' and value='${safeCaseId}' }`;
      const listFolders = async (withinDepartment: boolean): Promise<Record<string, unknown> | undefined> => {
        const scopedQuery = withinDepartment ? `${query} and '${departmentRootId}' in parents` : query;
        const search = new URLSearchParams({ q: scopedQuery, spaces: 'drive', pageSize: '10', fields: 'files(id,name,parents)' });
        const listing = await this.authorizedJson(`https://www.googleapis.com/drive/v3/files?${search.toString()}`, signal);
        if (listing.files !== undefined && !Array.isArray(listing.files)) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
        return Array.isArray(listing.files) ? listing.files.find(isRecord) : undefined;
      };
      const existing = await listFolders(true);
      if (existing) {
        const folderId = validateResourceId(requiredString(existing, 'id', 200));
        const folderName = validateDisplayText(requiredString(existing, 'name', 200), 200);
        return { folderId, folderName, webViewLink: `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`, isExisting: true };
      }
      const legacy = await listFolders(false);
      if (legacy) {
        const folderId = validateResourceId(requiredString(legacy, 'id', 200));
        const folderName = validateDisplayText(requiredString(legacy, 'name', 200), 200);
        const parents = Array.isArray(legacy.parents)
          ? legacy.parents.filter((parent): parent is string => typeof parent === 'string').map(validateResourceId)
          : [];
        const move = new URLSearchParams({ addParents: departmentRootId, fields: 'id,name,parents' });
        if (parents.length) move.set('removeParents', parents.join(','));
        const moved = await this.authorizedJson(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?${move.toString()}`, signal, 'PATCH');
        if (validateResourceId(requiredString(moved, 'id', 200)) !== folderId) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
        return { folderId, folderName, webViewLink: `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`, isExisting: true };
      }
      const created = await this.authorizedJson(
        'https://www.googleapis.com/drive/v3/files?fields=id,name,parents',
        signal,
        'POST',
        {
          name: `[사건] ${safeTitle}`,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [departmentRootId],
          appProperties: { claimCenterCaseId: safeCaseId, claimCenterFolderKind: 'PROJECT_ROOT', concostDepartment: 'CLAIM_CENTER', idempotencyKey: safeKey }
        },
        { 'X-Claim-Center-Idempotency-Key': safeKey }
      );
      const folderId = validateResourceId(requiredString(created, 'id', 200));
      const folderName = validateDisplayText(requiredString(created, 'name', 200), 200);
      return { folderId, folderName, webViewLink: `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`, isExisting: false };
    });
  }

  public async createCalendarEvent(caseId: string, input: CalendarEventInput, idempotencyKey: string, signal?: AbortSignal): Promise<GoogleAdapterResponse<CalendarEventResult>> {
    return this.respond(async () => {
      if (!input.humanConfirmed) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
      const safeCaseId = validateResourceId(caseId);
      const safeKey = validateResourceId(idempotencyKey);
      const eventId = sha256(`${safeCaseId}:${safeKey}`).slice(0, 32);
      const created = await this.authorizedJson(
        'https://calendar.googleapis.com/calendar/v3/calendars/primary/events',
        signal,
        'POST',
        {
          id: eventId,
          summary: validateDisplayText(input.summary, 500),
          description: input.description.slice(0, 8_192),
          start: { dateTime: new Date(input.startDateTime).toISOString() },
          end: { dateTime: new Date(input.endDateTime).toISOString() },
          extendedProperties: { private: { claimCenterIdempotencyKey: safeKey } }
        },
        { 'X-Claim-Center-Idempotency-Key': safeKey }
      );
      const returnedId = validateResourceId(requiredString(created, 'id', 200));
      const summary = validateDisplayText(requiredString(created, 'summary', 500), 500);
      const returnedStart = isRecord(created.start) ? requiredString(created.start, 'dateTime', 100) : '';
      const returnedEnd = isRecord(created.end) ? requiredString(created.end, 'dateTime', 100) : '';
      if (
        returnedId !== eventId
        || summary !== input.summary
        || new Date(returnedStart).toISOString() !== new Date(input.startDateTime).toISOString()
        || new Date(returnedEnd).toISOString() !== new Date(input.endDateTime).toISOString()
      ) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
      return { eventId: returnedId, htmlLink: `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(returnedId)}`, summary };
    });
  }

  public async exportDocs(_caseId: string, _meetingId: string, versionNumber: number, title: string, content: string, idempotencyKey: string, signal?: AbortSignal): Promise<GoogleAdapterResponse<DocsExportResult>> {
    return this.respond(async () => {
      const safeTitle = validateDisplayText(title, 200);
      const safeKey = validateResourceId(idempotencyKey);
      if (!Number.isSafeInteger(versionNumber) || versionNumber < 1 || Buffer.byteLength(content, 'utf8') > 1_000_000) {
        throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
      }
      const created = await this.authorizedJson(
        'https://docs.googleapis.com/v1/documents', signal, 'POST', { title: safeTitle },
        { 'X-Claim-Center-Idempotency-Key': safeKey }
      );
      const documentId = validateResourceId(requiredString(created, 'documentId', 200));
      try {
        await this.authorizedJson(
          `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`,
          signal,
          'POST',
          { requests: [{ insertText: { location: { index: 1 }, text: content } }] },
          { 'X-Claim-Center-Idempotency-Key': safeKey }
        );
      } catch {
        // The external document already exists. A retryable response here would
        // create a second document, so force server-side reconciliation instead.
        throw new ProviderFailure('SERVER_ERROR');
      }
      return { documentId, title: safeTitle, webViewLink: `https://docs.google.com/document/d/${encodeURIComponent(documentId)}`, version: versionNumber };
    });
  }

  public async importSheets(_caseId: string, input: SheetsImportInput, signal?: AbortSignal): Promise<GoogleAdapterResponse<SheetsImportResult>> {
    return this.respond(async () => {
      const spreadsheetId = validateResourceId(input.spreadsheetId);
      const sheetName = validateDisplayText(input.sheetName, 100);
      if (!/^[A-Z]{1,3}[1-9][0-9]{0,5}:[A-Z]{1,3}[1-9][0-9]{0,5}$/.test(input.rangeA1)) {
        throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
      }
      const quotedSheetName = `'${sheetName.replace(/'/g, "''")}'`;
      const encodedRange = encodeURIComponent(`${quotedSheetName}!${input.rangeA1}`);
      const response = await this.authorizedJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodedRange}?majorDimension=ROWS`,
        signal
      );
      if (!Array.isArray(response.values) || response.values.length < 1 || response.values.length > 100_001) {
        throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
      }
      if (response.majorDimension !== 'ROWS') throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
      const returnedRange = parseProviderSheetRange(requiredString(response, 'range', 500));
      const requestedRectangle = parseA1Rectangle(input.rangeA1);
      if (
        returnedRange.sheetName !== sheetName
        || returnedRange.rectangle.startColumn !== requestedRectangle.startColumn
        || returnedRange.rectangle.startRow !== requestedRectangle.startRow
        || returnedRange.rectangle.endColumn > requestedRectangle.endColumn
        || returnedRange.rectangle.endRow > requestedRectangle.endRow
      ) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
      const rows = response.values.map((row) => {
        if (!Array.isArray(row) || row.length > 18_278 || row.some((cell) => cell !== null && !['string', 'number', 'boolean'].includes(typeof cell))) {
          throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
        }
        return row;
      });
      const headers = rows[0].map((value) => String(value));
      const dataRows = rows.slice(1);
      const columnCount = Math.max(headers.length, ...dataRows.map((row) => row.length));
      if (columnCount < 1 || headers.length !== columnCount) throw new ProviderFailure('MALFORMED_PROVIDER_RESPONSE');
      const valuesJson = JSON.stringify({ spreadsheetId, sheetName, range: input.rangeA1, headers, rows: dataRows });
      const digest = sha256(valuesJson);
      return {
        snapshotId: `sheet-snap-${digest.slice(0, 32)}`,
        rowCount: dataRows.length,
        columnCount,
        sha256: digest,
        valuesJson
      };
    });
  }

  public async revokeConnection(secretRef: string, signal?: AbortSignal): Promise<GoogleAdapterResponse<{ revoked: boolean }>> {
    return this.respond(async () => {
      this.useCredential(secretRef);
      const credential = await this.#credentialProvider.resolveCredential(this.#organizationId, secretRef);
      if (!credential) throw new ProviderFailure('RECONSENT_REQUIRED');
      const response = await this.request({
        url: 'https://oauth2.googleapis.com/revoke',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: credential.refreshToken }).toString(),
        signal
      });
      if (response.status < 200 || response.status >= 300) throw new ProviderFailure('REVOKE_FAILURE');
      // An HTTP client may ignore AbortSignal and complete after the server has
      // already reported TIMEOUT. Preserve the local credential in that
      // uncertain state so the persisted CONNECTED row never points at a
      // deleted secret and an explicit retry/re-consent path remains possible.
      throwIfAborted(signal);
      // This method confirms the provider-side revoke only. The server owns the
      // durable connection/audit transition and explicitly discards the local
      // vault entry after that transaction commits.
      return { revoked: true };
    });
  }
}
