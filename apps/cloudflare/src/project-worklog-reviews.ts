import {handleProjectWorklogs,WORKLOG_IDENTITIES,worklogCanWrite,worklogWeekRange,type WorklogActor,type WorklogDatabase} from './project-worklogs';

const SUBMIT='PROJECT_WORKLOG_WEEKLY_SUBMITTED',DECIDE='PROJECT_WORKLOG_WEEKLY_DECIDED',SETTINGS='PROJECT_WORKLOG_WEEKLY_SETTINGS';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dayOK=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
class Invalid extends Error{constructor(message:string,readonly status=400){super(message);}}
type Recipient={id:string;name:string;loginId:string};
type Snapshot={weekStart:string;weekEnd:string;days:string[];logs:Record<string,any>[];automaticEntries:Record<string,any>[]};
type Submission={id:string;authorId:string;authorName:string;weekStart:string;weekEnd:string;caseId:string;recipientIds:string[];recipientNames:Record<string,string>;slot:string;createdAt:string;snapshot:Snapshot;snapshotHash:string};
type Setting={enabled:boolean;recipientIds:string[];caseId:string;version:number};
const kstDay=(now:Date)=>new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
const shift=(day:string,offset:number)=>new Date(Date.parse(day+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
const actorActive=async(db:WorklogDatabase,actor:WorklogActor)=>!!await db.prepare('SELECT id FROM preview_users WHERE id=? AND login_id=? AND is_active=1').bind(actor.id,actor.loginId).first();
const writerGuard="EXISTS(SELECT 1 FROM preview_users WHERE id=? AND login_id=? AND is_active=1 AND NOT EXISTS(SELECT 1 FROM json_each(roles_json) WHERE value IN ('admin','ceo')))";
const recipientGuard="NOT EXISTS(SELECT 1 FROM json_each(?) chosen WHERE NOT EXISTS(SELECT 1 FROM preview_users u WHERE u.id=chosen.value AND u.id<>? AND u.is_active=1 AND EXISTS(SELECT 1 FROM json_each(u.roles_json) WHERE value IN ('admin','ceo','director'))))";
const caseGuard="NOT EXISTS(SELECT 1 FROM json_each(?) chosen WHERE NOT EXISTS(SELECT 1 FROM preview_cases c WHERE c.id=chosen.value AND c.organization_id='concost' AND c.deleted_at IS NULL AND EXISTS(SELECT 1 FROM preview_case_assignments a WHERE a.case_id=c.id AND a.user_id=?)))";
const pendingGuard=`NOT EXISTS(SELECT 1 FROM preview_workflow_events p WHERE p.event_type='${SUBMIT}' AND p.actor_id=? AND json_extract(p.detail_json,'$.weekStart')=? AND json_extract(p.detail_json,'$.caseId')=? AND json_extract(p.detail_json,'$.slot')<>'WEEKEND' AND NOT EXISTS(SELECT 1 FROM preview_workflow_events d WHERE d.event_type='${DECIDE}' AND d.entity_id=p.id AND json_extract(d.detail_json,'$.decision')='REJECTED') AND (SELECT COUNT(DISTINCT d.actor_id) FROM preview_workflow_events d WHERE d.event_type='${DECIDE}' AND d.entity_id=p.id AND json_extract(d.detail_json,'$.decision')='APPROVED')<json_array_length(json_extract(p.detail_json,'$.recipientIds')))`;
async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
async function stableId(key:string){const h=await digest(key);return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);}
async function recipients(db:WorklogDatabase,actor:WorklogActor){
 return (await db.prepare("SELECT id,display_name AS name,login_id AS loginId FROM preview_users WHERE is_active=1 AND id<>? AND EXISTS(SELECT 1 FROM json_each(roles_json) WHERE value IN ('admin','ceo','director')) ORDER BY display_name,id").bind(actor.id).all<Recipient>()).results;
}
async function configuration(db:WorklogDatabase,actor:WorklogActor){
 const allowed=await recipients(db,actor),row=await db.prepare('SELECT detail_json AS detail FROM preview_workflow_events WHERE actor_id=? AND event_type=? ORDER BY rowid DESC LIMIT 1').bind(actor.id,SETTINGS).first<{detail:string}>();
 const settings:Setting=row?JSON.parse(row.detail):{enabled:true,recipientIds:allowed.filter(r=>['ceo@con-cost.com','lwh@con-cost.com'].includes(r.loginId)).map(r=>r.id),caseId:'',version:0};
 return {settings,recipients:allowed,actor:{id:actor.id,name:actor.displayName,canWrite:worklogCanWrite(actor)}};
}
function validateRecipients(ids:unknown,allowed:Recipient[]):asserts ids is string[]{
 if(!Array.isArray(ids)||!ids.length||ids.length>10||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!uuid.test(id)))throw new Invalid('결재 수신자를 1명 이상 선택하세요.');
 if(ids.some(id=>!allowed.some(r=>r.id===id)))throw new Invalid('본인을 제외한 활성 결재자만 지정할 수 있습니다.',403);
}
async function projects(db:WorklogDatabase,actor:WorklogActor){const r=await handleProjectWorklogs(new Request('https://worklog.internal/api/project-worklogs'),db,actor);return (await r.json() as {projects:{id:string}[]}).projects;}
async function snapshot(db:WorklogDatabase,actor:WorklogActor,week:string,caseId:string){
 const r=await handleProjectWorklogs(new Request('https://worklog.internal/api/project-worklogs/weekly?'+new URLSearchParams({week,...(caseId?{caseId}:{})})),db,actor);
 if(!r.ok)throw new Invalid('조회할 프로젝트·주간을 확인하세요.',r.status);
 const data=await r.json() as Snapshot;
 // A management role never expands a writer's own submission to someone else's journal.
 data.logs=data.logs.filter(row=>row.authorId===actor.id);data.automaticEntries=data.automaticEntries.filter(row=>row.authorId===actor.id);
 return data;
}
async function readSubmission(db:WorklogDatabase,id:string){
 const row=await db.prepare("SELECT e.detail_json AS detail FROM preview_workflow_events e JOIN preview_cases c ON c.id=e.case_id AND c.organization_id='concost' AND c.deleted_at IS NULL WHERE e.id=? AND e.event_type=?").bind(id,SUBMIT).first<{detail:string}>();
 return row?JSON.parse(row.detail) as Submission:null;
}
async function decorate(db:WorklogDatabase,s:Submission,includeSnapshot=true){
 const rows=(await db.prepare('SELECT actor_id AS actorId,detail_json AS detail,created_at AS createdAt FROM preview_workflow_events WHERE event_type=? AND entity_id=? ORDER BY rowid').bind(DECIDE,s.id).all<{actorId:string;detail:string;createdAt:string}>()).results;
 const decisions=s.recipientIds.map(id=>{const row=rows.find(r=>r.actorId===id),detail=row?JSON.parse(row.detail):{};return {id,name:s.recipientNames[id],status:detail.decision||'PENDING',comment:detail.comment||'',decidedAt:row?.createdAt||null};});
 const status=decisions.some(d=>d.status==='REJECTED')?'REJECTED':decisions.every(d=>d.status==='APPROVED')?'APPROVED':'PENDING';
 const {snapshot,...rest}=s;return {...rest,status,recipients:decisions,...(includeSnapshot?{snapshot}:{})};
}
const reviewerRole=(actor:WorklogActor)=>actor.roles.some(r=>['admin','ceo','director'].includes(r));
const permitted=(s:Submission,actor:WorklogActor)=>s.authorId===actor.id||(reviewerRole(actor)&&s.recipientIds.includes(actor.id));
async function submit(db:WorklogDatabase,actor:WorklogActor,week:string,caseId:string,ids:string[],id:string,slot:string,now:Date){
 const sameRequest=(s:Submission)=>s.authorId===actor.id&&s.weekStart===worklogWeekRange(week).weekStart&&s.caseId===caseId&&(slot!=='MANUAL'||JSON.stringify([...s.recipientIds].sort())===JSON.stringify([...ids].sort()));
 const previous=await readSubmission(db,id);
 if(previous){if(!sameRequest(previous))throw new Invalid('같은 요청 번호의 상신 내용이 다릅니다. 새로 상신하세요.',409);return {submission:await decorate(db,previous),created:false};}
 const allowed=await recipients(db,actor);validateRecipients(ids,allowed);
 const accessible=await projects(db,actor),anchor=caseId||accessible[0]?.id;if(!anchor||!accessible.some(p=>p.id===anchor))throw new Invalid('배정된 프로젝트가 필요합니다.',404);
 const data=await snapshot(db,actor,week,caseId);
 if(!data.logs.length&&!data.automaticEntries.length)throw new Invalid('상신할 저장 업무가 없습니다.',409);
 const weekStart=data.weekStart;
 if(slot==='WEEKEND'){const saturday=data.days[5];data.days=data.days.slice(5);data.logs=data.logs.filter(row=>row.date>=saturday);data.automaticEntries=data.automaticEntries.filter(row=>row.date>=saturday);if(!data.logs.length&&!data.automaticEntries.length)return null;data.weekStart=saturday;}
 const s:Submission={id,authorId:actor.id,authorName:actor.displayName,weekStart,weekEnd:data.weekEnd,caseId,recipientIds:ids,recipientNames:Object.fromEntries(allowed.filter(r=>ids.includes(r.id)).map(r=>[r.id,r.name])),slot,createdAt:now.toISOString(),snapshot:data,snapshotHash:await digest(JSON.stringify(data))};
 const detail=JSON.stringify(s);if(new TextEncoder().encode(detail).length>2000000)throw new Invalid('주간 보고가 너무 큽니다. 프로젝트를 선택해 상신하세요.',413);
 // The immutable submission is also the durable notification. No second write can be lost.
 const caseIds=[...new Set([anchor,...data.logs.map(r=>r.caseId),...data.automaticEntries.map(r=>r.caseId)])];
 const inserted=await db.prepare(`INSERT INTO preview_workflow_events(id,case_id,actor_id,event_type,entity_id,detail_json,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM preview_workflow_events WHERE id=?) AND ${writerGuard} AND ${recipientGuard} AND ${caseGuard} ${slot==='WEEKEND'?'':'AND '+pendingGuard}`)
 .bind(id,anchor,actor.id,SUBMIT,'weekly:'+id,detail,s.createdAt,id,actor.id,actor.loginId,JSON.stringify(ids),actor.id,JSON.stringify(caseIds),actor.id,...(slot==='WEEKEND'?[]:[actor.id,weekStart,caseId])).run();
 const saved=await readSubmission(db,id);if(!saved)throw new Invalid('배정·수신자 상태가 변경됐거나 같은 주간의 대기 상신본이 있습니다. 서버 상태를 확인하세요.',409);if(!sameRequest(saved))throw new Invalid('같은 요청 번호의 상신 내용이 다릅니다. 새로 상신하세요.',409);
 return {submission:await decorate(db,saved),created:inserted.meta?.changes===1};
}

export function scheduledWorklogSlot(now:Date){
 const local=new Date(now.getTime()+9*3600000),day=kstDay(now),minutes=local.getUTCHours()*60+local.getUTCMinutes(),weekday=local.getUTCDay();
 if(weekday===5&&minutes>=17*60+10)return {slot:'FRIDAY',week:worklogWeekRange(day).weekStart};
 if(weekday===1&&minutes>=9*60)return {slot:'WEEKEND',week:shift(day,-7)};
 return null;
}
export async function dispatchScheduledWorklogs(db:WorklogDatabase,now:Date,options:{actorId?:string}={}){
 const slot=scheduledWorklogSlot(now),result={created:0,existing:0,skipped:0,failed:0};
 if(!slot)return result;
 const rows=(await db.prepare('SELECT id,login_id AS loginId,display_name AS displayName,roles_json AS rolesJson FROM preview_users WHERE is_active=1').all<{id:string;loginId:string;displayName:string;rolesJson:string}>()).results;
 for(const row of rows){const actor={...row,roles:JSON.parse(row.rolesJson)};if(!worklogCanWrite(actor)||(options.actorId&&actor.id!==options.actorId))continue;
  try{const {settings}=await configuration(db,actor);if(!settings.enabled){result.skipped++;continue;}const id=await stableId(`claim-weekly:${actor.id}:${slot.week}:${slot.slot}`),existing=await readSubmission(db,id);if(existing){result.existing++;continue;}
   const value=await submit(db,actor,slot.week,settings.caseId,settings.recipientIds,id,slot.slot,now);if(value){if(value.created)result.created++;else result.existing++;}else result.skipped++;
  }catch(error){if(error instanceof Invalid&&[404,409].includes(error.status))result.skipped++;else result.failed++;}
 }
 return result;
}

export async function weeklyWorklogAlerts(db:WorklogDatabase,actor:WorklogActor){
 const rows=(await db.prepare("SELECT e.detail_json AS detail FROM preview_workflow_events e JOIN preview_cases c ON c.id=e.case_id AND c.organization_id='concost' AND c.deleted_at IS NULL WHERE e.event_type=? AND (e.actor_id=? OR (?=1 AND EXISTS(SELECT 1 FROM json_each(json_extract(e.detail_json,'$.recipientIds')) WHERE value=?))) ORDER BY e.rowid DESC LIMIT 30").bind(SUBMIT,actor.id,reviewerRole(actor)?1:0,actor.id).all<{detail:string}>()).results;
 const result=[];
 for(const row of rows){const s=JSON.parse(row.detail) as Submission,r=await decorate(db,s,false),incoming=s.authorId!==actor.id,own=r.recipients.find(d=>d.id===actor.id);if(incoming?(r.status!=='PENDING'||own?.status!=='PENDING'):r.status==='PENDING')continue;
  const eventKey=`WORKLOG:${s.id}:${r.status}`;
  if(await db.prepare('SELECT event_key FROM preview_member_alert_reads WHERE user_id=? AND event_key=?').bind(actor.id,eventKey).first())continue;
  result.push({eventKey,title:`${s.authorName} · ${s.weekStart} 주간 업무일지`,status:r.status,createdAt:s.createdAt,path:'/projects/worklogs/weekly?'+new URLSearchParams({week:s.weekStart,submissionId:s.id}),message:incoming?'주간 상신본을 확인하고 결재하세요.':r.status==='APPROVED'?'선택한 결재자가 모두 승인했습니다.':'수정 요청을 확인하고 새로 상신하세요.'});
 }
 return result;
}

export async function handleWeeklyWorklogReviews(request:Request,db:WorklogDatabase,actor:WorklogActor):Promise<Response>{
 try{
  if(!await actorActive(db,actor))throw new Invalid('활성 계정으로 로그인하세요.',403);
  const url=new URL(request.url),path=url.pathname;
  if(request.method!=='GET'){
   const origin=request.headers.get('Origin');if((origin&&origin!==url.origin)||(request.headers.has('Cookie')&&origin!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')throw new Invalid('현재 서버에서 요청하세요.',403);
   if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))throw new Invalid('JSON 입력이 필요합니다.',415);
  }
  let body:Record<string,any>={};if(request.method!=='GET'){const raw=await request.text();if(new TextEncoder().encode(raw).length>20000)throw new Invalid('입력이 너무 큽니다.',413);try{body=JSON.parse(raw);}catch{throw new Invalid('입력 형식을 확인하세요.');}if(!body||typeof body!=='object'||Array.isArray(body))throw new Invalid('입력 형식을 확인하세요.');}
  if(path==='/api/project-worklogs/weekly/settings'){
   const c=await configuration(db,actor);if(request.method==='GET')return reply(c);
   if(request.method!=='PUT')throw new Invalid('지원하지 않는 요청입니다.',405);
   if(!worklogCanWrite(actor))throw new Invalid('본인 업무일지의 정기보고만 설정합니다.',403);
   if(Object.keys(body).some(k=>!['enabled','recipientIds','caseId','expectedVersion'].includes(k))||typeof body.enabled!=='boolean'||typeof body.caseId!=='string'||(body.caseId&&!uuid.test(body.caseId))||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0)throw new Invalid('보고 범위·수신자·설정 버전을 확인하세요.');
   validateRecipients(body.recipientIds,c.recipients);const accessible=await projects(db,actor),anchor=body.caseId||accessible[0]?.id;if(!anchor||!accessible.some(p=>p.id===anchor))throw new Invalid('배정된 프로젝트가 필요합니다.',404);
   const settings={enabled:body.enabled,recipientIds:body.recipientIds,caseId:body.caseId,version:body.expectedVersion+1};
   const saved=await db.prepare(`INSERT INTO preview_workflow_events(id,case_id,actor_id,event_type,entity_id,detail_json,created_at) SELECT ?,?,?,?,?,?,? WHERE COALESCE((SELECT MAX(CAST(json_extract(detail_json,'$.version') AS INTEGER)) FROM preview_workflow_events WHERE actor_id=? AND event_type=?),0)=? AND ${writerGuard} AND ${recipientGuard} AND ${caseGuard}`).bind(crypto.randomUUID(),anchor,actor.id,SETTINGS,'weekly-settings:'+actor.id,JSON.stringify(settings),new Date().toISOString(),actor.id,SETTINGS,body.expectedVersion,actor.id,actor.loginId,JSON.stringify(settings.recipientIds),actor.id,JSON.stringify([anchor]),actor.id).run();
   if(saved.meta?.changes!==1)throw new Invalid('설정이 다른 화면에서 바뀌었습니다. 다시 열어 확인하세요.',409);return reply({settings});
  }
  if(path==='/api/project-worklogs/weekly/run-scheduled'){
   if(request.method!=='POST')throw new Invalid('지원하지 않는 요청입니다.',405);if(!worklogCanWrite(actor))throw new Invalid('본인의 정기보고만 실행합니다.',403);if(Object.keys(body).length)throw new Invalid('서버의 현재 주간으로 실행합니다.');
   return reply(await dispatchScheduledWorklogs(db,new Date(),{actorId:actor.id}));
  }
  const match=path.match(/^\/api\/project-worklogs\/weekly\/reviews(?:\/([0-9a-f-]{36}))?$/i);if(!match)throw new Invalid('결재 경로를 확인하세요.',404);
  if(match[1]){
   const s=await readSubmission(db,match[1]);if(!s||!permitted(s,actor))throw new Invalid('지정된 주간 상신본이 없습니다.',404);
   if(request.method==='GET')return reply({submission:await decorate(db,s)});
   if(request.method!=='POST')throw new Invalid('지원하지 않는 요청입니다.',405);
   const allowed=await recipients(db,{...actor,id:s.authorId});if(s.authorId===actor.id||!s.recipientIds.includes(actor.id)||!allowed.some(r=>r.id===actor.id))throw new Invalid('지정된 결재자만 결재합니다.',403);
   if(Object.keys(body).some(k=>!['decision','comment','viewed'].includes(k))||!['APPROVED','REJECTED'].includes(body.decision)||body.viewed!==true||typeof body.comment!=='string'||body.comment.length>5000||(body.decision==='REJECTED'&&!body.comment.trim()))throw new Invalid('상신본 확인 여부와 결재 의견을 확인하세요.');
   // One conditional insert serializes duplicate/concurrent decisions, including rejection.
   const result=await db.prepare(`INSERT INTO preview_workflow_events(id,case_id,actor_id,event_type,entity_id,detail_json,created_at) SELECT ?,e.case_id,?,?,?,?,? FROM preview_workflow_events e WHERE e.id=? AND e.event_type=? AND e.actor_id<>? AND EXISTS(SELECT 1 FROM json_each(json_extract(e.detail_json,'$.recipientIds')) WHERE value=?) AND EXISTS(SELECT 1 FROM preview_users u WHERE u.id=? AND u.login_id=? AND u.is_active=1 AND EXISTS(SELECT 1 FROM json_each(u.roles_json) WHERE value IN ('admin','ceo','director'))) AND EXISTS(SELECT 1 FROM preview_cases c WHERE c.id=e.case_id AND c.deleted_at IS NULL AND c.organization_id='concost') AND NOT EXISTS(SELECT 1 FROM preview_workflow_events d WHERE d.event_type=? AND d.entity_id=e.id AND (d.actor_id=? OR json_extract(d.detail_json,'$.decision')='REJECTED'))`)
   .bind(crypto.randomUUID(),actor.id,DECIDE,s.id,JSON.stringify(body),new Date().toISOString(),s.id,SUBMIT,actor.id,actor.id,actor.id,actor.loginId,DECIDE,actor.id).run();
   if(result.meta?.changes!==1)throw new Invalid('이미 결재했거나 반려된 상신본입니다. 서버 상태를 다시 확인하세요.',409);return reply({submission:await decorate(db,s)});
  }
  if(request.method==='GET'){
   const week=url.searchParams.get('week');if(week&&!dayOK(week))throw new Invalid('조회 주를 확인하세요.');
   const rows=(await db.prepare("SELECT e.detail_json AS detail FROM preview_workflow_events e JOIN preview_cases c ON c.id=e.case_id AND c.organization_id='concost' AND c.deleted_at IS NULL WHERE e.event_type=? AND (e.actor_id=? OR (?=1 AND EXISTS(SELECT 1 FROM json_each(json_extract(e.detail_json,'$.recipientIds')) WHERE value=?))) AND (?='' OR json_extract(e.detail_json,'$.weekStart')=?) ORDER BY e.rowid DESC LIMIT 60").bind(SUBMIT,actor.id,reviewerRole(actor)?1:0,actor.id,week?worklogWeekRange(week).weekStart:'',week?worklogWeekRange(week).weekStart:'').all<{detail:string}>()).results;
   return reply({submissions:await Promise.all(rows.map(row=>decorate(db,JSON.parse(row.detail),false)))});
  }
  if(request.method!=='POST')throw new Invalid('지원하지 않는 요청입니다.',405);
  if(!worklogCanWrite(actor))throw new Invalid('본인 주간 업무일지만 상신합니다.',403);
  if(Object.keys(body).some(k=>!['week','caseId','recipientIds','requestId'].includes(k))||!dayOK(body.week)||typeof body.caseId!=='string'||(body.caseId&&!uuid.test(body.caseId))||!uuid.test(body.requestId))throw new Invalid('상신 주간·프로젝트·요청 번호를 확인하세요.');
  validateRecipients(body.recipientIds,await recipients(db,actor));const result=await submit(db,actor,body.week,body.caseId,body.recipientIds,await stableId(`claim-manual:${actor.id}:${body.requestId}`),'MANUAL',new Date());return reply(result);
 }catch(e){if(e instanceof Invalid)return reply({error:e.message},e.status);throw e;}
}
