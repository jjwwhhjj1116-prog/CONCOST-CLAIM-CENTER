import {zipSync} from 'fflate';
import type {NativeHwpEngine,NativeHwpPage} from './editable-hwp-export';
import {nativeAll as all,nativeDirect as direct,nativeParse as parse,nativeWrite as write,nativePaintGlyphs,type PaintReader} from './native-hwp-paragraph-advances';
import {nativeParagraphText} from './native-hwp-line-cache';

/** A native first-line clip can cut ink above its font baseline box. Extend
 * only that box and compensate the paper top, retaining every glyph origin. */
export function preserveNativeHeadingInk(files:Record<string,Uint8Array>,pages:NativeHwpPage[],Engine:NativeHwpEngine):void{
 if(!pages.some(p=>p.firstLineInkAscent!==undefined))return;
 const prepared=new Engine(zipSync(files));
 type Reader=PaintReader&{getLineInfo(section:number,paragraph:number,offset:number):string;getPageTextLayout(page:number):string};
 let saved:Reader;
 try{saved=new Engine(prepared.exportHwp()) as Reader;}finally{prepared.free();}
 try{
  if(saved.pageCount()!==pages.length)throw Error('HWP 제목의 실제 쪽수가 다릅니다.');
  const positions=nativePaintGlyphs(saved),header=parse(files['Contents/header.xml']);
  pages.forEach((page,sec)=>{
   if(page.firstLineInkAscent===undefined)return;
   const path=`Contents/section${sec}.xml`,xml=parse(files[path]),p=direct(xml.documentElement,'p')[0],margin=all(xml,'pagePr').flatMap(pr=>direct(pr,'margin'))[0];
   const properties=all(header,'paraPr').find(pr=>pr.getAttribute('id')===p.getAttribute('paraPrIDRef'))!,spacing=all(properties,'lineSpacing').at(-1)!;
   const baseline=positions.get(`section:${sec}/para:0`)?.get(0)?.y,top=Number(margin.getAttribute('top')),base=baseline===undefined?NaN:Math.round(baseline*75)-top;
   if(!Number.isFinite(base)||!Number.isFinite(page.firstLineInkAscent))throw Error('HWP 제목의 첫 기준선을 확인하지 못했습니다.');
   const extra=Math.max(0,Math.ceil((page.firstLineInkAscent+.04)*75)-base);if(!extra)return;
   if(extra>=top||spacing.getAttribute('type')!=='FIXED')throw Error('HWP 제목 잉크의 줄 간격을 보존할 수 없습니다.');
   const advance=Number(spacing.getAttribute('value'))/2;
   if(!Number.isSafeInteger(advance)||advance<=0||base<=0)throw Error('HWP 제목 줄 간격이 유효하지 않습니다.');
   const textOnly=p.cloneNode(true) as Element;for(const run of direct(textOnly,'run'))if([...run.children].some(c=>c.localName!=='t'))run.remove();
   const {text,offsets}=nativeParagraphText(textOnly),runs=JSON.parse(saved.getPageTextLayout(sec)).runs.filter((r:any)=>r.secIdx===sec&&r.paraIdx===0&&r.cellIdx===undefined);
   const starts:number[]=[],length=Array.from(text).length;for(let at=0;at<length;){const line=JSON.parse(saved.getLineInfo(sec,0,at));if(line.charStart!==at||!Number.isSafeInteger(line.charEnd)||line.charEnd<=at||line.charEnd>length)throw Error('HWP 제목의 실제 줄 순서를 확인하지 못했습니다.');starts.push(at);at=line.charEnd;}
   const cache=xml.createElementNS('http://www.hancom.co.kr/hwpml/2011/paragraph','hp:linesegarray');
   const controls=direct(p,'run').flatMap(run=>[...run.children]).filter(c=>c.localName==='ctrl').length*8;
   const left=Number(all(properties,'left').at(-1)?.getAttribute('value')??0)/2,right=Number(all(properties,'right').at(-1)?.getAttribute('value')??0)/2;
   const indent=Number(all(properties,'intent').at(-1)?.getAttribute('value')??0);if(indent)throw Error('HWP 제목 들여쓰기의 추가 검증이 필요합니다.');
   const width=Math.floor((Math.round(page.width*75)-Math.round(page.margins.left*75)-Math.round(page.margins.right*75))/4)*4-left-right;
   if(![left,right,width].every(Number.isSafeInteger)||left<0||right<0||width<=0)throw Error('HWP 제목의 줄 너비가 유효하지 않습니다.');
   const heightValues=runs.map((r:any)=>Math.round(r.fontSize*75));if(new Set(heightValues).size!==1)throw Error('HWP 혼합 크기 제목의 추가 검증이 필요합니다.');
   const original=positions.get(`section:${sec}/para:0`)!;page.firstParagraphPaint=[...original].map(([at,g])=>({at,...g}));
   starts.forEach((start,line)=>{
    const end=starts[line+1]??Array.from(text).length,height=Math.round(Math.max(...runs.filter((r:any)=>r.charStart<end&&r.charStart+Array.from(r.text).length>start).map((r:any)=>r.fontSize))*75);
    if(!Number.isFinite(height)||height<=0)throw Error('HWP 제목의 실제 글자 높이가 없습니다.');
    if(base>height||!Number.isSafeInteger(offsets[start]))throw Error('HWP 제목의 기준선·문자 위치가 유효하지 않습니다.');
    const glyph=original.get(start);if(!glyph||Math.abs(glyph.y-(top+base+line*advance)/75)>.02)throw Error('HWP 제목의 줄별 기준선이 다릅니다.');
    const segment=xml.createElementNS('http://www.hancom.co.kr/hwpml/2011/paragraph','hp:lineseg');
    const values={textpos:line?offsets[start]+controls:0,vertpos:line*advance+(line?extra:0),vertsize:height+(line?0:extra),textheight:height+(line?0:extra),baseline:base+(line?0:extra),spacing:advance-height,horzpos:left,horzsize:width,flags:393216};
    for(const [name,value]of Object.entries(values))segment.setAttribute(name,String(value));cache.append(segment);
   });
   for(const old of direct(p,'linesegarray'))old.remove();p.append(cache);margin.setAttribute('top',String(top-extra));page.margins.top=(top-extra)/75;files[path]=write(xml);
  });
 }finally{saved.free();}
}
