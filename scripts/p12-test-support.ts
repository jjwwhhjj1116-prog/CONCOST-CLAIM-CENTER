import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createPrismaClient, resetDatabase, seedDatabase, type PrismaClient } from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { createP09Fixture, P09_TEST_ORIGIN, login, type P09Fixture, type TestSession } from './p09-test-support';

const root = path.resolve(__dirname, '..');

export interface P12TestContext {
  db: PrismaClient;
  api: ManagedApiServer;
  origin: string;
  databasePath: string;
  uploadDir: string;
  fixture: P09Fixture;
  foreignSession: TestSession;
}

export async function startP12Isolated(name: string, options: { sectionCount?: number } = {}): Promise<P12TestContext> {
  const unique = `${name}-${process.pid}-${Date.now()}`;
  const databasePath = path.join(root, 'packages/database/.data', `${unique}.db`);
  const uploadDir = path.join(root, 'packages/database/.data', `${unique}-uploads`);
  const databaseUrl = `file:${databasePath}`;
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const db = createPrismaClient(databaseUrl);
  const api = createApiServer({ databaseUrl, allowedOrigins: [P09_TEST_ORIGIN], secureCookies: false, uploadDir, allowTestAiModes: true });
  await new Promise<void>((resolve, reject) => api.once('error', reject).listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  const fixture = await createP09Fixture(origin, db, { sectionCount: options.sectionCount ?? 5 });

  // Login foreign user or create session
  const foreignSession = await login(origin, 'director@example.invalid'); // valid session for testing

  return { db, api, origin, databasePath, uploadDir, fixture, foreignSession };
}

export async function closeP12Isolated(context: P12TestContext): Promise<void> {
  await new Promise<void>((resolve) => context.api.close(() => resolve()));
  await context.api.waitForDatabaseClose();
  await context.db.$disconnect();
  fs.rmSync(context.uploadDir, { recursive: true, force: true });
  for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${context.databasePath}${suffix}`, { force: true });
}
