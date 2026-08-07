import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createPrismaClient, databaseUrlFor, resetDatabase, seedDatabase } from '@claim-studio/database';
import { createApiServer } from '../apps/api/src/server';
import { createP09Fixture, login, requestJson, revisionPayload } from './p09-test-support';

const root = path.resolve(__dirname, '..');
const testOrigin = 'http://127.0.0.1:43180';

test('P09 security rejects role, tenant, provenance, lifecycle, mutation, and rollback attacks', async () => {
  const databasePath = path.join(root, 'packages/database/.data', `p09-security-${process.pid}.db`);
  const uploadDir = path.join(root, 'packages/database/.data', `p09-security-uploads-${process.pid}`);
  const databaseUrl = databaseUrlFor(databasePath);
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const db = createPrismaClient(databaseUrl);
  const api = createApiServer({ databaseUrl, allowedOrigins: [testOrigin], secureCookies: false, uploadDir });
  await new Promise<void>((resolve, reject) => api.once('error', reject).listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

  try {
    const fixture = await createP09Fixture(origin, db, { requestOrigin: testOrigin });
    const [section1, section2] = fixture.sectionIds;
    const orgB = await login(origin, 'pm_b@example.invalid', testOrigin);

    const reviewerEdit = await requestJson(origin, `/api/reports/${fixture.reportId}/sections/${section1}/revisions`, 'POST',
      revisionPayload(1, 'Reviewer direct edit'), fixture.reviewer, testOrigin);
    assert.strictEqual(reviewerEdit.status, 403);
    const staffApproval = await requestJson(origin, `/api/reports/${fixture.reportId}/sections/${section1}/approve`, 'POST', {
      revisionId: 'unknown', expectedVersion: 1
    }, fixture.staff, testOrigin);
    assert.strictEqual(staffApproval.status, 403);
    const reviewerMerge = await requestJson(origin, `/api/reports/${fixture.reportId}/merge`, 'POST', { expectedReportVersion: 1 }, fixture.reviewer, testOrigin);
    assert.strictEqual(reviewerMerge.status, 403);

    const missingCsrf = await requestJson(origin, `/api/reports/${fixture.reportId}/sections/${section1}/revisions`, 'POST',
      revisionPayload(1, 'CSRF bypass'), { cookie: fixture.pm.cookie, csrf: '' }, testOrigin);
    assert.strictEqual(missingCsrf.status, 403);
    const crossTenant = await requestJson(origin, `/api/reports/${fixture.reportId}/studio`, 'GET', undefined, orgB, testOrigin);
    assert.strictEqual(crossTenant.status, 403);

    const unknownField = await requestJson(origin, `/api/reports/${fixture.reportId}/sections/${section1}/revisions`, 'POST', {
      ...revisionPayload(1, 'Unknown input'), apiKey: 'must-not-be-accepted'
    }, fixture.pm, testOrigin);
    assert.strictEqual(unknownField.status, 400);
    const invalidSourceType = await requestJson(origin, `/api/reports/${fixture.reportId}/sections/${section1}/revisions`, 'POST', {
      ...revisionPayload(1, 'Invalid evidence'),
      evidenceLinks: [{ sourceType: 'URL', sourceId: 'https://example.invalid', targetParagraphIndex: 0, quoteText: 'x', anchorPosition: 'x' }]
    }, fixture.pm, testOrigin);
    assert.strictEqual(invalidSourceType.status, 400);
    const draftMeeting = await requestJson(origin, `/api/reports/${fixture.reportId}/sections/${section1}/revisions`, 'POST', {
      ...revisionPayload(1, '계약금액 100원'),
      evidenceLinks: [{ sourceType: 'MEETING', sourceId: 'MEET-SYN-001', targetParagraphIndex: 0, quoteText: 'draft', anchorPosition: 'p1' }]
    }, fixture.pm, testOrigin);
    assert.strictEqual(draftMeeting.status, 409);

    const save = await requestJson(origin, `/api/reports/${fixture.reportId}/sections/${section1}/revisions`, 'POST',
      revisionPayload(1, '계약금액 100원은 최종 회의에서 확인했습니다.', { withMeetingEvidence: true }), fixture.pm, testOrigin);
    assert.strictEqual(save.status, 201);
    const beforeConflictRevisionCount = await db.reportSectionRevision.count({ where: { sectionId: section1 } });
    const beforeConflictAuditCount = await db.auditLog.count({ where: { action: 'REPORT_SECTION_REVISION_CREATED', targetEntity: 'ReportSectionRevision' } });
    const conflict = await requestJson(origin, `/api/reports/${fixture.reportId}/sections/${section1}/revisions`, 'POST',
      revisionPayload(1, 'stale revision'), fixture.staff, testOrigin);
    assert.strictEqual(conflict.status, 409);
    assert.strictEqual(await db.reportSectionRevision.count({ where: { sectionId: section1 } }), beforeConflictRevisionCount);
    assert.strictEqual(await db.auditLog.count({ where: { action: 'REPORT_SECTION_REVISION_CREATED', targetEntity: 'ReportSectionRevision' } }), beforeConflictAuditCount);

    const section2Save = await requestJson(origin, `/api/reports/${fixture.reportId}/sections/${section2}/revisions`, 'POST',
      revisionPayload(1, '독립 검토 대상 문단입니다.'), fixture.staff, testOrigin);
    assert.strictEqual(section2Save.status, 201);
    assert.strictEqual((await requestJson(origin, `/api/reports/${fixture.reportId}/sections/${section2}/approve`, 'POST', {
      revisionId: save.body.revision.id, expectedVersion: 2
    }, fixture.reviewer, testOrigin)).status, 400);
    assert.strictEqual((await requestJson(origin, `/api/reports/${fixture.reportId}/sections/${section1}/approve`, 'POST', {
      revisionId: save.body.revision.id, expectedVersion: 2
    }, fixture.pm, testOrigin)).status, 403);

    await db.meeting.create({
      data: {
        id: 'MEET-P09-ORGB',
        caseId: 'CASE-SYN-ORGB',
        title: 'ORG B FINAL',
        meetingDate: new Date('2026-08-07T00:00:00Z'),
        rawText: 'ORG B private transcript',
        rawTextSha256: crypto.createHash('sha256').update('ORG B private transcript').digest('hex'),
        status: 'FINAL',
        version: 1,
        createdById: 'USR-ORGB-PM'
      }
    });
    const crossCaseEvidence = await requestJson(origin, `/api/reports/${fixture.reportId}/sections/${section2}/revisions`, 'POST', {
      ...revisionPayload(2, 'Cross-case source attempt'),
      evidenceLinks: [{ sourceType: 'MEETING', sourceId: 'MEET-P09-ORGB', targetParagraphIndex: 0, quoteText: 'private', anchorPosition: 'p1' }]
    }, fixture.staff, testOrigin);
    assert.strictEqual(crossCaseEvidence.status, 403);

    await assert.rejects(db.reportEvidenceLink.create({
      data: {
        id: 'P09-EVID-CROSS-CASE',
        revisionId: save.body.revision.id,
        sourceType: 'MEETING',
        sourceId: 'MEET-P09-ORGB',
        sourceDocumentVersionId: null,
        sourceMeetingId: 'MEET-P09-ORGB',
        sourceSha256: crypto.createHash('sha256').update('ORG B private transcript').digest('hex'),
        sourceVersion: 1,
        targetParagraphIndex: 0,
        quoteText: 'private',
        anchorPosition: 'p1'
      }
    }));
    await assert.rejects(db.reportSectionApproval.create({
      data: {
        id: 'P09-APPR-SELF',
        sectionId: section1,
        approvedRevisionId: save.body.revision.id,
        approverId: 'USR-PM',
        eventNumber: 1,
        status: 'APPROVED'
      }
    }));
    await assert.rejects(db.reportSectionApproval.create({
      data: {
        id: 'P09-APPR-CROSS-SECTION',
        sectionId: section2,
        approvedRevisionId: save.body.revision.id,
        approverId: 'USR-REVIEWER',
        eventNumber: 1,
        status: 'APPROVED'
      }
    }));

    const comment = await requestJson(origin, `/api/reports/${fixture.reportId}/sections/${section1}/comments`, 'POST', {
      commentType: 'COMMENT', content: 'append-only comment', revisionId: save.body.revision.id
    }, fixture.reviewer, testOrigin);
    assert.strictEqual(comment.status, 201);
    await assert.rejects(db.reportSectionComment.update({ where: { id: comment.body.comment.id }, data: { content: 'tamper' } }));
    await assert.rejects(db.reportSectionComment.delete({ where: { id: comment.body.comment.id } }));

    const approval = await requestJson(origin, `/api/reports/${fixture.reportId}/sections/${section1}/approve`, 'POST', {
      revisionId: save.body.revision.id, expectedVersion: 2
    }, fixture.reviewer, testOrigin);
    assert.strictEqual(approval.status, 200);
    await assert.rejects(db.reportSectionApproval.update({ where: { id: approval.body.approval.id }, data: { comment: 'tamper' } }));
    await assert.rejects(db.reportSectionApproval.delete({ where: { id: approval.body.approval.id } }));
    assert.strictEqual((await requestJson(origin, `/api/reports/${fixture.reportId}/sections/${section1}/comments`, 'POST', {
      commentType: 'REVISION_REQUEST', content: 'approved bypass', revisionId: save.body.revision.id, expectedVersion: 3
    }, fixture.reviewer, testOrigin)).status, 409);

    console.log('P09 security: RBAC, CSRF, tenant isolation, strict input, provenance, self/cross approval, immutable events, rollback PASSED');
  } finally {
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await api.waitForDatabaseClose();
    await db.$disconnect();
    fs.rmSync(uploadDir, { recursive: true, force: true });
    for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});
