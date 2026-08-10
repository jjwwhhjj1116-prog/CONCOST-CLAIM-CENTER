import * as assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { startP14Isolated, requestJson } from './p14-test-support';

async function main() {
  console.log('--- Running corrected P14 Google Workspace vertical-slice contract ---');
  const context = await startP14Isolated('p14-contract-corrected');
  try {
    const { origin, db, caseId, adminSession, pmSession } = context;

    const initial = await requestJson(origin, '/api/google-workspace/connection', 'GET', undefined, adminSession);
    assert.equal(initial.status, 200);
    assert.equal(initial.body.status, 'DISCONNECTED');
    assert.equal(initial.body.connection, null);
    const reconciliation = await requestJson(origin, '/api/google-workspace/reconciliation', 'GET', undefined, adminSession);
    assert.equal(reconciliation.status, 200);
    assert.deepEqual(reconciliation.body.operations, []);
    assert.equal(reconciliation.body.resolution, 'CONFIRMED_NO_EXTERNAL_SIDE_EFFECT');
    assert.equal(reconciliation.body.confirmation, 'NO_EXTERNAL_RESOURCE_CONFIRMED');
    assert.equal((await requestJson(origin, '/api/google-workspace/reconciliation', 'GET', undefined, pmSession)).status, 403);

    const initiated = await requestJson(origin, '/api/google-workspace/connect/init', 'POST', {
      redirectTarget: '/integrations/google',
      expectedVersion: null
    }, adminSession);
    assert.equal(initiated.status, 201);
    assert.match(initiated.body.state, /^[A-Za-z0-9_-]{40,}$/);
    assert.match(initiated.body.authorizationUrl, /code_challenge_method=S256/);
    assert.equal(JSON.stringify(initiated.body).includes('verifier'), false);
    const persistedState = await db.googleOAuthState.findUniqueOrThrow({ where: { stateHash: crypto.createHash('sha256').update(initiated.body.state).digest('hex') } });
    assert.notEqual(persistedState.stateHash, initiated.body.state);

    const connected = await requestJson(origin, '/api/google-workspace/connect/callback', 'POST', {
      state: initiated.body.state,
      code: 'FAKE_AUTHORIZATION_CODE'
    }, adminSession);
    assert.equal(connected.status, 200);
    assert.equal(connected.body.connection.status, 'CONNECTED');
    const connectedText = JSON.stringify(connected.body);
    assert.equal(connectedText.includes('secretRef'), false);
    assert.equal(connectedText.includes('access_token'), false);
    assert.equal(connectedText.includes('refresh_token'), false);

    let workspace = await requestJson(origin, `/api/cases/${caseId}/google/workspace`, 'GET', undefined, pmSession);
    assert.equal(workspace.status, 200);
    assert.equal(workspace.body.connectionStatus, 'CONNECTED');
    assert.ok(workspace.body.gmailAttachments.length >= 3);
    assert.ok(workspace.body.meetings.some((meeting: { id: string }) => meeting.id === 'MEET-SYN-002'));
    assert.ok(workspace.body.sheetSources.length >= 2);

    const drivePayload = { idempotencyKey: 'P14-CONTRACT-DRIVE-001', expectedCaseVersion: workspace.body.caseVersion };
    const drive = await requestJson(origin, `/api/cases/${caseId}/google/drive-folder`, 'POST', drivePayload, pmSession);
    assert.equal(drive.status, 201);
    assert.equal(drive.body.caseVersion, drivePayload.expectedCaseVersion + 1);
    const driveReplay = await requestJson(origin, `/api/cases/${caseId}/google/drive-folder`, 'POST', drivePayload, pmSession);
    assert.equal(driveReplay.status, 200);
    assert.equal(driveReplay.body.folderId, drive.body.folderId);
    assert.equal(driveReplay.body.idempotentReplay, true);

    workspace = await requestJson(origin, `/api/cases/${caseId}/google/workspace`, 'GET', undefined, pmSession);
    const selected = workspace.body.gmailAttachments.slice(0, 2).map((candidate: { attachmentId: string }) => candidate.attachmentId);
    const gmail = await requestJson(origin, `/api/cases/${caseId}/google/import-gmail`, 'POST', {
      attachmentIds: selected,
      idempotencyKey: 'P14-CONTRACT-GMAIL-001',
      expectedCaseVersion: workspace.body.caseVersion
    }, pmSession);
    assert.equal(gmail.status, 201);
    assert.equal(gmail.body.importedCount, 2);
    assert.equal(gmail.body.documents.length, 2);
    for (const document of gmail.body.documents) {
      const stored = await db.document.findUnique({ where: { id: document.id }, include: { versions: true } });
      assert.ok(stored);
      assert.equal(stored.versions.length, 1);
      assert.match(stored.versions[0].sha256, /^[0-9a-f]{64}$/);
    }

    workspace = await requestJson(origin, `/api/cases/${caseId}/google/workspace`, 'GET', undefined, pmSession);
    const dateCandidate = workspace.body.dateCandidates[0];
    assert.equal(dateCandidate.sourceType, 'MEETING_ACTION_ITEM');
    assert.match(dateCandidate.candidateHash, /^[0-9a-f]{64}$/);
    const calendarPayload = {
      dateCandidateId: dateCandidate.id,
      candidateHash: dateCandidate.candidateHash,
      humanConfirmed: true,
      idempotencyKey: 'P14-CONTRACT-CALENDAR-001',
      expectedCaseVersion: workspace.body.caseVersion
    };
    const calendar = await requestJson(origin, `/api/cases/${caseId}/google/calendar-event`, 'POST', calendarPayload, pmSession);
    assert.equal(calendar.status, 201);
    const calendarReplay = await requestJson(origin, `/api/cases/${caseId}/google/calendar-event`, 'POST', calendarPayload, pmSession);
    assert.equal(calendarReplay.status, 200);
    assert.equal(calendarReplay.body.event.eventId, calendar.body.event.eventId);

    workspace = await requestJson(origin, `/api/cases/${caseId}/google/workspace`, 'GET', undefined, pmSession);
    const meeting = workspace.body.meetings.find((item: { id: string }) => item.id === 'MEET-SYN-002');
    const docs = await requestJson(origin, `/api/cases/${caseId}/google/export-docs`, 'POST', {
      meetingId: meeting.id,
      versionNumber: meeting.version,
      idempotencyKey: 'P14-CONTRACT-DOCS-001',
      expectedCaseVersion: workspace.body.caseVersion
    }, pmSession);
    assert.equal(docs.status, 201);
    assert.equal(docs.body.exportResult.version, meeting.version);
    const sourceMeeting = await db.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
    const sourceText = [sourceMeeting.rawText, sourceMeeting.summary, sourceMeeting.decisions]
      .filter((part): part is string => Boolean(part))
      .join('\n\n');
    const docsSnapshot = await db.googleImportSnapshot.findUniqueOrThrow({ where: { id: docs.body.snapshot.id } });
    const docsProvenance = JSON.parse(docsSnapshot.provenanceJson);
    const docsLink = await db.googleResourceLink.findUniqueOrThrow({ where: { id: docs.body.resourceLink.id } });
    const docsMetadata = JSON.parse(docsLink.resourceMetadataJson);
    assert.equal(docsSnapshot.sourceType, 'DOCS_TEXT');
    assert.equal(docsSnapshot.version, meeting.version);
    assert.equal(docsSnapshot.sha256, crypto.createHash('sha256').update(sourceText).digest('hex'));
    assert.equal(docsSnapshot.externalResourceId, docs.body.exportResult.documentId);
    assert.equal(docsProvenance.meetingId, meeting.id);
    assert.equal(docsProvenance.meetingVersion, meeting.version);
    assert.equal(docsProvenance.contentSha256, docsSnapshot.sha256);
    assert.equal(docsProvenance.exportedDocumentId, docsSnapshot.externalResourceId);
    assert.equal(docsMetadata.snapshotId, docsSnapshot.id);
    assert.equal(docsMetadata.contentSha256, docsSnapshot.sha256);

    workspace = await requestJson(origin, `/api/cases/${caseId}/google/workspace`, 'GET', undefined, pmSession);
    const sheet = workspace.body.sheetSources[0];
    const sheets = await requestJson(origin, `/api/cases/${caseId}/google/import-sheets`, 'POST', {
      spreadsheetId: sheet.spreadsheetId,
      sheetName: sheet.sheetName,
      rangeA1: 'A1:C10',
      idempotencyKey: 'P14-CONTRACT-SHEETS-001',
      expectedCaseVersion: workspace.body.caseVersion
    }, pmSession);
    assert.equal(sheets.status, 201);
    assert.equal(sheets.body.snapshot.sourceType, 'SHEETS_RANGE');
    const sheetSnapshot = await db.googleImportSnapshot.findUniqueOrThrow({ where: { id: sheets.body.snapshot.id } });
    const sheetProvenance = JSON.parse(sheetSnapshot.provenanceJson);
    const sheetLink = await db.googleResourceLink.findUniqueOrThrow({ where: { id: sheets.body.resourceLink.id } });
    const sheetMetadata = JSON.parse(sheetLink.resourceMetadataJson);
    assert.match(sheetProvenance.providerSnapshotId, /^[A-Za-z0-9._:-]{1,200}$/);
    assert.equal(sheetMetadata.providerSnapshotId, sheetProvenance.providerSnapshotId);
    assert.equal(sheetMetadata.snapshotId, sheetSnapshot.id);

    const preHealth = await requestJson(origin, '/api/google-workspace/connection', 'GET', undefined, adminSession);
    const health = await requestJson(origin, '/api/google-workspace/test', 'POST', { expectedVersion: preHealth.body.connection.version }, adminSession);
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);

    const status = await requestJson(origin, '/api/google-workspace/connection', 'GET', undefined, adminSession);
    const disconnect = await requestJson(origin, '/api/google-workspace/disconnect', 'POST', {
      expectedVersion: status.body.connection.version
    }, adminSession);
    assert.equal(disconnect.status, 200);
    assert.equal(disconnect.body.status, 'DISCONNECTED');
    assert.equal(JSON.stringify(disconnect.body).includes('secretRef'), false);

    assert.equal(await db.googleImportSnapshot.count({ where: { caseId } }), 4);
    assert.equal(await db.googleResourceLink.count({ where: { caseId } }), 6);
    console.log('✅ Corrected P14 contract passed');
  } finally {
    await context.cleanup();
  }
}

void main().catch((error: unknown) => {
  console.error('❌ Corrected P14 contract failed', error);
  process.exitCode = 1;
});
