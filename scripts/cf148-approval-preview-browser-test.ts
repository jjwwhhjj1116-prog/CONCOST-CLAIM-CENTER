import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('Approval reads the submitted version and blocks approval on failed or stale previews',async()=>{
  const {createServer}=await import('../apps/web/qa/vite-server.js');
  const baseStyles=readFileSync('apps/web/index.html','utf8').match(/<style[^>]*>[\s\S]*?<\/style>/gu)?.join('')??'';
  const server=await createServer({root:resolve('apps/web'),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{
    name:'approval-preview-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
      if(!req.url?.startsWith('/approval-test.html'))return next();res.setHeader('Content-Type','text/html');
      res.end(await server.transformIndexHtml(req.url,'<html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1">'+baseStyles+'<body><div id="root"></div><script type="module" src="/approval-entry.js"></script></body></html>'));
    });},resolveId:id=>id==='/approval-entry.js'?'\0approval-entry':undefined,
    load:id=>id==='\0approval-entry'?`import React from 'react';import{createRoot}from'react-dom/client';import{PreviewApprovalInbox}from'/src/routes/PreviewApprovalInbox.tsx';import '/src/preview-theme.css';import '/src/theme-system.css';createRoot(document.getElementById('root')).render(React.createElement(PreviewApprovalInbox,{roles:['director'],onNavigate:()=>{}}));`:undefined
  }]});await server.listen();
  const origin='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port;
  const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>p&&existsSync(p));assert.ok(executablePath);
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage();page.setDefaultTimeout(8000);
    let fail=true;let wrong=false;let decisionCount=0;let hold:Promise<void>|null=null;let release=()=>{};
    let imageAttempt=0, imageFailure=false, canDecide=true;
    let imageGate:Promise<void>|null=null, releaseImage=()=>{}, imageRequested=()=>{};
    const review=(id:string)=>({id,caseId:'case-'+id,caseNumber:'CC-'+id,caseTitle:'사건 '+id,reportRevisionId:'revision-'+id,reportVersion:1,reportTitle:'제출 보고서 '+id,status:'PENDING',requestedBy:{id:'author',name:'작성자'},requestedAt:'2026-09-28T00:00:00Z',canDecide});
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/fixture-photo.png'){
        imageRequested();if(imageGate)await imageGate;
        if(imageFailure)return route.abort();
        return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5SAAAAAASUVORK5CYII=','base64')});
      }
      if(!url.pathname.startsWith('/api/'))return url.origin===origin?route.continue():route.abort();
      const send=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
      if(url.pathname==='/api/report-reviews')return send({reviews:[review('a'),review('b')]});
      if(url.pathname.endsWith('/decision')){decisionCount++;return send({reviews:[]});}
      const id=url.pathname.split('/')[3];if(id==='a'&&hold)await hold;
      if(fail)return send({error:'합성 본문 조회 실패'},503);
      return send({document:{reviewId:id,revisionId:wrong?'wrong':'revision-'+id,version:1,caseNumber:'CC-'+id,caseTitle:'제출 사건',title:'제출 제목 '+id,content:'제출 당시 본문 '+id,editorJson:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'제출 당시 본문 '+id}]},{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',content:[{type:'paragraph',content:[{type:'text',text:'검토 금액 123,456'}]}]}]}]},{type:'image',attrs:{src:imageAttempt?'/fixture-photo.png?attempt='+imageAttempt:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5SAAAAAASUVORK5CYII=',alt:'제출 사진'}}]}}});
    });
    await page.goto(origin+'/approval-test.html');
    const approve=page.getByRole('button',{name:'이 버전 승인 · 최종 결재 후 PM 납품 알림',exact:true});
    await approve.first().waitFor();assert.equal(await approve.first().isEnabled(),false);
    const open=page.getByRole('button',{name:'제출 본문·표·사진 보기 · v1',exact:true});
    await open.first().click();await page.getByRole('alert').waitFor();assert.equal(await approve.first().isEnabled(),false);
    fail=false;wrong=true;await page.getByRole('button',{name:'제출 본문 다시 조회',exact:true}).click();await page.getByText('제출 버전이 일치하지 않습니다. 다시 조회해 주세요.',{exact:false}).waitFor();
    wrong=false;await page.getByRole('button',{name:'제출 본문 다시 조회',exact:true}).click();
    await page.getByText('제출 당시 본문 a',{exact:true}).last().waitFor();
    await page.getByRole('checkbox',{name:'제출된 이 버전의 본문·표·사진을 확인했습니다.'}).check();assert.equal(await approve.first().isEnabled(),true);assert.equal(await approve.last().isEnabled(),false);
    hold=new Promise<void>(resolve=>{release=resolve;});await open.first().click();await open.last().click();
    await page.getByText('제출 당시 본문 b',{exact:true}).last().waitFor();release();hold=null;
    await page.waitForTimeout(100);assert.equal(await page.getByText('제출 당시 본문 a',{exact:true}).count(),0);
    assert.equal(await approve.first().isEnabled(),false);assert.equal(await approve.last().isEnabled(),false);assert.equal(decisionCount,0);
    const confirmed=page.getByRole('checkbox',{name:'제출된 이 버전의 본문·표·사진을 확인했습니다.'});
    imageAttempt++;imageGate=new Promise<void>(resolve=>{releaseImage=resolve;});
    const requested=new Promise<void>(resolve=>{imageRequested=resolve;});
    await open.first().click();await requested;await confirmed.waitFor();
    assert.equal(await confirmed.isEnabled(),false,'Loading photos must not be confirmable');
    assert.equal(await approve.first().isEnabled(),false);
    releaseImage();imageGate=null;
    await page.waitForFunction(()=>!!document.querySelector('input[type="checkbox"]:not(:disabled)'));
    await confirmed.check();assert.equal(await approve.first().isEnabled(),true);
    await page.locator('[data-export-page]').first().evaluate(element=>element.setAttribute('data-page-fit-overflow','true'));
    await page.waitForFunction(()=>!!document.querySelector('input[type="checkbox"]:disabled'));
    assert.equal(await confirmed.isChecked(),false,'Detected page overflow must clear earlier confirmation');
    assert.equal(await approve.first().isEnabled(),false);
    await page.locator('[data-export-page]').first().evaluate(element=>element.setAttribute('data-page-fit-overflow','false'));
    await page.waitForFunction(()=>!!document.querySelector('input[type="checkbox"]:not(:disabled)'));
    assert.equal(await confirmed.isChecked(),false,'Recovering layout must require confirmation again');
    await confirmed.check();assert.equal(await approve.first().isEnabled(),true);
    imageAttempt++;imageFailure=true;await open.first().click();
    await page.getByText('사진을 불러오지 못했습니다.',{exact:false}).waitFor();
    assert.equal(await approve.first().isEnabled(),false);assert.equal(await confirmed.count(),0);
    imageAttempt++;imageFailure=false;await page.getByRole('button',{name:'제출 본문 다시 조회',exact:true}).click();
    await page.waitForFunction(()=>!!document.querySelector('input[type="checkbox"]:not(:disabled)'));
    await confirmed.check();assert.equal(await approve.first().isEnabled(),true);
    await page.getByRole('button',{name:'새로고침',exact:true}).click();await approve.first().waitFor();
    assert.equal(await confirmed.count(),0,'Refresh must discard an earlier confirmation and detached preview');
    assert.equal(await approve.first().isEnabled(),false);
    await open.first().click();await page.waitForFunction(()=>!!document.querySelector('input[type="checkbox"]:not(:disabled)'));
    await confirmed.check();assert.equal(await approve.first().isEnabled(),true);
    await page.getByLabel('승인 상태').selectOption('ALL');
    assert.equal(await confirmed.count(),0,'Changing filters must require reopening and reconfirming the revision');
    assert.equal(await approve.first().isEnabled(),false);
    imageAttempt++;imageGate=new Promise<void>(resolve=>{releaseImage=resolve;});
    await open.first().click();
    await page.getByText('사진 로딩 또는 페이지 배치를 확인하지 못했습니다.',{exact:false}).waitFor({timeout:20_000});
    assert.equal(await approve.first().isEnabled(),false);assert.equal(await confirmed.count(),0);
    releaseImage();imageGate=null;
    imageAttempt++;await page.getByRole('button',{name:'제출 본문 다시 조회',exact:true}).click();
    await page.waitForFunction(()=>!!document.querySelector('input[type="checkbox"]:not(:disabled)'));
    await confirmed.check();assert.equal(await approve.first().isEnabled(),true);
    canDecide=false;await page.getByRole('button',{name:'새로고침',exact:true}).click();
    await open.first().click();await confirmed.waitFor();
    assert.equal(await confirmed.isEnabled(),false,'The saved author cannot confirm another requester\'s review');
    assert.equal(await approve.first().isEnabled(),false);
    await page.getByLabel('검토 의견').first().fill('작성자 수정 요청 시도');
    assert.equal(await page.getByRole('button',{name:'수정 요청',exact:true}).first().isEnabled(),false);
    assert.equal(decisionCount,0);
    mkdirSync('output/cf148',{recursive:true});
    await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'output/cf148/approval-preview-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/cf148/approval-preview-mobile.png',fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,JSON.stringify(await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).filter(el=>el.getBoundingClientRect().right>innerWidth+1).slice(0,10).map(el=>({tag:el.tagName,cls:el.className,width:el.getBoundingClientRect().width})))));
  }finally{await browser.close();await server.close();}
});
