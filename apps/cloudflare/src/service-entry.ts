import {WorkerEntrypoint} from 'cloudflare:workers';
import worker,{handleTechWorklogs,type CloudflareEnv} from './index';
import {dispatchScheduledWorklogs} from './project-worklog-reviews';
export default {...worker,async scheduled(controller:{scheduledTime:number},env:CloudflareEnv){
  if(!env.DB||env.RELEASE_MAINTENANCE==='1')return;
  const result=await dispatchScheduledWorklogs(env.DB,new Date(controller.scheduledTime));
  if(result.failed)throw new Error(`Weekly worklog dispatch failed for ${result.failed} writers`);
}};
export class ClaimWorklogs extends WorkerEntrypoint<CloudflareEnv>{
  fetch(request:Request){return handleTechWorklogs(request,this.env);}
}
