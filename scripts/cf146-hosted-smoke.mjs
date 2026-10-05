// Read-only deployment proof; never sends documents, credentials, or API writes.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const origin=process.argv[2] || 'https://concost-claim-center-development.jjwwhhjj1116.workers.dev';
assert.ok(origin==='https://concost-claim-center-development.jjwwhhjj1116.workers.dev' || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
const repo=new URL('../',import.meta.url),dist=new URL('apps/web/dist/',repo);
const sha=b=>createHash('sha256').update(b).digest('hex');
const request=async path=>{
  let response=await fetch(origin+path,{redirect:'manual',signal:AbortSignal.timeout(30000)});
  // Cloudflare canonicalizes HTML asset URLs. Accept only that exact same-origin redirect.
  if([301,302,307,308].includes(response.status)){
    assert.ok(path.endsWith('.html'),`Unexpected redirect: ${path}`);
    const destination=new URL(response.headers.get('location'),origin);
    const canonical=path.endsWith('/index.html')?path.slice(0,-10):path.slice(0,-5);
    assert.equal(destination.href,origin+canonical);
    response=await fetch(destination,{redirect:'error',signal:AbortSignal.timeout(30000)});
  }
  assert.equal(response.status,200,path);
  return Buffer.from(await response.arrayBuffer());
};
const manifest=JSON.parse(readFileSync(new URL('rhwp/build-manifest.json',dist),'utf8'));
assert.equal(sha(await request('/rhwp/build-manifest.json')),sha(readFileSync(new URL('rhwp/build-manifest.json',dist))));
const files=[];
for(const file of manifest.files){
  assert.ok(!file.path.includes('..') && !file.path.startsWith('/'));
  const bytes=await request('/rhwp/'+file.path);
  assert.equal(sha(bytes),file.sha256,file.path);
  if(file.path.endsWith('.woff2'))assert.equal(bytes.subarray(0,4).toString(),'wOF2');
  files.push(file.path);
}
const runtime=(await request('/runtime-config.js')).toString();
assert.ok(runtime.includes('new URL("/rhwp/", window.location.origin).href'));
const html=(await request('/rhwp/')).toString();
assert.ok(html.includes('/rhwp/assets/') && !html.includes('registerSW.js'));
const print=(await request('/rhwp/print.html')).toString();
assert.ok(print.includes('print-loading-message'));
const result={passed:true,origin,wasm:manifest.wasm,verifiedFiles:files.length,fonts:files.filter(f=>f.endsWith('.woff2')).length,printPage:true,sameOriginRuntime:true,scope:'Public runtime assets only; no authenticated save or HWP visual fidelity claim'};
mkdirSync(new URL('output/cf146/',repo),{recursive:true});
writeFileSync(new URL('output/cf146/hosted-smoke.json',repo),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
