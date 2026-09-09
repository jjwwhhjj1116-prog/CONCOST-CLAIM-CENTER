import type { EsInput, EsPair, EsPeriod } from './es-calculation';
import { esDecimal as d, esSum } from './es-decimal';

/** Imported source values, not formula caches. Kept with the document and working workbook. */
export interface EsSourceHistory {
  hash: string;
  months: { month: string; wage: string; materials: [string, string, string, string]; injury: string }[];
  rates: { kind: 'health' | 'pension' | 'care' | 'employment' | 'retirement'; date: string; values: string[] }[];
  standards: { label: string; publications: { date: string; label: string }[]; pairs: EsPair[] }[];
  machinery: { year: string; rows: [string, string][] }[];
}
export function validateEsSourceHistory(raw: unknown): EsSourceHistory {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('ES 원자료 이력 형식을 확인하세요.');
  if (JSON.stringify(raw).length > 400_000) throw new Error(`ES 원자료 이력이 저장 한도를 초과합니다 (${JSON.stringify(raw).length}자).`);
  const v = raw as EsSourceHistory;
  const str = (s: unknown, max = 300): string => { if (typeof s !== 'string' || s.length > max) throw new Error('ES 원자료 문자열을 확인하세요.'); return s; };
  const num = (s: unknown): string => { const n = str(s, 40); if (n !== '') d(n); return n; };
  const date = (s: unknown) => { const n = str(s, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(n) || new Date(n + 'T00:00:00Z').toISOString().slice(0, 10) !== n) throw new Error('ES 원자료 시행일을 확인하세요.'); return n; };
  const list = <T>(x: T[], max: number): T[] => { if (!Array.isArray(x) || x.length > max || x.some(y => !y || typeof y !== 'object')) throw new Error('ES 원자료 행 수를 확인하세요.'); return x; };
  const hash = str(v.hash, 64); if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('ES 원자료 지문이 없습니다.');
  return { hash,
    months: list(v.months, 240).map(r => { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month) || !Array.isArray(r.materials) || r.materials.length !== 4) throw new Error('ES 월별 원자료 형식 오류'); return { month: r.month, wage: num(r.wage), materials: r.materials.map(num) as EsPeriod['materials'], injury: num(r.injury) }; }),
    rates: list(v.rates, 300).map(r => { const count = r.kind === 'employment' ? 7 : r.kind === 'retirement' ? 2 : ['health', 'pension', 'care'].includes(r.kind) ? 1 : 0; if (!count || !Array.isArray(r.values) || r.values.length !== count) throw new Error('ES 요율 이력 형식 오류'); return { kind: r.kind, date: date(r.date), values: r.values.map(num) }; }),
    standards: list(v.standards, 5).map(s => ({ label: str(s.label), publications: list(s.publications, 100).map(p => ({ date: date(p.date), label: str(p.label) })), pairs: list(s.pairs, 500).map(p => ({ label: str(p.label), baseAverage: num(p.baseAverage), comparisonAverage: num(p.comparisonAverage), commonCount: num(p.commonCount), baseLabel: str(p.baseLabel), comparisonLabel: str(p.comparisonLabel), baseSum: num(p.baseSum), comparisonSum: num(p.comparisonSum), source: str(p.source, 2000) })) })),
    machinery: list(v.machinery, 20).map(y => { if (!/^\d{4}$/.test(y.year) || !Array.isArray(y.rows) || y.rows.length > 1000) throw new Error('ES 기계 단가 이력 형식 오류'); return { year: y.year, rows: y.rows.map(r => { if (!Array.isArray(r) || r.length !== 2) throw new Error('ES 기계 행 형식 오류'); return [num(r[0]), num(r[1])]; }) }; }) };
}
export function esMaterialMonth(date: string): string {
  const dt = new Date(date + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(dt.getTime()) || dt.toISOString().slice(0, 10) !== date) throw new Error('기준일과 조정기준일을 확인하세요.');
  if (dt.getUTCDate() !== new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate()) dt.setUTCDate(0);
  return dt.toISOString().slice(0, 7);
}
export function esElapsedDays(input: EsInput): string {
  const date = input.contract?.contractDate;
  if (!date || !input.adjustmentDate) return '';
  try { esMaterialMonth(date); esMaterialMonth(input.adjustmentDate); return String((Date.parse(input.adjustmentDate) - Date.parse(date)) / 86400000 - 1); } catch { return ''; }
}
/** Reconcile only changed source selectors. Ordinary saves keep reviewed manual values. */
export function syncEsSourceDates(input: EsInput, previous?: EsInput): EsInput {
  const days = esSourceDates(input);
  const mismatch = input.base.date !== days[0] || input.current.period.date !== days[1] || input.previous.period.date !== days[2];
  const changed = previous && (input.baseDate !== previous.baseDate || input.adjustmentDate !== previous.adjustmentDate || input.contract?.employmentGrade !== previous.contract?.employmentGrade || input.contract?.retirementTrade !== previous.contract?.retirementTrade);
  if (!mismatch && !changed) return input;
  if (input.sourceHistory && days.every(Boolean)) {
    const resolved = resolveEsSources(input).input;
    if (!mismatch && previous && input.baseDate === previous.baseDate && input.adjustmentDate === previous.adjustmentDate) {
      const next = structuredClone(input);
      for (const key of ['base', 'current', 'previous'] as const) {
        const period = key === 'base' ? next.base : next[key].period, candidate = key === 'base' ? resolved.base : resolved[key].period;
        if (input.contract?.employmentGrade !== previous.contract?.employmentGrade) period.rates.employment = candidate.rates.employment;
        if (input.contract?.retirementTrade !== previous.contract?.retirementTrade) period.rates.retirement = candidate.rates.retirement;
      }
      return next;
    }
    return resolved;
  }
  const next = structuredClone(input);
  const baseChanged = next.base.date !== days[0] || Boolean(previous && input.baseDate !== previous.baseDate);
  for (const [index, key] of (['base', 'current', 'previous'] as const).entries()) {
    const p = key === 'base' ? next.base : next[key].period;
    const dateChanged = p.date !== days[index];
    if (dateChanged) {
      p.date = days[index]; p.wage = ''; p.materials = ['', '', '', ''];
      for (const rate of Object.keys(p.rates) as (keyof EsPeriod['rates'])[]) if (rate !== 'safety') p.rates[rate] = '';
      p.source = '기준일 변경: 해당 기간 원자료 확인 필요';
    }
    if (previous && input.contract?.employmentGrade !== previous.contract?.employmentGrade) p.rates.employment = '';
    if (previous && input.contract?.retirementTrade !== previous.contract?.retirementTrade) p.rates.retirement = '';
    if (key !== 'base' && (baseChanged || dateChanged)) for (const pair of [next[key].machinery, ...next[key].standards]) {
      for (const field of ['baseAverage', 'comparisonAverage', 'commonCount', 'baseSum', 'comparisonSum', 'baseLabel', 'comparisonLabel', 'source'] as const) pair[field] = '';
    }
  }
  return next;
}
export function esSourceDates(input: EsInput): [string, string, string] {
  const valid = (date: string) => { try { esMaterialMonth(date); return date; } catch { return ''; } };
  const base = valid(input.baseDate), current = valid(input.adjustmentDate);
  return [base, current, current ? new Date(Date.parse(current + 'T00:00:00Z') - 86400000).toISOString().slice(0,10) : ''];
}
/** Exact month and latest effective entry at/before date. No future/current-value substitution. */
export function resolveEsSources(input: EsInput): { input: EsInput; warnings: string[] } {
  esMaterialMonth(input.baseDate); esMaterialMonth(input.adjustmentDate);
  const next = structuredClone(input), h = input.sourceHistory, warnings: string[] = [];
  if (!h) return { input: syncEsSourceDates(next), warnings: ['보관된 월별·시행일 이력이 없습니다. 원본 Excel을 다시 가져오거나 지수·요율에서 원자료를 입력하세요.'] };
  const requireOne = <T>(rows: T[], description: string): T => { if (rows.length !== 1) throw new Error(description + ': 원자료 누락 또는 중복'); return rows[0]; };
  const grade = Number(input.contract?.employmentGrade.match(/^[1-7](?=등급|$)/)?.[0]), trade = input.contract?.retirementTrade;
  const get = (fn: () => string, label: string) => { try { return fn(); } catch { warnings.push(label + ' · 확인 가능한 원자료 없음'); return ''; } };
  const period = (date: string): EsPeriod => {
    const month = (key: string) => requireOne(h.months.filter(r => r.month === key), key);
    const rate = (kind: EsSourceHistory['rates'][number]['kind'], index = 0) => { const rows = h.rates.filter(r => r.kind === kind && r.date <= date).sort((a, b) => b.date.localeCompare(a.date)); return requireOne(rows.filter(r => r.date === rows[0]?.date), kind).values[index] ?? ''; };
    return { date, wage: get(() => month(date.slice(0, 7)).wage, date + ' 노임'), materials: [0, 1, 2, 3].map(i => get(() => month(esMaterialMonth(date)).materials[i], esMaterialMonth(date) + ' 재료 ' + (i + 1))) as EsPeriod['materials'],
      rates: { injury: get(() => month(date.slice(0, 7)).injury, date + ' 산재'), safety: input.base.rates.safety,
        employment: get(() => { if (!grade) throw new Error(); return rate('employment', grade - 1); }, date + ' 고용 등급'), retirement: get(() => { if (!['토목', '건축'].includes(trade ?? '')) throw new Error(); return rate('retirement', trade === '토목' ? 0 : 1); }, date + ' 퇴직공제 공종'),
        health: get(() => rate('health'), date + ' 건강'), pension: get(() => rate('pension'), date + ' 연금'), care: get(() => rate('care'), date + ' 요양') },
      source: `가져온 Excel 이력 ${h.hash.slice(0, 12)} / 노임 ${date.slice(0, 7)}, 재료 ${esMaterialMonth(date)} / 요율 시행일 ≤ ${date}. 공식 자료 대조 필요` };
  };
  const blank = (label: string): EsPair => ({ label, baseAverage: '', comparisonAverage: '', commonCount: '', source: '', baseSum: '', comparisonSum: '', baseLabel: '', comparisonLabel: '' });
  const pair = (label: string, fn: () => EsPair) => { try { return fn(); } catch { warnings.push(label + ' 기간쌍 원자료 없음 · 지수·요율에서 확인하세요.'); return blank(label); } };
  next.base = period(input.baseDate);
  const previous = new Date(input.adjustmentDate + 'T00:00:00Z'); previous.setUTCDate(previous.getUTCDate() - 1);
  for (const [key, date] of [['current', input.adjustmentDate], ['previous', previous.toISOString().slice(0, 10)]] as const) {
    next[key].period = period(date);
    next[key].machinery = pair('기계경비', () => {
      const b = requireOne(h.machinery.filter(y => y.year === input.baseDate.slice(0, 4)), '기준연도'), c = requireOne(h.machinery.filter(y => y.year === date.slice(0, 4)), '비교연도');
      if (b.rows.length !== c.rows.length) throw new Error();
      const indices = b.rows.flatMap((r, i) => d(r[0] || '0').compare(d(0)) > 0 && d(c.rows[i][0] || '0').compare(d(0)) > 0 ? [i] : []); if (!indices.length) throw new Error();
      const sum = (rows: [string, string][]) => esSum(indices.map(i => d(rows[i][1])));
      return { label: '기계경비', commonCount: String(indices.length), baseAverage: sum(b.rows).div(d(indices.length)).round(0).toString(), comparisonAverage: sum(c.rows).div(d(indices.length)).round(0).toString(), baseSum: sum(b.rows).toString(), comparisonSum: sum(c.rows).toString(), baseLabel: b.year, comparisonLabel: c.year, source: `가져온 K0 공통품목 ${b.year} → ${c.year}` };
    });
    next[key].standards = ['토목표준', '건축표준', '기계표준', '전기표준', '통신표준'].map(label => pair(label, () => {
      const s = requireOne(h.standards.filter(s => s.label === label), label);
      const at = (day: string) => { const rows = s.publications.filter(p => p.date <= day).sort((a, b) => b.date.localeCompare(a.date)); return requireOne(rows.filter(p => p.date === rows[0]?.date), label).label; };
      return structuredClone(requireOne(s.pairs.filter(p => p.baseLabel === at(input.baseDate) && p.comparisonLabel === at(date)), label));
    }));
  }
  return { input: next, warnings: [...new Set(warnings)] };
}
