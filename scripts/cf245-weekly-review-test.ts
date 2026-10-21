import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';
import {handleProjectWorklogs,worklogCanWrite,WORKLOG_IDENTITIES} from '../apps/cloudflare/src/project-worklogs.js';

const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002';
const day='2026-10-23',time='2026-10-22T15:00:00.000Z';
async function fixture(){
 const SQL=await initSqlJs();let sql=new SQL.Database(),writes=0;let beforeWrite:(()=>void)|undefined;
 sql.run(`CREATE TABLE preview_member_alert_reads(organization_id TEXT NOT NULL DEFAULT 'concost',user_id TEXT NOT NULL,event_key TEXT NOT NULL,read_at TEXT NOT NULL,PRIMARY KEY(user_id,event_key));CREATE TABLE preview_users(id TEXT PRIMARY KEY,login_id TEXT,display_name TEXT,roles_json TEXT,is_active INTEGER);CREATE TABLE preview_cases(id TEXT PRIMARY KEY,organization_id TEXT,deleted_at TEXT,case_number TEXT,title TEXT,updated_at TEXT);CREATE TABLE preview_case_assignments(case_id TEXT,user_id TEXT);CREATE TABLE preview_workflow_events(id TEXT PRIMARY KEY,case_id TEXT,actor_id TEXT,event_type TEXT,entity_id TEXT,detail_json TEXT,created_at TEXT);CREATE TABLE preview_case_activities(id TEXT PRIMARY KEY,case_id TEXT,actor_id TEXT,event_type TEXT,title TEXT,description TEXT,created_at TEXT);`);
 const actors=WORKLOG_IDENTITIES.map((p,i)=>({id:p.id,loginId:p.loginId,displayName:'Synthetic '+i,roles:i===5?['admin']:i===3?['ceo']:i===4||i===1?['director']:['pm']}));
 for(const a of actors)sql.run('INSERT INTO preview_users VALUES(?,?,?,?,1)',[a.id,a.loginId,a.displayName,JSON.stringify(a.roles)]);
 for(const id of [A,B]){sql.run('INSERT INTO preview_cases VALUES(?,?,NULL,?,?,?)',[id,'concost','QA','Synthetic project',time]);for(const a of actors)sql.run('INSERT INTO preview_case_assignments VALUES(?,?)',[id,a.id]);}
 const db={prepare(query:string){let values:unknown[]=[];return {bind(...v:unknown[]){values=v;return this;},async first(){const s=sql.prepare(query);try{s.bind(values as any[]);return s.step()?s.getAsObject():null;}finally{s.free();}},async all(){const s=sql.prepare(query),results:unknown[]=[];try{s.bind(values as any[]);while(s.step())results.push(s.getAsObject());return {results};}finally{s.free();}},async run(){const hook=beforeWrite;beforeWrite=undefined;hook?.();writes++;sql.run(query,values as any[]);return {meta:{changes:sql.getRowsModified()}};}};}};
 const activity=(id:string,i=0,at=time,project=A,type='REPORT_SAVED')=>sql.run('INSERT INTO preview_case_activities VALUES(?,?,?,?,?,?,?)',[id,project,actors[i].id,type,'Synthetic activity','Synthetic detail',at]);
 const workflow=(id:string,type:string,i=0,at=time,project=A,detail:object={})=>sql.run('INSERT INTO preview_workflow_events VALUES(?,?,?,?,?,?,?)',[id,project,actors[i].id,type,'synthetic',JSON.stringify(detail),at]);
 const get=async(i=0,date=day,project=A)=>{const r=await handleProjectWorklogs(new Request(`https://qa.invalid/api/project-worklogs/${project}?date=${date}`),db as any,actors[i]);assert.equal(r.status,200);return r.json() as Promise<any>;};
 const metadata=async(i=0)=>{const r=await handleProjectWorklogs(new Request('https://qa.invalid/api/project-worklogs'),db as any,actors[i]);assert.equal(r.status,200);return r.json() as Promise<any>;};
 return {setBeforeWrite(hook:()=>void){beforeWrite=hook;},actors,db,activity,workflow,get,metadata,get sql(){return sql;},get writes(){return writes;},reopen(){const bytes=sql.export();sql.close();sql=new SQL.Database(bytes);},close(){sql.close();}};
}


import {handleWeeklyWorklogReviews,dispatchScheduledWorklogs,weeklyWorklogAlerts} from '../apps/cloudflare/src/project-worklog-reviews.js';
const BASE='https://qa.invalid/api/project-worklogs/weekly';
const requestId=()=>crypto.randomUUID();
const count=(f:any)=>Number(f.sql.exec('SELECT count(*) FROM preview_workflow_events')[0].values[0][0]);
const call=(f:any,actor:number,path:string,method='GET',body?:object)=>handleWeeklyWorklogReviews(new Request(BASE+path,{method,headers:{'Content-Type':'application/json',Origin:'https://qa.invalid'},...(body?{body:JSON.stringify(body)}:{})}),f.db,f.actors[actor]);
const success=async(r:Response)=>{assert.equal(r.status,200,await r.clone().text());return r.json() as Promise<any>;};
async function save(f:any,expectedVersion=0,todayTask='Frozen synthetic work'){
 const r=await handleProjectWorklogs(new Request('https://qa.invalid/api/project-worklogs/'+A,{method:'PUT',headers:{'Content-Type':'application/json',Origin:'https://qa.invalid'},body:JSON.stringify({date:day,todayTask,tomorrowPlan:'Next',notes:'',workHours:2,expectedVersion})}),f.db,f.actors[0]);return success(r);
}
async function submit(f:any,recipientIds=[f.actors[3].id,f.actors[4].id],id=requestId()){
 return success(await call(f,0,'/reviews','POST',{week:day,caseId:A,recipientIds,requestId:id}));
}
const decide=(f:any,actor:number,id:string,decision='APPROVED')=>call(f,actor,'/reviews/'+id,'POST',{decision,comment:'Synthetic decision',viewed:true});

test('CF245 submission freezes saved weekly data, same request is idempotent and reads/reopen never write',async()=>{
 const f=await fixture();try{
 await save(f);f.activity('actual',0,time);const id=requestId(),created=await submit(f,undefined,id),submissionId=created.submission.id;
 const before=count(f);assert.equal((await submit(f,undefined,id)).submission.id,submissionId);assert.equal(count(f),before);
 assert.equal((await call(f,0,'/reviews','POST',{week:day,caseId:B,recipientIds:[f.actors[3].id,f.actors[4].id],requestId:id})).status,409);
 const frozen=await success(await call(f,0,'/reviews/'+submissionId));assert.ok(JSON.stringify(frozen).includes('Frozen synthetic work'));
 await save(f,1,'Edited after submission');const afterWrite=count(f),bytes=f.sql.export();
 assert.deepEqual(await success(await call(f,0,'/reviews/'+submissionId)),frozen);
 await success(await call(f,0,'/reviews?week='+day));await weeklyWorklogAlerts(f.db as any,f.actors[3]);
 assert.equal(count(f),afterWrite);assert.deepEqual(Array.from(f.sql.export()),Array.from(bytes));
 f.reopen();assert.deepEqual(await success(await call(f,0,'/reviews/'+submissionId)),frozen);
 }finally{f.close();}
});

test('CF245 named recipients all approve once; other actor, unviewed and duplicate decisions cannot change state',async()=>{
 const f=await fixture();try{
 await save(f);const id=(await submit(f)).submission.id;
 for(const i of [1,2,5])assert.ok([403,404].includes((await call(f,i,'/reviews/'+id)).status));
 assert.ok([403,404].includes((await decide(f,5,id)).status));assert.ok([403,404].includes((await decide(f,0,id)).status));
 assert.equal((await call(f,3,'/reviews/'+id,'POST',{decision:'APPROVED',comment:'',viewed:false})).status,400);
 await success(await decide(f,3,id));let result=await success(await call(f,0,'/reviews/'+id));assert.equal(result.submission.status,'PENDING');
 const before=count(f);assert.equal((await decide(f,3,id)).status,409);assert.equal(count(f),before);
 await success(await decide(f,4,id));result=await success(await call(f,0,'/reviews/'+id));assert.equal(result.submission.status,'APPROVED');
 assert.equal(result.submission.recipients.filter((r:any)=>r.status==="APPROVED").length,2);assert.equal((await decide(f,4,id)).status,409);
 }finally{f.close();}
});

test('CF245 one rejection closes review, invalid/self recipients and excluded writers cannot submit',async()=>{
 const f=await fixture();try{
 await save(f);for(const recipientIds of [[f.actors[0].id],[f.actors[2].id]])assert.equal((await call(f,0,'/reviews','POST',{week:day,caseId:A,recipientIds,requestId:requestId()})).status,403);
 for(const i of [3,4,5])assert.equal((await call(f,i,'/reviews','POST',{week:day,caseId:A,recipientIds:[f.actors[3].id],requestId:requestId()})).status,403);
 const id=(await submit(f)).submission.id;await success(await decide(f,3,id,'REJECTED'));assert.equal((await success(await call(f,0,'/reviews/'+id))).submission.status,'REJECTED');
 const before=count(f);assert.equal((await decide(f,4,id)).status,409);assert.equal(count(f),before);
 }finally{f.close();}
});

test('CF245 Friday KST schedule waits until 17:10, repeats once, respects disabled settings and active author',async()=>{
 const f=await fixture();try{
 await save(f);await success(await call(f,0,'/settings','PUT',{enabled:true,recipientIds:[f.actors[3].id],caseId:A,expectedVersion:0}));
 const before=count(f);await dispatchScheduledWorklogs(f.db as any,new Date('2026-10-23T08:09:59.999Z'));assert.equal(count(f),before);
 await dispatchScheduledWorklogs(f.db as any,new Date('2026-10-23T08:10:00.000Z'));assert.ok(count(f)>before);const once=count(f);
 await dispatchScheduledWorklogs(f.db as any,new Date('2026-10-23T09:00:00.000Z'));assert.equal(count(f),once);
 await dispatchScheduledWorklogs(f.db as any,new Date('2026-10-28T09:00:00.000Z'),{actorId:f.actors[0].id});assert.equal(count(f),once);
 await success(await call(f,0,'/settings','PUT',{enabled:false,recipientIds:[f.actors[3].id],caseId:A,expectedVersion:1}));const disabled=count(f);
 await dispatchScheduledWorklogs(f.db as any,new Date('2026-10-30T08:10:00Z'));assert.equal(count(f),disabled);
 await success(await call(f,0,'/settings','PUT',{enabled:true,recipientIds:[f.actors[3].id],caseId:A,expectedVersion:2}));f.sql.run('UPDATE preview_users SET is_active=0 WHERE id=?',[f.actors[0].id]);const inactive=count(f);
 await dispatchScheduledWorklogs(f.db as any,new Date('2026-10-30T08:10:00Z'));assert.equal(count(f),inactive);
 }finally{f.close();}
});

test('CF245 Monday supplement only follows weekend work and uses previous week across year boundary',async()=>{
 const f=await fixture();try{
 await success(await call(f,0,'/settings','PUT',{enabled:true,recipientIds:[f.actors[3].id],caseId:A,expectedVersion:0}));
 const before=count(f);await dispatchScheduledWorklogs(f.db as any,new Date('2027-01-04T00:00:00Z'));assert.equal(count(f),before);
 f.activity('weekday',0,'2026-12-31T01:00:00Z');f.activity('weekend',0,'2027-01-03T14:59:59Z');const work=count(f);
 await dispatchScheduledWorklogs(f.db as any,new Date('2027-01-03T23:59:59.999Z'));assert.equal(count(f),work);
 await dispatchScheduledWorklogs(f.db as any,new Date('2027-01-04T00:00:00Z'));assert.ok(count(f)>work);const once=count(f);
 await dispatchScheduledWorklogs(f.db as any,new Date('2027-01-04T00:10:00Z'));assert.equal(count(f),once);
 const listed=await success(await call(f,0,'/reviews?week=2027-01-03'));assert.equal(listed.submissions.length,1);assert.equal(listed.submissions[0].weekStart,'2026-12-28');const detail=await success(await call(f,0,'/reviews/'+listed.submissions[0].id));assert.deepEqual(detail.submission.snapshot.days,['2027-01-02','2027-01-03']);assert.deepEqual(detail.submission.snapshot.automaticEntries.map((r:any)=>r.id),['activity:weekend']);
 }finally{f.close();}
});


test('CF245 settings CAS and CSRF reject changes without rows; selection requires assigned case',async()=>{
 const f=await fixture();try{
 const initial=await success(await call(f,0,'/settings'));assert.equal(initial.settings.version,0);
 assert.ok(!initial.recipients.some((r:any)=>r.id===f.actors[0].id));
 const body={enabled:true,recipientIds:[f.actors[3].id],caseId:A,expectedVersion:0};
 await success(await call(f,0,'/settings','PUT',body));const before=count(f);
 assert.equal((await call(f,0,'/settings','PUT',body)).status,409);assert.equal(count(f),before);
 const request=new Request(BASE+'/settings',{method:'PUT',headers:{'Content-Type':'application/json',Origin:'https://foreign.invalid'},body:JSON.stringify({...body,expectedVersion:1})});
 assert.equal((await handleWeeklyWorklogReviews(request,f.db as any,f.actors[0])).status,403);assert.equal(count(f),before);
 f.sql.run('DELETE FROM preview_case_assignments WHERE case_id=? AND user_id=?',[B,f.actors[0].id]);
 assert.ok([403,404].includes((await call(f,0,'/reviews','POST',{week:day,caseId:B,recipientIds:[f.actors[3].id],requestId:requestId()})).status));
 assert.equal(count(f),before);
 }finally{f.close();}
});


test('CF245 simultaneous same request with different recipients conflicts instead of accepting another payload',async()=>{
 const f=await fixture();try{
 await save(f);const id=requestId();
 const results=await Promise.all([[f.actors[3].id],[f.actors[4].id]].map(recipientIds=>call(f,0,'/reviews','POST',{week:day,caseId:A,recipientIds,requestId:id})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 }finally{f.close();}
});



test('CF245 concurrent distinct requests cannot create duplicate pending submissions',async()=>{
 const f=await fixture();try{
 await save(f);const results=await Promise.all([requestId(),requestId()].map(id=>call(f,0,'/reviews','POST',{week:day,caseId:A,recipientIds:[f.actors[3].id],requestId:id})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal((await success(await call(f,0,'/reviews?week='+day))).submissions.length,1);
 }finally{f.close();}
});

test('CF245 assignment/recipient authorization revoked just before INSERT cannot persist a submission or decision',async()=>{
 for(const kind of ['assignment','recipient'] as const){const f=await fixture();try{
 await save(f);const before=count(f);
 f.setBeforeWrite(()=>kind==='assignment'?f.sql.run('DELETE FROM preview_case_assignments WHERE case_id=? AND user_id=?',[A,f.actors[0].id]):f.sql.run("UPDATE preview_users SET roles_json='[\"pm\"]' WHERE id=?",[f.actors[3].id]));
 const response=await call(f,0,'/reviews','POST',{week:day,caseId:A,recipientIds:[f.actors[3].id],requestId:requestId()});
 assert.equal(response.status,409);assert.equal(count(f),before);
 }finally{f.close();}}
 const f=await fixture();try{
 await save(f);const id=(await submit(f)).submission.id,before=count(f);
 f.setBeforeWrite(()=>f.sql.run('UPDATE preview_users SET is_active=0 WHERE id=?',[f.actors[3].id]));
 assert.equal((await decide(f,3,id)).status,409);assert.equal(count(f),before);
 assert.equal((await success(await call(f,0,'/reviews/'+id))).submission.status,'PENDING');
 }finally{f.close();}
});

test('CF245 scheduled empty work, absent assignment and manual pending are skipped without extra rows or false failures',async()=>{
 for(const state of ['empty','unassigned','pending'] as const){
 const f=await fixture();try{
 if(state==='unassigned')f.sql.run('DELETE FROM preview_case_assignments WHERE user_id=?',[f.actors[0].id]);
 if(state==='pending'){await save(f);await success(await call(f,0,'/settings','PUT',{enabled:true,recipientIds:[f.actors[3].id,f.actors[4].id],caseId:A,expectedVersion:0}));await submit(f);}
 const before=count(f);
 const result=await dispatchScheduledWorklogs(f.db as any,new Date('2026-10-23T08:10:00Z'),{actorId:f.actors[0].id});
 assert.deepEqual(result,{created:0,existing:0,skipped:1,failed:0},state);assert.equal(count(f),before,state);
 }finally{f.close();}}
});

import {dispatchLocalWorklogs,dispatchWorklogEnvironments} from '../apps/cloudflare/src/worklog-scheduler.js';
test('CF245 environment scheduler still calls remote after local DB failure, then reports failure',async()=>{
 let remote=0;
 const env={DB:{prepare(){throw Error('Synthetic local failure');}},WORKLOG_SCHEDULER:{async runDue(...args:unknown[]){assert.equal(args.length,0);remote++;return {failed:0};}}};
 await assert.rejects(dispatchWorklogEnvironments(env as any,new Date('2026-10-23T08:10:00Z')),/failed in 1 environments/);assert.equal(remote,1);
});
test('CF245 maintenance only skips local work and still calls remote scheduler without parameters',async()=>{
 let remote=0;const env={RELEASE_MAINTENANCE:'1',DB:{prepare(){throw Error('Maintenance must not access DB');}},WORKLOG_SCHEDULER:{async runDue(...args:unknown[]){assert.equal(args.length,0);remote++;}}};
 await assert.doesNotReject(dispatchWorklogEnvironments(env as any,new Date('2026-10-23T08:10:00Z')));assert.equal(remote,1);
});
test('CF245 remote failure is reported after actual local SQLite submission completes',async()=>{
 const f=await fixture();try{
 await save(f);const before=count(f);let remote=0;
 const env={DB:f.db,WORKLOG_SCHEDULER:{async runDue(){remote++;throw Error('Synthetic remote failure');}}};
 await assert.rejects(dispatchWorklogEnvironments(env as any,new Date('2026-10-23T08:10:00Z')),/failed in 1 environments/);
 assert.equal(remote,1);assert.equal(count(f),before+1);const rows=await success(await call(f,0,'/reviews?week='+day));assert.equal(rows.submissions.length,1);
 }finally{f.close();}
});
test('CF245 scheduler without DB is harmless and does not require a remote binding',async()=>{
 assert.deepEqual(await dispatchLocalWorklogs({} as any,new Date('2026-10-23T08:10:00Z')),{created:0,existing:0,skipped:0,failed:0});
 await assert.doesNotReject(dispatchWorklogEnvironments({} as any,new Date('2026-10-23T08:10:00Z')));
});
