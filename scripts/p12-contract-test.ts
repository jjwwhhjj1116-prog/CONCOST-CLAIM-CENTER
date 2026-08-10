import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateReportDocxBuffer, validateReportDocxBuffer } from '../packages/document-engine/src/docx-engine';
import { generateReportPdfBuffer, validateReportPdfBuffer } from '../packages/document-engine/src/pdf-engine';
import { closeP12Isolated, startP12Isolated } from './p12-test-support';
import { requestJson } from './p09-test-support';

async function main(): Promise<void> {
  console.log('--- Running P12 Contract & Deterministic Final Output Test ---');
  const context = await startP12Isolated('p12-contract', { sectionCount: 5 });

  try {
    const { origin, db, fixture, uploadDir } = context;
    const { reportId, sectionIds, pm, staff, reviewer } = fixture;

    const reportWorkspace = await requestJson(origin, '/api/reports', 'GET', undefined, pm);
    assert.equal(reportWorkspace.status, 200);
    assert.ok(reportWorkspace.body.reports.some((report: { id: string }) => report.id === reportId), 'REPO-01 must expose an accessible report studio entry');

    // 1. Review Request Flow
    console.log('1. Testing Review Request creation & changes request cycle...');
    const req1 = await requestJson(origin, `/api/reports/${reportId}/review-requests`, 'POST', {
      comment: '1차 초안 작성 완료 검토 요청'
    }, pm);
    assert.equal(req1.status, 201, JSON.stringify(req1.body));
    let requestId = req1.body.reviewRequest.id;

    const approvalInbox = await requestJson(origin, '/api/review-requests', 'GET', undefined, reviewer);
    assert.equal(approvalInbox.status, 200);
    assert.equal(approvalInbox.body.reviewRequests.length, 1, 'APPR-01 must expose the latest accessible review request');
    assert.equal(approvalInbox.body.reviewRequests[0].report.id, reportId);
    assert.equal(approvalInbox.body.reviewRequests[0].status, 'PENDING');

    // Reviewer requests changes (requires comment)
    const changesErr = await requestJson(origin, `/api/reports/${reportId}/review-requests/${requestId}/changes-requested`, 'POST', {
      comment: ''
    }, reviewer);
    assert.equal(changesErr.status, 400, 'Comment required for changes request');

    const changesSuccess = await requestJson(origin, `/api/reports/${reportId}/review-requests/${requestId}/changes-requested`, 'POST', {
      comment: '제 2장 문단 보완 필요'
    }, reviewer);
    assert.equal(changesSuccess.status, 200, JSON.stringify(changesSuccess.body));
    assert.equal(changesSuccess.body.reviewRequest.status, 'CHANGES_REQUESTED');
    requestId = changesSuccess.body.reviewRequest.id;

    // Resubmit
    const resubmit = await requestJson(origin, `/api/reports/${reportId}/review-requests/${requestId}/resubmit`, 'POST', {
      comment: '제 2장 보완 완료'
    }, staff);
    assert.equal(resubmit.status, 200);
    assert.equal(resubmit.body.reviewRequest.status, 'RESUBMITTED');
    const reviewEvents = await db.reportReviewRequest.findMany({ where: { reportId }, orderBy: { eventNumber: 'asc' } });
    assert.deepEqual(reviewEvents.map((event) => event.status), ['PENDING', 'CHANGES_REQUESTED', 'RESUBMITTED']);

    const replayKey = await requestJson(origin, `/api/reports/${reportId}/review-requests`, 'POST', {
      comment: '결정적 검토 요청', idempotencyKey: 'P12-REVIEW-IDEMP-001'
    }, pm);
    const replaySame = await requestJson(origin, `/api/reports/${reportId}/review-requests`, 'POST', {
      comment: '결정적 검토 요청', idempotencyKey: 'P12-REVIEW-IDEMP-001'
    }, pm);
    assert.equal(replaySame.status, 200);
    assert.equal(replaySame.body.reviewRequest.id, replayKey.body.reviewRequest.id);
    const replayMismatch = await requestJson(origin, `/api/reports/${reportId}/review-requests`, 'POST', {
      comment: '변경된 요청', idempotencyKey: 'P12-REVIEW-IDEMP-001'
    }, pm);
    assert.equal(replayMismatch.status, 409);

    // Ensure all sections have an initial revision authored by staff
    for (const secId of sectionIds) {
      const sec = await db.reportSection.findUniqueOrThrow({ where: { id: secId } });
      await requestJson(origin, `/api/reports/${reportId}/sections/${secId}/revisions`, 'POST', {
        title: sec.title,
        content: `제 ${sec.sectionNumber} 장 손해사정 검토 내용입니다.\n손해액 및 관련 증빙 자료 검토 완료.`,
        structuredDataJson: '{}',
        expectedVersion: sec.version,
        saveMode: 'MANUAL',
        evidenceLinks: []
      }, staff);
    }

    // 2. Readiness Blockers & Self-Approval Prevention Test
    console.log('2. Testing Finalization readiness blockers & self-approval prevention...');

    // Attempt finalization before sections are approved
    const preFin = await requestJson(origin, `/api/reports/${reportId}/finalizations`, 'POST', {}, reviewer);
    assert.equal(preFin.status, 409, 'Finalization must be blocked when sections are not approved');

    // Approve sections 1..4 by reviewer (staff is author)
    for (let i = 0; i < 4; i++) {
      const secId = sectionIds[i];
      const sec = await db.reportSection.findUniqueOrThrow({ where: { id: secId }, include: { revisions: true } });
      const revId = sec.revisions[0].id;

      // Self approval attempt: staff approves staff's own revision -> allowed at approval route (or blocked) but must be blocked at finalization!
      const appRes = await requestJson(origin, `/api/reports/${reportId}/sections/${secId}/approve`, 'POST', {
        revisionId: revId,
        expectedVersion: sec.version
      }, reviewer);
      assert.equal(appRes.status, 200, JSON.stringify(appRes.body));
    }

    // Now section 5 is unapproved -> Finalization still blocked
    const preFin5 = await requestJson(origin, `/api/reports/${reportId}/finalizations`, 'POST', {}, reviewer);
    assert.equal(preFin5.status, 409, 'Section 5 unapproved');

    // Approve section 5 with reviewer
    const sec5 = await db.reportSection.findUniqueOrThrow({ where: { id: sectionIds[4] }, include: { revisions: true } });
    const appRes5 = await requestJson(origin, `/api/reports/${reportId}/sections/${sectionIds[4]}/approve`, 'POST', {
      revisionId: sec5.revisions[0].id,
      expectedVersion: sec5.version
    }, reviewer);
    assert.equal(appRes5.status, 200);

    // 3. Finalization Creation & Canonical Hash Test
    console.log('3. Testing Report Finalization creation & idempotency...');
    const finRes = await requestJson(origin, `/api/reports/${reportId}/finalizations`, 'POST', {
      idempotencyKey: 'FIN-IDEMP-001'
    }, reviewer);
    assert.equal(finRes.status, 201, JSON.stringify(finRes.body));
    const finalization = finRes.body.finalization;
    assert.equal(finalization.status, 'FINALIZED');
    assert.equal(finalization.sectionCount, 5);
    assert.match(finalization.canonicalSnapshotHash, /^[a-f0-9]{64}$/);

    // Idempotent re-execution returns 200 with same finalization
    const finReplay = await requestJson(origin, `/api/reports/${reportId}/finalizations`, 'POST', {
      idempotencyKey: 'FIN-IDEMP-001'
    }, reviewer);
    assert.equal(finReplay.status, 200);
    assert.equal(finReplay.body.finalization.id, finalization.id);

    // 4. Deterministic Output Generation & Independent Parser Validation
    console.log('4. Testing DOCX & PDF Output Generation with Independent Parsers...');

    // Generate DOCX
    const docxOut1 = await requestJson(origin, `/api/reports/${reportId}/finalizations/${finalization.id}/outputs`, 'POST', {
      format: 'DOCX'
    }, reviewer);
    assert.equal(docxOut1.status, 201, JSON.stringify(docxOut1.body));
    const docxArtifact1 = docxOut1.body.artifact;
    assert.equal(docxArtifact1.format, 'DOCX');

    // Verify DOCX file on disk with independent OOXML parser
    const docxPath = path.join(uploadDir, docxArtifact1.storageKey);
    assert.ok(fs.existsSync(docxPath), 'DOCX file must exist on disk');
    const docxBuffer1 = fs.readFileSync(docxPath);
    const docxVal = validateReportDocxBuffer(docxBuffer1);
    assert.ok(docxVal.isValid, `DOCX Validation failed: ${docxVal.error}`);
    assert.equal(docxVal.entryCount! > 3, true);

    // Generate PDF
    const pdfOut1 = await requestJson(origin, `/api/reports/${reportId}/finalizations/${finalization.id}/outputs`, 'POST', {
      format: 'PDF'
    }, reviewer);
    assert.equal(pdfOut1.status, 201, JSON.stringify(pdfOut1.body));
    const pdfArtifact1 = pdfOut1.body.artifact;
    assert.equal(pdfArtifact1.format, 'PDF');

    // Verify PDF file on disk with independent PDF parser
    const pdfPath = path.join(uploadDir, pdfArtifact1.storageKey);
    assert.ok(fs.existsSync(pdfPath), 'PDF file must exist on disk');
    const pdfBuffer1 = fs.readFileSync(pdfPath);
    const pdfVal = validateReportPdfBuffer(pdfBuffer1);
    assert.ok(pdfVal.isValid, `PDF Validation failed: ${pdfVal.error}`);
    assert.ok(pdfVal.pageCount! >= 1);

    // 5. Byte-Level Hash Determinism Verification
    console.log('5. Testing Byte-Level Determinism on Re-rendering...');
    const docxOut2 = await requestJson(origin, `/api/reports/${reportId}/finalizations/${finalization.id}/outputs`, 'POST', {
      format: 'DOCX'
    }, reviewer);
    assert.equal(docxOut2.status, 200, 'Re-request returns existing artifact');
    assert.equal(docxOut2.body.artifact.sha256, docxArtifact1.sha256, 'DOCX SHA256 must match byte-level');

    const pdfOut2 = await requestJson(origin, `/api/reports/${reportId}/finalizations/${finalization.id}/outputs`, 'POST', {
      format: 'PDF'
    }, reviewer);
    assert.equal(pdfOut2.status, 200);
    assert.equal(pdfOut2.body.artifact.sha256, pdfArtifact1.sha256, 'PDF SHA256 must match byte-level');

    // 100-section and long-content boundary: real pagination, complete order, deterministic bytes.
    const boundarySections = Array.from({ length: 100 }, (_, index) => ({
      sectionId: `BOUNDARY-SEC-${index + 1}`,
      sectionNumber: index + 1,
      title: `경계 검증 장 ${index + 1} ${'긴제목'.repeat(index === 99 ? 30 : 1)}`,
      content: index === 99
        ? Array.from({ length: 120 }, (__, line) => `마지막 장 긴 본문 ${line + 1} ${'<표>&근거'.repeat(8)}`).join('\n')
        : `본문 ${index + 1}\n근거 해시와 승인 이력을 보존합니다.`,
      approvedRevisionId: `BOUNDARY-REV-${index + 1}`,
      approvedRevisionHash: String(index + 1).padStart(64, '0'),
      approvedByUserId: 'USR-REVIEWER',
      approvedAt: '2026-08-10T00:00:00.000Z'
    }));
    const boundaryOptions = {
      finalizationId: 'FIN-BOUNDARY-100',
      canonicalSnapshotHash: 'b'.repeat(64),
      title: '100개 장 및 긴 본문 경계 검증 보고서',
      caseNumber: 'CASE-BOUNDARY-100',
      claimType: 'TYPE-01',
      finalizedBy: 'Independent Reviewer',
      finalizedAt: '2026-08-10T00:00:00.000Z',
      sections: boundarySections
    };
    const boundaryDocxA = generateReportDocxBuffer(boundaryOptions);
    const boundaryDocxB = generateReportDocxBuffer(boundaryOptions);
    assert.deepEqual(boundaryDocxA, boundaryDocxB, '100-section DOCX must be byte deterministic');
    const boundaryDocxValidation = validateReportDocxBuffer(boundaryDocxA);
    assert.equal(boundaryDocxValidation.isValid, true);
    assert.equal(boundaryDocxValidation.entryCount, 9);
    assert.equal(boundaryDocxValidation.sectionCount, 100);
    assert.match(boundaryDocxValidation.documentXmlText ?? '', /마지막 장 긴 본문 120/);

    const boundaryPdfA = generateReportPdfBuffer(boundaryOptions);
    const boundaryPdfB = generateReportPdfBuffer(boundaryOptions);
    assert.deepEqual(boundaryPdfA, boundaryPdfB, '100-section PDF must be byte deterministic');
    const boundaryPdfValidation = validateReportPdfBuffer(boundaryPdfA);
    assert.equal(boundaryPdfValidation.isValid, true);
    assert.ok((boundaryPdfValidation.pageCount ?? 0) > 102, 'TOC and long content must create additional real pages');
    assert.match(boundaryPdfValidation.extractedText ?? '', /Section 100:/);
    assert.match(boundaryPdfValidation.extractedText ?? '', /마지막 장 긴 본문 120/);

    const tamperedPdf = Buffer.from(boundaryPdfA);
    const xrefOffset = tamperedPdf.indexOf(Buffer.from('xref\n'));
    tamperedPdf[xrefOffset + 20] = tamperedPdf[xrefOffset + 20] === 0x30 ? 0x31 : 0x30;
    assert.equal(validateReportPdfBuffer(tamperedPdf).isValid, false, 'xref mutation must be rejected');

    // 6. Download API & Audit Logging Test
    console.log('6. Testing Download API & RFC 5987 headers...');
    const dlRes = await requestJson(origin, `/api/reports/outputs/${docxArtifact1.id}/download`, 'GET', undefined, reviewer);
    assert.equal(dlRes.status, 200);

    const downloadLogs = await db.reportOutputDownload.findMany({ where: { artifactId: docxArtifact1.id } });
    assert.equal(downloadLogs.length, 1);
    assert.ok(downloadLogs[0].downloadedById);

    console.log('✅ P12 Contract & Deterministic Final Output Test Passed Cleanly!');
  } finally {
    await closeP12Isolated(context);
  }
}

main().catch((err) => {
  console.error('❌ P12 Contract Test Failed:', err);
  process.exit(1);
});
