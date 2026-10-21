import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';
import {handleProjectWorklogs,worklogCanWrite,WORKLOG_IDENTITIES} from '../apps/cloudflare/src/project-worklogs.js';
import {handleTechWorklogs} from '../apps/cloudflare/src/index.js';
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002';
const day='2026-10-21',time='2026-10-20T15:00:00.000Z';
async function fixture(){
 const SQL=await initSqlJs();let sql=new SQL.Database(),writes=0;
 sql.run(`CREATE TABLE preview_users(id TEXT PRIMARY KEY,login_id TEXT,display_name TEXT,roles_json TEXT,is_active INTEGER);CREATE TABLE preview_cases(id TEXT PRIMARY KEY,organization_id TEXT,deleted_at TEXT,case_number TEXT,title TEXT,updated_at TEXT);CREATE TABLE preview_case_assignments(case_id TEXT,user_id TEXT);CREATE TABLE preview_workflow_events(id TEXT PRIMARY KEY,case_id TEXT,actor_id TEXT,event_type TEXT,entity_id TEXT,detail_json TEXT,created_at TEXT);CREATE TABLE preview_case_activities(id TEXT PRIMARY KEY,case_id TEXT,actor_id TEXT,event_type TEXT,title TEXT,description TEXT,created_at TEXT);`);
 const actors=WORKLOG_IDENTITIES.map((p,i)=>({id:p.id,loginId:p.loginId,displayName:'Synthetic '+i,roles:i===5?['admin']:i===3?['ceo']:i===4||i===1?['director']:['pm']}));
 for(const a of actors)sql.run('INSERT INTO preview_users VALUES(?,?,?,?,1)',[a.id,a.loginId,a.displayName,JSON.stringify(a.roles)]);
 for(const id of [A,B]){sql.run('INSERT INTO preview_cases VALUES(?,?,NULL,?,?,?)',[id,'concost','QA','Synthetic project',time]);for(const a of actors)sql.run('INSERT INTO preview_case_assignments VALUES(?,?)',[id,a.id]);}
 const db={prepare(query:string){let values:unknown[]=[];return {bind(...v:unknown[]){values=v;return this;},async first(){const s=sql.prepare(query);try{s.bind(values as any[]);return s.step()?s.getAsObject():null;}finally{s.free();}},async all(){const s=sql.prepare(query),results:unknown[]=[];try{s.bind(values as any[]);while(s.step())results.push(s.getAsObject());return {results};}finally{s.free();}},async run(){writes++;sql.run(query,values as any[]);return {meta:{changes:sql.getRowsModified()}};}};}};
 const activity=(id:string,i=0,at=time,project=A,type='REPORT_SAVED')=>sql.run('INSERT INTO preview_case_activities VALUES(?,?,?,?,?,?,?)',[id,project,actors[i].id,type,'Synthetic activity','Synthetic detail',at]);
 const workflow=(id:string,type:string,i=0,at=time,project=A,detail:object={})=>sql.run('INSERT INTO preview_workflow_events VALUES(?,?,?,?,?,?,?)',[id,project,actors[i].id,type,'synthetic',JSON.stringify(detail),at]);
 const get=async(i=0,date=day,project=A)=>{const r=await handleProjectWorklogs(new Request(`https://qa.invalid/api/project-worklogs/${project}?date=${date}`),db as any,actors[i]);assert.equal(r.status,200);return r.json() as Promise<any>;};
 const metadata=async(i=0)=>{const r=await handleProjectWorklogs(new Request('https://qa.invalid/api/project-worklogs'),db as any,actors[i]);assert.equal(r.status,200);return r.json() as Promise<any>;};
 return {actors,db,activity,workflow,get,metadata,get sql(){return sql;},get writes(){return writes;},reopen(){const bytes=sql.export();sql.close();sql=new SQL.Database(bytes);},close(){sql.close();}};
}
test('CF243 employees see only own writer and manual log; management sees three, excluded roles cannot write',async()=>{
 const f=await fixture();try{
 for(let i=0;i<3;i++){
  assert.deepEqual((await f.metadata(i)).writers.map((x:any)=>x.id),[f.actors[i].id]);
  f.sql.run('INSERT INTO preview_workflow_events VALUES(?,?,?,?,?,?,?)',['manual'+i,A,f.actors[i].id,'PROJECT_WORKLOG_SAVED','worklog:'+day,JSON.stringify({date:day,todayTask:'Manual '+i,tomorrowPlan:'',notes:'',workHours:null,version:1}),time]);
 }
 for(let i=0;i<3;i++)assert.deepEqual((await f.get(i)).logs.map((x:any)=>x.authorId),[f.actors[i].id]);
 for(const i of [3,4,5]){assert.equal((await f.metadata(i)).writers.length,3);assert.equal((await f.get(i)).logs.length,3);assert.equal(worklogCanWrite(f.actors[i]),false);}
 assert.equal(worklogCanWrite(f.actors[1]),true);
 for(const roles of [['admin'],['ceo'],['pm','admin']])assert.equal(worklogCanWrite({...f.actors[0],roles}),false);
 }finally{f.close();}
});
test('CF243 persisted source events use KST date, stable IDs, own actor/project and all events beyond 100 without GET writes',async()=>{
 const f=await fixture();try{
 for(let i=0;i<105;i++)f.activity('a'+i);
 f.activity('previous',0,'2026-10-20T14:59:59.999Z');f.activity('next',0,'2026-10-21T15:00:00.000Z');f.activity('last',0,'2026-10-21T14:59:59.999Z');
 f.activity('other-person',1);f.activity('other-project',0,time,B);f.activity('admin-action',5);
 for(const type of ['KICKOFF_SAVED','KICKOFF_DRAFT_GENERATED','SITE_SURVEY_SAVED','SITE_SURVEY_DRAFT_GENERATED','SITE_SURVEY_CONFIRMED'])f.workflow(type,type);
 for(const type of ['PROJECT_WORKLOG_SAVED','WORKFORCE_ALLOCATED','UNKNOWN'])f.workflow('exclude'+type,type);
 const before=f.sql.export();const first=await f.get();assert.equal(first.automaticEntries.length,111);
 const ids=first.automaticEntries.map((e:any)=>e.id);assert.equal(new Set(ids).size,111);assert.ok(ids.includes('activity:a104'));assert.ok(ids.includes('activity:last'));
 for(const e of first.automaticEntries){assert.equal(e.authorId,f.actors[0].id);assert.equal(e.source,'CLAIM_CENTER');assert.ok(e.title);assert.ok(e.createdAt);}
 assert.ok(!(await f.get(5)).automaticEntries.some((e:any)=>e.id==='activity:admin-action'));
 assert.deepEqual(Array.from(f.sql.export()),Array.from(before));assert.equal(f.writes,0);f.reopen();assert.deepEqual(await f.get(),first);assert.equal(f.writes,0);
 assert.deepEqual((await f.get(0,'2026-10-20')).automaticEntries.map((e:any)=>e.id),['activity:previous']);
 }finally{f.close();}
});
test('CF243 failed/pending housekeeping and manual saves never feed automatic activities',async()=>{
 const f=await fixture();try{
 for(const type of ['UPLOAD_PENDING','UPLOAD_FAILED','SESSION_CLEANUP'])f.activity(type,0,time,A,type);
 f.workflow('manual','PROJECT_WORKLOG_SAVED');f.workflow('allocation','WORKFORCE_ALLOCATED');
 assert.deepEqual((await f.get()).automaticEntries,[]);assert.equal(f.writes,0);
 }finally{f.close();}
});
test('CF243 Tech gateway is read only even for valid source employee; Claim context remains writable',async()=>{
 const f=await fixture();try{
 const identity=WORKLOG_IDENTITIES[1],actor={id:identity.techId,login:identity.techLogin,email:identity.techEmail};
 const call=(method:string)=>handleTechWorklogs(new Request('https://private.invalid',{method:'POST',body:JSON.stringify({actor,method,path:'/api/project-worklogs',body:{}})}),{DB:f.db} as any);
 assert.equal((await call('PUT')).status,405);const r=await call('GET');assert.equal(r.status,200);assert.equal((await r.json() as any).actor.canWrite,false);
 assert.equal((await f.metadata(1)).actor.canWrite,true);assert.equal(f.writes,0);
 }finally{f.close();}
});

