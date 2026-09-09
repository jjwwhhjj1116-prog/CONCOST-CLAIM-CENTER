import { esCellAddress, esCellPosition, esTemplateColor, esTemplateStyles, esTemplateFooter, type EsTemplateGrid, type EsCellStyle } from '../../../../packages/document-engine/src/es-template';
import { esDecimal as d } from '../../../../packages/document-engine/src/es-decimal';
import { esContentsDrawingSvg } from '../../../../packages/document-engine/src/es-template-drawing';

const esc = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const color = esTemplateColor;
function styleCss(s: EsCellStyle): string {
  const a = s.alignment ?? {}, f = s.font;
  return `font-family:${esc(f.name)},"Malgun Gothic",serif;font-size:${f.size}pt;font-weight:${f.bold ? 700 : 400};font-style:${f.italic ? 'italic':'normal'};color:${color(f.color)};text-decoration:${f.underline?'underline':'none'};text-align:${a.horizontal === 'center'?'center':a.horizontal === 'right'?'right':'left'};vertical-align:${a.vertical==='top'?'top':a.vertical==='bottom'?'bottom':'middle'};background:${s.fill ? color((s.fill as {foreground?:unknown}).foreground) : 'transparent'};white-space:${a.wrapText==='1'?'pre-wrap':'pre'};overflow-wrap:${a.wrapText==='1'?'anywhere':'normal'};` + Object.entries(s.borders ?? {}).filter(([side]) => ['left','right','top','bottom'].includes(side)).map(([side,b]) => `border-${side}:${b.style ? (b.style==='double'?'3px double':b.style==='medium'?'2px solid':'1px solid') : '0'} ${color(b.color)};`).join('');
}
export function esPrintNumber(value: string, format: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return value;
  // Interpret the formats present in the source, including accounting sections
  // and escaped/quoted units. Keep decimal arithmetic out of binary Number.
  const sections = format.match(/(?:"[^"]*"|\\.|[^;])+/g) ?? ['General'];
  const negative = d(value).compare(d(0)) < 0;
  let pattern = sections[d(value).compare(d(0)) === 0 && sections.length > 2 ? 2 : negative && sections.length > 1 ? 1 : 0];
  const literals: string[] = [];
  pattern = pattern.replace(/"([^"]*)"|\\(.)/g, (_, quoted, escaped) => String.fromCharCode(0xe000 + literals.push(quoted ?? escaped)-1)).replace(/\[[^\]]*\]/g,'').replace(/_.|\*./g,'');
  const restore = (text: string) => text.replace(/[\ue000-\uf8ff]/g, token => literals[token.charCodeAt(0)-0xe000]).trim();
  if (/y+.*m+.*d+/i.test(pattern)) {
    const date = new Date(Date.UTC(1899,11,30) + Number(value)*86400000);
    return restore(pattern.replace(/yyyy|yy|mm|m|dd|d/g, token => token[0]==='y' ? String(date.getUTCFullYear()).slice(token.length===2?-2:0) : String(token[0]==='m'?date.getUTCMonth()+1:date.getUTCDate()).padStart(token.length,'0')));
  }
  const numeric = pattern.match(/General|[#0][#0,]*(?:\.[0#]+)?/);
  if (!numeric) return restore(pattern);
  let amount = d(negative && sections.length > 1 ? value.slice(1) : value);
  if (pattern.includes('%')) amount = amount.mul(d(100));
  const places = numeric[0].split('.')[1]?.length ?? 0;
  const parts = (numeric[0] === 'General' ? amount : amount.round(places,'ROUND')).toString().split('.');
  if (numeric[0].includes(',')) parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const number = parts[0] + (places ? '.'+(parts[1]??'').padEnd(places,'0') : numeric[0]==='General' && parts[1] ? '.'+parts[1] : '');
  return restore(pattern.replace(numeric[0], number));
}
/** Complete original print-area grid. Merged row groups cannot cross a page boundary. */
export function paginateEsTemplate(grid: EsTemplateGrid, values: Record<string,string>, measure: HTMLElement): string[] {
  const [lastRow,lastCol] = esCellPosition(grid.printArea.split(':').at(-1)!);
  const rowHeight = (r: number) => grid.hiddenRows.includes(r) ? 0 : grid.rowHeights[r] ?? grid.defaultRowHeight;
  const widths = Array.from({length:lastCol},(_,i) => (grid.columns[i+1]?.width ?? 8.43)*7+5);
  const width = widths.reduce((a,b)=>a+b,0), margins = Object.fromEntries(['left','right','top','bottom'].map(k=>[k, Number(grid.margins[k] ?? .6)*25.4]));
  const scale = Math.min(Number(grid.pageSetup.scale ?? 100)/100, (210-margins.left-margins.right)*96/25.4/width);
  const left = margins.left + (grid.horizontalCentered ? ((210-margins.left-margins.right)-width*scale*25.4/96)/2 : 0);
  const capacity = (297-margins.top-margins.bottom)*72/25.4/scale;
  const styles = new Map(grid.cellStyles), mergeStarts = new Map<string,[number,number]>(), covered = new Set<string>();
  const cellStyle = (r: number, c: number) => esTemplateStyles[styles.get(esCellAddress(r,c))??grid.rowStyles?.[r]??grid.columns[c]?.style??0];
  const endAt = Array.from({length:lastRow+1},(_,r)=>r);
  for(const range of grid.merges) {
    const [a,b]=range.split(':'), [r1,c1]=esCellPosition(a),[r2,c2]=esCellPosition(b);
    mergeStarts.set(a,[r2-r1+1,c2-c1+1]);
    for(let r=r1;r<=r2;r++) { endAt[r]=Math.max(endAt[r],r2); for(let c=c1;c<=c2;c++) if(r!==r1||c!==c1) covered.add(esCellAddress(r,c)); }
  }
  const fitted = new Map<string, number>();
  const render = ([from,to]:[number,number]) => {
    let rows='';
    for(let r=from;r<=to;r++) {
      let cells='';
      for(let c=1;c<=lastCol;c++) {
        const address=esCellAddress(r,c);if(covered.has(address))continue;
        const [rs,cs]=mergeStarts.get(address)??[1,1], original=cellStyle(r,c);
        const style = { ...original, borders: { ...original.borders } };
        // OOXML stores merged-cell perimeter borders on covered edge cells too.
        if (rs > 1 || cs > 1) for (const side of ['top','bottom','left','right'] as const) {
          for (let i=0; i<(side==='top'||side==='bottom'?cs:rs); i++) {
            const edge=cellStyle(r+(side==='bottom'?rs-1:side==='top'?0:i),c+(side==='right'?cs-1:side==='left'?0:i)).borders?.[side];
            if(edge?.style) { style.borders[side]=edge; break; }
          }
        }
        const text = esPrintNumber(values[address]??'',style.numberFormat);
        const numeric = /^-?\d+(\.\d+)?$/.test(values[address]??'');
        cells+=`<td data-cell="${address}"${style.alignment?.shrinkToFit==='1'?' data-shrink="true"':''} rowspan="${rs}" colspan="${cs}" style="padding:0 2px;min-width:0;${esc(styleCss(style))}${numeric && (!style.alignment?.horizontal || style.alignment.horizontal==='general')?'text-align:right;':''}"><span style="${fitted.has(address)?`font-size:${fitted.get(address)}pt;`:''}">${esc(text)}</span></td>`;
      }
      rows+=`<tr data-row="${r}" style="height:${rowHeight(r)}pt;${rowHeight(r)===0?'display:none':''}">${cells}</tr>`;
    }
    const footer = esTemplateFooter(grid) ? `<footer style="bottom:${Number(grid.margins.footer)*25.4}mm;font-size:${grid.name==='3'||grid.name==='3.'?10:9}pt;border:0;padding:0">- __ES_PAGE_NUMBER__ -</footer>` : '';
    return `<section class="es-paper es-original" data-sheet="${esc(grid.name)}" data-first-row="${from}" data-last-row="${to}" style="padding:0"><div style="position:absolute;top:${margins.top}mm;left:${left}mm;width:${width}px;transform:scale(${scale});transform-origin:top left"><table style="border-collapse:collapse;table-layout:fixed;width:${width}px;min-width:0;line-height:1.15"><colgroup>${widths.map(w=>`<col style="width:${w}px">`).join('')}</colgroup><tbody>${rows}</tbody></table>${grid.name==='목록' && from===1?esContentsDrawingSvg(widths,rowHeight):''}</div>${footer}</section>`;
  };
  measure.innerHTML=render([1,lastRow]);
  for (const cell of measure.querySelectorAll<HTMLTableCellElement>('td[data-shrink]')) {
    const span = cell.firstElementChild as HTMLElement;
    const css = measure.ownerDocument.defaultView!.getComputedStyle(cell);
    const available = cell.getBoundingClientRect().width - (parseFloat(css.paddingLeft)+parseFloat(css.paddingRight)+2)*scale;
    const [row] = esCellPosition(cell.dataset.cell!);
    const height = Array.from({length:cell.rowSpan},(_,i)=>rowHeight(row+i)).reduce((a,b)=>a+b,0)*96/72*scale;
    const fits = () => { const rect=span.getBoundingClientRect(); return rect.width<=available && rect.height<=height; };
    if (!fits() && available > 0 && height > 0) {
      // Font hinting is not linear: measure candidate sizes instead of merely
      // multiplying by a width ratio (which can still spill into the next cell).
      let low=.5, high=parseFloat(css.fontSize)*72/96;
      for(let i=0;i<12;i++) { const size=(low+high)/2; span.style.fontSize=`${size}pt`; if(fits())low=size;else high=size; }
      fitted.set(cell.dataset.cell!,low); span.style.fontSize=`${low}pt`;
    }
  }
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
