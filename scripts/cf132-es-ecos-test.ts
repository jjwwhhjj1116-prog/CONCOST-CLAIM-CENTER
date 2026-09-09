import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEsEcosSources, ES_ECOS_ITEMS, fetchEsEcosSources, mergeEsSourceCandidates, type EsEcosItem } from '../packages/document-engine/src/es-ecos';
import { newEsInput, validateEsInput, type EsInput } from '../packages/document-engine/src/es-calculation';
import { esSourceDates, resolveEsSources, syncEsSourceDates } from '../packages/document-engine/src/es-source-history';

// Synthetic key/values only. Official response shape and mapper-verified four top-level codes.
const KEY = 'CF132SYNTHETICKEY0123456789';
const expectedItems = [['201AA', '광산품'], ['3AA', '공산품'], ['4AA', '전력,가스,수도및폐기물'], ['101AA', '농림수산품']] as const;
const values: Record<string, string[]> = { '202405': ['131.01', '132.02', '133.03', '134.04'], '202604': ['141.001', '142.002', '143.003', '144.004'], '202605': ['151.1', '152.2', '153.3', '154.4'] };
type Json = Record<string, any>;
function fixture(change?: (body: Json, url: URL) => Json | Response) {
  const calls: URL[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input)); calls.push(url);
    const parts = url.pathname.split('/').filter(Boolean);
    assert.equal(url.origin, 'https://ecos.bok.or.kr'); assert.equal(parts[0], 'api'); assert.equal(parts[1], 'StatisticSearch');
    assert.equal(parts[2], KEY); assert.deepEqual(parts.slice(3, 9), ['json', 'kr', '1', '1', '404Y014', 'M']);
    assert.equal(parts[9], parts[10]); assert.match(parts[9], /^\d{6}$/); assert.equal(init?.redirect, 'error'); assert.ok(init?.signal);
    const position = expectedItems.findIndex(([code]) => code === parts[11]); assert.ok(position >= 0, 'only the four verified top-level series may be queried');
    const [code, name] = expectedItems[position];
    let payload: Json = { StatisticSearch: { list_total_count: 1, row: [{ STAT_CODE: '404Y014', STAT_NAME: '생산자물가지수(기본분류)', ITEM_CODE1: code, ITEM_NAME1: name, ITEM_CODE2: null, ITEM_CODE3: null, ITEM_CODE4: null, UNIT_NAME: '2020=100', TIME: parts[9], DATA_VALUE: values[parts[9]]?.[position] ?? '121.01' }] } };
    const changed = change?.(payload, url); if (changed instanceof Response) return changed; if (changed) payload = changed;
    return Response.json(payload);
  };
  return { fetcher, calls };
}
function sourceInput(): EsInput {
  const input = newEsInput(); input.title = 'CF132 합성 자료 병합'; input.baseDate = '2024-06-15'; input.adjustmentDate = '2026-05-01'; input.contractAmount = '123456789'; input.costs['11'] = '120000';
  for (const [index, key] of (['base', 'current', 'previous'] as const).entries()) {
    const p = key === 'base' ? input.base : input[key].period;
    p.date = esSourceDates(input)[index]; p.wage = String(200000 + index); p.materials = ['111.01', '112.02', '113.03', '114.04'];
    p.rates = { injury: '1', safety: '2', employment: '3', retirement: '4', health: '5', pension: '6', care: '7' }; p.source = '검수자가 확인한 합성 수동 출처 ' + key;
  }
  for (const c of [input.current, input.previous]) for (const pair of [c.machinery, ...c.standards]) Object.assign(pair, { baseAverage: '100', comparisonAverage: '110', commonCount: '2', source: '보존할 기간쌍 출처', baseSum: '200', comparisonSum: '220', baseLabel: '기준', comparisonLabel: '현재' });
  input.sourceHistory = { hash: 'a'.repeat(64), months: [], rates: [], machinery: [], standards: [] };
  return input;
}
function missingCandidate(input: EsInput): EsInput {
  const next = structuredClone(input);
  for (const p of [next.base, next.current.period, next.previous.period]) { p.wage = ''; p.materials = ['', '', '', '']; for (const k of Object.keys(p.rates) as (keyof typeof p.rates)[]) p.rates[k] = ''; p.source = '조회 후보의 누락 자료'; }
  for (const c of [next.current, next.previous]) for (const p of [c.machinery, ...c.standards]) for (const k of ['baseAverage', 'comparisonAverage', 'commonCount', 'source', 'baseSum', 'comparisonSum', 'baseLabel', 'comparisonLabel'] as const) p[k] = '';
  return next;
}

test('CF132 ECOS requests exact 2020=100 top-level codes and distinct material months, preserving decimal strings and provenance', async () => {
  assert.deepEqual(ES_ECOS_ITEMS, expectedItems);
  const dates = ['2024-06-15', '2026-05-01', '2026-04-30'], before = [...dates], mock = fixture();
  const response = await fetchEsEcosSources(KEY, dates, mock.fetcher);
  assert.deepEqual(dates, before); assert.deepEqual(response.warnings, []); assert.equal(mock.calls.length, 8);
  assert.deepEqual(response.items.map(i => [i.date, i.month, i.materials]), [
    ['2024-06-15', '2024-05', values['202405']], ['2026-05-01', '2026-04', values['202604']], ['2026-04-30', '2026-04', values['202604']],
  ]);
  for (const item of response.items) { assert.match(item.checkedAt, /^\d{4}-\d{2}-\d{2}T/); for (const text of ['404Y014', '2020=100', item.month, '201AA,3AA,4AA,101AA', item.checkedAt]) assert.ok(item.source.includes(text)); }
  assert.ok(!JSON.stringify(response).includes(KEY));
});

test('CF132 duplicate dates produce one verified item per date usable by the strict apply helper', async () => {
  const mock = fixture(), response = await fetchEsEcosSources(KEY, ['2026-04-30', '2026-04-30'], mock.fetcher);
  assert.equal(mock.calls.length, 4); assert.equal(response.items.length, 1);
  const input = sourceInput(); assert.doesNotThrow(() => applyEsEcosSources(input, response.items));
});

test('CF132 malformed keys/dates never issue a provider call', async () => {
  const mock = fixture();
  for (const key of ['', 'sample', 'short', 'x'.repeat(101), 'https://example.invalid', KEY + '/', KEY + ' ', '_'.repeat(20)]) await assert.rejects(fetchEsEcosSources(key, ['2026-04-30'], mock.fetcher), /ES_ECOS_KEY_REQUIRED/);
  for (const dates of [[], [''], ['2026-02-29'], ['2026-04-31'], ['2026-1-01'], Array(4).fill('2026-04-30')]) await assert.rejects(fetchEsEcosSources(KEY, dates, mock.fetcher), /ES_SOURCE_INVALID_DATE/);
  assert.equal(mock.calls.length, 0);
});

for (const [label, mutate] of [
  ['wrong table', (row: Json) => { row.STAT_CODE = '404Y015'; }],
  ['wrong mining subcategory', (row: Json) => { row.ITEM_CODE1 = '301AA'; }],
  ['wrong electricity subcategory', (row: Json) => { row.ITEM_CODE1 = '401AA'; }],
  ['lookalike item name', (row: Json) => { row.ITEM_NAME1 += ' 일부'; }],
  ['2015 base year', (row: Json) => { row.UNIT_NAME = '2015=100'; }],
  ['percent unit', (row: Json) => { row.UNIT_NAME = '%'; }],
  ['latest month instead of requested', (row: Json) => { row.TIME = '202609'; }],
  ['nested classification', (row: Json) => { row.ITEM_CODE2 = 'NOT-TOTAL'; }],
  ['absent data', (row: Json) => { row.DATA_VALUE = ''; }],
  ['zero index', (row: Json) => { row.DATA_VALUE = '0'; }],
  ['negative index', (row: Json) => { row.DATA_VALUE = '-1'; }],
  ['non-string value', (row: Json) => { row.DATA_VALUE = 123.45; }],
  ['nonfinite value', (row: Json) => { row.DATA_VALUE = 'Infinity'; }],
] as const) test(`CF132 ${label} rejects the entire material month without a partial quartet`, async () => {
  const mock = fixture(body => { if (body.StatisticSearch.row[0].ITEM_CODE1 === '201AA') mutate(body.StatisticSearch.row[0]); return body; });
  const response = await fetchEsEcosSources(KEY, ['2026-04-30'], mock.fetcher);
  assert.deepEqual(response.items, []); assert.equal(response.warnings.length, 1); assert.match(response.warnings[0], /2026-04/); assert.ok(!JSON.stringify(response).includes(KEY));
});

test('CF132 duplicate/missing response rows and provider INFO-200 never become an empty successful month', async () => {
  for (const mutate of [
    (body: Json) => { body.StatisticSearch.row.push({ ...body.StatisticSearch.row[0] }); body.StatisticSearch.list_total_count = 2; return body; },
    (body: Json) => { body.StatisticSearch.row = []; body.StatisticSearch.list_total_count = 0; return body; },
    () => ({ RESULT: { CODE: 'INFO-200', MESSAGE: '해당 자료 없음' } }),
    () => ({ RESULT: { CODE: 'ERROR-100', MESSAGE: '인증키 오류 ' + KEY } }),
  ]) {
    const response = await fetchEsEcosSources(KEY, ['2026-04-30'], fixture(mutate).fetcher);
    assert.deepEqual(response.items, []); assert.ok(response.warnings.length); assert.ok(!JSON.stringify(response).includes(KEY));
  }
});

test('CF132 upstream failures and oversized payloads are redacted and preserve successful independent months only', async () => {
  for (const response of [() => new Response('private key ' + KEY, { status: 403 }), () => new Response('not-json ' + KEY), () => new Response(JSON.stringify({ large: 'x'.repeat(100001) })), () => { throw new Error('https://ecos.bok.or.kr/api/' + KEY); }]) {
    const mock = fixture((body, url) => url.pathname.includes('/202405/') ? response() : body);
    const result = await fetchEsEcosSources(KEY, ['2024-06-15', '2026-04-30'], mock.fetcher);
    assert.deepEqual(result.items.map(i => i.date), ['2026-04-30']); assert.equal(result.warnings.length, 1); assert.ok(!JSON.stringify(result).includes(KEY));
  }
});

test('CF132 candidate merge preserves reviewed same-date missing values, pairs and source workbook hash without mutating either caller', () => {
  const existing = sourceInput(), candidate = missingCandidate(existing), before = structuredClone(existing), proposed = structuredClone(candidate);
  const merged = mergeEsSourceCandidates(existing, candidate);
  for (const key of ['base', 'current', 'previous'] as const) {
    const old = key === 'base' ? existing.base : existing[key].period, next = key === 'base' ? merged.base : merged[key].period;
    assert.equal(next.wage, old.wage); assert.deepEqual(next.materials, old.materials); assert.deepEqual(next.rates, old.rates); assert.ok(next.source.includes(old.source));
    if (key !== 'base') { assert.deepEqual(merged[key].machinery, existing[key].machinery); assert.deepEqual(merged[key].standards, existing[key].standards); }
  }
  assert.deepEqual(merged.sourceHistory, existing.sourceHistory); assert.deepEqual(existing, before); assert.deepEqual(candidate, proposed);
});

test('CF132 candidate merge never carries stale values into a different date or hides explicit zero', () => {
  const existing = sourceInput(), candidate = missingCandidate(existing);
  candidate.current.period.date = '2026-05-02'; existing.base.materials[0] = '0'; existing.base.rates.health = '0'; candidate.base.materials[0] = '999'; candidate.base.rates.health = '999';
  const merged = mergeEsSourceCandidates(existing, candidate);
  assert.equal(merged.base.materials[0], '0'); assert.equal(merged.base.rates.health, '0');
  assert.deepEqual(merged.current.period, candidate.current.period); assert.deepEqual(merged.current.machinery, candidate.current.machinery);
});

test('CF132 failed lookup candidate cannot erase prior ECOS or manual source values when applied later', async () => {
  const existing = sourceInput(); existing.current.period.source += ' / [ECOS 404Y014 / 2020=100 / 월 2026-04 / 합성검증]';
  const candidate = resolveEsSources(existing).input;
  const merged = mergeEsSourceCandidates(existing, candidate);
  const failed = await fetchEsEcosSources(KEY, esSourceDates(existing), (async () => { throw new Error('synthetic failure'); }) as typeof fetch);
  const applied = applyEsEcosSources(merged, failed.items);
  for (const key of ['base', 'current', 'previous'] as const) {
    const old = key === 'base' ? existing.base : existing[key].period, next = key === 'base' ? applied.base : applied[key].period;
    assert.equal(next.wage, old.wage); assert.deepEqual(next.materials, old.materials); assert.deepEqual(next.rates, old.rates);
  }
  assert.deepEqual(applied.sourceHistory, existing.sourceHistory);
});

test('CF132 successful ECOS apply changes only exact-date material quartets and source provenance, not wage/rates/pairs/history', async () => {
  const existing = sourceInput(), before = structuredClone(existing);
  const response = await fetchEsEcosSources(KEY, esSourceDates(existing), fixture().fetcher);
  const applied = applyEsEcosSources(existing, response.items);
  for (const key of ['base', 'current', 'previous'] as const) {
    const old = key === 'base' ? existing.base : existing[key].period, next = key === 'base' ? applied.base : applied[key].period;
    assert.deepEqual(next.materials, values[key === 'base' ? '202405' : '202604']); assert.equal(next.date, old.date); assert.equal(next.wage, old.wage); assert.deepEqual(next.rates, old.rates);
    assert.ok(next.source.includes(old.source)); assert.match(next.source, /ECOS 404Y014 \/ 2020=100/);
    if (key !== 'base') { assert.deepEqual(applied[key].machinery, existing[key].machinery); assert.deepEqual(applied[key].standards, existing[key].standards); }
  }
  assert.deepEqual(applied.sourceHistory, before.sourceHistory); assert.deepEqual(existing, before);
  assert.deepEqual(validateEsInput(applied), applied, 'normal saved-input validation retains material values and provenance');
});

test('CF132 apply rejects duplicates, wrong month/base year and incomplete quartets atomically', async () => {
  const existing = sourceInput(), before = structuredClone(existing), items = (await fetchEsEcosSources(KEY, esSourceDates(existing), fixture().fetcher)).items;
  for (const mutate of [
    (next: EsEcosItem[]) => { next.push(structuredClone(next[0])); },
    (next: EsEcosItem[]) => { next[1].month = '2026-05'; },
    (next: EsEcosItem[]) => { next[1].source = next[1].source.replace('2020=100', '2015=100'); },
    (next: EsEcosItem[]) => { next[1].materials = ['1', '2', '', '4']; },
    (next: EsEcosItem[]) => { next[1].materials.pop(); },
  ]) { const next = structuredClone(items); mutate(next); assert.throws(() => applyEsEcosSources(existing, next), /ES_ECOS_INVALID_RESPONSE/); assert.deepEqual(existing, before); }
  const unrelated = structuredClone(items); for (const item of unrelated) item.date = '2000-01-01';
  assert.deepEqual(applyEsEcosSources(existing, unrelated), existing); assert.deepEqual(applyEsEcosSources(existing, []), existing);
});

test('CF132 complete Excel candidates never replace reviewed same-date manual values; only empty reviewed cells are filled', () => {
  const existing = sourceInput(), candidate = structuredClone(existing);
  for (const p of [candidate.base, candidate.current.period, candidate.previous.period]) {
    p.wage = '999999'; p.materials = ['991', '992', '993', '994'];
    for (const k of Object.keys(p.rates) as (keyof typeof p.rates)[]) p.rates[k] = '99';
    p.source = '다른 Excel 후보 출처';
  }
  existing.base.wage = ''; existing.base.materials[2] = ''; existing.previous.period.rates.care = '';
  const before = structuredClone(existing), proposed = structuredClone(candidate), next = mergeEsSourceCandidates(existing, candidate);
  for (const key of ['base', 'current', 'previous'] as const) {
    const old = key === 'base' ? existing.base : existing[key].period, incoming = key === 'base' ? candidate.base : candidate[key].period, actual = key === 'base' ? next.base : next[key].period;
    assert.equal(actual.wage, old.wage || incoming.wage);
    assert.deepEqual(actual.materials, old.materials.map((v, i) => v || incoming.materials[i]));
    for (const k of Object.keys(old.rates) as (keyof typeof old.rates)[]) assert.equal(actual.rates[k], old.rates[k] || incoming.rates[k]);
    assert.ok(actual.source.includes(old.source));
  }
  assert.deepEqual(existing, before); assert.deepEqual(candidate, proposed);
});

test('CF132 changing only employment grade or retirement trade preserves ECOS/manual sources and every unrelated value', async () => {
  const initial = sourceInput(); initial.contract!.employmentGrade = '1등급'; initial.contract!.retirementTrade = '토목';
  initial.sourceHistory!.rates = [{ kind: 'employment', date: '2020-01-01', values: ['1.1', '2.2', '3.3', '4.4', '5.5', '6.6', '7.7'] }, { kind: 'retirement', date: '2020-01-01', values: ['11.1', '22.2'] }];
  const existing = applyEsEcosSources(initial, (await fetchEsEcosSources(KEY, esSourceDates(initial), fixture().fetcher)).items);
  for (const [grade, trade] of [[true, false], [false, true], [true, true]]) {
    const edited = structuredClone(existing);
    if (grade) edited.contract!.employmentGrade = '3등급'; if (trade) edited.contract!.retirementTrade = '건축';
    const expected = structuredClone(edited);
    for (const p of [expected.base, expected.current.period, expected.previous.period]) { if (grade) p.rates.employment = '3.3'; if (trade) p.rates.retirement = '22.2'; }
    const before = structuredClone(edited), next = syncEsSourceDates(edited, existing);
    assert.deepEqual(next, expected); assert.deepEqual(edited, before);
    assert.strictEqual(syncEsSourceDates(next), next, 'ordinary save must not reselect Excel after the targeted selector update');
  }
});

test('CF132 average-only and sum-only machinery/standard pairs survive complete or missing Excel candidates', () => {
  const existing = sourceInput();
  for (const c of [existing.current, existing.previous]) for (const [i, p] of [c.machinery, ...c.standards].entries()) {
    p.commonCount = ''; p.baseAverage = i % 2 ? '' : '100.1'; p.comparisonAverage = i % 2 ? '' : '110.2'; p.baseSum = i % 2 ? '200.3' : ''; p.comparisonSum = i % 2 ? '220.4' : '';
  }
  for (const candidate of [missingCandidate(existing), sourceInput()]) {
    const before = structuredClone(existing), next = mergeEsSourceCandidates(existing, candidate);
    for (const key of ['current', 'previous'] as const) { assert.deepEqual(next[key].machinery, existing[key].machinery); assert.deepEqual(next[key].standards, existing[key].standards); }
    assert.deepEqual(existing, before);
  }
});
