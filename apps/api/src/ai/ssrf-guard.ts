import * as net from 'node:net';

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

/**
 * Validates a target base URL to prevent SSRF vulnerabilities.
 * Enforces HTTPS protocol (unless explicit local fake mode) and blocks private/loopback/metadata IP ranges.
 */
export function assertSafeBaseUrl(urlStr: string, isLocalFake = false): void {
  if (isLocalFake) {
    // Local Fake provider bypasses network calls
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new SsrfError('Invalid URL format');
  }

  if (parsed.protocol !== 'https:') {
    throw new SsrfError('Only HTTPS protocol is permitted for external AI provider endpoints');
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block obvious localhost / loopback names
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'loopback') {
    throw new SsrfError('Loopback hostnames are forbidden for external AI endpoints');
  }

  // Check IP addresses
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new SsrfError(`Private or metadata IP range (${hostname}) is forbidden`);
    }
  }
}

/**
 * Checks whether an IP address falls within private, loopback, or link-local/metadata ranges.
 */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;
    // 10.0.0.0/8 (Private)
    if (a === 10) return true;
    // 172.16.0.0/12 (Private)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 (Private)
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16 (Link-local / Cloud Metadata)
    if (a === 169 && b === 254) return true;
    // 0.0.0.0/8
    if (a === 0) return true;
    return false;
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    // ::1 (Loopback)
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
    // fe80::/10 (Link-local)
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
    // fc00::/7 (Unique local address)
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    return false;
  }

  return false;
}
