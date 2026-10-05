import assert from 'node:assert/strict';
import test from 'node:test';
import { readReportDriveBytes, reuseReportTranscription } from '../apps/cloudflare/src/report-source';

test('report transcription reuse is bounded, scoped, expiring and success-only', async () => {
  const scope = {}; let calls = 0; let time = 100;
  const read = async () => `원문 ${++calls}`;
  const now = () => time;
  assert.equal(await reuseReportTranscription(scope,'case/file/hash/model/policy',read,now),'원문 1');
  assert.equal(await reuseReportTranscription(scope,'case/file/hash/model/policy',read,now),'원문 1');
  assert.equal(await reuseReportTranscription({},'case/file/hash/model/policy',read,now),'원문 2');
  for (const key of ['other-case/file/hash/model/policy','case/file/new-hash/model/policy','case/file/hash/new-model/policy','case/file/hash/model/new-policy']) await reuseReportTranscription(scope,key,read,now);
  assert.equal(calls,6);
  time += 600_001;
  await reuseReportTranscription(scope,'case/file/hash/model/policy',read,now);
  assert.equal(calls,7);
  await assert.rejects(reuseReportTranscription(scope,'partial',async () => { throw new Error('partial'); },now),/partial/);
  assert.equal(await reuseReportTranscription(scope,'partial',read,now),'원문 8');
  const fresh = {};
  for(let i=0;i<33;i++) await reuseReportTranscription(fresh,String(i),read,now);
  await reuseReportTranscription(fresh,'0',read,now);
  assert.equal(calls,42,'oldest entry must be evicted at 32 entries');
});

test('report Drive deadline covers token, headers and body; requests are cancelled', {timeout:5_000}, async () => {
  for(const phase of ['token','headers','body'] as const) {
    let signal: AbortSignal | null | undefined; let cancelled = false;
    const started = Date.now();
    await assert.rejects(readReportDriveBytes(async (_input,init) => {
      signal = init?.signal;
      if(phase !== 'body') return new Promise<Response>((_resolve,reject) => signal!.addEventListener('abort',() => reject(new Error('aborted')),{once:true}));
      return new Response(new ReadableStream<Uint8Array>({cancel(){cancelled=true;}}));
    },async (bounded) => { if(phase==='token') await bounded('https://oauth2.googleapis.com/token',{method:'POST'}); return 'synthetic-token'; },'synthetic-file',4,Date.now()+50), /한도|aborted|timed out/);
    assert.equal(signal?.aborted,true);
    if(phase==='body') assert.equal(cancelled,true);
    assert.ok(Date.now()-started<1_000,`${phase} must terminate within the shared deadline`);
  }
});

test('report Drive verifies exact byte size without writing remote data', async () => {
  let calls=0;
  const read = async (size:number) => readReportDriveBytes(async (input,init) => {
    calls++; assert.match(String(input),/alt=media/); assert.ok(!init?.method || init.method==='GET');
    return new Response(new Uint8Array([1,2,3,4]));
  },async()=> 'synthetic-token','synthetic-file',size,Date.now()+1_000);
  assert.deepEqual(await read(4),new Uint8Array([1,2,3,4]));
  await assert.rejects(read(3),/크기/); await assert.rejects(read(5),/크기/);
  assert.equal(calls,3);
});
