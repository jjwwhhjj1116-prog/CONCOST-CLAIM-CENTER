import {WorkerEntrypoint} from 'cloudflare:workers';
import worker,{handleTechWorklogs,type CloudflareEnv} from './index';
export default worker;
export class ClaimWorklogs extends WorkerEntrypoint<CloudflareEnv>{
  fetch(request:Request){return handleTechWorklogs(request,this.env);}
}
