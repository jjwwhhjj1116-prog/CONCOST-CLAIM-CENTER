import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

test('CF158 real reception component: cancel, duplicate, errors, authority and navigation', async () => {
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const server = await createServer({root:resolve('apps/web'),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{name:'reception-test',configureServer(s){s.middlewares.use(async(req,res,next)=>{
    if(req.url!=='/reception-test')return next();
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(await s.transformIndexHtml(req.url,`<html lang="ko"><meta charset="utf-8"><body><div id="root"></div><script>window.__CLAIM_API_ORIGIN__=location.origin;</script><script type="module" src="/reception-entry.js"></script></body></html>`));
  });},resolveId:id=>id==='/reception-entry.js'?'\0reception-entry':undefined,load:id=>id==='\0reception-entry'?`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {ProposalAwardWorkflow} from '/src/workflow/ProposalAwardWorkflow.tsx';
    const root=createRoot(document.getElementById('root'));window.paths=[];
    window.renderTest=(roles=['admin'],routeId='WF-02')=>root.render(React.createElement(ProposalAwardWorkflow,{roles,routeId,onNavigate:p=>window.paths.push(p)}));
    window.unmountTest=()=>root.unmount();window.renderTest();`:undefined}]});
  await server.listen();
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try {
    const page=await browser.newPage();page.setDefaultTimeout(8000);const errors:string[]=[];let native=0;
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{native++;void d.dismiss();});
    const posts:{body:any;key:string|undefined}[]=[];let fail=false;
    const queries:string[]=[];let routeChecks=false;
    let heldGet:(()=>Promise<void>)|undefined;let holdGet=false;
    let heldPost:(()=>Promise<void>)|undefined;let holdPost=false;
    let getStarted:()=>void=()=>{};let postStarted:()=>void=()=>{};
    const row={proposalId:'qa-proposal',caseId:'qa-case',caseNumber:'QA-ONLY',caseTitle:'합성 시험',caseStatus:'INQUIRY',caseVersion:7,proposalTitle:'합성 제안서',proposalVersion:3,versionNumber:1,clientName:'내부 시험',confirmedAt:'2026-10-01T00:00:00Z',proposalNumber:'QA-P',revisionLabel:'v1',receptionStatus:'READY'};
    await page.route('**/api/proposal-workflow/receptions*',async route=>{
      if(route.request().method()==='POST'){
        posts.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']});
        if(holdPost){holdPost=false;await new Promise<void>(resolve=>{heldPost=async()=>{await route.fulfill({json:{reception:{...row,receptionStatus:'LOST'}}});resolve();};postStarted();});return;}
        if(!fail)row.receptionStatus=route.request().postDataJSON().decision;
        await route.fulfill({status:fail?500:200,json:fail?{error:'합성 서버 오류'}:{reception:row,erpSync:{status:'PENDING'}}});
      }else {
        const q=new URL(route.request().url()).searchParams.get('q')||'';queries.push(q);
        const rows=routeChecks?[row,{...row,proposalId:'qa-other-2',caseId:'qa-case-2',caseNumber:'QA-SECOND'},{...row,proposalId:'qa-other-3',caseId:'qa-case-3',caseNumber:'QA-THIRD'}]:[row];
        const receptions=rows.filter(item=>!q||item.caseNumber.includes(q));
        if(holdGet){holdGet=false;await new Promise<void>(resolve=>{heldGet=async()=>{await route.fulfill({json:{receptions}});resolve();};getStarted();});return;}
        await route.fulfill({json:{receptions}});
      }
    });
    const url='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port+'/reception-test';
    const open=async()=>{row.receptionStatus='READY';await page.goto(url);await page.getByRole('button',{name:'✓ 수주 확인 · 프로젝트 접수',exact:true}).waitFor();};
    const show=()=>page.getByRole('button',{name:'✓ 수주 확인 · 프로젝트 접수',exact:true}).click();
    await open();
    for(const action of ['cancel','escape','enter']){
      await show();await page.getByRole('dialog').waitFor();
      if(action==='cancel')await page.getByRole('button',{name:'취소 · 기존 상태 유지',exact:true}).click();
      else await page.keyboard.press(action==='escape'?'Escape':'Enter');
      await page.getByRole('dialog').waitFor({state:'detached'});assert.equal(posts.length,0);
    }
    fail=true;await show();await page.getByRole('button',{name:'확인 · 수주 확정',exact:true}).click();
    await page.getByRole('alert').waitFor();assert.equal(posts.length,1);assert.deepEqual(await page.evaluate(()=>(window as any).paths),[]);
    fail=false;await show();
    await page.getByRole('button',{name:'확인 · 수주 확정',exact:true}).evaluate(el=>{(el as HTMLButtonElement).click();(el as HTMLButtonElement).click();});
    await page.waitForFunction(()=>(window as any).paths.length===1);
    assert.equal(posts.length,2);assert.equal(posts[0].key,posts[1].key);assert.ok(posts[0].key);
    assert.deepEqual(posts[1].body,{proposalId:'qa-proposal',decision:'WON',expectedProposalVersion:3,expectedCaseVersion:7});
    assert.match(await page.evaluate(()=>(window as any).paths[0]),/projectId=project-qa-case/);
    await open();await page.getByRole('button',{name:'접수 취소',exact:true}).click();await page.getByRole('button',{name:'확인 · 접수 취소',exact:true}).click();
    await page.getByRole('status').waitFor();assert.equal(posts.length,3);assert.equal(posts[2].body.decision,'LOST');assert.deepEqual(await page.evaluate(()=>(window as any).paths),[]);
    await open();await show();await page.evaluate(()=>(window as any).renderTest([]));await page.getByRole('dialog').waitFor({state:'detached'});assert.equal(posts.length,3);
    assert.equal(await page.getByRole('button',{name:'✓ 수주 확인 · 프로젝트 접수',exact:true}).isDisabled(),true);
    await page.evaluate(()=>(window as any).renderTest());await show();
    routeChecks=true;
    await page.evaluate(()=>(window as any).renderTest(['admin'],'WF-07'));
    await page.getByRole('dialog').waitFor({state:'detached'});assert.equal(posts.length,3,'route change cancels an unconfirmed mutation');
    const databaseRows=page.locator('.reception-database-table tbody tr');
    const receptionRows=page.locator('.reception-status-list__body > button');
    await page.waitForFunction(()=>document.querySelectorAll('.reception-database-table tbody tr').length===3);
    await page.getByLabel('프로젝트·제안서 통합 검색').fill('QA-ONLY');
    await page.getByRole('button',{name:'검색',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.reception-database-table tbody tr').length===1);
    assert.equal(await databaseRows.count(),1);assert.equal(queries.at(-1),'QA-ONLY');
    await page.evaluate(()=>(window as any).renderTest(['admin'],'WF-02'));
    await page.waitForFunction(()=>document.querySelectorAll('.reception-status-list__body > button').length===3);
    assert.equal(await receptionRows.count(),3);assert.equal(queries.at(-1),'');
    assert.equal(await page.getByLabel('접수 프로젝트 빠른 검색').inputValue(),'');
    await page.evaluate(()=>(window as any).renderTest(['admin'],'WF-07'));
    await page.waitForFunction(()=>document.querySelectorAll('.reception-database-table tbody tr').length===1);
    assert.equal(await page.getByLabel('프로젝트·제안서 통합 검색').inputValue(),'QA-ONLY');
    const getInFlight=new Promise<void>(resolve=>{getStarted=resolve;});
    holdGet=true;await page.getByRole('button',{name:'검색',exact:true}).click();await getInFlight;
    assert.ok(heldGet,'the old DB search is actually in flight');
    await page.evaluate(()=>(window as any).renderTest(['admin'],'WF-02'));
    await page.waitForFunction(()=>document.querySelectorAll('.reception-status-list__body > button').length===3);
    await heldGet();
    await page.waitForTimeout(50);
    assert.equal(await receptionRows.count(),3,'late DB search must not overwrite reception rows');
    const postInFlight=new Promise<void>(resolve=>{postStarted=resolve;});
    holdPost=true;await page.getByRole('button',{name:'접수 취소',exact:true}).click();
    await page.getByRole('button',{name:'확인 · 접수 취소',exact:true}).click();
    await postInFlight;assert.ok(heldPost);assert.equal(posts.length,4);
    await page.evaluate(()=>(window as any).renderTest(['admin'],'WF-07'));
    await page.waitForFunction(()=>document.querySelectorAll('.reception-database-table tbody tr').length===1);
    const beforeLatePost=queries.length;await heldPost();await page.waitForTimeout(50);
    assert.equal(queries.length,beforeLatePost,'late LOST callback must not start an old reception refresh');
    assert.equal(await databaseRows.count(),1);assert.deepEqual(await page.evaluate(()=>(window as any).paths),[]);
    assert.equal(await page.getByRole('status').count(),0);
    await page.evaluate(()=>(window as any).renderTest(['admin'],'WF-02'));
    await page.waitForFunction(()=>document.querySelectorAll('.reception-status-list__body > button').length===3);
    await show();await page.evaluate(()=>(window as any).unmountTest());await page.getByRole('dialog').waitFor({state:'detached'});assert.equal(posts.length,4);
    assert.equal(native,0);assert.deepEqual(errors,[]);
  } finally {await browser.close();await server.close();}
});
