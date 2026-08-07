import test from 'node:test';
import assert from 'node:assert';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import initSqlJs from 'sql.js';
import {
  createPrismaClient, databaseUrlFor, migrateDatabase, resetDatabase, seedDatabase, type PrismaClient
} from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';

interface Session { cookie: string; csrf: string }
interface Result { status: number; body: Record<string, any>; headers: http.IncomingHttpHeaders }
const allowedOrigin = 'http://localhost:3000';
const databasePath = path.join(__dirname, '../packages/database/.data', `p07-security-${process.pid}.db`);
const uploadDir = path.join(__dirname, '../packages/database/.data', `p07-security-uploads-${process.pid}`);
const databaseUrl = databaseUrlFor(databasePath);

function request(origin: string, pathname: string, method = 'GET', body?: unknown, session?: Session, trustedOrigin = true): Promise<Result> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request(`${origin}${pathname}`, {
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {}),
        ...(trustedOrigin ? { Origin: allowedOrigin } : {}),
        ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {})
      }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode ?? 500, body: raw ? JSON.parse(raw) : {}, headers: res.headers });
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

test('P07 proposal security, DB integrity and lossless migration', async (t) => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const db: PrismaClient = createPrismaClient(databaseUrl);
  const server: ManagedApiServer = createApiServer({ databaseUrl, allowedOrigins: [allowedOrigin], secureCookies: true, uploadDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const pm = await login(origin, 'pm@example.invalid');
  const director = await login(origin, 'director@example.invalid');
  const staff = await login(origin, 'staff@example.invalid');
  const reviewer = await login(origin, 'reviewer@example.invalid');
  const orgB = await login(origin, 'pm_b@example.invalid');

  try {
    await t.test('P07 mutations require Origin, CSRF and writer role', async () => {
      const noOrigin = await request(origin, '/api/cases/CASE-SYN-001/proposals', 'POST', { templateId: 'TPL-PROP-TYPE-01' }, pm, false);
      assert.strictEqual(noOrigin.status, 403);
      const badCsrf = await request(origin, '/api/cases/CASE-SYN-001/proposals', 'POST', { templateId: 'TPL-PROP-TYPE-01' }, { ...pm, csrf: 'wrong' });
      assert.strictEqual(badCsrf.status, 403);
      assert.strictEqual((await request(origin, '/api/cases/CASE-SYN-001/proposals', 'POST', { templateId: 'TPL-PROP-TYPE-01' }, staff)).status, 403);
      assert.strictEqual((await request(origin, '/api/cases/CASE-SYN-001/proposals', 'POST', { templateId: 'TPL-PROP-TYPE-01' }, reviewer)).status, 403);
    });

    await t.test('cross-organization proposal IDOR is rejected before record disclosure', async () => {
      const response = await request(origin, '/api/cases/CASE-SYN-001/proposals/PROP-SYN-001', 'GET', undefined, orgB);
      assert.strictEqual(response.status, 403);
    });

    await t.test('credentials, cross-case evidence and tampered evidence are rejected', async () => {
      await db.party.create({ data: { id: 'PARTY-P07-SEC', caseId: 'CASE-SYN-001', name: 'SYNTHETIC_SECURITY_CLIENT', role: 'CLIENT' } });
      const created = await request(origin, '/api/cases/CASE-SYN-001/proposals', 'POST', { templateId: 'TPL-PROP-TYPE-01', title: 'P07_SECURITY_PROPOSAL' }, pm);
      assert.strictEqual(created.status, 201);
      const proposalId = created.body.proposal.id;
      const source = Buffer.from('%PDF-1.4\nP07_SECURITY_SOURCE\n%%EOF');
      const uploaded = await request(origin, '/api/cases/CASE-SYN-001/documents', 'POST', {
        title: 'P07_SECURITY_SOURCE', source: 'RECEIVED', category: 'EVIDENCE', filename: 'p07-security.pdf',
        fileBase64: source.toString('base64'), mimeType: 'application/pdf'
      }, pm);
      assert.strictEqual(uploaded.status, 201);
      const sourceVersionId = uploaded.body.versionId;
      const base = {
        background: 'Background', objective: 'Objective', method: 'Method', expectedOutcome: 'Outcome', exclusions: 'None',
        generationMode: 'MANUAL', version: 1
      };
      assert.strictEqual((await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/versions`, 'POST', { ...base, apiKey: 'forbidden' }, pm)).status, 400);
      assert.strictEqual((await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/versions`, 'POST', { ...base, sourceDocumentVersionIds: ['DOCVER-SYN-003'] }, pm)).status, 403);
      const version = await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/versions`, 'POST', { ...base, sourceDocumentVersionIds: [sourceVersionId] }, pm);
      assert.strictEqual(version.status, 201);
      const sourceRow = await db.documentVersion.findUniqueOrThrow({ where: { id: sourceVersionId } });
      fs.writeFileSync(path.join(uploadDir, sourceRow.storageKey), Buffer.from('%PDF-1.4\nTAMPERED\n%%EOF'));
      const review = await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/reviews`, 'POST', {
        action: 'REQUEST_REVIEW', versionId: version.body.version.id, version: version.body.proposalVersion
      }, pm);
      assert.strictEqual(review.status, 409);
    });

    await t.test('Reviewer may approve but not write, while a Director cannot approve a self-authored version', async () => {
      const buildReviewable = async (session: Session, title: string) => {
        const created = await request(origin, '/api/cases/CASE-SYN-001/proposals', 'POST', { templateId: 'TPL-PROP-TYPE-01', title }, session);
        assert.strictEqual(created.status, 201);
        const proposalId = created.body.proposal.id;
        const version = await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/versions`, 'POST', {
          background: 'Background', objective: 'Objective', method: 'Method', expectedOutcome: 'Outcome', exclusions: 'None',
          generationMode: 'MANUAL', version: 1
        }, session);
        assert.strictEqual(version.status, 201);
        const review = await request(origin, `/api/cases/CASE-SYN-001/proposals/${proposalId}/reviews`, 'POST', {
          action: 'REQUEST_REVIEW', versionId: version.body.version.id, version: version.body.proposalVersion
        }, session);
        assert.strictEqual(review.status, 200);
        return { proposalId, versionId: version.body.version.id, optimisticVersion: review.body.version };
      };

      const pmProposal = await buildReviewable(pm, 'P07_REVIEWER_APPROVAL');
      const approved = await request(origin, `/api/cases/CASE-SYN-001/proposals/${pmProposal.proposalId}/reviews`, 'POST', {
        action: 'APPROVE', versionId: pmProposal.versionId, version: pmProposal.optimisticVersion
      }, reviewer);
      assert.strictEqual(approved.status, 200);
      assert.strictEqual((await request(origin, `/api/cases/CASE-SYN-001/proposals/${pmProposal.proposalId}/versions`, 'POST', {
        background: 'x', objective: 'x', method: 'x', expectedOutcome: 'x', exclusions: 'x', generationMode: 'MANUAL', version: approved.body.version
      }, reviewer)).status, 403);

      const directorProposal = await buildReviewable(director, 'P07_DIRECTOR_SELF_APPROVAL');
      const selfApproval = await request(origin, `/api/cases/CASE-SYN-001/proposals/${directorProposal.proposalId}/reviews`, 'POST', {
        action: 'APPROVE', versionId: directorProposal.versionId, version: directorProposal.optimisticVersion
      }, director);
      assert.strictEqual(selfApproval.status, 403);
      assert.match(selfApproval.body.error, /self-approve/);
    });

    await t.test('DB rejects invalid enums, pointers, self approval and cross-proposal review versions', async () => {
      await assert.rejects(db.proposalTemplate.create({
        data: { id: 'TPL-P07-BAD', name: 'bad', claimType: 'TYPE-07', bodyTemplate: 'bad', placeholdersJson: '[]', version: 1 }
      }));
      await assert.rejects(db.proposal.update({ where: { id: 'PROP-SYN-001' }, data: { currentVersionId: 'PROPVER-SYN-003' } }));
      await assert.rejects(db.proposalReview.create({
        data: { id: 'PROPREV-P07-CROSS', proposalId: 'PROP-SYN-001', versionId: 'PROPVER-SYN-003', reviewerId: 'USR-REVIEWER', action: 'REJECT' }
      }));
      await assert.rejects(db.proposalReview.create({
        data: { id: 'PROPREV-P07-SELF', proposalId: 'PROP-SYN-002', versionId: 'PROPVER-SYN-003', reviewerId: 'USR-PM', action: 'APPROVE' }
      }));
    });

    await t.test('all proposal snapshots and review rows remain append-only at DB level', async () => {
      await assert.rejects(db.proposalVersion.delete({ where: { id: 'PROPVER-SYN-001' } }));
      await assert.rejects(db.proposalVersion.update({ where: { id: 'PROPVER-SYN-001' }, data: { sha256: '0'.repeat(64) } }));
      await assert.rejects(db.proposalReview.update({ where: { id: 'PROPREV-SYN-001' }, data: { comment: 'changed' } }));
      await assert.rejects(db.proposalReview.delete({ where: { id: 'PROPREV-SYN-001' } }));
    });

    await t.test('P07 migration is additive over populated P05/P06 state', async () => {
      const upgradePath = path.join(__dirname, '../packages/database/.data', `p07-upgrade-${process.pid}.db`);
      const migrationNames = ['20260806070000_p04_baseline', '20260806080000_p05_case_management', '20260806090000_p06_materials_meetings'];
      const SQL = await initSqlJs({ locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`) });
      const sqlite = new SQL.Database();
      const now = new Date().toISOString();
      try {
        sqlite.run('PRAGMA foreign_keys = ON');
        sqlite.run('CREATE TABLE "_P04Migration" ("name" TEXT NOT NULL PRIMARY KEY, "checksum" TEXT NOT NULL, "appliedAt" TEXT NOT NULL)');
        for (const name of migrationNames) {
          const sql = fs.readFileSync(path.join(__dirname, `../packages/database/prisma/migrations/${name}/migration.sql`), 'utf8');
          sqlite.run(sql);
          sqlite.run('INSERT INTO "_P04Migration" VALUES (?,?,?)', [name, crypto.createHash('sha256').update(sql).digest('hex'), now]);
        }
        sqlite.run('INSERT INTO "Organization" ("id","name","createdAt","updatedAt") VALUES (?,?,?,?)', ['P07-UPGRADE-ORG', 'Synthetic upgrade org', now, now]);
        sqlite.run('INSERT INTO "User" ("id","email","passwordHash","name","organizationId","isActive","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)', ['P07-UPGRADE-USER', 'p07-upgrade@example.invalid', 'synthetic', 'Synthetic upgrade user', 'P07-UPGRADE-ORG', 1, now, now]);
        sqlite.run('INSERT INTO "CaseItem" ("id","organizationId","caseNumber","title","claimType","status","version","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)', ['P07-UPGRADE-CASE', 'P07-UPGRADE-ORG', 'P07-UPGRADE-0001', 'Preserved P06 case', 'TYPE-01', 'INQUIRY', 1, now, now]);
        sqlite.run('INSERT INTO "Document" ("id","caseId","title","source","version","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)', ['P07-UPGRADE-DOC', 'P07-UPGRADE-CASE', 'Preserved P06 document', 'RECEIVED', 1, now, now]);
        fs.writeFileSync(upgradePath, Buffer.from(sqlite.export()));
      } finally {
        sqlite.close();
      }
      try {
        await migrateDatabase(databaseUrlFor(upgradePath));
        const upgraded = createPrismaClient(databaseUrlFor(upgradePath));
        assert.strictEqual((await upgraded.caseItem.findUnique({ where: { id: 'P07-UPGRADE-CASE' } }))?.title, 'Preserved P06 case');
        assert.strictEqual((await upgraded.document.findUnique({ where: { id: 'P07-UPGRADE-DOC' } }))?.title, 'Preserved P06 document');
        assert.strictEqual(await upgraded.proposalTemplate.count(), 0);
        await upgraded.$disconnect();
      } finally {
        for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${upgradePath}${suffix}`, { force: true });
      }
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.waitForDatabaseClose();
    await db.$disconnect();
    fs.rmSync(uploadDir, { recursive: true, force: true });
    for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});
