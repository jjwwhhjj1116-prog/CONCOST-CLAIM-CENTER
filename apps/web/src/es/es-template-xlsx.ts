import { esCellAddress, esCellPosition, esTemplateColor, esTemplateStyles, esTemplateFooter, type EsTemplateGrid } from '../../../../packages/document-engine/src/es-template';
import { esBandExcel, type EsPrintSettings } from '../../../../packages/document-engine/src/es-print-settings';
const esc=(v:unknown)=>String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const attrs=(o:Record<string,unknown>)=>Object.entries(o).map(([k,v])=>` ${k}="${esc(v)}"`).join('');
const rgb=(v:unknown)=>'FF'+esTemplateColor(v).slice(1);
export function esTemplateStylesXml(): string {
  const baseFonts='<font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="12"/><name val="맑은 고딕"/></font>';
  const fonts=esTemplateStyles.map(s=>`<font><sz val="${s.font.size}"/><name val="${esc(s.font.name)}"/>${s.font.bold?'<b/>':''}${s.font.italic?'<i/>':''}${s.font.underline?'<u/>':''}<color rgb="${rgb(s.font.color)}"/></font>`).join('');
  const borders=esTemplateStyles.map(s=>'<border>'+['left','right','top','bottom','diagonal'].map(side=>{const b=s.borders?.[side];return b?.style?`<${side} style="${esc(b.style)}"><color rgb="${rgb(b.color)}"/></${side}>`:`<${side}/>`;}).join('')+'</border>').join('');
  const fills=esTemplateStyles.map(s=>{const f=s.fill as {pattern?:string;foreground?:unknown;background?:unknown}|undefined;return f?`<fill><patternFill patternType="${esc(f.pattern??'none')}"><fgColor rgb="${rgb(f.foreground)}"/><bgColor rgb="${rgb(f.background)}"/></patternFill></fill>`:'<fill><patternFill patternType="none"/></fill>';}).join('');
  const formats=esTemplateStyles.map((s,i)=>`<numFmt numFmtId="${164+i}" formatCode="${esc(s.numberFormat)}"/>`).join('');
  const baseXfs=[0,1].map(i=>`<xf numFmtId="0" fontId="${i}" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>`).join('');
  const xfs=esTemplateStyles.map((s,i)=>`<xf numFmtId="${164+i}" fontId="${i+2}" fillId="${i+2}" borderId="${i+1}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment${attrs(s.alignment??{})}/></xf>`).join('');
  return `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="${esTemplateStyles.length}">${formats}</numFmts><fonts count="${esTemplateStyles.length+2}">${baseFonts}${fonts}</fonts><fills count="${esTemplateStyles.length+2}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fills}</fills><borders count="${esTemplateStyles.length+1}"><border><left/><right/><top/><bottom/><diagonal/></border>${borders}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${esTemplateStyles.length+2}">${baseXfs}${xfs}</cellXfs></styleSheet>`;
}
export function esTemplateSheetXml(grid:EsTemplateGrid,values:Record<string,string>,formulas:Record<string,string>={},settings?:EsPrintSettings):string {
  const [lastRow,lastCol]=esCellPosition(grid.printArea.split(':').at(-1)!); const styles=new Map(grid.cellStyles);
  let rows='';
  for(let r=1;r<=lastRow;r++) {
    let cells='';for(let c=1;c<=lastCol;c++) {
      const a=esCellAddress(r,c),v=values[a]??'',style=(styles.get(a)??grid.rowStyles?.[r]??grid.columns[c]?.style??0)+2;
      let body: string;
      if(formulas[a]) body=`<f>${esc(formulas[a])}</f>${/^-?\d+(\.\d+)?$/.test(v)?`<v>${v}</v>`:''}`;
      else if(/^-?\d+(\.\d+)?$/.test(v)&&v.replace(/[-.]/g,'').length<=15)body=`<v>${v}</v>`;
      else body=`<is><t xml:space="preserve">${esc(v)}</t></is>`;
      cells+=`<c r="${a}" s="${style}"${body.startsWith('<is>')?' t="inlineStr"':''}>${body}</c>`;
    }
    rows+=`<row r="${r}" ht="${grid.rowHeights[r]??grid.defaultRowHeight}" customHeight="1"${grid.hiddenRows.includes(r)?' hidden="1"':''}>${cells}</row>`;
  }
  const pageSetup = Object.fromEntries(Object.entries(grid.pageSetup).filter(([key]) => !key.includes(':') && key !== 'id'));
  const footer = !settings || settings.footer.mode === 'original' ? esTemplateFooter(grid) : settings.footer.mode === 'custom' ? esBandExcel(settings.footer) : '';
  const header = settings?.header.mode === 'custom' ? esBandExcel(settings.header) : '';
  const margins: Record<string,string | number> = {...grid.margins};
  if (settings?.header.mode === 'custom') { margins.top = Math.max(Number(margins.top), 24/25.4); margins.header = 5/25.4; }
  if (settings?.footer.mode === 'custom') { margins.bottom = Math.max(Number(margins.bottom), 24/25.4); margins.footer = 5/25.4; }
  return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${grid.printArea}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="${grid.defaultRowHeight}"/><cols>${Object.entries(grid.columns).map(([n,c])=>`<col min="${n}" max="${n}" width="${c.width}" customWidth="1" style="${(c.style??0)+2}"/>`).join('')}</cols><sheetData>${rows}</sheetData>${grid.merges.length?`<mergeCells count="${grid.merges.length}">${grid.merges.map(m=>`<mergeCell ref="${m}"/>`).join('')}</mergeCells>`:''}<printOptions horizontalCentered="${grid.horizontalCentered ? 1 : 0}"/><pageMargins${attrs(margins)}/><pageSetup${attrs(pageSetup)}/><headerFooter alignWithMargins="0">${header ? `<oddHeader>${esc(header)}</oddHeader>` : ''}${footer ? `<oddFooter>${esc(footer)}</oddFooter>` : ''}</headerFooter></worksheet>`;
}
