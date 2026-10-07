import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createNativeHwp } from '../apps/web/src/documents/editable-hwp-export';
import { readQaNativeEngine } from './cf183-template-source-gate.mjs';

test('CF190 real SDK report dialog confirms numeral refresh once, cancels safely and excludes proposal dialogs',async()=>{
  const approved=readQaNativeEngine(), module=await import(pathToFileURL(resolve(approved.root,'rhwp.js')).href);await module.default({module_or_path:approved.wasm});const Engine=module.HwpDocument;
  const pages=['<p>목 차</p><p>Ⅰ. 자료 목록 ........ <strong>9</strong> </p><p>본문에서 없는 자료 ........ 8</p>','<table><tr><td><p>Ⅰ.</p></td><td><p>자료 목록</p></td></tr></table><p>확정 금액 123,456원 · 보존 본문</p>'].map((html,index)=>({html,text:html.replace(/<[^>]*>/gu,''),tables:index===1?1:0,tableCells:index===1?[[{row:0,col:0,rowSpan:1,colSpan:1,text:'Ⅰ.'},{row:0,col:1,rowSpan:1,colSpan:1,text:'자료 목록'}]]:[],images:0,width:794,height:1123,margins:{top:40,right:40,bottom:40,left:40}}));
  const doc=new Engine(createNativeHwp(pages,Engine));let bytes:Uint8Array;
  try{assert.equal(JSON.parse(doc.insertNewNumber(1,1,doc.getParagraphLength(1,1),23)).ok,true);bytes=doc.exportHwp();}finally{doc.free();}
  let legacy:Uint8Array|undefined,legacyPages:number|undefined,legacyHash:string|undefined;
  if(process.env.CF192_HWP3_GIT_DIR&&process.env.CF192_HWP3_OBJECT){const result=spawnSync('git',['--git-dir='+process.env.CF192_HWP3_GIT_DIR,'show',process.env.CF192_HWP3_OBJECT],{windowsHide:true,maxBuffer:5_000_000});assert.equal(result.status,0,'Local legacy fixture object is required');legacy=new Uint8Array(result.stdout);assert.equal(new TextDecoder().decode(legacy.slice(0,17)),'HWP Document File');legacyHash=createHash('sha256').update(legacy).digest('hex');const source=new Engine(legacy);try{assert.equal(source.getSourceFormat(),'hwp');const count=source.pageCount();assert.ok(Number.isSafeInteger(count)&&count>0);legacyPages=count;}finally{source.free();}}
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
      if(pathname==='/legacy.hwp'&&legacy){res.end(legacy);return;}
      if(pathname!=='/toc-qa.html')return next();
      res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url!,'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/toc-qa-entry.js"></script></body></html>'));
    });},
    resolveId:id=>id==='/toc-qa-entry.js'?'\0toc-qa-entry':undefined,
    load:id=>id==='\0toc-qa-entry'?`
      import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{RhwpEditorDialog}from'/src/documents/RhwpEditorDialog.tsx';import'/src/documents/RhwpEditorDialog.css';
      window.__CLAIM_CENTER_RHWP_STUDIO_URL__=new URLSearchParams(location.search).has('initfail')?'data:text/html,<p>synthetic</p>':location.origin+'/rhwp/';window.cf190={applies:[],closeCount:0};
      function App(){const[file,setFile]=useState(null);const[open,setOpen]=useState(true);const[disabled,setDisabled]=useState(false);const[report,setReport]=useState(true);const[canApply,setCanApply]=useState(true);
        useEffect(()=>{const legacy=new URLSearchParams(location.search).has('legacy');fetch(legacy?'/legacy.hwp':'/original.hwp').then(r=>r.arrayBuffer()).then(b=>setFile(new File([b],legacy?'구형 한글 검수.hwp':'합성 목차.hwp')));},[]);
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
    const readyButton=()=>{const button=document.querySelector<HTMLButtonElement>('.rhwp-action-hwp');return Boolean(button&&!button.disabled);};
    await page.waitForFunction(readyButton);
    const inputHash=createHash('sha256').update(bytes).digest('hex');
    let manifestAttempts=0;
    await page.route(origin+'/rhwp/build-manifest.json',async route=>{if(++manifestAttempts===1)await route.fulfill({status:503,body:'Synthetic manifest unavailable'});else await route.continue();});
    await page.getByLabel('목차가 있는 물리 쪽',{exact:false}).fill('1');
    await page.getByRole('button',{name:'목차 번호 확인',exact:true}).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('.rhwp-dialog__status').innerText(),'');assert.equal(await page.locator('.rhwp-dialog__status i').count(),0);
    assert.equal(await page.locator('.rhwp-dialog__editor').evaluate(el=>(el as HTMLElement).inert),false);assert.equal(await page.locator('.rhwp-dialog__toc-result').count(),0);
    assert.equal(await page.getByRole('button',{name:'HWP/HWPX 가져오기',exact:true}).isDisabled(),false);assert.equal(await page.evaluate(()=>(window as any).cf190.applies.length),0);
    await page.getByRole('button',{name:'목차 번호 확인',exact:true}).click();
    const choices=page.getByRole('group',{name:'갱신할 목차 항목 선택',exact:true});await choices.waitFor();assert.match(await choices.innerText(),/9 → 23/u);
    assert.equal(manifestAttempts,2);assert.equal(createHash('sha256').update(bytes).digest('hex'),inputHash);
    assert.equal(await page.locator('.rhwp-dialog__editor').evaluate(el=>(el as HTMLElement).inert),true);
    assert.equal(await page.getByRole('button',{name:'HWP/HWPX 가져오기',exact:true}).isDisabled(),true);
    const apply=page.getByRole('button',{name:'선택 숫자 갱신·보고서 적용',exact:true});assert.equal(await apply.isDisabled(),true);
    await page.getByRole('button',{name:'취소·원형 편집 계속',exact:true}).click();assert.equal(await page.evaluate(()=>(window as any).cf190.applies.length),0);
    assert.equal(await page.locator('.rhwp-dialog__editor').evaluate(el=>(el as HTMLElement).inert),false);
    await page.getByRole('button',{name:'목차 번호 확인',exact:true}).click();await choices.waitFor();
    await choices.getByRole('checkbox').check();assert.equal(await apply.isDisabled(),true);
    await page.getByRole('checkbox',{name:/본문에 인쇄된 쪽번호/u}).check();assert.equal(await apply.isDisabled(),false);
    const excluded=page.locator('.rhwp-dialog__toc-excluded');await excluded.locator('summary').click();assert.match(await excluded.innerText(),/지원 범위에서 정확히 일치하는 본문 제목/u);assert.match(await excluded.innerText(),/원본 물리 1쪽/u);
    assert.match(await page.locator('.rhwp-dialog__toc-result').innerText(),/쪽번호 있는 행 2개/u);
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:1000});
      const metrics=await page.locator('.rhwp-dialog__toc').evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,buttons:[...el.querySelectorAll('button')].map(button=>button.getBoundingClientRect().height)}));
      assert.ok(metrics.scrollWidth<=metrics.width+1);assert.ok(metrics.buttons.every(height=>height>=44));
      if(process.env.CF190_OUTPUT_ROOT)await page.screenshot({path:resolve(process.env.CF190_OUTPUT_ROOT,`native-toc-${width}.png`)});
    }
    // Two synchronous attempts use the same actual React control; only one callback is allowed.
    await apply.evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});await page.getByRole('dialog').waitFor({state:'hidden'});
    const applied=await page.evaluate(()=>(window as any).cf190.applies);assert.equal(applied.length,1);assert.equal(applied[0].original,'합성 목차.hwp');assert.equal(applied[0].pages.length,2);
    const saved=new Engine(new Uint8Array(applied[0].bytes));try{assert.equal(saved.getTextRange(0,1,0,saved.getParagraphLength(0,1)),'Ⅰ. 자료 목록 ........ 23 ');assert.match(saved.getTextFileText(),/123,456원/u);const table=JSON.parse(saved.getCursorModel()).lists.find((list:any)=>list.isCell&&list.sectionIndex===1&&list.hostPara===0);assert.ok(table);assert.equal(JSON.parse(saved.getTableDimensions(1,0,table.controlIndex)).cellCount,2);for(let p=0;p<2;p++)assert.equal(saved.renderPageSvgWithProfile(p,'print'),applied[0].pages[p]);}finally{saved.free();}
    const prepare=async()=>{
      await page.waitForFunction(readyButton);
      await page.getByLabel('목차가 있는 물리 쪽',{exact:false}).fill('1');await page.getByRole('button',{name:'목차 번호 확인',exact:true}).click();await choices.waitFor();await choices.getByRole('checkbox').check();await page.getByRole('checkbox',{name:/본문에 인쇄된 쪽번호/u}).check();
    };
    await page.evaluate(()=>(window as any).cf190.setOpen(true));await prepare();
    await apply.evaluate(button=>{(button as HTMLButtonElement).click();(window as any).cf190.swap();});
    await page.locator('.rhwp-dialog__header').getByText(/교체 원본.hwp/u).waitFor();await page.waitForFunction(readyButton);
    assert.equal(await page.evaluate(()=>(window as any).cf190.applies.length),1,'Late old-source candidates cannot apply');assert.equal(await choices.count(),0);
    await prepare();await apply.evaluate(button=>{(button as HTMLButtonElement).click();(window as any).cf190.setCanApply(false);});
    await page.getByRole('alert').filter({hasText:/저장 권한/u}).waitFor();assert.equal(await page.evaluate(()=>(window as any).cf190.applies.length),1,'Removing apply callback revokes pending permission');
    assert.equal(await page.locator('.rhwp-dialog__status').innerText(),'');
    await page.evaluate(()=>{(window as any).cf190.setCanApply(true);(window as any).cf190.setReport(false);});assert.equal(await page.getByText('원형 목차 쪽번호 갱신',{exact:true}).count(),0);
    await page.evaluate(()=>(window as any).cf190.setReport(true));
    await page.getByRole('button',{name:'취소·원형 편집 계속',exact:true}).click();await prepare();
    await page.evaluate(()=>(window as any).cf190.failApply=true);await apply.click();
    await page.getByRole('alert').filter({hasText:/파일 적용은 이미 시작/u}).waitFor();assert.equal(await page.evaluate(()=>(window as any).cf190.applies.length),2);
    assert.equal(await page.locator('.rhwp-dialog__status').innerText(),'');
    assert.equal(await apply.isDisabled(),true);assert.equal(await page.getByRole('button',{name:'취소·원형 편집 계속',exact:true}).count(),0);
    await apply.evaluate(button=>(button as HTMLButtonElement).click());assert.equal(await page.evaluate(()=>(window as any).cf190.applies.length),2,'A rejected handoff cannot upload the same candidate again');
    await page.getByRole('button',{name:'닫고 보고서 저장 상태 확인',exact:true}).click();await page.getByRole('button',{name:'닫고 저장 상태 확인',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
    await page.evaluate(()=>{(window as any).cf190.setReport(false);(window as any).cf190.setOpen(true);});await page.getByRole('dialog').waitFor();assert.equal(await page.getByText('원형 목차 쪽번호 갱신',{exact:true}).count(),0);
    const recovery=await browser.newPage({viewport:{width:1440,height:1000}});recovery.setDefaultTimeout(30000);recovery.on('pageerror',error=>errors.push(error.message));
    await recovery.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await recovery.goto(origin+'/toc-qa.html?initfail');await recovery.getByRole('alert').waitFor();
    assert.match(await recovery.getByRole('alert').innerText(),/닫은 뒤 다시 열어/u);assert.equal(await recovery.locator('.rhwp-dialog__status').innerText(),'');
    for(const action of ['.rhwp-action-import','.rhwp-action-hwp','.rhwp-action-hwpx','.rhwp-action-apply'])assert.equal(await recovery.locator(action).isDisabled(),true);
    assert.equal(await recovery.getByRole('button',{name:'HWP 편집기 닫기',exact:true}).isDisabled(),false);
    for(const width of [1440,390]){await recovery.setViewportSize({width,height:1000});assert.ok(await recovery.locator('.rhwp-dialog__error').evaluate(el=>el.scrollWidth<=el.clientWidth+1));if(process.env.CF190_OUTPUT_ROOT)await recovery.screenshot({path:resolve(process.env.CF190_OUTPUT_ROOT,`native-init-error-${width}.png`)});}
    await recovery.getByRole('button',{name:'HWP 편집기 닫기',exact:true}).click();await recovery.getByRole('button',{name:'저장하지 않고 닫기',exact:true}).click();await recovery.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await recovery.locator('iframe').count(),0);
    await recovery.evaluate(()=>{(window as any).__CLAIM_CENTER_RHWP_STUDIO_URL__=location.origin+'/rhwp/';(window as any).cf190.setOpen(true);});
    await recovery.waitForFunction(readyButton);
    await recovery.locator('input[type=file]').setInputFiles({name:'깨진.hwp',mimeType:'application/x-hwp',buffer:Buffer.from([0,1,2,3])});await recovery.getByRole('alert').waitFor();
    assert.equal(await recovery.locator('.rhwp-dialog__status').innerText(),'');assert.equal(await recovery.locator('.rhwp-dialog__editor').evaluate(el=>(el as HTMLElement).inert),false);
    assert.equal(await recovery.locator('.rhwp-action-import').isDisabled(),false);assert.equal(await recovery.locator('.rhwp-action-hwp').isDisabled(),true);assert.equal(await recovery.locator('.rhwp-action-apply').isDisabled(),true);
    assert.equal(await recovery.locator('input[type=file]').inputValue(),'');assert.equal(await recovery.locator('.rhwp-dialog__toc-result').count(),0);assert.equal(await recovery.evaluate(()=>(window as any).cf190.applies.length),0);
    await recovery.locator('input[type=file]').setInputFiles({name:'정상 복구.hwp',mimeType:'application/x-hwp',buffer:Buffer.from(bytes)});await recovery.waitForFunction(readyButton);assert.equal(await recovery.getByRole('alert').count(),0);
    await recovery.getByLabel('목차가 있는 물리 쪽',{exact:false}).fill('1');await recovery.getByRole('button',{name:'목차 번호 확인',exact:true}).click();await recovery.getByRole('group',{name:'갱신할 목차 항목 선택',exact:true}).waitFor();
    assert.match(await recovery.getByRole('group',{name:'갱신할 목차 항목 선택',exact:true}).innerText(),/9 → 23/u);assert.equal(await recovery.evaluate(()=>(window as any).cf190.applies.length),0);assert.equal(createHash('sha256').update(bytes).digest('hex'),inputHash);
    await recovery.close();
    if(legacy){const legacyPage=await browser.newPage();legacyPage.setDefaultTimeout(30000);legacyPage.on('pageerror',error=>errors.push(error.message));await legacyPage.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await legacyPage.goto(origin+'/toc-qa.html?legacy');await legacyPage.waitForFunction(readyButton);assert.match(await legacyPage.locator('.rhwp-dialog__header').innerText(),new RegExp(`${legacyPages}페이지`,'u'));assert.equal(await legacyPage.getByRole('alert').count(),0);assert.equal(await legacyPage.evaluate(()=>(window as any).cf190.applies.length),0);assert.equal(createHash('sha256').update(legacy).digest('hex'),legacyHash);await legacyPage.close();console.log('CF192 upstream legacy HWP3 imports through the actual SDK; no apply/export');}
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await server.close();}
});
