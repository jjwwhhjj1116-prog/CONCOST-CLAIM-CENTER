import {strFromU8,strToU8} from 'fflate';
import type {NativeHwpPage} from './editable-hwp-export';
import {nativeParagraphText,setNativeParagraphLines} from './native-hwp-line-cache';

/** Fresh web paragraphs use their reviewed line breaks instead of rewrapping
 * at native font-run boundaries. Loaded HWP and table cells keep their paths. */
export function restoreNativeFlowLines(files:Record<string,Uint8Array>,pages:NativeHwpPage[]):void{
  if(!pages.some(page=>page.flowLines?.length))return;
  const parser=new DOMParser(),serializer=new XMLSerializer();
  const header=parser.parseFromString(strFromU8(files['Contents/header.xml']),'application/xml');
  pages.forEach((page,index)=>{
    if(!page.flowLines?.length)return;
    const path=`Contents/section${index}.xml`,xml=parser.parseFromString(strFromU8(files[path]),'application/xml');
    const paragraphs=[...xml.documentElement.children].filter(child=>child.localName==='p');
    for(const source of page.flowLines){
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
        original.setAttribute('paraPrIDRef',id);copy.setAttribute('paraPrIDRef',id);
        setNativeParagraphLines(copy,source,source.width,header);
        for(const cache of [...original.children].filter(child=>child.localName==='linesegarray'))cache.remove();
        const cache=[...copy.children].find(child=>child.localName==='linesegarray');
        if(!cache)throw Error('HWP 웹 본문의 현재 줄 배치를 기록하지 못했습니다.');
        for(const line of [...cache.children])line.setAttribute('vertpos',String(Number(line.getAttribute('vertpos'))+Math.round(Math.max(0,source.top-page.margins.top)*75)));
        original.append(cache);
    }
    files[path]=strToU8(serializer.serializeToString(xml));
  });
  files['Contents/header.xml']=strToU8(serializer.serializeToString(header));
}
