import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { closeP12Isolated, startP12Isolated } from './p12-test-support';
import { requestJson } from './p09-test-support';

async function main(): Promise<void> {
  console.log('--- Running P12 Security & Adversarial Test ---');
  const context = await startP12Isolated('p12-security', { sectionCount: 3 });

  try {
    const { origin, db, fixture, uploadDir } = context;
    const { reportId, sectionIds, reviewer, pm, staff } = fixture;

    // 1. Invalid State Transitions & Unauthenticated / Unauthorized Attempts
    console.log('1. Testing Review Request & Finalization Access Control...');

    // Staff attempts to request review
    const revRes = await requestJson(origin, `/api/reports/${reportId}/review-requests`, 'POST', {
      comment: 'Review request'
    }, pm);
    assert.equal(revRes.status, 201);
    const requestId = revRes.body.reviewRequest.id;

    const invalidAssignee = await requestJson(origin, `/api/reports/${reportId}/review-requests`, 'POST', {
      assignedReviewerId: 'USR-STAFF', comment: 'Staff cannot be assigned as independent reviewer'
    }, pm);
    assert.equal(invalidAssignee.status, 400);

    // Staff attempts to request changes (Staff does NOT have reviewer role) -> 403
    const staffChange = await requestJson(origin, `/api/reports/${reportId}/review-requests/${requestId}/changes-requested`, 'POST', {
      comment: 'Staff cannot review'
    }, staff);
    assert.equal(staffChange.status, 403, 'Staff must be denied reviewer actions');

    // Reviewer requests changes
    const revChange = await requestJson(origin, `/api/reports/${reportId}/review-requests/${requestId}/changes-requested`, 'POST', {
      comment: 'Reviewer changes requested'
    }, reviewer);
    assert.equal(revChange.status, 200);

    // Create revisions for sections
    for (const secId of sectionIds) {
      const sec = await db.reportSection.findUniqueOrThrow({ where: { id: secId } });
      await requestJson(origin, `/api/reports/${reportId}/sections/${secId}/revisions`, 'POST', {
        title: sec.title,
        content: `제 ${sec.sectionNumber} 장 손해사정 검토 내용입니다.`,
        structuredDataJson: '{}',
        expectedVersion: sec.version,
        saveMode: 'MANUAL',
        evidenceLinks: []
      }, staff);
    }

    // Approve sections 1..3 with reviewer
    for (const secId of sectionIds) {
      const sec = await db.reportSection.findUniqueOrThrow({ where: { id: secId }, include: { revisions: true } });
      await requestJson(origin, `/api/reports/${reportId}/sections/${secId}/approve`, 'POST', {
        revisionId: sec.revisions[0].id,
        expectedVersion: sec.version
      }, reviewer);
    }

    // Finalize report legitimately with reviewer
    const finRes = await requestJson(origin, `/api/reports/${reportId}/finalizations`, 'POST', {}, reviewer);
    assert.equal(finRes.status, 201);
    const finalizationId = finRes.body.finalization.id;

    const staffOutput = await requestJson(origin, `/api/reports/${reportId}/finalizations/${finalizationId}/outputs`, 'POST', {
      format: 'DOCX'
    }, staff);
    assert.equal(staffOutput.status, 403, 'Staff must not generate final output artifacts');
    assert.equal(await db.reportOutputArtifact.count({ where: { finalizationId } }), 0);

    // Generate output legitimately
    const outRes = await requestJson(origin, `/api/reports/${reportId}/finalizations/${finalizationId}/outputs`, 'POST', {
      format: 'DOCX'
    }, reviewer);
    assert.equal(outRes.status, 201);
    const artifactId = outRes.body.artifact.id;

    // 2. Storage Tampering & Missing File Tests
    console.log('2. Testing Integrity Verification & Tamper Detection...');

    // Corrupt storage file on disk
    const artifact = outRes.body.artifact;
    const diskPath = path.join(uploadDir, artifact.storageKey);
    fs.writeFileSync(diskPath, Buffer.from('TAMPERED CORRUPTED CONTENT'));

    // Download attempt on tampered file
    const tamperedDl = await requestJson(origin, `/api/reports/outputs/${artifactId}/download`, 'GET', undefined, reviewer);
    assert.equal(tamperedDl.status, 409, 'Tampered storage file must trigger 409 integrity failure');

    // Remove file from disk
    fs.unlinkSync(diskPath);
    const missingDl = await requestJson(origin, `/api/reports/outputs/${artifactId}/download`, 'GET', undefined, reviewer);
    assert.equal(missingDl.status, 409, 'Missing storage file must trigger 409 error');

    // 3. Database Immutability Trigger Enforcement
    console.log('3. Testing SQLite DB Trigger Immutability Guards...');

    let updateRejected = false;
    try {
      await db.$executeRawUnsafe(`UPDATE "ReportFinalization" SET "status" = 'TAMPERED' WHERE "id" = '${finalizationId}'`);
    } catch (err) {
      updateRejected = true;
      assert.ok(err, 'UPDATE on ReportFinalization must throw error');
    }
    assert.ok(updateRejected, 'Database trigger must prevent UPDATE on ReportFinalization');

    let deleteRejected = false;
    try {
      await db.$executeRawUnsafe(`DELETE FROM "ReportOutputArtifact" WHERE "id" = '${artifactId}'`);
    } catch (err) {
      deleteRejected = true;
      assert.ok(err, 'DELETE on ReportOutputArtifact must throw error');
    }
    assert.ok(deleteRejected, 'Database trigger must prevent DELETE on ReportOutputArtifact');

    let reviewUpdateRejected = false;
    try {
      await db.$executeRawUnsafe(`UPDATE "ReportReviewRequest" SET "status" = 'APPROVED' WHERE "id" = '${requestId}'`);
    } catch (err) {
      reviewUpdateRejected = true;
      assert.ok(err);
    }
    assert.ok(reviewUpdateRejected, 'Review history must be append-only');

    console.log('✅ P12 Security & Adversarial Test Passed Cleanly!');
  } finally {
    await closeP12Isolated(context);
  }
}

main().catch((err) => {
  console.error('❌ P12 Security Test Failed:', err);
  process.exit(1);
});
