export interface ErpBridgeCredential {
  url: string;
  secret: string;
}

export interface ErpProjectSyncResult {
  erpProjectId: string;
}

export class ErpBridgeError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ErpBridgeError';
  }
}

function normalizeHttpsUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('unsafe URL');
    return url.toString();
  } catch {
    throw new ErpBridgeError('ERP_BRIDGE_URL_INVALID', 'ERP project webhook must be an HTTPS URL without credentials or a fragment.');
  }
}

async function hmacSha256Hex(secret: string, text: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(text));
  return [...new Uint8Array(signature)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function registerProjectInErp(
  fetcher: typeof fetch,
  credential: ErpBridgeCredential,
  payload: Record<string, unknown>,
  idempotencyKey: string
): Promise<ErpProjectSyncResult> {
  const url = normalizeHttpsUrl(credential.url);
  if (credential.secret.trim().length < 16) throw new ErpBridgeError('ERP_BRIDGE_SECRET_INVALID', 'ERP webhook secret is missing or too short.');
  const body = JSON.stringify(payload);
  const timestamp = new Date().toISOString();
  const signature = await hmacSha256Hex(credential.secret, `${timestamp}.${body}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'X-CONCOST-Timestamp': timestamp,
        'X-CONCOST-Signature': `sha256=${signature}`
      },
      body,
      signal: controller.signal
    });
    if (!response.ok) throw new ErpBridgeError(`ERP_HTTP_${response.status}`, `ERP returned HTTP ${response.status}.`);
    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    const erpProjectId = typeof result?.projectId === 'string' ? result.projectId : typeof result?.id === 'string' ? result.id : '';
    if (!erpProjectId.trim()) throw new ErpBridgeError('ERP_RESPONSE_INVALID', 'ERP did not return a projectId.');
    return { erpProjectId: erpProjectId.trim() };
  } catch (reason) {
    if (reason instanceof ErpBridgeError) throw reason;
    if (reason instanceof DOMException && reason.name === 'AbortError') throw new ErpBridgeError('ERP_TIMEOUT', 'ERP project registration timed out.');
    throw new ErpBridgeError('ERP_NETWORK_ERROR', 'ERP project registration could not reach the configured endpoint.');
  } finally {
    clearTimeout(timeout);
  }
}
