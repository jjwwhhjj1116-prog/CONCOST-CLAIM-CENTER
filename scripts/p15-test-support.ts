import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createPrismaClient, resetDatabase, seedDatabase, type PrismaClient } from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { EncryptedFileGooglePkceVerifierVault } from '../apps/api/src/google-workspace/GoogleCredentialVault';
import { createP09Fixture } from './p09-test-support';

const root = path.resolve(__dirname, '..');

export interface P15TestContext {
  db: PrismaClient;
  apiServer: ManagedApiServer;
  origin: string;
  fixture: Awaited<ReturnType<typeof createP09Fixture>>;
  caseId: string;
  backupRootDir: string;
  restoreRootDir: string;
  credentialVaultDir: string;
  pkceVaultDir: string;
  databasePath: string;
  uploadDir: string;
  backupSigningKey: Buffer;
  adminSession: any;
  directorSession: any;
  pmSession: any;
  staffSession: any;
  cleanup: () => Promise<void>;
}

export async function startP15Isolated(testName: string): Promise<P15TestContext> {
  const unique = `${testName}-${process.pid}-${Date.now()}`;
  const dataRoot = path.join(root, 'packages/database/.data', unique);
  const databasePath = path.join(dataRoot, 'database.db');
  const uploadDir = path.join(dataRoot, 'uploads');
  const backupRootDir = path.join(dataRoot, 'backups');
  const restoreRootDir = path.join(dataRoot, 'restores');
  const credentialVaultDir = path.join(dataRoot, 'google-credentials');
  const pkceVaultDir = path.join(dataRoot, 'google-pkce');
  const databaseUrl = `file:${databasePath}`;
  const backupSigningKey = crypto.createHash('sha256').update(`P15 backup key ${unique}`, 'utf8').digest();
  const pkceMasterKey = crypto.createHash('sha256').update(`P15 PKCE key ${unique}`, 'utf8').digest();

  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const db = createPrismaClient(databaseUrl);
  const apiServer = createApiServer({
    databaseUrl,
    databasePath,
    allowedOrigins: ['http://127.0.0.1:3000'],
    secureCookies: false,
    uploadDir,
    allowTestGoogleModes: true,
    backupRootDir,
    restoreRootDir,
    backupSigningKey,
    backupStorageRoots: [
      { name: 'google-credentials', sourceDir: credentialVaultDir },
      { name: 'google-pkce', sourceDir: pkceVaultDir }
    ],
    googlePkceVerifierVault: new EncryptedFileGooglePkceVerifierVault({ directory: pkceVaultDir, masterKey: pkceMasterKey })
  });
  await new Promise<void>((resolve, reject) => {
    apiServer.once('error', reject);
    apiServer.listen(0, '127.0.0.1', () => resolve());
  });
  const origin = `http://127.0.0.1:${(apiServer.address() as { port: number }).port}`;
  const fixture = await createP09Fixture(origin, db, { sectionCount: 2, requestOrigin: 'http://127.0.0.1:3000' });
  const reportRow = await db.report.findUniqueOrThrow({ where: { id: fixture.reportId } });

  const cleanup = async () => {
    await new Promise<void>((resolve) => apiServer.close(() => resolve()));
    await apiServer.waitForDatabaseClose();
    await db.$disconnect();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  };

  return {
    db, apiServer, origin, fixture, caseId: reportRow.caseId,
    backupRootDir, restoreRootDir, credentialVaultDir, pkceVaultDir,
    databasePath, uploadDir, backupSigningKey,
    adminSession: fixture.admin, directorSession: fixture.director,
    pmSession: fixture.pm, staffSession: fixture.staff, cleanup
  };
}

export async function requestJson(
  origin: string,
  pathname: string,
  method = 'GET',
  body?: unknown,
  session?: { cookie?: string; csrf?: string } | string
): Promise<{ status: number; body: any; headers: Record<string, string> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3000' };
  if (session) {
    if (typeof session === 'string') headers.Cookie = session.includes('=') ? session : `sessionToken=${session}`;
    else {
      if (session.cookie) headers.Cookie = session.cookie;
      if (session.csrf) headers['X-CSRF-Token'] = session.csrf;
    }
  }
  const response = await fetch(`${origin}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => { responseHeaders[key.toLowerCase()] = value; });
  const text = await response.text();
  let responseBody: any;
  try { responseBody = JSON.parse(text); } catch { responseBody = { raw: text }; }
  return { status: response.status, body: responseBody, headers: responseHeaders };
}
