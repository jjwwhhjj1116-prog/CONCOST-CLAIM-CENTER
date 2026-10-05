export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_OAUTH_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3';
export const GOOGLE_DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
export const MAX_EVIDENCE_BYTES = 10_000_000;
export const MAX_REPORT_TEMPLATE_BYTES = 50_000_000;

export type GoogleFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class GoogleDriveError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly uncertain = false,
    public readonly retryAfterSeconds: number | null = null,
    public readonly providerHttpStatus: number | null = null,
    public requestStage: 'HEADERS' | 'BODY' | null = null
  ) {
    super(message);
  }
}

export type GoogleUploadStage = 'TOKEN_REFRESH' | 'PROJECT_FOLDER' | 'DAILY_FOLDER' | 'FILE_UPLOAD' | 'RENAME' | 'METADATA_COMMIT' | 'RESPONSE_PROJECTION';

export function googleUploadFailureCode(reason: unknown, stage: GoogleUploadStage): string {
  const code = reason instanceof GoogleDriveError ? reason.code : 'GOOGLE_OPERATION_FAILED';
  const requestStage = reason instanceof GoogleDriveError ? reason.requestStage : null;
  return `${code}:${stage}${requestStage ? `:${requestStage}` : ''}`;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  return new Uint8Array(value.match(/.{2}/g)?.map((entry) => Number.parseInt(entry, 16)) ?? []);
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)));
}

async function importMasterKey(masterKeyHex: string): Promise<CryptoKey> {
  const bytes = hexToBytes(masterKeyHex);
  if (!bytes || bytes.length !== 32) throw new GoogleDriveError('INVALID_MASTER_KEY', 503, 'Google credential encryption key is invalid');
  return crypto.subtle.importKey('raw', bytes.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(plaintext: string, masterKeyHex: string, aad: string): Promise<{ ciphertextHex: string; ivHex: string }> {
  const key = await importMasterKey(masterKeyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(plaintext)
  );
  return { ciphertextHex: bytesToHex(new Uint8Array(ciphertext)), ivHex: bytesToHex(iv) };
}

export async function decryptSecret(ciphertextHex: string, ivHex: string, masterKeyHex: string, aad: string): Promise<string | null> {
  try {
    const key = await importMasterKey(masterKeyHex);
    const ciphertext = hexToBytes(ciphertextHex);
    const iv = hexToBytes(ivHex);
    if (!ciphertext || !iv || iv.length !== 12) return null;
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv.buffer as ArrayBuffer,
        additionalData: encoder.encode(aad).buffer as ArrayBuffer,
      },
      key,
      ciphertext.buffer as ArrayBuffer
    );
    return decoder.decode(plaintext);
  } catch {
    return null;
  }
}

export async function createPkce(): Promise<{ state: string; stateHash: string; verifier: string; challenge: string }> {
  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const challengeInput = encoder.encode(verifier);
  const challengeBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', challengeInput.buffer as ArrayBuffer));
  return { state, stateHash: await sha256Hex(state), verifier, challenge: base64Url(challengeBytes) };
}

export function buildAuthorizationUrl(clientId: string, redirectUri: string, state: string, challenge: string): string {
  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_DRIVE_SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'offline');
  // Always show the chooser so an administrator can move the storage
  // connection to another company-managed Google account at any time.
  url.searchParams.set('prompt', 'select_account consent');
  return url.toString();
}

async function fetchWithTimeout(fetcher: GoogleFetch, input: string, init: RequestInit, timeoutMs = 20_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } catch {
    throw new GoogleDriveError('GOOGLE_TIMEOUT', 504, 'Google Drive request timed out', true);
  } finally {
    clearTimeout(timeout);
  }
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GoogleDriveError('GOOGLE_MALFORMED_RESPONSE', 502, 'Google returned an invalid response');
  }
  return value as Record<string, unknown>;
}

function providerFailure(response: Response, operation: string, uncertain = false): GoogleDriveError {
  const retryAfterRaw = Number(response.headers.get('Retry-After'));
  const retryAfter = Number.isFinite(retryAfterRaw) && retryAfterRaw >= 0 ? Math.min(120, retryAfterRaw) : null;
  // Google's OAuth token endpoint reports an expired/revoked refresh token as
  // HTTP 400 (invalid_grant), not only as 401/403. Treat every failed refresh
  // as a reconnect request so callers can recover instead of surfacing the
  // misleading generic "Google token refresh failed" message.
  if (response.status === 429) return new GoogleDriveError('GOOGLE_RATE_LIMITED', 429, 'Google Drive rate limit reached', false, retryAfter, response.status);
  if ((operation === 'Google token refresh' && response.status === 400) || response.status === 401 || response.status === 403) return new GoogleDriveError('GOOGLE_RECONSENT_REQUIRED', 401, 'Google Drive connection must be renewed', false, null, response.status);
  return new GoogleDriveError('GOOGLE_PROVIDER_ERROR', response.status >= 500 ? 502 : 400, `${operation} failed`, uncertain && response.status >= 500, null, response.status);
}

// Bound headers AND JSON bodies. Read/token failures cannot imply a Drive write;
// folder/file mutations must retain uncertainty when their receipt is lost.
async function driveJsonRequest(fetcher: GoogleFetch, input: string | URL, init: RequestInit, operation: string, uncertain = false): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  let requestStage: 'HEADERS' | 'BODY' = 'HEADERS';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetcher(input, { ...init, signal: controller.signal });
        if (!response.ok) throw providerFailure(response, operation, uncertain);
        requestStage = 'BODY';
        return safeJson(response);
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new GoogleDriveError('GOOGLE_TIMEOUT', 504, `${operation} timed out`, uncertain));
          controller.abort();
        }, 20_000);
      })
    ]);
  } catch (error) {
    if (error instanceof GoogleDriveError) {
      if (error.code === 'GOOGLE_MALFORMED_RESPONSE' && uncertain) {
        throw new GoogleDriveError(error.code, error.status, error.message, true, error.retryAfterSeconds, error.providerHttpStatus, requestStage);
      }
      error.requestStage ??= requestStage;
      throw error;
    }
    throw new GoogleDriveError('GOOGLE_TIMEOUT', 504, `${operation} request was interrupted`, uncertain, null, null, requestStage);
  } finally { clearTimeout(timer); controller.abort(); }
}

export async function exchangeAuthorizationCode(
  fetcher: GoogleFetch,
  input: { clientId: string; clientSecret: string; code: string; verifier: string; redirectUri: string }
): Promise<{ refreshToken: string; accessToken: string; scope: string }> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    code_verifier: input.verifier,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri
  });
  const payload = await driveJsonRequest(fetcher, GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  }, 'Google OAuth exchange');
  if (typeof payload.refresh_token !== 'string' || payload.refresh_token.length < 10) {
    throw new GoogleDriveError('GOOGLE_REFRESH_TOKEN_MISSING', 502, 'Google did not return a refresh token');
  }
  if (typeof payload.access_token !== 'string' || payload.access_token.length < 10 || payload.token_type !== 'Bearer') {
    throw new GoogleDriveError('GOOGLE_MALFORMED_RESPONSE', 502, 'Google returned an invalid access token');
  }
  const grantedScopes = typeof payload.scope === 'string' ? payload.scope.split(/\s+/u) : [];
  if (!grantedScopes.includes(GOOGLE_DRIVE_SCOPE)) throw new GoogleDriveError('GOOGLE_SCOPE_MISSING', 403, 'Required Google Drive scope was not granted');
  return { refreshToken: payload.refresh_token, accessToken: payload.access_token, scope: GOOGLE_DRIVE_SCOPE };
}

export async function getDriveAccount(fetcher: GoogleFetch, accessToken: string): Promise<{ email: string; displayName: string }> {
  const payload = await driveJsonRequest(fetcher, `${GOOGLE_DRIVE_API}/about?fields=user(displayName,emailAddress,permissionId)`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  }, 'Google Drive account verification');
  const user = payload.user;
  if (!user || typeof user !== 'object' || Array.isArray(user)) {
    throw new GoogleDriveError('GOOGLE_MALFORMED_RESPONSE', 502, 'Google returned an invalid account profile');
  }
  const account = user as Record<string, unknown>;
  if (typeof account.emailAddress !== 'string' || !/^[^@\s]+@[^@\s]+$/u.test(account.emailAddress) || typeof account.displayName !== 'string') {
    throw new GoogleDriveError('GOOGLE_MALFORMED_RESPONSE', 502, 'Google returned an invalid account profile');
  }
  return { email: account.emailAddress.toLowerCase(), displayName: account.displayName.slice(0, 120) };
}

export function isAllowedGoogleAccountEmail(email: string, allowedDomain: string, allowedAccount?: string | null): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedAccount = allowedAccount?.trim().toLowerCase();
  return normalizedEmail.endsWith(`@${allowedDomain.trim().toLowerCase()}`) || Boolean(normalizedAccount && normalizedEmail === normalizedAccount);
}

export async function refreshAccessToken(
  fetcher: GoogleFetch,
  input: { clientId: string; clientSecret: string; refreshToken: string }
): Promise<string> {
  const payload = await driveJsonRequest(fetcher, GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: 'refresh_token'
    })
  }, 'Google token refresh');
  if (typeof payload.access_token !== 'string' || payload.access_token.length < 10 || payload.token_type !== 'Bearer') {
    throw new GoogleDriveError('GOOGLE_MALFORMED_RESPONSE', 502, 'Google returned an invalid access token');
  }
  return payload.access_token;
}

export async function revokeGoogleCredential(fetcher: GoogleFetch, refreshToken: string): Promise<void> {
  const response = await fetchWithTimeout(fetcher, GOOGLE_OAUTH_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken })
  });
  if (!response.ok) throw providerFailure(response, 'Google credential revocation', true);
}

const extensionMime: Record<string, { mime: string; magic: (bytes: Uint8Array) => boolean }> = {
  pdf: { mime: 'application/pdf', magic: (b) => decoder.decode(b.slice(0, 5)) === '%PDF-' },
  png: { mime: 'image/png', magic: (b) => bytesToHex(b.slice(0, 8)) === '89504e470d0a1a0a' },
  jpg: { mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  webp: { mime: 'image/webp', magic: (b) => decoder.decode(b.slice(0, 4)) === 'RIFF' && decoder.decode(b.slice(8, 12)) === 'WEBP' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  hwpx: { mime: 'application/vnd.hancom.hwpx', magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  doc: { mime: 'application/msword', magic: (b) => bytesToHex(b.slice(0, 4)) === 'd0cf11e0' },
  xls: { mime: 'application/vnd.ms-excel', magic: (b) => bytesToHex(b.slice(0, 4)) === 'd0cf11e0' },
  ppt: { mime: 'application/vnd.ms-powerpoint', magic: (b) => bytesToHex(b.slice(0, 4)) === 'd0cf11e0' },
  hwp: { mime: 'application/x-hwp', magic: (b) => bytesToHex(b.slice(0, 4)) === 'd0cf11e0' },
  txt: { mime: 'text/plain', magic: (b) => !b.includes(0) },
  csv: { mime: 'text/csv', magic: (b) => !b.includes(0) },
  mp3: { mime: 'audio/mpeg', magic: (b) => decoder.decode(b.slice(0, 3)) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  m4a: { mime: 'audio/mp4', magic: (b) => decoder.decode(b.slice(4, 8)) === 'ftyp' },
  wav: { mime: 'audio/wav', magic: (b) => decoder.decode(b.slice(0, 4)) === 'RIFF' && decoder.decode(b.slice(8, 12)) === 'WAVE' },
  ogg: { mime: 'audio/ogg', magic: (b) => decoder.decode(b.slice(0, 4)) === 'OggS' },
  webm: { mime: 'audio/webm', magic: (b) => bytesToHex(b.slice(0, 4)) === '1a45dfa3' }
};

export async function validateEvidenceFile(file: File): Promise<{ bytes: Uint8Array; mimeType: string; sha256: string }> {
  if (file.size <= 0 || file.size > MAX_EVIDENCE_BYTES) throw new GoogleDriveError('EVIDENCE_TOO_LARGE', 413, 'Evidence file must be between 1 byte and 10 MB');
  if (file.name.length > 240 || /[\\/:*?"<>|\u0000-\u001f]/u.test(file.name)) throw new GoogleDriveError('INVALID_FILE_NAME', 400, 'Evidence file name is invalid');
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const rule = extensionMime[extension];
  if (!rule) throw new GoogleDriveError('EVIDENCE_TYPE_NOT_ALLOWED', 415, 'Evidence file type is not allowed');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!rule.magic(bytes)) throw new GoogleDriveError('EVIDENCE_SIGNATURE_MISMATCH', 415, 'Evidence file content does not match its extension');
  return { bytes, mimeType: rule.mime, sha256: await sha256Hex(bytes) };
}

export async function validateReportTemplateFile(file: File): Promise<{ bytes: Uint8Array; mimeType: string; sha256: string }> {
  if (file.size <= 0 || file.size > MAX_REPORT_TEMPLATE_BYTES) throw new GoogleDriveError('REPORT_TEMPLATE_TOO_LARGE', 413, 'Report template must be between 1 byte and 50 MB');
  if (file.name.length > 240 || /[\\/:*?"<>|\u0000-\u001f]/u.test(file.name)) throw new GoogleDriveError('INVALID_FILE_NAME', 400, 'Report template file name is invalid');
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!['pdf', 'hwp', 'hwpx', 'xlsx'].includes(extension)) throw new GoogleDriveError('REPORT_TEMPLATE_TYPE_NOT_ALLOWED', 415, 'Only PDF, HWP, HWPX, and XLSX report templates are allowed');
  const rule = extensionMime[extension];
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!rule?.magic(bytes)) throw new GoogleDriveError('REPORT_TEMPLATE_SIGNATURE_MISMATCH', 415, 'Report template content does not match its extension');
  return { bytes, mimeType: rule.mime, sha256: await sha256Hex(bytes) };
}

const GOOGLE_ID = /^[A-Za-z0-9_-]{10,200}$/u;

export async function ensureReportTemplateFolder(
  fetcher: GoogleFetch,
  input: { accessToken: string; categoryCode: string; categoryName: string }
): Promise<{ rootId: string; categoryId: string }> {
  if (!/^REF-0[1-9]$/u.test(input.categoryCode) || input.categoryName.trim().length < 2) {
    throw new GoogleDriveError('INVALID_REPORT_TEMPLATE_CATEGORY', 400, 'Report template category is invalid');
  }
  const ensureFolder = async (kind: 'REPORT_TEMPLATE_LIBRARY' | 'REPORT_TEMPLATE_CATEGORY', name: string, parentId?: string): Promise<string> => {
    const q = [
      "trashed = false",
      "mimeType = 'application/vnd.google-apps.folder'",
      `appProperties has { key='claimCenterFolderKind' and value='${kind}' }`,
      `appProperties has { key='claimCenterTemplateCategory' and value='${kind === 'REPORT_TEMPLATE_LIBRARY' ? 'ROOT' : input.categoryCode}' }`
    ];
    if (parentId) q.push(`'${driveQueryValue(parentId)}' in parents`);
    const listUrl = new URL(`${GOOGLE_DRIVE_API}/files`);
    listUrl.searchParams.set('q', q.join(' and '));
    listUrl.searchParams.set('spaces', 'drive');
    listUrl.searchParams.set('pageSize', '10');
    listUrl.searchParams.set('fields', 'files(id,name,mimeType,trashed)');
    const listing = await driveJsonRequest(fetcher, listUrl, { headers: { Authorization: `Bearer ${input.accessToken}` } }, 'Google Drive report-template folder lookup');
    if (!Array.isArray(listing.files)) throw new GoogleDriveError('GOOGLE_MALFORMED_RESPONSE', 502, 'Google returned an invalid report-template folder list');
    const existing = listing.files.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)))
      .filter((entry) => typeof entry.id === 'string' && GOOGLE_ID.test(entry.id) && entry.mimeType === 'application/vnd.google-apps.folder' && entry.trashed !== true)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
    if (existing) return String(existing.id);
    const metadata = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
      appProperties: {
        claimCenterFolderKind: kind,
        claimCenterTemplateCategory: kind === 'REPORT_TEMPLATE_LIBRARY' ? 'ROOT' : input.categoryCode
      }
    };
    const result = await driveJsonRequest(fetcher, `${GOOGLE_DRIVE_API}/files?fields=id,name,mimeType,trashed`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata)
    }, 'Google Drive report-template folder creation', true);
    if (typeof result.id !== 'string' || !GOOGLE_ID.test(result.id) || result.name !== name || result.mimeType !== 'application/vnd.google-apps.folder' || result.trashed === true) {
      throw new GoogleDriveError('GOOGLE_MALFORMED_RESPONSE', 502, 'Google returned invalid report-template folder metadata', true);
    }
    return result.id;
  };
  const department = await ensureClaimCenterDepartmentRoot(fetcher, input.accessToken);
  const rootId = await ensureFolder('REPORT_TEMPLATE_LIBRARY', 'CONCOST CLAIM CENTER - 보고서 템플릿', department.departmentRootId);
  const categoryId = await ensureFolder('REPORT_TEMPLATE_CATEGORY', `${input.categoryCode} ${input.categoryName}`, rootId);
  return { rootId, categoryId };
}

export async function verifyDriveFolder(fetcher: GoogleFetch, accessToken: string, folderId: string): Promise<{ id: string; name: string }> {
  if (!GOOGLE_ID.test(folderId)) throw new GoogleDriveError('INVALID_GOOGLE_FOLDER_ID', 400, 'Google Drive folder ID is invalid');
  const payload = await driveJsonRequest(fetcher, `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,trashed`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  }, 'Google Drive folder verification');
  if (payload.id !== folderId || payload.mimeType !== 'application/vnd.google-apps.folder' || payload.trashed === true || typeof payload.name !== 'string') {
    throw new GoogleDriveError('INVALID_GOOGLE_FOLDER', 400, 'Selected Google Drive item is not an active folder');
  }
  return { id: folderId, name: payload.name };
}

export type ClaimCenterFolderKind =
  | 'PROJECT_ROOT' | 'INTAKE_REFERENCE' | 'PROPOSAL_REFERENCE' | 'KICKOFF_MATERIAL'
  | 'MEETING_MINUTES' | 'MEETING_RECORDING' | 'SITE_PHOTO' | 'SITE_RECORDING'
  | 'SITE_DOCUMENT' | 'TAKEOFF_SOURCE' | 'COST_BREAKDOWN' | 'REPORT_REFERENCE'
  | 'COURT_DOCUMENT' | 'FINAL_DELIVERABLE' | 'INTAKE_AUDIO' | 'INTAKE_SOURCE'
  | 'INTAKE_DB_ARCHIVE' | 'PROPOSAL_DB_ARCHIVE' | 'BUSINESS_CARD_LIBRARY' | 'MONTH';

const CLAIM_CENTER_FOLDER_KINDS = new Set<ClaimCenterFolderKind>([
  'PROJECT_ROOT','INTAKE_REFERENCE','PROPOSAL_REFERENCE','KICKOFF_MATERIAL','MEETING_MINUTES',
  'MEETING_RECORDING','SITE_PHOTO','SITE_RECORDING','SITE_DOCUMENT','TAKEOFF_SOURCE',
  'COST_BREAKDOWN','REPORT_REFERENCE','COURT_DOCUMENT','FINAL_DELIVERABLE','INTAKE_AUDIO','INTAKE_SOURCE',
  'INTAKE_DB_ARCHIVE','PROPOSAL_DB_ARCHIVE','BUSINESS_CARD_LIBRARY','MONTH'
]);

function driveQueryValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

// Read names of recorded upload folders only. Never create, move or rename on a library GET.
export async function readEvidenceFolderNames(fetcher: GoogleFetch, getToken: (fetcher: GoogleFetch) => Promise<string>, caseId: string, folderIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!/^[0-9a-f-]{36}$/iu.test(caseId)) return names;
  const wanted = new Set(folderIds.filter((id) => GOOGLE_ID.test(id)));
  if (!wanted.size) return names;
  const deadline = Date.now() + 6_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  const boundedFetch: GoogleFetch = (input, init) => fetcher(input, { ...init, signal: controller.signal });
  let pageToken = '';
  try {
  const token = await getToken(boundedFetch);
  // ponytail: cap at 3 pages/6 seconds; unresolved names stay explicitly unknown. Add lazy paging if projects exceed 3,000 folders.
  for (let page = 0; wanted.size && page < 3 && Date.now() < deadline; page++) {
    const url = new URL(`${GOOGLE_DRIVE_API}/files`);
    url.searchParams.set('q', `trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='claimCenterCaseId' and value='${driveQueryValue(caseId)}' }`);
    url.searchParams.set('spaces', 'drive');
    url.searchParams.set('pageSize', '1000');
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,trashed,appProperties)');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    try {
      const response = await boundedFetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) break;
      const payload = await safeJson(response);
      if (!Array.isArray(payload.files)) break;
      for (const entry of payload.files) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const item = entry as Record<string, unknown>;
        const properties = item.appProperties as Record<string, unknown> | undefined;
        if (typeof item.id !== 'string' || !wanted.has(item.id) || item.mimeType !== 'application/vnd.google-apps.folder' || item.trashed === true || properties?.claimCenterCaseId !== caseId || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 1000) continue;
        names.set(item.id, item.name);
        wanted.delete(item.id);
      }
      if (typeof payload.nextPageToken !== 'string' || !payload.nextPageToken || payload.nextPageToken === pageToken) break;
      pageToken = payload.nextPageToken;
    } catch { break; } // Name lookup failure must not hide existing files or block their proxy downloads.
  }
  } catch { /* Token refresh shares the metadata deadline; unavailable metadata is not a file-list failure. */ }
  finally { clearTimeout(timeout); }
  return names;
}

export const CONCOST_DRIVE_ROOT_NAME = 'CONCOST 자료실';
export const CLAIM_CENTER_DEPARTMENT_FOLDER_NAME = '20_클레임센터';

export async function ensureClaimCenterDepartmentRoot(
  fetcher: GoogleFetch,
  accessToken: string
): Promise<{ organizationRootId: string; departmentRootId: string }> {
  const ensureFolder = async (
    kind: 'ORGANIZATION_ROOT' | 'DEPARTMENT_ROOT',
    name: string,
    parentId?: string
  ): Promise<string> => {
    const department = kind === 'ORGANIZATION_ROOT' ? 'ROOT' : 'CLAIM_CENTER';
    const q = [
      "trashed = false",
      "mimeType = 'application/vnd.google-apps.folder'",
      `appProperties has { key='concostFolderKind' and value='${kind}' }`,
      `appProperties has { key='concostDepartment' and value='${department}' }`
    ];
    if (parentId) q.push(`'${driveQueryValue(parentId)}' in parents`);
    const listUrl = new URL(`${GOOGLE_DRIVE_API}/files`);
    listUrl.searchParams.set('q', q.join(' and '));
    listUrl.searchParams.set('spaces', 'drive');
    listUrl.searchParams.set('pageSize', '10');
    listUrl.searchParams.set('fields', 'files(id,name,mimeType,trashed,parents,appProperties)');
    const listing = await driveJsonRequest(fetcher, listUrl, { headers: { Authorization: `Bearer ${accessToken}` } }, 'Google Drive department folder lookup');
    if (!Array.isArray(listing.files)) throw new GoogleDriveError('GOOGLE_MALFORMED_RESPONSE', 502, 'Google returned an invalid department folder list');
    const existing = listing.files
      .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)))
      .filter((entry) => typeof entry.id === 'string' && GOOGLE_ID.test(entry.id) && entry.mimeType === 'application/vnd.google-apps.folder' && entry.trashed !== true)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
    if (existing) {
      const existingId = String(existing.id);
      if (existing.name !== name) {
        const result = await driveJsonRequest(fetcher, `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(existingId)}?fields=id,name`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        }, 'Google Drive department folder rename', true);
        if (result.id !== existingId || result.name !== name) {
          throw new GoogleDriveError('GOOGLE_MALFORMED_RESPONSE', 502, 'Google returned invalid renamed department folder metadata', true);
        }
      }
      return existingId;
    }
    const metadata = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
      appProperties: { concostFolderKind: kind, concostDepartment: department }
    };
    const result = await driveJsonRequest(fetcher, `${GOOGLE_DRIVE_API}/files?fields=id,name,mimeType,trashed,parents,appProperties`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata)
    }, 'Google Drive department folder creation', true);
    if (typeof result.id !== 'string' || !GOOGLE_ID.test(result.id) || result.name !== name || result.mimeType !== 'application/vnd.google-apps.folder' || result.trashed === true) {
      throw new GoogleDriveError('GOOGLE_MALFORMED_RESPONSE', 502, 'Google returned invalid department folder metadata', true);
    }
    return result.id;
  };
  const organizationRootId = await ensureFolder('ORGANIZATION_ROOT', CONCOST_DRIVE_ROOT_NAME);
  const departmentRootId = await ensureFolder('DEPARTMENT_ROOT', CLAIM_CENTER_DEPARTMENT_FOLDER_NAME, organizationRootId);
  return { organizationRootId, departmentRootId };
}

export async function ensureClaimCenterFolder(
  fetcher: GoogleFetch,
  input: { accessToken: string; caseId: string; kind: ClaimCenterFolderKind; period: string; name: string; parentId?: string }
): Promise<{ id: string; name: string; created: boolean }> {
  if (!/^[0-9a-f-]{36}$/iu.test(input.caseId) || !CLAIM_CENTER_FOLDER_KINDS.has(input.kind) || !/^(?:|\d{4}-\d{2}|\d{4}-\d{2}-\d{2}_[0-9a-f-]{36})$/iu.test(input.period)) {
    throw new GoogleDriveError('INVALID_GOOGLE_FOLDER_CONTEXT', 400, 'Google Drive project folder context is invalid');
  }
  const name = input.name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '-').replace(/\s+/gu, ' ').slice(0, 180);
  let parentId = input.parentId;
  const usesDepartmentRoot = (input.kind === 'PROJECT_ROOT' || input.kind === 'BUSINESS_CARD_LIBRARY') && !parentId;
  if ((input.kind === 'PROJECT_ROOT' || input.kind === 'BUSINESS_CARD_LIBRARY') && !parentId) {
    parentId = (await ensureClaimCenterDepartmentRoot(fetcher, input.accessToken)).departmentRootId;
  }
  if (!name || (parentId && !GOOGLE_ID.test(parentId))) throw new GoogleDriveError('INVALID_GOOGLE_FOLDER_CONTEXT', 400, 'Google Drive project folder name or parent is invalid');
  const q = [
    "trashed = false",
    "mimeType = 'application/vnd.google-apps.folder'",
    `appProperties has { key='claimCenterCaseId' and value='${driveQueryValue(input.caseId)}' }`,
    `appProperties has { key='claimCenterFolderKind' and value='${driveQueryValue(input.kind)}' }`,
    `appProperties has { key='claimCenterPeriod' and value='${driveQueryValue(input.period)}' }`
  ];
  if (parentId) q.push(`'${driveQueryValue(parentId)}' in parents`);
  const listUrl = new URL(`${GOOGLE_DRIVE_API}/files`);
  listUrl.searchParams.set('q', q.join(' and '));
  listUrl.searchParams.set('spaces', 'drive');
  listUrl.searchParams.set('pageSize', '10');
  listUrl.searchParams.set('fields', 'files(id,name,mimeType,trashed,parents,appProperties)');
  const listing = await driveJsonRequest(fetcher, listUrl, { headers: { Authorization: `Bearer ${input.accessToken}` } }, 'Google Drive project folder lookup');
  if (!Array.isArray(listing.files)) throw new GoogleDriveError('GOOGLE_MALFORMED_RESPONSE', 502, 'Google returned an invalid folder list');
  const candidates = listing.files.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)))
    .filter((entry) => typeof entry.id === 'string' && GOOGLE_ID.test(entry.id) && entry.mimeType === 'application/vnd.google-apps.folder' && entry.trashed !== true)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (candidates[0]) return { id: String(candidates[0].id), name: typeof candidates[0].name === 'string' ? candidates[0].name : name, created: false };

  // Preserve folders created before departmental routing was introduced. The
  // app owns these folders under drive.file, so it can move them without
  // copying files or breaking their stable Google Drive URLs.
  if (usesDepartmentRoot && input.kind === 'PROJECT_ROOT' && parentId) {
    const legacyQuery = q.filter((entry) => !entry.endsWith(' in parents')).join(' and ');
    const legacyUrl = new URL(`${GOOGLE_DRIVE_API}/files`);
    legacyUrl.searchParams.set('q', legacyQuery);
    legacyUrl.searchParams.set('spaces', 'drive');
    legacyUrl.searchParams.set('pageSize', '10');
    legacyUrl.searchParams.set('fields', 'files(id,name,mimeType,trashed,parents,appProperties)');
    const legacyListing = await driveJsonRequest(fetcher, legacyUrl, { headers: { Authorization: `Bearer ${input.accessToken}` } }, 'Google Drive legacy project folder lookup');
    if (!Array.isArray(legacyListing.files)) throw new GoogleDriveError('GOOGLE_MALFORMED_RESPONSE', 502, 'Google returned an invalid legacy folder list');
    const legacy = legacyListing.files
      .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)))
      .filter((entry) => typeof entry.id === 'string' && GOOGLE_ID.test(entry.id) && entry.mimeType === 'application/vnd.google-apps.folder' && entry.trashed !== true)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
    if (legacy) {
      const legacyId = String(legacy.id);
      const legacyParents = Array.isArray(legacy.parents)
        ? legacy.parents.filter((value): value is string => typeof value === 'string' && GOOGLE_ID.test(value))
        : [];
      const moveUrl = new URL(`${GOOGLE_DRIVE_API}/files/${encodeURIComponent(legacyId)}`);
      moveUrl.searchParams.set('addParents', parentId);
      if (legacyParents.length) moveUrl.searchParams.set('removeParents', legacyParents.join(','));
      moveUrl.searchParams.set('fields', 'id,name,mimeType,trashed,parents,appProperties');
      const moved = await driveJsonRequest(fetcher, moveUrl, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${input.accessToken}` }
      }, 'Google Drive legacy project folder move', true);
      if (moved.id !== legacyId || moved.mimeType !== 'application/vnd.google-apps.folder' || moved.trashed === true) {
        throw new GoogleDriveError('GOOGLE_MALFORMED_RESPONSE', 502, 'Google returned invalid moved project-folder metadata', true);
      }
      return { id: legacyId, name: typeof moved.name === 'string' ? moved.name : name, created: false };
    }
  }

  const metadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    ...(parentId ? { parents: [parentId] } : {}),
    appProperties: {
      claimCenterCaseId: input.caseId,
      claimCenterFolderKind: input.kind,
      claimCenterPeriod: input.period,
      concostDepartment: 'CLAIM_CENTER'
    }
  };
  const result = await driveJsonRequest(fetcher, `${GOOGLE_DRIVE_API}/files?fields=id,name,mimeType,trashed,parents,appProperties`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata)
  }, 'Google Drive project folder creation', true);
  if (typeof result.id !== 'string' || !GOOGLE_ID.test(result.id) || result.name !== name || result.mimeType !== 'application/vnd.google-apps.folder' || result.trashed === true) {
    throw new GoogleDriveError('GOOGLE_MALFORMED_RESPONSE', 502, 'Google returned invalid project folder metadata', true);
  }
  return { id: result.id, name, created: true };
}

interface DriveUploadCandidate {
  id: string; name: string; mimeType: string; size: string; trashed: boolean;
  parents: string[]; appProperties: Record<string, string>; webViewLink?: string;
}

// Receipt recovery is read-only. An unreadable POST response must never cause another POST.
async function driveUploadCheckJson(fetcher: GoogleFetch, accessToken: string, url: URL, operation: string): Promise<Record<string, unknown>> {
  return driveJsonRequest(fetcher, url, { headers: { Authorization: `Bearer ${accessToken}` } }, operation);
}

async function driveUploadCandidates(fetcher: GoogleFetch, accessToken: string, query: string): Promise<DriveUploadCandidate[]> {
  const url = new URL(`${GOOGLE_DRIVE_API}/files`);
  url.searchParams.set('q', `trashed = false and ${query}`);
  url.searchParams.set('pageSize', '100');
  url.searchParams.set('fields', 'nextPageToken,incompleteSearch,files(id,name,mimeType,size,trashed,parents,appProperties,webViewLink)');
  const payload = await driveUploadCheckJson(fetcher, accessToken, url, 'Google Drive candidate search');
  if (!Array.isArray(payload.files) || payload.nextPageToken || payload.incompleteSearch) {
    throw new GoogleDriveError('GOOGLE_UPLOAD_VERIFICATION_INCOMPLETE', 409, 'Drive 저장 결과를 유일하게 확인하지 못했습니다. 기존 파일은 보존됩니다.');
  }
  return payload.files as DriveUploadCandidate[];
}

async function verifyDriveUploadBytes(fetcher: GoogleFetch, accessToken: string, file: DriveUploadCandidate): Promise<boolean> {
  const size = Number(file.size);
  if (!GOOGLE_ID.test(file.id) || !Number.isSafeInteger(size) || size < 1 || size > MAX_REPORT_TEMPLATE_BYTES
    || file.trashed !== false || !/^[0-9a-f]{64}$/u.test(file.appProperties?.sha256 ?? '')
    || !Array.isArray(file.parents) || file.parents.length !== 1 || !GOOGLE_ID.test(file.parents[0])) return false;
  const bytes = await readTemplateDownloadBody(await downloadEvidenceFromDrive(fetcher, accessToken, file.id), size);
  return await sha256Hex(bytes) === file.appProperties.sha256;
}

interface EvidenceUploadInspectionInput {
  operationId?: string;
  accessToken: string; caseId: string; category: string; uploadedById: string;
  requestFingerprint: string; createdAt: string; updatedAt: string;
}
interface EvidenceUploadReceipt {
  fileId: string; evidenceId: string; originalName: string; mimeType: string; byteSize: number;
  sha256: string; folderId: string; uploadedAt: string;
}
export interface EvidenceUploadInspection {
  diagnostics?: { candidateCount: number; matchedCount: number; rejected: Record<'attribution' | 'time' | 'evidenceId' | 'version' | 'fingerprint', number> };
  receipt: EvidenceUploadReceipt | null;
  reasonCode: 'EMPTY_SCOPED_SEARCH' | 'NO_FINGERPRINT_MATCH' | 'AMBIGUOUS_MATCH' | 'BYTES_MISMATCH' | 'PARENT_MISMATCH' | 'PROJECT_ROOT_MISMATCH' | 'VERIFIED';
  stage: 'CANDIDATE_SEARCH' | 'CANDIDATE_MATCH' | 'CONTENT_VERIFY' | 'PARENT_VERIFY' | 'ROOT_VERIFY' | 'COMPLETE';
}

export async function inspectEvidenceUploadInDrive(fetcher: GoogleFetch, input: EvidenceUploadInspectionInput): Promise<EvidenceUploadReceipt | null> {
  return (await diagnoseEvidenceUploadInDrive(fetcher, input)).receipt;
}

export async function diagnoseEvidenceUploadInDrive(fetcher: GoogleFetch, input: EvidenceUploadInspectionInput,
  searchScope: 'OPERATION_WINDOW' | 'PROJECT_ACTOR' = 'OPERATION_WINDOW'): Promise<EvidenceUploadInspection> {
  if (input.operationId !== undefined && !/^[0-9a-f-]{36}$/iu.test(input.operationId)) throw new GoogleDriveError('INVALID_UPLOAD_OPERATION', 409, '유효한 업로드 작업번호가 필요합니다.');
  const start = Date.parse(input.createdAt); const end = Date.parse(input.updatedAt) + 60_000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new GoogleDriveError('INVALID_UPLOAD_OPERATION', 409, '업로드 기록의 시각을 확인해야 합니다.');
  const query = [
    `appProperties has { key='claimCenterCaseId' and value='${driveQueryValue(input.caseId)}' }`,
    `appProperties has { key='claimCenterCategory' and value='${driveQueryValue(input.category)}' }`,
    `appProperties has { key='claimCenterUploadedBy' and value='${driveQueryValue(input.uploadedById)}' }`,
    // Broader admin inspection avoids assuming Drive creation time equals request time.
    // Exact upload attribution/time/fingerprint checks below still apply to every candidate.
    ...(searchScope === 'OPERATION_WINDOW' ? [`createdTime >= '${new Date(start).toISOString()}'`, `createdTime <= '${new Date(end).toISOString()}'`] : [])
  ].join(' and ');
  const matches: DriveUploadCandidate[] = [];
  // The ID was persisted before POST. Never repeat a POST to recover its receipt.
  let exactOperation = false;
  let candidates: DriveUploadCandidate[] = [];
  if (input.operationId) {
    candidates = await driveUploadCandidates(fetcher, input.accessToken, `${query} and appProperties has { key='claimCenterOperationId' and value='${driveQueryValue(input.operationId)}' }`);
    exactOperation = candidates.length > 0;
  }
  if (!exactOperation) candidates = await driveUploadCandidates(fetcher, input.accessToken, query);
  if (exactOperation && candidates.length > 1) return { receipt: null, reasonCode: 'AMBIGUOUS_MATCH', stage: 'CANDIDATE_MATCH' };
  if (!candidates.length) return { receipt: null, reasonCode: 'EMPTY_SCOPED_SEARCH', stage: 'CANDIDATE_SEARCH' };
  const rejected = { attribution: 0, time: 0, evidenceId: 0, version: 0, fingerprint: 0 };
  for (const file of candidates) {
    const props = file.appProperties;
    const hasOperationTag = Object.prototype.hasOwnProperty.call(props ?? {}, 'claimCenterOperationId');
    const uploadedAt = Date.parse(props?.claimCenterUploadedAt ?? '');
    const versionedName = typeof file.name === 'string' ? /^\[FINAL_v([1-9]\d*)\] (.+)$/u.exec(file.name) : null;
    const originalName = versionedName?.[2] ?? '';
    if (props?.claimCenterCaseId !== input.caseId || props.claimCenterCategory !== input.category
      || props.claimCenterUploadedBy !== input.uploadedById
      || (exactOperation ? props.claimCenterOperationId !== input.operationId : hasOperationTag)) { rejected.attribution++; continue; }
    if (uploadedAt < start || uploadedAt > end || !Number.isFinite(uploadedAt)) { rejected.time++; continue; }
    if (!/^[0-9a-f-]{36}$/iu.test(props.claimCenterEvidenceId ?? '')) { rejected.evidenceId++; continue; }
    // Later versions are attributable only through the persisted operation ID.
    // Untagged historical uploads retain the original v1-only boundary.
    if (!versionedName || !Number.isSafeInteger(Number(versionedName[1])) || (!exactOperation && versionedName[1] !== '1')) { rejected.version++; continue; }
    const fingerprint = await sha256Hex(`${input.caseId}:${input.category}:${originalName}:${file.mimeType}:${Number(file.size)}:${props.sha256}`);
    if (fingerprint === input.requestFingerprint) matches.push(file);
    else rejected.fingerprint++;
  }
  if (matches.length !== 1) return { receipt: null, reasonCode: matches.length ? 'AMBIGUOUS_MATCH' : 'NO_FINGERPRINT_MATCH', stage: 'CANDIDATE_MATCH',
    diagnostics: { candidateCount: candidates.length, matchedCount: matches.length, rejected } };
  const file = matches[0];
  if (!await verifyDriveUploadBytes(fetcher, input.accessToken, file)) return { receipt: null, reasonCode: 'BYTES_MISMATCH', stage: 'CONTENT_VERIFY' };
  // Confirm the parent belongs to this project; never create/move a folder while inspecting.
  const folder = await driveUploadCheckJson(fetcher, input.accessToken, new URL(`${GOOGLE_DRIVE_API}/files/${encodeURIComponent(file.parents[0])}?fields=id,mimeType,trashed,parents,appProperties`), 'Google Drive parent folder verification');
  const folderProps = folder.appProperties as Record<string, unknown> | undefined;
  if (folder.id !== file.parents[0] || folder.mimeType !== 'application/vnd.google-apps.folder' || folder.trashed !== false
    || folderProps?.claimCenterCaseId !== input.caseId || folderProps.claimCenterFolderKind !== input.category
    || folderProps.claimCenterPeriod !== `${file.appProperties.claimCenterUploadedAt.slice(0, 10)}_${input.uploadedById}`
    || !Array.isArray(folder.parents) || folder.parents.length !== 1 || typeof folder.parents[0] !== 'string' || !GOOGLE_ID.test(folder.parents[0])) return { receipt: null, reasonCode: 'PARENT_MISMATCH', stage: 'PARENT_VERIFY' };
  const root = await driveUploadCheckJson(fetcher, input.accessToken, new URL(`${GOOGLE_DRIVE_API}/files/${encodeURIComponent(folder.parents[0])}?fields=id,mimeType,trashed,appProperties`), 'Google Drive project root verification');
  const rootProps = root.appProperties as Record<string, unknown> | undefined;
  if (root.id !== folder.parents[0] || root.mimeType !== 'application/vnd.google-apps.folder' || root.trashed !== false
    || rootProps?.claimCenterCaseId !== input.caseId || rootProps.claimCenterFolderKind !== 'PROJECT_ROOT') return { receipt: null, reasonCode: 'PROJECT_ROOT_MISMATCH', stage: 'ROOT_VERIFY' };
  return { reasonCode: 'VERIFIED', stage: 'COMPLETE', receipt: {
    fileId: file.id, evidenceId: file.appProperties.claimCenterEvidenceId, originalName: file.name.replace(/^\[FINAL_v[1-9]\d*\] /u, ''), mimeType: file.mimeType,
    byteSize: Number(file.size), sha256: file.appProperties.sha256, folderId: file.parents[0], uploadedAt: file.appProperties.claimCenterUploadedAt } };
}

export async function uploadEvidenceToDrive(
  fetcher: GoogleFetch,
  input: { accessToken: string; folderId: string; evidenceId: string; fileName: string; mimeType: string; sha256: string; bytes: Uint8Array; caseId?: string; category?: string; uploadedById?: string; uploadedAt?: string; operationId?: string }
): Promise<{ fileId: string; name: string; webViewLink: string | null }> {
  if (input.operationId !== undefined && !/^[0-9a-f-]{36}$/iu.test(input.operationId)) throw new GoogleDriveError('INVALID_UPLOAD_OPERATION', 409, '유효한 업로드 작업번호가 필요합니다.');
  const boundary = `claim-center-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name: input.fileName,
    parents: [input.folderId],
    appProperties: {
      claimCenterEvidenceId: input.evidenceId,
      ...(input.operationId ? { claimCenterOperationId: input.operationId } : {}),
      sha256: input.sha256,
      ...(input.caseId ? { claimCenterCaseId: input.caseId } : {}),
      ...(input.category ? { claimCenterCategory: input.category } : {}),
      ...(input.uploadedById ? { claimCenterUploadedBy: input.uploadedById } : {}),
      ...(input.uploadedAt ? { claimCenterUploadedAt: input.uploadedAt } : {})
    }
  });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`,
    new Uint8Array(input.bytes).buffer,
    `\r\n--${boundary}--\r\n`
  ]);
  const controller = new AbortController();
  let requestStage: 'HEADERS' | 'BODY' = 'HEADERS';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
  return await Promise.race([
  (async () => {
  const response = await fetcher(`${GOOGLE_DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink`, {
    method: 'POST',
    signal: controller.signal,
    headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  }).catch(() => {
    throw new GoogleDriveError('GOOGLE_TIMEOUT', 504, 'Google Drive request timed out', true);
  });
  if (!response.ok) throw providerFailure(response, 'Google Drive upload', true);
  requestStage = 'BODY';
  // A successful upload may already exist remotely even when its receipt is unreadable.
  const payload = await safeJson(response).catch(() => {
    throw new GoogleDriveError('GOOGLE_MALFORMED_RESPONSE', 502, 'Google Drive returned invalid upload metadata', true);
  });
  const providerSize = typeof payload.size === 'string' ? Number(payload.size) : payload.size;
  if (typeof payload.id !== 'string' || !GOOGLE_ID.test(payload.id) || payload.name !== input.fileName || payload.mimeType !== input.mimeType || providerSize !== input.bytes.length) {
    throw new GoogleDriveError('GOOGLE_MALFORMED_RESPONSE', 502, 'Google Drive returned invalid file metadata', true);
  }
  return { fileId: payload.id, name: payload.name, webViewLink: typeof payload.webViewLink === 'string' ? payload.webViewLink : null };
  })(),
  new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new GoogleDriveError('GOOGLE_TIMEOUT', 504, 'Google Drive upload response timed out', true));
      controller.abort();
    }, 20_000);
  })
  ]);
  } catch (reason) {
    clearTimeout(timer);
    controller.abort();
    if (reason instanceof GoogleDriveError) reason.requestStage ??= requestStage;
    if (reason instanceof GoogleDriveError && ['GOOGLE_TIMEOUT', 'GOOGLE_MALFORMED_RESPONSE'].includes(reason.code)) {
      try {
        const files = await driveUploadCandidates(fetcher, input.accessToken, `appProperties has { key='claimCenterEvidenceId' and value='${driveQueryValue(input.evidenceId)}' }`);
        const file = files.length === 1 ? files[0] : null;
        const props = file?.appProperties;
        if (file && file.name === input.fileName && file.mimeType === input.mimeType && Number(file.size) === input.bytes.length
          && props?.claimCenterEvidenceId === input.evidenceId && props.sha256 === input.sha256
          && (!input.operationId || props.claimCenterOperationId === input.operationId)
          && (!input.caseId || props.claimCenterCaseId === input.caseId) && (!input.category || props.claimCenterCategory === input.category)
          && (!input.uploadedById || props.claimCenterUploadedBy === input.uploadedById) && (!input.uploadedAt || props.claimCenterUploadedAt === input.uploadedAt)
          && file.parents?.length === 1 && file.parents[0] === input.folderId && await verifyDriveUploadBytes(fetcher, input.accessToken, file)) {
          return { fileId: file.id, name: file.name, webViewLink: file.webViewLink ?? null };
        }
      } catch { /* Keep the original uncertain outcome; never repeat an external write. */ }
    }
    throw reason;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export async function readTemplateDownloadBody(response: Response, size: number, timeoutMs = 20_000): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_REPORT_TEMPLATE_BYTES || !response.body) {
    throw new GoogleDriveError('TEMPLATE_SOURCE_INTEGRITY_MISMATCH', 409, 'Report template source size is invalid');
  }
  const reader = response.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const bytes = new Uint8Array(size); let offset = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (offset + chunk.value.length > size) throw new GoogleDriveError('TEMPLATE_SOURCE_INTEGRITY_MISMATCH', 409, 'Report template source size differs from its record');
          bytes.set(chunk.value, offset); offset += chunk.value.length;
        }
        if (offset !== size) throw new GoogleDriveError('TEMPLATE_SOURCE_INTEGRITY_MISMATCH', 409, 'Report template source size differs from its record');
        return bytes;
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new GoogleDriveError('GOOGLE_TIMEOUT', 504, 'Google Drive download body timed out')), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

export async function downloadEvidenceFromDrive(fetcher: GoogleFetch, accessToken: string, fileId: string): Promise<Response> {
  if (!GOOGLE_ID.test(fileId)) throw new GoogleDriveError('INVALID_GOOGLE_FILE_ID', 400, 'Google Drive file ID is invalid');
  const response = await fetchWithTimeout(fetcher, `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw providerFailure(response, 'Google Drive download');
  return response;
}

export async function renameEvidenceInDrive(fetcher: GoogleFetch, accessToken: string, fileId: string, name: string): Promise<void> {
  if (!GOOGLE_ID.test(fileId)) throw new GoogleDriveError('INVALID_GOOGLE_FILE_ID', 400, 'Google Drive file ID is invalid');
  const result = await driveJsonRequest(fetcher, `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name })
  }, 'Google Drive version archive', true);
  if (result.id !== fileId || result.name !== name) throw new GoogleDriveError('GOOGLE_MALFORMED_RESPONSE', 502, 'Google Drive archive result needs reconciliation', true);
}
