import React,{useEffect,useState} from 'react';
import {registerNavigationBlocker} from '../navigation-guard';
import {ProjectWorklogPanel} from './ProjectWorklogPanel';
import {WeeklyProjectWorklogs} from './WeeklyProjectWorklogs';
export function ProjectWorklogs({actorKey,weekly=false,onNavigate}:{actorKey:string;weekly?:boolean;onNavigate?:(path:string)=>void}){
  const [dirty,setDirty]=useState(false);
  useEffect(()=>registerNavigationBlocker(()=>dirty&&!window.confirm('저장하지 않은 업무일지가 있습니다. 입력을 버리고 이동할까요?')),[dirty]);
  return weekly?<WeeklyProjectWorklogs actorKey={actorKey} onNavigate={onNavigate}/>:<ProjectWorklogPanel actorKey={actorKey} onDirtyChange={setDirty} onNavigate={onNavigate}/>;
}
