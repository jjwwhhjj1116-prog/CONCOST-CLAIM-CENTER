import * as assert from 'node:assert/strict';
import * as nodeCrypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  EncryptedFileGoogleCredentialProvider,
  MemoryGoogleCredentialProvider,
  type GoogleOAuthCredential
} from '../apps/api/src/google-workspace/GoogleCredentialProvider';
import {
  GoogleWorkspaceRealAdapter,
  type GoogleHttpRequest,
  type GoogleHttpResponse,
  type GoogleHttpTransport
} from '../apps/api/src/google-workspace/GoogleWorkspaceRealAdapter';
import { REQUIRED_GOOGLE_SCOPES } from '../apps/api/src/google-workspace/GoogleWorkspaceAdapter';
import { createGoogleWorkspaceAdapterFactoryFromEnvironment } from '../apps/api/src/server';
import { requestJson, startP14Isolated } from './p14-test-support';

const NOW = new Date('2026-08-10T00:00:00.000Z');
const ACCESS_TOKEN = 'ya29.synthetic-access-token-never-returned';
const REFRESH_TOKEN = '1//synthetic-refresh-token-never-returned';
const CLIENT_SECRET = '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r-returned';
const PKCE = 'A'.repeat(64);
const DEFAULT_ORGANIZATION_ID = 'ORG-SYN-A';

function json(status: number, value: unknown, headers: Record<string, string> = {}): GoogleHttpResponse {
  return { status, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) };
}

async function credentialProvider(
  expiresAt = new Date(NOW.getTime() + 3_600_000),
  organizationId = DEFAULT_ORGANIZATION_ID
): Promise<{
  provider: MemoryGoogleCredentialProvider;
  secretRef: string;
}> {
  const provider = new MemoryGoogleCredentialProvider();
  const credential: GoogleOAuthCredential = {
    accessToken: ACCESS_TOKEN,
    refreshToken: REFRESH_TOKEN,
    expiresAt,
    grantedScopes: [...REQUIRED_GOOGLE_SCOPES],
    tokenType: 'Bearer'
  };
  const secretRef = await provider.createCredential(organizationId, credential);
  return { provider, secretRef };
}

function adapterOptions(
  provider: MemoryGoogleCredentialProvider,
  transport: GoogleHttpTransport,
  defaultSecretRef?: string,
  organizationId = DEFAULT_ORGANIZATION_ID
) {
  return {
    credentialProvider: provider,
    organizationId,
    clientId: 'claim-center.apps.googleusercontent.com',
    clientSecret: CLIENT_SECRET,
    redirectUri: 'https://claim-center.invalid/google/callback',
    defaultSecretRef,
    transport,
    now: () => new Date(NOW)
  };
}

test('P14-REAL-01 exchanges PKCE code into opaque SECREF without API or snapshot secret disclosure', async () => {
  const provider = new MemoryGoogleCredentialProvider();
  const requests: GoogleHttpRequest[] = [];
  const transport: GoogleHttpTransport = async (request) => {
    requests.push(request);
    return json(200, {
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_in: 3600,
      token_type: 'Bearer',
      scope: REQUIRED_GOOGLE_SCOPES.join(' '),
      raw_debug_secret: 'must-not-escape'
    });
  };
  const adapter = new GoogleWorkspaceRealAdapter(adapterOptions(provider, transport));
  const authorizationUrl = new URL(adapter.createAuthorizationUrl({
    state: 'state-for-real-adapter-contract',
    codeChallenge: PKCE,
    scopes: REQUIRED_GOOGLE_SCOPES
  }));
  assert.equal(authorizationUrl.origin, 'https://accounts.google.com');
  assert.equal(authorizationUrl.searchParams.get('client_id'), 'claim-center.apps.googleusercontent.com');
  assert.equal(authorizationUrl.searchParams.get('redirect_uri'), 'https://claim-center.invalid/google/callback');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorizationUrl.searchParams.get('state'), 'state-for-real-adapter-contract');
  const result = await adapter.exchangeAuthorizationCode('authorization-code', PKCE);

  assert.equal(result.responseClass, 'SUCCESS');
  assert.ok(result.data);
  assert.match(result.data.secretRef, /^SECREF_GOOGLE_[A-Z0-9_-]{16,120}$/);
  assert.deepEqual([...result.data.grantedScopes].sort(), [...REQUIRED_GOOGLE_SCOPES].sort());
  assert.equal(requests.length, 1);
  const requestUrl = new URL(requests[0].url);
  assert.equal(requestUrl.hostname, 'oauth2.googleapis.com');
  assert.equal(requestUrl.pathname, '/token');
  assert.equal(requests[0].method, 'POST');
  const form = new URLSearchParams(requests[0].body);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('code_verifier'), PKCE);
  assert.equal(form.get('client_secret'), CLIENT_SECRET);
  assert.equal(form.get('redirect_uri'), 'https://claim-center.invalid/google/callback');

  const publicText = JSON.stringify({ result, adapter, vault: provider.getRedactedSnapshot() });
  for (const secret of [ACCESS_TOKEN, REFRESH_TOKEN, CLIENT_SECRET, 'must-not-escape']) {
    assert.equal(publicText.includes(secret), false);
  }
  const stored = await provider.resolveCredential(DEFAULT_ORGANIZATION_ID, result.data.secretRef);
  assert.equal(stored?.accessToken, ACCESS_TOKEN);
  assert.equal(stored?.refreshToken, REFRESH_TOKEN);
});

test('P14-REAL-02 refreshes an expiring token and uses the rotated bearer credential', async () => {
  const { provider, secretRef } = await credentialProvider(new Date(NOW.getTime() + 30_000));
  const requests: GoogleHttpRequest[] = [];
  const transport: GoogleHttpTransport = async (request) => {
    requests.push(request);
    if (new URL(request.url).pathname === '/token') {
      return json(200, {
        access_token: 'ya29.rotated-access-token',
        expires_in: 7200,
        token_type: 'Bearer',
        scope: REQUIRED_GOOGLE_SCOPES.join(' ')
      });
    }
    return json(200, { user: { permissionId: 'permission-1' }, ignoredSecret: ACCESS_TOKEN });
  };
  const adapter = new GoogleWorkspaceRealAdapter(adapterOptions(provider, transport, secretRef));
  const result = await adapter.testConnection({
    organizationId: 'ORG-SYN-001',
    status: 'CONNECTED',
    grantedScopes: [...REQUIRED_GOOGLE_SCOPES],
    secretRef,
    tokenExpiresAt: new Date(NOW.getTime() + 30_000)
  });

  assert.deepEqual(result.data, { ok: true });
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[0].url).hostname, 'oauth2.googleapis.com');
  assert.equal(new URL(requests[1].url).pathname, '/drive/v3/about');
  assert.equal(requests[1].headers.Authorization, 'Bearer ya29.rotated-access-token');
  const refreshForm = new URLSearchParams(requests[0].body);
  assert.equal(refreshForm.get('grant_type'), 'refresh_token');
  assert.equal(refreshForm.get('refresh_token'), REFRESH_TOKEN);
  assert.equal((await provider.resolveCredential(DEFAULT_ORGANIZATION_ID, secretRef))?.accessToken, 'ya29.rotated-access-token');
  assert.equal(JSON.stringify(result).includes(ACCESS_TOKEN), false);
});

test('P14-REAL-03 rejects non-Google and cross-host redirect hops before credential forwarding', async () => {
  assert.throws(() => new GoogleWorkspaceRealAdapter({
    ...adapterOptions(new MemoryGoogleCredentialProvider(), async () => json(200, {})),
    redirectUri: 'https://attacker.invalid/google/callback'
  }), /redirect URI is not allowed/);
  assert.throws(() => new GoogleWorkspaceRealAdapter({
    ...adapterOptions(new MemoryGoogleCredentialProvider(), async () => json(200, {})),
    redirectUri: 'https://claim-center.invalid/google/callback?next=https://attacker.invalid'
  }), /redirect URI is not allowed/);
  const provider = new MemoryGoogleCredentialProvider();
  const attempted: string[] = [];
  const transport: GoogleHttpTransport = async (request) => {
    attempted.push(request.url);
    return { status: 302, headers: { location: 'https://attacker.invalid/token-capture' }, body: '' };
  };
  const adapter = new GoogleWorkspaceRealAdapter(adapterOptions(provider, transport));
  const result = await adapter.exchangeAuthorizationCode('authorization-code', PKCE);
  assert.equal(result.responseClass, 'MALFORMED_PROVIDER_RESPONSE');
  assert.equal(attempted.length, 1);
  assert.equal(result.redactedError, 'Google Workspace returned an invalid response');
  assert.equal(JSON.stringify(result).includes('attacker.invalid'), false);

  const { provider: connectedProvider, secretRef } = await credentialProvider();
  const crossHostTransport: GoogleHttpTransport = async () => ({
    status: 307,
    headers: { location: 'https://gmail.googleapis.com/credential-capture' },
    body: ''
  });
  const connected = new GoogleWorkspaceRealAdapter(adapterOptions(connectedProvider, crossHostTransport, secretRef));
  const health = await connected.testConnection({
    organizationId: 'ORG-SYN-001', status: 'CONNECTED', grantedScopes: [...REQUIRED_GOOGLE_SCOPES], secretRef, tokenExpiresAt: null
  });
  assert.equal(health.responseClass, 'MALFORMED_PROVIDER_RESPONSE');
});

test('P14-REAL-04 calls fixed Drive, Gmail, Calendar, Docs, and Sheets REST routes and canonicalizes outputs', async () => {
  const { provider, secretRef } = await credentialProvider();
  const requests: GoogleHttpRequest[] = [];
  const attachmentBytes = Buffer.from('synthetic attachment bytes', 'utf8');
  const transport: GoogleHttpTransport = async (request) => {
    requests.push(request);
    assert.equal(request.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
    const url = new URL(request.url);

    if (url.hostname === 'www.googleapis.com' && url.pathname === '/drive/v3/files') {
      if ((url.searchParams.get('q') ?? '').includes('spreadsheet')) {
        return json(200, { files: [{ id: 'sheet-001', name: 'Case cost sheet', rawToken: ACCESS_TOKEN }] });
      }
      if (request.method === 'POST') return json(200, { id: 'folder-001', name: '[사건] Synthetic case', rawToken: ACCESS_TOKEN });
      return json(200, { files: [], rawToken: ACCESS_TOKEN });
    }
    if (url.hostname === 'gmail.googleapis.com' && url.pathname.endsWith('/messages')) {
      return json(200, { messages: [{ id: 'message-001', threadId: 'ignored' }], rawToken: ACCESS_TOKEN });
    }
    if (url.hostname === 'gmail.googleapis.com' && url.pathname.endsWith('/attachments/attachment-001')) {
      return json(200, { data: attachmentBytes.toString('base64url'), size: attachmentBytes.length, rawToken: ACCESS_TOKEN });
    }
    if (url.hostname === 'gmail.googleapis.com' && url.pathname.endsWith('/messages/message-001')) {
      return json(200, {
        payload: {
          parts: [{
            filename: 'evidence.txt', mimeType: 'text/plain',
            body: { attachmentId: 'attachment-001', size: attachmentBytes.length }
          }]
        },
        rawToken: ACCESS_TOKEN
      });
    }
    if (url.hostname === 'calendar.googleapis.com') {
      const sent = JSON.parse(request.body ?? '{}') as {
        id?: string; summary?: string; start?: { dateTime?: string }; end?: { dateTime?: string };
      };
      return json(200, {
        id: sent.id, summary: sent.summary, start: sent.start, end: sent.end,
        htmlLink: `https://unsafe.invalid/${ACCESS_TOKEN}`
      });
    }
    if (url.hostname === 'docs.googleapis.com' && url.pathname === '/v1/documents') {
      return json(200, { documentId: 'document-001', rawToken: ACCESS_TOKEN });
    }
    if (url.hostname === 'docs.googleapis.com' && url.pathname.endsWith(':batchUpdate')) {
      return json(200, { replies: [], rawToken: ACCESS_TOKEN });
    }
    if (url.hostname === 'sheets.googleapis.com' && url.pathname.endsWith('/spreadsheets/sheet-001')) {
      return json(200, {
        sheets: [{ properties: { title: 'Costs', gridProperties: { rowCount: 100, columnCount: 3 } } }],
        rawToken: ACCESS_TOKEN
      });
    }
    if (url.hostname === 'sheets.googleapis.com' && url.pathname.includes('/values/')) {
      return json(200, {
        range: 'Costs!A1:B2', majorDimension: 'ROWS',
        values: [['Item', 'Amount'], ['Concrete', 125000]], rawToken: ACCESS_TOKEN
      });
    }
    throw new Error(`Unexpected request ${request.method} ${request.url}`);
  };
  const adapter = new GoogleWorkspaceRealAdapter(adapterOptions(provider, transport, secretRef));

  const drive = await adapter.createDriveFolder('CASE-SYN-001', 'Synthetic case', 'IDEMP-DRIVE-001');
  assert.deepEqual(drive.data, {
    folderId: 'folder-001', folderName: '[사건] Synthetic case',
    webViewLink: 'https://drive.google.com/drive/folders/folder-001', isExisting: false
  });
  const gmailCandidates = await adapter.listGmailAttachments('CASE-SYN-001');
  assert.deepEqual(gmailCandidates.data, [{
    attachmentId: 'message-001:attachment-001', filename: 'evidence.txt', mimeType: 'text/plain', sizeBytes: attachmentBytes.length
  }]);
  const gmail = await adapter.importGmailAttachments('CASE-SYN-001', ['message-001:attachment-001']);
  assert.equal(gmail.data?.importedCount, 1);
  assert.equal(gmail.data?.items[0].contentBase64, attachmentBytes.toString('base64'));
  assert.match(gmail.data?.items[0].sha256 ?? '', /^[0-9a-f]{64}$/);

  const calendar = await adapter.createCalendarEvent('CASE-SYN-001', {
    summary: 'Site inspection', description: 'Synthetic calendar test',
    startDateTime: '2026-08-11T01:00:00.000Z', endDateTime: '2026-08-11T02:00:00.000Z', humanConfirmed: true
  }, 'IDEMP-CALENDAR-001');
  assert.equal(calendar.data?.summary, 'Site inspection');
  assert.match(calendar.data?.htmlLink ?? '', /^https:\/\/calendar\.google\.com\//);

  const docs = await adapter.exportDocs('CASE-SYN-001', 'MEET-SYN-001', 3, 'Final meeting', 'Approved content', 'IDEMP-DOCS-001');
  assert.deepEqual(docs.data, {
    documentId: 'document-001', title: 'Final meeting',
    webViewLink: 'https://docs.google.com/document/d/document-001', version: 3
  });

  const sheetSources = await adapter.listSheetSources('CASE-SYN-001');
  assert.deepEqual(sheetSources.data, [{
    spreadsheetId: 'sheet-001', sheetName: 'Costs', allowedRange: 'A1:C100', displayName: 'Case cost sheet'
  }]);
  const sheets = await adapter.importSheets('CASE-SYN-001', { spreadsheetId: 'sheet-001', sheetName: 'Costs', rangeA1: 'A1:B10' });
  assert.equal(sheets.data?.rowCount, 1);
  assert.equal(sheets.data?.columnCount, 2);
  assert.deepEqual(JSON.parse(sheets.data?.valuesJson ?? '{}'), {
    spreadsheetId: 'sheet-001', sheetName: 'Costs', range: 'A1:B10', headers: ['Item', 'Amount'], rows: [['Concrete', 125000]]
  });

  const calendarRequest = requests.find((request) => new URL(request.url).hostname === 'calendar.googleapis.com');
  assert.equal(calendarRequest?.method, 'POST');
  assert.equal(calendarRequest?.headers['X-Claim-Center-Idempotency-Key'], 'IDEMP-CALENDAR-001');
  const docsBatchRequest = requests.find((request) => new URL(request.url).pathname.endsWith(':batchUpdate'));
  assert.deepEqual(JSON.parse(docsBatchRequest?.body ?? '{}'), {
    requests: [{ insertText: { location: { index: 1 }, text: 'Approved content' } }]
  });
  const publicText = JSON.stringify({ drive, gmailCandidates, gmail, calendar, docs, sheetSources, sheets });
  assert.equal(publicText.includes(ACCESS_TOKEN), false);
  assert.equal(publicText.includes(REFRESH_TOKEN), false);
});

test('P14-REAL-05 redacts provider failures and revokes stored refresh credentials', async () => {
  const { provider, secretRef } = await credentialProvider();
  let mode: 'fail' | 'revoke' = 'fail';
  const requests: GoogleHttpRequest[] = [];
  const transport: GoogleHttpTransport = async (request) => {
    requests.push(request);
    if (mode === 'fail') return json(500, { error: `backend leaked ${ACCESS_TOKEN} ${REFRESH_TOKEN}` });
    return { status: 200, headers: {}, body: '' };
  };
  const adapter = new GoogleWorkspaceRealAdapter(adapterOptions(provider, transport, secretRef));
  const failed = await adapter.listGmailAttachments('CASE-SYN-001');
  assert.equal(failed.responseClass, 'SERVER_ERROR');
  assert.equal(failed.redactedError, 'Google Workspace service is temporarily unavailable');
  assert.equal(JSON.stringify(failed).includes(ACCESS_TOKEN), false);
  assert.equal(JSON.stringify(failed).includes(REFRESH_TOKEN), false);

  mode = 'revoke';
  const revoked = await adapter.revokeConnection(secretRef);
  assert.deepEqual(revoked.data, { revoked: true });
  const revokeRequest = requests.at(-1);
  assert.equal(new URL(revokeRequest?.url ?? '').pathname, '/revoke');
  assert.equal(new URLSearchParams(revokeRequest?.body).get('token'), REFRESH_TOKEN);
  assert.ok(await provider.resolveCredential(DEFAULT_ORGANIZATION_ID, secretRef));
  await adapter.discardCredentialReference(secretRef);
  assert.equal(await provider.resolveCredential(DEFAULT_ORGANIZATION_ID, secretRef), null);
  assert.equal(JSON.stringify(revoked).includes(REFRESH_TOKEN), false);
});

test('P14-REAL-06 server uses an injected real adapter and fails closed instead of silently selecting fake', async () => {
  const provider = new MemoryGoogleCredentialProvider();
  const transport: GoogleHttpTransport = async (request) => {
    if (new URL(request.url).pathname !== '/token') throw new Error('Unexpected provider route');
    return json(200, {
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_in: 3600,
      token_type: 'Bearer',
      scope: REQUIRED_GOOGLE_SCOPES.join(' ')
    });
  };
  const context = await startP14Isolated('p14-real-server', {
    allowTestGoogleModes: false,
    googleWorkspaceAdapterFactory: (organizationId) => new GoogleWorkspaceRealAdapter(
      adapterOptions(provider, transport, undefined, organizationId)
    )
  });
  try {
    const initiated = await requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', {
      redirectTarget: '/integrations/google', expectedVersion: null
    }, context.adminSession);
    assert.equal(initiated.status, 201);
    const authorizationUrl = new URL(initiated.body.authorizationUrl);
    assert.equal(authorizationUrl.origin, 'https://accounts.google.com');
    assert.equal(authorizationUrl.searchParams.get('state'), initiated.body.state);
    assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');

    const connected = await requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
      state: initiated.body.state,
      code: 'authorization-code'
    }, context.adminSession);
    assert.equal(connected.status, 200);
    assert.equal(JSON.stringify(connected.body).includes(ACCESS_TOKEN), false);
    assert.equal(JSON.stringify(connected.body).includes(REFRESH_TOKEN), false);
    assert.equal('secretRef' in connected.body.connection, false);
    const admin = await context.db.user.findUniqueOrThrow({ where: { email: 'admin@example.invalid' } });
    const stored = await context.db.googleWorkspaceConnection.findUniqueOrThrow({ where: { organizationId: admin.organizationId } });
    assert.match(stored.secretRef, /^SECREF_GOOGLE_[A-Z0-9_-]{16,120}$/);
    assert.ok(await provider.resolveCredential(admin.organizationId, stored.secretRef));
  } finally {
    await context.cleanup();
  }
});

test('P14-REAL-07 server without an injected provider returns 503 and never starts fake OAuth', async () => {
  const context = await startP14Isolated('p14-provider-missing', { allowTestGoogleModes: false });
  try {
    const response = await requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', {
      redirectTarget: '/integrations/google', expectedVersion: null
    }, context.adminSession);
    assert.equal(response.status, 503);
    assert.match(response.body.error, /provider is not configured/i);
    assert.equal(await context.db.googleOAuthState.count(), 0);
  } finally {
    await context.cleanup();
  }
});

test('P14-REAL-08 OAuth persistence rollback discards newly exchanged credential material', async () => {
  const provider = new MemoryGoogleCredentialProvider();
  const transport: GoogleHttpTransport = async () => json(200, {
    access_token: ACCESS_TOKEN,
    refresh_token: REFRESH_TOKEN,
    expires_in: 3600,
    token_type: 'Bearer',
    scope: REQUIRED_GOOGLE_SCOPES.join(' ')
  });
  const context = await startP14Isolated('p14-real-rollback', {
    allowTestGoogleModes: false,
    googleWorkspaceAdapterFactory: (organizationId) => new GoogleWorkspaceRealAdapter(
      adapterOptions(provider, transport, undefined, organizationId)
    )
  });
  try {
    const initiated = await requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', {
      redirectTarget: '/integrations/google', expectedVersion: null
    }, context.adminSession);
    assert.equal(initiated.status, 201);
    await context.db.$executeRawUnsafe(`
      CREATE TRIGGER p14_real_force_connected_audit_failure
      BEFORE INSERT ON AuditLog
      WHEN NEW.action = 'GOOGLE_WORKSPACE_CONNECTED'
      BEGIN SELECT RAISE(ABORT, 'synthetic connected audit failure'); END;
    `);
    const failed = await requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
      state: initiated.body.state,
      code: 'authorization-code'
    }, context.adminSession);
    assert.equal(failed.status, 500);
    assert.equal(provider.getRedactedSnapshot().length, 0);
    assert.equal(await context.db.googleWorkspaceConnection.count(), 0);
    const state = await context.db.googleOAuthState.findUniqueOrThrow({ where: { stateHash: nodeCrypto.createHash('sha256').update(initiated.body.state).digest('hex') } });
    assert.equal(state.usedAt, null);
  } finally {
    await context.cleanup();
  }
});

test('P14-REAL-09 production callback rejects incomplete OAuth success data without fake fallback', async () => {
  const provider = new MemoryGoogleCredentialProvider();
  const context = await startP14Isolated('p14-real-invalid-exchange', {
    allowTestGoogleModes: false,
    googleWorkspaceAdapterFactory: (organizationId) => {
      const adapter = new GoogleWorkspaceRealAdapter(adapterOptions(
        provider,
        async () => json(200, {}),
        undefined,
        organizationId
      ));
      (adapter as any).exchangeAuthorizationCode = async () => ({
        responseClass: 'SUCCESS',
        data: { grantedScopes: [...REQUIRED_GOOGLE_SCOPES], expiresInSeconds: 3600 },
        durationMs: 0
      });
      return adapter;
    }
  });
  try {
    const initiated = await requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', {
      redirectTarget: '/integrations/google', expectedVersion: null
    }, context.adminSession);
    const callback = await requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
      state: initiated.body.state, code: 'authorization-code'
    }, context.adminSession);
    assert.equal(callback.status, 502);
    assert.equal(await context.db.googleWorkspaceConnection.count(), 0);
    assert.equal(JSON.stringify(callback.body).includes('LOCAL_FAKE_GOOGLE'), false);
  } finally {
    await context.cleanup();
  }
});

test('P14-REAL-10 expired access metadata reaches refresh flow and synchronizes the DB expiry', async () => {
  const provider = new MemoryGoogleCredentialProvider();
  const requests: GoogleHttpRequest[] = [];
  const transport: GoogleHttpTransport = async (request) => {
    requests.push(request);
    const url = new URL(request.url);
    if (url.pathname === '/token') {
      const form = new URLSearchParams(request.body);
      if (form.get('grant_type') === 'refresh_token') {
        return json(200, {
          access_token: 'ya29.rotated-refresh-path', expires_in: 7200,
          token_type: 'Bearer', scope: REQUIRED_GOOGLE_SCOPES.join(' ')
        });
      }
      return json(200, {
        access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, expires_in: 3600,
        token_type: 'Bearer', scope: REQUIRED_GOOGLE_SCOPES.join(' ')
      });
    }
    if (url.pathname === '/drive/v3/about') return json(200, { user: { permissionId: 'permission-1' } });
    throw new Error(`Unexpected provider route ${request.url}`);
  };
  const context = await startP14Isolated('p14-real-refresh-server', {
    allowTestGoogleModes: false,
    googleWorkspaceAdapterFactory: (organizationId) => new GoogleWorkspaceRealAdapter(
      adapterOptions(provider, transport, undefined, organizationId)
    )
  });
  try {
    const initiated = await requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', {
      redirectTarget: '/integrations/google', expectedVersion: null
    }, context.adminSession);
    const callback = await requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
      state: initiated.body.state, code: 'authorization-code'
    }, context.adminSession);
    assert.equal(callback.status, 200);
    const connection = await context.db.googleWorkspaceConnection.findFirstOrThrow();
    await provider.replaceCredential(connection.organizationId, connection.secretRef, {
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      expiresAt: new Date(NOW.getTime() + 30_000),
      grantedScopes: [...REQUIRED_GOOGLE_SCOPES],
      tokenType: 'Bearer'
    });
    const expired = await context.db.googleWorkspaceConnection.update({
      where: { id: connection.id },
      data: { tokenExpiresAt: new Date(Date.now() - 60_000), version: { increment: 1 } }
    });
    const tested = await requestJson(context.origin, '/api/google-workspace/test', 'POST', {
      expectedVersion: expired.version
    }, context.adminSession);
    assert.equal(tested.status, 200);
    assert.equal(requests.some((request) => new URLSearchParams(request.body).get('grant_type') === 'refresh_token'), true);
    const refreshed = await context.db.googleWorkspaceConnection.findUniqueOrThrow({ where: { id: connection.id } });
    assert.equal(refreshed.status, 'CONNECTED');
    assert.equal(refreshed.version, expired.version + 1);
    assert.equal(refreshed.tokenExpiresAt?.toISOString(), new Date(NOW.getTime() + 7_200_000).toISOString());
    assert.equal(await context.db.auditLog.count({ where: { action: 'GOOGLE_CREDENTIAL_METADATA_REFRESHED', targetId: connection.id } }), 1);
  } finally {
    await context.cleanup();
  }
});

test('P14-REAL-11 Docs second-step rate limit is non-retryable after document creation', async () => {
  const { provider, secretRef } = await credentialProvider();
  let creates = 0;
  let batches = 0;
  const adapter = new GoogleWorkspaceRealAdapter(adapterOptions(provider, async (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/v1/documents') {
      creates += 1;
      return json(200, { documentId: `document-${creates}` });
    }
    if (url.pathname.endsWith(':batchUpdate')) {
      batches += 1;
      return json(429, { error: 'synthetic rate limit' }, { 'retry-after': '1' });
    }
    throw new Error(`Unexpected provider route ${request.url}`);
  }, secretRef));
  const result = await adapter.exportDocs('CASE-SYN-001', 'MEET-SYN-001', 1, 'Approved meeting', 'Approved content', 'IDEMP-DOCS-RATE-LIMIT');
  assert.equal(result.responseClass, 'SERVER_ERROR');
  assert.equal(creates, 1);
  assert.equal(batches, 1);
});

test('P14-REAL-12 encrypted credential vault persists ciphertext across provider instances', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claim-center-google-vault-'));
  try {
    const masterKey = Buffer.alloc(32, 0x5a);
    const first = new EncryptedFileGoogleCredentialProvider({ directory, masterKey });
    const secretRef = await first.createCredential(DEFAULT_ORGANIZATION_ID, {
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      expiresAt: new Date(NOW.getTime() + 3_600_000),
      grantedScopes: [...REQUIRED_GOOGLE_SCOPES],
      tokenType: 'Bearer'
    });
    const files = await fs.readdir(directory);
    assert.deepEqual(files, [`${secretRef}.vault`]);
    const ciphertext = await fs.readFile(path.join(directory, files[0]), 'utf8');
    assert.equal(ciphertext.includes(ACCESS_TOKEN), false);
    assert.equal(ciphertext.includes(REFRESH_TOKEN), false);

    const restarted = new EncryptedFileGoogleCredentialProvider({ directory, masterKey });
    assert.equal((await restarted.resolveCredential(DEFAULT_ORGANIZATION_ID, secretRef))?.refreshToken, REFRESH_TOKEN);
    await restarted.replaceCredential(DEFAULT_ORGANIZATION_ID, secretRef, {
      accessToken: 'ya29.rotated-persistent-token',
      refreshToken: REFRESH_TOKEN,
      expiresAt: new Date(NOW.getTime() + 7_200_000),
      grantedScopes: [...REQUIRED_GOOGLE_SCOPES],
      tokenType: 'Bearer'
    });
    assert.equal((await first.resolveCredential(DEFAULT_ORGANIZATION_ID, secretRef))?.accessToken, 'ya29.rotated-persistent-token');
    await restarted.deleteCredential(DEFAULT_ORGANIZATION_ID, secretRef);
    assert.equal(await first.resolveCredential(DEFAULT_ORGANIZATION_ID, secretRef), null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('P14-REAL-13 production environment bootstrap resolves only ENV references and exact redirect origins', () => {
  const directory = path.join(os.tmpdir(), `claim-center-google-env-${process.pid}`);
  const environment: NodeJS.ProcessEnv = {
    GOOGLE_WORKSPACE_PROVIDER_MODE: 'REAL',
    GOOGLE_WORKSPACE_CLIENT_ID_REF: 'ENV_GOOGLE_SYNTHETIC_CLIENT_ID',
    GOOGLE_WORKSPACE_CLIENT_SECRET_REF: 'ENV_GOOGLE_SYNTHETIC_CLIENT_SECRET',
    GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY_REF: 'ENV_GOOGLE_SYNTHETIC_MASTER_KEY',
    GOOGLE_WORKSPACE_REDIRECT_URI: 'https://claims.example.invalid/integrations/google',
    GOOGLE_WORKSPACE_REDIRECT_ORIGINS: 'https://claims.example.invalid',
    GOOGLE_WORKSPACE_CREDENTIAL_VAULT_DIR: directory,
    GOOGLE_SYNTHETIC_CLIENT_ID: 'claim-center.apps.googleusercontent.com',
    GOOGLE_SYNTHETIC_CLIENT_SECRET: CLIENT_SECRET,
    GOOGLE_SYNTHETIC_MASTER_KEY: Buffer.alloc(32, 0x6b).toString('base64url')
  };
  const factory = createGoogleWorkspaceAdapterFactoryFromEnvironment(environment);
  assert.ok(factory);
  const adapter = factory('ORG-SYN-001');
  const authorization = new URL(adapter.createAuthorizationUrl({
    state: 'environment-bootstrap-state', codeChallenge: PKCE, scopes: REQUIRED_GOOGLE_SCOPES
  }));
  assert.equal(authorization.origin, 'https://accounts.google.com');
  assert.equal(authorization.searchParams.get('redirect_uri'), environment.GOOGLE_WORKSPACE_REDIRECT_URI);
  assert.throws(() => factory('ORG WITH SPACES'), /organization is invalid/);
  assert.throws(() => createGoogleWorkspaceAdapterFactoryFromEnvironment({
    ...environment,
    GOOGLE_WORKSPACE_REDIRECT_ORIGINS: 'https://attacker.invalid'
  }), /not allowlisted/);
  assert.throws(() => createGoogleWorkspaceAdapterFactoryFromEnvironment({
    ...environment,
    GOOGLE_WORKSPACE_CLIENT_SECRET_REF: CLIENT_SECRET
  }), /ENV_\* secret reference|Secret reference/);
});

test('P14-REAL-14 quotes apostrophes in Sheets A1 URLs and rejects a mismatched provider range', async () => {
  const { provider, secretRef } = await credentialProvider();
  const requestedUrls: string[] = [];
  let providerRange = "'Case O''Brien Costs'!A1:B2";
  const transport: GoogleHttpTransport = async (request) => {
    requestedUrls.push(request.url);
    return json(200, {
      range: providerRange,
      majorDimension: 'ROWS',
      values: [['Item', 'Amount'], ['Concrete', 125000]]
    });
  };
  const adapter = new GoogleWorkspaceRealAdapter(adapterOptions(provider, transport, secretRef));
  const input = {
    spreadsheetId: 'sheet-special-name',
    sheetName: "Case O'Brien Costs",
    rangeA1: 'A1:B2'
  };

  const accepted = await adapter.importSheets('CASE-SYN-001', input);
  assert.equal(accepted.responseClass, 'SUCCESS');
  assert.equal(accepted.data?.rowCount, 1);
  const requested = new URL(requestedUrls[0]);
  assert.equal(
    decodeURIComponent(requested.pathname),
    "/v4/spreadsheets/sheet-special-name/values/'Case O''Brien Costs'!A1:B2"
  );
  assert.equal(requested.searchParams.get('majorDimension'), 'ROWS');

  providerRange = "'Case O''Brien Costs'!A1:C2";
  const rejected = await adapter.importSheets('CASE-SYN-001', input);
  assert.equal(rejected.responseClass, 'MALFORMED_PROVIDER_RESPONSE');
  assert.equal(rejected.data, undefined);
});

test('P14-REAL-15 rejects Calendar responses whose returned start or end differs from the confirmed event', async () => {
  const { provider, secretRef } = await credentialProvider();
  let mismatch: 'start' | 'end' = 'start';
  const transport: GoogleHttpTransport = async (request) => {
    const sent = JSON.parse(request.body ?? '{}') as {
      id: string;
      summary: string;
      start: { dateTime: string };
      end: { dateTime: string };
    };
    return json(200, {
      id: sent.id,
      summary: sent.summary,
      start: mismatch === 'start' ? { dateTime: '2026-08-11T01:30:00.000Z' } : sent.start,
      end: mismatch === 'end' ? { dateTime: '2026-08-11T02:30:00.000Z' } : sent.end
    });
  };
  const adapter = new GoogleWorkspaceRealAdapter(adapterOptions(provider, transport, secretRef));
  const input = {
    summary: 'Site inspection',
    description: 'Confirmed schedule',
    startDateTime: '2026-08-11T01:00:00.000Z',
    endDateTime: '2026-08-11T02:00:00.000Z',
    humanConfirmed: true
  };

  const wrongStart = await adapter.createCalendarEvent('CASE-SYN-001', input, 'IDEMP-CALENDAR-DATE-CHECK');
  assert.equal(wrongStart.responseClass, 'MALFORMED_PROVIDER_RESPONSE');
  mismatch = 'end';
  const wrongEnd = await adapter.createCalendarEvent('CASE-SYN-001', input, 'IDEMP-CALENDAR-DATE-CHECK');
  assert.equal(wrongEnd.responseClass, 'MALFORMED_PROVIDER_RESPONSE');
});

test('P14-REAL-16 case identity namespaces Calendar event and Gmail document identifiers', async () => {
  const { provider, secretRef } = await credentialProvider();
  const attachmentBytes = Buffer.from('case-bound attachment', 'utf8');
  const transport: GoogleHttpTransport = async (request) => {
    const url = new URL(request.url);
    if (url.hostname === 'calendar.googleapis.com') {
      const sent = JSON.parse(request.body ?? '{}') as {
        id: string;
        summary: string;
        start: { dateTime: string };
        end: { dateTime: string };
      };
      return json(200, {
        id: sent.id,
        summary: sent.summary,
        start: sent.start,
        end: sent.end
      });
    }
    if (url.pathname.endsWith('/attachments/attachment-shared')) {
      return json(200, { data: attachmentBytes.toString('base64url'), size: attachmentBytes.length });
    }
    if (url.pathname.endsWith('/messages/message-shared')) {
      return json(200, {
        payload: {
          parts: [{
            filename: 'shared-evidence.txt',
            mimeType: 'text/plain',
            body: { attachmentId: 'attachment-shared', size: attachmentBytes.length }
          }]
        }
      });
    }
    throw new Error(`Unexpected provider route ${request.url}`);
  };
  const adapter = new GoogleWorkspaceRealAdapter(adapterOptions(provider, transport, secretRef));
  const eventInput = {
    summary: 'Shared idempotency event',
    description: 'Same provider request key across cases',
    startDateTime: '2026-08-12T01:00:00.000Z',
    endDateTime: '2026-08-12T02:00:00.000Z',
    humanConfirmed: true
  };

  const firstEvent = await adapter.createCalendarEvent('CASE-SYN-001', eventInput, 'IDEMP-SHARED-CALENDAR');
  const secondEvent = await adapter.createCalendarEvent('CASE-SYN-002', eventInput, 'IDEMP-SHARED-CALENDAR');
  assert.equal(firstEvent.responseClass, 'SUCCESS');
  assert.equal(secondEvent.responseClass, 'SUCCESS');
  assert.notEqual(firstEvent.data?.eventId, secondEvent.data?.eventId);

  const firstImport = await adapter.importGmailAttachments('CASE-SYN-001', ['message-shared:attachment-shared']);
  const secondImport = await adapter.importGmailAttachments('CASE-SYN-002', ['message-shared:attachment-shared']);
  assert.equal(firstImport.responseClass, 'SUCCESS');
  assert.equal(secondImport.responseClass, 'SUCCESS');
  assert.notEqual(firstImport.data?.items[0].documentId, secondImport.data?.items[0].documentId);
});

test('P14-REAL-17 request-scoped real adapters bind the persisted secret before workspace source listing', async () => {
  const provider = new MemoryGoogleCredentialProvider();
  const requests: GoogleHttpRequest[] = [];
  let factoryCalls = 0;
  const transport: GoogleHttpTransport = async (request) => {
    requests.push(request);
    const url = new URL(request.url);
    if (url.pathname === '/token') {
      return json(200, {
        access_token: ACCESS_TOKEN,
        refresh_token: REFRESH_TOKEN,
        expires_in: 3600,
        token_type: 'Bearer',
        scope: REQUIRED_GOOGLE_SCOPES.join(' ')
      });
    }
    assert.equal(request.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
    if (url.hostname === 'gmail.googleapis.com' && url.pathname.endsWith('/messages')) {
      return json(200, { messages: [{ id: 'workspace-message' }] });
    }
    if (url.hostname === 'gmail.googleapis.com' && url.pathname.endsWith('/messages/workspace-message')) {
      return json(200, {
        payload: {
          parts: [{
            filename: 'workspace-evidence.txt',
            mimeType: 'text/plain',
            body: { attachmentId: 'workspace-attachment', size: 24 }
          }]
        }
      });
    }
    if (url.hostname === 'www.googleapis.com' && url.pathname === '/drive/v3/files') {
      return json(200, { files: [{ id: 'workspace-sheet', name: 'Workspace costs' }] });
    }
    if (url.hostname === 'sheets.googleapis.com' && url.pathname.endsWith('/spreadsheets/workspace-sheet')) {
      return json(200, {
        sheets: [{ properties: { title: 'Costs', gridProperties: { rowCount: 100, columnCount: 4 } } }]
      });
    }
    throw new Error(`Unexpected provider route ${request.url}`);
  };
  const context = await startP14Isolated('p14-real-workspace-bind', {
    allowTestGoogleModes: false,
    googleWorkspaceAdapterFactory: (organizationId) => {
      factoryCalls += 1;
      return new GoogleWorkspaceRealAdapter(adapterOptions(provider, transport, undefined, organizationId));
    }
  });
  try {
    const initiated = await requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', {
      redirectTarget: '/integrations/google', expectedVersion: null
    }, context.adminSession);
    const connected = await requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
      state: initiated.body.state, code: 'authorization-code'
    }, context.adminSession);
    assert.equal(connected.status, 200, JSON.stringify(connected.body));

    const workspace = await requestJson(
      context.origin,
      `/api/cases/${context.caseId}/google/workspace`,
      'GET',
      undefined,
      context.pmSession
    );
    assert.equal(workspace.status, 200, JSON.stringify(workspace.body));
    assert.deepEqual(workspace.body.gmailAttachments, [{
      attachmentId: 'workspace-message:workspace-attachment',
      filename: 'workspace-evidence.txt',
      mimeType: 'text/plain',
      sizeBytes: 24
    }]);
    assert.deepEqual(workspace.body.sheetSources, [{
      spreadsheetId: 'workspace-sheet',
      sheetName: 'Costs',
      allowedRange: 'A1:D100',
      displayName: 'Workspace costs'
    }]);
    assert.equal(workspace.body.gmailSourceStatus.responseClass, 'SUCCESS');
    assert.equal(workspace.body.sheetSourceStatus.responseClass, 'SUCCESS');
    assert.ok(factoryCalls >= 3, `expected request-scoped adapters, received ${factoryCalls} factory calls`);
  } finally {
    await context.cleanup();
  }
  assert.equal(requests.filter((request) => new URL(request.url).pathname !== '/token').length, 4);
});

test('P14-REAL-18 reconnect retires the old vault reference and leaves only the new credential', async () => {
  const provider = new MemoryGoogleCredentialProvider();
  let exchangeCount = 0;
  const transport: GoogleHttpTransport = async (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/token') {
      exchangeCount += 1;
      return json(200, {
        access_token: `${ACCESS_TOKEN}-${exchangeCount}`,
        refresh_token: `${REFRESH_TOKEN}-${exchangeCount}`,
        expires_in: 3600,
        token_type: 'Bearer',
        scope: REQUIRED_GOOGLE_SCOPES.join(' ')
      });
    }
    if (url.pathname === '/revoke') return { status: 200, headers: {}, body: '' };
    throw new Error(`Unexpected provider route ${request.url}`);
  };
  const context = await startP14Isolated('p14-real-reconnect-retire', {
    allowTestGoogleModes: false,
    googleWorkspaceAdapterFactory: (organizationId) => new GoogleWorkspaceRealAdapter(
      adapterOptions(provider, transport, undefined, organizationId)
    )
  });
  try {
    const firstInit = await requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', {
      redirectTarget: '/integrations/google', expectedVersion: null
    }, context.adminSession);
    const firstCallback = await requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
      state: firstInit.body.state, code: 'authorization-code-1'
    }, context.adminSession);
    assert.equal(firstCallback.status, 200, JSON.stringify(firstCallback.body));
    const firstConnection = await context.db.googleWorkspaceConnection.findFirstOrThrow();
    const oldSecretRef = firstConnection.secretRef;
    assert.ok(await provider.resolveCredential(firstConnection.organizationId, oldSecretRef));

    const secondInit = await requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', {
      redirectTarget: '/integrations/google', expectedVersion: firstConnection.version
    }, context.adminSession);
    const secondCallback = await requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
      state: secondInit.body.state, code: 'authorization-code-2'
    }, context.adminSession);
    assert.equal(secondCallback.status, 200, JSON.stringify(secondCallback.body));
    assert.equal(secondCallback.body.previousCredentialRetired, true);

    const reconnected = await context.db.googleWorkspaceConnection.findFirstOrThrow();
    assert.notEqual(reconnected.secretRef, oldSecretRef);
    assert.equal(await provider.resolveCredential(reconnected.organizationId, oldSecretRef), null);
    assert.ok(await provider.resolveCredential(reconnected.organizationId, reconnected.secretRef));
    assert.deepEqual(provider.getRedactedSnapshot().map((entry) => entry.secretRef), [reconnected.secretRef]);
  } finally {
    await context.cleanup();
  }
});

test('P14-REAL-19 a late OAuth token response after server timeout cannot mint a vault credential', async () => {
  const provider = new MemoryGoogleCredentialProvider();
  const transport: GoogleHttpTransport = async (request) => {
    if (new URL(request.url).pathname !== '/token') throw new Error(`Unexpected provider route ${request.url}`);
    // Deliberately ignore request.signal to model a third-party SDK transport
    // that resolves after the API timeout has already aborted the operation.
    await new Promise<void>((resolve) => setTimeout(resolve, 1_250));
    return json(200, {
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_in: 3600,
      token_type: 'Bearer',
      scope: REQUIRED_GOOGLE_SCOPES.join(' ')
    });
  };
  const context = await startP14Isolated('p14-real-late-oauth-timeout', {
    allowTestGoogleModes: false,
    googleWorkspaceProviderTimeoutMs: 1_000,
    googleWorkspaceAdapterFactory: (organizationId) => new GoogleWorkspaceRealAdapter(
      adapterOptions(provider, transport, undefined, organizationId)
    )
  });
  try {
    const initiated = await requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', {
      redirectTarget: '/integrations/google', expectedVersion: null
    }, context.adminSession);
    assert.equal(initiated.status, 201, JSON.stringify(initiated.body));
    const callback = await requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
      state: initiated.body.state, code: 'authorization-code-after-timeout'
    }, context.adminSession);
    assert.equal(callback.status, 504, JSON.stringify(callback.body));
    assert.equal(callback.body.responseClass, 'TIMEOUT');
    assert.equal(provider.getRedactedSnapshot().length, 0);

    await new Promise<void>((resolve) => setTimeout(resolve, 400));
    assert.equal(provider.getRedactedSnapshot().length, 0);
    assert.equal(await context.db.googleWorkspaceConnection.count(), 0);
  } finally {
    await context.cleanup();
  }
});

test('P14-REAL-20 a late successful revoke response after abort cannot delete the existing credential', async () => {
  const { provider, secretRef } = await credentialProvider();
  const controller = new AbortController();
  const transport: GoogleHttpTransport = async (request) => {
    assert.equal(new URL(request.url).pathname, '/revoke');
    // Model an SDK transport that ignores AbortSignal and resolves after the
    // caller/server has already classified the operation as cancelled/timeout.
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    return { status: 200, headers: {}, body: '' };
  };
  const adapter = new GoogleWorkspaceRealAdapter(adapterOptions(provider, transport, secretRef));

  const pending = adapter.revokeConnection(secretRef, controller.signal);
  setTimeout(() => controller.abort(), 20);
  const revoked = await pending;

  assert.equal(revoked.responseClass, 'USER_CANCEL');
  assert.equal(revoked.data, undefined);
  assert.ok(await provider.resolveCredential(DEFAULT_ORGANIZATION_ID, secretRef));
  assert.deepEqual(provider.getRedactedSnapshot().map((entry) => entry.secretRef), [secretRef]);
});

test('P14-REAL-21 disconnect survives an in-flight credential metadata version bump and purges the revoked credential', async () => {
  const provider = new MemoryGoogleCredentialProvider();
  let context: Awaited<ReturnType<typeof startP14Isolated>> | undefined;
  let revokeMetadataBumps = 0;
  const transport: GoogleHttpTransport = async (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/token') {
      return json(200, {
        access_token: ACCESS_TOKEN,
        refresh_token: REFRESH_TOKEN,
        expires_in: 3600,
        token_type: 'Bearer',
        scope: REQUIRED_GOOGLE_SCOPES.join(' ')
      });
    }
    if (url.pathname === '/revoke') {
      const activeContext = context;
      if (!activeContext) throw new Error('P14 isolated context is unavailable');
      const current = await activeContext.db.googleWorkspaceConnection.findFirstOrThrow();
      await activeContext.db.googleWorkspaceConnection.update({
        where: { id: current.id },
        data: {
          lastSyncedAt: new Date((current.lastSyncedAt ?? current.updatedAt).getTime() + 1_000),
          version: { increment: 1 }
        }
      });
      revokeMetadataBumps += 1;
      return { status: 200, headers: {}, body: '' };
    }
    throw new Error(`Unexpected provider route ${request.url}`);
  };
  context = await startP14Isolated('p14-real-disconnect-metadata-race', {
    allowTestGoogleModes: false,
    googleWorkspaceAdapterFactory: (organizationId) => new GoogleWorkspaceRealAdapter(
      adapterOptions(provider, transport, undefined, organizationId)
    )
  });
  try {
    const initiated = await requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', {
      redirectTarget: '/integrations/google', expectedVersion: null
    }, context.adminSession);
    const connected = await requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
      state: initiated.body.state, code: 'authorization-code-disconnect-race'
    }, context.adminSession);
    assert.equal(connected.status, 200, JSON.stringify(connected.body));
    const before = await context.db.googleWorkspaceConnection.findFirstOrThrow();
    assert.ok(await provider.resolveCredential(before.organizationId, before.secretRef));

    const disconnected = await requestJson(context.origin, '/api/google-workspace/disconnect', 'POST', {
      expectedVersion: before.version
    }, context.adminSession);
    assert.equal(disconnected.status, 200, JSON.stringify(disconnected.body));
    assert.equal(disconnected.body.status, 'DISCONNECTED');
    assert.equal(disconnected.body.connection.status, 'DISCONNECTED');
    assert.equal(disconnected.body.credentialPurged, true);
    assert.equal(revokeMetadataBumps, 1);

    const after = await context.db.googleWorkspaceConnection.findFirstOrThrow();
    assert.equal(after.status, 'DISCONNECTED');
    assert.equal(after.version, before.version + 2);
    assert.equal(await provider.resolveCredential(after.organizationId, before.secretRef), null);
    assert.equal(provider.getRedactedSnapshot().length, 0);
    assert.equal(await context.db.auditLog.count({
      where: { action: 'GOOGLE_WORKSPACE_DISCONNECTED', targetId: before.id }
    }), 1);
  } finally {
    await context.cleanup();
  }
});

test('P14-REAL-22 a cross-organization DB secretRef swap cannot authorize test or revoke provider calls', async () => {
  const provider = new MemoryGoogleCredentialProvider();
  const providerCallsAfterSwap: GoogleHttpRequest[] = [];
  let swapped = false;
  const transport: GoogleHttpTransport = async (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/token') {
      return json(200, {
        access_token: `${ACCESS_TOKEN}-ORG-A`,
        refresh_token: `${REFRESH_TOKEN}-ORG-A`,
        expires_in: 3600,
        token_type: 'Bearer',
        scope: REQUIRED_GOOGLE_SCOPES.join(' ')
      });
    }
    if (swapped) providerCallsAfterSwap.push(request);
    if (url.pathname === '/drive/v3/about') return json(200, { user: { permissionId: 'foreign-call-must-not-happen' } });
    if (url.pathname === '/revoke') return { status: 200, headers: {}, body: '' };
    throw new Error(`Unexpected provider route ${request.url}`);
  };
  const context = await startP14Isolated('p14-real-cross-organization-secret-ref', {
    allowTestGoogleModes: false,
    googleWorkspaceAdapterFactory: (organizationId) => new GoogleWorkspaceRealAdapter(
      adapterOptions(provider, transport, undefined, organizationId)
    )
  });
  try {
    const initiated = await requestJson(context.origin, '/api/google-workspace/connect/init', 'POST', {
      redirectTarget: '/integrations/google', expectedVersion: null
    }, context.adminSession);
    const connected = await requestJson(context.origin, '/api/google-workspace/connect/callback', 'POST', {
      state: initiated.body.state, code: 'authorization-code-org-a'
    }, context.adminSession);
    assert.equal(connected.status, 200, JSON.stringify(connected.body));
    const organizationAConnection = await context.db.googleWorkspaceConnection.findFirstOrThrow();
    const organizationA = organizationAConnection.organizationId;
    const organizationB = 'ORG-SYN-B';
    const organizationBSecretRef = await provider.createCredential(organizationB, {
      accessToken: `${ACCESS_TOKEN}-ORG-B`,
      refreshToken: `${REFRESH_TOKEN}-ORG-B`,
      expiresAt: new Date(NOW.getTime() + 3_600_000),
      grantedScopes: [...REQUIRED_GOOGLE_SCOPES],
      tokenType: 'Bearer'
    });
    assert.ok(await provider.resolveCredential(organizationA, organizationAConnection.secretRef));
    assert.ok(await provider.resolveCredential(organizationB, organizationBSecretRef));
    assert.equal(await provider.resolveCredential(organizationA, organizationBSecretRef), null);

    const tampered = await context.db.googleWorkspaceConnection.update({
      where: { id: organizationAConnection.id },
      data: { secretRef: organizationBSecretRef, version: { increment: 1 } }
    });
    swapped = true;

    const tested = await requestJson(context.origin, '/api/google-workspace/test', 'POST', {
      expectedVersion: tampered.version
    }, context.adminSession);
    assert.equal(tested.status, 409, JSON.stringify(tested.body));
    assert.equal(tested.body.responseClass, 'RECONSENT_REQUIRED');
    const afterTest = await context.db.googleWorkspaceConnection.findUniqueOrThrow({ where: { id: tampered.id } });
    assert.equal(afterTest.status, 'RECONSENT_REQUIRED');

    const disconnected = await requestJson(context.origin, '/api/google-workspace/disconnect', 'POST', {
      expectedVersion: afterTest.version
    }, context.adminSession);
    assert.equal(disconnected.status, 409, JSON.stringify(disconnected.body));
    assert.match(disconnected.body.error, /consent/i);
    assert.equal(providerCallsAfterSwap.length, 0, JSON.stringify(providerCallsAfterSwap));

    const unchanged = await context.db.googleWorkspaceConnection.findUniqueOrThrow({ where: { id: tampered.id } });
    assert.equal(unchanged.status, 'RECONSENT_REQUIRED');
    assert.equal(unchanged.secretRef, organizationBSecretRef);
    assert.ok(await provider.resolveCredential(organizationB, organizationBSecretRef));
    assert.equal(await provider.resolveCredential(organizationA, organizationBSecretRef), null);
  } finally {
    await context.cleanup();
  }
});
