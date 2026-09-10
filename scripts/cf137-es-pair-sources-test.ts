import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { utils, write } from 'xlsx';
import { fetchEsPairSources, machineryPair, parseMachineryPage, parsePpsPairRows, PPS_PAIR_PUBLICATIONS } from '../apps/cloudflare/src/es-pair-sources';
import { applyEsPairSources } from '../packages/document-engine/src/es-pair-candidates';
import { newEsInput, calculateEs, type EsPair } from '../packages/document-engine/src/es-calculation';
import { syncEsSourceDates } from '../packages/document-engine/src/es-source-history';
import { handleServerSettingsRequest, type ServerSettingsAdapterOptions } from '../apps/api/src/settings/server-settings-adapter';

// Structural synthetic fixtures. No customer data or copied official attachments.
const rows = (base = '23-05-10', date = '26-01-01') => [
  ['표준시장단가 지수총괄표'], [], [], [], ['', '', '기준일', '전체품목수', '품목수', '총금액', '평균금액'],
  ['합성', '토목', base, '5', '3', '1,001', '333', date, '6', '3', '1,202', '400']
];
const cell = (str: string, row: number, column: number) => ({ str, transform: [0,1,1,0,row,column] });
const page = () => [cell('(천원)',109,440),cell('손료(원)',109,517),cell('0101-0007',132,191),cell('7ton',132,263),cell('76,547',132,473),cell('13,862 동력15.1㎾',132,534),cell('9.0',132,596),cell('16',132,644)];
const machine = (code: string, hourly: string, price = '100', specification = '합성기종') => ({ code, hourly, price, specification });
const input = () => { const n = newEsInput(); n.baseDate = '2023-11-15'; n.adjustmentDate = '2026-04-03'; return syncEsSourceDates(n); };
const pair = (): EsPair => ({ ...parsePpsPairRows(rows(),1,'2023-05-10','2026-01-01'), source:'합성 검증 근거' });
const candidate = () => ({ baseDate:'2023-11-15', date:'2026-04-03', index:1, pair:pair() });

test('CF137 PPS uses exact field and both effective dates, including amended civil date', () => {
  const table = rows(); table.push(['합성','토목','23-05-01','5','3','900','300','26-01-01','6','3','1200','400']);
  assert.equal(parsePpsPairRows(table,1,'2023-05-10','2026-01-01').baseAverage,'333');
  assert.throws(() => parsePpsPairRows(table,4,'2023-05-10','2026-01-01'));
  assert.throws(() => parsePpsPairRows(table,1,'2023-05-10','2026-03-10'));
  table.push(table[5]); assert.throws(() => parsePpsPairRows(table,1,'2023-05-10','2026-01-01'));
});
test('CF137 PPS rejects ambiguous headers, unequal common counts and nonmatching integer totals', () => {
  for (const [column,value] of [[4,'0'],[9,'4'],[6,'334'],[5,'#REF!'],[3,'2']] as const) { const r=rows(); r[5][column]=value; assert.throws(() => parsePpsPairRows(r,1,'2023-05-10','2026-01-01')); }
  const r=rows(); r[0]=['다른 파일']; assert.throws(() => parsePpsPairRows(r,1,'2023-05-10','2026-01-01'));
});
test('CF137 machinery reads price and hourly cost by columns, never fuel or machine purchase price', () => {
  const parsed=parseMachineryPage(page()); assert.deepEqual(parsed,[{code:'0101-0007',specification:'7ton',price:'76547',hourly:'13862'}]);
  assert.throws(() => parseMachineryPage(page().filter(c=>c.str!=='손료(원)')));
  assert.throws(() => parseMachineryPage(page().filter(c=>!c.str.startsWith('13,862'))));
  assert.throws(() => parseMachineryPage([...page(),cell('9,000',132,540)]));
});
test('CF137 common machinery joins classification code, not row position; new/deleted/nonpriced classes excluded', () => {
  const a=[machine('0001-0001','100'),machine('0001-0002','201'),machine('0001-0003','900'),machine('0001-0004','800','0')];
  const b=[machine('0001-0002','301'),machine('0001-0005','999'),machine('0001-0001','200'),machine('0001-0004','800')];
  const p=machineryPair(a,b,'2023','2026'); assert.equal(p.commonCount,'2'); assert.equal(p.baseSum,'301'); assert.equal(p.baseAverage,'150'); assert.equal(p.comparisonAverage,'250');
  assert.throws(()=>machineryPair([...a,a[0]],b,'2023','2026'));
  assert.throws(()=>machineryPair(a,[machine('0001-0001','0')],'2023','2026'));
});
test('CF137 changed specification keeps existing code and both original specifications for review', () => {
  const p=machineryPair([machine('0001-0001','100','200','2.24HP')],[machine('0001-0001','200','300','2.24㎾')],'2023','2026');
  assert.equal(p.commonCount,'1'); assert.match(p.source,/2.24HP→2.24㎾/); assert.match(p.source,/원문 검토/);
});
test('CF137 confirmation is atomic and cannot change costs, safety or original input', () => {
  const n=input(); n.base.rates.safety='1.86'; n.costs[14]='11941085'; const before=JSON.stringify(n), next=applyEsPairSources(n,[candidate()]);
  assert.equal(JSON.stringify(n),before); assert.equal(next.current.standards[0].baseAverage,'333'); assert.equal(next.costs[14],'11941085'); assert.equal(next.base.rates.safety,'1.86');
  assert.equal(next.previous.standards[0].baseAverage,'');
  for (const bad of [{...candidate(),date:'2025-01-01'},{...candidate(),baseDate:'2024-01-01'},{...candidate(),index:6},{...candidate(),pair:{...pair(),commonCount:'0'}},{...candidate(),pair:{...pair(),baseSum:'1'}},{...candidate(),pair:{...pair(),source:''}},{...candidate(),pair:{...pair(),comparisonLabel:'2027-01-01'}}]) assert.throws(()=>applyEsPairSources(n,[candidate(),bad]));
  assert.equal(JSON.stringify(n),before);
});
test('CF137 amount alone is not machinery evidence; missing count still blocks calculation', () => {
  const n=input(); n.costs[14]='11941085'; assert.equal(n.current.machinery.commonCount,'');
  const next=applyEsPairSources(n,[candidate()]); assert.equal(next.current.machinery.commonCount,''); assert.ok(calculateEs(next).fatal.length);
});

test('CF137 live-structure provider selects separate electricity/civil sources and isolates machinery failure', async () => {
  const urls:string[]=[];
  const r=await fetchEsPairSources(['2023-11-15','2026-04-03','2026-04-02'],(async u=>{
    const url=new URL(String(u));urls.push(url.href);
    if(url.hostname.includes('cak'))return new Response('private error payload',{status:503});
    const electric=url.searchParams.get('key')==='202603190010', table=rows().slice(0,5);
    for(const i of electric?[4]:[1,2,3,5]) table.push(['合成',['','토목','건축','기계','전기','통신'][i],['','23-05-10','23-05-01','23-05-01','23-08-30','23-07-01'][i],'5','3','1001','333',electric?'26-03-10':'26-01-01','6','3','1202','400']);
    const b=utils.book_new();utils.book_append_sheet(b,utils.aoa_to_sheet(table),'총괄표');return new Response(write(b,{type:'array',bookType:'xlsx'}));
  }) as typeof fetch);
  assert.equal(r.items.length,10);assert.equal(r.issues.length,2);assert.equal(urls.filter(u=>/fileDown|download\.do/.test(u)).length,3);assert.ok(r.issues.every(i=>i.index===0));assert.equal(JSON.stringify(r).includes('private error'),false);
});
test('CF137 invalid or future dates never fetch unverified fallback or accept user supplied URLs', async () => {
  const deny=(async()=>{throw new Error('must not fetch');}) as typeof fetch;
  await assert.rejects(fetchEsPairSources(['bad','2026-01-01','2026-01-02'],deny));
  await assert.rejects(fetchEsPairSources(['2026-01-02','2026-01-01','2026-01-01'],deny));
  const r=await fetchEsPairSources(['2023-01-01','2027-01-02','2027-01-01'],deny);assert.equal(r.items.length,0);assert.equal(r.issues.length,12);
  assert.ok(PPS_PAIR_PUBLICATIONS.some(p=>p[0]==='2023-05-10'&&p[3]===2));
});
test('CF137 Node source route protects role/method/date and performs no DB reads/writes', async () => {
  for(const [roles,method,dates,status] of [[['staff'],'GET','date=2023-01-01&date=2027-01-02&date=2027-01-01',200],[['viewer'],'GET','',403],[['admin'],'POST','',405],[['admin'],'GET','date=bad',400]] as const){
    let body='';const response={statusCode:0,setHeader(){},end(s:string){body=s;}};
    await handleServerSettingsRequest({pathname:'/api/es/sources/pairs',method,request:{url:'/api/es/sources/pairs?'+dates},response,context:{user:{id:'synthetic',organizationId:'synthetic'},roles:[...roles]},db:new Proxy({},{get(){throw new Error('DB forbidden');}}),masterKey:null} as unknown as ServerSettingsAdapterOptions);
    assert.equal(response.statusCode,status,body);
  }
});
test('CF137 UI confirms official pairs before mutation and provides missing-field recovery and manual input', () => {
  const ui=readFileSync('apps/web/src/es/EsStudio.tsx','utf8'); assert.match(ui,/applyEsPairSources\(candidate.input/); assert.match(ui,/공표일·출처·규격 변경 확인/); assert.match(ui,/data-es-pair-missing/); assert.match(ui,/onClick=\{revealMissingSource\}/); assert.match(ui,/기존 기간쌍 유지/); assert.match(ui,/delete p.baseSum/);
});
