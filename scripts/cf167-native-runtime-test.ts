import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {chromium} from 'playwright-core';

test('native runtime executes verified bytes, shares initialization and recovers after failure',async t=>{
  const {createServer}=await import('../apps/web/qa/vite-server.js');
  const server=await createServer({root:resolve('apps/web'),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});
  await server.listen();
  const origin='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port;
  const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>p&&existsSync(p));
  const pkg=resolve(process.env.CF148_ENGINE_DIR||'pinned-runtime/pkg');
  const wasm=readFileSync(resolve(pkg,'rhwp_bg.wasm')),binding=readFileSync(resolve(pkg,'rhwp.js'));
  const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
  const manifest={wasm:sha(wasm),files:[{path:'assets/rhwp_bg-test.wasm',sha256:sha(wasm)},{path:'native/rhwp-ad01e939079e.js',sha256:sha(binding)}]};
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    for(const name of ['verified-bytes','manifest-http-retry','manifest-version-retry','binding-hash-retry','binding-path-retry','wasm-path-retry'])await t.test(name,async()=>{
    const page=await browser.newPage();let bindingReads=0,wasmReads=0,manifestReads=0;
    const externalRequests:string[]=[];
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());if(url.origin!==origin){externalRequests.push(url.href);return route.abort();}
      if(url.pathname==='/runtime-qa.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'});
      if(url.pathname==='/rhwp/build-manifest.json'){
        manifestReads++;
        if(manifestReads===1&&name==='manifest-http-retry')return route.fulfill({status:503,body:'Synthetic unavailable'});
        if(manifestReads===1&&name==='manifest-version-retry')return route.fulfill({json:{...manifest,wasm:'0'.repeat(64)}});
        if(manifestReads===1&&(name==='binding-path-retry'||name==='wasm-path-retry')){
          return route.fulfill({json:{...manifest,files:manifest.files.map((file,index)=>index===(name==='binding-path-retry'?1:0)?{...file,path:'https://external.invalid/'+file.path}:file)}});
        }
        return route.fulfill({json:manifest});
      }
      if(url.pathname==='/rhwp/assets/rhwp_bg-test.wasm'){wasmReads++;return route.fulfill({body:wasm,contentType:'application/wasm'});}
      if(url.pathname==='/rhwp/native/rhwp-ad01e939079e.js'){
        bindingReads++;
        const unverified='globalThis.unverifiedBindingExecuted=true;throw Error("Unverified binding executed");';
        return route.fulfill({contentType:'text/javascript',headers:{'Cache-Control':'no-store'},body:name==='binding-hash-retry'?(bindingReads===1?unverified:binding):(bindingReads===1?binding:unverified)});
      }
      return route.continue();
    });
    await page.goto(origin+'/runtime-qa.html');
    if(name!=='verified-bytes'){
      const failure=await page.evaluate(async()=>{
        const {loadNativeHwpEngine}=await import('/src/documents/native-hwp-runtime.ts' as string);
        try{await loadNativeHwpEngine();return ''; }catch(error){return String(error);}
      });
      assert.match(failure,name==='manifest-http-retry'?/배포 정보를 읽지 못했습니다/u:name==='manifest-version-retry'?/승인된 HWP 변환 엔진 버전/u:name==='binding-hash-retry'?/무결성 검사에 실패/u:/아직 배포되지 않았습니다/u);
    }
    const outcome=await page.evaluate(async()=>{
      try{const {loadNativeHwpEngine}=await import('/src/documents/native-hwp-runtime.ts' as string);const [first,second]=await Promise.all([loadNativeHwpEngine(),loadNativeHwpEngine()]);return{loaded:typeof first==='function',shared:first===second,executed:Boolean((globalThis as any).unverifiedBindingExecuted)};}
      catch(error){return{loaded:false,shared:false,executed:Boolean((globalThis as any).unverifiedBindingExecuted),error:String(error)};}
    });
    assert.equal(outcome.executed,false,'A response not checked by SHA must never execute');
    assert.equal(outcome.loaded,true,JSON.stringify(outcome));
    assert.equal(outcome.shared,true,'Concurrent callers must share the initialized engine');
    assert.equal(await page.evaluate(async()=>{
      const {loadNativeHwpEngine}=await import('/src/documents/native-hwp-runtime.ts' as string);
      return await loadNativeHwpEngine()===await loadNativeHwpEngine();
    }),true,'Successful initialization remains cached');
    assert.equal(manifestReads,name==='verified-bytes'?1:2,'Retry must discard a failed pending promise, not a successful cache');
    assert.equal(bindingReads,name==='binding-hash-retry'?2:1,'Import must not make another GET for verified binding');
    assert.equal(wasmReads,name==='binding-hash-retry'?2:1,'Concurrent initialization must download WASM once');
    assert.deepEqual(externalRequests,[],'Manifest paths outside the approved /rhwp/ file patterns must be rejected before fetching');
    await page.close();
    });
  }finally{await browser.close();await server.close();}
});
