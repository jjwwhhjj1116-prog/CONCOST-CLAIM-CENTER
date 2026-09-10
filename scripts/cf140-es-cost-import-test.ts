import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as XLSX from 'xlsx';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEsCostWorkbook, applyEsCostChoice } from '../apps/web/src/es/es-cost-import';
import { newEsInput } from '../packages/document-engine/src/es-calculation';
const { zipSync, unzipSync, strToU8 } = createRequire(resolve('apps/web/package.json'))('fflate');

const labels: Record<number, string> = { 4: '직접재료비', 6: '직접노무비', 7: '간접노무비', 9: '기계경비', 10: '산재보험료', 11: '고용보험료', 12: '국민 건강 보험료', 13: '국민 연금 보험료', 14: '노인장기요양보험료', 15: '퇴직 공제 부금비', 16: '산업안전보건관리비', 17: '환경보전비', 18: '공사손해보험료', 19: '하도급지급보증수수료', 20: '기타경비', 21: '건설기계대여금지급보증서발급수수료', 24: '일반관리비', 25: '이윤', 26: '공급가액', 27: '부가가치세', 28: '총공사비' };
function cell(sheet: XLSX.WorkSheet, address: string, value: string | number, formula?: string) {
  sheet[address] = { t: typeof value === 'number' ? 'n' : 's', v: value, ...(formula ? { f: formula } : {}) };
}
function sheet(columns = ['K']): XLSX.WorkSheet {
  const s: XLSX.WorkSheet = { '!ref': 'A1:AB32' };
  for (const [r, label] of Object.entries(labels)) {
    cell(s, `C${r}`, label);
    for (const [i, col] of columns.entries()) cell(s, col + r, 1000 + Number(r) + i * 100);
  }
  return s;
}
function book(sheets: Record<string, XLSX.WorkSheet>, hidden: string[] = []) {
  const b = XLSX.utils.book_new();
  for (const [name, s] of Object.entries(sheets)) XLSX.utils.book_append_sheet(b, s, name);
  b.Workbook = { Sheets: b.SheetNames.map(name => ({ name, Hidden: hidden.includes(name) ? 1 : 0 })) };
  return b;
}
function bytes(b: XLSX.WorkBook, format: XLSX.BookType = 'xlsx') { return new Uint8Array(XLSX.write(b, { type: 'buffer', bookType: format })); }
function standard() { const s = sheet(); cell(s, 'K3', '합 계'); return s; }

test('CF140 BIFF XLS: only total sheet and total column, never sum sectors or hidden detail', () => {
  const total = standard(), sector = sheet(['D']); cell(sector, 'D3', '금액');
  const b = book({ '0.원가계산서(총괄)': total, '1.원가계산서(건축)': sector, '숨김원가계산서': sector }, ['숨김원가계산서']);
  const out = parseEsCostWorkbook(bytes(b, 'biff8'), 'synthetic.xls');
  assert.equal(out.choices.length, 1); const choice = out.choices[0];
  assert.equal(choice.column, 'K'); assert.equal(choice.costs.length, 14);
  assert.equal(choice.costs.find(c => c.row === 11)?.cell, 'K6');
  assert.equal(choice.costs.find(c => c.row === 11)?.labelCell, 'C6');
  assert.ok(out.warnings.some(s => s.includes('분야별'))); assert.ok(out.warnings.some(s => s.includes('숨김')));
});

test('CF140 original/revised columns are exclusive choices; difference and percentage columns are not candidates', () => {
  const s = sheet(['D', 'E', 'F', 'G']);
  cell(s, 'D4', '금액'); cell(s, 'D5', '당초(A)'); cell(s, 'E5', '변경(B)'); cell(s, 'F4', '대비(C=B-A)'); cell(s, 'G4', '제비율'); cell(s, 'G5', '당초');
  const out = parseEsCostWorkbook(bytes(book({ 총괄원가계산서: s })), 'synthetic.xlsx');
  assert.deepEqual(out.choices.map(c => [c.column, c.role]), [['D', 'original'], ['E', 'revised']]);
  assert.notEqual(out.choices[0].costs[0].amount, out.choices[1].costs[0].amount);
});

test('CF140 wide original/revised bands prefer their totals and omit hidden alternate summary', () => {
  const s = sheet(['E', 'L', 'M', 'T', 'U', 'AB']);
  for (const c of ['E', 'L']) cell(s, c + '2', '당초');
  for (const c of ['M', 'T']) cell(s, c + '2', '변경');
  cell(s, 'L3', '합계(A)'); cell(s, 'T3', '합계(B)'); cell(s, 'U2', '대비(B-A)'); cell(s, 'AB2', '대비(C=B-A)'); cell(s, 'AB3', '합계');
  const out = parseEsCostWorkbook(bytes(book({ 원가계산서: s, 총괄원가계산서: standard() }, ['총괄원가계산서'])), 'synthetic.xlsx');
  assert.deepEqual(out.choices.map(c => [c.column, c.role]), [['L', 'original'], ['T', 'revised']]);
});

test('CF140 material and unmatched insurance are evidence-only, not guessed as industrial goods or other expense', () => {
  const choice = parseEsCostWorkbook(bytes(book({ 원가계산서: standard() })), 'synthetic.xlsx').choices[0];
  assert.ok(choice.unmapped.some(c => c.label === '직접재료비' && c.cell === 'K4'));
  assert.ok(choice.unmapped.some(c => c.label === '공사손해보험료'));
  for (const row of [17, 18, 19, 20, 22, 23, 24, 25, 26, 42, 43, 44]) assert.ok(!choice.costs.some(c => c.row === row));
  assert.equal(choice.costs.find(c => c.row === 35)?.cell, 'K20');
  assert.ok(!choice.costs.some(c => c.cell === 'K24' || c.cell === 'K25'));
});

test('CF140 blank/error/rate are not zero, explicit numeric zero remains selectable', () => {
  const s = standard(); delete s.K6; s.K7 = { t: 'e', v: 7 }; s.K9 = { t: 'n', v: 0.02, z: '0.00%' }; cell(s, 'K10', 0);
  const c = parseEsCostWorkbook(bytes(book({ 원가계산서: s })), 'synthetic.xlsx').choices[0];
  assert.ok(!c.costs.some(v => [11, 12, 14].includes(v.row)));
  assert.equal(c.costs.find(v => v.row === 28)?.amount, '0');
  assert.equal(c.unmapped.filter(v => v.amount === null).length, 3);
});

test('CF140 duplicate cost captions are not silently summed or first-match selected', () => {
  const s = standard(); cell(s, 'C30', '직접노무비'); cell(s, 'K30', 7654);
  const c = parseEsCostWorkbook(bytes(book({ 원가계산서: s })), 'synthetic.xlsx').choices[0];
  assert.ok(!c.costs.some(v => v.row === 11));
  assert.equal(c.unmapped.filter(v => v.reason.includes('반복')).length, 2);
});

test('CF140 only cached formula values are read; formulas never run or follow external links', () => {
  const s = standard(); cell(s, 'K6', 12345, "'[99]external.xlsx'!B4");
  const c = parseEsCostWorkbook(bytes(book({ 원가계산서: s })), 'synthetic.xlsx').choices[0];
  assert.equal(c.costs.find(v => v.row === 11)?.amount, '12345'); assert.equal(c.costs.find(v => v.row === 11)?.formula, true);
  assert.ok(c.warnings.some(w => w.includes('수식은 실행하지')));
});

test('CF140 total amount is optional, scope warning is retained and conflicting totals are not chosen', () => {
  const s = standard(); const c = parseEsCostWorkbook(bytes(book({ 원가계산서: s })), 'synthetic.xlsx').choices[0];
  assert.equal(c.contractAmount?.cell, 'K28'); assert.ok(c.warnings.some(w => w.includes('부가세')));
  cell(s, 'C31', '총계약금액'); cell(s, 'K31', 999999);
  const conflicting = parseEsCostWorkbook(bytes(book({ 원가계산서: s })), 'synthetic.xlsx').choices[0];
  assert.equal(conflicting.contractAmount, undefined); assert.ok(conflicting.warnings.some(w => w.includes('여러 개')));
  cell(s, 'K31', 1028);
  assert.equal(parseEsCostWorkbook(bytes(book({ 원가계산서: s })), 'synthetic.xlsx').choices[0].contractAmount, undefined, 'same amount under two total captions is still ambiguous');
  delete s.K28; delete s.K31;
  assert.equal(parseEsCostWorkbook(bytes(book({ 원가계산서: s })), 'synthetic.xlsx').choices[0].contractAmount, undefined);
});

test('CF140 ZIP archive size/count/path/embedded-object/content-type limits reject before parsing', () => {
  const good = bytes(book({ 원가계산서: standard() }));
  const withPart = (name: string, data = new Uint8Array([1])) => zipSync({ ...unzipSync(good), [name]: data });
  assert.throws(() => parseEsCostWorkbook(withPart('../escape.xml'), 'file.xlsx'), /내부 경로/);
  assert.throws(() => parseEsCostWorkbook(withPart('/absolute.xml'), 'file.xlsx'), /내부 경로/);
  assert.throws(() => parseEsCostWorkbook(withPart('xl/embeddings/oleObject1.bin'), 'file.xlsx'), /삽입 실행/);
  assert.throws(() => parseEsCostWorkbook(withPart('[Content_Types].xml', strToU8('<Types>macroEnabled</Types>')), 'file.xlsx'), /매크로/);
  assert.throws(() => parseEsCostWorkbook(withPart('large.xml', new Uint8Array(30_000_001)), 'file.xlsx'), /압축 크기/);
  const inflated = { ...unzipSync(good) }; for (let i = 0; i < 4; i++) inflated[`inflated/${i}`] = new Uint8Array([1]);
  const cumulative = zipSync(inflated), view = new DataView(cumulative.buffer, cumulative.byteOffset, cumulative.byteLength);
  for (let offset = 0; offset + 46 <= cumulative.length; offset++) if (view.getUint32(offset, true) === 0x02014b50) {
    const nameSize = view.getUint16(offset + 28, true), name = new TextDecoder().decode(cumulative.subarray(offset + 46, offset + 46 + nameSize));
    if (name.startsWith('inflated/')) view.setUint32(offset + 24, 26_000_000, true);
  }
  assert.throws(() => parseEsCostWorkbook(cumulative, 'file.xlsx'), /압축 크기/);
  const many = { ...unzipSync(good) }; for (let i = 0; i < 5001; i++) many[`empty/${i}`] = new Uint8Array();
  assert.throws(() => parseEsCostWorkbook(zipSync(many), 'file.xlsx'), /압축 크기/);
});

test('CF140 full row extent is checked even when SheetJS truncates parsed rows', () => {
  const long = standard(); long['!ref'] = 'A1:K600'; cell(long, 'K600', 123);
  assert.throws(() => parseEsCostWorkbook(bytes(book({ 원가계산서: long })), 'file.xlsx'), /확인할 수 없/);
});

test('CF140 applying explicitly selected costs keeps original object, other costs, contract, periods and metadata intact', () => {
  const original = newEsInput(); original.title = 'Synthetic contract'; original.contractAmount = '777777'; original.costs[18] = '123'; original.note = 'existing';
  const snapshot = structuredClone(original), choice = parseEsCostWorkbook(bytes(book({ 원가계산서: standard() })), 'synthetic.xlsx').choices[0];
  const applied = applyEsCostChoice(original, choice, [11, 28]);
  assert.deepEqual(original, snapshot); assert.notEqual(applied, original);
  const expected = structuredClone(original); for (const row of [11, 28]) expected.costs[row] = choice.costs.find(v => v.row === row)!.amount;
  assert.deepEqual(applied, expected);
  assert.equal(applyEsCostChoice(original, choice, [], true).contractAmount, choice.contractAmount!.amount);
  assert.throws(() => applyEsCostChoice(original, choice, [11, 11]), /중복/);
  assert.throws(() => applyEsCostChoice(original, choice, [999]), /확인/);
  assert.throws(() => applyEsCostChoice(original, { ...choice, contractAmount: undefined }, [], true), /후보/);
});

test('CF140 invalid signatures, macro formats, non-cost workbooks and negative amount candidates fail safely', () => {
  const b = bytes(book({ 원가계산서: standard() }));
  assert.throws(() => parseEsCostWorkbook(new TextEncoder().encode('<html>'), 'fake.xls'), /실제/);
  assert.throws(() => parseEsCostWorkbook(b, 'fake.xls'), /실제/);
  assert.throws(() => parseEsCostWorkbook(b, 'fake.xlsm'), /실제/);
  assert.throws(() => parseEsCostWorkbook(bytes(book({ Sheet1: standard() })), 'file.xlsx'), /확인할 수 없/);
  const macroBook = book({ 원가계산서: standard() }); macroBook.vbaraw = new Uint8Array([1, 2, 3]);
  assert.throws(() => parseEsCostWorkbook(bytes(macroBook, 'xlsm'), 'renamed.xlsx'), /매크로/);
  const s = standard(); cell(s, 'K6', -123);
  assert.ok(!parseEsCostWorkbook(bytes(book({ 원가계산서: s })), 'file.xlsx').choices[0].costs.some(c => c.row === 11));
});
