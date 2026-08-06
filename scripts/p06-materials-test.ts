import test, { after, before } from 'node:test';
import assert from 'node:assert';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApiServer, UPLOAD_MAX_BYTES, validateFileSecurity, type ManagedApiServer } from '../apps/api/src/server';
import { createPrismaClient, databaseUrlFor, resetDatabase, seedDatabase, type PrismaClient } from '../packages/database/src';

interface HttpResult {
  status: number;
  body: Record<string, any>;
  raw: Buffer;
  headers: http.IncomingHttpHeaders;
}

interface Session { cookie: string; csrf: string }

const allowedOrigin = 'http://localhost:3000';
const databasePath = path.join(__dirname, '../packages/database/.data', `p06-materials-${process.pid}.db`);
const uploadDir = path.join(__dirname, '../packages/database/.data', `p06-materials-uploads-${process.pid}`);
const databaseUrl = databaseUrlFor(databasePath);
let db: PrismaClient;
let server: ManagedApiServer;
let origin: string;

function request(pathname: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request(`${origin}${pathname}`, {
      method,
      headers: { ...headers, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {}) }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const isJson = String(res.headers['content-type'] ?? '').includes('application/json');
        resolve({ status: res.statusCode ?? 500, body: isJson && raw.length ? JSON.parse(raw.toString('utf8')) : {}, raw, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function login(email: string): Promise<Session> {
  const response = await request('/auth/login', 'POST', { email, password: 'Password123!' }, { Origin: allowedOrigin });
  assert.strictEqual(response.status, 200, `${email} login failed`);
  const setCookies = response.headers['set-cookie'] ?? [];
  return { cookie: setCookies.map((value) => value.split(';')[0]).join('; '), csrf: response.body.csrfToken };
}

function mutationHeaders(session: Session): Record<string, string> {
  return { Cookie: session.cookie, Origin: allowedOrigin, 'X-CSRF-Token': session.csrf };
}

function pdf(label: string): Buffer {
  return Buffer.from(`%PDF-1.4\n${label}\n%%EOF`, 'utf8');
}

function documentPayload(title: string, filename: string, bytes = pdf(title), extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title, source: 'AUTHORED', category: 'PROPOSAL', filename,
    fileBase64: bytes.toString('base64'), mimeType: 'application/pdf', ...extra
  };
}

before(async () => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  db = createPrismaClient(databaseUrl);
  await db.schedule.create({ data: {
    id: 'P06-SCHED-CASE1', caseId: 'CASE-SYN-001', title: 'P06 same-case schedule', type: 'INTERNAL',
    date: new Date('2026-08-08T00:00:00.000Z'), location: 'SYNTHETIC_ROOM', description: 'P06 isolated fixture'
  } });
  server = createApiServer({ databaseUrl, allowedOrigins: [allowedOrigin], secureCookies: true, uploadDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (server) await server.waitForDatabaseClose();
  if (db) await db.$disconnect();
  fs.rmSync(uploadDir, { recursive: true, force: true });
  for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
});

test('P06 document v01 -> v02 -> v03 keeps latest and final pointers distinct with exact naming and audit trail', async () => {
  const pm = await login('pm@example.invalid');
  const headers = mutationHeaders(pm);
  const v1Bytes = pdf('VERSION_ONE');
  const created = await request('/api/cases/CASE-SYN-001/documents', 'POST', documentPayload(
    'VersionChain', 'version-chain-v1.pdf', v1Bytes, { scheduleId: 'P06-SCHED-CASE1', reportSectionId: 'SEC-SYN-001' }
  ), headers);
  assert.strictEqual(created.status, 201);
  const docId = created.body.document.id as string;
  const v1Id = created.body.versionId as string;
  const v2Bytes = pdf('VERSION_TWO');
  const v2 = await request(`/api/cases/CASE-SYN-001/documents/${docId}/versions`, 'POST', {
    filename: 'version-chain-v2.pdf', fileBase64: v2Bytes.toString('base64'), mimeType: 'application/pdf', version: 1
  }, headers);
  assert.strictEqual(v2.status, 201);
  assert.strictEqual(v2.body.version.versionNumber, 2);
  const v3Bytes = pdf('VERSION_THREE');
  const v3 = await request(`/api/cases/CASE-SYN-001/documents/${docId}/versions`, 'POST', {
    filename: 'version-chain-v3.pdf', fileBase64: v3Bytes.toString('base64'), mimeType: 'application/pdf', version: 2
  }, headers);
  assert.strictEqual(v3.status, 201);
  assert.strictEqual(v3.body.version.versionNumber, 3);

  const finalized = await request(`/api/cases/CASE-SYN-001/documents/${docId}/finalize`, 'POST', {
    versionId: v2.body.version.id, version: 3
  }, headers);
  assert.strictEqual(finalized.status, 200);

  const doc = await db.document.findUniqueOrThrow({ where: { id: docId }, include: { versions: { orderBy: { versionNumber: 'asc' } } } });
  assert.strictEqual(doc.currentVersionId, v3.body.version.id);
  assert.strictEqual(doc.finalVersionId, v2.body.version.id);
  assert.strictEqual(doc.version, 4);
  assert.deepStrictEqual(doc.versions.map((item) => item.versionNumber), [1, 2, 3]);
  assert.strictEqual(doc.versions.filter((item) => item.isFinal).length, 1);
  assert.match(doc.versions[0].displayName, /^CASE-2026-0001_PROPOSAL_VersionChain_\d{8}_v01\.pdf$/);
  assert.strictEqual(doc.versions[0].originalName, 'version-chain-v1.pdf');
  assert.strictEqual(doc.versions[0].sha256, crypto.createHash('sha256').update(v1Bytes).digest('hex'));
  assert.strictEqual(doc.scheduleId, 'P06-SCHED-CASE1');
  assert.strictEqual(doc.reportSectionId, 'SEC-SYN-001');
  assert.ok(v1Id);
  assert.strictEqual(await db.auditLog.count({ where: { targetId: docId } }), 2);
  assert.strictEqual(await db.auditLog.count({ where: { action: 'DOCUMENT_VERSION_CREATED', metadataJson: { contains: docId } } }), 2);
});

test('P06 authenticated download returns exact bytes and rejects a SHA/size tampered storage object', async () => {
  const pm = await login('pm@example.invalid');
  const headers = mutationHeaders(pm);
  const bytes = pdf('DOWNLOAD_INTEGRITY');
  const created = await request('/api/cases/CASE-SYN-001/documents', 'POST', documentPayload('DownloadIntegrity', 'download-integrity.pdf', bytes), headers);
  assert.strictEqual(created.status, 201);
  const docId = created.body.document.id as string;
  const versionId = created.body.versionId as string;
  const downloaded = await request(`/api/cases/CASE-SYN-001/documents/${docId}/versions/${versionId}/download`, 'GET', undefined, { Cookie: pm.cookie });
  assert.strictEqual(downloaded.status, 200);
  assert.deepStrictEqual(downloaded.raw, bytes);
  assert.strictEqual(downloaded.headers['x-content-type-options'], 'nosniff');
  assert.strictEqual(downloaded.headers['content-security-policy'], 'sandbox');
  assert.match(String(downloaded.headers['content-disposition']), /^attachment;/);

  const version = await db.documentVersion.findUniqueOrThrow({ where: { id: versionId } });
  fs.writeFileSync(path.join(uploadDir, version.storageKey), pdf('TAMPERED'));
  const blocked = await request(`/api/cases/CASE-SYN-001/documents/${docId}/versions/${versionId}/download`, 'GET', undefined, { Cookie: pm.cookie });
  assert.strictEqual(blocked.status, 409);
  assert.match(blocked.body.error, /integrity/i);
  assert.strictEqual(await db.auditLog.count({ where: { action: 'DOCUMENT_DOWNLOADED', targetId: versionId } }), 1);
});

test('P06 file policy rejects MIME mismatch, double extensions, path semantics, malformed Base64, bad magic and oversize', async () => {
  const pm = await login('pm@example.invalid');
  const headers = mutationHeaders(pm);
  const attacks = [
    documentPayload('MimeMismatch', 'mismatch.pdf', pdf('MIME'), { mimeType: 'image/png' }),
    documentPayload('DoubleExtension', 'payload.exe.pdf'),
    documentPayload('PathTraversal', '../traversal.pdf'),
    { ...documentPayload('MalformedBase64', 'bad-base64.pdf'), fileBase64: '%%%not-base64%%%' },
    documentPayload('BadMagic', 'bad-magic.pdf', Buffer.from('NOT_A_PDF')),
    documentPayload('NulFilename', 'nul\u0000name.pdf')
  ];
  for (const payload of attacks) {
    const response = await request('/api/cases/CASE-SYN-001/documents', 'POST', payload, headers);
    assert.strictEqual(response.status, 400, JSON.stringify(response.body));
  }
  assert.throws(() => validateFileSecurity('too-large.pdf', 'application/pdf', Buffer.alloc(UPLOAD_MAX_BYTES + 1)), /10MB/);
  assert.strictEqual(await db.document.count({ where: { title: { in: attacks.map((item) => String(item.title)) } } }), 0);
});

test('P06 document transaction and storage roll back together when append-only audit insertion fails', async () => {
  const pm = await login('pm@example.invalid');
  const headers = mutationHeaders(pm);
  await db.$executeRawUnsafe(`CREATE TRIGGER "P06_force_document_audit_failure" BEFORE INSERT ON "AuditLog" WHEN NEW."action" = 'DOCUMENT_CREATED' BEGIN SELECT RAISE(ABORT, 'forced P06 audit failure'); END`);
  const filesBefore = fs.readdirSync(uploadDir).sort();
  const response = await request('/api/cases/CASE-SYN-001/documents', 'POST', documentPayload('MustRollback', 'must-rollback.pdf'), headers);
  assert.strictEqual(response.status, 500);
  assert.strictEqual(await db.document.count({ where: { title: 'MustRollback' } }), 0);
  assert.deepStrictEqual(fs.readdirSync(uploadDir).sort(), filesBefore);
  await db.$executeRawUnsafe('DROP TRIGGER "P06_force_document_audit_failure"');
});

test('P06 stale document writes roll back their rows and storage files', async () => {
  const pm = await login('pm@example.invalid');
  const headers = mutationHeaders(pm);
  const created = await request('/api/cases/CASE-SYN-001/documents', 'POST', documentPayload('OptimisticLock', 'optimistic-v1.pdf'), headers);
  assert.strictEqual(created.status, 201);
  const docId = created.body.document.id as string;
  const filesBefore = fs.readdirSync(uploadDir).sort();
  const stale = await request(`/api/cases/CASE-SYN-001/documents/${docId}/versions`, 'POST', {
    filename: 'optimistic-v2.pdf', fileBase64: pdf('STALE').toString('base64'), mimeType: 'application/pdf', version: 999
  }, headers);
  assert.strictEqual(stale.status, 409);
  assert.strictEqual(await db.documentVersion.count({ where: { documentId: docId } }), 1);
  assert.deepStrictEqual(fs.readdirSync(uploadDir).sort(), filesBefore);
});

test('P06 tenant, assignment and role boundaries protect document mutations and downloads', async () => {
  const pm = await login('pm@example.invalid');
  const staff = await login('staff@example.invalid');
  const reviewer = await login('reviewer@example.invalid');
  const payload = documentPayload('ForbiddenUpload', 'forbidden.pdf');
  assert.strictEqual((await request('/api/cases/CASE-SYN-001/documents', 'POST', payload, mutationHeaders(staff))).status, 403);
  assert.strictEqual((await request('/api/cases/CASE-SYN-001/documents', 'POST', payload, mutationHeaders(reviewer))).status, 403);
  assert.strictEqual((await request('/api/cases/CASE-SYN-ORGB/documents/DOC-SYN-002/versions/DOCVER-SYN-003/download', 'GET', undefined, { Cookie: pm.cookie })).status, 403);
  assert.strictEqual((await request('/api/cases/CASE-SYN-003/documents', 'GET', undefined, { Cookie: pm.cookie })).status, 403);
  assert.strictEqual((await request('/api/cases/CASE-SYN-001/documents/DOC-SYN-001', 'DELETE', { version: 1 }, mutationHeaders(pm))).status, 403);
});

test('P06 meetings preserve original transcript, link action items, enforce concurrency and freeze FINAL records', async () => {
  const pm = await login('pm@example.invalid');
  const headers = mutationHeaders(pm);
  const rawText = 'SYNTHETIC_P06_ORIGINAL_TRANSCRIPT';
  const created = await request('/api/cases/CASE-SYN-001/meetings', 'POST', {
    title: 'P06_MEETING_FLOW', meetingDate: '2026-08-06T01:00:00.000Z', location: 'SYNTHETIC_ROOM',
    attendees: 'SYNTHETIC_ATTENDEES', rawText, summary: 'initial', decisions: 'initial decision',
    actionItems: [{ title: 'Initial action', assigneeId: 'USR-STAFF', scheduleId: 'P06-SCHED-CASE1', dueDate: '2026-08-07T00:00:00.000Z' }]
  }, headers);
  assert.strictEqual(created.status, 201);
  const meetingId = created.body.meeting.id as string;
  assert.strictEqual(created.body.meeting.version, 1);
  assert.strictEqual(created.body.meeting.rawTextSha256, crypto.createHash('sha256').update(rawText).digest('hex'));

  const updated = await request(`/api/cases/CASE-SYN-001/meetings/${meetingId}`, 'PATCH', {
    summary: 'revised summary', decisions: 'revised decision', version: 1
  }, headers);
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.body.meeting.version, 2);
  const stale = await request(`/api/cases/CASE-SYN-001/meetings/${meetingId}`, 'PATCH', { summary: 'stale', version: 1 }, headers);
  assert.strictEqual(stale.status, 409);
  const transcriptMutation = await request(`/api/cases/CASE-SYN-001/meetings/${meetingId}`, 'PATCH', { rawText: 'changed', version: 2 }, headers);
  assert.strictEqual(transcriptMutation.status, 400);
  const action = await request(`/api/cases/CASE-SYN-001/meetings/${meetingId}/action-items`, 'POST', {
    title: 'Linked action', assigneeId: 'USR-STAFF', scheduleId: 'P06-SCHED-CASE1', dueDate: '2026-08-08T00:00:00.000Z'
  }, headers);
  assert.strictEqual(action.status, 201);
  const finalized = await request(`/api/cases/CASE-SYN-001/meetings/${meetingId}/finalize`, 'POST', { version: 2 }, headers);
  assert.strictEqual(finalized.status, 200);
  assert.strictEqual(finalized.body.meeting.status, 'FINAL');
  assert.strictEqual(finalized.body.meeting.version, 3);
  assert.strictEqual((await request(`/api/cases/CASE-SYN-001/meetings/${meetingId}`, 'PATCH', { summary: 'forbidden', version: 3 }, headers)).status, 400);
  assert.strictEqual((await request(`/api/cases/CASE-SYN-001/meetings/${meetingId}/action-items`, 'POST', { title: 'forbidden' }, headers)).status, 400);
  await assert.rejects(db.$executeRawUnsafe('UPDATE "Meeting" SET "summary" = ? WHERE "id" = ?', 'TAMPERED', meetingId), /Finalized meeting/i);
  await assert.rejects(db.meetingActionItem.update({ where: { id: action.body.actionItem.id }, data: { title: 'TAMPERED' } }));
  assert.strictEqual((await db.meetingActionItem.findUniqueOrThrow({ where: { id: action.body.actionItem.id } })).title, 'Linked action');
});

test('P06 DB guards reject cross-case document links, wrong version pointers and cross-tenant/cross-case action links', async () => {
  await assert.rejects(db.document.create({ data: {
    id: 'DOC-INVALID-LINK', caseId: 'CASE-SYN-001', scheduleId: 'SCHED-SYN-001', title: 'Invalid link',
    category: 'ETC', source: 'RECEIVED', currentVersionId: null, finalVersionId: null, version: 1
  } }));
  await assert.rejects(db.document.update({ where: { id: 'DOC-SYN-001' }, data: { currentVersionId: 'DOCVER-SYN-003' } }));
  await assert.rejects(db.meetingActionItem.create({ data: {
    id: 'ACT-CROSS-ORG', meetingId: 'MEET-SYN-001', title: 'Cross org', assigneeId: 'USR-ORGB-PM', status: 'PENDING'
  } }));
  await assert.rejects(db.meetingActionItem.create({ data: {
    id: 'ACT-CROSS-CASE', meetingId: 'MEET-SYN-001', title: 'Cross case', scheduleId: 'SCHED-SYN-001', status: 'PENDING'
  } }));
  await assert.rejects(db.meetingActionItem.create({ data: {
    id: 'ACT-FINAL', meetingId: 'MEET-SYN-002', title: 'Final child', status: 'PENDING'
  } }));
});
