/// <reference types="vite/client" />

declare global {
  interface Window {
    __CLAIM_API_ORIGIN__?: string;
  }
}

const defaultApiOrigin = typeof window === 'undefined'
  ? 'http://127.0.0.1:3001'
  : ['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port !== '8787'
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : window.location.origin;
const configuredApiOrigin = typeof window === 'undefined' ? undefined : window.__CLAIM_API_ORIGIN__;
export const API_ORIGIN = (configuredApiOrigin ?? defaultApiOrigin).replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly payload: Record<string, unknown> = {}) {
    super(message);
  }
}

function readCookie(name: string): string {
  const entry = document.cookie.split(';').map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}

function requestHeaders(init: RequestInit): Headers {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    const csrf = readCookie('csrf_token');
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }
  return headers;
}

export async function apiRequest<T>(pathname: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = requestHeaders(init);

  const { timeoutMs = 30_000, signal: callerSignal, ...requestInit } = init;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = window.setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${pathname}`, { ...requestInit, method, headers, credentials: 'include', signal: controller.signal });
  } catch (reason) {
    if (controller.signal.aborted && !callerSignal?.aborted) {
      throw new ApiError(504, `서버 응답이 ${Math.ceil(timeoutMs / 1000)}초를 초과했습니다. 최신 데이터를 다시 불러와 저장 여부를 확인한 뒤 재시도해 주세요.`, { code: 'CLIENT_REQUEST_TIMEOUT' });
    }
    throw reason;
  } finally {
    window.clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
  const payload = await response.json().catch(() => ({})) as { error?: string } & Record<string, unknown>;
  if (!response.ok) throw new ApiError(response.status, payload.error ?? `HTTP ${response.status}`, payload);
  return payload as T;
}

export async function apiDownload(pathname: string): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(`${API_ORIGIN}${pathname}`, { credentials: 'include', headers: requestHeaders({}) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new ApiError(response.status, payload.error ?? `HTTP ${response.status}`, payload);
  }
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  return { blob: await response.blob(), filename: encoded ? decodeURIComponent(encoded) : 'download.bin' };
}

export async function apiDownloadPost(pathname: string, body: unknown): Promise<{ blob: Blob; filename: string }> {
  const init: RequestInit = {
    method: 'POST',
    body: JSON.stringify(body)
  };
  const response = await fetch(`${API_ORIGIN}${pathname}`, { credentials: 'include', headers: requestHeaders(init), method: 'POST', body: JSON.stringify(body) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new ApiError(response.status, payload.error ?? `HTTP ${response.status}`, payload);
  }
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  return { blob: await response.blob(), filename: encoded ? decodeURIComponent(encoded) : 'download.bin' };
}

export function triggerBrowserDownload(result: { blob: Blob; filename: string }): void {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 10_000);
}
