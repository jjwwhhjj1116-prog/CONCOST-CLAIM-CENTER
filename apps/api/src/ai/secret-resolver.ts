/**
 * Resolves API keys from environment variables or secure vault references.
 * Raw key strings are NEVER stored in DB, written to logs, audit entries, or API responses.
 */
export function resolveSecretReference(secretRef: string): string | null {
  if (!secretRef) return null;

  // Local fake environment key default fallback
  if (secretRef === 'ENV_LOCAL_FAKE_KEY') {
    return process.env.LOCAL_FAKE_AI_KEY || 'fake-synthetic-local-key-secret-value-12345';
  }

  if (secretRef.startsWith('ENV_')) {
    const envKey = secretRef.replace(/^ENV_/, '');
    return process.env[envKey] || null;
  }

  return null;
}

/**
 * Sanitizes and redacts raw secret strings from error messages or logs.
 */
export function redactSecretText(text: string): string {
  if (!text) return '';
  return text
    .replace(/(sk-[a-zA-Z0-9]{20,})/g, '[REDACTED_API_KEY]')
    .replace(/(key-[a-zA-Z0-9]{20,})/g, '[REDACTED_API_KEY]')
    .replace(/(Bearer\s+[a-zA-Z0-9.\-_]+)/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/(gsa_[a-zA-Z0-9]{20,})/g, '[REDACTED_SERVICE_ACCOUNT]');
}
