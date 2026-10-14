import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page, type Route } from 'playwright-core';
import { hydrateProposalPublishedFacts, sanitizeProposalCostData } from '../apps/cloudflare/src/proposal-company-content';

test('CF213 actual ProposalView preserves drafts on renderer crash, explicit recovery and exact save acknowledgements', { timeout: 180_000 }, async t => {
  const base=resolve(process.env.CF213_OUTPUT_ROOT||'tmp');mkdirSync(base,{recursive:true});const proof=mkdtempSync(join(base,'cf213-proposal-recovery-'));
  const {createServer}=await import('../apps/web/qa/vite-server.js');
  const appHead=readFileSync('apps/web/index.html','utf8').match(/<style>[\s\S]*?<\/style>/u)?.[0];assert.ok(appHead);
  const server=await createServer({root:resolve('apps/web'),cacheDir:join(proof,'cache'),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{
    name:'cf213-proposal-local-recovery-fixture',
    configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(!req.url?.startsWith('/cf213-proposal.html'))return next();res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await vite.transformIndexHtml(req.url,`<!doctype html><html lang="ko" data-theme="light"><head><meta charset="utf-8">${appHead}</head><body><div id="root"></div><script>window.__CLAIM_API_ORIGIN__=location.origin</script><script type="module" src="/cf213-proposal.js"></script></body></html>`));});},
    resolveId:id=>id==='/cf213-proposal.js'?'\0cf213-proposal':undefined,
    load:id=>id==='\0cf213-proposal'?`import React from 'react';import{createRoot}from'react-dom/client';import{ProposalView}from'/src/proposals/ProposalView.tsx';import'/src/theme-system.css';import'/src/documents/DocumentReviewWorkspace.css';window.__CLAIM_API_ORIGIN__=location.origin;window.cf213Navigation=[];createRoot(document.getElementById('root')).render(React.createElement(ProposalView,{routeId:'PROP-02',roles:['pm'],userEmail:new URLSearchParams(location.search).get('account')||'synthetic-author@example.invalid',onNavigate:path=>window.cf213Navigation.push(path)}));`:undefined
  }]});await server.listen();const origin='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port;
  const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(path=>path&&existsSync(path));assert.ok(executablePath);
  let context=await chromium.launchPersistentContext(join(proof,'profile'),{executablePath,headless:true,viewport:{width:1440,height:1000}});
  const caseId='cf213-synthetic-case',proposalId='cf213-synthetic-proposal';
  const modules=Array.from({length:9},(_,index)=>({code:`CF213-M${index+4}`,chapterNumber:index+4,title:`합성 ${index+4}장`,category:'FIXED',bodyMarkdown:`합성 기본 ${index+4}장`,isActive:true,version:1,updatedAt:'2026-10-13T00:00:00Z'}));
  const chapters=Array.from({length:12},(_,index)=>({number:index+1,title:`합성 ${index+1}장`,kind:index<3?'VARIABLE':'FIXED',body:`합성 원문 ${index+1}장`,...(index===3?{moduleCode:modules[0].code,excludedCompanyAssetKeys:['CF213_EXCLUDED'],editorJson:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'합성 표와 사진 원문'}]},{type:'table',attrs:{width:'100%',alignment:'center'},content:[{type:'tableRow',content:[{type:'tableCell',attrs:{colspan:1,rowspan:1,colwidth:[220]},content:[{type:'paragraph',content:[{type:'text',text:'합성 셀 123'}]}]},{type:'tableCell',attrs:{colspan:1,rowspan:1,colwidth:[220]},content:[{type:'paragraph',content:[{type:'text',text:'합성 셀 456'}]}]}]}]},{type:'image',attrs:{src:'/api/proposal-studio/assets/CF213_PHOTO?v=1',alt:'합성 사진',width:120,height:80,alignment:'right'}},{type:'paragraph',content:[{type:'text',text:'합성 맺는 문장'}]}]}}:{} )}));
  const inputs={clientName:'합성 제출처',projectTitle:'합성 프로젝트',subtitle:'합성 제안서',submissionDate:'2026-10-13',keyIssues:'합성 쟁점',objective:'합성 목적',planNotes:'합성 업무',exclusions:'해당 없음',chapters,includedModuleCodes:modules.map(item=>item.code),templateSourceId:'cf213-source',templateSourceName:'합성 유형 원본'};
  let proposal:any={id:proposalId,caseId,templateId:'cf213-template',title:'CF213 합성 제안서',status:'DRAFT',currentVersionId:'cf213-version-1',approvedVersionId:null,version:1,versions:[{id:'cf213-version-1',versionNumber:1,bodyText:'합성 원문',structuredInputsJson:JSON.stringify(inputs),generationMode:'MANUAL',providerId:null,modelId:null,inputSha256:'synthetic',sourceDocumentVersionIdsJson:'[]',sha256:'synthetic',isApproved:false,createdAt:'2026-10-13T00:00:00Z'}]};
  let saveMode:'exact'|'mismatch'|'hold'='exact',held:Route|null=null,holdReady:((route:Route)=>void)|null=null;
  const writes:{path:string;body:any}[]=[];const denied:string[]=[],errors:string[]=[];
  const respondSave=async(route:Route,mismatch=false)=>{
    const body=route.request().postDataJSON();const savedInputs=JSON.parse(hydrateProposalPublishedFacts(sanitizeProposalCostData(JSON.stringify({...body,templateSourceName:inputs.templateSourceName,chapters:body.chapters.map((item:any)=>({...item,excludedCompanyAssetKeys:item.excludedCompanyAssetKeys??[]}))})).value));
    if(mismatch)savedInputs.chapters[3].body+=' ACK 불일치';
    const next=proposal.version+1,version={...proposal.versions[0],id:`cf213-version-${next}`,versionNumber:next,structuredInputsJson:JSON.stringify(savedInputs),sourceDocumentVersionIdsJson:JSON.stringify(body.sourceDocumentVersionIds),generationMode:body.generationMode};
    const response={...proposal,version:next,currentVersionId:version.id,versions:[version,...proposal.versions]};if(!mismatch)proposal=response;
    await route.fulfill({contentType:'application/json',body:JSON.stringify({proposal:response})});
  };
  const initialize=async(page:Page,account='synthetic-author@example.invalid')=>{
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());if(url.origin!==origin){denied.push(url.origin);return route.abort();}
      if(!url.pathname.startsWith('/api/'))return route.continue();
      if(route.request().method()!=='GET'){
        writes.push({path:url.pathname,body:route.request().postDataJSON()});
        assert.equal(url.pathname,`/api/cases/${caseId}/proposals/${proposalId}/versions`,'No proposal confirmation, email, company DB or other mutations allowed');
        if(saveMode==='hold'){held=route;holdReady?.(route);return;}return respondSave(route,saveMode==='mismatch');
      }
      if(url.pathname.includes('/assets/'))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=','base64')});
      let payload:unknown;
      if(url.pathname==='/api/cases')payload={cases:[{id:caseId,caseNumber:'CF213-LOCAL',title:'합성 프로젝트',description:'합성 목적',clientName:'합성 제출처',claimType:'TYPE-01',status:'DRAFT'}]};
      else if(url.pathname==='/api/proposal-studio/config')payload={modules,sources:[{id:'cf213-source',sourceName:inputs.templateSourceName,sourceFormat:'HWP',sourceDate:'2026-10-13',isDefault:true,analysisStatus:'READY',chapterMapJson:'{}',version:1}],assets:[{assetKey:'CF213_EXCLUDED',chapterNumber:4,displayOrder:1,title:'제외할 합성 기본 이미지',altText:'합성 기본 이미지',mimeType:'image/png',fileName:'synthetic.png',sha256:'synthetic',width:120,height:80,hasContent:true,isActive:true,version:1,updatedAt:null}],templateTypes:[{id:'GENERAL_CLAIM',label:'합성 유형',description:'합성 검사 전용',representativeSourceId:'cf213-source',representativeSourceName:inputs.templateSourceName,sourceCount:1,promptReady:true}]};
      else if(url.pathname==='/api/proposal-templates')payload={templates:[{id:'cf213-template',name:'합성 템플릿',claimType:'TYPE-01',description:'합성 검사',bodyTemplate:'',placeholdersJson:'{}'}]};
      else if(url.pathname===`/api/cases/${caseId}/proposals`)payload={proposals:[proposal]};
      else if(url.pathname===`/api/cases/${caseId}/proposals/${proposalId}`)payload={proposal};
      else throw new Error('Unexpected synthetic API read '+url.pathname);
      return route.fulfill({contentType:'application/json',body:JSON.stringify(payload)});
    });
    await page.goto(`${origin}/cf213-proposal.html?caseId=${caseId}&account=${account}`);
    await page.getByRole('textbox',{name:'클라이언트명',exact:true}).waitFor({timeout:15000}).catch(async error=>{throw new Error(`${error.message}; fixture errors=${JSON.stringify(errors)}; denied=${JSON.stringify(denied)}; DOM=${(await page.locator('body').innerText()).slice(0,500)}`);});await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('.proposal-input-grid input')?.value==='합성 제출처');
    await page.evaluate('globalThis.__name = value => value');
  };
  const openRecovery=async(page:Page)=>{if(!(await page.getByRole('dialog',{name:'이전 작업 복구',exact:true}).count()))await page.getByRole('button',{name:/^이전 작업 복구 /}).click();};
  const records=async(page:Page,account='synthetic-author@example.invalid')=>page.evaluate(async({caseId,account})=>{
    const {createLocalDocumentRecovery}=await import('/src/documents/local-document-recovery.ts' as string),client=createLocalDocumentRecovery({accountId:account,workspaceId:`proposal:${caseId}`});
    const rows=await client.list();return Promise.all(rows.map((row:{snapshotId:string})=>client.read(row.snapshotId)));
  },{caseId,account});
  const backedUp=async(page:Page)=>page.getByRole('status').filter({hasText:'미저장 편집본을 이 브라우저에 보관했습니다'}).waitFor();
  const goReview=async(page:Page)=>page.getByRole('navigation',{name:'제안서 작성 및 메일 준비 5단계'}).getByRole('button',{name:/03.*담당자 검수/}).click();
  let page=await context.newPage();
  try{
    await initialize(page);
    let snapshot:any;
    await t.test('actual cover, TOC and rich chapter edits are journalled without a server write',async()=>{
      await page.getByRole('textbox',{name:'프로젝트 제목',exact:true}).fill('합성 미저장 제목 🧱');await goReview(page);
      await page.getByRole('complementary',{name:'갑지·목차·12개 챕터 편집 목록'}).getByRole('button',{name:'목 목차 12개 챕터 제목 편집',exact:true}).click();
      await page.locator('.proposal-toc-editor-list input').nth(3).fill('합성 수정 목차');
      await page.getByRole('complementary',{name:'갑지·목차·12개 챕터 편집 목록'}).getByRole('button',{name:/04.*합성 수정 목차/}).click();
      const editor=page.locator('.proposal-chapter-editor .tiptap[contenteditable="true"]');await editor.click();await editor.press('Control+End');await editor.press('End');await editor.pressSequentially(' 합성 미저장 덧붙임');await backedUp(page);
      const rows=await records(page);assert.equal(rows.length,1);snapshot=rows[0];
      assert.equal(snapshot.payload.inputs.projectTitle,'합성 미저장 제목 🧱');assert.equal(snapshot.payload.inputs.chapters[3].title,'합성 수정 목차');assert.match(snapshot.payload.inputs.chapters[3].body,/합성 미저장 덧붙임/u);
      assert.ok(JSON.stringify(snapshot.payload.inputs.chapters[3].editorJson).includes('tableCell'));assert.ok(JSON.stringify(snapshot.payload.inputs.chapters[3].editorJson).includes('/api/proposal-studio/assets/CF213_PHOTO?v=1'));
      assert.deepEqual(snapshot.payload.inputs.chapters[3].excludedCompanyAssetKeys,['CF213_EXCLUDED']);assert.equal(snapshot.payload.selectedChapter,4);assert.equal(snapshot.payload.reviewSurface,'chapter');assert.equal(snapshot.payload.step,3);assert.equal(writes.length,0);
    });
    await t.test('actual renderer crash and browser reopen present a candidate, never autooverwrite, then restore every saved field',async()=>{
      const crash=page.waitForEvent('crash'),cdp=await context.newCDPSession(page);void cdp.send('Page.crash').catch(()=>undefined);await crash;await page.close();await context.close();
      context=await chromium.launchPersistentContext(join(proof,'profile'),{executablePath,headless:true,viewport:{width:1440,height:1000}});page=await context.newPage();await initialize(page);
      await openRecovery(page);await page.getByRole('button',{name:'이 편집본 복구',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'프로젝트 제목',exact:true}).inputValue(),'합성 프로젝트');assert.equal(writes.length,0);
      await page.getByRole('button',{name:'이 편집본 복구',exact:true}).click();await backedUp(page);
      assert.equal(await page.locator('.proposal-toc button.active span').textContent(),'합성 수정 목차');assert.match(await page.locator('.proposal-chapter-editor .tiptap').innerText(),/합성 미저장 덧붙임/u);
      const rows=await records(page),restored=rows.find(row=>row?.snapshotId!==snapshot.snapshotId);assert.ok(restored);assert.deepEqual(restored.payload,snapshot.payload);assert.equal(writes.length,0);
    });
    await t.test('an ambiguous mismatched save leaves editor and both recovery records intact',async()=>{
      saveMode='mismatch';const before=await records(page);await page.getByRole('button',{name:'검수 완료 · 전체 합본 미리보기 →',exact:true}).click();
      await page.getByRole('dialog',{name:'제안서 작업 확인'}).waitFor();assert.match(await page.getByRole('dialog',{name:'제안서 작업 확인'}).innerText(),/一致|일치하지/u);
      assert.deepEqual(await records(page),before);assert.match(await page.locator('.proposal-chapter-editor .tiptap').innerText(),/합성 미저장 덧붙임/u);await page.getByRole('dialog',{name:'제안서 작업 확인'}).getByRole('button',{name:/닫기|확인/}).last().click();
    });
    let lateAckPassed=false;
    await t.test('a late exact acknowledgement cannot overwrite or acknowledge additional typed content',async()=>{
      saveMode='hold';const holdArrived=new Promise<Route>(resolve=>{holdReady=resolve;});await page.getByRole('button',{name:'검수 완료 · 전체 합본 미리보기 →',exact:true}).click();held=await holdArrived;
      // The side navigation remains interactive while a save is pending. Its
      // editor view belongs to the same draft and must not be reset by ACK.
      await page.getByRole('complementary',{name:'갑지·목차·12개 챕터 편집 목록'}).getByRole('button',{name:'목 목차 12개 챕터 제목 편집',exact:true}).click();
      // Exercise the real React change handler even though normal typing is
      // disabled during the network wait (IME/event ordering can be late).
      await page.locator('.proposal-toc-editor-list input').nth(3).evaluate((input:HTMLInputElement)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'合成 ACK 후 보존');input.dispatchEvent(new Event('input',{bubbles:true}));});
      await backedUp(page);await respondSave(held!);held=null;await page.waitForFunction(()=>!document.querySelector('.proposal-toc-editor-list input')?.hasAttribute('disabled'));
      assert.equal(await page.locator('.proposal-toc-editor-list input').nth(3).inputValue(),'合成 ACK 후 보존');const rows=await records(page);assert.equal(rows.length,1);assert.equal(rows[0].payload.inputs.chapters[3].title,'合成 ACK 후 보존');assert.equal(rows[0].payload.proposalVersion,2);lateAckPassed=true;
    });
    assert.ok(lateAckPassed,'Do not run dependent saves against an unresolved request after a failed late-ACK gate');
    await t.test('the next exact save acknowledges only the current snapshot and preserves prior server revisions',async()=>{
      saveMode='exact';await page.getByRole('button',{name:'검수 완료 · 전체 합본 미리보기 →',exact:true}).click();await page.getByText('서버 저장 응답의 내용 일치를 확인했습니다.',{exact:true}).waitFor();assert.deepEqual(await records(page),[]);assert.equal(proposal.version,3);assert.equal(proposal.versions.length,3);assert.equal(proposal.versions[2].id,'cf213-version-1');assert.equal(JSON.parse(proposal.versions[2].structuredInputsJson).projectTitle,'합성 프로젝트');
    });
    await t.test('two actual editor tabs and another login retain isolated candidates; keep-server drops only the chosen candidate',async()=>{
      await page.getByRole('button',{name:/← 수정 · 3단계로/}).first().click();await page.getByRole('complementary',{name:'갑지·목차·12개 챕터 편집 목록'}).getByRole('button',{name:/갑지/}).click();await page.getByRole('textbox',{name:'제출처',exact:true}).fill('합성 첫 탭');await backedUp(page);
      const other=await context.newPage();await initialize(other);await other.getByRole('textbox',{name:'프로젝트 제목',exact:true}).fill('합성 두 번째 탭');await backedUp(other);const before=await records(other);assert.equal(before.length,2);assert.notEqual(before[0].tabId,before[1].tabId);
      const foreign=await context.newPage();await initialize(foreign,'synthetic-other@example.invalid');assert.equal(await foreign.getByRole('button',{name:'이 편집본 복구',exact:true}).count(),0);assert.deepEqual(await records(foreign,'synthetic-other@example.invalid'),[]);await foreign.close();
      const clean=await context.newPage();await initialize(clean);await openRecovery(clean);await clean.getByRole('button',{name:'이 복구본 삭제',exact:true}).first().click();await clean.getByRole('button',{name:'이 복구본 삭제 확인',exact:true}).click();await clean.waitForTimeout(30);assert.equal((await records(clean)).length,1);assert.equal(await clean.getByRole('textbox',{name:'프로젝트 제목',exact:true}).inputValue(),'합성 미저장 제목 🧱');await other.close();await clean.close();
    });
    await t.test('quota failure is visible and retains the last successful record instead of fake success',async()=>{
      const before=await records(page);await page.evaluate(()=>{(window as any).cf213Put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('CF213 synthetic quota','QuotaExceededError');};});
      await page.getByRole('textbox',{name:'제출처',exact:true}).fill('합성 저장 공간 부족');await page.getByRole('alert').filter({hasText:'브라우저 저장 공간이 부족'}).waitFor();assert.deepEqual(await records(page),before);assert.equal(await page.getByRole('textbox',{name:'제출처',exact:true}).inputValue(),'합성 저장 공간 부족');
      await page.evaluate(()=>{IDBObjectStore.prototype.put=(window as any).cf213Put;});
    });
    await t.test('an asynchronous restore cannot overwrite edits made while its IndexedDB read is pending',async()=>{
      const clean=await context.newPage();await initialize(clean);await openRecovery(clean);await clean.getByRole('button',{name:'이 편집본 복구',exact:true}).waitFor();
      await page.evaluate(async()=>{
        const db=await new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open('claim-center-local-document-recovery',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
        (window as any).cf213HoldDb=db;(window as any).cf213Release=false;const lock=db.transaction('snapshots','readwrite');
        const keepAlive=()=>{if(!(window as any).cf213Release){const req=lock.objectStore('snapshots').get(['synthetic-author@example.invalid','proposal:cf213-synthetic-case','not-present']);req.onsuccess=keepAlive;}};keepAlive();
      });
      await clean.getByRole('button',{name:'이 편집본 복구',exact:true}).first().click();await clean.getByRole('textbox',{name:'프로젝트 제목',exact:true}).fill('합성 복구 대기 중 새 작성');
      await page.evaluate(()=>{(window as any).cf213Release=true;});await clean.getByRole('dialog',{name:'제안서 작업 확인'}).waitFor();assert.match(await clean.getByRole('dialog',{name:'제안서 작업 확인'}).innerText(),/복구본을 읽는 동안/u);assert.equal(await clean.getByRole('textbox',{name:'프로젝트 제목',exact:true}).inputValue(),'합성 복구 대기 중 새 작성');
      const rows=await records(clean);assert.ok(rows.some(row=>row?.payload.inputs.projectTitle==='합성 복구 대기 중 새 작성'));assert.ok(rows.length>=2);await page.evaluate(()=>{(window as any).cf213HoldDb.close();});await clean.close();
    });
    await t.test('unavailable IndexedDB is visible in the real screen and does not trigger a server write',async()=>{
      const unavailable=await context.newPage();await unavailable.addInitScript(()=>{Object.defineProperty(window,'indexedDB',{configurable:true,get(){throw new DOMException('CF213 blocked local storage','SecurityError');}});});await initialize(unavailable);
      await unavailable.getByRole('alert').filter({hasText:'로컬 복구 저장소를 사용할 수 없습니다'}).waitFor();await unavailable.getByRole('textbox',{name:'프로젝트 제목',exact:true}).fill('합성 로컬 저장 불가');await unavailable.getByRole('alert').filter({hasText:'로컬 복구 저장소를 사용할 수 없습니다'}).waitFor();assert.equal(await unavailable.getByRole('textbox',{name:'프로젝트 제목',exact:true}).inputValue(),'합성 로컬 저장 불가');await unavailable.close();
    });
    assert.deepEqual(errors,[]);assert.deepEqual(denied,[]);assert.equal(writes.length,3);
  }finally{await context.close();await server.close();}
});
