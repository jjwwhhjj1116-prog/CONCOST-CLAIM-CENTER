import {zipSync} from 'fflate';
import type {NativeHwpEngine,NativeHwpPage} from './editable-hwp-export';
import {nativeAll as all,nativeDirect as direct,nativeParse as parse,nativeWrite as write,nativePaintGlyphs as glyphs,preserveNativeBodyInkWidth,restoreNativeParagraphAdvances,restoreNativeCellOrigins,type PaintReader} from './native-hwp-paragraph-advances';

/** Calibrate fresh editable paragraphs against the reviewed DOM. Each pass
 * reads the actual serialized HWP, because its first-line cache can differ
 * from HWPX. Preserve footer/paper geometry and reject overlapping margins. */
export function restoreNativeFlowAdvances(files:Record<string,Uint8Array>,pages:NativeHwpPage[],Engine:NativeHwpEngine):void{
 preserveNativeBodyInkWidth(files,pages);
 restoreNativeParagraphAdvances(files,pages,Engine);
 if(!pages.some(p=>p.flowAnchors?.length||p.flowObjects?.length)){restoreNativeCellOrigins(files,pages,Engine);return;}
 const normalizedHeader=parse(files['Contents/header.xml']);
 pages.forEach((page,sec)=>{
  const path=`Contents/section${sec}.xml`,xml=parse(files[path]),paragraphs=direct(xml.documentElement,'p');
  const ordered=[...(page.flowAnchors??[]).map(a=>({...a,object:false})),...(page.flowObjects??[]).map(a=>({...a,baseline:a.top,object:true}))].sort((a,b)=>a.paragraphIndex-b.paragraphIndex);
  if(ordered[0]?.paragraphIndex===0){
   const first=ordered[0],segment=direct(paragraphs[0],'linesegarray').flatMap(c=>[...c.children])[0];
   if(segment){
    let top=Math.round((first.baseline-(first.object?0:Number(segment.getAttribute('baseline'))/75))*75);
    const source=page.flowLines?.find(line=>line.paragraphIndex===0),ink=source?.paint?.origins.filter(g=>g.at<(source.starts[1]??Infinity)&&Array.from(source.text)[g.at]?.trim()).map(g=>g.inkTop).filter((v):v is number=>v!==undefined);
    if(!first.object&&ink?.length){
     const extra=Math.max(0,top-Math.floor((Math.min(...ink)-.04)*75));
     for(const key of ['baseline','vertsize','textheight'])segment.setAttribute(key,String(Number(segment.getAttribute(key))+extra));
     top-=extra;
    }
    if(top<0)throw Error('HWP 첫 줄 잉크가 용지 밖입니다.');
    all(xml,'pagePr').flatMap(e=>direct(e,'margin'))[0].setAttribute('top',String(top));page.margins.top=top/75;
   }
  }
  for(const anchor of ordered){
   const p=paragraphs[anchor.paragraphIndex],segments=direct(p,'linesegarray').flatMap(c=>[...c.children]),source=page.flowLines?.find(line=>line.paragraphIndex===anchor.paragraphIndex);
   if(anchor.object){
    const table=all(p,'tbl')[0],size=table&&direct(table,'sz')[0],segment=segments[0];
    if(segment&&size){const height=Number(size.getAttribute('height'));for(const key of ['vertsize','textheight','baseline'])segment.setAttribute(key,String(height));segment.setAttribute('spacing','0');segment.setAttribute('vertpos',String(Math.round((anchor.baseline-page.margins.top)*75)));}
   }else if(source){
    segments.forEach((segment,line)=>{const start=source.starts[line],origin=source.paint?.origins.find(g=>g.at>=start&&g.at<(source.starts[line+1]??Infinity)&&Array.from(source.text)[g.at]?.trim());const y=origin?.y??anchor.baseline+line*source.lineHeight;segment.setAttribute('vertpos',String(Math.round((y-page.margins.top)*75)-Number(segment.getAttribute('baseline'))));});
   }
  }
  for(const index of new Set([...(page.flowAnchors??[]),...(page.flowObjects??[])].map(a=>a.paragraphIndex))){
   const p=paragraphs[index],props=all(normalizedHeader,'paraPr'),def=props.find(d=>d.getAttribute('id')===p.getAttribute('paraPrIDRef'))!;
   const clone=def.cloneNode(true) as Element,id=String(Math.max(...props.map(d=>Number(d.getAttribute('id'))))+1);clone.setAttribute('id',id);
   for(const margin of [...all(clone,'prev'),...all(clone,'next')])margin.setAttribute('value','0');
   def.parentElement!.append(clone);def.parentElement!.setAttribute('itemCnt',String(props.length+1));p.setAttribute('paraPrIDRef',id);
  }
  files[path]=write(xml);
 });
 files['Contents/header.xml']=write(normalizedHeader);
 for(let pass=0;pass<24;pass++){
 const positioned=new Engine(zipSync(files)) as PaintReader;let positions:ReturnType<typeof glyphs>;const objects=new Map<string,number>();
 try{const saved=new Engine(positioned.exportHwp()) as PaintReader;try{positions=glyphs(saved);for(let page=0;page<saved.pageCount();page++)for(const c of JSON.parse(saved.getPageControlLayout(page)).controls)if(c.type==='table'&&!c.cellPath)objects.set(`section:${c.secIdx}/para:${c.paraIdx}`,c.y);}finally{saved.free();}}finally{positioned.free();}
 const targets=pages.map(page=>[...(page.flowAnchors??[]).map(a=>({...a,object:false})),...(page.flowObjects??[]).map(a=>({...a,baseline:a.top,object:true}))].sort((a,b)=>a.paragraphIndex-b.paragraphIndex));
 const origin=(sec:number,anchor:{paragraphIndex:number;object:boolean;baseline:number})=>{
  const key=`section:${sec}/para:${anchor.paragraphIndex}`,value=anchor.object?objects.get(key):positions.get(key)?.values().next().value?.y;
  if(!Number.isFinite(anchor.baseline)||!Number.isFinite(value))throw Error('HWP 본문 기준선이 유효하지 않습니다. '+key);
  return value!;
 };
 const error=Math.max(0,...targets.flatMap((anchors,sec)=>anchors.map(anchor=>Math.abs(anchor.baseline-(origin(sec,anchor)??NaN)))));
 if(error<=.1){restoreNativeCellOrigins(files,pages,Engine);return;}
 if(pass===23)throw Error('HWP 저장 후 본문 세로 위치가 다릅니다. '+error);
 const yHeader=parse(files['Contents/header.xml']);
 pages.forEach((page,sec)=>{
  const path=`Contents/section${sec}.xml`,xml=parse(files[path]),paragraphs=direct(xml.documentElement,'p');
  // Sections are independent. Within a section remeasure the saved file
  // after its first unresolved anchor, rather than assuming linear flow.
  const pending=targets[sec].find(anchor=>Math.abs(anchor.baseline-(origin(sec,anchor)??NaN))>.1);
  for(const anchor of pending?[pending]:[]){
   const actual=origin(sec,anchor);
   if(actual===undefined)throw Error('HWP 본문 첫 글자의 기준선이 없습니다.');
   const p=paragraphs[anchor.paragraphIndex],props=all(yHeader,'paraPr'),def=props.find(d=>d.getAttribute('id')===p.getAttribute('paraPrIDRef'))!;
   const delta=anchor.baseline-actual,change=delta;
   const segments=direct(p,'linesegarray').flatMap(cache=>[...cache.children]);
   const followsTable=anchor.paragraphIndex>0&&all(paragraphs[anchor.paragraphIndex-1],'tbl').length>0;
   if(anchor.paragraphIndex>0&&segments.length&&!followsTable&&!anchor.object){
    if(Math.abs(delta)>.1)for(const segment of segments){
     const value=Number(segment.getAttribute('vertpos'))+Math.round(delta*75);
     if(value<0)throw Error('HWP 본문 줄이 용지 위로 이동합니다.');
     segment.setAttribute('vertpos',String(value));
    }
    continue;
   }
   if(Math.abs(change)<=.1)continue;
   if(anchor.paragraphIndex===0){
    const margin=all(xml,'pagePr').flatMap(e=>direct(e,'margin'))[0];
    if(!margin)throw Error('HWP 첫 문단의 용지 여백이 없습니다.');
    const value=Number(margin.getAttribute('top'))+Math.round(change*75);
    if(value<0||value/75+page.margins.bottom>=page.height)throw Error('HWP 첫 문단이 용지 밖입니다.');
    margin.setAttribute('top',String(value));page.margins.top=value/75;
    continue;
   }
   const clone=def.cloneNode(true) as Element,id=String(Math.max(...props.map(d=>Number(d.getAttribute('id'))))+1);clone.setAttribute('id',id);
   for(const prev of all(clone,'prev')){
    let ancestor=prev.parentElement,inCase=false;while(ancestor&&ancestor!==clone){if(ancestor.localName==='case')inCase=true;ancestor=ancestor.parentElement;}
    const factor=inCase?75:150,value=Number(prev.getAttribute('value'))+Math.round(change*75)*(factor/75);
    if(value<0)throw Error('HWP 본문 문단 간격이 겹칩니다. '+JSON.stringify({sec,para:anchor.paragraphIndex,change,value}));
    prev.setAttribute('value',String(value));
   }
   def.parentElement!.append(clone);def.parentElement!.setAttribute('itemCnt',String(props.length+1));p.setAttribute('paraPrIDRef',id);
  }
  files[path]=write(xml);
 });
 files['Contents/header.xml']=write(yHeader);
 }
}
