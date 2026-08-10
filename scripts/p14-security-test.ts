import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import initSqlJs from 'sql.js';
import { createPrismaClient, migrateDatabase } from '@claim-studio/database';
import { GoogleWorkspaceFakeAdapter } from '../apps/api/src/google-workspace/GoogleWorkspaceFakeAdapter';
import { login } from './p09-test-support';
import { startP14Isolated, requestJson, type P14TestContext } from './p14-test-support';

const root = path.resolve(__dirname, '..');
const requiredScopes = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets.readonly'
];

async function withContext(
  name: string,
  run: (context: P14TestContext) => Promise<void>,
  options: { allowTestGoogleModes?: boolean } = {}
): Promise<void> {
  const context = await startP14Isolated(name, options);
  try {
    await run(context);
  } finally {
    await context.cleanup();
  }
}

async function connectionStatus(context: P14TestContext): Promise<any> {
  const response = await requestJson(context.origin, '/api/google-workspace/connection', 'GET', undefined, context.adminSession);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

async function connectGoogle(context: P14TestContext): Promise<any> {
  const current = await connectionStatus(context);
  const initiated = await requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', {
    redirectTarget: '/integrations/google',
    expectedVersion: current.connection?.version ?? null
  }, context.adminSession);
  assert.equal(initiated.status, 201, JSON.stringify(initiated.body));
  const callback = await requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
    state: initiated.body.state,
    code: 'FAKE_AUTHORIZATION_CODE'
  }, context.adminSession);
  assert.equal(callback.status, 200, JSON.stringify(callback.body));
  return callback.body.connection;
}

async function workspace(context: P14TestContext, caseId = context.caseId): Promise<any> {
  const response = await requestJson(context.origin, `/api/cases/${caseId}/google/workspace`, 'GET', undefined, context.pmSession);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

async function setMode(context: P14TestContext, mode: string): Promise<void> {
  const response = await requestJson(context.origin, '/api/google-workspace/fake-mode', 'POST', { mode }, context.adminSession);
  assert.equal(response.status, 200, JSON.stringify(response.body));
}

test('P14-SEC-01 OAuth uses raw-state/S256, strict internal redirect, invalid-code rejection, one-time state, and secret-free responses', async () => {
  await withContext('p14-sec-oauth-contract', async (context) => {
    const forbiddenActor = await requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', {
      redirectTarget: '/integrations/google', expectedVersion: null
    }, context.directorSession);
    assert.equal(forbiddenActor.status, 403);

    for (const redirectTarget of ['https://attacker.invalid/callback', '//attacker.invalid', 'javascript:alert(1)', '/integrations/google\\evil']) {
      const rejected = await requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', { redirectTarget, expectedVersion: null }, context.adminSession);
      assert.equal(rejected.status, 400, redirectTarget);
    }
    const staleInit = await requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', {
      redirectTarget: '/integrations/google', expectedVersion: 1
    }, context.adminSession);
    assert.equal(staleInit.status, 409);

    const initiated = await requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', {
      redirectTarget: '/integrations/google', expectedVersion: null
    }, context.adminSession);
    assert.equal(initiated.status, 201);
    assert.match(initiated.body.state, /^[A-Za-z0-9_-]{40,}$/);
    assert.match(initiated.body.authorizationUrl, /code_challenge_method=S256/);
    const stateHash = crypto.createHash('sha256').update(initiated.body.state).digest('hex');
    const stored = await context.db.googleOAuthState.findUniqueOrThrow({ where: { stateHash } });
    assert.notEqual(stored.stateHash, initiated.body.state);
    assert.equal(stored.pkceChallenge.length, 43);
    assert.match(stored.pkceVerifierRef, /^PKCE_[A-Z0-9_]+$/);

    const invalidCode = await requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
      state: initiated.body.state, code: 'INVALID_AUTHORIZATION_CODE'
    }, context.adminSession);
    assert.equal(invalidCode.status, 502);
    assert.equal((await context.db.googleOAuthState.findUniqueOrThrow({ where: { stateHash } })).usedAt, null);

    const connected = await requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
      state: initiated.body.state, code: 'FAKE_AUTHORIZATION_CODE'
    }, context.adminSession);
    assert.equal(connected.status, 200);
    assert.equal(JSON.stringify(connected.body).includes('secretRef'), false);
    assert.equal(JSON.stringify(connected.body).includes('access_token'), false);

    const replay = await requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
      state: initiated.body.state, code: 'FAKE_AUTHORIZATION_CODE'
    }, context.adminSession);
    assert.equal(replay.status, 409);
  });
});

test('P14-SEC-02 expired OAuth state and cross-actor/cross-tenant callbacks are rejected without consuming the valid state', async () => {
  await withContext('p14-sec-oauth-binding', async (context) => {
    const rawExpiredState = 'P14_EXPIRED_STATE_TOKEN_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789';
    await context.db.googleOAuthState.create({ data: {
      id: `GOAUTH-EXPIRED-${crypto.randomUUID()}`,
      stateHash: crypto.createHash('sha256').update(rawExpiredState).digest('hex'),
      pkceVerifierRef: `PKCE_${crypto.randomUUID().replace(/-/g, '_').toUpperCase()}`,
      pkceChallenge: 'A'.repeat(43),
      connectionVersion: null,
      organizationId: 'ORG-SYN-A',
      actorId: 'USR-ADMIN',
      redirectTarget: '/integrations/google',
      expiresAt: new Date(Date.now() - 1_000)
    } });
    const expired = await requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
      state: rawExpiredState, code: 'FAKE_AUTHORIZATION_CODE'
    }, context.adminSession);
    assert.equal(expired.status, 400);
    assert.match(expired.body.error, /expired/i);

    await context.db.userRole.create({ data: { userId: 'USR-DIRECTOR', roleId: 'admin' } });
    await context.db.userRole.create({ data: { userId: 'USR-ORGB-PM', roleId: 'admin' } });
    const orgBAdmin = await login(context.origin, 'pm_b@example.invalid', 'http://127.0.0.1:3000');
    const initiated = await requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', {
      redirectTarget: '/integrations/google', expectedVersion: null
    }, context.adminSession);
    assert.equal(initiated.status, 201);
    const crossActor = await requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
      state: initiated.body.state, code: 'FAKE_AUTHORIZATION_CODE'
    }, context.directorSession);
    assert.equal(crossActor.status, 403);
    const crossTenant = await requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
      state: initiated.body.state, code: 'FAKE_AUTHORIZATION_CODE'
    }, orgBAdmin);
    assert.equal(crossTenant.status, 403);
    const owner = await requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
      state: initiated.body.state, code: 'FAKE_AUTHORIZATION_CODE'
    }, context.adminSession);
    assert.equal(owner.status, 200);
  });
});

test('P14-SEC-03 concurrent callbacks for one state converge to exactly one connection and one audit', async () => {
  await withContext('p14-sec-state-race', async (context) => {
    const initiated = await requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', {
      redirectTarget: '/integrations/google', expectedVersion: null
    }, context.adminSession);
    const results = await Promise.all(Array.from({ length: 8 }, () => requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
      state: initiated.body.state, code: 'FAKE_AUTHORIZATION_CODE'
    }, context.adminSession)));
    assert.equal(results.filter((result) => result.status === 200).length, 1);
    assert.equal(results.filter((result) => result.status === 409).length, 7);
    assert.equal(await context.db.googleWorkspaceConnection.count({ where: { organizationId: 'ORG-SYN-A' } }), 1);
    assert.equal(await context.db.auditLog.count({ where: { action: 'GOOGLE_WORKSPACE_CONNECTED', organizationId: 'ORG-SYN-A' } }), 1);
  });
});

test('P14-SEC-04 independently initialized OAuth states use a connection-version CAS', async () => {
  await withContext('p14-sec-connection-cas', async (context) => {
    const initBody = { redirectTarget: '/integrations/google', expectedVersion: null };
    const [first, second] = await Promise.all([
      requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', initBody, context.adminSession),
      requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', initBody, context.adminSession)
    ]);
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const results = await Promise.all([first, second].map((entry) => requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
      state: entry.body.state, code: 'FAKE_AUTHORIZATION_CODE'
    }, context.adminSession)));
    assert.equal(results.filter((result) => result.status === 200).length, 1);
    assert.equal(results.filter((result) => result.status === 409).length, 1);
    const states = await context.db.googleOAuthState.findMany({ where: { organizationId: 'ORG-SYN-A' } });
    assert.equal(states.filter((state) => state.usedAt !== null).length, 1);
  });
});

test('P14-SEC-05 deterministic fake modes require both the explicit server option and Admin role', async () => {
  await withContext('p14-sec-fake-disabled', async (context) => {
    const disabled = await requestJson(context.origin, '/api/google-workspace/fake-mode', 'POST', { mode: 'RATE_LIMIT_RETRY_AFTER' }, context.adminSession);
    assert.equal(disabled.status, 404);
    const nonAdmin = await requestJson(context.origin, '/api/google-workspace/fake-mode', 'POST', { mode: 'SUCCESS' }, context.directorSession);
    assert.equal(nonAdmin.status, 403);
  }, { allowTestGoogleModes: false });
  await withContext('p14-sec-fake-enabled', async (context) => {
    const nonAdmin = await requestJson(context.origin, '/api/google-workspace/fake-mode', 'POST', { mode: 'SUCCESS' }, context.directorSession);
    assert.equal(nonAdmin.status, 403);
    const invalid = await requestJson(context.origin, '/api/google-workspace/fake-mode', 'POST', { mode: 'NOT_A_MODE' }, context.adminSession);
    assert.equal(invalid.status, 400);
    await setMode(context, 'SUCCESS');
  });
});

test('P14-SEC-06 secret references never leave Admin APIs and DB guards reject raw credential patterns and malformed refs', async () => {
  await withContext('p14-sec-secret-redaction', async (context) => {
    await connectGoogle(context);
    const response = await connectionStatus(context);
    const apiText = JSON.stringify(response);
    assert.equal(apiText.includes('secretRef'), false);
    assert.equal(/ya29\.|access_token|refresh_token|client_secret/i.test(apiText), false);
    const connection = await context.db.googleWorkspaceConnection.findUniqueOrThrow({ where: { organizationId: 'ORG-SYN-A' } });
    assert.equal((await requestJson(context.origin, '/api/google-workspace/test', 'POST', {}, context.adminSession)).status, 400);
    assert.equal((await requestJson(context.origin, '/api/google-workspace/test', 'POST', { expectedVersion: connection.version + 1 }, context.adminSession)).status, 409);
    await assert.rejects(() => context.db.googleWorkspaceConnection.update({
      where: { id: connection.id }, data: { secretRef: 'ENV_A!raw', version: { increment: 1 } }
    }));
    await assert.rejects(() => context.db.googleWorkspaceConnection.update({
      where: { id: connection.id }, data: { secretRef: 'ya29.plaintext-token', version: { increment: 1 } }
    }));
    await assert.rejects(() => context.db.googleWorkspaceConnection.update({
      where: { id: connection.id }, data: { grantedScopesJson: JSON.stringify([...requiredScopes, 'access_token=raw']), version: { increment: 1 } }
    }));
    assert.equal((await context.db.googleWorkspaceConnection.findUniqueOrThrow({ where: { id: connection.id } })).secretRef, 'LOCAL_FAKE_GOOGLE');
  });
});

test('P14-SEC-07 case operations enforce connection/tenant/assignment/CAS and split material access from Calendar editor access', async () => {
  await withContext('p14-sec-rbac-assignment', async (context) => {
    const beforeConnection = await requestJson(context.origin, `/api/cases/${context.caseId}/google/drive-folder`, 'POST', {
      idempotencyKey: 'P14-NO-CONNECTION-001', expectedCaseVersion: 1
    }, context.pmSession);
    assert.equal(beforeConnection.status, 409);
    await connectGoogle(context);

    const pm = await context.db.user.findUniqueOrThrow({ where: { id: 'USR-PM' } });
    await context.db.user.create({ data: {
      id: 'USR-P14-ASSIGNED-NO-ROLE',
      email: 'p14-assigned-no-role@example.invalid',
      passwordHash: pm.passwordHash,
      name: 'Assigned without role',
      organizationId: 'ORG-SYN-A'
    } });
    await context.db.caseAssignment.create({ data: { caseId: context.caseId, userId: 'USR-P14-ASSIGNED-NO-ROLE' } });
    const rolelessSession = await login(context.origin, 'p14-assigned-no-role@example.invalid', 'http://127.0.0.1:3000');
    const rolelessWorkspace = await requestJson(
      context.origin,
      `/api/cases/${context.caseId}/google/workspace`,
      'GET',
      undefined,
      rolelessSession
    );
    assert.equal(rolelessWorkspace.status, 403, JSON.stringify(rolelessWorkspace.body));

    let current = await workspace(context);
    const payload = { idempotencyKey: 'P14-BOUNDARY-DRIVE-001', expectedCaseVersion: current.caseVersion };
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/drive-folder`, 'POST', { ...payload, injected: true }, context.pmSession)).status, 400);
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/drive-folder`, 'POST', { ...payload, expectedCaseVersion: current.caseVersion + 1 }, context.pmSession)).status, 409);

    const staffDrive = await requestJson(context.origin, `/api/cases/${context.caseId}/google/drive-folder`, 'POST', payload, context.staffSession);
    assert.equal(staffDrive.status, 201, JSON.stringify(staffDrive.body));
    current = await workspace(context);
    const reviewerDrive = await requestJson(context.origin, `/api/cases/${context.caseId}/google/drive-folder`, 'POST', {
      idempotencyKey: 'P14-REVIEWER-DRIVE-001', expectedCaseVersion: current.caseVersion
    }, context.reviewerSession);
    assert.equal(reviewerDrive.status, 200);

    const reviewerGmail = await requestJson(context.origin, `/api/cases/${context.caseId}/google/import-gmail`, 'POST', {
      attachmentIds: [current.gmailAttachments[0].attachmentId], idempotencyKey: 'P14-REVIEWER-GMAIL-001', expectedCaseVersion: current.caseVersion
    }, context.reviewerSession);
    assert.equal(reviewerGmail.status, 201, JSON.stringify(reviewerGmail.body));
    current = await workspace(context);
    const sheet = current.sheetSources[0];
    const staffSheets = await requestJson(context.origin, `/api/cases/${context.caseId}/google/import-sheets`, 'POST', {
      spreadsheetId: sheet.spreadsheetId, sheetName: sheet.sheetName, rangeA1: 'A1:C5',
      idempotencyKey: 'P14-STAFF-SHEETS-001', expectedCaseVersion: current.caseVersion
    }, context.staffSession);
    assert.equal(staffSheets.status, 201, JSON.stringify(staffSheets.body));
    current = await workspace(context);
    const meeting = current.meetings.find((entry: { id: string }) => entry.id === 'MEET-SYN-002');
    const reviewerDocs = await requestJson(context.origin, `/api/cases/${context.caseId}/google/export-docs`, 'POST', {
      meetingId: meeting.id, versionNumber: meeting.version,
      idempotencyKey: 'P14-REVIEWER-DOCS-001', expectedCaseVersion: current.caseVersion
    }, context.reviewerSession);
    assert.equal(reviewerDocs.status, 201, JSON.stringify(reviewerDocs.body));

    current = await workspace(context);
    const dateCandidate = current.dateCandidates[0];
    const calendarPayload = {
      dateCandidateId: dateCandidate.id, candidateHash: dateCandidate.candidateHash, humanConfirmed: true,
      idempotencyKey: 'P14-CALENDAR-ROLE-001', expectedCaseVersion: current.caseVersion
    };
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/calendar-event`, 'POST', calendarPayload, context.staffSession)).status, 403);
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/calendar-event`, 'POST', { ...calendarPayload, idempotencyKey: 'P14-CALENDAR-ROLE-002' }, context.reviewerSession)).status, 403);
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/drive-folder`, 'POST', payload, context.directorSession)).status, 403);
    const orgB = await login(context.origin, 'pm_b@example.invalid', 'http://127.0.0.1:3000');
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/drive-folder`, 'POST', payload, orgB)).status, 404);
  });
});

test('P14-SEC-08 scoped idempotency converges concurrent Drive requests and rejects fingerprint reuse', async () => {
  await withContext('p14-sec-idempotency-race', async (context) => {
    await connectGoogle(context);
    const current = await workspace(context);
    const payload = { idempotencyKey: 'P14-DRIVE-RACE-0001', expectedCaseVersion: current.caseVersion };
    const results = await Promise.all([
      requestJson(context.origin, `/api/cases/${context.caseId}/google/drive-folder`, 'POST', payload, context.pmSession),
      requestJson(context.origin, `/api/cases/${context.caseId}/google/drive-folder`, 'POST', payload, context.pmSession)
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 201]);
    assert.equal(results[0].body.folderId, results[1].body.folderId);
    const mismatch = await requestJson(context.origin, `/api/cases/${context.caseId}/google/drive-folder`, 'POST', {
      ...payload, expectedCaseVersion: current.caseVersion + 1
    }, context.pmSession);
    assert.equal(mismatch.status, 409);
    assert.equal(await context.db.googleSyncOperation.count({ where: { operationKind: 'DRIVE_FOLDER', idempotencyKey: payload.idempotencyKey } }), 1);
    assert.equal(await context.db.googleResourceLink.count({ where: { caseId: context.caseId, entityType: 'CASE_DRIVE_FOLDER' } }), 1);
    assert.equal(await context.db.auditLog.count({ where: { action: 'GOOGLE_DRIVE_FOLDER_CREATED' } }), 1);
  });
});

test('P14-SEC-08A different idempotency keys cannot start duplicate unresolved Drive mutations', async () => {
  const adapterPrototype = GoogleWorkspaceFakeAdapter.prototype as any;
  const originalCreateDriveFolder = adapterPrototype.createDriveFolder;
  let providerCalls = 0;
  adapterPrototype.createDriveFolder = async function (...args: unknown[]): Promise<unknown> {
    providerCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 100));
    return originalCreateDriveFolder.apply(this, args);
  };
  try {
    await withContext('p14-sec-semantic-race', async (context) => {
      await connectGoogle(context);
      const current = await workspace(context);
      const results = await Promise.all([
        requestJson(context.origin, `/api/cases/${context.caseId}/google/drive-folder`, 'POST', {
          idempotencyKey: 'P14-DRIVE-DIFFERENT-KEY-0001', expectedCaseVersion: current.caseVersion
        }, context.pmSession),
        requestJson(context.origin, `/api/cases/${context.caseId}/google/drive-folder`, 'POST', {
          idempotencyKey: 'P14-DRIVE-DIFFERENT-KEY-0002', expectedCaseVersion: current.caseVersion
        }, context.pmSession)
      ]);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
      assert.equal(providerCalls, 1);
      assert.equal(await context.db.googleResourceLink.count({ where: { caseId: context.caseId, entityType: 'CASE_DRIVE_FOLDER' } }), 1);
    });
  } finally {
    adapterPrototype.createDriveFolder = originalCreateDriveFolder;
  }
});

test('P14-SEC-09 Gmail imports only case-scoped candidates into real DocumentVersion storage and prevents duplicates', async () => {
  await withContext('p14-sec-gmail-import', async (context) => {
    await connectGoogle(context);
    const primary = await workspace(context);
    const otherCase = await workspace(context, 'CASE-SYN-004');
    assert.notEqual(primary.gmailAttachments[0].attachmentId, otherCase.gmailAttachments[0].attachmentId);
    const common = { idempotencyKey: 'P14-GMAIL-IDOR-0001', expectedCaseVersion: primary.caseVersion };
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/import-gmail`, 'POST', {
      ...common, attachmentIds: ['arbitrary-provider-id']
    }, context.pmSession)).status, 400);
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/import-gmail`, 'POST', {
      ...common, idempotencyKey: 'P14-GMAIL-CROSS-0001', attachmentIds: [otherCase.gmailAttachments[0].attachmentId]
    }, context.pmSession)).status, 400);

    const attachmentId = primary.gmailAttachments[0].attachmentId;
    const imported = await requestJson(context.origin, `/api/cases/${context.caseId}/google/import-gmail`, 'POST', {
      attachmentIds: [attachmentId], idempotencyKey: 'P14-GMAIL-VALID-0001', expectedCaseVersion: primary.caseVersion
    }, context.pmSession);
    assert.equal(imported.status, 201, JSON.stringify(imported.body));
    const link = await context.db.googleResourceLink.findFirstOrThrow({ where: { caseId: context.caseId, entityType: 'GMAIL_ATTACHMENT', externalResourceId: attachmentId } });
    const version = await context.db.documentVersion.findUniqueOrThrow({ where: { id: link.internalEntityId } });
    assert.ok(fs.existsSync(path.join(context.uploadDir, version.storageKey)));
    assert.equal(version.sha256, imported.body.snapshots[0].sha256);
    const duplicate = await requestJson(context.origin, `/api/cases/${context.caseId}/google/import-gmail`, 'POST', {
      attachmentIds: [attachmentId], idempotencyKey: 'P14-GMAIL-DUPLICATE-0001', expectedCaseVersion: imported.body.caseVersion
    }, context.pmSession);
    assert.equal(duplicate.status, 409);
  });
});

test('P14-SEC-09A Gmail provider over-response, duplicate response, and omitted selection fail before any persistence', async () => {
  const adapterPrototype = GoogleWorkspaceFakeAdapter.prototype as any;
  const originalImport = adapterPrototype.importGmailAttachments;
  let corruption: 'EXTRA' | 'DUPLICATE' | 'MISSING' = 'EXTRA';
  adapterPrototype.importGmailAttachments = async function (
    this: GoogleWorkspaceFakeAdapter,
    caseId: string,
    selectedAttachmentIds: string[]
  ): Promise<any> {
    const response = await originalImport.call(this, caseId, selectedAttachmentIds);
    if (!response.data || response.data.items.length !== 1) throw new Error('Expected one deterministic Gmail item');
    const originalItem = response.data.items[0];
    if (corruption === 'EXTRA') {
      const extra = {
        ...originalItem,
        attachmentId: `${originalItem.attachmentId}-UNSELECTED`,
        documentId: `${originalItem.documentId}-UNSELECTED`
      };
      response.data = { importedCount: 2, items: [originalItem, extra] };
    } else if (corruption === 'DUPLICATE') {
      response.data = {
        importedCount: 2,
        items: [originalItem, { ...originalItem, documentId: `${originalItem.documentId}-DUPLICATE` }]
      };
    } else {
      response.data = { importedCount: 0, items: [] };
    }
    return response;
  };

  try {
    await withContext('p14-sec-gmail-provider-trust', async (context) => {
      await connectGoogle(context);
      const current = await workspace(context);
      const attachmentId = current.gmailAttachments[0].attachmentId;
      const before = {
        caseVersion: current.caseVersion,
        documents: await context.db.document.count({ where: { caseId: context.caseId } }),
        versions: await context.db.documentVersion.count({ where: { document: { caseId: context.caseId } } }),
        snapshots: await context.db.googleImportSnapshot.count({ where: { caseId: context.caseId } }),
        resources: await context.db.googleResourceLink.count({ where: { caseId: context.caseId } }),
        files: fs.existsSync(context.uploadDir) ? [...fs.readdirSync(context.uploadDir)].sort() : []
      };

      for (const scenario of ['EXTRA', 'DUPLICATE', 'MISSING'] as const) {
        corruption = scenario;
        const idempotencyKey = `P14-GMAIL-PROVIDER-${scenario}-001`;
        const failed = await requestJson(context.origin, `/api/cases/${context.caseId}/google/import-gmail`, 'POST', {
          attachmentIds: [attachmentId],
          idempotencyKey,
          expectedCaseVersion: before.caseVersion
        }, context.pmSession);
        assert.equal(failed.status, 502, `${scenario}: ${JSON.stringify(failed.body)}`);
        const operation = await context.db.googleSyncOperation.findFirstOrThrow({ where: { idempotencyKey } });
        assert.equal(operation.status, 'FAILED', scenario);
        assert.equal((await context.db.caseItem.findUniqueOrThrow({ where: { id: context.caseId } })).version, before.caseVersion);
        assert.equal(await context.db.document.count({ where: { caseId: context.caseId } }), before.documents);
        assert.equal(await context.db.documentVersion.count({ where: { document: { caseId: context.caseId } } }), before.versions);
        assert.equal(await context.db.googleImportSnapshot.count({ where: { caseId: context.caseId } }), before.snapshots);
        assert.equal(await context.db.googleResourceLink.count({ where: { caseId: context.caseId } }), before.resources);
        assert.deepEqual(fs.existsSync(context.uploadDir) ? [...fs.readdirSync(context.uploadDir)].sort() : [], before.files);
      }
    });
  } finally {
    adapterPrototype.importGmailAttachments = originalImport;
  }
});

test('P14-SEC-10 Gmail audit failure rolls back case/document/version/snapshot/resource and removes written files', async () => {
  await withContext('p14-sec-gmail-rollback', async (context) => {
    await connectGoogle(context);
    const current = await workspace(context);
    const before = {
      caseVersion: current.caseVersion,
      documents: await context.db.document.count({ where: { caseId: context.caseId } }),
      versions: await context.db.documentVersion.count({ where: { document: { caseId: context.caseId } } }),
      snapshots: await context.db.googleImportSnapshot.count({ where: { caseId: context.caseId } }),
      resources: await context.db.googleResourceLink.count({ where: { caseId: context.caseId } })
    };
    await context.db.$executeRawUnsafe(`CREATE TRIGGER "p14_test_reject_gmail_audit" BEFORE INSERT ON "AuditLog" WHEN NEW."action" = 'GMAIL_ATTACHMENTS_IMPORTED' BEGIN SELECT RAISE(ABORT, 'forced audit rollback'); END`);
    const failed = await requestJson(context.origin, `/api/cases/${context.caseId}/google/import-gmail`, 'POST', {
      attachmentIds: [current.gmailAttachments[0].attachmentId],
      idempotencyKey: 'P14-GMAIL-ROLLBACK-0001',
      expectedCaseVersion: current.caseVersion
    }, context.pmSession);
    assert.equal(failed.status, 500);
    assert.equal((await context.db.caseItem.findUniqueOrThrow({ where: { id: context.caseId } })).version, before.caseVersion);
    assert.equal(await context.db.document.count({ where: { caseId: context.caseId } }), before.documents);
    assert.equal(await context.db.documentVersion.count({ where: { document: { caseId: context.caseId } } }), before.versions);
    assert.equal(await context.db.googleImportSnapshot.count({ where: { caseId: context.caseId } }), before.snapshots);
    assert.equal(await context.db.googleResourceLink.count({ where: { caseId: context.caseId } }), before.resources);
    assert.equal(await context.db.googleSyncOperation.count({ where: { idempotencyKey: 'P14-GMAIL-ROLLBACK-0001' } }), 0);
    assert.deepEqual(fs.existsSync(context.uploadDir) ? fs.readdirSync(context.uploadDir) : [], []);
  });
});

test('P14-SEC-11 Calendar accepts only server-derived case-owned date candidates with hash binding and human confirmation', async () => {
  await withContext('p14-sec-calendar', async (context) => {
    await connectGoogle(context);
    let current = await workspace(context);
    const candidate = current.dateCandidates[0];
    assert.equal(candidate.sourceType, 'MEETING_ACTION_ITEM');
    assert.equal(candidate.sourceEntityId, 'ACT-SYN-001');
    assert.equal(candidate.startDateTime, '2026-03-01T10:00:00.000Z');
    assert.equal(typeof candidate.confidence, 'number');
    const base = {
      dateCandidateId: candidate.id, candidateHash: candidate.candidateHash, humanConfirmed: true,
      idempotencyKey: 'P14-CALENDAR-RACE-0001', expectedCaseVersion: current.caseVersion
    };
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/calendar-event`, 'POST', { ...base, humanConfirmed: false }, context.pmSession)).status, 400);
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/calendar-event`, 'POST', { ...base, startDateTime: '2026-08-15T10:00:00.000Z' }, context.pmSession)).status, 400);
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/calendar-event`, 'POST', { ...base, dateCandidateId: 'FORGED-CANDIDATE' }, context.pmSession)).status, 400);

    await context.db.meeting.create({ data: {
      id: 'MEET-P14-OTHER-CASE', caseId: 'CASE-SYN-004', title: 'Other case meeting', meetingDate: new Date('2026-03-01T00:00:00.000Z'),
      rawText: 'Other case source', rawTextSha256: crypto.createHash('sha256').update('Other case source').digest('hex'), status: 'DRAFT', version: 1, createdById: 'USR-PM'
    } });
    await context.db.meetingActionItem.create({ data: {
      id: 'ACT-P14-OTHER-CASE', meetingId: 'MEET-P14-OTHER-CASE', title: 'Other case date', dueDate: new Date('2026-04-01T10:00:00.000Z'), status: 'PENDING'
    } });
    const crossCaseCandidate = (await workspace(context, 'CASE-SYN-004')).dateCandidates[0];
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/calendar-event`, 'POST', {
      ...base, dateCandidateId: crossCaseCandidate.id, candidateHash: crossCaseCandidate.candidateHash, idempotencyKey: 'P14-CALENDAR-CROSS-0001'
    }, context.pmSession)).status, 400);

    await context.db.meetingActionItem.update({ where: { id: candidate.id }, data: { title: 'Updated verified action item' } });
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/calendar-event`, 'POST', base, context.pmSession)).status, 409);
    current = await workspace(context);
    const refreshed = current.dateCandidates.find((entry: { id: string }) => entry.id === candidate.id);
    const valid = { ...base, candidateHash: refreshed.candidateHash, expectedCaseVersion: current.caseVersion };
    const results = await Promise.all([
      requestJson(context.origin, `/api/cases/${context.caseId}/google/calendar-event`, 'POST', valid, context.pmSession),
      requestJson(context.origin, `/api/cases/${context.caseId}/google/calendar-event`, 'POST', valid, context.pmSession)
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 201]);
    assert.equal(await context.db.googleResourceLink.count({ where: { caseId: context.caseId, entityType: 'CALENDAR_EVENT' } }), 1);
  });
});

test('P14-SEC-11A quarantined mutations require an audited Admin no-side-effect resolution before a fresh key is allowed', async () => {
  const adapterPrototype = GoogleWorkspaceFakeAdapter.prototype as any;
  const originalCreateCalendarEvent = adapterPrototype.createCalendarEvent;
  let providerCalls = 0;
  adapterPrototype.createCalendarEvent = async function (...args: unknown[]): Promise<unknown> {
    providerCalls += 1;
    return originalCreateCalendarEvent.apply(this, args);
  };
  try {
    await withContext('p14-sec-calendar-reconciliation', async (context) => {
      await connectGoogle(context);
      const current = await workspace(context);
      const candidate = current.dateCandidates[0];
      const request = {
        dateCandidateId: candidate.id,
        candidateHash: candidate.candidateHash,
        humanConfirmed: true,
        idempotencyKey: 'P14-CALENDAR-RECONCILIATION-0001',
        expectedCaseVersion: current.caseVersion
      };
      await context.db.$executeRawUnsafe(`CREATE TRIGGER "p14_test_reject_calendar_audit" BEFORE INSERT ON "AuditLog" WHEN NEW."action" = 'GOOGLE_CALENDAR_EVENT_CREATED' BEGIN SELECT RAISE(ABORT, 'forced calendar audit rollback'); END`);
      const first = await requestJson(context.origin, `/api/cases/${context.caseId}/google/calendar-event`, 'POST', request, context.pmSession);
      assert.equal(first.status, 500);
      assert.equal(providerCalls, 1);
      const quarantined = await context.db.googleSyncOperation.findFirstOrThrow({ where: { idempotencyKey: request.idempotencyKey } });
      assert.equal(quarantined.status, 'RECONCILIATION_REQUIRED');
      assert.equal(await context.db.googleResourceLink.count({ where: { operationId: quarantined.id } }), 0);
      await context.db.$executeRawUnsafe('DROP TRIGGER "p14_test_reject_calendar_audit"');

      const sameKey = await requestJson(context.origin, `/api/cases/${context.caseId}/google/calendar-event`, 'POST', request, context.pmSession);
      assert.equal(sameKey.status, 503);
      const newKey = await requestJson(context.origin, `/api/cases/${context.caseId}/google/calendar-event`, 'POST', {
        ...request,
        idempotencyKey: 'P14-CALENDAR-RECONCILIATION-0002'
      }, context.pmSession);
      assert.equal(newKey.status, 409);
      assert.equal(providerCalls, 1);
      assert.equal((await context.db.caseItem.findUniqueOrThrow({ where: { id: context.caseId } })).version, current.caseVersion);

      const forbiddenQueue = await requestJson(context.origin, '/api/google-workspace/reconciliation', 'GET', undefined, context.directorSession);
      assert.equal(forbiddenQueue.status, 403);
      const queue = await requestJson(context.origin, '/api/google-workspace/reconciliation', 'GET', undefined, context.adminSession);
      assert.equal(queue.status, 200);
      const queued = queue.body.operations.find((operation: { id: string }) => operation.id === quarantined.id);
      assert.ok(queued);
      assert.equal(queued.status, 'RECONCILIATION_REQUIRED');

      const resolutionResult = JSON.stringify({ httpStatus: 409, body: {
        error: 'fresh key required', responseClass: 'RECONCILED_NO_SIDE_EFFECT', status: 'RECONCILED_NO_SIDE_EFFECT',
        resolution: 'CONFIRMED_NO_EXTERNAL_SIDE_EFFECT', confirmation: 'NO_EXTERNAL_RESOURCE_CONFIRMED',
        verificationReferenceHash: 'a'.repeat(64), resolvedById: 'USR-ADMIN', previousResultSha256: 'b'.repeat(64)
      } });
      await assert.rejects(() => context.db.googleSyncOperation.update({
        where: { id: quarantined.id },
        data: { status: 'RECONCILED_NO_SIDE_EFFECT', resultJson: resolutionResult, completedAt: new Date() }
      }), /same-transaction active Admin audit|constraint/i);
      await assert.rejects(() => context.db.$transaction(async (tx) => {
        await tx.auditLog.create({ data: {
          id: `AUD-P14-NONADMIN-${crypto.randomUUID()}`,
          organizationId: 'ORG-SYN-A',
          userId: 'USR-DIRECTOR',
          action: 'GOOGLE_RECONCILIATION_RESOLVED',
          targetEntity: 'GoogleSyncOperation',
          targetId: quarantined.id,
          metadataJson: JSON.stringify({
            resolution: 'CONFIRMED_NO_EXTERNAL_SIDE_EFFECT', confirmation: 'NO_EXTERNAL_RESOURCE_CONFIRMED', verificationReferenceHash: 'a'.repeat(64)
          })
        } });
        await tx.googleSyncOperation.update({
          where: { id: quarantined.id },
          data: { status: 'RECONCILED_NO_SIDE_EFFECT', resultJson: resolutionResult, completedAt: new Date() }
        });
      }), /same-transaction active Admin audit|constraint/i);

      const resolvePath = `/api/google-workspace/reconciliation/${quarantined.id}/resolve`;
      const expectedUpdatedAt = quarantined.updatedAt.toISOString();
      const resolvePayload = {
        resolution: 'CONFIRMED_NO_EXTERNAL_SIDE_EFFECT',
        confirmation: 'NO_EXTERNAL_RESOURCE_CONFIRMED',
        verificationReference: 'Google Calendar console check P14-SEC-11A',
        expectedUpdatedAt
      };
      assert.equal((await requestJson(context.origin, resolvePath, 'POST', { ...resolvePayload, resolution: 'ASSUME_NO_SIDE_EFFECT' }, context.adminSession)).status, 400);
      assert.equal((await requestJson(context.origin, resolvePath, 'POST', { ...resolvePayload, confirmation: 'YES' }, context.adminSession)).status, 400);
      assert.equal((await requestJson(context.origin, resolvePath, 'POST', { ...resolvePayload, verificationReference: 'access_token=raw-secret' }, context.adminSession)).status, 400);
      assert.equal((await requestJson(context.origin, resolvePath, 'POST', { ...resolvePayload, expectedUpdatedAt: new Date(0).toISOString() }, context.adminSession)).status, 409);
      assert.equal((await requestJson(context.origin, resolvePath, 'POST', resolvePayload, context.directorSession)).status, 403);

      const concurrentResolutions = await Promise.all([
        requestJson(context.origin, resolvePath, 'POST', resolvePayload, context.adminSession),
        requestJson(context.origin, resolvePath, 'POST', resolvePayload, context.adminSession)
      ]);
      assert.deepEqual(concurrentResolutions.map((entry) => entry.status).sort(), [200, 409]);
      const reconciled = await context.db.googleSyncOperation.findUniqueOrThrow({ where: { id: quarantined.id } });
      assert.equal(reconciled.status, 'RECONCILED_NO_SIDE_EFFECT');
      assert.equal(String(reconciled.resultJson).includes(resolvePayload.verificationReference), false);
      assert.equal(await context.db.auditLog.count({ where: {
        action: 'GOOGLE_RECONCILIATION_RESOLVED', targetEntity: 'GoogleSyncOperation', targetId: quarantined.id
      } }), 1);
      assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/calendar-event`, 'POST', request, context.pmSession)).status, 409);

      const afterResolution = await requestJson(context.origin, `/api/cases/${context.caseId}/google/calendar-event`, 'POST', {
        ...request,
        idempotencyKey: 'P14-CALENDAR-RECONCILIATION-0003'
      }, context.pmSession);
      assert.equal(afterResolution.status, 201, JSON.stringify(afterResolution.body));
      assert.equal(providerCalls, 2);

      const recentPending = await context.db.googleSyncOperation.create({ data: {
        id: `GSYNC-P14-RECENT-${crypto.randomUUID()}`,
        organizationId: 'ORG-SYN-A', caseId: context.caseId, operationKind: 'DRIVE_FOLDER',
        idempotencyKey: 'P14-RECENT-PENDING-0001', requestFingerprint: 'c'.repeat(64), status: 'PENDING', actorId: 'USR-PM'
      } });
      const recentResolution = await requestJson(context.origin, `/api/google-workspace/reconciliation/${recentPending.id}/resolve`, 'POST', {
        ...resolvePayload, expectedUpdatedAt: recentPending.updatedAt.toISOString(), verificationReference: 'Recent pending external console check'
      }, context.adminSession);
      assert.equal(recentResolution.status, 409);
      await context.db.googleSyncOperation.delete({ where: { id: recentPending.id } });

      const staleAt = new Date(Date.now() - 10 * 60 * 1000);
      const stalePending = await context.db.googleSyncOperation.create({ data: {
        id: `GSYNC-P14-STALE-${crypto.randomUUID()}`,
        organizationId: 'ORG-SYN-A', caseId: context.caseId, operationKind: 'SHEETS_IMPORT',
        idempotencyKey: 'P14-STALE-PENDING-0001', requestFingerprint: 'd'.repeat(64), status: 'PENDING', actorId: 'USR-PM',
        createdAt: staleAt, updatedAt: staleAt
      } });
      const staleResolution = await requestJson(context.origin, `/api/google-workspace/reconciliation/${stalePending.id}/resolve`, 'POST', {
        ...resolvePayload, expectedUpdatedAt: stalePending.updatedAt.toISOString(), verificationReference: 'Stale pending Sheets console check'
      }, context.adminSession);
      assert.equal(staleResolution.status, 200, JSON.stringify(staleResolution.body));
      assert.equal((await context.db.googleSyncOperation.findUniqueOrThrow({ where: { id: stalePending.id } })).status, 'RECONCILED_NO_SIDE_EFFECT');
    });
  } finally {
    adapterPrototype.createCalendarEvent = originalCreateCalendarEvent;
  }
});

test('P14-SEC-12 Docs export loads a case-owned meeting/version from DB and rejects client-authored content', async () => {
  await withContext('p14-sec-docs', async (context) => {
    await connectGoogle(context);
    const current = await workspace(context);
    const meeting = current.meetings.find((entry: { id: string }) => entry.id === 'MEET-SYN-002');
    const base = { meetingId: meeting.id, versionNumber: meeting.version, idempotencyKey: 'P14-DOCS-VALID-0001', expectedCaseVersion: current.caseVersion };
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/export-docs`, 'POST', { ...base, content: 'forged client body' }, context.pmSession)).status, 400);
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/export-docs`, 'POST', { ...base, meetingId: 'MEET-NOT-FOUND' }, context.pmSession)).status, 404);
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/export-docs`, 'POST', { ...base, versionNumber: meeting.version + 1 }, context.pmSession)).status, 409);
    const exported = await requestJson(context.origin, `/api/cases/${context.caseId}/google/export-docs`, 'POST', base, context.pmSession);
    assert.equal(exported.status, 201, JSON.stringify(exported.body));
    assert.equal(exported.body.exportResult.version, meeting.version);
    const sourceMeeting = await context.db.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
    const sourceText = [sourceMeeting.rawText, sourceMeeting.summary, sourceMeeting.decisions]
      .filter((part): part is string => Boolean(part))
      .join('\n\n');
    const expectedSha256 = crypto.createHash('sha256').update(sourceText).digest('hex');
    const snapshot = await context.db.googleImportSnapshot.findUniqueOrThrow({ where: { id: exported.body.snapshot.id } });
    const provenance = JSON.parse(snapshot.provenanceJson);
    const resource = await context.db.googleResourceLink.findUniqueOrThrow({ where: { id: exported.body.resourceLink.id } });
    const metadata = JSON.parse(resource.resourceMetadataJson);
    assert.equal(snapshot.sourceType, 'DOCS_TEXT');
    assert.equal(snapshot.caseId, context.caseId);
    assert.equal(snapshot.operationId, resource.operationId);
    assert.equal(snapshot.externalResourceId, resource.externalResourceId);
    assert.equal(snapshot.sha256, expectedSha256);
    assert.equal(snapshot.version, meeting.version);
    assert.deepEqual(
      { meetingId: provenance.meetingId, meetingVersion: provenance.meetingVersion, contentSha256: provenance.contentSha256, exportedDocumentId: provenance.exportedDocumentId },
      { meetingId: meeting.id, meetingVersion: meeting.version, contentSha256: expectedSha256, exportedDocumentId: resource.externalResourceId }
    );
    assert.equal(metadata.snapshotId, snapshot.id);
    assert.equal(metadata.contentSha256, snapshot.sha256);
  });
});

test('P14-SEC-12A Docs audit failure rolls back the source snapshot, resource projection, and case version', async () => {
  await withContext('p14-sec-docs-rollback', async (context) => {
    await connectGoogle(context);
    const current = await workspace(context);
    const meeting = current.meetings.find((entry: { id: string }) => entry.id === 'MEET-SYN-002');
    const before = {
      caseVersion: current.caseVersion,
      snapshots: await context.db.googleImportSnapshot.count({ where: { caseId: context.caseId } }),
      resources: await context.db.googleResourceLink.count({ where: { caseId: context.caseId } })
    };
    await context.db.$executeRawUnsafe(`CREATE TRIGGER "p14_test_reject_docs_audit" BEFORE INSERT ON "AuditLog" WHEN NEW."action" = 'GOOGLE_DOCS_EXPORTED' BEGIN SELECT RAISE(ABORT, 'forced docs audit rollback'); END`);
    try {
      const failed = await requestJson(context.origin, `/api/cases/${context.caseId}/google/export-docs`, 'POST', {
        meetingId: meeting.id,
        versionNumber: meeting.version,
        idempotencyKey: 'P14-DOCS-ROLLBACK-0001',
        expectedCaseVersion: current.caseVersion
      }, context.pmSession);
      assert.equal(failed.status, 500, JSON.stringify(failed.body));
    } finally {
      await context.db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "p14_test_reject_docs_audit"');
    }
    assert.equal((await context.db.caseItem.findUniqueOrThrow({ where: { id: context.caseId } })).version, before.caseVersion);
    assert.equal(await context.db.googleImportSnapshot.count({ where: { caseId: context.caseId } }), before.snapshots);
    assert.equal(await context.db.googleResourceLink.count({ where: { caseId: context.caseId } }), before.resources);
    const operation = await context.db.googleSyncOperation.findFirstOrThrow({ where: { idempotencyKey: 'P14-DOCS-ROLLBACK-0001' } });
    assert.equal(operation.status, 'RECONCILIATION_REQUIRED');
  });
});

test('P14-SEC-12B DB guards reject cross-case Docs snapshots and mismatched snapshot/resource bindings atomically', async () => {
  await withContext('p14-sec-docs-db-idor', async (context) => {
    const sourceMeeting = await context.db.meeting.findUniqueOrThrow({ where: { id: 'MEET-SYN-002' } });
    await context.db.meeting.create({ data: {
      id: 'MEET-P14-DOCS-OTHER-CASE',
      caseId: 'CASE-SYN-004',
      title: 'Synthetic other case Docs source',
      meetingDate: new Date('2026-04-10T00:00:00.000Z'),
      rawText: 'Other case private source',
      rawTextSha256: crypto.createHash('sha256').update('Other case private source').digest('hex'),
      status: 'FINAL',
      version: 1,
      createdById: 'USR-PM'
    } });
    const sourceText = [sourceMeeting.rawText, sourceMeeting.summary, sourceMeeting.decisions]
      .filter((part): part is string => Boolean(part))
      .join('\n\n');
    const sourceHash = crypto.createHash('sha256').update(sourceText).digest('hex');
    const operationData = (suffix: string) => ({
      id: `GSYNC-P14-DOCS-IDOR-${suffix}`,
      organizationId: 'ORG-SYN-A',
      caseId: context.caseId,
      operationKind: 'DOCS_EXPORT',
      idempotencyKey: `P14-DOCS-IDOR-${suffix}-0001`,
      requestFingerprint: crypto.createHash('sha256').update(`docs-idor-${suffix}`).digest('hex'),
      status: 'PENDING',
      actorId: 'USR-PM'
    });

    await assert.rejects(() => context.db.$transaction(async (tx) => {
      const operation = operationData('CROSS');
      await tx.googleSyncOperation.create({ data: operation });
      await tx.googleImportSnapshot.create({ data: {
        id: 'GSNAP-P14-DOCS-IDOR-CROSS',
        organizationId: 'ORG-SYN-A',
        caseId: context.caseId,
        operationId: operation.id,
        sourceType: 'DOCS_TEXT',
        externalResourceId: 'docs-provider-idor-cross',
        sha256: sourceHash,
        version: 1,
        provenanceJson: JSON.stringify({
          meetingId: 'MEET-P14-DOCS-OTHER-CASE', meetingVersion: 1, contentSha256: sourceHash,
          exportedDocumentId: 'docs-provider-idor-cross', exportedBy: 'USR-PM'
        }),
        createdById: 'USR-PM'
      } });
    }), /Docs source snapshot is not bound|Foreign key constraint/i);

    await assert.rejects(() => context.db.$transaction(async (tx) => {
      const operation = operationData('LINK');
      await tx.googleSyncOperation.create({ data: operation });
      const snapshotId = 'GSNAP-P14-DOCS-IDOR-LINK';
      const externalResourceId = 'docs-provider-idor-link';
      await tx.googleImportSnapshot.create({ data: {
        id: snapshotId,
        organizationId: 'ORG-SYN-A',
        caseId: context.caseId,
        operationId: operation.id,
        sourceType: 'DOCS_TEXT',
        externalResourceId,
        sha256: sourceHash,
        version: sourceMeeting.version,
        provenanceJson: JSON.stringify({
          meetingId: sourceMeeting.id, meetingVersion: sourceMeeting.version, contentSha256: sourceHash,
          exportedDocumentId: externalResourceId, exportedBy: 'USR-PM'
        }),
        createdById: 'USR-PM'
      } });
      await tx.googleResourceLink.create({ data: {
        id: 'GRLINK-P14-DOCS-IDOR-LINK',
        organizationId: 'ORG-SYN-A',
        caseId: context.caseId,
        operationId: operation.id,
        entityType: 'DOCS_EXPORT',
        internalEntityId: `${sourceMeeting.id}:v${sourceMeeting.version}`,
        externalResourceId,
        resourceMetadataJson: JSON.stringify({
          snapshotId,
          meetingId: 'MEET-P14-DOCS-OTHER-CASE',
          versionNumber: sourceMeeting.version,
          contentSha256: sourceHash
        })
      } });
    }), /Docs export is not bound|Foreign key constraint/i);

    assert.equal(await context.db.googleSyncOperation.count({ where: { id: { startsWith: 'GSYNC-P14-DOCS-IDOR-' } } }), 0);
    assert.equal(await context.db.googleImportSnapshot.count({ where: { id: { startsWith: 'GSNAP-P14-DOCS-IDOR-' } } }), 0);
    assert.equal(await context.db.googleResourceLink.count({ where: { id: 'GRLINK-P14-DOCS-IDOR-LINK' } }), 0);
  });
});

test('P14-SEC-13 Sheets requires a case-scoped allowlisted source and bounded A1 range; same-key replay survives case-version bump', async () => {
  await withContext('p14-sec-sheets', async (context) => {
    await connectGoogle(context);
    const current = await workspace(context);
    const otherCase = await workspace(context, 'CASE-SYN-004');
    const source = current.sheetSources[0];
    const common = { sheetName: source.sheetName, rangeA1: 'A1:C10', idempotencyKey: 'P14-SHEETS-VALID-0001', expectedCaseVersion: current.caseVersion };
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/import-sheets`, 'POST', { ...common, spreadsheetId: otherCase.sheetSources[0].spreadsheetId, idempotencyKey: 'P14-SHEETS-CROSS-0001' }, context.pmSession)).status, 400);
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/import-sheets`, 'POST', { ...common, spreadsheetId: 'arbitrary-sheet', idempotencyKey: 'P14-SHEETS-ARBITRARY-0001' }, context.pmSession)).status, 400);
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/import-sheets`, 'POST', { ...common, spreadsheetId: source.spreadsheetId, rangeA1: 'A1:D10', idempotencyKey: 'P14-SHEETS-RANGE-0001' }, context.pmSession)).status, 400);
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/import-sheets`, 'POST', { ...common, spreadsheetId: source.spreadsheetId, rangeA1: 'A1:Z200', idempotencyKey: 'P14-SHEETS-HUGE-0001' }, context.pmSession)).status, 400);
    const validPayload = { ...common, spreadsheetId: source.spreadsheetId };
    const imported = await requestJson(context.origin, `/api/cases/${context.caseId}/google/import-sheets`, 'POST', validPayload, context.pmSession);
    assert.equal(imported.status, 201, JSON.stringify(imported.body));
    const snapshot = await context.db.googleImportSnapshot.findUniqueOrThrow({ where: { id: imported.body.snapshot.id } });
    const provenance = JSON.parse(snapshot.provenanceJson);
    const resource = await context.db.googleResourceLink.findUniqueOrThrow({ where: { id: imported.body.resourceLink.id } });
    const metadata = JSON.parse(resource.resourceMetadataJson);
    assert.match(provenance.providerSnapshotId, /^[A-Za-z0-9._:-]{1,200}$/);
    assert.equal(metadata.providerSnapshotId, provenance.providerSnapshotId);
    assert.equal(metadata.snapshotId, snapshot.id);
    const replay = await requestJson(context.origin, `/api/cases/${context.caseId}/google/import-sheets`, 'POST', validPayload, context.pmSession);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.idempotentReplay, true);
  });
});

test('P14-SEC-13A Sheets provider hash, dimensions, range, and JSON are verified before snapshot persistence', async () => {
  const adapterPrototype = GoogleWorkspaceFakeAdapter.prototype as any;
  const originalImport = adapterPrototype.importSheets;
  let corruption: 'HASH' | 'ROW_COUNT' | 'COLUMN_COUNT' | 'RANGE' | 'JSON' | 'SNAPSHOT_ID' = 'HASH';
  adapterPrototype.importSheets = async function (
    this: GoogleWorkspaceFakeAdapter,
    caseId: string,
    input: { spreadsheetId: string; sheetName: string; rangeA1: string }
  ): Promise<any> {
    const response = await originalImport.call(this, caseId, input);
    if (!response.data) throw new Error('Expected deterministic Sheets data');
    if (corruption === 'HASH') {
      response.data.sha256 = '0'.repeat(64);
    } else if (corruption === 'ROW_COUNT') {
      response.data.rowCount += 1;
    } else if (corruption === 'COLUMN_COUNT') {
      response.data.columnCount -= 1;
    } else if (corruption === 'RANGE') {
      const values = JSON.parse(response.data.valuesJson);
      values.range = 'A1:B2';
      response.data.valuesJson = JSON.stringify(values);
      response.data.sha256 = crypto.createHash('sha256').update(response.data.valuesJson).digest('hex');
    } else if (corruption === 'JSON') {
      response.data.valuesJson = '{"spreadsheetId":';
      response.data.sha256 = crypto.createHash('sha256').update(response.data.valuesJson).digest('hex');
    } else {
      response.data.snapshotId = '../untrusted-provider-snapshot';
    }
    return response;
  };

  try {
    await withContext('p14-sec-sheets-provider-trust', async (context) => {
      await connectGoogle(context);
      const current = await workspace(context);
      const source = current.sheetSources[0];
      const before = {
        caseVersion: current.caseVersion,
        snapshots: await context.db.googleImportSnapshot.count({ where: { caseId: context.caseId } }),
        resources: await context.db.googleResourceLink.count({ where: { caseId: context.caseId } })
      };

      for (const scenario of ['HASH', 'ROW_COUNT', 'COLUMN_COUNT', 'RANGE', 'JSON', 'SNAPSHOT_ID'] as const) {
        corruption = scenario;
        const idempotencyKey = `P14-SHEETS-PROVIDER-${scenario}-001`;
        const failed = await requestJson(context.origin, `/api/cases/${context.caseId}/google/import-sheets`, 'POST', {
          spreadsheetId: source.spreadsheetId,
          sheetName: source.sheetName,
          rangeA1: 'A1:C10',
          idempotencyKey,
          expectedCaseVersion: before.caseVersion
        }, context.pmSession);
        assert.equal(failed.status, 502, `${scenario}: ${JSON.stringify(failed.body)}`);
        const operation = await context.db.googleSyncOperation.findFirstOrThrow({ where: { idempotencyKey } });
        assert.equal(operation.status, 'FAILED', scenario);
        assert.equal((await context.db.caseItem.findUniqueOrThrow({ where: { id: context.caseId } })).version, before.caseVersion);
        assert.equal(await context.db.googleImportSnapshot.count({ where: { caseId: context.caseId } }), before.snapshots);
        assert.equal(await context.db.googleResourceLink.count({ where: { caseId: context.caseId } }), before.resources);
      }
    });
  } finally {
    adapterPrototype.importSheets = originalImport;
  }
});

test('P14-SEC-14 retry policy is capped at three for 429/5xx and never retries 401/403/cancel', async () => {
  await withContext('p14-sec-retries', async (context) => {
    await connectGoogle(context);
    const assertAttempts = async (mode: string, expectedStatus: number, expectedAttempts: number) => {
      await setMode(context, mode);
      const current = await connectionStatus(context);
      const startedAt = Date.now();
      const response = await requestJson(context.origin, '/api/google-workspace/test', 'POST', { expectedVersion: current.connection.version }, context.adminSession);
      const elapsedMs = Date.now() - startedAt;
      assert.equal(response.status, expectedStatus, `${mode}: ${JSON.stringify(response.body)}`);
      const operation = await context.db.googleSyncOperation.findFirstOrThrow({ where: { operationKind: 'CONNECTION_TEST' }, orderBy: { createdAt: 'desc' }, include: { attempts: true } });
      assert.equal(operation.attempts.length, expectedAttempts, mode);
      return elapsedMs;
    };
    const rateLimitElapsedMs = await assertAttempts('RATE_LIMIT_RETRY_AFTER', 429, 3);
    assert.ok(rateLimitElapsedMs >= 9_500, `Retry-After=5 seconds must be honored twice; observed ${rateLimitElapsedMs}ms`);
    const serverErrorElapsedMs = await assertAttempts('SERVER_ERROR', 502, 3);
    assert.ok(serverErrorElapsedMs >= 250, `5xx exponential backoff must not be a busy retry loop; observed ${serverErrorElapsedMs}ms`);
    assert.ok(serverErrorElapsedMs < 5_000, `5xx bounded backoff exceeded a reasonable cap; observed ${serverErrorElapsedMs}ms`);
    await assertAttempts('BAD_SCOPE', 403, 1);
    await assertAttempts('USER_CANCEL', 409, 1);
    await assertAttempts('TOKEN_EXPIRED', 401, 1);
  });
});

test('P14-SEC-14A an ignored abort is quarantined after the hard timeout and cannot be issued under a new key', async () => {
  const adapterPrototype = GoogleWorkspaceFakeAdapter.prototype as any;
  const originalCreateDriveFolder = adapterPrototype.createDriveFolder;
  let providerCalls = 0;
  let providerCompletions = 0;
  adapterPrototype.createDriveFolder = async function (_caseId: string, _title: string, key: string, _signal?: AbortSignal): Promise<unknown> {
    providerCalls += 1;
    return new Promise((resolve) => {
      setTimeout(() => {
        providerCompletions += 1;
        resolve({
          responseClass: 'SUCCESS',
          data: {
            folderId: `late-${key}`,
            folderName: 'Late provider side effect',
            webViewLink: `https://drive.google.invalid/folders/late-${key}`,
            isExisting: false
          },
          durationMs: 2_500
        });
      }, 2_500);
    });
  };
  try {
    await withContext('p14-sec-provider-hard-timeout', async (context) => {
      await connectGoogle(context);
      const current = await workspace(context);
      const startedAt = Date.now();
      const result = await requestJson(context.origin, `/api/cases/${context.caseId}/google/drive-folder`, 'POST', {
        idempotencyKey: 'P14-NEVER-SETTLING-PROVIDER-0001',
        expectedCaseVersion: current.caseVersion
      }, context.pmSession);
      const elapsed = Date.now() - startedAt;
      assert.equal(result.status, 504, JSON.stringify(result.body));
      assert.equal(result.body.responseClass, 'TIMEOUT');
      assert.ok(elapsed >= 1_800 && elapsed < 6_000, `hard timeout elapsed ${elapsed}ms`);
      const operation = await context.db.googleSyncOperation.findFirstOrThrow({ where: { idempotencyKey: 'P14-NEVER-SETTLING-PROVIDER-0001' } });
      assert.equal(operation.status, 'RECONCILIATION_REQUIRED');
      assert.equal(await context.db.googleSyncAttempt.count({ where: { operationId: operation.id } }), 1);
      const blocked = await requestJson(context.origin, `/api/cases/${context.caseId}/google/drive-folder`, 'POST', {
        idempotencyKey: 'P14-NEVER-SETTLING-PROVIDER-0002',
        expectedCaseVersion: current.caseVersion
      }, context.pmSession);
      assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
      assert.equal(providerCalls, 1);
      await new Promise((resolve) => setTimeout(resolve, 700));
      assert.equal(providerCompletions, 1);
      assert.equal(await context.db.googleResourceLink.count({ where: { operationId: operation.id } }), 0);
    });
  } finally {
    adapterPrototype.createDriveFolder = originalCreateDriveFolder;
  }
});

test('P14-SEC-14B malformed provider envelope fields are canonicalized and never reflected to the API', async () => {
  const adapterPrototype = GoogleWorkspaceFakeAdapter.prototype as any;
  const originalListGmailAttachments = adapterPrototype.listGmailAttachments;
  adapterPrototype.listGmailAttachments = async function (): Promise<unknown> {
    return {
      responseClass: 'RAW_SECRET_1//OPAQUE',
      retryAfterSeconds: 'RAW_RETRY_SECRET',
      durationMs: Number.POSITIVE_INFINITY,
      debugToken: 'RAW_ENVELOPE_SECRET'
    };
  };
  try {
    await withContext('p14-sec-provider-envelope', async (context) => {
      await connectGoogle(context);
      const response = await requestJson(context.origin, `/api/cases/${context.caseId}/google/workspace`, 'GET', undefined, context.pmSession);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.gmailSourceStatus.responseClass, 'MALFORMED_PROVIDER_RESPONSE');
      assert.equal(response.body.gmailSourceStatus.retryAfterSeconds, null);
      assert.deepEqual(response.body.gmailAttachments, []);
      const serialized = JSON.stringify(response.body);
      for (const marker of ['RAW_SECRET_1//OPAQUE', 'RAW_RETRY_SECRET', 'RAW_ENVELOPE_SECRET']) {
        assert.equal(serialized.includes(marker), false, `provider envelope leaked ${marker}`);
      }
    });
  } finally {
    adapterPrototype.listGmailAttachments = originalListGmailAttachments;
  }
});

test('P14-SEC-14C a failed quarantine write leaves PENDING and still blocks every fresh mutation key', async () => {
  const adapterPrototype = GoogleWorkspaceFakeAdapter.prototype as any;
  const originalCreateDriveFolder = adapterPrototype.createDriveFolder;
  let providerCalls = 0;
  adapterPrototype.createDriveFolder = async function (...args: unknown[]): Promise<unknown> {
    providerCalls += 1;
    return originalCreateDriveFolder.apply(this, args);
  };
  try {
    await withContext('p14-sec-quarantine-write-failure', async (context) => {
      await connectGoogle(context);
      await setMode(context, 'TIMEOUT');
      const current = await workspace(context);
      await context.db.$executeRawUnsafe(`CREATE TRIGGER "p14_test_reject_quarantine_attempt" BEFORE INSERT ON "GoogleSyncAttempt" BEGIN SELECT RAISE(ABORT, 'forced quarantine persistence failure'); END`);
      const first = await requestJson(context.origin, `/api/cases/${context.caseId}/google/drive-folder`, 'POST', {
        idempotencyKey: 'P14-QUARANTINE-FAILURE-0001', expectedCaseVersion: current.caseVersion
      }, context.pmSession);
      assert.equal(first.status, 504, JSON.stringify(first.body));
      const pending = await context.db.googleSyncOperation.findFirstOrThrow({ where: { idempotencyKey: 'P14-QUARANTINE-FAILURE-0001' } });
      assert.equal(pending.status, 'PENDING');
      await context.db.$executeRawUnsafe('DROP TRIGGER "p14_test_reject_quarantine_attempt"');
      await setMode(context, 'SUCCESS');
      const blocked = await requestJson(context.origin, `/api/cases/${context.caseId}/google/drive-folder`, 'POST', {
        idempotencyKey: 'P14-QUARANTINE-FAILURE-0002', expectedCaseVersion: current.caseVersion
      }, context.pmSession);
      assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
      assert.equal(providerCalls, 1);
    }, { allowTestGoogleModes: true });
  } finally {
    adapterPrototype.createDriveFolder = originalCreateDriveFolder;
  }
});

test('P14-SEC-15 disconnect is fail-closed on revoke failure and preserves imported internal data', async () => {
  await withContext('p14-sec-disconnect', async (context) => {
    await connectGoogle(context);
    let current = await workspace(context);
    const imported = await requestJson(context.origin, `/api/cases/${context.caseId}/google/import-gmail`, 'POST', {
      attachmentIds: [current.gmailAttachments[0].attachmentId], idempotencyKey: 'P14-DISCONNECT-GMAIL-0001', expectedCaseVersion: current.caseVersion
    }, context.pmSession);
    assert.equal(imported.status, 201);
    const beforeSnapshots = await context.db.googleImportSnapshot.count({ where: { caseId: context.caseId } });
    assert.equal((await requestJson(context.origin, '/api/google-workspace/disconnect', 'POST', {}, context.adminSession)).status, 400);
    const versionBeforeDisconnect = await connectionStatus(context);
    assert.equal((await requestJson(context.origin, '/api/google-workspace/disconnect', 'POST', { expectedVersion: versionBeforeDisconnect.connection.version + 1 }, context.adminSession)).status, 409);
    await setMode(context, 'REVOKE_FAILURE');
    const before = await connectionStatus(context);
    const failed = await requestJson(context.origin, '/api/google-workspace/disconnect', 'POST', { expectedVersion: before.connection.version }, context.adminSession);
    assert.equal(failed.status, 502);
    const unchanged = await connectionStatus(context);
    assert.equal(unchanged.connection.status, 'CONNECTED');
    assert.equal(unchanged.connection.version, before.connection.version);
    await setMode(context, 'SUCCESS');
    const disconnected = await requestJson(context.origin, '/api/google-workspace/disconnect', 'POST', { expectedVersion: unchanged.connection.version }, context.adminSession);
    assert.equal(disconnected.status, 200);
    assert.equal(disconnected.body.status, 'DISCONNECTED');
    assert.equal(await context.db.googleImportSnapshot.count({ where: { caseId: context.caseId } }), beforeSnapshots);
    current = await workspace(context);
    const blocked = await requestJson(context.origin, `/api/cases/${context.caseId}/google/drive-folder`, 'POST', {
      idempotencyKey: 'P14-AFTER-DISCONNECT-0001', expectedCaseVersion: current.caseVersion
    }, context.pmSession);
    assert.equal(blocked.status, 409);
  });
});

test('P14-SEC-16 raw DB triggers enforce tenant/assignment/role scope, terminal immutability, attempt bounds, and OAuth binding', async () => {
  await withContext('p14-sec-db-triggers', async (context) => {
    const initiated = await requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', { redirectTarget: '/integrations/google', expectedVersion: null }, context.adminSession);
    assert.equal(initiated.status, 201);
    const stateHash = crypto.createHash('sha256').update(initiated.body.state).digest('hex');
    await assert.rejects(() => context.db.googleOAuthState.update({ where: { stateHash }, data: { expiresAt: new Date(Date.now() + 86_400_000) } }));
    await assert.rejects(() => context.db.googleOAuthState.delete({ where: { stateHash } }));
    const connected = await requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
      state: initiated.body.state,
      code: 'FAKE_AUTHORIZATION_CODE'
    }, context.adminSession);
    assert.equal(connected.status, 200, JSON.stringify(connected.body));
    const connection = await context.db.googleWorkspaceConnection.findUniqueOrThrow({ where: { organizationId: 'ORG-SYN-A' } });
    await assert.rejects(() => context.db.googleWorkspaceConnection.update({
      where: { id: connection.id },
      data: {
        grantedScopesJson: JSON.stringify([...requiredScopes, 'https://www.googleapis.com/auth/drive.readonly']),
        version: { increment: 1 }
      }
    }));
    await assert.rejects(() => context.db.googleWorkspaceConnection.delete({ where: { id: connection.id } }));

    const operationData = {
      organizationId: 'ORG-SYN-A', caseId: context.caseId, operationKind: 'DRIVE_FOLDER',
      idempotencyKey: 'P14-DB-VALID-OP-0001', requestFingerprint: 'a'.repeat(64), status: 'PENDING', actorId: 'USR-PM'
    } as const;
    await assert.rejects(() => context.db.googleSyncOperation.create({ data: {
      id: `GSYNC-CROSS-${crypto.randomUUID()}`, ...operationData, organizationId: 'ORG-SYN-B', actorId: 'USR-ORGB-PM'
    } }));
    await assert.rejects(() => context.db.googleSyncOperation.create({ data: {
      id: `GSYNC-UNASSIGNED-${crypto.randomUUID()}`, ...operationData, actorId: 'USR-DIRECTOR', idempotencyKey: 'P14-DB-UNASSIGNED-01'
    } }));
    await context.db.user.create({ data: {
      id: 'USR-P14-NO-ROLE', email: 'p14-no-role@example.invalid', passwordHash: 'synthetic', name: 'No role', organizationId: 'ORG-SYN-A'
    } });
    await context.db.caseAssignment.create({ data: { caseId: context.caseId, userId: 'USR-P14-NO-ROLE' } });
    await assert.rejects(() => context.db.googleSyncOperation.create({ data: {
      id: `GSYNC-ROLE-${crypto.randomUUID()}`, ...operationData, actorId: 'USR-P14-NO-ROLE', idempotencyKey: 'P14-DB-BAD-ROLE-001'
    } }));
    await assert.rejects(() => context.db.googleWorkspaceConnection.create({ data: {
      id: `GCONN-NON-ADMIN-${crypto.randomUUID()}`,
      organizationId: 'ORG-SYN-B',
      status: 'CONNECTED',
      grantedScopesJson: JSON.stringify(requiredScopes),
      secretRef: 'LOCAL_FAKE_GOOGLE',
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
      createdById: 'USR-ORGB-PM'
    } }));
    await context.db.user.create({ data: {
      id: 'USR-P14-INACTIVE-ADMIN', email: 'p14-inactive-admin@example.invalid', passwordHash: 'synthetic',
      name: 'Inactive admin', organizationId: 'ORG-SYN-B', isActive: false
    } });
    await context.db.userRole.create({ data: { userId: 'USR-P14-INACTIVE-ADMIN', roleId: 'admin' } });
    await assert.rejects(() => context.db.googleWorkspaceConnection.create({ data: {
      id: `GCONN-INACTIVE-ADMIN-${crypto.randomUUID()}`,
      organizationId: 'ORG-SYN-B',
      status: 'CONNECTED',
      grantedScopesJson: JSON.stringify(requiredScopes),
      secretRef: 'LOCAL_FAKE_GOOGLE',
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
      createdById: 'USR-P14-INACTIVE-ADMIN'
    } }));
    await assert.rejects(() => context.db.googleOAuthState.create({ data: {
      id: `GOAUTH-INACTIVE-ADMIN-${crypto.randomUUID()}`,
      stateHash: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'),
      pkceVerifierRef: `PKCE_${crypto.randomUUID().replace(/-/g, '_').toUpperCase()}`,
      pkceChallenge: crypto.randomBytes(32).toString('base64url'),
      connectionVersion: null,
      organizationId: 'ORG-SYN-B',
      actorId: 'USR-P14-INACTIVE-ADMIN',
      redirectTarget: '/integrations/google',
      expiresAt: new Date(Date.now() + 600_000)
    } }));
    await assert.rejects(() => context.db.googleOAuthState.create({ data: {
      id: `GOAUTH-NON-ADMIN-${crypto.randomUUID()}`,
      stateHash: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'),
      pkceVerifierRef: `PKCE_${crypto.randomUUID().replace(/-/g, '_').toUpperCase()}`,
      pkceChallenge: crypto.randomBytes(32).toString('base64url'),
      connectionVersion: connection.version,
      organizationId: 'ORG-SYN-A',
      actorId: 'USR-P14-NO-ROLE',
      redirectTarget: '/integrations/google',
      expiresAt: new Date(Date.now() + 600_000)
    } }));
    await assert.rejects(() => context.db.googleSyncOperation.create({ data: {
      id: `GSYNC-CONNECTION-STAFF-${crypto.randomUUID()}`,
      organizationId: 'ORG-SYN-A', caseId: null, operationKind: 'CONNECTION_TEST', idempotencyKey: null,
      requestFingerprint: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'), status: 'PENDING', actorId: 'USR-STAFF'
    } }));
    await assert.rejects(() => context.db.googleSyncOperation.create({ data: {
      id: `GSYNC-CALENDAR-ROLE-${crypto.randomUUID()}`, ...operationData, operationKind: 'CALENDAR_EVENT', actorId: 'USR-STAFF', idempotencyKey: 'P14-DB-CALENDAR-ROLE'
    } }));

    const operation = await context.db.googleSyncOperation.create({ data: { id: `GSYNC-VALID-${crypto.randomUUID()}`, ...operationData } });
    await context.db.googleSyncAttempt.create({ data: {
      id: `GATT-${crypto.randomUUID()}`, operationId: operation.id, attemptNumber: 1, responseClass: 'SUCCESS', durationMs: 1
    } });
    await context.db.googleSyncOperation.update({ where: { id: operation.id }, data: {
      status: 'SUCCESS', resultJson: JSON.stringify({ httpStatus: 200, body: { ok: true } }), completedAt: new Date()
    } });
    await assert.rejects(() => context.db.googleSyncAttempt.create({ data: {
      id: `GATT-LATE-${crypto.randomUUID()}`, operationId: operation.id, attemptNumber: 2, responseClass: 'SUCCESS', durationMs: 1
    } }));
    await assert.rejects(() => context.db.googleSyncOperation.update({ where: { id: operation.id }, data: { requestFingerprint: 'b'.repeat(64) } }));
    await assert.rejects(() => context.db.googleSyncOperation.delete({ where: { id: operation.id } }));

    const createPendingOperation = async (suffix: string) => context.db.googleSyncOperation.create({ data: {
      id: `GSYNC-${suffix}-${crypto.randomUUID()}`,
      organizationId: 'ORG-SYN-A',
      caseId: context.caseId,
      operationKind: 'GMAIL_IMPORT',
      idempotencyKey: `P14-DB-${suffix}-${crypto.randomUUID()}`,
      requestFingerprint: crypto.createHash('sha256').update(`P14-DB-${suffix}-${crypto.randomUUID()}`).digest('hex'),
      status: 'PENDING',
      actorId: 'USR-PM'
    } });

    const wrongCreatorOperation = await createPendingOperation('WRONG-CREATOR');
    await assert.rejects(() => context.db.googleImportSnapshot.create({ data: {
      id: `GSNAP-WRONG-CREATOR-${crypto.randomUUID()}`,
      organizationId: 'ORG-SYN-A', caseId: context.caseId, operationId: wrongCreatorOperation.id,
      sourceType: 'GMAIL_ATTACHMENT', externalResourceId: 'EXT-WRONG-CREATOR', sha256: 'a'.repeat(64),
      provenanceJson: JSON.stringify({ documentVersionId: 'DOCVER-SYN-001' }), createdById: 'USR-P14-NO-ROLE'
    } }));
    await context.db.googleSyncOperation.delete({ where: { id: wrongCreatorOperation.id } });

    const calendarWorkspace = await workspace(context);
    const calendarCandidate = calendarWorkspace.dateCandidates[0];
    const calendarCreated = await requestJson(context.origin, `/api/cases/${context.caseId}/google/calendar-event`, 'POST', {
      dateCandidateId: calendarCandidate.id,
      candidateHash: calendarCandidate.candidateHash,
      humanConfirmed: true,
      idempotencyKey: 'P14-DB-CALENDAR-SOURCE-0001',
      expectedCaseVersion: calendarWorkspace.caseVersion
    }, context.pmSession);
    assert.equal(calendarCreated.status, 201, JSON.stringify(calendarCreated.body));
    const existingCalendar = await context.db.googleResourceLink.findFirstOrThrow({ where: {
      organizationId: 'ORG-SYN-A', caseId: context.caseId, entityType: 'CALENDAR_EVENT'
    } });
    const duplicateCalendarOperation = await context.db.googleSyncOperation.create({ data: {
      id: `GSYNC-CALENDAR-DUPLICATE-${crypto.randomUUID()}`,
      organizationId: 'ORG-SYN-A', caseId: context.caseId, operationKind: 'CALENDAR_EVENT',
      idempotencyKey: 'P14-DB-CALENDAR-SOURCE-0002', requestFingerprint: 'f'.repeat(64), status: 'PENDING', actorId: 'USR-PM'
    } });
    await assert.rejects(() => context.db.googleResourceLink.create({ data: {
      id: `GRLINK-CALENDAR-DUPLICATE-${crypto.randomUUID()}`,
      organizationId: 'ORG-SYN-A', caseId: context.caseId, operationId: duplicateCalendarOperation.id,
      entityType: 'CALENDAR_EVENT', internalEntityId: `CAL-ARBITRARY-${crypto.randomUUID()}`,
      externalResourceId: `EVENT-DUPLICATE-${crypto.randomUUID()}`,
      resourceMetadataJson: existingCalendar.resourceMetadataJson
    } }));
    await context.db.googleSyncOperation.delete({ where: { id: duplicateCalendarOperation.id } });

    const scopeOperation = await createPendingOperation('CROSS-SCOPE');
    await assert.rejects(() => context.db.googleResourceLink.create({ data: {
      id: `GRLINK-CROSS-${crypto.randomUUID()}`, organizationId: 'ORG-SYN-B', caseId: context.caseId,
      operationId: scopeOperation.id, entityType: 'GMAIL_ATTACHMENT', internalEntityId: 'DOCVER-CROSS',
      externalResourceId: 'EXT-CROSS', resourceMetadataJson: '{}'
    } }));
    await context.db.googleSyncOperation.delete({ where: { id: scopeOperation.id } });

    const kindMismatchOperation = await createPendingOperation('KIND-MISMATCH');
    await assert.rejects(() => context.db.googleResourceLink.create({ data: {
      id: `GRLINK-KIND-MISMATCH-${crypto.randomUUID()}`, organizationId: 'ORG-SYN-A', caseId: context.caseId,
      operationId: kindMismatchOperation.id, entityType: 'CALENDAR_EVENT', internalEntityId: 'CAL-KIND-MISMATCH',
      externalResourceId: 'EXT-KIND-MISMATCH', resourceMetadataJson: '{}'
    } }));
    await assert.rejects(() => context.db.googleImportSnapshot.create({ data: {
      id: `GSNAP-KIND-MISMATCH-${crypto.randomUUID()}`, organizationId: 'ORG-SYN-A', caseId: context.caseId,
      operationId: kindMismatchOperation.id, sourceType: 'SHEETS_RANGE', externalResourceId: 'EXT-KIND-MISMATCH',
      sha256: 'e'.repeat(64), provenanceJson: '{}', createdById: 'USR-PM'
    } }));
    await context.db.googleSyncOperation.delete({ where: { id: kindMismatchOperation.id } });
    const internalIdorOperation = await createPendingOperation('INTERNAL-IDOR');
    await assert.rejects(() => context.db.googleResourceLink.create({ data: {
      id: `GRLINK-INTERNAL-IDOR-${crypto.randomUUID()}`, organizationId: 'ORG-SYN-A', caseId: context.caseId,
      operationId: internalIdorOperation.id, entityType: 'GMAIL_ATTACHMENT', internalEntityId: 'DOCVER-SYN-003',
      externalResourceId: 'EXT-INTERNAL-IDOR', resourceMetadataJson: '{}'
    } }));
    await context.db.googleSyncOperation.delete({ where: { id: internalIdorOperation.id } });
    const assignmentRaceOperation = await createPendingOperation('ASSIGNMENT-RACE');
    await context.db.caseAssignment.delete({ where: { caseId_userId: { caseId: context.caseId, userId: 'USR-PM' } } });
    await assert.rejects(() => context.db.googleResourceLink.create({ data: {
      id: `GRLINK-ASSIGNMENT-RACE-${crypto.randomUUID()}`, organizationId: 'ORG-SYN-A', caseId: context.caseId,
      operationId: assignmentRaceOperation.id, entityType: 'GMAIL_ATTACHMENT', internalEntityId: 'DOCVER-SYN-001',
      externalResourceId: 'EXT-ASSIGNMENT-RACE', resourceMetadataJson: '{}'
    } }));
    await context.db.caseAssignment.create({ data: { caseId: context.caseId, userId: 'USR-PM' } });
    await context.db.googleSyncOperation.delete({ where: { id: assignmentRaceOperation.id } });

    const duplicateOperationOne = await createPendingOperation('DUPLICATE-ONE');
    const mismatchVersion = await context.db.documentVersion.findUniqueOrThrow({ where: { id: 'DOCVER-SYN-001' } });
    await context.db.googleImportSnapshot.create({ data: {
      id: `GSNAP-DUPLICATE-ONE-${crypto.randomUUID()}`, organizationId: 'ORG-SYN-A', caseId: context.caseId,
      operationId: duplicateOperationOne.id, sourceType: 'GMAIL_ATTACHMENT', externalResourceId: 'GMAIL-EXTERNAL-DUPLICATE',
      sha256: mismatchVersion.sha256,
      provenanceJson: JSON.stringify({ attachmentId: 'GMAIL-EXTERNAL-DUPLICATE', documentVersionId: 'DOCVER-SYN-001' }),
      createdById: 'USR-PM'
    } });
    await context.db.googleResourceLink.create({ data: {
      id: `GRLINK-DUPLICATE-ONE-${crypto.randomUUID()}`, organizationId: 'ORG-SYN-A', caseId: context.caseId,
      operationId: duplicateOperationOne.id, entityType: 'GMAIL_ATTACHMENT', internalEntityId: 'DOCVER-SYN-001',
      externalResourceId: 'GMAIL-EXTERNAL-DUPLICATE', resourceMetadataJson: JSON.stringify({ documentVersionId: 'DOCVER-SYN-001' })
    } });
    for (const terminalStatus of ['FAILED', 'CANCELLED'] as const) {
      await assert.rejects(() => context.db.googleSyncOperation.update({
        where: { id: duplicateOperationOne.id },
        data: {
          status: terminalStatus,
          resultJson: JSON.stringify({ httpStatus: 502, body: { error: 'synthetic failure' } }),
          completedAt: new Date()
        }
      }));
    }
    await context.db.googleSyncOperation.update({ where: { id: duplicateOperationOne.id }, data: {
      status: 'SUCCESS',
      resultJson: JSON.stringify({ httpStatus: 201, body: { importedCount: 1 } }),
      completedAt: new Date()
    } });
    const duplicateOperationTwo = await createPendingOperation('DUPLICATE-TWO');
    await assert.rejects(() => context.db.googleResourceLink.create({ data: {
      id: `GRLINK-DUPLICATE-TWO-${crypto.randomUUID()}`, organizationId: 'ORG-SYN-A', caseId: context.caseId,
      operationId: duplicateOperationTwo.id, entityType: 'GMAIL_ATTACHMENT', internalEntityId: 'DOCVER-SYN-002',
      externalResourceId: 'GMAIL-EXTERNAL-DUPLICATE', resourceMetadataJson: '{}'
    } }));
    await assert.rejects(() => context.db.googleImportSnapshot.create({ data: {
      id: `GSNAP-DUPLICATE-TWO-${crypto.randomUUID()}`, organizationId: 'ORG-SYN-A', caseId: context.caseId,
      operationId: duplicateOperationTwo.id, sourceType: 'GMAIL_ATTACHMENT', externalResourceId: 'GMAIL-EXTERNAL-DUPLICATE',
      sha256: '2'.repeat(64), provenanceJson: '{}', createdById: 'USR-PM'
    } }));
    await context.db.googleSyncOperation.delete({ where: { id: duplicateOperationTwo.id } });

    await assert.rejects(() => context.db.googleResourceLink.create({ data: {
      id: `GRLINK-TERMINAL-${crypto.randomUUID()}`, organizationId: 'ORG-SYN-A', caseId: context.caseId,
      operationId: operation.id, entityType: 'GMAIL_ATTACHMENT', internalEntityId: 'DOCVER-TERMINAL',
      externalResourceId: 'EXT-TERMINAL', resourceMetadataJson: '{}'
    } }));
    await assert.rejects(() => context.db.googleImportSnapshot.create({ data: {
      id: `GSNAP-TERMINAL-${crypto.randomUUID()}`, organizationId: 'ORG-SYN-A', caseId: context.caseId,
      operationId: operation.id, sourceType: 'GMAIL_ATTACHMENT', externalResourceId: 'EXT-TERMINAL',
      sha256: 'c'.repeat(64), provenanceJson: '{}', createdById: 'USR-PM'
    } }));
    await assert.rejects(() => context.db.googleResourceLink.create({ data: {
      id: `GRLINK-NULL-OP-${crypto.randomUUID()}`, organizationId: 'ORG-SYN-A', caseId: context.caseId,
      entityType: 'GMAIL_ATTACHMENT', internalEntityId: 'DOCVER-NULL-OP',
      externalResourceId: 'EXT-NULL-OP', resourceMetadataJson: '{}'
    } }));
    await assert.rejects(() => context.db.googleImportSnapshot.create({ data: {
      id: `GSNAP-NULL-OP-${crypto.randomUUID()}`, organizationId: 'ORG-SYN-A', caseId: context.caseId,
      sourceType: 'GMAIL_ATTACHMENT', externalResourceId: 'EXT-NULL-OP',
      sha256: 'd'.repeat(64), provenanceJson: '{}', createdById: 'USR-PM'
    } }));

    const credentialPayloads = [
      '{"accessToken":"SYNTHETIC_RAW_SECRET"}',
      '{"refreshToken":"SYNTHETIC_RAW_SECRET"}',
      '{"clientSecret":"SYNTHETIC_RAW_SECRET"}',
      '{"authorizationCode":"SYNTHETIC_RAW_SECRET"}',
      '{"privateKey":"SYNTHETIC_RAW_SECRET"}',
      '{"bearer":"SYNTHETIC_RAW_SECRET"}'
    ];
    for (const [index, credentialPayload] of credentialPayloads.entries()) {
      const credentialOperation = await createPendingOperation(`CREDENTIAL-${index}`);
      await assert.rejects(() => context.db.googleSyncAttempt.create({ data: {
        id: `GATT-CREDENTIAL-${index}-${crypto.randomUUID()}`,
        operationId: credentialOperation.id,
        attemptNumber: 1,
        responseClass: 'SERVER_ERROR',
        redactedError: credentialPayload,
        durationMs: 1
      } }), `attempt accepted camelCase credential payload ${credentialPayload}`);
      await assert.rejects(() => context.db.googleSyncOperation.update({
        where: { id: credentialOperation.id },
        data: {
          status: 'FAILED',
          resultJson: JSON.stringify({ httpStatus: 502, body: JSON.parse(credentialPayload) }),
          completedAt: new Date()
        }
      }), `operation result accepted camelCase credential payload ${credentialPayload}`);
      await assert.rejects(() => context.db.googleResourceLink.create({ data: {
        id: `GRLINK-CREDENTIAL-${index}-${crypto.randomUUID()}`,
        organizationId: 'ORG-SYN-A',
        caseId: context.caseId,
        operationId: credentialOperation.id,
        entityType: 'GMAIL_ATTACHMENT',
        internalEntityId: `DOCVER-CREDENTIAL-${index}`,
        externalResourceId: `EXT-CREDENTIAL-${index}`,
        resourceMetadataJson: credentialPayload
      } }), `resource metadata accepted camelCase credential payload ${credentialPayload}`);
      await assert.rejects(() => context.db.googleImportSnapshot.create({ data: {
        id: `GSNAP-CREDENTIAL-${index}-${crypto.randomUUID()}`,
        organizationId: 'ORG-SYN-A',
        caseId: context.caseId,
        operationId: credentialOperation.id,
        sourceType: 'GMAIL_ATTACHMENT',
        externalResourceId: `EXT-CREDENTIAL-${index}`,
        sha256: crypto.createHash('sha256').update(`credential-${index}`).digest('hex'),
        provenanceJson: credentialPayload,
        createdById: 'USR-PM'
      } }), `snapshot provenance accepted camelCase credential payload ${credentialPayload}`);
      await context.db.googleSyncOperation.delete({ where: { id: credentialOperation.id } });
    }
  });
});

test('P14-SEC-16A a Gmail operation cannot bind a snapshot and resource to different provider attachments', async () => {
  await withContext('p14-sec-gmail-pairing', async (context) => {
    const operation = await context.db.googleSyncOperation.create({ data: {
      id: `GSYNC-GMAIL-MISMATCH-${crypto.randomUUID()}`,
      organizationId: 'ORG-SYN-A', caseId: context.caseId, operationKind: 'GMAIL_IMPORT',
      idempotencyKey: 'P14-DB-GMAIL-MISMATCH-0001', requestFingerprint: 'e'.repeat(64),
      status: 'PENDING', actorId: 'USR-PM'
    } });
    const version = await context.db.documentVersion.findUniqueOrThrow({ where: { id: 'DOCVER-SYN-001' } });
    await context.db.googleImportSnapshot.create({ data: {
      id: `GSNAP-GMAIL-MISMATCH-${crypto.randomUUID()}`,
      organizationId: 'ORG-SYN-A', caseId: context.caseId, operationId: operation.id,
      sourceType: 'GMAIL_ATTACHMENT', externalResourceId: 'EXT-GMAIL-MISMATCH-A', sha256: version.sha256,
      provenanceJson: JSON.stringify({ attachmentId: 'EXT-GMAIL-MISMATCH-A', documentVersionId: version.id }),
      createdById: 'USR-PM'
    } });
    await assert.rejects(() => context.db.googleResourceLink.create({ data: {
      id: `GRLINK-GMAIL-MISMATCH-${crypto.randomUUID()}`,
      organizationId: 'ORG-SYN-A', caseId: context.caseId, operationId: operation.id,
      entityType: 'GMAIL_ATTACHMENT', internalEntityId: version.id,
      externalResourceId: 'EXT-GMAIL-MISMATCH-B', resourceMetadataJson: JSON.stringify({ documentVersionId: version.id })
    } }));
    await assert.rejects(() => context.db.googleSyncOperation.update({
      where: { id: operation.id },
      data: {
        status: 'SUCCESS', resultJson: JSON.stringify({ httpStatus: 201, body: { importedCount: 1 } }), completedAt: new Date()
      }
    }));
  });
});

test('P14-SEC-17 workspace query is bounded, metadata-searchable, safe-projected, and history is capped at 100', async () => {
  await withContext('p14-sec-workspace-bounds', async (context) => {
    await connectGoogle(context);
    const boundaryOperations = Array.from({ length: 121 }, (_, index) => ({
      id: `GSYNC-BOUNDARY-${String(index).padStart(3, '0')}`,
      organizationId: 'ORG-SYN-A',
      caseId: context.caseId,
      operationKind: 'GMAIL_IMPORT',
      idempotencyKey: `P14-BOUNDARY-HISTORY-${String(index).padStart(3, '0')}`,
      requestFingerprint: crypto.createHash('sha256').update(`history-${index}`).digest('hex'),
      status: 'PENDING',
      actorId: 'USR-PM'
    }));
    await context.db.document.createMany({ data: Array.from({ length: 121 }, (_, index) => ({
      id: `DOC-BOUNDARY-${String(index).padStart(3, '0')}`,
      caseId: context.caseId,
      title: `Synthetic boundary document ${index}`,
      source: 'RECEIVED'
    })) });
    await context.db.documentVersion.createMany({ data: Array.from({ length: 121 }, (_, index) => ({
      id: `DOCVER-BOUNDARY-${index}`,
      documentId: `DOC-BOUNDARY-${String(index).padStart(3, '0')}`,
      versionNumber: 1,
      originalName: `boundary-${index}.txt`,
      displayName: `boundary-${index}.txt`,
      storageKey: `p14-boundary-${index}.txt`,
      fileSize: 1,
      mimeType: 'text/plain',
      sha256: crypto.createHash('sha256').update(`boundary-${index}`).digest('hex'),
      uploadedById: 'USR-PM'
    })) });
    for (const [index, operation] of boundaryOperations.entries()) {
      await context.db.$transaction(async (tx) => {
        await tx.googleSyncOperation.create({ data: operation });
        await tx.googleImportSnapshot.create({ data: {
          id: `GSNAP-BOUNDARY-${String(index).padStart(3, '0')}`,
          organizationId: 'ORG-SYN-A', caseId: context.caseId, operationId: operation.id,
          sourceType: 'GMAIL_ATTACHMENT', externalResourceId: `EXT-BOUNDARY-${index}`,
          sha256: crypto.createHash('sha256').update(`boundary-${index}`).digest('hex'),
          provenanceJson: JSON.stringify({ attachmentId: `EXT-BOUNDARY-${index}`, documentVersionId: `DOCVER-BOUNDARY-${index}` }),
          createdById: 'USR-PM'
        } });
        await tx.googleResourceLink.create({ data: {
          id: `GRLINK-BOUNDARY-${String(index).padStart(3, '0')}`,
          organizationId: 'ORG-SYN-A', caseId: context.caseId, entityType: 'GMAIL_ATTACHMENT',
          operationId: operation.id, internalEntityId: `DOCVER-BOUNDARY-${index}`,
          externalResourceId: `EXT-BOUNDARY-${index}`,
          resourceMetadataJson: JSON.stringify({
            name: index === 120 ? 'E2E-BOUNDARY' : `Resource ${index}`,
            provenance: `synthetic-${index}`,
            documentVersionId: `DOCVER-BOUNDARY-${index}`
          })
        } });
        await tx.googleSyncOperation.update({ where: { id: operation.id }, data: {
          status: 'SUCCESS',
          resultJson: JSON.stringify({ httpStatus: 201, body: { syntheticBoundary: index } }),
          completedAt: new Date()
        } });
      });
    }
    const bounded = await requestJson(context.origin, `/api/cases/${context.caseId}/google/workspace?resourceLimit=200`, 'GET', undefined, context.pmSession);
    assert.equal(bounded.status, 200);
    assert.equal(bounded.body.resources.length, 121);
    assert.equal(bounded.body.history.length, 100);
    assert.equal(JSON.stringify(bounded.body.resources).includes('resourceMetadataJson'), false);
    const searched = await requestJson(context.origin, `/api/cases/${context.caseId}/google/workspace?resourceLimit=200&resourceQuery=E2E-BOUNDARY`, 'GET', undefined, context.pmSession);
    assert.equal(searched.status, 200);
    assert.equal(searched.body.resources.length, 1);
    assert.equal(searched.body.resources[0].name, 'E2E-BOUNDARY');
    assert.equal(searched.body.resources[0].provenance, 'synthetic-120');
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/workspace?resourceLimit=201`, 'GET', undefined, context.pmSession)).status, 400);
    assert.equal((await requestJson(context.origin, `/api/cases/${context.caseId}/google/workspace?resourceQuery=${'x'.repeat(101)}`, 'GET', undefined, context.pmSession)).status, 400);
  });
});

const originalP14Migration = '20260810140000_p14_google_workspace_integration';
const correctiveP14Migration = '20260810141000_p14_google_workspace_invariants';
const originalP14CanonicalSha256 = '9c9472b0ebb569e164c430644cd58acb8d07ac329af10b1411cb4fb8ce702324';

type LegacyInvalidMode = 'NONE' | 'CROSS_SCOPE' | 'NULL_OPERATION' | 'PENDING_OPERATION';

async function createPopulatedLegacyDatabase(filePath: string, invalidMode: LegacyInvalidMode): Promise<void> {
  const SQL = await initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  const sqlite = new SQL.Database();
  try {
    sqlite.run('PRAGMA foreign_keys = ON');
    sqlite.run('CREATE TABLE IF NOT EXISTS "_P04Migration" ("name" TEXT NOT NULL PRIMARY KEY, "checksum" TEXT NOT NULL, "appliedAt" TEXT NOT NULL)');
    const migrationsDir = path.join(root, 'packages/database/prisma/migrations');
    const migrations = fs.readdirSync(migrationsDir).filter((name) => name <= originalP14Migration && fs.existsSync(path.join(migrationsDir, name, 'migration.sql'))).sort();
    for (const name of migrations) {
      const sql = fs.readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8');
      sqlite.run(sql);
      sqlite.run('INSERT INTO "_P04Migration"("name","checksum","appliedAt") VALUES (?,?,?)', [
        name, crypto.createHash('sha256').update(sql).digest('hex'), new Date().toISOString()
      ]);
    }
    const now = Date.now();
    for (const [id, name] of [['ORG-LEGACY-A', 'Legacy A'], ['ORG-LEGACY-B', 'Legacy B']]) {
      sqlite.run('INSERT INTO "Organization"("id","name","createdAt","updatedAt") VALUES (?,?,?,?)', [id, name, now, now]);
    }
    sqlite.run('INSERT INTO "User"("id","email","passwordHash","name","organizationId","isActive","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)', ['USR-LEGACY-A', 'legacy-a@example.invalid', 'hash', 'Legacy A', 'ORG-LEGACY-A', 1, now, now]);
    sqlite.run('INSERT INTO "User"("id","email","passwordHash","name","organizationId","isActive","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)', ['USR-LEGACY-B', 'legacy-b@example.invalid', 'hash', 'Legacy B', 'ORG-LEGACY-B', 1, now, now]);
    sqlite.run('INSERT INTO "Role"("id","name") VALUES (?,?)', ['pm', 'pm']);
    sqlite.run('INSERT INTO "Role"("id","name") VALUES (?,?)', ['admin', 'admin']);
    sqlite.run('INSERT INTO "UserRole"("userId","roleId") VALUES (?,?)', ['USR-LEGACY-A', 'pm']);
    sqlite.run('INSERT INTO "UserRole"("userId","roleId") VALUES (?,?)', ['USR-LEGACY-A', 'admin']);
    sqlite.run('INSERT INTO "CaseItem"("id","organizationId","caseNumber","title","description","claimType","status","assignedUserId","version","deletedAt","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', ['CASE-LEGACY-A', 'ORG-LEGACY-A', 'LEGACY-A-001', 'Legacy populated case', 'synthetic', 'TYPE-01', 'INQUIRY', 'USR-LEGACY-A', 1, null, now, now]);
    sqlite.run('INSERT INTO "CaseAssignment"("caseId","userId") VALUES (?,?)', ['CASE-LEGACY-A', 'USR-LEGACY-A']);
    sqlite.run('INSERT INTO "GoogleWorkspaceConnection"("id","organizationId","status","grantedScopesJson","secretRef","tokenExpiresAt","lastSyncedAt","createdById","version","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?)', [
      'GCONN-LEGACY-A', 'ORG-LEGACY-A', 'CONNECTED', JSON.stringify(requiredScopes), 'sec-ref-google-valid', now + 3_600_000, now, 'USR-LEGACY-A', 2, now, now
    ]);
    sqlite.run('INSERT INTO "GoogleOAuthState"("id","stateHash","pkceVerifierRef","organizationId","actorId","redirectTarget","expiresAt","usedAt","createdAt") VALUES (?,?,?,?,?,?,?,?,?)', [
      'GOAUTH-LEGACY-A', 'a'.repeat(64), 'legacy-verifier-ref', 'ORG-LEGACY-A', 'USR-LEGACY-A', '/integrations/google', now + 600_000, null, now
    ]);
    sqlite.run('INSERT INTO "GoogleSyncOperation"("id","organizationId","caseId","operationKind","idempotencyKey","requestFingerprint","status","actorId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?)', [
      'GSYNC-LEGACY-A', 'ORG-LEGACY-A', 'CASE-LEGACY-A', 'DRIVE_FOLDER', 'LEGACY-OP-0001', 'b'.repeat(64), invalidMode === 'PENDING_OPERATION' ? 'PENDING' : 'SUCCESS', 'USR-LEGACY-A', now, now
    ]);
    sqlite.run('INSERT INTO "GoogleSyncAttempt"("id","operationId","attemptNumber","responseClass","redactedError","retryAt","durationMs","createdAt") VALUES (?,?,?,?,?,?,?,?)', [
      'GATT-LEGACY-A', 'GSYNC-LEGACY-A', 1, 'SUCCESS', null, null, 5, now
    ]);
    sqlite.run('INSERT INTO "GoogleSyncOperation"("id","organizationId","caseId","operationKind","idempotencyKey","requestFingerprint","status","actorId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?)', [
      'GSYNC-LEGACY-GMAIL-A', 'ORG-LEGACY-A', 'CASE-LEGACY-A', 'GMAIL_IMPORT', 'LEGACY-GMAIL-OP-0001', 'd'.repeat(64), 'SUCCESS', 'USR-LEGACY-A', now, now
    ]);
    sqlite.run('INSERT INTO "GoogleSyncAttempt"("id","operationId","attemptNumber","responseClass","redactedError","retryAt","durationMs","createdAt") VALUES (?,?,?,?,?,?,?,?)', [
      'GATT-LEGACY-GMAIL-A', 'GSYNC-LEGACY-GMAIL-A', 1, 'SUCCESS', null, null, 5, now
    ]);
    sqlite.run('INSERT INTO "Document"("id","caseId","title","source","currentVersionId","version","deletedAt","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)', [
      'DOC-LEGACY-GMAIL-A', 'CASE-LEGACY-A', 'Legacy Gmail attachment', 'RECEIVED', 'DOCVER-LEGACY-GMAIL-A', 1, null, now, now
    ]);
    sqlite.run('INSERT INTO "DocumentVersion"("id","documentId","versionNumber","originalName","displayName","storageKey","fileSize","mimeType","sha256","isFinal","uploadedById","createdAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [
      'DOCVER-LEGACY-GMAIL-A', 'DOC-LEGACY-GMAIL-A', 1, 'legacy.txt', 'legacy.txt', 'legacy-google-attachment-a.txt', 1, 'text/plain', 'c'.repeat(64), 0, 'USR-LEGACY-A', now
    ]);
    sqlite.run('INSERT INTO "GoogleResourceLink"("id","organizationId","caseId","operationId","entityType","internalEntityId","externalResourceId","resourceMetadataJson","createdAt") VALUES (?,?,?,?,?,?,?,?,?)', [
      'GRLINK-LEGACY-A', invalidMode === 'CROSS_SCOPE' ? 'ORG-LEGACY-B' : 'ORG-LEGACY-A', 'CASE-LEGACY-A', invalidMode === 'NULL_OPERATION' ? null : 'GSYNC-LEGACY-A', 'CASE_DRIVE_FOLDER', 'CASE-LEGACY-A', 'folder-legacy-a', '{}', now
    ]);
    sqlite.run('INSERT INTO "GoogleResourceLink"("id","organizationId","caseId","operationId","entityType","internalEntityId","externalResourceId","resourceMetadataJson","createdAt") VALUES (?,?,?,?,?,?,?,?,?)', [
      'GRLINK-LEGACY-GMAIL-A', 'ORG-LEGACY-A', 'CASE-LEGACY-A', 'GSYNC-LEGACY-GMAIL-A', 'GMAIL_ATTACHMENT', 'DOCVER-LEGACY-GMAIL-A', 'legacy-att-a', JSON.stringify({ documentVersionId: 'DOCVER-LEGACY-GMAIL-A' }), now
    ]);
    sqlite.run('INSERT INTO "GoogleImportSnapshot"("id","organizationId","caseId","operationId","sourceType","externalResourceId","sha256","version","provenanceJson","createdById","createdAt") VALUES (?,?,?,?,?,?,?,?,?,?,?)', [
      'GSNAP-LEGACY-A', 'ORG-LEGACY-A', 'CASE-LEGACY-A', 'GSYNC-LEGACY-GMAIL-A', 'GMAIL_ATTACHMENT', 'legacy-att-a', 'c'.repeat(64), 1,
      JSON.stringify({ attachmentId: 'legacy-att-a', documentVersionId: 'DOCVER-LEGACY-GMAIL-A' }), 'USR-LEGACY-A', now
    ]);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(sqlite.export()));
  } finally {
    sqlite.close();
  }
}

test('P14-SEC-18 corrective migration preserves original migration, upgrades valid populated DB, and fully rolls back invalid cross-scope DB', async () => {
  const originalPath = path.join(root, 'packages/database/prisma/migrations', originalP14Migration, 'migration.sql');
  const canonical = fs.readFileSync(originalPath, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(crypto.createHash('sha256').update(canonical).digest('hex'), originalP14CanonicalSha256);

  const unique = `${process.pid}-${Date.now()}`;
  const validPath = path.join(root, 'packages/database/.data', `p14-valid-upgrade-${unique}.db`);
  const invalidPath = path.join(root, 'packages/database/.data', `p14-invalid-upgrade-${unique}.db`);
  const invalidNullOperationPath = path.join(root, 'packages/database/.data', `p14-invalid-null-operation-${unique}.db`);
  const invalidPendingOperationPath = path.join(root, 'packages/database/.data', `p14-invalid-pending-operation-${unique}.db`);
  try {
    await createPopulatedLegacyDatabase(validPath, 'NONE');
    await createPopulatedLegacyDatabase(invalidPath, 'CROSS_SCOPE');
    await createPopulatedLegacyDatabase(invalidNullOperationPath, 'NULL_OPERATION');
    await createPopulatedLegacyDatabase(invalidPendingOperationPath, 'PENDING_OPERATION');
    await migrateDatabase(`file:${validPath}`);
    const upgraded = createPrismaClient(`file:${validPath}`);
    try {
      const connection = await upgraded.googleWorkspaceConnection.findUniqueOrThrow({ where: { id: 'GCONN-LEGACY-A' } });
      assert.match(connection.secretRef, /^SECREF_GOOGLE_LEGACY_/);
      const oauth = await upgraded.googleOAuthState.findUniqueOrThrow({ where: { id: 'GOAUTH-LEGACY-A' } });
      assert.equal(oauth.pkceChallenge.length, 43);
      assert.equal(oauth.connectionVersion, 2);
      assert.ok(oauth.usedAt);
      const operation = await upgraded.googleSyncOperation.findUniqueOrThrow({ where: { id: 'GSYNC-LEGACY-A' } });
      assert.ok(operation.resultJson);
      assert.ok(operation.completedAt);
    } finally {
      await upgraded.$disconnect();
    }

    await assert.rejects(() => migrateDatabase(`file:${invalidPath}`), /CHECK constraint failed|constraint failed/i);
    await assert.rejects(() => migrateDatabase(`file:${invalidNullOperationPath}`), /CHECK constraint failed|constraint failed/i);
    await assert.rejects(() => migrateDatabase(`file:${invalidPendingOperationPath}`), /CHECK constraint failed|constraint failed/i);
    const SQL = await initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
    const invalid = new SQL.Database(fs.readFileSync(invalidPath));
    try {
      const columns = invalid.exec(`PRAGMA table_info('GoogleOAuthState')`)[0].values.map((row) => String(row[1]));
      assert.equal(columns.includes('pkceChallenge'), false);
      const marker = invalid.exec(`SELECT count(*) FROM "_P04Migration" WHERE "name" = '${correctiveP14Migration}'`)[0].values[0][0];
      assert.equal(Number(marker), 0);
      const originalStillCrossScoped = invalid.exec(`SELECT "organizationId" FROM "GoogleResourceLink" WHERE "id" = 'GRLINK-LEGACY-A'`)[0].values[0][0];
      assert.equal(String(originalStillCrossScoped), 'ORG-LEGACY-B');
    } finally {
      invalid.close();
    }
  } finally {
    for (const filePath of [validPath, invalidPath, invalidNullOperationPath, invalidPendingOperationPath]) fs.rmSync(filePath, { force: true });
  }
});
