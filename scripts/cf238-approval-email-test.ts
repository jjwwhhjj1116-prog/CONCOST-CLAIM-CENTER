import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {databaseFixture,createSavedReport,submitReview,worker,request,ADMIN_ID,REVIEWER_ID,REVIEWER_TOKEN,ADMIN_TOKEN} from './cf221-approval-fixture.js';
const before=process.env.CF238_BEFORE==='1';
async function target(){if(!before)return worker;const path='../tmp/cf238-qa/before-worker.ts';return (await import(path)).default;}
async function setup(email='pm@example.invalid',login='pm-login@example.invalid',legacyApproval=false){
  const {sql,env}=await databaseFixture({adminLogin:login}),w=await target();
  sql.exec(readFileSync('apps/cloudflare/migrations/0067_cf221_assigned_report_approval.sql','utf8'));
  if(!before)sql.exec(readFileSync('apps/cloudflare/migrations/0068_cf238_approval_email_delivery.sql','utf8'));
  sql.run("UPDATE preview_users SET department_code='TECHNICAL_HQ',version=version+1 WHERE id=?",[REVIEWER_ID]);
  sql.run('UPDATE preview_users SET email=?,version=version+1 WHERE id=?',[email,ADMIN_ID]);
  const accounts=JSON.stringify(sql.exec('SELECT * FROM preview_users ORDER BY id'));
  const caseId=await createSavedReport(env,sql),review=await submitReview(env,caseId,'cf238-'+crypto.randomUUID());
  if(legacyApproval){
    // Model the existing CF237 approved notification with no outbox. The account
    // is provisioned in this state, never changed by the recovery operation.
    sql.run("UPDATE preview_report_reviews SET status='APPROVED',reviewed_by=?,reviewed_at=?,decision_note='Prior synthetic approval' WHERE id=?",[REVIEWER_ID,new Date(Date.now()+1000).toISOString(),review.id]);
    sql.run("INSERT INTO preview_notifications (id,organization_id,user_id,case_id,review_id,notification_type,title,message,created_at) VALUES (?,'concost',?,?,?,'REPORT_APPROVED_DELIVERY_REQUIRED','Prior approval','Prior synthetic approval notification',?)",[crypto.randomUUID(),ADMIN_ID,caseId,review.id,new Date().toISOString()]);
  }else{
    const approved=await w.fetch(request(`/api/report-reviews/${review.id}/decision`,REVIEWER_TOKEN,{method:'POST',body:JSON.stringify({decision:'APPROVED',expectedStatus:'PENDING',note:'Synthetic email QA'})}),env);
    assert.equal(approved.status,200);
  }
  const notificationId=String(sql.exec('SELECT id FROM preview_notifications')[0].values[0][0]);
  const retry=(token=ADMIN_TOKEN,payload:Record<string,unknown>={})=>w.fetch(request(`/api/notifications/${notificationId}/email`,token,{method:'POST',body:JSON.stringify(payload)}),env);
  const inspect=()=>w.fetch(request(`/api/notifications/${notificationId}/email`,ADMIN_TOKEN),env);
  return {sql,env,retry,inspect,caseId,review,accounts};
}
const scalar=(sql:any,query:string)=>sql.exec(query)[0]?.values[0]?.[0];
const bridge=(env:any)=>Object.assign(env,{PM_NOTIFICATION_WEBHOOK_URL:'https://mail.example.invalid/notify',PM_NOTIFICATION_WEBHOOK_SECRET:'synthetic-mail-test-only'});

for(const [label,contact] of [['legacy','legacy contact'],['blank',''],['NBSP','pm\u00a0@example.invalid'],['multiple-at','pm@@example.invalid']] as const)test('CF238 invalid contact fallback '+label+' uses the same active recipient login without account changes',async()=>{
  const f=await setup(contact);try{assert.equal(scalar(f.sql,'SELECT recipient_email FROM preview_email_outbox'),'pm-login@example.invalid');assert.equal(scalar(f.sql,'SELECT status FROM preview_email_outbox'),'CONFIG_REQUIRED');assert.equal(JSON.stringify(f.sql.exec('SELECT * FROM preview_users ORDER BY id')),f.accounts);}finally{f.sql.close();}
});
test('CF238 valid contact takes priority over a different mail-shaped login',async()=>{
  const f=await setup();try{assert.equal(scalar(f.sql,'SELECT recipient_email FROM preview_email_outbox'),'pm@example.invalid');assert.equal(JSON.stringify(f.sql.exec('SELECT * FROM preview_users ORDER BY id')),f.accounts);}finally{f.sql.close();}
});
test('CF238 recovery creates only the missing outbox for an existing approved notification',async()=>{
  const f=await setup('legacy contact','pm-login@example.invalid',true);try{
    assert.equal(scalar(f.sql,'SELECT count(*) FROM preview_email_outbox'),0);
    const accounts=JSON.stringify(f.sql.exec('SELECT * FROM preview_users ORDER BY id'));
    assert.equal((await f.retry()).status,200);assert.equal((await f.retry()).status,200);
    assert.equal(scalar(f.sql,'SELECT count(*) FROM preview_email_outbox'),1);assert.equal(scalar(f.sql,'SELECT count(*) FROM preview_notifications'),1);
    assert.equal(scalar(f.sql,'SELECT attempt_count FROM preview_email_outbox'),1,'Repeated missing configuration does not exhaust attempts');
    assert.equal(JSON.stringify(f.sql.exec('SELECT * FROM preview_users ORDER BY id')),accounts);
    assert.match(String(scalar(f.sql,'SELECT body_text FROM preview_email_outbox')),new RegExp('/reports/studio\\?caseId='+f.caseId+'&step=5'));
  }finally{f.sql.close();}
});
test('CF238 scoped retry rejects nonrecipient, arbitrary destination and unauthenticated callers',async()=>{
  const f=await setup();try{assert.equal((await f.retry(REVIEWER_TOKEN)).status,403);assert.equal((await f.retry(ADMIN_TOKEN,{to:'other@example.invalid'})).status,400);assert.equal((await f.retry('wrong-token')).status,401);assert.equal(scalar(f.sql,'SELECT attempt_count FROM preview_email_outbox'),1);}finally{f.sql.close();}
});
test('CF238 provider message receipt, concurrent retries and repeat SENT calls send exactly once',async()=>{
  const f=await setup(),original=globalThis.fetch;try{
    bridge(f.env);let begin!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>begin=r),gate=new Promise<void>(r=>release=r);const sends:any[]=[];
    globalThis.fetch=async(_input,init)=>{sends.push(JSON.parse(String(init?.body)));begin();await gate;return new Response(null,{status:200,headers:{'X-Message-Id':'synthetic-provider-1'}});};
    const first=f.retry();await entered;const second=await f.retry();assert.equal(second.status,200);assert.equal(sends.length,1);release();assert.equal((await first).status,200);assert.equal((await f.retry()).status,200);assert.equal(sends.length,1);
    assert.equal(scalar(f.sql,'SELECT status FROM preview_email_outbox'),'SENT');assert.equal(scalar(f.sql,'SELECT provider_message_id FROM preview_email_outbox'),'synthetic-provider-1');assert.equal(sends[0].to,'pm@example.invalid');assert.equal(sends[0].idempotencyKey,scalar(f.sql,'SELECT id FROM preview_email_outbox'));
    assert.equal(scalar(f.sql,'SELECT count(*) FROM preview_email_dispatch_claims'),0);
  }finally{globalThis.fetch=original;f.sql.close();}
});
for(const mode of ['missing-receipt','network-unknown'] as const)test('CF238 '+mode+' stays unconfirmed and does not resend blindly',async()=>{
  const f=await setup(),original=globalThis.fetch;try{bridge(f.env);let sends=0;globalThis.fetch=async()=>{sends++;if(mode==='network-unknown')throw Error('synthetic unavailable');return new Response(null,{status:200});};
    assert.equal((await f.retry()).status,200);const response=await f.retry();const body=await response.json() as any;assert.equal(body.email.status,'FAILED');assert.equal(body.email.retryable,false);assert.equal(sends,1);assert.equal(scalar(f.sql,'SELECT provider_message_id FROM preview_email_outbox'),null);assert.equal(scalar(f.sql,'SELECT count(*) FROM preview_email_dispatch_claims'),1);
    const read=await f.inspect();assert.equal(read.status,200);const reloaded=await read.json() as any;assert.equal(reloaded.email.retryable,false);assert.equal(reloaded.email.recipientEmail,'pm@example.invalid');assert.equal(sends,1,'Reload is a read without another send');
  }finally{globalThis.fetch=original;f.sql.close();}
});
test('CF238 known rejection can retry with the same identity up to the fixed attempt limit',async()=>{
  const f=await setup(),original=globalThis.fetch;try{bridge(f.env);let sends=0;globalThis.fetch=async()=>{sends++;return new Response(null,{status:401});};for(let i=0;i<7;i++)assert.equal((await f.retry()).status,200);assert.equal(sends,4);assert.equal(scalar(f.sql,'SELECT attempt_count FROM preview_email_outbox'),5);assert.equal(scalar(f.sql,'SELECT count(*) FROM preview_email_dispatch_claims'),0);assert.equal(JSON.stringify(f.sql.exec('SELECT * FROM preview_users ORDER BY id')),f.accounts);assert.equal(f.sql.exec('PRAGMA foreign_key_check').length,0);}finally{globalThis.fetch=original;f.sql.close();}
});

test('CF239 internal company mail binding takes precedence without copying a mail key or using the public webhook',async()=>{
  const f=await setup(),original=globalThis.fetch;try{
    bridge(f.env);let calls=0;
    globalThis.fetch=async()=>{throw Error('Public mail webhook must not be called');};
    f.env.APPROVAL_MAILER={async fetch(req){calls++;assert.equal(new URL(req.url).origin,'https://claim-center.internal');assert.equal(req.headers.has('Authorization'),false);assert.equal((await req.json() as any).to,'pm@example.invalid');return new Response(null,{headers:{'X-Message-Id':'synthetic-private-receipt'}});}};
    assert.equal((await f.retry()).status,200);assert.equal((await f.retry()).status,200);assert.equal(calls,1);assert.equal(scalar(f.sql,'SELECT status FROM preview_email_outbox'),'SENT');assert.equal(JSON.stringify(f.sql.exec('SELECT * FROM preview_users ORDER BY id')),f.accounts);
  }finally{globalThis.fetch=original;f.sql.close();}
});
