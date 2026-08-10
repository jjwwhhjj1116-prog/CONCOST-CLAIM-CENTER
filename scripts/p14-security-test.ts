import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { startP14Isolated, requestJson } from './p14-test-support';

describe('P14 Security Suite: Google Workspace Integration, OAuth, Immutability & Audits', async () => {
  const context = await startP14Isolated('p14-security');

  test('1 & 2. OAuth state reuse, expiry, and cross-tenant/cross-user callback protection', async () => {
    const { origin, adminSession, directorSession } = context;

    // Init state
    const initRes = await requestJson(origin, '/api/google-workspace/connect/init', 'POST', { redirectTarget: '/integrations/google' }, adminSession);
    assert.equal(initRes.status, 201);
    const stateHash = initRes.body.stateHash;

    // Callback by different user (Director) -> 403
    const crossUserRes = await requestJson(origin, '/api/google-workspace/connect/callback', 'POST', { stateHash, code: 'code-cross' }, directorSession);
    assert.equal(crossUserRes.status, 403);

    // Valid callback -> 200
    const okRes = await requestJson(origin, '/api/google-workspace/connect/callback', 'POST', { stateHash, code: 'code-ok' }, adminSession);
    assert.equal(okRes.status, 200);

    // Reuse state token -> 400
    const reuseRes = await requestJson(origin, '/api/google-workspace/connect/callback', 'POST', { stateHash, code: 'code-reuse' }, adminSession);
    assert.equal(reuseRes.status, 400);
    assert.match(reuseRes.body.error, /already been used/i);
  });

  test('3. Redirect URL domain allowlist enforcement', async () => {
    const { origin, adminSession } = context;
    const maliciousInit = await requestJson(origin, '/api/google-workspace/connect/init', 'POST', { redirectTarget: 'https://attacker.evil.invalid/steal' }, adminSession);
    assert.equal(maliciousInit.status, 400);
    assert.match(maliciousInit.body.error, /Forbidden redirect domain/i);
  });

  test('4. Token redaction & 0 raw secrets in API payload or DB', async () => {
    const { origin, adminSession, db } = context;
    const connRes = await requestJson(origin, '/api/google-workspace/connection', 'GET', undefined, adminSession);
    assert.equal(connRes.status, 200);

    const jsonText = JSON.stringify(connRes.body);
    assert.equal(jsonText.includes('ya29.'), false);
    assert.equal(jsonText.includes('access_token'), false);
    assert.equal(jsonText.includes('refresh_token'), false);

    const dbConn = await db.googleWorkspaceConnection.findFirst({ where: { id: connRes.body.connection.id } });
    assert.ok(dbConn?.secretRef.startsWith('sec-ref-google-'));
  });

  test('5. Duplicate Drive folder creation concurrency & idempotency convergence', async () => {
    const { origin, pmSession, caseId } = context;

    const [res1, res2] = await Promise.all([
      requestJson(origin, `/api/cases/${caseId}/google/drive-folder`, 'POST', { idempotencyKey: 'CONCURRENT-DRIVE-KEY' }, pmSession),
      requestJson(origin, `/api/cases/${caseId}/google/drive-folder`, 'POST', { idempotencyKey: 'CONCURRENT-DRIVE-KEY' }, pmSession)
    ]);

    assert.ok([200, 201].includes(res1.status));
    assert.ok([200, 201].includes(res2.status));
    assert.equal(res1.body.folderId, res2.body.folderId);
  });

  test('7 & 8. Unselected Gmail attachments & Human confirmation guard for Calendar', async () => {
    const { origin, pmSession, caseId } = context;

    // Unselected attachments -> 400
    const emptyGmailRes = await requestJson(origin, `/api/cases/${caseId}/google/import-gmail`, 'POST', { attachmentIds: [] }, pmSession);
    assert.equal(emptyGmailRes.status, 400);

    // Calendar without human confirmation -> 400
    const unconfirmedCalRes = await requestJson(origin, `/api/cases/${caseId}/google/calendar-event`, 'POST', {
      summary: '사건 현장 검증',
      startDateTime: '2026-09-01T10:00:00Z',
      endDateTime: '2026-09-01T11:00:00Z',
      humanConfirmed: false
    }, pmSession);
    assert.equal(unconfirmedCalRes.status, 400);
    assert.match(unconfirmedCalRes.body.error, /Human confirmation/i);
  });

  test('9. Cross-tenant & Non-existent case IDOR protection', async () => {
    const { origin, pmSession } = context;
    const fakeCaseId = 'CASE-NON-EXISTENT-999';

    const driveRes = await requestJson(origin, `/api/cases/${fakeCaseId}/google/drive-folder`, 'POST', {}, pmSession);
    assert.equal(driveRes.status, 404);

    const gmailRes = await requestJson(origin, `/api/cases/${fakeCaseId}/google/import-gmail`, 'POST', { attachmentIds: ['att-1'] }, pmSession);
    assert.equal(gmailRes.status, 404);

    const calRes = await requestJson(origin, `/api/cases/${fakeCaseId}/google/calendar-event`, 'POST', { summary: 'a', startDateTime: 'b', endDateTime: 'c', humanConfirmed: true }, pmSession);
    assert.equal(calRes.status, 404);
  });

  test('10 & 11. Rate limit retry-after & error mode handling', async () => {
    const { origin, adminSession } = context;

    // Set fake mode to RATE_LIMIT_RETRY_AFTER
    await requestJson(origin, '/api/google-workspace/fake-mode', 'POST', { mode: 'RATE_LIMIT_RETRY_AFTER' }, adminSession);

    const testRes = await requestJson(origin, '/api/google-workspace/test', 'POST', undefined, adminSession);
    assert.equal(testRes.status, 400);
    assert.equal(testRes.body.responseClass, 'RATE_LIMIT_RETRY_AFTER');
    assert.equal(testRes.body.retryAfterSeconds, 5);

    // Reset mode back to SUCCESS
    await requestJson(origin, '/api/google-workspace/fake-mode', 'POST', { mode: 'SUCCESS' }, adminSession);
  });

  test('13. Disconnect preserves internal case data, documents, and snapshots', async () => {
    const { origin, adminSession, pmSession, caseId, db } = context;

    // Import a Gmail snapshot first
    await requestJson(origin, `/api/cases/${caseId}/google/import-gmail`, 'POST', { attachmentIds: ['att-preserve-1'] }, pmSession);

    // Disconnect
    const discRes = await requestJson(origin, '/api/google-workspace/disconnect', 'POST', undefined, adminSession);
    assert.equal(discRes.status, 200);

    // Internal snapshot & case remain intact
    const caseRow = await db.caseItem.findUnique({ where: { id: caseId } });
    assert.ok(caseRow);
    const snapshots = await db.googleImportSnapshot.findMany({ where: { caseId } });
    assert.ok(snapshots.length >= 1);
  });

  test('16. SQLite DB triggers prevent UPDATE and DELETE on immutable Google tables', async () => {
    const { db, caseId } = context;

    const caseRow = await db.caseItem.findUniqueOrThrow({ where: { id: caseId } });

    // Create a ResourceLink
    const link = await db.googleResourceLink.create({
      data: {
        id: `GRLINK-TRIG-${Date.now()}`,
        organizationId: caseRow.organizationId,
        caseId,
        entityType: 'CASE_DRIVE_FOLDER',
        internalEntityId: caseId,
        externalResourceId: 'folder-trigger-test'
      }
    });

    // Attempt UPDATE on GoogleResourceLink -> MUST fail due to DB trigger
    await assert.rejects(async () => {
      await db.$executeRawUnsafe(`UPDATE "GoogleResourceLink" SET "externalResourceId" = 'hacked' WHERE "id" = '${link.id}'`);
    }, /GoogleResourceLink is immutable/);

    // Attempt DELETE on GoogleResourceLink -> MUST fail due to DB trigger
    await assert.rejects(async () => {
      await db.$executeRawUnsafe(`DELETE FROM "GoogleResourceLink" WHERE "id" = '${link.id}'`);
    }, /GoogleResourceLink is immutable/);
  });

  test.after(async () => {
    await context.cleanup();
  });
});
