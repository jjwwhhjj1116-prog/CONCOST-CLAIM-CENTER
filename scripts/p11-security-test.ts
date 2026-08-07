import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { closeP11Isolated, createMeetingSelection, createSuggestion, P11_INSTRUCTION, startP11Isolated } from './p11-test-support';
import { createP09Fixture, requestJson } from './p09-test-support';

async function main(): Promise<void> {
  console.log('P11 security: assignment, IDOR, DB provenance, secret redaction, terminal state and cancellation');
  const context = await startP11Isolated('p11-security');
  try {
    const { db, fixture } = context;
    const reportId = fixture.reportId;
    const sectionId = fixture.sectionIds[0];

    const reviewerDenied = await createMeetingSelection(context, fixture.reviewer);
    assert.equal(reviewerDenied.status, 403);

    await db.caseAssignment.delete({ where: { caseId_userId: { caseId: 'CASE-SYN-001', userId: 'USR-STAFF' } } });
    const unassignedDenied = await createMeetingSelection(context, fixture.staff);
    assert.equal(unassignedDenied.status, 403);
    await db.caseAssignment.create({ data: { caseId: 'CASE-SYN-001', userId: 'USR-STAFF' } });

    const crossCaseSource = await requestJson(context.origin, `/api/reports/${reportId}/sections/${sectionId}/grounding/selections`, 'POST', {
      providerId: 'CFG-LOCAL-FAKE-01', modelCode: 'fake-claim-v1', instruction: P11_INSTRUCTION,
      sources: [{ sourceType: 'MATERIAL', sourceId: 'DOC-SYN-002', sourceVersionId: 'DOCVER-SYN-003', allowedAnchors: [0] }]
    }, fixture.pm);
    assert.equal(crossCaseSource.status, 403);

    const draftMeeting = await requestJson(context.origin, `/api/reports/${reportId}/sections/${sectionId}/grounding/selections`, 'POST', {
      providerId: 'CFG-LOCAL-FAKE-01', modelCode: 'fake-claim-v1', instruction: P11_INSTRUCTION,
      sources: [{ sourceType: 'MEETING', sourceId: 'MEET-SYN-001', sourceVersionId: 'MEET-SYN-001:v1', allowedAnchors: [0] }]
    }, fixture.pm);
    assert.equal(draftMeeting.status, 409);

    const selectionResponse = await createMeetingSelection(context);
    assert.equal(selectionResponse.status, 201);
    const selectionId = selectionResponse.body.selection.id;
    const grounded = await createSuggestion(context, selectionId, 'GROUNDED_SUCCESS', 'P11-SEC-GROUNDED');
    assert.equal(grounded.status, 201);
    assert.equal(grounded.body.suggestion.status, 'GENERATED');
    const suggestionId = grounded.body.suggestion.id as string;

    await db.caseAssignment.delete({ where: { caseId_userId: { caseId: 'CASE-SYN-001', userId: 'USR-STAFF' } } });
    const unassignedApply = await requestJson(context.origin, `/api/reports/${reportId}/sections/${sectionId}/ai/suggestions/${suggestionId}/apply`, 'POST', {
      expectedVersion: 1, idempotencyKey: 'P11-SEC-UNASSIGNED-APPLY'
    }, fixture.staff);
    assert.equal(unassignedApply.status, 403);
    assert.equal(await db.reportSectionRevision.count({ where: { sectionId } }), 0);
    await db.caseAssignment.create({ data: { caseId: 'CASE-SYN-001', userId: 'USR-STAFF' } });

    const staffSelection = await createMeetingSelection(context, fixture.staff);
    assert.equal(staffSelection.status, 201);
    const staffBlocked = await createSuggestion(context, staffSelection.body.selection.id, 'UNGROUNDED_VALUE', 'P11-SEC-STAFF-DISCARD', fixture.staff);
    assert.equal(staffBlocked.status, 201);
    assert.equal(staffBlocked.body.suggestion.status, 'BLOCKED');
    await db.caseAssignment.delete({ where: { caseId_userId: { caseId: 'CASE-SYN-001', userId: 'USR-STAFF' } } });
    const unassignedDiscard = await requestJson(context.origin, `/api/reports/${reportId}/sections/${sectionId}/ai/suggestions/${staffBlocked.body.suggestion.id}`, 'DELETE', undefined, fixture.staff);
    assert.equal(unassignedDiscard.status, 403);
    assert.equal((await db.aiDraftSuggestion.findUniqueOrThrow({ where: { id: staffBlocked.body.suggestion.id } })).status, 'BLOCKED');
    await db.caseAssignment.create({ data: { caseId: 'CASE-SYN-001', userId: 'USR-STAFF' } });

    const secondFixture = await createP09Fixture(context.origin, db, { sectionCount: 1 });
    const listIdor = await requestJson(context.origin, `/api/reports/${reportId}/sections/${secondFixture.sectionIds[0]}/ai/suggestions`, 'GET', undefined, fixture.pm);
    assert.equal(listIdor.status, 404);
    const discardIdor = await requestJson(context.origin, `/api/reports/${reportId}/sections/${secondFixture.sectionIds[0]}/ai/suggestions/${suggestionId}`, 'DELETE', undefined, fixture.pm);
    assert.equal(discardIdor.status, 404);

    await assert.rejects(db.$executeRawUnsafe(
      `INSERT INTO AiGroundingSelection (id,organizationId,caseId,reportId,sectionId,actorId,status,policyHash,providerId,modelCode,instructionHash,manifestSha256,createdAt) ` +
      `VALUES ('GSEL-CROSS-TENANT','ORG-SYN-B','CASE-SYN-001','${reportId}','${sectionId}','USR-ORGB-PM','LOCKED','${'a'.repeat(64)}','CFG-LOCAL-FAKE-01','fake-claim-v1','${'b'.repeat(64)}','${'c'.repeat(64)}',CURRENT_TIMESTAMP)`
    ), /P11_GROUNDING_SELECTION_SCOPE_INVALID/);

    const badText = 'P11 security second source';
    await db.meeting.create({ data: {
      id: 'MEET-P11-SEC', caseId: 'CASE-SYN-001', title: 'P11 security source', meetingDate: new Date(), rawText: badText,
      rawTextSha256: crypto.createHash('sha256').update(badText).digest('hex'), status: 'FINAL', version: 1, createdById: 'USR-PM'
    } });
    await assert.rejects(db.$executeRawUnsafe(
      `INSERT INTO AiGroundingItem (id,selectionId,sourceType,sourceId,sourceVersionId,sourceVersionNumber,sourceSha256,allowedAnchorsJson,orderIndex) ` +
      `VALUES ('GITM-BAD-HASH','${selectionId}','MEETING','MEET-P11-SEC','MEET-P11-SEC:v1',1,'${'0'.repeat(64)}','[0]',9)`
    ), /P11_MEETING_SOURCE_PROVENANCE_INVALID/);

    const exactCitation = grounded.body.suggestion.citations[0];
    await assert.rejects(db.$executeRawUnsafe(
      `INSERT INTO AiCitation (id,suggestionId,targetClaimIndex,claimText,sourceType,sourceId,sourceVersionId,sourceSha256,anchorIndex,anchorText,status,createdAt) ` +
      `VALUES ('CIT-BAD-ANCHOR','${suggestionId}',99,'bad anchor','${exactCitation.sourceType}','${exactCitation.sourceId}','${exactCitation.sourceVersionId}','${exactCitation.sourceSha256}',999,'missing','VALID',CURRENT_TIMESTAMP)`
    ), /P11_CITATION_PROVENANCE_INVALID/);
    await assert.rejects(db.$executeRawUnsafe(
      `INSERT INTO AiCitation (id,suggestionId,targetClaimIndex,claimText,sourceType,sourceId,sourceVersionId,sourceSha256,anchorIndex,anchorText,status,createdAt) ` +
      `VALUES ('CIT-SECRET','${suggestionId}',100,'Bearer raw-secret-token','${exactCitation.sourceType}','${exactCitation.sourceId}','${exactCitation.sourceVersionId}','${exactCitation.sourceSha256}',0,'${exactCitation.anchorText}','VALID',CURRENT_TIMESTAMP)`
    ), /P11_SECRET_MATERIAL_FORBIDDEN/);
    await assert.rejects(db.$executeRawUnsafe(`UPDATE AiDraftSuggestion SET status='PROCESSING' WHERE id='${suggestionId}'`), /P11_DRAFT_SUGGESTION_STATE_INVALID/);
    await assert.rejects(db.$executeRawUnsafe(`UPDATE AiDraftSuggestion SET status='DISCARDED', summaryText='sk-raw-secret-value' WHERE id='${suggestionId}'`), /P11_(?:SECRET_MATERIAL_FORBIDDEN|DRAFT_SUGGESTION_OUTPUT_IMMUTABLE)/);
    await assert.rejects(db.$executeRawUnsafe(`UPDATE AiGroundingSelection SET status='DISCARDED' WHERE id='${selectionId}'`), /P11_GROUNDING_SELECTION_IMMUTABLE/);

    const rawRequest = await db.aiGenerationRequest.findUniqueOrThrow({ where: { id: grounded.body.suggestion.requestId } });
    assert.doesNotMatch(rawRequest.responseMetadataJson, /resultText|Synthetic final raw transcript text|Bearer|sk-/i);
    const auditDump = JSON.stringify(await db.auditLog.findMany({ where: { action: { startsWith: 'AI_' } } }));
    assert.doesNotMatch(auditDump, /Synthetic final raw transcript text|Bearer\s|sk-[A-Za-z0-9]/i);

    const slow = await createSuggestion(context, selectionId, 'SLOW_SUCCESS', 'P11-SEC-CANCEL', fixture.pm, { waitForCompletion: false });
    assert.equal(slow.status, 202);
    assert.equal(slow.body.suggestion.status, 'PROCESSING');
    const canceled = await requestJson(context.origin, `/api/reports/${reportId}/sections/${sectionId}/ai/suggestions/${slow.body.suggestion.id}/cancel`, 'POST', {}, fixture.pm);
    assert.equal(canceled.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 900));
    const canceledSuggestion = await db.aiDraftSuggestion.findUniqueOrThrow({ where: { id: slow.body.suggestion.id } });
    assert.equal(canceledSuggestion.status, 'CANCELED');
    assert.equal(await db.reportSectionRevision.count({ where: { sectionId } }), 0);
    const cancellationLedger = await db.aiUsageLedger.aggregate({ where: { requestId: slow.body.suggestion.requestId }, _sum: { costMicros: true } });
    assert.equal(cancellationLedger._sum.costMicros, 0);

    const requestCount = await db.aiGenerationRequest.count();
    await db.aiCasePolicy.update({ where: { caseId: 'CASE-SYN-001' }, data: { externalAiAllowed: false } });
    const policyBlocked = await createMeetingSelection(context);
    assert.equal(policyBlocked.status, 403);
    assert.equal(await db.aiGenerationRequest.count(), requestCount);
    console.log('P11 security: PASSED (assignment/IDOR/DB guards/redaction/cancel/policy side effects)');
  } finally {
    await closeP11Isolated(context);
  }

  const productionLike = await startP11Isolated('p11-testmode-disabled', false);
  try {
    const selection = await createMeetingSelection(productionLike);
    assert.equal(selection.status, 201);
    const forbiddenMode = await createSuggestion(productionLike, selection.body.selection.id, 'CROSS_CASE', 'P11-FORBIDDEN-TESTMODE');
    assert.equal(forbiddenMode.status, 400);
  } finally {
    await closeP11Isolated(productionLike);
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
