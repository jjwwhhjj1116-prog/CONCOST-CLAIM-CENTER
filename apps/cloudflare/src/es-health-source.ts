import { esDecimal as d } from '../../../packages/document-engine/src/es-decimal';

type Json = Record<string, any>;
const array = (v: any): Json[] => Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : [];
const day = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) throw new Error('ES_SOURCE_INVALID_DATE');
  return date.replaceAll('-', '');
};
/** Health only, ordinary construction employee employer share. No pension/care unit inference. */
export async function fetchEsHealthSources(oc: string, dates: string[], fetcher: typeof fetch = fetch) {
  if (!oc || !/^[A-Za-z0-9._-]{1,100}$/.test(oc)) throw new Error('LAW_API_OC_REQUIRED');
  if (!Array.isArray(dates) || !dates.length || dates.length > 3) throw new Error('ES_SOURCE_INVALID_DATE');
  dates.forEach(day);
  const read = async (path: string, params: Record<string, string>): Promise<Json> => {
    try {
      const url = new URL(`https://www.law.go.kr/DRF/${path}`); url.search = new URLSearchParams({ OC: oc, target: 'eflaw', type: 'JSON', ...params }).toString();
      const response = await fetcher(url, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
      if (!response.ok) throw new Error();
      const raw = await response.text(); if (raw.length > 1_000_000) throw new Error();
      return JSON.parse(raw) as Json;
    } catch { throw new Error('ES_LAW_SOURCE_UNAVAILABLE'); } // Never return upstream URLs/credentials/errors.
  };
  const article = async (date: string, id: string, name: string, jo: string) => {
    const list = (await read('lawSearch.do', { LID: id, query: name, nw: '1,3', efYd: `19000101~${day(date)}`, sort: 'efdes', display: '100', page: '1' })).LawSearch;
    if (!list || list.resultCode !== '00') throw new Error('ES_LAW_SOURCE_UNAVAILABLE');
    const matches = array(list.law).filter(r => String(r['법령ID']) === id && r['법령명한글'] === name && /^\d{8}$/.test(String(r['시행일자'])) && String(r['시행일자']) <= day(date)).sort((a, b) => String(b['시행일자']).localeCompare(String(a['시행일자'])));
    const chosen = matches[0]; if (!chosen || !/^\d+$/.test(String(chosen['법령일련번호']))) throw new Error('ES_LAW_HISTORY_MISSING');
    const mst = String(chosen['법령일련번호']), effective = String(chosen['시행일자']);
    if (matches.some(r => String(r['시행일자']) === effective && String(r['법령일련번호']) !== mst)) throw new Error('ES_LAW_HISTORY_AMBIGUOUS');
    const law = (await read('lawService.do', { MST: mst, efYd: effective, JO: jo })).법령;
    const info = law?.기본정보, unit = array(law?.조문?.조문단위).find(r => Number(r['조문번호']) === Number(jo.slice(0, 4)) && r['조문여부'] === '조문');
    if (!info || String(info['법령ID']) !== id || info['법령명_한글'] !== name || String(info['시행일자']) !== effective || !unit || Number(unit['조문가지번호'] || 0) !== Number(jo.slice(4)) || !/^\d{8}$/.test(String(unit['조문시행일자'])) || String(unit['조문시행일자']) > day(date)) throw new Error('ES_LAW_DETAIL_MISMATCH');
    try { day(String(unit['조문시행일자']).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')); } catch { throw new Error('ES_LAW_DETAIL_MISMATCH'); }
    const first = array(unit.항).find(r => r['항번호'] === '①'); if (!first || typeof first['항내용'] !== 'string') throw new Error('ES_LAW_ARTICLE_MISSING');
    return { text: first['항내용'] as string, effective, mst, name, jo, first };
  };
  const items = await Promise.all([...new Set(dates)].map(async date => {
    const [rate, share] = await Promise.all([article(date, '002813', '국민건강보험법 시행령', '004400'), article(date, '001971', '국민건강보험법', '007600')]);
    const match = rate.text.match(/1만분의\s*([0-9]+(?:\.[0-9]+)?)/);
    if (!match || !/직장가입자/.test(rate.text) || !/각각.*100분의\s*50/.test(share.text) || !/근로자/.test(JSON.stringify(share.first)) || !/사업주/.test(JSON.stringify(share.first))) throw new Error('ES_LAW_RATE_UNVERIFIED');
    const value = d(match[1]).div(d(200)).toString(); // x/10000 total → percent → half employer share.
    if (d(value).compare(d(0)) <= 0 || d(value).compare(d(10)) > 0) throw new Error('ES_LAW_RATE_UNVERIFIED');
    return { date, value, effectiveDate: rate.effective.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'), source: `${rate.name} 제44조① MST ${rate.mst} 시행 ${rate.effective}; ${share.name} 제76조① MST ${share.mst} 시행 ${share.effective}; 일반 건설근로자 사업주 50% / 조회 ${new Date().toISOString().slice(0, 10)} / https://www.law.go.kr/법령/국민건강보험법시행령` };
  }));
  return { items, warnings: ['공식 API 조회는 건강보험 일반 사업주 부담률(%)입니다. 노임·재료지수 및 다른 요율은 별도 공표자료·적용조건 확인이 필요합니다.'] };
}
