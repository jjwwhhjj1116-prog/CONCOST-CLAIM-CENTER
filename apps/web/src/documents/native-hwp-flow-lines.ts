import {strFromU8,strToU8} from 'fflate';
import type {NativeHwpPage,NativeHwpEngine} from './editable-hwp-export';
import {restoreNativeFlowAdvances} from './native-hwp-flow-advances';
import {nativeParagraphText,setNativeParagraphLines} from './native-hwp-line-cache';

/** Fresh web paragraphs use their reviewed line breaks instead of rewrapping
 * at native font-run boundaries. Loaded HWP and table cells keep their paths. */
export function restoreNativeFlowLines(files:Record<string,Uint8Array>,pages:NativeHwpPage[],Engine:NativeHwpEngine):void{
  if(!pages.some(page=>page.flowLines?.length||!page.positioned&&page.tableGeometry?.some(t=>t.cells.some(c=>c.lines?.length))))return;
  const parser=new DOMParser(),serializer=new XMLSerializer();
  const header=parser.parseFromString(strFromU8(files['Contents/header.xml']),'application/xml');
  pages.forEach((page,index)=>{
    if(page.positioned)return;
    const path=`Contents/section${index}.xml`,xml=parser.parseFromString(strFromU8(files[path]),'application/xml');
    const paragraphs=[...xml.documentElement.children].filter(child=>child.localName==='p');
    const bodyTables=[...xml.getElementsByTagName('*')].filter(node=>{if(node.localName!=='tbl')return false;for(let p=node.parentElement;p;p=p.parentElement)if(['header','footer','tbl'].includes(p.localName))return false;return true;});
    for(const [tableIndex,table]of bodyTables.entries())for(const [cellIndex,cell]of [...table.getElementsByTagName('*')].filter(n=>n.localName==='tc').entries()){
      const geometry=page.tableGeometry?.[tableIndex]?.cells[cellIndex];if(!geometry?.lines?.length)continue;
      const sub=[...cell.children].find(n=>n.localName==='subList')!,ps=[...sub.children].filter(n=>n.localName==='p'&&nativeParagraphText(n).text.trim()),lines=geometry.lines.filter(l=>l.text.trim());
      if(ps.length!==lines.length)throw Error('HWP 웹 표의 현재 문단 수가 다릅니다.');
      ps.forEach((p,i)=>{
        const source=lines[i];setNativeParagraphLines(p,source,geometry.width-geometry.padding.left-geometry.padding.right,header,true);
        if(!source.paint)return;
        const segments=[...p.getElementsByTagName('*')].filter(n=>n.localName==='lineseg');
        const ys=source.starts.map((start,line)=>source.paint!.origins.find(g=>g.at>=start&&g.at<(source.starts[line+1]??Infinity)&&g.y!==undefined)?.y);
        if(ys.some(y=>y===undefined))return;
        const height=Math.round(Math.max(source.fontSize??0,source.lineHeight)*75);let top=0;
        segments.forEach((segment,line)=>{
          const advance=line+1<ys.length?Math.round((ys[line+1]!-ys[line]!)*75):Math.round(source.lineHeight*75);
          if(advance<=0)throw Error('HWP 웹 셀의 줄 기준선 순서가 다릅니다.');
          for(const [key,value]of Object.entries({vertpos:top,vertsize:height,textheight:height,baseline:Math.round(height*.85),spacing:advance-height}))segment.setAttribute(key,String(value));
          top+=advance;
        });
      });
    }
    for(const source of page.flowLines??[]){
        const original=paragraphs[source.paragraphIndex];
        if(!original)throw Error('HWP 웹 본문의 문단 순서가 현재 원고와 다릅니다.');
        const copy=original.cloneNode(true) as Element;
        for(const run of [...copy.children])if(run.localName==='run'&&[...run.children].some(child=>child.localName!=='t'))run.remove();
        if(nativeParagraphText(copy).text!==source.text)throw Error('HWP 웹 본문의 줄 배치가 현재 원고와 다릅니다.');
        const properties=[...header.getElementsByTagName('*')].filter(node=>node.localName==='paraPr');
        const definition=properties.find(node=>node.getAttribute('id')===original.getAttribute('paraPrIDRef'));
        if(!definition?.parentElement)throw Error('HWP 목록 문단의 너비 속성이 없습니다.');
        const inset=page.width-page.margins.left-page.margins.right-source.width;
        if(inset<-.1||!Number.isFinite(inset))throw Error('HWP 목록 문단의 열 너비가 본문 밖입니다.');
        const clone=definition.cloneNode(true) as Element,id=String(Math.max(...properties.map(node=>Number(node.getAttribute('id'))))+1);
        clone.setAttribute('id',id);
        for(const right of [...clone.getElementsByTagName('*')].filter(node=>node.localName==='right')){
          let ancestor=right.parentElement,inCase=false;while(ancestor&&ancestor!==clone){if(ancestor.localName==='case')inCase=true;ancestor=ancestor.parentElement;}
          right.setAttribute('value',String(Math.round(Math.max(0,inset)*75)*(inCase?1:2)));
        }
        definition.parentElement.append(clone);definition.parentElement.setAttribute('itemCnt',String(properties.length+1));
        if(source.paint)for(const align of [...clone.getElementsByTagName('*')].filter(node=>node.localName==='align'))align.setAttribute('horizontal','LEFT');
        original.setAttribute('paraPrIDRef',id);copy.setAttribute('paraPrIDRef',id);
        setNativeParagraphLines(copy,source,source.width,header);
        for(const cache of [...original.children].filter(child=>child.localName==='linesegarray'))cache.remove();
        const cache=[...copy.children].find(child=>child.localName==='linesegarray');
        if(!cache)throw Error('HWP 웹 본문의 현재 줄 배치를 기록하지 못했습니다.');
        for(const [index,line] of [...cache.children].entries()){
          // The fresh paragraph uses normal document flow. An absolute page
          // offset here would restart the height cursor after margin changes.
          if(index)line.setAttribute('textpos',String(Number(line.getAttribute('textpos'))+[...original.children].filter(run=>run.localName==='run').flatMap(run=>[...run.children]).filter(node=>node.localName==='ctrl').length*8));
        }
        original.append(cache);
    }
    files[path]=strToU8(serializer.serializeToString(xml));
  });
  files['Contents/header.xml']=strToU8(serializer.serializeToString(header));
  restoreNativeFlowAdvances(files,pages,Engine);
}
