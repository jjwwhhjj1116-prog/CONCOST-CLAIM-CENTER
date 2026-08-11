import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import {
  createPrismaClient, databaseUrlFor, resetDatabase, seedDatabase, type PrismaClient
} from '@claim-studio/database';
import {
  createApiServer, type ApiServerOptions, type ManagedApiServer
} from '../apps/api/src/server';
import { EncryptedFileGooglePkceVerifierVault } from '../apps/api/src/google-workspace/GoogleCredentialVault';
import { createP09Fixture } from './p09-test-support';

const root = path.resolve(__dirname, '..');

export interface P16TestContext {
  db: PrismaClient;
  apiServer: ManagedApiServer;
  origin: string;
  fixture: Awaited<ReturnType<typeof createP09Fixture>>;
  caseId: string;
  dataRoot: string;
  backupRootDir: string;
  restoreRootDir: string;
  credentialVaultDir: string;
  pkceVaultDir: string;
  databasePath: string;
  databaseUrl: string;
  uploadDir: string;
  backupSigningKey: Buffer;
  restartApi: () => Promise<void>;
  cleanup: () => Promise<void>;
}

export async function startP16Isolated(
  testName: string,
  customOptions: Partial<ApiServerOptions> = {}
): Promise<P16TestContext> {
  const unique = `${testName}-${process.pid}-${Date.now()}`;
  const dataRoot = path.join(root, 'packages/database/.data', unique);
  const databasePath = path.join(dataRoot, 'database', 'claim-center.db');
  const uploadDir = path.join(dataRoot, 'storage');
  const backupRootDir = path.join(dataRoot, 'backups');
  const restoreRootDir = path.join(dataRoot, 'restores');
  const credentialVaultDir = path.join(dataRoot, 'google-credentials');
  const pkceVaultDir = path.join(dataRoot, 'google-pkce');
  const databaseUrl = databaseUrlFor(databasePath);
  const backupSigningKey = crypto.createHash('sha256').update(`P16 backup ${unique}`).digest();
  const pkceMasterKey = crypto.createHash('sha256').update(`P16 PKCE ${unique}`).digest();

  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const db = createPrismaClient(databaseUrl);
  let apiServer: ManagedApiServer;
  let origin = '';

  const startApi = async (): Promise<void> => {
    apiServer = createApiServer({
      databaseUrl,
      databasePath,
      volumeRootDir: dataRoot,
      allowedOrigins: ['http://127.0.0.1:3000'],
      secureCookies: false,
      uploadDir,
      backupRootDir,
      restoreRootDir,
      credentialVaultDir,
      pkceVaultDir,
      backupSigningKey,
      backupStorageRoots: [
        { name: 'google-credentials', sourceDir: credentialVaultDir },
        { name: 'google-pkce', sourceDir: pkceVaultDir }
      ],
      googlePkceVerifierVault: new EncryptedFileGooglePkceVerifierVault({
        directory: pkceVaultDir,
        masterKey: pkceMasterKey
      }),
      allowTestGoogleModes: true,
      ...customOptions
    });
    await new Promise<void>((resolve, reject) => {
      apiServer.once('error', reject);
      apiServer.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${(apiServer.address() as { port: number }).port}`;
  };

  const stopApi = async (): Promise<void> => {
    if (!apiServer?.listening) return;
    await new Promise<void>((resolve) => apiServer.close(() => resolve()));
    await apiServer.waitForDatabaseClose();
  };

  await startApi();
  const fixture = await createP09Fixture(origin, db, {
    sectionCount: 2,
    requestOrigin: 'http://127.0.0.1:3000'
  });
  const reportRow = await db.report.findUniqueOrThrow({ where: { id: fixture.reportId } });

  const context = {
    db,
    get apiServer() { return apiServer; },
    get origin() { return origin; },
    fixture,
    caseId: reportRow.caseId,
    dataRoot,
    backupRootDir,
    restoreRootDir,
    credentialVaultDir,
    pkceVaultDir,
    databasePath,
    databaseUrl,
    uploadDir,
    backupSigningKey,
    restartApi: async () => { await stopApi(); await startApi(); },
    cleanup: async () => {
      await stopApi();
      await db.$disconnect();
      fs.rmSync(dataRoot, { recursive: true, force: true });
    }
  } satisfies P16TestContext;
  return context;
}

export async function requestJson(
  origin: string,
  pathname: string,
  method = 'GET',
  body?: unknown,
  session?: { cookie?: string; csrf?: string } | string
): Promise<{ status: number; body: any; headers: Record<string, string> }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: 'http://127.0.0.1:3000'
  };
  if (session) {
    if (typeof session === 'string') headers.Cookie = session.includes('=') ? session : `sessionToken=${session}`;
    else {
      if (session.cookie) headers.Cookie = session.cookie;
      if (session.csrf) headers['X-CSRF-Token'] = session.csrf;
    }
  }
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => { responseHeaders[key.toLowerCase()] = value; });
  const text = await response.text();
  let responseBody: any;
  try { responseBody = JSON.parse(text); } catch { responseBody = { raw: text }; }
  return { status: response.status, body: responseBody, headers: responseHeaders };
}
