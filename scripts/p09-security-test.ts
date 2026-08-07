import assert from 'node:assert/strict';
import http from 'node:http';
import { createPrismaClient, resetDatabase, seedDatabase } from '@claim-studio/database';
import { createApiServer } from '../apps/api/src/server';

async function main() {
  console.log('[P09 Security Test] Initializing database and API server...');
  await resetDatabase();
  await seedDatabase();
  const db = createPrismaClient();

  const server = createApiServer({ db });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  const origin = 'http://localhost:3000';

  async function request(path: string, options: { method?: string; headers?: Record<string, string>; body?: any } = {}) {
    const url = new URL(path, baseUrl);
    const method = options.method || 'GET';
    const bodyStr = options.body ? JSON.stringify(options.body) : undefined;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Origin': origin,
      ...options.headers
    };

    return new Promise<{ status: number; data: any; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const req = http.request(url, { method, headers }, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            const data = raw ? JSON.parse(raw) : null;
            resolve({ status: res.statusCode || 500, data, headers: res.headers });
          } catch {
            resolve({ status: res.statusCode || 500, data: raw, headers: res.headers });
          }
        });
      });
      req.on('error', reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  async function loginAs(email: string) {
    const res = await request('/auth/login', { method: 'POST', body: { email, password: 'Password123!' } });
    assert.equal(res.status, 200, `Login failed for ${email}`);
    const setCookies = res.headers['set-cookie'] || [];
    const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');
    const csrfToken = res.data.csrfToken;
    return {
      'Cookie': cookieHeader,
      'X-CSRF-Token': csrfToken
    };
  }

  try {
    console.log('[P09 Security Test] 1. Login as Reviewer & PM...');
    const pmHeaders = await loginAs('pm@example.invalid');
    const revHeaders = await loginAs('reviewer@example.invalid');

    console.log('[P09 Security Test] 2. Reviewer Revision Creation Attempt -> 403 Forbidden...');
    const revEditRes = await request('/api/reports/RPT-001/sections/SEC-002/revisions', {
      method: 'POST',
      headers: revHeaders,
      body: { title: 'Reviewer Edit Attempt', content: 'Forbidden' }
    });
    assert.equal(revEditRes.status, 403);

    console.log('[P09 Security Test] 3. Reviewer Merge Attempt -> 403 Forbidden...');
    const revMergeRes = await request('/api/reports/RPT-001/merge', {
      method: 'POST',
      headers: revHeaders
    });
    assert.equal(revMergeRes.status, 403);

    console.log('[P09 Security Test] 4. Self-Approval Prohibition (Author approving own revision) -> 403 Forbidden...');
    // pmUser created SECREV-002-1. If pmUser tries to approve SEC-002:
    const selfApprRes = await request('/api/reports/RPT-001/sections/SEC-002/approve', {
      method: 'POST',
      headers: pmHeaders,
      body: { revisionId: 'SECREV-002-1', comment: 'Self approval' }
    });
    assert.equal(selfApprRes.status, 403);
    assert(selfApprRes.data && typeof selfApprRes.data.error === 'string');
    assert(selfApprRes.data.error.includes('Self-approval'));

    console.log('[P09 Security Test] 5. Self-Approval DB Trigger Layer Check...');
    let triggerCaught = false;
    try {
      await db.$executeRawUnsafe(`
        INSERT INTO ReportSectionApproval (id, sectionId, approvedRevisionId, approverId, status, createdAt)
        VALUES ('APPR-SELF-TEST', 'SEC-002', 'SECREV-002-1', 'USR-PM', 'APPROVED', datetime('now'))
      `);
    } catch (e: any) {
      triggerCaught = true;
      assert(e.message.includes('P09: Self-approval is strictly forbidden') || e.message.includes('FAIL'));
    }
    assert.equal(triggerCaught, true, 'DB trigger did not block self-approval!');

    console.log('[P09 Security Test] 6. Cross-Organization (ORG-B) Access Attempt -> 403 Forbidden...');
    const orgBHeaders = await loginAs('orgb-pm@example.invalid');

    const crossOrgStudio = await request('/api/reports/RPT-001/studio', { headers: orgBHeaders });
    assert.equal(crossOrgStudio.status, 403);

    console.log('[P09 Security Test] PASS 100%!');
  } finally {
    server.close();
    await db.$disconnect();
  }
}

void main().catch((e) => {
  console.error('[P09 Security Test Failed]', e);
  process.exitCode = 1;
});
