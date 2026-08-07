import { promises as dns } from 'node:dns';
import * as net from 'node:net';

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

export type AiProviderKind = 'LOCAL_FAKE' | 'OPENAI' | 'ANTHROPIC' | 'GEMINI';
export type HostResolver = (hostname: string) => Promise<readonly string[]>;

const PROVIDER_HOST_ALLOWLIST: Readonly<Record<Exclude<AiProviderKind, 'LOCAL_FAKE'>, readonly string[]>> = {
  OPENAI: ['api.openai.com'],
  ANTHROPIC: ['api.anthropic.com'],
  GEMINI: ['generativelanguage.googleapis.com']
};

function parseProviderUrl(urlStr: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new SsrfError('Invalid URL format');
  }
  if (parsed.protocol !== 'https:') throw new SsrfError('Only HTTPS is permitted for AI provider endpoints');
  if (parsed.username || parsed.password) throw new SsrfError('Provider URLs must not contain credentials');
  if (parsed.port && parsed.port !== '443') throw new SsrfError('Only TCP port 443 is permitted for external AI providers');
  return parsed;
}

function isLocalName(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local') || normalized === 'loopback';
}

/** Reject private, loopback, link-local, documentation, multicast, and metadata ranges. */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if (a >= 224) return true;
    return false;
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    const mapped = normalized.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped) return isPrivateIp(mapped);
    if (normalized === '::' || normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
    if (/^f[cd]/.test(normalized)) return true;
    if (/^fe[89ab]/.test(normalized)) return true;
    if (normalized.startsWith('ff')) return true;
    if (normalized.startsWith('2001:db8')) return true;
    return false;
  }

  return true;
}

/** Synchronous syntax/allowlist validation. DNS is checked separately immediately before a network call. */
export function assertSafeBaseUrl(urlStr: string, isLocalFake = false, providerKind?: AiProviderKind): void {
  const parsed = parseProviderUrl(urlStr);
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');

  if (isLocalFake || providerKind === 'LOCAL_FAKE') {
    if (hostname !== 'local-fake.invalid') throw new SsrfError('LOCAL_FAKE must use the non-routable local-fake.invalid endpoint');
    return;
  }

  if (isLocalName(hostname)) throw new SsrfError('Loopback and local hostnames are forbidden');
  if (net.isIP(hostname) && isPrivateIp(hostname)) throw new SsrfError(`Non-public address (${hostname}) is forbidden`);

  if (providerKind) {
    const allowedHosts = PROVIDER_HOST_ALLOWLIST[providerKind];
    if (!allowedHosts.includes(hostname)) throw new SsrfError(`${providerKind} endpoint host is not allowlisted`);
  }
}

const defaultResolver: HostResolver = async (hostname) => {
  const answers = await dns.lookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
};

/** DNS-rebinding guard used immediately before every external provider connection. */
export async function assertSafeResolvedBaseUrl(
  urlStr: string,
  providerKind: AiProviderKind,
  resolver: HostResolver = defaultResolver
): Promise<void> {
  assertSafeBaseUrl(urlStr, providerKind === 'LOCAL_FAKE', providerKind);
  if (providerKind === 'LOCAL_FAKE') return;
  const hostname = new URL(urlStr).hostname.toLowerCase().replace(/\.$/, '');
  const addresses = await resolver(hostname);
  if (addresses.length === 0) throw new SsrfError('Provider hostname did not resolve');
  for (const address of addresses) {
    if (!net.isIP(address) || isPrivateIp(address)) throw new SsrfError(`Provider DNS resolved to a forbidden address (${address})`);
  }
}

/** Redirects may not cross provider hosts and are subjected to a fresh DNS check. */
export async function assertSafeRedirectUrl(
  currentUrl: string,
  redirectUrl: string,
  providerKind: Exclude<AiProviderKind, 'LOCAL_FAKE'>,
  resolver: HostResolver = defaultResolver
): Promise<void> {
  const current = parseProviderUrl(currentUrl);
  const next = new URL(redirectUrl, current);
  if (current.hostname.toLowerCase() !== next.hostname.toLowerCase()) throw new SsrfError('Cross-host provider redirects are forbidden');
  await assertSafeResolvedBaseUrl(next.toString(), providerKind, resolver);
}
