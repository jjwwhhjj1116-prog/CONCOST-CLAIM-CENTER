import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createPrismaClient, type PrismaClient } from '@claim-studio/database';

const BACKUP_SCHEMA_VERSION = 2;
const BACKUP_ID_PATTERN = /^BACKUP-[0-9TZ-]{20,40}-[0-9a-f]{8}$/;
const SAFE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface BackupFileEntry { storageRoot: string; relativePath: string; size: number; sha256: string; createdAt: string; }
export interface BackupMigrationEntry { name: string; checksum: string; }
export interface BackupTriggerEntry { name: string; sqlSha256: string; }
export interface BackupDatabaseEntry {
  relativePath: 'database.db'; size: number; sha256: string;
  migrations: BackupMigrationEntry[]; triggers: BackupTriggerEntry[];
}
export interface BackupManifest {
  schemaVersion: 2; backupId: string; createdAt: string; status: 'READY';
  database: BackupDatabaseEntry; files: BackupFileEntry[]; totalFilesSize: number;
  signatureAlgorithm: 'HMAC-SHA256'; signature: string;
}
export interface BackupStorageRoot { name: string; sourceDir: string; }
export interface BackupCreateOptions {
  backupRootDir: string; uploadDir: string; additionalStorageRoots?: BackupStorageRoot[];
  signingKey: Buffer; db: PrismaClient;
}
export interface RestoreOptions {
  backupId: string; backupRootDir: string; restoreRootDir: string; restoreName: string; signingKey: Buffer;
}

type DatabaseInspection = Pick<BackupDatabaseEntry, 'migrations' | 'triggers'>;

function assertSigningKey(signingKey: Buffer): void {
  if (!Buffer.isBuffer(signingKey) || signingKey.length < 32) throw new Error('Backup signing key must be at least 32 bytes');
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function manifestPayload(manifest: BackupManifest): Omit<BackupManifest, 'signature'> {
  const { signature, ...payload } = manifest; void signature; return payload;
}
function signManifest(manifest: Omit<BackupManifest, 'signature'>, signingKey: Buffer): string {
  return crypto.createHmac('sha256', signingKey).update(canonicalJson(manifest), 'utf8').digest('hex');
}
function safeEqualHex(left: string, right: string): boolean {
  return SHA256_PATTERN.test(left) && SHA256_PATTERN.test(right)
    && crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
function assertContained(rootDir: string, candidatePath: string, label: string): string {
  const root = path.resolve(rootDir); const candidate = path.resolve(candidatePath);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) throw new Error(`${label} escapes its configured root`);
  return candidate;
}
function assertBackupId(backupId: string): void {
  if (!BACKUP_ID_PATTERN.test(backupId)) throw new Error('Backup ID is invalid');
}
function assertSafeName(value: string, label: string): void {
  if (!SAFE_NAME_PATTERN.test(value)) throw new Error(`${label} is invalid`);
}
function normalizeRelativePath(value: string): string {
  if (!value || value.includes('\\') || path.posix.isAbsolute(value)) throw new Error('Backup relative path is invalid');
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) throw new Error('Backup relative path is invalid');
  return normalized;
}
export function computeFileSha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
export function computeBufferSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
export async function createConsistentDbSnapshot(db: PrismaClient, destinationPath: string): Promise<void> {
  const destination = path.resolve(destinationPath); fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) throw new Error('Database snapshot destination already exists');
  await db.$executeRawUnsafe(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
}
async function inspectDatabase(databasePath: string): Promise<DatabaseInspection> {
  const db = createPrismaClient(`file:${path.resolve(databasePath)}`);
  try {
    const integrityRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>('PRAGMA integrity_check');
    const values = integrityRows.flatMap((row) => Object.values(row).map(String));
    if (values.length !== 1 || values[0].toLowerCase() !== 'ok') throw new Error(`SQLite integrity_check failed: ${values.join(', ') || 'no result'}`);
    await db.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    const fkRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>('PRAGMA foreign_key_check');
    if (fkRows.length !== 0) throw new Error(`SQLite foreign_key_check failed with ${fkRows.length} row(s)`);
    const migrations = await db.$queryRawUnsafe<Array<{ name: string; checksum: string }>>('SELECT "name", "checksum" FROM "_P04Migration" ORDER BY "name" ASC');
    if (migrations.length === 0 || migrations.some((item) => !item.name || !SHA256_PATTERN.test(item.checksum))) throw new Error('Migration ledger is missing or invalid');
    const triggerRows = await db.$queryRawUnsafe<Array<{ name: string; sql: string | null }>>("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name ASC");
    if (triggerRows.length === 0 || triggerRows.some((item) => !item.name || !item.sql)) throw new Error('Database trigger inventory is missing or invalid');
    return {
      migrations: migrations.map((item) => ({ name: item.name, checksum: item.checksum })),
      triggers: triggerRows.map((item) => ({ name: item.name, sqlSha256: crypto.createHash('sha256').update(item.sql!, 'utf8').digest('hex') }))
    };
  } finally { await db.$disconnect(); }
}
function copyStorageTree(sourceRoot: string, destinationRoot: string, storageRoot: string): BackupFileEntry[] {
  assertSafeName(storageRoot, 'Storage root name'); const source = path.resolve(sourceRoot);
  if (!fs.existsSync(source)) return [];
  if (!fs.lstatSync(source).isDirectory()) throw new Error(`Storage root is not a directory: ${storageRoot}`);
  const entries: BackupFileEntry[] = [];
  const walk = (current: string, relative = ''): void => {
    for (const dirent of fs.readdirSync(current, { withFileTypes: true })) {
      const nextRelative = normalizeRelativePath((relative ? `${relative}/${dirent.name}` : dirent.name).replace(/\\/g, '/'));
      const sourcePath = assertContained(source, path.join(source, ...nextRelative.split('/')), 'Storage source path');
      const stat = fs.lstatSync(sourcePath);
      if (stat.isSymbolicLink()) throw new Error(`Symbolic links are forbidden in backup storage: ${storageRoot}/${nextRelative}`);
      if (stat.isDirectory()) walk(sourcePath, nextRelative);
      else if (stat.isFile()) {
        const destinationPath = assertContained(destinationRoot, path.join(destinationRoot, storageRoot, ...nextRelative.split('/')), 'Backup storage path');
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
        const copiedStat = fs.statSync(destinationPath);
        entries.push({ storageRoot, relativePath: nextRelative, size: copiedStat.size, sha256: computeFileSha256(destinationPath), createdAt: stat.birthtime.toISOString() });
      } else throw new Error(`Unsupported filesystem entry in backup storage: ${storageRoot}/${nextRelative}`);
    }
  };
  walk(source); return entries;
}
function validateManifestShape(value: unknown): BackupManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Backup manifest must be an object');
  const manifest = value as BackupManifest;
  if (manifest.schemaVersion !== BACKUP_SCHEMA_VERSION || manifest.status !== 'READY' || manifest.signatureAlgorithm !== 'HMAC-SHA256') throw new Error('Backup manifest version or status is invalid');
  assertBackupId(manifest.backupId);
  if (!Number.isFinite(Date.parse(manifest.createdAt))) throw new Error('Backup manifest timestamp is invalid');
  if (!manifest.database || manifest.database.relativePath !== 'database.db' || !Number.isSafeInteger(manifest.database.size) || manifest.database.size <= 0 || !SHA256_PATTERN.test(manifest.database.sha256)) throw new Error('Backup database metadata is invalid');
  if (!Array.isArray(manifest.database.migrations) || !Array.isArray(manifest.database.triggers) || manifest.database.migrations.length === 0 || manifest.database.triggers.length === 0) throw new Error('Backup database inventory is invalid');
  if (!Array.isArray(manifest.files) || !Number.isSafeInteger(manifest.totalFilesSize) || manifest.totalFilesSize < 0 || !SHA256_PATTERN.test(manifest.signature)) throw new Error('Backup file manifest is invalid');
  const seen = new Set<string>(); let total = 0;
  for (const file of manifest.files) {
    assertSafeName(file.storageRoot, 'Storage root name'); normalizeRelativePath(file.relativePath);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || !SHA256_PATTERN.test(file.sha256) || !Number.isFinite(Date.parse(file.createdAt))) throw new Error('Backup file entry is invalid');
    const key = `${file.storageRoot}/${file.relativePath}`; if (seen.has(key)) throw new Error('Backup file entry is duplicated'); seen.add(key); total += file.size;
  }
  if (total !== manifest.totalFilesSize) throw new Error('Backup total file size is inconsistent');
  return manifest;
}
export async function createBackupPackage(options: BackupCreateOptions): Promise<BackupManifest> {
  assertSigningKey(options.signingKey); const root = path.resolve(options.backupRootDir);
  const backupId = `BACKUP-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`; assertBackupId(backupId);
  const backupDir = assertContained(root, path.join(root, backupId), 'Backup package path');
  const preparingDir = assertContained(root, `${backupDir}-PREPARING`, 'Preparing package path');
  fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(preparingDir, { recursive: false });
  try {
    const databasePath = path.join(preparingDir, 'database.db'); await createConsistentDbSnapshot(options.db, databasePath);
    const inspection = await inspectDatabase(databasePath); const databaseStat = fs.statSync(databasePath);
    const roots: BackupStorageRoot[] = [{ name: 'uploads', sourceDir: options.uploadDir }, ...(options.additionalStorageRoots ?? [])];
    const rootNames = new Set<string>(); const storageDestination = path.join(preparingDir, 'storage'); fs.mkdirSync(storageDestination, { recursive: true });
    const files: BackupFileEntry[] = [];
    for (const item of roots) {
      assertSafeName(item.name, 'Storage root name'); if (rootNames.has(item.name)) throw new Error(`Duplicate storage root name: ${item.name}`); rootNames.add(item.name);
      files.push(...copyStorageTree(item.sourceDir, storageDestination, item.name));
    }
    files.sort((a, b) => `${a.storageRoot}/${a.relativePath}`.localeCompare(`${b.storageRoot}/${b.relativePath}`));
    const unsigned: Omit<BackupManifest, 'signature'> = {
      schemaVersion: BACKUP_SCHEMA_VERSION, backupId, createdAt: new Date().toISOString(), status: 'READY',
      database: { relativePath: 'database.db', size: databaseStat.size, sha256: computeFileSha256(databasePath), migrations: inspection.migrations, triggers: inspection.triggers },
      files, totalFilesSize: files.reduce((sum, file) => sum + file.size, 0), signatureAlgorithm: 'HMAC-SHA256'
    };
    const manifest: BackupManifest = { ...unsigned, signature: signManifest(unsigned, options.signingKey) };
    const handle = fs.openSync(path.join(preparingDir, 'manifest.json'), 'wx', 0o600);
    try { fs.writeFileSync(handle, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'); fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
    fs.renameSync(preparingDir, backupDir); return manifest;
  } catch (error) { fs.rmSync(preparingDir, { recursive: true, force: true }); throw error; }
}
function manifestDirectories(backupRootDir: string): string[] {
  const root = path.resolve(backupRootDir); if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && BACKUP_ID_PATTERN.test(entry.name)).map((entry) => assertContained(root, path.join(root, entry.name), 'Backup package path'));
}
export async function listBackupPackages(backupRootDir: string, signingKey: Buffer): Promise<BackupManifest[]> {
  const manifests: BackupManifest[] = [];
  for (const directory of manifestDirectories(backupRootDir)) { const result = await verifyBackupPackage(directory, signingKey); if (result.valid && result.manifest) manifests.push(result.manifest); }
  return manifests.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
export async function pruneBackupsDryRun(backupRootDir: string, signingKey: Buffer, keepCount = 3): Promise<{ keep: BackupManifest[]; pruneCandidates: BackupManifest[] }> {
  if (!Number.isSafeInteger(keepCount) || keepCount < 3 || keepCount > 100) throw new Error('Backup retention count must be an integer between 3 and 100');
  const all = await listBackupPackages(backupRootDir, signingKey); return { keep: all.slice(0, keepCount), pruneCandidates: all.slice(keepCount) };
}
function actualStorageFiles(storageDir: string): string[] {
  if (!fs.existsSync(storageDir)) return []; const results: string[] = [];
  const walk = (current: string, relative = ''): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Backup contains forbidden symbolic link: ${next}`);
      if (entry.isDirectory()) walk(path.join(current, entry.name), next); else if (entry.isFile()) results.push(next.replace(/\\/g, '/')); else throw new Error(`Backup contains unsupported filesystem entry: ${next}`);
    }
  }; walk(storageDir); return results.sort();
}
export async function verifyBackupPackage(backupDir: string, signingKey: Buffer): Promise<{ valid: boolean; errors: string[]; manifest?: BackupManifest }> {
  const errors: string[] = [];
  try {
    assertSigningKey(signingKey); const directory = path.resolve(backupDir); const manifestPath = path.join(directory, 'manifest.json');
    if (!fs.existsSync(manifestPath) || fs.lstatSync(manifestPath).isSymbolicLink()) throw new Error('manifest.json is missing or unsafe');
    const manifest = validateManifestShape(JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown);
    if (path.basename(directory) !== manifest.backupId) throw new Error('Backup directory and manifest ID do not match');
    if (!safeEqualHex(manifest.signature, signManifest(manifestPayload(manifest), signingKey))) throw new Error('Backup manifest signature mismatch');
    const databasePath = assertContained(directory, path.join(directory, manifest.database.relativePath), 'Database snapshot path');
    if (!fs.existsSync(databasePath) || fs.lstatSync(databasePath).isSymbolicLink()) throw new Error('Database snapshot is missing or unsafe');
    const databaseStat = fs.statSync(databasePath);
    if (databaseStat.size !== manifest.database.size || computeFileSha256(databasePath) !== manifest.database.sha256) throw new Error('Database snapshot size or hash mismatch');
    const inspection = await inspectDatabase(databasePath);
    if (canonicalJson(inspection.migrations) !== canonicalJson(manifest.database.migrations)) throw new Error('Migration ledger does not match the signed manifest');
    if (canonicalJson(inspection.triggers) !== canonicalJson(manifest.database.triggers)) throw new Error('Trigger inventory does not match the signed manifest');
    const storageDir = path.join(directory, 'storage'); const expected = manifest.files.map((file) => `${file.storageRoot}/${file.relativePath}`).sort();
    if (canonicalJson(actualStorageFiles(storageDir)) !== canonicalJson(expected)) throw new Error('Backup storage file set does not match the signed manifest');
    for (const file of manifest.files) {
      const relative = normalizeRelativePath(file.relativePath); const filePath = assertContained(storageDir, path.join(storageDir, file.storageRoot, ...relative.split('/')), 'Backup storage file path'); const stat = fs.statSync(filePath);
      if (stat.size !== file.size || computeFileSha256(filePath) !== file.sha256) throw new Error(`Storage file size or hash mismatch: ${file.storageRoot}/${relative}`);
    }
    return { valid: true, errors, manifest };
  } catch (error) { errors.push(error instanceof Error ? error.message : 'Unknown backup verification failure'); return { valid: false, errors }; }
}
export async function restoreBackupPackage(options: RestoreOptions): Promise<{ restoredDir: string; dbPath: string; storageDir: string; manifest: BackupManifest }> {
  assertSigningKey(options.signingKey); assertBackupId(options.backupId); assertSafeName(options.restoreName, 'Restore name');
  const backupRoot = path.resolve(options.backupRootDir); const restoreRoot = path.resolve(options.restoreRootDir);
  const backupDir = assertContained(backupRoot, path.join(backupRoot, options.backupId), 'Backup package path');
  const target = assertContained(restoreRoot, path.join(restoreRoot, options.restoreName), 'Restore target path');
  const preparing = assertContained(restoreRoot, `${target}-PREPARING-${crypto.randomBytes(4).toString('hex')}`, 'Restore preparing path');
  if (fs.existsSync(target)) throw new Error('Restore target already exists'); fs.mkdirSync(restoreRoot, { recursive: true });
  const verification = await verifyBackupPackage(backupDir, options.signingKey);
  if (!verification.valid || !verification.manifest) throw new Error(`Cannot restore corrupted backup package: ${verification.errors.join('; ')}`);
  const manifest = verification.manifest; fs.mkdirSync(preparing, { recursive: false });
  try {
    const restoredDbPath = path.join(preparing, 'database.db'); fs.copyFileSync(path.join(backupDir, manifest.database.relativePath), restoredDbPath, fs.constants.COPYFILE_EXCL);
    const restoredStorageDir = path.join(preparing, 'storage'); fs.mkdirSync(restoredStorageDir, { recursive: true });
    for (const file of manifest.files) {
      const relative = normalizeRelativePath(file.relativePath);
      const source = assertContained(path.join(backupDir, 'storage'), path.join(backupDir, 'storage', file.storageRoot, ...relative.split('/')), 'Restore source path');
      const destination = assertContained(restoredStorageDir, path.join(restoredStorageDir, file.storageRoot, ...relative.split('/')), 'Restore destination path');
      fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    }
    const inspection = await inspectDatabase(restoredDbPath);
    if (computeFileSha256(restoredDbPath) !== manifest.database.sha256 || canonicalJson(inspection.migrations) !== canonicalJson(manifest.database.migrations) || canonicalJson(inspection.triggers) !== canonicalJson(manifest.database.triggers)) throw new Error('Restored database verification failed');
    for (const file of manifest.files) { const destination = path.join(restoredStorageDir, file.storageRoot, ...file.relativePath.split('/')); if (fs.statSync(destination).size !== file.size || computeFileSha256(destination) !== file.sha256) throw new Error('Restored storage verification failed'); }
    fs.renameSync(preparing, target); return { restoredDir: target, dbPath: path.join(target, 'database.db'), storageDir: path.join(target, 'storage'), manifest };
  } catch (error) { fs.rmSync(preparing, { recursive: true, force: true }); throw error; }
}
export function removeBackupPackage(backupRootDir: string, backupId: string): void {
  assertBackupId(backupId); const root = path.resolve(backupRootDir); fs.rmSync(assertContained(root, path.join(root, backupId), 'Backup package path'), { recursive: true, force: true });
}
export function removeRestoredPackage(restoreRootDir: string, restoreName: string): void {
  assertSafeName(restoreName, 'Restore name'); const root = path.resolve(restoreRootDir); fs.rmSync(assertContained(root, path.join(root, restoreName), 'Restore target path'), { recursive: true, force: true });
}
