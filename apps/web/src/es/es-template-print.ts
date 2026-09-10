import { esCellAddress, esCellPosition, esTemplateColor, esTemplateStyles, esTemplateFooter, type EsTemplateGrid, type EsCellStyle } from '../../../../packages/document-engine/src/es-template';
import { esDecimal as d } from '../../../../packages/document-engine/src/es-decimal';
import { esContentsDrawingSvg } from '../../../../packages/document-engine/src/es-template-drawing';
import { esPrintMargins, type EsPrintSettings } from '../../../../packages/document-engine/src/es-print-settings';

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
export function paginateEsTemplate(grid: EsTemplateGrid, values: Record<string,string>, measure: HTMLElement, settings?: EsPrintSettings): string[] {
  const margins = esPrintMargins(settings);
  // Divider sheets are single presentation pages, not 47 rows of blank cells.
  // Keep their actual wording; wrap the title inside a centered A4 content box.
  if (/^붙[1-5]$/.test(grid.name)) {
    const extra = Object.entries(values).filter(([cell, text]) => text.trim() && !['A1','B7','B8','D47'].includes(cell));
    return [`<section class="es-paper es-original es-divider" data-sheet="${esc(grid.name)}" data-first-row="1" data-last-row="47" style="padding:${margins.top}mm 12mm ${margins.bottom}mm"><header data-cell="A1" style="font-size:9pt;border-bottom:1px solid #777;padding-bottom:3mm;overflow-wrap:anywhere">${esc(values.A1 ?? '')}</header><div style="margin-top:25mm;text-align:center"><div data-cell="B7" style="display:inline-block;padding:2mm 6mm;background:#222;color:white;font-size:14pt;font-weight:700">${esc(values.B7 ?? grid.name)}</div><h1 data-cell="B8" style="margin:6mm 0;font-size:18pt;line-height:1.5;white-space:normal;overflow-wrap:anywhere;text-align:center;border-bottom:1px solid #777;padding-bottom:5mm">${esc(values.B8 ?? '')}</h1></div><div style="margin:10mm 4mm;font-size:11pt;line-height:1.7">${extra.map(([cell,text])=>`<div data-cell="${esc(cell)}">${esc(text)}</div>`).join('')}</div><footer style="left:12mm;right:12mm;bottom:${settings?.footer.mode === 'custom' ? 24 : 12}mm;border:0">${esc(values.D47 ?? '')}</footer></section>`];
  }
  const [lastRow,lastCol] = esCellPosition(grid.printArea.split(':').at(-1)!);
  const compactHeights = new Map<number, number>();
  const rowHeight = (r: number) => grid.hiddenRows.includes(r) ? 0 : compactHeights.get(r) ?? grid.rowHeights[r] ?? grid.defaultRowHeight;
  const widths = Array.from({length:lastCol},(_,i) => (grid.columns[i+1]?.width ?? 8.43)*7+5);
  const width = widths.reduce((a,b)=>a+b,0);
  // Fill the printable width instead of applying the legacy reduction a second time.
  const scale = (210-margins.left-margins.right)*96/25.4/width;
  const left = margins.left;
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
  const wrapped = new Set<string>();
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
        cells+=`<td data-cell="${address}"${style.alignment?.shrinkToFit==='1'?' data-shrink="true"':''} rowspan="${rs}" colspan="${cs}" style="padding:0 2px;min-width:0;${esc(styleCss(style))}${wrapped.has(address)?'white-space:normal;overflow-wrap:anywhere;':''}${numeric && (!style.alignment?.horizontal || style.alignment.horizontal==='general')?'text-align:right;':''}"><span style="${fitted.has(address)?`font-size:${fitted.get(address)}pt;`:''}">${esc(text)}</span></td>`;
      }
      rows+=`<tr data-row="${r}" style="height:${rowHeight(r)}pt;${rowHeight(r)===0?'display:none':''}">${cells}</tr>`;
    }
    const footer = (!settings || settings.footer.mode === 'original') && esTemplateFooter(grid) ? `<footer style="bottom:7mm;font-size:9pt;border:0;padding:0">- __ES_PAGE_NUMBER__ -</footer>` : '';
    return `<section class="es-paper es-original" data-sheet="${esc(grid.name)}" data-first-row="${from}" data-last-row="${to}" style="padding:0"><div style="position:absolute;top:${margins.top}mm;left:${left}mm"><div style="position:relative;width:${width}px;zoom:${scale}"><table style="border-collapse:collapse;table-layout:fixed;width:${width}px;min-width:0;line-height:1.15"><colgroup>${widths.map(w=>`<col style="width:${w}px">`).join('')}</colgroup><tbody>${rows}</tbody></table>${grid.name==='목록' && from===1?esContentsDrawingSvg(widths,rowHeight):''}</div></div>${footer}</section>`;
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
      const address = cell.dataset.cell!;
      if (low * scale < 7.5 && !/^-?\d+(\.\d+)?$/.test(values[address] ?? '')) {
        // Period names remain readable on paper: wrap instead of reducing to 5pt.
        wrapped.add(address); fitted.set(address, Math.max(7.5 / scale, parseFloat(css.fontSize)*72/96));
      } else fitted.set(address,low);
      span.style.fontSize=`${fitted.get(address)}pt`;
    }
  }
  measure.innerHTML=render([1,lastRow]);
  const measureRows = () => new Map([...measure.querySelectorAll<HTMLTableRowElement>('tr[data-row]')].map(row=>[Number(row.dataset.row),row.getBoundingClientRect().height*72/96/scale]));
  let measured = measureRows();
  // Single-form sheets should not push a signature or footnote onto a nearly
  // empty page. Compress only unused row space, never the font or real content.
  if (lastRow < 100 && !['표지','목록'].includes(grid.name)) {
    const fullHeight = [...measured.values()].reduce((a,b)=>a+b,0);
    if (fullHeight > capacity - 3) {
      for (const row of measure.querySelectorAll<HTMLTableRowElement>('tr[data-row]')) row.style.height = '0';
      const minimum = measureRows(), minHeight = [...minimum.values()].reduce((a,b)=>a+b,0);
      if (minHeight < capacity - 5) {
        const ratio = Math.min(1,(capacity - 5 - minHeight)/(fullHeight - minHeight));
        for (const [r,h] of measured) compactHeights.set(r,(minimum.get(r) ?? 0) + Math.max(0,h-(minimum.get(r) ?? 0))*ratio);
      }
      measure.innerHTML=render([1,lastRow]); measured=measureRows();
    }
  }
  const ranges: [number,number][]=[]; let start=1,used=0;
  for(let row=1;row<=lastRow;) {
    let end=endAt[row]; for(let r=row;r<=end;r++) end=Math.max(end,endAt[r]);
    let height=0;for(let r=row;r<=end;r++)height+=Math.max(rowHeight(r),measured.get(r)??0);
    if(height>capacity-3) throw new Error(`${grid.name}: 병합 행이 인쇄 한 페이지보다 큽니다.`);
    if(used && used+height>capacity-3) {ranges.push([start,row-1]);start=row;used=0;}
    used+=height;row=end+1;
  }
  ranges.push([start,lastRow]);
  // Exclude only wholly empty fragments. Intentional blank rows inside populated
  // pages and all meaningful template cells remain; cover/dividers are retained.
  const pages=ranges.filter(([from,to]) => grid.name==='목록' && from===1 || Object.entries(values).some(([cell,text]) => { const [row] = esCellPosition(cell); return row>=from && row<=to && text.trim() !== ''; })).map(render);
  // Font fallback and wrapped input may make a fixed row taller. Reject clipping, never omit rows.
  for(const html of pages) {
    measure.innerHTML=html;
    const table=measure.querySelector('table')!;
    if(table.getBoundingClientRect().height>(297-margins.top-margins.bottom)*96/25.4+2) throw new Error(`${grid.name}: 입력 문구가 원본 페이지 높이를 넘습니다. 긴 문구를 줄인 뒤 다시 출력하세요.`);
  }
  return pages;
}
