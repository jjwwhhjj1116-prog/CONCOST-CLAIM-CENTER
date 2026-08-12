export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_OAUTH_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3';
export const GOOGLE_DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
export const MAX_EVIDENCE_BYTES = 10_000_000;

export type GoogleFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class GoogleDriveError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly uncertain = false,
    public readonly retryAfterSeconds: number | null = null
  ) {
    super(message);
  }
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
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer)));
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
  url.searchParams.set('prompt', 'consent');
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
  if (response.status === 401 || response.status === 403) return new GoogleDriveError('GOOGLE_RECONSENT_REQUIRED', 401, 'Google Drive connection must be renewed');
  if (response.status === 429) return new GoogleDriveError('GOOGLE_RATE_LIMITED', 429, 'Google Drive rate limit reached', false, retryAfter);
  return new GoogleDriveError('GOOGLE_PROVIDER_ERROR', response.status >= 500 ? 502 : 400, `${operation} failed`, uncertain && response.status >= 500);
}

export async function exchangeAuthorizationCode(
  fetcher: GoogleFetch,
  input: { clientId: string; clientSecret: string; code: string; verifier: string; redirectUri: string }
): Promise<{ refreshToken: string; scope: string }> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    code_verifier: input.verifier,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri
  });
  const response = await fetchWithTimeout(fetcher, GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!response.ok) throw providerFailure(response, 'Google OAuth exchange');
  const payload = await safeJson(response);
  if (typeof payload.refresh_token !== 'string' || payload.refresh_token.length < 10) {
    throw new GoogleDriveError('GOOGLE_REFRESH_TOKEN_MISSING', 502, 'Google did not return a refresh token');
  }
  const grantedScopes = typeof payload.scope === 'string' ? payload.scope.split(/\s+/u) : [];
  if (!grantedScopes.includes(GOOGLE_DRIVE_SCOPE)) throw new GoogleDriveError('GOOGLE_SCOPE_MISSING', 403, 'Required Google Drive scope was not granted');
  return { refreshToken: payload.refresh_token, scope: GOOGLE_DRIVE_SCOPE };
}

export async function refreshAccessToken(
  fetcher: GoogleFetch,
  input: { clientId: string; clientSecret: string; refreshToken: string }
): Promise<string> {
  const response = await fetchWithTimeout(fetcher, GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: 'refresh_token'
    })
  });
  if (!response.ok) throw providerFailure(response, 'Google token refresh');
  const payload = await safeJson(response);
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
  csv: { mime: 'text/csv', magic: (b) => !b.includes(0) }
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

const GOOGLE_ID = /^[A-Za-z0-9_-]{10,200}$/u;

export async function verifyDriveFolder(fetcher: GoogleFetch, accessToken: string, folderId: string): Promise<{ id: string; name: string }> {
  if (!GOOGLE_ID.test(folderId)) throw new GoogleDriveError('INVALID_GOOGLE_FOLDER_ID', 400, 'Google Drive folder ID is invalid');
  const response = await fetchWithTimeout(fetcher, `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,trashed`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw providerFailure(response, 'Google Drive folder verification');
  const payload = await safeJson(response);
  if (payload.id !== folderId || payload.mimeType !== 'application/vnd.google-apps.folder' || payload.trashed === true || typeof payload.name !== 'string') {
    throw new GoogleDriveError('INVALID_GOOGLE_FOLDER', 400, 'Selected Google Drive item is not an active folder');
  }
  return { id: folderId, name: payload.name };
}

export async function uploadEvidenceToDrive(
  fetcher: GoogleFetch,
  input: { accessToken: string; folderId: string; evidenceId: string; fileName: string; mimeType: string; sha256: string; bytes: Uint8Array }
): Promise<{ fileId: string; name: string; webViewLink: string | null }> {
  const boundary = `claim-center-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name: input.fileName,
    parents: [input.folderId],
    appProperties: { claimCenterEvidenceId: input.evidenceId, sha256: input.sha256 }
  });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`,
    input.bytes.buffer as ArrayBuffer,
    `\r\n--${boundary}--\r\n`
  ]);
  const response = await fetchWithTimeout(fetcher, `${GOOGLE_DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
  if (!response.ok) throw providerFailure(response, 'Google Drive upload', true);
  const payload = await safeJson(response);
  const providerSize = typeof payload.size === 'string' ? Number(payload.size) : payload.size;
  if (typeof payload.id !== 'string' || !GOOGLE_ID.test(payload.id) || payload.name !== input.fileName || payload.mimeType !== input.mimeType || providerSize !== input.bytes.length) {
    throw new GoogleDriveError('GOOGLE_MALFORMED_RESPONSE', 502, 'Google Drive returned invalid file metadata', true);
  }
  return { fileId: payload.id, name: payload.name, webViewLink: typeof payload.webViewLink === 'string' ? payload.webViewLink : null };
}

export async function downloadEvidenceFromDrive(fetcher: GoogleFetch, accessToken: string, fileId: string): Promise<Response> {
  if (!GOOGLE_ID.test(fileId)) throw new GoogleDriveError('INVALID_GOOGLE_FILE_ID', 400, 'Google Drive file ID is invalid');
  const response = await fetchWithTimeout(fetcher, `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw providerFailure(response, 'Google Drive download');
  return response;
}
