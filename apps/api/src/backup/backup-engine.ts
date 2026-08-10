import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { type PrismaClient } from '@claim-studio/database';

export interface BackupFileEntry {
  relativePath: string;
  size: number;
  sha256: string;
  createdAt: string;
}

export interface BackupManifest {
  backupId: string;
  createdAt: string;
  status: 'PREPARING' | 'READY' | 'FAILED';
  dbSnapshotFile: string;
  dbMigrationLedgerCount: number;
  dbTriggerCount: number;
  files: BackupFileEntry[];
  totalFilesSize: number;
  masterKeyHash?: string;
}

export interface BackupCreateOptions {
  backupRootDir: string;
  databasePath: string;
  uploadDir: string;
  masterKey?: string;
  db: PrismaClient;
}

export interface RestoreOptions {
  backupId: string;
  backupRootDir: string;
  targetRestoreDir: string;
  masterKey?: string;
  db?: PrismaClient;
}

export function computeFileSha256(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function computeBufferSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Executes a consistent SQLite online backup using `VACUUM INTO`
 */
export async function createConsistentDbSnapshot(db: PrismaClient, destinationPath: string): Promise<void> {
  const destDir = path.dirname(destinationPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  if (fs.existsSync(destinationPath)) {
    fs.unlinkSync(destinationPath);
  }
  // Sanitize path for SQLite SQL string literal
  const safeDest = destinationPath.replace(/'/g, "''");
  await db.$executeRawUnsafe(`VACUUM INTO '${safeDest}'`);
}

/**
 * Scans a directory recursively and builds BackupFileEntry metadata list
 */
export function scanDirectoryFiles(baseDir: string, subDir = ''): BackupFileEntry[] {
  const currentDir = subDir ? path.join(baseDir, subDir) : baseDir;
  if (!fs.existsSync(currentDir)) return [];

  const entries: BackupFileEntry[] = [];
  const files = fs.readdirSync(currentDir, { withFileTypes: true });

  for (const file of files) {
    const relPath = subDir ? path.join(subDir, file.name) : file.name;
    const fullPath = path.join(baseDir, relPath);

    if (file.isDirectory()) {
      entries.push(...scanDirectoryFiles(baseDir, relPath));
    } else if (file.isFile()) {
      const stat = fs.statSync(fullPath);
      entries.push({
        relativePath: relPath.replace(/\\/g, '/'),
        size: stat.size,
        sha256: computeFileSha256(fullPath),
        createdAt: stat.birthtime.toISOString()
      });
    }
  }

  return entries;
}

/**
 * Creates a complete consistent backup package
 */
export async function createBackupPackage(options: BackupCreateOptions): Promise<BackupManifest> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupId = `BACKUP-${timestamp}-${crypto.randomUUID().substring(0, 8)}`;
  const backupDir = path.join(options.backupRootDir, backupId);
  const preparingDir = `${backupDir}-PREPARING`;

  if (!fs.existsSync(options.backupRootDir)) {
    fs.mkdirSync(options.backupRootDir, { recursive: true });
  }

  fs.mkdirSync(preparingDir, { recursive: true });

  try {
    // 1. Consistent SQLite Online Backup via VACUUM INTO
    const dbSnapshotPath = path.join(preparingDir, 'database.db');
    await createConsistentDbSnapshot(options.db, dbSnapshotPath);

    // Get DB Trigger count and Migration count
    const triggerRows: any = await options.db.$queryRawUnsafe(`SELECT count(*) as cnt FROM sqlite_master WHERE type = 'trigger'`);
    const triggerCount = Number(triggerRows[0]?.cnt ?? 0);

    let migrationCount = 0;
    try {
      const migrationRows: any = await options.db.$queryRawUnsafe(`SELECT count(*) as cnt FROM _prisma_migrations`);
      migrationCount = Number(migrationRows[0]?.cnt ?? 0);
    } catch {
      migrationCount = 0;
    }

    // 2. Backup File Storage (Uploads/Artifacts)
    const storageBackupDir = path.join(preparingDir, 'storage');
    fs.mkdirSync(storageBackupDir, { recursive: true });

    if (fs.existsSync(options.uploadDir)) {
      fs.cpSync(options.uploadDir, storageBackupDir, { recursive: true });
    }

    const files = scanDirectoryFiles(storageBackupDir);
    const totalFilesSize = files.reduce((acc, f) => acc + f.size, 0);

    const masterKeyHash = options.masterKey
      ? crypto.createHash('sha256').update(options.masterKey).digest('hex')
      : undefined;

    // 3. Create Manifest
    const manifest: BackupManifest = {
      backupId,
      createdAt: new Date().toISOString(),
      status: 'READY',
      dbSnapshotFile: 'database.db',
      dbMigrationLedgerCount: migrationCount,
      dbTriggerCount: triggerCount,
      files,
      totalFilesSize,
      masterKeyHash
    };

    fs.writeFileSync(path.join(preparingDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    // 4. Atomic Publish: Rename PREPARING -> READY
    fs.renameSync(preparingDir, backupDir);

    return manifest;
  } catch (err) {
    if (fs.existsSync(preparingDir)) {
      fs.rmSync(preparingDir, { recursive: true, force: true });
    }
    throw err;
  }
}

/**
 * Lists all existing ready backup packages
 */
export function listBackupPackages(backupRootDir: string): BackupManifest[] {
  if (!fs.existsSync(backupRootDir)) return [];
  const entries = fs.readdirSync(backupRootDir, { withFileTypes: true });

  const manifests: BackupManifest[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('BACKUP-') && !entry.name.endsWith('-PREPARING')) {
      const manifestPath = path.join(backupRootDir, entry.name, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const content = fs.readFileSync(manifestPath, 'utf8');
          const parsed = JSON.parse(content) as BackupManifest;
          if (parsed.status === 'READY') {
            manifests.push(parsed);
          }
        } catch {
          // ignore corrupted unparseable manifest
        }
      }
    }
  }

  return manifests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Calculates prune dry-run candidates maintaining at least `keepCount` (default 3) latest backups
 */
export function pruneBackupsDryRun(backupRootDir: string, keepCount = 3): { keep: BackupManifest[]; pruneCandidates: BackupManifest[] } {
  const all = listBackupPackages(backupRootDir);
  const keep = all.slice(0, keepCount);
  const pruneCandidates = all.slice(keepCount);
  return { keep, pruneCandidates };
}

/**
 * Verifies backup manifest integrity against stored files
 */
export function verifyBackupPackage(backupDir: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const manifestPath = path.join(backupDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return { valid: false, errors: ['manifest.json not found in backup directory'] };
  }

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    return { valid: false, errors: [`Corrupted manifest.json: ${(e as Error).message}`] };
  }

  // 1. Verify DB snapshot exists & is non-empty
  const dbPath = path.join(backupDir, manifest.dbSnapshotFile);
  if (!fs.existsSync(dbPath)) {
    errors.push(`Database snapshot file missing: ${manifest.dbSnapshotFile}`);
  } else {
    const dbStat = fs.statSync(dbPath);
    if (dbStat.size === 0) errors.push('Database snapshot file is empty (0 bytes)');
  }

  // 2. Verify all file storage entries
  const storageDir = path.join(backupDir, 'storage');
  for (const file of manifest.files) {
    const fullPath = path.join(storageDir, file.relativePath);
    if (!fs.existsSync(fullPath)) {
      errors.push(`Storage file missing: ${file.relativePath}`);
    } else {
      const currentSha = computeFileSha256(fullPath);
      if (currentSha !== file.sha256) {
        errors.push(`Hash mismatch for ${file.relativePath}: expected ${file.sha256}, got ${currentSha}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Restores a backup package to a NEW isolated destination directory (fail-closed, zero overwriting existing paths)
 */
export async function restoreBackupPackage(options: RestoreOptions): Promise<{
  restoredDir: string;
  dbPath: string;
  storageDir: string;
  manifest: BackupManifest;
}> {
  const backupDir = path.join(options.backupRootDir, options.backupId);
  if (!fs.existsSync(backupDir)) {
    throw new Error(`Backup package not found: ${options.backupId}`);
  }

  // Verification before restore
  const verification = verifyBackupPackage(backupDir);
  if (!verification.valid) {
    throw new Error(`Cannot restore corrupted backup package: ${verification.errors.join('; ')}`);
  }

  const manifest: BackupManifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));

  // Verify Master Key if required
  if (manifest.masterKeyHash) {
    if (!options.masterKey) {
      throw new Error('Master key is required to restore this encrypted backup set');
    }
    const keyHash = crypto.createHash('sha256').update(options.masterKey).digest('hex');
    if (keyHash !== manifest.masterKeyHash) {
      throw new Error('Invalid master key provided for backup restoration');
    }
  }

  // Target restore directory MUST NOT pre-exist or be non-empty (Prevent overwrite of active production path)
  if (fs.existsSync(options.targetRestoreDir)) {
    const files = fs.readdirSync(options.targetRestoreDir);
    if (files.length > 0) {
      throw new Error(`Target restore directory '${options.targetRestoreDir}' is not empty. Restoration requires a new clean directory.`);
    }
  } else {
    fs.mkdirSync(options.targetRestoreDir, { recursive: true });
  }

  try {
    // Copy database & files to targetRestoreDir
    const restoredDbPath = path.join(options.targetRestoreDir, 'restored-database.db');
    const restoredStorageDir = path.join(options.targetRestoreDir, 'restored-storage');

    fs.copyFileSync(path.join(backupDir, manifest.dbSnapshotFile), restoredDbPath);
    fs.cpSync(path.join(backupDir, 'storage'), restoredStorageDir, { recursive: true });

    return {
      restoredDir: options.targetRestoreDir,
      dbPath: restoredDbPath,
      storageDir: restoredStorageDir,
      manifest
    };
  } catch (err) {
    // Clean up on failure
    if (fs.existsSync(options.targetRestoreDir)) {
      fs.rmSync(options.targetRestoreDir, { recursive: true, force: true });
    }
    throw err;
  }
}
