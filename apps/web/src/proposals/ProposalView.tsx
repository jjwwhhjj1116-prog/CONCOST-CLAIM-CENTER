import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Card, Dialog, Input, Select, StatusBadge, type StatusType } from '@claim-studio/ui';
import DOMPurify from 'dompurify';
import './ProposalFinalization.css';
import { marked } from 'marked';
import { apiRequest } from '../api';
import { proposalBodyWithCompanyImages, sanitizeProposalCostData, hydrateProposalPublishedFacts } from '../../../cloudflare/src/proposal-company-content';
import { loadCaseOptions } from '../case-options';
import { claimTypeLabel } from '../claim-types';
import { AiGenerationProgressModal, type AiGenerationStatus } from '../components/AiGenerationProgressModal';
import { RhwpEditorDialog } from '../documents/RhwpEditorDialog';
import { DocumentToolMenus } from '../documents/DocumentToolMenus';
import { FileFormatIcon } from '../documents/FileFormatIcon';
import { DocumentPreviewPane } from '../documents/DocumentPreviewPane';
import { expandDocumentSpacingMarkers } from '../documents/document-spacing';
import { downloadFinalDocument, type FinalDocumentFormat } from '../documents/final-document-export';
import { StructuredDocumentEditor, markdownToEditorHtml, normalizeStructuredDocumentHtml, renderStructuredDocumentHtml, type StructuredDocumentEditorHandle, type StructuredSelection } from '../documents/StructuredDocumentEditor';
import { registerNavigationBlocker, type PendingNavigation } from '../navigation-guard';
import {
  proposalChapterWorkbook,
  proposalStudioWorkbook as proposalWorkbook,
  readProposalChapterWorkbook,
  readProposalStudioWorkbook as readProposalWorkbook,
} from './proposal-excel';

export interface ProposalViewProps { routeId:string; roles:readonly string[]; userEmail?:string; onNavigate:(path:string)=>void }
interface CaseItem { id:string; caseNumber:string; title:string; description?:string|null; claimType:string; status:string; clientName?:string|null }
interface ProposalTemplate { id:string; name:string; claimType:string; description:string; bodyTemplate:string; placeholdersJson:string }
interface ProposalChapter { number:number; title:string; kind:'VARIABLE'|'FIXED'; moduleCode?:string; body:string; editorJson?:import('@tiptap/core').JSONContent|null; excludedCompanyAssetKeys?:string[] }
interface CompanyModule { code:string; chapterNumber:number; title:string; category:string; bodyMarkdown:string; isActive:boolean; version:number; updatedAt:string }
interface CompanyAsset { assetKey:string;chapterNumber:number;displayOrder:number;title:string;altText:string;mimeType:string|null;fileName:string|null;sha256:string|null;width:number|null;height:number|null;hasContent:boolean;isActive:boolean;version:number;updatedAt:string|null }
interface TemplateSource { id:string; sourceName:string; sourceFormat:string; sourceDate:string; isDefault:boolean; analysisStatus:string; chapterMapJson:string; version:number }
type ProposalTemplateCategory='REDEVELOPMENT_FINANCE'|'REDEVELOPMENT_COST'|'CLAIM_LITIGATION'|'PRICE_ESCALATION'|'PUBLIC_SUPPORT'|'GENERAL_CLAIM';
interface ProposalTemplateType { id:ProposalTemplateCategory;label:string;description:string;representativeSourceId:string;representativeSourceName:string;sourceCount:number;promptReady:boolean }
interface ProposalVersion { id:string; versionNumber:number; bodyText:string; structuredInputsJson:string; generationMode:string; providerId:string|null; modelId:string|null; inputSha256:string; sourceDocumentVersionIdsJson:string|null; sha256:string; isApproved:boolean; createdAt:string; createdBy?:{id:string;name:string} }
interface ProposalReview { id:string; action:string; comment:string|null; createdAt:string; reviewer:{id:string;name:string} }
interface ProposalExport { id:string;versionId:string;format:string;fileName:string;sha256:string;sanitizationCount:number;createdAt:string }
interface Proposal { id:string;caseId:string;templateId:string;title:string;status:string;currentVersionId:string|null;approvedVersionId:string|null;version:number;template?:ProposalTemplate;versions?:ProposalVersion[];reviews?:ProposalReview[];exports?:ProposalExport[] }
interface StudioInputs { clientName:string;projectTitle:string;subtitle:string;submissionDate:string;keyIssues:string;objective:string;planNotes:string;exclusions:string;chapters:ProposalChapter[];includedModuleCodes:string[];templateSourceId?:string;templateSourceName?:string }

const chapterTitles=['제안(용역)의 목적','당 현장의 핵심 쟁점 분석','업무 수행 내용 및 추진 계획','전문가 현황','당사의 강점','조직도 및 업무 영역','도시정비사업 공사비검증 실적','한국부동산원 공사비검증 실적','건설 클레임·소송·기술감정 실적','자격 증명자료','용역 조건 및 제안 범위','맺음말'];
const blankChapters=():ProposalChapter[]=>chapterTitles.map((title,index)=>({number:index+1,title,kind:index>=3?'FIXED':'VARIABLE',body:'[작성 필요]'}));
const parseArray=(value:string|null|undefined):string[]=>{try{const parsed:unknown=JSON.parse(value??'[]');return Array.isArray(parsed)&&parsed.every((item)=>typeof item==='string')?parsed:[];}catch{return[];}};
const statusBadge=(status:string):StatusType=>['draft','in_review','approved','rejected'].includes(status.toLowerCase())?status.toLowerCase() as StatusType:'unwritten';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

async function proposalImageForUpload(source:File):Promise<File>{
  if(!['image/jpeg','image/png','image/webp'].includes(source.type))throw new Error('JPG, PNG 또는 WebP 원본 이미지만 삽입할 수 있습니다.');
  const bitmap=await createImageBitmap(source);
  const scale=Math.min(1,6000/bitmap.width,6000/bitmap.height);
  if(source.type==='image/jpeg'&&scale===1&&source.size<=8_000_000){bitmap.close();return source;}
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const context=canvas.getContext('2d');if(!context){bitmap.close();throw new Error('브라우저에서 원본 이미지를 처리하지 못했습니다.');}
  context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const toJpeg=(quality:number)=>new Promise<Blob|null>((resolve)=>canvas.toBlob(resolve,'image/jpeg',quality));
  let blob=await toJpeg(.96);if(blob&&blob.size>8_000_000)blob=await toJpeg(.9);
  if(!blob||blob.size>8_000_000)throw new Error('이미지가 너무 큽니다. 긴 변 6000px 이하 원본을 사용해 주세요.');
  return new File([blob],source.name.replace(/\.(?:png|webp)$/iu,'.jpg'),{type:'image/jpeg',lastModified:source.lastModified});
}

async function hwpSvgPageForUpload(svg:string,fileName:string):Promise<File>{
  const parsed=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;
  const viewBox=(parsed.getAttribute('viewBox')??'').split(/[ ,]+/u).map(Number);
  const sourceWidth=viewBox.length===4&&viewBox[2]>0?viewBox[2]:Number.parseFloat(parsed.getAttribute('width')??'794')||794;
  const sourceHeight=viewBox.length===4&&viewBox[3]>0?viewBox[3]:Number.parseFloat(parsed.getAttribute('height')??'1123')||1123;
  const width=Math.min(2400,Math.max(1200,Math.round(sourceWidth*2)));
  const height=Math.max(1,Math.round(width*sourceHeight/sourceWidth));
  const sourceUrl=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  try{
    const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const next=new Image();next.onload=()=>resolve(next);next.onerror=()=>reject(new Error('HWP 페이지 모양을 이미지로 변환하지 못했습니다.'));next.src=sourceUrl;});
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d');if(!context)throw new Error('HWP 페이지 변환용 캔버스를 만들지 못했습니다.');
    context.fillStyle='#fff';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob((value)=>value?resolve(value):reject(new Error('HWP 페이지 이미지를 압축하지 못했습니다.')),'image/jpeg',.94));
    return new File([blob],fileName,{type:'image/jpeg',lastModified:Date.now()});
  }finally{URL.revokeObjectURL(sourceUrl);}
}

function proposalChapterWithCompanyImages(chapter:ProposalChapter,assets:readonly CompanyAsset[]):ProposalChapter{
  const excluded=new Set(chapter.excludedCompanyAssetKeys??[]);
  const chapterAssets=assets.filter((asset)=>asset.chapterNumber===chapter.number&&asset.hasContent&&asset.isActive&&asset.assetKey!=='BRAND_LOGO'&&!excluded.has(asset.assetKey)).sort((a,b)=>a.displayOrder-b.displayOrder);
  if(!chapterAssets.length)return chapter;
  const body=proposalBodyWithCompanyImages(chapter.body,chapter.number,chapterAssets);let editorChanged=false;
  const nextEditorJson=chapter.editorJson?JSON.parse(JSON.stringify(chapter.editorJson)) as import('@tiptap/core').JSONContent:null;
  for(const asset of chapterAssets){
    const sourceBase=`/api/proposal-studio/assets/${asset.assetKey}`;
    // Preserve every manual table/font edit. Legacy JSON that predates a fixed
    // company image is repaired by appending only the missing image node.
    if(nextEditorJson&&!JSON.stringify(nextEditorJson).includes(sourceBase)){
      nextEditorJson.type ||= 'doc';
      nextEditorJson.content ||= [];
      nextEditorJson.content.push({type:'image',attrs:{src:`${sourceBase}?v=${asset.version}`,alt:asset.altText,title:asset.title,alignment:'center'}});
      editorChanged=true;
    }
  }
  return body!==chapter.body||editorChanged?{...chapter,body,editorJson:nextEditorJson}:chapter;
}
const proposalImageTokenPattern=/!\[[^\]]*\]\((?:<)?[^\s)>]+(?:>)?(?:\s+["'][^"']*["'])?\)|<img\b[^>]*\bsrc\s*=\s*(?:"[^"]+"|'[^']+'|[^\s>]+)[^>]*>/giu;
const proposalImageSource=(token:string):string=>{
  const markdown=token.match(/^!\[[^\]]*\]\((?:<)?([^\s)>]+)(?:>)?/iu);
  if(markdown?.[1])return markdown[1];
  const html=token.match(/\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/iu);
  return html?.[1]??html?.[2]??html?.[3]??'';
};
const normalizedProposalImageSource=(source:string):string=>source.trim().replace(/[?#].*$/u,'');
const deduplicateProposalImages=(body:string):string=>{
  const seen=new Set<string>();
  return body.replace(proposalImageTokenPattern,(token)=>{
    const source=normalizedProposalImageSource(proposalImageSource(token));
    if(!source)return token;
    if(seen.has(source))return '';
    seen.add(source);return token;
  });
};
const renderProposalBodyHtml=(body:string,assets:readonly CompanyAsset[],hydrateCompanyAssets:boolean):string=>{
  const source=hydrateCompanyAssets?proposalChapterWithCompanyImages({number:assets[0]?.chapterNumber??0,title:'',kind:'FIXED',body},assets).body:body;
  const rendered=marked.parse(expandDocumentSpacingMarkers(hydrateCompanyAssets?deduplicateProposalImages(source):source),{async:false,gfm:true,breaks:true});
  return DOMPurify.sanitize(normalizeStructuredDocumentHtml(typeof rendered==='string'?rendered:''),{
    ADD_ATTR:['data-document-spacer','data-document-page-break','data-image-align','data-table-width','data-table-align','data-table-density','data-cell-vertical-align','data-cell-horizontal-align','data-row-height-mm','colspan','rowspan','style','target','rel','width','height']
  });
};
const ProposalRichContent=React.memo(function ProposalRichContent({body,editorJson,assets=[],hydrateCompanyAssets=true}:{body:string;editorJson?:import('@tiptap/core').JSONContent|null;assets?:CompanyAsset[];hydrateCompanyAssets?:boolean}):React.ReactElement{
  const visible=assets.filter((asset)=>asset.hasContent&&asset.isActive).sort((a,b)=>a.displayOrder-b.displayOrder);
  const structuredHtml=editorJson?renderStructuredDocumentHtml(editorJson,{pageMode:'a4-portrait'}):'';
  const html=structuredHtml
    ? DOMPurify.sanitize(structuredHtml,{ADD_ATTR:['data-document-spacer','data-document-page-break','data-image-align','data-table-width','data-table-align','data-table-density','data-cell-vertical-align','data-cell-horizontal-align','data-row-height-mm','colspan','rowspan','style','target','rel','width','height']})
    : renderProposalBodyHtml(body,visible,hydrateCompanyAssets);
  return <article className="proposal-rich-content structured-editor__preview" dangerouslySetInnerHTML={{__html:html}}/>;
});

const PROPOSAL_PAGE_BODY_WIDTH=675;
const PROPOSAL_PAGE_BODY_HEIGHT=913;
const ignoreProposalPageCount=()=>undefined;

function proposalPageFragments(source:HTMLElement,host:HTMLElement):{fragments:string[];scale:number}{
  const images=[...source.querySelectorAll('img')];
  if(images.some(image=>!image.complete||!image.naturalWidth))return{fragments:[],scale:1};
  // Newly cloned HTTP images can have zero intrinsic height until decoded,
  // even when the source has loaded. Reserve the reviewed dimensions before
  // measuring any fragment. Only the temporary layout copy is changed.
  const measuredSource=source.cloneNode(true) as HTMLElement;
  measuredSource.querySelectorAll('img').forEach((image,index)=>{
    const original=images[index];const css=getComputedStyle(original);
    image.style.width=css.width;image.style.height=css.height;
  });
  const tester=source.cloneNode(false) as HTMLElement;
  tester.removeAttribute('aria-label');
  tester.style.cssText=`width:${PROPOSAL_PAGE_BODY_WIDTH}px;max-width:none;min-height:0;margin:0;padding:0;transform:none;`;
  host.append(tester);
  const fits=()=>tester.scrollHeight<=PROPOSAL_PAGE_BODY_HEIGHT&&tester.scrollWidth<=PROPOSAL_PAGE_BODY_WIDTH+1;
  tester.innerHTML='';tester.style.width='100%';
  const fragments:string[]=[];
  const commit=()=>{if(tester.childNodes.length){fragments.push(tester.innerHTML);tester.innerHTML='';}};
  const splitList=(list:HTMLElement)=>{
    const shell=()=>{const next=list.cloneNode(false) as HTMLElement;tester.append(next);return next;};
    let current=shell();
    for(const child of [...list.children]){current.append(child.cloneNode(true));if(!fits()){current.lastElementChild?.remove();commit();current=shell();current.append(child.cloneNode(true));}}
  };
  const splitTable=(table:HTMLTableElement)=>{
    const rows=[...table.querySelectorAll('tr')];
    const headerRows=rows.filter((row,index)=>row.parentElement?.tagName==='THEAD'||(index===0&&row.querySelector('th')));
    const bodyRows=rows.filter((row)=>!headerRows.includes(row));
    const shell=()=>{const next=table.cloneNode(false) as HTMLTableElement;for(const child of [...table.children])if(child.tagName==='COLGROUP'||child.tagName==='CAPTION')next.append(child.cloneNode(true));const body=document.createElement('tbody');for(const row of headerRows)body.append(row.cloneNode(true));next.append(body);tester.append(next);return body;};
    let body=shell();
    if(!fits()&&tester.children.length>1){tester.lastElementChild?.remove();commit();body=shell();}
    for(const row of bodyRows){body.append(row.cloneNode(true));if(!fits()){body.lastElementChild?.remove();commit();body=shell();body.append(row.cloneNode(true));}}
  };
  const sourceChildren=[...measuredSource.children] as HTMLElement[];
  // Tiptap's trailing empty cursor paragraph is not a printable blank page.
  // Keep the saved document and any styled/explicit page breaks unchanged.
  while(sourceChildren.length>1&&sourceChildren.at(-1)?.outerHTML==='<p></p>')sourceChildren.pop();
  for(let childIndex=0;childIndex<sourceChildren.length;childIndex+=1){
    const child=sourceChildren[childIndex];
    const following=sourceChildren[childIndex+1];
    if(child.hasAttribute('data-document-page-break')){commit();continue;}
    // Keep an image caption heading with its first picture on a fresh sheet.
    // Measure the same sibling layout, without adding a wrapper or changing source.
    if(/^H[1-6]$/u.test(child.tagName)&&following&&!following.hasAttribute('data-document-page-break')&&(following.tagName==='IMG'||following.querySelector('img'))){
      const heading=child.cloneNode(true) as HTMLElement,picture=following.cloneNode(true) as HTMLElement;
      const prior=[...tester.childNodes];tester.append(heading,picture);
      if(fits()){childIndex+=1;continue;}
      heading.remove();picture.remove();tester.replaceChildren(heading,picture);
      const fitsFresh=fits();tester.replaceChildren(...prior);
      if(fitsFresh){commit();tester.append(heading,picture);childIndex+=1;continue;}
    }
    // Existing list/photo grouping
    if((child.tagName==='UL'||child.tagName==='OL')&&following?.querySelector('img')){
      const group=document.createElement('div');group.className='proposal-content-keep-together';group.append(child.cloneNode(true),following.cloneNode(true));tester.append(group);
      if(!fits()){group.remove();commit();tester.append(group);if(!fits())tester.dataset.unbreakableOverflow='true';}
      childIndex+=1;continue;
    }
    const clone=child.cloneNode(true) as HTMLElement;
    tester.append(clone);
    if(fits())continue;
    clone.remove();
    if(child.tagName==='TABLE'){splitTable(child as HTMLTableElement);continue;}
    if(child.tagName==='UL'||child.tagName==='OL'){splitList(child as HTMLElement);continue;}
    commit();tester.append(clone);
    if(!fits())tester.dataset.unbreakableOverflow='true';
  }
  commit();
  const overflow=tester.dataset.unbreakableOverflow==='true';
  tester.remove();
  return{fragments:overflow?[]:fragments,scale:1};
}

export function ProposalFinalChapterPages({item,startPage,onPageCount}:{item:ProposalChapter;startPage:number;onPageCount:(chapter:number,count:number)=>void}):React.ReactElement{
  const sourceRef=useRef<HTMLDivElement>(null);
  const [layout,setLayout]=useState<{fragments:string[];scale:number;ready:boolean}>({fragments:[''],scale:1,ready:false});
  useLayoutEffect(()=>{
    const host=sourceRef.current;const source=host?.querySelector<HTMLElement>('.proposal-rich-content');if(!host||!source)return;
    let active=true;let frame=0;
    const paginate=()=>{window.cancelAnimationFrame(frame);frame=window.requestAnimationFrame(()=>{const next=proposalPageFragments(source,host);if(active)setLayout({fragments:next.fragments.length?next.fragments:[''],scale:next.scale,ready:next.fragments.length>0});});};
    const images=[...source.querySelectorAll('img')];
    images.forEach((image)=>{image.addEventListener('load',paginate,{once:true});image.addEventListener('error',paginate,{once:true});});
    window.addEventListener('resize',paginate);window.addEventListener('final-document:refit',paginate);void document.fonts?.ready.then(paginate);paginate();
    return()=>{active=false;window.cancelAnimationFrame(frame);window.removeEventListener('resize',paginate);window.removeEventListener('final-document:refit',paginate);images.forEach((image)=>{image.removeEventListener('load',paginate);image.removeEventListener('error',paginate);});};
  },[item.body,item.editorJson,item.number,item.title]);
  useEffect(()=>onPageCount(item.number,layout.fragments.length),[item.number,layout.fragments.length,onPageCount]);
  return <>
    <div ref={sourceRef} className="proposal-final-pagination-source proposal-final-chapter" aria-hidden="true"><ProposalRichContent body={item.body} editorJson={item.editorJson} hydrateCompanyAssets={false}/></div>
    {layout.fragments.map((html,index)=><section className="proposal-final-chapter" data-export-page data-export-page-policy="fit" data-page-fit-overflow={layout.ready?'false':'true'} data-page-fit-scale={layout.scale.toFixed(3)} data-page-number={startPage+index} data-chapter-number={item.number} data-chapter-page-index={index+1} key={`${item.number}-${index}`}>
      <header><span>CHAPTER {String(item.number).padStart(2,'0')}{index>0?` · CONTINUED ${index+1}`:''}</span><h3>{item.number}. {item.title}</h3></header>
      <div className="proposal-final-chapter__viewport"><div className="proposal-final-chapter__fit"><article className="proposal-rich-content structured-editor__preview" dangerouslySetInnerHTML={{__html:html}}/></div></div>
      <span className="proposal-final-chapter__fit-status" data-html2canvas-ignore="true">{layout.ready?(layout.fragments.length>1?`A4 ${index+1}/${layout.fragments.length} · 담당자 검수 크기 100% · 표 행·문단 자동 나눔`:'A4 1페이지 · 담당자 검수 크기 100%'):'A4 페이지 계산 중'}</span>
    </section>)}
  </>;
}

function ProposalCoverPage({projectTitle,subtitle,clientName,submissionDate}:{projectTitle:string;subtitle:string;clientName:string;submissionDate:string}):React.ReactElement{
  const normalizedDate=submissionDate.replaceAll('-','. ');
  return <section className="proposal-final-cover" data-export-page data-export-page-policy="fit" data-page-number="1">
    <div className="proposal-cover-frame" aria-hidden="true"/>
    <div className="proposal-cover-heading"><p>{projectTitle}</p><div><h2>{subtitle}</h2><strong>용역 제안서</strong></div></div>
    <time dateTime={submissionDate}>{normalizedDate}</time>
    <footer><img className="proposal-template-logo" src="/api/proposal-studio/assets/BRAND_LOGO?v=1" alt="주식회사 컨코스트"/><div><b>주식회사 컨코스트 / 하파트 공사비 연구소</b><span>(06616) 서울시 송파구 법원로4길 18, 5C. TOWER 5F</span><span>Tel. 02) 2203-1463, 1467　 Fax. 02) 2203-1464, 1468</span><span>www.con-cost.com　 E-mail. ceo@con-cost.com</span><small>제출처 · {clientName}</small></div></footer>
  </section>;
}

function ProposalTableOfContentsPage({chapters,pageCounts}:{chapters:ProposalChapter[];pageCounts:Record<number,number>}):React.ReactElement{
  let precedingPages=0;
  return <section className="proposal-final-toc" data-export-page data-export-page-policy="fit" data-page-number="2"><span>TABLE OF CONTENTS</span><h3>목 차</h3><ol>{chapters.map((item)=>{const page=3+precedingPages;precedingPages+=pageCounts[item.number]??1;return <li key={item.number}><b>{String(item.number).padStart(2,'0')}</b><span>{item.title}</span><i>{String(page).padStart(2,'0')}</i></li>;})}</ol></section>;
}

function ProposalPageNavigation({root}:{root:React.RefObject<HTMLDivElement>}):React.ReactElement{
  const [pages,setPages]=useState<HTMLElement[]>([]);
  const [selected,setSelected]=useState(1);
  useEffect(()=>{
    const host=root.current;if(!host)return;
    const update=()=>{const next=Array.from(host.querySelectorAll<HTMLElement>('[data-export-page]'));setPages(next);setSelected((current)=>Math.max(1,Math.min(current,next.length)));};
    update();const observer=new MutationObserver(update);observer.observe(host,{childList:true,subtree:true});return()=>observer.disconnect();
  },[root]);
  const go=(page:number)=>{const next=Math.max(1,Math.min(page,pages.length));setSelected(next);pages[next-1]?.scrollIntoView({block:'start',behavior:'auto'});};
  return <nav className="proposal-page-navigation" aria-label="제안서 출력 페이지 이동">
    <label>페이지<select aria-label="이동할 페이지" value={selected} onChange={(event)=>go(Number(event.target.value))}>{pages.map((page,index)=><option value={index+1} key={index}>{index+1} / {pages.length} · {index===0?'갑지':index===1?'목차':page.querySelector('h3')?.textContent??'본문'}</option>)}</select></label>
    <div><Button variant="secondary" disabled={selected<=1} onClick={()=>go(selected-1)}>이전 쪽</Button><Button variant="secondary" disabled={selected>=pages.length} onClick={()=>go(selected+1)}>다음 쪽</Button></div>
  </nav>;
}

function ProposalFinalDocumentPreview({projectTitle,subtitle,clientName,submissionDate,chapters,revision}:{projectTitle:string;subtitle:string;clientName:string;submissionDate:string;chapters:ProposalChapter[];revision:string}):React.ReactElement{
  const [pageCounts,setPageCounts]=useState<Record<number,number>>({});
  const updatePageCount=useCallback((chapter:number,count:number)=>setPageCounts((current)=>current[chapter]===count?current:{...current,[chapter]:count}),[]);
  let precedingPages=0;
  return <article className="proposal-final-document" aria-label="확정 전 제안서 전체 합본 미리보기" data-export-document-title={projectTitle} data-export-document-kind="PROPOSAL" data-export-document-revision={revision}>
    <ProposalCoverPage projectTitle={projectTitle} subtitle={subtitle} clientName={clientName} submissionDate={submissionDate}/>
    <ProposalTableOfContentsPage chapters={chapters} pageCounts={pageCounts}/>
    {chapters.map((item)=>{const startPage=3+precedingPages;precedingPages+=pageCounts[item.number]??1;return <ProposalFinalChapterPages item={item} startPage={startPage} onPageCount={updatePageCount} key={item.number}/>;})}
  </article>;
}

export function proposalChapterHasContent(chapter:Pick<ProposalChapter,'body'|'editorJson'>):boolean {
  const meaningful=(text:string)=>Boolean(text.replace(/\u00a0/gu,' ').trim()&&text.trim()!=='[작성 필요]');
  if(chapter.editorJson){
    const hasContent=(node:import('@tiptap/core').JSONContent):boolean=>node.type==='text'&&meaningful(node.text??'')||node.type==='image'&&typeof node.attrs?.src==='string'&&Boolean(node.attrs.src.trim())||Boolean(node.content?.some(hasContent));
    return hasContent(chapter.editorJson);
  }
  const document=new DOMParser().parseFromString(markdownToEditorHtml(chapter.body),'text/html');
  return meaningful(document.body.textContent??'')||Array.from(document.images).some(image=>Boolean(image.getAttribute('src')?.trim()));
}

export function ProposalManualDraft({chapters,documentKey,readOnly,onChange}:{chapters:ProposalChapter[];documentKey:string;readOnly:boolean;onChange:(number:number,body:string,json:import('@tiptap/core').JSONContent)=>void}){
  const [selected,setSelected]=useState(1);
  const item=chapters.find(chapter=>chapter.number===selected)??chapters[0];
  if(!item)return null;
  return <section className="proposal-manual-draft proposal-manual-document">
    <header><div><b>1~3장 직접 작성</b><span>초안의 글과 표를 직접 수정하거나 외부 문서 내용을 붙여넣으세요. 작성 내용은 3단계로 그대로 이어집니다.</span></div></header>
    <nav className="proposal-manual-document__chapters" aria-label="직접 작성할 장 선택">{chapters.map(chapter=><button type="button" key={chapter.number} aria-pressed={chapter.number===item.number} onClick={()=>setSelected(chapter.number)}>{chapter.number}. {chapter.title}</button>)}</nav>
    <StructuredDocumentEditor key={`${documentKey}-${item.number}`} documentKey={`${documentKey}-${item.number}`} pageMode="a4-portrait" label={`${item.number}. ${item.title}`} value={item.body==='[작성 필요]'?'':item.body} editorJson={item.editorJson} readOnly={readOnly} parsePastedMarkup onChange={(body,json)=>onChange(item.number,body,json)}/>
  </section>;
}

export const ProposalView:React.FC<ProposalViewProps>=({routeId,roles,userEmail='',onNavigate})=>{
  const requestedCaseId=new URLSearchParams(window.location.search).get('caseId')??'';
  const fromIntake=new URLSearchParams(window.location.search).get('from')==='intake';
  const intakeStoragePending=new URLSearchParams(window.location.search).get('intakeStorage')==='pending';
  const [cases,setCases]=useState<CaseItem[]>([]); const [selectedCaseId,setSelectedCaseId]=useState(requestedCaseId);
  const [casesReady,setCasesReady]=useState(false);
  const selectedCaseRef=useRef(selectedCaseId);selectedCaseRef.current=selectedCaseId;
  const [templates,setTemplates]=useState<ProposalTemplate[]>([]); const [selectedTemplateId,setSelectedTemplateId]=useState('');
  const [,setProposals]=useState<Proposal[]>([]); const [activeProposal,setActiveProposal]=useState<Proposal|null>(null);
  const [modules,setModules]=useState<CompanyModule[]>([]); const [sources,setSources]=useState<TemplateSource[]>([]); const [companyAssets,setCompanyAssets]=useState<CompanyAsset[]>([]);
  const [templateTypes,setTemplateTypes]=useState<ProposalTemplateType[]>([]); const [selectedTemplateType,setSelectedTemplateType]=useState<ProposalTemplateCategory>('REDEVELOPMENT_FINANCE');
  const [selectedTemplateSourceId,setSelectedTemplateSourceId]=useState('');
  const [step,setStep]=useState(1); const [draftMethod,setDraftMethod]=useState<'AI'|'MANUAL'>('AI'); const [selectedChapter,setSelectedChapter]=useState(1); const [reviewSurface,setReviewSurface]=useState<'cover'|'toc'|'chapter'>('cover'); const [templatePreview,setTemplatePreview]=useState(false); const [confirmProposalOpen,setConfirmProposalOpen]=useState(false);
  const [clientName,setClientName]=useState(''); const [projectTitle,setProjectTitle]=useState(''); const [subtitle,setSubtitle]=useState('건설 클레임 전문용역 제안'); const [submissionDate,setSubmissionDate]=useState(today());
  const [keyIssues,setKeyIssues]=useState(''); const [objective,setObjective]=useState(''); const [planNotes,setPlanNotes]=useState(''); const [exclusions,setExclusions]=useState('해당 없음');
  const [chapters,setChapters]=useState<ProposalChapter[]>(blankChapters); const [includedModuleCodes,setIncludedModuleCodes]=useState<string[]>([]); const [sourceDocumentVersionIds,setSourceDocumentVersionIds]=useState('');
  const [errorMessage,setErrorMessage]=useState<string|null>(null); const [successMessage,setSuccessMessage]=useState<string|null>(null); const [busy,setBusy]=useState(false);
  const [mailRecipient,setMailRecipient]=useState(''); const [mailSubject,setMailSubject]=useState(''); const [mailBody,setMailBody]=useState('안녕하세요.\n\n요청하신 기술용역 제안서를 첨부하여 보내드립니다.\n검토 후 회신 부탁드립니다.\n\n감사합니다.');
  const [aiGeneration,setAiGeneration]=useState<{kind:'draft'|'improve';status:AiGenerationStatus;error?:string}|null>(null);
  const [proposalSelection,setProposalSelection]=useState<StructuredSelection|null>(null); const [proposalImproveInstruction,setProposalImproveInstruction]=useState('사실과 수치는 유지하고 수주 제안서 문체로 더 명확하고 설득력 있게 다듬어 주세요.');
  const [proposalImprovement,setProposalImprovement]=useState<{from:number;to:number;original:string;replacement:string}|null>(null);
  const [hwpEditorOpen,setHwpEditorOpen]=useState(false); const [hwpSourceFile,setHwpSourceFile]=useState<File|null>(null); const [hwpApplyChapter,setHwpApplyChapter]=useState<number|null>(null);
  const [selectedModuleCode,setSelectedModuleCode]=useState(''); const [moduleTitle,setModuleTitle]=useState(''); const [moduleBody,setModuleBody]=useState(''); const [moduleActive,setModuleActive]=useState(true);
  const [companyImageTitle,setCompanyImageTitle]=useState('');
  const [companyImageFile,setCompanyImageFile]=useState<File|null>(null);
  const companyImageInputRef=useRef<HTMLInputElement>(null);
  const [dirty,setDirty]=useState(false); const [pendingNavigation,setPendingNavigation]=useState<PendingNavigation|null>(null); const [stepValidationMessage,setStepValidationMessage]=useState('');
  const excelInputRef=useRef<HTMLInputElement>(null); const chapterExcelInputRef=useRef<HTMLInputElement>(null); const proposalImageInputRef=useRef<HTMLInputElement>(null); const proposalEditorRef=useRef<StructuredDocumentEditorHandle|null>(null); const finalPreviewRef=useRef<HTMLDivElement>(null);
  const canEdit=roles.some((role)=>['ceo','director','pm','admin'].includes(role)); const canManageModules=roles.includes('admin');

  useEffect(()=>{setCompanyImageFile(null);setCompanyImageTitle('');if(companyImageInputRef.current)companyImageInputRef.current.value='';},[selectedModuleCode]);
  const addCompanyImage=async()=>{
    const module=modules.find((item)=>item.code===selectedModuleCode);
    if(busy||!canManageModules||!module||!companyImageFile||!companyImageTitle.trim())return;
    if(module.chapterNumber<4||module.chapterNumber>10){setErrorMessage('공통 이미지 등록은 현재 4~10장을 지원합니다. 11~12장 본문은 공통 양식으로 저장할 수 있습니다.');return;}
    setBusy(true);setErrorMessage(null);
    try{
      const file=await proposalImageForUpload(companyImageFile);
      if(file.size>2_000_000)throw new Error('공통 이미지는 2MB 이하로 준비해 주세요. 기존 이미지는 유지됩니다.');
      const title=companyImageTitle.trim();
      const displayOrder=Math.max(0,...companyAssets.filter((item)=>item.chapterNumber===module.chapterNumber&&item.assetKey!=='BRAND_LOGO').map((item)=>item.displayOrder))+1;
      if(displayOrder>99)throw new Error('이 장의 이미지 등록 순서 한도(99)에 도달했습니다. 관리자에게 이미지 구성을 확인해 주세요.');
      const form=new FormData();form.append('file',file);form.append('chapterNumber',String(module.chapterNumber));form.append('title',title);form.append('altText',title);form.append('displayOrder',String(displayOrder));
      const response=await apiRequest<{asset:CompanyAsset}>('/api/proposal-studio/assets',{method:'POST',body:form});
      if(!response.asset?.hasContent||response.asset.chapterNumber!==module.chapterNumber||response.asset.title!==title)throw new Error('공통 이미지 저장 결과를 확인하지 못했습니다. 같은 파일·제목으로 다시 등록해 주세요.');
      setCompanyAssets((current)=>[...current.filter(item=>item.assetKey!==response.asset.assetKey),response.asset]);
      setCompanyImageFile(null);setCompanyImageTitle('');if(companyImageInputRef.current)companyImageInputRef.current.value='';
      setSuccessMessage(`${module.chapterNumber}장 공통 이미지 “${response.asset.title}”을 등록했습니다. 신규 제안서의 같은 장에 사용됩니다. 설명을 편집한 뒤 공통 DB 새 버전 저장을 누르면 현재 장에도 적용됩니다. 기존 저장·확정본은 변경하지 않았습니다.`);
    }catch(reason){setErrorMessage(reason instanceof Error?reason.message:'공통 이미지를 추가하지 못했습니다. 입력을 확인한 뒤 다시 등록하세요.');}finally{setBusy(false);}
  };

  useLayoutEffect(()=>{
    if(step!==4)return;
    const workspace=finalPreviewRef.current?.closest<HTMLElement>('.proposal-finalization-workspace');
    const topbar=document.querySelector<HTMLElement>('.topbar');
    if(!workspace||!topbar)return;
    const update=()=>workspace.style.setProperty('--proposal-sticky-top',`${topbar.getBoundingClientRect().height+16}px`);
    update();
    const observer=new ResizeObserver(update);observer.observe(topbar);
    return()=>observer.disconnect();
  },[step]);

  const applyVersion=useCallback((version:ProposalVersion|undefined,caseRow?:CaseItem)=>{
    if(!version){setChapters(blankChapters());setDraftMethod('AI');return;}
    try{
      const parsed=JSON.parse(version.structuredInputsJson) as Partial<StudioInputs>&Record<string,unknown>;
      if(Array.isArray(parsed.chapters)&&parsed.chapters.length===12){
        const parsedKeyIssues=String(parsed.keyIssues??'');const parsedObjective=String(parsed.objective??'');const parsedPlanNotes=String(parsed.planNotes??'');
        const linkedClientName=caseRow?.clientName?.trim()??'';
        setClientName(typeof parsed.clientName==='string'?parsed.clientName:linkedClientName);setProjectTitle(String(parsed.projectTitle??caseRow?.title??''));setSubtitle(String(parsed.subtitle??'건설 클레임 전문용역 제안'));setSubmissionDate(String(parsed.submissionDate??today()));
        setKeyIssues(parsedKeyIssues);setObjective(parsedObjective);setPlanNotes(parsedPlanNotes);setExclusions(String(parsed.exclusions??'해당 없음'));
        const savedChapters=parsed.chapters as ProposalChapter[];const savedModuleCodes=Array.isArray(parsed.includedModuleCodes)?parsed.includedModuleCodes.filter((item):item is string=>typeof item==='string'):[];setChapters(savedChapters);setIncludedModuleCodes(savedModuleCodes);if(typeof parsed.templateSourceId==='string')setSelectedTemplateSourceId(parsed.templateSourceId);
      }else{
        const next=blankChapters();next[0].body=`${String(parsed.background??'')}\n\n${String(parsed.objective??'')}`.trim();next[2].body=String(parsed.method??'');next[11].body=`${String(parsed.expectedOutcome??'')}\n\n제외사항: ${String(parsed.exclusions??'')}`;
        setClientName(caseRow?.clientName?.trim()??'');setProjectTitle(`${caseRow?.title??'프로젝트'} 기술용역 제안서`);setObjective(String(parsed.objective??''));setPlanNotes(String(parsed.method??''));setExclusions(String(parsed.exclusions??'해당 없음'));setChapters(next);
      }
      setSourceDocumentVersionIds(parseArray(version.sourceDocumentVersionIdsJson).join(', '));
      setDraftMethod(version.generationMode==='AI'?'AI':'MANUAL');
    }catch{setChapters(blankChapters());}
  },[]);

  const loadProposalDetail=useCallback(async(cId:string,pId:string)=>{const response=await apiRequest<{proposal:Proposal}>(`/api/cases/${cId}/proposals/${pId}`);if(selectedCaseRef.current!==cId)return;setActiveProposal(response.proposal);applyVersion(response.proposal.versions?.[0],cases.find((item)=>item.id===cId));setDirty(false);},[applyVersion,cases]);
  const loadCaseData=useCallback(async(cId:string)=>{if(!cId)return;const caseRow=cases.find((item)=>item.id===cId);const query=caseRow?`?claimType=${caseRow.claimType}`:'';try{const [templateResult,proposalResult]=await Promise.all([apiRequest<{templates:ProposalTemplate[]}>(`/api/proposal-templates${query}`),apiRequest<{proposals:Proposal[]}>(`/api/cases/${cId}/proposals`)]);if(selectedCaseRef.current!==cId)return;setTemplates(templateResult.templates??[]);setSelectedTemplateId(templateResult.templates?.[0]?.id??'');setProposals(proposalResult.proposals??[]);if(proposalResult.proposals?.length)await loadProposalDetail(cId,proposalResult.proposals[0].id);else{setActiveProposal(null);setClientName(caseRow?.clientName?.trim()??'');setProjectTitle(`${caseRow?.title??''} 기술용역 제안서`);setObjective(caseRow?.description??'');setChapters(blankChapters());setStep(1);setDirty(false);}}catch(reason){if(selectedCaseRef.current===cId)setErrorMessage(reason instanceof Error?reason.message:'제안서 데이터를 불러오지 못했습니다.');}},[cases,loadProposalDetail]);
  useEffect(()=>{let active=true;void Promise.all([loadCaseOptions<CaseItem>('/api/cases?scope=proposal-authoring&limit=100&q='),apiRequest<{modules:CompanyModule[];sources:TemplateSource[];assets:CompanyAsset[];templateTypes:ProposalTemplateType[]}>('/api/proposal-studio/config')]).then(async([res,config])=>{
    const availableCases=[...(res.cases??[])];
    // Authoring candidates exclude awarded projects. A saved proposal opened
    // explicitly still belongs to that project; verify access by its detail API.
    if(requestedCaseId&&!availableCases.some(item=>item.id===requestedCaseId)){
      const detail=await apiRequest<{case:CaseItem}>(`/api/cases/${encodeURIComponent(requestedCaseId)}`);
      if(!detail.case||detail.case.id!==requestedCaseId)throw new Error('연결된 프로젝트를 확인하지 못했습니다. 제안서 목록에서 다시 열어 주세요.');
      availableCases.unshift(detail.case);
    }
    if(!active)return;
    const availableTypes=config.templateTypes??[];const preferredType=availableTypes.find((type)=>type.id==='REDEVELOPMENT_FINANCE')??availableTypes[0];setCases(availableCases);setModules(config.modules??[]);setSources(config.sources??[]);setTemplateTypes(availableTypes);setCompanyAssets(config.assets??[]);if(preferredType){setSelectedTemplateType(preferredType.id);setSelectedTemplateSourceId((current)=>current||preferredType.representativeSourceId);}else setSelectedTemplateSourceId((current)=>current||config.sources?.find((source)=>source.isDefault)?.id||config.sources?.[0]?.id||'');setIncludedModuleCodes((config.modules??[]).filter((module)=>module.isActive).map((module)=>module.code));setSelectedCaseId(requestedCaseId||availableCases[0]?.id||'');setCasesReady(true);
  }).catch((reason:Error)=>{if(active){setActiveProposal(null);setErrorMessage(reason.message);}});return()=>{active=false;};},[]);
  useEffect(()=>{if(casesReady&&selectedCaseId)void loadCaseData(selectedCaseId);},[casesReady,selectedCaseId,loadCaseData]);
  useEffect(()=>{const selected=modules.find((module)=>module.code===selectedModuleCode)??modules[0];if(!selected)return;if(selected.code!==selectedModuleCode)setSelectedModuleCode(selected.code);setModuleTitle(selected.title);setModuleBody(selected.bodyMarkdown);setModuleActive(selected.isActive);},[modules,selectedModuleCode]);
  // Reopening must preserve saved text, tables and HWP page images. Company
  // defaults are inserted at creation or by the explicit apply-defaults action.
  useEffect(()=>{const onImageDeleted=(event:Event)=>{const detail=(event as CustomEvent<{documentKey?:string;src?:string}>).detail;if(detail.documentKey!==`proposal-${activeProposal?.id}-${selectedChapter}`||!detail.src)return;const companyKey=detail.src.match(/\/api\/proposal-studio\/assets\/([A-Z0-9_]+)/u)?.[1];if(!companyKey)return;setChapters((current)=>current.map((item)=>item.number===selectedChapter?{...item,excludedCompanyAssetKeys:[...new Set([...(item.excludedCompanyAssetKeys??[]),companyKey])]}:item));setDirty(true);setSuccessMessage(`${selectedChapter}장에서 선택한 회사 기본 이미지를 이 제안서에서 제외했습니다. 중앙 기본값 최신본을 다시 가져오면 복원할 수 있습니다.`);};window.addEventListener('structured-editor:image-deleted',onImageDeleted);return()=>window.removeEventListener('structured-editor:image-deleted',onImageDeleted);},[activeProposal?.id,selectedChapter]);
  useEffect(()=>{if(projectTitle.trim()&&!mailSubject.trim())setMailSubject(`[컨코스트] ${projectTitle} 제안서 송부`);},[projectTitle,mailSubject]);
  useEffect(()=>{const type=templateTypes.find((item)=>item.representativeSourceId===selectedTemplateSourceId);if(type&&type.id!==selectedTemplateType)setSelectedTemplateType(type.id);},[selectedTemplateSourceId,selectedTemplateType,templateTypes]);
  useEffect(()=>registerNavigationBlocker((navigation)=>{const current=`${window.location.pathname}${window.location.search}`;if(!dirty||navigation.path===current)return false;setPendingNavigation(navigation);return true;}),[dirty]);
  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(dirty)event.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);

  const createProposal=async()=>{if(!selectedCaseId||!selectedTemplateId||!selectedTemplateSourceId)return;setBusy(true);setErrorMessage(null);try{const result=await apiRequest<{proposal:Proposal}>(`/api/cases/${selectedCaseId}/proposals`,{method:'POST',body:JSON.stringify({templateId:selectedTemplateId,sourceId:selectedTemplateSourceId})});await loadCaseData(selectedCaseId);await loadProposalDetail(selectedCaseId,result.proposal.id);setStep(1);setSuccessMessage('선택한 실무 템플릿으로 12개 챕터 제안서 작업공간을 만들었습니다. 1단계 입력부터 진행하세요.');onNavigate(`/proposals/editor?caseId=${encodeURIComponent(selectedCaseId)}`);}catch(reason){setErrorMessage(reason instanceof Error?reason.message:'제안서를 만들지 못했습니다.');}finally{setBusy(false);}};
  const preparedChapters=()=>chapters.map((chapter)=>chapter.number===1?{...chapter,body:objective}:chapter.number===2?{...chapter,body:keyIssues}:chapter.number===3?{...chapter,body:planNotes}:chapter);
  const chooseDraftMethod=(method:'AI'|'MANUAL')=>{setDraftMethod(method);if(method==='MANUAL')setChapters((current)=>current.map((chapter)=>{if(chapter.editorJson)return chapter;if(chapter.number===1&&(!chapter.body.trim()||chapter.body==='[작성 필요]'))return{...chapter,body:objective};if(chapter.number===2&&(!chapter.body.trim()||chapter.body==='[작성 필요]'))return{...chapter,body:keyIssues};if(chapter.number===3&&(!chapter.body.trim()||chapter.body==='[작성 필요]'))return{...chapter,body:planNotes};return chapter;}));};
  const saveVersion=async(generationMode:'MANUAL'|'AI',nextStep:3|4=4)=>{
    if(!activeProposal||!selectedCaseId||busy)return;
    if(generationMode==='MANUAL'&&nextStep===3&&!chapters.slice(0,3).every(proposalChapterHasContent)){setErrorMessage('1~3장에 실제 내용을 작성한 뒤 담당자 검수로 이동하세요.');return;}
    if(![clientName,projectTitle,subtitle,submissionDate,keyIssues,objective,planNotes].every((value)=>value.trim())){setErrorMessage('1단계의 클라이언트·프로젝트 정보, 당 현장의 핵심 쟁점 분석, 제안 목적, 업무 수행 내용을 모두 입력하세요.');return;}
    setBusy(true);setErrorMessage(null);if(generationMode==='AI')setAiGeneration({kind:'draft',status:'running'});
    try{
      let target=activeProposal;
      let forked=false;
      if(activeProposal.status!=='DRAFT'){
        const created=await apiRequest<{proposal:Proposal}>(`/api/cases/${selectedCaseId}/proposals`,{method:'POST',body:JSON.stringify({templateId:activeProposal.templateId,sourceId:selectedTemplateSourceId})});
        target=created.proposal;forked=true;
      }
      const submittedChapters=generationMode==='AI'?preparedChapters():chapters;
      const saved=await apiRequest<{proposal:Proposal}>(`/api/cases/${selectedCaseId}/proposals/${target.id}/versions`,{method:'POST',timeoutMs:generationMode==='AI'?105_000:30_000,body:JSON.stringify({clientName,projectTitle,subtitle,submissionDate,keyIssues,objective,planNotes,exclusions,chapters:submittedChapters,includedModuleCodes,templateSourceId:selectedTemplateSourceId,generationMode,sourceDocumentVersionIds:sourceDocumentVersionIds.split(',').map((item)=>item.trim()).filter(Boolean),version:target.version})});
      const revision=saved.proposal?.versions?.[0];
      if(selectedCaseRef.current!==selectedCaseId||saved.proposal?.id!==target.id||saved.proposal.caseId!==selectedCaseId||saved.proposal.version!==target.version+1||!revision||revision.id!==saved.proposal.currentVersionId||revision.versionNumber!==target.version+1||revision.generationMode!==generationMode)throw new Error('새 제안서 버전의 저장 결과를 확인하지 못했습니다. 입력은 유지했습니다. 재저장 전 저장본을 확인해 주세요.');
      let snapshot:StudioInputs|null=null;try{snapshot=JSON.parse(revision.structuredInputsJson) as StudioInputs;}catch{/* Keep the authored draft when an acknowledgement cannot be read. */}
      const savedText=(value:string,max:number)=>hydrateProposalPublishedFacts(sanitizeProposalCostData(value.trim().slice(0,max)).value);
      if(!snapshot||snapshot.clientName!==savedText(clientName,200)||snapshot.projectTitle!==savedText(projectTitle,300)||snapshot.subtitle!==savedText(subtitle,300)||snapshot.submissionDate!==submissionDate.trim().slice(0,30)||snapshot.templateSourceId!==selectedTemplateSourceId||!['keyIssues','objective','planNotes','exclusions'].every(key=>typeof snapshot![key as keyof StudioInputs]==='string')||!Array.isArray(snapshot.chapters)||snapshot.chapters.length!==12||!snapshot.chapters.every((chapter,index)=>chapter&&chapter.number===index+1&&chapter.kind===(index<3?'VARIABLE':'FIXED')&&typeof chapter.title==='string'&&Boolean(chapter.title.trim())&&typeof chapter.body==='string'&&(!chapter.editorJson||chapter.editorJson.type==='doc'&&Array.isArray(chapter.editorJson.content)))||!Array.isArray(snapshot.includedModuleCodes)||!snapshot.includedModuleCodes.every(code=>typeof code==='string'))throw new Error('저장 응답의 갑지·목차·12장 구성을 확인하지 못했습니다. 입력은 유지했습니다. 재저장 전 저장본을 확인해 주세요.');
      if(generationMode==='MANUAL'){
        const maskText=(value:string,max=10000)=>sanitizeProposalCostData(value.trim().slice(0,max)).value;
        // Match the Worker's field pass, then its whole-input JSON pass. A
        // chapter-local pass can reject valid existing public-fact snapshots.
        const expected=JSON.parse(hydrateProposalPublishedFacts(sanitizeProposalCostData(JSON.stringify({clientName:maskText(clientName,200),projectTitle:maskText(projectTitle,300),subtitle:maskText(subtitle,300),submissionDate:submissionDate.trim().slice(0,30),keyIssues:maskText(keyIssues),objective:maskText(objective),planNotes:maskText(planNotes),exclusions:maskText(exclusions),templateSourceId:selectedTemplateSourceId,templateSourceName:sources.find(source=>source.id===selectedTemplateSourceId)?.sourceName,includedModuleCodes,chapters:submittedChapters.map(chapter=>({...chapter,title:maskText(chapter.title,200),body:maskText(chapter.body,50000),excludedCompanyAssetKeys:(chapter.excludedCompanyAssetKeys??[]).filter(key=>companyAssets.some(asset=>asset.assetKey===key))}))})).value)) as StudioInputs;
        if(!snapshot.chapters.every((chapter,index)=>{const submitted=expected.chapters[index];return chapter.title===submitted.title&&chapter.body===submitted.body&&JSON.stringify(chapter.editorJson??null)===JSON.stringify(submitted.editorJson??null)&&JSON.stringify(chapter.excludedCompanyAssetKeys??[])===JSON.stringify(submitted.excludedCompanyAssetKeys??[]);} ))throw new Error('저장 응답의 본문·표·이미지가 편집 내용과 일치하지 않습니다. 입력은 유지했습니다. 재저장 전 저장본을 확인해 주세요.');
      }
      setActiveProposal(saved.proposal);applyVersion(revision,cases.find(item=>item.id===selectedCaseId));setDirty(false);if(generationMode==='AI')setAiGeneration({kind:'draft',status:'complete'});else setStep(nextStep);
      setSuccessMessage(`${forked?'기존 확정본은 보존하고 편집용 새 초안을 만들었습니다. ':''}${generationMode==='AI'?'Gemini가 1·2·3장 최초 초안을 만들고 4~12장 중앙 기본값의 편집 복사본을 결합했습니다. 이제 모든 장을 사람이 직접 수정할 수 있습니다.':nextStep===3?'수동·외부 LLM 초안을 저장했습니다. 이제 3단계 편집기에서 1~12장 전체를 검수·수정하세요.':'사람이 수정한 12개 챕터를 그대로 새 버전으로 저장했습니다.'}`);
    }catch(reason){const message=reason instanceof Error?reason.message:'제안서 버전을 저장하지 못했습니다.';if(generationMode==='AI')setAiGeneration({kind:'draft',status:'error',error:message});else setErrorMessage(message);}finally{setBusy(false);}
  };
  const confirmProposal=async()=>{if(!activeProposal||!selectedCaseId)return;setBusy(true);try{await apiRequest(`/api/cases/${selectedCaseId}/proposals/${activeProposal.id}/reviews`,{method:'POST',body:JSON.stringify({action:'CONFIRM',comment:'4단계 전체 합본 미리보기 확인 후 작성자가 최종 확정함',versionId:activeProposal.currentVersionId,version:activeProposal.version})});await loadProposalDetail(selectedCaseId,activeProposal.id);setConfirmProposalOpen(false);onNavigate('/workflow/award?caseId='+encodeURIComponent(selectedCaseId)+'&proposalId='+encodeURIComponent(activeProposal.id));setSuccessMessage('제안서 확정 완료. 현재 미리보기 그대로 DOCX·PDF·HWP 내려받기가 활성화됐고 확정본으로 보관되었습니다.');}catch(reason){setErrorMessage(reason instanceof Error?reason.message:'제안서 상태를 바꾸지 못했습니다.');}finally{setBusy(false);}};
  const download=async(format:FinalDocumentFormat)=>{
    if(!activeProposal||!selectedCaseId||activeProposal.caseId!==selectedCaseId){setErrorMessage('출력할 제안서의 프로젝트 연결을 확인하지 못했습니다. 제안서 목록에서 다시 열어 주세요.');return;}
    if(!activeProposal.currentVersionId){setErrorMessage('확정 버전을 확인하지 못했습니다. 제안서 목록에서 다시 열어 주세요.');return;}
    if(!finalPreviewRef.current){setErrorMessage('출력 미리보기가 준비되지 않았습니다. 전체 미리보기를 다시 열어 주세요.');return;}
    setBusy(true);setErrorMessage(null);try{const result=await downloadFinalDocument({root:finalPreviewRef.current,format,fileName:`${cases.find((item)=>item.id===selectedCaseId)?.caseNumber??'CONCOST'}_${projectTitle}_v${activeProposal.version}`,orientation:'portrait',onProgress:(message)=>setSuccessMessage(message)});setSuccessMessage(format==='docx'?`미리보기 ${result.pageCount}쪽의 문단·표·이미지를 편집 가능한 DOCX로 내려받았습니다. 제출 전 Word에서 쪽 배치를 확인하세요.`:`${format.toUpperCase()} 확정본 ${result.pageCount}페이지 내려받기 완료 · 담당자 검수와 동일한 A4 세로 화면을 페이지 단위로 보존했습니다.`);}catch(reason){setErrorMessage(reason instanceof Error?reason.message:'제안서를 내려받지 못했습니다.');}finally{setBusy(false);}};
  const exportExcel=()=>{const selected=cases.find((item)=>item.id===selectedCaseId);const bytes=proposalWorkbook({clientName,projectTitle,subtitle,submissionDate,keyIssues,objective,planNotes,exclusions},`${selected?.caseNumber??''} · ${selected?.title??''}`,templates.find((item)=>item.id===selectedTemplateId)?.name??'컨코스트 12챕터');const payload=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;const url=URL.createObjectURL(new Blob([payload],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`${selected?.caseNumber??'PROJECT'}_제안서_입력양식.xlsx`;anchor.click();URL.revokeObjectURL(url);setSuccessMessage('Excel 양식을 내보냈습니다. C열 작성 후 다시 가져오면 1단계에 반영됩니다.');};
  const importExcel=async(file?:File)=>{if(!file)return;setBusy(true);try{const values=await readProposalWorkbook(file);setClientName(values.clientName);setProjectTitle(values.projectTitle);setSubtitle(values.subtitle);setSubmissionDate(values.submissionDate);setKeyIssues(values.keyIssues);setObjective(values.objective);setPlanNotes(values.planNotes);setExclusions(values.exclusions);setDirty(true);setStep(1);setSuccessMessage('작성 Excel 가져오기 완료. C열의 8개 항목을 1단계에 반영했습니다. 화면 확인 후 초안 작성 방식을 선택하세요.');}catch(reason){setErrorMessage(reason instanceof Error?reason.message:'Excel을 읽지 못했습니다.');}finally{setBusy(false);if(excelInputRef.current)excelInputRef.current.value='';}};
  const exportChapterExcel=()=>{const selected=cases.find((item)=>item.id===selectedCaseId);const current=chapters[selectedChapter-1];if(!current)return;const bytes=proposalChapterWorkbook({chapterNumber:current.number,chapterTitle:current.title,chapterBody:current.body},`${selected?.caseNumber??''} · ${selected?.title??''}`);const payload=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;const url=URL.createObjectURL(new Blob([payload],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`${selected?.caseNumber??'PROJECT'}_제안서_${String(current.number).padStart(2,'0')}장_편집.xlsx`;anchor.click();URL.revokeObjectURL(url);setSuccessMessage(`${current.number}장 전용 Excel을 내보냈습니다. 본문을 수정한 뒤 같은 장에서 다시 가져오세요.`);};
  const importChapterExcel=async(file?:File)=>{if(!file)return;setBusy(true);try{const imported=await readProposalChapterWorkbook(file);if(imported.chapterNumber!==selectedChapter)throw new Error(`이 파일은 ${imported.chapterNumber}장 전용입니다. 목차에서 ${imported.chapterNumber}장을 선택한 뒤 가져오세요.`);setChapters((current)=>current.map((item)=>item.number===selectedChapter?{...item,title:imported.chapterTitle,body:imported.chapterBody,editorJson:null}:item));if(selectedChapter===1)setObjective(imported.chapterBody);if(selectedChapter===2)setKeyIssues(imported.chapterBody);if(selectedChapter===3)setPlanNotes(imported.chapterBody);setDirty(true);setSuccessMessage(`${selectedChapter}장 Excel 본문을 현재 담당자 검수 편집기에 반영했습니다. 검수 완료를 눌러 버전에 저장하세요.`);}catch(reason){setErrorMessage(reason instanceof Error?reason.message:'현재 챕터 Excel을 읽지 못했습니다.');}finally{setBusy(false);if(chapterExcelInputRef.current)chapterExcelInputRef.current.value='';}};
  const openChapterHwp=()=>{setHwpApplyChapter(selectedChapter);setHwpSourceFile(null);setHwpEditorOpen(true);};
  const applyHwpPagesToChapter=async(pages:string[])=>{const target=hwpApplyChapter;if(!target||!activeProposal||!selectedCaseId||!pages.length)return;setBusy(true);setErrorMessage(null);try{const images:string[]=[];for(let index=0;index<pages.length;index+=1){const title=`${target}장 HWP 원본 ${index+1}쪽`;const file=await hwpSvgPageForUpload(pages[index],`chapter-${String(target).padStart(2,'0')}-hwp-page-${String(index+1).padStart(2,'0')}.jpg`);const form=new FormData();form.append('file',file);form.append('chapterNumber',String(target));form.append('title',title);form.append('altText',title);const response=await apiRequest<{asset:{url:string;altText:string;title:string}}>(`/api/cases/${selectedCaseId}/proposals/${activeProposal.id}/assets`,{method:'POST',body:form});images.push(`<img src="${response.asset.url}" alt="${response.asset.altText}" title="${response.asset.title}" data-image-align="center">`);}const body=images.join('\n\n');setChapters((current)=>current.map((item)=>item.number===target?{...item,body,editorJson:null}:item));setSelectedChapter(target);setDirty(true);setHwpEditorOpen(false);setHwpSourceFile(null);setSuccessMessage(`${target}장에 HWP ${pages.length}쪽의 글꼴·표·이미지·여백이 보이는 페이지 모양을 그대로 반영했습니다. 문구를 다시 고치려면 HWP 편집기에서 수정 후 재적용하세요.`);}catch(reason){setErrorMessage(reason instanceof Error?reason.message:'HWP 페이지 모양을 현재 장에 반영하지 못했습니다.');}finally{setBusy(false);}};
  const saveCompanyModule=async()=>{const selected=modules.find((module)=>module.code===selectedModuleCode);if(!selected||!canManageModules)return;setBusy(true);setErrorMessage(null);try{const response=await apiRequest<{module:CompanyModule;sanitizationCount:number}>(`/api/proposal-studio/modules/${selected.code}`,{method:'PUT',body:JSON.stringify({title:moduleTitle,bodyMarkdown:moduleBody,isActive:moduleActive,version:selected.version})});setModules((current)=>current.map((module)=>module.code===response.module.code?response.module:module));if(response.module.isActive){setIncludedModuleCodes((current)=>[...new Set([...current,response.module.code])]);setChapters((current)=>current.map((item)=>item.number===response.module.chapterNumber?proposalChapterWithCompanyImages({...item,title:response.module.title,kind:'FIXED',moduleCode:response.module.code,body:response.module.bodyMarkdown,editorJson:null,excludedCompanyAssetKeys:[]},companyAssets):item));setDirty(true);}setSuccessMessage(`관리자 회사 DB 모듈 v${response.module.version} 저장 완료 · 현재 제안서 ${response.module.chapterNumber}장에도 적용했습니다${response.sanitizationCount?` · 금액 ${response.sanitizationCount}건 비공개 처리`:''}. 검수 완료를 누르면 제안서 버전에 보존됩니다.`);}catch(reason){setErrorMessage(reason instanceof Error?reason.message:'회사 DB 모듈을 저장하지 못했습니다.');}finally{setBusy(false);}};
  const uploadCompanyAsset=async(asset:CompanyAsset,file?:File)=>{if(!file||!canManageModules)return;if(file.type!=='image/jpeg'){setErrorMessage('회사 공통 이미지는 JPG로 변환한 뒤 등록하세요. DOCX와 PDF에 동일하게 삽입됩니다.');return;}setBusy(true);setErrorMessage(null);try{const form=new FormData();form.append('file',file);const response=await apiRequest<{asset:CompanyAsset}>(`/api/proposal-studio/assets/${asset.assetKey}`,{method:'PUT',body:form});setCompanyAssets((current)=>current.map((item)=>item.assetKey===response.asset.assetKey?response.asset:item));setSuccessMessage(`${asset.title} 이미지를 공통 기본값 새 버전으로 저장했습니다. 신규 제안서부터 사용합니다. 기존 제안서는 그대로 보존되며 최신 기본값 적용을 선택해야 변경됩니다.`);}catch(reason){setErrorMessage(reason instanceof Error?reason.message:'회사 이미지를 저장하지 못했습니다.');}finally{setBusy(false);}};
  const uploadProposalImage=async(file?:File)=>{if(!file||!activeProposal||!selectedCaseId||!canEdit||busy)return;setBusy(true);setErrorMessage(null);try{const normalized=await proposalImageForUpload(file);const title=file.name.replace(/\.[^.]+$/u,'').slice(0,160)||`${selectedChapter}장 원본 이미지`;const form=new FormData();form.append('file',normalized);form.append('chapterNumber',String(selectedChapter));form.append('title',title);form.append('altText',`${selectedChapter}장 ${title}`);const response=await apiRequest<{asset:{id:string;title:string;altText:string;url:string}}>(`/api/cases/${selectedCaseId}/proposals/${activeProposal.id}/assets`,{method:'POST',body:form});proposalEditorRef.current?.insertImage({src:response.asset.url,alt:response.asset.altText,title:response.asset.title});setSuccessMessage(`${selectedChapter}장 현재 커서 위치에 원본 이미지 “${response.asset.title}”을 삽입했습니다. 검수 완료를 누르면 이 위치가 제안서 버전에 저장됩니다.`);}catch(reason){setErrorMessage(reason instanceof Error?reason.message:'제안서 원본 이미지를 삽입하지 못했습니다.');}finally{setBusy(false);if(proposalImageInputRef.current)proposalImageInputRef.current.value='';}};
  const setCompanyModuleIncluded=(module:CompanyModule,included:boolean)=>{setIncludedModuleCodes((current)=>included?[...new Set([...current,module.code])]:current.filter((code)=>code!==module.code));setChapters((current)=>current.map((item)=>item.number!==module.chapterNumber?item:included?proposalChapterWithCompanyImages({...item,title:module.title,kind:'FIXED',moduleCode:module.code,body:module.bodyMarkdown,editorJson:null,excludedCompanyAssetKeys:[]},companyAssets):{...item,title:module.title,kind:'FIXED',moduleCode:module.code,body:'[이 회사 공통 모듈은 현재 제안서에서 제외되었습니다.]',editorJson:null,excludedCompanyAssetKeys:[]}));setSelectedChapter(module.chapterNumber);setDirty(true);setSuccessMessage(included?`${module.chapterNumber}장 공통 기본 모듈 v${module.version}을 현재 편집본에 불러왔습니다.`:`${module.chapterNumber}장 공통 기본 모듈을 현재 제안서에서 제외했습니다.`);};
  const applyLatestCompanyModules=()=>{const activeModules=modules.filter((module)=>module.isActive&&module.chapterNumber>=4&&module.chapterNumber<=12);setIncludedModuleCodes(activeModules.map((module)=>module.code));setChapters((current)=>current.map((item)=>{if(item.number<4||item.number>12)return item;const module=activeModules.find((candidate)=>candidate.chapterNumber===item.number);return module?proposalChapterWithCompanyImages({...item,title:module.title,kind:'FIXED',moduleCode:module.code,body:module.bodyMarkdown,editorJson:null,excludedCompanyAssetKeys:[]},companyAssets):{...item,body:'[이 회사 공통 모듈은 현재 제안서에서 제외되었습니다.]',editorJson:null};}));setDirty(true);setSuccessMessage(`회사 공통 기본 모듈 ${activeModules.length}개(4~12장) 최신본을 현재 제안서 편집 복사본에 반영했습니다. 검수 완료를 누르면 새 버전으로 보존됩니다.`);};

  const improveProposalSelection=async(instruction=proposalImproveInstruction,selectionOverride?:StructuredSelection)=>{const selection=selectionOverride??proposalEditorRef.current?.getSelection()??proposalSelection;if(!activeProposal||!selectedCaseId||!selection?.text.trim()||busy)return;setBusy(true);setErrorMessage(null);setAiGeneration({kind:'improve',status:'running'});try{const response=await apiRequest<{content:string}>('/api/proposal-studio/improve',{method:'POST',body:JSON.stringify({caseId:selectedCaseId,proposalId:activeProposal.id,chapterNumber:selectedChapter,content:selection.text,instruction:instruction.trim(),expectedProposalVersion:activeProposal.version})});proposalEditorRef.current?.dismissSelectionMenu();setProposalImprovement({from:selection.from,to:selection.to,original:selection.text,replacement:response.content.trim()});setAiGeneration(null);}catch(reason){const message=reason instanceof Error?reason.message:'선택 문장을 개선하지 못했습니다.';setAiGeneration({kind:'improve',status:'error',error:message});}finally{setBusy(false);}};
  const applyProposalImprovement=()=>{if(!proposalImprovement)return;const applied=proposalEditorRef.current?.replaceRange(proposalImprovement.from,proposalImprovement.to,proposalImprovement.replacement,proposalImprovement.original);if(!applied){setProposalImprovement(null);setErrorMessage('AI 개선안을 기다리는 동안 원문이 바뀌었습니다. 최신 문장을 다시 선택해 개선해 주세요.');return;}setProposalSelection(null);setProposalImprovement(null);};

  const selectedCase=cases.find((item)=>item.id===selectedCaseId);const currentVersion=activeProposal?.versions?.[0];const hasAiDraft=Boolean(activeProposal?.versions?.some((version)=>version.generationMode==='AI'));const chapter=chapters[selectedChapter-1]??chapters[0];const selectedTemplateSource=sources.find((source)=>source.id===selectedTemplateSourceId);const selectedProposalType=templateTypes.find((item)=>item.id===selectedTemplateType);
  const step1Fields=[['클라이언트명',clientName],['프로젝트 제목',projectTitle],['제안서 부제',subtitle],['제출일',submissionDate],['당 현장의 핵심 쟁점 분석',keyIssues],['제안 목적·의뢰 배경',objective],['업무 수행 내용',planNotes]] as const;
  const step1Missing=step1Fields.filter(([,value])=>!value.trim()).map(([label])=>label);
  const firstThreeComplete=chapters.slice(0,3).every(proposalChapterHasContent);
  const allChaptersComplete=chapters.every((item)=>item.body.trim()&&item.body.trim()!=='[작성 필요]');
  const goToProposalStep=(target:number)=>{if(busy)return;if(target<step){setStep(target);setStepValidationMessage('');return;}if(target>=2&&step1Missing.length){setStepValidationMessage(`1단계 필수 입력을 완료하세요: ${step1Missing.join(', ')}`);setStep(1);return;}if(target>=3&&(!firstThreeComplete||(dirty&&!currentVersion))){setStepValidationMessage(firstThreeComplete?'최초 초안을 저장해야 담당자 검수로 이동할 수 있습니다.':'1~3장 초안을 작성하고 저장해야 담당자 검수로 이동할 수 있습니다.');setStep(2);return;}if(target>=4&&(!allChaptersComplete||dirty||!currentVersion)){setStepValidationMessage(allChaptersComplete?'담당자 검수의 변경 내용을 저장한 뒤 전체 미리보기로 이동하세요.':'1~12장 내용을 모두 확인·작성해야 전체 미리보기로 이동할 수 있습니다.');setStep(3);return;}if(target===5&&activeProposal?.status!=='APPROVED'){setStepValidationMessage('제안서를 확정한 뒤 메일 발송 준비를 열 수 있습니다.');setStep(4);return;}setStepValidationMessage('');setStep(target);};
  const chooseProposalType=(category:ProposalTemplateCategory)=>{const type=templateTypes.find((item)=>item.id===category);if(!type||busy)return;setSelectedTemplateType(category);setSelectedTemplateSourceId(type.representativeSourceId);if(activeProposal&&type.representativeSourceId!==selectedTemplateSourceId)setDirty(true);setSuccessMessage(`${type.label} 대표 템플릿과 유형별 1~3장 작성 지침을 적용했습니다.`);};
  const stepOneDocumentTools=<DocumentToolMenus groups={[
    {id:'excel',label:'Excel',actions:[
      {id:'export',label:'입력 양식 내보내기',onClick:exportExcel},
      {id:'import',label:'작성 Excel 가져오기',onClick:()=>excelInputRef.current?.click(),disabled:busy},
    ]},
  ]}/>;
  const stepThreeDocumentTools=reviewSurface==='chapter'?<DocumentToolMenus groups={[
    {id:'excel',label:'현재 장 Excel',actions:[
      {id:'export',label:`${selectedChapter}장 내보내기`,onClick:exportChapterExcel},
      {id:'import',label:`${selectedChapter}장 가져오기`,onClick:()=>chapterExcelInputRef.current?.click(),disabled:busy||!canEdit},
    ]},
    {id:'hwp',label:'HWP',actions:[
      {id:'edit',label:`HWP/HWPX 가져오기·편집 · ${selectedChapter}장에 적용`,onClick:openChapterHwp,disabled:busy||!canEdit},
    ]},
  ]}/>:null;
  const finalizationActions=activeProposal&&<><Button className="proposal-action-revise" onClick={()=>setStep(3)} disabled={busy}>← 수정 · 3단계로</Button>{activeProposal.status==='APPROVED'?<><Button className="final-export-button is-docx" aria-label="확정 제안서 Word DOCX 내려받기" title="미리보기와 동일한 DOCX 내려받기" onClick={()=>void download('docx')} disabled={busy}><FileFormatIcon format="docx"/><span>Word DOCX</span></Button><Button className="final-export-button is-pdf" aria-label="확정 제안서 PDF 내려받기" title="미리보기와 동일한 PDF 내려받기" onClick={()=>void download('pdf')} disabled={busy}><FileFormatIcon format="pdf"/><span>PDF</span></Button><Button className="final-export-button is-hwp" aria-label="확정 제안서 HWP 내려받기" title="편집기를 열지 않고 확정 HWP 내려받기" onClick={()=>void download('hwp')} disabled={busy}><FileFormatIcon format="hwp"/><span>HWP</span></Button><Button onClick={()=>onNavigate('/workflow/award?caseId='+encodeURIComponent(selectedCaseId)+'&proposalId='+encodeURIComponent(activeProposal.id))}>프로젝트 접수로 →</Button><Button variant="secondary" onClick={()=>goToProposalStep(5)} disabled={busy}>5단계 · 메일 준비</Button></>:<Button className="proposal-action-confirm" onClick={()=>setConfirmProposalOpen(true)} disabled={busy||!canEdit||activeProposal.status!=='DRAFT'}>확정 · 프로젝트 접수로</Button>}</>;
  return <div className="proposal-view-container proposal-studio-v2">
    <AiGenerationProgressModal isOpen={Boolean(aiGeneration)} status={aiGeneration?.status??'running'} providerLabel="Gemini" title={aiGeneration?.kind==='improve'?'Gemini가 선택한 제안서 문장을 개선하고 있습니다':'Gemini가 제안서 최초 초안을 작성하고 있습니다'} description={aiGeneration?.kind==='improve'?'사실과 수치는 유지하면서 문장 구조와 제안서 설득력을 다듬습니다. 원문은 확인 전까지 유지됩니다.':'의뢰·회의록·1단계 입력을 확인해 2장→1장→3장 순서로 초안을 작성하고 회사 고정 모듈을 결합합니다.'} stages={aiGeneration?.kind==='improve'?['AI 공급자 응답 대기','사실·수치 보존','제안서 문체 개선','비교본 준비']:['AI 공급자 응답 대기','2장→1장→3장 통합 초안 작성','회사 공통 4~12장 최신본 병합','금액 마스킹·편집본 저장']} completeMessage={aiGeneration?.kind==='improve'?'개선안이 준비되었습니다. 원문과 비교한 뒤 적용하세요.':'최초 AI 초안이 완료되었습니다. 이제 3단계에서 모든 문장을 직접 검수·수정하세요.'} errorMessage={aiGeneration?.error} confirmLabel={aiGeneration?.kind==='improve'?'편집 화면으로':'확인하고 담당자 검수로'} timeoutHintSeconds={aiGeneration?.kind==='draft'?90:90} retryLabel="Gemini 초안 다시 작성" onRetry={aiGeneration?.kind==='draft'?()=>void saveVersion('AI'):undefined} onConfirm={()=>{const kind=aiGeneration?.kind;setAiGeneration(null);if(kind==='draft')goToProposalStep(3);}} onClose={()=>setAiGeneration(null)}/>
    <RhwpEditorDialog isOpen={hwpEditorOpen} sourceFile={hwpSourceFile} suggestedName={`${projectTitle||'클레임센터_제안서'}${hwpApplyChapter?`_${String(hwpApplyChapter).padStart(2,'0')}장`:''}.hwp`} documentLabel={hwpApplyChapter?`프로젝트 제안서 ${hwpApplyChapter}장`:'프로젝트 제안서 최종본'} onApplyPages={hwpApplyChapter&&activeProposal?.status==='DRAFT'?applyHwpPagesToChapter:undefined} applyLabel={hwpApplyChapter?`현재 HWP 페이지 모양을 ${hwpApplyChapter}장에 적용`:undefined} onClose={()=>{setHwpEditorOpen(false);setHwpSourceFile(null);setHwpApplyChapter(null);}}/>
    {errorMessage&&<Dialog isOpen title="제안서 작업 확인" onClose={()=>setErrorMessage(null)}><p className="error-text">{errorMessage}</p></Dialog>}
    <Dialog isOpen={Boolean(pendingNavigation)} title="작성 중인 제안서를 두고 이동할까요?" onClose={()=>setPendingNavigation(null)}><p>저장하지 않은 입력 또는 편집 내용이 있습니다. 이동하면 이 변경은 사라질 수 있습니다.</p><div className="action-row"><Button variant="secondary" onClick={()=>setPendingNavigation(null)}>계속 작성</Button><Button variant="danger" onClick={()=>{const navigation=pendingNavigation;setPendingNavigation(null);setDirty(false);navigation?.proceed();}}>변경 버리고 이동</Button></div></Dialog>
    {templatePreview&&<Dialog isOpen title="유형별 대표 제안서 구조" onClose={()=>setTemplatePreview(false)}><div className="proposal-template-dialog"><p><b>{selectedProposalType?.label??'컨코스트 표준 제안서'}</b><br/>{selectedProposalType?.description} 1·2·3장은 이 유형의 관리자 지침으로 작성하고, 4~12장은 모든 유형에서 같은 회사 공통 기본 모듈 최신본을 사용합니다.</p><ol>{chapterTitles.map((title,index)=><li key={title}><b>{index+1}. {title}</b><span>{index<3?`${selectedProposalType?.label??'선택 유형'} 지침 → 담당자 전면 편집`:'관리자 승인 회사 공통 기본 모듈 자동 병합'}</span></li>)}</ol><h4>6개 제안서 유형 · 대표 템플릿</h4><ul>{templateTypes.map((type)=><li key={type.id}><button type="button" className={type.id===selectedTemplateType?'is-selected':''} onClick={()=>chooseProposalType(type.id)}><b>{type.label}</b> · {type.representativeSourceName}<small>{type.description} · 1~3장 지침 {type.promptReady?'준비 완료':'관리자 확인 필요'}</small></button></li>)}</ul></div></Dialog>}
    {confirmProposalOpen&&<Dialog isOpen title="제안서를 최종 확정할까요?" onClose={()=>!busy&&setConfirmProposalOpen(false)} hideDefaultAction><div className="proposal-confirm-dialog"><p>갑지·목차·12개 챕터와 이미지가 현재 미리보기 그대로 확정됩니다. 확정 후 DOCX·PDF·HWP 직접 내려받기가 활성화되고 이 버전은 확정본으로 보관됩니다. 확정이 완료되면 해당 제안서의 프로젝트 접수 화면으로 이동합니다.</p><strong>확정 후 내용을 바꾸려면 기존 확정본을 보존한 채 새 편집 버전을 만들어야 합니다.</strong><div className="dialog-actions"><Button variant="secondary" onClick={()=>setConfirmProposalOpen(false)} disabled={busy}>아니요 · 다시 확인</Button><Button onClick={()=>void confirmProposal()} disabled={busy||activeProposal?.status!=='DRAFT'}>네 · 제안서 확정</Button></div></div></Dialog>}
    {proposalImprovement&&<Dialog isOpen title="Gemini 제안서 문장 개선안 비교" size="wide" hideDefaultAction onClose={()=>setProposalImprovement(null)}><div className="report-improvement-compare proposal-improvement-compare"><section><span>원문 · 그대로 보존 중</span><p>{proposalImprovement.original}</p></section><section><span>Gemini 개선안 · 적용 전</span><p>{proposalImprovement.replacement}</p></section><p className="notice-box">원문의 사실·숫자·날짜·고유명사와 의미를 보존한 개선안만 표시합니다. 두 내용을 나란히 확인한 뒤 적용하세요.</p><div className="action-row"><Button variant="secondary" onClick={()=>setProposalImprovement(null)}>취소 · 원문 유지</Button><Button className="proposal-action-confirm" onClick={applyProposalImprovement}>검토 완료 · 개선안 적용</Button></div></div></Dialog>}
    {intakeStoragePending&&<div className="proposal-storage-warning" role="status"><div><b>의뢰 저장 완료 · 제안서 작성 가능</b><span>Google Drive 연결이 만료되어 첨부 원본만 보관 대기 중입니다. 제안서 작성은 계속할 수 있으며, 관리자가 Drive를 다시 연결한 뒤 원본 보관을 재시도하세요.</span></div><Button variant="secondary" onClick={()=>onNavigate('/settings?section=admin')}>Google Drive 다시 연결</Button></div>}
    {successMessage&&<div className="proposal-success" role="status"><b>완료</b><span>{successMessage}</span><button type="button" onClick={()=>setSuccessMessage(null)}>닫기</button></div>}
    <Card title="현재 프로젝트 · 제안서 유형"><div className="proposal-project-bar proposal-project-template-bar"><Select searchable searchPlaceholder="프로젝트 번호·이름 검색" label="작업할 프로젝트" disabled={busy} value={selectedCaseId} onChange={(event)=>{const caseId=event.target.value;if(caseId===selectedCaseId)return;const proceed=()=>{setSelectedCaseId(caseId);setStep(1);};if(dirty)setPendingNavigation({path:`/proposals/editor?caseId=${encodeURIComponent(caseId)}`,proceed});else proceed();}} options={cases.map((item)=>({value:item.id,label:`${item.caseNumber} · ${item.title}`}))}/><Select label="제안서 유형" disabled={busy} value={selectedTemplateType} onChange={(event)=>chooseProposalType(event.target.value as ProposalTemplateCategory)} options={templateTypes.map((type)=>({value:type.id,label:type.label}))}/><label className="proposal-field proposal-representative-template"><span>유형 대표 템플릿</span><input readOnly value={selectedProposalType?.representativeSourceName??selectedTemplateSource?.sourceName??''}/></label><Button className="proposal-template-preview-button" onClick={()=>setTemplatePreview(true)}>유형별 완제품 보기</Button></div>{selectedCase&&<div className="proposal-project-context"><b>{fromIntake?'방금 등록한 프로젝트':'현재 프로젝트'}</b><strong>{selectedCase.caseNumber} · {selectedCase.title}</strong><span>{claimTypeLabel(selectedCase.claimType)} · {selectedCase.status}</span></div>}</Card>
    {(routeId==='PROP-01'||(!activeProposal && selectedCaseId))&&<Card title={routeId==='PROP-01'?'제안서 유형 선택':'제안서 작성 1단계 · 유형별 대표 템플릿'}><div className="proposal-template-pick"><Select label="제안서 6개 유형" value={selectedTemplateType} onChange={(event)=>chooseProposalType(event.target.value as ProposalTemplateCategory)} options={templateTypes.map((type)=>({value:type.id,label:type.label}))}/><label className="proposal-field proposal-representative-template"><span>고정 대표 템플릿</span><input readOnly value={selectedProposalType?.representativeSourceName??''}/></label><Button variant="secondary" onClick={()=>setTemplatePreview(true)}>유형 구성 확인</Button><Button onClick={()=>void createProposal()} disabled={!canEdit||busy||!selectedTemplateId||!selectedTemplateSourceId}>이 유형으로 제안서 시작</Button></div><p className="muted">선택한 유형의 대표 템플릿과 관리자 승인 1~3장 지침이 함께 적용됩니다. 4~12장은 유형과 관계없이 회사 공통 기본 모듈 최신본으로 고정됩니다.</p></Card>}
    {activeProposal&&<Card title={`${activeProposal.title} · 제안서 스튜디오 · 작성 4단계 + 메일 준비`} className="proposal-step-card">
      <div className="proposal-status-row"><StatusBadge status={statusBadge(activeProposal.status)}/><span>저장 버전 v{currentVersion?.versionNumber??1}</span><span>편집 버전 {activeProposal.version}</span>{currentVersion?.generationMode==='AI'&&<StatusBadge status="ai_draft"/>}</div>
      <nav className="proposal-four-steps has-mail-step" aria-label="제안서 작성 및 메일 준비 5단계">{[['01','입력','클라이언트·쟁점'],['02','제안서 초안 작성','AI 또는 수동 선택'],['03','담당자 검수','갑지·목차·12챕터 편집'],['04','전체 미리보기·확정','확정 후 프로젝트 접수'],['05','메일 발송 준비','확정 후 선택 사항']].map((item,index)=>{const target=index+1;const unlocked=target===5?activeProposal.status==='APPROVED'&&!dirty:target===1||target===2&&!step1Missing.length||target===3&&!step1Missing.length&&firstThreeComplete&&(!dirty||Boolean(currentVersion))||target===4&&!step1Missing.length&&allChaptersComplete&&!dirty&&Boolean(currentVersion);return <button key={item[0]} className={`proposal-step-button ${step===target?'active':''}`} aria-current={step===target?'step':undefined} aria-disabled={!unlocked} disabled={busy} onClick={()=>goToProposalStep(target)}><b>{item[0]}</b><span>{item[1]}</span><small>{unlocked?item[2]:'앞 단계 완료 후 열림'}</small></button>;})}</nav>
      {stepValidationMessage&&<p className="proposal-step-validation" role="alert">{stepValidationMessage}</p>}
      <input ref={excelInputRef} hidden type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event)=>void importExcel(event.target.files?.[0])}/>
      <input ref={chapterExcelInputRef} hidden type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event)=>void importChapterExcel(event.target.files?.[0])}/>
      {step===1&&<div className="proposal-stage proposal-stage-input">
        <header className="workflow-stage-title"><div><b>STEP 1</b><h3>클라이언트와 프로젝트 사실을 입력하세요.</h3><p>연한 노란색은 반드시 확인·입력해야 하는 항목입니다. 모르면 추측하지 말고 ‘확인 필요’라고 적으세요.</p></div>{stepOneDocumentTools}</header>
        <aside className="proposal-input-guidance" aria-label="제안서 작성 기준"><strong>작성 기준</strong><span>프로젝트 접수 내용 → 계약·발주처 자료 → 회의록 순으로 확인된 사실을 사용합니다. 클라이언트명은 갑지의 제출처에 그대로 표시되므로 실명 제출이 원칙이며, 외부 공유용 익명본이 필요한 경우에만 승인된 익명 표기를 입력하고 4단계에서 다시 확인하세요.</span></aside>
        <div className="proposal-input-grid">
          <Input disabled={busy||!canEdit} required label="클라이언트명" value={clientName} onChange={(event)=>{setClientName(event.target.value);setDirty(true);}}/>
          <Input disabled={busy||!canEdit} required label="프로젝트 제목" value={projectTitle} onChange={(event)=>{setProjectTitle(event.target.value);setDirty(true);}}/>
          <Input disabled={busy||!canEdit} required label="제안서 부제" value={subtitle} onChange={(event)=>{setSubtitle(event.target.value);setDirty(true);}}/>
          <Input disabled={busy||!canEdit} required label="제출일" type="date" value={submissionDate} onChange={(event)=>{setSubmissionDate(event.target.value);setDirty(true);}}/>
          <label className="proposal-field proposal-step1-textarea"><span>당 현장의 핵심 쟁점 분석 <i className="ui-required-mark">*</i></span><textarea disabled={busy||!canEdit} required aria-required="true" value={keyIssues} onChange={(event)=>{setKeyIssues(event.target.value);setDirty(true);}} placeholder="계약조건, 물가변동 기준일, 단가조정 등 확인된 사실"/></label>
          <label className="proposal-field proposal-step1-textarea"><span>제안 목적·의뢰 배경 <i className="ui-required-mark">*</i></span><textarea disabled={busy||!canEdit} required aria-required="true" value={objective} onChange={(event)=>{setObjective(event.target.value);setDirty(true);}}/></label>
          <label className="proposal-field proposal-step1-textarea"><span>업무 수행 내용 <i className="ui-required-mark">*</i></span><textarea disabled={busy||!canEdit} required aria-required="true" value={planNotes} onChange={(event)=>{setPlanNotes(event.target.value);setDirty(true);}}/></label>
          <label className="proposal-field proposal-step1-textarea is-optional"><span>제외·추가 확인 사항</span><textarea disabled={busy||!canEdit} value={exclusions} onChange={(event)=>{setExclusions(event.target.value);setDirty(true);}}/></label>
        </div>
        <div className="proposal-next"><Button className="workflow-next-action" onClick={()=>goToProposalStep(2)}>입력 완료 · 초안 작성 방식 선택 →</Button></div>
      </div>}
      {step===2&&<div className="proposal-stage proposal-ai-stage">
        <header className="workflow-stage-title"><div><b>STEP 2</b><h3>제안서 초안 작성 방식을 선택하세요.</h3><p>Gemini 자동작성과 수동 작성 중 하나를 선택합니다. 다른 LLM에서 만든 내용도 직접 붙여넣을 수 있으며 3단계 검수·확정 흐름은 동일합니다.</p></div></header>
        <div className="proposal-draft-methods" role="radiogroup" aria-label="제안서 초안 작성 방식">
          <button type="button" role="radio" aria-checked={draftMethod==='AI'} className={draftMethod==='AI'?'is-selected is-ai':''} onClick={()=>chooseDraftMethod('AI')}><span>✦ AI 자동작성</span><b>Gemini로 1~3장 초안 생성</b><small>1단계 입력과 프로젝트 근거를 사용합니다. API 연결이 필요합니다.</small></button>
          <button type="button" role="radio" aria-checked={draftMethod==='MANUAL'} className={draftMethod==='MANUAL'?'is-selected is-manual':''} onClick={()=>chooseDraftMethod('MANUAL')}><span>⌨ 수동·외부 LLM</span><b>직접 작성 또는 결과 붙여넣기</b><small>API 키 없이 작성하며 HWP·ChatGPT·Claude 등 외부 초안도 사용할 수 있습니다.</small></button>
        </div>
        {draftMethod==='AI'?<><div className="proposal-ai-map"><div><b>Gemini 최초 초안</b><strong>01 · 02 · 03장</strong><span>목적, 핵심 쟁점, 수행계획 · 프로젝트당 1회</span></div><div><b>회사 공통 기본 모듈 병합</b><strong>04 ~ 12장</strong><span>전문가, 강점, 조직, 실적, 자격, 용역조건, 맺음말</span></div><div><b>보안 검증</b><strong>금액 마스킹</strong><span>AI 응답과 저장값의 민감정보 검증</span></div></div><label className="proposal-field"><span>근거 자료 버전 ID (선택, 쉼표 구분)</span><textarea value={sourceDocumentVersionIds} onChange={(event)=>{setSourceDocumentVersionIds(event.target.value);setDirty(true);}} placeholder="DOCVER-..."/></label>{hasAiDraft&&<p className="proposal-ai-once-complete" role="status"><b>✓ 최초 AI 초안 생성 완료</b><span>이제 3단계에서 사람이 직접 수정하세요. 기존 초안은 AI로 다시 덮어쓸 수 없습니다.</span></p>}</>:<ProposalManualDraft chapters={chapters.slice(0,3)} documentKey={`proposal-manual-${activeProposal.id}`} readOnly={!canEdit||busy} onChange={(number,body,editorJson)=>{setChapters(current=>current.map(chapter=>chapter.number===number?{...chapter,body,editorJson}:chapter));setDirty(true);}}/>}
        <div className="proposal-next"><Button variant="secondary" onClick={()=>goToProposalStep(1)}>← 입력 수정</Button>{draftMethod==='AI'?(hasAiDraft?<Button className="workflow-next-action" onClick={()=>goToProposalStep(3)}>담당자 검수·편집으로 →</Button>:<Button className="gemini-action-button" onClick={()=>void saveVersion('AI')} disabled={busy||!canEdit}><span className="gemini-button-star" aria-hidden="true">✦</span> AI 자동작성 시작 · Gemini</Button>):<Button className="proposal-action-confirm workflow-next-action" onClick={()=>void saveVersion('MANUAL',3)} disabled={busy||!canEdit||!firstThreeComplete}>수동 초안 저장 · 담당자 검수로 →</Button>}</div>
      </div>}
      {step===3&&<div className="proposal-stage proposal-editor-stage">
        <header className="workflow-stage-title"><div><b>STEP 3</b><h3>갑지·목차와 1~12장 전체를 직접 검수·수정하세요.</h3><p>갑지의 가변 제목과 제출 정보, 목차 제목, 본문 글꼴·크기·색상·표·원본 이미지를 모두 확인합니다. 최종 출력은 전 페이지 A4 세로형으로 고정됩니다.</p></div>{stepThreeDocumentTools}</header>
        {activeProposal.status!=='DRAFT'&&<section aria-label="확정본 보존 및 새 편집본"><p className="document-review-note">사진 추가·HWP 적용 전 새 편집본을 만드세요. 현재 내용으로 초안을 저장하며 기존 확정본과 원본 사진은 보존합니다.</p><Button onClick={()=>void saveVersion('MANUAL',3)} disabled={busy||!canEdit}>기존 확정본 보존 · 새 편집본 만들기</Button></section>}
        <div className="proposal-editor-grid">
          <aside className="proposal-toc" aria-label="갑지·목차·12개 챕터 편집 목록">
            <button type="button" className={reviewSurface==='cover'?'active':''} onClick={()=>{setReviewSurface('cover');setProposalSelection(null);}}><b>갑</b><span>갑지</span><small>가변 제목 · 제출 정보 편집</small></button>
            <button type="button" className={reviewSurface==='toc'?'active':''} onClick={()=>{setReviewSurface('toc');setProposalSelection(null);}}><b>목</b><span>목차</span><small>12개 챕터 제목 편집</small></button>
            {chapters.map((item)=><button type="button" key={item.number} className={reviewSurface==='chapter'&&selectedChapter===item.number?'active':''} onClick={()=>{setReviewSurface('chapter');setSelectedChapter(item.number);setProposalSelection(null);}}><b>{String(item.number).padStart(2,'0')}</b><span>{item.title}</span><small>{item.number<=3?'프로젝트 초안 편집':'공통 기본값 · 제안서별 편집'}</small></button>)}
            <details className="proposal-module-controls"><summary>회사 공통 모듈 적용</summary><p className="document-review-note">최신 승인본으로 현재 제안서의 4~12장을 교체합니다.</p><Button variant="secondary" onClick={applyLatestCompanyModules} disabled={busy||!canEdit}>4~12장 공통 기본값 전체 적용</Button><div className="proposal-module-panel">{modules.map((module)=><label key={module.code}><input type="checkbox" checked={includedModuleCodes.includes(module.code)} disabled={busy||!canEdit} onChange={(event)=>setCompanyModuleIncluded(module,event.target.checked)}/><span><b>{module.chapterNumber}. {module.title}</b><small>승인본 v{module.version} · {includedModuleCodes.includes(module.code)?'적용 중':'제외'}</small></span></label>)}</div></details>
          </aside>
          <main className="proposal-chapter-editor">
            {reviewSurface==='cover'&&<section className="proposal-frontmatter-editor" aria-labelledby="proposal-cover-review-title"><div><span>HUMAN REVIEW & EDIT · COVER</span><h3 id="proposal-cover-review-title">갑지 제목과 제출 정보를 확인하세요.</h3></div><div className="proposal-frontmatter-fields"><Input disabled={busy||!canEdit} required label="프로젝트 제목" value={projectTitle} onChange={(event)=>{setProjectTitle(event.target.value);setDirty(true);}}/><Input disabled={busy||!canEdit} required label="제안서 제목" value={subtitle} onChange={(event)=>{setSubtitle(event.target.value);setDirty(true);}}/><Input disabled={busy||!canEdit} required label="제출처" value={clientName} onChange={(event)=>{setClientName(event.target.value);setDirty(true);}}/><Input disabled={busy||!canEdit} required label="제출일" type="date" value={submissionDate} onChange={(event)=>{setSubmissionDate(event.target.value);setDirty(true);}}/></div></section>}
            {reviewSurface==='toc'&&<section className="proposal-frontmatter-editor" aria-labelledby="proposal-toc-review-title"><div><span>HUMAN REVIEW & EDIT · TABLE OF CONTENTS</span><h3 id="proposal-toc-review-title">목차 제목을 최종 확인·편집하세요.</h3></div><div className="proposal-toc-editor-list">{chapters.map((item)=><label key={item.number}><span>{String(item.number).padStart(2,'0')}</span><input disabled={busy||!canEdit} value={item.title} maxLength={100} onChange={(event)=>{const title=event.target.value;setChapters((current)=>current.map((candidate)=>candidate.number===item.number?{...candidate,title}:candidate));setDirty(true);}}/></label>)}</div></section>}
            {reviewSurface==='chapter'&&<>
              <StructuredDocumentEditor key={`proposal-${activeProposal.id}-${chapter.number}`} ref={proposalEditorRef} pageMode="a4-portrait" onRequestInsertImage={()=>{if(busy||!canEdit)return;proposalEditorRef.current?.focus();proposalImageInputRef.current?.click();}} previewContent={<ProposalFinalChapterPages item={chapter} startPage={3} onPageCount={ignoreProposalPageCount}/>} documentKey={`proposal-${activeProposal.id}-${chapter.number}`} label={`${chapter.number}. ${chapter.title}`} value={chapter.body} editorJson={chapter.editorJson} readOnly={!canEdit||busy} onSelectionChange={setProposalSelection} selectionAssistant={{busy,disabled:!canEdit,instruction:proposalImproveInstruction,onInstructionChange:setProposalImproveInstruction,onImprove:(mode,selection)=>void improveProposalSelection(mode==='professional'?'문법과 맞춤법을 바로잡고 전문적인 건설 클레임 제안서 문체로 다듬어 주세요. 사실과 수치는 유지하세요.':mode==='concise'?'중복을 줄이고 비전문가도 이해할 수 있게 간결하고 명확하게 고쳐 주세요. 사실과 수치는 유지하세요.':proposalImproveInstruction,selection)}} onChange={(next,json)=>{setChapters((current)=>current.map((item)=>item.number===chapter.number?{...item,body:next,editorJson:json}:item));setDirty(true);}}/>
              <input ref={proposalImageInputRef} hidden type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={(event)=>{if(activeProposal.status!=='DRAFT'){setErrorMessage('기존 확정본 보존 · 새 편집본 만들기를 먼저 눌러 주세요. 확정본에는 사진을 직접 추가하지 않습니다.');event.target.value='';return;}void uploadProposalImage(event.target.files?.[0]);}}/>
              {chapter.number>=4&&<p className="proposal-copy-notice">이 장은 중앙 공통 모듈을 복사해 온 현재 제안서 전용 편집본입니다. 실적·자격·조직도·맺음말을 자유롭게 수정하고 표와 원본 이미지를 추가할 수 있습니다.</p>}</>}
          </main>
          {reviewSurface!=='chapter'&&<DocumentPreviewPane title="출력 미리보기">
            {reviewSurface==='cover'?<ProposalCoverPage projectTitle={projectTitle} subtitle={subtitle} clientName={clientName} submissionDate={submissionDate}/>:<ProposalTableOfContentsPage chapters={chapters} pageCounts={{}}/>}
          </DocumentPreviewPane>}
        </div>
        {canManageModules&&<>
          <section className="proposal-admin-module-editor"><div><b>관리자 · 회사 공통 기본 모듈 DB 편집</b><span>4~12장 신규 제안서의 기본값을 관리합니다. 저장하면 현재 제안서의 같은 장에도 즉시 적용되며, 개별 제안서 편집 내용은 중앙 DB에 역반영되지 않습니다.</span></div><Select disabled={busy} label="편집할 기본 챕터" value={selectedModuleCode} onChange={(event)=>setSelectedModuleCode(event.target.value)} options={modules.map((module)=>({value:module.code,label:`${module.chapterNumber}. ${module.title} · v${module.version}`}))}/><Input disabled={busy} label="챕터 제목" value={moduleTitle} onChange={(event)=>{setModuleTitle(event.target.value);setDirty(true);}}/><div className="proposal-admin-body-grid"><label className="proposal-field"><span>관리자 승인 원문 · Markdown 표 지원</span><textarea disabled={busy} value={moduleBody} onChange={(event)=>{setModuleBody(event.target.value);setDirty(true);}}/></label><section><b>완제품 구조 미리보기</b><ProposalRichContent body={moduleBody} assets={companyAssets.filter((asset)=>asset.chapterNumber===modules.find((module)=>module.code===selectedModuleCode)?.chapterNumber)}/></section></div><label className="proposal-module-active"><input disabled={busy} type="checkbox" checked={moduleActive} onChange={(event)=>{setModuleActive(event.target.checked);setDirty(true);}}/><span>신규 제안서에 이 모듈 사용</span></label><Button onClick={()=>void saveCompanyModule()} disabled={busy||!moduleTitle.trim()||!moduleBody.trim()}>공통 DB 새 버전 저장 · 현재 장 적용</Button></section>
          <section className="proposal-admin-module-editor" aria-label="새 공통 이미지 등록">
            <div><b>학위·자격·실적 이미지 추가</b><span>위에서 선택한 공통 장에 새 이미지를 추가합니다. 모든 제안서 유형이 같은 기본 이미지를 사용하며, 기존 저장본은 자동 변경하지 않습니다.</span></div>
            <Input label="추가할 공통 이미지 제목" maxLength={160} value={companyImageTitle} onChange={(event)=>{setCompanyImageTitle(event.target.value);setDirty(true);}} disabled={busy}/>
            <label className="proposal-field"><span>공통 이미지 파일 · JPG/PNG/WebP, 변환 후 2MB 이하</span><input ref={companyImageInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" disabled={busy} onChange={(event)=>{setCompanyImageFile(event.target.files?.[0]??null);setDirty(true);}}/></label>
            <p role="status">대상: {modules.find((module)=>module.code===selectedModuleCode)?.chapterNumber}장 · {moduleTitle}. 이미지 신규 등록은 4~10장을 지원합니다.</p>
            <Button onClick={()=>void addCompanyImage()} disabled={busy||!companyImageFile||!companyImageTitle.trim()||(modules.find((module)=>module.code===selectedModuleCode)?.chapterNumber??0)>10}>공통 기본 이미지 추가</Button>
          </section>
          <section className="proposal-admin-asset-manager"><header><div><b>관리자 · 회사 기본 이미지 DB</b><span>조직도·전문가 프로필·자격 증명·저서 이미지의 신규 제안서 기본값입니다. 개별 제안서에는 위의 원본 이미지 삽입 버튼으로 별도 자료를 추가하세요.</span></div><StatusBadge status={companyAssets.some((asset)=>asset.hasContent)?'completed':'unwritten'}/></header><div className="proposal-admin-asset-grid">{companyAssets.filter((asset)=>asset.assetKey!=='BRAND_LOGO').map((asset)=><article key={asset.assetKey}><div className="proposal-admin-asset-preview">{asset.hasContent?<img src={`/api/proposal-studio/assets/${asset.assetKey}?v=${asset.version}`} alt={asset.altText}/>:<span>원본 이미지<br/>등록 대기</span>}</div><div><b>{asset.chapterNumber}장 · {asset.title}</b><small>{asset.hasContent?`${asset.width}×${asset.height}px · 보호 DB v${asset.version}`:'260728 HWP 원본 JPG를 등록하세요.'}</small></div><label className="proposal-admin-asset-upload"><span>{asset.hasContent?'기본 이미지 교체':'HWP 원본 JPG 등록'}</span><input type="file" accept=".jpg,.jpeg,image/jpeg" disabled={busy} onChange={(event)=>void uploadCompanyAsset(asset,event.target.files?.[0])}/></label></article>)}</div></section>
        </>}
        <div className="proposal-next"><Button variant="secondary" onClick={()=>goToProposalStep(2)}>← 초안 작성 방식</Button><Button className="proposal-action-confirm" onClick={()=>void saveVersion('MANUAL')} disabled={busy||!canEdit}>검수 완료 · 전체 합본 미리보기 →</Button></div>
      </div>}
      {step===4&&<section className="proposal-finalization-workspace">
        <header><div><b>STEP 4 · 전체 합본 미리보기</b><h3>갑지부터 목차·맺음말까지 모두 확인하세요.</h3><p>아래 화면이 DOCX·PDF·HWP에 반영될 최종 순서입니다. 내용이 다르면 3단계로 돌아가 수정하고, 맞으면 제안서를 확정하세요.</p></div><StatusBadge status={activeProposal.status==='APPROVED'?'approved':'in_review'}/></header>
        <div className={`proposal-finalization-status is-${activeProposal.status.toLowerCase()}`}><b>{activeProposal.status==='APPROVED'?'✓ 제안서 확정·보관 완료':'확정 전 전체 내용 확인 중'}</b><span>{activeProposal.status==='APPROVED'?'아래 3종 내려받기 버튼이 활성화되었습니다. 확정본은 변경 이력과 함께 보관됩니다.':'갑지·목차·12개 챕터·이미지를 마지막으로 확인한 뒤 확정하세요.'}</span></div>
        <div className="proposal-finalization-layout">
        <aside className="proposal-finalization-actions" aria-label="제안서 확정 및 내보내기"><ProposalPageNavigation root={finalPreviewRef}/>{finalizationActions}</aside>
        <div ref={finalPreviewRef} className="proposal-final-export-source"><ProposalFinalDocumentPreview projectTitle={projectTitle} subtitle={subtitle} clientName={clientName} submissionDate={submissionDate} chapters={chapters} revision={activeProposal.currentVersionId??`draft-${activeProposal.version}`}/></div>
        </div>
        <footer className="proposal-finalization-footer" aria-label="제안서 마지막 확인 및 프로젝트 접수">{finalizationActions}</footer>
      </section>}
        {step===5&&activeProposal.status==='APPROVED'&&<section className="proposal-mail-preview" aria-labelledby="proposal-mail-title"><header><div><b>STEP 5 · 메일 발송 준비</b><h3 id="proposal-mail-title">제안서 이메일 발송 준비</h3><p>수신자와 본문을 미리 작성하는 화면입니다. 회사 메일 서버는 아직 연결하지 않아 실제 발송은 되지 않습니다.</p></div><span>메일 서버 연동 예정</span></header><div className="proposal-mail-grid"><label><span>보내는 사람</span><input value={userEmail||'현재 로그인 회사 계정'} readOnly/></label><label><span>받는 사람</span><input type="email" value={mailRecipient} onChange={(event)=>setMailRecipient(event.target.value)} placeholder="client@example.com"/></label><label className="wide"><span>제목</span><input value={mailSubject} onChange={(event)=>setMailSubject(event.target.value)}/></label><label className="wide"><span>메일 내용</span><textarea value={mailBody} onChange={(event)=>setMailBody(event.target.value)}/></label></div><div className="proposal-mail-attachment"><b>첨부 예정</b><span>{projectTitle} · 확정 DOCX/PDF/HWP</span><button type="button" disabled title="회사 메일 발송 백엔드 연결 후 활성화됩니다.">메일 서버 연결 후 발송 가능</button></div><div className="proposal-next"><Button variant="secondary" onClick={()=>goToProposalStep(4)}>← 확정본 확인·내려받기</Button><Button onClick={()=>onNavigate('/workflow/award?caseId='+encodeURIComponent(selectedCaseId)+'&proposalId='+encodeURIComponent(activeProposal.id))}>프로젝트 접수로 →</Button></div></section>}
    </Card>}
  </div>;
};
