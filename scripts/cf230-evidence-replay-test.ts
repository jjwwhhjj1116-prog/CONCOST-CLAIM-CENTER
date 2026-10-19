import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import initSqlJs from 'sql.js';
import ts from 'typescript';
const path='apps/cloudflare/src/index.ts';
const current=readFileSync(path,'utf8');
const eager=current.replace(/    const hasReplay = await db\.prepare\([\s\S]+?\.first<\{found:number\}>\(\);/u,'    const hasReplay = true;');
assert.notEqual(eager,current,'The deliberate eager-listing fault must reach the actual replay probe');
function closure(source:string){
 const start=source.indexOf('    const hasReplay =',source.indexOf('const requestedCategory ='));
 const old=source.indexOf('    const previous = (await categoryEvidence',source.indexOf('const requestedCategory ='));
 const at=start>=0?start:old;assert.ok(at>=0);
 const end=source.indexOf('    const prepared = await prepareEvidenceVersion',at);assert.ok(end>at);
 const code=source.slice(at,end)+'\nreturn null;';
 const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 return new Function('db','caseId','category','idempotencyKey','fingerprint','categoryEvidence','json','projectFile','PREVIEW_ORGANIZATION_ID','return (async()=>{'+js+'})();');
}
const now=closure(current),old=closure(eager),sqlReady=initSqlJs();
async function fixture(rows:any[]=[]){
 const SQL=await sqlReady,sql=new SQL.Database();for(const table of ['preview_case_evidence','preview_google_case_evidence'])sql.run(`CREATE TABLE ${table}(id TEXT,organization_id TEXT,case_id TEXT,workflow_category TEXT,idempotency_key TEXT,request_fingerprint TEXT); CREATE UNIQUE INDEX ${table}_key ON ${table}(organization_id,case_id,idempotency_key)`);
 for(const row of rows)sql.run(`INSERT INTO ${row.provider==='google'?'preview_google_case_evidence':'preview_case_evidence'} VALUES(?,?,?,?,?,?)`,[row.id,row.org??'concost',row.case??'case-A',row.category??'REPORT_REFERENCE',row.key??'key-old',row.fingerprint??'same']);
 let lists=0,probes=0,fail=false;
 const db={prepare(query:string){
  assert.match(query,/^SELECT /u);
  return {bind(...values:any[]){
   return {async first(){
    probes++;if(fail)throw Error('PROBE_FAILED');const statement=sql.prepare(query);
    try{statement.bind(values);return statement.step()?statement.getAsObject():null;}finally{statement.free();}
   }};
  }};
 }};
 // Existing order deliberately differs from UNION order. Production must still
 // resolve replay through categoryEvidence, not through the first provider hit.
 const categoryEvidence=async(_db:any,caseId:string,category:string)=>{lists++;return rows.filter(r=>(r.org??'concost')==='concost'&&(r.case??'case-A')===caseId&&(r.category??'REPORT_REFERENCE')===category).map(r=>({id:r.id,idempotencyKey:r.key??'key-old',requestFingerprint:r.fingerprint??'same'}));};
 return{sql,stats:()=>({lists,probes}),fail:()=>{fail=true;},run:(fn=now,key='key-new',fingerprint='same')=>fn(db,'case-A','REPORT_REFERENCE',key,fingerprint,categoryEvidence,(body:any,status=200)=>({body,status}),async(file:any)=>file,'concost')};
}
test('new key avoids full listing; deliberate eager listing fails the cost contract',async()=>{for(const fn of [now,old]){const f=await fixture([{id:'old'}]);try{assert.equal(await f.run(fn),null);if(fn===now)assert.deepEqual(f.stats(),{lists:0,probes:1});else{assert.equal(f.stats().lists,1);assert.throws(()=>assert.equal(f.stats().lists,0));}}finally{f.sql.close();}}});
for(const provider of ['local','google'])test(provider+' replay preserves receipt and fingerprint conflict',async()=>{const f=await fixture([{id:'stored',provider}]);try{const response=await f.run(now,'key-old');assert.equal(response.status,200);assert.equal(response.body.file.id,'stored');assert.equal(response.body.replay,true);assert.equal(f.stats().lists,1);const conflict=await f.run(now,'key-old','different');assert.equal(conflict.status,409);assert.equal(conflict.body.code,'IDEMPOTENCY_MISMATCH');}finally{f.sql.close();}});
for(const scope of ['org','case','category'])test('same key in other '+scope+' is not replayed',async()=>{const f=await fixture([{id:'outside',[scope]:'other'}]);try{assert.equal(await f.run(now,'key-old'),null);assert.equal(f.stats().lists,0);}finally{f.sql.close();}});
test('dual providers retain existing categoryEvidence ordering',async()=>{const f=await fixture([{id:'google-first',provider:'google'},{id:'local-second',provider:'local'}]);try{const result=await f.run(now,'key-old');assert.equal(result.body.file.id,'google-first');assert.equal(f.stats().lists,1);}finally{f.sql.close();}});
test('probe failure rejects before downstream work',async()=>{const f=await fixture();let downstream=0;try{f.fail();await assert.rejects(async()=>{await f.run();downstream++;},/PROBE_FAILED/);assert.equal(downstream,0);assert.deepEqual(f.stats(),{lists:0,probes:1});}finally{f.sql.close();}});
