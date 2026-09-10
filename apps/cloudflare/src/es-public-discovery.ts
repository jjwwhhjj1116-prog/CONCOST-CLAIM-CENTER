import { readPublicFile } from './es-public-sources';

export const checkedToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
const clean = (s: string) => s.replace(/<!--[\s\S]*?-->/g,'').replace(/<[^>]+>/g,' ').replace(/&(?:nbsp|amp|quot|#39);/g,m=>({'&nbsp;':' ','&amp;':'&','&quot;':'"','&#39;':"'"})[m]!).replace(/\s+/g,' ').trim();
const unescape = (s:string) => s.replaceAll('&amp;','&');
export interface PublicAttachment { title: string; url: string; key?: string; sn?: number }
export interface PublicNotice { id: string; title: string; url: string; body: string; attachments: PublicAttachment[] }
const cache = new WeakMap<typeof fetch, Map<string,{expires:number;promise:Promise<any>}>>();
function recent<T>(key:string, fetcher:typeof fetch, load:()=>Promise<T>):Promise<T> {
  let entries=cache.get(fetcher); if(!entries){entries=new Map();cache.set(fetcher,entries);}
  const old=entries.get(key); if(old && old.expires>Date.now())return old.promise;
  const entry={expires:Date.now()+3_600_000,promise:load()};
  entries.set(key,entry); void entry.promise.catch(()=>{if(entries!.get(key)===entry)entries!.delete(key);}); return entry.promise;
}
async function html(url:string,fetcher:typeof fetch) {
  const text=new TextDecoder().decode(await readPublicFile(url,fetcher,url));
  if(text.length>2_000_000 || !/<html[\s>]/i.test(text))throw new Error('PUBLIC_BOARD_INVALID');
  return text.replace(/<!--[\s\S]*?-->/g,'');
}
export function parsePpsList(text:string) {
  return [...text.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].flatMap(m=>{
    const id=m[0].match(/goView\(['"](\d{10})['"]/i)?.[1];
    return id?[id]:[];
  });
}
export function parsePpsNotice(text:string,id:string):PublicNotice {
  const title=clean(text.match(/<strong\b[^>]*class=["']title["'][^>]*>([\s\S]*?)<\/strong>/i)?.[1]??'');
  const start=text.search(/<div\b[^>]*id=["']brdContent["']/i), end=text.indexOf('class="file_cont"',start);
  if(!title || start<0 || end<0)throw new Error('PPS_NOTICE_INVALID');
  const filePart=text.slice(end), attachments=[...filePart.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(m=>{
    const href=unescape(m[1]).replace(/;jsessionid=[^?]+/i,'');
    if(!href.startsWith('/common/fileDown.do?'))return[];
    const u=new URL(href,'https://www.pps.go.kr'),key=u.searchParams.get('key'),sn=u.searchParams.get('sn');
    if(!key || !/^\d{10,14}$/.test(key) || !sn || !/^\d{1,2}$/.test(sn))throw new Error('PPS_ATTACHMENT_INVALID');
    const name=clean(m[2])||clean(m[2].match(/alt=["']([^"']+)/)?.[1]??'');
    return [{title:name,url:'https://www.pps.go.kr/common/fileDown.do?key='+key+'&sn='+sn,key,sn:Number(sn)}];
  });
  return {id,title,url:'https://www.pps.go.kr/kor/bbs/view.do?bbsSn='+id+'&key=00038',body:clean(text.slice(start,end)),attachments};
}
export function latestPpsNotices(kind:'rates'|'pairs',fetcher:typeof fetch=fetch):Promise<PublicNotice[]> {
  return recent('pps-'+kind,fetcher,async()=>{
    // ponytail: bounded discovery (5 pages/20 new notices); advance the verified anchor if the limit is reached.
    const anchor=kind==='rates'?'2604070010':'2607100022', ids=new Set<string>();
    try {
    for(const keyword of kind==='rates'?['제비율','간접공사비']:['표준시장단가']) {
      let complete=false;
      for(let page=1;page<=5;page++){
        const url='https://www.pps.go.kr/kor/bbs/list.do?key=00038&sc=BBS_SJ&sw='+encodeURIComponent(keyword)+'&pageIndex='+page;
        const source=await html(url,fetcher), pageIds=parsePpsList(source);
        if(!pageIds.length)throw new Error('PPS_DISCOVERY_EMPTY');
        pageIds.filter(id=>id>=anchor).forEach(id=>ids.add(id));
        if(pageIds.includes(anchor) || pageIds.at(-1)!<anchor){complete=true;break;}
      }
      if(!complete)throw new Error('PPS_DISCOVERY_LIMIT');
    }
    if(!ids.size || ids.size>20)throw new Error('PPS_DISCOVERY_LIMIT');
    } catch(error) { if(ids.size)throw new Error('PPS_DISCOVERED_NOTICE_UNVERIFIED'); throw error; }
    const results:PublicNotice[]=[];
    try { for(const id of [...ids].sort()) results.push(await getPpsNotice(id,fetcher)); }
    catch { throw new Error('PPS_DISCOVERED_NOTICE_UNVERIFIED'); }
    return results;
  });
}
export function getPpsNotice(id:string,fetcher:typeof fetch=fetch):Promise<PublicNotice> {
  if(!/^\d{10}$/.test(id))throw new Error('PPS_NOTICE_INVALID');
  return recent('pps-notice-'+id,fetcher,async()=>parsePpsNotice(await html('https://www.pps.go.kr/kor/bbs/view.do?bbsSn='+id+'&key=00038',fetcher),id));
}
export function ppsEffective(body:string,date:string):string {
  const matches=[...body.matchAll(/적용\s*시기\s*[-:○]*\s*(20\d{2})[.\-]\s*(\d{1,2})[.\-]\s*(\d{1,2})\.?\s*(?:\([^)]{1,5}\)\s*)?(?:이후\s*)?(입찰공고|(?:예비가격)?기초금액\s*발표)/g)];
  if(matches.length!==1 || matches[0][1]+'-'+matches[0][2].padStart(2,'0')+'-'+matches[0][3].padStart(2,'0')!==date)throw new Error('PPS_NEW_PUBLICATION_UNVERIFIED');
  return matches[0][4];
}
export interface CakReport { title:string; year:string; half?:string; url:string; file:string }
export function parseCakReports(text:string,mode:'wage'|'machinery',board:string):CakReport[] {
  return [...text.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].flatMap(m=>{
    const row=m[0], a=[...row.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].find(a=>/class=["']title["']/.test(a[1]));
    if(!a)return[];const title=clean(a[2]),period=mode==='wage'?title.match(/^(20\d{2})년\s*([상하])반기\s*적용\s*건설업\s*임금실태조사\s*보고서/):title.match(/^(20\d{2})년\s*건설기계의\s*기계경비\s*산출표/);
    if(!period)return[];
    const id=a[1].match(/article_seq=(\d+)/)?.[1];if(!id)throw new Error('CAK_NOTICE_INVALID');
    const files=[...row.matchAll(/href=["']\/download\.do\?uuid=([a-f0-9-]{36}\.(?:hwpx|pdf))["']/gi)].map(m=>m[1]).filter(v=>v.endsWith(mode==='wage'?'.hwpx':'.pdf'));
    return [{title,year:period[1],half:period[2],url:board.replace('list.do','view.do')+'?article_seq='+id,file:files.length===1?'https://www.cak.or.kr/download.do?uuid='+files[0]:''}];
  });
}
export function latestCakReports(mode:'wage'|'machinery',fetcher:typeof fetch=fetch):Promise<CakReport[]> {
  return recent('cak-'+mode,fetcher,async()=>{
    // Machinery board is selected from the same official construction statistics site.
    const board=mode==='wage'?'https://www.cak.or.kr/lay1/bbs/S1T41C42/A/14/list.do':'https://www.cak.or.kr/lay1/bbs/S1T43C45/A/15/list.do';
    const reports=parseCakReports(await html(board+'?cpage=1&rows=10',fetcher),mode,board);
    if(!reports.length)throw new Error('CAK_DISCOVERY_EMPTY');
    reports.sort((a,b)=>b.year.localeCompare(a.year)||(b.half==='하'?1:0)-(a.half==='하'?1:0));
    const latest=reports[0];
    try {
      if(!latest.file)throw new Error('CAK_ATTACHMENT_INVALID');
      const detail=await html(latest.url,fetcher);
      if(!detail.includes(latest.file.split('uuid=')[1]))throw new Error('CAK_ATTACHMENT_MISMATCH');
    } catch { throw new Error('CAK_ATTACHMENT_UNVERIFIED'); }
    return reports;
  });
}
