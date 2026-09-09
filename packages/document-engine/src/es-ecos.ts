import type { EsInput, EsPeriod } from './es-calculation';
import { esMaterialMonth } from './es-source-history';

export const ES_ECOS_KEY = /^[A-Za-z0-9]{16,100}$/;
export const ES_ECOS_ITEMS = [['201AA', '광산품'], ['3AA', '공산품'], ['4AA', '전력,가스,수도및폐기물'], ['101AA', '농림수산품']] as const;
export interface EsEcosItem { date: string; month: string; materials: EsPeriod['materials']; source: string; checkedAt: string }
/** Official 404Y014 basic classification, 2020=100. Never substitute a subcategory or latest month. */
export async function fetchEsEcosSources(apiKey: string, dates: string[], fetcher: typeof fetch = fetch): Promise<{ items: EsEcosItem[]; warnings: string[] }> {
  if (!ES_ECOS_KEY.test(apiKey)) throw new Error('ES_ECOS_KEY_REQUIRED');
  if (!Array.isArray(dates) || !dates.length || dates.length > 3) throw new Error('ES_SOURCE_INVALID_DATE');
  dates = [...new Set(dates)];
  let months: string[];
  try { months = dates.map(esMaterialMonth); } catch { throw new Error('ES_SOURCE_INVALID_DATE'); }
  const checkedAt = new Date().toISOString();
  const results = await Promise.all([...new Set(months)].map(async month => {
    try {
      const values = await Promise.all(ES_ECOS_ITEMS.map(async ([code, name]) => {
        const time = month.replace('-', '');
        const url = `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(apiKey)}/json/kr/1/1/404Y014/M/${time}/${time}/${code}`;
        let raw: any;
        try {
          const response = await fetcher(url, { signal: AbortSignal.timeout(12_000), redirect: 'error', headers: { Accept: 'application/json' } });
          if (!response.ok) throw new Error();
          const text = await response.text(); if (text.length > 100_000) throw new Error(); raw = JSON.parse(text);
        } catch { throw new Error('ES_ECOS_UNAVAILABLE'); }
        if (raw?.RESULT?.CODE === 'INFO-200') throw new Error('ES_ECOS_NO_DATA');
        if (raw?.RESULT) throw new Error('ES_ECOS_UNAVAILABLE');
        const data = raw?.StatisticSearch, row = data?.row?.[0];
        if (Number(data?.list_total_count) !== 1 || !Array.isArray(data?.row) || data.row.length !== 1 || row.STAT_CODE !== '404Y014' || row.ITEM_CODE1 !== code || row.ITEM_NAME1 !== name || row.TIME !== time || row.UNIT_NAME !== '2020=100' || typeof row.DATA_VALUE !== 'string' || !/^\d+(?:\.\d+)?$/.test(row.DATA_VALUE) || !(Number(row.DATA_VALUE) > 0 && Number(row.DATA_VALUE) < 10_000_000) || [row.ITEM_CODE2, row.ITEM_CODE3, row.ITEM_CODE4].some(v => v != null && v !== '')) throw new Error('ES_ECOS_INVALID_RESPONSE');
        return row.DATA_VALUE as string;
      }));
      return { month, materials: values as EsPeriod['materials'] };
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      return { month, error: code === 'ES_ECOS_NO_DATA' ? '해당 월 공표 자료 없음' : code === 'ES_ECOS_INVALID_RESPONSE' ? '통계 항목·기준년·자료월 검증 실패' : '조회 실패 · 인증키 상태와 호출 제한을 확인하세요' };
    }
  }));
  const items = dates.flatMap((date, i) => {
    const result = results.find(r => r.month === months[i]);
    return result?.materials ? [{ date, month: months[i], materials: result.materials, checkedAt,
      source: `[ECOS 404Y014 / 2020=100 / 월 ${months[i]} / 항목 201AA,3AA,4AA,101AA / 조회 ${checkedAt}]` }] : [];
  });
  return { items, warnings: results.flatMap(r => r.error ? [`ECOS ${r.month}: ${r.error}. 해당 월 4개 재료지수는 반영하지 않습니다.`] : []) };
}

/** Missing lookup data must not erase values already reviewed for the same period. */
export function mergeEsSourceCandidates(existing: EsInput, candidate: EsInput): EsInput {
  const next = structuredClone(candidate);
  for (const key of ['base', 'current', 'previous'] as const) {
    const before = key === 'base' ? existing.base : existing[key].period;
    const after = key === 'base' ? next.base : next[key].period;
    if (before.date !== after.date) continue;
    let retained = false;
    const keep = (a: string, b: string) => { if (b) { retained = true; return b; } return a; };
    after.wage = keep(after.wage, before.wage);
    after.materials = after.materials.map((v, i) => keep(v, before.materials[i])) as EsPeriod['materials'];
    for (const rate of Object.keys(after.rates) as (keyof EsPeriod['rates'])[]) after.rates[rate] = keep(after.rates[rate], before.rates[rate]);
    if (retained) after.source = `${after.source} / 유지한 기존값 출처: ${before.source}`.slice(-2000);
    if (key !== 'base' && existing.base.date === next.base.date) {
      const present = (pair: EsInput['current']['machinery']) => Boolean(pair.commonCount || pair.baseAverage || pair.comparisonAverage || pair.baseSum || pair.comparisonSum);
      if (present(existing[key].machinery)) next[key].machinery = structuredClone(existing[key].machinery);
      next[key].standards = next[key].standards.map((pair, i) => existing[key].standards[i] && present(existing[key].standards[i]) ? structuredClone(existing[key].standards[i]) : pair);
    }
  }
  return next;
}

export function applyEsEcosSources(input: EsInput, items: EsEcosItem[]): EsInput {
  const next = structuredClone(input);
  for (const key of ['base', 'current', 'previous'] as const) {
    const period = key === 'base' ? next.base : next[key].period;
    const matches = items.filter(item => item.date === period.date);
    if (!matches.length) continue;
    const item = matches[0];
    if (matches.length !== 1 || item.month !== esMaterialMonth(period.date) || item.materials.length !== 4 || !item.materials.every(v => /^\d+(?:\.\d+)?$/.test(v) && Number(v) > 0) || !item.source.startsWith('[ECOS 404Y014 / 2020=100 /')) throw new Error('ES_ECOS_INVALID_RESPONSE');
    period.materials = [...item.materials];
    period.source = `${period.source} / ${item.source}`.slice(-2000);
  }
  return next;
}
