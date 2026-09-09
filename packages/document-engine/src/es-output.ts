import { type EsInput, type EsResult, type EsContextResult } from './es-calculation';
import { ES_ATTACHMENT_TITLES, esTemplateGrids, esTemplateValues, type EsTemplateGrid } from './es-template';

export const ES_SHEETS = [
  ['cover', '표지', 'A1:A18', '물가변동 산출서'],
  ['contents', '목록', 'A1:D24', '출력 목록'],
  ['divider_1', '붙1', 'A1:D47', ES_ATTACHMENT_TITLES[0]],
  ['review_summary', '1', 'A1:J42', '물가변동 검토 요약'],
  ['divider_2', '붙2', 'A1:D47', ES_ATTACHMENT_TITLES[1]],
  ['amount_adjustment', '2', 'A1:E32', '계약금액 조정 산출'],
  ['weighted_rate', '2.1', 'A1:E40', '가중평균 지수조정률'],
  ['advance_deduction', '2.2(선금)', 'A1:D32', '선금 공제'],
  ['divider_3', '붙3', 'A1:D47', ES_ATTACHMENT_TITLES[2]],
  ['rate_details', '3', 'A1:H51', '비목별 지수조정률 산출'],
  ['divider_4', '붙4', 'A1:D47', ES_ATTACHMENT_TITLES[3]],
  ['index_details', '4', 'A1:M443', '비목별 지수 산출근거'],
  ['divider_5', '붙5', 'A1:D47', ES_ATTACHMENT_TITLES[4]],
  ['previous_day_eligibility', '2.', 'A1:E24', '직전일 조정 검토'],
  ['previous_day_weighted_rate', '2.1.', 'A1:E40', '직전일 가중평균 지수조정률'],
  ['previous_day_rate_details', '3.', 'A1:H51', '직전일 비목별 지수조정률'],
  ['previous_day_index_details', '4.', 'A1:M443', '직전일 비목별 지수 산출근거']
] as const;
export type EsSheetId = typeof ES_SHEETS[number][0];
export const orderedEsSheets = (ids: readonly string[]) => {
  if (!ids.length) throw new Error('출력할 시트를 하나 이상 선택하세요.');
  if (ids.some(id => !ES_SHEETS.some(sheet => sheet[0] === id))) throw new Error('출력할 수 없는 내부 시트입니다.');
  return ES_SHEETS.filter(sheet => ids.includes(sheet[0]));
};
/** Duplicates are deduplicated; page order always follows the current bundle. */
export function parseEsPages(text: string, total: number): number[] {
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error('미리보기를 먼저 생성하세요.');
  if (!text.trim()) return Array.from({ length: total }, (_, i) => i + 1);
  if (text.length > 2000) throw new Error('페이지 지정이 너무 깁니다.');
  const selected = new Set<number>();
  for (const token of text.split(',')) {
    const match = token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('페이지는 1,3,5-8 형식으로 입력하세요.');
    const from = Number(match[1]), to = Number(match[2] ?? match[1]);
    if (from < 1 || to < from || to > total) throw new Error(`페이지 범위는 1~${total} 안에서 오름차순으로 지정하세요.`);
    for (let page = from; page <= to; page++) selected.add(page);
  }
  return [...selected].sort((a, b) => a - b);
}
export interface EsOutputSheet { id: EsSheetId; name: string; printArea: string; title: string; columns: string[]; rows: string[][]; divider: boolean; grid?: EsTemplateGrid; values?: Record<string,string> }
const detailRows = (context: EsContextResult) => context.rows.map(r => [r.code, r.label, r.amount, r.weight, r.base, r.comparison, r.ratio, r.adjusted]);
export function buildEsSheets(input: EsInput, result: EsResult, selected: readonly string[]): EsOutputSheet[] {
  return orderedEsSheets(selected).map(([id, name, printArea, title]) => {
    const divider = id === 'cover' || id.startsWith('divider_');
    const context = id.startsWith('previous_day_') ? result.previous : result.current;
    const period = id.startsWith('previous_day_') ? input.previous : input.current;
    let columns = ['항목', '내용'], rows: string[][] = [];
    if (divider) rows = [['공사명', input.title], ['발주자', input.client], ['시공자', input.contractor], ['기준일', input.baseDate], ['조정기준일', input.adjustmentDate]];
    else if (id === 'contents') rows = orderedEsSheets(selected).filter(s => s[0] !== 'contents').map(s => [s[1], s[3]]);
    else if (!context || !result.amount || result.status === 'INCOMPLETE') throw new Error('필수 계산 오류가 있습니다. 표지·붙지·목록만 초안 출력할 수 있습니다.');
    else if (id.includes('rate_details')) { columns = ['기호', '비목', '금액', '계수', '기준', '비교', '등락비', '조정계수']; rows = detailRows(context); rows.push(['', '합계', context.denominator, context.weightSum, '', '', '', context.adjustedSum], ['', '적용 K', context.k, '표시 K', context.displayK, '', '', '']); }
    else if (id.includes('index_details')) {
      columns = ['구분 / 근거', '기준값', '비교값', '결과 / 확인사항'];
      rows.push(['적용일', input.base.date, period.period.date, '직전일은 별도 원자료 snapshot'], ['노임', input.base.wage, period.period.wage, context.rows[0].comparison], ['노임 출처', input.base.source, period.period.source, '입력 원자료']);
      ['광산품', '공산품', '전력·수도·가스·폐기물', '농림수산품'].forEach((label, i) => rows.push([label, input.base.materials[i], period.period.materials[i], '월말/직전월 선택 확인']));
      [period.machinery, ...period.standards].forEach(pair => rows.push([pair.label, pair.baseAverage, pair.comparisonAverage, `공통 ${pair.commonCount}개`], ['기간쌍 출처', pair.source, '', '공통품목 정수 평균 snapshot']));
      for (const key of ['injury', 'safety', 'employment', 'retirement', 'health', 'pension', 'care'] as const) rows.push([key, input.base.rates[key], period.period.rates[key], '% 요율']);
      rows.push(['안전보건관리비 중간값', context.safetyBase, context.safetyComparison, '소수 4자리 절사'], ['기타비목 중간값', context.zBase, context.zComparison, context.zIndex]);
      context.rows.forEach(r => rows.push([`${r.code} ${r.label}`, r.base, r.comparison, `등락비 ${r.ratio}`], ['계수 적용', r.weight, r.adjusted, '등락비 4자리·조정계수 8자리 절사']));
    } else if (id === 'advance_deduction') rows = [['선금 계약금액', input.advanceContract], ['선금 지급액', input.advancePaid], ['이전 기성액', input.priorCompletion], ['적용 K', context.k], ['선금 공제액', result.amount.advance], ['산식', '원본: ROUND(잔여 적용대가 × K × 선금 지급액 / 선금 계약금액, 0)']];
    else if (id.includes('weighted_rate') || id === 'previous_day_eligibility') rows = [['기준일', input.baseDate], ['비교일', context.date], ['비목 원가 합계', context.denominator], ['계수 합계', context.weightSum], ['조정계수 합계', context.adjustedSum], ['적용 K (합계−1)', context.k], ['표시 K (합계−계수합)', context.displayK], ['판정', '법적 요건·기간·원본 참조 오류 검토 필요']];
    else rows = [['공사명', input.title], ['계약금액', input.contractAmount], ['기성 제외액', input.paidWorkExclusion], ['직접 지급 추가 제외액', result.amount.directExtra], ['적용대가', result.amount.applicable], ['적용 K', context.k], ['조정금액', result.amount.gross], ['선금 공제', result.amount.advance], ['기타 공제', input.otherDeduction], ['순조정금액', result.amount.net]];
    const grid = esTemplateGrids.find(g => g.name === name);
    const values = grid ? esTemplateValues(input, result, grid) : undefined;
    if (id === 'contents' && values) {
      values.B19 = ''; values.C19 = '';
      // Retain the original five-group layout, but never list an omitted group.
      const groups = [['divider_1','review_summary'],['divider_2','amount_adjustment','weighted_rate','advance_deduction'],['divider_3','rate_details'],['divider_4','index_details'],['divider_5','previous_day_eligibility','previous_day_weighted_rate','previous_day_rate_details','previous_day_index_details']];
      groups.forEach((ids, i) => { if (!ids.some(key => selected.includes(key))) { values[`B${i+5}`] = ''; values[`C${i+5}`] = ''; } });
    }
    return { id, name, printArea, title, columns, rows, divider, ...(grid ? { grid, values } : {}) };
  });
}
