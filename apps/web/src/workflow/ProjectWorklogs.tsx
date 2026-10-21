import React,{useEffect,useState} from 'react';
import {Button,Dialog} from '@claim-studio/ui';
import {registerNavigationBlocker,type PendingNavigation} from '../navigation-guard';
import {ProjectWorklogPanel} from './ProjectWorklogPanel';
import {WeeklyProjectWorklogs} from './WeeklyProjectWorklogs';
export function ProjectWorklogs({actorKey,weekly=false,onNavigate}:{actorKey:string;weekly?:boolean;onNavigate?:(path:string)=>void}){
  const [dirty,setDirty]=useState(false);
  const [pending,setPending]=useState<PendingNavigation|null>(null);
  useEffect(()=>registerNavigationBlocker(navigation=>{if(!dirty)return false;setPending(navigation);return true;}),[dirty]);
  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  return <>{weekly?<WeeklyProjectWorklogs actorKey={actorKey} onNavigate={onNavigate} onDirtyChange={setDirty}/>:<ProjectWorklogPanel actorKey={actorKey} onDirtyChange={setDirty} onNavigate={onNavigate}/>}<Dialog isOpen={!!pending} title="저장하지 않은 업무일지" onClose={()=>setPending(null)} hideDefaultAction trapFocus><p>저장하지 않은 입력이 있습니다. 이동을 취소하면 입력을 그대로 유지합니다.</p><div className="dialog-actions worklog-discard-actions"><Button onClick={()=>setPending(null)}>이동 취소 · 계속 작성</Button><Button variant="secondary" onClick={()=>{const navigation=pending;setPending(null);setDirty(false);navigation?.proceed();}}>입력 버리고 이동</Button></div></Dialog></>;
}
