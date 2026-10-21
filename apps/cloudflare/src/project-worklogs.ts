// Project worklogs share the existing immutable workflow history, never report drafts.
export interface WorklogActor {id:string;loginId:string;displayName:string;roles:string[]}
interface Statement {bind(...v:unknown[]):Statement;first<T>():Promise<T|null>;all<T>():Promise<{results:T[]}>;run():Promise<{meta?:{changes?:number}}>}
export interface WorklogDatabase {prepare(sql:string):Statement}
const ORGANIZATION='concost';
const EVENT='PROJECT_WORKLOG_SAVED';
// Existing account identities verified in the account directories; names do not grant access.
export const WORKLOG_IDENTITIES=[
  {id:'5591c07f-054e-44aa-afdd-aacbaaf4ecf5',developmentId:'9ab3d678-0047-4b60-bfd5-5443fbe151fa',loginId:'lkh@con-cost.com',name:'이경훈',position:'센터장',writer:true},
  {id:'04913c4f-661b-4458-b920-cc8da980fe6d',developmentId:'9ffc45e9-f599-4faf-9cc3-461cd63f239f',loginId:'ybchoi@con-cost.com',name:'최영배',position:'본부장',writer:true,techId:'u_8',techLogin:'ybchoi',techEmail:'ybchoi@con-cost.com'},
  {id:'a5f4ef96-b107-4766-952f-3c45723cf067',developmentId:'609e76ea-4524-478b-a6ea-c601d9dc7be4',loginId:'bsjang@con-cost.com',name:'장범선',position:'실장',writer:true,techId:'u_24',techLogin:'bsjang',techEmail:'bsjang@con-cost.com'},
  {id:'f5dc35e5-9c59-416b-a65a-66cbe07c628e',loginId:'ceo@con-cost.com',name:'현동명',position:'대표이사',writer:false,techId:'management-1132',techLogin:'ceo',techEmail:'ceo@concost.co.kr'},
  {id:'810e32fe-eeb3-4108-83a9-4f0ad2ad9f9a',loginId:'lwh@con-cost.com',name:'이원희',position:'부사장',writer:false,techId:'management-1135',techLogin:'lwh',techEmail:'lwh@concost.co.kr'},
  {id:'d16dbd63-1074-4ab5-b686-e20e7eabe7dc',loginId:'yjw@con-cost.com',name:'유종욱',position:'관리자',writer:false,techId:'u_10',techLogin:'yjw',techEmail:'yjw@con-cost.com'}
] as const;
const matchesAccount=(p:{id:string;developmentId?:string;loginId:string},actor:{id:string;loginId:string})=>p.loginId===actor.loginId&&(p.id===actor.id||p.developmentId===actor.id);
export const worklogCanWrite=(actor:WorklogActor)=>!actor.roles.some(r=>['admin','ceo'].includes(r))&&WORKLOG_IDENTITIES.some(p=>p.writer&&matchesAccount(p,actor));
const canReview=(actor:WorklogActor)=>actor.roles.some(r=>['admin','ceo','director'].includes(r))&&!worklogCanWrite(actor);
const workflowTitles:Record<string,string>={KICKOFF_SAVED:'착수회의 기록 저장',KICKOFF_DRAFT_GENERATED:'착수회의 정리 저장',SITE_SURVEY_SAVED:'현장조사 기록 저장',SITE_SURVEY_DRAFT_GENERATED:'현장조사 정리 저장',SITE_SURVEY_CONFIRMED:'현장조사 결과 확정'};
const activityTypes=['CASE_CREATED','STATUS_CHANGED','PARTY_ADDED','SCHEDULE_ADDED','PROPOSAL_CREATED','PROPOSAL_IMAGE_ADDED','PROPOSAL_VERSION_SAVED','PROPOSAL_CONFIRMED','PROPOSAL_LINKED','AWARD_DECIDED','LITIGATION_LINKED','LITIGATION_UPDATED','LITIGATION_EVENT_ADDED','INTAKE_SOURCE_SUMMARIZED','REPORT_AUTOSAVED','REPORT_SAVED','REPORT_CHAPTER_SAVED','REPORT_CHAPTER_APPLIED','REPORT_OUTLINE_SAVED','REPORT_OUTLINE_CONFIRMED','REPORT_REVIEW_REQUESTED','REPORT_FINALIZED','REPORT_OUTLINE_AI_SUGGESTED','REPORT_CHAPTER_AI_DRAFTED','REPORT_MEMORY_CANDIDATE_CREATED','EVIDENCE_UPLOADED','EVIDENCE_UPLOADED_TO_GOOGLE_DRIVE','PROJECT_SCHEDULE_SAVED','SCHEDULE_CHANGE_REQUESTED','SCHEDULE_CHANGE_DECIDED'];
// Read the successful, persisted work itself. No duplicate daily copies, guessed hours,
// assignment-as-performance attribution, or writes caused merely by opening a journal.
async function automaticEntries(db:WorklogDatabase,caseId:string,day:string,authors:string[],actor:WorklogActor,endDay=day){
  if(!authors.length)return [];
  const marks=authors.map(()=>'?').join(','),start=new Date(day+'T00:00:00+09:00'),end=new Date(new Date(endDay+'T00:00:00+09:00').getTime()+86400000),admin=actor.roles.includes('admin')?1:0;
  const rows=await db.prepare(`SELECT 'activity:'||a.id AS id,a.actor_id AS authorId,u.display_name AS authorName,a.event_type AS eventType,a.title,a.created_at AS createdAt,c.id AS caseId,c.case_number AS caseNumber,c.title AS projectTitle,date(a.created_at,'+9 hours') AS date FROM preview_case_activities a JOIN preview_users u ON u.id=a.actor_id JOIN preview_cases c ON c.id=a.case_id WHERE ${accessSql} AND (?='' OR c.id=?) AND a.actor_id IN (${marks}) AND julianday(a.created_at)>=julianday(?) AND julianday(a.created_at)<julianday(?) AND a.event_type IN (${activityTypes.map(()=>'?').join(',')}) UNION ALL SELECT 'workflow:'||e.id,e.actor_id,u.display_name,e.event_type,e.event_type,e.created_at,c.id,c.case_number,c.title,date(e.created_at,'+9 hours') FROM preview_workflow_events e JOIN preview_users u ON u.id=e.actor_id JOIN preview_cases c ON c.id=e.case_id WHERE ${accessSql} AND (?='' OR c.id=?) AND e.actor_id IN (${marks}) AND julianday(e.created_at)>=julianday(?) AND julianday(e.created_at)<julianday(?) AND e.event_type IN (${Object.keys(workflowTitles).map(()=>'?').join(',')}) ORDER BY createdAt,id`)
    .bind(ORGANIZATION,admin,actor.id,caseId,caseId,...authors,start.toISOString(),end.toISOString(),...activityTypes,ORGANIZATION,admin,actor.id,caseId,caseId,...authors,start.toISOString(),end.toISOString(),...Object.keys(workflowTitles)).all<{id:string;authorId:string;authorName:string;eventType:string;title:string;createdAt:string}>();
  return rows.results.map(row=>({...row,title:row.id.startsWith('workflow:')?workflowTitles[row.eventType]:row.title,source:'CLAIM_CENTER'}));
}
async function manualEntries(db:WorklogDatabase,actor:WorklogActor,authors:string[],start:string,end:string,caseId=''){
  if(!authors.length)return [];
  const rows=await db.prepare(`SELECT e.id,e.actor_id AS authorId,u.display_name AS authorName,e.detail_json AS detail,e.created_at AS updatedAt,c.id AS caseId,c.case_number AS caseNumber,c.title AS projectTitle FROM preview_workflow_events e JOIN preview_users u ON u.id=e.actor_id JOIN preview_cases c ON c.id=e.case_id WHERE ${accessSql} AND (?='' OR c.id=?) AND e.actor_id IN (${authors.map(()=>'?').join(',')}) AND e.event_type=? AND e.entity_id>=? AND e.entity_id<=? AND NOT EXISTS(SELECT 1 FROM preview_workflow_events n WHERE n.case_id=e.case_id AND n.actor_id=e.actor_id AND n.event_type=e.event_type AND n.entity_id=e.entity_id AND n.rowid>e.rowid) ORDER BY e.entity_id,c.case_number,e.actor_id`)
    .bind(ORGANIZATION,actor.roles.includes('admin')?1:0,actor.id,caseId,caseId,...authors,EVENT,'worklog:'+start,'worklog:'+end).all<{detail:string}>();
  return rows.results.map(({detail,...row})=>({...row,...JSON.parse(detail)}));
}
export function worklogWeekRange(day:string){
  const date=new Date(day+'T00:00:00Z');date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));
  const days=Array.from({length:7},(_,i)=>new Date(date.getTime()+i*86400000).toISOString().slice(0,10));
  return {weekStart:days[0],weekEnd:days[6],days};
}
export function techWorklogIdentity(actor:unknown){
  if(!actor||typeof actor!=='object')return null;
  const a=actor as Record<string,unknown>;
  return WORKLOG_IDENTITIES.find(p=>'techId'in p&&p.techId===a.id&&p.techLogin===a.login&&p.techEmail===a.email)||null;
}
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const error=(message:string,status:number)=>response({error:message},status);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dayOK=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const accessSql='c.organization_id=? AND c.deleted_at IS NULL AND (?=1 OR EXISTS(SELECT 1 FROM preview_case_assignments a WHERE a.case_id=c.id AND a.user_id=?))';
export async function handleProjectWorklogs(request:Request,db:WorklogDatabase,actor:WorklogActor):Promise<Response>{
  const url=new URL(request.url),admin=actor.roles.includes('admin')?1:0;
  const parts=url.pathname.match(/^\/api\/project-worklogs(?:\/([^/]+))?$/);
  if(!parts)return error('업무일지 경로를 확인하세요.',404);
  if(!['GET','PUT'].includes(request.method))return error('지원하지 않는 요청입니다.',405);
  const accounts=await db.prepare("SELECT id,login_id AS loginId FROM preview_users WHERE is_active=1 AND login_id IN (?,?,?) AND NOT EXISTS(SELECT 1 FROM json_each(roles_json) r WHERE r.value IN ('admin','ceo'))").bind(...WORKLOG_IDENTITIES.filter(p=>p.writer).map(p=>p.loginId)).all<{id:string;loginId:string}>();
  const writers=WORKLOG_IDENTITIES.filter(p=>p.writer).flatMap(p=>{const a=accounts.results.find(a=>matchesAccount(p,a));return a&&(canReview(actor)||a.id===actor.id)?[{id:a.id,name:p.name,position:p.position}]:[];});
  if(!parts[1]){
    if(request.method!=='GET')return error('프로젝트를 먼저 선택하세요.',400);
    const projects=await db.prepare(`SELECT c.id,c.case_number AS caseNumber,c.title FROM preview_cases c WHERE ${accessSql} ORDER BY c.updated_at DESC,c.id`).bind(ORGANIZATION,admin,actor.id).all();
    return response({actor:{id:actor.id,name:actor.displayName,canWrite:worklogCanWrite(actor)},writers,projects:projects.results});
  }
  if(parts[1]==='weekly'){
    if(request.method!=='GET')return error('주간 업무일지는 일일 저장본을 자동 취합합니다.',405);
    const week=url.searchParams.get('week'),caseId=url.searchParams.get('caseId')||'';
    if(!dayOK(week)||(caseId&&!uuid.test(caseId)))return error('조회 주와 프로젝트를 확인하세요.',400);
    if(caseId&&!await db.prepare(`SELECT c.id FROM preview_cases c WHERE c.id=? AND ${accessSql}`).bind(caseId,ORGANIZATION,admin,actor.id).first())return error('배정된 프로젝트를 찾을 수 없습니다.',404);
    const range=worklogWeekRange(week),authors=writers.map(p=>p.id);
    return response({...range,logs:await manualEntries(db,actor,authors,range.weekStart,range.weekEnd,caseId),automaticEntries:await automaticEntries(db,caseId,range.weekStart,authors,actor,range.weekEnd)});
  }
  const caseId=parts[1];if(!uuid.test(caseId))return error('프로젝트 번호를 확인하세요.',400);
  const project=await db.prepare(`SELECT c.id,c.case_number AS caseNumber,c.title FROM preview_cases c WHERE c.id=? AND ${accessSql}`).bind(caseId,ORGANIZATION,admin,actor.id).first();
  if(!project)return error('배정된 프로젝트를 찾을 수 없습니다.',404);
  if(request.method==='GET'){
    const day=url.searchParams.get('date');if(!dayOK(day))return error('작성일을 확인하세요.',400);
    const allowed=writers.map(p=>p.id);
    return response({project,date:day,logs:await manualEntries(db,actor,allowed,day,day,caseId),automaticEntries:await automaticEntries(db,caseId,day,allowed,actor)});
  }
  if(!worklogCanWrite(actor))return error('업무일지는 이경훈·최영배·장범선 본인 계정으로 작성합니다. 기존 조회·결재 권한은 유지됩니다.',403);
  const origin=request.headers.get('Origin');
  if((origin&&origin!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site'||(request.headers.has('Cookie')&&origin!==url.origin))return error('현재 서버 화면에서 저장하세요.',403);
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))return error('JSON 입력이 필요합니다.',415);
  const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>256000)return error('업무일지 입력이 너무 큽니다.',413);
  let body:Record<string,unknown>;try{body=JSON.parse(raw);}catch{return error('입력 형식을 확인하세요.',400);}
  const textFields=['dailyGoal','plannedDetails','planMemo','remainingTask','delayReason','blockers'];
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['date','todayTask','tomorrowPlan','notes','workHours','expectedVersion','progress','status',...textFields].includes(k)))return error('본인 업무 내용과 작성일만 저장할 수 있습니다.',400);
  if(textFields.some(k=>k in body&&(typeof body[k]!=='string'||String(body[k]).length>5000))||('progress'in body&&body.progress!==null&&(typeof body.progress!=='number'||!Number.isFinite(body.progress)||body.progress<0||body.progress>100))||('status'in body&&(typeof body.status!=='string'||!['','진행중','완료','지연','대기'].includes(body.status))))return error('계획·진행률(0~100)·업무 상태를 확인하세요.',400);
  if(!dayOK(body.date)||!Number.isSafeInteger(body.expectedVersion)||Number(body.expectedVersion)<0||Number(body.expectedVersion)>=Number.MAX_SAFE_INTEGER||['todayTask','tomorrowPlan','notes'].some(k=>typeof body[k]!=='string'||String(body[k]).length>10000)||!String(body.todayTask).trim()||(body.workHours!==null&&(typeof body.workHours!=='number'||!Number.isFinite(body.workHours)||body.workHours<0||body.workHours>24)))return error('작성일·수행 업무·시간(0~24)·저장 버전을 확인하세요.',400);
  const id=crypto.randomUUID(),now=new Date().toISOString(),version=Number(body.expectedVersion)+1;
  const old=await db.prepare('SELECT detail_json AS detail FROM preview_workflow_events WHERE case_id=? AND actor_id=? AND event_type=? AND entity_id=? ORDER BY rowid DESC LIMIT 1').bind(caseId,actor.id,EVENT,'worklog:'+body.date).first<{detail:string}>();
  const previous=old?JSON.parse(old.detail):{};
  const additions=Object.fromEntries([...textFields,'progress','status'].map(k=>[k,k in body?body[k]:previous[k]??(k==='progress'?null:'')]));
  const detail={...additions,date:body.date,todayTask:body.todayTask,tomorrowPlan:body.tomorrowPlan,notes:body.notes,workHours:body.workHours,version,source:'CLAIM_CENTER'};
  // A single conditional insert performs the version check and write atomically.
  const saved=await db.prepare(`INSERT INTO preview_workflow_events(id,case_id,actor_id,event_type,entity_id,detail_json,created_at) SELECT ?,?,?,?,?,?,? WHERE COALESCE((SELECT MAX(CAST(json_extract(detail_json,'$.version') AS INTEGER)) FROM preview_workflow_events WHERE case_id=? AND actor_id=? AND event_type=? AND entity_id=?),0)=? AND EXISTS(SELECT 1 FROM preview_cases c WHERE c.id=? AND ${accessSql}) AND EXISTS(SELECT 1 FROM preview_users WHERE id=? AND login_id=? AND is_active=1)`)
    .bind(id,caseId,actor.id,EVENT,'worklog:'+body.date,JSON.stringify(detail),now,caseId,actor.id,EVENT,'worklog:'+body.date,body.expectedVersion,caseId,ORGANIZATION,admin,actor.id,actor.id,actor.loginId).run();
  if(saved.meta?.changes!==1)return error('다른 화면에서 변경됐거나 프로젝트 배정이 달라졌습니다. 입력은 유지됩니다. 서버 내용을 확인한 뒤 다시 저장하세요.',409);
  return response({log:{id,authorId:actor.id,authorName:actor.displayName,updatedAt:now,...detail},project});
}
