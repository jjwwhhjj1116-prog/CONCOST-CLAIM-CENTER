import * as fs from 'node:fs';
import * as path from 'node:path';
import { type AddressInfo } from 'node:net';
import { createPrismaClient, resetDatabase, seedDatabase, type PrismaClient } from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { createP09Fixture, P09_TEST_ORIGIN, requestJson, type P09Fixture, type TestSession } from './p09-test-support';

const root = path.resolve(__dirname, '..');

export interface P11TestContext {
  db: PrismaClient;
  api: ManagedApiServer;
  origin: string;
  databasePath: string;
  uploadDir: string;
  fixture: P09Fixture;
}

export async function startP11Isolated(name: string, allowTestAiModes = true): Promise<P11TestContext> {
  const unique = `${name}-${process.pid}-${Date.now()}`;
  const databasePath = path.join(root, 'packages/database/.data', `${unique}.db`);
  const uploadDir = path.join(root, 'packages/database/.data', `${unique}-uploads`);
  const databaseUrl = `file:${databasePath}`;
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const db = createPrismaClient(databaseUrl);
  const api = createApiServer({ databaseUrl, allowedOrigins: [P09_TEST_ORIGIN], secureCookies: false, uploadDir, allowTestAiModes });
  await new Promise<void>((resolve, reject) => api.once('error', reject).listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  const fixture = await createP09Fixture(origin, db, { sectionCount: 2 });
  return { db, api, origin, databasePath, uploadDir, fixture };
}

export async function closeP11Isolated(context: P11TestContext): Promise<void> {
  await new Promise<void>((resolve) => context.api.close(() => resolve()));
  await context.api.waitForDatabaseClose();
  await context.db.$disconnect();
  fs.rmSync(context.uploadDir, { recursive: true, force: true });
  for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${context.databasePath}${suffix}`, { force: true });
}

export const P11_INSTRUCTION = '선택한 근거만 사용하여 사실관계 검토 초안을 작성하세요.';

export async function createMeetingSelection(
  context: P11TestContext,
  session: TestSession = context.fixture.pm,
  options: { sectionId?: string; meetingIds?: string[]; instruction?: string; providerId?: string } = {}
) {
  const sectionId = options.sectionId ?? context.fixture.sectionIds[0];
  const meetingIds = options.meetingIds ?? ['MEET-SYN-002'];
  const instruction = options.instruction ?? P11_INSTRUCTION;
  const meetings = await context.db.meeting.findMany({ where: { id: { in: meetingIds } } });
  return requestJson(context.origin, `/api/reports/${context.fixture.reportId}/sections/${sectionId}/grounding/selections`, 'POST', {
    providerId: options.providerId ?? 'CFG-LOCAL-FAKE-01',
    modelCode: 'fake-claim-v1',
    instruction,
    sources: meetingIds.map((id) => {
      const meeting = meetings.find((row) => row.id === id);
      if (!meeting) throw new Error(`Meeting fixture missing: ${id}`);
      return { sourceType: 'MEETING', sourceId: id, sourceVersionId: `${id}:v${meeting.version}`, allowedAnchors: [0] };
    })
  }, session);
}

export async function createSuggestion(
  context: P11TestContext,
  selectionId: string,
  testMode: string,
  idempotencyKey: string,
  session: TestSession = context.fixture.pm,
  options: { instruction?: string; waitForCompletion?: boolean; sectionId?: string } = {}
) {
  const sectionId = options.sectionId ?? context.fixture.sectionIds[0];
  return requestJson(context.origin, `/api/reports/${context.fixture.reportId}/sections/${sectionId}/ai/suggestions`, 'POST', {
    selectionId,
    instruction: options.instruction ?? P11_INSTRUCTION,
    idempotencyKey,
    waitForCompletion: options.waitForCompletion ?? true,
    testMode
  }, session);
}
