import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { newEsInput, calculateEs, type EsInput } from '../packages/document-engine/src/es-calculation';
import { ES_SHEETS, orderedEsSheets, parseEsPages, buildEsSheets } from '../packages/document-engine/src/es-output';
import { exportEsWorking, exportEsReport } from '../apps/web/src/es/es-xlsx';
import { esPrintNumber } from '../apps/web/src/es/es-template-print';

const requireWeb = createRequire(resolve('apps/web/package.json'));
const { unzipSync, strFromU8 } = requireWeb('fflate') as typeof import('../apps/web/node_modules/fflate');
function fixture(): EsInput {
  const input = newEsInput(); input.title = '합성 검수 공사 ES 산출서'; input.client = '합성 발주자'; input.contractor = '합성 시공자';
  input.baseDate = '2024-01-01'; input.adjustmentDate = '2024-03-01'; input.contractAmount = '1000000';
  input.costs['11'] = '60000'; input.costs['18'] = '30000'; input.costs['35'] = '10000';
  for (const [p, date, wage] of [[input.base, input.baseDate, '100'], [input.current.period, input.adjustmentDate, '105'], [input.previous.period, '2024-02-29', '104']] as const) {
    p.date = date; p.wage = wage; p.materials = ['100', '100', '100', '100'];
    p.rates = { injury: '3', safety: '2', employment: '1', retirement: '2', health: '2', pension: '4', care: '10' }; p.source = '비식별 합성 입력';
  }
  for (const c of [input.current, input.previous]) for (const p of [c.machinery, ...c.standards]) { p.baseAverage = '100'; p.comparisonAverage = '105'; p.commonCount = '10'; p.source = '합성 기간쌍'; }
  return input;
}
function files(bytes: Uint8Array) { return Object.fromEntries(Object.entries(unzipSync(bytes)).map(([key, value]) => [key, strFromU8(value)])); }
test('CF123 exact 17 sheet names/order; internal sheets and numeric name coercion rejected', () => {
  assert.deepEqual(ES_SHEETS.map(s => s[1]), ['표지', '목록', '붙1', '1', '붙2', '2', '2.1', '2.2(선금)', '붙3', '3', '붙4', '4', '붙5', '2.', '2.1.', '3.', '4.']);
  assert.deepEqual(orderedEsSheets(['previous_day_index_details', 'cover', 'index_details']).map(s => s[1]), ['표지', '4', '4.']);
  assert.throws(() => orderedEsSheets([])); assert.throws(() => orderedEsSheets(['기본입력']));
  assert.equal(orderedEsSheets(['cover', 'cover']).length, 1);
});
test('CF123 page ranges: original order, deduplication, empty means all; invalid ranges reject', () => {
  assert.deepEqual(parseEsPages('1,3,5-8,3', 10), [1, 3, 5, 6, 7, 8]);
  assert.deepEqual(parseEsPages('', 3), [1, 2, 3]); assert.deepEqual(parseEsPages('3,1', 3), [1, 3]);
  for (const range of ['0', '-1', '3-1', '11', '1,', '1.5', '1-a']) assert.throws(() => parseEsPages(range, 10), range);
  assert.throws(() => parseEsPages('', 0));
});
test('CF123 selection never changes calculation; fatal permits only cover/contents/dividers', () => {
  const input = fixture(), result = calculateEs(input), before = JSON.stringify(result);
  assert.equal(result.status, 'LEGACY_REPLAY');
  const sheets = buildEsSheets(input, result, ['contents', 'rate_details', 'index_details']);
  assert.deepEqual(sheets[0].rows.map(row => row[0]), ['3', '4']);
  assert.equal(JSON.stringify(result), before);
  const invalid = calculateEs(newEsInput());
  assert.equal(buildEsSheets(newEsInput(), invalid, ['cover', 'divider_1']).length, 2);
  assert.throws(() => buildEsSheets(newEsInput(), invalid, ['amount_adjustment']));
});
test('CF123 real full/selected XLSX are values-only, exact scope, no support data/secrets/external links', () => {
  const input = fixture(), result = calculateEs(input), all = exportEsReport(input, result, ES_SHEETS.map(s => s[0]));
  const selected = exportEsReport(input, result, ['previous_day_index_details', 'cover', 'index_details']);
  const fullFiles = files(all), selectedFiles = files(selected);
  assert.equal(Object.keys(fullFiles).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).length, 17);
  assert.equal(Object.keys(selectedFiles).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).length, 3);
  const names = [...selectedFiles['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(names, ['표지', '4', '4.']);
  assert.match(selectedFiles['xl/workbook.xml'], /'4\.'!\$A\$1:\$M\$443/);
  for (const [path, xml] of Object.entries(fullFiles)) { assert.doesNotMatch(path, /external|macro|metadata|ES_/i); assert.doesNotMatch(xml, /<f[ >]|api.?key|ownerId|organizationId|Bearer|http[^"]*\/externalLinks/i); }
  for (const xml of Object.values(fullFiles).filter(v => v.includes('<worksheet'))) { assert.doesNotMatch(xml, /fitToHeight="0"/); assert.match(xml, /paperSize="9"/); }
  const out = resolve('outputs/cf123-es'); mkdirSync(out, { recursive: true }); writeFileSync(resolve(out, 'synthetic-full-17.xlsx'), all); writeFileSync(resolve(out, 'synthetic-selected-cover-4-4dot.xlsx'), selected);
  for (const [name, ids, expected] of [
    ['synthetic-selected-cover-3-4dot.xlsx', ['cover', 'rate_details', 'previous_day_index_details'], ['표지', '3', '4.']],
    ['synthetic-single-advance.xlsx', ['advance_deduction'], ['2.2(선금)']],
    ['synthetic-single-4dot.xlsx', ['previous_day_index_details'], ['4.']]
  ] as const) {
    const bytes = exportEsReport(input, result, ids), workbook = files(bytes);
    assert.deepEqual([...workbook['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1]), expected);
    assert.doesNotMatch(Object.values(workbook).join(''), /<f[ >]|externalLinks/);
    writeFileSync(resolve(out, name), bytes);
  }
  writeFileSync(resolve(out, 'synthetic-input.json'), JSON.stringify(input, null, 2));
});
test('CF123 working XLSX contains editable input, guarded snapshot and supported Excel formulas; blank backup exports', async () => {
  const input = fixture(), bytes = await exportEsWorking(input), wb = files(bytes);
  assert.equal(Object.keys(wb).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).length, 20);
  assert.match(wb['xl/workbook.xml'], /name="ES_작업정보"[^>]*state="veryHidden"/);
  assert.match(wb['xl/worksheets/sheet2.xml'], /<f>SUM\(/);
  assert.match(wb['xl/worksheets/sheet2.xml'], /ROUND\(/);
  assert.match(wb['xl/workbook.xml'], /fullCalcOnLoad="1"/);
  const xml = wb['xl/worksheets/sheet2.xml'];
  const cell = (address: string) => xml.match(new RegExp(`<c r="${address}"[^>]*>(.*?)</c>`))?.[1] ?? '';
  const result = calculateEs(input);
  assert.match(cell('C35'), new RegExp(`<v>${result.current!.k}</v>`));
  assert.match(cell('D35'), new RegExp(`<v>${result.previous!.k}</v>`));
  assert.match(cell('B67'), new RegExp(`<v>${result.amount!.net}</v>`));
  assert.match(cell('B67'), /ROUNDDOWN/); assert.match(cell('B66'), /ROUND/);
  // Formula graph check uses generated expressions only; it is not an Excel evaluator.
  const formulaMap = new Map([...xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*><f>(.*?)<\/f>/g)].map(m => [m[1], m[2]]));
  assert.ok(formulaMap.size > 280);
  const finished = new Set<string>(), active = new Set<string>();
  const visit = (address: string) => {
    if (finished.has(address)) return;
    assert.equal(active.has(address), false, `circular Excel dependency: ${address}`);
    active.add(address);
    const formula = formulaMap.get(address)!.replace(/&apos;ES_입력&apos;!B\d+/g, '0');
    for (const match of formula.matchAll(/\b([A-J]\d+)\b/g)) {
      assert.ok(formulaMap.has(match[1]), `missing calculation cell ${match[1]} referenced from ${address}`);
      visit(match[1]);
    }
    active.delete(address); finished.add(address);
  };
  for (const address of formulaMap.keys()) visit(address);
  assert.doesNotMatch(Object.values(wb).join(''), /ownerId|organizationId|api.?key|Bearer/);
  const out = resolve('outputs/cf123-es'); mkdirSync(out, { recursive: true }); writeFileSync(resolve(out, 'synthetic-working.xlsx'), bytes);
  writeFileSync(resolve(out, 'blank-working-template.xlsx'), await exportEsWorking(newEsInput()));
});
test('CF123 formula-like user text is encoded as text, never a formula', () => {
  const input = fixture(); input.title = '=HYPERLINK("https://invalid.example","test")'; input.contractor = '<script>alert(1)</script>';
  const xml = files(exportEsReport(input, calculateEs(input), ['cover']))['xl/worksheets/sheet1.xml'];
  assert.doesNotMatch(xml, /<f>|<script>/); assert.match(xml, /&lt;script&gt;/);
});
test('CF123 original print grid emits all 443 rows, merges, values at original coordinates', () => {
  const input=fixture(), result=calculateEs(input), wb=files(exportEsReport(input,result,['rate_details','index_details','previous_day_index_details']));
  const xml=wb['xl/worksheets/sheet2.xml'];
  assert.equal([...xml.matchAll(/<row r=/g)].length,443);
  assert.match(xml,/<row r="443"/); assert.match(xml,/<mergeCells count="371"/);
  assert.match(wb['xl/worksheets/sheet3.xml'],/<mergeCells count="372"/);
  assert.match(wb['xl/worksheets/sheet1.xml'],new RegExp(`<c r="G11"[^>]*><v>${result.current!.rows[0].adjusted}</v>`));
  assert.match(wb['xl/styles.xml'],/<borders count="421"/);
  assert.doesNotMatch(Object.values(wb).join(''),/#REF!|TODAY\(|file:\/\/|externalLinks/);
});
test('CF123 template guards preserve large numbers, blank advance draft and valid XML text',()=>{
  assert.equal(esPrintNumber('9007199254740993','#,##0'),'9,007,199,254,740,993');
  assert.equal(esPrintNumber('0.03115','0.00%'),'3.12%');
  const input=newEsInput();input.advanceContract='100';input.advancePaid='';input.title='공사\u0001명';
  const xml=files(exportEsReport(input,calculateEs(input),['cover']))['xl/worksheets/sheet1.xml'];
  assert.doesNotMatch(xml,/\u0001/);assert.match(xml,/공사명/);
});
