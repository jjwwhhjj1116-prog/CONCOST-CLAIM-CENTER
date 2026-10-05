import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('Studio final output uses the immutable snapshot, never the current draft', async () => {
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const server = await createServer({ root: resolve('apps/web'), server: {host:'127.0.0.1',port:0,hmr:false}, logLevel:'error', plugins:[{
    name:'final-snapshot-fixture',
    enforce:'pre',
    transform(source,id){
      if(process.env.CF148_LEGACY_PROJECT_LOADING==='1' && id.endsWith('/PreviewReportStudio.tsx')) return source.replace('if (projectsLoading) return', 'if (false) return');
      if(process.env.CF148_LEGACY_FINAL==='1' && id.endsWith('/PreviewReportStudio.tsx')) return source.replace('<ReportFinalDocumentPreview {...approvedDocument}/>', '<ReportFinalDocumentPreview caseNumber={selectedCase?.caseNumber??""} caseTitle={selectedCase?.title??""} title={title} content={content} editorJson={editorJson}/>');
    },
    configureServer(server) { server.middlewares.use(async(req,res,next)=>{
      if(!req.url?.startsWith('/snapshot-test.html'))return next();
      res.setHeader('Content-Type','text/html');
      res.end(await server.transformIndexHtml(req.url,'<html><body><div id="root"></div><script type="module" src="/snapshot-entry.js"></script></body></html>'));
    }); },
    resolveId:id=>id==='/snapshot-entry.js'?'\0snapshot-entry':undefined,
    load:id=>id==='\0snapshot-entry'?`import React from 'react';import{createRoot}from'react-dom/client';import{PreviewReportStudio}from'/src/routes/PreviewReportStudio.tsx';createRoot(document.getElementById('root')).render(React.createElement(PreviewReportStudio,{roles:['admin'],onNavigate:()=>{}}));`:undefined,
  }]});
  await server.listen();
  const origin='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port;
  const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>p&&existsSync(p));assert.ok(executablePath);
  const browser=await chromium.launch({executablePath,headless:true});
  let releaseProjects=()=>{};
  const projectsGate=new Promise<void>(resolve=>{releaseProjects=resolve;});
  try {
    const page=await browser.newPage();page.setDefaultTimeout(7000);let fail=false;let snapshotVersion=3;let snapshotRequests=0;
    let projectsMode:'normal'|'empty'|'error'='normal';
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(!url.pathname.startsWith('/api/'))return url.origin===origin?route.continue():route.abort();
      assert.equal(route.request().method(),'GET','This test never modifies server data');
      const send=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      const person={id:'reviewer',name:'검토자'};
      switch(url.pathname){
        case '/api/cases':
          await projectsGate;
          if(projectsMode==='error')return send({error:'프로젝트 조회 시험 오류'},503);
          if(projectsMode==='empty')return send({cases:[],total:0,nextOffset:null});
          return send(url.searchParams.get('offset')==='100'?{cases:[{id:'case-1',caseNumber:'CURRENT-1',title:'현재 변경된 사건명',claimType:'TYPE03',status:'CONTRACT'}],total:101,nextOffset:null}:{cases:Array.from({length:100},(_,i)=>({id:`other-${i}`,caseNumber:`OTHER-${i}`,title:`다른 프로젝트 ${i}`,claimType:'TYPE03',status:'CONTRACT'})),total:101,nextOffset:100});
        case '/api/report-workspaces':return send({workspaces:[]});
        case '/api/report-drafts':return send({draft:{title:'현재 변경된 제목',content:'현재 변경된 본문',editorJson:null,version:3,wizardStep:5,updatedAt:'2026-09-23T00:00:00Z'},revisions:[],backups:[]});
        case '/api/report-reviews':return send({reviews:[{id:'review-1',reportVersion:3,status:'APPROVED',reviewedBy:person}]});
        case '/api/report-finalizations':return send({finalizations:[{id:'final-1',caseId:'case-1',reviewId:'review-1',reportVersion:3,reportTitle:'확정 제목',finalizedAt:'2026-09-23T00:00:00Z',finalizedBy:person,approvedBy:'검토자',outputs:[]}]});
        case '/api/report-authoring/config':return send({available:true,claimType:'TYPE03',aiConnected:false,chapters:[],templateLibrary:[],templates:[],sourceGroups:[],outlinePlan:{status:'CONFIRMED',version:1,items:[],persistenceAvailable:true},typeGuideline:null});
        case '/api/report-chapter-collaboration':return send({assignments:[],members:[],canManage:true,currentUserId:'qa'});
        case '/api/report-finalizations/final-1/document':snapshotRequests++;return fail?send({error:'확정본 조회 실패'},503):send({document:{caseNumber:'APPROVED-1',caseTitle:'확정 당시 사건명',title:'확정 당시 제목',content:'확정 당시 본문',editorJson:null,version:snapshotVersion}});
        default:return send({error:'Unexpected API '+url.pathname},500);
      }
    });
    const projectsRequested=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/cases');
    await page.goto(origin+'/snapshot-test.html?caseId=case-1');
    await projectsRequested;
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.getByText('보고서를 연결할 프로젝트가 없습니다',{exact:true}).count(),0,'Pending lookup must not claim no projects');
    assert.equal(await page.getByText('보고서에 연결할 프로젝트와 저장한 작업을 불러오고 있습니다.',{exact:true}).count(),1);
    releaseProjects();
    const output=page.locator('.report-final-export-source');
    await output.getByText('확정 당시 본문',{exact:true}).last().waitFor();
    assert.ok((await output.innerText()).includes('확정 당시 제목'));
    assert.equal((await output.innerText()).includes('현재 변경된'),false);
    assert.equal(await page.getByRole('button',{name:'확정 보고서 PDF 내려받기',exact:true}).isEnabled(),true);
    assert.equal(snapshotRequests,1);
    fail=true;await page.reload();
    await page.getByRole('button',{name:'확정본 다시 조회',exact:true}).waitFor();
    assert.equal(await output.innerText(),'');
    assert.equal(await page.getByRole('button',{name:'확정 보고서 PDF 내려받기',exact:true}).isEnabled(),false);
    fail=false;snapshotVersion=2;
    await page.getByRole('button',{name:'확정본 다시 조회',exact:true}).click();
    await page.getByText('확정 버전이 일치하지 않아 출력을 중단했습니다.',{exact:false}).waitFor();
    assert.equal(await output.innerText(),'');
    snapshotVersion=3;await page.getByRole('button',{name:'확정본 다시 조회',exact:true}).click();
    await output.getByText('확정 당시 본문',{exact:true}).last().waitFor();
    assert.equal(await page.getByRole('button',{name:'확정 보고서 HWP 내려받기',exact:true}).isEnabled(),true);
    projectsMode='error';await page.reload();
    await page.getByRole('button',{name:'프로젝트 다시 조회',exact:true}).waitFor();
    assert.equal(await page.getByText('보고서를 연결할 프로젝트가 없습니다',{exact:true}).count(),0);
    projectsMode='normal';await page.getByRole('button',{name:'프로젝트 다시 조회',exact:true}).click();
    await output.getByText('확정 당시 본문',{exact:true}).last().waitFor();
    projectsMode='empty';await page.reload();
    await page.getByText('보고서를 연결할 프로젝트가 없습니다',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'프로젝트 의뢰 등록',exact:true}).count(),1);
  }finally{releaseProjects();await browser.close();await server.close();}
});
