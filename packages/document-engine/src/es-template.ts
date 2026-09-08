import template from './es-template-layout';
import type { EsInput, EsResult, EsContextResult } from './es-calculation';
import { esDecimal as d, esSum } from './es-decimal';
import { esThemeColors, esIndexedColors } from './es-template-colors';

export interface EsCellStyle { font: { name: string; size: number; bold?: boolean; italic?: boolean; underline?: boolean; color?: unknown }; numberFormat: string; alignment?: Record<string, string>; borders?: Record<string, { style?: string; color?: unknown }>; fill?: unknown }
export interface EsTemplateGrid { name: string; printArea: string; defaultRowHeight: number; rowHeights: Record<string, number>; rowStyles?: Record<string, number>; hiddenRows: number[]; columns: Record<string, { width: number; style?: number }>; merges: string[]; cellStyles: [string, number][]; margins: Record<string, string>; pageSetup: Record<string, string>; staticCells: Record<string, string>; fields: Record<string, string> }
export const esTemplateStyles = template.styles as unknown as EsCellStyle[];
export const esTemplateGrids = template.sheets as unknown as EsTemplateGrid[];
export function esTemplateColor(value: unknown): string {
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return value;
  const v = value as { theme?: number; indexed?: number; tint?: number } | undefined;
  const raw = v?.theme !== undefined ? esThemeColors[v.theme] : v?.indexed !== undefined ? esIndexedColors[v.indexed] : undefined;
  if (typeof raw !== 'string') return '#111111';
  const hex = raw.replace('#','').slice(-6), tint = v?.tint ?? 0;
  return '#' + [0,2,4].map(i => {const n=parseInt(hex.slice(i,i+2),16);return Math.round(tint<0?n*(1+tint):n*(1-tint)+255*tint).toString(16).padStart(2,'0');}).join('');
}
export const esCellPosition = (address: string): [number, number] => { const m = address.match(/^([A-Z]+)(\d+)$/)!; return [Number(m[2]), [...m[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0)]; };
export const esCellAddress = (row: number, col: number) => { let letters = ''; while (col) { letters = String.fromCharCode(65 + (col - 1) % 26) + letters; col = Math.floor((col - 1) / 26); } return letters + row; };
const sum = (values: string[]) => esSum(values.map(d)).toString();
const at = (value: unknown, path: string): unknown => path.split('.').reduce<unknown>((v, k) => v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, k) ? (v as Record<string, unknown>)[k] : undefined, value);

/** No workbook formula/cache is evaluated here. Values come only from the immutable run. */
export function esTemplateValues(input: EsInput, result: EsResult, grid: EsTemplateGrid): Record<string, string> {
  const excluded = result.amount ? d(input.paidWorkExclusion).add(d(result.amount.directExtra)).toString() : '';
  const metadata = input.contract ?? {};
  const contexts: Record<string, unknown> = {};
  for (const name of ['current', 'previous'] as const) {
    const c = result[name]; if (!c) continue;
    const p = input[name], rows = Object.fromEntries(c.rows.map(r => [r.row, r]));
    const subtotals: Record<string, unknown> = {};
    for (const [n, members] of Object.entries({ 10: [11,12], 13: [14,15], 16: [17,18,19,20], 21: [22,23,24,25,26], 27: [28,29,30,31,32,33,34,35,36,37,38,39], 40: c.rows.filter(r => r.row < 40).map(r => r.row), 41: [42,43,44], 45: c.rows.map(r => r.row) })) {
      subtotals[n] = Object.fromEntries(['amount','weight','adjusted'].map(k => [k, sum(members.map(r => String(at(rows[r], k))))]));
    }
    const safeRows = [11,17,18,19,20,22,23,24,25,26,42,43,44];
    const safetyRatios = Object.fromEntries(safeRows.map(r => [r, name === 'previous' && r >= 23 && r <= 26 ? result.current!.rows.find(x => x.row === r)!.ratio : rows[r].ratio]));
    const contributions = Object.fromEntries(safeRows.map(r => [r, d(rows[r].weight).mul(d(safetyRatios[r])).round(6).toString()]));
    const otherRows = [11,17,18,19,20,22,23,24,25,26];
    const groups = otherRows.map(r => {
      const weight = r === 11 ? d(rows[11].weight).add(d(rows[12].weight)).toString() : rows[r].weight;
      const comparison = name === 'previous' ? result.current!.rows.find(x => x.row === r)!.comparison : rows[r].comparison;
      return { weight, base: rows[r].base, comparison, baseContribution: d(weight).mul(d(rows[r].base)).round(4).toString(), comparisonContribution: d(weight).mul(d(comparison)).round(4).toString() };
    });
    const rateDetails: Record<string, unknown> = {};
    for (const [key, row] of [['injury',28],['retirement',31],['employment',30],['health',32],['pension',33],['care',34]] as const) {
      const baseIntermediate = key === 'care' ? d(input.base.rates.health).mul(d(input.base.rates.care)).div(d(100)).round(4) : d(input.base.rates[key]).round(4);
      const comparisonIntermediate = key === 'care' ? d(rows[11].comparison).mul(d((name === 'previous' ? input.current : p).period.rates.health)).mul(d(p.period.rates.care)).div(d(10000)).round(4) : d(rows[11].comparison).mul(d(p.period.rates[key])).div(d(100)).round(4);
      rateDetails[key] = { baseIntermediate: baseIntermediate.toString(), comparisonIntermediate: comparisonIntermediate.toString(), display: { baseStatement: `${input.baseDate} 적용 ${input.base.rates[key]}%`, comparisonStatement: `${c.date} 적용 ${p.period.rates[key]}%`, equation: `${comparisonIntermediate} ÷ ${baseIntermediate} × 100 = ${rows[row].comparison}` } };
    }
    const pairDisplay = (pair: typeof p.machinery) => ({ baseStatement: `${pair.baseLabel || input.baseDate} · 공통 ${pair.commonCount}개 · 평균 ${pair.baseAverage}`, comparisonStatement: `${pair.comparisonLabel || c.date} · 공통 ${pair.commonCount}개 · 평균 ${pair.comparisonAverage}`, equation: `${pair.comparisonAverage} ÷ ${pair.baseAverage} × 100` });
    contexts[name] = { ...p, ...c, costRows: rows, subtotals, rateDetails, safety: { ratios: safetyRatios, contributions, weightSum: sum(safeRows.map(r => rows[r].weight)), changedWeightSum: sum(Object.values(contributions)) }, other: { groups, baseSum: sum(groups.map(g => g.baseContribution)), comparisonSum: sum(groups.map(g => g.comparisonContribution)) },
      standards: p.standards.map(pair => ({ ...pair, display: pairDisplay(pair) })),
      cohorts: [{ periodLabel: `${input.baseDate} ~ ${c.date}`, amount: c.denominator, amountWeight: '1', k: c.k, weightedK: c.k }], cohortAmountTotal: c.denominator, cohortWeightSum: '1', legacyThresholdStatus: '원본 호환 · 법적 요건 검토 필요',
      display: { periodCaption: `기준일 ${input.baseDate} / 비교일 ${c.date}`, rateDetailsTitle: '비목별 지수조정률 산출', rateEquation: `${c.adjustedSum} − ${c.weightSum} = ${c.displayK}`, wageStatement: `${c.date} 적용 노임 ${p.period.wage}`, wageEquation: `${p.period.wage} ÷ ${input.base.wage} × 100 = ${rows[11].comparison}`, machineryBaseStatement: pairDisplay(p.machinery).baseStatement, machineryComparisonStatement: pairDisplay(p.machinery).comparisonStatement, machineryEquation: pairDisplay(p.machinery).equation,
        materialRatio: [17,18,19,20].map(r => rows[r].ratio), materialPeriod: p.period.materials.map(() => `${input.baseDate} / ${c.date}`), safetyEquation: `${c.safetyComparison} ÷ ${c.safetyBase} × 100 = ${rows[29].comparison}`, otherBaseEquation: `양수 계수 비목 평균 = ${c.zBase}`, otherComparisonEquation: `양수 계수 비목 평균 = ${c.zComparison}`, otherRatioEquation: `${c.zComparison} ÷ ${c.zBase} × 100 = ${c.zIndex}` }
    };
  }
  const advanceRemaining = result.amount ? d(input.advanceContract).sub(d(excluded).sub(d(input.priorCompletion))).toString() : '';
  const display = { ...Object.fromEntries(['currentContractDate','currentContractAmount','currentStartDate','currentEndDate'].map(k => [k, at(metadata,k)])), technicalContacts: [at(metadata,'technicalDepartment'),at(metadata,'technicalManager')].filter(Boolean).join(' · '), elapsedDays: input.baseDate && input.adjustmentDate ? String(Math.round((Date.parse(input.adjustmentDate)-Date.parse(input.baseDate))/86400000)) : '', baseDate: input.baseDate, baseDateCaption: '입찰 기준일', totalExcluded: excluded, directPaidExclusionCaption: '직접 지급액 (중복 제외 후)', directPaidEvidence: input.directPaid.join(' + '), advanceEvidence: '단일 선금 원본 호환 산식', advanceDateEvidence: at(metadata,'advanceDate'), advancePaidEvidence: input.advancePaid, advancePaidRatio: input.advancePaid !== '' && input.advanceContract && d(input.advanceContract).compare(d(0)) > 0 ? d(input.advancePaid).div(d(input.advanceContract)).toString() : '0', advanceRuleDescription: '선금 잔여 적용대가 × 적용 K × 선금 지급액 / 선금 계약금액 (원 단위 반올림)', advanceContractNetOfPriorCompletion: input.advanceContract ? d(input.advanceContract).sub(d(input.priorCompletion || '0')).toString() : '', priorCompletionNote: input.priorCompletion, advanceApplicable: advanceRemaining, currentContractCaption: '선금 지급 계약', advanceEquation: `${advanceRemaining} × ${result.current?.k ?? '—'} × ${input.advancePaid} / ${input.advanceContract}` };
  const root = { input, metadata, ...contexts, amount: result.amount, display, base: { display: { wageStatement: `${input.baseDate} 적용 노임 ${input.base.wage}` } } };
  const values: Record<string,string> = { ...grid.staticCells };
  for (const [address, field] of Object.entries(grid.fields)) {
    const [path, format] = field.split(':');
    let value = at(root, path);
    // Original F19 is the narrow equals cell; G19 already contains the resulting index.
    if (path.endsWith('.display.wageEquation')) value = '=';
    if (path.startsWith('output.dividerTitle.')) value = ['','물가변동 검토 요약','계약금액 조정 산출','비목별 지수조정률 산출','비목별 지수 산출근거','조정기준일 직전일 검토'][Number(path.split('.').at(-1))];
    if (path.startsWith('output.attachmentNumber.')) value = '붙임 ' + path.split('.').at(-1);
    if (value === undefined || value === '') { values[address] = '—'; continue; }
    let text = String(value);
    if (format === 'percent') text = d(text).mul(d(100)).toString() + '%';
    else if (format === 'yearMonth' && /^\d{4}-\d{2}/.test(text)) text = text.slice(0,4) + '년 ' + text.slice(5,7) + '월';
    else if (format === 'longDate' && /^\d{4}-\d{2}-\d{2}$/.test(text)) text = text.replace(/^(\d+)-(\d+)-(\d+)$/, '$1년 $2월 $3일');
    values[address] = text;
  }
  return values;
}
