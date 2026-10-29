import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { handleWorkspaceAssistant } from '../apps/cloudflare/src/workspace-assistant';
import { assistantFacts, assistantGuides, assistantPath, ASSISTANT_MANUAL_VERSION, ASSISTANT_ROUTES } from '../apps/web/src/layout/workspace-assistant-guide';
import { ROUTE_HELP } from '../apps/web/src/layout/workspace-help-content';
import worker from '../apps/cloudflare/src/index';

const A='10000000-0000-4000-8000-000000000001', B='10000000-0000-4000-8000-000000000002';
async function fixture(content=JSON.stringify({sourceId:'REPO-02',stepIndexes:[2,3,5]})) {
  const SQL=await initSqlJs(), sql=new SQL.Database(), userId=randomUUID(); let calls=0, inputs='';
  sql.run(`CREATE TABLE preview_cases(id TEXT PRIMARY KEY,organization_id TEXT,case_number TEXT,title TEXT,status TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE preview_case_assignments(case_id TEXT,user_id TEXT);
    CREATE TABLE preview_case_activities(case_id TEXT,event_type TEXT);
    CREATE TABLE preview_report_drafts(case_id TEXT,organization_id TEXT,version INTEGER,wizard_step INTEGER,updated_at TEXT);
    CREATE TABLE preview_report_reviews(id TEXT,case_id TEXT,organization_id TEXT,report_version INTEGER,status TEXT,requested_at TEXT);
    CREATE TABLE preview_report_finalizations(id TEXT,case_id TEXT,organization_id TEXT,report_version INTEGER,finalized_at TEXT);
    CREATE TABLE preview_proposals(id TEXT,case_id TEXT,organization_id TEXT,status TEXT,updated_at TEXT);`);
  for(const id of [A,B])sql.run('INSERT INTO preview_cases VALUES(?,?,?,?,?,?,NULL)',[id,'org','QA%_한글','PRIVATE_CUSTOMER_PROJECT','CONTRACT','2026-10-29T01:00:00Z']);
  sql.run('INSERT INTO preview_case_assignments VALUES(?,?)',[A,userId]);
  sql.run('INSERT INTO preview_report_drafts VALUES(?,?,?,?,?)',[A,'org',4,5,'2026-10-29T01:00:00Z']);
  sql.run("INSERT INTO preview_report_reviews VALUES('review',?,'org',3,'APPROVED','2026-10-28T00:00:00Z')",[A]);
  sql.run("INSERT INTO preview_report_finalizations VALUES('final',?,'org',3,'2026-10-28T00:00:00Z')",[A]);
  const db={prepare(query:string){assert.match(query,/^SELECT\b/iu,'assistant must only issue SELECT');return {bind(...values:unknown[]){return {async all(){const s=sql.prepare(query),results:unknown[]=[];try{s.bind(values as any[]);while(s.step())results.push(s.getAsObject());return {results};}finally{s.free();}},async first(){const s=sql.prepare(query);try{s.bind(values as any[]);return s.step()?s.getAsObject():null;}finally{s.free();}}};}};}};
  const context={db:db as any,organizationId:'org',userId,generate:async(system:string,input:string)=>{calls++;inputs=system+input;return {content};}};
  const body=(patch:object={})=>({question:'HWP 보고서는 어떻게 불러와?',previousQuestion:'',caseId:A,routeId:'REPO-02',...patch});
  const send=(payload:unknown=body(),headers:Record<string,string>={})=>handleWorkspaceAssistant(new Request('https://qa.invalid/api/workspace-assistant',{method:'POST',headers:{Origin:'https://qa.invalid','Content-Type':'application/json',...headers},body:JSON.stringify(payload)}),context);
  const get=(query='')=>handleWorkspaceAssistant(new Request('https://qa.invalid/api/workspace-assistant'+query),context);
  const digest=()=>createHash('sha256').update(sql.export()).digest('hex');
  return {sql,context,body,send,get,digest,get calls(){return calls;},get inputs(){return inputs;}};
}
async function ok(response:Response){assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('Cache-Control'),'no-store');return response.json() as Promise<any>;}
test('assistant own assignment scope, literal search, denied IDs and database byte preservation',async()=>{
  const f=await fixture();try{const before=f.digest();const list=await ok(await f.get());assert.deepEqual(list.projects.map((p:any)=>p.id),[A]);assert.equal((await ok(await f.get('?q=%25_'))).projects.length,1);assert.equal((await f.get('?caseId='+B)).status,404);assert.equal((await f.send(f.body({caseId:B}))).status,404);assert.equal(f.calls,0);assert.equal(f.digest(),before);}finally{f.sql.close();}
});
test('real stored versions remain separate; an old approved/final version is not the current draft',async()=>{
  const f=await fixture();try{const before=f.digest(),r=await ok(await f.send(f.body({question:'왜 출력이 안 돼?'})));assert.equal(r.snapshot.draftVersion,4);assert.equal(r.snapshot.reviewVersion,3);assert.equal(r.mode,'MANUAL');assert.match(assistantFacts(r.snapshot).join('\n'),/현재 저장본과 다른 버전/u);assert.equal(f.calls,0);f.sql.run("INSERT INTO preview_case_activities VALUES(?,'REPORT_WORKSPACE_DELETED')",[A]);const deleted=await ok(await f.get('?caseId='+A));assert.match(assistantFacts(deleted.snapshot).join('\n'),/삭제 처리됨/u);assert.doesNotMatch(assistantFacts(deleted.snapshot).join('\n'),/최근 상신/u);assert.notEqual(f.digest(),before);}finally{f.sql.close();}
});
test('same live manual sources, no customer snapshot in model input, bounded repeat and plaintext output',async()=>{
  const f=await fixture();try{const before=f.digest(),r=await ok(await f.send(f.body({question:'PRIVATE_CUSTOMER_PROJECT HWP 불러오기 방법?'})));assert.equal(r.mode,'AI');assert.equal(r.manualVersion,ASSISTANT_MANUAL_VERSION);assert.deepEqual(r.sources[0].steps,ROUTE_HELP['REPO-02'].steps);assert.ok(f.inputs.includes(ROUTE_HELP['REPO-02'].steps[2]));assert.ok(!f.inputs.includes('PRIVATE_CUSTOMER_PROJECT'));assert.ok(!f.inputs.includes('QA%_한글'));assert.ok(!f.inputs.includes('draftVersion'));const repeat=await ok(await f.send());assert.equal(repeat.mode,'MANUAL');assert.equal(f.calls,1);assert.equal(f.digest(),before);}finally{f.sql.close();}
});
test('cross-site, unknown fields/roles, invalid IDs/types and oversized questions fail before provider call',async()=>{
  const f=await fixture();try{for(const bad of [null,[],f.body({roles:['admin']}),f.body({caseId:B+'x'}),f.body({question:'x'.repeat(601)}),f.body({previousQuestion:4}),f.body({routeId:'NO_SUCH_MENU'})])assert.equal((await f.send(bad)).status,400);assert.equal((await f.send(f.body(),{Origin:'https://other.invalid'})).status,403);assert.equal((await f.send(f.body(),{'Content-Type':'text/plain'})).status,415);assert.equal((await f.send(f.body({question:'x'.repeat(14000)}))).status,413);assert.equal(f.calls,0);}finally{f.sql.close();}
});
test('provider failure/action claims/executable content keep manual and do not write business state',async()=>{
  for(const answer of ['', '<script>alert(1)</script>', 'https://evil.invalid', '승인했습니다', '보고서를 저장 완료했습니다', '승인되었습니다', '승인 완료입니다. 이제 출력하세요.', '대표님 결재가 끝났습니다.', '{"sourceId":"NO_MENU","stepIndexes":[0]}', '{"sourceId":"REPO-02","stepIndexes":[99]}']){const f=await fixture(answer);try{const before=f.digest(),r=await ok(await f.send());assert.equal(r.mode,'MANUAL');assert.equal(f.digest(),before);}finally{f.sql.close();}}
  const action=await fixture();try{const r=await ok(await action.send(action.body({question:'보고서 저장 상신 승인해'})));assert.equal(r.mode,'MANUAL');assert.equal(action.calls,0);}finally{action.sql.close();}
  const f=await fixture();try{f.context.generate=async()=>{throw Error('Synthetic timeout');};const r=await ok(await f.send());assert.equal(r.mode,'MANUAL');assert.ok(r.notice);assert.deepEqual(r.sources[0].steps,ROUTE_HELP['REPO-02'].steps);}finally{f.sql.close();}
});
test('manual navigation retains exact project context and only existing routes; global workflow is sourced',()=>{
  const routes=readFileSync('apps/web/src/routes/Router.tsx','utf8');for(const [,path]of ASSISTANT_ROUTES)assert.ok(routes.includes(`path: '${path}'`));
  const report=assistantGuides('HWP 불러오기','REPO-02')[0];assert.equal(assistantPath(report,A),'/reports/studio?caseId='+A);const start=assistantGuides('처음 작업 순서','DASH-01')[0];assert.ok(start.steps.some(step=>step.includes('최종 결재')));
});
test('worker assistant rejects unauthenticated requests before database/provider use',async()=>{
  const r=await worker.fetch(new Request('https://qa.invalid/api/workspace-assistant'),{});assert.equal(r.status,401);
});
