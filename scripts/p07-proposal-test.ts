import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  createPrismaClient, databaseUrlFor, resetDatabase, seedDatabase, type PrismaClient
} from '@claim-studio/database';
import {
  generateDocxBuffer, generatePdfBuffer, validateDocxBuffer, validatePdfBuffer
} from '@claim-studio/document-engine';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';

interface Session { cookie: string; csrf: string }
interface Result { status: number; body: Record<string, any>; raw: Buffer; headers: http.IncomingHttpHeaders }

const allowedOrigin = 'http://localhost:3000';
const databasePath = path.join(__dirname, '../packages/database/.data', `p07-test-${process.pid}.db`);
const uploadDir = path.join(__dirname, '../packages/database/.data', `p07-test-uploads-${process.pid}`);
const databaseUrl = databaseUrlFor(databasePath);

function request(origin: string, pathname: string, method = 'GET', body?: unknown, session?: Session): Promise<Result> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request(`${origin}${pathname}`, {
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {}),
        ...(session ? { Cookie: session.cookie, Origin: allowedOrigin, 'X-CSRF-Token': session.csrf } : { Origin: allowedOrigin })
      }
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

async function login(origin: string, email: string): Promise<Session> {
  const response = await request(origin, '/auth/login', 'POST', { email, password: 'Password123!' });
  assert.strictEqual(response.status, 200);
  return {
    cookie: (response.headers['set-cookie'] ?? []).map((value) => value.split(';')[0]).join('; '),
    csrf: response.body.csrfToken
  };
}

const completeInputs = {
  background: 'Synthetic P07 background',
  objective: 'Synthetic P07 objective',
  method: 'Synthetic P07 method',
  expectedOutcome: 'Synthetic P07 outcome',
  exclusions: 'None'
};

test('P07 proposal template, immutable workflow and real document output', async (t) => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const db: PrismaClient = createPrismaClient(databaseUrl);
  const server: ManagedApiServer = createApiServer({ databaseUrl, allowedOrigins: [allowedOrigin], secureCookies: false, uploadDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const pm = await login(origin, 'pm@example.invalid');
  const director = await login(origin, 'director@example.invalid');

  let proposalId = '';
  let proposalVersionId = '';
  let proposalOptimisticVersion = 1;
  let sourceVersionId = '';

  try {
    await t.test('six exact claim templates and TYPE-07 rejection', async () => {
      const response = await request(origin, '/api/proposal-templates', 'GET', undefined, pm);
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.body.templates.map((template: any) => template.claimType).sort(), ['TYPE-01', 'TYPE-02', 'TYPE-03', 'TYPE-04', 'TYPE-05', 'TYPE-06']);
      const invalid = await request(origin, '/api/proposal-templates?claimType=TYPE-07', 'GET', undefined, pm);
      assert.strictEqual(invalid.status, 400);
    });

    await t.test('DOCX ZIP and PDF xref parsers reject tampering and preserve provenance', () => {
      const options = {
        title: '합성 P07 제안서', caseNumber: 'CASE-P07', claimType: 'TYPE-01', proposalId: 'PROP-PARSER',
        versionId: 'PROPVER-PARSER', versionNumber: 2, approvedBy: '합성 검수자',
        approvedAt: '2026-08-07T00:00:00.000Z', sha256: 'a'.repeat(64), bodyText: 'P07 한글 파서 본문'
      };
      const docx = generateDocxBuffer(options);
      const parsedDocx = validateDocxBuffer(docx);
      assert.strictEqual(parsedDocx.isValid, true);
      assert.strictEqual(parsedDocx.metadata?.VersionId, 'PROPVER-PARSER');
      const brokenDocx = Buffer.from(docx);
      const docxBodyOffset = brokenDocx.indexOf(Buffer.from('P07 한글 파서 본문'));
      assert.ok(docxBodyOffset >= 0);
      brokenDocx[docxBodyOffset] ^= 1;
      assert.strictEqual(validateDocxBuffer(brokenDocx).isValid, false);

      const pdf = generatePdfBuffer(options);
      const parsedPdf = validatePdfBuffer(pdf);
      assert.strictEqual(parsedPdf.isValid, true);
      assert.strictEqual(parsedPdf.metadata?.ProposalId, 'PROP-PARSER');
      assert.strictEqual(parsedPdf.metadata?.Title, '합성 P07 제안서');
      assert.strictEqual(parsedPdf.metadata?.Author, '합성 검수자');
      assert.match(parsedPdf.extractedText ?? '', /P07 한글 파서 본문/);
      const brokenPdf = Buffer.from(pdf);
      const firstLiveXref = pdf.indexOf(Buffer.from('0000000000 65535 f \n')) + Buffer.byteLength('0000000000 65535 f \n');
      brokenPdf.write('0000000000', firstLiveXref);
      assert.strictEqual(validatePdfBuffer(brokenPdf).isValid, false);
    });

    await t.test('create snapshots template and case values while unknown values remain explicit', async () => {
      await db.party.create({ data: { id: 'PARTY-P07-TEST', caseId: 'CASE-SYN-001', name: 'SYNTHETIC_P07_CLIENT', role: 'CLIENT' } });
      const response = await request(origin, '/api/cases/CASE-SYN-001/proposals', 'POST', { templateId: 'TPL-PROP-TYPE-01', title: 'P07_SYNTHETIC_WORKFLOW' }, pm);
      assert.strictEqual(response.status, 201);
      proposalId = response.body.proposal.id;
      proposalVersionId = response.body.proposal.currentVersionId;
      const initial = response.body.proposal.versions[0];
      assert.match(initial.bodyText, /CASE-2026-0001/);
      assert.match(initial.bodyText, /누락: BACKGROUND/);
      assert.ok(JSON.parse(initial.missingFieldsJson).includes('OBJECTIVE'));
      const snapshot = initial.bodyText;
      await db.caseItem.update({ where: { id: 'CASE-SYN-001' }, data: { title: 'SYNTHETIC_CASE_CHANGED_AFTER_SNAPSHOT' } });
      assert.strictEqual((await db.proposalVersion.findUniqueOrThrow({ where: { id: proposalVersionId } })).bodyText, snapshot);
    });

    await t.test('valid source upload, five required inputs, source IDOR and stale 409', async () => {
      const source = Buffer.from('%PDF-1.4\nP07_SYNTHETIC_SOURCE\n%%EOF');
      const uploaded = await request(origin, '/api/cases/CASE-SYN-001/documents', 'POST', {
        title: 'P07_SYNTHETIC_SOURCE', source: 'RECEIVED', category: 'EVIDENCE', filename: 'p07-source.pdf',
        fileBase64: source.toString('base64'), mimeType: 'application/pdf'
      }, pm);
      assert.strictEqual(uploaded.status, 201);
      sourceVersionId = uploaded.body.versionId;

      const missing = await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/versions`, 'POST', {
        ...completeInputs, objective: '', generationMode: 'MANUAL', version: proposalOptimisticVersion
      }, pm);
      assert.strictEqual(missing.status, 400);
      const idor = await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/versions`, 'POST', {
        ...completeInputs, generationMode: 'MANUAL', version: proposalOptimisticVersion, sourceDocumentVersionIds: ['DOCVER-SYN-003']
      }, pm);
      assert.strictEqual(idor.status, 403);

      const created = await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/versions`, 'POST', {
        ...completeInputs, generationMode: 'MANUAL', version: proposalOptimisticVersion, sourceDocumentVersionIds: [sourceVersionId]
      }, pm);
      assert.strictEqual(created.status, 201);
      proposalVersionId = created.body.version.id;
      proposalOptimisticVersion = created.body.proposalVersion;
      const stale = await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/versions`, 'POST', {
        ...completeInputs, generationMode: 'MANUAL', version: 1
      }, pm);
      assert.strictEqual(stale.status, 409);
    });

    await t.test('AI draft records provenance and cannot enter review until a manual human version exists', async () => {
      const ai = await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/versions`, 'POST', {
        ...completeInputs, generationMode: 'AI', providerId: 'local-fake-ai', modelId: 'fake-claim-v1',
        version: proposalOptimisticVersion, sourceDocumentVersionIds: [sourceVersionId]
      }, pm);
      assert.strictEqual(ai.status, 201);
      assert.strictEqual(ai.body.version.generationMode, 'AI');
      assert.match(ai.body.version.bodyText, /\[AI_DRAFT\]/);
      assert.match(ai.body.version.inputSha256, /^[0-9a-f]{64}$/);
      assert.ok(ai.body.version.generatedAt);
      proposalVersionId = ai.body.version.id;
      proposalOptimisticVersion = ai.body.proposalVersion;
      const blocked = await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/reviews`, 'POST', {
        action: 'REQUEST_REVIEW', versionId: proposalVersionId, version: proposalOptimisticVersion
      }, pm);
      assert.strictEqual(blocked.status, 409);

      const manual = await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/versions`, 'POST', {
        ...completeInputs, background: 'Human revised after AI draft', generationMode: 'MANUAL',
        version: proposalOptimisticVersion, sourceDocumentVersionIds: [sourceVersionId]
      }, pm);
      assert.strictEqual(manual.status, 201);
      proposalVersionId = manual.body.version.id;
      proposalOptimisticVersion = manual.body.proposalVersion;
    });

    await t.test('DRAFT to IN_REVIEW to APPROVED enforces lock and self-approval boundary', async () => {
      const unapprovedRender = await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/render`, 'POST', {
        format: 'docx', versionId: proposalVersionId, version: proposalOptimisticVersion
      }, pm);
      assert.strictEqual(unapprovedRender.status, 403);
      const requested = await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/reviews`, 'POST', {
        action: 'REQUEST_REVIEW', versionId: proposalVersionId, version: proposalOptimisticVersion
      }, pm);
      assert.strictEqual(requested.status, 200);
      proposalOptimisticVersion = requested.body.version;
      const pmApprove = await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/reviews`, 'POST', {
        action: 'APPROVE', versionId: proposalVersionId, version: proposalOptimisticVersion
      }, pm);
      assert.strictEqual(pmApprove.status, 403);
      const approved = await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/reviews`, 'POST', {
        action: 'APPROVE', versionId: proposalVersionId, version: proposalOptimisticVersion, comment: 'Synthetic director approval'
      }, director);
      assert.strictEqual(approved.status, 200);
      proposalOptimisticVersion = approved.body.version;
    });

    await t.test('only approved version renders parser-valid DOCX/PDF with actual approver metadata', async () => {
      const oldVersion = await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/render`, 'POST', {
        format: 'docx', versionId: 'PROPVER-SYN-001', version: proposalOptimisticVersion
      }, pm);
      assert.strictEqual(oldVersion.status, 403);
      const docx = await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/render`, 'POST', {
        format: 'docx', versionId: proposalVersionId, version: proposalOptimisticVersion
      }, pm);
      assert.strictEqual(docx.status, 200);
      const parsedDocx = validateDocxBuffer(docx.raw);
      assert.strictEqual(parsedDocx.isValid, true);
      assert.strictEqual(parsedDocx.metadata?.VersionId, proposalVersionId);
      assert.match(parsedDocx.corePropsText ?? '', /Synthetic Director/);
      proposalOptimisticVersion += 1;

      const pdf = await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/render`, 'POST', {
        format: 'pdf', versionId: proposalVersionId, version: proposalOptimisticVersion
      }, pm);
      assert.strictEqual(pdf.status, 200);
      const parsedPdf = validatePdfBuffer(pdf.raw);
      assert.strictEqual(parsedPdf.isValid, true);
      assert.strictEqual(parsedPdf.metadata?.Author, 'Synthetic Director');
      proposalOptimisticVersion += 1;
      const outputs = await db.document.findMany({ where: { proposalVersionId } });
      assert.strictEqual(outputs.length, 2);
      assert.ok(outputs.every((document) => document.currentVersionId && document.finalVersionId));
    });

    await t.test('version, review and approved output rows are DB-immutable', async () => {
      await assert.rejects(db.proposalVersion.update({ where: { id: proposalVersionId }, data: { bodyText: 'tampered' } }));
      const review = await db.proposalReview.findFirstOrThrow({ where: { proposalId, action: 'APPROVE' } });
      await assert.rejects(db.proposalReview.update({ where: { id: review.id }, data: { comment: 'tampered' } }));
      await assert.rejects(db.proposalReview.delete({ where: { id: review.id } }));
      const output = await db.document.findFirstOrThrow({ where: { proposalVersionId } });
      await assert.rejects(db.document.update({ where: { id: output.id }, data: { title: 'tampered' } }));
      await assert.rejects(db.document.delete({ where: { id: output.id } }));
    });

    await t.test('render audit failure rolls back DB rows and removes storage orphan', async () => {
      const docsBefore = await db.document.count({ where: { proposalVersionId } });
      const filesBefore = fs.readdirSync(uploadDir).sort();
      await db.$executeRawUnsafe(`CREATE TRIGGER P07_test_abort_render_audit BEFORE INSERT ON AuditLog FOR EACH ROW WHEN NEW.action = 'PROPOSAL_RENDERED' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END`);
      const failed = await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/render`, 'POST', {
        format: 'pdf', versionId: proposalVersionId, version: proposalOptimisticVersion
      }, pm);
      assert.strictEqual(failed.status, 500);
      await db.$executeRawUnsafe('DROP TRIGGER P07_test_abort_render_audit');
      assert.strictEqual(await db.document.count({ where: { proposalVersionId } }), docsBefore);
      assert.deepStrictEqual(fs.readdirSync(uploadDir).sort(), filesBefore);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.waitForDatabaseClose();
    await db.$disconnect();
    fs.rmSync(uploadDir, { recursive: true, force: true });
    for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});
