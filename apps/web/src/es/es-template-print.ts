import { esCellAddress, esCellPosition, esTemplateColor, esTemplateStyles, type EsTemplateGrid, type EsCellStyle } from '../../../../packages/document-engine/src/es-template';
import { esDecimal as d } from '../../../../packages/document-engine/src/es-decimal';

const esc = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const color = esTemplateColor;
function styleCss(s: EsCellStyle): string {
  const a = s.alignment ?? {}, f = s.font;
  return `font-family:${esc(f.name)},"Malgun Gothic",serif;font-size:${f.size}pt;font-weight:${f.bold ? 700 : 400};font-style:${f.italic ? 'italic':'normal'};color:${color(f.color)};text-decoration:${f.underline?'underline':'none'};text-align:${a.horizontal === 'center'?'center':a.horizontal === 'right'?'right':'left'};vertical-align:${a.vertical==='top'?'top':a.vertical==='bottom'?'bottom':'middle'};background:${s.fill ? color((s.fill as {foreground?:unknown}).foreground) : 'transparent'};white-space:${a.wrapText==='1'?'pre-wrap':'pre'};overflow-wrap:${a.wrapText==='1'?'anywhere':'normal'};` + Object.entries(s.borders ?? {}).filter(([side]) => ['left','right','top','bottom'].includes(side)).map(([side,b]) => `border-${side}:${b.style ? (b.style==='double'?'3px double':b.style==='medium'?'2px solid':'1px solid') : '0'} ${color(b.color)};`).join('');
}
export function esPrintNumber(value: string, format: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return value;
  const fixed = (places:number,percent=false) => { const parts=(percent?d(value).mul(d(100)):d(value)).round(places,'ROUND').toString().split('.');return parts[0]+(places?'.'+(parts[1]??'').padEnd(places,'0'):''); };
  if (format.includes('%')) { const places = format.match(/0\.(0+)%/)?.[1].length ?? 0; return fixed(places,true)+'%'; }
  if (/0\.0/.test(format) || format.includes('#,##0')) {
    const places = format.match(/0\.(0+)/)?.[1].length ?? 0;
    const parts=fixed(places).split('.'); if(format.includes('#,##0'))parts[0]=parts[0].replace(/\B(?=(\d{3})+(?!\d))/g,',');return parts.join('.');
  }
  return value;
}
/** Complete original print-area grid. Merged row groups cannot cross a page boundary. */
export function paginateEsTemplate(grid: EsTemplateGrid, values: Record<string,string>, measure: HTMLElement): string[] {
  const [lastRow,lastCol] = esCellPosition(grid.printArea.split(':').at(-1)!);
  const rowHeight = (r: number) => grid.hiddenRows.includes(r) ? 0 : grid.rowHeights[r] ?? grid.defaultRowHeight;
  const widths = Array.from({length:lastCol},(_,i) => (grid.columns[i+1]?.width ?? 8.43)*7+5);
  const width = widths.reduce((a,b)=>a+b,0), margins = Object.fromEntries(['left','right','top','bottom'].map(k=>[k, Number(grid.margins[k] ?? .6)*25.4]));
  const scale = Math.min(Number(grid.pageSetup.scale ?? 100)/100, (210-margins.left-margins.right)*96/25.4/width);
  const capacity = (297-margins.top-margins.bottom)*72/25.4/scale;
  const styles = new Map(grid.cellStyles), mergeStarts = new Map<string,[number,number]>(), covered = new Set<string>();
  const endAt = Array.from({length:lastRow+1},(_,r)=>r);
  for(const range of grid.merges) {
    const [a,b]=range.split(':'), [r1,c1]=esCellPosition(a),[r2,c2]=esCellPosition(b);
    mergeStarts.set(a,[r2-r1+1,c2-c1+1]);
    for(let r=r1;r<=r2;r++) { endAt[r]=Math.max(endAt[r],r2); for(let c=c1;c<=c2;c++) if(r!==r1||c!==c1) covered.add(esCellAddress(r,c)); }
  }
  const render = ([from,to]:[number,number]) => {
    let rows='';
    for(let r=from;r<=to;r++) {
      let cells='';
      for(let c=1;c<=lastCol;c++) {
        const address=esCellAddress(r,c);if(covered.has(address))continue;
        const [rs,cs]=mergeStarts.get(address)??[1,1], style=esTemplateStyles[styles.get(address)??grid.rowStyles?.[r]??grid.columns[c]?.style??0];
        cells+=`<td data-cell="${address}" rowspan="${rs}" colspan="${cs}" style="padding:0 2px;${esc(styleCss(style))}">${esc(esPrintNumber(values[address]??'',style.numberFormat))}</td>`;
      }
      rows+=`<tr data-row="${r}" style="height:${rowHeight(r)}pt;${rowHeight(r)===0?'display:none':''}">${cells}</tr>`;
    }
    return `<section class="es-paper es-original" data-sheet="${esc(grid.name)}" data-first-row="${from}" data-last-row="${to}" style="padding:0"><div style="position:absolute;top:${margins.top}mm;left:${margins.left}mm;width:${width}px;transform:scale(${scale});transform-origin:top left"><table style="border-collapse:collapse;table-layout:fixed;width:${width}px;line-height:1.15"><colgroup>${widths.map(w=>`<col style="width:${w}px">`).join('')}</colgroup><tbody>${rows}</tbody></table></div>__ES_FOOTER__</section>`;
  };
  measure.innerHTML=render([1,lastRow]);
  const measured=new Map([...measure.querySelectorAll<HTMLTableRowElement>('tr[data-row]')].map(row=>[Number(row.dataset.row),row.getBoundingClientRect().height*72/96/scale]));
  const ranges: [number,number][]=[]; let start=1,used=0;
  for(let row=1;row<=lastRow;) {
    let end=endAt[row]; for(let r=row;r<=end;r++) end=Math.max(end,endAt[r]);
    let height=0;for(let r=row;r<=end;r++)height+=Math.max(rowHeight(r),measured.get(r)??0);
    if(height>capacity-3) throw new Error(`${grid.name}: 병합 행이 인쇄 한 페이지보다 큽니다.`);
    if(used && used+height>capacity-3) {ranges.push([start,row-1]);start=row;used=0;}
    used+=height;row=end+1;
  }
  ranges.push([start,lastRow]);
  const pages=ranges.map(render);
  // Font fallback and wrapped input may make a fixed row taller. Reject clipping, never omit rows.
  for(const html of pages) {
    measure.innerHTML=html;
    const table=measure.querySelector('table')!;
    if(table.getBoundingClientRect().height>(297-margins.top-margins.bottom)*96/25.4+2) throw new Error(`${grid.name}: 입력 문구가 원본 페이지 높이를 넘습니다. 긴 문구를 줄인 뒤 다시 출력하세요.`);
  }
  return pages;
}
