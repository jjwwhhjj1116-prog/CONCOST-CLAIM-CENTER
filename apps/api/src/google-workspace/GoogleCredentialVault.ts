import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export interface EncryptedSecretRecord {
  secretRef: string;
  organizationId: string;
  cipherText: string;
  iv: string;
  authTag: string;
  keyVersion: number;
  updatedAt: string;
}

export interface VaultMetadata {
  vaultVersion: number;
  currentKeyVersion: number;
  keyVersionsHash: Record<number, string>;
  records: Record<string, EncryptedSecretRecord>;
}

export class GoogleCredentialVault {
  private vaultPath: string;
  private masterKeys: Map<number, string> = new Map();
  private currentKeyVersion = 1;

  constructor(vaultPath: string, masterKey: string, keyVersion = 1) {
    this.vaultPath = path.resolve(vaultPath);
    this.masterKeys.set(keyVersion, masterKey);
    this.currentKeyVersion = keyVersion;
    this.ensureVaultDirectory();
  }

  private ensureVaultDirectory(): void {
    const dir = path.dirname(this.vaultPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.vaultPath)) {
      const initial: VaultMetadata = {
        vaultVersion: 1,
        currentKeyVersion: this.currentKeyVersion,
        keyVersionsHash: {
          [this.currentKeyVersion]: this.hashMasterKey(this.masterKeys.get(this.currentKeyVersion)!)
        },
        records: {}
      };
      fs.writeFileSync(this.vaultPath, JSON.stringify(initial, null, 2), 'utf8');
    }
  }

  private hashMasterKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  private deriveKey(masterKey: string): Buffer {
    const derived = crypto.hkdfSync('sha256', Buffer.from(masterKey), Buffer.from('vault-salt'), Buffer.from('google-workspace-vault'), 32);
    return Buffer.from(derived);
  }

  public registerKeyVersion(version: number, key: string): void {
    this.masterKeys.set(version, key);
  }

  public readVault(): VaultMetadata {
    try {
      const content = fs.readFileSync(this.vaultPath, 'utf8');
      return JSON.parse(content) as VaultMetadata;
    } catch {
      return {
        vaultVersion: 1,
        currentKeyVersion: this.currentKeyVersion,
        keyVersionsHash: {},
        records: {}
      };
    }
  }

  public writeVault(data: VaultMetadata): void {
    fs.writeFileSync(this.vaultPath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Encrypts and stores a credential token into the vault using AES-256-GCM
   */
  public encryptSecret(secretRef: string, organizationId: string, plainText: string): EncryptedSecretRecord {
    const masterKey = this.masterKeys.get(this.currentKeyVersion);
    if (!masterKey) throw new Error(`Master key version ${this.currentKeyVersion} not available`);

    const derivedKey = this.deriveKey(masterKey);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);

    let cipherText = cipher.update(plainText, 'utf8', 'hex');
    cipherText += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    const record: EncryptedSecretRecord = {
      secretRef,
      organizationId,
      cipherText,
      iv: iv.toString('hex'),
      authTag,
      keyVersion: this.currentKeyVersion,
      updatedAt: new Date().toISOString()
    };

    const vault = this.readVault();
    vault.records[secretRef] = record;
    vault.currentKeyVersion = this.currentKeyVersion;
    vault.keyVersionsHash[this.currentKeyVersion] = this.hashMasterKey(masterKey);
    this.writeVault(vault);

    return record;
  }

  /**
   * Decrypts a stored secret using the corresponding key version
   */
  public decryptSecret(secretRef: string): string {
    const vault = this.readVault();
    const record = vault.records[secretRef];
    if (!record) throw new Error(`Secret reference not found in vault: ${secretRef}`);

    const masterKey = this.masterKeys.get(record.keyVersion);
    if (!masterKey) throw new Error(`Master key version ${record.keyVersion} missing for secret decryption`);

    const derivedKey = this.deriveKey(masterKey);
    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, Buffer.from(record.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(record.authTag, 'hex'));

    const decrypted = Buffer.concat([decipher.update(Buffer.from(record.cipherText, 'hex')), decipher.final()]);
    return decrypted.toString('utf8');
  }

  /**
   * Rotates master key version and re-encrypts all stored vault secrets
   */
  public rotateMasterKey(newVersion: number, newMasterKey: string): { reEncryptedCount: number } {
    if (this.masterKeys.has(newVersion)) throw new Error(`Key version ${newVersion} already exists`);
    this.masterKeys.set(newVersion, newMasterKey);

    const vault = this.readVault();
    let reEncryptedCount = 0;

    for (const secretRef of Object.keys(vault.records)) {
      const plainText = this.decryptSecret(secretRef);
      const orgId = vault.records[secretRef].organizationId;

      // Re-encrypt under new key version
      const oldCurrent = this.currentKeyVersion;
      this.currentKeyVersion = newVersion;
      this.encryptSecret(secretRef, orgId, plainText);
      this.currentKeyVersion = oldCurrent;

      reEncryptedCount++;
    }

    this.currentKeyVersion = newVersion;
    vault.currentKeyVersion = newVersion;
    vault.keyVersionsHash[newVersion] = this.hashMasterKey(newMasterKey);
    this.writeVault(vault);

    return { reEncryptedCount };
  }
}
