import { extractHwpxTables, extractPublicXlsxText, IntakeSourceError } from './intake-source';
import { esMaterialMonth } from '../../../packages/document-engine/src/es-source-history';
import type { EsPublicSourceResult, EsSourceField } from '../../../packages/document-engine/src/es-source-candidates';

// Public document identifiers, not copied rates. Re-read the official file for every lookup.
// Publication cutoffs are explicit: an unverified future version must not inherit today's rates.
export const PPS_PUBLICATIONS = [
  ['2023-01-02', '202212300001', '2212300001', '기초금액 발표'],
  ['2023-04-28', '202304250007', '2304250009', '입찰공고'],
  ['2023-07-10', '202307100012', '2307100018', '입찰공고'],
  ['2024-01-01', '202312300001', '2312300001', '기초금액 발표'],
  ['2024-03-15', '202403150002', '2403150006', '입찰공고'],
  ['2024-07-01', '202406210007', '2406210013', '기초금액 발표'],
  ['2025-01-01', '202412310017', '2412310018', '기초금액 발표'],
  ['2025-04-01', '202503280001', '2503280003', '입찰공고'],
  ['2025-05-01', '202505010004', '2505010007', '입찰공고'],
  ['2025-08-09', '202508040015', '2508040029', '입찰공고'],
  ['2026-01-01', '202512300015', '2512300024', '기초금액 발표'],
  ['2026-04-13', '202604070010', '2604070010', '입찰공고']
] as const;
const VERIFIED_THROUGH = '2026-09-10';
export const CAK_WAGE_URL = 'https://www.cak.or.kr/download.do?uuid=173735f5-cd8d-45d4-8d8f-ffc0968f8500.hwpx';
const PPS_FIELDS = ['injury', 'employment', 'retirement', 'health', 'pension', 'care'] as const;
const compact = (s: string) => s.replace(/\s+/gu, '');
const failureCode = (error: unknown): string => {
  if (error instanceof IntakeSourceError) return error.message.includes('압축을 해제') ? 'PUBLIC_DECOMPRESSION_FAILED' : error.code;
  if (error instanceof Error && /^(?:PUBLIC|PPS|CAK)_[A-Z_]+(?:_\d{3})?$/.test(error.message)) return error.message;
  if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) return 'PUBLIC_TIMEOUT';
  return 'PUBLIC_RUNTIME_FAILURE';
};
type Cell = { ref: string; col: string; row: number; text: string };
const column = (col: string) => [...col].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);

/** Labels + denominators, not absolute cell positions or incidental numbers in legal notes. */
export function parsePpsRates(text: string, trade: string, grade: string, effectiveDate?: string) {
  const first = text.split(/\[sheet2\]/u)[0];
  if (!first.includes('제비율') || !first.includes('적용기준') || !first.includes(trade)) throw new Error('PPS_TEMPLATE_MISMATCH');
  const cells: Cell[] = [...first.matchAll(/^([A-Z]+)(\d+): ([\s\S]*?)(?=^[A-Z]+\d+: |(?![\s\S]))/gmu)].map(m => ({ ref: m[1] + m[2], col: m[1], row: Number(m[2]), text: m[3].trim() }));
  const title = cells.find(c => c.row <= 5 && c.text.includes('원가계산') && c.text.includes('제비율'));
  if (!title || !title.text.includes(trade)) throw new Error('PPS_TITLE_MISMATCH');
  if (effectiveDate) {
    const m = cells.find(c => c.row <= 5 && compact(c.text).includes('적용시기'))?.text.match(/(20\d{2})[.\-]\s*(\d{1,2})[.\-]\s*(\d{1,2})/u);
    if (!m || `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` !== effectiveDate) throw new Error('PPS_PUBLICATION_MISMATCH');
  }
  const values: Partial<Record<EsSourceField, { value: string; cell: string; condition: string }>> = {};
  for (const [field, label, denominator, condition] of [
    ['health', '건강보험료', '직노', '직접노무비 기준 · 공사기간 30일 이상 여부 확인'],
    ['pension', '연금보험료', '직노', '직접노무비 기준 · 공사기간 30일 이상 여부 확인'],
    ['care', '노인장기요양보험료', '건강보험료', '건강보험료 대비 비율 · 공사기간 30일 이상 여부 확인'],
    ['injury', '산재보험료', '노', '노무비 기준 · 건설공사 적용'],
    ['retirement', '퇴직공제부금비', '직노', '직접노무비 기준 · 추정금액 1억 원 이상 여부 확인']
  ] as const) {
    const headers = cells.filter(c => compact(c.text) === `[${label}]`);
    if (headers.length !== 1) continue;
    const h = headers[0], matches = cells.filter(c => c.col === h.col && c.row > h.row && c.row <= h.row + 6 && new RegExp(`^\\(${denominator}\\)[x×]\\d+(?:\\.\\d+)?$`).test(compact(c.text)));
    if (matches.length !== 1) continue;
    const value = compact(matches[0].text).split(/[x×]/u)[1];
    if (Number(value) > 0 && Number(value) < 100) values[field] = { value, cell: matches[0].ref, condition };
  }
  const selectedGrade = grade.match(/^([1-7])(?:등급)?$/u)?.[1];
  const employment = cells.filter(c => compact(c.text) === '[고용보험료]');
  const gradeRows = cells.filter(c => selectedGrade && compact(c.text).startsWith(`[${selectedGrade}등급]`) && employment.length === 1 && c.col === employment[0].col && c.row > employment[0].row && c.row < employment[0].row + 30);
  const employmentDenominator = employment.length === 1 && cells.some(c => c.col === employment[0].col && c.row > employment[0].row && c.row <= employment[0].row + 6 && compact(c.text) === '(노)x율');
  const rateColumn = employment.length === 1 ? cells.filter(c => c.row > employment[0].row && c.row <= employment[0].row + 8 && compact(c.text) === '요율' && column(c.col) > column(employment[0].col)).sort((a, b) => column(a.col) - column(b.col))[0]?.col : undefined;
  if (gradeRows.length === 1 && employmentDenominator && rateColumn) {
    const g = gradeRows[0];
    const rate = cells.find(c => c.row === g.row && c.col === rateColumn && /^\d+(?:\.\d+)?$/u.test(c.text));
    if (rate) {
      const raw = Number(rate.text), normalized = Number(raw.toFixed(2));
      // PPS employment displays two decimals; remove only IEEE-754 storage noise.
      if (raw > 0 && raw < 10 && Math.abs(raw - normalized) < 1e-12) values.employment = { value: String(normalized), cell: rate.ref, condition: `노무비 기준 · ${g.text} · 비건설업자 소액공사 등 적용 제외 여부 확인` };
    }
  }
  return values;
}

export function parseCakWages(tables: string[][][]) {
  const matches = tables.filter(rows => rows[0]?.some(c => compact(c).startsWith('공표일')) && rows[0]?.some(c => compact(c) === '일반공사직종'));
  if (matches.length !== 1) throw new Error('CAK_TABLE_MISMATCH');
  const table = matches[0], col = table[0].findIndex(c => compact(c) === '일반공사직종');
  const rows = table.slice(1).flatMap(row => {
    const match = row[0]?.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})(?:\s|\.|$)/u);
    if (!match) return [];
    const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    esMaterialMonth(date);
    const value = row[col]?.replaceAll(',', '').trim();
    if (!/^\d{5,6}$/u.test(value ?? '')) throw new Error('CAK_VALUE_INVALID');
    return [{ date, value }];
  });
  if (rows.length < 10 || new Set(rows.map(r => r.date)).size !== rows.length) throw new Error('CAK_HISTORY_INVALID');
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export async function readPublicFile(url: string, fetcher: typeof fetch, noticeUrl: string): Promise<Uint8Array> {
  // URL is selected exclusively from this module's public catalog. No user URLs or secrets.
  const original = new URL(url), signal = AbortSignal.timeout(15_000); let target = original, response: Response;
  for (let hops = 0; ; hops++) {
    try { response = await fetcher(target, { redirect: 'manual', signal, headers: { 'User-Agent': 'ClaimCenter-ES/1.0 (official public construction statistics)', Accept: '*/*', 'Accept-Language': 'ko-KR', Referer: noticeUrl } }); }
    catch (error) { if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) throw new Error('PUBLIC_TIMEOUT'); throw new Error('PUBLIC_NETWORK'); }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location'); await response.body?.cancel();
    if (!location || hops >= 2) throw new Error('PUBLIC_REDIRECT_REJECTED');
    const next = new URL(location, target);
    if (next.origin !== original.origin || next.pathname !== original.pathname || next.username || next.password || [...original.searchParams].some(([key, value]) => next.searchParams.getAll(key).length !== 1 || next.searchParams.get(key) !== value)) throw new Error('PUBLIC_REDIRECT_REJECTED');
    target = next;
  }
  if (!response.ok) throw new Error(`PUBLIC_HTTP_${response.status}`);
  if (!response.body || Number(response.headers.get('content-length') || 0) > 5_000_000) throw new Error('PUBLIC_DOWNLOAD_FAILED');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 5_000_000) throw new Error('PUBLIC_DOCUMENT_TOO_LARGE'); chunks.push(value); }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function fetchEsPublicSources(dates: string[], trade: string, grade: string, fetcher: typeof fetch = fetch): Promise<EsPublicSourceResult> {
  if (!Array.isArray(dates) || !dates.length || dates.length > 3) throw new Error('ES_SOURCE_INVALID_DATE');
  try { dates.forEach(esMaterialMonth); } catch { throw new Error('ES_SOURCE_INVALID_DATE'); }
  const result: EsPublicSourceResult = { items: [], issues: [] }, cache = new Map<string, Promise<string>>();
  const issue = (date: string, field: EsSourceField, reason: string) => result.issues.push({ date, field, reason });
  await Promise.all([
    (async () => {
      try {
        const rows = parseCakWages(await extractHwpxTables(await readPublicFile(CAK_WAGE_URL, fetcher, 'https://www.cak.or.kr/lay1/bbs/S1T41C42/A/14/view.do?article_seq=160598')));
        for (const date of new Set(dates)) {
          const row = date <= VERIFIED_THROUGH ? rows.find(r => r.date <= date) : undefined;
          if (!row) { issue(date, 'wage', '해당 공표기간 노임 자료 미연결 · 공식 공표자료 확인 후 수동 입력'); continue; }
          result.items.push({ date, field: 'wage', value: row.value, effectiveDate: row.date, source: `대한건설협회 일반공사 평균 / 공표 ${row.date} / ${CAK_WAGE_URL}`, condition: '원본 Excel T열과 같은 일반공사 직종 평균(원/일) · 전체직종 평균·조사월과 다름' });
        }
      } catch (error) { for (const date of new Set(dates)) issue(date, 'wage', `대한건설협회 자료 조회 실패 (${failureCode(error)}) · 재조회 또는 수동 입력`); }
    })(),
    ...[...new Set(dates)].map(async date => {
      const publication = date <= VERIFIED_THROUGH ? [...PPS_PUBLICATIONS].reverse().find(p => p[0] <= date) : undefined;
      if (!publication || !['건축', '토목'].includes(trade)) {
        for (const field of PPS_FIELDS) issue(date, field, !['건축', '토목'].includes(trade) ? '기본입력의 퇴직공제 적용 공종에 건축 또는 토목을 선택·입력한 뒤 재조회' : '해당 날짜의 조달청 공표 이력 미연결 · 공식 자료 확인 후 수동 입력');
        return;
      }
      const [effectiveDate, key, notice, basis] = publication;
      const sn = trade === '건축' ? key === '202505010004' ? 3 : 2 : 1;
      const url = `https://www.pps.go.kr/common/fileDown.do?key=${key}&sn=${sn}`;
      try {
        let request = cache.get(url);
        if (!request) { request = readPublicFile(url, fetcher, `https://www.pps.go.kr/kor/bbs/view.do?bbsSn=${notice}&key=00038`).then(extractPublicXlsxText); cache.set(url, request); }
        const text = await request;
        const rates = parsePpsRates(text, trade, grade, effectiveDate);
        for (const field of PPS_FIELDS) {
          const rate = rates[field];
          if (!rate) { issue(date, field, field === 'employment' && !/^[1-7](등급)?$/u.test(grade) ? '고용보험 적용 등급 1~7등급 확인 후 재조회' : '조달청 항목·분모·값 확인 실패 · 원문 확인 후 수동 입력'); continue; }
          result.items.push({ date, field, value: rate.value, effectiveDate, source: `조달청 ${trade} ${effectiveDate} ${rate.cell} / https://www.pps.go.kr/kor/bbs/view.do?bbsSn=${notice}&key=00038`, condition: `${rate.condition} / 공표 적용: ${effectiveDate} ${basis}부터. ES 계약상 적용 여부 검토` });
        }
      } catch (error) { for (const field of PPS_FIELDS) issue(date, field, `조달청 공표자료 조회 실패 (${failureCode(error)}) · 재조회 또는 수동 입력`); }
    })
  ]);
  for (const date of new Set(dates)) issue(date, 'safety', '산업안전은 공사종류·대상액·기초액 조건 확인 필요 · 기존 원본 C22 공통값 유지, 수동 검토');
  return result;
}
