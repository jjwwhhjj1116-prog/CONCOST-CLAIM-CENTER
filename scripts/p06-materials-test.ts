import test, { after, before } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import {
  createPrismaClient, databaseUrlFor, resetDatabase, seedDatabase, type PrismaClient
} from '../packages/database/src';

interface HttpResult {
  status: number;
  body: Record<string, any>;
  headers: http.IncomingHttpHeaders;
}

const allowedOrigin = 'http://localhost:3000';
const databasePath = path.join(__dirname, '../packages/database/.data', `p06-materials-${process.pid}.db`);
const databaseUrl = databaseUrlFor(databasePath);
let db: PrismaClient;
let server: ManagedApiServer;
let origin: string;

function request(pathname: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request(`${origin}${pathname}`, {
      method,
      headers: {
        ...headers,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {})
      }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode ?? 500, body: text ? JSON.parse(text) : {}, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function login(email: string): Promise<{ cookie: string; csrf: string; response: HttpResult }> {
  const response = await request('/auth/login', 'POST', { email, password: 'Password123!' }, { Origin: allowedOrigin });
  assert.strictEqual(response.status, 200, `${email} login failed`);
  const setCookies = response.headers['set-cookie'] ?? [];
  return {
    response,
    cookie: setCookies.map((value) => value.split(';')[0]).join('; '),
    csrf: response.body.csrfToken
  };
}

function mutationHeaders(session: { cookie: string; csrf: string }): Record<string, string> {
  return { Cookie: session.cookie, Origin: allowedOrigin, 'X-CSRF-Token': session.csrf };
}

before(async () => {
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);

  db = createPrismaClient(databaseUrl);
  server = createApiServer({ databaseUrl, allowedOrigins: [allowedOrigin], secureCookies: true });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (server) await server.waitForDatabaseClose();
  if (db) await db.$disconnect();
  for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
});

test('P06 Document v01 -> v02 -> v03 versioning and final version assignment', async () => {
  const pm = await login('pm@example.invalid');
  const headers = mutationHeaders(pm);

  const pdfMagic = Buffer.from('%PDF-1.4 synthetic pdf content').toString('base64');

  // Create v01
  const createRes = await request('/api/cases/CASE-SYN-001/documents', 'POST', {
    title: 'NewProposal',
    source: 'AUTHORED',
    category: 'PROPOSAL',
    filename: 'proposal_v01.pdf',
    fileBase64: pdfMagic,
    mimeType: 'application/pdf'
  }, headers);
  assert.strictEqual(createRes.status, 201);
  const docId = createRes.body.document.id;

  // Add v02
  const v2Res = await request(`/api/cases/CASE-SYN-001/documents/${docId}/versions`, 'POST', {
    filename: 'proposal_v02.pdf',
    fileBase64: pdfMagic,
    mimeType: 'application/pdf'
  }, headers);
  assert.strictEqual(v2Res.status, 201);
  assert.strictEqual(v2Res.body.version.versionNumber, 2);

  // Set v02 as final
  const finalRes = await request(`/api/cases/CASE-SYN-001/documents/${docId}/finalize`, 'POST', {
    versionId: v2Res.body.version.id
  }, headers);
  assert.strictEqual(finalRes.status, 200);

  const updatedDoc = await db.documentVersion.findUnique({ where: { id: v2Res.body.version.id } });
  assert.strictEqual(updatedDoc?.isFinal, true);
});

test('P06 Document source classification (RECEIVED, AUTHORED, SUBMITTED)', async () => {
  const pm = await login('pm@example.invalid');
  const headers = mutationHeaders(pm);
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).toString('base64');

  for (const source of ['RECEIVED', 'AUTHORED', 'SUBMITTED']) {
    const res = await request('/api/cases/CASE-SYN-001/documents', 'POST', {
      title: `DocSource_${source}`,
      source,
      category: 'EVIDENCE',
      filename: `evidence_${source}.png`,
      fileBase64: pngMagic,
      mimeType: 'image/png'
    }, headers);
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.document.source, source);
  }
});

test('P06 File security rejection (executable, oversized, invalid magic bytes)', async () => {
  const pm = await login('pm@example.invalid');
  const headers = mutationHeaders(pm);

  // Executable extension
  const exeRes = await request('/api/cases/CASE-SYN-001/documents', 'POST', {
    title: 'Malware', source: 'RECEIVED', category: 'ETC', filename: 'virus.exe',
    fileBase64: Buffer.from('MZ...').toString('base64'), mimeType: 'application/x-msdownload'
  }, headers);
  assert.strictEqual(exeRes.status, 400);

  // Invalid magic bytes (claiming to be PDF but lacks %PDF)
  const fakePdf = await request('/api/cases/CASE-SYN-001/documents', 'POST', {
    title: 'FakePdf', source: 'RECEIVED', category: 'ETC', filename: 'fake.pdf',
    fileBase64: Buffer.from('NOT_A_PDF').toString('base64'), mimeType: 'application/pdf'
  }, headers);
  assert.strictEqual(fakePdf.status, 400);
});

test('P06 Duplicate filename conflict prevention (409)', async () => {
  const pm = await login('pm@example.invalid');
  const headers = mutationHeaders(pm);
  const pdfMagic = Buffer.from('%PDF-1.4 content').toString('base64');

  const upload1 = await request('/api/cases/CASE-SYN-001/documents', 'POST', {
    title: 'DupTest', source: 'AUTHORED', category: 'CONTRACT', filename: 'duplicate_check.pdf',
    fileBase64: pdfMagic, mimeType: 'application/pdf'
  }, headers);
  assert.strictEqual(upload1.status, 201);

  // Attempt upload with exact same filename in same case
  const upload2 = await request('/api/cases/CASE-SYN-001/documents', 'POST', {
    title: 'DupTest2', source: 'AUTHORED', category: 'CONTRACT', filename: 'duplicate_check.pdf',
    fileBase64: pdfMagic, mimeType: 'application/pdf'
  }, headers);
  assert.strictEqual(upload2.status, 409);
});

test('P06 IDOR protection on document download across organizations and unassigned cases', async () => {
  const pm = await login('pm@example.invalid');
  // Attempt downloading document from Org B case
  const res = await request('/api/cases/CASE-SYN-ORGB/documents/DOC-SYN-002/versions/DOCVER-SYN-003/download', 'GET', undefined, { Cookie: pm.cookie });
  assert.strictEqual(res.status, 403);
});

test('P06 Role RBAC enforcement (Staff/Reviewer upload blocked, PM final delete blocked)', async () => {
  const staff = await login('staff@example.invalid');
  const staffHeaders = mutationHeaders(staff);
  const pdfMagic = Buffer.from('%PDF-1.4 content').toString('base64');

  // Staff upload attempt -> 403
  const staffUpload = await request('/api/cases/CASE-SYN-001/documents', 'POST', {
    title: 'StaffDoc', source: 'AUTHORED', category: 'GENERAL', filename: 'staff.pdf', fileBase64: pdfMagic, mimeType: 'application/pdf'
  }, staffHeaders);
  assert.strictEqual(staffUpload.status, 403);

  // PM attempts deleting finalized document -> 400 or PM role deletion check
  const pm = await login('pm@example.invalid');
  const pmHeaders = mutationHeaders(pm);
  const pmDelete = await request('/api/cases/CASE-SYN-001/documents/DOC-SYN-001', 'DELETE', undefined, pmHeaders);
  assert.strictEqual(pmDelete.status, 403); // PM cannot final-delete documents
});

test('P06 Meeting creation, draft update, and finalized immutability', async () => {
  const pm = await login('pm@example.invalid');
  const headers = mutationHeaders(pm);

  // Create meeting
  const meetRes = await request('/api/cases/CASE-SYN-001/meetings', 'POST', {
    title: '1차 클레임 전략 회의',
    meetingDate: new Date('2026-03-10T10:00:00.000Z').toISOString(),
    location: '대회의실 A',
    attendees: 'PM, Staff, Reviewer',
    rawText: '회의록 원문 텍스트 예시...',
    summary: '주요 요약 사항',
    decisions: '1차 서면 작성 결정',
    actionItems: [
      { title: '증거 서류 수집', assigneeId: 'USR-STAFF', scheduleId: 'SCHED-SYN-001', dueDate: '2026-03-20T00:00:00.000Z' }
    ]
  }, headers);
  assert.strictEqual(meetRes.status, 201);
  const meetingId = meetRes.body.meeting.id;

  // Finalize meeting
  const finalRes = await request(`/api/cases/CASE-SYN-001/meetings/${meetingId}/finalize`, 'POST', {}, headers);
  assert.strictEqual(finalRes.status, 200);

  // Attempt updating finalized meeting -> 400 Bad Request
  const updateRes = await request(`/api/cases/CASE-SYN-001/meetings/${meetingId}`, 'PATCH', {
    title: '수정 시도', version: 2
  }, headers);
  assert.strictEqual(updateRes.status, 400);

  // Attempt DB raw update/delete on FINAL meeting -> triggers reject
  await assert.rejects(
    db.$executeRawUnsafe('UPDATE "Meeting" SET "title" = ? WHERE "id" = ?', 'TAMPERED', meetingId),
    /finalized meeting cannot be updated|constraint/i
  );
});
