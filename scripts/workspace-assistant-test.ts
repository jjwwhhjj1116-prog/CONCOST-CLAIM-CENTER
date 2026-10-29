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
  const SQL=await initSqlJs(), sql=new SQL.Database(), userId=randomUUID(); let calls=0, inputs=''; const queries:string[]=[];
  sql.run(`CREATE TABLE preview_cases(id TEXT PRIMARY KEY,organization_id TEXT,case_number TEXT,title TEXT,status TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE preview_case_assignments(case_id TEXT,user_id TEXT);
    CREATE TABLE preview_case_activities(case_id TEXT,event_type TEXT);
    CREATE TABLE preview_report_drafts(case_id TEXT,organization_id TEXT,version INTEGER,wizard_step INTEGER,updated_at TEXT);
    CREATE TABLE preview_report_reviews(id TEXT,case_id TEXT,organization_id TEXT,report_version INTEGER,status TEXT,requested_at TEXT);
    CREATE TABLE preview_report_finalizations(id TEXT,case_id TEXT,organization_id TEXT,report_version INTEGER,finalized_at TEXT);
    CREATE TABLE preview_proposals(id TEXT,case_id TEXT,organization_id TEXT,status TEXT,updated_at TEXT);`);
  for(const id of [A,B])sql.run('INSERT INTO preview_cases VALUES(?,?,?,?,?,?,NULL)',[id,'concost','QA%_한글','PRIVATE_CUSTOMER_PROJECT','CONTRACT','2026-10-29T01:00:00Z']);
  sql.run('INSERT INTO preview_case_assignments VALUES(?,?)',[A,userId]);
  sql.run('INSERT INTO preview_report_drafts VALUES(?,?,?,?,?)',[A,'concost',4,5,'2026-10-29T01:00:00Z']);
  sql.run("INSERT INTO preview_report_reviews VALUES('review',?,'concost',3,'APPROVED','2026-10-28T00:00:00Z')",[A]);
  sql.run("INSERT INTO preview_report_finalizations VALUES('final',?,'concost',3,'2026-10-28T00:00:00Z')",[A]);
  const db={prepare(query:string){queries.push(query);assert.match(query,/^SELECT\b/iu,'assistant must only issue SELECT');return {bind(...values:unknown[]){return {async all(){const s=sql.prepare(query),results:unknown[]=[];try{s.bind(values as any[]);while(s.step())results.push(s.getAsObject());return {results};}finally{s.free();}},async first(){const s=sql.prepare(query);try{s.bind(values as any[]);return s.step()?s.getAsObject():null;}finally{s.free();}}};}};}};
  const context={db:db as any,organizationId:'concost',userId,generate:async(system:string,input:string)=>{calls++;inputs=system+input;return {content};}};
  const body=(patch:object={})=>({question:'HWP 보고서는 어떻게 불러와?',previousQuestion:'',caseId:A,routeId:'REPO-02',...patch});
  const send=(payload:unknown=body(),headers:Record<string,string>={})=>handleWorkspaceAssistant(new Request('https://qa.invalid/api/workspace-assistant',{method:'POST',headers:{Origin:'https://qa.invalid','Content-Type':'application/json',...headers},body:JSON.stringify(payload)}),context);
  const get=(query='')=>handleWorkspaceAssistant(new Request('https://qa.invalid/api/workspace-assistant'+query),context);
  const digest=()=>createHash('sha256').update(sql.export()).digest('hex');
  return {sql,context,body,send,get,digest,queries,get calls(){return calls;},get inputs(){return inputs;}};
}
async function ok(response:Response){assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('Cache-Control'),'no-store');return response.json() as Promise<any>;}
test('assistant own assignment scope, literal search, denied IDs and database byte preservation',async()=>{
  const f=await fixture();try{const before=f.digest();const list=await ok(await f.get());assert.deepEqual(list.projects.map((p:any)=>p.id),[A]);assert.equal((await ok(await f.get('?q=%25_'))).projects.length,1);assert.equal((await f.get('?caseId='+B)).status,404);assert.equal((await f.send(f.body({caseId:B}))).status,404);assert.equal(f.calls,0);assert.equal(f.digest(),before);}finally{f.sql.close();}
});
test('real stored versions remain separate; an old approved/final version is not the current draft',async()=>{
  const f=await fixture();try{const before=f.digest(),r=await ok(await f.send(f.body({question:'왜 출력이 안 돼?'})));assert.equal(r.snapshot.draftVersion,4);assert.equal(r.snapshot.reviewVersion,3);assert.equal(r.mode,'MANUAL');assert.match(assistantFacts(r.snapshot).join('\n'),/현재 저장본과 다른 버전/u);assert.equal(f.calls,0);f.sql.run("INSERT INTO preview_case_activities VALUES(?,'REPORT_WORKSPACE_DELETED')",[A]);const deleted=await ok(await f.get('?caseId='+A));assert.match(assistantFacts(deleted.snapshot).join('\n'),/삭제 처리됨/u);assert.doesNotMatch(assistantFacts(deleted.snapshot).join('\n'),/최근 상신/u);assert.notEqual(f.digest(),before);}finally{f.sql.close();}
});
test('manual-only avoids configured generator and repeated question charges',async()=>{
  const f=await fixture();try{
    const before=f.digest();
    for(let i=0;i<3;i++){
      const r=await ok(await f.send());
      assert.equal(r.mode,'MANUAL');
      assert.equal(r.manualVersion,ASSISTANT_MANUAL_VERSION);
      assert.deepEqual(r.sources[0].steps,ROUTE_HELP['REPO-02'].steps);
      assert.ok(r.answer.includes(ROUTE_HELP['REPO-02'].steps[2]));
    }
    assert.equal(f.calls,0);assert.equal(f.inputs,'');assert.equal(f.digest(),before);
  }finally{f.sql.close();}
});

test('cross-site, unknown fields/roles, invalid IDs/types and oversized questions fail before provider call',async()=>{
  const f=await fixture();try{for(const bad of [null,[],f.body({roles:['admin']}),f.body({caseId:B+'x'}),f.body({question:'x'.repeat(601)}),f.body({previousQuestion:4}),f.body({routeId:'NO_SUCH_MENU'})])assert.equal((await f.send(bad)).status,400);assert.equal((await f.send(f.body(),{Origin:'https://other.invalid'})).status,403);assert.equal((await f.send(f.body(),{'Content-Type':'text/plain'})).status,415);assert.equal((await f.send(f.body({question:'x'.repeat(14000)}))).status,413);assert.equal(f.calls,0);}finally{f.sql.close();}
});
test('unknown questions do not invent a manual; current topic wins and explicit follow-up retains context',async()=>{
  const f=await fixture();try{
    const before=f.digest();
    for(const question of ['내일 날씨 알려줘','점심 메뉴 추천','키보드 닫기']){
      assert.equal(assistantGuides(question,'REPO-02').length,0);
      const r=await ok(await f.send(f.body({question,previousQuestion:'HWP 보고서 불러오기'})));
      assert.match(r.answer,/찾지 못했습니다/u);assert.equal(r.mode,'MANUAL');
    }
    const weekly=await ok(await f.send(f.body({question:'주간 업무일지 작성 방법',previousQuestion:'HWP DOCX PDF 보고서 가져오기 출력 저장 복구 목차 챕터'})));
    assert.equal(weekly.sources[0].id,'WL-02');
    const follow=await ok(await f.send(f.body({question:'그럼 다음은?',previousQuestion:'HWP 가져오기'})));
    assert.equal(follow.sources[0].id,'REPO-02');assert.match(follow.answer,/정해진 절차/u);
    const noPrevious=await ok(await f.send(f.body({question:'그럼 다음은?',previousQuestion:''})));
    assert.match(noPrevious.answer,/찾지 못했습니다/u);
    const action=await ok(await f.send(f.body({question:'보고서 저장 상신 승인해'})));
    assert.match(action.answer,/저장하거나 상신·승인·삭제하지 않습니다/u);
    assert.equal(f.calls,0);assert.equal(f.digest(),before);
  }finally{f.sql.close();}
});

test('authenticated Worker uses no AI key lookup, provider fetch or database write',async()=>{
  const f=await fixture(); const originalFetch=globalThis.fetch;let externalCalls=0;
  try{
    f.sql.run('CREATE TABLE preview_users(id TEXT,login_id TEXT,display_name TEXT,email TEXT,roles_json TEXT,is_active INTEGER,department_code TEXT)');
    f.sql.run('CREATE TABLE preview_sessions(id_hash TEXT,user_id TEXT,expires_at TEXT)');
    const token='synthetic-assistant-session-'+randomUUID();
    f.sql.run('INSERT INTO preview_users VALUES(?,?,?,?,?,1,?)',[f.context.userId,'synthetic','Synthetic QA','qa@invalid.test','["director"]','CLAIM_CENTER']);
    f.sql.run('INSERT INTO preview_sessions VALUES(?,?,?)',[createHash('sha256').update(token).digest('hex'),f.context.userId,new Date(Date.now()+3600000).toISOString()]);
    const before=f.digest();
    globalThis.fetch=async()=>{externalCalls++;throw Error('Assistant must not call an external provider');};
    for(const [question,sourceId] of [['HWP 불러오기 방법','REPO-02'],['명함 등록','CONTACT-02'],['주간 업무일지 작성 방법','WL-02']]){
      const r=await ok(await worker.fetch(new Request('https://qa.invalid/api/workspace-assistant',{method:'POST',headers:{Origin:'https://qa.invalid','Content-Type':'application/json',Cookie:'claim_center_session='+token},body:JSON.stringify(f.body({question}))}),{DB:f.context.db,GEMINI_API_KEY:'synthetic-never-use'} as any));
      assert.equal(r.mode,'MANUAL');assert.equal(r.snapshot.id,A);assert.equal(r.sources[0].id,sourceId);
    }
    assert.equal(externalCalls,0);assert.equal(f.calls,0);
    assert.deepEqual(f.queries.filter(query=>/ai_|gemini|credential|governance|settings/iu.test(query)),[]);
    assert.equal(f.digest(),before);
  }finally{globalThis.fetch=originalFetch;f.sql.close();}
});

test('manual navigation retains exact project context and only existing routes; global workflow is sourced',()=>{
  const routes=readFileSync('apps/web/src/routes/Router.tsx','utf8');for(const [,path]of ASSISTANT_ROUTES)assert.ok(routes.includes(`path: '${path}'`));
  const report=assistantGuides('HWP 불러오기','REPO-02')[0];assert.equal(assistantPath(report,A),'/reports/studio?caseId='+A);const start=assistantGuides('처음 작업 순서','DASH-01')[0];assert.ok(start.steps.some(step=>step.includes('최종 결재')));
});
test('worker assistant rejects unauthenticated requests before database/provider use',async()=>{
  const r=await worker.fetch(new Request('https://qa.invalid/api/workspace-assistant'),{});assert.equal(r.status,401);
});

test('business topic outranks generic registration words on every current screen',()=>{
  for(const routeId of ['REPO-02','DASH-01','CASE-02']){
    for(const question of ['명함 등록','명함을 등록','명함 촬영 후 등록']){
      assert.equal(assistantGuides(question,routeId)[0].id,'CONTACT-02');
    }
    assert.equal(assistantGuides('프로젝트 등록 방법',routeId)[0].id,'CASE-02');
    assert.equal(assistantGuides('주간 업무일지 작성',routeId)[0].id,'WL-02');
  }
});
