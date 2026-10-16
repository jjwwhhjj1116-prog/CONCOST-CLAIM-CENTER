export interface NativeGlyphRun {
 text:string;x:number;y:number;h:number;fontSize:number;charX:number[];baseline?:number;
 secIdx:number;paraIdx:number;parentParaIdx?:number;cellPath?:unknown;fontFamily:string;bold?:boolean;italic?:boolean;
}

/** Match native runs to the same document's painted glyphs, without guessing
 * the nearest repeated character or borrowing one SVG glyph for two runs. */
export function resolveNativeHwpGlyphs<T extends NativeGlyphRun>(runs:T[],svg:Document,fail:(why:string)=>never):Map<T,Array<{offset:number;glyph:Element}>>{
 const glyphs=Array.from(svg.getElementsByTagName('*')).filter(element=>element.localName==='text');
 const n=(e:Element,key:string)=>Number(e.getAttribute(key));
 const groups=new Map<string,Array<{run:T;offset:number;candidates:Element[]}>>();
 for(const run of runs)for(const [offset,char]of Array.from(run.text).entries()){
  if(/\s/u.test(char))continue;
  const candidates=glyphs.filter(glyph=>glyph.textContent===char&&Math.abs(n(glyph,'x')-run.x-run.charX[offset])<=.2&&Math.abs(n(glyph,'font-size')-run.fontSize)<=.1&&n(glyph,'y')>=run.y&&n(glyph,'y')<=run.y+run.h*2);
  const key=JSON.stringify([run.secIdx,run.parentParaIdx??run.paraIdx,run.cellPath??[],run.y,run.fontSize,run.fontFamily,run.bold,run.italic]);
  groups.set(key,[...(groups.get(key)??[]),{run,offset,candidates}]);
 }
 const used=new Set<Element>(),result=new Map<T,Array<{offset:number;glyph:Element}>>();
 while(groups.size){let progress=false;
  for(const [key,items]of groups){
   const candidates=items.map(item=>item.candidates.filter(glyph=>!used.has(glyph)));
   const common=[...new Set(candidates[0].map(glyph=>n(glyph,'y')))].filter(y=>candidates.every(list=>list.some(glyph=>Math.abs(n(glyph,'y')-y)<=.1)));
   if(common.length!==1)continue;
   const matches=candidates.map(list=>list.filter(glyph=>Math.abs(n(glyph,'y')-common[0])<=.1));
   if(matches.some(list=>list.length!==1)||new Set(matches.flat()).size!==items.length)fail('원본 글자 기준선 중복');
   items.forEach(({run,offset},index)=>{
    const glyph=matches[index][0],baseline=n(glyph,'y');
    if(run.baseline!==undefined&&Math.abs(run.baseline-baseline)>.1)fail('한 글자 구간의 여러 기준선');
    for(let e:Element|null=glyph;e;e=e.parentElement)if(e.hasAttribute('transform'))fail('기준선 변환 좌표');
    run.baseline=baseline;used.add(glyph);result.set(run,[...(result.get(run)??[]),{offset,glyph}]);
   });
   groups.delete(key);progress=true;
  }
  if(!progress)fail('원본 글자 기준선 매핑');
 }
 for(const list of result.values())list.sort((a,b)=>a.offset-b.offset);
 return result;
}
