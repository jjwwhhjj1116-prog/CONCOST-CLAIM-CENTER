import { Button } from '@claim-studio/ui';
import { useEffect,useMemo,useState } from 'react';
import { apiRequest } from '../api';

interface CourtEvent {eventType:string;occurredAt:string;title:string;detailText:string;verificationStatus:string}
interface Outcome {
  id:string;caseId:string;projectCaseNumber:string;projectTitle:string;courtName:string;courtCaseNumber:string;caseTitle:string;
  currentStage:string;verificationStatus:string;outcomeStatus:string;completedEventCount:number;upcomingEventCount:number;
  nextSchedule:CourtEvent|null;judgement:CourtEvent|null;performanceSummary:string;
}
const outcomeLabel:Record<string,string>={CLOSED:'종결',JUDGEMENT_RECORDED:'판결 기록',SCHEDULED:'기일 예정',IN_PROGRESS:'진행 중',NOT_STARTED:'일정 미등록'};

export function PreviewOutcomeCenter({onNavigate}:{onNavigate:(path:string)=>void}):React.ReactElement{
  const [outcomes,setOutcomes]=useState<Outcome[]>([]); const [query,setQuery]=useState(''); const [error,setError]=useState(''); const [loading,setLoading]=useState(true);
  useEffect(()=>{void apiRequest<{outcomes:Outcome[]}>('/api/litigation-outcomes').then((result)=>setOutcomes(result.outcomes)).catch((reason)=>setError(reason instanceof Error?reason.message:'판결·성과 현황을 불러오지 못했습니다.')).finally(()=>setLoading(false));},[]);
  const filtered=useMemo(()=>{const term=query.trim().toLowerCase();return term?outcomes.filter((item)=>`${item.projectCaseNumber} ${item.projectTitle} ${item.courtCaseNumber} ${item.caseTitle}`.toLowerCase().includes(term)):outcomes;},[outcomes,query]);
  const judgementCount=outcomes.filter((item)=>Boolean(item.judgement)).length; const scheduledCount=outcomes.filter((item)=>item.upcomingEventCount>0).length;
  return <section className="route-view preview-outcome-center" aria-labelledby="outcome-center-title">
    <header className="quality-center-hero is-outcome"><div><span>COURT OUTCOME INTELLIGENCE</span><h2 id="outcome-center-title">법원 일정이 쌓이면<br/>성과 현황이 자동 정리됩니다.</h2><p>등록된 법원 사건과 일정·판결 이벤트만 계산합니다. 법원 공식 조회를 자동으로 가장하지 않으며 VERIFIED 근거를 사람이 확인합니다.</p></div><div><strong>{judgementCount}</strong><span>판결 기록</span></div></header>
    <div className="outcome-kpis"><article><span>연결 사건</span><strong>{outcomes.length}</strong></article><article><span>예정 일정</span><strong>{scheduledCount}</strong></article><article><span>판결 기록</span><strong>{judgementCount}</strong></article><article><span>확인 필요</span><strong>{outcomes.filter((item)=>item.verificationStatus!=='VERIFIED'||item.judgement?.verificationStatus==='UNVERIFIED').length}</strong></article></div>
    <div className="quality-search"><label>프로젝트·법원 사건 검색<input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="프로젝트 번호, 사건번호, 사건명"/></label><Button variant="secondary" onClick={()=>onNavigate('/after-delivery')}>법원 자료·소송 일정 관리</Button></div>
    {loading&&<p className="quality-feedback">등록된 일정에서 성과를 계산하는 중입니다.</p>}{error&&<p className="error-box" role="alert">{error}</p>}
    {!loading&&<div className="outcome-list">{filtered.length?filtered.map((item)=><article key={item.id}><header><div><span>{item.projectCaseNumber}</span><h3>{item.projectTitle}</h3></div><em className={`is-${item.outcomeStatus.toLowerCase()}`}>{outcomeLabel[item.outcomeStatus]??item.outcomeStatus}</em></header><dl><div><dt>법원 사건</dt><dd>{item.courtName} · {item.courtCaseNumber}</dd></div><div><dt>현재 단계</dt><dd>{item.currentStage} · 완료 일정 {item.completedEventCount}건</dd></div><div><dt>다음 일정</dt><dd>{item.nextSchedule?`${new Date(item.nextSchedule.occurredAt).toLocaleString('ko-KR')} · ${item.nextSchedule.title}`:'등록된 예정 일정 없음'}</dd></div><div><dt>판결·성과</dt><dd>{item.judgement?`${item.judgement.title} · ${item.judgement.detailText}`:item.performanceSummary}</dd></div></dl><footer><span>{item.judgement?.verificationStatus==='VERIFIED'?'공식 근거 확인됨':'사람 확인 필요'}</span><Button size="sm" variant="secondary" onClick={()=>onNavigate(`/after-delivery?caseId=${encodeURIComponent(item.caseId)}`)}>소송 기록 열기</Button></footer></article>):<div className="quality-empty"><strong>연결된 법원 사건이 없습니다.</strong><p>법원 자료·소송 일정에서 프로젝트와 법원 사건을 먼저 연결하세요.</p></div>}</div>}
  </section>;
}
