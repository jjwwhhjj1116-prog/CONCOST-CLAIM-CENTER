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
export const worklogCanWrite=(actor:WorklogActor)=>WORKLOG_IDENTITIES.some(p=>p.writer&&matchesAccount(p,actor));
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
  if(!parts[1]){
    if(request.method!=='GET')return error('프로젝트를 먼저 선택하세요.',400);
    const accounts=await db.prepare('SELECT id,login_id AS loginId FROM preview_users WHERE is_active=1 AND login_id IN (?,?,?)').bind(...WORKLOG_IDENTITIES.filter(p=>p.writer).map(p=>p.loginId)).all<{id:string;loginId:string}>();
    const writers=WORKLOG_IDENTITIES.filter(p=>p.writer).flatMap(p=>{const a=accounts.results.find(a=>matchesAccount(p,a));return a?[{id:a.id,name:p.name,position:p.position}]:[];});
    const projects=await db.prepare(`SELECT c.id,c.case_number AS caseNumber,c.title FROM preview_cases c WHERE ${accessSql} ORDER BY c.updated_at DESC,c.id`).bind(ORGANIZATION,admin,actor.id).all();
    return response({actor:{id:actor.id,name:actor.displayName,canWrite:worklogCanWrite(actor)},writers,projects:projects.results});
  }
  const caseId=parts[1];if(!uuid.test(caseId))return error('프로젝트 번호를 확인하세요.',400);
  const project=await db.prepare(`SELECT c.id,c.case_number AS caseNumber,c.title FROM preview_cases c WHERE c.id=? AND ${accessSql}`).bind(caseId,ORGANIZATION,admin,actor.id).first();
  if(!project)return error('배정된 프로젝트를 찾을 수 없습니다.',404);
  if(request.method==='GET'){
    const day=url.searchParams.get('date');if(!dayOK(day))return error('작성일을 확인하세요.',400);
    const rows=await db.prepare(`SELECT e.id,e.actor_id AS authorId,u.display_name AS authorName,e.detail_json AS detail,e.created_at AS updatedAt FROM preview_workflow_events e JOIN preview_users u ON u.id=e.actor_id WHERE e.case_id=? AND e.event_type=? AND e.entity_id=? AND NOT EXISTS(SELECT 1 FROM preview_workflow_events n WHERE n.case_id=e.case_id AND n.actor_id=e.actor_id AND n.event_type=e.event_type AND n.entity_id=e.entity_id AND n.rowid>e.rowid) ORDER BY e.created_at DESC`).bind(caseId,EVENT,'worklog:'+day).all<{id:string;authorId:string;authorName:string;detail:string;updatedAt:string}>();
    return response({project,date:day,logs:rows.results.map(({detail,...row})=>({...row,...JSON.parse(detail)}))});
  }
  if(!worklogCanWrite(actor))return error('업무일지는 이경훈·최영배·장범선 본인 계정으로 작성합니다. 기존 조회·결재 권한은 유지됩니다.',403);
  const origin=request.headers.get('Origin');
  if((origin&&origin!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site'||(request.headers.has('Cookie')&&origin!==url.origin))return error('현재 서버 화면에서 저장하세요.',403);
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))return error('JSON 입력이 필요합니다.',415);
  const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>40000)return error('업무일지 입력이 너무 큽니다.',413);
  let body:Record<string,unknown>;try{body=JSON.parse(raw);}catch{return error('입력 형식을 확인하세요.',400);}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['date','todayTask','tomorrowPlan','notes','workHours','expectedVersion'].includes(k)))return error('본인 업무 내용과 작성일만 저장할 수 있습니다.',400);
  if(!dayOK(body.date)||!Number.isSafeInteger(body.expectedVersion)||Number(body.expectedVersion)<0||Number(body.expectedVersion)>=Number.MAX_SAFE_INTEGER||['todayTask','tomorrowPlan','notes'].some(k=>typeof body[k]!=='string'||String(body[k]).length>10000)||!String(body.todayTask).trim()||(body.workHours!==null&&(typeof body.workHours!=='number'||!Number.isFinite(body.workHours)||body.workHours<0||body.workHours>24)))return error('작성일·수행 업무·시간(0~24)·저장 버전을 확인하세요.',400);
  const id=crypto.randomUUID(),now=new Date().toISOString(),version=Number(body.expectedVersion)+1;
  const detail={date:body.date,todayTask:body.todayTask,tomorrowPlan:body.tomorrowPlan,notes:body.notes,workHours:body.workHours,version,source:'CLAIM_CENTER'};
  // A single conditional insert performs the version check and write atomically.
  const saved=await db.prepare(`INSERT INTO preview_workflow_events(id,case_id,actor_id,event_type,entity_id,detail_json,created_at) SELECT ?,?,?,?,?,?,? WHERE COALESCE((SELECT MAX(CAST(json_extract(detail_json,'$.version') AS INTEGER)) FROM preview_workflow_events WHERE case_id=? AND actor_id=? AND event_type=? AND entity_id=?),0)=? AND EXISTS(SELECT 1 FROM preview_cases c WHERE c.id=? AND ${accessSql}) AND EXISTS(SELECT 1 FROM preview_users WHERE id=? AND login_id=? AND is_active=1)`)
    .bind(id,caseId,actor.id,EVENT,'worklog:'+body.date,JSON.stringify(detail),now,caseId,actor.id,EVENT,'worklog:'+body.date,body.expectedVersion,caseId,ORGANIZATION,admin,actor.id,actor.id,actor.loginId).run();
  if(saved.meta?.changes!==1)return error('다른 화면에서 변경됐거나 프로젝트 배정이 달라졌습니다. 입력은 유지됩니다. 서버 내용을 확인한 뒤 다시 저장하세요.',409);
  return response({log:{id,authorId:actor.id,authorName:actor.displayName,updatedAt:now,...detail},project});
}
