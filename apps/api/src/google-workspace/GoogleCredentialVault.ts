import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const PKCE_REF_PATTERN = /^PKCE_[A-Z0-9_]{20,120}$/;
const SCOPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{1,254}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

export interface PkceVerifierScope {
  organizationId: string;
  actorId: string;
  stateHash: string;
}

export interface PkceVerifierCreateInput extends PkceVerifierScope {
  verifier: string;
  expiresAt: Date;
}

export interface GooglePkceVerifierVault {
  createVerifier(input: PkceVerifierCreateInput): Promise<string>;
  resolveVerifier(secretRef: string, scope: PkceVerifierScope, now?: Date): Promise<string | null>;
  deleteVerifier(secretRef: string): Promise<void>;
}

type EncryptedPkceEnvelope = {
  version: 1;
  organizationHash: string;
  actorHash: string;
  stateHash: string;
  expiresAt: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

function assertScope(scope: PkceVerifierScope): void {
  if (!SCOPE_ID_PATTERN.test(scope.organizationId)) throw new Error('PKCE organization binding is invalid');
  if (!SCOPE_ID_PATTERN.test(scope.actorId)) throw new Error('PKCE actor binding is invalid');
  if (!SHA256_PATTERN.test(scope.stateHash)) throw new Error('PKCE state binding is invalid');
}

function assertCreateInput(input: PkceVerifierCreateInput): void {
  assertScope(input);
  if (!VERIFIER_PATTERN.test(input.verifier)) throw new Error('PKCE verifier is invalid');
  if (!(input.expiresAt instanceof Date) || !Number.isFinite(input.expiresAt.getTime()) || input.expiresAt.getTime() <= Date.now()) {
    throw new Error('PKCE verifier expiry is invalid');
  }
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeEqual(left: string, right: string): boolean {
  if (!SHA256_PATTERN.test(left) || !SHA256_PATTERN.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function copyScope(scope: PkceVerifierScope): PkceVerifierScope {
  return { organizationId: scope.organizationId, actorId: scope.actorId, stateHash: scope.stateHash };
}

export class MemoryGooglePkceVerifierVault implements GooglePkceVerifierVault {
  readonly #records = new Map<string, PkceVerifierCreateInput>();

  public async createVerifier(input: PkceVerifierCreateInput): Promise<string> {
    assertCreateInput(input);
    const secretRef = `PKCE_${crypto.randomUUID().replace(/-/g, '_').toUpperCase()}`;
    this.#records.set(secretRef, { ...copyScope(input), verifier: input.verifier, expiresAt: new Date(input.expiresAt) });
    return secretRef;
  }

  public async resolveVerifier(secretRef: string, scope: PkceVerifierScope, now = new Date()): Promise<string | null> {
    assertScope(scope);
    const record = this.#records.get(secretRef);
    if (!record || record.expiresAt <= now || record.organizationId !== scope.organizationId || record.actorId !== scope.actorId || record.stateHash !== scope.stateHash) return null;
    return record.verifier;
  }

  public async deleteVerifier(secretRef: string): Promise<void> {
    this.#records.delete(secretRef);
  }
}

export class EncryptedFileGooglePkceVerifierVault implements GooglePkceVerifierVault {
  readonly #directory: string;
  readonly #key: Buffer;

  public constructor(options: { directory: string; masterKey: Buffer }) {
    if (!path.isAbsolute(options.directory)) throw new Error('PKCE vault directory must be absolute');
    if (!Buffer.isBuffer(options.masterKey) || options.masterKey.length !== 32) throw new Error('PKCE vault master key must be 32 bytes');
    this.#directory = path.resolve(options.directory);
    this.#key = Buffer.from(crypto.hkdfSync('sha256', options.masterKey, Buffer.from('claim-center-pkce-v1'), Buffer.from('pkce-verifier-vault'), 32));
  }

  #path(secretRef: string): string {
    if (!PKCE_REF_PATTERN.test(secretRef)) throw new Error('PKCE verifier reference is invalid');
    return path.join(this.#directory, `${secretRef}.pkce`);
  }

  #aad(secretRef: string, scope: PkceVerifierScope): Buffer {
    return Buffer.from(`${scope.organizationId}\u0000${scope.actorId}\u0000${scope.stateHash}\u0000${secretRef}`, 'utf8');
  }

  async #ensureDirectory(): Promise<void> {
    await fs.mkdir(this.#directory, { recursive: true, mode: 0o700 });
  }

  public async createVerifier(input: PkceVerifierCreateInput): Promise<string> {
    assertCreateInput(input);
    await this.#ensureDirectory();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const secretRef = `PKCE_${crypto.randomUUID().replace(/-/g, '_').toUpperCase()}`;
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', this.#key, iv);
      cipher.setAAD(this.#aad(secretRef, input));
      const ciphertext = Buffer.concat([cipher.update(input.verifier, 'utf8'), cipher.final()]);
      const envelope: EncryptedPkceEnvelope = {
        version: 1,
        organizationHash: hash(input.organizationId),
        actorHash: hash(input.actorId),
        stateHash: input.stateHash,
        expiresAt: input.expiresAt.toISOString(),
        iv: iv.toString('base64url'),
        tag: cipher.getAuthTag().toString('base64url'),
        ciphertext: ciphertext.toString('base64url')
      };
      try {
        await fs.writeFile(this.#path(secretRef), JSON.stringify(envelope), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        return secretRef;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    throw new Error('PKCE verifier reference allocation failed');
  }

  public async resolveVerifier(secretRef: string, scope: PkceVerifierScope, now = new Date()): Promise<string | null> {
    assertScope(scope);
    try {
      const raw = await fs.readFile(this.#path(secretRef), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
      const envelope = parsed as EncryptedPkceEnvelope;
      if (envelope.version !== 1 || !safeEqual(envelope.organizationHash, hash(scope.organizationId)) || !safeEqual(envelope.actorHash, hash(scope.actorId)) || !safeEqual(envelope.stateHash, scope.stateHash)) return null;
      const expiresAt = new Date(envelope.expiresAt);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) return null;
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.#key, Buffer.from(envelope.iv, 'base64url'));
      decipher.setAAD(this.#aad(secretRef, scope));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
      const verifier = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]).toString('utf8');
      return VERIFIER_PATTERN.test(verifier) ? verifier : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error('PKCE verifier entry is corrupt or cannot be decrypted');
    }
  }

  public async deleteVerifier(secretRef: string): Promise<void> {
    await fs.rm(this.#path(secretRef), { force: true });
  }
}
