import * as path from 'node:path';
import * as fs from 'node:fs';
import { createPrismaClient, resetDatabase, seedDatabase, type PrismaClient } from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { createP09Fixture } from './p09-test-support';

const root = path.resolve(__dirname, '..');

export interface P14TestContext {
  db: PrismaClient;
  apiServer: ManagedApiServer;
  origin: string;
  fixture: Awaited<ReturnType<typeof createP09Fixture>>;
  caseId: string;
  adminSession: any;
  directorSession: any;
  pmSession: any;
  staffSession: any;
  cleanup: () => Promise<void>;
}

export async function startP14Isolated(testName: string): Promise<P14TestContext> {
  const unique = `${testName}-${process.pid}-${Date.now()}`;
  const databasePath = path.join(root, 'packages/database/.data', `${unique}.db`);
  const uploadDir = path.join(root, 'packages/database/.data', `${unique}-uploads`);
  const databaseUrl = `file:${databasePath}`;

  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const db = createPrismaClient(databaseUrl);

  const apiServer = createApiServer({
    databaseUrl,
    allowedOrigins: ['http://127.0.0.1:3000'],
    secureCookies: false,
    uploadDir
  });

  await new Promise<void>((resolve, reject) => {
    apiServer.once('error', reject);
    apiServer.listen(0, '127.0.0.1', () => resolve());
  });

  const address = apiServer.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;

  const fixture = await createP09Fixture(origin, db, { sectionCount: 2, requestOrigin: 'http://127.0.0.1:3000' });
  const reportRow = await db.report.findUniqueOrThrow({ where: { id: fixture.reportId } });
  const caseId = reportRow.caseId;
  const adminSession = fixture.admin;
  const directorSession = fixture.director;
  const pmSession = fixture.pm;
  const staffSession = fixture.staff;

  const cleanup = async () => {
    await new Promise<void>((resolve) => apiServer.close(() => resolve()));
    await db.$disconnect();
    try { if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath); } catch {}
    try { if (fs.existsSync(uploadDir)) fs.rmSync(uploadDir, { recursive: true, force: true }); } catch {}
  };

  return {
    db,
    apiServer,
    origin,
    fixture,
    caseId,
    adminSession,
    directorSession,
    pmSession,
    staffSession,
    cleanup
  };
}

export async function requestJson(
  origin: string,
  pathname: string,
  method = 'GET',
  body?: unknown,
  session?: { cookie?: string; csrf?: string } | string
): Promise<{ status: number; body: any; headers: Record<string, string> }> {
  const url = `${origin}${pathname}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Origin': 'http://127.0.0.1:3000'
  };

  if (session) {
    if (typeof session === 'string') {
      headers['Cookie'] = session.includes('=') ? session : `sessionToken=${session}`;
    } else {
      if (session.cookie) headers['Cookie'] = session.cookie;
      if (session.csrf) headers['X-CSRF-Token'] = session.csrf;
    }
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const respHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    respHeaders[key.toLowerCase()] = value;
  });

  let respBody: any = {};
  const text = await response.text();
  try {
    respBody = JSON.parse(text);
  } catch {
    respBody = { raw: text };
  }

  return {
    status: response.status,
    body: respBody,
    headers: respHeaders
  };
}
