import type {NativeHwpLines} from './editable-hwp-export';

const ns='http://www.hancom.co.kr/hwpml/2011/paragraph';
const all=(element:Element|Document,name:string)=>Array.from(element.getElementsByTagName('*')).filter(child=>child.localName===name);

/** Adjacent HTML font spans may produce identical native runs. Native layout
 * rounds each run origin and resets inline tab measurement, so retain them as
 * one text run. Never merge section setup, shapes, pictures or other controls. */
export function mergeNativeTextRuns(paragraph:Element):void{
 const signature=(run:Element)=>JSON.stringify([...run.attributes].map(a=>[a.name,a.value]).sort());
 const merge=()=>{
  let previous:Element|undefined;
  for(const run of [...paragraph.children]){
   const textOnly=run.localName==='run'&&run.children.length>0&&[...run.children].every(t=>t.localName==='t'&&!t.attributes.length&&[...t.children].every(c=>['tab','lineBreak'].includes(c.localName)));
   if(!textOnly){previous=undefined;continue;}
   if(previous&&signature(previous)===signature(run)){
    const target=previous.lastElementChild!;
    for(const t of [...run.children])target.append(...t.childNodes);
    run.remove();
   }else previous=run;
  }
 };
 // Coalesce consecutive default-font TAB runs before looking for the text
 // style on either side of the entire TAB group.
 merge();
 const runs=[...paragraph.children];
 for(let i=1;i<runs.length-1;i++){
  const run=runs[i],before=runs[i-1],after=runs[i+1],tabs=all(run,'tab');
  const tabOnly=run.localName==='run'&&tabs.length>0&&[...run.children].every(t=>t.localName==='t'&&[...t.childNodes].every(n=>n instanceof Element?n.localName==='tab'&&Number(n.getAttribute('leader')||0)===0:!n.textContent));
  // Paste gives unstyled TABs a default font. If the two adjacent text runs
  // have the same style, a TAB needs no separate font boundary. Keeping that
  // boundary resets the native inline-TAB cursor and repeats earlier widths.
  if(tabOnly&&before.localName==='run'&&after.localName==='run'&&before.textContent?.length&&after.textContent?.length&&signature(before)===signature(after)&&[...run.attributes].every(a=>a.name==='charPrIDRef'||a.value===before.getAttribute(a.name))){
   run.setAttribute('charPrIDRef',before.getAttribute('charPrIDRef')!);
  }
 }
 merge();
}

/** HWP stores tabs in eight UTF-16 units, while the editable text uses one
 * character. Build this mapping from freshly generated text, never old caches. */
export function nativeParagraphText(paragraph:Element):{text:string;offsets:number[]}{
 let text='',wide=0;const offsets=[0];
 const push=(char:string,size:number)=>{text+=char;wide+=size;offsets.push(wide);};
 for(const t of all(paragraph,'t'))for(const node of Array.from(t.childNodes)){
  if(node.nodeType===3)for(const char of Array.from(node.textContent||''))push(char,char.length);
  else if(node instanceof Element&&node.localName==='lineBreak')push('\n',1);
  else if(node instanceof Element&&node.localName==='tab')push('\t',8);
  else throw Error('HWP 줄 배치에서 지원하지 않는 문자 제어입니다.');
 }
 return{text,offsets};
}

/** Record the actual edited web lines in the standard native line cache.
 * Native reflow can differ from a source file's saved typography by a few
 * letters; reflowing again before an explicit visual break adds a blank line. */
export function setNativeParagraphLines(paragraph:Element,source:NativeHwpLines,width:number,header:Document,cell=false,bodyGeometry=false):void{
 let {text,offsets}=nativeParagraphText(paragraph);
 // HTML paste normalizes a paragraph containing only spaces to an empty run.
 // Restore those exact authored spaces from the current DOM before checking
 // text and line positions; never substitute non-whitespace content.
 if(!text&&source.empty&&/^[ \u00a0\u3000]+$/u.test(source.text)&&!['pic','tbl','ctrl'].some(name=>all(paragraph,name).length)){
  const run=all(paragraph,'run').at(-1);if(!run)throw Error('HWP 공백 문단의 문자 서식이 없습니다.');
  let target=all(run,'t').at(-1);if(!target){target=paragraph.ownerDocument.createElementNS(ns,'hp:t');run.append(target);}
  target.append(paragraph.ownerDocument.createTextNode(source.text));({text,offsets}=nativeParagraphText(paragraph));
 }
 if(text!==source.text)throw Error('HWP 새 줄 배치의 문장이 현재 편집본과 다릅니다.');
 if(!text.trim()&&!source.empty)return;
 if(source.empty){
  const height=Math.round(Number(source.fontSize)*75),runs=all(paragraph,'run'),properties=all(header,'charPr');
  if(!Number.isSafeInteger(height)||height<=0||height>15000||!runs.length)throw Error('HWP 빈 문단의 글자 크기가 없습니다.');
  const reference=properties.find(def=>def.getAttribute('id')===runs[0].getAttribute('charPrIDRef'));
  if(!reference?.parentElement)throw Error('HWP 빈 문단의 글자 서식 참조가 없습니다.');
  const existing=properties.find(def=>Number(def.getAttribute('height'))===height&&[...def.attributes].every(a=>['id','height'].includes(a.name)||a.value===reference.getAttribute(a.name))&&[...def.children].map(e=>e.outerHTML).join('')===[...reference.children].map(e=>e.outerHTML).join(''));
  let definition=existing;
  if(!definition){definition=reference.cloneNode(true) as Element;definition.setAttribute('id',String(Math.max(...properties.map(def=>Number(def.getAttribute('id'))))+1));definition.setAttribute('height',String(height));reference.parentElement.append(definition);reference.parentElement.setAttribute('itemCnt',String(properties.length+1));}
  for(const run of runs)run.setAttribute('charPrIDRef',definition.getAttribute('id')!);
 }
 if(!Number.isFinite(source.lineHeight)||source.lineHeight<=0||!Number.isFinite(width)||width<=0||source.starts[0]!==0||source.starts.some((start,index)=>!Number.isSafeInteger(start)||start<0||start>=offsets.length||index>0&&start<=source.starts[index-1]))throw Error('HWP 새 줄 배치의 문자 위치가 잘못됐습니다.');
 const ids=new Set(all(paragraph,'run').map(run=>run.getAttribute('charPrIDRef')));
 const heights=all(header,'charPr').filter(def=>ids.has(def.getAttribute('id'))).map(def=>Number(def.getAttribute('height')));
 const height=Math.max(...heights);if(!Number.isFinite(height)||height<=0)throw Error('HWP 줄 배치의 글자 크기가 없습니다.');
 const boxHeight=cell&&source.starts.length===1?Math.max(height,Math.round(source.lineHeight*75)):height;
 const styles=new Map(all(header,'charPr').map(def=>[def.getAttribute('id'),Number(def.getAttribute('height'))]));
 let position=0;
 const runs=all(paragraph,'run').map(run=>{const from=position;position+=Array.from(nativeParagraphText(run).text).length;return{from,to:position,height:styles.get(run.getAttribute('charPrIDRef'))??height};});
 for(const old of all(paragraph,'linesegarray'))old.remove();
 const cache=paragraph.ownerDocument.createElementNS(ns,'hp:linesegarray');
 source.starts.forEach((start,line)=>{
  const segment=paragraph.ownerDocument.createElementNS(ns,'hp:lineseg');
  const end=source.starts[line+1]??Array.from(text).length,lineHeight=Math.max(0,...runs.filter(run=>run.from<end&&run.to>start).map(run=>run.height))||height;
  const attributes={textpos:offsets[start],vertpos:Math.round(line*source.lineHeight*75),vertsize:boxHeight,textheight:boxHeight,baseline:Math.round((cell&&source.starts.length===1?boxHeight:lineHeight)*.85),spacing:Math.round(source.lineHeight*75)-boxHeight,horzpos:bodyGeometry?Math.round(source.lefts![line]*75):0,horzsize:Math.round((bodyGeometry?source.widths![line]:width)*75),flags:393216};
  for(const [name,value]of Object.entries(attributes))segment.setAttribute(name,String(value));
  cache.append(segment);
 });paragraph.append(cache);
 // A paragraph split at a page boundary can end in a line which was fully
 // justified in the original paragraph. Preserve that reviewed word spacing;
 // ordinary short last lines retain normal JUSTIFY behavior.
 const lastWidth=source.widths?.at(-1);
 if(!cell&&source.starts.length===1&&source.align==='justify'&&!text.includes('\n')&&!/\s$/u.test(text)&&/\S +\S/u.test(text)&&typeof lastWidth==='number'&&Math.abs(lastWidth-width)<=.5){
  const properties=all(header,'paraPr'),definition=properties.find(def=>def.getAttribute('id')===paragraph.getAttribute('paraPrIDRef'));
  if(!definition?.parentElement)throw Error('HWP 마지막 줄 정렬의 문단 속성이 없습니다.');
  const clone=definition.cloneNode(true) as Element;clone.setAttribute('id',String(Math.max(...properties.map(def=>Number(def.getAttribute('id'))))+1));
  for(const align of all(clone,'align'))align.setAttribute('horizontal','DISTRIBUTE_SPACE');
  definition.parentElement.append(clone);definition.parentElement.setAttribute('itemCnt',String(properties.length+1));paragraph.setAttribute('paraPrIDRef',clone.getAttribute('id')!);
 }
}
