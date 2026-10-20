import React,{useEffect,useState} from 'react';
import {registerNavigationBlocker} from '../navigation-guard';
import {ProjectWorklogPanel} from './ProjectWorklogPanel';
export function ProjectWorklogs({actorKey}:{actorKey:string}){
  const [dirty,setDirty]=useState(false);
  useEffect(()=>registerNavigationBlocker(()=>dirty&&!window.confirm('저장하지 않은 업무일지가 있습니다. 입력을 버리고 이동할까요?')),[dirty]);
  return <ProjectWorklogPanel actorKey={actorKey} onDirtyChange={setDirty}/>;
}
