import { sha256Hex } from './google-drive';

export type MemoryBridgeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface MemoryBridgeCredential {
  baseUrl: string;
  keyId: string;
  hmacKey: string;
}

export interface MemoryBridgeHealth {
  status: 'ready';
  serviceVersion: string;
  hermesRuntime: string;
  schemaVersion: 'CLAIM_MEMORY_V1';
  time: string;
  latencyMs: number;
}

export interface MemoryBridgeRule {
  id: string;
  memoryScope: string;
  scopeKey: string;
  ruleText: string;
  confidence: number;
}

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function normalizeMemoryBridgeBaseUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

async function signedHeaders(credential: MemoryBridgeCredential, method: string, path: string, body: string): Promise<Record<string, string>> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
  const bodySha256 = await sha256Hex(body);
  const key = await crypto.subtle.importKey('raw', encoder.encode(credential.hmacKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodySha256}`;
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(canonical));
  return {
    'Content-Type': 'application/json',
    'X-Claim-Key-Id': credential.keyId,
    'X-Claim-Timestamp': timestamp,
    'X-Claim-Nonce': nonce,
    'X-Claim-Content-SHA256': bodySha256,
    'X-Claim-Signature': base64Url(new Uint8Array(signature))
  };
}

async function callBridge(fetcher: MemoryBridgeFetch, credential: MemoryBridgeCredential, path: string, method: 'GET' | 'POST', payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const body = payload ? JSON.stringify(payload) : '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetcher(`${credential.baseUrl}${path}`, {
      method,
      headers: await signedHeaders(credential, method, path, body),
      ...(body ? { body } : {}),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`MEMORY_BRIDGE_HTTP_${response.status}`);
    const result = await response.json().catch(() => null);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('MEMORY_BRIDGE_INVALID_JSON');
    return result as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkMemoryBridge(fetcher: MemoryBridgeFetch, credential: MemoryBridgeCredential): Promise<MemoryBridgeHealth> {
  const started = Date.now();
  const result = await callBridge(fetcher, credential, '/v1/health', 'GET');
  if (result.status !== 'ready' || result.schemaVersion !== 'CLAIM_MEMORY_V1' || typeof result.serviceVersion !== 'string' || typeof result.hermesRuntime !== 'string' || typeof result.time !== 'string') {
    throw new Error('MEMORY_BRIDGE_HEALTH_SCHEMA_INVALID');
  }
  return {
    status: 'ready',
    serviceVersion: result.serviceVersion,
    hermesRuntime: result.hermesRuntime,
    schemaVersion: 'CLAIM_MEMORY_V1',
    time: result.time,
    latencyMs: Date.now() - started
  };
}

export async function rankMemoryRules(
  fetcher: MemoryBridgeFetch,
  credential: MemoryBridgeCredential,
  context: { organizationId: string; userId: string; caseId: string; claimType: string; chapterCode: string },
  rules: readonly MemoryBridgeRule[]
): Promise<string[]> {
  if (!rules.length) return [];
  const result = await callBridge(fetcher, credential, '/v1/memory/rank', 'POST', {
    requestId: crypto.randomUUID(),
    ...context,
    rules: rules.slice(0, 20).map((rule) => ({ id: rule.id, scope: rule.memoryScope, scopeKey: rule.scopeKey, rule: rule.ruleText.slice(0, 800), confidence: rule.confidence }))
  });
  if (!Array.isArray(result.ranked) || result.ranked.length > 20) throw new Error('MEMORY_BRIDGE_RANK_SCHEMA_INVALID');
  const allowed = new Set(rules.map((rule) => rule.id));
  const ids: string[] = [];
  for (const item of result.ranked) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('MEMORY_BRIDGE_RANK_SCHEMA_INVALID');
    const id = (item as Record<string, unknown>).id;
    const score = (item as Record<string, unknown>).score;
    if (typeof id !== 'string' || !allowed.has(id) || typeof score !== 'number' || score < 0 || score > 1) throw new Error('MEMORY_BRIDGE_RANK_SCHEMA_INVALID');
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
