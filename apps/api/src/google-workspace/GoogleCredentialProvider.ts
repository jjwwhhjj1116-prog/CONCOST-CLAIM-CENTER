import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface GoogleOAuthCredential {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  grantedScopes: string[];
  tokenType: 'Bearer';
}

export interface GoogleCredentialProvider {
  createCredential(organizationId: string, credential: GoogleOAuthCredential): Promise<string>;
  resolveCredential(organizationId: string, secretRef: string): Promise<GoogleOAuthCredential | null>;
  replaceCredential(organizationId: string, secretRef: string, credential: GoogleOAuthCredential): Promise<void>;
  deleteCredential(organizationId: string, secretRef: string): Promise<void>;
}

function assertOrganizationId(organizationId: string): void {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(organizationId)) throw new Error('Google credential organization is invalid');
}

function copyCredential(credential: GoogleOAuthCredential): GoogleOAuthCredential {
  return {
    accessToken: credential.accessToken,
    refreshToken: credential.refreshToken,
    expiresAt: new Date(credential.expiresAt.getTime()),
    grantedScopes: [...credential.grantedScopes],
    tokenType: 'Bearer'
  };
}

function assertCredential(credential: GoogleOAuthCredential): void {
  if (!credential.accessToken || !credential.refreshToken) throw new Error('Google OAuth credential material is incomplete');
  if (!(credential.expiresAt instanceof Date) || !Number.isFinite(credential.expiresAt.getTime())) {
    throw new Error('Google OAuth credential expiry is invalid');
  }
  if (credential.tokenType !== 'Bearer') throw new Error('Google OAuth token type is unsupported');
  if (!Array.isArray(credential.grantedScopes) || credential.grantedScopes.some((scope) => typeof scope !== 'string' || !scope)) {
    throw new Error('Google OAuth granted scopes are invalid');
  }
}

/**
 * Test/development credential vault. Production servers should inject a KMS or
 * secret-manager backed implementation of GoogleCredentialProvider.
 */
export class MemoryGoogleCredentialProvider implements GoogleCredentialProvider {
  private readonly credentials = new Map<string, { organizationId: string; credential: GoogleOAuthCredential }>();

  public async createCredential(organizationId: string, credential: GoogleOAuthCredential): Promise<string> {
    assertOrganizationId(organizationId);
    assertCredential(credential);
    const secretRef = `SECREF_GOOGLE_${crypto.randomBytes(24).toString('base64url').toUpperCase()}`;
    this.credentials.set(secretRef, { organizationId, credential: copyCredential(credential) });
    return secretRef;
  }

  public async resolveCredential(organizationId: string, secretRef: string): Promise<GoogleOAuthCredential | null> {
    assertOrganizationId(organizationId);
    const entry = this.credentials.get(secretRef);
    return entry?.organizationId === organizationId ? copyCredential(entry.credential) : null;
  }

  public async replaceCredential(organizationId: string, secretRef: string, credential: GoogleOAuthCredential): Promise<void> {
    assertOrganizationId(organizationId);
    const entry = this.credentials.get(secretRef);
    if (!entry || entry.organizationId !== organizationId) throw new Error('Google credential reference was not found');
    assertCredential(credential);
    this.credentials.set(secretRef, { organizationId, credential: copyCredential(credential) });
  }

  public async deleteCredential(organizationId: string, secretRef: string): Promise<void> {
    assertOrganizationId(organizationId);
    const entry = this.credentials.get(secretRef);
    if (entry?.organizationId === organizationId) this.credentials.delete(secretRef);
  }

  public getRedactedSnapshot(): Array<{ organizationId: string; secretRef: string; expiresAt: string; grantedScopes: string[]; tokenType: 'Bearer' }> {
    return Array.from(this.credentials.entries()).map(([secretRef, entry]) => ({
      organizationId: entry.organizationId,
      secretRef,
      expiresAt: entry.credential.expiresAt.toISOString(),
      grantedScopes: [...entry.credential.grantedScopes],
      tokenType: 'Bearer'
    }));
  }
}

type EncryptedCredentialEnvelope = {
  version: 1;
  organizationHash: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

class CredentialScopeMismatch extends Error {}

function organizationHash(organizationId: string): string {
  assertOrganizationId(organizationId);
  return crypto.createHash('sha256').update(organizationId, 'utf8').digest('hex');
}

export function decodeGoogleCredentialMasterKey(encoded: string): Buffer {
  const value = encoded.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64url');
  if (key.length !== 32) throw new Error('Google credential master key must be exactly 32 bytes');
  return key;
}

/**
 * Node-server credential vault. Only AES-256-GCM ciphertext is written to disk;
 * the database stores the opaque SECREF identifier. Cloud deployments can inject
 * a KMS-backed provider through the same interface.
 */
export class EncryptedFileGoogleCredentialProvider implements GoogleCredentialProvider {
  readonly #directory: string;
  readonly #masterKey: Buffer;

  public constructor(options: { directory: string; masterKey: Buffer }) {
    if (!path.isAbsolute(options.directory)) throw new Error('Google credential vault directory must be absolute');
    if (options.masterKey.length !== 32) throw new Error('Google credential vault key must be 32 bytes');
    this.#directory = path.resolve(options.directory);
    this.#masterKey = Buffer.from(options.masterKey);
  }

  #credentialPath(secretRef: string): string {
    if (!/^SECREF_GOOGLE_[A-Z0-9_-]{16,120}$/.test(secretRef)) throw new Error('Google credential reference is invalid');
    return path.join(this.#directory, `${secretRef}.vault`);
  }

  #encrypt(organizationId: string, secretRef: string, credential: GoogleOAuthCredential): string {
    assertOrganizationId(organizationId);
    assertCredential(credential);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.#masterKey, iv);
    cipher.setAAD(Buffer.from(`${organizationId}\u0000${secretRef}`, 'utf8'));
    const plaintext = Buffer.from(JSON.stringify({
      organizationId,
      accessToken: credential.accessToken,
      refreshToken: credential.refreshToken,
      expiresAt: credential.expiresAt.toISOString(),
      grantedScopes: credential.grantedScopes,
      tokenType: credential.tokenType
    }), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope: EncryptedCredentialEnvelope = {
      version: 1,
      organizationHash: organizationHash(organizationId),
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url')
    };
    return JSON.stringify(envelope);
  }

  #decrypt(organizationId: string, secretRef: string, serialized: string): GoogleOAuthCredential {
    assertOrganizationId(organizationId);
    let envelope: EncryptedCredentialEnvelope;
    try {
      const parsed: unknown = JSON.parse(serialized);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
      const record = parsed as Record<string, unknown>;
      if (record.version !== 1 || typeof record.organizationHash !== 'string' || typeof record.iv !== 'string' || typeof record.tag !== 'string' || typeof record.ciphertext !== 'string') {
        throw new Error('invalid');
      }
      envelope = record as EncryptedCredentialEnvelope;
    } catch {
      throw new Error('Google credential vault entry is invalid');
    }
    if (envelope.organizationHash !== organizationHash(organizationId)) throw new CredentialScopeMismatch('Google credential organization mismatch');
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.#masterKey, Buffer.from(envelope.iv, 'base64url'));
      decipher.setAAD(Buffer.from(`${organizationId}\u0000${secretRef}`, 'utf8'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
        decipher.final()
      ]).toString('utf8');
      const parsed: unknown = JSON.parse(plaintext);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
      const record = parsed as Record<string, unknown>;
      if (record.organizationId !== organizationId) throw new CredentialScopeMismatch('Google credential organization mismatch');
      const credential: GoogleOAuthCredential = {
        accessToken: typeof record.accessToken === 'string' ? record.accessToken : '',
        refreshToken: typeof record.refreshToken === 'string' ? record.refreshToken : '',
        expiresAt: typeof record.expiresAt === 'string' ? new Date(record.expiresAt) : new Date(Number.NaN),
        grantedScopes: Array.isArray(record.grantedScopes) && record.grantedScopes.every((scope) => typeof scope === 'string')
          ? [...record.grantedScopes] as string[]
          : [],
        tokenType: record.tokenType === 'Bearer' ? 'Bearer' : ('' as 'Bearer')
      };
      assertCredential(credential);
      return credential;
    } catch (error) {
      if (error instanceof CredentialScopeMismatch) throw error;
      throw new Error('Google credential vault entry cannot be decrypted');
    }
  }

  async #prepareDirectory(): Promise<void> {
    await fs.mkdir(this.#directory, { recursive: true, mode: 0o700 });
  }

  public async createCredential(organizationId: string, credential: GoogleOAuthCredential): Promise<string> {
    assertOrganizationId(organizationId);
    assertCredential(credential);
    await this.#prepareDirectory();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const secretRef = `SECREF_GOOGLE_${crypto.randomBytes(24).toString('base64url').toUpperCase()}`;
      try {
        await fs.writeFile(this.#credentialPath(secretRef), this.#encrypt(organizationId, secretRef, credential), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        return secretRef;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    throw new Error('Google credential reference allocation failed');
  }

  public async resolveCredential(organizationId: string, secretRef: string): Promise<GoogleOAuthCredential | null> {
    assertOrganizationId(organizationId);
    try {
      const serialized = await fs.readFile(this.#credentialPath(secretRef), 'utf8');
      return copyCredential(this.#decrypt(organizationId, secretRef, serialized));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof CredentialScopeMismatch) return null;
      throw error;
    }
  }

  public async replaceCredential(organizationId: string, secretRef: string, credential: GoogleOAuthCredential): Promise<void> {
    assertOrganizationId(organizationId);
    assertCredential(credential);
    await this.#prepareDirectory();
    const destination = this.#credentialPath(secretRef);
    try {
      const existing = await fs.readFile(destination, 'utf8');
      this.#decrypt(organizationId, secretRef, existing);
    } catch { throw new Error('Google credential reference was not found'); }
    const temporary = `${destination}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
      await fs.writeFile(temporary, this.#encrypt(organizationId, secretRef, credential), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, destination);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  public async deleteCredential(organizationId: string, secretRef: string): Promise<void> {
    assertOrganizationId(organizationId);
    const destination = this.#credentialPath(secretRef);
    try {
      const existing = await fs.readFile(destination, 'utf8');
      this.#decrypt(organizationId, secretRef, existing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new Error('Google credential reference was not found');
    }
    await fs.rm(destination, { force: true });
  }
}
