import {dispatchScheduledWorklogs} from './project-worklog-reviews';
import type {CloudflareEnv} from './index';

export async function dispatchLocalWorklogs(env:CloudflareEnv,now:Date){
  if(!env.DB||env.RELEASE_MAINTENANCE==='1')return {created:0,existing:0,skipped:0,failed:0};
  const result=await dispatchScheduledWorklogs(env.DB,now);
  if(result.failed)throw new Error(`Weekly worklog dispatch failed for ${result.failed} writers`);
  return result;
}

// One account cron serves both Claim environments; each keeps its own DB and clock.
export async function dispatchWorklogEnvironments(env:CloudflareEnv,now:Date){
  const results=await Promise.allSettled([
    dispatchLocalWorklogs(env,now),
    ...(env.WORKLOG_SCHEDULER?[env.WORKLOG_SCHEDULER.runDue()]:[])
  ]);
  const failed=results.filter(r=>r.status==='rejected').length;
  console.info('weekly-worklog-scheduler',JSON.stringify({environments:results.length,failed}));
  if(failed)throw new Error(`Weekly worklog scheduler failed in ${failed} environments`);
}
