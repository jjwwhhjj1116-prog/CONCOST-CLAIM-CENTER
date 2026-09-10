import { PPS_HISTORY } from './es-pps-history-data';
import type { EsPublicSourceResult } from '../../../packages/document-engine/src/es-source-candidates';

const fields = ['injury','employment','retirement','health','pension','care'] as const;
// Known ambiguous changes must interrupt a previous version, never silently extend it.
const gaps = [
  ['2011-01-01','2011-01-03','건축','0001210645'],
  ['2011-01-01','2011-05-19','토목','0001210646'],
  ['2012-01-01','2012-03-06','건축','0001210784'],
  ['2012-01-01','2012-01-25','토목','0001210784'],
  ['2012-03-06','2012-09-16','토목','0001210799'],
] as const;
export async function fetchPpsHistory(date: string, trade: string, grade: string, load: (url:string,notice:string)=>Promise<Uint8Array>): Promise<EsPublicSourceResult> {
  const result: EsPublicSourceResult = { items: [], issues: [] };
  const gap = gaps.find(g=>g[2]===trade && g[0]<=date && date<=g[1]);
  const record = [...PPS_HISTORY].reverse().find(r=>r.trade===trade && r.date<=date);
  const notice = `https://www.pps.go.kr/kor/bbs/view.do?bbsSn=${gap?.[3] ?? record?.notice ?? '0001210645'}&key=00038`;
  const unavailable = (reason:string) => { for(const field of fields) result.issues.push({date,field,reason:reason+' / '+notice}); return result; };
  if(date<'2011-01-01' || date>='2023-01-02' || !['건축','토목'].includes(trade)) return unavailable('조달청 과거 공표 조회 범위·공종 확인 필요');
  if(gap || !record) return unavailable('당시 공표·법령 변경 적용일 추가 확인 필요 · 이전 요율을 연장하지 않음 · 원문 확인 후 수동 입력');
  if(!Object.keys(record.rates).length) return unavailable('조달청 보존 첨부의 본문 손상으로 요율 검증 불가 · 이전 요율을 연장하지 않음 · 공표 원문 확인 후 수동 입력');
  const file = `https://www.pps.go.kr/common/fileDown.do?key=${record.key}&sn=${record.sn}`;
  const bytes = await load(file,notice);
  const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(sha!==record.sha256) return unavailable('조달청 과거 원문 버전 변경 · 요율 재검증 필요 · 기존 값 유지');
  const selectedGrade = grade.match(/^([1-7])(?:등급)?$/u)?.[1];
  // Publication dates can lag statutory January changes. Do not backdate the new
  // rate or automatically extend the old one for fields that change in the new year.
  const firstThisYear = record.date.slice(0,4) < date.slice(0,4) ? PPS_HISTORY.find(r=>r.trade===trade && r.date.slice(0,4)===date.slice(0,4)) : undefined;
  for(const field of fields) {
    const rateKey = field==='employment'?'employment'+selectedGrade:field;
    const value = record.rates[rateKey];
    if(!value){result.issues.push({date,field,reason:(field==='employment'?'고용보험 적용 등급 1~7 확인 필요':'과거 원문 항목·분모 미확인')+' / '+notice});continue;}
    const changedNext = firstThisYear?.rates[rateKey];
    // The next (2023-01-02) publication is in the modern XLSX catalogue.
    if ((changedNext && changedNext[0] !== value[0]) || (date==='2023-01-01' && ['health','care'].includes(field))) {
      result.issues.push({date,field,reason:'연도 전환 후 공표판 갱신 전 · 변경 항목의 시행일 추가 확인 필요 · 전년도 요율 자동 연장 안 함 / '+notice}); continue;
    }
    const denominator = field==='care'?'건강보험료 대비':field==='injury'||field==='employment'?'노무비 대비':'직접노무비 대비';
    const historicalHealth = field==='health' && date<'2018-08-01';
    result.items.push({ date,field,value:value[0],effectiveDate:record.date,source:`조달청 ${trade} 과거 공표 ${value[1]} / ${notice} / ${file}`,
      condition:`${denominator} % / ${record.date} ${record.basis}. ${field==='retirement'?record.condition:field==='employment'?selectedGrade+'등급(당시 등급 구간·대상 확인)':historicalHealth?'국토부 공사원가 산정률(보수 기준 법정률과 다름)':'당시 공표 적용대상 확인'}. ES 계약상 적용일·기준 검토`,
      ...(historicalHealth?{basis:'PPS_CONSTRUCTION_DIRECT_LABOR' as const}:{}) });
  }
  return result;
}
