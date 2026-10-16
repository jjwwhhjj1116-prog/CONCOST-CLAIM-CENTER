import type { JSONContent } from '@tiptap/core';
import { unzipSync, strFromU8 } from 'fflate';
import { loadNativeHwpEngine } from './native-hwp-runtime';
import { assertReportNativeImportContainer } from './report-native-source';
import { alignImportedHwpPages, measureImportedHwpOffsets } from './hwp-import-alignment';
import { prepareDocumentExportFonts, resolveDocumentExportFontFamily } from './document-export-fonts';
import {resolveNativeHwpGlyphs} from './native-hwp-glyphs';
import {hwpAdvanceMetric} from './hwp-import-nodes';
import './hwp-import.css';

// Read meaning from HWPX and page placement from the same pinned document.
type Box={x:number;y:number;w:number;h:number};
type CellPath=Array<{controlIndex:number;cellIndex:number;cellParaIndex:number}>;
type Run=Box&{baseline?:number;text:string;secIdx:number;paraIdx:number;charStart:number;charX:number[];fontFamily:string;nativeFontFamily?:string;fontSize:number;bold:boolean;italic:boolean;underline:boolean;strikethrough:boolean;textColor:string;ratio:number;letterSpacing:number;charShapeId?:number;cellPath?:CellPath;parentParaIdx?:number};
type Control=Box&{type:string;wrap?:string;secIdx:number;paraIdx:number;controlIdx:number;cellPath?:CellPath;cells?:Array<Box&{row:number;col:number;rowSpan:number;colSpan:number}>};
type Info={width:number;height:number;sectionIndex:number;bodyLeft:number;bodyRight:number;columns:unknown[]};
type Reader={pageCount():number;free():void;renderPageSvgWithProfile(p:number,profile:string):string;getPageInfo(p:number):string;getPageTextLayout(p:number):string;getPageControlLayout(p:number):string;getPageOfPosition(s:number,p:number):string;exportHwpxWithReport():{contentLoss():string;takeBytes():Uint8Array;free():void}};
const children=(e:Element,name?:string)=>Array.from(e.children).filter(x=>!name||x.localName===name);
const all=(e:Element|Document,name:string)=>Array.from(e.getElementsByTagName('*')).filter(x=>x.localName===name);
const one=(e:Element|Document,name:string)=>all(e,name)[0];
const attr=(e:Element|undefined,k:string)=>e?.getAttribute(k)??'';
const fail=(why:string):never=>{throw new Error(`HWP 편집 가능한 가져오기를 중단했습니다: ${why}. 기존 보고서는 유지됩니다.`);};
const number=(e:Element|undefined,k:string)=>{const v=attr(e,k);if(!v||!Number.isFinite(Number(v)))return fail(`${k} 수치 없음`);return Number(v);};
const color=(v:string)=>/^#[0-9a-f]{6}$/iu.test(v)?v:fail('지원하지 않는 색');
const parse=(b:Uint8Array|undefined)=>{if(!b)fail('필수 XML 없음');const d=new DOMParser().parseFromString(strFromU8(b!),'application/xml');if(d.getElementsByTagName('parsererror').length)fail('XML 오류');return d;};
const bounds=(runs:Box[])=>{if(!runs.length)return fail('배치 좌표 없음');const x=Math.min(...runs.map(r=>r.x)),y=Math.min(...runs.map(r=>r.y));return{x,y,w:Math.max(...runs.map(r=>r.x+r.w))-x,h:Math.max(...runs.map(r=>r.y+r.h))-y};};
const absolute=(b:Box)=>({left:b.x,top:b.y,width:b.w,height:b.h,position:'absolute'});
const pathEquals=(a:CellPath|undefined,b:CellPath|undefined)=>JSON.stringify(a??[])===JSON.stringify(b??[]);

export async function readReportHwp(file:File):Promise<{document:JSONContent;images:Array<{key:string;file:File}>;pageCount:number;sourceName:string}>{
 const bytes=await file.arrayBuffer();assertReportNativeImportContainer(bytes,file.name);
 let measure:HTMLSpanElement|undefined;
 let calibration:HTMLElement|undefined;
 const calibrationUrls:string[]=[];
 const Engine=await loadNativeHwpEngine(),native=new Engine(new Uint8Array(bytes)) as unknown as Reader;
 try{
  if(typeof native.exportHwpxWithReport!=='function')fail('승인 엔진의 손실 보고 API 없음');
  const exported=native.exportHwpxWithReport();let files:Record<string,Uint8Array>;
  try{const loss=JSON.parse(exported.contentLoss());if(loss.schemaVersion!==1||String(loss.outputFormat).toLowerCase()!=='hwpx'||loss.count!==0||!Array.isArray(loss.losses)||loss.losses.length)fail('엔진 구조 변환 손실');files=unzipSync(exported.takeBytes());}finally{exported.free();}
  const header=parse(files['Contents/header.xml']),manifest=parse(files['Contents/content.hpf']);
  const ids=(name:string)=>new Map(all(header,name).map(e=>[attr(e,'id'),e]));
  const paraDefs=ids('paraPr'),charDefs=ids('charPr'),borders=ids('borderFill');
  const assets=new Map(all(manifest,'item').map(e=>[attr(e,'id'),e]));
  const sectionRefs=all(manifest,'itemref').map(e=>attr(e,'idref')).filter(id=>/^section\d+$/u.test(id));
  if(!sectionRefs.length||new Set(sectionRefs).size!==sectionRefs.length||sectionRefs.some((id,index)=>id!==`section${index}`))fail('구역 순서 매핑');
  const sections=sectionRefs.map(id=>parse(files[attr(assets.get(id),'href')]));
  const pageNumbers=sections.flatMap(section=>all(section,'pageNum'));
  if(pageNumbers.some(item=>attr(item,'formatType')!=='DIGIT'))fail('쪽번호 형식');
  const count=native.pageCount(),pages=Array.from({length:count},(_,page)=>({info:JSON.parse(native.getPageInfo(page)) as Info,runs:(JSON.parse(native.getPageTextLayout(page)).runs??[]) as Run[],controls:(JSON.parse(native.getPageControlLayout(page)).controls??[]) as Control[],content:[] as JSONContent[]}));
  const consumedRuns=new Set<Run>();
  const nativeFontStacks=new Map<string,string>();
  if(!count||!sections.length)fail('빈 문서');
  // Public run.y is the em-box top, not the painted baseline. Resolve the latter
  // from the same native print SVG; 0.2px covers two 0.1px public-coordinate roundings.
  for(const [index,page] of pages.entries()){
   const svg=new DOMParser().parseFromString(native.renderPageSvgWithProfile(index,'print'),'image/svg+xml');
   if(svg.getElementsByTagName('parsererror').length)fail('원본 기준선 SVG');
   const glyphs=all(svg,'text');
   // Page borders are decorative strokes outside the native body control list.
   // Copy only direct, axis-aligned vector lines, never page text or raster pages.
   const pageBorder=all(sections[page.info.sectionIndex],'pageBorderFill').some(ref=>{const definition=borders.get(attr(ref,'borderFillIDRef'));return definition&&['left','right','top','bottom'].some(side=>!['','NONE'].includes(attr(one(definition,side+'Border'),'type')));});
   if(pageBorder)for(const line of children(svg.documentElement,'line')){
    const x1=number(line,'x1'),y1=number(line,'y1'),x2=number(line,'x2'),y2=number(line,'y2');
    if(x1!==x2&&y1!==y2||attr(line,'transform')||attr(line,'stroke-dasharray'))fail('페이지 테두리 선');
    page.content.push({type:'hwpImportedRule',attrs:{left:Math.min(x1,x2),top:Math.min(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1),color:color(attr(line,'stroke')),stroke:number(line,'stroke-width'),style:'solid',nativeVector:1}});
   }
   const matched=resolveNativeHwpGlyphs(page.runs,svg,fail);
   for(const [run,list]of matched)nativeFontStacks.set(run.fontFamily,attr(list[0].glyph,'font-family'));
  }
  for(const p of pages){if(!Number.isFinite(p.info.width)||!Number.isFinite(p.info.height)||p.info.width<200||p.info.height<200||p.info.width>2400||p.info.height>4000)fail('용지 크기');if(Math.abs(p.info.width-794)>1||Math.abs(p.info.height-1123)>1)fail('A4 세로 외 용지');if(Array.isArray(p.info.columns)&&p.info.columns.length>1)fail('다단 문서');for(const c of p.controls)if(!['table','image','line','shape'].includes(c.type))fail(`지원하지 않는 ${c.type} 개체`);}
  const images:Array<{key:string;file:File}>=[],imageKeys=new Map<string,string>(),imageFiles=new Map<string,File>();
  // Cropping cannot silently turn into an uncropped editable image.
  for(const section of sections)for(const pic of all(section,'pic')){
   const id=attr(one(pic,'img'),'binaryItemIDRef'),entry=assets.get(id),path=attr(entry,'href'),bytes=files[path],mime=attr(entry,'media-type');
   if(!bytes||!['image/png','image/jpeg','image/bmp'].includes(mime))fail('사진 바이너리 형식');
   const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:attr(entry,'media-type')}));
   try{const clip=one(pic,'imgClip'),dim=one(pic,'imgDim');
    // HWP stores the full crop coordinate extent separately from raster pixels.
    // Older reports need not use 75 HWPUNIT per pixel (the native renderer uses imgDim).
    const dimWidth=dim?number(dim,'dimwidth'):0,dimHeight=dim?number(dim,'dimheight'):0;
    const width=dimWidth===0&&dimHeight===0?bitmap.width*75:dimWidth,height=dimWidth===0&&dimHeight===0?bitmap.height*75:dimHeight;
    if(width<=0||height<=0||!clip||number(clip,'left')!==0||number(clip,'top')!==0||number(clip,'right')!==width||number(clip,'bottom')!==height)fail('사진 잘라내기 또는 이미지 좌표 단위 미확인');
    if(!imageFiles.has(id)){
     let blob:Blob=new Blob([new Uint8Array(bytes)],{type:mime}),name=path.split('/').pop()!;
     // Keep raster pixels losslessly; PNG also works in the existing DOCX/PDF exporters.
     // The complete original HWP is retained separately by the normal import receipt.
     if(mime==='image/bmp'){const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');if(!context)fail('BMP 사진 변환');context!.drawImage(bitmap,0,0);blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('BMP 사진 변환 실패')),'image/png'));name=name.replace(/\.[^.]+$/u,'.png');}
     imageFiles.set(id,new File([blob],name,{type:blob.type}));
    }
   }finally{bitmap.close();}
  }
  // The SDK's stored advances differ from browser shaping (notably half-em spaces).
  // Measure the actual loaded face and keep original tracking separately from that adjustment.
  await prepareDocumentExportFonts(document);
  const resolvedFaces=new Map<string,string>();
  for(const [family,stack]of nativeFontStacks)if(stack&&!['Noto Serif KR','Noto Sans KR'].includes(family))resolvedFaces.set(family,await resolveDocumentExportFontFamily(stack,document));
  for(const page of pages)for(const run of page.runs){
   run.nativeFontFamily=run.fontFamily;
   run.fontFamily=resolvedFaces.get(run.fontFamily)??run.fontFamily;
   const definition=charDefs.get(String(run.charShapeId));
   // Public layout rounds sizes to 0.1px. Preserve the actual HWP font height
   // for a later native export instead of accumulating that rounding per glyph.
   if(definition){const size=number(definition,'height')/75;if(size<=0||Math.abs(size-run.fontSize)>.1)fail('원본 글자 크기 매핑');run.fontSize=Math.round(size*1e6)/1e6;}
  }
  const face=(run:Run)=>['Noto Serif KR','Noto Sans KR'].includes(run.fontFamily)?`HwpImport ${run.fontFamily}`:run.fontFamily;
  const fontRequests=new Set(pages.flatMap(page=>page.runs.filter(run=>run.text).map(run=>`${run.italic?'italic ':''}${run.bold?700:400} ${run.fontSize}px ${JSON.stringify(face(run))}`)));
  await Promise.all([...fontRequests].map(font=>document.fonts.load(font)));
  measure=document.createElement('span');
  measure!.style.cssText='position:fixed;left:-20000px;top:0;visibility:hidden;white-space:pre;margin:0;padding:0;border:0;';
  document.body.append(measure);
  const tracking=(run:Run,text:string,advance:number)=>{
   measure!.style.fontFamily=JSON.stringify(face(run));measure!.style.fontSize=`${run.fontSize}px`;measure!.style.fontWeight=run.bold?'700':'400';measure!.style.fontStyle=run.italic?'italic':'normal';measure!.style.letterSpacing=`${run.letterSpacing}px`;
   measure!.textContent=text;
   const width=measure!.getBoundingClientRect().width,correction=(advance-width)/Array.from(text).length;
   if(!Number.isFinite(correction)||Math.abs(correction)>20)fail('글자 폭 보정 범위');
   return correction;
  };
  const advanceOf=(runs:Run[],start:number,text:string)=>{
   let total=0;
   for(const [index,char]of Array.from(text).entries()){
    const position=start+index,run=runs.find(run=>position>=run.charStart&&position<run.charStart+Array.from(run.text).length),offset=run?position-run.charStart:0;
    if(!run||Array.from(run.text)[offset]!==char||!Array.isArray(run.charX)||!Number.isFinite(run.charX[offset+1])||!Number.isFinite(run.charX[offset]))fail('문자별 원본 폭 매핑');
    total+=run!.charX[offset+1]-run!.charX[offset];
   }
   return total;
  };
  const fontMarks=(run:Run,text=run.text,advance=run.charX?.at(-1)):NonNullable<JSONContent['marks']>=>{
   if(!run.fontFamily||!Number.isFinite(run.fontSize)||run.fontSize<=0||run.ratio!==1||!Number.isFinite(run.letterSpacing))fail('글꼴 또는 장평 근거 없음');
   return [{type:'hwpTextStyle',attrs:{fontFamily:run.fontFamily,nativeFontFamily:run.nativeFontFamily,fontSize:run.fontSize,color:color(run.textColor),letterSpacing:run.letterSpacing,trackingCorrection:tracking(run,text,advance!)}},...(run.bold?[{type:'bold'}]:[]),...(run.italic?[{type:'italic'}]:[]),...(run.underline?[{type:'underline'}]:[]),...(run.strikethrough?[{type:'strike'}]:[])];
  };
  const portableRun=(run:Run):JSONContent[]=>Array.from(run.text).map((text,index)=>{
   const width=run.charX[index+1]-run.charX[index];if(!Number.isFinite(width)||width<0)fail('쪽번호 문자 폭');
   const marks=fontMarks(run,text,width);marks[0].attrs!.trackingCorrection=0;
   marks.push({type:'hwpTextAdvance',attrs:{letterSpacing:0,unitAdvance:Math.round(width*1e6)/1e6,metric:hwpAdvanceMetric(text)}});
   return{type:'text',text,marks};
  });
  const paragraphStyle=(p:Element)=>{
   const def=paraDefs.get(attr(p,'paraPrIDRef'));if(!def)fail('문단 서식 참조');
   const branch=one(def!,'case')??one(def!,'default')??def!,factor=branch.localName==='case'?75:150;
   const margin=one(branch,'margin'),spacing=one(branch,'lineSpacing');
   const get=(name:string)=>one(margin??branch,name)?number(one(margin??branch,name),'value')/factor:0;
   const type=attr(spacing,'type'),v=number(spacing,'value');if(!['PERCENT','FIXED'].includes(type))fail(`줄간격 ${type}`);
   const nativeAlign=attr(one(def!,'align'),'horizontal').toLowerCase(),align=nativeAlign==='distribute_space'?'justify':nativeAlign;if(!['left','right','center','justify'].includes(align))fail(`문단 정렬 ${align}`);
   return {textAlign:align,hwpLayout:{marginLeft:get('left'),marginRight:get('right'),marginTop:get('prev'),marginBottom:get('next'),textIndent:get('intent'),...(type==='PERCENT'?{lineHeightRatio:v/100}:{lineHeight:v/factor})}};
  };
  const image=(pic:Element):JSONContent=>{
   if(attr(one(pic,'rotationInfo'),'angle')!=='0'||all(pic,'flip').some(e=>attr(e,'horizontal')!=='0'||attr(e,'vertical')!=='0')||(one(pic,'effects')?.children.length??0)>0)fail('사진 회전·효과');
   for(const tag of ['transMatrix','scaMatrix','rotMatrix'])for(const matrix of all(pic,tag))if(['e1','e2','e3','e4','e5','e6'].some((k,i)=>tag==='scaMatrix'&&(i===0||i===4)?number(matrix,k)<=0:number(matrix,k)!==[1,0,0,0,1,0][i]))fail('사진 변환 행렬');
   const img=one(pic,'img'),id=attr(img,'binaryItemIDRef'),entry=assets.get(id),path=attr(entry,'href');
   if(!/^BinData\/[^/]+$/u.test(path)||!files[path])fail('사진 원본 참조');
   const mime=attr(entry,'media-type');if(!['image/png','image/jpeg','image/bmp'].includes(mime))fail(`사진 형식 ${mime}`);
   if(['bright','contrast','alpha'].some(k=>Number(attr(img,k)||0)!==0)||!['','REAL_PIC'].includes(attr(img,'effect')))fail('사진 색상 효과');
   let key=imageKeys.get(id);if(!key){key=`image-${images.length+1}`;imageKeys.set(id,key);images.push({key,file:imageFiles.get(id)!});}
   const size=children(pic,'sz')[0];return{type:'image',attrs:{src:`/__hwp_import_image__/${key}`,alt:'',width:number(size,'width')/75,height:number(size,'height')/75}};
  };
  const table=(tbl:Element,sec:number,para:number,page:number,control:Control):JSONContent=>{
   if(all(tbl,'tbl').length)fail('중첩 표');
   const columns=number(tbl,'colCnt'),rowCount=number(tbl,'rowCnt');
   const grid=(axis:'x'|'y',size:'w'|'h',index:'col'|'row',span:'colSpan'|'rowSpan',count:number)=>{
    const boundaries:Array<number|undefined>=Array.from({length:count+1});
    for(const cell of control.cells??[]){const start=cell[index],end=start+cell[span];if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(end)||end>count)fail('표 병합 범위');for(const [at,value]of [[start,cell[axis]],[end,cell[axis]+cell[size]]] as const){if(!Number.isFinite(value))fail('표 경계 수치');if(boundaries[at]!==undefined&&Math.abs(boundaries[at]!-value)>.5)fail('표 병합 경계 충돌');if(boundaries[at]===undefined)boundaries[at]=value;}}
    if(boundaries.some(v=>v===undefined))fail(`병합 표 ${index==='col'?'열':'행'} 내부 경계 근거 없음`);
    const values=boundaries as number[];if(values.some((v,i)=>i>0&&v<=values[i-1]))fail('표 경계 순서');return values;
   };
   const columnEdges=grid('x','w','col','colSpan',columns),rowEdges=grid('y','h','row','rowSpan',rowCount);
   const rows=children(tbl,'tr').map((tr,rowIndex)=>({type:'tableRow',attrs:{hwpLayout:{height:rowEdges[rowIndex+1]-rowEdges[rowIndex]}},content:children(tr,'tc').map(tc=>{
    const sub=children(tc,'subList')[0],span=children(tc,'cellSpan')[0],size=children(tc,'cellSz')[0],margin=attr(tc,'hasMargin')==='1'?children(tc,'cellMargin')[0]:children(tbl,'inMargin')[0];
    if(!sub||attr(sub,'textDirection')!=='HORIZONTAL')fail('세로쓰기 셀');
    const bf=borders.get(attr(tc,'borderFillIDRef'));if(!bf)fail('셀 테두리 참조');
    const brush=one(bf!,'fillBrush'),fill=brush&&one(brush,'winBrush');
    if(brush?.children.length&&(brush.children.length!==1||brush.children[0].localName!=='winBrush'))fail('표 배경 채움 형식');
    const layout:Record<string,unknown>={height:number(size,'height')/75,nativeHeight:number(size,'height')/75};
    if(fill){if(!['','NONE'].includes(attr(fill,'hatchStyle'))||Number(attr(fill,'alpha')||0)!==0)fail('표 배경 무늬·투명도');if(attr(fill,'faceColor')!=='none')layout.backgroundColor=color(attr(fill,'faceColor'));}
    for(const side of ['left','right','top','bottom']){layout['padding'+side[0].toUpperCase()+side.slice(1)]=number(margin,side)/75;const edge=one(bf!,side+'Border'),style=attr(edge,'type');if(!['NONE','SOLID','DOT','DASH','DOUBLE_SLIM','SLIM_THICK_SLIM'].includes(style))fail(`셀 테두리 ${style}`);if(['DOUBLE_SLIM','SLIM_THICK_SLIM'].includes(style))layout['border'+side[0].toUpperCase()+side.slice(1)+'Pattern']=style;const mm=attr(edge,'width').match(/^([\d.]+) mm$/u);if(!mm)fail('셀 테두리 폭');layout['border'+side[0].toUpperCase()+side.slice(1)]=style==='NONE'?'none':`${Number(mm![1])*96/25.4}px ${style==='DOT'?'dotted':style==='DASH'?'dashed':'solid'} ${color(attr(edge,'color'))}`;}
    const row=number(children(tc,'cellAddr')[0],'rowAddr'),col=number(children(tc,'cellAddr')[0],'colAddr'),cellIndex=all(tbl,'tc').indexOf(tc);
    let content=children(sub,'p').flatMap((p,cellPara)=>parseParagraph(p,sec,para,page,[{controlIndex:control.controlIdx,cellIndex,cellParaIndex:cellPara}],false));
    const colspan=number(span,'colSpan'),rowspan=number(span,'rowSpan');
    if(!control.cells?.some(c=>c.row===row&&c.col===col&&c.rowSpan===rowspan&&c.colSpan===colspan))fail('표 셀 병합 배치 없음');
    const colwidth=Array.from({length:colspan},(_,i)=>columnEdges[col+i+1]-columnEdges[col+i]);
    layout.height=rowEdges[row+rowspan]-rowEdges[row];layout.nativeX=columnEdges[col];layout.nativeY=rowEdges[row];layout.nativeWidth=columnEdges[col+colspan]-columnEdges[col];
    if(content.length===1&&content[0].type==='paragraph'){
     const p=content[0],metrics=p.attrs?.hwpLayout??{},lines=1+(p.content??[]).filter(n=>n.type==='hardBreak').length;
     const available=Number(layout.height)-Number(layout.paddingTop)-Number(layout.paddingBottom),intrinsic=Number(metrics.lineHeight)*lines+Number(metrics.marginTop||0)+Number(metrics.marginBottom||0);
     const runs=pages[page].runs.filter(r=>r.secIdx===sec&&r.parentParaIdx===para&&pathEquals(r.cellPath,[{controlIndex:control.controlIdx,cellIndex,cellParaIndex:0}]));
     if(intrinsic>available+.1&&runs.some(r=>r.text.trim())){
      const b=bounds(runs);
      if(b.y>=Number(layout.nativeY)-.2&&b.y+b.h<=Number(layout.nativeY)+Number(layout.height)+.2){
       // Native fixed-height cells may fit glyphs while CSS padding + line-box
       // minima do not. Preserve that text in an editable, locally anchored box.
       content=[{type:'hwpImportedTextBox',attrs:{hwpLayout:{position:'absolute',left:layout.paddingLeft,top:layout.paddingTop,width:Number(layout.nativeWidth)-Number(layout.paddingLeft)-Number(layout.paddingRight),height:Math.max(0,available),nativeCellPosition:1}},content:[p]}];
      }
     }
    }
    return{type:attr(tc,'header')==='1'?'tableHeader':'tableCell',attrs:{colspan,rowspan,colwidth,verticalAlignment:attr(sub,'vertAlign').toLowerCase()==='center'?'middle':attr(sub,'vertAlign').toLowerCase(),hwpLayout:layout},content:content.length?content:[{type:'paragraph'}]};
   })}));
   return{type:'table',attrs:{hwpLayout:{...absolute(control),marginTop:0,marginBottom:0,marginLeft:0,marginRight:0,nativeGrid:1}},content:rows};
  };
  const parseParagraph=(p:Element,sec:number,para:number,page:number,path:CellPath|undefined,root:boolean):JSONContent[]=>{
   const pageRuns=pages[page].runs.filter(r=>r.secIdx===sec&&(path?r.parentParaIdx:r.paraIdx)===para&&pathEquals(r.cellPath,path));
   pageRuns.forEach(run=>consumedRuns.add(run));
   const pageFrom=pageRuns.length?Math.min(...pageRuns.map(r=>r.charStart)):0,pageTo=pageRuns.length?Math.max(...pageRuns.map(r=>r.charStart+Array.from(r.text).length)):0;
   let tokens:JSONContent[]=[];const blocks:JSONContent[]=[];let plain='';
   for(const run of children(p,'run'))for(const child of children(run)){
    if(child.localName==='t'){
     for(const n of Array.from(child.childNodes)){
      if(n.nodeType===3){const original=n.textContent??'',start=Array.from(plain).length;plain+=original;const textStart=Math.max(start,pageFrom),text=Array.from(original).slice(Math.max(0,pageFrom-start),Math.max(0,Math.min(Array.from(original).length,pageTo-start))).join('');const def=charDefs.get(attr(run,'charPrIDRef'));if(text&&!def)fail('글자 서식 참조');if(def){for(const [tag,value]of [['ratio',100],['relSz',100],['offset',0]] as const){const e=one(def,tag);if(e&&Array.from(e.attributes).some(a=>Number(a.value)!==value))fail(`지원하지 않는 글자 ${tag}`);}if(['outline','shadow'].some(tag=>!['','NONE'].includes(attr(one(def,tag),'type'))))fail('글자 외곽선·그림자');}const styleRuns=pageRuns.filter(r=>r.charShapeId===Number(attr(run,'charPrIDRef')));if(text&&!styleRuns.length)fail('글자 서식 배치 매핑');if(text){const marks=fontMarks(styleRuns[0],text,advanceOf(pageRuns,textStart,text));const anchor=pageRuns.find(r=>r.baseline!==undefined);if(anchor&&styleRuns[0].baseline!==undefined)Object.assign(marks[0].attrs!,{baselineShift:(styleRuns[0].baseline!-styleRuns[0].y)-(anchor.baseline!-anchor.y)});if(styleRuns.some(r=>r.fontFamily!==styleRuns[0].fontFamily||r.fontSize!==styleRuns[0].fontSize||r.bold!==styleRuns[0].bold||r.italic!==styleRuns[0].italic||r.textColor!==styleRuns[0].textColor||r.letterSpacing!==styleRuns[0].letterSpacing))fail('한 XML run 안의 언어별 글꼴·서식 차이');tokens.push({type:'text',text,marks});}}
      else if(n instanceof Element&&n.localName==='lineBreak'){if(Array.from(plain).length>=pageFrom&&Array.from(plain).length<pageTo)tokens.push({type:'hardBreak'});plain+='\n';}else if(n instanceof Element&&n.localName==='tab'){if(number(n,'leader')!==0)fail('탭 안내선');if(Array.from(plain).length>=pageFrom&&Array.from(plain).length<pageTo){const width=advanceOf(pageRuns,Array.from(plain).length,'\t');tokens.push({type:'hwpImportedTab',attrs:{width}});}plain+='\t';}else if(n.nodeType===1)fail(`문자 안 ${n.nodeName}`);
     }
    }else if(child.localName==='pic'){const node=image(child),style=paragraphStyle(p),placements=pages[page].controls.filter(c=>c.type==='image'&&c.secIdx===sec&&c.paraIdx===para&&pathEquals(c.cellPath,path));if(placements.length!==1)fail('사진 위치 매핑');const placement=placements[0];node.attrs={...node.attrs,width:placement.w,height:placement.h,alignment:['left','center','right'].includes(style.textAlign)?style.textAlign:'left',hwpLayout:{...style.hwpLayout,width:placement.w,height:placement.h}};if(root)node.attrs.hwpLayout={...style.hwpLayout,...absolute(placement),marginTop:0,marginBottom:0,marginLeft:0,marginRight:0};else if(placement.wrap==='inFrontOfText'){const cell=pages[page].controls.find(c=>c.type==='table'&&c.secIdx===sec&&c.paraIdx===para&&!c.cellPath)?.cells?.[path![0].cellIndex];if(!cell)fail('셀 안 고정 사진 위치');node.attrs.hwpLayout={...absolute({...placement,x:placement.x-cell!.x,y:placement.y-cell!.y}),marginTop:0,marginBottom:0,marginLeft:0,marginRight:0,nativeCellPosition:1};}blocks.push(node);}
    else if(child.localName==='tbl'){
     if(!root)fail('중첩 표');const controls=pages[page].controls.filter(c=>c.type==='table'&&c.secIdx===sec&&c.paraIdx===para&&!c.cellPath);
     if(controls.length!==1)fail('한 문단 여러 표 또는 표 위치 없음');blocks.push(table(child,sec,para,page,controls[0]));
    }else if(child.localName==='rect'){
     const draw=children(child,'drawText')[0],placements=pages[page].controls.filter(c=>c.type==='shape'&&c.secIdx===sec&&c.paraIdx===para&&!c.cellPath);
     if(!root||!draw||placements.length!==1)fail('지원하지 않는 도형 또는 중첩 글상자');
     const sub=children(draw,'subList')[0],margin=children(draw,'textMargin')[0],rotation=one(child,'rotationInfo');
     if(!sub||attr(sub,'textDirection')!=='HORIZONTAL'||attr(sub,'vertAlign')!=='TOP'||!['BREAK','SQUEEZE'].includes(attr(sub,'lineWrap'))||Number(attr(rotation,'angle')||0)!==0||all(child,'flip').some(e=>attr(e,'horizontal')!=='0'||attr(e,'vertical')!=='0')||all(child,'fillBrush').length||Number(attr(children(child,'lineShape')[0],'width')||0)!==0)fail('글상자 회전·채움·테두리');
     for(const tag of ['transMatrix','scaMatrix','rotMatrix'])for(const matrix of all(child,tag))if(['e1','e2','e3','e4','e5','e6'].some((k,i)=>number(matrix,k)!==[1,0,0,0,1,0][i]))fail('글상자 변환 행렬');
     const control=placements[0],content=children(sub,'p').flatMap((p,index)=>parseParagraph(p,sec,para,page,[{controlIndex:control.controlIdx,cellIndex:0,cellParaIndex:index}],false));
     if(content.some(node=>node.type!=='paragraph'))fail('글상자 안 지원하지 않는 개체');
     // The pinned serializer omits textMargin only when all four values are 0.
     // A present element must still provide every numeric edge explicitly.
     blocks.push({type:'hwpImportedTextBox',attrs:{hwpLayout:{...absolute(control),paddingLeft:margin?number(margin,'left')/75:0,paddingRight:margin?number(margin,'right')/75:0,paddingTop:margin?number(margin,'top')/75:0,paddingBottom:margin?number(margin,'bottom')/75:0}},content:content.length?content:[{type:'paragraph'}]});
    }else if(child.localName==='line'){
     if(!root)fail('셀 안 선');if(Number(attr(one(child,'rotationInfo'),'angle')||0)!==0||all(child,'flip').some(e=>attr(e,'horizontal')!=='0'||attr(e,'vertical')!=='0'))fail('선 회전·뒤집기');for(const tag of ['transMatrix','scaMatrix','rotMatrix'])for(const matrix of all(child,tag))if(['e1','e2','e3','e4','e5','e6'].some((k,i)=>number(matrix,k)!==[1,0,0,0,1,0][i]))fail('선 변환 행렬');const line=pages[page].controls.filter(c=>c.type==='line'&&c.secIdx===sec&&c.paraIdx===para)[blocks.filter(b=>b.type==='hwpImportedRule').length];if(!line)fail('선 위치 없음');
     const start=one(child,'startPt'),end=one(child,'endPt'),shape=one(child,'lineShape');if(number(start,'y')!==number(end,'y')&&number(start,'x')!==number(end,'x'))fail('비수평·수직선');const style=attr(shape,'style');if(!['SOLID','DOT','DASH'].includes(style))fail('선 스타일');blocks.push({type:'hwpImportedRule',attrs:{left:line.x,top:line.y,width:Math.abs(number(end,'x')-number(start,'x'))/75,height:Math.abs(number(end,'y')-number(start,'y'))/75,color:color(attr(shape,'color')),stroke:number(shape,'width')/75,style:style==='DOT'?'dotted':style==='DASH'?'dashed':'solid',nativeVector:1}});
    }else if(child.localName==='secPr'){}else if(child.localName==='ctrl'){
     // Numbering/hiding controls have already been resolved by the same native page layout.
     for(const c of children(child)){if(!['colPr','footer','header','pageNum','pageHiding','newNum'].includes(c.localName))fail(`제어 ${c.localName}`);if(c.localName==='newNum'&&attr(c,'numType')!=='PAGE')fail('쪽번호 외 새 번호');}
    }else fail(`개체 ${child.localName}`);
   }
   if(tokens.length&&blocks.some(b=>b.type==='image'||b.type==='table'))fail('한 문단 안의 문자와 사진·표 혼합 순서');
   const sourceRuns=pages.flatMap(page=>page.runs.filter(r=>r.secIdx===sec&&(path?r.parentParaIdx:r.paraIdx)===para&&pathEquals(r.cellPath,path))).sort((a,b)=>a.charStart-b.charStart);
   if(plain.replace(/\s/gu,'')!==sourceRuns.map(r=>r.text).join('').replace(/\s/gu,''))fail(`전체 문단 문자 매핑 ${sec}:${para}`);
   if(Array.from(plain).slice(pageFrom,pageTo).join('').replace(/\s/gu,'')!==pageRuns.map(r=>r.text).join('').replace(/\s/gu,''))fail(`본문 문자 매핑 ${sec}:${para}`);
   // Preserve the native visual line boundaries inside the same editable paragraph.
   // CSS/Korean word wrapping alone can otherwise move a whole word to another line.
   const lineStarts=new Map<number,number>();for(const r of pageRuns)if(r.text){const y=Math.round(r.y*10);lineStarts.set(y,Math.min(lineStarts.get(y)??Infinity,r.charStart));}
   const starts=new Set([...lineStarts.values()].sort((a,b)=>a-b).slice(1)),rebuilt:JSONContent[]=[];
   // Public runs round their origins independently. Preserve the measured gap
   // only after the last glyph, without spreading it over the preceding word.
   const runGaps=new Map<Run,number>();
   for(const r of pageRuns){
    const end=r.charStart+Array.from(r.text).length,next=pageRuns.find(n=>n.charStart===end&&Math.abs(n.y-r.y)<.1);
    if(next){const gap=next.x+next.charX[0]-r.x-r.charX.at(-1)!;if(Math.abs(gap)>1e-6)runGaps.set(r,gap);}
   }

   let position=pageFrom,firstText:Run|undefined,firstTextX:number|undefined;
   for(const token of tokens){
    if(token.type!=='text'){
     // A terminal TAB's raw advance and the next painted run can differ after
     // native layout rounding. Keep the same boundary correction as for text,
     // rather than adding that rounding gap a second time in the browser.
     if(token.type==='hwpImportedTab'){
      const run=pageRuns.find(r=>position>=r.charStart&&position<r.charStart+Array.from(r.text).length);
      if(run&&position+1===run.charStart+Array.from(run.text).length)token.attrs={...token.attrs,width:Number(token.attrs?.width)+(runGaps.get(run)??0)};
     }
     rebuilt.push(token);position++;continue;
    }
    const chars=Array.from(token.text??''),end=position+chars.length;
    const kind=hwpAdvanceMetric;
    const classCuts=chars.flatMap((char,index)=>index&&kind(char)!==kind(chars[index-1])?[position+index]:[]);
    const cuts=[...new Set([position,end,...classCuts,...pageRuns.map(r=>r.charStart).filter(n=>n>position&&n<end),...[...runGaps.keys()].map(r=>r.charStart+Array.from(r.text).length-1).filter(n=>n>position&&n<end),...[...starts].filter(n=>n>position&&n<end)])].sort((a,b)=>a-b),begin=position;
    for(let i=0;i<cuts.length-1;i++){
     const at=cuts[i],text=chars.slice(at-begin,cuts[i+1]-begin).join(''),r=pageRuns.find(r=>at>=r.charStart&&at<r.charStart+Array.from(r.text).length);
     if(!r)fail('원본 줄 문자 위치');
     if(starts.has(at)&&rebuilt.at(-1)?.type!=='hardBreak')rebuilt.push({type:'hardBreak',attrs:{hwpSoftBreak:true}});
     if(!firstText&&text.trim()&&r!.baseline!==undefined){firstText=r;firstTextX=r!.x+r!.charX[at-r!.charStart];}
     const gap=at+Array.from(text).length===r!.charStart+Array.from(r!.text).length?runGaps.get(r!)??0:0;
     const marks=fontMarks(r!,text,advanceOf(pageRuns,at,text)+gap),style=marks[0].attrs!;
     style.trackingCorrection=0;
     if(firstText?.baseline!==undefined&&r!.baseline!==undefined)Object.assign(style,{baselineShift:Math.round(((r!.baseline!-r!.y)-(firstText!.baseline!-firstText!.y))*1e6)/1e6});
     marks.push({type:'hwpTextAdvance',attrs:{letterSpacing:0,unitAdvance:Math.round((advanceOf(pageRuns,at,text)+gap)/Array.from(text).length*1e6)/1e6,metric:kind(Array.from(text)[0])}});
     rebuilt.push({type:'text',text,marks});
    }
    position=end;
   }
   tokens=rebuilt;
   if(tokens.length||(!root&&!blocks.length&&pageRuns.length)){
    const style=paragraphStyle(p),layout=style.hwpLayout as Record<string,string|number>;
    const fontSize=Math.max(...pageRuns.map(run=>run.fontSize)),lineOf=(run:Run)=>run.y,lines=[...new Set(pageRuns.map(run=>Math.round(lineOf(run)*10)/10))].sort((a,b)=>a-b),lastHeight=Math.max(...pageRuns.filter(run=>Math.abs(lineOf(run)-lines.at(-1)!)<.1).map(run=>run.h));
    const lineHeight=lines.length>1?lines[1]-lines[0]:lastHeight;
    if(lines.some((y,i)=>i>0&&Math.abs(y-lines[i-1]-lineHeight)>.2))fail(`문단 줄 간격 매핑 ${sec}:${para}`);
    delete layout.lineHeightRatio;
    Object.assign(layout,{fontSize,fontFamily:face(pageRuns[0]),lineHeight,marginBottom:Number(layout.marginBottom)-(lineHeight-lastHeight)});
    // Native visual breaks are already explicit. A second CSS wrap would add
    // extra lines and move all following text away from its original position.
    layout.whiteSpace='pre';
    const first=firstText??pageRuns.find(run=>run.baseline!==undefined);
    if(first)Object.assign(layout,{nativeX:firstTextX??first.x,nativeBaseline:first.baseline});
    const paragraph:JSONContent={type:'paragraph',attrs:style,...(tokens.length?{content:tokens}:{})};
    if(root){
     const b=bounds(pageRuns);let left=Number(style.hwpLayout.marginLeft),right=Number(style.hwpLayout.marginRight);
     // A page-anchored export can encode reviewed visual rows as one standard
     // body paragraph with line-specific native bounds. Recover its column
     // width as well as its glyph positions for subsequent web editing.
     const stored=children(children(p,'linesegarray')[0]??p,'lineseg');
     if(style.textAlign==='justify'&&Math.abs(pages[page].info.bodyLeft)<.01&&left===0&&right===0&&stored.length>1){
      const edges=stored.map(line=>({left:number(line,'horzpos')/75,width:number(line,'horzsize')/75}));
      if(edges.every(edge=>edge.left>=0&&edge.width>0)&&edges.some(edge=>edge.left>0)&&Math.max(...edges.map(edge=>edge.left+edge.width))<=pages[page].info.bodyRight+.1){left=Math.min(...edges.map(edge=>edge.left));right=pages[page].info.bodyRight-Math.max(...edges.map(edge=>edge.left+edge.width));}
     }
     const width=pages[page].info.bodyRight-pages[page].info.bodyLeft-left-right;
     if(width<=0)fail('본문 문단 유효 폭');
     Object.assign(style.hwpLayout,{marginTop:0,marginBottom:0,marginLeft:0,marginRight:0});
     blocks.unshift({type:'hwpImportedTextBox',attrs:{hwpLayout:absolute({x:pages[page].info.bodyLeft+left,y:b.y,w:width,h:b.h})},content:[paragraph]});
    }else blocks.unshift(paragraph);
   }
   return blocks;
  };
  sections.forEach((section,sec)=>children(section.documentElement,'p').forEach((p,para)=>{
   const hits=pages.map((page,index)=>page.runs.some(r=>r.secIdx===sec&&(r.cellPath?r.parentParaIdx:r.paraIdx)===para)||page.controls.some(c=>c.secIdx===sec&&c.paraIdx===para)?index:-1).filter(n=>n>=0);
   if(hits.length>1&&['tbl','pic','line'].some(name=>all(p,name).length))fail(`여러 쪽에 걸친 표/개체 ${sec}:${para}`);
   const placements=hits.length?hits:[JSON.parse(native.getPageOfPosition(sec,para)).page];
   for(const page of placements){if(!pages[page])fail('문단 페이지 없음');pages[page].content.push(...parseParagraph(p,sec,para,page,undefined,true));}
  }));
  for(const page of pages){const footers=page.runs.filter(r=>{
   if(r.paraIdx===4294967295)return !!r.text;
   if(r.secIdx===undefined&&r.paraIdx===undefined&&r.text){if(!pageNumbers.length||!/^\s*[-–]?\s*\d+\s*[-–]?\s*$/u.test(r.text))fail('자동 생성 문자 매핑');return true;}
   return false;
  });const lines=new Map<number,Run[]>();for(const r of footers){consumedRuns.add(r);lines.set(r.y,[...(lines.get(r.y)??[]),r]);}for(const rs of lines.values()){const sorted=rs.sort((a,b)=>a.x-b.x);page.content.push({type:'hwpImportedTextBox',attrs:{hwpLayout:absolute(bounds(sorted))},content:[{type:'paragraph',attrs:{textAlign:'left',hwpLayout:{fontFamily:face(sorted[0]),fontSize:Math.max(...sorted.map(r=>r.fontSize)),lineHeight:Math.max(...sorted.map(r=>r.h)),nativeX:sorted[0].x,nativeBaseline:sorted.find(r=>r.baseline!==undefined)?.baseline}},content:sorted.flatMap(portableRun)}]});}}
  if(pages.some(page=>page.runs.some(run=>run.text.trim()&&!consumedRuns.has(run))))fail('미처리 원본 문자');
  measure.remove();
  const documentJson:JSONContent={type:'doc',content:pages.map(p=>({type:'hwpImportedPage',attrs:{width:p.info.width,height:p.info.height},content:p.content}))};
  const {renderStructuredDocumentHtml}=await import('./StructuredDocumentEditor');
  calibration=document.createElement('div');calibration.className='structured-editor';calibration.style.cssText='position:fixed;left:-20000px;top:0;width:794px;visibility:hidden;pointer-events:none';
  const preview=document.createElement('article');preview.className='structured-editor__preview';preview.style.cssText='padding:0;margin:0;width:794px;max-width:none';preview.innerHTML=renderStructuredDocumentHtml(documentJson);calibration.append(preview);document.body.append(calibration);
  await Promise.all(Array.from(preview.querySelectorAll('img')).map(async image=>{const file=images.find(item=>image.getAttribute('src')===`/__hwp_import_image__/${item.key}`)?.file;if(!file)fail('사진 측정 원본');const url=URL.createObjectURL(file!);calibrationUrls.push(url);image.src=url;await image.decode();}));
  alignImportedHwpPages(preview);
  const offsets=measureImportedHwpOffsets(preview),paragraphs:JSONContent[]=[];
  const visit=(node:JSONContent)=>{if(node.type==='paragraph')paragraphs.push(node);node.content?.forEach(visit);};visit(documentJson);
  if(offsets.length!==paragraphs.length)fail('문단 기준선 측정 개수');
  offsets.forEach((offset,index)=>{if(!offset)return;if(!Number.isFinite(offset.left)||!Number.isFinite(offset.top)||Math.abs(offset.left)>Math.max(...pages.map(p=>p.info.width))||Math.abs(offset.top)>Math.max(...pages.map(p=>p.info.height)))fail(`문단 기준선 보정 범위 ${index}: ${offset.left.toFixed(1)}, ${offset.top.toFixed(1)}`);Object.assign(paragraphs[index].attrs!.hwpLayout,{position:'relative',left:offset.left,top:offset.top});});
  return{document:documentJson,images,pageCount:count,sourceName:file.name};
 }finally{calibration?.remove();calibrationUrls.forEach(url=>URL.revokeObjectURL(url));measure?.remove();native.free();}
}
