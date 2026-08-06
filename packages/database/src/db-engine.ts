import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';
import initSqlJs from 'sql.js';

const packageRoot = path.resolve(__dirname, '..');
export const defaultDbPath = path.join(packageRoot, '.data', 'dev.db');
export const schemaPath = path.join(packageRoot, 'prisma', 'schema.prisma');

export function databaseUrlFor(filePath = defaultDbPath): string {
  const relativeToSchema = path.relative(path.dirname(schemaPath), path.resolve(filePath)).replace(/\\/g, '/');
  return `file:${relativeToSchema}`;
}

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL || databaseUrlFor();
}

export function createPrismaClient(databaseUrl = getDatabaseUrl()): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

function databasePathFromUrl(databaseUrl: string): string {
  if (!databaseUrl.startsWith('file:')) {
    throw new Error('P04 reset supports SQLite file: URLs only.');
  }
  const rawPath = databaseUrl.slice('file:'.length);
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(path.dirname(schemaPath), rawPath);
}

export async function migrateDatabase(databaseUrl = getDatabaseUrl()): Promise<void> {
  const filePath = databasePathFromUrl(databaseUrl);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const SQL = await initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  const sqlite = fs.existsSync(filePath) ? new SQL.Database(fs.readFileSync(filePath)) : new SQL.Database();
  try {
    sqlite.run('PRAGMA foreign_keys = ON');
    sqlite.run('CREATE TABLE IF NOT EXISTS "_P04Migration" ("name" TEXT NOT NULL PRIMARY KEY, "checksum" TEXT NOT NULL, "appliedAt" TEXT NOT NULL)');
    const migrationName = '20260806070000_p04_baseline';
    const migrationPath = path.join(packageRoot, 'prisma', 'migrations', migrationName, 'migration.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    const checksum = crypto.createHash('sha256').update(migrationSql).digest('hex');
    const applied = sqlite.exec(`SELECT "checksum" FROM "_P04Migration" WHERE "name" = '${migrationName}'`);
    if (applied.length === 0) {
      sqlite.run('BEGIN IMMEDIATE');
      try {
        sqlite.run(migrationSql);
        sqlite.run('INSERT INTO "_P04Migration" ("name", "checksum", "appliedAt") VALUES (?, ?, ?)', [migrationName, checksum, new Date().toISOString()]);
        sqlite.run('COMMIT');
      } catch (error) {
        sqlite.run('ROLLBACK');
        throw error;
      }
    } else if (String(applied[0].values[0][0]) !== checksum) {
      throw new Error(`Migration checksum mismatch: ${migrationName}`);
    }
    fs.writeFileSync(filePath, Buffer.from(sqlite.export()));
  } finally {
    sqlite.close();
  }
}

export async function resetDatabase(databaseUrl = getDatabaseUrl()): Promise<void> {
  const filePath = databasePathFromUrl(databaseUrl);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  for (const suffix of ['', '-journal', '-shm', '-wal']) {
    fs.rmSync(`${filePath}${suffix}`, { force: true });
  }
  await migrateDatabase(databaseUrl);
}
