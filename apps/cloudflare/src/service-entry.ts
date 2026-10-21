import {WorkerEntrypoint} from 'cloudflare:workers';
import worker,{handleTechWorklogs,type CloudflareEnv} from './index';
import {dispatchLocalWorklogs,dispatchWorklogEnvironments} from './worklog-scheduler';
export default {...worker,async scheduled(controller:{scheduledTime:number},env:CloudflareEnv){
  await dispatchWorklogEnvironments(env,new Date(controller.scheduledTime));
}};
// Service binding only: no public HTTP handler and no caller-supplied time.
export class WorklogScheduler extends WorkerEntrypoint<CloudflareEnv>{
  runDue(){return dispatchLocalWorklogs(this.env,new Date());}
}
export class ClaimWorklogs extends WorkerEntrypoint<CloudflareEnv>{
  fetch(request:Request){return handleTechWorklogs(request,this.env);}
}
