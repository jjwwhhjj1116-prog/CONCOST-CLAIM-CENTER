import assert from 'node:assert/strict';
import http from 'node:http';
import { createPrismaClient, resetDatabase, seedDatabase } from '@claim-studio/database';
import { createApiServer } from '../apps/api/src/server';

async function main() {
  console.log('[P09 E2E Test] Initializing database and API server...');
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
    console.log('[P09 E2E Test] 1. PM User Login...');
    const pmHeaders = await loginAs('pm@example.invalid');

    console.log('[P09 E2E Test] 2. Verify Studio view endpoint data loading...');
    const studio = await request('/api/reports/RPT-001/studio', { headers: pmHeaders });
    assert.equal(studio.status, 200);
    assert.equal(studio.data.report.sections.length, 3);
    assert.equal(studio.data.report.sections[0].status, 'APPROVED');

    console.log('[P09 E2E Test] 3. Save Revision on Section 2...');
    const revSave = await request('/api/reports/RPT-001/sections/SEC-002/revisions', {
      method: 'POST',
      headers: pmHeaders,
      body: {
        title: '제2장 E2E 테스트 수치 산출',
        content: 'E2E 마크다운 본문 검증',
        expectedVersion: 1
      }
    });
    assert.equal(revSave.status, 201);

    console.log('[P09 E2E Test] 4. Director User Login & Section 2 & 3 Approval...');
    const dirHeaders = await loginAs('director@example.invalid');

    const app2 = await request('/api/reports/RPT-001/sections/SEC-002/approve', {
      method: 'POST',
      headers: dirHeaders,
      body: { comment: 'E2E SEC-002 Approved' }
    });
    assert.equal(app2.status, 200);

    const app3 = await request('/api/reports/RPT-001/sections/SEC-003/approve', {
      method: 'POST',
      headers: dirHeaders,
      body: { comment: 'E2E SEC-003 Approved' }
    });
    assert.equal(app3.status, 200);

    console.log('[P09 E2E Test] 5. Merge Report Snapshot Generation...');
    const merge = await request('/api/reports/RPT-001/merge', {
      method: 'POST',
      headers: pmHeaders
    });
    assert.equal(merge.status, 201);
    assert(merge.data.snapshot.mergedBodyText.includes('E2E 마크다운 본문 검증'));

    console.log('[P09 E2E Test] PASS 100%!');
  } finally {
    server.close();
    await db.$disconnect();
  }
}

void main().catch((e) => {
  console.error('[P09 E2E Test Failed]', e);
  process.exitCode = 1;
});
