import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';
import {handleProjectWorklogs,techWorklogIdentity,WORKLOG_IDENTITIES} from '../apps/cloudflare/src/project-worklogs.js';
import {handleTechWorklogs} from '../apps/cloudflare/src/index.js';

// In-memory synthetic accounts only. Stable identifiers exercise the production allowlist;
// no real account, remote database, mail provider or authenticated browser is accessed.
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002';
async function fixture(){
 const SQL=await initSqlJs(),sql=new SQL.Database();
 sql.run(`CREATE TABLE preview_users(id TEXT PRIMARY KEY,login_id TEXT,display_name TEXT,roles_json TEXT,is_active INTEGER);
 CREATE TABLE preview_cases(id TEXT PRIMARY KEY,organization_id TEXT,deleted_at TEXT,case_number TEXT,title TEXT,updated_at TEXT);
 CREATE TABLE preview_case_assignments(case_id TEXT,user_id TEXT);
 CREATE TABLE preview_case_activities(id TEXT PRIMARY KEY,case_id TEXT,actor_id TEXT,event_type TEXT,title TEXT,created_at TEXT);
 CREATE TABLE preview_workflow_events(id TEXT PRIMARY KEY,case_id TEXT,actor_id TEXT,event_type TEXT,entity_id TEXT,detail_json TEXT,created_at TEXT);`);
 const actors=WORKLOG_IDENTITIES.map((p,i)=>({id:p.id,loginId:p.loginId,displayName:'Synthetic '+i,roles:i===5?['admin']:['pm']}));
 for(const a of actors)sql.run('INSERT INTO preview_users VALUES(?,?,?,?,1)',[a.id,a.loginId,a.displayName,JSON.stringify(a.roles)]);
 for(const id of [A,B]){sql.run('INSERT INTO preview_cases VALUES(?,?,NULL,?,?,?)',[id,'concost','QA','Synthetic project','2026-01-01']);for(const a of actors)sql.run('INSERT INTO preview_case_assignments VALUES(?,?)',[id,a.id]);}
 const db={prepare(query:string){let values:unknown[]=[];return {bind(...v:unknown[]){values=v;return this;},async first(){const s=sql.prepare(query);try{s.bind(values as any[]);return s.step()?s.getAsObject():null;}finally{s.free();}},async all(){const s=sql.prepare(query),results:unknown[]=[];try{s.bind(values as any[]);while(s.step())results.push(s.getAsObject());return {results};}finally{s.free();}},async run(){sql.run(query,values as any[]);return {meta:{changes:sql.getRowsModified()}};}};}};
 const body=(extra:object={})=>({date:'2026-10-20',todayTask:'Synthetic task',tomorrowPlan:'Next',notes:'',workHours:0,expectedVersion:0,...extra});
 const call=(i=0,method='PUT',data:any=body(),id=A,headers:Record<string,string>={})=>handleProjectWorklogs(new Request('https://qa.invalid/api/project-worklogs/'+id+(method==='GET'?'?date='+data.date:''),{method,headers:{'Content-Type':'application/json',...headers},...(method==='PUT'?{body:JSON.stringify(data)}:{})}),db as any,actors[i]);
 const count=()=>Number(sql.exec('SELECT count(*) FROM preview_workflow_events')[0].values[0][0]);
 return {sql,db,actors,body,call,count};
}
test('CF241 three stable writers save/reopen exact, histories and project/author scopes remain independent',async()=>{
 const f=await fixture();try{
 for(let i=0;i<3;i++)for(const id of [A,B]){const r=await f.call(i,'PUT',f.body({todayTask:`Task ${i} ${id}`,workHours:8}),id);assert.equal(r.status,200);assert.equal((await r.json() as any).log.version,1);}
 assert.equal(f.count(),6);
 const reopen=await (await f.call(5,'GET',f.body())).json() as any;assert.equal(reopen.logs.length,3);
 for(let i=0;i<3;i++){const row=reopen.logs.find((x:any)=>x.authorId===f.actors[i].id);assert.equal(row.todayTask,`Task ${i} ${A}`);assert.equal(row.workHours,8);assert.equal(row.version,1);}
 const before=JSON.stringify(f.sql.exec('SELECT * FROM preview_workflow_events ORDER BY id'));
 assert.equal((await f.call(0)).status,409);assert.equal(JSON.stringify(f.sql.exec('SELECT * FROM preview_workflow_events ORDER BY id')),before);
 assert.equal((await f.call(0,'PUT',f.body({expectedVersion:1,todayTask:'Revised'}))).status,200);assert.equal(f.count(),7);
 const rows=(await (await f.call(0,'GET',f.body())).json() as any).logs;assert.equal(rows.find((x:any)=>x.authorId===f.actors[0].id).version,2);
 assert.equal((await f.call(0,'PUT',f.body({date:'2026-10-21'}))).status,200);
 }finally{f.sql.close();}
});
test('CF241 CEO vice president admin cannot write; assignment revocation and identity spoof cannot create rows',async()=>{
 const f=await fixture();try{for(const i of [3,4,5])assert.equal((await f.call(i)).status,403);
 f.sql.run('DELETE FROM preview_case_assignments WHERE user_id=?',[f.actors[0].id]);
 assert.equal((await f.call()).status,404);assert.equal((await f.call(0,'GET',f.body())).status,404);
 const forged={...f.actors[1],loginId:f.actors[2].loginId};assert.equal((await handleProjectWorklogs(new Request('https://qa.invalid/api/project-worklogs/'+A,{method:'PUT',body:JSON.stringify(f.body())}),f.db as any,forged)).status,403);
 assert.equal(f.count(),0);
 }finally{f.sql.close();}
});
test('CF241 author override, invalid dates/values and cross-site requests reject before insert',async()=>{
 const f=await fixture();try{
 for(const patch of [{authorId:f.actors[1].id},{date:'2026-02-30'},{date:'2026-13-01'},{expectedVersion:-1},{expectedVersion:0.5},{workHours:25},{workHours:'8'},{todayTask:'  '},{notes:'x'.repeat(10001)}])assert.equal((await f.call(0,'PUT',f.body(patch))).status,400);
 for(const headers of [{Origin:'https://evil.invalid'},{'Sec-Fetch-Site':'cross-site'},{Cookie:'synthetic=1'}])assert.equal((await f.call(0,'PUT',f.body(),A,headers)).status,403);
 assert.equal((await f.call(0,'PUT',f.body(),A,{'Content-Type':'text/plain'})).status,415);
 assert.equal(f.count(),0);
 assert.equal((await f.call(0,'PUT',f.body(),A,{Cookie:'synthetic=1',Origin:'https://qa.invalid'})).status,200);
 }finally{f.sql.close();}
});
test('CF241 real Tech handler requires exact source id/login/email and active linked user',async()=>{
 const f=await fixture();try{
 const p=WORKLOG_IDENTITIES[1],actor={id:p.techId,login:p.techLogin,email:p.techEmail};
 const call=(a:any=actor,extra:object={})=>handleTechWorklogs(new Request('https://private.invalid',{method:'POST',body:JSON.stringify({actor:a,method:'PUT',path:'/api/project-worklogs/'+A,body:f.body(),...extra})}),{DB:f.db} as any);
 assert.ok(techWorklogIdentity(actor));for(const key of ['id','login','email']){const fake={...actor,[key]:'synthetic-forged'};assert.equal(techWorklogIdentity(fake),null);assert.equal((await call(fake)).status,403);}
 assert.equal(f.count(),0);assert.equal((await call()).status,405);
 assert.equal((await f.call(1)).status,200);
 assert.equal((await call()).status,405);
 const got=await call(actor,{method:'GET',path:'/api/project-worklogs/'+A+'?date=2026-10-20'});assert.equal(got.status,200);assert.equal((await got.json() as any).logs[0].authorId,p.id);
 f.sql.run('UPDATE preview_users SET is_active=0 WHERE id=?',[p.id]);assert.equal((await call(actor,{method:'GET',path:'/api/project-worklogs'})).status,403);assert.equal(f.count(),1);
 }finally{f.sql.close();}
});

test('CF241 competing same-version saves execute actual conditional SQLite INSERT exactly once',async()=>{
 const f=await fixture();try{
 const results=await Promise.all([f.call(0,'PUT',f.body({todayTask:'Concurrent A'})),f.call(0,'PUT',f.body({todayTask:'Concurrent B'}))]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(f.count(),1);
 const winner=await results.find(r=>r.status===200)!.json() as any;
 const reopened=await (await f.call(0,'GET',f.body())).json() as any;
 assert.equal(reopened.logs[0].todayTask,winner.log.todayTask);assert.equal(reopened.logs[0].id,winner.log.id);assert.equal(reopened.logs[0].version,1);
 }finally{f.sql.close();}
});

test('CF241 development account IDs resolve active metadata and preserve three-writer save/read scopes',async()=>{
 const f=await fixture();try{
 const expected=['9ab3d678-0047-4b60-bfd5-5443fbe151fa','9ffc45e9-f599-4faf-9cc3-461cd63f239f','609e76ea-4524-478b-a6ea-c601d9dc7be4'];
 for(let i=0;i<3;i++){const old=f.actors[i].id;f.sql.run('UPDATE preview_users SET id=? WHERE id=?',[expected[i],old]);f.sql.run('UPDATE preview_case_assignments SET user_id=? WHERE user_id=?',[expected[i],old]);f.actors[i].id=expected[i];}
 const metadata=await handleProjectWorklogs(new Request('https://qa.invalid/api/project-worklogs'),f.db as any,f.actors[5]);
 assert.equal(metadata.status,200);assert.deepEqual((await metadata.json() as any).writers.map((p:any)=>p.id),expected);
 for(let i=0;i<3;i++){const r=await f.call(i,'PUT',f.body({todayTask:'Development synthetic '+i}));assert.equal(r.status,200);assert.equal((await r.json() as any).log.authorId,expected[i]);}
 const rows=(await (await f.call(5,'GET',f.body())).json() as any).logs;
 assert.equal(rows.length,3);for(let i=0;i<3;i++)assert.equal(rows.find((r:any)=>r.authorId===expected[i]).todayTask,'Development synthetic '+i);
 const tech=WORKLOG_IDENTITIES[1];const bridged=await handleTechWorklogs(new Request('https://private.invalid',{method:'POST',body:JSON.stringify({actor:{id:tech.techId,login:tech.techLogin,email:tech.techEmail},method:'GET',path:'/api/project-worklogs/'+A+'?date=2026-10-20'})}),{DB:f.db} as any);
 assert.equal(bridged.status,200);assert.deepEqual((await bridged.json() as any).logs,rows.filter((r:any)=>r.authorId===expected[1]));
 const forgedId='10000000-0000-4000-8000-000000000099';f.sql.run('INSERT INTO preview_case_assignments VALUES(?,?)',[A,forgedId]);
 const forged={...f.actors[0],id:forgedId};
 assert.equal((await handleProjectWorklogs(new Request('https://qa.invalid/api/project-worklogs/'+A,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(f.body())}),f.db as any,forged)).status,403);
 f.sql.run('UPDATE preview_users SET is_active=0 WHERE id=?',[expected[2]]);
 const filtered=await handleProjectWorklogs(new Request('https://qa.invalid/api/project-worklogs'),f.db as any,f.actors[5]);assert.deepEqual((await filtered.json() as any).writers.map((p:any)=>p.id),expected.slice(0,2));assert.equal(f.count(),3);
 }finally{f.sql.close();}
});
