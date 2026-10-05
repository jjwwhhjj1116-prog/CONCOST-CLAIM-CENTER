import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {chromium} from 'playwright-core';
import {extractIntakeSource} from '../apps/cloudflare/src/intake-source.js';

test('CF147 project search shows only matches without silently switching or clearing the selection', async () => {
  const {createServer}=await import('../apps/web/qa/vite-server.js');
  const server=await createServer({root:fileURLToPath(new URL('../apps/web',import.meta.url)),server:{host:'127.0.0.1',port:0},logLevel:'error',plugins:[{
    name:'cf147-search',
    configureServer(server){server.middlewares.use(async(req,res,next)=>{
      if(req.url!=='/cf147.html')return next();
      res.setHeader('Content-Type','text/html');
      res.end(await server.transformIndexHtml(req.url,'<!doctype html><html><body><div id="root"></div><script type="module" src="/cf147.js"></script></body></html>'));
    });},
    resolveId:id=>id==='/cf147.js'?'\0cf147':undefined,
    load:id=>id==='\0cf147'?`
      import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Select} from '@claim-studio/ui';
      import {ProposalFinalChapterPages} from '/src/proposals/ProposalView.tsx';
      import '/src/theme-system.css';
      import '/src/documents/DocumentReviewWorkspace.css';
      window.showLongProposal=()=>{const root=document.createElement('div');root.className='proposal-final-document';document.body.append(root);createRoot(root).render(React.createElement(ProposalFinalChapterPages,{item:{number:1,title:'긴 문단 검수',kind:'VARIABLE',body:('원문 보존 긴 문단입니다. ').repeat(1000)},startPage:1,onPageCount:()=>{}}));};
      function App(){const [value,setValue]=useState('A'),[changes,setChanges]=useState(0);return React.createElement('div',null,
        React.createElement(Select,{searchable:true,label:'프로젝트',value,options:[{value:'A',label:'기존 재건축'},{value:'B',label:'돌관 공사'},{value:'C',label:'돌관 검토'}],onChange:e=>{setValue(e.target.value);setChanges(n=>n+1)}}),
        React.createElement('output',null,value+':'+changes));}createRoot(document.getElementById('root')).render(React.createElement(App));
    `:undefined
  }]});
  await server.listen();
  const origin='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port;
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const {kickoffMinutesValues,workflowArchiveFile}=await server.ssrLoadModule('/src/workflow/WorkflowOperations.tsx');
    const input={minutesFields:{author:'작성자',meetingEndTime:'11:30',clientParticipants:'거래처 참석자'},meetingAt:'2026-09-11T10:00',location:'회의실',agenda:'공사비 검토',participants:['컨코스트 참석자'],sourceNotes:'원문에서 확인한 회의 내용',summary:'AI 임의 제안 999999원',timeline:[{date:'2099-01-01',event:'AI 미확정 일정'}],surveyDate:'2026-09-11'};
    assert.equal(kickoffMinutesValues(input).meetingTime,'10:00');
    assert.equal(kickoffMinutesValues({...input,meetingAt:'2026-09-11T01:00:00Z'}).meetingTime,'10:00');
    assert.equal(kickoffMinutesValues(input).followUps,'');
    const file=workflowArchiveFile('KICKOFF',input,'확정');
    assert.match(file.name,/2026-09-11_확정\.xlsx$/);
    const extracted=await extractIntakeSource(file.name,file.type,new Uint8Array(await file.arrayBuffer()));
    assert.match(extracted.extractedText??'',/원문에서 확인한 회의 내용/);
    assert.match(extracted.extractedText??'',/11:30/);
    assert.notDeepEqual(new Uint8Array(await file.arrayBuffer()),new Uint8Array(await workflowArchiveFile('KICKOFF',input,'자동작성').arrayBuffer()));
    assert.doesNotMatch(extracted.extractedText??'',/999999|2099-01-01|AI 미확정/);
    assert.match(workflowArchiveFile('SITE_SURVEY',input,'확정').name,/\.txt$/);
    const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await page.goto(origin+'/cf147.html');
    const search=page.getByRole('searchbox',{name:'프로젝트 검색'});
    await search.fill('돌관');
    assert.equal(await page.locator('output').textContent(),'A:0');
    assert.deepEqual(await page.locator('select option:not([hidden])').allTextContents(),['돌관 공사','돌관 검토']);
    assert.match(await page.locator('small[role="status"]').textContent()??'',/검색 결과 2건/);
    await page.locator('select').selectOption('B');
    assert.equal(await page.locator('output').textContent(),'B:1');
    await search.fill('존재하지않음');
    assert.equal(await page.locator('output').textContent(),'B:1');
    assert.match(await page.locator('small[role="status"]').textContent()??'',/검색 결과 0건/);
    await search.fill('');
    assert.equal(await page.locator('select').inputValue(),'B');
    assert.equal(await page.locator('select option').count(),3);
    assert.equal(await page.locator('output').textContent(),'B:1');
    await page.evaluate(()=> (window as any).showLongProposal());
    await page.waitForFunction(()=>document.querySelectorAll('[data-export-page]').length>1&&[...document.querySelectorAll('[data-export-page]')].every(el=>el.getAttribute('data-page-fit-overflow')==='false'));
    const pageText=await page.locator('[data-export-page] .proposal-rich-content').allTextContents();
    assert.equal(pageText.join('').replace(/\s/g,''),('원문 보존 긴 문단입니다. ').repeat(1000).replace(/\s/g,''));
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await server.close();}
});
