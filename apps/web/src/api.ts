/// <reference types="vite/client" />

declare global {
  interface Window {
    __CLAIM_API_ORIGIN__?: string;
  }
}

const defaultApiOrigin = typeof window === 'undefined'
  ? 'http://127.0.0.1:3001'
  : ['localhost', '127.0.0.1'].includes(window.location.hostname)
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
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    const csrf = readCookie('csrf_token');
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }
  return headers;
}

export async function apiRequest<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = requestHeaders(init);

  const response = await fetch(`${API_ORIGIN}${pathname}`, { ...init, method, headers, credentials: 'include' });
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
