import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnoseEvidenceUploadInDrive, inspectEvidenceUploadInDrive, refreshAccessToken, sha256Hex, uploadEvidenceToDrive, type GoogleFetch } from '../apps/cloudflare/src/google-drive';
import { duplicateEvidenceResponse } from '../apps/cloudflare/src/evidence-versioning';

const CASE = '40000000-0000-4000-8000-000000000010';
const EVIDENCE = '40000000-0000-4000-8000-000000000011';
const ACTOR = '40000000-0000-4000-8000-000000000012';
const TIME = '2026-09-30T02:17:45.700Z';

test('CF152 SHA hashes only the supplied byte view', async () => {
  const view = new Uint8Array([9, 1, 2, 8]).subarray(1, 3);
  assert.equal(await sha256Hex(view), await sha256Hex(new Uint8Array([1, 2])));
});

test('CF152 inspection retains provider HTTP status without exposing response body', async () => {
  const f = await fixture();
  await assert.rejects(diagnoseEvidenceUploadInDrive(async () => new Response('sensitive-provider-body', { status: 503 }), f.inspection),
    (error: any) => error.code === 'GOOGLE_PROVIDER_ERROR' && error.providerHttpStatus === 503
      && error.uncertain === false && !error.message.includes('sensitive-provider-body'));
});

test('CF152 multipart sends only the supplied byte view once', async () => {
  const bytes = new Uint8Array([9, 1, 2, 8]).subarray(1, 3);
  let posts = 0;
  const fetcher: GoogleFetch = async (_url, init) => {
    posts++;
    assert.equal(init?.method, 'POST');
    const body = new Uint8Array(await (init!.body as Blob).arrayBuffer());
    const text = new TextDecoder().decode(body);
    const start = text.indexOf('Content-Type: application/x-hwp\r\n\r\n') + 'Content-Type: application/x-hwp\r\n\r\n'.length;
    const end = text.indexOf('\r\n--', start);
    assert.deepEqual(body.slice(start, end), new Uint8Array([1, 2]));
    return Response.json({ id: 'synthetic-file', name: 'original.hwp', mimeType: 'application/x-hwp', size: '2' });
  };
  await uploadEvidenceToDrive(fetcher, { accessToken: 'synthetic-token', folderId: 'synthetic-folder', evidenceId: EVIDENCE,
    fileName: 'original.hwp', mimeType: 'application/x-hwp', sha256: await sha256Hex(new Uint8Array([1, 2])), bytes });
  assert.equal(posts, 1);
});

async function fixture(change: Record<string, unknown> = {}) {
  const bytes = new TextEncoder().encode('synthetic original bytes');
  const sha256 = await sha256Hex(bytes);
  const file = { id: 'synthetic-drive-file', name: '[FINAL_v1] original.hwp', mimeType: 'application/x-hwp', size: String(bytes.length), trashed: false,
    parents: ['synthetic-drive-folder'], appProperties: { claimCenterEvidenceId: EVIDENCE, claimCenterCaseId: CASE, claimCenterCategory: 'REPORT_REFERENCE', claimCenterUploadedBy: ACTOR, claimCenterUploadedAt: TIME, sha256 }, ...change };
  let writes = 0; let reads = 0;
  const fetcher: GoogleFetch = async (url, init) => {
    if (init?.method === 'POST') { writes++; return new Response('unreadable receipt'); }
    reads++;
    const target = new URL(String(url));
    if (target.searchParams.get('alt') === 'media') return new Response(bytes);
    if (target.pathname.endsWith('/synthetic-drive-folder')) return Response.json({ id: 'synthetic-drive-folder', mimeType: 'application/vnd.google-apps.folder', trashed: false, parents: ['synthetic-project-root'], appProperties: { claimCenterCaseId: CASE, claimCenterFolderKind: 'REPORT_REFERENCE', claimCenterPeriod: `2026-09-30_${ACTOR}` } });
    if (target.pathname.endsWith('/synthetic-project-root')) return Response.json({ id: 'synthetic-project-root', mimeType: 'application/vnd.google-apps.folder', trashed: false, appProperties: { claimCenterCaseId: CASE, claimCenterFolderKind: 'PROJECT_ROOT' } });
    return Response.json({ files: [file] });
  };
  const input = { accessToken: 'synthetic-token', folderId: 'synthetic-drive-folder', evidenceId: EVIDENCE, fileName: file.name, mimeType: 'application/x-hwp', sha256, bytes, caseId: CASE, category: 'REPORT_REFERENCE', uploadedById: ACTOR, uploadedAt: TIME };
  const inspection = { accessToken: input.accessToken, caseId: CASE, category: 'REPORT_REFERENCE', uploadedById: ACTOR, createdAt: '2026-09-30T02:17:45.692Z', updatedAt: '2026-09-30T02:18:06.263Z', requestFingerprint: await sha256Hex(`${CASE}:REPORT_REFERENCE:original.hwp:${input.mimeType}:${bytes.length}:${sha256}`) };
  return { input, inspection, fetcher, file, count: () => ({ writes, reads }) };
}

test('CF150 unreadable receipt recovers only exact remote bytes without repeating POST', async () => {
  const f = await fixture();
  assert.equal((await uploadEvidenceToDrive(f.fetcher, f.input)).fileId, f.file.id);
  assert.deepEqual(f.count(), { writes: 1, reads: 2 });
});

test('CF150 stalled successful upload recovers after deadline and sends one POST', { timeout: 25_000 }, async () => {
  const f = await fixture(); let posts = 0; let aborted = false;
  const fetcher: GoogleFetch = async (url, init) => {
    if (init?.method !== 'POST') return f.fetcher(url, init);
    posts++;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{'));
      init.signal?.addEventListener('abort', () => { aborted = true; controller.error(new Error('synthetic abort')); }, { once: true });
    } }));
  };
  assert.equal((await uploadEvidenceToDrive(fetcher, f.input)).fileId, f.file.id);
  assert.equal(posts, 1); assert.equal(aborted, true);
});

test('CF150 stalled token JSON expires without declaring a Drive write uncertain', { timeout: 25_000 }, async () => {
  let calls=0; let aborted=false;
  const fetcher: GoogleFetch=async(_url,init)=>{
    calls++;
    return new Response(new ReadableStream({start(controller){
      controller.enqueue(new TextEncoder().encode('{'));
      init?.signal?.addEventListener('abort',()=>{aborted=true;controller.error(new Error('synthetic abort'));},{once:true});
    }}));
  };
  await assert.rejects(refreshAccessToken(fetcher,{clientId:'synthetic-client',clientSecret:'synthetic-secret',refreshToken:'synthetic-refresh'}),{code:'GOOGLE_TIMEOUT',uncertain:false});
  assert.equal(calls,1); assert.equal(aborted,true);
});

test('CF150 mismatched bytes, scope, parent and ambiguous results stay uncertain', async () => {
  const f = await fixture();
  for (const altered of [
    { ...f.file, parents: ['other-drive-folder'] },
    { ...f.file, appProperties: { ...f.file.appProperties, claimCenterCaseId: 'other-case' } },
    { ...f.file, size: '1' },
    { ...f.file, trashed: true }
  ]) {
    let posts = 0;
    await assert.rejects(uploadEvidenceToDrive(async (_url, init) => { if (init?.method === 'POST') { posts++; return new Response('bad'); } return Response.json({ files: [altered] }); }, f.input), { code: 'GOOGLE_MALFORMED_RESPONSE', uncertain: true });
    assert.equal(posts, 1);
  }
  for (const listing of [{ files: [f.file, f.file] }, { files: [f.file], nextPageToken: 'more' }, { files: [f.file], incompleteSearch: true }, { files: [] }]) {
    await assert.rejects(uploadEvidenceToDrive(async (_url, init) => init?.method === 'POST' ? new Response('bad') : Response.json(listing), f.input), { code: 'GOOGLE_MALFORMED_RESPONSE', uncertain: true });
  }
  await assert.rejects(uploadEvidenceToDrive(async (url, init) => init?.method === 'POST' ? new Response('bad') : new URL(String(url)).searchParams.get('alt') === 'media' ? new Response('x'.repeat(f.input.bytes.length)) : Response.json({ files: [f.file] }), f.input), { code: 'GOOGLE_MALFORMED_RESPONSE', uncertain: true });
});

test('CF150 existing failed-operation inspection is read-only and matches original fingerprint', async () => {
  const f = await fixture();
  const found = await inspectEvidenceUploadInDrive(f.fetcher, f.inspection);
  assert.equal(found?.evidenceId, EVIDENCE); assert.equal(found?.sha256, f.input.sha256); assert.equal(f.count().writes, 0);
  assert.equal(await inspectEvidenceUploadInDrive(f.fetcher, { ...f.inspection, requestFingerprint: '0'.repeat(64) }), null);
  assert.equal(await inspectEvidenceUploadInDrive(f.fetcher, { ...f.inspection, category: 'SITE_PHOTO' }), null);
  assert.equal(await inspectEvidenceUploadInDrive(f.fetcher, { ...f.inspection, uploadedById: 'other-actor' }), null);
});

test('CF150 inspection diagnostics preserve nullable receipt and never infer missing storage', async () => {
  const f = await fixture();
  const exact = await diagnoseEvidenceUploadInDrive(f.fetcher, f.inspection);
  assert.equal(exact.reasonCode, 'VERIFIED'); assert.equal(exact.stage, 'COMPLETE');
  assert.deepEqual(exact.receipt, await inspectEvidenceUploadInDrive(f.fetcher, f.inspection));
  for (const [files, reasonCode, stage] of [
    [[], 'EMPTY_SCOPED_SEARCH', 'CANDIDATE_SEARCH'],
    [[f.file, f.file], 'AMBIGUOUS_MATCH', 'CANDIDATE_MATCH'],
    [[{ ...f.file, name: '[FINAL_v2] original.hwp' }], 'NO_FINGERPRINT_MATCH', 'CANDIDATE_MATCH'],
    [[{ ...f.file, appProperties: { ...f.file.appProperties, claimCenterUploadedAt: '2026-09-29T00:00:00Z' } }], 'NO_FINGERPRINT_MATCH', 'CANDIDATE_MATCH'],
    [[{ ...f.file, appProperties: { ...f.file.appProperties, claimCenterUploadedBy: 'other-actor' } }], 'NO_FINGERPRINT_MATCH', 'CANDIDATE_MATCH']
  ] as const) {
    let writes = 0;
    const fetcher: GoogleFetch = async (_url, init) => { if (init?.method && init.method !== 'GET') writes++; return Response.json({ files }); };
    const { diagnostics, ...verdict } = await diagnoseEvidenceUploadInDrive(fetcher, f.inspection);
    assert.deepEqual(verdict, { receipt: null, reasonCode, stage });
    if (files.length) assert.equal(diagnostics?.candidateCount, files.length);
    assert.equal(await inspectEvidenceUploadInDrive(fetcher, f.inspection), null); assert.equal(writes, 0);
  }
  for (const extra of [{ nextPageToken: 'more' }, { incompleteSearch: true }]) {
    await assert.rejects(diagnoseEvidenceUploadInDrive(async () => Response.json({ files: [f.file], ...extra }), f.inspection), { code: 'GOOGLE_UPLOAD_VERIFICATION_INCOMPLETE' });
  }
  for (const part of ['bytes', 'parent', 'root'] as const) {
    const fetcher: GoogleFetch = async (url, init) => {
      const target = new URL(String(url));
      if (part === 'bytes' && target.searchParams.get('alt') === 'media') return new Response('x'.repeat(f.input.bytes.length));
      const response = await f.fetcher(url, init);
      if ((part === 'parent' && target.pathname.endsWith('/synthetic-drive-folder')) || (part === 'root' && target.pathname.endsWith('/synthetic-project-root'))) {
        const payload = await response.json(); payload.appProperties.claimCenterCaseId = 'other-project'; return Response.json(payload);
      }
      return response;
    };
    assert.deepEqual(await diagnoseEvidenceUploadInDrive(fetcher, f.inspection), { receipt: null,
      reasonCode: part === 'bytes' ? 'BYTES_MISMATCH' : part === 'parent' ? 'PARENT_MISMATCH' : 'PROJECT_ROOT_MISMATCH',
      stage: part === 'bytes' ? 'CONTENT_VERIFY' : part === 'parent' ? 'PARENT_VERIFY' : 'ROOT_VERIFY' });
  }
  assert.equal(f.count().writes, 0);
});

test('CF150 broader admin search retains exact upload attribution and existing bounded wrapper', async () => {
  const f = await fixture(); const queries: string[] = [];
  const fetcher: GoogleFetch = async (url, init) => {
    const query = new URL(String(url)).searchParams.get('q'); if (query) queries.push(query);
    return f.fetcher(url, init);
  };
  assert.equal((await diagnoseEvidenceUploadInDrive(fetcher, f.inspection, 'PROJECT_ACTOR')).reasonCode, 'VERIFIED');
  assert.equal(queries[0].includes('createdTime'), false);
  for (const key of ['claimCenterCaseId', 'claimCenterCategory', 'claimCenterUploadedBy']) assert.ok(queries[0].includes(key));
  await inspectEvidenceUploadInDrive(fetcher, f.inspection); assert.ok(queries[1].includes('createdTime'));
  const old = { ...f.file, appProperties: { ...f.file.appProperties, claimCenterUploadedAt: '2026-09-29T00:00:00Z' } };
  const result = await diagnoseEvidenceUploadInDrive(async () => Response.json({ files: [old] }), f.inspection, 'PROJECT_ACTOR');
  assert.equal(result.reasonCode, 'NO_FINGERPRINT_MATCH'); assert.equal(result.receipt, null); assert.equal(f.count().writes, 0);
});

test('CF153 mismatch counts explain each rejection without changing UNKNOWN or writing', async () => {
  const f = await fixture();
  const files = [
    { ...f.file, appProperties: { ...f.file.appProperties, claimCenterCaseId: 'other' } },
    { ...f.file, appProperties: { ...f.file.appProperties, claimCenterUploadedAt: '2026-01-01T00:00:00Z' } },
    { ...f.file, appProperties: { ...f.file.appProperties, claimCenterEvidenceId: 'invalid' } },
    { ...f.file, name: '[FINAL_v2] original.hwp' },
    { ...f.file, name: '[FINAL_v1] different.hwp' }
  ];
  let reads = 0;
  const result = await diagnoseEvidenceUploadInDrive(async (_url, init) => {
    assert.ok(!init?.method || init.method === 'GET'); reads++;
    return Response.json({ files });
  }, f.inspection, 'PROJECT_ACTOR');
  assert.equal(reads, 1); assert.equal(result.receipt, null); assert.equal(result.reasonCode, 'NO_FINGERPRINT_MATCH');
  assert.deepEqual(result.diagnostics, { candidateCount: 5, matchedCount: 0,
    rejected: { attribution: 1, time: 1, evidenceId: 1, version: 1, fingerprint: 1 } });
  assert.ok(!JSON.stringify(result).includes('different.hwp'));
});

test('CF150 wrong category folder or another project root cannot be declared stored', async () => {
  const f = await fixture();
  for (const part of ['category', 'root']) {
    const fetcher: GoogleFetch = async (url, init) => {
      if (String(url).includes(part === 'category' ? '/synthetic-drive-folder?' : '/synthetic-project-root?')) {
        const response = await f.fetcher(url, init); const folder = await response.json();
        if (part === 'category') folder.appProperties.claimCenterFolderKind = 'SITE_PHOTO';
        else folder.appProperties.claimCenterCaseId = 'other-project';
        return Response.json(folder);
      }
      return f.fetcher(url, init);
    };
    assert.equal(await inspectEvidenceUploadInDrive(fetcher, f.inspection), null);
  }
  assert.equal(f.count().writes, 0);
});

test('CF150 exact duplicate reuse retains native-source integrity metadata', async () => {
  const f = await fixture();
  const response = duplicateEvidenceResponse({ id: EVIDENCE, category: 'REPORT_REFERENCE', originalName: 'original.hwp', mimeType: f.input.mimeType, byteSize: f.input.bytes.length, sha256: f.input.sha256, chunkCount: 0, storageProvider: 'GOOGLE_DRIVE', uploadedBy: '검수', uploadedAt: TIME });
  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.equal(payload.file.sha256, f.input.sha256); assert.equal(payload.file.byteSize, f.input.bytes.length); assert.equal(payload.file.downloadUrl, `/api/cases/evidence/${EVIDENCE}/download`);
});
