import * as assert from 'node:assert/strict';
import { startP14Isolated, requestJson } from './p14-test-support';

async function main() {
  console.log('--- Running P14 Google Workspace Integration Contract Test ---');
  const context = await startP14Isolated('p14-contract');

  try {
    const { origin, db, caseId, adminSession, pmSession } = context;

    // 1. Initial Connection Status (DISCONNECTED)
    console.log('1. Testing GET /api/google-workspace/connection (Initial DISCONNECTED)...');
    const getRes1 = await requestJson(origin, '/api/google-workspace/connection', 'GET', undefined, adminSession);
    assert.equal(getRes1.status, 200);
    assert.equal(getRes1.body.status, 'DISCONNECTED');
    assert.equal(getRes1.body.connection, null);

    // 2. OAuth Init & Callback
    console.log('2. Testing OAuth init & callback flow...');
    const initRes = await requestJson(origin, '/api/google-workspace/connect/init', 'POST', { redirectTarget: '/integrations/google' }, adminSession);
    assert.equal(initRes.status, 201);
    assert.ok(initRes.body.stateHash);

    const cbRes = await requestJson(origin, '/api/google-workspace/connect/callback', 'POST', { stateHash: initRes.body.stateHash, code: 'code-123' }, adminSession);
    assert.equal(cbRes.status, 200);
    assert.equal(cbRes.body.connection.status, 'CONNECTED');
    assert.ok(cbRes.body.connection.secretRef);

    // Verify secretRef does NOT expose raw tokens
    assert.equal(cbRes.body.connection.accessToken, undefined);
    assert.equal(cbRes.body.connection.refreshToken, undefined);

    // 3. Drive Folder Creation & Idempotency
    console.log('3. Testing Drive folder creation & idempotency...');
    const driveRes1 = await requestJson(origin, `/api/cases/${caseId}/google/drive-folder`, 'POST', { idempotencyKey: 'IDEM-DRIVE-001' }, pmSession);
    assert.equal(driveRes1.status, 201);
    assert.equal(driveRes1.body.isExisting, false);
    assert.ok(driveRes1.body.folderId);

    const driveRes2 = await requestJson(origin, `/api/cases/${caseId}/google/drive-folder`, 'POST', { idempotencyKey: 'IDEM-DRIVE-001' }, pmSession);
    assert.equal(driveRes2.status, 200);
    assert.equal(driveRes2.body.isExisting, true);
    assert.equal(driveRes2.body.folderId, driveRes1.body.folderId);

    // 4. Gmail Attachments Selective Import
    console.log('4. Testing Gmail attachments selective import...');
    const gmailRes = await requestJson(origin, `/api/cases/${caseId}/google/import-gmail`, 'POST', { attachmentIds: ['att-101', 'att-102'] }, pmSession);
    assert.equal(gmailRes.status, 201);
    assert.equal(gmailRes.body.importedCount, 2);
    assert.equal(gmailRes.body.snapshots.length, 2);

    // 5. Calendar Event Creation & Human Confirmation Guard
    console.log('5. Testing Calendar event creation & Human Confirmation guard...');
    const calNoConfirmRes = await requestJson(origin, `/api/cases/${caseId}/google/calendar-event`, 'POST', {
      summary: '손해사정 현장조사',
      startDateTime: '2026-08-15T10:00:00Z',
      endDateTime: '2026-08-15T12:00:00Z',
      humanConfirmed: false
    }, pmSession);
    assert.equal(calNoConfirmRes.status, 400);

    const calOkRes = await requestJson(origin, `/api/cases/${caseId}/google/calendar-event`, 'POST', {
      summary: '손해사정 현장조사',
      startDateTime: '2026-08-15T10:00:00Z',
      endDateTime: '2026-08-15T12:00:00Z',
      humanConfirmed: true
    }, pmSession);
    assert.equal(calOkRes.status, 201);
    assert.ok(calOkRes.body.event.eventId);

    // 6. Docs Export & Sheets Import
    console.log('6. Testing Docs export & Sheets import...');
    const docsRes = await requestJson(origin, `/api/cases/${caseId}/google/export-docs`, 'POST', {
      meetingId: 'MEET-001',
      versionNumber: 1,
      title: '1차 회의록 Google Docs Export',
      content: '회의 결과: 손해사정 합의 완료'
    }, pmSession);
    assert.equal(docsRes.status, 201);
    assert.ok(docsRes.body.exportResult.documentId);

    const sheetsRes = await requestJson(origin, `/api/cases/${caseId}/google/import-sheets`, 'POST', {
      spreadsheetId: 'sheet-999',
      sheetName: '비용산정',
      rangeA1: 'A1:C10'
    }, pmSession);
    assert.equal(sheetsRes.status, 201);
    assert.equal(sheetsRes.body.snapshot.sourceType, 'SHEETS_RANGE');

    // 7. Disconnect & Data Preservation Test
    console.log('7. Testing Disconnect & internal data preservation...');
    const discRes = await requestJson(origin, '/api/google-workspace/disconnect', 'POST', undefined, adminSession);
    assert.equal(discRes.status, 200);
    assert.equal(discRes.body.status, 'DISCONNECTED');
    assert.equal(discRes.body.internalDataPreserved, true);

    // Verify existing snapshots still remain intact in DB
    const snapCount = await db.googleImportSnapshot.count({ where: { caseId } });
    assert.ok(snapCount >= 3);

    console.log('✅ P14 Google Workspace Integration Contract Test Passed Cleanly!');
  } finally {
    await context.cleanup();
  }
}

main().catch((err) => {
  console.error('❌ P14 Contract Test Failed:', err);
  process.exit(1);
});
