import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EsDecimal, esDecimal as d } from '../packages/document-engine/src/es-decimal';
import { ES_COSTS, ES_RATE_KEYS, calculateEs, newEsInput, previousEsDay, validateEsInput, type EsInput, type EsPeriod } from '../packages/document-engine/src/es-calculation';

/** Entirely synthetic fixture. No original workbook, company, amount or API data. */
function fixture(): EsInput {
  const input = newEsInput();
  const period = (date: string, wage: string, material: string): EsPeriod => ({
    date, wage, materials: [material, material, material, material],
    rates: { injury: '3', safety: '2', employment: '1', retirement: '2', health: '2', pension: '4', care: '10' },
    source: 'Synthetic QA fixture only'
  });
  input.title = 'Synthetic ES unit fixture';
  input.baseDate = '2024-01-01'; input.adjustmentDate = '2024-03-01'; input.contractAmount = '1000000';
  input.base = period(input.baseDate, '100', '100');
  input.current.period = period(input.adjustmentDate, '105', '102');
  input.previous.period = period('2024-02-29', '104', '101');
  for (const comparison of [input.current, input.previous]) {
    comparison.machinery = { label: 'Synthetic machinery', baseAverage: '100', comparisonAverage: '105', commonCount: '10', source: 'Synthetic pair' };
    comparison.standards = comparison.standards.map(p => ({ ...p, baseAverage: '100', comparisonAverage: '105', commonCount: '10', source: 'Synthetic pair' }));
  }
  input.costs['11'] = '60000'; input.costs['18'] = '30000'; input.costs['35'] = '10000';
  return input;
}
function valid(input = fixture()) {
  const result = calculateEs(input);
  assert.equal(result.status, 'LEGACY_REPLAY', result.fatal.join('; '));
  assert.ok(result.current && result.previous && result.amount);
  assert.deepEqual(result.fatal, []);
  return result as typeof result & { current: NonNullable<typeof result.current>; previous: NonNullable<typeof result.previous>; amount: NonNullable<typeof result.amount> };
}
function invalid(input: unknown, reason?: RegExp) {
  const result = calculateEs(input);
  assert.equal(result.status, 'INCOMPLETE', JSON.stringify({ status: result.status, fatal: result.fatal, amount: result.amount }));
  assert.ok(result.fatal.length > 0);
  if (reason) assert.match(result.fatal.join('; '), reason);
  assert.equal(result.amount, undefined, 'invalid data must not yield a final amount');
  return result;
}

test('CF123 decimal: exact rational arithmetic and large integer precision', () => {
  assert.equal(d('0.1').add(d('0.2')).toString(), '0.3');
  assert.equal(d('99999999999999999999').add(d('1')).toString(), '100000000000000000000');
  assert.equal(d('1').div(d('3')).mul(d('3')).toString(), '1');
  assert.equal(new EsDecimal(2n, -4n).toString(), '-0.5');
  assert.equal(d('1.0000000000000001').sub(d('1')).toString(), '0.0000000000000001');
});

test('CF123 decimal: Excel round ties and truncation toward zero at positive/negative places', () => {
  for (const [value, places, rounded, truncated] of [
    ['2.345', 2, '2.35', '2.34'], ['-2.345', 2, '-2.35', '-2.34'],
    ['12500', -3, '13000', '12000'], ['-12500', -3, '-13000', '-12000'],
    ['0.00000001', 4, '0', '0'], ['-0.00000001', 4, '0', '0']
  ] as const) {
    assert.equal(d(value).round(places, 'ROUND').toString(), rounded);
    assert.equal(d(value).round(places, 'ROUNDDOWN').toString(), truncated);
  }
});

test('CF123 decimal: reject malformed, non-finite and unsupported precision inputs', () => {
  for (const text of ['', ' ', 'NaN', 'Infinity', '1e3', '1,000', '1.2.3', '.5', '100000000000000000000', '0.00000000000000001'])
    assert.throws(() => d(text));
  assert.throws(() => d('1').div(d('0')));
  assert.throws(() => d('1').round(21));
  assert.throws(() => d('1').round(1.5));
});

test('CF123 blank new document is incomplete, never a fake zero estimate', () => {
  const fresh = newEsInput();
  invalid(fresh);
  assert.equal(fresh.contractAmount, '');
  assert.equal(fresh.base.wage, '');
  assert.equal(fresh.current.standards.length, 5);
  assert.equal(Object.keys(fresh.costs).length, 28);
});

test('CF123 validation whitelists ownership, approval, results and unknown cost IDs', () => {
  const candidate = { ...fixture(), ownerId: 'forged', status: 'APPROVED', result: { net: '1' }, runId: 'forged', companyId: 'other' };
  candidate.costs['untrustedCost'] = '999999';
  const clean = validateEsInput(candidate) as unknown as Record<string, unknown>;
  for (const key of ['ownerId', 'status', 'result', 'runId', 'companyId']) assert.equal(clean[key], undefined);
  assert.equal((clean.costs as Record<string, string>).untrustedCost, undefined);
  valid(clean as unknown as EsInput);
});

test('CF123 validation rejects malformed schema, arrays, missing fields and oversized collections', () => {
  const sample = fixture();
  for (const bad of [null, [], {}, { ...sample, schemaVersion: 1 }, { ...sample, costs: [] },
    { ...sample, directPaid: Array(121).fill('1') }, { ...sample, current: { ...sample.current, standards: [] } },
    { ...sample, base: { ...sample.base, materials: ['1'] } }, { ...sample, note: 'x'.repeat(10001) }]) invalid(bad);
  for (const key of ES_RATE_KEYS) {
    const bad = fixture(); delete (bad.base.rates as Partial<EsPeriod['rates']>)[key]; invalid(bad);
  }
});

test('CF123 dates: leap year, month/year end and invalid calendar days', () => {
  assert.equal(previousEsDay('2024-03-01'), '2024-02-29');
  assert.equal(previousEsDay('2025-03-01'), '2025-02-28');
  assert.equal(previousEsDay('2026-01-01'), '2025-12-31');
  for (const day of ['', '2025-02-29', '2024-02-30', '2024-13-01', '2024-1-01', 'not-a-date']) assert.throws(() => previousEsDay(day));
});

test('CF123 context dates must match base/current/actual previous calendar day', () => {
  for (const target of ['base', 'current', 'previous'] as const) {
    const input = fixture();
    if (target === 'base') input.base.date = '2024-01-02'; else input[target].period.date = '2024-03-02';
    invalid(input, /날짜/);
  }
  const reversed = fixture(); reversed.baseDate = '2025-01-01'; invalid(reversed, /이전/);
});

test('CF123 synthetic baseline: 28 stable rows and independently known current/previous totals', () => {
  const result = valid();
  assert.deepEqual(result.current.rows.map(r => r.row), ES_COSTS.map(([r]) => r));
  assert.equal(result.current.denominator, '100000');
  assert.equal(result.current.weightSum, '1');
  assert.equal(result.current.zBase, '45'); assert.equal(result.current.zComparison, '46.8');
  assert.equal(result.current.zIndex, '104'); assert.equal(result.current.adjustedSum, '1.04'); assert.equal(result.current.k, '0.04');
  assert.equal(result.previous.rows.find(r => r.row === 11)?.comparison, '104');
  assert.equal(result.previous.rows.find(r => r.row === 18)?.comparison, '101');
  assert.equal(result.previous.adjustedSum, '1.031'); assert.equal(result.previous.k, '0.031');
  assert.equal(result.amount.net, '40000');
  assert.match(result.warnings.join('; '), /LEGACY_REPLAY/);
  assert.match(result.warnings.join('; '), /공식 제출 승인 계산이 아닙니다/);
});

test('CF123 exact zero cost is allowed while an empty cost is not silently zero', () => {
  valid();
  const blank = fixture(); blank.costs['14'] = ''; invalid(blank, /빈 값은 0이 아닙니다/);
  const omitted = fixture(); delete omitted.costs['14']; invalid(omitted);
});

test('CF123 required active wage and material values never fall back to zero or 100', () => {
  const emptyWage = fixture(); emptyWage.current.period.wage = ''; invalid(emptyWage, /빈 값/);
  const noBase = fixture(); noBase.base.wage = '0'; invalid(noBase, /기준 원자료가 0/);
  const noMaterial = fixture(); noMaterial.base.materials[1] = '0'; invalid(noMaterial);
  const emptyMaterial = fixture(); emptyMaterial.current.period.materials[1] = ''; invalid(emptyMaterial, /빈 값/);
});

test('CF123 amount validation: negative and zero denominator cannot yield a report amount', () => {
  const negative = fixture(); negative.costs['11'] = '-1'; invalid(negative, /음수/);
  const zero = fixture(); for (const [r] of ES_COSTS) zero.costs[r] = '0'; invalid(zero, /비목 금액 합계가 0/);
  const invalidMoney = fixture(); invalidMoney.contractAmount = '1e20'; invalid(invalidMoney);
});

test('CF123 input changes recompute current labor and derived Z instead of reusing stored results', () => {
  const first = valid(); const input = fixture(); input.current.period.wage = '110';
  const changed = valid(input);
  assert.equal(changed.current.rows.find(r => r.row === 11)?.comparison, '110');
  assert.notEqual(changed.current.zIndex, first.current.zIndex);
  assert.notEqual(changed.current.k, first.current.k);
  assert.equal(changed.previous.rows.find(r => r.row === 11)?.comparison, '104');
  assert.equal(changed.previous.rows.find(r => r.row === 18)?.comparison, '101');
  assert.equal(changed.previous.zIndex, changed.current.zIndex, 'legacy-only cross reference must be explicit and reproducible');
  assert.match(changed.warnings.join('; '), /직전일 원본/);
});

test('CF123 same base date may use different selected standard common-item pairs per comparison', () => {
  const input = fixture(); input.current.standards[0].baseAverage = '200'; input.current.standards[0].comparisonAverage = '220';
  input.previous.standards[0].baseAverage = '150'; input.previous.standards[0].comparisonAverage = '156';
  const result = valid(input);
  assert.equal(result.current.rows.find(r => r.row === 22)?.comparison, '110');
  assert.equal(result.previous.rows.find(r => r.row === 22)?.comparison, '104');
});

test('CF123 long-term care derives from health rate as well as care rate and labor index', () => {
  const input = fixture(); input.current.period.wage = '110'; input.current.period.rates.care = '11';
  const result = valid(input);
  assert.equal(result.current.rows.find(r => r.row === 34)?.comparison, '121');
  assert.equal(result.current.rows.find(r => r.row === 32)?.comparison, '110');
});

test('CF123 source private-material residual defect is visible and never labeled approved', () => {
  const input = fixture(); input.costs['43'] = '10000';
  const result = valid(input);
  assert.equal(result.current.weightSum, '1.0909');
  assert.notEqual(result.current.k, result.current.displayK);
  assert.match(result.warnings.join('; '), /사급자재/);
  assert.match(result.warnings.join('; '), /계수 합계/);
  assert.equal(result.status, 'LEGACY_REPLAY');
});

test('CF123 direct-paid labor excludes only the portion not already in excluded work', () => {
  const input = fixture(); input.paidWorkExclusion = '100000'; input.directPaid = ['20000', '30000']; input.alreadyExcludedDirect = '30000';
  const result = valid(input);
  assert.equal(result.amount.directExtra, '20000'); assert.equal(result.amount.applicable, '880000'); assert.equal(result.amount.gross, '35000');
  input.alreadyExcludedDirect = '60000';
  const clipped = valid(input); assert.equal(clipped.amount.directExtra, '0'); assert.equal(clipped.amount.applicable, '900000');
});

test('CF123 excluded work above contract cannot create negative applicable consideration', () => {
  const input = fixture(); input.paidWorkExclusion = '1000001'; invalid(input, /계약금액보다/);
});

test('CF123 advance uses full ratio before rounding instead of the displayed four-decimal rate', () => {
  const input = fixture(); input.contractAmount = '200000000'; input.paidWorkExclusion = '20000000';
  input.advanceContract = '100000003'; input.advancePaid = '33333334';
  const result = valid(input);
  assert.equal(result.amount.advance, '1066667');
  assert.notEqual(result.amount.advance, '1066560', 'rounded display ratio 0.3333 must not feed internal calculation');
});

test('CF123 advance payment cannot exceed its own target contract', () => {
  const input = fixture(); input.advanceContract = '10'; input.advancePaid = '11'; invalid(input, /선금 지급액/);
  const noTarget = fixture(); noTarget.advanceContract = '0'; noTarget.advancePaid = '1'; invalid(noTarget);
});

test('CF123 final amount truncates after other deductions and preserves negative adjustment direction', () => {
  const input = fixture(); input.otherDeduction = '1'; assert.equal(valid(input).amount.net, '39000');
  input.current.period.wage = '95'; input.current.period.materials = ['98', '98', '98', '98'];
  const decreased = valid(input); assert.equal(decreased.current.k, '-0.04'); assert.equal(decreased.amount.gross, '-40000');
  assert.equal(decreased.amount.net, '-40000', 'ROUNDDOWN(-40001,-3) truncates toward zero');
});

test('CF123 structural limits: 28 distinct IDs despite repeated expense codes; source provenance retained', () => {
  assert.equal(new Set(ES_COSTS.map(([row]) => row)).size, 28);
  assert.ok(ES_COSTS.filter(([, code]) => code === 'Z').length > 1);
  const clean = validateEsInput(fixture()); assert.equal(clean.current.period.source, 'Synthetic QA fixture only');
  assert.equal(clean.current.standards[0].source, 'Synthetic pair');
});

test('CF123 validation blocks a negative advance remainder instead of increasing the final amount', () => {
  const input = fixture(); input.paidWorkExclusion = '200000'; input.advanceContract = '100000'; input.advancePaid = '50000';
  invalid(input, /선금|잔여|대가/);
});

test('CF123 common-item count must be an integer, not a fractional item', () => {
  const input = fixture(); input.current.machinery.commonCount = '0.5'; invalid(input, /정수|품목|기종/);
});
