import {useEffect,useRef,useState} from 'react';
import './ProjectWorklogPanel.css';
type Project={id:string;caseNumber:string;title:string};
type Writer={id:string;name:string;position:string};
type Form={todayTask:string;tomorrowPlan:string;notes:string;workHours:number|null;dailyGoal:string;plannedDetails:string;planMemo:string;progress:number|null;status:string;remainingTask:string;delayReason:string;blockers:string};
type Log=Form&{id:string;authorId:string;authorName:string;date:string;version:number;updatedAt:string};
type AutomaticEntry={id:string;authorId:string;authorName:string;eventType:string;title:string;createdAt:string};
type Context={actor:{id:string;name:string;canWrite:boolean};writers:Writer[];projects:Project[]};
const emptyForm=():Form=>({todayTask:'',tomorrowPlan:'',notes:'',workHours:null,dailyGoal:'',plannedDetails:'',planMemo:'',progress:null,status:'',remainingTask:'',delayReason:'',blockers:''});
const formFromLog=(log?:Log):Form=>Object.fromEntries(Object.entries(emptyForm()).map(([key,fallback])=>[key,log?.[key as keyof Form]??fallback])) as Form;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const message=(e:unknown)=>e instanceof Error?e.message:'업무일지를 불러오지 못했습니다.';
async function request<T>(path:string,options?:RequestInit):Promise<T>{
  const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
  const value=await r.json().catch(()=>null);if(!r.ok)throw Error(value?.error||'서버 연결을 확인하고 다시 시도하세요.');return value as T;
}
export function ProjectWorklogPanel({basePath='/api/project-worklogs',actorKey='',onDirtyChange,onNavigate}:{basePath?:string;actorKey?:string;onDirtyChange?:(dirty:boolean)=>void;onNavigate?:(path:string)=>void}){
  const params=new URLSearchParams(window.location.search),initialCase=params.get('caseId')||'';
  const [context,setContext]=useState<Context|null>(null),[caseId,setCaseId]=useState(''),[day,setDay]=useState(params.get('date')||today()),[author,setAuthor]=useState('');
  const [logs,setLogs]=useState<Log[]>([]),[form,setForm]=useState<Form>(emptyForm),[original,setOriginal]=useState<Form>(emptyForm);
  const [automatic,setAutomatic]=useState<AutomaticEntry[]>([]);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[failure,setFailure]=useState(''),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0),[loadedKey,setLoadedKey]=useState('');
  const generation=useRef(0),saveBusy=useRef(false),mounted=useRef(true),keyRef=useRef('');
  const key=[actorKey,context?.actor.id,caseId,day,author].join('|');keyRef.current=key;
  const selected=logs.find(log=>log.authorId===author),canEdit=Boolean(context?.actor.canWrite&&author===context.actor.id&&caseId&&!loading&&loadedKey===caseId+'|'+day);
  const dirty=canEdit&&JSON.stringify(form)!==JSON.stringify(original);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
  useEffect(()=>{onDirtyChange?.(dirty);const warn=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>{window.removeEventListener('beforeunload',warn);onDirtyChange?.(false);};},[dirty,onDirtyChange]);
  useEffect(()=>{
    const controller=new AbortController();setContext(null);setCaseId('');setLogs([]);setAutomatic([]);setForm(emptyForm());setOriginal(emptyForm());setLoading(true);setFailure('');
    void request<Context>(basePath,{signal:controller.signal}).then(data=>{
      if(controller.signal.aborted)return;setContext(data);setAuthor(data.writers.some(p=>p.id===params.get('authorId'))?params.get('authorId')!:data.actor.canWrite?data.actor.id:data.writers[0]?.id||'');
      setCaseId(initialCase?(data.projects.some(p=>p.id===initialCase)?initialCase:''):'');
      if(initialCase&&!data.projects.some(p=>p.id===initialCase))setFailure('요청한 프로젝트의 배정을 확인할 수 없습니다. 접근 가능한 프로젝트를 선택하세요.');
    }).catch(e=>{if(!controller.signal.aborted)setFailure(message(e));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[basePath,actorKey]);
  useEffect(()=>{
    const seq=++generation.current,controller=new AbortController();setLoadedKey('');setLogs([]);setAutomatic([]);setForm(emptyForm());setOriginal(emptyForm());setNotice('');
    if(!context||!caseId)return()=>controller.abort();
    setLoading(true);setFailure('');
    void request<{logs:Log[];automaticEntries?:AutomaticEntry[]}>(`${basePath}/${encodeURIComponent(caseId)}?date=${encodeURIComponent(day)}`,{signal:controller.signal}).then(data=>{if(seq===generation.current&&!controller.signal.aborted){setLogs(data.logs);setAutomatic(data.automaticEntries||[]);setLoadedKey(caseId+'|'+day);}}).catch(e=>{if(seq===generation.current&&!controller.signal.aborted)setFailure(message(e));}).finally(()=>{if(seq===generation.current&&!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[basePath,actorKey,context,caseId,day,refresh]);
  useEffect(()=>{const next=formFromLog(logs.find(entry=>entry.authorId===author));setForm(next);setOriginal(next);},[author,logs]);
  const discard=()=>!dirty||window.confirm('저장하지 않은 입력이 있습니다. 입력을 버리고 이동할까요?');
  const change=(field:keyof Form,value:string|number|null)=>setForm(current=>({...current,[field]:value}));
  const chooseContext=(nextCase:string,nextDay:string)=>{if(onNavigate){onNavigate('/projects/worklogs?'+new URLSearchParams({...(nextCase?{caseId:nextCase}:{}),date:nextDay,authorId:author}));}else if(discard()){setCaseId(nextCase);setDay(nextDay);}};
  const save=async()=>{
    if(!canEdit||saveBusy.current||loading)return;saveBusy.current=true;setSaving(true);setFailure('');setNotice('');const savedKey=keyRef.current;
    try{const result=await request<{log:Log}>(`${basePath}/${encodeURIComponent(caseId)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,date:day,expectedVersion:selected?.version||0})});
      if(!mounted.current||savedKey!==keyRef.current)return;
      setLogs(current=>[result.log,...current.filter(log=>log.authorId!==result.log.authorId)]);setNotice(`서버 저장 완료 · v${result.log.version}`);
    }catch(e){if(mounted.current&&savedKey===keyRef.current)setFailure(message(e));}finally{saveBusy.current=false;if(mounted.current)setSaving(false);}
  };
  const project=context?.projects.find(p=>p.id===caseId);
  const entries=automatic.filter(entry=>entry.authorId===author);
  const summary=entries.reduce<Record<string,{title:string;count:number}>>((groups,entry)=>{const group=groups[entry.eventType]||(groups[entry.eventType]={title:entry.title.replace(/ · v\d+$/,''),count:0});group.count++;return groups;},{});
  return <section className="project-worklog" aria-label="프로젝트 업무일지">
    <header><div><h2>일일 업무일지</h2><p>실제 저장한 업무는 자동 기록하고, 오늘의 계획·수행 내용·내일 계획은 본인이 작성합니다.</p></div>{onNavigate&&<button type="button" onClick={()=>onNavigate('/projects/worklogs/weekly?'+new URLSearchParams({...(caseId?{caseId}:{}),week:day,authorId:author}))}>주간 업무일지 보기</button>}</header>
    <p className="project-worklog__policy">작성 대상: 이경훈 센터장 · 최영배 본부장 · 장범선 실장. 대표·부사장·관리자 계정의 작업은 일지로 작성하지 않으며 기존 조회·결재 권한은 유지합니다.</p>
    {failure&&<div role="alert" className="project-worklog__error">{failure} <button type="button" onClick={()=>{if(!context)window.location.reload();else if(discard())setRefresh(n=>n+1);}} disabled={saving}>다시 불러오기</button></div>}
    {notice&&<p role="status">{notice}</p>}
    <div className="project-worklog__filters">
      <label>프로젝트<select value={caseId} disabled={saving||loading} onChange={e=>chooseContext(e.target.value,day)}><option value="">프로젝트 선택</option>{context?.projects.map(p=><option key={p.id} value={p.id}>{p.caseNumber} · {p.title}</option>)}</select></label>
      <label>작성일<input type="date" value={day} disabled={saving||loading} onChange={e=>{if(e.target.value)chooseContext(caseId,e.target.value);}}/></label>
      <label>작성자{context?.actor.canWrite?<output>{context.writers.find(p=>p.id===author)?.name} {context.writers.find(p=>p.id===author)?.position} · 본인</output>:<select value={author} disabled={saving||loading} onChange={e=>{if(discard())setAuthor(e.target.value);}}>{!context?.writers.length&&<option value="">작성 대상 직원 없음</option>}{context?.writers.map(p=><option key={p.id} value={p.id}>{p.name} {p.position}</option>)}</select>}</label>
    </div>
    {loading?<p role="status">서버 업무일지를 불러오는 중입니다.</p>:!caseId?<p>배정된 프로젝트를 선택하세요. 프로젝트가 없으면 기존 프로젝트 배정 상태를 확인해야 합니다.</p>:<>
      <div className="project-worklog__record"><strong>{project?.caseNumber} · {project?.title}</strong><span>{loadedKey!==caseId+'|'+day?'서버 저장본을 확인하지 못했습니다. 다시 불러오세요.':`자동 작성 ${entries.length}건${selected?' · 직접 기록 저장본 v'+selected.version:''}`}</span>{!canEdit&&<span>조회 전용 화면입니다.</span>}</div>
      {loadedKey===caseId+'|'+day&&<section aria-label="자동 작성된 수행 업무" className="project-worklog__automatic"><h3>자동 작성된 수행 업무</h3>{entries.length?<><ul>{Object.entries(summary).map(([kind,group])=><li key={kind}>{group.title} · {group.count}회</li>)}</ul><details><summary>저장 이력 {entries.length}건 확인</summary><ol>{entries.map(entry=><li key={entry.id}><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})}</time> {entry.title}</li>)}</ol></details></>:<p>이 날짜에 본인 계정으로 저장한 업무가 없습니다. 보고서·착수회의·현장조사 등을 저장하면 여기에 자동 반영됩니다.</p>}<p>서버에 저장된 실제 작업 이력입니다. 조회·미저장 편집·타인의 작업·인력 배정만으로는 작성하지 않습니다. 업무시간과 다음 계획은 추정하지 않습니다.</p></section>}
      <section className="project-worklog__manual" aria-label="일일 업무 작성"><h3>일일 업무 작성{selected?` · 저장본 v${selected.version}`:''}</h3>
      <fieldset disabled={!canEdit||saving}>
        <h4>오늘의 업무계획</h4><div className="project-worklog__three">{([['dailyGoal','주요 목표'],['plannedDetails','세부 작업 내용'],['planMemo','계획 메모']] as const).map(([key,label])=><label key={key}>{label} · 선택<textarea rows={3} maxLength={5000} value={form[key]} onChange={e=>change(key,e.target.value)}/></label>)}</div>
        <h4>업무수행 보고</h4><label>오늘 수행 업무 · 필수<textarea rows={4} value={form.todayTask} maxLength={10000} onChange={e=>change('todayTask',e.target.value)}/></label>
        <div className="project-worklog__three"><label>진행률 · 선택<input type="number" min={0} max={100} step="any" value={form.progress??''} onChange={e=>change('progress',e.target.value===''?null:Number(e.target.value))}/></label><label>업무 상태<select value={form.status} onChange={e=>change('status',e.target.value)}><option value="">미입력</option>{['진행중','완료','지연','대기'].map(s=><option key={s}>{s}</option>)}</select></label><label>실제 업무시간 · 선택<input type="number" min={0} max={24} step="any" value={form.workHours??''} onChange={e=>change('workHours',e.target.value===''?null:Number(e.target.value))}/></label></div>
        <div className="project-worklog__three">{([['remainingTask','미완료 업무'],['delayReason','지연 사유'],['blockers','장애요인']] as const).map(([key,label])=><label key={key}>{label}<textarea rows={3} maxLength={5000} value={form[key]} onChange={e=>change(key,e.target.value)}/></label>)}</div>
        <h4>다음 계획·특이사항</h4>
        <div className="project-worklog__details"><label>다음 업무 계획<textarea rows={4} value={form.tomorrowPlan} maxLength={10000} onChange={e=>change('tomorrowPlan',e.target.value)}/></label><label>특이사항·협의 내용<textarea rows={4} value={form.notes} maxLength={10000} onChange={e=>change('notes',e.target.value)}/></label></div>
      </fieldset>
      {canEdit&&<button type="button" className="project-worklog__save" disabled={saving||!form.todayTask.trim()} onClick={()=>void save()}>{saving?'저장 중…':'일일 업무일지 저장'}</button>}
      </section>
      <footer><span>{dirty?'저장하지 않은 직접 기록이 있습니다.':loadedKey!==caseId+'|'+day?'저장본 확인이 필요합니다.':entries.length?'자동 작성된 업무는 서버 작업 이력에 보관되어 있습니다.':selected?'현재 서버 직접 기록입니다.':'저장된 작업이 있으면 자동 반영됩니다.'}</span><button type="button" disabled={loading||saving} onClick={()=>{if(discard())setRefresh(n=>n+1);}}>서버 저장본 다시 열기</button></footer>
    </>}
  </section>;
}
