import * as XLSX from 'xlsx';
import { strFromU8, unzipSync } from 'fflate';
import { ES_COSTS, type EsInput } from '../../../../packages/document-engine/src/es-calculation';
import { esDecimal } from '../../../../packages/document-engine/src/es-decimal';

export interface EsCostValueCandidate {
  row: number; label: string; amount: string; cell: string; labelCell: string; sourceLabel: string; formula: boolean;
}
export interface EsCostImportChoice {
  id: string; sheetName: string; column: string; columnLabel: string; role: 'total' | 'original' | 'revised';
  costs: EsCostValueCandidate[];
  unmapped: { label: string; amount: string | null; cell: string; labelCell: string; reason: string }[];
  contractAmount?: { amount: string; cell: string; label: string; formula: boolean };
  warnings: string[];
}
export interface EsCostImportPreview { fileName: string; choices: EsCostImportChoice[]; warnings: string[] }

const compact = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/\s+/g, '');
// Only synonymous cost captions. Material/market-price classifications require separate source evidence.
const ROWS: Record<string, number> = {
  직접노무비: 11, 간접노무비: 12, 기계경비: 14,
  산재보험료: 28, 산업재해보상보험료: 28, 산업안전보건관리비: 29, 고용보험료: 30,
  퇴직공제부금비: 31, 퇴직공제부금: 31, 국민건강보험료: 32, 건강보험료: 32,
  국민연금보험료: 33, 연금보험료: 33, 노인장기요양보험료: 34, 노인장기요양보함료: 34,
  기타경비: 35, 환경보전비: 36, 하도급지급보증수수료: 37, 하도급대금지급보증수수료: 37,
  건설기계대여금지급보증서발급수수료: 38, 건설기계대여금지급보증수수료: 38, 건실기계대여금지급보증수수료: 38,
  안전관리비: 39,
};
const MATERIAL = /^(?:직접재료비|간접재료비|작업부산물|작업설,?부산물(?:\(△\))?|사급재료비)$/;
const OTHER = /^(?:공사손해보험료|공사이행보증수수료|시공보증수수료)$/;
const TOTAL = /^(?:총공사비|총계약금액|계약금액|도급금액|도급공사비|총금액)$/;
const amount = (cell: XLSX.CellObject | undefined, signed = false): string | null => {
  if (!cell || cell.t === 'e' || cell.t === 'b' || cell.t === 'd' || /%/.test(String(cell.z ?? '')) || XLSX.SSF.is_date(String(cell.z ?? ''))) return null;
  const value = typeof cell.v === 'number' && Number.isFinite(cell.v) ? String(cell.v)
    : typeof cell.v === 'string' ? cell.v.trim().replace(/,/g, '') : '';
  if (!/^-?\d{1,20}(?:\.\d{1,16})?$/.test(value)) return null;
  try { const number = esDecimal(value); return signed || number.compare(esDecimal(0)) >= 0 ? number.toString() : null; } catch { return null; }
};

/** Reads local cached cell values only. Does not calculate formulas, open links, upload, or save. */
export function parseEsCostWorkbook(bytes: Uint8Array, fileName: string): EsCostImportPreview {
  if (!bytes.length || bytes.length > 25_000_000) throw new Error('25MB 이하의 원가계산서 파일을 선택하세요.');
  const extension = fileName.toLowerCase().match(/\.(xlsx|xls)$/)?.[1];
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
  const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((v, i) => bytes[i] === v);
  if (!extension || extension === 'xlsx' && !zip || extension === 'xls' && !ole) throw new Error('실제 XLS 또는 XLSX 형식의 원가계산서가 필요합니다.');
  if (zip) {
    // Same archive limits as the existing ES workbook importer, before SheetJS expands XML.
    let size = 0, count = 0;
    const parts = unzipSync(bytes, { filter: file => {
      size += file.originalSize; count++;
      if (size > 100_000_000 || count > 5000 || file.originalSize > 30_000_000 || /(^\/|\\|(^|\/)\.\.(\/|$))/.test(file.name)) throw new Error('압축 크기 또는 내부 경로가 안전하지 않습니다.');
      if (/vbaProject|embeddings\//i.test(file.name)) throw new Error('매크로·삽입 실행 객체가 있는 파일은 지원하지 않습니다.');
      return file.name === '[Content_Types].xml';
    } });
    const manifest = parts['[Content_Types].xml'] ? strFromU8(parts['[Content_Types].xml']) : '';
    const overrides = manifest.match(/<(?:\w+:)?Override\b[^>]*>/g) ?? [];
    const workbookType = overrides.find(t => /PartName\s*=\s*["']\/xl\/workbook\.xml["']/.test(t)) ?? '';
    // SheetJS emits an unused macro-enabled .bin Default even in normal XLSX; inspect actual Overrides.
    if (!/ContentType\s*=\s*["']application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet\.main\+xml["']/.test(workbookType) || overrides.some(t => /macroEnabled|vbaProject/i.test(t)) || /<!DOCTYPE|<!ENTITY/i.test(manifest)) throw new Error('매크로 형식이 아닌 .xlsx 통합문서만 지원합니다.');
  }
  let book: XLSX.WorkBook;
  try { book = XLSX.read(bytes, { type: 'array', cellFormula: true, cellNF: true, bookVBA: true, sheetRows: 501 }); }
  catch { throw new Error('원가계산서를 읽지 못했습니다. 암호·손상 여부를 확인하고 Excel에서 저장한 파일을 선택하세요.'); }
  if (book.vbaraw) throw new Error('매크로가 포함된 원가계산서는 지원하지 않습니다. 매크로 없는 사본을 사용하세요.');
  if (book.SheetNames.length > 100) throw new Error('시트가 100개 이하인 원가계산서를 선택하세요.');
  const preview: EsCostImportPreview = { fileName, choices: [], warnings: [] };
  const visible = book.SheetNames.filter((name, index) => !book.Workbook?.Sheets?.[index]?.Hidden && /원가.*계산|계산.*원가/.test(name));
  const summaries = visible.filter(name => /총괄/.test(name));
  const sheets = summaries.length ? summaries : visible;
  if (book.SheetNames.some((_, index) => book.Workbook?.Sheets?.[index]?.Hidden)) preview.warnings.push('숨김 시트는 가져오기 대상에서 제외했습니다.');
  if (summaries.length && visible.length > summaries.length) preview.warnings.push('총괄표와 분야별 표의 중복을 막기 위해 총괄 원가계산서만 선택합니다.');
  for (const name of sheets) {
    const sheet = book.Sheets[name], extent = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
    if (XLSX.utils.decode_range(sheet['!fullref'] ?? sheet['!ref'] ?? 'A1').e.r >= 500) { preview.warnings.push(`${name}: 500행을 넘는 표는 범위를 확인한 뒤 별도 원가표로 저장하세요.`); continue; }
    const rowLabels: { row: number; cell: string; label: string; key: string }[] = [];
    for (let row = 0; row <= extent.e.r; row++) for (let col = 0; col < 4; col++) {
      const cell = XLSX.utils.encode_cell({ r: row, c: col }), source = sheet[cell];
      if (source?.t !== 's' || source.f) continue;
      const label = String(source.v ?? '').trim(), key = compact(label);
      if (ROWS[key] || MATERIAL.test(key) || OTHER.test(key) || TOTAL.test(key)) rowLabels.push({ row, cell, label, key });
    }
    type Column = { index: number; label: string; total: boolean; role: EsCostImportChoice['role'] };
    let columns: Column[] = [];
    for (let col = 3; col <= Math.min(extent.e.c, 59); col++) {
      const captions = Array.from({ length: 8 }, (_, row) => sheet[XLSX.utils.encode_cell({ r: row, c: col })])
        .filter(c => c?.t === 's' && !c.f).map(c => compact(c.v));
      if (captions.some(t => /대비|증감|차액|제비율|구성비/.test(t))) continue;
      const total = captions.some(t => /^합계(?:\([^)]+\))?$/.test(t));
      const original = captions.some(t => /^당초(?:\([A-Z]\))?$/.test(t));
      const revised = captions.some(t => /^변경(?:\([A-Z]\))?$/.test(t));
      if (!total && !original && !revised && !captions.includes('금액')) continue;
      const monetaryRows = rowLabels.filter(r => ROWS[r.key] && amount(sheet[XLSX.utils.encode_cell({ r: r.row, c: col })]) !== null);
      if (monetaryRows.length < 3) continue;
      const role = revised ? 'revised' : original ? 'original' : 'total';
      columns.push({ index: col, total, role, label: `${role === 'original' ? '당초' : role === 'revised' ? '변경' : ''}${total ? ' 합계' : role === 'total' ? '금액' : ' 금액'}`.trim() });
    }
    // A total band owns its component columns. Never offer both as additive sources.
    if (columns.some(c => c.total)) columns = columns.filter(c => c.total);
    for (const column of columns) {
      const col = XLSX.utils.encode_col(column.index);
      const choice: EsCostImportChoice = { id: `${book.SheetNames.indexOf(name)}:${col}`, sheetName: name, column: col,
        columnLabel: column.label, role: column.role, costs: [], unmapped: [], warnings: [] };
      let totalCandidates = 0;
      for (const r of rowLabels) {
        const cell = XLSX.utils.encode_cell({ r: r.row, c: column.index }), source = sheet[cell];
        const numeric = amount(source), target = ROWS[r.key];
        if (target) {
          if (numeric === null) { choice.unmapped.push({ label: r.label, amount: null, cell, labelCell: r.cell, reason: '빈칸·오류·요율은 금액 0으로 바꾸지 않습니다.' }); continue; }
          choice.costs.push({ row: target, label: ES_COSTS.find(([row]) => row === target)![2], amount: numeric, cell, labelCell: r.cell, sourceLabel: r.label, formula: Boolean(source.f) });
        } else if (TOTAL.test(r.key)) {
          if (numeric !== null) {
            if (++totalCandidates > 1) choice.warnings.push('총액 후보가 여러 개입니다. 계약서 금액을 대조하고 직접 입력하세요.');
            else choice.contractAmount = { amount: numeric, cell, label: r.label, formula: Boolean(source.f) };
          }
        } else choice.unmapped.push({ label: r.label, amount: amount(source, true), cell, labelCell: r.cell,
          reason: MATERIAL.test(r.key) ? '광산품·공산품 등 ES 재료 분류를 원본에서 확인할 수 없어 자동 배분하지 않습니다.' : '현재 ES 비목에 직접 대응하는 분류가 없습니다. 원가 근거를 확인하세요.' });
      }
      const duplicateRows = new Set(choice.costs.filter((c, i, all) => all.findIndex(x => x.row === c.row) !== i).map(c => c.row));
      for (const c of choice.costs.filter(c => duplicateRows.has(c.row))) choice.unmapped.push({ label: c.sourceLabel, amount: c.amount, cell: c.cell, labelCell: c.labelCell, reason: '같은 비목이 반복되어 자동 합산하지 않습니다.' });
      choice.costs = choice.costs.filter(c => !duplicateRows.has(c.row));
      if (choice.warnings.length) delete choice.contractAmount;
      if (choice.costs.some(c => c.formula) || choice.contractAmount?.formula) choice.warnings.push('수식은 실행하지 않고 Excel에 저장된 계산값을 읽습니다. 최신 계산·저장본인지 확인하세요.');
      if (choice.contractAmount) choice.warnings.push('총액 후보는 선택한 표의 금액입니다. 계약 버전·부가세·사업비 포함 범위를 확인한 경우에만 총계약금액에 반영하세요.');
      else choice.warnings.push('이 금액열에서는 총계약금액을 확정할 수 없습니다. 계약서 금액을 확인하세요.');
      if (choice.costs.length) preview.choices.push(choice);
    }
  }
  if (!preview.choices.length) throw new Error('원가계산서의 비목과 합계·당초·변경 금액열을 확인할 수 없습니다. 제목·비목·금액열이 있는 원가표를 선택하세요.');
  preview.warnings.push('한 시트의 한 금액열만 선택합니다. 다른 파일·당초·변경·분야별 금액은 자동으로 합산하지 않습니다.');
  return preview;
}

/** Only the explicitly selected fields change. Import review itself never changes the document. */
export function applyEsCostChoice(input: EsInput, choice: EsCostImportChoice, selectedRows: number[], applyContractAmount = false): EsInput {
  const next = structuredClone(input), selected = new Set(selectedRows);
  if (selected.size !== selectedRows.length) throw new Error('반영할 비목이 중복되었습니다.');
  for (const row of selected) {
    const candidates = choice.costs.filter(c => c.row === row);
    if (!ES_COSTS.some(([valid]) => valid === row) || candidates.length !== 1 || amount({ t: 's', v: candidates[0].amount }) === null) throw new Error('반영할 비목 금액과 원본 근거를 확인하세요.');
    next.costs[row] = amount({ t: 's', v: candidates[0].amount })!;
  }
  if (applyContractAmount) {
    if (!choice.contractAmount || amount({ t: 's', v: choice.contractAmount.amount }) === null) throw new Error('총계약금액 후보가 없습니다.');
    next.contractAmount = amount({ t: 's', v: choice.contractAmount.amount })!;
  }
  return next;
}
