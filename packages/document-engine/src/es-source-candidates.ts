import type { EsInput, EsPeriod } from './es-calculation';
import { esSourceDates, esMaterialMonth } from './es-source-history';

export type EsSourceField = 'wage' | keyof EsPeriod['rates'];
export interface EsPublicSourceItem {
  date: string; field: EsSourceField; value: string; source: string; effectiveDate: string; condition: string;
}
export interface EsPublicSourceResult {
  items: EsPublicSourceItem[];
  issues: { date: string; field: EsSourceField; reason: string }[];
}
export const esSourceValue = (period: EsPeriod, field: EsSourceField) => field === 'wage' ? period.wage : period.rates[field];
export function setEsSourceValue(period: EsPeriod, field: EsSourceField, value: string): void {
  if (field === 'wage') period.wage = value; else period.rates[field] = value;
}
/** Verified automatic candidates take priority, but never mutate the editor before confirmation. */
export function applyEsPublicSources(input: EsInput, items: EsPublicSourceItem[]): EsInput {
  const next = structuredClone(input), dates = esSourceDates(next);
  if ([next.base, next.current.period, next.previous.period].some((period, i) => period.date !== dates[i])) throw new Error('입력 기준일과 원자료 적용일이 다릅니다.');
  const fields = ['wage', 'injury', 'employment', 'retirement', 'health', 'pension', 'care'];
  const seen = new Set<string>();
  for (const item of items) {
    esMaterialMonth(item.effectiveDate);
    const id = item.date + ':' + item.field;
    if (!fields.includes(item.field) || !dates.includes(item.date) || seen.has(id) || !/^\d+(?:\.\d+)?$/.test(item.value) || !Number.isFinite(Number(item.value)) || Number(item.value) <= 0 || Number(item.value) > (item.field === 'wage' ? 1_000_000 : 100) || !/^\d{4}-\d{2}-\d{2}$/.test(item.effectiveDate) || item.effectiveDate > item.date || typeof item.source !== 'string' || item.source.length > 600 || typeof item.condition !== 'string' || item.condition.length > 500) throw new Error('자동조회 응답의 항목·단위·적용일 검증에 실패했습니다.');
    if (!item.source.trim() || !item.condition.trim()) throw new Error('자동조회 근거가 없습니다.');
    seen.add(id);
    for (const period of [next.base, next.current.period, next.previous.period]) if (period.date === item.date) {
      setEsSourceValue(period, item.field, item.value);
      period.source = `${period.source} / ${item.field}=${item.value}; ${item.source}; ${item.condition}`.slice(-2000);
    }
  }
  return next;
}
