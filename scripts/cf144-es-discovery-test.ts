import assert from 'node:assert/strict';
import {test} from 'node:test';
import {zipSync,strToU8} from '../apps/web/node_modules/fflate';
import {fetchEsPublicSources} from '../apps/cloudflare/src/es-public-sources';
import {latestPpsNotices,latestCakReports,parsePpsNotice,parseCakReports,ppsEffective} from '../apps/cloudflare/src/es-public-discovery';
import {esSourceWarnings} from '../packages/document-engine/src/es-source-candidates';
import {utils,write} from 'xlsx';
import {fetchEsPairSources,CAK_MACHINERY} from '../apps/cloudflare/src/es-pair-sources';
const anchor='2604070010', newer='2701050001', key='202701050001';
const board=(ids:string[])=>'<html><table>'+ids.map(id=>'<tr><td class="title"><a onclick="goView(\''+id+'\', \'0001\');">공표</a></td></tr>').join('')+'</table></html>';
test('CF144 discovered metadata failures cannot be downgraded to an ordinary board outage',async()=>{
 const pps=(async(u:RequestInfo|URL)=>new URL(String(u)).searchParams.get('pageIndex')==='1'?new Response(board([newer])):new Response('',{status:503})) as typeof fetch;
 await assert.rejects(latestPpsNotices('rates',pps),/PPS_DISCOVERED_NOTICE_UNVERIFIED/);
 const cak=(async(u:RequestInfo|URL)=>String(u).includes('list.do')?new Response('<html><tr><a class="title" href="view.do?article_seq=999">2027년 상반기 적용 건설업 임금실태조사 보고서</a><a href="/download.do?uuid=00000000-0000-0000-0000-000000000001.hwpx">첨부</a></tr></html>'):new Response('',{status:503})) as typeof fetch;
 await assert.rejects(latestCakReports('wage',cak),/CAK_ATTACHMENT_UNVERIFIED/);
});

test('CF144 an ambiguous corrected machinery report blocks its year instead of downloading an obsolete file',async()=>{
 const calls:string[]=[],uuid=(n:number)=>'00000000-0000-0000-0000-00000000000'+n+'.pdf';
 const report=(year:string,files:number[])=>'<tr><a class="title" href="view.do?article_seq='+year+'">'+year+'년 건설기계의 기계경비 산출표</a>'+files.map(n=>'<a href="/download.do?uuid='+uuid(n)+'">첨부</a>').join('')+'</tr>';
 const result=await fetchEsPairSources(['2025-06-01','2026-06-01','2026-06-01'],(async(u)=>{
   const x=new URL(String(u));calls.push(x.href);
   if(x.hostname.includes('pps'))return new Response('',{status:503});
   if(x.pathname.endsWith('list.do'))return new Response('<html>'+report('2026',[1])+report('2025',[2,3])+'</html>');
   if(x.pathname.endsWith('view.do'))return new Response('<html>'+uuid(1)+'</html>');
   return new Response('',{status:503});
 }) as typeof fetch);
 assert.equal(calls.some(u=>u.includes(CAK_MACHINERY['2025'])),false);
 assert.equal(result.items.some(i=>i.index===0),false);
 assert.ok(result.issues.some(i=>i.index===0));
});
const notice=(id:string,broken=false)=>'<html><strong class="title">건축 간접공사비 적용기준</strong><div id="brdContent"><div>적용시기 '+(id===newer?'2027.1.5':'2026.4.13')+' 입찰공고</div><!-- misleading 2099.1.1 --></div><div class="file_cont"><a href="/common/fileDown.do;jsessionid=ignored?key='+(id===newer?key:'202604070010')+'&amp;sn=2">건축공사 적용기준'+(broken?' INVALID':'')+'</a></div></html>';
test('CF144 conflicting same-notice standard-price attachments never resolve by attachment order',async()=>{
 const result=await fetchEsPairSources(['2023-11-15','2026-08-01','2026-08-01'],(async(u)=>{
   const url=new URL(String(u));if(url.hostname.includes('cak'))return new Response('',{status:503});
   if(url.pathname.endsWith('list.do'))return new Response(board(['2607100022']));
   if(url.pathname.endsWith('view.do'))return new Response('<html><strong class="title">표준시장단가 지수</strong><div id="brdContent">공표</div><div class="file_cont">'+[1,2].map(sn=>'<a href="/common/fileDown.do?key=202607100013&sn='+sn+'">표준시장단가 지수</a>').join('')+'</div></html>');
   const count=url.searchParams.get('sn')==='1'?1200:1500;
   const rows=[['표준시장단가 지수총괄표 평균금액 품목수'],[],[],[],[],['합성','통신','23-07-01',5,3,900,300,'26-07-01',6,3,count,count/3]];
   const book=utils.book_new();utils.book_append_sheet(book,utils.aoa_to_sheet(rows),'총괄표');return new Response(write(book,{type:'array',bookType:'xlsx'}));
 }) as typeof fetch);
 assert.equal(result.items.some(i=>i.index>0),false);assert.ok(result.warnings!.some(w=>w.includes('검증 실패')));
});
function workbook(date:string,value='4.01') {
 const c:Record<string,string>={A1:'건축 원가계산 간접공사비(제비율) 적용기준',B2:'적용시기 : '+date,A10:'[건강보험료]',B10:'[연금보험료]',C10:'[노인장기요양보험료]',D10:'[산재보험료]',E10:'[퇴직공제부금비]',A14:'(직노) x 3.595',B14:'(직노) x 4.75',C14:'(건강보험료) x 13.14',D14:'(노) x '+value,E14:'(직노) x 2.3',A20:'[고용보험료]',A23:'(노) x 율',B24:'요율',A27:'[7등급]',B27:'1.01'};
 return zipSync({'[Content_Types].xml':strToU8('<Types/>'),'xl/worksheets/sheet1.xml':strToU8('<worksheet>'+Object.entries(c).map(([r,t])=>'<c r="'+r+'" t="inlineStr"><is><t>'+t+'</t></is></c>').join('')+'</worksheet>')});
}
function mockSource(state:{ids:string[];broken?:boolean;calls:string[]}) {
 return (async (u:RequestInfo|URL)=>{
  const url=new URL(String(u));state.calls.push(url.href);
  if(url.hostname.includes('cak'))return new Response('<html>unavailable</html>');
  if(url.pathname.endsWith('list.do'))return new Response(board(state.ids));
  if(url.pathname.endsWith('view.do'))return new Response(notice(url.searchParams.get('bbsSn')!));
  return new Response(state.broken?'invalid file':workbook(url.searchParams.get('key')===key?'2027.1.5':'2026.4.13'));
 }) as typeof fetch;
}
test('CF144 discovers a new publication without a code catalogue entry, uses its effective date and refuses future dates',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2027-02-01T00:00:00Z')});
 const state={ids:[newer,anchor],calls:[] as string[]},fetcher=mockSource(state);
 const result=await fetchEsPublicSources(['2027-01-10','2027-01-04','2027-03-01'],'건축','7',fetcher);
 assert.equal(result.items.find(i=>i.date==='2027-01-10'&&i.field==='injury')?.effectiveDate,'2027-01-05');
 assert.equal(result.items.find(i=>i.date==='2027-01-04'&&i.field==='injury')?.effectiveDate,'2026-04-13');
 assert.equal(result.items.some(i=>i.date==='2027-03-01'),false);
 assert.match(result.items.find(i=>i.date==='2027-01-10')!.source,new RegExp(newer));
 assert.ok(result.warnings!.some(w=>w.includes('조달청 최신 공표 자동확인')));
});
test('CF144 metadata cache expires, refreshed failures are not cached as current',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2027-02-01T00:00:00Z')});
 const state={ids:[anchor],calls:[] as string[]},fetcher=mockSource(state);
 assert.equal((await latestPpsNotices('rates',fetcher)).length,1);
 state.ids=[newer,anchor];assert.equal((await latestPpsNotices('rates',fetcher)).length,1);
 t.mock.timers.tick(3_600_001);assert.equal((await latestPpsNotices('rates',fetcher)).length,2);
 state.ids=[];t.mock.timers.tick(3_600_001);await assert.rejects(latestPpsNotices('rates',fetcher));
 state.ids=[newer,anchor];assert.equal((await latestPpsNotices('rates',fetcher)).length,2);
});
test('CF144 unverified new file does not extend the old cutoff or claim latest confirmation',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2027-02-01T00:00:00Z')});
 const result=await fetchEsPublicSources(['2027-01-10','2026-07-04'],'건축','7',mockSource({ids:[newer,anchor],broken:true,calls:[]}));
 assert.equal(result.items.length,0);assert.ok(result.warnings!.some(w=>w.includes('검증 실패')));assert.equal(result.warnings!.some(w=>w.includes('자동확인 ·')),false);
});
test('CF144 source links canonicalize official IDs and latest CAK identity ignores misleading category columns',()=>{
 const n=parsePpsNotice(notice(newer),newer);assert.equal(n.attachments[0].url,'https://www.pps.go.kr/common/fileDown.do?key='+key+'&sn=2');assert.equal(n.body.includes('2099'),false);
 assert.throws(()=>parsePpsNotice(notice(newer).replace(key,'unsafe'),newer));
 const html='<tr><td>2025</td><td><a class="title" href="view.do?article_seq=999">2027년 하반기 적용 건설업 임금실태조사 보고서</a><a href="/download.do?uuid=00000000-0000-0000-0000-000000000001.hwpx">첨부</a></td></tr>';
 const reports=parseCakReports(html,'wage','https://www.cak.or.kr/lay1/bbs/S1T41C42/A/14/list.do');assert.equal(reports[0].year,'2027');assert.equal(reports[0].half,'하');
});

test('CF144 reference dates cannot masquerade as the publication effective date; warning payloads validate before use',()=>{
 assert.equal(ppsEffective('관련일 2026.1.1 적용 시기 - 2027.1.5 입찰공고분부터 적용','2027-01-05'),'입찰공고');
 assert.throws(()=>ppsEffective('관련일 2027.1.5 적용 시기 - 2027.1.10 입찰공고분부터 적용','2027-01-05'));
 for(const bad of [{},[{}],['x'.repeat(1001)],Array(31).fill('x')])assert.throws(()=>esSourceWarnings(bad));
 assert.deepEqual(esSourceWarnings(undefined),[]);
});
test('CF144 a changed January field cannot inherit the prior-year rate before the first new publication',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2027-02-01T00:00:00Z')});
 const original=mockSource({ids:[newer,anchor],calls:[]});
 const result=await fetchEsPublicSources(['2027-01-04','2027-01-05'],'건축','7',(async(u,init)=>{
   const url=new URL(String(u));
   if(url.pathname.endsWith('fileDown.do'))return new Response(workbook(url.searchParams.get('key')===key?'2027.1.5':'2026.4.13',url.searchParams.get('key')===key?'4.1':'3.56'));
   return original(u,init);
 }) as typeof fetch);
 assert.equal(result.items.some(i=>i.date==='2027-01-04'&&i.field==='injury'),false);
 assert.equal(result.items.find(i=>i.date==='2027-01-05'&&i.field==='injury')?.value,'4.1');
 assert.equal(result.items.find(i=>i.date==='2027-01-04'&&i.field==='retirement')?.value,'2.3');
});
test('CF144 newest CAK file is discovered and its actual publication row is used without changing old stored inputs',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2027-02-01T00:00:00Z')});
 const uuid='00000000-0000-0000-0000-000000000001.hwpx';
 const rows=[['공표일','일반공사직종'],...Array.from({length:12},(_,i)=>[(2016+i)+'. 1. 1','333333'])];
 const bytes=zipSync({'Contents/section0.xml':strToU8('<hp:tbl>'+rows.map(r=>'<hp:tr>'+r.map(c=>'<hp:tc><hp:t>'+c+'</hp:t></hp:tc>').join('')+'</hp:tr>').join('')+'</hp:tbl>')});
 const original=mockSource({ids:[newer,anchor],calls:[]});
 const result=await fetchEsPublicSources(['2027-01-10'],'건축','7',(async(u,init)=>{
   const url=new URL(String(u)); if(!url.hostname.includes('cak'))return original(u,init);
   if(url.pathname.endsWith('download.do'))return new Response(bytes);
   if(url.pathname.endsWith('view.do'))return new Response('<html>'+uuid+'</html>');
   return new Response('<html><tr><td><a class="title" href="view.do?article_seq=999">2027년 상반기 적용 건설업 임금실태조사 보고서</a><a href="/download.do?uuid='+uuid+'">첨부</a></td></tr></html>');
 }) as typeof fetch);
 const wage=result.items.find(i=>i.field==='wage')!;assert.equal(wage.value,'333333');assert.equal(wage.effectiveDate,'2027-01-01');assert.ok(wage.source.includes(uuid));
});

test('CF144 new PPS standard-price workbook supplies actual field-specific periods beyond the static cutoff',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2027-02-01T00:00:00Z')});
 const pairAnchor='2607100022';
 const fetcher=(async(u:RequestInfo|URL)=>{
  const url=new URL(String(u));if(url.hostname.includes('cak'))return new Response('<html>offline</html>');
  if(url.pathname.endsWith('list.do'))return new Response(board([newer,pairAnchor]));
  if(url.pathname.endsWith('view.do')) {
   const id=url.searchParams.get('bbsSn')!;return new Response(notice(id).replace('건축공사 적용기준','표준시장단가 지수'));
  }
  const current=url.searchParams.get('key')===key?'27-01-05':'26-07-01';
  const rows:unknown[][]=[['표준시장단가지수총괄표 평균금액 품목수'],[],[],[],[]];
  for(let i=1;i<=5;i++)rows.push(['',['','토목','건축','기계','전기','통신'][i],['','23-05-10','23-05-01','23-05-01','23-08-30','23-07-01'][i],5,3,1001,333,current,6,3,1202,400]);
  const book=utils.book_new();utils.book_append_sheet(book,utils.aoa_to_sheet(rows),'총괄표');return new Response(write(book,{type:'array',bookType:'xlsx'}));
 }) as typeof fetch;
 const result=await fetchEsPairSources(['2023-11-15','2027-01-10','2027-01-09'],fetcher);
 assert.equal(result.items.length,10,JSON.stringify(result.issues));assert.ok(result.items.every(i=>i.pair.comparisonLabel==='2027-01-05'&&i.pair.commonCount==='3'));
});
test('CF144 a discovered but invalid pair workbook blocks old automatic pairs even inside the former cutoff',async()=>{
 const fetcher=(async(u:RequestInfo|URL)=>{
  const url=new URL(String(u));if(url.hostname.includes('cak'))return new Response('<html>offline</html>');
  if(url.pathname.endsWith('list.do'))return new Response(board([newer,'2607100022']));
  if(url.pathname.endsWith('view.do'))return new Response(notice(url.searchParams.get('bbsSn')!).replace('건축공사 적용기준','표준시장단가 지수'));
  return new Response('not a workbook');
 }) as typeof fetch;
 const result=await fetchEsPairSources(['2023-11-15','2026-07-04','2026-07-03'],fetcher);
 assert.equal(result.items.length,0);assert.ok(result.issues.filter(i=>i.index>0).every(i=>i.reason.includes('PAIR_NEW_PUBLICATION_UNVERIFIED')));
});
