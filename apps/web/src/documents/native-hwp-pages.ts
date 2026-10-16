import {documentBlockImageAlignment,documentImageData,listMarker} from './editable-docx-export';
import type {NativeHwpContent,NativeHwpPage,NativeHwpLines} from './editable-hwp-export';
import {prepareDocumentExportFonts,resolveDocumentExportFontFamily} from './document-export-fonts';

const px=(v:string)=>Number.parseFloat(v)||0;
const style=(e:Element)=>e.ownerDocument.defaultView!.getComputedStyle(e);
const escape=(v:string)=>v.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const color=(v:string)=>{
  const m=v.match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)(?:[, /]+([\d.]+))?\)/u);
  return m?(m[4]==='0'?'transparent':'#'+m.slice(1,4).map(n=>Number(n).toString(16).padStart(2,'0')).join('')):v;
};
const ignored=(e:Element)=>e.matches('script,style,button,input,select,textarea,[hidden],[aria-hidden="true"],[data-export-ignore],[data-html2canvas-ignore],.document-tool-menus,.structured-editor__toolbar')||['none'].includes(style(e).display)||['hidden','collapse'].includes(style(e).visibility);
const empty=():NativeHwpContent=>({html:'',text:'',tables:0,images:0,tableCells:[],pictures:[],tableGeometry:[],tabs:[]});
const measured=(element:HTMLElement)=>{const page=element.closest<HTMLElement>('[data-hwp-import-page]'),scale=page?(page.getBoundingClientRect().width/Number(page.getAttribute('data-hwp-width'))||1):1,rect=element.getBoundingClientRect();return{width:rect.width/scale,height:rect.height/scale};};
function textAnchor(element:HTMLElement):NativeHwpLines['anchor']{
  const page=element.closest<HTMLElement>('[data-hwp-import-page]');if(!page)return;
  const paper=page.getBoundingClientRect(),scale=paper.width/Number(page.getAttribute('data-hwp-width'));
  const walker=element.ownerDocument.createTreeWalker(element,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){
    const text=walker.currentNode as Text,index=text.data.search(/[^\s\u200b]/u);if(index<0)continue;
    const range=element.ownerDocument.createRange();range.setStart(text,index);range.setEnd(text,index+Array.from(text.data.slice(index))[0].length);
    const glyph=range.getBoundingClientRect(),probe=element.ownerDocument.createElement('span');probe.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline';text.parentElement!.insertBefore(probe,text);
    const anchor={x:(glyph.left-paper.left)/scale,baseline:(probe.getBoundingClientRect().top-paper.top)/scale};probe.remove();return anchor;
  }
}
function paragraphLines(paragraph:HTMLElement):NativeHwpLines{
  const css=style(paragraph),page=paragraph.closest<HTMLElement>('[data-hwp-import-page]'),scale=page?(page.getBoundingClientRect().width/Number(page.getAttribute('data-hwp-width'))||1):1;
  const lineHeight=px(css.lineHeight)||px(css.fontSize),starts=[0],bounds=[{left:Infinity,right:-Infinity}],firstXs:number[]=[],inputs:NonNullable<NativeHwpLines['inputs']>=[],glyphs:NonNullable<NativeHwpLines['glyphs']>=[];let text='',position=0,lineY:number|undefined;
  const addBounds=(rect:DOMRect)=>{const current=bounds[bounds.length-1];current.left=Math.min(current.left,rect.left);current.right=Math.max(current.right,rect.right);};
  const visit=(node:Node)=>{
    if(node.nodeType===Node.TEXT_NODE){let offset=0;const input={from:position,widths:[] as number[]},parent=node.parentElement;
      for(const char of Array.from(node.textContent||'')){
        const range=paragraph.ownerDocument.createRange();range.setStart(node,offset);range.setEnd(node,offset+char.length);const rect=range.getClientRects()[0];
        if(rect?.height&&rect.width){if(lineY!==undefined&&rect.top-lineY>lineHeight*scale/2&&starts.at(-1)!==position){starts.push(position);bounds.push({left:Infinity,right:-Infinity});}if(lineY===undefined||rect.top-lineY>lineHeight*scale/2)lineY=rect.top;addBounds(rect);}
        if(rect?.width){if(!/\s|\u200b/u.test(char)){if(firstXs[bounds.length-1]===undefined)firstXs[bounds.length-1]=rect.left;if(page)glyphs.push({at:position,x:(rect.left-page.getBoundingClientRect().left)/scale});}input.widths.push(rect.width/scale);}
        text+=char;position++;offset+=char.length;
      }
      if(parent?.closest('[data-hwp-text-style]')&&!parent.closest('[data-hwp-advance]')&&input.widths.length===Array.from(node.textContent||'').length)inputs.push(input);
    }else if(node instanceof Element){
      if(node.hasAttribute('data-hwp-tab')){text+='\t';position++;addBounds(node.getBoundingClientRect());return;}
      if(node.tagName==='BR'){if(node.classList.contains('ProseMirror-trailingBreak'))return;if(!node.hasAttribute('data-hwp-soft-break')){text+='\n';position++;}if(starts.at(-1)!==position){starts.push(position);bounds.push({left:Infinity,right:-Infinity});}lineY=undefined;return;}
      if(node instanceof HTMLImageElement||ignored(node))return;
      node.childNodes.forEach(visit);
    }
  };paragraph.childNodes.forEach(visit);
  let anchor=textAnchor(paragraph);const empty=/^[\s\u200b]*$/u.test(text)&& !paragraph.querySelector('img,table');
  if(empty&&page){
    const probe=paragraph.ownerDocument.createElement('span');probe.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline';paragraph.prepend(probe);
    const bounds=probe.getBoundingClientRect(),paper=page.getBoundingClientRect();anchor={x:(bounds.left-paper.left)/scale,baseline:(bounds.top-paper.top)/scale};probe.remove();
  }
  const paperLeft=page?.getBoundingClientRect().left??0;
  return{text,starts,lineHeight,fontSize:px(css.fontSize),...(empty?{empty:true}:{}),align:css.textAlign,widths:bounds.map(b=>Number.isFinite(b.left)?(b.right-b.left)/scale:0),lefts:bounds.map(b=>Number.isFinite(b.left)?(b.left-paperLeft)/scale:0),firstXs:firstXs.map(x=>(x-paperLeft)/scale),...(inputs.length?{inputs}:{}),...(glyphs.length&&paragraph.querySelector('[data-hwp-advance]')?{glyphs}:{}),anchor};
}
function singleTextLine(element:Element):boolean{
  if(!element.textContent?.trim()||element.querySelector('br,img,table'))return false;
  const range=element.ownerDocument.createRange();range.selectNodeContents(element);
  const boxes=[...range.getClientRects()].filter(box=>box.width>0&&box.height>0);
  return boxes.length>0&&boxes.every(box=>Math.abs(box.top-boxes[0].top)<.5);
}
function append(target:NativeHwpContent,source:NativeHwpContent){
  target.html+=source.html;target.text+=source.text;target.tables+=source.tables;target.images+=source.images;
  target.tableCells!.push(...source.tableCells!);target.pictures!.push(...source.pictures!);target.tableGeometry!.push(...source.tableGeometry!);
  target.tabs!.push(...source.tabs??[]);
}
async function fontStyle(css:CSSStyleDeclaration,document:Document):Promise<string>{
  const family=css.fontFamily,properties=`font-size:${css.fontSize};font-weight:${px(css.fontWeight)>=600?'bold':css.fontWeight};font-style:${css.fontStyle};letter-spacing:${css.letterSpacing};color:${color(css.color)};text-decoration:${css.textDecorationLine}`;
  const resolved=await resolveDocumentExportFontFamily(family,document);
  // Make the script-specific font slots explicit in the native importer.
  return `font-family:${resolved};${properties};mso-fareast-font-family:${resolved}`;
}
const paragraphStyle=(css:CSSStyleDeclaration,before?:number,after?:number)=>{
  const align=css.textAlign==='start'?(css.direction==='rtl'?'right':'left'):css.textAlign==='end'?(css.direction==='rtl'?'left':'right'):css.textAlign;
  return `text-align:${align};line-height:${css.lineHeight};margin-top:${before??px(css.marginTop)}px;margin-bottom:${after??px(css.marginBottom)}px;margin-left:${px(css.paddingLeft)}px;margin-right:${px(css.paddingRight)}px`;
};
const base64=(bytes:Uint8Array)=>{let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);};

async function image(source:HTMLImageElement):Promise<NativeHwpContent>{
  const {bytes,type,width,height}=await documentImageData(source),result=empty(),css=style(source);
  // CF208 reviewed image alignment: ordinary solitary block photographs only.
  const parent=source.parentElement,visible=parent?[...parent.childNodes].filter(n=>n instanceof Element?!ignored(n):Boolean(n.textContent?.trim())):[];
  const solitary=parent?.tagName!=='P'||visible.length===1&&visible[0]===source;
  const authored=source.getAttribute('data-image-align');
  const alignment=authored&&['left','center','right'].includes(authored)?authored:solitary&&!source.closest('td,th,li')&&!source.matches('[data-report-source-page="true"]')?documentBlockImageAlignment(source):undefined;
  const margins=['top','bottom'].filter(side=>px(css.getPropertyValue(`margin-${side}`))!==0).map(side=>`margin-${side}:${css.getPropertyValue(`margin-${side}`)}`).join(';');
  result.html=`<img src="data:image/${type==='jpg'?'jpeg':type};base64,${base64(bytes)}" width="${width}" height="${height}" style="text-align:${alignment??css.textAlign};${margins}">`;
  let floating=false;
  try{floating=!!source.closest('td,th')&&JSON.parse(source.getAttribute('data-hwp-layout')||'{}').nativeCellPosition===1;}catch{/* ordinary photo */}
  result.images=1;result.pictures!.push({bytes,width,height,...(floating?{floating:true}:{})});return result;
}

async function inline(nodes:readonly Node[],parent:Element):Promise<NativeHwpContent>{
  const result=empty();
  for(const node of nodes){
    if(node.nodeType===Node.TEXT_NODE){
      const css=style(parent),text=css.whiteSpace.startsWith('pre')?node.textContent||'':(node.textContent||'').replace(/\s+/gu,' ');
      let properties=await fontStyle(css,parent.ownerDocument);
      const original=parent.closest<HTMLElement>('[data-hwp-text-style]')?.getAttribute('data-hwp-text-style');
      if(original){
        const value=JSON.parse(original),family=Array.isArray(value)?value[0]:value.fontFamily;
        // Unchanged imported text retains its native face and measured width.
        // Newly authored text uses the visible web face, not the old source's
        // different font metrics inherited through a surrounding font mark.
        const measured=!!parent.closest('[data-hwp-advance]'),nativeFamily=measured?((Array.isArray(value)?value[6]:value.nativeFontFamily)||family):family;
        const spacing=Array.isArray(value)?value[3]:value.letterSpacing,size=Array.isArray(value)?value[1]:value.fontSize;
        const actual=css.fontFamily.replace(/["']/gu,'').split(',').map(name=>name.trim());
        if(typeof family==='string'&&typeof nativeFamily==='string'&&actual.some(name=>name===family||name===`HwpImport ${family}`))properties=properties.replace(/(?:^|;)font-family:[^;]+/u,`font-family:${nativeFamily}`).replace(/mso-fareast-font-family:[^;]+/u,`mso-fareast-font-family:${nativeFamily}`);
        if(typeof spacing==='number'&&!parent.closest('[data-text-style]'))properties=properties.replace(/letter-spacing:[^;]+/u,`letter-spacing:${spacing}px`);
        if(typeof size==='number'){const pixels=size<0?-size/75:size;if(Math.abs(px(css.fontSize)-pixels)<.001)properties=properties.replace(/font-size:[^;]+/u,`font-size:${Math.round(pixels*75)/100}pt`);}
      }
      result.html+=`<span style="${escape(properties)}">${escape(text)}</span>`;result.text+=text;
    }else if(node instanceof Element&&!ignored(node)){
      if(node instanceof HTMLImageElement)append(result,await image(node));
      else if(node.hasAttribute('data-hwp-tab')){result.html+='<span>\ue001</span>';result.text+='\t';result.tabs!.push(Number(node.getAttribute('data-hwp-tab')));}
      else if(node.tagName==='BR'){if(!node.classList.contains('ProseMirror-trailingBreak')&&!node.hasAttribute('data-hwp-soft-break')){result.html+='<br>';result.text+='\n';}}
      else append(result,await inline([...node.childNodes],node));
    }
  }return result;
}

async function paragraph(element:Element,nodes:readonly Node[]=[...element.childNodes],before?:number,after?:number,marker=''):Promise<NativeHwpContent>{
  const visible=nodes.filter(node=>node instanceof Element?!ignored(node):Boolean(node.textContent?.trim()));
  if(visible.length===1&&visible[0] instanceof HTMLImageElement){
    nodes=visible;
    const parent=style(element),photo=style(visible[0]);
    // A sole block image and a plain block paragraph collapse their adjoining
    // margins in CSS. Resolve that supported case while the DOM is available;
    // keep unsupported mixed content/borders under the existing loss guard.
    if(parent.display==='block'&&parent.overflow==='visible'&&photo.display==='block'&&['Top','Right','Bottom','Left'].every(side=>px(parent.getPropertyValue(`padding-${side.toLowerCase()}`))===0&&px(parent.getPropertyValue(`border-${side.toLowerCase()}-width`))===0)&&!(element as HTMLElement).style.height){
      const collapsed=(a:number,b:number)=>Math.max(0,a,b)+Math.min(0,a,b);
      const parentBox=element.getBoundingClientRect(),photoBox=visible[0].getBoundingClientRect(),scale=parentBox.width/(element as HTMLElement).offsetWidth||1;
      const insideTop=(photoBox.top-parentBox.top)/scale,insideBottom=(parentBox.bottom-photoBox.bottom)/scale;
      // min-height can prevent bottom-margin collapse. Measure the actual
      // interior gap instead of guessing from CSS declarations alone.
      const top=insideTop>0.05?(before??px(parent.marginTop))+insideTop:collapsed(before??px(parent.marginTop),px(photo.marginTop));
      const bottom=insideBottom>0.05?(after??px(parent.marginBottom))+insideBottom:collapsed(after??px(parent.marginBottom),px(photo.marginBottom));
      const result=await image(visible[0]);
      result.html=result.html.replace(/margin-(?:top|bottom):[^;"]+;?/gu,'').replace(/style="/u,`style="margin-top:${top}px;margin-bottom:${bottom}px;`);
      return result;
    }
  }
  const result=await inline(nodes,element),css=style(element);
  let lineHeight=css.lineHeight;
  if(lineHeight==='normal'&&css.display==='block'&&element instanceof HTMLElement&&!element.style.height&&px(css.minHeight)===0&&!result.images&&result.text.trim()){
    const range=element.ownerDocument.createRange();range.selectNodeContents(element);
    const rects=[...range.getClientRects()].filter(r=>r.height>0&&r.width>0);
    if(rects.length&&rects.every(r=>Math.abs(r.top-rects[0].top)<.5)){
      const box=element.getBoundingClientRect(),scale=box.width/element.offsetWidth||1;
      const measured=box.height/scale-px(css.paddingTop)-px(css.paddingBottom)-px(css.borderTopWidth)-px(css.borderBottomWidth);
      if(measured>0)lineHeight=`${measured}px`;
    }
  }
  // CSS places half the extra line-height above the glyphs. HWP places it
  // below. Transfer that space from after to before without changing advance;
  // mixed-size runs and insufficient trailing space need richer layout support.
  const leading=Math.max(0,(px(lineHeight)-px(css.fontSize))/2);
  const uniform=[element,...element.querySelectorAll('*')].every(e=>px(style(e).fontSize)===px(css.fontSize));
  if(before===undefined&&after===undefined&&!element.closest('td,th')&&!result.images&&result.text&&leading>0&&uniform&&px(css.marginBottom)>=leading){before=px(css.marginTop)+leading;after=px(css.marginBottom)-leading;}
  if(marker){result.html=escape(marker)+result.html;result.text=marker+result.text;}
  // Keep photos as individual blocks. Inline mixed text/photos require a richer
  // character-object mapping; the semantic gate blocks loss rather than flattening.
  let properties=paragraphStyle(css,before,after).replace(/line-height:[^;]+/u,`line-height:${lineHeight}`);
  // TD padding is stored once on the native cell, not again as paragraph indent.
  if(/^(TD|TH)$/u.test(element.tagName))properties=properties.replace(/margin-(left|right):[^;]+/gu,'margin-$1:0px');
  result.html=`<p style="${escape(properties)}">${result.html}</p>`;
  return result;
}

async function table(source:HTMLTableElement):Promise<NativeHwpContent>{
  const columns=[...source.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col')].map(col=>measured(col).width);
  const gridWidth=source.hasAttribute('data-hwp-layout')&&columns.length&&columns.every(w=>w>0)?columns.reduce((sum,w)=>sum+w,0):measured(source).width;
  const result=empty(),cells:NonNullable<NativeHwpContent['tableCells']>[number]=[],geometry:NonNullable<NativeHwpContent['tableGeometry']>[number]={width:gridWidth,reflowCellLines:true,cells:[]};
  result.tables=1;result.tableCells!.push(cells);result.tableGeometry!.push(geometry);
  let rows='';const occupied:boolean[][]=[];
  const visibleRows=[...source.rows].filter(row=>!ignored(row));
  for(let r=0;r<visibleRows.length;r++){
    let rowHtml='',column=0;
    for(const cell of [...visibleRows[r].cells].filter(cell=>!ignored(cell))){
      while(occupied[r]?.[column])column++;
      const css=style(cell),body=await blocks(cell),rowSpan=cell.rowSpan||visibleRows.length-r,colSpan=cell.colSpan;
      for(let y=r;y<r+rowSpan;y++)for(let x=column;x<column+colSpan;x++){occupied[y]??=[];occupied[y][x]=true;}
      // Cell text excludes nested tables; those have their own expected manifest.
      const own=cell.cloneNode(true) as HTMLElement;own.querySelectorAll('table').forEach(node=>node.remove());
      const ownText=body.tables?[...own.childNodes].map(node=>node.textContent||'').join('').replace(/\s+/gu,' '):body.text;
      cells.push({row:r,col:column,rowSpan,colSpan,text:ownText});
      const children=[...cell.children],captions=children.filter(child=>child.textContent?.trim());
      const singleLine=Boolean(cell.querySelector('img'))&&!cell.querySelector('table,br')&&captions.length>0
        &&[...cell.childNodes].every(node=>node.nodeType===Node.TEXT_NODE?!node.textContent?.trim():node instanceof HTMLImageElement||node instanceof Element&&/^(P|H[1-6])$/u.test(node.tagName))
        &&captions.every(singleTextLine);
      const size=measured(cell);
      let native:Record<string,unknown>={};try{native=JSON.parse(cell.getAttribute('data-hwp-layout')||'{}');}catch{/* ordinary table */}
      const nativeBorders=typeof native.nativeWidth==='number'?Object.fromEntries(['left','right','top','bottom'].map(side=>{
        const key=side[0].toUpperCase()+side.slice(1),raw=String(native[`border${key}`]||'none'),edge=raw.match(/^([\d.]+)px (\w+) (#[0-9a-f]{6})$/iu),pattern=native[`border${key}Pattern`];
        return[side,{type:!edge?'NONE':pattern?String(pattern):edge[2]==='dotted'?'DOT':edge[2]==='dashed'?'DASH':edge[2]==='double'?'DOUBLE_SLIM':'SOLID',width:edge?Math.round(Number(edge[1])*25.4/96*100)/100:.12,color:edge?.[3]||'#000000'}];
      })):undefined;
      // Collapsed-border compensation is local browser paint, not authored
      // native padding. Serializing it again subtracts half a border each trip.
      const padding=Object.fromEntries(['top','right','bottom','left'].map(side=>{const key='padding'+side[0].toUpperCase()+side.slice(1);return[side,typeof native.nativeWidth==='number'&&typeof native[key]==='number'?native[key]:px(css.getPropertyValue('padding-'+side))];})) as {top:number;right:number;bottom:number;left:number};
      // A raw height may be only a minimum (e.g. a photo expanded the row).
      // Use its precision only when it represents the same visible height.
      const preciseHeight=typeof native.nativeHeight==='number'&&native.nativeHeight>0&&Math.abs(native.nativeHeight-Number(native.height))<=.05?native.nativeHeight:typeof native.height==='number'?native.height:size.height;
      const height=typeof native.nativeWidth==='number'&&typeof native.height==='number'&&!cell.parentElement?.hasAttribute('data-row-height-mm')?preciseHeight:size.height;
      geometry.cells.push({width:size.width,height,singleLine,padding,borders:nativeBorders,lines:typeof native.nativeWidth==='number'?[...cell.querySelectorAll<HTMLElement>('p')].map(paragraphLines):undefined});
      const borders=['top','right','bottom','left'].map(side=>`border-${side}:${css.getPropertyValue(`border-${side}-width`)} ${css.getPropertyValue(`border-${side}-style`)} ${color(css.getPropertyValue(`border-${side}-color`))}`).join(';');
      rowHtml+=`<td rowspan="${rowSpan}" colspan="${colSpan}" style="width:${size.width}px;height:${height}px;padding:0;vertical-align:${css.verticalAlign};background-color:${color(css.backgroundColor)};${borders}">${body.html}</td>`;
      result.text+=body.text;result.images+=body.images;result.tables+=body.tables;result.pictures!.push(...body.pictures!);result.tableCells!.push(...body.tableCells!);result.tableGeometry!.push(...body.tableGeometry!);
      result.tabs!.push(...body.tabs??[]);
      column+=colSpan;
    }rows+=`<tr>${rowHtml}</tr>`;
  }
  result.html=`<table style="width:${geometry.width}px;border-collapse:collapse">${rows}</table>`;return result;
}

async function positionedPage(page:HTMLElement):Promise<NativeHwpPage>{
  const source=page.matches('[data-hwp-import-page]')?page:page.querySelector<HTMLElement>('[data-hwp-import-page]');
  if(!source)throw Error('HWP 페이지 배치 원본이 없습니다.');
  const width=Number(source.getAttribute('data-hwp-width')),height=Number(source.getAttribute('data-hwp-height')),paper=source.getBoundingClientRect(),scale=paper.width/width;
  const body=empty(),positioned:NonNullable<NativeHwpPage['positioned']>=[];
  for(const element of [...source.children] as HTMLElement[]){
    if(ignored(element))continue;
    const picture=element.tagName==='P'&&!element.textContent?.replace(/\u200b/gu,'').trim()&&element.querySelectorAll('img').length===1?element.querySelector<HTMLImageElement>('img'):null;
    const outer=element.getBoundingClientRect(),rect=picture?picture.getBoundingClientRect():element instanceof HTMLTableElement?element.rows[0]?.cells[0]?.getBoundingClientRect()??outer:outer,marker=`CF229_POSITION_${positioned.length}_ANCHOR`;
    if(source.textContent?.includes(marker))throw Error('HWP 배치 내부 표식과 본문이 충돌했습니다.');
    let content:NativeHwpContent,kind:'text'|'table'|'image'|'rule';
    let anchor:{x:number;baseline:number}|undefined;
    if(picture){kind='image';content=await image(picture);}
    else if(element.hasAttribute('data-hwp-text-box')||element.tagName==='P'){
      kind='text';content=empty();
      for(const p of element.tagName==='P'?[element]:[...element.children])append(content,await paragraph(p));
      anchor=textAnchor(element);
    }else if(element.hasAttribute('data-hwp-import-rule')){kind='rule';content=empty();}
    else if(element instanceof HTMLTableElement){kind='table';content=await table(element);}
    else if(element instanceof HTMLImageElement){kind='image';content=await image(element);}
    else throw Error('HWP 고정 페이지에서 보존하지 못하는 개체가 있습니다.');
    body.html+=`<p>${marker}</p>`;append(body,content);
    positioned.push({marker,kind,left:(rect.left-paper.left)/scale,top:(rect.top-paper.top)/scale,width:outer.width/scale,height:outer.height/scale,anchor,...(kind==='text'?{lines:(element.tagName==='P'?[element]:[...element.children] as HTMLElement[]).map(paragraphLines)}:{}),...(kind==='rule'?{stroke:Number(element.getAttribute('data-hwp-rule-stroke')),color:element.getAttribute('data-hwp-rule-color')||'#000000',lineStyle:element.getAttribute('data-hwp-rule-style')||'solid'}:{})});
  }
  return{...body,width,height,margins:{top:0,right:0,bottom:0,left:0},positioned};
}

/** Native borderless table for an authored two/three-column layout (cover/TOC). */
function layoutRow(contents:NativeHwpContent[],widths:number[],height:number,padding?:Array<{top:number;right:number;bottom:number;left:number}>,advance?:number):NativeHwpContent{
  const result=empty();result.tables=1;
  result.tableCells!.push(contents.map((c,col)=>({row:0,col,rowSpan:1,colSpan:1,text:c.text})));
  result.tableGeometry!.push({width:widths.reduce((a,b)=>a+b,0),advance,cells:widths.map((width,i)=>({width,height,padding:padding?.[i]??{top:0,right:0,bottom:0,left:0}}))});
  result.html='<table style="border-collapse:collapse"><tr>'+contents.map((c,i)=>`<td style="width:${widths[i]}px;height:${height}px;padding:0;border:0px none #ffffff;vertical-align:middle">${c.html}</td>`).join('')+'</tr></table>';
  for(const c of contents){result.text+=c.text;result.images+=c.images;result.tables+=c.tables;result.tableCells!.push(...c.tableCells!);result.tableGeometry!.push(...c.tableGeometry!);result.pictures!.push(...c.pictures!);result.tabs!.push(...c.tabs??[]);}
  return result;
}

async function blocks(parent:Element):Promise<NativeHwpContent>{
  const result=empty();let pending:Node[]=[],previous:HTMLElement|null=null,previousBottom=0;
  const flush=async()=>{if(pending.some(n=>n instanceof Element||n.textContent?.trim())){append(result,await paragraph(parent,pending));previous=null;}pending=[];};
  for(const node of [...parent.childNodes]){
    if(!(node instanceof Element)){pending.push(node);continue;}
    if(ignored(node)||node.matches('.report-page-number,.proposal-cover-frame'))continue;
    if(node.matches('.proposal-final-toc li,.report-toc-entry')){
      await flush();previous=null;
      const reportToc=node.matches('.report-toc-entry');
      const children=reportToc?[node.firstElementChild,node.querySelector('.report-toc-leader'),node.querySelector('.report-toc-page')]:[node.querySelector(':scope > b'),node.querySelector(':scope > span'),node.querySelector(':scope > i')];
      if(children.some(e=>!e))throw Error('HWP 목차 제목·쪽번호를 확인하지 못했습니다.');
      const contents=await Promise.all(children.map((e,i)=>reportToc&&i===1?empty():paragraph(e!,[...e!.childNodes],0,0)));
      const rect=node.getBoundingClientRect(),scale=rect.width/(node as HTMLElement).offsetWidth||1;
      const boxes=children.map(e=>e!.getBoundingClientRect());
      const starts=boxes.map((box,i)=>i?(box.left-rect.left)/scale:0);
      const ends=boxes.map((_,i)=>i+1<boxes.length?starts[i+1]:rect.width/scale);
      const widths=starts.map((start,i)=>ends[i]-start);
      const padding=boxes.map((box,i)=>reportToc&&i===1?{left:0,right:0,top:0,bottom:0}:{left:(box.left-rect.left)/scale-starts[i],right:ends[i]-(box.right-rect.left)/scale,top:(box.top-rect.top)/scale,bottom:(rect.bottom-box.bottom)/scale});
      if(widths.some(width=>width<=0)||padding.some(p=>Object.values(p).some(value=>value<-.1)))throw Error('HWP 목차 열 배치를 확인하지 못했습니다.');
      const page=node.closest<HTMLElement>('[data-export-page]'),pageScale=page?(page.getBoundingClientRect().width/page.offsetWidth||1):scale;
      const next=node.nextElementSibling?.matches(reportToc?'.report-toc-entry':'.proposal-final-toc li')?node.nextElementSibling:null;
      const advance=next?(next.getBoundingClientRect().top-rect.top)/pageScale:rect.height/pageScale+px(style(node).marginBottom);
      const row=layoutRow(contents,widths,(node as HTMLElement).offsetHeight,padding,advance);
      row.tableGeometry![0].reflowCellLines=true;
      if(reportToc&&singleTextLine(children[0]!))row.tableGeometry![0].cells[0].singleLine=true;
      append(result,row);continue;
    }
    if(node instanceof HTMLTableElement){await flush();previous=null;append(result,await table(node));continue;}
    if(node instanceof HTMLImageElement){await flush();previous=null;append(result,await image(node));continue;}
    // CF208 reviewed proposal header flow: the label uses the header line box;
    // its outer gap belongs after the title, not after the inline label.
    if(node.matches('.proposal-final-chapter > header')){
      await flush();previous=null;
      const [label,title]=[...node.children],css=style(node),titleCss=title&&style(title);
      if(node.children.length!==2||label?.tagName!=='SPAN'||title?.tagName!=='H3'||px(css.paddingTop)!==0||!titleCss)throw Error('HWP 제안서 머리구간 배치를 확인하지 못했습니다.');
      const page=node.closest<HTMLElement>('[data-export-page]'),scale=page?(page.getBoundingClientRect().width/page.offsetWidth||1):1;
      const labelHeight=(title.getBoundingClientRect().top-node.getBoundingClientRect().top)/scale-px(titleCss.marginTop);
      if(labelHeight<=0)throw Error('HWP 제안서 머리구간 줄 높이를 확인하지 못했습니다.');
      const caption=await paragraph(label,[...label.childNodes],0,0);
      caption.html=caption.html.replace(/line-height:[^;]+/u,`line-height:${labelHeight}px`);
      append(result,caption);
      append(result,await paragraph(title,[...title.childNodes],px(titleCss.marginTop),px(titleCss.marginBottom)+px(css.paddingBottom)+px(css.borderBottomWidth)+px(css.marginBottom)));
      continue;
    }
    const css=style(node);
    if(['inline','inline-block','inline-flex'].includes(css.display)||node.tagName==='BR'){pending.push(node);continue;}
    await flush();
    if(/^(P|H[1-6]|PRE|FIGCAPTION)$/u.test(node.tagName)){
      const block=node instanceof HTMLElement&&/^(P|H[1-6])$/u.test(node.tagName)&&!parent.closest('td,th,li')&&['block','flow-root'].includes(style(parent).display)&&css.display==='block'&&css.position==='static'&&css.cssFloat==='none'&&css.clear==='none'&&css.transform==='none'&&px(css.marginTop)>=0&&px(css.marginBottom)>=0&&['top','bottom'].every(side=>px(css.getPropertyValue(`padding-${side}`))===0&&px(css.getPropertyValue(`border-${side}-width`))===0);
      const ordinary=block&&!node.querySelector('img,table,svg,canvas,iframe,video,audio,object,embed,input,textarea,button');
      // Bare zero-height paragraphs collapse through their neighbours in CSS;
      // creating a native line for them adds content height absent from the DOM.
      if(previous&&ordinary&&node.tagName==='P'&&!node.attributes.length&&!node.childNodes.length&&node.getBoundingClientRect().height===0&&['::before','::after'].every(side=>['none','normal','""',"''"].includes(node.ownerDocument.defaultView!.getComputedStyle(node,side).content)))continue;
      const content=await paragraph(node);
      const picture=node.querySelector('img'),photo=block&&node.tagName==='P'&&content.html.startsWith('<img ')&&content.images===1&&!content.text.trim()&&picture&&Math.abs(node.getBoundingClientRect().height-picture.getBoundingClientRect().height)<.1;
      const photoMargin=(side:'top'|'bottom')=>px(content.html.match(new RegExp(`margin-${side}:([^;"\\s]+)`,'u'))?.[1]||'0');
      if(previous&&(ordinary||photo)){
        const scale=parent.getBoundingClientRect().width/(parent as HTMLElement).offsetWidth||1;
        const gap=(node.getBoundingClientRect().top-previous.getBoundingClientRect().bottom)/scale;
        // Resolve CSS sibling margin collapse, retaining paragraph()'s existing
        // half-leading transfer exactly once and leaving source nodes untouched.
        const difference=gap-previousBottom-(photo?photoMargin('top'):px(css.marginTop));
        content.html=content.html.replace(/margin-top:([\d.]+)px/u,(_,value:string)=>{
          const before=Number(value)+difference;
          if(before<-.1)throw Error('HWP 문단의 겹친 간격을 보존하지 못했습니다.');
          return `margin-top:${Math.max(0,before)}px`;
        });
      }
      append(result,content);previous=(ordinary&&content.text.trim()||photo)?node as HTMLElement:null;previousBottom=photo?photoMargin('bottom'):px(css.marginBottom);
    }
    else if(node.tagName==='LI'){
      previous=null;
      append(result,await paragraph(node,[...node.childNodes].filter(n=>!(n instanceof Element&&/^(UL|OL)$/u.test(n.tagName))),undefined,undefined,listMarker(node)));
      for(const child of node.children)if(/^(UL|OL)$/u.test(child.tagName))append(result,await blocks(child));
    }else {previous=null;append(result,await blocks(node));}
  }
  await flush();return result;
}

/** Read the reviewed DOM only. No template reinjection, save or API mutation. */
export async function collectNativeHwpPages(root:HTMLElement,orientation:'portrait'|'landscape'):Promise<NativeHwpPage[]>{
  await prepareDocumentExportFonts(root.ownerDocument);
  const candidates=root.matches('[data-export-page]')?[root]:[...root.querySelectorAll<HTMLElement>('[data-export-page]')];
  const pages=candidates.filter(page=>!ignored(page)&&!page.parentElement?.closest('[data-export-page]'));
  const results:NativeHwpPage[]=[];
  for(const page of pages){
    if(page.matches('[data-hwp-import-page]')||page.querySelector('[data-hwp-import-page]')){results.push(await positionedPage(page));continue;}
    // Native paper has no CSS border box. Its content starts after both the
    // authored page border and padding, just as in the reviewed DOM.
    const css=style(page),margins={top:px(css.paddingTop)+px(css.borderTopWidth),right:px(css.paddingRight)+px(css.borderRightWidth),bottom:px(css.paddingBottom)+px(css.borderBottomWidth),left:px(css.paddingLeft)+px(css.borderLeftWidth)};
    const rules:NonNullable<NativeHwpPage['rules']>=[],pageRect=page.getBoundingClientRect(),scale=pageRect.width/page.offsetWidth||1;
    const borderRule=(element:Element,side:'top'|'bottom')=>{
      const computed=style(element),height=px(computed.getPropertyValue(`border-${side}-width`));
      if(!height)return;
      const rect=element.getBoundingClientRect(),fill=color(computed.getPropertyValue(`border-${side}-color`));
      if(fill==='transparent')return;
      if(element.matches('.report-toc-leader')&&side==='bottom'&&computed.borderBottomStyle==='dotted'){
        rules.push({left:(rect.left-pageRect.left)/scale,top:(rect.bottom-pageRect.top)/scale-height/2,width:rect.width/scale,height:0,colors:[fill],dotted:true,stroke:height});return;
      }
      if(computed.getPropertyValue(`border-${side}-style`)!=='solid')throw Error('HWP 장식선 형식의 추가 검증이 필요합니다.');
      rules.push({left:(rect.left-pageRect.left)/scale,top:(rect[side==='top'?'top':'bottom']-pageRect.top)/scale-(side==='bottom'?height:0),width:rect.width/scale,height,colors:[fill]});
    };
    const body=empty();let footer:NativeHwpPage['footer'],paragraphInsets:NativeHwpPage['paragraphInsets'];
    const proposalCover=page.matches('.proposal-final-cover')&&page.querySelector(':scope > .proposal-cover-heading');
    const reportCover=page.matches('.report-final-cover')&&page.querySelector(':scope > .report-cover-heading');
    if(proposalCover||reportCover){
      paragraphInsets=[];
      const rect=page.getBoundingClientRect(),scale=rect.width/page.offsetWidth||1;let previous=rect.top+margins.top*scale;
      const selector=proposalCover?':scope > .proposal-cover-heading > p, :scope > .proposal-cover-heading > div > *, :scope > time':':scope > .report-cover-heading > *, :scope > .report-cover-signature > *';
      for(const element of page.querySelectorAll(selector)){
        if(ignored(element))continue;const box=element.getBoundingClientRect();
        paragraphInsets.push({left:(box.left-rect.left)/scale-margins.left+px(style(element).paddingLeft),right:rect.width/scale-margins.right-(box.right-rect.left)/scale+px(style(element).paddingRight)});
        append(body,await paragraph(element,[...element.childNodes],Math.max(0,(box.top-previous)/scale),0));previous=box.bottom;
      }
      if(proposalCover){
        const band=page.querySelector(':scope > .proposal-cover-heading > div')!,bandStyle=style(band),bandRect=band.getBoundingClientRect();
        if(bandStyle.borderImageSource!=='none'){
          const gradient=bandStyle.borderImageSource.match(/^linear-gradient\(90deg,\s*(rgba?\([^)]+\)),\s*(rgba?\([^)]+\))\)$/u);
          if(!gradient)throw Error('HWP 갑지 그라데이션 형식의 추가 검증이 필요합니다.');
          for(const side of ['top','bottom'] as const){const height=px(bandStyle.getPropertyValue(`border-${side}-width`));if(height)rules.push({left:(bandRect.left-pageRect.left)/scale,top:(bandRect[side==='top'?'top':'bottom']-pageRect.top)/scale-(side==='bottom'?height:0),width:bandRect.width/scale,height,colors:[color(gradient[1]),color(gradient[2])]});}
        }
        const signature=page.querySelector<HTMLElement>(':scope > footer'),logo=signature?.querySelector<HTMLImageElement>(':scope > img'),details=signature?.querySelector<HTMLElement>(':scope > div');
        if(!signature||!logo||!details)throw Error('HWP 갑지 회사정보·로고가 없습니다.');
        const contact=empty();for(const element of details.children)append(contact,await paragraph(element,[...element.childNodes],px(style(element).marginTop),element===details.lastElementChild?0:px(style(details).rowGap)));
        const widths=[px(style(signature).gridTemplateColumns.split(' ')[0])+px(style(signature).columnGap),details.offsetWidth];
        footer={...layoutRow([await image(logo),contact],widths,signature.offsetHeight),distance:px(css.paddingBottom)+px(css.borderBottomWidth),centerTable:true};
        margins.bottom=Math.max(margins.bottom,footer.distance+signature.offsetHeight);
      }
    }else append(body,await blocks(page));
    for(const element of page.querySelectorAll(':scope > ol > li, :scope > header, .report-toc-leader'))borderRule(element,'bottom');
    const pageNumber=page.querySelector<HTMLElement>(':scope > .report-page-number');
    if(pageNumber&&!ignored(pageNumber))footer={...await paragraph(pageNumber),distance:px(css.borderBottomWidth)+px(style(pageNumber).bottom)};
    if(page.matches('.proposal-final-toc,.proposal-final-chapter')){
      const pseudo=page.ownerDocument.defaultView!.getComputedStyle(page,'::after');
      if(pseudo.content&&!['none','normal'].includes(pseudo.content)&&pseudo.display!=='none'){
        const text=[...pseudo.content.matchAll(/"([^"]*)"|'([^']*)'/gu)].map(m=>m[1]??m[2]).join('');
        if(!text)throw Error('HWP 하단 쪽번호를 확인하지 못했습니다.');
        footer={...empty(),html:`<p style="${escape(paragraphStyle(pseudo,0,0))}"><span style="${escape(await fontStyle(pseudo,page.ownerDocument))}">${escape(text)}</span></p>`,text,distance:px(css.borderBottomWidth)+px(pseudo.bottom)};
        const thickness=px(pseudo.borderTopWidth);
        if(thickness&&pseudo.borderTopStyle==='solid')rules.push({left:px(css.borderLeftWidth)+px(pseudo.left),top:page.offsetHeight-px(css.borderBottomWidth)-px(pseudo.bottom)-px(pseudo.height)-px(pseudo.paddingTop)-px(pseudo.paddingBottom)-thickness,width:px(pseudo.width),height:thickness,colors:[color(pseudo.borderTopColor)]});
      }
    }
    const frameElement=proposalCover?page.querySelector<HTMLElement>(':scope > .proposal-cover-frame'):null,frameCss=frameElement?style(frameElement):null;
    // HWP suppresses before-spacing on the first paragraph of a section.
    // Standalone photos also become paragraphs in the native importer.
    // Move that space into the paper margin for both titles and first photos.
    body.html=body.html.replace(/^<(p|img)\b([^>]*\bstyle=")([^"]*)"/u,(tag,kind:string,attributes:string,properties:string)=>{
      const before=properties.match(/(?:^|;)margin-top:([\d.]+)px/u);
      if(!before)return tag;
      margins.top+=Number(before[1]);
      return `<${kind}${attributes}${properties.replace(/margin-top:[\d.]+px/u,'margin-top:0px')}"`;
    });
    results.push({...body,width:orientation==='portrait'?794:1123,height:orientation==='portrait'?1123:794,margins,footer,rules,paragraphInsets,frame:frameCss?{left:px(frameCss.left),top:px(frameCss.top),width:page.offsetWidth-px(frameCss.left)-px(frameCss.right),height:page.offsetHeight-px(frameCss.top)-px(frameCss.bottom),color:color(frameCss.borderTopColor),stroke:px(frameCss.borderTopWidth)}:undefined});
  }return results;
}
