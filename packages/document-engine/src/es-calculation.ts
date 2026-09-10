import { EsDecimal, esDecimal as d, esSum } from './es-decimal';
import { validateEsSourceHistory, type EsSourceHistory } from './es-source-history';
import { validateEsPrintSettings, type EsPrintSettings } from './es-print-settings';

export const ES_ENGINE_VERSION = 'es-v2-legacy-1';
export const ES_COSTS = [
  [11, 'A', '직접노무비'], [12, "A′", '간접노무비'], [14, 'B', '기계경비'], [15, 'Z', '기타비목군'],
  [17, 'C', '광산품'], [18, 'D', '공산품'], [19, 'E', '전력·수도·가스·폐기물'], [20, 'F', '농림수산품'],
  [22, 'G1', '토목 표준시장단가'], [23, 'G2', '건축 표준시장단가'], [24, 'G3', '기계설비 표준시장단가'],
  [25, 'G4', '전기 표준시장단가'], [26, 'G5', '통신 표준시장단가'], [28, 'H', '산재보험료'],
  [29, 'I', '산업안전보건관리비'], [30, 'J', '고용보험료'], [31, 'K', '퇴직공제부금'],
  [32, 'L', '건강보험료'], [33, 'M', '국민연금'], [34, 'N', '장기요양보험료'],
  [35, 'Z', '기타경비'], [36, 'Z', '환경보전비'], [37, 'Z', '지급보증수수료'],
  [38, 'Z', '기계대여금 지급보증 발급액'], [39, 'Z', '안전관리비'],
  [42, 'C', '사급자재 · 광산품'], [43, 'D', '사급자재 · 공산품'], [44, 'F', '사급자재 · 농림수산품']
] as const;
export const ES_RATE_KEYS = ['injury', 'safety', 'employment', 'retirement', 'health', 'pension', 'care'] as const;
export type EsRateKey = typeof ES_RATE_KEYS[number];
export const ES_CONTRACT_FIELDS = [
  ['contractDate', '계약일', 'date', 'C11'], ['priorAdjustmentDate', '직전 조정기준일', 'date', 'C13'],
  ['firstContractDate', '1차 계약일', 'date', 'C17'], ['startDate', '착공일', 'date', 'C18'], ['endDate', '준공일', 'date', 'C19'],
  ['contractKind', '계약 방식 (계속비·장기계속공사)', 'text', 'C20'], ['bidRate', '낙찰률 (%)', 'number', 'E9'],
  ['currentContractAmount', '금차 계약금액 (원)', 'number', 'E16'], ['currentContractDate', '금차 계약일', 'date', 'E17'],
  ['currentStartDate', '금차 착공일', 'date', 'E18'], ['currentEndDate', '금차 준공일', 'date', 'E19'],
  ['advanceDate', '선금 지급일', 'date', 'E12'], ['employmentGrade', '고용보험 적용 등급', 'text', 'C23'],
  ['retirementTrade', '퇴직공제 적용 공종', 'text', 'C24'], ['legalSystem', '국가·지방·민간 적용체계', 'text', 'C25'],
  ['vatMode', '계약금액 VAT 구분', 'text', ''], ['plannedProgress', '예정 공정률 (%)', 'number', ''],
  ['actualProgress', '실행 공정률 (%)', 'number', ''],
  ['technicalDepartment', '담당 부서', 'text', 'C32'], ['technicalManager', '담당자', 'text', 'C33'], ['reportDate', '보고서 작성일', 'date', '']
] as const;
export type EsContractKey = typeof ES_CONTRACT_FIELDS[number][0];
export const newEsContract = () => Object.fromEntries(ES_CONTRACT_FIELDS.map(([key]) => [key, ''])) as Record<EsContractKey, string>;
export interface EsPeriod {
  date: string;
  wage: string;
  materials: [string, string, string, string];
  rates: Record<EsRateKey, string>;
  source: string;
}
export interface EsPair {
  label: string;
  baseAverage: string;
  comparisonAverage: string;
  commonCount: string;
  source: string;
  baseSum?: string;
  comparisonSum?: string;
  baseLabel?: string;
  comparisonLabel?: string;
}
export interface EsComparison {
  period: EsPeriod;
  machinery: EsPair;
  standards: EsPair[];
}
export interface EsInput {
  schemaVersion: 2;
  title: string;
  client: string;
  contractor: string;
  baseDate: string;
  adjustmentDate: string;
  contractAmount: string;
  costs: Record<string, string>;
  base: EsPeriod;
  current: EsComparison;
  previous: EsComparison;
  paidWorkExclusion: string;
  directPaid: string[];
  alreadyExcludedDirect: string;
  advanceContract: string;
  advancePaid: string;
  priorCompletion: string;
  otherDeduction: string;
  note: string;
  contract?: Record<EsContractKey, string>;
  sourceHistory?: EsSourceHistory;
  printSettings?: EsPrintSettings;
}
const blankPeriod = (): EsPeriod => ({ date: '', wage: '', materials: ['', '', '', ''], rates: Object.fromEntries(ES_RATE_KEYS.map(key => [key, ''])) as EsPeriod['rates'], source: '' });
const blankPair = (label: string): EsPair => ({ label, baseAverage: '', comparisonAverage: '', commonCount: '', source: '', baseSum: '', comparisonSum: '', baseLabel: '', comparisonLabel: '' });
const blankComparison = (): EsComparison => ({ period: blankPeriod(), machinery: blankPair('기계경비'), standards: ['토목', '건축', '기계설비', '전기', '통신'].map(blankPair) });
export const newEsInput = (): EsInput => ({
  schemaVersion: 2, title: '새 물가변동 산출서', client: '', contractor: '', baseDate: '', adjustmentDate: '', contractAmount: '',
  costs: Object.fromEntries(ES_COSTS.map(([row]) => [String(row), '0'])), base: blankPeriod(), current: blankComparison(), previous: blankComparison(),
  paidWorkExclusion: '0', directPaid: [], alreadyExcludedDirect: '0', advanceContract: '0', advancePaid: '0', priorCompletion: '0', otherDeduction: '0', note: '', contract: newEsContract()
});
export const previousEsDay = (date: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('날짜를 입력하세요.');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('올바르지 않은 날짜입니다.');
  parsed.setUTCDate(parsed.getUTCDate() - 1); return parsed.toISOString().slice(0, 10);
};

/** Whitelist client fields. Ownership, approval, caches and run IDs never come from imported input. */
export function validateEsInput(value: unknown): EsInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('산출서 입력 형식이 올바르지 않습니다.');
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== 2) throw new Error('지원하지 않는 산출서 버전입니다.');
  const text = (x: unknown, max = 300) => { if (typeof x !== 'string' || x.length > max) throw new Error('텍스트 길이 또는 형식이 올바르지 않습니다.'); return x; };
  const num = (x: unknown) => { const s = text(x, 40); if (s !== '') d(s); return s; };
  const object = (x: unknown) => { if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('입력 항목이 없습니다.'); return x as Record<string, unknown>; };
  const period = (x: unknown): EsPeriod => {
    const p = object(x), r = object(p.rates);
    if (!Array.isArray(p.materials) || p.materials.length !== 4) throw new Error('재료 원자료 4개가 필요합니다.');
    return { date: text(p.date, 10), wage: num(p.wage), materials: p.materials.map(num) as EsPeriod['materials'], rates: Object.fromEntries(ES_RATE_KEYS.map(k => [k, num(r[k])])) as EsPeriod['rates'], source: text(p.source, 2000) };
  };
  const pair = (x: unknown): EsPair => { const p = object(x); return { label: text(p.label), baseAverage: num(p.baseAverage), comparisonAverage: num(p.comparisonAverage), commonCount: num(p.commonCount), source: text(p.source, 2000), ...Object.fromEntries(['baseSum', 'comparisonSum', 'baseLabel', 'comparisonLabel'].filter(key => p[key] !== undefined).map(key => [key, key.endsWith('Sum') ? num(p[key]) : text(p[key])])) }; };
  const comparison = (x: unknown): EsComparison => { const p = object(x); if (!Array.isArray(p.standards) || p.standards.length !== 5) throw new Error('표준시장단가 기간쌍 5개가 필요합니다.'); return { period: period(p.period), machinery: pair(p.machinery), standards: p.standards.map(pair) }; };
  const costs = object(v.costs);
  if (!Array.isArray(v.directPaid) || v.directPaid.length > 120) throw new Error('직접 지급 내역은 120개 이내로 입력하세요.');
  return { schemaVersion: 2, title: text(v.title), client: text(v.client), contractor: text(v.contractor), baseDate: text(v.baseDate, 10), adjustmentDate: text(v.adjustmentDate, 10), contractAmount: num(v.contractAmount),
    costs: Object.fromEntries(ES_COSTS.map(([row]) => [row, num(costs[String(row)])])), base: period(v.base), current: comparison(v.current), previous: comparison(v.previous),
    paidWorkExclusion: num(v.paidWorkExclusion), directPaid: v.directPaid.map(num), alreadyExcludedDirect: num(v.alreadyExcludedDirect), advanceContract: num(v.advanceContract), advancePaid: num(v.advancePaid), priorCompletion: num(v.priorCompletion), otherDeduction: num(v.otherDeduction), note: text(v.note, 10000),
    ...(v.sourceHistory === undefined ? {} : { sourceHistory: validateEsSourceHistory(v.sourceHistory) }),
    ...(v.printSettings === undefined ? {} : { printSettings: validateEsPrintSettings(v.printSettings) }),
    ...(v.contract === undefined ? {} : { contract: Object.fromEntries(ES_CONTRACT_FIELDS.map(([key, , type]) => { const item = object(v.contract)[key] ?? ''; const val = type === 'number' ? num(item) : text(item, type === 'date' ? 10 : 300); if (type === 'date' && val) previousEsDay(val); return [key, val]; })) as Record<EsContractKey, string> }) };
}

export interface EsCalculatedRow { row: number; code: string; label: string; amount: string; weight: string; base: string; comparison: string; ratio: string; adjusted: string }
export interface EsContextResult { date: string; rows: EsCalculatedRow[]; denominator: string; weightSum: string; adjustedSum: string; k: string; displayK: string; zBase: string; zComparison: string; zIndex: string; safetyBase: string; safetyComparison: string }
export interface EsResult {
  engineVersion: string;
  status: 'INCOMPLETE' | 'LEGACY_REPLAY';
  fatal: string[];
  warnings: string[];
  current?: EsContextResult;
  previous?: EsContextResult;
  amount?: { applicable: string; gross: string; advance: string; net: string; directExtra: string };
}
export function calculateEs(value: unknown): EsResult {
  const result: EsResult = { engineVersion: ES_ENGINE_VERSION, status: 'INCOMPLETE', fatal: [], warnings: [
    '원본 호환 재현(LEGACY_REPLAY)입니다. 공식 제출 승인 계산이 아닙니다.',
    '직전일 원본의 Z·일부 표준시장단가·장기요양 참조가 현재일에 연결됩니다. 교정 규칙은 별도 검토가 필요합니다.',
    '신규비목 다중 구간·복수 선금 배분은 아직 지원하지 않습니다. 해당 계약은 이 결과로 제출하지 마세요.'
  ] };
  try {
    const input = validateEsInput(value);
    const required = (s: string, label: string) => { if (s === '') throw new Error(`${label}: 빈 값은 0이 아닙니다. 원자료를 입력하세요.`); const n = d(s); if (n.compare(d(0)) < 0) throw new Error(`${label}: 음수 입력은 지원하지 않습니다.`); return n; };
    const previousDate = previousEsDay(input.adjustmentDate); previousEsDay(input.baseDate);
    if (input.baseDate > input.adjustmentDate) throw new Error('조정기준일은 기준일 이전일 수 없습니다.');
    if (input.base.date !== input.baseDate || input.current.period.date !== input.adjustmentDate || input.previous.period.date !== previousDate) throw new Error('날짜가 바뀌었습니다. 기준·현재·직전일 원자료를 다시 선택하고 날짜를 확인하세요.');
    const amounts = Object.fromEntries(ES_COSTS.map(([row, , label]) => [row, required(input.costs[row], label)]));
    const denominator = esSum(Object.values(amounts)); if (denominator.compare(d(0)) <= 0) throw new Error('비목 금액 합계가 0입니다.');
    const weights: Record<number, EsDecimal> = Object.fromEntries(ES_COSTS.map(([r]) => [r, amounts[r].div(denominator).round(4, 'ROUND')]));
    weights[35] = amounts[35].compare(d(0)) > 0 ? d(1).sub(esSum(Object.entries(weights).filter(([r]) => ![35, 42, 43, 44].includes(Number(r))).map(([, v]) => v))) : d(0);
    if ([42, 43, 44].some(r => amounts[r].compare(d(0)) > 0)) result.warnings.push('사급자재를 포함하면 원본 기타경비 잔차가 이를 차감하지 않습니다. 표시 K와 적용 K가 다를 수 있습니다.');
    if (weights[35].compare(d(0)) < 0) throw new Error('원본 잔차 계수가 음수입니다. 원가 분류를 검토하세요.');
    const t2ratio = (end: EsDecimal, base: EsDecimal) => { if (base.compare(d(0)) <= 0) throw new Error('기준 원자료가 0이어서 지수를 계산할 수 없습니다.'); return end.div(base).mul(d(100)).round(2); };
    const labor = (c: EsComparison) => t2ratio(required(c.period.wage, '비교 노임'), required(input.base.wage, '기준 노임'));
    const pairIndex = (p: EsPair) => { const count = required(p.commonCount, `${p.label} 공통품목 수`); if (count.compare(d(0)) <= 0) throw new Error(`${p.label}: 공통품목이 없습니다.`); if (count.denominator !== 1n) throw new Error(`${p.label}: 공통품목 수는 정수여야 합니다.`); return t2ratio(required(p.comparisonAverage, `${p.label} 비교 평균`), required(p.baseAverage, `${p.label} 기준 평균`)); };
    const currentLabor = labor(input.current), currentStandard = input.current.standards.map(pairIndex);
    const calc = (c: EsComparison, previous: boolean): EsContextResult => {
      const l = labor(c), std = c.standards.map(pairIndex), base: Record<number, EsDecimal> = {}, indices: Record<number, EsDecimal> = {};
      for (const [r] of ES_COSTS) base[r] = d(100);
      indices[11] = l; indices[12] = l; indices[14] = pairIndex(c.machinery);
      [17, 18, 19, 20].forEach((r, i) => { base[r] = required(input.base.materials[i], '기준 재료지수'); indices[r] = required(c.period.materials[i], '비교 재료지수'); });
      [22, 23, 24, 25, 26].forEach((r, i) => { indices[r] = std[i]; });
      [[42, 17], [43, 18], [44, 20]].forEach(([r, origin]) => { base[r] = base[origin]; indices[r] = indices[origin]; });
      for (const [r, rate] of [[28, 'injury'], [30, 'employment'], [31, 'retirement'], [32, 'health'], [33, 'pension']] as const) {
        const start = required(input.base.rates[rate], `기준 ${rate}`).round(4), end = l.mul(required(c.period.rates[rate], `비교 ${rate}`)).div(d(100)).round(4);
        indices[r] = t2ratio(end, start);
      }
      const care0 = required(input.base.rates.health, '기준 건강요율').mul(required(input.base.rates.care, '기준 요양요율')).div(d(100)).round(4);
      const care1 = l.mul(required((previous ? input.current : c).period.rates.health, '비교 건강요율')).mul(required(c.period.rates.care, '비교 요양요율')).div(d(10000)).round(4);
      indices[34] = t2ratio(care1, care0);
      const safeRows = [11, 17, 18, 19, 20, 22, 23, 24, 25, 26, 42, 43, 44];
      const safe0 = esSum(safeRows.map(r => weights[r])).mul(required(input.base.rates.safety, '기준 안전요율')).div(d(100)).round(4);
      const safe1 = esSum(safeRows.map(r => weights[r].mul((previous && [23, 24, 25, 26].includes(r) ? currentStandard[r - 22] : indices[r]).div(base[r]).round(4)).round(6))).mul(required(c.period.rates.safety, '비교 안전요율')).div(d(100)).round(4);
      indices[29] = t2ratio(safe1, safe0);
      const zRows = [11, 17, 18, 19, 20, 22, 23, 24, 25, 26];
      const zw = zRows.map(r => r === 11 ? weights[11].add(weights[12]) : weights[r]);
      const zi = previous ? [currentLabor, ...input.current.period.materials.map(v => required(v, '현재 재료지수')), ...currentStandard] : zRows.map(r => indices[r]);
      const count = zw.filter(w => w.compare(d(0)) > 0).length;
      if (!count) throw new Error('기타비목 지수 산정에 필요한 양수 계수가 없습니다.');
      const z0 = esSum(zw.map((w, i) => w.mul(base[zRows[i]]).round(4))).div(d(count)).round(4);
      const z1 = esSum(zw.map((w, i) => w.mul(zi[i]).round(4))).div(d(count)).round(4);
      const z = t2ratio(z1, z0);
      [15, 35, 36, 37, 38, 39].forEach(r => { indices[r] = z; });
      const rows = ES_COSTS.map(([row, code, label]) => { const ratio = indices[row].div(base[row]).round(4); return { row, code, label, amount: amounts[row].toString(), weight: weights[row].toString(), base: base[row].toString(), comparison: indices[row].toString(), ratio: ratio.toString(), adjusted: weights[row].mul(ratio).round(8).toString() }; });
      const weightSum = esSum(Object.values(weights)).round(4), adjustedSum = esSum(rows.map(r => d(r.adjusted))).round(8);
      return { date: c.period.date, rows, denominator: denominator.toString(), weightSum: weightSum.toString(), adjustedSum: adjustedSum.toString(), k: adjustedSum.sub(d(1)).round(4).toString(), displayK: adjustedSum.sub(weightSum).round(4).toString(), zBase: z0.toString(), zComparison: z1.toString(), zIndex: z.toString(), safetyBase: safe0.toString(), safetyComparison: safe1.toString() };
    };
    result.current = calc(input.current, false); result.previous = calc(input.previous, true);
    const k = d(result.current.k), paid = required(input.paidWorkExclusion, '기성 제외액'), direct = esSum(input.directPaid.map(s => required(s, '직접 지급액'))).sub(required(input.alreadyExcludedDirect, '중복 제외액'));
    const directExtra = direct.compare(d(0)) > 0 ? direct : d(0), excluded = paid.add(directExtra);
    const applicable = required(input.contractAmount, '계약금액').sub(excluded);
    if (applicable.compare(d(0)) < 0) throw new Error('공제액이 계약금액보다 큽니다.');
    const gross = applicable.mul(k).round(-3), ac = required(input.advanceContract, '선금 계약금액'), ap = required(input.advancePaid, '선금 지급액');
    if (ap.compare(ac) > 0) throw new Error('선금 지급액이 선금 계약금액보다 큽니다.');
    const advanceRemaining = ac.sub(excluded.sub(required(input.priorCompletion, '이전 기성액')));
    if (ap.compare(d(0)) > 0 && advanceRemaining.compare(d(0)) < 0) throw new Error('선금 잔여 적용대가가 음수입니다. 기성 공제 배분을 확인하세요.');
    const advance = ac.compare(d(0)) > 0 ? advanceRemaining.mul(k).mul(ap).div(ac).round(0, 'ROUND') : d(0);
    result.amount = { applicable: applicable.toString(), gross: gross.toString(), advance: advance.toString(), net: gross.sub(advance).sub(required(input.otherDeduction, '기타 공제액')).round(-3).toString(), directExtra: directExtra.toString() };
    if (result.current.weightSum !== '1') result.warnings.push(`계수 합계가 ${result.current.weightSum}입니다. 적용 K와 표시 K를 구분해 검토하세요.`);
    result.status = 'LEGACY_REPLAY';
  } catch (error) { result.fatal.push(error instanceof Error ? error.message : '계산 입력을 확인하세요.'); }
  return result;
}
