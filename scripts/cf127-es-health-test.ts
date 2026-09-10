import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchEsHealthSources } from '../apps/cloudflare/src/es-health-source';
import { newEsInput } from '../packages/document-engine/src/es-calculation';
import { esMaterialMonth, resolveEsSources, validateEsSourceHistory, type EsSourceHistory } from '../packages/document-engine/src/es-source-history';

// Public API shapes, synthetic law metadata. No customer OC or live network in this suite.
const OC = 'synthetic_cf127_oc';
test('CF136 health follows only same-origin same-query redirects and blocks secret forwarding', async () => {
  const mock = fixture(); let redirectCount = 0;
  const valid = await fetchEsHealthSources(OC, ['2026-01-01'], (async (u, init) => {
    const url = new URL(String(u));
    if (!url.searchParams.has('validated')) { url.searchParams.set('validated', '1'); redirectCount++; return new Response(null, { status: 302, headers: { location: url.href } }); }
    return mock.fetcher(u, init);
  }) as typeof fetch);
  assert.equal(valid.items[0].value, '3.595'); assert.ok(redirectCount > 0);
  for (const target of ['https://evil.invalid/', 'http://www.law.go.kr/DRF/lawSearch.do', '/signin', '?OC=changed', `?OC=${OC}&OC=changed`]) {
    let calls = 0;
    await assert.rejects(fetchEsHealthSources(OC, ['2026-01-01'], (async () => { calls++; return new Response(null, { status: 302, headers: { location: target } }); }) as typeof fetch), /REDIRECT_UNSAFE/);
    assert.equal(calls, 2, 'only the two initial law searches run; redirect destination is never contacted');
  }
});
test('CF136 health returns verified dates when a different date fails', async () => {
  const mock = fixture();
  const result = await fetchEsHealthSources(OC, ['2025-12-31', '2026-01-01'], (async (u, init) => {
    const url = new URL(String(u));
    if (url.searchParams.get('efYd')?.endsWith('20251231')) return new Response('{}', { status: 503 });
    return mock.fetcher(u, init);
  }) as typeof fetch);
  assert.deepEqual(result.items.map(i => i.date), ['2026-01-01']); assert.equal(result.warnings.length, 1);
});
const DECREE = '국민건강보험법 시행령';
const ACT = '국민건강보험법';
type JsonObject = Record<string, any>;
const row = (id: string, name: string, mst: string, date: string): JsonObject => ({
  법령ID: id, 법령명한글: name, 법령일련번호: mst, 시행일자: date,
  공포일자: '20251223', 현행연혁코드: date < '20260101' ? '연혁' : '현행',
  법령상세링크: `/DRF/lawService.do?target=eflaw&MST=${mst}&efYd=${date}&type=HTML`
});
const decreeRows = [row('002813', DECREE, '280453', '20260101'), row('002813', DECREE, '280453', '20251223')];
const actRows = [row('001971', ACT, '276651', '20260102'), row('001971', ACT, '276650', '20250101')];
const asArray = <T>(value: T | T[]): T[] => Array.isArray(value) ? value : [value];
const listing = (rows: JsonObject[], single = false): JsonObject => ({ LawSearch: {
  resultCode: '00', resultMsg: 'success', target: 'eflaw', totalCnt: String(rows.length), page: '1', numOfRows: String(rows.length),
  law: single && rows.length === 1 ? rows[0] : rows
} });
function detail(id: string, name: string, date: string): JsonObject {
  const health = id === '002813';
  const article = health ? '44' : '76';
  const paragraph = health
    ? `① 법 제73조제1항에 따른 직장가입자의 보험료율 및 같은 조 제3항에 따른 지역가입자의 보험료율은 각각 1만분의 ${date < '20260101' ? '709' : '719'}로 한다.`
    : '① 직장가입자의 보수월액보험료는 직장가입자와 다음 각 호의 구분에 따른 자가 각각 보험료액의 100분의 50씩 부담한다. 다만, 직장가입자가 교직원으로서 사립학교에 근무하는 교원이면 보험료액은 그 직장가입자가 100분의 50을, 사용자가 100분의 30을, 국가가 100분의 20을 각각 부담한다.';
  return { 법령: { 기본정보: { 법령ID: id, 법령명_한글: name, 시행일자: date, 공포일자: '20251223' },
    조문: { 조문단위: { 조문번호: article, 조문가지번호: '00', 조문여부: '조문', 조문시행일자: date,
      조문내용: `제${article}조(${health ? '보험료율 및 재산보험료부과점수당 금액' : '보험료의 부담'})`,
      항: [{ 항번호: '①', 항내용: paragraph, ...(!health ? { 호: [{ 호번호: '1.', 호내용: '1. 직장가입자가 근로자인 경우에는 제3조제2호가목에 해당하는 사업주' }] } : {}) },
        { 항번호: '②', 항내용: '② 다른 항의 숫자 100분의 30은 건강보험 총요율이 아니다.' }]
    } } } };
}
type FixtureOptions = {
  decree?: JsonObject[];
  act?: JsonObject[];
  mutateList?: (payload: JsonObject, url: URL) => JsonObject;
  mutateDetail?: (payload: JsonObject, url: URL) => JsonObject;
};
function fixture(options: FixtureOptions = {}) {
  const calls: URL[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input)); calls.push(url);
    assert.equal(url.origin, 'https://www.law.go.kr');
    assert.equal(url.searchParams.get('OC'), OC);
    assert.equal(url.searchParams.get('target'), 'eflaw');
    assert.equal(url.searchParams.get('type'), 'JSON');
    assert.equal(init?.redirect, 'manual', 'credential-bearing redirects require explicit validation');
    assert.ok(init?.signal, 'provider request has an abort deadline');
    let payload: JsonObject;
    if (url.pathname.endsWith('/lawSearch.do')) {
      assert.equal(url.searchParams.get('nw'), '1,3');
      assert.equal(url.searchParams.get('sort'), 'efdes');
      const id = url.searchParams.get('LID');
      const name = url.searchParams.get('query');
      const health = id === '002813' || name === DECREE;
      let rows = health ? options.decree ?? decreeRows : options.act ?? actRows;
      const max = url.searchParams.get('efYd')?.split('~')[1];
      if (max) rows = rows.filter(item => item.시행일자 <= max);
      payload = listing(rows, true);
      payload = options.mutateList?.(payload, url) ?? payload;
    } else {
      assert.equal(url.pathname, '/DRF/lawService.do');
      assert.equal(url.searchParams.has('ID'), false, 'ID ignores historical efYd; use MST');
      const mst = url.searchParams.get('MST'); const date = url.searchParams.get('efYd');
      assert.ok(mst); assert.ok(date);
      const selected = [...(options.decree ?? decreeRows), ...(options.act ?? actRows)].find(item => item.법령일련번호 === mst && item.시행일자 === date);
      assert.ok(selected, 'detail must use a listed MST and its exact effective date');
      payload = detail(selected.법령ID, selected.법령명한글, date);
      payload = options.mutateDetail?.(payload, url) ?? payload;
    }
    return Response.json(payload);
  }) as typeof fetch;
  return { calls, fetcher };
}

test('CF127 health uses historical MST plus efYd, including two effective dates of one MST', async () => {
  const dates = ['2025-12-31', '2026-01-01']; const original = [...dates]; const mock = fixture();
  const result = await fetchEsHealthSources(OC, dates, mock.fetcher);
  assert.deepEqual(dates, original, 'caller dates are not mutated');
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map(item => [item.date, item.value]), [['2025-12-31', '3.545'], ['2026-01-01', '3.595']]);
  for (const item of result.items) {
    assert.ok(item.source); assert.ok(item.effectiveDate);
    assert.ok(!JSON.stringify(item).includes(OC), 'stored evidence must never expose the credential');
  }
  const decreeDetails = mock.calls.filter(url => url.pathname.endsWith('/lawService.do') && url.searchParams.get('MST') === '280453');
  assert.deepEqual([...new Set(decreeDetails.map(url => url.searchParams.get('efYd')))].sort(), ['20251223', '20260101']);
});

test('CF127 health handles a single history object and deduplicates caller dates without losing evidence', async () => {
  const mock = fixture({ decree: [decreeRows[1]], act: [actRows[1]] });
  const result = await fetchEsHealthSources(OC, ['2025-12-31', '2025-12-31'], mock.fetcher);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].value, '3.545');
  assert.ok(result.items[0].source.includes('280453')); assert.ok(result.items[0].source.includes('276650'));
  assert.equal(mock.calls.length, 4, 'two law lists and two details suffice for one distinct date');
});

test('CF127 health rejects malformed credentials and dates before any upstream request', async () => {
  const calls: unknown[] = [];
  const fetcher = (async (...args: unknown[]) => { calls.push(args); throw new Error('must not request'); }) as typeof fetch;
  for (const oc of ['', 'https://law.go.kr/?OC=wrong', 'bad secret', 'a'.repeat(101)]) await assert.rejects(fetchEsHealthSources(oc, ['2026-01-01'], fetcher));
  for (const dates of [[], ['', '2026-01-01'], ['2026-02-29'], ['2026-04-31'], ['2026-1-01'], ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']]) await assert.rejects(fetchEsHealthSources(OC, dates, fetcher));
  assert.equal(calls.length, 0);
});

test('CF127 health rejects multiple law masters at the same effective date', async () => {
  const mock = fixture({ decree: [decreeRows[0], row('002813', DECREE, '999999', '20260101')] });
  await assert.rejects(fetchEsHealthSources(OC, ['2026-01-01'], mock.fetcher), /AMBIGUOUS/);
});

test('CF127 health ignores an unrelated exact-query lookalike instead of selecting it', async () => {
  const mock = fixture({ mutateList(payload) {
    payload.LawSearch.law = [row('999999', '국민건강보험법 시행규칙', '999999', '20260101'), ...asArray<JsonObject>(payload.LawSearch.law)];
    return payload;
  } });
  const result = await fetchEsHealthSources(OC, ['2026-01-01'], mock.fetcher);
  assert.equal(result.items[0].value, '3.595');
  assert.ok(!mock.calls.some(url => url.searchParams.get('MST') === '999999'));
});

test('CF127 health rejects a future-effective article even if law-level date matches', async () => {
  const mock = fixture({ mutateDetail(payload) { payload.법령.조문.조문단위.조문시행일자 = '20990101'; return payload; } });
  await assert.rejects(fetchEsHealthSources(OC, ['2026-01-01'], mock.fetcher));
});

test('CF127 health failures redact credential-bearing upstream errors and reject oversized bodies', async () => {
  const error = await fetchEsHealthSources(OC, ['2026-01-01'], (async () => { throw new Error(`upstream https://www.law.go.kr/?OC=${OC}`); }) as typeof fetch).then(() => null, e => e);
  assert.ok(error instanceof Error); assert.ok(!error.message.includes(OC)); assert.ok(!error.message.includes('https://'));
  await assert.rejects(fetchEsHealthSources(OC, ['2026-01-01'], (async () => new Response(JSON.stringify({ tooLarge: 'x'.repeat(1_000_001) }))) as typeof fetch));
});

test('CF127 health rejects a mismatching detail law identity instead of returning a rate', async () => {
  const mock = fixture({ mutateDetail(payload) { payload.법령.기본정보.법령ID = '999999'; return payload; } });
  await assert.rejects(fetchEsHealthSources(OC, ['2026-01-01'], mock.fetcher));
});

test('CF127 health rejects a mismatching detail effective date instead of using the latest law', async () => {
  const mock = fixture({ mutateDetail(payload) { payload.법령.기본정보.시행일자 = '20270101'; return payload; } });
  await assert.rejects(fetchEsHealthSources(OC, ['2025-12-31'], mock.fetcher));
});

test('CF127 health does not select future-only history or manufacture zero for missing history', async () => {
  const mock = fixture({ decree: [row('002813', DECREE, '999991', '20300101')] });
  await assert.rejects(fetchEsHealthSources(OC, ['2026-01-01'], mock.fetcher));
  assert.ok(!mock.calls.some(url => url.searchParams.get('MST') === '999991'));
});

test('CF127 health treats HTTP 200 provider error as failure rather than an empty successful lookup', async () => {
  const mock = fixture({ mutateList() { return { LawSearch: { resultCode: '99', resultMsg: 'denied', totalCnt: '0' } }; } });
  await assert.rejects(fetchEsHealthSources(OC, ['2026-01-01'], mock.fetcher));
});

test('CF127 health does not parse another paragraph as the health premium rate', async () => {
  const mock = fixture({ mutateDetail(payload) {
    if (payload.법령.기본정보.법령ID === '002813') {
      const article = payload.법령.조문.조문단위;
      article.항 = asArray<JsonObject>(article.항).filter(item => item.항번호 !== '①');
      article.항[0].항내용 = '② 직장가입자의 보험료율은 1만분의 999로 한다.';
    }
    return payload;
  } });
  await assert.rejects(fetchEsHealthSources(OC, ['2026-01-01'], mock.fetcher));
});

test('CF127 health rejects incomplete employer share evidence', async () => {
  const mock = fixture({ mutateDetail(payload) {
    if (payload.법령.기본정보.법령ID === '001971') payload.법령.조문.조문단위.항 = [{ 항번호: '①', 항내용: '① 사업주는 100분의 30을 부담한다.' }];
    return payload;
  } });
  await assert.rejects(fetchEsHealthSources(OC, ['2026-01-01'], mock.fetcher));
});

for (const [label, fetcher] of [
  ['HTTP error', async () => new Response('unavailable', { status: 503 })],
  ['malformed JSON', async () => new Response('<html>provider failed</html>', { status: 200 })],
  ['network error', async () => { throw new Error('network failure'); }]
] as const) test(`CF127 health ${label} cannot produce source values`, async () => {
  await assert.rejects(fetchEsHealthSources(OC, ['2026-01-01'], fetcher as typeof fetch));
});

function sourceHistory(): EsSourceHistory {
  return {
    hash: 'a'.repeat(64),
    months: [
      { month: '2025-12', wage: '100', materials: ['101', '102', '103', '104'], injury: '3.5' },
      { month: '2026-01', wage: '110', materials: ['201', '202', '203', '204'], injury: '3.6' },
      { month: '2099-12', wage: '999', materials: ['999', '999', '999', '999'], injury: '99' }
    ],
    rates: [
      { kind: 'health', date: '2025-01-01', values: ['3.545'] },
      { kind: 'health', date: '2026-01-01', values: ['3.595'] },
      { kind: 'health', date: '2099-01-01', values: ['99'] },
      { kind: 'pension', date: '2025-01-01', values: ['4.5'] },
      { kind: 'pension', date: '2026-01-01', values: ['4.75'] },
      { kind: 'care', date: '2025-01-01', values: ['12.95'] },
      { kind: 'employment', date: '2025-01-01', values: ['1', '2', '3', '4', '5', '6', '7'] },
      { kind: 'retirement', date: '2025-01-01', values: ['2.1', '2.3'] }
    ],
    standards: [], machinery: []
  };
}
function sourceInput() {
  const input = newEsInput(); input.baseDate = '2025-12-31'; input.adjustmentDate = '2026-01-01';
  input.sourceHistory = sourceHistory(); input.contract!.employmentGrade = '3등급'; input.contract!.retirementTrade = '건축';
  input.base.rates.safety = '2.5'; input.current.period.rates.safety = '2.8'; input.previous.period.rates.safety = '2.6';
  return input;
}

test('CF127 material source month handles month-end, leap-year and January without Date rollover', () => {
  for (const [date, expected] of [['2026-01-01', '2025-12'], ['2026-01-31', '2026-01'], ['2024-02-28', '2024-01'], ['2024-02-29', '2024-02'], ['2025-02-28', '2025-02']]) {
    assert.equal(esMaterialMonth(date), expected);
  }
  for (const invalid of ['', '2026-02-29', '2026-04-31', '2026-13-01', '2026-1-01']) assert.throws(() => esMaterialMonth(invalid));
});

test('CF127 source resolver chooses exact wage/material months and historical rates for all three contexts', () => {
  const input = sourceInput(); const original = structuredClone(input); const result = resolveEsSources(input);
  assert.deepEqual(input, original, 'source lookup never mutates the caller');
  assert.deepEqual(result.input.costs, input.costs); assert.deepEqual(result.input.contract, input.contract);
  assert.equal(result.input.base.date, '2025-12-31'); assert.equal(result.input.current.period.date, '2026-01-01'); assert.equal(result.input.previous.period.date, '2025-12-31');
  assert.equal(result.input.base.wage, '100'); assert.equal(result.input.current.period.wage, '110'); assert.equal(result.input.previous.period.wage, '100');
  assert.deepEqual(result.input.current.period.materials, ['101', '102', '103', '104']);
  assert.equal(result.input.base.rates.health, '3.545'); assert.equal(result.input.current.period.rates.health, '3.595'); assert.equal(result.input.previous.period.rates.health, '3.545');
  assert.equal(result.input.current.period.rates.employment, '3'); assert.equal(result.input.current.period.rates.retirement, '2.3');
  assert.ok(result.input.current.period.source.includes('aaaaaaaaaaaa'));
});

test('CF127 missing or duplicate source months are unresolved, never latest-value fallbacks', () => {
  for (const change of [
    (history: EsSourceHistory) => { history.months = history.months.filter(r => r.month !== '2025-12'); },
    (history: EsSourceHistory) => { history.months.push(structuredClone(history.months[0])); }
  ]) {
    const input = sourceInput(); change(input.sourceHistory!); const result = resolveEsSources(input);
    assert.equal(result.input.base.wage, ''); assert.deepEqual(result.input.current.period.materials, ['', '', '', '']);
    assert.ok(result.warnings.length); assert.equal(result.input.current.period.wage, '110');
  }
});

test('CF127 duplicate effective rates are unresolved and unknown employment/trade categories are not guessed', () => {
  const input = sourceInput(); input.sourceHistory!.rates.push({ kind: 'health', date: '2026-01-01', values: ['99'] });
  input.contract!.employmentGrade = 'unknown'; input.contract!.retirementTrade = 'unknown';
  const result = resolveEsSources(input);
  assert.equal(result.input.current.period.rates.health, ''); assert.equal(result.input.base.rates.health, '3.545');
  assert.equal(result.input.current.period.rates.employment, ''); assert.equal(result.input.current.period.rates.retirement, '');
  assert.ok(result.warnings.length);
});

test('CF127 empty source values remain empty while explicit zero remains zero', () => {
  const input = sourceInput(); input.sourceHistory!.months[0].materials = ['0', '', '103', '104'];
  const result = resolveEsSources(input);
  assert.deepEqual(result.input.current.period.materials, ['0', '', '103', '104']);
});

test('CF127 absent source history preserves date-aligned existing inputs and returns an explicit warning', () => {
  const input = sourceInput(); delete input.sourceHistory; input.base.wage = 'preserve';
  input.base.date = input.baseDate; input.current.period.date = input.adjustmentDate; input.previous.period.date = '2025-12-31';
  const result = resolveEsSources(input);
  assert.deepEqual(result.input, input); assert.notEqual(result.input, input); assert.ok(result.warnings.length);
});

test('CF127 source history validation rejects invalid dates, shape, amounts and fingerprints', () => {
  assert.deepEqual(validateEsSourceHistory(sourceHistory()), sourceHistory());
  for (const change of [
    (h: EsSourceHistory) => { h.hash = 'wrong'; },
    (h: EsSourceHistory) => { h.months[0].month = '2026-13'; },
    (h: EsSourceHistory) => { h.months[0].wage = 'NaN'; },
    (h: EsSourceHistory) => { h.rates[0].date = '2025-02-29'; },
    (h: EsSourceHistory) => { h.rates[0].values = ['1', '2']; },
    (h: EsSourceHistory) => { h.machinery = [{ year: 'not-year', rows: [['1', '1']] }]; }
  ]) { const h = sourceHistory(); change(h); assert.throws(() => validateEsSourceHistory(h)); }
});
