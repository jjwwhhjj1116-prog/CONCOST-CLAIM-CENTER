import { Extension, Mark, Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import { Table, TableCell, TableHeader, createColGroup } from '@tiptap/extension-table';

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
const measurements = new Set(['nativeX','nativeY','nativeBaseline','nativeGrid']);
const choices: Record<string, readonly string[]> = {
  position: ['absolute','relative'], textAlign: ['left','center','right','justify'],
  verticalAlign: ['top','middle','bottom'], whiteSpace: ['pre-wrap','pre','normal'],
  borderCollapse: ['collapse','separate'], tableLayout: ['fixed','auto'],
};
const cssName=(name:string)=>name.replace(/[A-Z]/gu,c=>'-'+c.toLowerCase());
export function normalizeHwpLayout(value:unknown):HwpLayout|null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
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
  return Object.entries(layout).filter(([key])=>!measurements.has(key)).map(([key,value])=>{
    if(/^padding(Top|Bottom|Left|Right)$/u.test(key)&&typeof layout.nativeX==='number'){
      const edge=String(layout[key.replace('padding','border')]??'none').match(/^(\d+(?:\.\d+)?)px/u);
      if(edge&&Number(edge[1])>0)return `${cssName(key)}:max(0px,calc(${value}px - max(var(--hwp-device-pixel, 1px), round(down, ${edge[1]}px, var(--hwp-device-pixel, 1px))) / 2))`;
    }
    return `${key==='lineHeightRatio'?'line-height':cssName(key)}:${key==='fontFamily'?JSON.stringify(value):value}${lengths.has(key)?'px':''}`;
  }).join(';');
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
  }}];}
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
  parseHTML(){return [{tag:'section[data-hwp-import-page]'}];},
  renderHTML({node,HTMLAttributes}){
    const width=Math.min(2400,Math.max(200,Number(node.attrs.width)||794));
    const height=Math.min(4000,Math.max(200,Number(node.attrs.height)||1123));
    return ['section',mergeAttributes(HTMLAttributes,{'data-hwp-import-page':'1','data-hwp-width':String(width),'data-hwp-height':String(height),class:'hwp-import-page',style:`position:relative;width:${width}px;height:${height}px;min-height:${height}px;box-sizing:border-box;padding:0;margin:0 0 24px;background:#ffffff;isolation:isolate`}),0];
  }
});
export const HwpImportedRule=Node.create({
  name:'hwpImportedRule',group:'block',atom:true,selectable:true,
  addAttributes(){return Object.fromEntries(['left','top','width','height','stroke','color','style'].map(key=>[key,{default:key==='color'?'#000000':key==='style'?'solid':0,parseHTML:(element:HTMLElement)=>{const raw=element.getAttribute('data-hwp-rule-'+key);return ['color','style'].includes(key)?raw:Number(raw)||0;}}]));},
  parseHTML(){return [{tag:'div[data-hwp-import-rule]'}];},
  renderHTML({node}){
    const a=node.attrs,layout=normalizeHwpLayout({position:'absolute',left:a.left,top:a.top,width:a.width,height:a.height})!;
    const color=/^#[0-9a-f]{6}$/iu.test(a.color)?a.color:'#000000',style=['solid','dotted','dashed','double'].includes(a.style)?a.style:'solid';
    const stroke=Math.min(12,Math.max(.1,Number(a.stroke)||1));
    const attrs:Record<string,string>={'data-hwp-import-rule':'1',contenteditable:'false',style:hwpLayoutStyle(layout)+`;border-top:${stroke}px ${style} ${color};pointer-events:none;box-sizing:border-box`};
    for(const key of ['left','top','width','height','stroke','color','style'])attrs['data-hwp-rule-'+key]=String(a[key]);
    return ['div',attrs];
  }
});
export const HwpTextStyle=Mark.create({
  name:'hwpTextStyle',priority:1000,
  addAttributes(){return {
    fontFamily:{default:null},fontSize:{default:null},color:{default:null},letterSpacing:{default:null},trackingCorrection:{default:null},
  };},
  parseHTML(){return [{tag:'span[data-hwp-text-style]',getAttrs:element=>{
    try{return JSON.parse((element as HTMLElement).getAttribute('data-hwp-text-style')||'{}');}catch{return false;}
  }}];},
  renderHTML({HTMLAttributes:a}){
    const style:string[]=[],attrs:Record<string,string|number>={};
    if(typeof a.fontFamily==='string'&&a.fontFamily.length<=120&&!/[;{}<>\\]/u.test(a.fontFamily)){
      attrs.fontFamily=a.fontFamily;
      const family=['Noto Serif KR','Noto Sans KR'].includes(a.fontFamily)?`HwpImport ${a.fontFamily}`:a.fontFamily;
      style.push(`font-family:${JSON.stringify(family)}`);
    }
    if(Number.isFinite(a.fontSize)&&a.fontSize>0&&a.fontSize<=200){attrs.fontSize=a.fontSize;style.push(`font-size:${a.fontSize}px`);}
    if(typeof a.color==='string'&&/^#[0-9a-f]{6}$/iu.test(a.color)){attrs.color=a.color;style.push(`color:${a.color}`);}
    if(Number.isFinite(a.letterSpacing)&&Math.abs(a.letterSpacing)<=20){
      attrs.letterSpacing=a.letterSpacing;
      const correction=Number.isFinite(a.trackingCorrection)&&Math.abs(a.trackingCorrection)<=20?a.trackingCorrection:0;
      if(a.trackingCorrection!==null)attrs.trackingCorrection=correction;
      style.push(`letter-spacing:${a.letterSpacing+correction}px`);
    }
    return ['span',{'data-hwp-text-style':JSON.stringify(attrs),style:style.join(';')},0];
  }
});
export const HWP_IMPORT_EXTENSIONS=[HwpImportedPage,HwpImportedTextBox,HwpImportedRule,HwpImportedLayout,HwpTextStyle];
export const HWP_IMPORT_DATA_ATTRIBUTES=['data-hwp-import-page','data-hwp-width','data-hwp-height','data-hwp-layout','data-hwp-text-box','data-hwp-text-style','data-hwp-import-rule',...['left','top','width','height','stroke','color','style'].map(key=>'data-hwp-rule-'+key)];
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
    return {type:n.type,text:n.text??'',attrs:canonical(Object.fromEntries(Object.entries(n.attrs??{}).filter(([key])=>['hwpLayout','textAlign','alignment','verticalAlignment','colspan','rowspan','colwidth','src','width','height','alt','left','top','stroke','color','style'].includes(key)))),marks:marks(n),content:children.map(visit)};
  };
  return JSON.stringify(visit(node));
}
