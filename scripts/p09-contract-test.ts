import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import {
  createPrismaClient, databaseUrlFor, resetDatabase, seedDatabase, type PrismaClient
} from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import { createP09Fixture, requestJson, revisionPayload } from './p09-test-support';

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(root, 'packages/database/prisma/migrations/20260807110000_p09_report_studio/migration.sql');
const schemaPath = path.join(root, 'packages/database/prisma/schema.prisma');
const testOrigin = 'http://127.0.0.1:43179';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function startIsolated(name: string): Promise<{
  db: PrismaClient;
  api: ManagedApiServer;
  origin: string;
  databasePath: string;
  uploadDir: string;
}> {
  const databasePath = path.join(root, 'packages/database/.data', `${name}-${process.pid}-${Date.now()}.db`);
  const uploadDir = path.join(root, 'packages/database/.data', `${name}-uploads-${process.pid}-${Date.now()}`);
  const databaseUrl = databaseUrlFor(databasePath);
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const db = createPrismaClient(databaseUrl);
  const api = createApiServer({ databaseUrl, allowedOrigins: [testOrigin], secureCookies: false, uploadDir });
  await new Promise<void>((resolve, reject) => api.once('error', reject).listen(0, '127.0.0.1', resolve));
  return { db, api, origin: `http://127.0.0.1:${(api.address() as AddressInfo).port}`, databasePath, uploadDir };
}

async function closeIsolated(context: Awaited<ReturnType<typeof startIsolated>>): Promise<void> {
  await new Promise<void>((resolve) => context.api.close(() => resolve()));
  await context.api.waitForDatabaseClose();
  await context.db.$disconnect();
  fs.rmSync(context.uploadDir, { recursive: true, force: true });
  for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${context.databasePath}${suffix}`, { force: true });
}

test('P09 migration is additive and declares every history/provenance guard', () => {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  for (const model of ['ReportSectionRevision', 'ReportEvidenceLink', 'ReportSectionComment', 'ReportSectionApproval', 'ReportMergeSnapshot']) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }
  for (const guard of [
    'P09_revision_insert_guard', 'P09_revision_immutable_update', 'P09_revision_immutable_delete',
    'P09_evidence_insert_guard', 'P09_evidence_immutable_update', 'P09_evidence_immutable_delete',
    'P09_comment_resolution_only', 'P09_comment_resolver_scope', 'P09_comment_delete_guard', 'P09_approval_insert_guard',
    'P09_approval_immutable_update', 'P09_approval_immutable_delete', 'P09_report_section_content_guard',
    'P09_report_section_status_transition_guard', 'P09_merge_snapshot_insert_guard',
    'P09_merge_snapshot_immutable_update', 'P09_merge_snapshot_immutable_delete', 'P09_report_history_delete_guard'
  ]) assert.ok(migration.includes(guard), `Missing P09 DB guard: ${guard}`);
  assert.doesNotMatch(migration, /DROP\s+TABLE|ALTER\s+TABLE\s+[^;]+\s+RENAME/i);
  assert.match(migration, /ON DELETE RESTRICT/);
  assert.doesNotMatch(migration, /ON DELETE SET NULL|ON DELETE CASCADE/);
});

test('P09 production seed does not bypass P08 ReportInstance provenance', async () => {
  const context = await startIsolated('p09-seed');
  try {
    assert.strictEqual(await context.db.reportInstance.count(), 0);
    assert.strictEqual(await context.db.report.count({ where: { reportInstanceId: { not: null } } }), 0);
    assert.strictEqual(await context.db.reportSectionRevision.count(), 0);
  } finally {
    await closeIsolated(context);
  }
});

test('P09 API enforces optimistic revisions, paragraph evidence, independent approval, unlock, and deterministic merge', async () => {
  const context = await startIsolated('p09-contract');
  try {
    const fixture = await createP09Fixture(context.origin, context.db, { requestOrigin: testOrigin });
    const [section1, section2, section3] = fixture.sectionIds;
    const studio = await requestJson(context.origin, `/api/reports/${fixture.reportId}/studio`, 'GET', undefined, fixture.pm, testOrigin);
    assert.strictEqual(studio.status, 200);
    assert.strictEqual(studio.body.report.reportInstanceId, fixture.reportInstanceId);
    assert.strictEqual(studio.body.report.sections.length, 3);
    assert.doesNotMatch(JSON.stringify(studio.body), /storageKey|originalName|rawText\"/);

    const firstSave = await requestJson(context.origin, `/api/reports/${fixture.reportId}/sections/${section1}/revisions`, 'POST',
      revisionPayload(1, '계약금액 100원은 최종 회의록에서 확인되었습니다.', { withMeetingEvidence: true, saveMode: 'AUTO' }), fixture.pm, testOrigin);
    assert.strictEqual(firstSave.status, 201);
    assert.strictEqual(firstSave.body.revision.validationStatus, 'VALID');
    assert.strictEqual(firstSave.body.sectionVersion, 2);
    assert.match(firstSave.body.revision.sha256, /^[0-9a-f]{64}$/);
    assert.strictEqual(firstSave.body.revision.evidenceLinks[0].targetParagraphIndex, 0);

    const stale = await requestJson(context.origin, `/api/reports/${fixture.reportId}/sections/${section1}/revisions`, 'POST',
      revisionPayload(1, '동시 편집에서 유실되어서는 안 되는 초안입니다.'), fixture.staff, testOrigin);
    assert.strictEqual(stale.status, 409);
    assert.strictEqual(stale.body.currentVersion, 2);
    assert.strictEqual(stale.body.latestRevision.id, firstSave.body.revision.id);

    const directPatch = await requestJson(context.origin, `/api/reports/${fixture.reportId}/sections/${section1}/body`, 'PATCH',
      { content: '승인 우회', version: 2 }, fixture.pm, testOrigin);
    assert.strictEqual(directPatch.status, 410);

    const secondSave1 = await requestJson(context.origin, `/api/reports/${fixture.reportId}/sections/${section2}/revisions`, 'POST',
      revisionPayload(1, '초기 사실관계 검토 문단입니다.'), fixture.pm, testOrigin);
    assert.strictEqual(secondSave1.status, 201);
    const revisionRequest = await requestJson(context.origin, `/api/reports/${fixture.reportId}/sections/${section2}/comments`, 'POST', {
      commentType: 'REVISION_REQUEST',
      content: '표현을 더 명확하게 수정해 주세요.',
      revisionId: secondSave1.body.revision.id,
      expectedVersion: 2
    }, fixture.reviewer, testOrigin);
    assert.strictEqual(revisionRequest.status, 201);
    const unresolvedApproval = await requestJson(context.origin, `/api/reports/${fixture.reportId}/sections/${section2}/approve`, 'POST', {
      revisionId: secondSave1.body.revision.id,
      expectedVersion: 3
    }, fixture.reviewer, testOrigin);
    assert.strictEqual(unresolvedApproval.status, 409);
    assert.strictEqual((await requestJson(context.origin,
      `/api/reports/${fixture.reportId}/sections/${section2}/comments/${revisionRequest.body.comment.id}/resolve`,
      'PATCH', {}, fixture.pm, testOrigin)).status, 200);
    const secondSave2 = await requestJson(context.origin, `/api/reports/${fixture.reportId}/sections/${section2}/revisions`, 'POST',
      revisionPayload(3, '수정 요청을 반영한 사실관계 문단입니다.'), fixture.pm, testOrigin);
    assert.strictEqual(secondSave2.status, 201);

    const longContent = ['가'.repeat(10_000), ...Array.from({ length: 9 }, () => '가'.repeat(9_998))].join('\n\n');
    const thirdSave = await requestJson(context.origin, `/api/reports/${fixture.reportId}/sections/${section3}/revisions`, 'POST',
      revisionPayload(1, longContent), fixture.staff, testOrigin);
    assert.strictEqual(thirdSave.status, 201);
    assert.strictEqual(thirdSave.body.revision.content.length, longContent.length);

    const warningSave = await requestJson(context.origin, `/api/reports/${fixture.reportId}/sections/${section3}/revisions`, 'POST',
      revisionPayload(2, '근거 없이 청구액 500원을 확정한 문단입니다.'), fixture.staff, testOrigin);
    assert.strictEqual(warningSave.status, 201);
    assert.strictEqual(warningSave.body.revision.validationStatus, 'WARNING');
    assert.strictEqual((await requestJson(context.origin, `/api/reports/${fixture.reportId}/sections/${section3}/approve`, 'POST', {
      revisionId: warningSave.body.revision.id, expectedVersion: 3
    }, fixture.director, testOrigin)).status, 409);
    const thirdValid = await requestJson(context.origin, `/api/reports/${fixture.reportId}/sections/${section3}/revisions`, 'POST',
      revisionPayload(3, '근거가 필요한 확정 표현을 제거한 결론 문단입니다.'), fixture.staff, testOrigin);
    assert.strictEqual(thirdValid.status, 201);

    const selfApproval = await requestJson(context.origin, `/api/reports/${fixture.reportId}/sections/${section1}/approve`, 'POST', {
      revisionId: firstSave.body.revision.id, expectedVersion: 2
    }, fixture.pm, testOrigin);
    assert.strictEqual(selfApproval.status, 403);
    const crossSectionApproval = await requestJson(context.origin, `/api/reports/${fixture.reportId}/sections/${section2}/approve`, 'POST', {
      revisionId: firstSave.body.revision.id, expectedVersion: 4
    }, fixture.reviewer, testOrigin);
    assert.strictEqual(crossSectionApproval.status, 400);

    assert.strictEqual((await requestJson(context.origin, `/api/reports/${fixture.reportId}/sections/${section1}/approve`, 'POST', {
      revisionId: firstSave.body.revision.id, expectedVersion: 2, comment: '독립 검토 승인'
    }, fixture.reviewer, testOrigin)).status, 200);
    assert.strictEqual((await requestJson(context.origin, `/api/reports/${fixture.reportId}/sections/${section2}/approve`, 'POST', {
      revisionId: secondSave2.body.revision.id, expectedVersion: 4
    }, fixture.reviewer, testOrigin)).status, 200);
    assert.strictEqual((await requestJson(context.origin, `/api/reports/${fixture.reportId}/sections/${section3}/approve`, 'POST', {
      revisionId: thirdValid.body.revision.id, expectedVersion: 4
    }, fixture.director, testOrigin)).status, 200);

    const merge = await requestJson(context.origin, `/api/reports/${fixture.reportId}/merge`, 'POST', { expectedReportVersion: 1 }, fixture.pm, testOrigin);
    assert.strictEqual(merge.status, 201);
    assert.match(merge.body.snapshot.snapshotSha256, /^[0-9a-f]{64}$/);
    const sectionsSnapshot = JSON.parse(merge.body.snapshot.sectionsSnapshotJson);
    const evidenceSnapshot = JSON.parse(merge.body.snapshot.evidenceSnapshotJson);
    const expectedSnapshotHash = crypto.createHash('sha256').update(canonicalJson({
      reportId: fixture.reportId,
      reportInstanceId: fixture.reportInstanceId,
      snapshotVersion: 1,
      sections: sectionsSnapshot,
      evidence: evidenceSnapshot,
      mergedBodyText: merge.body.snapshot.mergedBodyText
    })).digest('hex');
    assert.strictEqual(merge.body.snapshot.snapshotSha256, expectedSnapshotHash);
    assert.ok(merge.body.snapshot.mergedBodyText.includes('수정 요청을 반영한 사실관계'));
    assert.ok(!merge.body.snapshot.mergedBodyText.includes('초기 사실관계 검토'));

    await assert.rejects(context.db.reportSectionRevision.update({ where: { id: firstSave.body.revision.id }, data: { content: 'tamper' } }));
    await assert.rejects(context.db.reportSectionRevision.delete({ where: { id: firstSave.body.revision.id } }));
    await assert.rejects(context.db.reportEvidenceLink.update({ where: { id: firstSave.body.revision.evidenceLinks[0].id }, data: { quoteText: 'tamper' } }));
    await assert.rejects(context.db.reportEvidenceLink.delete({ where: { id: firstSave.body.revision.evidenceLinks[0].id } }));
    await assert.rejects(context.db.reportSection.update({ where: { id: section1 }, data: { content: 'direct tamper' } }));
    await assert.rejects(context.db.reportMergeSnapshot.update({ where: { id: merge.body.snapshot.id }, data: { mergedBodyText: 'tamper' } }));
    await assert.rejects(context.db.reportMergeSnapshot.delete({ where: { id: merge.body.snapshot.id } }));
    await assert.rejects(context.db.report.delete({ where: { id: fixture.reportId } }));

    assert.strictEqual((await requestJson(context.origin, `/api/reports/${fixture.reportId}/sections/${section1}/unlock`, 'POST', {
      expectedVersion: 3, comment: 'PM cannot unlock'
    }, fixture.pm, testOrigin)).status, 403);
    assert.strictEqual((await requestJson(context.origin, `/api/reports/${fixture.reportId}/sections/${section1}/unlock`, 'POST', {
      expectedVersion: 3, comment: '근거 문구 보완을 위한 명시적 잠금 해제'
    }, fixture.reviewer, testOrigin)).status, 200);
    assert.strictEqual((await requestJson(context.origin, `/api/reports/${fixture.reportId}/merge`, 'POST', {
      expectedReportVersion: 2
    }, fixture.pm, testOrigin)).status, 409);
    const newRevision = await requestJson(context.origin, `/api/reports/${fixture.reportId}/sections/${section1}/revisions`, 'POST',
      revisionPayload(4, '잠금 해제 후 생성한 새로운 개정 문단입니다.'), fixture.pm, testOrigin);
    assert.strictEqual(newRevision.status, 201);
    assert.strictEqual((await requestJson(context.origin, `/api/reports/${fixture.reportId}/sections/${section1}/approve`, 'POST', {
      revisionId: newRevision.body.revision.id, expectedVersion: 5
    }, fixture.reviewer, testOrigin)).status, 200);
    const merge2 = await requestJson(context.origin, `/api/reports/${fixture.reportId}/merge`, 'POST', { expectedReportVersion: 2 }, fixture.director, testOrigin);
    assert.strictEqual(merge2.status, 201);
    assert.strictEqual(merge2.body.snapshot.snapshotVersion, 2);

    const actions = (await context.db.auditLog.findMany({ where: { targetId: { in: [firstSave.body.revision.id, merge.body.snapshot.id] } } })).map((row) => row.action);
    assert.ok(actions.includes('REPORT_SECTION_REVISION_CREATED'));
    assert.ok(actions.includes('REPORT_MERGE_SNAPSHOT_CREATED'));
  } finally {
    await closeIsolated(context);
  }
});

test('P09 ReportInstance and studio load the 100-section boundary without truncation', async () => {
  const context = await startIsolated('p09-100-sections');
  try {
    const fixture = await createP09Fixture(context.origin, context.db, { sectionCount: 100, requestOrigin: testOrigin });
    const studio = await requestJson(context.origin, `/api/reports/${fixture.reportId}/studio`, 'GET', undefined, fixture.pm, testOrigin);
    assert.strictEqual(studio.status, 200);
    assert.strictEqual(studio.body.report.sections.length, 100);
    assert.strictEqual(studio.body.report.sections[99].sectionNumber, 100);
  } finally {
    await closeIsolated(context);
  }
});
