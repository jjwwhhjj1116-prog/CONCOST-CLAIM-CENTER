import assert from 'node:assert/strict';
import http from 'node:http';
import { createPrismaClient, resetDatabase, seedDatabase } from '@claim-studio/database';
import { createApiServer } from '../apps/api/src/server';

async function main() {
  console.log('[P09 Contract Test] Initializing database and API server...');
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
    console.log('[P09 Contract Test] 1. Login as PM user...');
    const pmHeaders = await loginAs('pm@example.invalid');

    console.log('[P09 Contract Test] 2. GET /api/reports/RPT-001/studio...');
    const studioRes = await request('/api/reports/RPT-001/studio', { headers: pmHeaders });
    assert.equal(studioRes.status, 200);
    assert.equal(studioRes.data.report.id, 'RPT-001');
    assert.equal(studioRes.data.report.sections.length, 3);

    console.log('[P09 Contract Test] 3. POST /api/reports/RPT-001/sections/SEC-002/revisions (Save Revision v2)...');
    const rev2Res = await request('/api/reports/RPT-001/sections/SEC-002/revisions', {
      method: 'POST',
      headers: pmHeaders,
      body: {
        title: '제2장 손실액 및 공사비 산출근거 (수정본)',
        content: '수정된 내용: 현장 재실측 결과 피해 면적 480㎡, 손실비용 135,000,000원.',
        expectedVersion: 1
      }
    });
    assert.equal(rev2Res.status, 201);
    assert.equal(rev2Res.data.revision.revisionNumber, 2);
    assert.equal(rev2Res.data.sectionVersion, 2);

    console.log('[P09 Contract Test] 4. Concurrency Conflict 409 Check (stale expectedVersion: 1)...');
    const conflictRes = await request('/api/reports/RPT-001/sections/SEC-002/revisions', {
      method: 'POST',
      headers: pmHeaders,
      body: {
        title: '동시 수정 시도',
        content: '충돌 데이터',
        expectedVersion: 1
      }
    });
    assert.equal(conflictRes.status, 409);
    assert.equal(conflictRes.data.currentVersion, 2);

    console.log('[P09 Contract Test] 5. Comment & Revision Request Creation...');
    const commentRes = await request('/api/reports/RPT-001/sections/SEC-002/comments', {
      method: 'POST',
      headers: pmHeaders,
      body: {
        commentType: 'REVISION_REQUEST',
        content: '재실측 항목 구체적 산출 단가 첨부 바람'
      }
    });
    assert.equal(commentRes.status, 201);
    assert.equal(commentRes.data.comment.commentType, 'REVISION_REQUEST');

    console.log('[P09 Contract Test] 6. Comment Resolve...');
    const resolveRes = await request(`/api/reports/RPT-001/sections/SEC-002/comments/${commentRes.data.comment.id}/resolve`, {
      method: 'PATCH',
      headers: pmHeaders
    });
    assert.equal(resolveRes.status, 200);
    assert.equal(resolveRes.data.comment.isResolved, true);

    console.log('[P09 Contract Test] 7. Unapproved Section Report Merge 400 Check...');
    const unapprovedMergeRes = await request('/api/reports/RPT-001/merge', {
      method: 'POST',
      headers: pmHeaders
    });
    assert.equal(unapprovedMergeRes.status, 400);

    console.log('[P09 Contract Test] 8. Approve SEC-002 and SEC-003 as Director...');
    const dirHeaders = await loginAs('director@example.invalid');

    const apprSec2 = await request('/api/reports/RPT-001/sections/SEC-002/approve', {
      method: 'POST',
      headers: dirHeaders,
      body: { comment: '제2장 승인 완료' }
    });
    assert.equal(apprSec2.status, 200);

    const apprSec3 = await request('/api/reports/RPT-001/sections/SEC-003/approve', {
      method: 'POST',
      headers: dirHeaders,
      body: { comment: '제3장 승인 완료' }
    });
    assert.equal(apprSec3.status, 200);

    console.log('[P09 Contract Test] 9. Report Merge Snapshot Creation after all sections APPROVED...');
    const mergeRes = await request('/api/reports/RPT-001/merge', {
      method: 'POST',
      headers: pmHeaders
    });
    assert.equal(mergeRes.status, 201);
    assert.equal(mergeRes.data.snapshot.snapshotVersion, 1);
    assert(mergeRes.data.snapshot.mergedBodyText.includes('제1장'));
    assert(mergeRes.data.snapshot.mergedBodyText.includes('제2장'));
    assert(mergeRes.data.snapshot.mergedBodyText.includes('제3장'));

    console.log('[P09 Contract Test] 10. DB Trigger Immutability Verification...');
    const snapshotId = mergeRes.data.snapshot.id;
    let dbErrorCaught = false;
    try {
      await db.$executeRawUnsafe(`UPDATE ReportMergeSnapshot SET mergedBodyText = 'MUTATED' WHERE id = '${snapshotId}'`);
    } catch (e: any) {
      dbErrorCaught = true;
      assert(e.message.includes('P09: ReportMergeSnapshot rows are DB-immutable') || e.message.includes('FAIL'));
    }
    assert.equal(dbErrorCaught, true, 'DB trigger did not block ReportMergeSnapshot mutation!');

    console.log('[P09 Contract Test] PASS 100%!');
  } finally {
    server.close();
    await db.$disconnect();
  }
}

void main().catch((e) => {
  console.error('[P09 Contract Test Failed]', e);
  process.exitCode = 1;
});
