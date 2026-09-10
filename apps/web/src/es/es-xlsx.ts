import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { ES_COSTS, ES_CONTRACT_FIELDS, calculateEs, newEsInput, previousEsDay, validateEsInput, type EsInput, type EsPeriod, type EsPair } from '../../../../packages/document-engine/src/es-calculation';
import { esDecimal as d, esSum } from '../../../../packages/document-engine/src/es-decimal';
import { buildEsSheets, type EsOutputSheet } from '../../../../packages/document-engine/src/es-output';
import type { EsResult } from '../../../../packages/document-engine/src/es-calculation';
import { esWorkingChain } from './es-working-formulas';
import { ES_ORIGINAL_FORMULAS } from './es-original-formulas';
import { esTemplateSheetXml, esTemplateStylesXml } from './es-template-xlsx';
import { esTemplateGrids, esTemplateValues } from '../../../../packages/document-engine/src/es-template';
import { ES_CONTENTS_DRAWING_XML } from '../../../../packages/document-engine/src/es-template-drawing';
import type { EsSourceHistory } from '../../../../packages/document-engine/src/es-source-history';

const esc = (value: unknown) => String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(v => v.toString(16).padStart(2, '0')).join('');
const parseXml = (text: string) => {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('외부 XML 선언은 허용하지 않습니다.');
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('손상된 Excel XML입니다.');
  return xml;
};
const tags = (node: Document | Element, name: string) => Array.from(node.getElementsByTagNameNS('*', name));
interface Cell { value: string; formula?: string; formulaMeta?: string[]; type: string }
interface Workbook { sheets: Map<string, Map<string, Cell>>; date1904: boolean; external: boolean }
function readWorkbook(bytes: Uint8Array): Workbook {
  if (bytes.length > 25_000_000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('25MB 이하의 암호화되지 않은 .xlsx 파일만 지원합니다. .xls는 Excel에서 변환하세요.');
  let size = 0, count = 0;
  const files = unzipSync(bytes, { filter: file => {
    size += file.originalSize; count++;
    if (size > 100_000_000 || count > 5000 || file.originalSize > 30_000_000 || /(^\/|\\|(^|\/)\.\.(\/|$))/.test(file.name)) throw new Error('압축 크기 또는 내부 경로가 안전하지 않습니다.');
    if (/vbaProject|embeddings\//i.test(file.name)) throw new Error('매크로·삽입 실행 객체가 있는 파일은 지원하지 않습니다.');
    return true;
  } });
  const xml = (name: string) => { if (!files[name]) throw new Error(`Excel 구성 파일이 없습니다: ${name}`); return parseXml(strFromU8(files[name])); };
  const contentTypes = tags(xml('[Content_Types].xml'), 'Override');
  if (contentTypes.find(t => t.getAttribute('PartName') === '/xl/workbook.xml')?.getAttribute('ContentType') !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml' || contentTypes.some(t => /macroEnabled|vbaProject/i.test(t.getAttribute('ContentType') ?? ''))) throw new Error('매크로 형식이 아닌 .xlsx 통합문서만 지원합니다.');
  const workbook = xml('xl/workbook.xml'), rels = tags(xml('xl/_rels/workbook.xml.rels'), 'Relationship');
  const shared = files['xl/sharedStrings.xml'] ? tags(xml('xl/sharedStrings.xml'), 'si').map(si => tags(si, 't').map(t => t.textContent ?? '').join('')) : [];
  const sheets = new Map<string, Map<string, Cell>>();
  for (const sheet of tags(workbook, 'sheet')) {
    const name = sheet.getAttribute('name') ?? '', relation = rels.find(r => r.getAttribute('Id') === sheet.getAttribute('r:id'));
    const target = relation?.getAttribute('Target') ?? '';
    if (!target || relation?.getAttribute('TargetMode') === 'External') throw new Error('외부 시트 연결은 허용하지 않습니다.');
    const file = target.startsWith('/xl/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(file) || sheets.has(name)) throw new Error('중복 또는 잘못된 시트 이름입니다.');
    const cells = new Map<string, Cell>();
    for (const c of tags(xml(file), 'c')) {
      const address = c.getAttribute('r') ?? '', type = c.getAttribute('t') ?? 'n', f = tags(c, 'f')[0];
      const raw = tags(c, 'v')[0]?.textContent ?? '';
      if (/\b(DDE|WEBSERVICE|RTD|CALL|REGISTER\.ID)\s*\(|\|[^!]*!/i.test(f?.textContent ?? '')) throw new Error('DDE·외부 실행 수식은 허용하지 않습니다.');
      const value = type === 's' ? shared[Number(raw)] ?? '' : type === 'inlineStr' ? tags(c, 't').map(t => t.textContent ?? '').join('') : raw;
      cells.set(address, { type, value, ...(f ? { formula: f.textContent ?? '', formulaMeta: ['t', 'si', 'ref'].map(key => f.getAttribute(key) ?? '') } : {}) });
    }
    sheets.set(name, cells);
  }
  return { sheets, date1904: tags(workbook, 'workbookPr')[0]?.getAttribute('date1904') === '1', external: Object.keys(files).some(name => name.startsWith('xl/externalLinks/')) };
}
function excelNumber(raw: string): string {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) || !Number.isFinite(Number(raw))) throw new Error('Excel 숫자 입력을 확인하세요.');
  // Source OOXML carries binary-double round-trip strings. Normalize import only to Excel precision.
  const normalized = Number(raw).toPrecision(15), match = normalized.match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i)!;
  const sign = match[1], digits = match[2] + (match[3] ?? ''), point = match[2].length + Number(match[4] ?? 0);
  const plain = point <= 0 ? '0.' + '0'.repeat(-point) + digits : point >= digits.length ? digits + '0'.repeat(point - digits.length) : digits.slice(0, point) + '.' + digits.slice(point);
  return d(sign + plain.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')).toString();
}
export interface EsImportPreview { input: EsInput; kind: 'ORIGINAL' | 'WORKING'; warnings: string[]; sourceHash: string }
export async function importEsWorkbook(bytes: Uint8Array): Promise<EsImportPreview> {
  const book = readWorkbook(bytes), sourceHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer))).map(v => v.toString(16).padStart(2, '0')).join('');
  const cell = (sheet: string, address: string) => book.sheets.get(sheet)?.get(address);
  const text = (sheet: string, address: string) => cell(sheet, address)?.value ?? '';
  const literal = (sheet: string, address: string, blank = false) => {
    const c = cell(sheet, address);
    if (c?.formula !== undefined) throw new Error(`${sheet}!${address}: 입력 위치의 수식은 실행하지 않습니다. 원본 입력값으로 복원하세요.`);
    if (!c || c.value === '') { if (blank) return '0'; throw new Error(`${sheet}!${address}: 필요한 원자료가 없습니다.`); }
    if (c.type === 'e') throw new Error(`${sheet}!${address}: 원자료 오류 ${c.value}`);
    return excelNumber(c.value);
  };
  if (book.sheets.has('ES_작업정보')) {
    if (text('ES_작업정보', 'A1') !== 'CLAIM_ES_WORKING_V2') throw new Error('지원하지 않는 작업용 Excel입니다.');
    const chunkCount = Number(text('ES_작업정보', 'B2'));
    if (!Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > 32) throw new Error('작업정보 크기가 올바르지 않습니다.');
    const encoded = Array.from({ length: chunkCount }, (_, i) => text('ES_작업정보', `A${i + 4}`)).join('');
    if (encoded.length > 500_000 || await hash(encoded) !== text('ES_작업정보', 'B1')) throw new Error('작업정보가 변경되거나 손상되었습니다. 가져오기를 중단했습니다.');
    const input = validateEsInput(JSON.parse(encoded));
    const bindings = workingBindings(input);
    for (const [i, binding] of bindings.entries()) {
      const c = cell('ES_입력', `B${i + 2}`);
      if (text('ES_입력', `A${i + 2}`) !== binding.label) throw new Error(`ES_입력!A${i + 2}: 행 위치나 입력 항목이 변경되었습니다. 원래 입력 행을 유지하세요.`);
      if (c?.formula !== undefined || c?.type === 'e') throw new Error(`ES_입력!B${i + 2}: 지원하지 않는 수식 또는 오류 값입니다.`);
      binding.set(c?.value ?? '');
    }
    const chainVersion = text('ES_작업정보', 'C1');
    if (chainVersion && chainVersion !== 'CHAIN_1') throw new Error('지원하지 않는 Excel 계산 규칙 버전입니다.');
    const expected = chainVersion ? esWorkingChain(input, bindings).formulas : workingFormulas(input);
    for (const [address, formula] of Object.entries(expected)) if (cell('ES_계산', address)?.formula !== formula) throw new Error(`ES_계산!${address}: 지원 수식이 변경되었습니다. 원래 작업용 파일을 사용하세요.`);
    for (const [address, c] of book.sheets.get('ES_계산') ?? []) if (c.formula !== undefined && !expected[address]) throw new Error(`ES_계산!${address}: 지원 범위 밖의 수식이 추가되었습니다.`);
    return { input: validateEsInput(input), kind: 'WORKING', warnings: ['작업용 입력을 새 버전으로 적용합니다. 소유자·회사·권한·승인·기존 문서 ID는 가져오지 않습니다.', 'Excel 계산 캐시는 사용하지 않고 웹에서 다시 계산합니다.'], sourceHash };
  }
  if (!['기본입력', '3', '3.', '4', '4.', 'K0', '2'].every(name => book.sheets.has(name))) throw new Error('지원하는 원본 양식이나 ES 작업용 파일이 아닙니다. 제출용 Excel은 편집 원본으로 가져올 수 없습니다.');
  const changedFormulas: string[] = [];
  for (const [name, expected] of Object.entries(ES_ORIGINAL_FORMULAS)) {
    const list = [...book.sheets.get(name)?.entries() ?? []].filter(([, c]) => c.formula !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([address, c]) => [address, c.formula, ...c.formulaMeta ?? []]);
    if (!book.sheets.has(name) || await hash(JSON.stringify(list)) !== expected) changedFormulas.push(name);
  }
  const input = newEsInput();
  const serialDate = (serial: string) => new Date(Date.UTC(book.date1904 ? 1904 : 1899, book.date1904 ? 0 : 11, book.date1904 ? 1 : 30) + Number(serial) * 86400000).toISOString().slice(0, 10);
  const dateSerial = (date: string) => String((Date.parse(date + 'T00:00:00Z') - Date.UTC(book.date1904 ? 1904 : 1899, book.date1904 ? 0 : 11, book.date1904 ? 1 : 30)) / 86400000);
  const basicText = (address: string) => {
    const c = cell('기본입력', address);
    if (c?.formula !== undefined || c?.type === 'e') throw new Error(`기본입력!${address}: 직접 입력한 문자만 가져올 수 있습니다.`);
    return c?.value ?? '';
  };
  input.title = basicText('C8') || '가져온 물가변동 산출서';
  input.client = basicText('C7'); input.contractor = basicText('C9');
  input.baseDate = serialDate(literal('기본입력', 'C10')); input.adjustmentDate = serialDate(literal('기본입력', 'C12'));
  input.contractAmount = literal('기본입력', 'C16');
  const skippedContract: string[] = [];
  for (const [key, label, type, coordinate] of ES_CONTRACT_FIELDS) {
    const sheet = key === 'plannedProgress' || key === 'actualProgress' ? '2' : '기본입력';
    const address = key === 'plannedProgress' ? 'C13' : key === 'actualProgress' ? 'C14' : coordinate;
    if (!address) continue;
    const value = cell(sheet, address);
    if (!value?.value) continue;
    if (value.formula !== undefined || value.type === 'e') { skippedContract.push(label); continue; }
    input.contract![key] = type === 'date' ? serialDate(value.value) : value.value;
  }
  for (const [row] of ES_COSTS) input.costs[row] = literal('3', `B${row}`, true);
  const lookup = (sheet: string, dateCol: string, valueCol: string, from: number, to: number, serial: string) => {
    const rows = Array.from({ length: to - from + 1 }, (_, i) => i + from).filter(r => text(sheet, dateCol + r) && d(literal(sheet, dateCol + r)).compare(d(serial)) <= 0);
    rows.sort((a, b) => d(literal(sheet, dateCol + b)).compare(d(literal(sheet, dateCol + a))));
    if (!rows.length) throw new Error(`${sheet}: 적용일에 맞는 원자료가 없습니다.`);
    return { row: rows[0], value: text(sheet, valueCol + rows[0]) };
  };
  const monthRow = (date: string) => {
    const dt = new Date(date + 'T00:00:00Z'), key = `${dt.getUTCFullYear()}년${dt.getUTCMonth() + 1}월`;
    const matches = Array.from({ length: 84 }, (_, i) => i + 5).filter(r => text('기본입력', 'R' + r) === key);
    if (matches.length !== 1) throw new Error(`${key}: 월별 원자료가 없거나 중복입니다.`);
    return matches[0];
  };
  const period = (date: string): EsPeriod => {
    const row = monthRow(date), dt = new Date(date + 'T00:00:00Z'), days = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
    const materialDate = dt.getUTCDate() === days ? date : previousEsDay(date.slice(0, 8) + '01'), mr = monthRow(materialDate), serial = dateSerial(date);
    const rate = (dateCol: string, valueCol: string, from: number, to: number) => literal('기본입력', valueCol + lookup('기본입력', dateCol, valueCol, from, to, serial).row);
    const grade = Number(text('기본입력', 'C23').match(/^\d+/)?.[0]);
    if (!Number.isInteger(grade) || grade < 1 || grade > 7) throw new Error('고용보험 등급을 확인하세요.');
    return { date, wage: literal('기본입력', 'T' + row), materials: ['U', 'V', 'W', 'X'].map(col => literal('기본입력', col + mr)) as EsPeriod['materials'],
      rates: { injury: literal('기본입력', 'Y' + row), safety: literal('기본입력', 'C22'), employment: rate('H', String.fromCharCode(72 + grade), 51, 61), retirement: rate('H', text('기본입력', 'C24') === '토목' ? 'I' : 'J', 64, 67), health: rate('J', 'K', 35, 48), pension: rate('L', 'M', 35, 48), care: rate('N', 'O', 35, 48) },
      source: `원본 월별·적용일 원자료 / 노임 T${row}, 재료 U${mr}:X${mr}. 자료월·공식 발표 대조 필요` };
  };
  input.base = period(input.baseDate);
  const pair = (sheet: string, date: string): EsPair => {
    // Period identities come from literal publication dates/labels and pair O/T dates.
    // E and L are formula-backed display labels; their caches can be absent or stale.
    const published = Array.from({ length: 85 }, (_, i) => i + 25).filter(r => text(sheet, 'C' + r)).map(r => {
      const label = cell(sheet, 'D' + r);
      if (!label || label.formula !== undefined || label.type === 'e') throw new Error(`${sheet}: 발표 기간 원자료가 필요합니다.`);
      return { day: Number(literal(sheet, 'C' + r)), label: label.value };
    }).sort((a, b) => b.day - a.day);
    const labelFor = (serial: string) => {
      const label = published.find(p => p.day <= Number(serial))?.label;
      if (!label) throw new Error(`${sheet}: 발표 기간을 찾을 수 없습니다.`);
      return label;
    };
    const b = labelFor(dateSerial(input.baseDate)), c = labelFor(dateSerial(date));
    const matches = [...book.sheets.get(sheet)!.entries()].filter(([address]) => /^O\d+$/.test(address) && Number(address.slice(1)) >= 26 && Number(address.slice(1)) <= 5000).filter(([address, value]) => {
      const row = address.slice(1); if (!value.value || !text(sheet, 'T' + row)) return false;
      return labelFor(literal(sheet, address)) === b && labelFor(literal(sheet, 'T' + row)) === c;
    });
    if (matches.length !== 1) throw new Error(`${sheet}: 기준·비교 기간쌍이 없거나 중복입니다.`);
    const row = matches[0][0].slice(1), baseCount = literal(sheet, 'Q' + row), currentCount = literal(sheet, 'V' + row);
    if (baseCount !== currentCount) throw new Error(`${sheet}: 공통품목 수가 일치하지 않습니다.`);
    return { label: sheet, commonCount: baseCount, baseAverage: literal(sheet, 'S' + row), comparisonAverage: literal(sheet, 'X' + row), baseSum: literal(sheet, 'R' + row), comparisonSum: literal(sheet, 'W' + row), baseLabel: b, comparisonLabel: c, source: `${sheet}!${row} / ${b}/${c} 원본 기간쌍 평균 snapshot` };
  };
  const machinery = (date: string): EsPair => {
    const cols: Record<number, string[]> = { 2021: ['S', 'T'], 2022: ['U', 'V'], 2023: ['W', 'X'], 2024: ['Y', 'Z'], 2025: ['AA', 'AB'] };
    const b = cols[Number(input.baseDate.slice(0, 4))], c = cols[Number(date.slice(0, 4))];
    if (!b || !c) throw new Error('원본 기계 단가표의 지원 연도 밖입니다. 수동 기간쌍 원자료를 입력하세요.');
    const rows = Array.from({ length: 620 }, (_, i) => i + 34).filter(r => d(literal('K0', b[0] + r, true)).compare(d(0)) > 0 && d(literal('K0', c[0] + r, true)).compare(d(0)) > 0);
    if (!rows.length) throw new Error('기계 공통품목이 없습니다.');
    const avg = (col: string) => esSum(rows.map(r => d(literal('K0', col + r)))).div(d(rows.length)).round(0).toString();
    return { label: '기계경비', commonCount: String(rows.length), baseAverage: avg(b[1]), comparisonAverage: avg(c[1]), baseSum: esSum(rows.map(r => d(literal('K0', b[1] + r)))).toString(), comparisonSum: esSum(rows.map(r => d(literal('K0', c[1] + r)))).toString(), baseLabel: input.baseDate.slice(0, 4), comparisonLabel: date.slice(0, 4), source: `K0!34:653 / ${input.baseDate.slice(0, 4)}→${date.slice(0, 4)} 양수 가격 공통 손료 평균` };
  };
  for (const [key, date] of [['current', input.adjustmentDate], ['previous', previousEsDay(input.adjustmentDate)]] as const) input[key] = { period: period(date), machinery: machinery(date), standards: ['토목표준', '건축표준', '기계표준', '전기표준', '통신표준'].map(s => pair(s, date)) };
  input.paidWorkExclusion = literal('2', 'C11', true); input.alreadyExcludedDirect = literal('2', 'K9', true);
  input.directPaid = Array.from({ length: 23 }, (_, i) => literal('2', 'K' + (i + 11), true));
  input.advanceContract = literal('기본입력', 'E10', true); input.advancePaid = literal('기본입력', 'E11', true);
  input.priorCompletion = esSum([27, 28, 29, 30].map(r => d(literal('기본입력', 'C' + r, true)))).toString();
  input.otherDeduction = literal('2', 'C22', true);
  // Preserve the bounded source tables, not only today's three lookup results.
  const numberOrBlank = (sheet: string, address: string) => { const c = cell(sheet, address); return c?.formula !== undefined || c?.type === 'e' || !c?.value ? '' : literal(sheet, address); };
  const sourceHistory: EsSourceHistory = { hash: sourceHash, months: [], rates: [], standards: [], machinery: [] };
  for (let r = 5; r <= 88; r++) {
    const m = text('기본입력', 'R' + r).match(/^(\d{4})년(\d{1,2})월$/);
    if (m) sourceHistory.months.push({ month: `${m[1]}-${m[2].padStart(2, '0')}`, wage: numberOrBlank('기본입력', 'T' + r), materials: ['U', 'V', 'W', 'X'].map(c => numberOrBlank('기본입력', c + r)) as EsPeriod['materials'], injury: numberOrBlank('기본입력', 'Y' + r) });
  }
  for (const [kind, dc, columns, start, end] of [['health', 'J', ['K'], 35, 48], ['pension', 'L', ['M'], 35, 48], ['care', 'N', ['O'], 35, 48], ['employment', 'H', ['I', 'J', 'K', 'L', 'M', 'N', 'O'], 51, 61], ['retirement', 'H', ['I', 'J'], 64, 67]] as const) {
    for (let r: number = start; r <= end; r++) if (text('기본입력', dc + r)) sourceHistory.rates.push({ kind, date: serialDate(literal('기본입력', dc + r)), values: columns.map(c => numberOrBlank('기본입력', c + r)) });
  }
  for (const label of ['토목표준', '건축표준', '기계표준', '전기표준', '통신표준']) {
    const publications = Array.from({ length: 85 }, (_, i) => i + 25).filter(r => text(label, 'C' + r)).map(r => ({ date: serialDate(literal(label, 'C' + r)), label: text(label, 'D' + r) }));
    const labelFor = (serial: string) => publications.filter(p => p.date <= serialDate(serial)).sort((a, b) => b.date.localeCompare(a.date))[0]?.label;
    const pairs: EsPair[] = [];
    for (const [address, c] of book.sheets.get(label)!) {
      if (!/^O\d+$/.test(address) || Number(address.slice(1)) < 26 || Number(address.slice(1)) > 5000 || !c.value) continue;
      const r = address.slice(1); if (!text(label, 'T' + r)) continue;
      const baseLabel = labelFor(literal(label, address)), comparisonLabel = labelFor(literal(label, 'T' + r));
      if (!baseLabel || !comparisonLabel || text(label, 'Q' + r) !== text(label, 'V' + r)) continue;
      pairs.push({ label, baseLabel, comparisonLabel, commonCount: literal(label, 'Q' + r), baseAverage: literal(label, 'S' + r), comparisonAverage: literal(label, 'X' + r), baseSum: literal(label, 'R' + r), comparisonSum: literal(label, 'W' + r), source: `가져온 ${label}!${r} / ${baseLabel} → ${comparisonLabel}` });
    }
    sourceHistory.standards.push({ label, publications, pairs });
  }
  for (const [year, pc, dc] of [['2021', 'S', 'T'], ['2022', 'U', 'V'], ['2023', 'W', 'X'], ['2024', 'Y', 'Z'], ['2025', 'AA', 'AB']]) sourceHistory.machinery.push({ year, rows: Array.from({ length: 620 }, (_, i) => [numberOrBlank('K0', pc + (i + 34)), numberOrBlank('K0', dc + (i + 34))]) });
  input.sourceHistory = sourceHistory;
  if (Number(literal('기본입력', 'E22', true)) > 0 || Number(literal('기본입력', 'E3', true)) > 1) throw new Error('신규비목 또는 후속 차수 원본은 아직 매핑 검수가 필요합니다. 현재 입력은 변경하지 않았습니다.');
  return { input: validateEsInput(input), kind: 'ORIGINAL', sourceHash, warnings: [
    '원본 금액·월별·시행일별 요율·공통 기간쌍 이력까지 보관합니다. 기본입력 날짜·등급·공종을 바꾸면 이력에서 다시 선택합니다. 수식과 최종 결과 캐시는 실행/채택하지 않습니다.',
    '이력 중 수식·오류로 채워진 원자료 칸은 빈 값으로 보관합니다. 해당 기간 선택 시 실제 공표 값을 확인해 입력하세요.',
    ...(skippedContract.length ? [`계약 정보 중 수식·오류 셀은 직접 확인해 입력하세요: ${skippedContract.join(', ')}`] : []),
    ...(changedFormulas.length ? [`기준 원본과 수식 구성이 다르거나 시트가 누락되었습니다: ${changedFormulas.join(', ')}. 재저장 표현 차이도 포함될 수 있습니다. 수정된 Excel 수식은 실행하지 않으며 웹 규칙으로만 재계산합니다.`] : ['기준 원본 27시트의 수식 구성 지문이 일치합니다. 입력값·업무 적합성의 승인을 의미하지 않습니다.']),
    '월말은 실제 달력으로 판단합니다. 원본의 잘못된 월일수 표를 사용하지 않습니다.',
    '초회·단일 구간만 지원합니다. 계약 세부정보·공정률·법체계 및 출력 배치는 추가 검수가 필요합니다.',
    ...(book.external ? ['원본 외부 링크는 열거나 갱신하지 않았으며 내보내기에 포함하지 않습니다.'] : [])
  ] };
}

interface Binding { label: string; value: string; set: (value: string) => void }
function workingBindings(input: EsInput): Binding[] {
  const result: Binding[] = [];
  const fields = (obj: Record<string, unknown>, keys: string[], prefix: string) => keys.forEach(key => result.push({ label: prefix + key, value: String(obj[key]), set: value => { obj[key] = value; } }));
  fields(input as unknown as Record<string, unknown>, ['title', 'client', 'contractor', 'baseDate', 'adjustmentDate', 'contractAmount', 'paidWorkExclusion', 'alreadyExcludedDirect', 'advanceContract', 'advancePaid', 'priorCompletion', 'otherDeduction', 'note'], '');
  fields(input.costs, ES_COSTS.map(([r]) => String(r)), '비목 ');
  for (const [label, period] of [['기준 ', input.base], ['현재 ', input.current.period], ['직전일 ', input.previous.period]] as const) {
    fields(period as unknown as Record<string, unknown>, ['date', 'wage', 'source'], label);
    fields(period.rates, Object.keys(period.rates), label);
    period.materials.forEach((value, i) => result.push({ label: label + '재료 ' + i, value, set: v => { period.materials[i] = v; } }));
  }
  for (const [label, comparison] of [['현재 ', input.current], ['직전일 ', input.previous]] as const) for (const pair of [comparison.machinery, ...comparison.standards]) fields(pair as unknown as Record<string, unknown>, ['baseAverage', 'comparisonAverage', 'commonCount', 'source'], label + pair.label + ' ');
  input.directPaid.forEach((value, i) => result.push({ label: '직접지급 ' + (i + 1), value, set: v => { input.directPaid[i] = v; } }));
  if (input.contract) fields(input.contract, ES_CONTRACT_FIELDS.map(([key]) => key), '계약 ');
  for (const [label, comparison] of [['현재 ', input.current], ['직전일 ', input.previous]] as const) for (const pair of [comparison.machinery, ...comparison.standards]) fields(pair as unknown as Record<string, unknown>, ['baseSum', 'comparisonSum', 'baseLabel', 'comparisonLabel'].filter(key => key in pair), label + pair.label + ' ');
  return result;
}
function workingFormulas(input: EsInput): Record<string, string> {
  const bindings = workingBindings(input), costIndex = bindings.findIndex(b => b.label === '비목 11') + 2;
  return { B2: `SUM('ES_입력'!B${costIndex}:B${costIndex + ES_COSTS.length - 1})`, ...Object.fromEntries(ES_COSTS.map((_, i) => [`B${i + 4}`, `IF(B2=0,0,ROUND('ES_입력'!B${costIndex + i}/B2,4))`])) };
}
interface SheetXml { name: string; area: string; rows: string[][]; formulas?: Record<string, string>; hidden?: boolean; columns?: number; templateXml?: string }
function makeXlsx(sheets: SheetXml[]): Uint8Array {
  const files: Record<string, Uint8Array> = {}, put = (path: string, xml: string) => { files[path] = strToU8(xml); };
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  put('[Content_Types].xml', head + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((sheet, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`+(sheet.name==='목록'&&sheet.templateXml?`<Override PartName="/xl/drawings/drawing${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`:'')).join('')}</Types>`);
  put('_rels/.rels', head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  put('xl/_rels/workbook.xml.rels', head + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  put('xl/workbook.xml', head + `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"${s.hidden ? ' state="veryHidden"' : ''}/>`).join('')}</sheets><definedNames>${sheets.map((s, i) => `<definedName name="_xlnm.Print_Area" localSheetId="${i}">'${esc(s.name)}'!${s.area.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName>`).join('')}</definedNames><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`);
  put('xl/styles.xml', head + `<styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="12"/><name val="맑은 고딕"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs></styleSheet>`);
  for (const [i, sheet] of sheets.entries()) {
    if (sheet.templateXml) {
      let xml=sheet.templateXml;
      if(sheet.name==='목록') {
        xml=xml.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ').replace('</worksheet>','<drawing r:id="contentsDrawing"/></worksheet>');
        put(`xl/drawings/drawing${i+1}.xml`,ES_CONTENTS_DRAWING_XML);
        put(`xl/worksheets/_rels/sheet${i+1}.xml.rels`,head+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="contentsDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${i+1}.xml"/></Relationships>`);
      }
      put(`xl/worksheets/sheet${i + 1}.xml`, head + xml); continue;
    }
    const cols = sheet.columns ?? Math.max(2, ...sheet.rows.map(r => r.length));
    let rows = sheet.rows.map((row, ri) => `<row r="${ri + 1}" ht="${ri < 2 ? 32 : 25}" customHeight="1">${row.map((value, ci) => {
      const address = String.fromCharCode(65 + ci) + (ri + 1), formula = sheet.formulas?.[address], style = ri < 2 ? 1 : 0;
      if (formula) return `<c r="${address}" s="${style}"><f>${esc(formula)}</f>${/^-?\d+(\.\d+)?$/.test(value) ? `<v>${value}</v>` : ''}</c>`;
      // Explicit text type prevents =,+,-,@ text from becoming executable formulas.
      return /^-?\d+(\.\d+)?$/.test(value) && value.length < 16 ? `<c r="${address}" s="${style}"><v>${value}</v></c>` : `<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const endRow = Number(sheet.area.match(/\d+$/)?.[0] ?? sheet.rows.length);
    for (let row = sheet.rows.length + 1; row <= endRow; row++) rows += `<row r="${row}" hidden="1" ht="0" customHeight="1"/>`;
    put(`xl/worksheets/sheet${i + 1}.xml`, head + `<worksheet xmlns="${ns}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="${sheet.area}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="25"/><cols><col min="1" max="${cols}" width="${Math.floor(95 / cols)}" customWidth="1"/></cols><sheetData>${rows}</sheetData><pageMargins left="0.5" right="0.5" top="0.65" bottom="0.65" header="0.25" footer="0.25"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/><headerFooter><oddHeader>&amp;C초안 · LEGACY_REPLAY</oddHeader><oddFooter>&amp;C&amp;P / &amp;N</oddFooter></headerFooter></worksheet>`);
  }
  if(sheets.some(s=>s.templateXml)) put('xl/styles.xml',head+esTemplateStylesXml());
  return zipSync(files, { level: 6 });
}
export async function exportEsWorking(input: EsInput): Promise<Uint8Array> {
  const normalized = validateEsInput(input), snapshot = JSON.stringify(normalized), chunks = snapshot.match(/[\s\S]{1,16000}/g) ?? [''], bindings = workingBindings(normalized);
  const chain = esWorkingChain(normalized, bindings);
  return makeXlsx([
    { name: 'ES_입력', area: `A1:B${bindings.length + 1}`, rows: [['입력 항목', '값 (이 열만 수정)'], ...bindings.map(b => [b.label, b.value])] },
    { name: 'ES_계산', area: 'A1:J72', ...chain },
    { name: 'ES_작업정보', area: `A1:C${chunks.length + 3}`, hidden: true, rows: [['CLAIM_ES_WORKING_V2', await hash(snapshot), 'CHAIN_1'], ['', String(chunks.length)], ['', ''], ...chunks.map(chunk => [chunk])] },
    ...esTemplateGrids.map(grid => ({name:grid.name,area:grid.printArea,rows:[],templateXml:esTemplateSheetXml(grid,esTemplateValues(normalized,calculateEs(normalized),grid),{},normalized.printSettings)})),
  ]);
}
function reportSheet(sheet: EsOutputSheet, settings?: EsInput['printSettings']): SheetXml {
  if(sheet.grid && sheet.values) return {name:sheet.name,area:sheet.printArea,rows:[],templateXml:esTemplateSheetXml(sheet.grid,sheet.values,{},settings)};
  const [end] = sheet.printArea.split(':').slice(-1), maxRows = Number(end.match(/\d+/)![0]), cols = end.match(/^[A-Z]+/)![0].charCodeAt(0) - 64;
  const rows = [[sheet.title], ['초안 · LEGACY_REPLAY · 원본 출력배치 대조 미완료'], sheet.columns, ...sheet.rows];
  if (rows.length > maxRows) throw new Error(`${sheet.name}: 인쇄영역보다 내용이 많습니다. 출력 배치 검토가 필요합니다.`);
  // Only print-area cells are emitted; source support tables and hidden metadata are absent.
  return { name: sheet.name, area: sheet.printArea, columns: cols, rows: rows.map(row => cols === 1 ? [row.join(' : ')] : row.length > cols ? [...row.slice(0, cols - 1), row.slice(cols - 1).join(' / ')] : row) };
}
export function exportEsReport(input: EsInput, result: EsResult, selection: readonly string[]): Uint8Array {
  return makeXlsx(buildEsSheets(input, result, selection).map(sheet => reportSheet(sheet, input.printSettings)));
}
