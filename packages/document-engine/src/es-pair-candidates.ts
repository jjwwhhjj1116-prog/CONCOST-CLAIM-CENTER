import type { EsInput, EsPair } from './es-calculation';
import { esSourceDates, esMaterialMonth } from './es-source-history';

export const ES_PAIR_LABELS = ['기계경비', '토목 표준시장단가', '건축 표준시장단가', '기계설비 표준시장단가', '전기 표준시장단가', '통신 표준시장단가'] as const;
export interface EsPairSourceItem { baseDate: string; date: string; index: number; pair: EsPair }
export interface EsPairSourceResult { items: EsPairSourceItem[]; issues: { date: string; index: number; reason: string }[]; warnings?: string[] }

/** Only validated period pairs enter the confirmation draft. The saved document is untouched. */
export function applyEsPairSources(input: EsInput, items: EsPairSourceItem[]): EsInput {
  const next = structuredClone(input), dates = esSourceDates(next), seen = new Set<string>();
  if ([next.base, next.current.period, next.previous.period].some((p, i) => p.date !== dates[i])) throw new Error('원자료 적용일이 입력 기준일과 다릅니다.');
  for (const item of items) {
    const p = item.pair, key = item.date + ':' + item.index;
    if (item.baseDate !== dates[0] || !dates.slice(1).includes(item.date) || !Number.isInteger(item.index) || item.index < 0 || item.index > 5 || seen.has(key) || !p || typeof p.source !== 'string' || !p.source.trim() || p.source.length > 2000) throw new Error('공식 기간쌍의 날짜·분야·근거가 올바르지 않습니다.');
    for (const field of ['baseAverage', 'comparisonAverage', 'commonCount', 'baseSum', 'comparisonSum'] as const) if (typeof p[field] !== 'string' || !/^\d{1,18}$/.test(p[field]!) || BigInt(p[field]!) <= 0n) throw new Error('공식 기간쌍의 공통 수·합계·평균이 올바르지 않습니다.');
    if (Number(p.commonCount) > 100_000 || BigInt(p.baseSum!) / BigInt(p.commonCount) !== BigInt(p.baseAverage) || BigInt(p.comparisonSum!) / BigInt(p.commonCount) !== BigInt(p.comparisonAverage)) throw new Error('공통품목 합계와 정수 평균이 일치하지 않습니다.');
    esMaterialMonth(p.baseLabel ?? ''); esMaterialMonth(p.comparisonLabel ?? '');
    if (p.baseLabel! > item.baseDate || p.comparisonLabel! > item.date || p.baseLabel! > p.comparisonLabel!) throw new Error('미래 공표자료는 적용할 수 없습니다.');
    seen.add(key);
    for (const c of [next.current, next.previous]) if (c.period.date === item.date) {
      const target = item.index === 0 ? c.machinery : c.standards[item.index - 1];
      Object.assign(target, { baseAverage: p.baseAverage, comparisonAverage: p.comparisonAverage, commonCount: p.commonCount, baseSum: p.baseSum, comparisonSum: p.comparisonSum, baseLabel: p.baseLabel, comparisonLabel: p.comparisonLabel, source: p.source });
    }
  }
  return next;
}
