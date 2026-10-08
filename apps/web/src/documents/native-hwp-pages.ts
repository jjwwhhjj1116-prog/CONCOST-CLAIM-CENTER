import {documentImageData,listMarker} from './editable-docx-export';
import type {NativeHwpContent,NativeHwpPage} from './editable-hwp-export';

const px=(v:string)=>Number.parseFloat(v)||0;
const style=(e:Element)=>e.ownerDocument.defaultView!.getComputedStyle(e);
const escape=(v:string)=>v.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const color=(v:string)=>{
  const m=v.match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)(?:[, /]+([\d.]+))?\)/u);
  return m?(m[4]==='0'?'transparent':'#'+m.slice(1,4).map(n=>Number(n).toString(16).padStart(2,'0')).join('')):v;
};
const ignored=(e:Element)=>e.matches('script,style,button,input,select,textarea,[hidden],[aria-hidden="true"],[data-export-ignore],[data-html2canvas-ignore],.document-tool-menus,.structured-editor__toolbar')||['none'].includes(style(e).display)||['hidden','collapse'].includes(style(e).visibility);
const empty=():NativeHwpContent=>({html:'',text:'',tables:0,images:0,tableCells:[],pictures:[],tableGeometry:[]});
function append(target:NativeHwpContent,source:NativeHwpContent){
  target.html+=source.html;target.text+=source.text;target.tables+=source.tables;target.images+=source.images;
  target.tableCells!.push(...source.tableCells!);target.pictures!.push(...source.pictures!);target.tableGeometry!.push(...source.tableGeometry!);
}
const fontStyle=(css:CSSStyleDeclaration)=>`font-family:${css.fontFamily.split(',')[0].replaceAll('"','').replaceAll("'",'')};font-size:${css.fontSize};font-weight:${px(css.fontWeight)>=600?'bold':css.fontWeight};font-style:${css.fontStyle};letter-spacing:${css.letterSpacing};color:${color(css.color)};text-decoration:${css.textDecorationLine}`;
const paragraphStyle=(css:CSSStyleDeclaration,before?:number,after?:number)=>{
  const align=css.textAlign==='start'?(css.direction==='rtl'?'right':'left'):css.textAlign==='end'?(css.direction==='rtl'?'left':'right'):css.textAlign;
  return `text-align:${align};line-height:${css.lineHeight};margin-top:${before??px(css.marginTop)}px;margin-bottom:${after??px(css.marginBottom)}px;margin-left:${px(css.paddingLeft)}px;margin-right:${px(css.paddingRight)}px`;
};
const base64=(bytes:Uint8Array)=>{let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);};

async function image(source:HTMLImageElement):Promise<NativeHwpContent>{
  const {bytes,type,width,height}=await documentImageData(source),result=empty(),css=style(source);
  const margins=['top','bottom'].filter(side=>px(css.getPropertyValue(`margin-${side}`))!==0).map(side=>`margin-${side}:${css.getPropertyValue(`margin-${side}`)}`).join(';');
  result.html=`<img src="data:image/${type==='jpg'?'jpeg':type};base64,${base64(bytes)}" width="${width}" height="${height}" style="text-align:${css.textAlign};${margins}">`;
  result.images=1;result.pictures!.push({bytes,width,height});return result;
}

async function inline(nodes:readonly Node[],parent:Element):Promise<NativeHwpContent>{
  const result=empty();
  for(const node of nodes){
    if(node.nodeType===Node.TEXT_NODE){
      const css=style(parent),text=css.whiteSpace.startsWith('pre')?node.textContent||'':(node.textContent||'').replace(/\s+/gu,' ');
      result.html+=`<span style="${escape(fontStyle(css))}">${escape(text)}</span>`;result.text+=text;
    }else if(node instanceof Element&&!ignored(node)){
      if(node instanceof HTMLImageElement)append(result,await image(node));
      else if(node.tagName==='BR'){result.html+='<br>';result.text+='\n';}
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
  const result=empty(),cells:NonNullable<NativeHwpContent['tableCells']>[number]=[],geometry:NonNullable<NativeHwpContent['tableGeometry']>[number]={width:source.offsetWidth,cells:[]};
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
      geometry.cells.push({width:cell.offsetWidth,height:cell.offsetHeight,padding:{top:px(css.paddingTop),right:px(css.paddingRight),bottom:px(css.paddingBottom),left:px(css.paddingLeft)}});
      const borders=['top','right','bottom','left'].map(side=>`border-${side}:${css.getPropertyValue(`border-${side}-width`)} ${css.getPropertyValue(`border-${side}-style`)} ${color(css.getPropertyValue(`border-${side}-color`))}`).join(';');
      rowHtml+=`<td rowspan="${rowSpan}" colspan="${colSpan}" style="width:${cell.offsetWidth}px;height:${cell.offsetHeight}px;padding:0;vertical-align:${css.verticalAlign};background-color:${color(css.backgroundColor)};${borders}">${body.html}</td>`;
      result.text+=body.text;result.images+=body.images;result.tables+=body.tables;result.pictures!.push(...body.pictures!);result.tableCells!.push(...body.tableCells!);result.tableGeometry!.push(...body.tableGeometry!);
      column+=colSpan;
    }rows+=`<tr>${rowHtml}</tr>`;
  }
  result.html=`<table style="width:${source.offsetWidth}px;border-collapse:collapse">${rows}</table>`;return result;
}

/** Native borderless table for an authored two/three-column layout (cover/TOC). */
function layoutRow(contents:NativeHwpContent[],widths:number[],height:number,padding?:Array<{top:number;right:number;bottom:number;left:number}>):NativeHwpContent{
  const result=empty();result.tables=1;
  result.tableCells!.push(contents.map((c,col)=>({row:0,col,rowSpan:1,colSpan:1,text:c.text})));
  result.tableGeometry!.push({width:widths.reduce((a,b)=>a+b,0),cells:widths.map((width,i)=>({width,height,padding:padding?.[i]??{top:0,right:0,bottom:0,left:0}}))});
  result.html='<table style="border-collapse:collapse"><tr>'+contents.map((c,i)=>`<td style="width:${widths[i]}px;height:${height}px;padding:0;border:0px none #ffffff;vertical-align:middle">${c.html}</td>`).join('')+'</tr></table>';
  for(const c of contents){result.text+=c.text;result.images+=c.images;result.tables+=c.tables;result.tableCells!.push(...c.tableCells!);result.tableGeometry!.push(...c.tableGeometry!);result.pictures!.push(...c.pictures!);}
  return result;
}

async function blocks(parent:Element):Promise<NativeHwpContent>{
  const result=empty();let pending:Node[]=[],previous:HTMLElement|null=null;
  const flush=async()=>{if(pending.some(n=>n instanceof Element||n.textContent?.trim())){append(result,await paragraph(parent,pending));previous=null;}pending=[];};
  for(const node of [...parent.childNodes]){
    if(!(node instanceof Element)){pending.push(node);continue;}
    if(ignored(node)||node.matches('.report-page-number,.proposal-cover-frame'))continue;
    if(node.matches('.proposal-final-toc li,.report-toc-entry')){
      await flush();previous=null;
      const children=node.matches('li')?[node.querySelector(':scope > b'),node.querySelector(':scope > span'),node.querySelector(':scope > i')]:[node.firstElementChild,node.querySelector('.report-toc-page')];
      if(children.some(e=>!e))throw Error('HWP 목차 제목·쪽번호를 확인하지 못했습니다.');
      const contents=await Promise.all(children.map(e=>paragraph(e!,[...e!.childNodes],0,0)));
      const rect=node.getBoundingClientRect(),scale=rect.width/(node as HTMLElement).offsetWidth||1;
      const boxes=children.map(e=>e!.getBoundingClientRect());
      const starts=boxes.map((box,i)=>i?(box.left-rect.left)/scale:0);
      const ends=boxes.map((_,i)=>i+1<boxes.length?starts[i+1]:rect.width/scale);
      const widths=starts.map((start,i)=>ends[i]-start);
      const padding=boxes.map((box,i)=>({left:(box.left-rect.left)/scale-starts[i],right:ends[i]-(box.right-rect.left)/scale,top:(box.top-rect.top)/scale,bottom:(rect.bottom-box.bottom)/scale}));
      if(widths.some(width=>width<=0)||padding.some(p=>Object.values(p).some(value=>value<-.1)))throw Error('HWP 목차 열 배치를 확인하지 못했습니다.');
      append(result,layoutRow(contents,widths,(node as HTMLElement).offsetHeight,padding));continue;
    }
    if(node instanceof HTMLTableElement){await flush();previous=null;append(result,await table(node));continue;}
    if(node instanceof HTMLImageElement){await flush();previous=null;append(result,await image(node));continue;}
    const css=style(node);
    if(['inline','inline-block','inline-flex'].includes(css.display)||node.tagName==='BR'){pending.push(node);continue;}
    await flush();
    if(/^(P|H[1-6]|PRE|FIGCAPTION)$/u.test(node.tagName)){
      const ordinary=node instanceof HTMLElement&&/^(P|H[1-6])$/u.test(node.tagName)&&!parent.closest('td,th,li')&&['block','flow-root'].includes(style(parent).display)&&css.display==='block'&&css.position==='static'&&css.cssFloat==='none'&&css.clear==='none'&&css.transform==='none'&&!node.querySelector('img,table,svg,canvas,iframe,video,audio,object,embed,input,textarea,button')&&px(css.marginTop)>=0&&px(css.marginBottom)>=0&&['top','bottom'].every(side=>px(css.getPropertyValue(`padding-${side}`))===0&&px(css.getPropertyValue(`border-${side}-width`))===0);
      // Bare zero-height paragraphs collapse through their neighbours in CSS;
      // creating a native line for them adds content height absent from the DOM.
      if(previous&&ordinary&&node.tagName==='P'&&!node.attributes.length&&!node.childNodes.length&&node.getBoundingClientRect().height===0&&['::before','::after'].every(side=>['none','normal','""',"''"].includes(node.ownerDocument.defaultView!.getComputedStyle(node,side).content)))continue;
      const content=await paragraph(node);
      if(previous&&ordinary){
        const scale=parent.getBoundingClientRect().width/(parent as HTMLElement).offsetWidth||1;
        const gap=(node.getBoundingClientRect().top-previous.getBoundingClientRect().bottom)/scale;
        // Resolve CSS sibling margin collapse, retaining paragraph()'s existing
        // half-leading transfer exactly once and leaving source nodes untouched.
        const difference=gap-px(style(previous).marginBottom)-px(css.marginTop);
        content.html=content.html.replace(/margin-top:([\d.]+)px/u,(_,value:string)=>{
          const before=Number(value)+difference;
          if(before<-.1)throw Error('HWP 문단의 겹친 간격을 보존하지 못했습니다.');
          return `margin-top:${Math.max(0,before)}px`;
        });
      }
      append(result,content);previous=ordinary&&content.text.trim()?node:null;
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
  const candidates=root.matches('[data-export-page]')?[root]:[...root.querySelectorAll<HTMLElement>('[data-export-page]')];
  const pages=candidates.filter(page=>!ignored(page)&&!page.parentElement?.closest('[data-export-page]'));
  const results:NativeHwpPage[]=[];
  for(const page of pages){
    const css=style(page),margins={top:px(css.paddingTop),right:px(css.paddingRight),bottom:px(css.paddingBottom),left:px(css.paddingLeft)};
    const rules:NonNullable<NativeHwpPage['rules']>=[],pageRect=page.getBoundingClientRect(),scale=pageRect.width/page.offsetWidth||1;
    const borderRule=(element:Element,side:'top'|'bottom')=>{
      const computed=style(element),height=px(computed.getPropertyValue(`border-${side}-width`));
      if(!height)return;
      const rect=element.getBoundingClientRect(),fill=color(computed.getPropertyValue(`border-${side}-color`));
      if(fill==='transparent')return;
      if(computed.getPropertyValue(`border-${side}-style`)!=='solid')throw Error('HWP 장식선 형식의 추가 검증이 필요합니다.');
      rules.push({left:(rect.left-pageRect.left)/scale,top:(rect[side==='top'?'top':'bottom']-pageRect.top)/scale-(side==='bottom'?height:0),width:rect.width/scale,height,colors:[fill]});
    };
    const body=empty();let footer:NativeHwpPage['footer'],paragraphInsets:NativeHwpPage['paragraphInsets'];
    const proposalCover=page.matches('.proposal-final-cover')&&page.querySelector(':scope > .proposal-cover-heading');
    const reportCover=page.matches('.report-final-cover')&&page.querySelector(':scope > .report-cover-heading');
    if(proposalCover||reportCover){
      paragraphInsets=[];
      const rect=page.getBoundingClientRect(),scale=rect.width/page.offsetWidth||1;let previous=rect.top+(margins.top+px(css.borderTopWidth))*scale;
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
    for(const element of page.querySelectorAll(':scope > ol > li, :scope > header'))borderRule(element,'bottom');
    const pageNumber=page.querySelector<HTMLElement>(':scope > .report-page-number');
    if(pageNumber&&!ignored(pageNumber))footer={...await paragraph(pageNumber),distance:px(style(pageNumber).bottom)};
    if(page.matches('.proposal-final-toc,.proposal-final-chapter')){
      const pseudo=page.ownerDocument.defaultView!.getComputedStyle(page,'::after');
      if(pseudo.content&&!['none','normal'].includes(pseudo.content)&&pseudo.display!=='none'){
        const text=[...pseudo.content.matchAll(/"([^"]*)"|'([^']*)'/gu)].map(m=>m[1]??m[2]).join('');
        if(!text)throw Error('HWP 하단 쪽번호를 확인하지 못했습니다.');
        footer={...empty(),html:`<p style="${escape(paragraphStyle(pseudo,0,0))}"><span style="${escape(fontStyle(pseudo))}">${escape(text)}</span></p>`,text,distance:px(pseudo.bottom)};
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
