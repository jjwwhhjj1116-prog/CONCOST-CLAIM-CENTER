import { read, utils } from 'xlsx';
import { getDocumentProxy } from 'unpdf';
import { readPublicFile } from './es-public-sources';
import { esMaterialMonth } from '../../../packages/document-engine/src/es-source-history';
import type { EsPair } from '../../../packages/document-engine/src/es-calculation';
import { ES_PAIR_LABELS, type EsPairSourceResult } from '../../../packages/document-engine/src/es-pair-candidates';
import { latestPpsNotices, latestCakReports, checkedToday, getPpsNotice } from './es-public-discovery';

const VERIFIED_THROUGH = '2026-09-10';
// Fixed official attachment catalog, not rates or customer workbooks. Per-field effective dates
// were checked inside each PPS workbook; a file can contain older dates for other fields.
export const PPS_PAIR_PUBLICATIONS: readonly (readonly [string, readonly number[], string, number, string])[] = [
  ['2023-01-01', [1,2,3,5], '202302060017', 1, '2302060022'],
  ['2023-02-28', [4], '202303290004', 1, '2303290008'],
  ['2023-05-01', [1,2,3], '202306210003', 1, '2306210004'],
  ['2023-05-10', [1], '202306210003', 2, '2306210004'],
  ['2023-07-01', [5], '202307040015', 1, '2307040020'],
  ['2023-08-30', [4], '202309270015', 1, '2309270018'],
  ['2024-01-01', [1,2,3,5], '202401250016', 1, '2401250021'],
  ['2024-03-04', [4], '202403110011', 1, '2403110016'],
  ['2024-05-01', [1,2,3], '202406040009', 1, '2406040016'],
  ['2024-05-22', [1], '202406040009', 2, '2406040016'],
  ['2024-07-01', [5], '202408010011', 1, '2408010013'],
  ['2024-08-27', [4], '202409110004', 1, '2409110006'],
  ['2025-01-01', [1,2,3,5], '202501240002', 1, '2501240009'],
  ['2025-03-06', [4], '202503240015', 1, '2503240016'],
  ['2025-05-01', [1,2,3], '202505220005', 1, '2505220007'],
  ['2025-05-12', [1], '202505220005', 2, '2505220007'],
  ['2025-07-01', [5], '202508040018', 1, '2508040036'],
  ['2025-08-25', [4], '202509150013', 1, '2509150016'],
  ['2026-01-01', [1,2,3,5], '202601220009', 1, '2601220022'],
  ['2026-03-10', [4], '202603190010', 1, '2603190012'],
  ['2026-05-08', [1,2,3], '202606100002', 1, '2606100002'],
  ['2026-05-22', [1], '202606100002', 2, '2606100002'],
  ['2026-07-01', [5], '202607100013', 1, '2607100022']
];
export const CAK_MACHINERY = {
  '2023': '1b96d3b9-9a1f-42fb-8fe9-b9d993088dd0.pdf',
  '2024': '2aa630a0-b16c-4366-8793-95407af17130.pdf',
  '2025': 'a414954a-d799-4053-9d98-3e321488fff2.pdf',
  '2026': 'b25d1f7d-c15d-4900-9806-f5f2d26239cf.pdf'
} as const;
const hash = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(b)))].map(v => v.toString(16).padStart(2, '0')).join('');
const positiveInteger = (v: unknown): string => {
  const s = String(v ?? '').replaceAll(',', '').trim();
  if (!/^\d{1,15}$/.test(s) || BigInt(s) <= 0n) throw new Error('PAIR_NUMBER_INVALID');
  return s;
};
const ppsDate = (value: unknown) => {
  const m = String(value ?? '').trim().match(/^(\d{2}|20\d{2})-(\d{2})-(\d{2})$/);
  if (!m) return ''; const date = `${m[1].length === 2 ? '20' : ''}${m[1]}-${m[2]}-${m[3]}`;
  esMaterialMonth(date); return date;
};
export function parsePpsPairRows(rows: unknown[][], index: number, baseLabel: string, comparisonLabel: string): EsPair {
  const text = rows.slice(0, 5).flat().join('').replace(/\s+/g, '');
  if (!text.includes('표준시장단가지수총괄표') || !text.includes('평균금액') || !text.includes('품목수')) throw new Error('PPS_PAIR_TEMPLATE_MISMATCH');
  const name = ['', '토목', '건축', '기계', '전기', '통신'][index];
  const matches = rows.filter(r => r[1] === name && ppsDate(r[2]) === baseLabel && ppsDate(r[7]) === comparisonLabel);
  if (matches.length !== 1) throw new Error('PPS_PAIR_PERIOD_MISSING');
  const r = matches[0], commonCount = positiveInteger(r[4]), baseSum = positiveInteger(r[5]), comparisonSum = positiveInteger(r[10]);
  const baseAverage = positiveInteger(r[6]), comparisonAverage = positiveInteger(r[11]);
  if (positiveInteger(r[9]) !== commonCount || BigInt(commonCount) > BigInt(positiveInteger(r[3])) || BigInt(commonCount) > BigInt(positiveInteger(r[8])) || BigInt(baseSum) / BigInt(commonCount) !== BigInt(baseAverage) || BigInt(comparisonSum) / BigInt(commonCount) !== BigInt(comparisonAverage)) throw new Error('PPS_PAIR_TOTAL_MISMATCH');
  return { label: ES_PAIR_LABELS[index], baseAverage, comparisonAverage, commonCount, baseSum, comparisonSum, baseLabel, comparisonLabel, source: '' };
}

export interface MachineryRow { code: string; specification: string; price: string; hourly: string }
interface PdfCell { str: string; transform: number[] }
/** Read the actual two columns, not a text regex that can mistake fuel/operator columns for cost. */
export function parseMachineryPage(cells: PdfCell[]): MachineryRow[] {
  const nonempty = cells.filter(c => c.str.trim()), headers = nonempty.filter(c => c.transform[4] < 120);
  if (!headers.some(c => c.str.replace(/\s/g, '') === '손료(원)' && c.transform[5] > 510 && c.transform[5] < 540) || !headers.some(c => c.str === '(천원)' && c.transform[5] > 420 && c.transform[5] < 460)) throw new Error('CAK_MACHINERY_COLUMNS_CHANGED');
  const codes = nonempty.filter(c => /^\d{4}-\d{4}$/.test(c.str));
  if (!codes.length || codes.some(c => c.transform[5] < 180 || c.transform[5] > 205)) throw new Error('CAK_MACHINERY_CODE_INVALID');
  return codes.map(c => {
    const row = nonempty.filter(v => Math.abs(v.transform[4] - c.transform[4]) < 1.5).sort((a,b) => a.transform[5] - b.transform[5]);
    const numberAt = (from: number, to: number) => {
      const values = row.filter(v => v.transform[5] >= from && v.transform[5] < to);
      if (values.length !== 1) throw new Error('CAK_MACHINERY_CELL_MISSING');
      // PDF.js sometimes joins the following fuel note to the hourly cell. Its first token is the cost.
      const token = values[0].str.match(/^(\d[\d,]*|-)(?:\s|$)/)?.[1];
      if (!token) throw new Error('CAK_MACHINERY_VALUE_INVALID');
      return token === '-' ? '0' : positiveInteger(token);
    };
    const specification = row.filter(v => v.transform[5] >= 245 && v.transform[5] < 410).map(v => v.str).join('').replace(/\s/g, '');
    if (!specification) throw new Error('CAK_MACHINERY_SPEC_MISSING');
    return { code: c.str, specification, price: numberAt(410, 510), hourly: numberAt(510, 568) };
  });
}
export async function parseMachineryPdf(bytes: Uint8Array, year: string): Promise<MachineryRow[]> {
  const doc = await getDocumentProxy(bytes), rows: MachineryRow[] = [];
  try {
  if (doc.numPages !== 33) throw new Error('CAK_MACHINERY_TEMPLATE_CHANGED');
  const cover = (await (await doc.getPage(1)).getTextContent()).items.filter(v => 'str' in v).map(v => v.str).join('').replace(/\s/g, '');
  if (!cover.includes(year) || !cover.includes('건설기계')) throw new Error('CAK_MACHINERY_YEAR_MISMATCH');
  // These four verified editions have cost tables p4–29; p30–33 are marine crew, not machinery.
  for (let page = 4; page <= 29; page++) {
    const p = await doc.getPage(page);
    rows.push(...parseMachineryPage((await p.getTextContent()).items.filter((v): v is typeof v & PdfCell => 'str' in v)));
    p.cleanup();
  }
  if (rows.length < 500 || rows.length > 1000 || new Set(rows.map(r => r.code)).size !== rows.length) throw new Error('CAK_MACHINERY_ROWS_INVALID');
  return rows;
  } finally { await doc.loadingTask.destroy(); }
}
export function machineryPair(base: MachineryRow[], comparison: MachineryRow[], baseYear: string, comparisonYear: string): EsPair {
  if (new Set(base.map(r => r.code)).size !== base.length || new Set(comparison.map(r => r.code)).size !== comparison.length) throw new Error('CAK_MACHINERY_DUPLICATE');
  const byCode = new Map(comparison.map(r => [r.code, r]));
  const common = base.flatMap(a => { const b = byCode.get(a.code); return b && BigInt(a.price) > 0n && BigInt(b.price) > 0n ? [{ a, b }] : []; });
  // The official rule retains existing machine classes and excludes new/deleted classes.
  // Wording/unit corrections do not justify silently deleting an existing classification code.
  if (!common.length || common.some(({a,b}) => BigInt(a.hourly) <= 0n || BigInt(b.hourly) <= 0n)) throw new Error('CAK_MACHINERY_COMMON_REVIEW');
  const count = BigInt(common.length), a = common.reduce((s, p) => s + BigInt(p.a.hourly), 0n), b = common.reduce((s, p) => s + BigInt(p.b.hourly), 0n);
  const changed = common.filter(({a,b}) => a.specification !== b.specification).map(({a,b}) => `${a.code}: ${a.specification}→${b.specification}`);
  return { label: '기계경비', commonCount: String(count), baseSum: String(a), comparisonSum: String(b), baseAverage: String(a / count), comparisonAverage: String(b / count), baseLabel: `${baseYear}-01-01`, comparisonLabel: `${comparisonYear}-01-01`, source: changed.length ? `규격 표기 변경 ${changed.length}종(동일 분류번호 유지·원문 검토): ${changed.join('; ')}` : '' };
}

export async function fetchEsPairSources(dates: string[], fetcher: typeof fetch = fetch): Promise<EsPairSourceResult> {
  if (dates.length !== 3) throw new Error('ES_SOURCE_INVALID_DATE');
  try { dates.forEach(esMaterialMonth); } catch { throw new Error('ES_SOURCE_INVALID_DATE'); }
  if (dates[0] > dates[1] || dates[0] > dates[2]) throw new Error('ES_SOURCE_INVALID_DATE');
  const result: EsPairSourceResult = { items: [], issues: [], warnings: [] };
  const publications=[...PPS_PAIR_PUBLICATIONS];
  const machineFiles: Record<string,string> = Object.fromEntries(Object.entries(CAK_MACHINERY).map(([year,id])=>[year,'https://www.cak.or.kr/download.do?uuid='+id]));
  let pairsFresh=false,machinesFresh=false,pairsMetadataFound=false,pairsUnverified=false,machinesUnverified=false;
  const books = new Map<string, Promise<{rows: unknown[][]; sha: string}>>(), machines = new Map<string, Promise<{rows: MachineryRow[]; sha: string}>>();
  const getBook=(url:string,notice:string)=>{
    let book=books.get(url);if(!book){book=(async()=>{const bytes=await readPublicFile(url,fetcher,notice),sha=await hash(bytes);const workbook=read(bytes,{type:'array',cellFormula:false,cellHTML:false,sheets:'총괄표',sheetRows:500});if(!workbook.Sheets['총괄표'])throw new Error('PPS_PAIR_SHEET_MISSING');return {rows:utils.sheet_to_json<unknown[]>(workbook.Sheets['총괄표'],{header:1,defval:null,range:'A1:L500'}),sha};})();books.set(url,book);}return book;
  };
  await Promise.all([
    (async()=>{try {
      const discovered: typeof publications=[];
      const notices=await latestPpsNotices('pairs',fetcher);pairsMetadataFound=true;
      for(const notice of notices) {
        if(!notice.attachments.length)throw new Error('PPS_NEW_PAIR_UNVERIFIED');
        let verified=false;
        const periodValues=new Map<string,string>();
        for(const file of notice.attachments) {
          // Only the actual total-sheet workbook can contribute period mappings.
          if(!/표준시장단가|지수/.test(file.title))continue;
          const data=await getBook(file.url,notice.url);
          for(let index=1;index<=5;index++) {
            const name=['','토목','건축','기계','전기','통신'][index];
            const dates=[...new Set(data.rows.filter(r=>r[1]===name).map(r=>ppsDate(r[7])).filter(Boolean))];
            for(const date of dates) {
              const rows=data.rows.filter(r=>r[1]===name&&ppsDate(r[7])===date);
              for(const row of rows) {
                const base=ppsDate(row[2]),key=index+':'+base+':'+date,value=JSON.stringify(parsePpsPairRows(data.rows,index,base,date));
                if(periodValues.has(key)&&periodValues.get(key)!==value)throw new Error('PPS_PAIR_CORRECTION_AMBIGUOUS');
                periodValues.set(key,value);
              }
              discovered.push([date,[index],file.key!,file.sn!,notice.id]);verified=true;
            }
          }
        }
        if(!verified)throw new Error('PPS_NEW_PAIR_UNVERIFIED');
      }
      publications.push(...discovered);publications.sort((a,b)=>a[0].localeCompare(b[0]));pairsFresh=true;
      result.warnings!.push('표준시장단가 최신 공표 자동확인 · '+checkedToday()+' · 총괄표 분야별 적용일 검증');
    }catch(e){pairsUnverified=pairsMetadataFound||(e instanceof Error&&e.message==='PPS_DISCOVERED_NOTICE_UNVERIFIED');result.warnings!.push('표준시장단가 최신 공표 확인·검증 실패 · '+(pairsUnverified?'새 공표 검증 전까지 자동 적용 중단':'검증된 과거 기간쌍만 사용합니다.'));}})(),
    (async()=>{try {const reports=await latestCakReports('machinery',fetcher),seen=new Set<string>();for(const r of reports)if(!seen.has(r.year)){seen.add(r.year);if(r.file)machineFiles[r.year]=r.file;else delete machineFiles[r.year];}machinesFresh=true;result.warnings!.push('기계경비 최신 공표 자동확인 · '+checkedToday()+' · '+reports[0].year+'년(파일 본문은 조회 시 검증)');}catch(e){machinesUnverified=e instanceof Error&&/CAK_ATTACHMENT/.test(e.message);result.warnings!.push('기계경비 최신 공표 확인 실패 · '+(machinesUnverified?'새 첨부 검증 전까지 자동 적용 중단':'검증된 과거 원문만 사용합니다.'));}})(),
  ]);
  const choose=(date:string,index:number)=>[...publications].reverse().find(p=>p[0]<=date&&p[1].includes(index));
  const getMachines = (year: string) => {
    let value = machines.get(year);
    if (!value) { value = (async () => { const url = machineFiles[year]; if (!url) throw new Error('CAK_YEAR_NOT_CONNECTED'); const bytes = await readPublicFile(url, fetcher, 'https://www.cak.or.kr'); const sha = await hash(bytes); return { rows: await parseMachineryPdf(bytes, year), sha }; })(); machines.set(year, value); }
    return value;
  };
  // Machinery downloads/decodes are sequential to keep the Worker memory peak bounded.
  for (const date of new Set(dates.slice(1))) for (let index = 0; index < 6; index++) {
    try {
      if(index===0?machinesUnverified:pairsUnverified)throw new Error('PAIR_NEW_PUBLICATION_UNVERIFIED');
      if (date > ((index===0?machinesFresh:pairsFresh)?checkedToday():VERIFIED_THROUGH)) throw new Error('PAIR_PUBLICATION_NOT_VERIFIED');
      let pair: EsPair;
      if (index === 0) {
        const aYear = dates[0].slice(0,4), bYear = date.slice(0,4), a = await getMachines(aYear), b = await getMachines(bYear);
        pair = machineryPair(a.rows, b.rows, aYear, bYear);
        pair.source = `대한건설협회 ${aYear}→${bYear} 공통 분류번호 ${pair.commonCount}기종 / 시간당 손료(원), 연료·운전경비 제외 / 합계÷공통수 정수 절사 / ${pair.source} / SHA256 ${a.sha},${b.sha} / ${machineFiles[aYear]} / ${machineFiles[bYear]}`;
      } else {
        const a = choose(dates[0], index), b = choose(date, index);
        if (!a || !b) throw new Error('PPS_PAIR_PERIOD_NOT_CONNECTED');
        let url = `https://www.pps.go.kr/common/fileDown.do?key=${b[2]}&sn=${b[3]}`; const notice = `https://www.pps.go.kr/kor/bbs/view.do?bbsSn=${b[4]}&key=00038`;
        if(pairsFresh) {const n=await getPpsNotice(b[4],fetcher);if(!n.attachments.some(a=>a.url===url)){const files=n.attachments.filter(a=>/표준시장단가|지수/.test(a.title));if(files.length!==1)throw new Error('PPS_CORRECTION_AMBIGUOUS');url=files[0].url;}}
        const data = await getBook(url,notice); pair = parsePpsPairRows(data.rows, index, a[0], b[0]);
        pair.source = `조달청 총괄표 ${a[0]}→${b[0]} / 공통 ${pair.commonCount}품목 / 원문 정수 평균·합계 검증 / SHA256 ${data.sha} / ${notice} / ${url}`;
      }
      result.items.push({ baseDate: dates[0], date, index, pair });
    } catch (error) {
      const code = error instanceof Error && /^(?:PUBLIC|PAIR|CAK|PPS)_[A-Z_]+(?:_\d{3})?$/.test(error.message) ? error.message : 'PAIR_SOURCE_UNAVAILABLE';
      result.issues.push({ date, index, reason: `${ES_PAIR_LABELS[index]} ${dates[0]}→${date} 공식 기간쌍 미확인 (${code}) · 기존/Excel 값 유지 · 원자료 확인 후 수동 입력` });
    }
  }
  return result;
}
