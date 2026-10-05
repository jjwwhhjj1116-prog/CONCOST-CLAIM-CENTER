import assert from 'node:assert/strict';
import test from 'node:test';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';

test('CF148 reopening a saved intake cannot show the creation form or create a duplicate',async()=>{
  const {createServer}=await import('../apps/web/qa/vite-server.js');
  const server=await createServer({root:resolve('apps/web'),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{
    name:'cf148-intake-reopen',
    configureServer(server){server.middlewares.use(async(req,res,next)=>{
      if(!req.url?.startsWith('/cf148-intake.html'))return next();
      res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<html><body><div id="root"></div><script type="module" src="/cf148-intake.js"></script></body></html>'));
    });},
    resolveId:id=>id==='/cf148-intake.js'?'\0cf148-intake':undefined,
    load:id=>id==='\0cf148-intake'?`
      import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import {IntakeLibraryView} from '/src/intakes/IntakeLibraryView.tsx';
      import {CaseManagement} from '/src/case-management/CaseManagement.tsx';
      function App(){const [path,setPath]=useState(new URLSearchParams(location.search).get('caseId')?'/cases/new':'list');
        const navigate=path=>{history.pushState({},'',path);setPath(path)};
        return path==='list'?React.createElement(IntakeLibraryView,{mode:'projects',onNavigate:navigate}):React.createElement(CaseManagement,{routeId:path.startsWith('/cases/new')?'CASE-02':'CASE-03',onNavigate:navigate,previewMode:true});}
      createRoot(document.getElementById('root')).render(React.createElement(App));
    `:undefined
  }]});
  await server.listen();const origin='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port;
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage();const writes:string[]=[];const reads:string[]=[];
    const record={id:'existing-intake',caseNumber:'QA-CC4',title:'기존 의뢰 원문',description:'원본 설명 첫 줄\n둘째 줄 보존',clientName:'검수 거래처',claimType:'TYPE-03',clientLegalPosition:'VICTIM',status:'CONTRACT',version:7,createdAt:'2026-09-14',createdByName:'검수 담당',parties:[],schedules:[]};
    await page.route('**/api/**',route=>{
      const req=route.request(),path=new URL(req.url()).pathname;
      if(req.method()!=='GET'){writes.push(path);return route.fulfill({status:500,json:{error:'Unexpected write'}});}
      reads.push(path);
      if(path==='/api/cases/catalog')return route.fulfill({json:{intakes:[record]}});
      if(path==='/api/cases/existing-intake')return route.fulfill({json:{case:record}});
      return route.fulfill({status:403,json:{error:{message:'접근 권한 없음'}}});
    });
    await page.goto(origin+'/cf148-intake.html');
    await page.getByRole('button',{name:'의뢰 열기',exact:true}).click();
    await page.getByText('등록된 의뢰 내용',{exact:true}).waitFor();
    assert.ok(page.url().includes('/cases/detail?caseId=existing-intake'));
    assert.match(await page.locator('body').innerText(),/검수 거래처/);
    assert.match(await page.locator('body').innerText(),/둘째 줄 보존/);
    assert.equal(await page.getByRole('button',{name:'의뢰 검토·등록'}).count(),0);
    await page.goto(origin+'/cf148-intake.html?caseId=existing-intake');
    await page.getByText('등록된 의뢰 내용',{exact:true}).waitFor();
    assert.match(await page.locator('body').innerText(),/기존 의뢰 원문/);
    await page.goto(origin+'/cf148-intake.html?caseId=forbidden');
    await page.getByRole('alert').waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(),/기존 의뢰 원문|검수 거래처/);
    assert.ok(reads.includes('/api/cases/forbidden'));assert.deepEqual(writes,[]);
  }finally{await browser.close();await server.close();}
});
