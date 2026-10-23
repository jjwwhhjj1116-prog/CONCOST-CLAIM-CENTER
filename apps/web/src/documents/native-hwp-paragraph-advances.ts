import {strFromU8,strToU8,zipSync} from 'fflate';
import type {NativeHwpDocument,NativeHwpEngine,NativeHwpLines,NativeHwpPage} from './editable-hwp-export';
import {nativeParagraphText} from './native-hwp-line-cache';

export const nativeAll=(e:Document|Element,name:string)=>[...e.getElementsByTagName('*')].filter(n=>n.localName===name);
export const nativeDirect=(e:Element,name:string)=>[...e.children].filter(n=>n.localName===name);
export const nativeParse=(b:Uint8Array)=>{
  const xml=new DOMParser().parseFromString(strFromU8(b),'application/xml');
  if(nativeAll(xml,'parsererror').length)throw Error('HWP 글자 배치 XML이 잘못됐습니다.');
  return xml;
};
export const nativeWrite=(d:Document)=>strToU8(new XMLSerializer().serializeToString(d));
export type PaintReader=NativeHwpDocument&{getPageLayerTreeWithProfile(page:number,profile:string,images:boolean,fonts:boolean):string;getPageControlLayout(page:number):string};
type Glyph={x:number;y:number;width:number;unsupported?:boolean};
const all=nativeAll,direct=nativeDirect,parse=nativeParse,write=nativeWrite;
const bodyTables=(xml:Document)=>all(xml,'tbl').filter(table=>{for(let p=table.parentElement;p;p=p.parentElement)if(['footer','header','tbl'].includes(p.localName))return false;return true;});

/** Read actual print clusters. Keys retain section, body/table/cell and scalar
 * offsets; textboxes, nested/vertical cells and non-translation transforms are
 * not silently treated as ordinary editable paragraphs. */
export function nativePaintGlyphs(document:PaintReader):Map<string,Map<number,Glyph>>{
  const result=new Map<string,Map<number,Glyph>>();
  // A section can span physical pages. Resolve its XML table order once,
  // including split-table fragments, rather than restarting on every page.
  const tableKeys=new Map<number,string[]>();
  for(let page=0;page<document.pageCount();page++)for(const c of JSON.parse(document.getPageControlLayout(page)).controls){
    if(c.type!=='table'||c.cellPath)continue;
    const key=`${c.paraIdx}:${c.controlIdx}`,keys=tableKeys.get(c.secIdx)??[];
    if(!keys.includes(key))keys.push(key);tableKeys.set(c.secIdx,keys);
  }
  for(const keys of tableKeys.values())keys.sort((a,b)=>{const x=a.split(':').map(Number),y=b.split(':').map(Number);return x[0]-y[0]||x[1]-y[1];});
  for(let page=0;page<document.pageCount();page++){
    const walk=(node:any)=>{
      if(node.type==='textRun'){
        const m=node.source?.stableSourceKey?.match(/^(section:(\d+)\/para:(\d+))\/char:(\d+)(?:\/cell:(\d+):(\d+):(\d+):(\d+):0)?$/u);
        if(m&&Number(m[3])<4294967295){
          let key=m[1];
          if(m[5]!==undefined){const index=tableKeys.get(Number(m[2]))?.indexOf(`${m[5]}:${m[6]}`)??-1;key=index<0?'':`section:${m[2]}/table:${index}/cell:${m[7]}/para:${m[8]}`;}
          const transform=node.placement?.runToPage;
          if(key&&transform&&transform.a===1&&transform.b===0&&transform.c===0&&transform.d===1){
            const chars=Array.from(node.text) as string[],offsets=[0],target=result.get(key)??new Map<number,Glyph>();result.set(key,target);
            for(const char of chars)offsets.push(offsets.at(-1)!+char.length);
            for(const cluster of node.clusters??[]){
              const index=offsets.indexOf(cluster.textRangeUtf16.start);if(index<0)continue;
              const value={x:transform.e+cluster.origin.x,y:transform.f+cluster.origin.y,width:cluster.advance.dx,unsupported:offsets[index+1]!==cluster.textRangeUtf16.end};
              if(![value.x,value.y,value.width].every(Number.isFinite))throw Error('HWP 출력 글자 좌표가 유효하지 않습니다.');
              const at=Number(m[4])+index;
              if(target.has(at))throw Error('HWP 출력 글자 위치가 중복되었습니다. '+JSON.stringify({page,key,at,old:target.get(at),value,source:node.source.stableSourceKey}));
              target.set(at,value);
            }
          }
        }
      }
      for(const child of node.children??[])walk(child);if(node.child)walk(node.child);for(const op of node.ops??[])walk(op);
    };
    walk(JSON.parse(document.getPageLayerTreeWithProfile(page,'print',true,true)).root);
  }
  return result;
}

type Target={sec:number;key:string;p:Element;source:NativeHwpLines;width:number;cell:boolean;cellElement?:Element;geometry?:{padding:Record<'left'|'right'|'top'|'bottom',number>}};
export function nativePaintTargets(xml:Document,page:NativeHwpPage,sec:number):Target[]{
  const ps=direct(xml.documentElement,'p'),result:Target[]=[];
  for(const source of page.flowLines??[])if(source.paint)result.push({sec,key:`section:${sec}/para:${source.paragraphIndex}`,p:ps[source.paragraphIndex],source,width:source.width,cell:false});
  if(!page.positioned)bodyTables(xml).forEach((table,ti)=>all(table,'tc').forEach((cell,ci)=>{
    const geometry=page.tableGeometry?.[ti]?.cells[ci],sources=geometry?.lines?.filter(l=>l.text.trim());if(!sources?.length||!sources.every(l=>l.paint&&['left','start','center','right','end'].includes(l.align??'')))return;
    const paragraphs=direct(direct(cell,'subList')[0],'p').map((p,index)=>({p,index})).filter(({p})=>nativeParagraphText(p).text.trim());
    if(sources.length!==paragraphs.length)throw Error('HWP 표 글자의 문단 대응이 다릅니다.');
    sources.forEach((source,i)=>{if(source.paint&&['left','start','center','right','end'].includes(source.align??''))result.push({sec,key:`section:${sec}/table:${ti}/cell:${ci}/para:${paragraphs[i].index}`,p:paragraphs[i].p,source,width:geometry!.width-geometry!.padding.left-geometry!.padding.right,cell:true,cellElement:cell,geometry});});
  }));
  for(const target of result)for(const origin of target.source.paint!.origins){
    if(!Number.isInteger(origin.at)||origin.at<0||![origin.x,origin.width,...(origin.y===undefined?[]:[origin.y])].every(Number.isFinite))throw Error('HWP 원고 글자 좌표가 유효하지 않습니다. '+target.key);
  }
  return result;
}
const targets=nativePaintTargets;
const hasPaint=(pages:NativeHwpPage[])=>pages.some(page=>page.flowLines?.some(line=>line.paint)||!page.positioned&&page.tableGeometry?.some(table=>table.cells.some(cell=>cell.lines?.some(line=>line.paint))));

/** Native body clips must include the authored font's ink overhang. Preserve
 * the effective paragraph frame when extending a page's horizontal margins. */
export function preserveNativeBodyInkWidth(files:Record<string,Uint8Array>,pages:NativeHwpPage[]):void{
  const header=parse(files['Contents/header.xml']);
  pages.forEach((page,sec)=>{
    const origins=(page.flowLines??[]).flatMap(line=>line.paint?.origins.filter(g=>Array.from(line.text)[g.at]?.trim())??[]),lefts=origins.map(g=>g.inkLeft).filter((v):v is number=>v!==undefined),rights=origins.map(g=>g.inkRight).filter((v):v is number=>v!==undefined);
    if(!lefts.length||!rights.length)return;
    const left=Math.max(0,Math.ceil((page.margins.left-Math.min(...lefts)+.55)*75));let right=Math.max(0,Math.ceil((Math.max(...rights)-(page.width-page.margins.right)+.55)*75));
    // Native body columns floor their width to four HU before subtracting
    // paragraph insets. Preserve that quantum to avoid rewrapping a cache.
    right+=Math.ceil((left+right)/4)*4-left-right;
    if(!left&&!right)return;
    if(left>=page.margins.left*75||right>=page.margins.right*75)throw Error('HWP 본문 잉크가 용지 밖입니다.');
    const path=`Contents/section${sec}.xml`,xml=parse(files[path]),margin=all(xml,'pagePr').flatMap(e=>direct(e,'margin'))[0];
    margin.setAttribute('left',String(Number(margin.getAttribute('left'))-left));margin.setAttribute('right',String(Number(margin.getAttribute('right'))-right));page.margins.left=Number(margin.getAttribute('left'))/75;page.margins.right=Number(margin.getAttribute('right'))/75;
    const ps=[...direct(xml.documentElement,'p'),...all(xml,'footer').flatMap(footer=>direct(footer,'subList').flatMap(sub=>direct(sub,'p'))),...all(xml,'header').flatMap(footer=>direct(footer,'subList').flatMap(sub=>direct(sub,'p')))];
    for(const p of ps){
      const para=clonePara(header,p);modifyMargin(para,'left',left/75);modifyMargin(para,'right',right/75);
      for(const cache of direct(p,'linesegarray'))for(const segment of [...cache.children])segment.setAttribute('horzpos',String(Number(segment.getAttribute('horzpos'))+left));
    }
    files[path]=write(xml);
  });
  files['Contents/header.xml']=write(header);
}

/** Read-only gate on the bytes actually returned for download, after shapes,
 * footers and the last HWP5 serialization have all been applied. */
export function verifyNativePaintPositions(document:NativeHwpDocument,pages:NativeHwpPage[],files:Record<string,Uint8Array>):void{
  if(!hasPaint(pages)&&!pages.some(p=>p.firstParagraphPaint))return;
  const positions=nativePaintGlyphs(document as PaintReader);
  pages.forEach((page,sec)=>{
    if(page.firstParagraphPaint){
      const actual=positions.get(`section:${sec}/para:0`);
      if(actual?.size!==page.firstParagraphPaint.length)throw Error('HWP 제목 글자 수가 변경됐습니다.');
      for(const wanted of page.firstParagraphPaint){const glyph=actual.get(wanted.at);if(!glyph||(['x','y','width'] as const).some(k=>Math.abs(wanted[k]-glyph[k])>.02))throw Error('HWP 제목 글자 위치가 변경됐습니다.');}
    }
    for(const target of targets(parse(files[`Contents/section${sec}.xml`]),page,sec)){
      // Recheck exact spaces and authored line breaks in the returned binary,
      // in addition to the document-wide semantic content check.
      textRuns(target);
      const actual=positions.get(target.key),chars=Array.from(target.source.text);
      for(const wanted of target.source.paint!.origins){
        if(!chars[wanted.at]?.trim())continue;
        const glyph=actual?.get(wanted.at);
        if(!glyph||glyph.unsupported||Math.abs(wanted.x-glyph.x)>(target.cell?.52:.51)||wanted.y!==undefined&&Math.abs(wanted.y-glyph.y)>.12)throw Error('최종 HWP 글자 위치가 현재 원고와 다릅니다. '+JSON.stringify({key:target.key,at:wanted.at,dx:glyph?glyph.x-wanted.x:null,dy:glyph&&wanted.y!==undefined?glyph.y-wanted.y:null}));
      }
    }
  });
}

/** Check the actual saved binary, then move text within existing cell padding.
 * Paired insets retain the inner size, row height, borders and editable cells. */
export function restoreNativeCellOrigins(files:Record<string,Uint8Array>,pages:NativeHwpPage[],Engine:NativeHwpEngine):void{
  if(!hasPaint(pages))return;
  for(let pass=0;pass<8;pass++){
    const prepared=new Engine(zipSync(files));let positions:ReturnType<typeof nativePaintGlyphs>;
    try{const saved=new Engine(prepared.exportHwp()) as PaintReader;try{positions=nativePaintGlyphs(saved);}finally{saved.free();}}finally{prepared.free();}
    let changed=false;const header=parse(files['Contents/header.xml']),styles=stylePool(header);
    pages.forEach((page,sec)=>{
      const path=`Contents/section${sec}.xml`,xml=parse(files[path]),cells=new Map<Element,{target:Target;dx:number[]}>();
      for(const target of targets(xml,page,sec)){
        const actual=positions.get(target.key),chars=Array.from(target.source.text),dx:number[]=[],dy:number[]=[];
        for(const wanted of target.source.paint!.origins){
          if(!chars[wanted.at]?.trim())continue;
          const glyph=actual?.get(wanted.at);if(!glyph||glyph.unsupported)throw Error('HWP 저장 후 글자 대응이 다릅니다.');
          dx.push(wanted.x-glyph.x);
          const y=wanted.y;if(y!==undefined)dy.push(y-glyph.y);
        }
        if(!target.cell&&dx.some(x=>Math.abs(x)>.51))throw Error('HWP 저장 후 본문 글자 위치가 다릅니다. '+JSON.stringify({key:target.key,min:Math.min(...dx),max:Math.max(...dx)}));
        const segments=direct(target.p,'linesegarray').flatMap(c=>[...c.children]);
        if(dy.some(v=>Math.abs(v)>.12)){
          if(pass===7)throw Error('HWP 저장 후 셀 기준선이 다릅니다.');
          target.source.starts.forEach((start,line)=>{
            const wanted=target.source.paint!.origins.find(g=>g.at>=start&&g.at<(target.source.starts[line+1]??Infinity)&&chars[g.at]?.trim()&&g.y!==undefined);if(!wanted)return;
            const glyph=actual?.get(wanted.at),segment=segments[line];if(!glyph||!segment)throw Error('HWP 셀의 줄 기준선이 없습니다.');
            const value=Number(segment.getAttribute('baseline'))+Math.round((wanted.y!-glyph.y)*75),height=Number(segment.getAttribute('vertsize'));
            if(value<=0||value>=height)throw Error('HWP 셀 기준선이 줄 상자 밖입니다. '+JSON.stringify({key:target.key,line,value,height}));
            segment.setAttribute('baseline',String(value));
          });changed=true;
        }
        if(target.cell){const group=cells.get(target.cellElement!)??{target,dx:[]};group.dx.push(...dx);cells.set(target.cellElement!,group);}
      }
      for(const {target,dx}of cells.values()){
        const center=(values:number[])=>values.length?(Math.min(...values)+Math.max(...values))/2:0;
        const x=center(dx),xSpan=dx.length?Math.max(...dx)-Math.min(...dx):0;
        if(dx.every(v=>Math.abs(v)<=.52))continue;
        if(pass===7)throw Error('HWP 저장 후 셀 글자 위치를 보존하지 못했습니다. '+JSON.stringify({key:target.key,xSpan,x,min:Math.min(...dx),max:Math.max(...dx)}));
        // Half a pixel of native run rounding plus one HU for cell padding.
        if(xSpan>1.026666){
          for(const paragraph of targets(xml,page,sec).filter(p=>p.cellElement===target.cellElement))refineCellAdvances(paragraph,positions.get(paragraph.key)!,styles);
          changed=true;continue;
        }
        const padding=target.geometry!.padding,margin=direct(target.cellElement!,'cellMargin')[0];
        for(const [side,delta]of [['left',x],['right',-x]]as const){
          const value=Math.round((padding[side]+delta)*75);if(value<0)throw Error('HWP 셀 글자의 보정이 테두리를 넘습니다.');
          margin.setAttribute(side,String(value));padding[side]=value/75;
        }
        changed=true;
      }
      files[path]=write(xml);
    });
    files['Contents/header.xml']=write(header);
    if(!changed)return;
  }
}

/** Cell alignment is resolved from native line widths. Recalibrate advances
 * from the saved line origin, retaining the existing paragraph and line breaks. */
function refineCellAdvances(target:Target,actual:Map<number,Glyph>,styles:ReturnType<typeof stylePool>):void{
 const desired=new Map(target.source.paint!.origins.map(o=>[o.at,o])),starts=new Set(target.source.starts),chars=Array.from(target.source.text);
 const plans=target.source.starts.map((start,line)=>{
  const end=target.source.starts[line+1]??chars.length,first=actual.get(start);if(!first)throw Error('HWP 셀 줄의 첫 글자가 없습니다.');
  const last=Array.from({length:end-start},(_,i)=>end-i-1).find(i=>chars[i]!=='\n'&&desired.has(i)&&(actual.get(i)?.width??0)>0)!;
  const width=Array.from({length:end-start},(_,i)=>actual.get(start+i)).reduce((sum,g)=>sum+Math.round(g?.width??0),0),align=target.source.align;
  const step=align==='center'?.5:['right','end'].includes(align??'')?1:0,wanted=desired.get(start)?.x??first.x,shift=step?Math.round((wanted-first.x)/step)*step:0;
  return{start,last,x:first.x+shift,width:width-(step?shift/step:0)};
 });
 let at=0,x=0,plan=plans[0],previous:string|undefined;
 for(const run of textRuns(target)){
  const def=styles.defs.find(d=>d.getAttribute('id')===run.getAttribute('charPrIDRef'))!;
  const values=[...all(def,'spacing')[0].attributes].map(a=>Number(a.value)),old=values[0];if(values.some(v=>v!==old))throw Error('HWP 셀 언어별 자간이 다릅니다.');
  const output:Element[]=[];
  for(const char of Array.from(nativeParagraphText(run).text)){
   const pos=at++,metric=actual.get(pos),want=desired.get(pos);if(starts.has(pos)){plan=plans.find(p=>p.start===pos)!;x=plan.x;}
   if(char==='\n'){output.push(characterRun(run,run.getAttribute('charPrIDRef')!,char));continue;}
   if(!metric||!Number.isFinite(x))throw Error('HWP 셀 줄의 실제 시작점이 없습니다. '+target.key);
   let value=old;
   if(want&&metric.width>0){
    // Keep the native total line width: changing the last character's
    // trailing advance retains CENTER/RIGHT origins without moving its ink.
    const next=desired.get(pos+1),end=pos===plan.last?plan.x+plan.width:next&&!starts.has(pos+1)?next.x:want.x+want.width,base=metric.width/(1+old/100);
    let best:{value:number;advance:number;score:number}|undefined;
    for(let candidate=-50;candidate<=50;candidate++){
     const raw=base*(1+candidate/100),advance=Math.round(raw),score=Math.abs(x+advance-end)*1000+Math.abs(raw-advance);
     if(advance>0&&(!best||score<best.score))best={value:candidate,advance,score};
    }
    if(!best)throw Error('HWP 셀 자간을 보존할 수 없습니다.');value=best.value;x+=best.advance;
   }else x+=Math.round(metric.width);
   const id=styles.id(def,value-old,previous);previous=id;output.push(characterRun(run,id,char));
  }
  run.replaceWith(...output);
 }
}
function textRuns(target:Target):Element[]{
  if(!target.p)throw Error('HWP 글자 배치의 문단이 없습니다.');
  const runs=direct(target.p,'run').filter(r=>[...r.children].every(c=>c.localName==='t'));
  if(runs.some(r=>[...r.children].some(t=>[...t.children].some(c=>c.localName!=='lineBreak')))||runs.map(r=>nativeParagraphText(r).text).join('')!==target.source.text)throw Error('HWP 글자 배치의 원문·제어문자가 다릅니다.');
  return runs;
}
function clonePara(header:Document,p:Element):Element{
  const properties=all(header,'paraPr'),source=properties.find(d=>d.getAttribute('id')===p.getAttribute('paraPrIDRef'));
  if(!source?.parentElement)throw Error('HWP 글자 배치의 문단 서식이 없습니다.');
  const copy=source.cloneNode(true) as Element,id=String(Math.max(...properties.map(d=>Number(d.getAttribute('id'))))+1);
  copy.setAttribute('id',id);source.parentElement.append(copy);source.parentElement.setAttribute('itemCnt',String(properties.length+1));p.setAttribute('paraPrIDRef',id);return copy;
}
function modifyMargin(para:Element,side:'left'|'right',delta:number){
  for(const margin of all(para,side)){
    let ancestor=margin.parentElement,inCase=false;while(ancestor&&ancestor!==para){if(ancestor.localName==='case')inCase=true;ancestor=ancestor.parentElement;}
    margin.setAttribute('value',String(Number(margin.getAttribute('value'))+Math.round(delta*75)*(inCase?1:2)));
  }
}
function setMargin(para:Element,side:'left'|'right'|'indent',pixels:number){
  for(const margin of all(para,side==='indent'?'intent':side)){
    let ancestor=margin.parentElement,inCase=false;while(ancestor&&ancestor!==para){if(ancestor.localName==='case')inCase=true;ancestor=ancestor.parentElement;}
    margin.setAttribute('value',String(Math.round(pixels*75)*(inCase?1:2)));
  }
}
/** At most two equivalent IDs per style keep adjacent native run boundaries
 * (native origins round per run), without one full style definition per glyph. */
function stylePool(header:Document){
  const defs=all(header,'charPr'),container=defs[0]?.parentElement;
  if(!container)throw Error('HWP 글자 서식이 없습니다.');
  let next=Math.max(...defs.map(d=>Number(d.getAttribute('id'))))+1;
  const variants=new Map<string,string[]>();
  return{defs,id(def:Element,delta:number,previous?:string,spaceRatio?:number,collapsed=false){
    const key=def.getAttribute('id')+':'+delta+':'+spaceRatio+':'+collapsed,ids=variants.get(key)??[];
    const cached=ids.find(id=>id!==previous);if(cached)return cached;
    const copy=def.cloneNode(true) as Element,id=String(next++);copy.setAttribute('id',id);
    for(const spacing of all(copy,'spacing'))for(const attr of [...spacing.attributes]){
      const value=Number(attr.value)+delta;if(!Number.isInteger(value)||value< -50||value>50)throw Error('HWP 언어별 글자 간격이 표준 범위를 벗어납니다.');spacing.setAttribute(attr.name,String(value));
    }
    if(spaceRatio!==undefined){
      if(!Number.isInteger(spaceRatio)||spaceRatio<50||spaceRatio>200)throw Error('HWP 공백 폭이 표준 범위를 벗어납니다.');
      for(const ratio of all(copy,'ratio'))for(const attr of [...ratio.attributes])ratio.setAttribute(attr.name,String(spaceRatio));
    }
    if(collapsed)copy.setAttribute('height','1');
    container.append(copy);ids.push(id);variants.set(key,ids);container.setAttribute('itemCnt',String(all(header,'charPr').length));return id;
  }};
}
function characterRun(run:Element,id:string,char:string):Element{
  const copy=run.cloneNode(false) as Element;copy.setAttribute('charPrIDRef',id);
  const text=run.ownerDocument.createElementNS('http://www.hancom.co.kr/hwpml/2011/paragraph','hp:t');
  if(char==='\n')text.append(run.ownerDocument.createElementNS('http://www.hancom.co.kr/hwpml/2011/paragraph','hp:lineBreak'));else text.textContent=char;copy.append(text);return copy;
}

/** Match measured web glyph advances using standard HWP integer-percent
 * spacing. Probe only a disposable, wider paragraph to avoid native overflow
 * compression contaminating font metrics; final geometry stays bounded. */
export function restoreNativeParagraphAdvances(files:Record<string,Uint8Array>,pages:NativeHwpPage[],Engine:NativeHwpEngine):void{
  const probe={...files},probeHeader=parse(files['Contents/header.xml']),probeStyles=stylePool(probeHeader);let count=0;
  pages.forEach((page,sec)=>{
    const path=`Contents/section${sec}.xml`,xml=parse(probe[path]);
    // This detached XML is written only to `probe[path]` below. Native cell
    // layout clamps negative paragraph margins, so use roomy probe columns
    // to obtain natural glyph metrics without overflow compression.
    for(const table of bodyTables(xml)){
      const column=1000000,count=Number(table.getAttribute('colCnt'));
      direct(table,'sz')[0]?.setAttribute('width',String(column*count));
      for(const cell of all(table,'tc')){
        const span=Number(direct(cell,'cellSpan')[0]?.getAttribute('colSpan')??1);
        direct(cell,'cellSz')[0]?.setAttribute('width',String(column*span));
      }
    }
    for(const target of targets(xml,page,sec)){
      count++;const para=clonePara(probeHeader,target.p);for(const align of all(para,'align'))align.setAttribute('horizontal','LEFT');
      modifyMargin(para,'right',-Math.max(1000,Array.from(target.source.text).length*(target.source.fontSize??16)*3));
      for(const cache of direct(target.p,'linesegarray'))cache.remove();
      let previous:string|undefined;
      for(const run of textRuns(target)){
        const def=probeStyles.defs.find(d=>d.getAttribute('id')===run.getAttribute('charPrIDRef'));if(!def)throw Error('HWP 글꼴 참조가 없습니다.');
        run.replaceWith(...Array.from(nativeParagraphText(run).text).map(char=>{const id=probeStyles.id(def,0,previous);previous=id;return characterRun(run,id,char);}));
      }
    }
    probe[path]=write(xml);
  });
  if(!count)return;
  probe['Contents/header.xml']=write(probeHeader);
  const native=new Engine(zipSync(probe)) as PaintReader;let metrics:ReturnType<typeof nativePaintGlyphs>;
  try{metrics=nativePaintGlyphs(native);}finally{native.free();}
  const header=parse(files['Contents/header.xml']),styles=stylePool(header);
  pages.forEach((page,sec)=>{
    const path=`Contents/section${sec}.xml`,xml=parse(files[path]),cellExpansion=new Map<Element,{target:Target;reserve:number}>();
    for(const target of targets(xml,page,sec)){
      const {source}=target,desired=new Map(source.paint!.origins.map(o=>[o.at,o])),actual=metrics.get(target.key),starts=new Set(source.starts);
      const prefix=source.markerLength??0,prefixWidth=Array.from({length:prefix},(_,i)=>Math.round(actual?.get(i)?.width??NaN)).reduce((a,b)=>a+b,0);
      if(!Number.isFinite(prefixWidth))throw Error('HWP 목록 번호의 글자 폭이 없습니다.');
      const firstOrigin=(start:number,line:number)=>source.paint!.origins.find(o=>o.at>=start&&o.at<(source.starts[line+1]??Infinity));
      const lineOrigins=source.starts.map((start,line)=>{const origin=firstOrigin(start,line);if(!origin)throw Error('HWP 본문 줄의 시작 위치가 없습니다.');return origin.x-(line===0?prefixWidth:0);});
      if(!target.cell){
        const first=lineOrigins[0],following=lineOrigins[1]??(prefix?first+prefixWidth:first),left=Math.min(first,following)-page.margins.left,indent=first-following;
        if(left<-.02||lineOrigins.slice(1).some(x=>Math.abs(x-following)>.51))throw Error('HWP 본문 들여쓰기 위치가 현재 줄과 다릅니다.');
        const para=clonePara(header,target.p);setMargin(para,'left',Math.max(0,left));setMargin(para,'indent',indent);
        const right=page.width-page.margins.left-page.margins.right-(following-page.margins.left)-target.width;
        setMargin(para,'right',right);
        const frameWidth=Math.floor((Math.round(page.width*75)-Math.round(page.margins.left*75)-Math.round(page.margins.right*75))/4)*4,leftHu=Math.round(Math.max(0,left)*75),indentHu=Math.round(indent*75);
        direct(target.p,'linesegarray').flatMap(cache=>[...cache.children]).forEach((segment,line)=>{
          const lineIndent=line===0?Math.max(0,indentHu):Math.max(0,-indentHu),start=leftHu+lineIndent;
          segment.setAttribute('horzpos',String(start));segment.setAttribute('horzsize',String(frameWidth-start-Math.round(right*75)));
          const flags=Number(segment.getAttribute('flags'));segment.setAttribute('flags',String(lineIndent?flags|1048576:flags&~1048576));
        });
      }
      let at=0,x=0,lineX=0,lineIndex=0,maxAdvance=0,natural=0,maxNatural=0,previous:string|undefined;
      for(const run of textRuns(target)){
        const def=styles.defs.find(d=>d.getAttribute('id')===run.getAttribute('charPrIDRef'));if(!def)throw Error('HWP 글꼴 참조가 없습니다.');
        const spacing=all(def,'spacing')[0],values=[...spacing?.attributes??[]].map(a=>Number(a.value)),old=values[0];
        if(!values.length||!Number.isFinite(old)||values.some(v=>v!==old))throw Error('HWP 언어별 글자 간격의 기준이 다릅니다.');
        const output:Element[]=[];
        for(const char of Array.from(nativeParagraphText(run).text)){
          const pos=at++,want=desired.get(pos),metric=actual?.get(pos);let value=old,spaceRatio:number|undefined;
          if(starts.has(pos)){maxAdvance=Math.max(maxAdvance,x-lineX-(lineIndex===0?prefixWidth:0));maxNatural=Math.max(maxNatural,natural);natural=0;lineIndex=source.starts.indexOf(pos);x=lineOrigins[lineIndex];lineX=x;}
          if(char==='\n'){output.push(characterRun(run,run.getAttribute('charPrIDRef')!,char));continue;}
          if(!metric||metric.unsupported||metric.width<=0)throw Error('HWP 글자의 실제 측정값이 없습니다.');
          if(pos<prefix){x+=Math.round(metric.width);natural+=Math.round(metric.width/(1+old/100));}
          else if(char===' '){
            // CSS collapses wrap-end spaces; native cells otherwise include
            // their full advance in CENTER/RIGHT alignment. Only invisible
            // spaces use width ratio, retaining their editable characters.
            const ratios=[...all(def,'ratio')[0].attributes].map(a=>Number(a.value)),ratio=ratios[0];
            if(ratios.some(r=>r!==ratio)||!ratio)throw Error('HWP 공백 장평의 기준이 다릅니다.');
            const next=desired.get(pos+1),width=want?(next&&!starts.has(pos+1)?next.x-want.x:want.width):0,base=metric.width/(1+old/100)/ratio;
            let best:{ratio:number;advance:number;score:number}|undefined;
            for(let candidate=50;candidate<=200;candidate++){
              const raw=base*candidate,advance=Math.round(raw),score=Math.abs(x+advance-(want?.x??x)-width)*1000+Math.abs(raw-width);
              if(!best||score<best.score)best={ratio:candidate,advance,score};
            }
            spaceRatio=want?best!.ratio:50;value=0;x+=want?best!.advance:0;natural+=want?best!.advance:0;
          }else if(want){
            const next=desired.get(pos+1),width=next&&!starts.has(pos+1)?next.x-want.x:want.width,base=metric.width/(1+old/100);let best:{value:number;advance:number;score:number}|undefined;
            if(!Number.isFinite(base)||base<=0||!Number.isFinite(width)||width<=0)throw Error('HWP 글자의 측정 폭이 잘못됐습니다.');
            for(let candidate=-50;candidate<=50;candidate++){
              const raw=base*(1+candidate/100),advance=Math.round(raw),score=Math.abs(x+advance-want.x-width)*1000+Math.abs(raw-advance);
              if(advance>0&&(!best||score<best.score))best={value:candidate,advance,score};
            }
            if(!best||Math.abs(x-want.x)>.51)throw Error('HWP 글자 위치의 보정 범위를 벗어났습니다.');
            value=best.value;x+=best.advance;natural+=Math.round(base);
          }else{
            if(char.trim())throw Error('HWP 현재 글자의 웹 위치가 없습니다.');
            x+=Math.round(metric.width);natural+=Math.round(metric.width/(1+old/100));
          }
          const id=styles.id(def,value-old,previous,spaceRatio,char===' '&&!want&&pos>=prefix);previous=id;output.push(characterRun(run,id,char));
        }
        run.replaceWith(...output);
      }
      maxAdvance=Math.max(maxAdvance,x-lineX-(lineIndex===0?prefixWidth:0));maxNatural=Math.max(maxNatural,natural);
      // CENTER/RIGHT native cells expand negative-tracked lines when their
      // untracked width exceeds the frame. Reserve measured natural width so
      // that heuristic cannot change the explicitly reviewed glyph advances.
      const reserve=Math.max(0,(target.cell?(Math.ceil(Math.max(maxAdvance,maxNatural)*75)+2)/75:maxAdvance)-target.width);
      if(reserve){
        const overhang=Math.max(0,...source.widths??[])-target.width,spaces=Math.max(0,...source.starts.map((start,i)=>{const end=source.starts[i+1]??Array.from(source.text).length;let width=0;for(let pos=end-1;pos>=start&&!desired.has(pos);pos--)width+=Math.round(actual!.get(pos)?.width??0);return width;}));
        if(!target.cell&&reserve>Math.max(0,overhang)+spaces+1)throw Error('HWP 글자 위치가 현재 줄 범위를 벗어납니다.');
        if(target.cell){const old=cellExpansion.get(target.cellElement!);if(!old||old.reserve<reserve)cellExpansion.set(target.cellElement!,{target,reserve});}
        else modifyMargin(clonePara(header,target.p),'right',-reserve);
        for(const cache of direct(target.p,'linesegarray'))for(const line of [...cache.children])line.setAttribute('horzsize',String(Number(line.getAttribute('horzsize'))+Math.ceil(reserve*75)));
      }
    }
    for(const {target,reserve}of cellExpansion.values()){
      const padding=target.geometry!.padding,margin=direct(target.cellElement!,'cellMargin')[0],align=target.source.align;
      const left=align==='center'?reserve/2:['right','end'].includes(align??'')?reserve:0;
      for(const [side,amount]of [['left',left],['right',reserve-left]]as const){
        const value=Math.round((padding[side]-amount)*75);if(value<0)throw Error('HWP 셀 글자가 테두리 밖입니다.');
        margin.setAttribute(side,String(value));padding[side]=value/75;
      }
    }
    files[path]=write(xml);
  });
  files['Contents/header.xml']=write(header);
}
