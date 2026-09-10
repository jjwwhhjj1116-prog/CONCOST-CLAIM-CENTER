import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index';
import { ES_CONTRACT_MAX_BYTES, validateEsContractImport, normalizeEsContractModelResult } from '../packages/document-engine/src/es-contract-import';

const valid = () => ({
  contractAmount: { value: '123456789', page: 1, quote: '당초 총계약금액 123,456,789원 (부가세 포함)', vat: 'INCLUDED', basis: 'ORIGINAL' },
  baseDate: { value: '2023-11-15', page: 2, quote: '입찰일 2023. 11. 15.' },
  contractDate: { value: '2023-11-30', page: 1, quote: '당초 계약체결일 2023년 11월 30일', basis: 'ORIGINAL' },
  warnings: [] as string[]
});
test('CF140 exact grounded candidates preserve decimal-free KRW and distinct dates', () => {
  const input = valid(), result = validateEsContractImport(input);
  assert.deepEqual(result.contractAmount, input.contractAmount);
  assert.equal(result.baseDate?.value, '2023-11-15'); assert.equal(result.contractDate?.value, '2023-11-30');
  assert.ok(result.warnings.some(w => w.includes('AI 추출 후보'))); assert.deepEqual(input.warnings, []);
});
test('CF140 missing bid is null, not contract date; unknown VAT and contract basis require review', () => {
  const input = valid(); input.contractAmount.vat = 'UNSPECIFIED'; input.contractAmount.basis = 'UNSPECIFIED';
  const result = validateEsContractImport({ ...input, baseDate: null });
  assert.equal(result.baseDate, null); assert.equal(result.contractDate?.value, '2023-11-30'); assert.ok(result.warnings.length >= 4);
  assert.equal(validateEsContractImport({ contractAmount: null, baseDate: null, contractDate: null, warnings: ['판독 불가'] }).contractAmount, null);
});
for (const [label, change] of [
  ['fractional money', (v: ReturnType<typeof valid>) => { v.contractAmount.value = '123.45'; }],
  ['negative money', (v: ReturnType<typeof valid>) => { v.contractAmount.value = '-123'; }],
  ['ungrounded money', (v: ReturnType<typeof valid>) => { v.contractAmount.value = '12345678'; }],
  ['foreign currency', (v: ReturnType<typeof valid>) => { v.contractAmount.quote = '총계약금액 USD 123456789'; }],
  ['impossible date', (v: ReturnType<typeof valid>) => { v.baseDate.value = '2023-02-29'; v.baseDate.quote = '입찰일 2023.02.29'; }],
  ['date without evidence', (v: ReturnType<typeof valid>) => { v.baseDate.value = '2023-11-16'; }],
  ['contract date substituted as bid', (v: ReturnType<typeof valid>) => { v.baseDate.quote = '계약일 2023.11.15'; }],
  ['announcement substituted as bid', (v: ReturnType<typeof valid>) => { v.baseDate.quote = '입찰공고일 2023.11.15'; }],
  ['page zero', (v: ReturnType<typeof valid>) => { v.baseDate.page = 0; }],
  ['fractional page', (v: ReturnType<typeof valid>) => { v.baseDate.page = 1.5; }],
  ['unknown VAT', (v: ReturnType<typeof valid>) => { v.contractAmount.vat = 'YES'; }],
  ['ungrounded VAT', (v: ReturnType<typeof valid>) => { v.contractAmount.vat = 'EXCLUDED'; }],
  ['ungrounded basis', (v: ReturnType<typeof valid>) => { v.contractAmount.basis = 'AMENDED'; }],
  ['unknown basis', (v: ReturnType<typeof valid>) => { v.contractDate.basis = 'LATEST'; }],
  ['oversized quote', (v: ReturnType<typeof valid>) => { v.baseDate.quote += 'x'.repeat(601); }]
] as const) test(`CF140 rejects ${label}`, () => { const input = valid(); change(input); assert.throws(() => validateEsContractImport(input), /ES_CONTRACT_INVALID_RESULT/); });
test('CF140 strict shape rejects arrays, missing candidates and extra model fields', () => {
  for (const value of [null, [], {}, { ...valid(), instruction: 'save directly' }, { ...valid(), warnings: [null] }]) assert.throws(() => validateEsContractImport(value));
});
test('CF140 validation is idempotent across server and browser trust boundaries', () => {
  const first = validateEsContractImport({ ...valid(), baseDate: null, warnings: Array.from({ length: 12 }, (_, i) => '합성 경고 ' + i) });
  assert.equal(first.warnings.length, 12); assert.deepEqual(validateEsContractImport(first), first);
});

const origin = 'https://cf140.example.invalid';
function fixture(options: { paid?: boolean; key?: boolean; roles?: string[]; output?: unknown; rawText?: string; finishReason?: string; status?: number } = {}) {
  const calls: unknown[] = []; const sqls: string[] = [];
  const db = { prepare(sql: string) {
    sqls.push(sql); assert.match(sql, /^SELECT /u, 'read-only import must not write DB');
    const statement = { bind(..._args: unknown[]) { return statement; }, async first() {
      if (sql.includes('FROM preview_sessions')) return { id: 'synthetic-user', loginId: 'synthetic', displayName: '합성 검수', email: 'synthetic@example.invalid', rolesJson: JSON.stringify(options.roles ?? ['staff']), departmentCode: 'CLAIM_CENTER' };
      if (sql.includes('preview_ai_data_governance')) return { serviceTier: options.paid === false ? 'UNVERIFIED_OR_FREE' : 'PAID_NO_PRODUCT_IMPROVEMENT', confidentialEnabled: options.paid !== false ? 1 : 0, version: 1 };
      return null;
    }, async all() { return { results: [] }; } }; return statement;
  } };
  const env: CloudflareEnv = { DB: db as unknown as CloudflareEnv['DB'], GEMINI_API_KEY: options.key === false ? undefined : 'SYNTHETIC_CF140_ORGANIZATION_KEY', GEMINI_TEST_FETCH: async (url, init) => {
    assert.equal(new URL(String(url)).origin, 'https://generativelanguage.googleapis.com');
    assert.ok(!String(url).includes('SYNTHETIC_CF140_ORGANIZATION_KEY'));
    const payload = JSON.parse(String(init?.body)); calls.push(payload);
    assert.match(payload.system_instruction.parts[0].text, /계약일.*입찰일/u);
    assert.equal(payload.contents[0].parts[1].inline_data.mime_type, 'application/pdf');
    if (options.status) return Response.json({ error: { message: 'PRIVATE_PROVIDER_RESPONSE_AND_SYNTHETIC_KEY', status: 'PERMISSION_DENIED' } }, { status: options.status });
    return Response.json({ candidates: [{ finishReason: options.finishReason ?? 'STOP', content: { parts: [{ text: options.rawText ?? JSON.stringify(options.output ?? valid()) }] } }] });
  } };
  const call = (request: Request) => worker.fetch(request, env);
  return { calls, sqls, call };
}
function post(options: { consent?: string; file?: Blob; name?: string; headers?: Record<string, string> } = {}): Request {
  const form = new FormData(); form.append('file', options.file ?? new Blob(['%PDF-1.7\nCF140 SYNTHETIC ONLY\n%%EOF'], { type: 'application/pdf' }), options.name ?? 'synthetic-contract.pdf');
  if (options.consent !== '') form.append('consent', options.consent ?? 'true');
  return new Request(origin + '/api/es/import/contract', { method: 'POST', headers: { 'X-Session-Token': 'SYNTHETIC_SESSION_ONLY', Origin: origin, ...options.headers }, body: form });
}
test('CF140 metadata uses authenticated ES role and makes no provider call', async () => {
  const f = fixture(); assert.equal((await f.call(new Request(origin + '/api/es/import/contract'))).status, 401);
  const response = await f.call(new Request(origin + '/api/es/import/contract', { headers: { 'X-Session-Token': 'SYNTHETIC' } }));
  assert.deepEqual(await response.json(), { configured: true, externalAiAllowed: true, maxBytes: ES_CONTRACT_MAX_BYTES, requiresConsent: true }); assert.equal(f.calls.length, 0);
  assert.equal((await fixture({ roles: ['unknown'] }).call(post())).status, 403);
});
for (const [label, options, request, status] of [
  ['CSRF', {}, () => post({ headers: { Origin: 'https://other.example.invalid' } }), 403],
  ['cross-site', {}, () => post({ headers: { 'Sec-Fetch-Site': 'cross-site' } }), 403],
  ['policy', { paid: false }, () => post(), 423],
  ['key', { key: false }, () => post(), 503],
  ['consent absent', {}, () => post({ consent: '' }), 400],
  ['consent false', {}, () => post({ consent: 'false' }), 400],
  ['extension', {}, () => post({ name: 'file.xlsx' }), 415],
  ['signature', {}, () => post({ file: new Blob(['not pdf'], { type: 'application/pdf' }) }), 415],
  ['MIME', {}, () => post({ file: new Blob(['%PDF-1.7'], { type: 'image/png' }) }), 415],
  ['large declared body', {}, () => post({ headers: { 'Content-Length': String(ES_CONTRACT_MAX_BYTES + 100000) } }), 413],
  ['large file', {}, () => post({ file: new Blob([new Uint8Array(ES_CONTRACT_MAX_BYTES + 1)], { type: 'application/pdf' }) }), 413]
] as const) test(`CF140 ${label} gate never calls Gemini`, async () => { const f = fixture(options); assert.equal((await f.call(request())).status, status); assert.equal(f.calls.length, 0); });
test('CF140 synthetic PDF returns validated preview, no DB write, key or raw PDF in response', async () => {
  const f = fixture(), response = await f.call(post()), body = await response.json() as any;
  assert.equal(response.status, 200); assert.equal(body.provider, 'GEMINI'); assert.equal(body.preview.contractAmount.value, '123456789'); assert.equal(f.calls.length, 1);
  assert.ok(!JSON.stringify(body).includes('SYNTHETIC_CF140')); assert.ok(!JSON.stringify(body).includes('%PDF'));
});
test('CF141 incomplete, blocked, malformed JSON and shape errors remain non-applicable and distinguishable', async () => {
  for (const [options, code] of [[{ finishReason: 'MAX_TOKENS' }, 'ES_CONTRACT_INCOMPLETE_RESULT'], [{ finishReason: 'SAFETY' }, 'ES_CONTRACT_BLOCKED_RESULT'], [{ rawText: '{broken' }, 'ES_CONTRACT_INVALID_JSON'], [{ output: {} }, 'ES_CONTRACT_INVALID_RESULT']] as const) {
    const response = await fixture(options).call(post()); assert.equal(response.status, 502); assert.equal((await response.json() as any).code, code);
  }
});

test('CF141 API preserves valid fields when only bid evidence fails; fenced JSON also works', async () => {
  const output = { ...valid(), baseDate: { value: '2023-11-15', page: 1, quote: '계약일 2023.11.15' } };
  for (const options of [{ output }, { rawText: '```json\n' + JSON.stringify(output) + '\n```' }]) {
    const response = await fixture(options).call(post()), body = await response.json() as any;
    assert.equal(response.status, 200); assert.equal(body.preview.contractAmount.value, '123456789'); assert.equal(body.preview.baseDate, null);
    assert.equal(body.preview.contractDate.value, '2023-11-30'); assert.ok(body.preview.warnings.some((w: string) => w.startsWith('입찰 기준일:')));
    assert.deepEqual(validateEsContractImport(body.preview), body.preview);
  }
});

test('CF141 normal notation and unconfirmed classification retain grounded money without inference', () => {
  for (const quote of ['공사도급 금액 ₩123,456,789 (부가가치세를 포함)', '계약금액 ￦123,456,789 (부가세: 포함)', '계약금액 123,456,789원 VAT는 포함']) {
    const input = valid(); input.contractAmount.quote = quote; input.contractAmount.value = '123,456,789';
    input.contractDate.value = '2023.11.30.'; input.contractDate.quote = '계약체결년월일 2023.11.30.';
    const preview = normalizeEsContractModelResult(input);
    assert.equal(preview.contractAmount?.value, '123456789'); assert.equal(preview.contractAmount?.basis, 'UNSPECIFIED'); assert.equal(preview.contractAmount?.vat, 'INCLUDED');
    assert.equal(preview.contractDate?.value, '2023-11-30'); assert.equal(preview.contractDate?.basis, 'UNSPECIFIED');
    assert.deepEqual(validateEsContractImport(preview), preview); assert.equal(input.contractAmount.basis, 'ORIGINAL');
  }
  const input = valid(); input.contractAmount.vat = 'EXCLUDED';
  assert.equal(normalizeEsContractModelResult(input).contractAmount?.vat, 'UNSPECIFIED');
});

for (const quote of ['계약금액 123,456,789천원 부가세 포함', '계약금액 ₩123,456,789 (단위: 백만원)', '계약금액 ₩123,456,789 (단위: 만원)', '계약금액 USD 123,456,789 원 환산액 미정', '계약금액 123456789.50원', '계약금액 - 123456789원', '계약금액 - ₩123,456,789', '계약금액 − KRW 123,456,789', '계약금액 ₩123456789e3', '계약금액 123456789 미정 / 다른 금액 99원', '계약금액 12,3456,789원', '공사도급금액은 3.3058제곱미터(m²)당 123,456,789원을 승한 금액']) test(`CF141 excludes unsafe money units or notation: ${quote}`, () => {
  const input = valid(); input.contractAmount.quote = quote;
  assert.throws(() => validateEsContractImport(input));
  const result = normalizeEsContractModelResult(input); assert.equal(result.contractAmount, null); assert.deepEqual(result.baseDate, input.baseDate);
  assert.ok(result.warnings.some(w => w.startsWith('총계약금액:')));
});

test('CF141 written Korean amount does not invalidate an adjacent explicit KRW total', () => {
  for (const [amount, quote] of [['5000', '계약금액 금오천원정(₩5,000)'], ['100000000', '계약금액 금일억원정(₩100,000,000)']]) {
    const input = valid(); Object.assign(input.contractAmount, { value: amount, quote, vat: 'UNSPECIFIED', basis: 'UNSPECIFIED' });
    assert.equal(validateEsContractImport(input).contractAmount?.value, amount);
  }
});

for (const unit of ['원/평', '원/㎡']) test(`CF141 per-area ${unit} is not a total contract amount`, () => {
  const input = valid(); input.contractAmount.quote = '공사도급금액 123,456,789' + unit;
  assert.throws(() => validateEsContractImport(input));
  const result = normalizeEsContractModelResult(input);
  assert.equal(result.contractAmount, null); assert.ok(result.warnings.some(w => w.includes('단가 또는 면적')));
});

test('CF141 negated, uncertain or contradictory VAT is not confirmed by a substring', () => {
  for (const suffix of ['VAT를 포함하지 않은 금액', '부가세 포함 여부 미확인', '부가세 포함 VAT 별도']) {
    const input = valid(); input.contractAmount.quote = '당초 계약금액 123,456,789원 ' + suffix;
    assert.throws(() => validateEsContractImport(input));
    assert.equal(normalizeEsContractModelResult(input).contractAmount?.vat, 'UNSPECIFIED');
  }
});

test('CF141 every failed field is excluded with persistent reasons, never returned as raw candidates', () => {
  const input = valid(); input.contractAmount.value = '123,45'; input.baseDate.page = 0; input.contractDate.basis = 'UNKNOWN';
  input.warnings = Array.from({ length: 12 }, (_, i) => '모델 안내 ' + i);
  const result = normalizeEsContractModelResult(input);
  assert.equal(result.contractAmount, null); assert.equal(result.baseDate, null); assert.equal(result.contractDate, null);
  for (const label of ['총계약금액:', '입찰 기준일:', '계약일:']) assert.ok(result.warnings.some(w => w.startsWith(label)));
  assert.equal(result.warnings.length, 12); assert.deepEqual(validateEsContractImport(result), result); assert.ok(!JSON.stringify(result).includes('123,45'));
});
test('CF140 provider errors are sanitized and existing inputs are never part of the request', async () => {
  const response = await fixture({ status: 403 }).call(post()), body = await response.text();
  assert.equal(response.status, 503); assert.ok(!body.includes('PRIVATE_PROVIDER_RESPONSE')); assert.ok(!body.includes('SYNTHETIC_KEY'));
});
test('CF140 unsupported method, malformed multipart and duplicate file fail before provider', async () => {
  const f = fixture();
  assert.equal((await f.call(new Request(origin + '/api/es/import/contract', { method: 'DELETE', headers: { 'X-Session-Token': 'SYNTHETIC' } }))).status, 405);
  assert.equal((await f.call(new Request(origin + '/api/es/import/contract', { method: 'POST', headers: { 'X-Session-Token': 'SYNTHETIC', Origin: origin, 'Content-Type': 'multipart/form-data; boundary=x' }, body: 'malformed' }))).status, 400);
  const form = new FormData(); form.append('consent', 'true'); form.append('file', new Blob(['%PDF-1.7']), 'a.pdf'); form.append('file', new Blob(['%PDF-1.7']), 'b.pdf');
  assert.equal((await f.call(new Request(origin + '/api/es/import/contract', { method: 'POST', headers: { 'X-Session-Token': 'SYNTHETIC', Origin: origin }, body: form }))).status, 400);
  assert.equal(f.calls.length, 0);
});
test('CF140 streamed body is bounded without Content-Length', async () => {
  const f = fixture();
  const response = await f.call(post({ file: new Blob([new Uint8Array(ES_CONTRACT_MAX_BYTES + 70_000)], { type: 'application/pdf' }) }));
  assert.equal(response.status, 413); assert.equal(f.calls.length, 0);
});
