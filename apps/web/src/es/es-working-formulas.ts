import { ES_COSTS, calculateEs, type EsInput } from '../../../../packages/document-engine/src/es-calculation';

/** Explicit Excel counterpart of the supported legacy engine. Never evaluates uploaded formulas. */
export function esWorkingChain(input: EsInput, bindings: readonly { label: string; value: string }[]) {
  const formulas: Record<string, string> = {}, rows = Array.from({ length: 72 }, () => Array(10).fill('') as string[]);
  const ref = (label: string) => {
    const index = bindings.findIndex(b => b.label === label);
    if (index < 0) throw new Error(`작업용 입력 연결이 없습니다: ${label}`);
    return `'ES_입력'!B${index + 2}`;
  };
  const n = (label: string) => { const r = ref(label); return `IF(OR(${r}="",${r}<0),NA(),${r})`; };
  const put = (cell: string, formula: string, cached = '') => { formulas[cell] = formula; rows[Number(cell.slice(1)) - 1][cell.charCodeAt(0) - 65] = cached; };
  const line = (r: number) => ES_COSTS.findIndex(([row]) => row === r) + 4;
  const cost = (r: number) => `C${line(r)}`, weight = (r: number) => `B${line(r)}`;
  const down = (formula: string, digits: number) => `ROUNDDOWN(${formula},${digits})`;
  const sum = (terms: string[]) => `SUM(${terms.join(',')})`;
  const result = calculateEs(input);
  rows[0] = ['원본 호환 계산 · LEGACY_REPLAY', '검토용 / 공식 제출 승인 아님'];
  rows[1][0] = '비목 원가 합계';
  rows[2] = ['비목', '계수', '금액', '기준지수', '현재지수', '직전일지수', '현재 등락비', '직전 등락비', '현재 조정계수', '직전 조정계수'];
  put('B2', 'SUM(C4:C31)', result.current?.denominator);
  for (const [i, [r, code, label]] of ES_COSTS.entries()) {
    rows[i + 3][0] = `${code} ${label}`;
    put(cost(r), n('비목 ' + r), input.costs[r]);
    put(weight(r), r === 35 ? `IF(${cost(r)}>0,1-${sum(ES_COSTS.filter(([row]) => ![35, 42, 43, 44].includes(row)).map(([row]) => weight(row)))},0)` : `IF(B2=0,NA(),ROUND(${cost(r)}/B2,4))`, result.current?.rows[i].weight);
    const materialIndex = [17, 18, 19, 20].indexOf(r), supplied = ({ 42: 17, 43: 18, 44: 20 } as Record<number, number>)[r];
    put(`D${line(r)}`, materialIndex >= 0 ? n('기준 재료 ' + materialIndex) : supplied ? `D${line(supplied)}` : '100', result.current?.rows[i].base);
  }
  const safeRows = [11, 17, 18, 19, 20, 22, 23, 24, 25, 26, 42, 43, 44], zRows = [11, 17, 18, 19, 20, 22, 23, 24, 25, 26];
  const zw = zRows.map(r => r === 11 ? `(${weight(11)}+${weight(12)})` : weight(r));
  const zCount = sum(zw.map(w => `IF(${w}>0,1,0)`));
  put('B52', down(`${n('기준 health')}*${n('기준 care')}/100`, 4));
  put('B53', down(`${sum(safeRows.map(weight))}*${n('기준 safety')}/100`, 4), result.current?.safetyBase);
  put('B54', down(`${sum(zw.map((w, i) => down(`${w}*D${line(zRows[i])}`, 4)))}/${zCount}`, 4), result.current?.zBase);
  for (const [prefix, column, sourceColumn, calculated] of [['현재 ', 'C', 'E', result.current], ['직전일 ', 'D', 'F', result.previous]] as const) {
    const previous = prefix === '직전일 ', comparison = previous ? input.previous : input.current;
    put(`${column}40`, down(`${n(prefix + 'wage')}/${n('기준 wage')}*100`, 2), calculated?.rows[0].comparison);
    for (const [i, pair] of comparison.standards.entries()) put(`${column}${41 + i}`, `IF(OR(${n(prefix + pair.label + ' commonCount')}<=0,MOD(${n(prefix + pair.label + ' commonCount')},1)<>0),NA(),${down(`${n(prefix + pair.label + ' comparisonAverage')}/${n(prefix + pair.label + ' baseAverage')}*100`, 2)})`, calculated?.rows.find(r => r.row === 22 + i)?.comparison);
    const pair = comparison.machinery;
    put(`${column}46`, `IF(OR(${n(prefix + pair.label + ' commonCount')}<=0,MOD(${n(prefix + pair.label + ' commonCount')},1)<>0),NA(),${down(`${n(prefix + pair.label + ' comparisonAverage')}/${n(prefix + pair.label + ' baseAverage')}*100`, 2)})`, calculated?.rows.find(r => r.row === 14)?.comparison);
    for (const [i, [rate, r]] of ([['injury', 28], ['employment', 30], ['retirement', 31], ['health', 32], ['pension', 33]] as const).entries()) put(`${column}${47 + i}`, down(`${down(`${column}40*${n(prefix + rate)}/100`, 4)}/${down(n('기준 ' + rate), 4)}*100`, 2), calculated?.rows.find(row => row.row === r)?.comparison);
    // Preserve disclosed original previous-day cross-reference, not an unapproved correction.
    put(`${column}52`, down(`${column}40*${n('현재 health')}*${n(prefix + 'care')}/10000`, 4));
    put(`${column}53`, down(`${sum(safeRows.map(r => down(`${weight(r)}*${down(`${previous && [23, 24, 25, 26].includes(r) ? 'E' : sourceColumn}${line(r)}/D${line(r)}`, 4)}`, 6)))}*${n(prefix + 'safety')}/100`, 4), calculated?.safetyComparison);
    put(`${column}54`, down(`${sum(zw.map((w, i) => down(`${w}*E${line(zRows[i])}`, 4)))}/${zCount}`, 4), calculated?.zComparison);
    put(`${column}55`, down(`${column}54/B54*100`, 2), calculated?.zIndex);
    for (const [i, [r]] of ES_COSTS.entries()) {
      let index: string;
      if ([11, 12].includes(r)) index = `${column}40`;
      else if (r === 14) index = `${column}46`;
      else if ([15, 35, 36, 37, 38, 39].includes(r)) index = `${column}55`;
      else if ([17, 18, 19, 20].includes(r)) index = n(prefix + '재료 ' + [17, 18, 19, 20].indexOf(r));
      else if (r >= 22 && r <= 26) index = `${column}${r + 19}`;
      else if (r === 29) index = down(`${column}53/B53*100`, 2);
      else if (r === 34) index = down(`${column}52/B52*100`, 2);
      else if ([42, 43, 44].includes(r)) index = `${sourceColumn}${line(({ 42: 17, 43: 18, 44: 20 } as Record<number, number>)[r])}`;
      else index = `${column}${47 + [28, 30, 31, 32, 33].indexOf(r)}`;
      put(`${sourceColumn}${line(r)}`, index, calculated?.rows[i].comparison);
      put(`${previous ? 'H' : 'G'}${line(r)}`, down(`${sourceColumn}${line(r)}/D${line(r)}`, 4), calculated?.rows[i].ratio);
      put(`${previous ? 'J' : 'I'}${line(r)}`, down(`${weight(r)}*${previous ? 'H' : 'G'}${line(r)}`, 8), calculated?.rows[i].adjusted);
    }
    put(`${column}34`, down(`SUM(${previous ? 'J' : 'I'}4:${previous ? 'J' : 'I'}31)`, 8), calculated?.adjustedSum);
    put(`${column}35`, down(`${column}34-1`, 4), calculated?.k);
    put(`${column}36`, down('SUM(B4:B31)', 4), calculated?.weightSum);
    put(`${column}37`, down(`${column}34-${column}36`, 4), calculated?.displayK);
  }
  const direct = bindings.filter(b => b.label.startsWith('직접지급 ')).map(b => n(b.label));
  put('B60', direct.length ? sum(direct) : '0');
  put('B61', `MAX(0,B60-${n('alreadyExcludedDirect')})`, result.amount?.directExtra);
  put('B62', `${n('paidWorkExclusion')}+B61`);
  put('B63', `${n('contractAmount')}-B62`, result.amount?.applicable);
  put('B64', down('B63*C35', -3), result.amount?.gross);
  put('B65', `${n('advanceContract')}-(B62-${n('priorCompletion')})`);
  put('B66', `IF(${n('advanceContract')}>0,ROUND(B65*C35*${n('advancePaid')}/${n('advanceContract')},0),0)`, result.amount?.advance);
  const date = ref('adjustmentDate');
  const priorDate = `TEXT(DATE(VALUE(LEFT(${date},4)),VALUE(MID(${date},6,2)),VALUE(RIGHT(${date},2)))-1,"yyyy-mm-dd")`;
  const invalidDates = `${ref('baseDate')}="",${date}="",${ref('baseDate')}>${date},${ref('기준 date')}<>${ref('baseDate')},${ref('현재 date')}<>${date},${ref('직전일 date')}<>${priorDate}`;
  put('B67', `IF(OR(${invalidDates},B63<0,${n('advancePaid')}>${n('advanceContract')},AND(${n('advancePaid')}>0,B65<0)),NA(),${down(`B64-B66-${n('otherDeduction')}`, -3)})`, result.amount?.net);
  const labels: Record<number, string> = {34:'조정계수 합계',35:'적용 K',36:'비목계수 합계',37:'표시 K',40:'노임 지수',41:'토목 표준',42:'건축 표준',43:'기계 표준',44:'전기 표준',45:'통신 표준',46:'기계경비 지수',47:'산재',48:'고용',49:'퇴직',50:'건강',51:'연금',52:'요양 중간값',53:'안전 중간값',54:'기타비목 중간값',55:'기타비목 지수',60:'직접지급 합계',61:'추가 직접지급 제외',62:'전체 제외액',63:'적용대가',64:'조정금액',65:'선금 잔여 적용대가',66:'선금 공제',67:'최종 조정금액'};
  for (const [row, label] of Object.entries(labels)) rows[Number(row) - 1][0] = label;
  rows[38] = ['지수 중간 계산', '기준', '현재', '직전일'];
  rows[68] = ['주의', '현재/직전일 원본 참조 쟁점 유지. 수식 수정 파일은 가져오기 거부.'];
  rows[69] = ['미입력', 'NA는 미입력·0분모·지원하지 않는 조건. 빈 값을 0으로 바꾸지 마세요.'];
  rows[70] = ['제한', '17개 출력 시트는 내보낸 시점의 검토용 값입니다. Excel 입력 수정 후 웹에 재가져와 재계산·출력하세요. 신규비목·후속차수·복수 선금 미지원.'];
  rows[71] = ['검수', 'Excel 자체 재계산은 별도 검증 필요. 웹 재가져오기 시 서버 규칙으로 재계산.'];
  return { rows, formulas };
}
