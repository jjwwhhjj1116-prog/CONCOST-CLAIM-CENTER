import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';
import {handleProjectWorklogs,worklogCanWrite,WORKLOG_IDENTITIES} from '../apps/cloudflare/src/project-worklogs.js';

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

// Actual SQLite statements with synthetic rows only; no server or user account mutation.
async function weekly(f:any,i=0,week='2026-12-31',caseId=''){
 return handleProjectWorklogs(new Request(`https://qa.invalid/api/project-worklogs/weekly?week=${week}${caseId?'&caseId='+caseId:''}`),f.db,f.actors[i]);
}
const manual=(patch:object={})=>({date:'2026-12-31',todayTask:'Synthetic work',tomorrowPlan:'Next',notes:'Notes',workHours:2,expectedVersion:0,...patch});
const put=(f:any,i=0,body=manual(),caseId=A)=>handleProjectWorklogs(new Request('https://qa.invalid/api/project-worklogs/'+caseId,{method:'PUT',headers:{'Content-Type':'application/json',Origin:'https://qa.invalid'},body:JSON.stringify(body)}),f.db,f.actors[i]);
async function ok(r:Response){assert.equal(r.status,200,await r.clone().text());return r.json() as Promise<any>;}

test('CF244 weekly Monday-Sunday year boundary uses KST, stable IDs, and no writes on read/reopen',async()=>{
 const f=await fixture();try{
 f.activity('before',0,'2026-12-27T14:59:59.999Z');f.activity('monday',0,'2026-12-27T15:00:00.000Z');
 f.activity('sunday',0,'2027-01-03T14:59:59.999Z');f.activity('after',0,'2027-01-03T15:00:00.000Z');
 const before=f.sql.export(),writes=f.writes;const row=await ok(await weekly(f));
 assert.equal(row.weekStart,'2026-12-28');assert.equal(row.weekEnd,'2027-01-03');
 assert.deepEqual(row.days,['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
 assert.deepEqual(row.automaticEntries.map((e:any)=>[e.id,e.date]),[['activity:monday','2026-12-28'],['activity:sunday','2027-01-03']]);
 assert.deepEqual(await ok(await weekly(f,0,'2027-01-03')),row);
 assert.deepEqual(Array.from(f.sql.export()),Array.from(before));assert.equal(f.writes,writes);
 f.reopen();assert.deepEqual(await ok(await weekly(f)),row);assert.equal(f.writes,writes);
 }finally{f.close();}
});

test('CF244 weekly combines latest manual per day with unique automatic events, scoped by actor/project',async()=>{
 const f=await fixture();try{
 for(let actor=0;actor<3;actor++)for(const project of [A,B]){
 await ok(await put(f,actor,manual({todayTask:'Task '+actor}),project));
 f.activity('event'+actor+project,actor,'2026-12-31T01:00:00Z',project);
 }
 await ok(await put(f,0,manual({expectedVersion:1,todayTask:'Revised',workHours:3})));
 await ok(await put(f,0,manual({date:'2027-01-01',todayTask:'New day',workHours:1})));
 f.workflow('kickoff','KICKOFF_SAVED',0,'2026-12-31T01:00:00Z');
 f.workflow('allocation','WORKFORCE_ALLOCATED',0,'2026-12-31T01:00:00Z');
 f.activity('admin-action',5,'2026-12-31T01:00:00Z');
 const row=await ok(await weekly(f));assert.equal(row.logs.length,3);assert.equal(row.automaticEntries.length,3);
 assert.ok(row.logs.every((x:any)=>x.authorId===f.actors[0].id));assert.ok(row.automaticEntries.every((x:any)=>x.authorId===f.actors[0].id));
 assert.equal(row.logs.filter((x:any)=>x.date==='2026-12-31'&&x.caseId===A).length,1);
 const latest=row.logs.find((x:any)=>x.date==='2026-12-31'&&x.caseId===A);assert.equal(latest.version,2);assert.equal(latest.todayTask,'Revised');
 assert.equal(row.logs.reduce((n:number,x:any)=>n+x.workHours,0),6);
 assert.equal(new Set(row.automaticEntries.map((x:any)=>x.id)).size,3);
 for(const entry of [...row.logs,...row.automaticEntries]){assert.ok([A,B].includes(entry.caseId));assert.equal(entry.caseNumber,'QA');assert.equal(entry.projectTitle,'Synthetic project');}
 const one=await ok(await weekly(f,0,'2026-12-31',A));assert.equal(one.logs.length,2);assert.equal(one.automaticEntries.length,2);
 for(let i=1;i<3;i++){const own=await ok(await weekly(f,i));assert.equal(own.logs.length,2);assert.equal(own.automaticEntries.length,2);assert.ok(own.logs.every((x:any)=>x.authorId===f.actors[i].id));}
 for(const i of [3,4,5]){const management=await ok(await weekly(f,i));assert.equal(management.logs.length,7);assert.equal(management.automaticEntries.length,7);assert.ok(!management.automaticEntries.some((x:any)=>x.authorId===f.actors[5].id));}
 f.sql.run('DELETE FROM preview_case_assignments WHERE case_id=? AND user_id=?',[B,f.actors[0].id]);
 const scoped=await ok(await weekly(f));assert.ok([...scoped.logs,...scoped.automaticEntries].every((x:any)=>x.caseId===A));
 assert.equal((await weekly(f,0,'2026-12-31',B)).status,404);
 }finally{f.close();}
});

test('CF244 extended daily fields persist, legacy update preserves them, full payload can clear explicitly',async()=>{
 const f=await fixture();try{
 const extra={dailyGoal:'Goal',plannedDetails:'Plan',planMemo:'Memo',remainingTask:'Remaining',delayReason:'Reason',blockers:'Blocked',progress:40,status:'진행중'};
 await ok(await put(f,0,manual(extra)));await ok(await put(f,0,manual({expectedVersion:1,todayTask:'Legacy edit'})));
 let current=(await ok(await weekly(f))).logs[0];for(const [key,value]of Object.entries(extra))assert.equal(current[key],value);
 assert.equal(current.version,2);f.reopen();current=(await ok(await weekly(f))).logs[0];for(const [key,value]of Object.entries(extra))assert.equal(current[key],value);
 const clear={dailyGoal:'',plannedDetails:'',planMemo:'',remainingTask:'',delayReason:'',blockers:'',progress:null,status:''};
 await ok(await put(f,0,manual({...clear,expectedVersion:2})));current=(await ok(await weekly(f))).logs[0];for(const [key,value]of Object.entries(clear))assert.equal(current[key],value);
 assert.equal(current.version,3);assert.equal((await put(f,0,manual({...extra,expectedVersion:1}))).status,409);
 assert.equal(Number(f.sql.exec("SELECT count(*) FROM preview_workflow_events WHERE event_type='PROJECT_WORKLOG_SAVED'")[0].values[0][0]),3);
 }finally{f.close();}
});

test('CF244 invalid week/extended fields reject without writes and allowed boundaries persist',async()=>{
 const f=await fixture();try{
 for(const week of ['','2026-02-30','2026-13-01','not-a-date'])assert.equal((await weekly(f,0,week)).status,400);
 for(const key of ['dailyGoal','plannedDetails','planMemo','remainingTask','delayReason','blockers'])for(const value of ['x'.repeat(5001),17,null])assert.equal((await put(f,0,manual({[key]:value}))).status,400);
 for(const patch of [{progress:-1},{progress:101},{progress:'50'},{status:'unknown'},{status:null},{status:[]},{status:{}},{status:['완료']},{todayTask:''},{authorId:f.actors[1].id}])assert.equal((await put(f,0,manual(patch))).status,400);
 assert.equal(f.writes,0);
 const text='x'.repeat(5000);await ok(await put(f,0,manual({dailyGoal:text,progress:0,status:'대기'})));
 for(const [version,status]of ['진행중','완료','지연'].entries())await ok(await put(f,0,manual({expectedVersion:version+1,progress:100,status})));
 assert.equal((await ok(await weekly(f))).logs[0].dailyGoal,text);
 }finally{f.close();}
});

