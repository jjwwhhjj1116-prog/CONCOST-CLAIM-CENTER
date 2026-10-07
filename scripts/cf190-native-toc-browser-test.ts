import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createNativeHwp } from '../apps/web/src/documents/editable-hwp-export';
import { readQaNativeEngine } from './cf183-template-source-gate.mjs';

test('CF190 real SDK report dialog confirms numeral refresh once, cancels safely and excludes proposal dialogs',async()=>{
  const approved=readQaNativeEngine(), module=await import(pathToFileURL(resolve(approved.root,'rhwp.js')).href);await module.default({module_or_path:approved.wasm});const Engine=module.HwpDocument;
  const pages=['<p>목 차</p><p>자료 목록 ........ <strong>9</strong></p>','<p>자료 목록</p><p>확정 금액 123,456원 · 보존 본문</p>'].map(html=>({html,text:html.replace(/<[^>]*>/gu,''),tables:0,images:0,width:794,height:1123,margins:{top:40,right:40,bottom:40,left:40}}));
  const doc=new Engine(createNativeHwp(pages,Engine));let bytes:Uint8Array;
  try{assert.equal(JSON.parse(doc.insertNewNumber(1,0,doc.getParagraphLength(1,0),23)).ok,true);bytes=doc.exportHwp();}finally{doc.free();}
  const runtime=resolve('pinned-runtime/rhwp'), manifest=JSON.parse(readFileSync(resolve(runtime,'build-manifest.json'),'utf8'));
  const files=new Set(['index.html','build-manifest.json',...manifest.files.map((file:{path:string})=>file.path)]);
  const {createServer}=await import('../apps/web/qa/vite-server.js');
  const server=await createServer({root:resolve('apps/web'),...(process.env.CF149_CACHE_ROOT?{cacheDir:process.env.CF149_CACHE_ROOT}:{}),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{
    name:'cf190-report-native-dialog',
    configureServer(server){server.middlewares.use(async(req,res,next)=>{
      const pathname=(req.url??'').split('?')[0];
      if(pathname.startsWith('/rhwp/')){
        const name=pathname.slice('/rhwp/'.length)||'index.html';
        if(!files.has(name)){res.statusCode=404;res.end();return;}
        const path=resolve(runtime,name);assert.ok(path.startsWith(runtime+sep));
        res.setHeader('Content-Type',name.endsWith('.html')?'text/html':name.endsWith('.json')?'application/json':name.endsWith('.js')?'text/javascript':name.endsWith('.wasm')?'application/wasm':name.endsWith('.css')?'text/css':name.endsWith('.woff2')?'font/woff2':'application/octet-stream');
        res.end(readFileSync(path));return;
      }
      if(pathname==='/original.hwp'){res.end(bytes);return;}
      if(pathname!=='/toc-qa.html')return next();
      res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url!,'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/toc-qa-entry.js"></script></body></html>'));
    });},
    resolveId:id=>id==='/toc-qa-entry.js'?'\0toc-qa-entry':undefined,
    load:id=>id==='\0toc-qa-entry'?`
      import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{RhwpEditorDialog}from'/src/documents/RhwpEditorDialog.tsx';import'/src/documents/RhwpEditorDialog.css';
      window.__CLAIM_CENTER_RHWP_STUDIO_URL__=location.origin+'/rhwp/';window.cf190={applies:[],closeCount:0};
      function App(){const[file,setFile]=useState(null);const[open,setOpen]=useState(true);const[disabled,setDisabled]=useState(false);const[report,setReport]=useState(true);const[canApply,setCanApply]=useState(true);
        useEffect(()=>{fetch('/original.hwp').then(r=>r.arrayBuffer()).then(b=>setFile(new File([b],'합성 목차.hwp')));},[]);
        window.cf190.setOpen=setOpen;window.cf190.setDisabled=setDisabled;window.cf190.setReport=setReport;window.cf190.setCanApply=value=>flushSync(()=>setCanApply(value));window.cf190.swap=()=>flushSync(()=>setFile(new File([file],'교체 원본.hwp')));
        return file?React.createElement(RhwpEditorDialog,{isOpen:open,sourceFile:file,suggestedName:'합성 목차',documentLabel:'검수 보고서',preserveAppliedSource:report,applyDisabled:disabled,onClose:()=>{window.cf190.closeCount++;setOpen(false);},onApplyPages:canApply?async(pages,edited,original)=>{const binary=new Uint8Array(await edited.arrayBuffer());window.cf190.applies.push({pages,bytes:Array.from(binary),edited:edited.name,original:original.name});if(window.cf190.failApply)throw Error('합성 저장 ACK 실패');setOpen(false);}:undefined}):null;
      }createRoot(document.getElementById('root')).render(React.createElement(App));
    `:undefined
  }]});await server.listen();
  const origin='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port, executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);assert.ok(executablePath);
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await page.goto(origin+'/toc-qa.html');await page.getByRole('button',{name:'목차 번호 확인',exact:true}).waitFor();await page.getByRole('button',{name:'HWP 다운로드만',exact:true}).waitFor({state:'visible'});
    await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('.rhwp-action-hwp')?.disabled);
    await page.getByLabel('목차가 있는 물리 쪽',{exact:false}).fill('1');
    await page.getByRole('button',{name:'목차 번호 확인',exact:true}).click();
    const choices=page.getByRole('group',{name:'갱신할 목차 항목 선택',exact:true});await choices.waitFor();assert.match(await choices.innerText(),/9 → 23/u);
    assert.equal(await page.locator('.rhwp-dialog__editor').evaluate(el=>(el as HTMLElement).inert),true);
    assert.equal(await page.getByRole('button',{name:'HWP/HWPX 가져오기',exact:true}).isDisabled(),true);
    const apply=page.getByRole('button',{name:'선택 숫자 갱신·보고서 적용',exact:true});assert.equal(await apply.isDisabled(),true);
    await page.getByRole('button',{name:'취소·원형 편집 계속',exact:true}).click();assert.equal(await page.evaluate(()=>(window as any).cf190.applies.length),0);
    assert.equal(await page.locator('.rhwp-dialog__editor').evaluate(el=>(el as HTMLElement).inert),false);
    await page.getByRole('button',{name:'목차 번호 확인',exact:true}).click();await choices.waitFor();
    await choices.getByRole('checkbox').check();assert.equal(await apply.isDisabled(),true);
    await page.getByRole('checkbox',{name:/본문에 인쇄된 쪽번호/u}).check();assert.equal(await apply.isDisabled(),false);
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:1000});
      const metrics=await page.locator('.rhwp-dialog__toc').evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,buttons:[...el.querySelectorAll('button')].map(button=>button.getBoundingClientRect().height)}));
      assert.ok(metrics.scrollWidth<=metrics.width+1);assert.ok(metrics.buttons.every(height=>height>=44));
      if(process.env.CF190_OUTPUT_ROOT)await page.screenshot({path:resolve(process.env.CF190_OUTPUT_ROOT,`native-toc-${width}.png`)});
    }
    // Two synchronous attempts use the same actual React control; only one callback is allowed.
    await apply.evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});await page.getByRole('dialog').waitFor({state:'hidden'});
    const applied=await page.evaluate(()=>(window as any).cf190.applies);assert.equal(applied.length,1);assert.equal(applied[0].original,'합성 목차.hwp');assert.equal(applied[0].pages.length,2);
    const saved=new Engine(new Uint8Array(applied[0].bytes));try{assert.equal(saved.getTextRange(0,1,0,saved.getParagraphLength(0,1)),'자료 목록 ........ 23');assert.match(saved.getTextFileText(),/123,456원/u);for(let p=0;p<2;p++)assert.equal(saved.renderPageSvgWithProfile(p,'print'),applied[0].pages[p]);}finally{saved.free();}
    const prepare=async()=>{
      await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('.rhwp-action-hwp')?.disabled);
      await page.getByLabel('목차가 있는 물리 쪽',{exact:false}).fill('1');await page.getByRole('button',{name:'목차 번호 확인',exact:true}).click();await choices.waitFor();await choices.getByRole('checkbox').check();await page.getByRole('checkbox',{name:/본문에 인쇄된 쪽번호/u}).check();
    };
    await page.evaluate(()=>(window as any).cf190.setOpen(true));await prepare();
    await apply.evaluate(button=>{(button as HTMLButtonElement).click();(window as any).cf190.swap();});
    await page.locator('.rhwp-dialog__header').getByText(/교체 원본.hwp/u).waitFor();await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('.rhwp-action-hwp')?.disabled);
    assert.equal(await page.evaluate(()=>(window as any).cf190.applies.length),1,'Late old-source candidates cannot apply');assert.equal(await choices.count(),0);
    await prepare();await apply.evaluate(button=>{(button as HTMLButtonElement).click();(window as any).cf190.setCanApply(false);});
    await page.getByRole('alert').filter({hasText:/저장 권한/u}).waitFor();assert.equal(await page.evaluate(()=>(window as any).cf190.applies.length),1,'Removing apply callback revokes pending permission');
    await page.evaluate(()=>{(window as any).cf190.setCanApply(true);(window as any).cf190.setReport(false);});assert.equal(await page.getByText('원형 목차 쪽번호 갱신',{exact:true}).count(),0);
    await page.evaluate(()=>(window as any).cf190.setReport(true));
    await page.getByRole('button',{name:'취소·원형 편집 계속',exact:true}).click();await prepare();
    await page.evaluate(()=>(window as any).cf190.failApply=true);await apply.click();
    await page.getByRole('alert').filter({hasText:/파일 적용은 이미 시작/u}).waitFor();assert.equal(await page.evaluate(()=>(window as any).cf190.applies.length),2);
    assert.equal(await apply.isDisabled(),true);assert.equal(await page.getByRole('button',{name:'취소·원형 편집 계속',exact:true}).count(),0);
    await apply.evaluate(button=>(button as HTMLButtonElement).click());assert.equal(await page.evaluate(()=>(window as any).cf190.applies.length),2,'A rejected handoff cannot upload the same candidate again');
    await page.getByRole('button',{name:'닫고 보고서 저장 상태 확인',exact:true}).click();await page.getByRole('button',{name:'닫고 저장 상태 확인',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
    await page.evaluate(()=>{(window as any).cf190.setReport(false);(window as any).cf190.setOpen(true);});await page.getByRole('dialog').waitFor();assert.equal(await page.getByText('원형 목차 쪽번호 갱신',{exact:true}).count(),0);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await server.close();}
});
