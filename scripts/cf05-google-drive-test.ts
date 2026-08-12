import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import worker from '../apps/cloudflare/src/index';

interface MockD1Statement {
  sql: string;
  params: unknown[];
}

function createMockD1(): { DB: any; queries: MockD1Statement[] } {
  const queries: MockD1Statement[] = [];
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const stmt = {
      bind: (...args: unknown[]) => {
        params = args;
        return stmt;
      },
      first: async <T>() => {
        queries.push({ sql, params });
        if (sql.includes('preview_users')) {
          if (params[0] === 'admin') {
            return {
              id: 'user-admin-id',
              loginId: 'admin',
              passwordSalt: '0123456789abcdef0123456789abcdef',
              passwordHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              passwordIterations: 1000,
              displayName: '대표이사',
              email: 'admin@claimstudio.com',
              rolesJson: '["ceo","admin"]'
            } as T;
          }
          if (params[0] === 'staff') {
            return {
              id: 'user-staff-id',
              loginId: 'staff',
              passwordSalt: '0123456789abcdef0123456789abcdef',
              passwordHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              passwordIterations: 1000,
              displayName: '담당자',
              email: 'staff@claimstudio.com',
              rolesJson: '["staff"]'
            } as T;
          }
        }
        if (sql.includes('preview_sessions')) {
          return {
            id: 'session-id',
            loginId: 'admin',
            displayName: '대표이사',
            email: 'admin@claimstudio.com',
            rolesJson: '["ceo","admin"]'
          } as T;
        }
        return null;
      },
      all: async <T>() => {
        queries.push({ sql, params });
        return { results: [] as T[] };
      },
      run: async () => {
        queries.push({ sql, params });
        return { success: true };
      }
    };
    return stmt;
  };
  return { DB: { prepare }, queries };
}

describe('CF05 Google Drive Evidence Sync & Security Verification', () => {

  test('1. Unconnected Google Drive returns 503 Fail-Closed on Upload API', async () => {
    const { DB } = createMockD1();
    const env = { DB, ASSETS: { fetch: async () => new Response() } };

    const req = new Request('http://localhost/api/preview/evidence', {
      method: 'POST',
      headers: {
        'X-Session-Token': 'test-session-token',
        'X-Preview-Draft-Key': '00000000-0000-4000-8000-000000000000'
      }
    });

    const res = await worker.fetch(req, env);
    assert.equal(res.status, 503);
    const body = await res.json() as any;
    assert.equal(body.code, 'GOOGLE_DRIVE_NOT_CONNECTED');
    assert.equal(body.r2SkippedByUser, true);
  });

  test('2. Admin role required for Google Workspace OAuth Management', async () => {
    const { DB } = createMockD1();
    // Simulate staff user (non-admin) session query
    DB.prepare = (sql: string) => ({
      bind: () => ({
        first: async () => {
          if (sql.includes('preview_sessions')) {
            return {
              id: 'staff-session',
              loginId: 'staff',
              displayName: '담당자',
              email: 'staff@claimstudio.com',
              rolesJson: '["staff"]'
            };
          }
          return null;
        }
      })
    });

    const env = { DB, ASSETS: { fetch: async () => new Response() } };

    const startReq = new Request('http://localhost/api/google/oauth/start', {
      method: 'POST',
      headers: { 'X-Session-Token': 'staff-token' }
    });

    const startRes = await worker.fetch(startReq, env);
    assert.equal(startRes.status, 403);
    const body = await startRes.json() as any;
    assert.equal(body.code, 'FORBIDDEN');
  });

  test('3. Google Client ID missing in Production returns 503 Fail-Closed', async () => {
    const { DB } = createMockD1();
    const env = { DB, ASSETS: { fetch: async () => new Response() } };

    const req = new Request('http://localhost/api/google/oauth/start', {
      method: 'POST',
      headers: { 'X-Session-Token': 'admin-token' }
    });

    const res = await worker.fetch(req, env);
    assert.equal(res.status, 503);
    const body = await res.json() as any;
    assert.equal(body.code, 'GOOGLE_CLIENT_ID_MISSING');
  });

  test('4. Connected Drive direct evidence upload succeeds and binds server session user', async () => {
    const { DB } = createMockD1();
    const env = {
      DB,
      ALLOW_TEST_GOOGLE_MODES: 'true',
      ASSETS: { fetch: async () => new Response() }
    };

    const formData = new FormData();
    const file = new File(['sample pdf content'], 'report.pdf', { type: 'application/pdf' });
    formData.append('file', file);

    const req = new Request('http://localhost/api/preview/evidence', {
      method: 'POST',
      headers: {
        'X-Session-Token': 'admin-token',
        'X-Preview-Draft-Key': '00000000-0000-4000-8000-000000000000'
      },
      body: formData
    });

    const res = await worker.fetch(req, env);
    assert.equal(res.status, 201);
    const body = await res.json() as any;
    assert.equal(body.file.originalName, 'report.pdf');
    assert.equal(body.file.uploadedBy, '대표이사'); // Derived strictly from server session user
    assert.equal(body.file.storageProvider, 'GOOGLE_DRIVE');
    assert.equal(body.file.syncStatus, 'SYNCED');
  });

  test('5. Health and Readiness API probes return Truthful Status without Secret Leakage', async () => {
    const { DB } = createMockD1();
    const env = { DB, ASSETS: { fetch: async () => new Response() } };

    const healthReq = new Request('http://localhost/health');
    const healthRes = await worker.fetch(healthReq, env);
    assert.equal(healthRes.status, 200);

    const readinessReq = new Request('http://localhost/readiness');
    const readinessRes = await worker.fetch(readinessReq, env);
    assert.equal(readinessRes.status, 200);
    const body = await readinessRes.json() as any;
    assert.equal(body.status, 'ready');
    assert.equal(body.r2SkippedByUser, true);
    assert.equal(JSON.stringify(body).includes('secret'), false);
  });
});
