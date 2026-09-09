import type { EsInput, EsPeriod } from './es-calculation';
import { esMaterialMonth } from './es-source-history';

export const ES_ECOS_KEY = /^[A-Za-z0-9]{16,100}$/;
export const ES_ECOS_ITEMS = [['201AA', '광산품'], ['3AA', '공산품'], ['4AA', '전력,가스,수도및폐기물'], ['101AA', '농림수산품']] as const;
export interface EsEcosItem { date: string; month: string; materials: EsPeriod['materials']; source: string; checkedAt: string }
// Provider messages and URLs can contain credentials. Only locally authored text
// and strictly validated status codes may cross the server boundary.
function ecosFailureMessage(code: string): string {
  if (code === 'ES_ECOS_NO_DATA') return '해당 월 공표 자료 없음 (ECOS INFO-200)';
  if (code === 'ES_ECOS_INVALID_RESPONSE') return '통계 항목·기준년·자료월 검증 실패 (RESPONSE_MISMATCH)';
  if (code === 'ES_ECOS_INVALID_JSON') return '한국은행 응답이 JSON 통계 자료가 아닙니다 (INVALID_JSON)';
  if (code === 'ES_ECOS_TIMEOUT') return '한국은행 응답 대기시간 초과 (TIMEOUT). 잠시 후 다시 확인하세요';
  if (code === 'ES_ECOS_REDIRECT') return '한국은행 요청이 다른 주소로 전환되어 차단되었습니다 (NETWORK_REDIRECT). 서버 연결 주소 점검이 필요합니다';
  if (code === 'ES_ECOS_REDIRECT_UNSAFE') return '한국은행이 공식 HTTPS 통계 API 밖으로 주소 전환을 요청했습니다 (REDIRECT_UNSAFE). 인증키 보호를 위해 전송하지 않았습니다';
  if (code === 'ES_ECOS_REDIRECT_LIMIT') return '한국은행 주소 전환이 반복되었습니다 (REDIRECT_LIMIT). 서버 연결 주소 점검이 필요합니다';
  if (code === 'ES_ECOS_TLS') return '한국은행 보안 연결 협상에 실패했습니다 (NETWORK_TLS). 서버 인증서·통신 설정 점검이 필요합니다';
  if (code === 'ES_ECOS_DNS') return '서버에서 한국은행 주소를 찾지 못했습니다 (NETWORK_DNS). DNS 상태 점검이 필요합니다';
  if (code === 'ES_ECOS_RESET') return '한국은행 연결이 응답 전에 끊겼습니다 (NETWORK_RESET). 잠시 후 다시 확인하세요';
  if (code === 'ES_ECOS_NETWORK') return '서버에서 한국은행에 연결하지 못했습니다 (NETWORK). 서버 통신 상태 확인이 필요합니다';
  const http = code.match(/^ES_ECOS_HTTP_(\d{3})$/)?.[1];
  if (http) return `한국은행 HTTP ${http} 응답${http === '429' ? ' · 호출 제한, 잠시 후 다시 확인하세요' : http === '403' ? ' · 서버 요청이 거부되었습니다' : ' · 서버 통신 상태 확인이 필요합니다'}`;
  const provider = code.match(/^ES_ECOS_PROVIDER_((?:INFO|ERROR)-\d{3})$/)?.[1];
  if (provider === 'INFO-100') return '한국은행이 인증키를 유효하지 않다고 응답했습니다 (ECOS INFO-100). ECOS에서 발급된 현재 인증키를 확인해 다시 저장하세요';
  if (provider === 'ERROR-602') return '한국은행 과도 호출로 이용이 제한되었습니다 (ECOS ERROR-602). 잠시 후 다시 확인하세요';
  if (provider === 'ERROR-400') return '한국은행 검색 범위 처리시간을 초과했습니다 (ECOS ERROR-400). 조회 요청 점검이 필요합니다';
  if (provider) return `한국은행 API 오류 (${provider}). ECOS 이용현황에서 인증키·이용 상태를 확인하세요`;
  return '한국은행 조회 실패 (UNAVAILABLE). 잠시 후 다시 확인하세요';
}
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
        let raw: any, response: Response;
        try {
          const signal = AbortSignal.timeout(12_000);
          let requestUrl = url;
          for (let redirects = 0; ; redirects++) {
            response = await fetcher(requestUrl, { signal, redirect: 'manual', headers: { Accept: 'application/json' } });
            if (![301, 302, 303, 307, 308].includes(response.status)) break;
            const location = response.headers.get('Location');
            await response.body?.cancel();
            if (redirects >= 2) throw new Error('ES_ECOS_REDIRECT_LIMIT');
            let next: URL;
            try { if (!location) throw new Error(); next = new URL(location, requestUrl); } catch { throw new Error('ES_ECOS_REDIRECT_UNSAFE'); }
            if (next.origin !== 'https://ecos.bok.or.kr' || next.username || next.password || !next.pathname.startsWith(`/api/StatisticSearch/${encodeURIComponent(apiKey)}/`)) throw new Error('ES_ECOS_REDIRECT_UNSAFE');
            requestUrl = next.href;
          }
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : '';
          if (message === 'ES_ECOS_REDIRECT_UNSAFE' || message === 'ES_ECOS_REDIRECT_LIMIT') throw new Error(message);
          const code = reason instanceof Error && ['TimeoutError', 'AbortError'].includes(reason.name) ? 'TIMEOUT'
            : /redirect/i.test(message) ? 'REDIRECT' : /tls|ssl|certificate|handshake/i.test(message) ? 'TLS'
              : /dns|resolve|ENOTFOUND/i.test(message) ? 'DNS' : /reset|connection.*lost|closed|disconnected/i.test(message) ? 'RESET' : 'NETWORK';
          throw new Error(`ES_ECOS_${code}`);
        }
        if (!response.ok) throw new Error(`ES_ECOS_HTTP_${response.status}`);
        try { const text = await response.text(); if (text.length > 100_000) throw new Error(); raw = JSON.parse(text); }
        catch (reason) { throw new Error(reason instanceof Error && ['TimeoutError', 'AbortError'].includes(reason.name) ? 'ES_ECOS_TIMEOUT' : 'ES_ECOS_INVALID_JSON'); }
        if (raw?.RESULT?.CODE === 'INFO-200') throw new Error('ES_ECOS_NO_DATA');
        if (raw?.RESULT) throw new Error(typeof raw.RESULT.CODE === 'string' && /^(?:INFO|ERROR)-\d{3}$/.test(raw.RESULT.CODE) ? `ES_ECOS_PROVIDER_${raw.RESULT.CODE}` : 'ES_ECOS_INVALID_RESPONSE');
        const data = raw?.StatisticSearch, row = data?.row?.[0] ?? {};
        if (Number(data?.list_total_count) !== 1 || !Array.isArray(data?.row) || data.row.length !== 1 || row.STAT_CODE !== '404Y014' || row.ITEM_CODE1 !== code || row.ITEM_NAME1 !== name || row.TIME !== time || row.UNIT_NAME !== '2020=100' || typeof row.DATA_VALUE !== 'string' || !/^\d+(?:\.\d+)?$/.test(row.DATA_VALUE) || !(Number(row.DATA_VALUE) > 0 && Number(row.DATA_VALUE) < 10_000_000) || [row.ITEM_CODE2, row.ITEM_CODE3, row.ITEM_CODE4].some(v => v != null && v !== '')) throw new Error('ES_ECOS_INVALID_RESPONSE');
        return row.DATA_VALUE as string;
      }));
      return { month, materials: values as EsPeriod['materials'] };
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      return { month, error: ecosFailureMessage(code) };
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
