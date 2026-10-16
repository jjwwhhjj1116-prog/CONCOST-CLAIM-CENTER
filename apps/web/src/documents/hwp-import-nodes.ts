import { Extension, Mark, Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import { Table, TableCell, TableHeader, createColGroup } from '@tiptap/extension-table';
import { hwpTableBorderDecoration } from './hwp-table-borders';
import {Plugin} from '@tiptap/pm/state';
import {Mapping,ReplaceStep} from '@tiptap/pm/transform';
import {isHistoryTransaction} from '@tiptap/pm/history';

export const DocumentMeasuredTable=Table.extend({
  renderHTML(props){
    if(!props.node.attrs.hwpLayout)return this.parent!(props);
    // Native TOC page-number columns can be narrower than Tiptap's 25px minimum.
    const {colgroup}=createColGroup(props.node,0);
    return ['table',mergeAttributes(this.options.HTMLAttributes,props.HTMLAttributes),colgroup!,['tbody',0]];
  }
});

// The stock HTML parser truncates fractional column widths with parseInt.
const fractionalColumnWidths = (element: HTMLElement): number[] | null => {
  const raw = element.getAttribute('colwidth');
  if (!raw) return null;
  const widths = raw.split(',').map(Number);
  return widths.length && widths.every(width => Number.isFinite(width) && width > 0) ? widths : null;
};
export const DocumentTableCell = TableCell.extend({
  addAttributes() { return { ...this.parent?.(), colwidth: { default: null, parseHTML: fractionalColumnWidths } }; }
});
export const DocumentTableHeader = TableHeader.extend({
  addAttributes() { return { ...this.parent?.(), colwidth: { default: null, parseHTML: fractionalColumnWidths } }; }
});

/** Versioned measurements from the HWP parser; never accept arbitrary CSS. */
export type HwpLayout = Record<string, string | number>;
const lengths = new Set(['left','top','width','height','minHeight','marginTop','marginBottom','marginLeft','marginRight','paddingTop','paddingBottom','paddingLeft','paddingRight','lineHeight','textIndent','letterSpacing','fontSize']);
const measurements = new Set(['nativeX','nativeY','nativeWidth','nativeBaseline','nativeGrid','nativeCellPosition']);
const choices: Record<string, readonly string[]> = {
  position: ['absolute','relative'], textAlign: ['left','center','right','justify'],
  verticalAlign: ['top','middle','bottom'], whiteSpace: ['pre-wrap','pre','normal'],
  borderCollapse: ['collapse','separate'], tableLayout: ['fixed','auto'],
  ...Object.fromEntries(['Top','Bottom','Left','Right'].map(side=>[`border${side}Pattern`,['DOUBLE_SLIM','SLIM_THICK_SLIM']])),
};
// A versioned key table compacts repeated layout field names in saved HTML.
// JSON editing state and all consumers still use the full normalized object.
// Version 1 indices are persisted: append new keys, never reorder these lists.
const layoutKeys=[...lengths,...measurements,...Object.keys(choices),'lineHeightRatio','fontFamily','color','backgroundColor','borderTop','borderBottom','borderLeft','borderRight'];
// The native API rounds visible cell bounds to 0.1px. Retain the actual
// authored height separately: rounding across a padding threshold can cause
// the native engine to add an entire minimum text line on the next export.
layoutKeys.push('nativeHeight');measurements.add('nativeHeight');
export function compactHwpLayout(value:unknown):unknown[]{
  return [1,...Object.entries(normalizeHwpLayout(value)??{}).flatMap(([key,item])=>[layoutKeys.indexOf(key),item])];
}
const cssName=(name:string)=>name.replace(/[A-Z]/gu,c=>'-'+c.toLowerCase());
export function normalizeHwpLayout(value:unknown):HwpLayout|null {
  if(Array.isArray(value)){
    if(value[0]!==1||value.length%2!==1)return null;
    const expanded:Record<string,unknown>={};
    for(let i=1;i<value.length;i+=2){const index=value[i];if(!Number.isSafeInteger(index)||index<0||index>=layoutKeys.length||layoutKeys[index] in expanded)return null;expanded[layoutKeys[index]]=value[i+1];}
    value=expanded;
  }
  if (!value || typeof value !== 'object') return null;
  const result:HwpLayout={};
  for (const [key,item] of Object.entries(value)) {
    if ((lengths.has(key)||measurements.has(key)) && typeof item==='number' && Number.isFinite(item) && Math.abs(item)<=10000) result[key]=item;
    else if(key==='lineHeightRatio'&&typeof item==='number'&&Number.isFinite(item)&&item>=.5&&item<=10)result[key]=item;
    else if(key==='fontFamily'&&typeof item==='string'&&item.length<=120&&!/[;{}<>\\]/u.test(item))result[key]=item;
    else if (choices[key]?.includes(String(item))) result[key]=String(item);
    else if (['color','backgroundColor'].includes(key) && typeof item==='string' && /^#[0-9a-f]{6}$/iu.test(item)) result[key]=item;
    else if (/^border(Top|Bottom|Left|Right)$/u.test(key) && typeof item==='string' && /^(?:0|none|(?:\d+(?:\.\d+)?px (?:solid|dotted|dashed|double|none) #[0-9a-f]{6}))$/iu.test(item)) result[key]=item;
  }
  return Object.keys(result).length?result:null;
}
export function hwpLayoutStyle(value:unknown):string {
  const layout=normalizeHwpLayout(value);
  if(!layout)return '';
  const borderWidth=(side:string)=>{
    const edge=String(layout[`border${side}`]??'none').match(/^(\d+(?:\.\d+)?)px/u);
    return edge&&Number(edge[1])>0?`max(var(--hwp-device-pixel, 1px), round(down, ${edge[1]}px, var(--hwp-device-pixel, 1px)))`:'0px';
  };
  const styles=Object.entries(layout).filter(([key])=>!measurements.has(key)&&!key.endsWith('Pattern')).map(([key,value])=>{
    if(layout.nativeCellPosition===1&&(key==='left'||key==='top'))return `${key}:calc(${value}px - var(--hwp-cell-border-${key==='left'?'left':'top'}-width, 0px) / 2)`;
    if(/^border(Top|Bottom|Left|Right)$/u.test(key)&&layout[`${key}Pattern`])return `${cssName(key)}:${String(value).replace(/#[0-9a-f]{6}$/iu,'transparent')}`;
    if(/^padding(Top|Bottom|Left|Right)$/u.test(key)&&typeof layout.nativeX==='number'){
      const edge=String(layout[key.replace('padding','border')]??'none').match(/^(\d+(?:\.\d+)?)px/u);
      if(edge&&Number(edge[1])>0)return `${cssName(key)}:max(0px,calc(${value}px - max(var(--hwp-device-pixel, 1px), round(down, ${edge[1]}px, var(--hwp-device-pixel, 1px))) / 2))`;
    }
    return `${key==='lineHeightRatio'?'line-height':cssName(key)}:${key==='fontFamily'?JSON.stringify(value):value}${lengths.has(key)?'px':''}`;
  });
  if(typeof layout.nativeWidth==='number')for(const side of ['Top','Right','Bottom','Left'])styles.push(`--hwp-cell-border-${side.toLowerCase()}-width:${borderWidth(side)}`);
  const decoration=hwpTableBorderDecoration(layout);if(decoration)styles.push(decoration);
  return styles.join(';');
}
function readLayout(element:HTMLElement):HwpLayout|null {
  try {return normalizeHwpLayout(JSON.parse(element.getAttribute('data-hwp-layout')||'null'));} catch {return null;}
}
export const HwpImportedLayout=Extension.create({
  name:'hwpImportedLayout',
  addGlobalAttributes(){return [{types:['hwpImportedTextBox','paragraph','heading','table','tableRow','tableCell','tableHeader','image'],attributes:{
    hwpLayout:{default:null,keepOnSplit:false,parseHTML:readLayout,renderHTML:attrs=>{
      const value=normalizeHwpLayout(attrs.hwpLayout);
      if(value&&typeof attrs.src==='string'){if(Number(attrs.width)>0)value.width=Number(attrs.width);if(Number(attrs.height)>0)value.height=Number(attrs.height);}
      return value?{'data-hwp-layout':JSON.stringify(value),style:hwpLayoutStyle(value)}:{};
    }}
  }},{types:['hardBreak'],attributes:{hwpSoftBreak:{default:false,parseHTML:element=>element.getAttribute('data-hwp-soft-break')==='1',renderHTML:attrs=>attrs.hwpSoftBreak?{'data-hwp-soft-break':'1'}:{}}}}];}
});
/** Keep the page anchor on a container so Enter creates normal flowing paragraphs. */
export const HwpImportedTextBox=Node.create({
  name:'hwpImportedTextBox',group:'block',content:'paragraph+',defining:true,isolating:true,
  parseHTML(){return [{tag:'div[data-hwp-text-box]'}];},
  renderHTML({HTMLAttributes}){return ['div',mergeAttributes(HTMLAttributes,{'data-hwp-text-box':'1'}),0];}
});
export const HwpImportedPage=Node.create({
  name:'hwpImportedPage',group:'block',content:'block+',defining:true,isolating:true,
  addAttributes(){return {
    width:{default:794,parseHTML:element=>Number(element.getAttribute('data-hwp-width'))||794},
    height:{default:1123,parseHTML:element=>Number(element.getAttribute('data-hwp-height'))||1123},
  };},
  parseHTML(){return [{tag:'section[data-hwp-import-page]',preserveWhitespace:'full'}];},
  renderHTML({node,HTMLAttributes}){
    const width=Math.min(2400,Math.max(200,Number(node.attrs.width)||794));
    const height=Math.min(4000,Math.max(200,Number(node.attrs.height)||1123));
    return ['section',mergeAttributes(HTMLAttributes,{'data-hwp-import-page':'1','data-hwp-width':String(width),'data-hwp-height':String(height),class:'hwp-import-page',style:`position:relative;width:${width}px;height:${height}px;min-height:${height}px;box-sizing:border-box;padding:0;margin:0 0 24px;background:#ffffff;isolation:isolate`}),0];
  }
});
export const HwpImportedRule=Node.create({
  name:'hwpImportedRule',group:'block',atom:true,selectable:true,
  addAttributes(){return Object.fromEntries(['left','top','width','height','stroke','color','style','nativeVector'].map(key=>[key,{default:key==='color'?'#000000':key==='style'?'solid':0,parseHTML:(element:HTMLElement)=>{const raw=element.getAttribute('data-hwp-rule-'+key);return ['color','style'].includes(key)?raw:Number(raw)||0;}}]));},
  parseHTML(){return [{tag:'div[data-hwp-import-rule]'}];},
  renderHTML({node}){
    const a=node.attrs,layout=normalizeHwpLayout({position:'absolute',left:a.left,top:a.top,width:a.width,height:a.height})!;
    const color=/^#[0-9a-f]{6}$/iu.test(a.color)?a.color:'#000000',style=['solid','dotted','dashed','double'].includes(a.style)?a.style:'solid';
    const stroke=Math.min(12,Math.max(.1,Number(a.stroke)||1));
    const attrs:Record<string,string>={'data-hwp-import-rule':'1',contenteditable:'false',style:hwpLayoutStyle(layout)+`;border-${Number(a.height)>Number(a.width)?'left':'top'}:${stroke}px ${style} ${color};pointer-events:none;box-sizing:border-box`};
    for(const key of ['left','top','width','height','stroke','color','style','nativeVector'])attrs['data-hwp-rule-'+key]=String(a[key]);
    if(Number(a.nativeVector)===1){
      const width=Number(layout.width),height=Number(layout.height),half=stroke/2;
      attrs.style=hwpLayoutStyle(layout)+';overflow:visible;pointer-events:none';
      return ['div',attrs,['http://www.w3.org/2000/svg svg',{width:width+stroke,height:height+stroke,viewBox:`0 0 ${width+stroke} ${height+stroke}`,style:`position:absolute;left:-${half}px;top:-${half}px;overflow:visible`},['http://www.w3.org/2000/svg line',{x1:half,y1:half,x2:width+half,y2:height+half,stroke:color,'stroke-width':stroke}]]];
    }
    return ['div',attrs];
  }
});
export const HwpImportedTab=Node.create({
  name:'hwpImportedTab',group:'inline',inline:true,atom:true,selectable:false,
  addAttributes(){return {width:{default:0,parseHTML:element=>Number(element.getAttribute('data-hwp-tab'))||0}};},
  parseHTML(){return [{tag:'span[data-hwp-tab]'}];},
  renderHTML({node}){const width=Math.min(2000,Math.max(0,Number(node.attrs.width)||0));return ['span',{'data-hwp-tab':String(width),contenteditable:'false',style:`display:inline-block;width:${width}px;height:0;vertical-align:baseline;white-space:pre;user-select:none`},'\u200b'];}
});
export function compactHwpTextStyle(value:Record<string,unknown>):unknown[]{
  const size=value.fontSize,native=typeof size==='number'?Math.round(size*75):0;
  const keys=['fontFamily','fontSize','color','letterSpacing','trackingCorrection','baselineShift',...(value.nativeFontFamily?['nativeFontFamily']:[])];
  return keys.map(key=>key==='fontSize'&&native>0&&Math.abs(native/75-Number(size))<.000001?-native:value[key]??null);
}
function readHwpTextStyle(element:HTMLElement):Record<string,unknown>|false{
 try{
  let value=JSON.parse(element.getAttribute('data-hwp-text-style')||'{}');
  if(Array.isArray(value)&&(value.length===2||value.length===3)){if(!Number.isFinite(value[1])||value[1]<0||value[1]>200||(value.length===3&&!validAdvanceMetric(value[2])))return false;value=value[0];}
  if(typeof value==='number'){
   if(!Number.isSafeInteger(value)||value<0)return false;
   const palette=JSON.parse(element.closest('[data-hwp-import-page]')?.getAttribute('data-hwp-fonts')||'null');
   if(!Array.isArray(palette)||!Array.isArray(palette[value]))return false;value=palette[value];
  }
  if(!Array.isArray(value))return value&&typeof value==='object'?value:false;
  if(value.length!==6&&value.length!==7)return false;
  if(typeof value[1]==='number'&&value[1]<0){if(!Number.isSafeInteger(value[1])||value[1]<-15000)return false;value[1]=Math.round(-value[1]/75*1e6)/1e6;}
  return Object.fromEntries(['fontFamily','fontSize','color','letterSpacing','trackingCorrection','baselineShift',...(value.length===7?['nativeFontFamily']:[])].map((key,index)=>[key,value[index]]));
 }catch{return false;}
}
/** Store repeated font records once per page. The editor still receives full
 * native font marks; this only compacts the persisted HTML representation. */
export function compactHwpPageFonts(page:HTMLElement):void{
 const fonts:unknown[][]=[],ids=new Map<string,number>();
 for(const element of page.querySelectorAll<HTMLElement>('[data-hwp-text-style]')){
  const value=readHwpTextStyle(element);if(!value)continue;
  const saved=JSON.parse(element.getAttribute('data-hwp-text-style')!);
  if(Array.isArray(saved)&&(saved.length===2||saved.length===3))element.setAttribute('data-hwp-advance',JSON.stringify(saved.slice(1)));
  const record=compactHwpTextStyle(value),key=JSON.stringify(record);
  let id=ids.get(key);if(id===undefined){id=fonts.length;ids.set(key,id);fonts.push(record);}
  element.setAttribute('data-hwp-text-style',String(id));
 }
 if(fonts.length)page.setAttribute('data-hwp-fonts',JSON.stringify(fonts));
 for(const outer of page.querySelectorAll<HTMLElement>('[data-hwp-text-style]')){
  const inner=outer.firstElementChild as HTMLElement|null;
  if(outer.childNodes.length===1&&inner?.tagName==='SPAN'&&inner.hasAttribute('data-hwp-advance')&&!outer.hasAttribute('data-hwp-advance')){
   outer.setAttribute('data-hwp-advance',inner.getAttribute('data-hwp-advance')!);outer.replaceChildren(...inner.childNodes);
  }
  // A compact pair stores the font palette index and native advance on the
  // same span. Both marks are reconstructed by the shared HTML parser.
  const advance=outer.getAttribute('data-hwp-advance');
  if(advance?.startsWith('[')){
   const unit=JSON.parse(advance);
   if(Array.isArray(unit)&&(unit.length===1||unit.length===2)&&typeof unit[0]==='number'&&Number.isFinite(unit[0])&&unit[0]>=0&&unit[0]<=200&&(unit.length===1||validAdvanceMetric(unit[1]))){outer.setAttribute('data-hwp-text-style',JSON.stringify([Number(outer.getAttribute('data-hwp-text-style')),...unit]));outer.removeAttribute('data-hwp-advance');}
  }
 }
}
export const HwpTextStyle=Mark.create({
  name:'hwpTextStyle',priority:1000,
  addAttributes(){return {
    fontFamily:{default:null},fontSize:{default:null},color:{default:null},letterSpacing:{default:null},trackingCorrection:{default:null},baselineShift:{default:null},nativeFontFamily:{default:null},
  };},
  parseHTML(){return [{tag:'span[data-hwp-text-style]',consuming:false,getAttrs:element=>{
    return readHwpTextStyle(element as HTMLElement);
  }}];},
  renderHTML({HTMLAttributes:a}){
    const style:string[]=[],attrs:Record<string,string|number>={};
    if(typeof a.nativeFontFamily==='string'&&a.nativeFontFamily.length<=120&&!/[;{}<>\\]/u.test(a.nativeFontFamily))attrs.nativeFontFamily=a.nativeFontFamily;
    if(typeof a.fontFamily==='string'&&a.fontFamily.length<=120&&!/[;{}<>\\]/u.test(a.fontFamily)){
      attrs.fontFamily=a.fontFamily;
      const family=['Noto Serif KR','Noto Sans KR'].includes(a.fontFamily)?`HwpImport ${a.fontFamily}`:a.fontFamily;
      style.push(`font-family:${JSON.stringify(family)}`);
    }
    if(Number.isFinite(a.fontSize)&&a.fontSize>0&&a.fontSize<=200){attrs.fontSize=a.fontSize;style.push(`font-size:${a.fontSize}px`);}
    if(typeof a.color==='string'&&/^#[0-9a-f]{6}$/iu.test(a.color)){attrs.color=a.color;style.push(`color:${a.color}`);}
    if(Number.isFinite(a.baselineShift)&&Math.abs(a.baselineShift)<=50){attrs.baselineShift=a.baselineShift;style.push(`position:relative;top:${a.baselineShift}px`);}
    if(Number.isFinite(a.letterSpacing)&&Math.abs(a.letterSpacing)<=20){
      attrs.letterSpacing=a.letterSpacing;
      const correction=Number.isFinite(a.trackingCorrection)&&Math.abs(a.trackingCorrection)<=20?a.trackingCorrection:0;
      if(a.trackingCorrection!==null)attrs.trackingCorrection=correction;
      style.push(`letter-spacing:${a.letterSpacing+correction}px`);
    }
    return ['span',{'data-hwp-text-style':JSON.stringify(attrs),style:style.join(';')},0];
  }
});
/** Equal native advances do not imply equal browser glyph widths. Keep these
 * metric groups distinct so ProseMirror cannot join a space and digit and
 * distribute their combined correction as, for example, 6px + 10px. */
export const hwpAdvanceMetric=(char:string):string=>/\s/u.test(char)?'space':/^[0-9]$/u.test(char)?'digit':/^[A-Za-z]$/u.test(char)?'latin:'+char:/\p{Letter}/u.test(char)?'cjk':'symbol:'+char.codePointAt(0)!.toString(16);
const validAdvanceMetric=(value:unknown):value is string=>typeof value==='string'&&/^(?:space|digit|cjk|latin:[A-Za-z]|symbol:[0-9a-f]{1,6})$/u.test(value);
const advanceAttributes=(attrs:Record<string,unknown>):Record<string,string>=>{
  const value=Number(attrs.letterSpacing),spacing=Number.isFinite(value)&&Math.abs(value)<=20?value:0,unit=attrs.unitAdvance;
  return{'data-hwp-advance':typeof unit==='number'&&Number.isFinite(unit)&&unit>=0&&unit<=200?JSON.stringify([Math.round(unit*1e6)/1e6,...(validAdvanceMetric(attrs.metric)?[attrs.metric]:[])]):String(spacing),style:`letter-spacing:${spacing}px`};
};
export const HwpTextAdvance=Mark.create({
  name:'hwpTextAdvance',priority:900,
  addAttributes(){return {letterSpacing:{default:0},unitAdvance:{default:null},metric:{default:null}};},
  addProseMirrorPlugins(){return [new Plugin({appendTransaction(transactions,_old,state){
    if(transactions.some(tr=>tr.getMeta('hwpAdvanceInput')||isHistoryTransaction(tr)))return null;
    const steps=transactions.flatMap(transaction=>transaction.steps.map(step=>({step,preserve:!!transaction.getMeta('preserveHwpAdvances')})));
    const tr=state.tr,type=state.schema.marks.hwpTextAdvance;
    for(const [{step,preserve},index]of steps.map((step,index)=>[step,index] as const)){
      if(preserve||!(step instanceof ReplaceStep)||!step.slice.size)continue;
      const mapping=new Mapping(steps.slice(index+1).map(({step})=>step.getMap()));
      step.getMap().forEach((_a,_b,from,to)=>{
        const a=mapping.map(from,1),b=mapping.map(to,-1);if(a>=b)return;
        state.doc.nodesBetween(a,b,(node,pos)=>{if(node.isText&&type.isInSet(node.marks))tr.removeMark(Math.max(a,pos),Math.min(b,pos+node.nodeSize),type);});
      });
    }
    return tr.steps.length?tr.setMeta('hwpAdvanceInput',true):null;
  }})];},
  parseHTML(){return [{tag:'span[data-hwp-advance]',consuming:false,getAttrs:element=>{try{const source=(element as HTMLElement).getAttribute('data-hwp-advance')||'0';if(source.startsWith('[')){const raw=JSON.parse(source);return Array.isArray(raw)&&(raw.length===1||raw.length===2)&&typeof raw[0]==='number'&&raw[0]>=0&&raw[0]<=200&&(raw.length===1||validAdvanceMetric(raw[1]))?{letterSpacing:0,unitAdvance:raw[0],...(raw.length===2?{metric:raw[1]}:{})}:false;}const raw=Number(source);return Number.isFinite(raw)&&Math.abs(raw)<=20?{letterSpacing:raw}:false;}catch{return false;}}},{tag:'span[data-hwp-text-style]',consuming:false,getAttrs:element=>{try{const raw=JSON.parse((element as HTMLElement).getAttribute('data-hwp-text-style')||'null');return Array.isArray(raw)&&(raw.length===2||raw.length===3)&&readHwpTextStyle(element as HTMLElement)?{letterSpacing:0,unitAdvance:raw[1],...(raw.length===3?{metric:raw[2]}:{})}:false;}catch{return false;}}}];},
  renderHTML({HTMLAttributes}){return ['span',advanceAttributes(HTMLAttributes),0];},
  addMarkView(){return({mark})=>{
    const dom=document.createElement('span');for(const [name,value]of Object.entries(advanceAttributes(mark.attrs)))dom.setAttribute(name,value);
    // Local font calibration is presentation only. Let ProseMirror observe all
    // authored text changes, but do not reinterpret our measured CSS as edits.
    return{dom,contentDOM:dom,ignoreMutation:mutation=>mutation.type==='attributes'&&mutation.target===dom&&mutation.attributeName==='style'};
  };}
});
export const HWP_IMPORT_EXTENSIONS=[HwpImportedPage,HwpImportedTextBox,HwpImportedRule,HwpImportedTab,HwpImportedLayout,HwpTextStyle,HwpTextAdvance];
export const HWP_IMPORT_DATA_ATTRIBUTES=['data-hwp-import-page','data-hwp-width','data-hwp-height','data-hwp-fonts','data-hwp-layout','data-hwp-text-box','data-hwp-text-style','data-hwp-advance','data-hwp-tab','data-hwp-soft-break','data-hwp-import-rule',...['left','top','width','height','stroke','color','style','nativeVector'].map(key=>'data-hwp-rule-'+key)];
/** Compare authored content/layout before upload; schema defaults are immaterial. */
export function hwpStructuredSignature(node:JSONContent):string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([,v])=>v!==null&&v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,canonical(v)])) : value;
  const marks = (n: JSONContent) => (n.marks??[]).map(mark=>({type:mark.type,attrs:canonical(mark.attrs??{})})).sort((a,b)=>a.type.localeCompare(b.type));
  const visit=(n:JSONContent):unknown=>{
    // ProseMirror joins adjacent text with identical marks. Compare the same text stream.
    const children:JSONContent[]=[];
    for(const child of n.content??[]){
      const previous=children.at(-1);
      if(child.type==='text'&&previous?.type==='text'&&JSON.stringify(marks(child))===JSON.stringify(marks(previous))) previous.text=(previous.text??'')+(child.text??'');
      else children.push({...child});
    }
    return {type:n.type,text:n.text??'',attrs:canonical(Object.fromEntries(Object.entries(n.attrs??{}).filter(([key,value])=>['hwpLayout','textAlign','alignment','verticalAlignment','colspan','rowspan','colwidth','src','width','height','alt','left','top','stroke','color','style'].includes(key)||key==='nativeVector'&&value===1||key==='hwpSoftBreak'&&value===true))),marks:marks(n),content:children.map(visit)};
  };
  return JSON.stringify(visit(node));
}
