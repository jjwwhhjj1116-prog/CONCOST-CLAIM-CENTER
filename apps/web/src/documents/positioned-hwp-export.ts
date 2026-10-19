import {strFromU8,strToU8,unzipSync,zipSync} from 'fflate';
import type {NativeHwpEngine,NativeHwpPage,NativeHwpDocument} from './editable-hwp-export';
import {resolveNativeHwpGlyphs,type NativeGlyphRun} from './native-hwp-glyphs';
import {nativeParagraphText,setNativeParagraphLines,mergeNativeTextRuns} from './native-hwp-line-cache';

const ns='http://www.hancom.co.kr/hwpml/2011/paragraph';
const direct=(element:Element,name:string)=>Array.from(element.children).filter(child=>child.localName===name);
const all=(element:Element|Document,name:string)=>Array.from(element.getElementsByTagName('*')).filter(child=>child.localName===name);
const parse=(bytes:Uint8Array)=>{const xml=new DOMParser().parseFromString(strFromU8(bytes),'application/xml');if(xml.getElementsByTagName('parsererror').length)throw Error('HWP 고정 배치 XML 오류');return xml;};
const write=(xml:Document)=>strToU8(new XMLSerializer().serializeToString(xml));
const hu=(value:number)=>Math.round(value*75);
const text=(element:Element)=>all(element,'t').map(node=>node.textContent||'').join('');
const check=(result:string)=>{const value=JSON.parse(result);if(!value.ok)throw Error('HWP 편집 개체 배치를 보존하지 못했습니다.');return value;};
const attrs=(element:Element,values:Record<string,string|number>)=>{for(const [key,value]of Object.entries(values))element.setAttribute(key,String(value));};
type Reader=NativeHwpDocument&{getPageTextLayout(page:number):string;getPageControlLayout(page:number):string;getCursorRectInCell(sec:number,para:number,control:number,cell:number,cellPara:number,offset:number):string};
type Block=NonNullable<NativeHwpPage['positioned']>[number];
type BodyAnchor={sec:number;para:number;block:Block};
const bodyBlock=(block:Block)=>{
 const line=block.lines?.length===1?block.lines[0]:undefined;
 return block.kind==='text'&&line?.align==='justify'&&!!line.inputs?.length&&line.starts.length>1&&line.widths?.length===line.starts.length&&line.widths.every(w=>Number.isFinite(w)&&w>0)&&line.lefts?.length===line.starts.length&&line.firstXs?.length===line.starts.length&&Math.max(...line.widths)-Math.min(...line.widths)>14;
};

/** Native textboxes always justify to their whole width. A standard body
 * paragraph honors its stored line geometry instead, while retaining the
 * paragraph and all of its authored/soft breaks. Calibrate newly typed glyphs
 * to the measured current advances using ordinary native character spacing. */
function calibrateBodyInputs(files:Record<string,Uint8Array>,bodies:BodyAnchor[],pages:NativeHwpPage[],Engine:NativeHwpEngine):void{
 const targets:Array<BodyAnchor&{cell?:{table:number;index:number;paragraph:number}}>=bodies.map(body=>({...body}));
 pages.forEach((page,sec)=>{
  const xml=parse(files[`Contents/section${sec}.xml`]),root=direct(xml.documentElement,'p');
  all(xml,'tbl').forEach((table,tableIndex)=>all(table,'tc').forEach((cell,index)=>{
   const source=page.tableGeometry?.[tableIndex]?.cells[index]?.lines?.filter(line=>line.text.trim()),paragraphs=direct(direct(cell,'subList')[0],'p').map((p,i)=>({p,i})).filter(({p})=>nativeParagraphText(p).text.trim());
   if(!source?.some(line=>line.inputs?.length))return;
   if(source.length!==paragraphs.length)throw Error('HWP 표의 새 입력 문단 대응이 다릅니다.');
   source.forEach((line,i)=>{if(line.inputs?.length)targets.push({sec,para:root.findIndex(p=>all(p,'tbl').includes(table)),cell:{table:tableIndex,index,paragraph:paragraphs[i].i},block:{marker:'',kind:'text',left:0,top:0,width:0,height:0,lines:[line]}});});
  }));
 });
 if(!targets.length)return;
 const paragraph=(xml:Document,target:typeof targets[number])=>target.cell?direct(direct(all(all(xml,'tbl')[target.cell.table],'tc')[target.cell.index],'subList')[0],'p')[target.cell.paragraph]:direct(xml.documentElement,'p')[target.para];
 const header=parse(files['Contents/header.xml']),probe=parse(files['Contents/header.xml']),properties=all(header,'charPr'),container=properties[0]?.parentElement;
 let nextId=Math.max(...properties.map(p=>Number(p.getAttribute('id'))))+1,added=0;
 for(const target of targets){const p=paragraph(parse(files[`Contents/section${target.sec}.xml`]),target),id=p.getAttribute('paraPrIDRef');for(const definition of all(probe,'paraPr').filter(def=>def.getAttribute('id')===id))for(const align of all(definition,'align'))align.setAttribute('horizontal','LEFT');}
 const document=new Engine(zipSync({...files,'Contents/header.xml':write(probe)})) as Reader,definitions=new Map<string,string>();
 try{
  for(const entry of targets){
   const {sec,para,block,cell}=entry,path=`Contents/section${sec}.xml`,xml=parse(files[path]),p=paragraph(xml,entry),source=block.lines![0],target=new Map<number,number>();
   for(const input of source.inputs!)input.widths.forEach((width,i)=>target.set(input.from+i,width));
   const control=cell?(JSON.parse(document.getPageControlLayout(sec)).controls as Array<{type:string;controlIdx:number;cellPath?:unknown}>).filter(c=>c.type==='table'&&!c.cellPath)[cell.table]:undefined;
   if(cell&&!control)throw Error('HWP 표의 새 입력 위치가 없습니다.');
   const runs=(JSON.parse(document.getPageTextLayout(sec)).runs as Array<NativeGlyphRun&{charStart:number}>).filter(run=>cell?run.parentParaIdx===para&&JSON.stringify(run.cellPath)===JSON.stringify([{controlIndex:control!.controlIdx,cellIndex:cell.index,cellParaIndex:cell.paragraph}]):run.paraIdx===para&&!run.cellPath);
   let position=0;
   for(const run of direct(p,'run')){
    const text=nativeParagraphText(run).text,length=Array.from(text).length,start=position;position+=length;
    if(!Array.from({length},(_,i)=>target.has(start+i)).some(Boolean))continue;
    if([...run.children].some(child=>child.localName!=='t'||[...child.children].some(c=>!['tab','lineBreak'].includes(c.localName))))throw Error('HWP 새 입력의 글자 개체 경계가 다릅니다.');
    const original=properties.find(def=>def.getAttribute('id')===run.getAttribute('charPrIDRef'));
    if(!original||!container)throw Error('HWP 새 입력의 글꼴 서식이 없습니다.');
    const fontSize=Number(original.getAttribute('height'))/75,tokens:Array<string|Element>=[];
    for(const t of direct(run,'t'))for(const node of [...t.childNodes])if(node.nodeType===3)tokens.push(...Array.from(node.textContent||''));else if(node instanceof Element)tokens.push(node);
    const output:Element[]=[];let offset=0;
    for(const token of tokens){
     const at=start+offset++,desired=target.get(at),native=runs.find(r=>at>=r.charStart&&at<r.charStart+Array.from(r.text).length);
     let id=run.getAttribute('charPrIDRef')!;
     if(desired!==undefined){
      if(typeof token!=='string'||!native||!Number.isFinite(desired)||desired<=0)throw Error('HWP 새 글자의 실제 폭을 확인하지 못했습니다.');
      const index=at-native.charStart,advance=native.charX[index+1]-native.charX[index],delta=Math.round((desired-advance)/fontSize*100);
      if(!Number.isFinite(advance)||advance<=0||!Number.isSafeInteger(delta))throw Error('HWP 새 글자 폭의 수치가 잘못됐습니다.');
      if(delta){
       const key=id+':'+delta,cached=definitions.get(key);
       if(cached)id=cached;else{
        const clone=original.cloneNode(true) as Element;id=String(nextId++);clone.setAttribute('id',id);
        const spacings=all(clone,'spacing');if(!spacings.length)throw Error('HWP 글자 간격 속성이 없습니다.');
        for(const spacing of spacings)for(const a of [...spacing.attributes]){const value=Number(a.value)+delta;if(value< -50||value>50||!Number.isFinite(value))throw Error('HWP 새 글자 폭이 지원하는 자간 범위를 넘습니다.');spacing.setAttribute(a.name,String(value));}
        container.append(clone);definitions.set(key,id);added++;
       }
      }
     }
     let next=output.at(-1),t=next&&direct(next,'t')[0];
     if(!next||next.getAttribute('charPrIDRef')!==id){next=run.cloneNode(false) as Element;next.setAttribute('charPrIDRef',id);t=xml.createElementNS(ns,'hp:t');next.append(t);output.push(next);}
     t!.append(typeof token==='string'?xml.createTextNode(token):token.cloneNode(true));
    }
    run.replaceWith(...output);
   }
   if(nativeParagraphText(p).text!==source.text)throw Error('HWP 글자 폭 보정 중 문장이 달라졌습니다.');files[path]=write(xml);
  }
  if(added){container!.setAttribute('itemCnt',String(properties.length+added));files['Contents/header.xml']=write(header);}
 }finally{document.free();}
}

/** HWP rounds positions at native run boundaries. Correct an accumulated
 * drift only when the current editable line exceeds 0.5px, using standard
 * integer-percent character spacing and a bounded, verified feedback pass.
 * No original line cache, substituted font, inserted text or raster is used. */
function refineTextAdvances(files:Record<string,Uint8Array>,anchors:BodyAnchor[],pages:NativeHwpPage[],Engine:NativeHwpEngine):void{
 // Keep multiple TABs in their existing native run: the pinned engine starts
 // its TAB-width cursor again at each split run. Normal export already keeps
 // those groups intact; per-character feedback must not split them again.
 type Target=BodyAnchor&{cell?:{table:number;index:number;paragraph:number}};
 const candidates:Target[]=anchors.filter(a=>a.block.lines?.length===1&&a.block.lines[0].starts.length===1&&a.block.lines[0].glyphs?.length&&(a.block.lines[0].text.match(/\t/gu)?.length??0)<=1);
 // A right-aligned cell is positioned by the widths of all later runs.
 // Verify retained text as well as newly typed amounts against the current
 // web coordinates, rather than treating rounded advances independently.
 pages.forEach((page,sec)=>{
  const xml=parse(files[`Contents/section${sec}.xml`]),root=direct(xml.documentElement,'p');
  all(xml,'tbl').forEach((table,tableIndex)=>all(table,'tc').forEach((cell,index)=>{
   const geometry=page.tableGeometry?.[tableIndex]?.cells[index],source=geometry?.lines?.filter(line=>line.text.trim()),paragraphs=direct(direct(cell,'subList')[0],'p').map((p,i)=>({p,i})).filter(({p})=>nativeParagraphText(p).text.trim());
   source?.forEach((line,i)=>{
    const shortJustify=line.align==='justify'&&typeof line.widths?.[0]==='number'&&line.widths[0]<geometry!.width-geometry!.padding.left-geometry!.padding.right-.5;
    if((line.align!=='right'&&!(line.unmarkedInput&&(['left','start'].includes(line.align??'')||shortJustify)))||line.starts.length!==1||line.text.includes('\t')||!line.glyphs?.length)return;
    if(line.align!=='right'){
     const typed=new Set(line.inputs?.flatMap(input=>input.widths.map((_,i)=>input.from+i)));
     if(line.glyphs.some(glyph=>!typed.has(glyph.at)))return;
    }
    if(source.length!==paragraphs.length)throw Error('HWP 표의 정밀 글자 위치 대응이 다릅니다.');
    candidates.push({sec,para:root.findIndex(p=>all(p,'tbl').includes(table)),cell:{table:tableIndex,index,paragraph:paragraphs[i].i},block:{marker:'',kind:'text',left:0,top:0,width:0,height:0,lines:[line]}});
   });
  }));
 });
 if(!candidates.length)return;
 const positions=(document:Reader,entry:Target)=>{
  const runs=(JSON.parse(document.getPageTextLayout(entry.sec)).runs??[]) as Array<NativeGlyphRun&{charStart:number}>;
  const control=entry.cell?(JSON.parse(document.getPageControlLayout(entry.sec)).controls as Array<{type:string;controlIdx:number;cellPath?:unknown}>).filter(c=>c.type==='table'&&!c.cellPath)[entry.cell.table]:undefined;
  if(entry.cell&&!control)throw Error('HWP 표의 정밀 글자 위치가 없습니다.');
  const relevant=runs.filter(r=>r.parentParaIdx===entry.para&&r.text.trim()&&(!entry.cell||JSON.stringify(r.cellPath)===JSON.stringify([{controlIndex:control!.controlIdx,cellIndex:entry.cell.index,cellParaIndex:entry.cell.paragraph}])));
  const svg=parse(strToU8(document.renderPageSvgWithProfile?.(entry.sec,'print')??document.renderPageSvg(entry.sec)));
  const matched=resolveNativeHwpGlyphs(relevant,svg,why=>{throw Error(`HWP 글자 간격 대조: ${why}`);});
  return relevant.flatMap(r=>(matched.get(r)??[]).map(g=>({at:r.charStart+g.offset,x:Number(g.glyph.getAttribute('x')),end:Number(g.glyph.getAttribute('x'))+r.charX[g.offset+1]-r.charX[g.offset]}))).sort((a,b)=>a.at-b.at);
 };
 const terminalWidth=(entry:Target)=>{
  // For a wholly new left-aligned last line, keep the final advance too.
  // It has no following glyph to expose a width error. Centre/right alignment
  // and trailing whitespace have different anchoring and are excluded here.
  const line=entry.block.lines![0],last=line.glyphs!.at(-1)!;
  if(!entry.cell||!line.unmarkedInput||line.align==='right'||last.at!==Array.from(line.text).length-1)return;
  const input=line.inputs?.find(input=>last.at>=input.from&&last.at<input.from+input.widths.length);
  return input?.widths[last.at-input.from];
 };
 const errors=(actual:Array<{at:number;x:number;end:number}>,entry:Target)=>{
  const target=entry.block.lines![0].glyphs!,width=terminalWidth(entry);
  if(actual.length!==target.length||actual.some((g,i)=>g.at!==target[i].at))throw Error('HWP 검수한 글자 위치 대응이 다릅니다.');
  const result=actual.map((g,i)=>entry.cell?g.x-target[i].x:(g.x-actual[0].x)-(target[i].x-target[0].x));
  if(width!==undefined){
   const delta=actual.at(-1)!.end-target.at(-1)!.x-width;
   if(!Number.isFinite(delta))throw Error('HWP 마지막 글자의 폭을 대조하지 못했습니다.');
   result.push(delta);
  }
  return result;
 };
 const initial=new Engine(zipSync(files)) as Reader;let pending:Target[];
 try{pending=candidates.filter(entry=>errors(positions(initial,entry),entry).some(dx=>Math.abs(dx)>.5));}finally{initial.free();}
 for(const entry of pending){
  const path=`Contents/section${entry.sec}.xml`,xml=parse(files[path]),carrier=direct(xml.documentElement,'p')[entry.para],p=entry.cell?direct(direct(all(all(xml,'tbl')[entry.cell.table],'tc')[entry.cell.index],'subList')[0],'p')[entry.cell.paragraph]:all(carrier,'drawText').flatMap(draw=>direct(direct(draw,'subList')[0],'p'))[0];
  if(!p||nativeParagraphText(p).text!==entry.block.lines![0].text)throw Error('HWP 정밀 글자 간격의 편집 문단이 다릅니다.');
  const header=parse(files['Contents/header.xml']),properties=all(header,'charPr'),container=properties[0]?.parentElement;
  if(!container)throw Error('HWP 정밀 글자 간격의 글꼴이 없습니다.');
  let id=Math.max(...properties.map(def=>Number(def.getAttribute('id'))))+1;
  const tokens:Array<{text:string|Element;definition:Element;run:Element}>=[];
  for(const run of direct(p,'run')){
   const original=properties.find(def=>def.getAttribute('id')===run.getAttribute('charPrIDRef'));
   if(!original||[...run.children].some(c=>c.localName!=='t'))throw Error('HWP 정밀 글자 간격의 문자 경계가 다릅니다.');
   for(const t of direct(run,'t'))for(const node of [...t.childNodes]){
    const parts= node.nodeType===3?Array.from(node.textContent||''):node instanceof Element&&['tab','lineBreak'].includes(node.localName)?[node]:null;
    if(!parts)throw Error('HWP 정밀 글자 간격의 문자 개체를 보존하지 못했습니다.');
    for(const token of parts){
     const definition=original.cloneNode(true) as Element;definition.setAttribute('id',String(id++));container.append(definition);
     const next=run.cloneNode(false) as Element;next.setAttribute('charPrIDRef',definition.getAttribute('id')!);
     const text=xml.createElementNS(ns,'hp:t');text.append(typeof token==='string'?xml.createTextNode(token):token.cloneNode(true));next.append(text);
     tokens.push({text:token,definition,run:next});
    }
   }
   run.remove();
  }
  const cache=direct(p,'linesegarray')[0];for(const token of tokens)p.insertBefore(token.run,cache??null);
  container.setAttribute('itemCnt',String(all(header,'charPr').length));
  const states=new Set<string>();let verified=false;
  for(let iteration=0;iteration<128;iteration++){
   files[path]=write(xml);files['Contents/header.xml']=write(header);
   const current=new Engine(zipSync(files)) as Reader;let dx:number[];
   try{dx=errors(positions(current,entry),entry);}finally{current.free();}
   const rightCell=entry.cell&&entry.block.lines![0].align==='right';
   let bad=dx.findIndex(value=>Math.abs(value)>.5);
   if(rightCell)for(let i=dx.length-1;i>bad;i--)if(Math.abs(dx[i])>.5){bad=i;break;}
   if(bad<0){verified=true;break;}
   const glyphs=entry.block.lines![0].glyphs!,terminal=bad===glyphs.length;
   const glyph=terminal?glyphs.at(-1)!:glyphs[bad];let before=glyph.at-(rightCell||terminal?0:1);
   while(before>=0&&typeof tokens[before]?.text!=='string')before--;
   if(before<0)throw Error('HWP 첫 글자 간격을 보존하지 못했습니다.');
   const spacings=all(tokens[before].definition,'spacing');if(!spacings.length)throw Error('HWP 표준 자간 속성이 없습니다.');
   for(const spacing of spacings)for(const a of [...spacing.attributes]){
    const value=Number(a.value)+(dx[bad]>0?(rightCell?1:-1):(rightCell?-1:1));
    if(!Number.isSafeInteger(value)||value< -50||value>50)throw Error('HWP 정밀 글자 간격이 표준 자간 범위를 넘습니다.');spacing.setAttribute(a.name,String(value));
   }
   const state=tokens.map(t=>all(t.definition,'spacing').map(s=>[...s.attributes].map(a=>a.value).join(',')).join('/')).join(';');
   if(states.has(state))throw Error('HWP 글자 간격이 수렴하지 않아 내보내기를 중단했습니다.');states.add(state);
  }
  if(!verified)throw Error('HWP 글자 간격 검수가 제한 횟수 안에 완료되지 않았습니다.');
  if(nativeParagraphText(p).text!==entry.block.lines![0].text)throw Error('HWP 정밀 글자 간격 처리 중 문장이 달라졌습니다.');
 }
}

/** A calibrated cell can place its visible paragraphs independently of the
 * empty paragraph's normal flow position. Encode that reviewed placement as
 * native TOP flow plus paragraph gaps, without changing cell padding, dropping
 * empty paragraphs or expanding their font sizes. */
function positionCellsWithEmptyParagraphs(files:Record<string,Uint8Array>,pages:NativeHwpPage[],Engine:NativeHwpEngine):void{
 const header=parse(files['Contents/header.xml']),properties=all(header,'paraPr'),container=properties[0]?.parentElement;
 let nextId=Math.max(...properties.map(p=>Number(p.getAttribute('id'))))+1,added=0;
 const records:Array<{sec:number;table:number;cell:number;source:NonNullable<NonNullable<NativeHwpPage['tableGeometry']>[number]['cells'][number]['lines']>}>=[];
 const spacing=(p:Element,before:number,after:number)=>{
  const definition=all(header,'paraPr').find(def=>def.getAttribute('id')===p.getAttribute('paraPrIDRef'));
  if(!definition||!container||before<0||after<0)throw Error('HWP 셀의 검수된 문단 간격을 보존하지 못했습니다.');
  const clone=definition.cloneNode(true) as Element;clone.setAttribute('id',String(nextId++));
  for(const [name,value]of [['prev',before],['next',after]] as const)for(const margin of all(clone,name)){
   let parent=margin.parentElement,inCase=false;while(parent&&parent!==clone){if(parent.localName==='case')inCase=true;parent=parent.parentElement;}
   margin.setAttribute('value',String(Math.round(value*(inCase?75:150))));
  }
  container.append(clone);p.setAttribute('paraPrIDRef',clone.getAttribute('id')!);added++;
  const first=all(p,'lineseg')[0];if(first)first.setAttribute('vertpos',String(hu(before)));
 };
 pages.forEach((page,sec)=>{
  if(!page.positioned)return;const path=`Contents/section${sec}.xml`,xml=parse(files[path]);
  all(xml,'tbl').forEach((table,tableIndex)=>all(table,'tc').forEach((cell,cellIndex)=>{
   const source=page.tableGeometry?.[tableIndex]?.cells[cellIndex]?.lines;
   if(!source?.some(line=>line.empty)||!source.some(line=>line.text.trim()))return;
   const sub=direct(cell,'subList')[0],paragraphs=direct(sub,'p');
   if(paragraphs.some(p=>all(p,'pic').length||all(p,'tbl').length))return;
   if(paragraphs.length!==source.length||source.some(line=>!line.anchor))throw Error('HWP 빈 문단의 현재 위치를 확인하지 못했습니다.');
   if(paragraphs.some((p,i)=>nativeParagraphText(p).text!==source[i].text))throw Error('HWP 빈 문단을 포함한 셀의 문장 대응이 다릅니다.');
   sub.setAttribute('vertAlign','TOP');paragraphs.forEach(p=>spacing(p,0,0));records.push({sec,table:tableIndex,cell:cellIndex,source});
  }));files[path]=write(xml);
 });
 if(!records.length)return;
 container!.setAttribute('itemCnt',String(properties.length+added));files['Contents/header.xml']=write(header);
 const document=new Engine(zipSync(files)) as Reader;
 try{
  for(const record of records){
   const {sec,source}=record,path=`Contents/section${sec}.xml`,xml=parse(files[path]),cell=all(all(xml,'tbl')[record.table],'tc')[record.cell],paragraphs=direct(direct(cell,'subList')[0],'p');
   const control=(JSON.parse(document.getPageControlLayout(sec)).controls as Array<{type:string;paraIdx:number;controlIdx:number;cellPath?:unknown}>).filter(c=>c.type==='table'&&!c.cellPath)[record.table];
   if(!control)throw Error('HWP 빈 문단의 표 위치가 없습니다.');
   const runs=JSON.parse(document.getPageTextLayout(sec)).runs as NativeGlyphRun[],svg=parse(strToU8(document.renderPageSvgWithProfile?.(sec,'print')??document.renderPageSvg(sec)));
   resolveNativeHwpGlyphs(runs,svg,why=>{throw Error(`HWP 셀의 빈 문단 위치 대조: ${why}`);});
   const baselines=source.map((line,index)=>{
    if(line.empty){const cursor=JSON.parse(document.getCursorRectInCell(sec,control.paraIdx,control.controlIdx,record.cell,index,0));if(cursor.cellOverflowed||cursor.pageIndex!==sec||Math.abs(Number(cursor.height)-Number(line.fontSize))>.11)throw Error('HWP 빈 문단이 셀 밖으로 넘어갑니다.');return Number(cursor.y)+Number(line.fontSize)*.8;}
    return runs.find(run=>run.parentParaIdx===control.paraIdx&&run.text.trim()&&JSON.stringify(run.cellPath)===JSON.stringify([{controlIndex:control.controlIdx,cellIndex:record.cell,cellParaIndex:index}]))?.baseline;
   });
   if(baselines.some(value=>typeof value!=='number'||!Number.isFinite(value)))throw Error('HWP 셀의 문단 기준선이 없습니다.');
   const leading=source[0].anchor!.baseline-baselines[0]!;
   if(leading<-.06)throw Error('HWP 셀의 첫 문단 앞 위치를 보존하지 못했습니다.');
   for(let i=0;i<source.length;i++){
    const gap=i+1<source.length?(source[i+1].anchor!.baseline-source[i].anchor!.baseline)-(baselines[i+1]!-baselines[i]!):0;
    if(gap<-.06)throw Error('HWP 셀의 문단이 겹쳐 기본 간격으로 보존할 수 없습니다.');
    spacing(paragraphs[i],i===0?Math.max(0,leading):0,Math.max(0,gap));
   }
   files[path]=write(xml);
  }
  container!.setAttribute('itemCnt',String(properties.length+added));files['Contents/header.xml']=write(header);
 }finally{document.free();}
}

/** CSS import calibration can give neighbouring cell paragraphs independent
 * baseline offsets. Encode their current baseline progression as native
 * paragraph spacing, rather than losing it when HTML returns to native flow. */
function restoreCellParagraphGaps(files:Record<string,Uint8Array>,pages:NativeHwpPage[],Engine:NativeHwpEngine):void{
 const document=new Engine(zipSync(files)) as Reader,header=parse(files['Contents/header.xml']);
 const properties=all(header,'paraPr'),container=properties[0]?.parentElement;
 let nextId=Math.max(...properties.map(p=>Number(p.getAttribute('id'))))+1,added=0;
 try{
  pages.forEach((page,sec)=>{
   if(!page.positioned||!page.tableGeometry?.some(t=>t.cells.some(c=>c.lines&&c.lines.filter(l=>l.text.trim()).length>1)))return;
   const path=`Contents/section${sec}.xml`,xml=parse(files[path]);
   const runs=JSON.parse(document.getPageTextLayout(sec)).runs as NativeGlyphRun[];
   const svg=parse(strToU8(document.renderPageSvgWithProfile?.(sec,'print')??document.renderPageSvg(sec)));
   resolveNativeHwpGlyphs(runs,svg,why=>{throw Error(`HWP 셀 문단 위치 대조: ${why}`);});
   const controls=(JSON.parse(document.getPageControlLayout(sec)).controls as Array<{type:string;secIdx:number;paraIdx:number;controlIdx:number;cellPath?:unknown}>).filter(c=>c.type==='table'&&!c.cellPath);
   all(xml,'tbl').forEach((table,tableIndex)=>{
    const control=controls[tableIndex];if(!control)throw Error('HWP 셀 문단의 표 위치가 없습니다.');
    all(table,'tc').forEach((cell,cellIndex)=>{
     const source=page.tableGeometry?.[tableIndex]?.cells[cellIndex]?.lines?.filter(line=>line.text.trim());if(!source||source.length<2)return;
     const paragraphs=direct(direct(cell,'subList')[0],'p'),visible=paragraphs.map((p,index)=>({p,index})).filter(({p})=>nativeParagraphText(p).text.trim());
     if(source.length!==visible.length)throw Error('HWP 셀 문단의 기준선 대응이 다릅니다.');
     const baselines=visible.map(({index})=>runs.find(run=>run.secIdx===sec&&run.parentParaIdx===control.paraIdx&&run.text.trim()&&JSON.stringify(run.cellPath)===JSON.stringify([{controlIndex:control.controlIdx,cellIndex,cellParaIndex:index}]))?.baseline);
     for(let i=0;i<source.length-1;i++){
      const a=source[i].anchor,b=source[i+1].anchor,x=baselines[i],y=baselines[i+1];if(!a||!b||typeof x!=='number'||typeof y!=='number')throw Error('HWP 셀 문단의 현재 기준선이 없습니다.');
      const delta=(b.baseline-a.baseline)-(y-x);if(Math.abs(delta)<.03)continue;
      const p=visible[i].p,definition=properties.find(def=>def.getAttribute('id')===p.getAttribute('paraPrIDRef'));
      if(!definition||!container)throw Error('HWP 셀 문단 간격 속성이 없습니다.');
      const clone=definition.cloneNode(true) as Element;clone.setAttribute('id',String(nextId++));
      const next=all(clone,'next');if(!next.length)throw Error('HWP 셀 문단 뒤 간격이 없습니다.');
      for(const margin of next){let parent=margin.parentElement,inCase=false;while(parent&&parent!==clone){if(parent.localName==='case')inCase=true;parent=parent.parentElement;}const value=Number(margin.getAttribute('value'))+Math.round(delta*(inCase?75:150));if(!Number.isFinite(value)||value<0)throw Error('HWP 셀 문단 간격이 음수가 됩니다.');margin.setAttribute('value',String(value));}
      container.append(clone);p.setAttribute('paraPrIDRef',clone.getAttribute('id')!);added++;
     }
    });
   });files[path]=write(xml);
  });
  if(added){container!.setAttribute('itemCnt',String(properties.length+added));files['Contents/header.xml']=write(header);}
 }finally{document.free();}
}

/** Convert fresh native paragraphs into native page-anchored textboxes. No
 * screenshot or old source file is substituted for the current edited DOM. */
export function positionNativeHwp(files:Record<string,Uint8Array>,pages:NativeHwpPage[],Engine:NativeHwpEngine):Uint8Array{
 const source=new Engine(zipSync(files));
 let generated:Record<string,Uint8Array>;
 try{
  pages.forEach((page,sec)=>{
   if(!page.positioned)return;
   const xml=parse(files[`Contents/section${sec}.xml`]),paragraphs=direct(xml.documentElement,'p');
   for(const block of page.positioned){
    if(!['text','rule'].includes(block.kind)||bodyBlock(block))continue;
    const para=paragraphs.findIndex(p=>text(p)===block.marker);
    if(para<0)throw Error('HWP 고정 배치 경계를 찾지 못했습니다.');
    const width=block.width;
    const created=check(source.createShapeControl(JSON.stringify({sectionIdx:sec,paraIdx:para,charOffset:0,shapeType:block.kind==='text'?'textbox':'line',width:Math.max(1,hu(width)),height:Math.max(1,hu(block.height+(block.kind==='text'?4:0))),horzOffset:hu(block.left),vertOffset:hu(block.top),treatAsChar:false,textWrap:'InFrontOfText'})));
    const rgb=block.color||'#000000',bgr=parseInt(rgb.slice(1).match(/../gu)!.reverse().join(''),16);
    check(source.setShapeProperties(sec,created.paraIdx,created.controlIdx,JSON.stringify({horzRelTo:'Paper',vertRelTo:'Paper',fillType:'none',borderWidth:block.kind==='rule'?hu(block.stroke||1):0,borderColor:bgr,lineType:block.lineStyle==='dotted'?3:block.lineStyle==='dashed'?2:1})));
   }
  });
  generated=unzipSync(source.exportHwpx());
 }finally{source.free();}
 const anchors:BodyAnchor[]=[],bodies:BodyAnchor[]=[];
 const header=parse(generated['Contents/header.xml']);
 pages.forEach((page,sec)=>{
  if(!page.positioned)return;
  const path=`Contents/section${sec}.xml`,xml=parse(generated[path]),root=xml.documentElement;
  const original=direct(root,'p');
  for(const paragraph of all(root,'p'))mergeNativeTextRuns(paragraph);
  const carriers=new Map<Element,NonNullable<NativeHwpPage['positioned']>[number]>();
  page.positioned.forEach((block,index)=>{
   const carrier=original.find(p=>text(p)===block.marker),nextMarker=page.positioned![index+1]?.marker;
   if(!carrier)throw Error('HWP 고정 배치 표식이 누락되었습니다.');
   carriers.set(carrier,block);
   const start=original.indexOf(carrier),end=nextMarker?original.findIndex(p=>text(p)===nextMarker):original.length;
   const body=original.slice(start+1,end);
   if(block.kind==='text'){
    if(bodyBlock(block)){
     if(body.length!==1||all(body[0],'tbl').length||all(body[0],'pic').length)throw Error('HWP 줄별 본문 배치의 문단이 다릅니다.');
     // The section setup paragraph suppresses its own leading space. Keep
     // that native setup on a separate empty carrier so the first authored
     // body paragraph can retain its reviewed vertical position as well.
     if(all(carrier,'secPr').length){
      const setup=carrier.cloneNode(false) as Element;setup.setAttribute('id',String(Math.max(...all(root,'p').map(p=>Number(p.getAttribute('id'))||0))+1));
      const run=xml.createElementNS(ns,'hp:run');run.setAttribute('charPrIDRef','0');
      for(const originalRun of direct(carrier,'run'))for(const child of [...originalRun.children])if(child.localName!=='t')run.append(child);
      setup.append(run);carrier.before(setup);
     }
     for(const t of all(carrier,'t'))if(t.textContent===block.marker)t.textContent='';
     for(const a of [...body[0].attributes])if(a.name!=='id')carrier.setAttribute(a.name,a.value);
     carrier.append(...body[0].children);body[0].remove();setNativeParagraphLines(carrier,block.lines![0],block.width,header,false,true);
    }else{
    const shape=all(carrier,'rect')[0],draw=shape&&all(shape,'drawText')[0],sub=draw&&direct(draw,'subList')[0];
    if(!shape||!draw||!sub||!body.length||body.some(p=>all(p,'tbl').length||all(p,'pic').length))throw Error('HWP 글상자에 본문 문단을 연결하지 못했습니다.');
    sub.replaceChildren(...body);attrs(sub,{lineWrap:'BREAK'});
    const margin=direct(draw,'textMargin')[0];if(!margin)throw Error('HWP 글상자 안쪽 여백이 없습니다.');attrs(margin,{left:0,right:0,top:0,bottom:0});
    if(block.lines?.length!==body.length)throw Error('HWP 글상자의 편집 문단 수가 다릅니다.');
    body.forEach((p,i)=>setNativeParagraphLines(p,block.lines![i],block.width,header));
    for(const fill of direct(shape,'fillBrush'))fill.remove();
    }
   }else if(block.kind==='rule'){
    const line=all(carrier,'line')[0];if(!line||body.length)throw Error('HWP 장식선 배치가 다릅니다.');
    const begin=all(line,'startPt')[0],end=all(line,'endPt')[0];if(!begin||!end)throw Error('HWP 장식선 끝점이 없습니다.');attrs(begin,{x:0,y:0});attrs(end,{x:hu(block.width),y:hu(block.height)});
   }else{
    if(body.length!==1)throw Error('HWP 표·사진의 고정 배치 문단 수가 다릅니다.');
    const control=all(body[0],block.kind==='table'?'tbl':'pic')[0];if(!control)throw Error('HWP 표·사진이 누락되었습니다.');
    const pos=direct(control,'pos')[0];if(!pos)throw Error('HWP 개체 위치가 없습니다.');
    attrs(pos,{treatAsChar:0,affectLSpacing:0,flowWithText:0,allowOverlap:1,vertRelTo:'PAPER',horzRelTo:'PAPER',vertAlign:'TOP',horzAlign:'LEFT',vertOffset:hu(block.top),horzOffset:hu(block.left)});
    attrs(control,{textWrap:'IN_FRONT_OF_TEXT'});
    const outer=direct(control,'outMargin')[0];if(outer)attrs(outer,{left:0,right:0,top:0,bottom:0});
    // Keep section/column setup on the outer carrier, never inside a textbox.
    const run=xml.createElementNS(ns,'hp:run');run.setAttribute('charPrIDRef','0');run.append(control);carrier.append(run);body[0].remove();
   }
   // The marker itself is not authored content. Textboxes retain only their
   // native editable sub-paragraphs, tables retain their actual cell content.
   for(const run of direct(carrier,'run'))for(const t of direct(run,'t'))if(t.textContent===block.marker)t.textContent='';
   if(!bodyBlock(block))for(const cache of direct(carrier,'linesegarray'))cache.remove();
  });
  for(const [para,p]of direct(root,'p').entries()){
   const block=carriers.get(p);
   if(block?.kind==='text'&&block.anchor)(bodyBlock(block)?bodies:anchors).push({sec,para,block});
  }
  all(root,'tbl').forEach((table,index)=>{
   all(table,'tc').forEach((cell,cellIndex)=>{
    const geometry=page.tableGeometry?.[index]?.cells[cellIndex];if(!geometry?.lines)return;
    const allParagraphs=direct(direct(cell,'subList')[0],'p'),withEmpty=geometry.lines.some(line=>line.empty)&&allParagraphs.length===geometry.lines.length&&!allParagraphs.some(p=>all(p,'pic').length||all(p,'tbl').length);
    const source=withEmpty?geometry.lines:geometry.lines.filter(line=>line.text.trim()),paragraphs=withEmpty?allParagraphs:allParagraphs.filter(p=>nativeParagraphText(p).text.trim());
    if(source.length!==paragraphs.length)throw Error('HWP 표 셀의 편집 문단 수가 다릅니다.');
    paragraphs.forEach((p,i)=>setNativeParagraphLines(p,source[i],Math.max(1,geometry.width-geometry.padding.left-geometry.padding.right),header,true));
   });
  });
  generated[path]=write(xml);
 });
 generated['Contents/header.xml']=write(header);
 calibrateBodyInputs(generated,bodies,pages,Engine);
 positionCellsWithEmptyParagraphs(generated,pages,Engine);
 restoreCellParagraphGaps(generated,pages,Engine);
 refineTextAdvances(generated,anchors,pages,Engine);
 const positioned=new Engine(zipSync(generated)) as Reader;
 const cellBaselines:Array<{page:number;table:number;cell:number;paragraph:number;delta:number}>=[];
 try{
  if(positioned.pageCount()!==pages.length)throw Error(`HWP 고정 배치 쪽수가 다릅니다 (${positioned.pageCount()}/${pages.length}).`);
  for(let page=0;page<pages.length;page++){
   const runs=(JSON.parse(positioned.getPageTextLayout(page)).runs??[]) as NativeGlyphRun[];
   const svg=new DOMParser().parseFromString(positioned.renderPageSvgWithProfile?.(page,'print')??positioned.renderPageSvg(page),'image/svg+xml');
   const matched=resolveNativeHwpGlyphs(runs,svg,why=>{throw Error(`HWP 출력 위치 대조: ${why}`);});
   const controls=JSON.parse(positioned.getPageControlLayout(page)).controls as Array<{type:string;secIdx:number;paraIdx:number;controlIdx:number;x:number;y:number;cellPath?:unknown}>;
   for(const entry of anchors.filter(anchor=>anchor.sec===page)){
    const control=controls.find(c=>c.type==='shape'&&c.secIdx===entry.sec&&c.paraIdx===entry.para);
    const first=runs.find(r=>r.secIdx===entry.sec&&r.parentParaIdx===entry.para&&r.text.trim()&&matched.has(r));
    const glyph=first&&matched.get(first)?.[0].glyph;
    if(!control||!glyph)throw Error('HWP 출력 글상자의 첫 글자 대조가 없습니다.');
    const dx=entry.block.anchor!.x-Number(glyph.getAttribute('x')),dy=entry.block.anchor!.baseline-Number(glyph.getAttribute('y'));
    check(positioned.setShapeProperties(entry.sec,entry.para,control.controlIdx,JSON.stringify({horzOffset:hu(entry.block.left+dx),vertOffset:hu(entry.block.top+dy)})));
   }
   // Plain text typed into a formerly empty cell has no imported baseline
   // offset. Preserve its measured baseline in the native single-line cache.
   const tables=all(parse(generated[`Contents/section${page}.xml`]),'tbl'),tableControls=controls.filter(c=>c.type==='table'&&!c.cellPath);
   pages[page].tableGeometry?.forEach((table,tableIndex)=>table.cells.forEach((cell,cellIndex)=>{
    const source=cell.lines?.filter(line=>line.text.trim());if(!source?.some(line=>line.unmarkedInput&&line.starts.length===1))return;
    const control=tableControls[tableIndex],nativeCell=tables[tableIndex]&&all(tables[tableIndex],'tc')[cellIndex];
    if(!control||!nativeCell)throw Error('HWP 새 셀 글자의 위치가 없습니다.');
    const paragraphs=direct(direct(nativeCell,'subList')[0],'p').map((p,index)=>({p,index})).filter(({p})=>nativeParagraphText(p).text.trim());
    if(paragraphs.length!==source.length)throw Error('HWP 새 셀 글자의 문단 대응이 다릅니다.');
    source.forEach((line,index)=>{
     if(!line.unmarkedInput||line.starts.length!==1)return;
     const paragraph=paragraphs[index];if(nativeParagraphText(paragraph.p).text!==line.text||!line.anchor)throw Error('HWP 새 셀 글자의 원고가 다릅니다.');
     const run=runs.find(r=>r.secIdx===page&&r.parentParaIdx===control.paraIdx&&r.text.trim()&&JSON.stringify(r.cellPath)===JSON.stringify([{controlIndex:control.controlIdx,cellIndex,cellParaIndex:paragraph.index}])&&matched.has(r));
     const glyph=run&&matched.get(run)?.[0].glyph;if(!glyph)throw Error('HWP 새 셀 글자의 기준선이 없습니다.');
     const delta=hu(line.anchor.baseline-Number(glyph.getAttribute('y')));
     if(delta)cellBaselines.push({page,table:tableIndex,cell:cellIndex,paragraph:paragraph.index,delta});
    });
   }));
  }
  const output=unzipSync(positioned.exportHwpx());
  for(const entry of cellBaselines){
   const path=`Contents/section${entry.page}.xml`,xml=parse(output[path]),cell=all(all(xml,'tbl')[entry.table],'tc')[entry.cell],paragraph=direct(direct(cell,'subList')[0],'p')[entry.paragraph],segments=all(paragraph,'lineseg');
   if(segments.length!==1)throw Error('HWP 새 셀 글자의 줄 수가 다릅니다.');
   const baseline=Number(segments[0].getAttribute('baseline'))+entry.delta,height=Number(segments[0].getAttribute('vertsize'));
   if(!Number.isSafeInteger(baseline)||baseline<=0||baseline>height)throw Error('HWP 새 셀 글자의 기준선이 줄 범위를 벗어납니다.');
   segments[0].setAttribute('baseline',String(baseline));output[path]=write(xml);
  }
  if(bodies.length){
   const definitions=parse(output['Contents/header.xml']),properties=all(definitions,'paraPr'),container=properties[0]?.parentElement;
   let id=Math.max(...properties.map(p=>Number(p.getAttribute('id'))))+1,added=0;
   for(const {sec,para,block}of bodies){
    // Earlier body paragraphs change the flow origin of later ones. Measure
    // each against the already corrected file, not the initial snapshot.
    container!.setAttribute('itemCnt',String(properties.length+added));output['Contents/header.xml']=write(definitions);
    const current=new Engine(zipSync(output)) as Reader;
    try{
    const runs=(JSON.parse(current.getPageTextLayout(sec)).runs??[]) as Array<NativeGlyphRun&{charStart:number}>;
    const svg=parse(strToU8(current.renderPageSvgWithProfile?.(sec,'print')??current.renderPageSvg(sec))),matched=resolveNativeHwpGlyphs(runs,svg,why=>{throw Error(`HWP 본문 줄 위치 대조: ${why}`);});
    const glyphs=runs.filter(run=>run.paraIdx===para&&!run.cellPath).flatMap(run=>(matched.get(run)??[]).map(m=>({at:run.charStart+m.offset,glyph:m.glyph}))).sort((a,b)=>a.at-b.at);
    const first=glyphs[0]?.glyph;if(!first)throw Error('HWP 본문 첫 글자가 없습니다.');
    const path=`Contents/section${sec}.xml`,xml=parse(output[path]),p=direct(xml.documentElement,'p')[para],source=block.lines![0],segments=all(p,'lineseg');
    if(segments.length!==source.starts.length)throw Error('HWP 본문 줄 수가 다릅니다.');
    const dy=block.anchor!.baseline-Number(first.getAttribute('y'));
    const definition=properties.find(def=>def.getAttribute('id')===p.getAttribute('paraPrIDRef'));
    if(!definition||!container||dy<-.06)throw Error('HWP 본문 앞 위치를 보존하지 못했습니다.');
    const clone=definition.cloneNode(true) as Element;clone.setAttribute('id',String(id++));
    for(const margin of all(clone,'prev')){let parent=margin.parentElement,inCase=false;while(parent&&parent!==clone){if(parent.localName==='case')inCase=true;parent=parent.parentElement;}margin.setAttribute('value',String(Number(margin.getAttribute('value'))+Math.round(Math.max(0,dy)*(inCase?75:150))));}
    container.append(clone);p.setAttribute('paraPrIDRef',clone.getAttribute('id')!);added++;
    segments.forEach((segment,line)=>{
     const glyph=glyphs.find(g=>g.at>=source.starts[line]&&g.at<(source.starts[line+1]??Array.from(source.text).length))?.glyph;
     if(!glyph||!Number.isFinite(source.firstXs?.[line]))throw Error('HWP 본문 줄의 첫 글자 위치가 없습니다.');
     segment.setAttribute('horzpos',String(Number(segment.getAttribute('horzpos'))+hu(source.firstXs![line]-Number(glyph.getAttribute('x')))));
     segment.setAttribute('vertpos',String(Number(segment.getAttribute('vertpos'))+hu(Math.max(0,dy))));
    });output[path]=write(xml);
    }finally{current.free();}
   }
   container!.setAttribute('itemCnt',String(properties.length+added));output['Contents/header.xml']=write(definitions);
  }
  return zipSync(output);
 }finally{positioned.free();}
}
