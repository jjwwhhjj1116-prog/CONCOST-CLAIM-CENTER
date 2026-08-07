const SECRET_REFERENCE = /^ENV_[A-Z][A-Z0-9_]{1,126}$/;

export function assertSecretReference(secretRef: string, isLocalFake = false): void {
  if (isLocalFake && secretRef === 'LOCAL_FAKE') return;
  if (!SECRET_REFERENCE.test(secretRef)) throw new Error('Secret reference must be an ENV_* identifier; raw secrets are forbidden');
}

/** Resolve only explicit environment references. No fallback secret is embedded in source code. */
export function resolveSecretReference(secretRef: string): string | null {
  assertSecretReference(secretRef);
  return process.env[secretRef.slice(4)] || null;
}

export function secretReferenceHint(secretRef: string): string {
  if (secretRef === 'LOCAL_FAKE') return 'LOCAL_FAKE';
  if (!SECRET_REFERENCE.test(secretRef)) return '[INVALID_REFERENCE]';
  return `${secretRef.slice(0, 8)}…${secretRef.slice(-4)}`;
}

/** Sanitize common credential formats without echoing the matched secret. */
export function redactSecretText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\b(?:sk|key|gsa|ghp|github_pat)-?[a-zA-Z0-9_\-]{12,}\b/g, '[REDACTED_SECRET]')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}
