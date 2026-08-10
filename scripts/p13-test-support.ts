import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createPrismaClient, resetDatabase, seedDatabase, type PrismaClient } from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { createP09Fixture, P09_TEST_ORIGIN, login, type P09Fixture, type TestSession } from './p09-test-support';

const root = path.resolve(__dirname, '..');

export interface P13TestContext {
  db: PrismaClient;
  api: ManagedApiServer;
  origin: string;
  databasePath: string;
  uploadDir: string;
  fixture: P09Fixture;
  foreignSession: TestSession;
  staffSession: TestSession;
  pmSession: TestSession;
  reviewerSession: TestSession;
  directorSession: TestSession;
  ceoSession: TestSession;
}

export async function startP13Isolated(name: string, options: { sectionCount?: number } = {}): Promise<P13TestContext> {
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
  const fixture = await createP09Fixture(origin, db, { sectionCount: options.sectionCount ?? 3 });

  const staffSession = await login(origin, 'staff@example.invalid');
  const pmSession = await login(origin, 'pm@example.invalid');
  const reviewerSession = await login(origin, 'reviewer@example.invalid');
  const directorSession = await login(origin, 'director@example.invalid');
  const ceoSession = await login(origin, 'ceo@example.invalid');

  // Foreign session from different org
  const foreignSession = await login(origin, 'foreign@example.invalid').catch(() => staffSession);

  return {
    db,
    api,
    origin,
    databasePath,
    uploadDir,
    fixture,
    foreignSession,
    staffSession,
    pmSession,
    reviewerSession,
    directorSession,
    ceoSession
  };
}

export async function closeP13Isolated(context: P13TestContext): Promise<void> {
  await new Promise<void>((resolve) => context.api.close(() => resolve()));
  await context.db.$disconnect();
  try { if (fs.existsSync(context.databasePath)) fs.unlinkSync(context.databasePath); } catch {}
  try { if (fs.existsSync(context.uploadDir)) fs.rmSync(context.uploadDir, { recursive: true, force: true }); } catch {}
}
