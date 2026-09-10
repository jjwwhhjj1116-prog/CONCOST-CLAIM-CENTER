import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright-core';

// The CF115 virtual Vite fixture pattern mounts the real component; no live APIs or source edits.
test('CF117 workflow record entry survives schedule outages and explicit reload cancellation', async t => {
  const { createServer } = await import('../apps/web/node_modules/vite/dist/node/index.js');
  const server = await createServer({ root: fileURLToPath(new URL('../apps/web', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
    name: 'cf117-workflow-schedule-fixture',
    configureServer(server) { server.middlewares.use(async (request, response, next) => {
      if (!request.url?.startsWith('/cf117-workflow-schedule.html')) return next();
      const html = await server.transformIndexHtml(request.url, '<!doctype html><html lang="ko"><head><meta charset="utf-8"><script>window.__CLAIM_API_ORIGIN__=location.origin</script></head><body><div id="root"></div><script type="module" src="/cf117-workflow-schedule-entry.js"></script></body></html>');
      response.setHeader('Content-Type', 'text/html'); response.end(html);
    }); },
    resolveId: id => id === '/cf117-workflow-schedule-entry.js' ? '\0cf117-workflow-schedule-entry' : undefined,
    load: id => id === '\0cf117-workflow-schedule-entry' ? `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import { WorkflowOperations } from '/src/workflow/WorkflowOperations.tsx';
      import { minutesFieldDefaults } from '/@fs/${fileURLToPath(new URL('../apps/cloudflare/src/company-minutes.ts', import.meta.url)).replaceAll('\\', '/')}';
      import '/src/workflow/WorkflowOperations.css';
      import '/src/preview-theme.css';
      import '/src/theme-system.css';
      const params=new URLSearchParams(location.search), kind=params.get('kind')||'WF-03';
      const state={scheduleFailure:params.has('schedule-failure'),workflowGets:0,scheduleGets:0,saveAttempts:0,uploads:0,ai:0,release:null};
      window.cf117=state;
      const project={id:'11700000-0000-4000-8000-000000000001',caseNumber:'CF117-LOCAL',title:'일정 장애 합성 프로젝트',claimType:'TYPE-01',status:'CONTRACT',version:1};
      const record={minutesFields:{...minutesFieldDefaults},meetingAt:'2026-09-07T01:00:00.000Z',surveyDate:'2026-09-07',location:'기존 장소',agenda:'기존 안건',scopeText:'기존 조사',leadUnit:'기존 팀',participantUnits:[],rawNotes:'기존 저장 원문',summaryText:'기존 요약',timeline:[],status:'DRAFTED',version:1,outputVersion:1,outputStatus:'DRAFTED',id:'survey-1',folderPath:'test',photoCount:0,audioCount:0,documentCount:0,updatedAt:'2026-09-07',updatedByName:'합성 검수자'};
      if(kind==='WF-04')record.status='IN_PROGRESS';
      const empty=params.has('empty'), payload={case:project,kickoff:empty?null:record,siteSurveys:empty?[]:[record],allocations:[],events:[],googleDrive:{connected:true,deferredByUser:false,uploadEnabled:true}};
      const schedule={id:'project-'+project.id,caseId:project.id,responsiblePm:{id:'pm-1',name:'합성 PM'},canManageSchedule:true,stages:['KICKOFF','SITE_SURVEY'].map(stageCode=>({stageCode,startDate:'2026-09-08',endDate:'2026-09-10',scheduleStatus:'PLANNED',scheduleNote:'새로 조회된 일정',scheduleVersion:1,scheduleExplicit:true}))};
      const originalFetch=window.fetch.bind(window), json=(body,status=200)=>Response.json(body,{status});
      window.fetch=async(input,init={})=>{
        const url=new URL(typeof input==='string'?input:input.url,location.origin),path=url.pathname,method=init.method||'GET';
        if(!path.startsWith('/api/'))return originalFetch(input,init);
        if(path==='/api/cases')return json({cases:[project]});
        if(path==='/api/project-workflow/schedule'){state.scheduleGets++;return state.scheduleFailure?json({error:'합성 기준 일정 조회 실패'},503):json({projects:[schedule]});}
        if(path.endsWith('/workflow')){state.workflowGets++;return json(payload);}
        if(method==='PUT'&&(path.endsWith('/workflow/kickoff')||path.endsWith('/workflow/site-survey'))){state.saveAttempts++;state.lastSave=JSON.parse(init.body);if(params.has('pending-save'))return new Promise(resolve=>{state.releaseSave=()=>resolve(json(payload));});return json({error:'합성 업무 기록 저장 실패'},503);}
        if(method==='PUT'&&path.includes('/stages/')){state.schedulePuts=(state.schedulePuts||0)+1;return json({schedule:{startDate:'2026-09-30',endDate:'2026-09-30',status:'PLANNED',noteText:'이전 단계 지연 저장',version:2}});}
        if(path.endsWith('/evidence')){
          if(method==='POST'){state.uploads++;return json({file:{id:'source-1',originalName:'cf117.txt',storageProvider:'GOOGLE_DRIVE'}});}
          return json({files:[],googleDriveConnected:true,storagePolicy:'GOOGLE_DRIVE_REQUIRED'});
        }
        if(path.endsWith('/workflow/ai-import')){state.ai++;return new Promise(resolve=>{state.release=()=>resolve(json({error:'합성 지연 AI 종료'},503));});}
        return json({});
      };
      const root=createRoot(document.getElementById('root'));
      if(params.has('route-switch')){
        schedule.stages[0].startDate='2026-09-17';schedule.stages[0].endDate='2026-09-17';
        schedule.stages[1].startDate='2026-09-21';schedule.stages[1].endDate='2026-09-21';
        const {RouterView}=await import('/src/routes/Router.tsx');
        const {requestNavigation}=await import('/src/navigation-guard.ts');
        const navigate=path=>{const proceed=()=>root.render(React.createElement(RouterView,{currentPath:path,roles:['admin'],previewMode:true,onNavigate:navigate}));if(!requestNavigation(path,proceed))proceed();};
        state.navigate=navigate;navigate('/workflow/site-survey');
      }else root.render(React.createElement(WorkflowOperations,{routeId:kind,roles:['admin'],onNavigate:()=>{}}));
    ` : undefined
  }] });
  await server.listen();
  const origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(path => path && existsSync(path));
  assert.ok(executablePath, 'Set CHROME_PATH to an installed Chrome/Chromium executable.');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await t.test('CF145 actual Router reloads each stage schedule and preserves cancelled dirty navigation', async () => {
      const page=await browser.newPage({timezoneId:'UTC'});
      try{
        await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
        await page.goto(`${origin}/cf117-workflow-schedule.html?kind=WF-04&route-switch=1`);
        const start=page.locator('.shared-stage-schedule').getByLabel('시작일',{exact:true});
        await page.waitForFunction(()=>document.querySelector('.shared-stage-schedule input')?.value==='2026-09-21');
        await page.locator('textarea.is-tall').fill('이동 취소 시 보존할 원문');
        page.once('dialog',dialog=>dialog.dismiss());
        await page.evaluate(()=>(window as any).cf117.navigate('/workflow/kickoff'));
        assert.equal(await page.getByLabel('조사 일자',{exact:true}).count(),1);
        assert.equal(await page.locator('textarea.is-tall').inputValue(),'이동 취소 시 보존할 원문');
        page.once('dialog',dialog=>dialog.accept());
        await page.evaluate(()=>(window as any).cf117.navigate('/workflow/kickoff'));
        await page.getByLabel('회의 일시',{exact:true}).waitFor();
        await page.waitForFunction(()=>(window as any).cf117.scheduleGets>=2,{},{timeout:5000});
        assert.equal(await start.inputValue(),'2026-09-17');
        await page.evaluate(()=>(window as any).cf117.navigate('/workflow/site-survey'));
        await page.getByLabel('조사 일자',{exact:true}).waitFor();
        await page.waitForFunction(()=>document.querySelector('.shared-stage-schedule input')?.value==='2026-09-21');
        assert.equal(await start.inputValue(),'2026-09-21');
        assert.equal(await page.evaluate(()=>(window as any).cf117.saveAttempts),0);
      }finally{await page.close();}
    });
    await t.test('CF145 late saved survey response cannot replace the current kickoff schedule', async () => {
      const page=await browser.newPage({timezoneId:'UTC'});
      try{
        await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
        await page.goto(`${origin}/cf117-workflow-schedule.html?kind=WF-04&route-switch=1&pending-save=1`);
        await page.getByLabel('조사 일자',{exact:true}).waitFor();
        await page.locator('textarea.is-tall').fill('이전 조사 저장');
        await page.getByRole('button',{name:'기록 저장',exact:true}).click();
        await page.waitForFunction(()=>typeof (window as any).cf117.releaseSave==='function');
        page.once('dialog',dialog=>dialog.accept());
        await page.evaluate(()=>(window as any).cf117.navigate('/workflow/kickoff'));
        await page.waitForFunction(()=>document.querySelector('.shared-stage-schedule input')?.value==='2026-09-17');
        await page.evaluate(()=>(window as any).cf117.releaseSave());
        await page.waitForFunction(()=>(window as any).cf117.schedulePuts===1);
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        assert.equal(await page.locator('.shared-stage-schedule').getByLabel('시작일',{exact:true}).inputValue(),'2026-09-17');
        assert.equal(await page.getByText('이전 단계 지연 저장',{exact:true}).count(),0);
        assert.equal(await page.getByLabel('회의 일시',{exact:true}).count(),1);
      }finally{await page.close();}
    });
    for (const kind of ['WF-03', 'WF-04']) {
      await t.test(`${kind}: CF145 grouped fields preserve status, attendees, dates, preview and responsive order`, async () => {
        const page=await browser.newPage({viewport:{width:1920,height:1080},timezoneId:'UTC'});
        try {
          await page.route('**/*', route => new URL(route.request().url()).origin===origin?route.continue():route.abort());
          await page.goto(`${origin}/cf117-workflow-schedule.html?kind=${kind}`);
          const date=page.getByLabel(kind==='WF-03'?'회의 일시':'조사 일자',{exact:true});await date.waitFor();
          const timeRow=page.locator('.minutes-row').first();
          assert.equal(await timeRow.locator('input').count(),kind==='WF-03'?2:3);
          assert.equal(await page.getByLabel('회의 상태',{exact:true}).count(),0);assert.equal(await page.getByLabel('진행 상태',{exact:true}).count(),0);
          await page.getByLabel('종료 시간',{exact:true}).fill('11:45');
          if(kind==='WF-04')await page.getByLabel('시작 시간',{exact:true}).fill('10:15');
          await page.getByLabel('참석자 (컨코스트)',{exact:true}).fill('내부 참석자');
          await page.getByLabel('참석자 (거래처)',{exact:true}).fill('거래처 참석자');
          assert.equal(await page.locator('.minutes-row--two input').count(),2);
          const preview=await page.locator('.company-minutes-table').innerText();
          for(const value of ['11:45','내부 참석자','거래처 참석자'])assert.ok(preview.includes(value));
          const positions=await page.locator('[aria-label="작성자 정보"] input').evaluateAll(inputs=>inputs.map(i=>({x:i.getBoundingClientRect().x,y:i.getBoundingClientRect().y,right:i.getBoundingClientRect().right})));
          assert.equal(new Set(positions.map(p=>p.y)).size,1);assert.equal(new Set(positions.map(p=>p.x)).size,3);
          assert.ok(positions[0].right<positions[1].x&&positions[1].right<positions[2].x,'adjacent fields never overlap');
          await page.getByRole('button',{name:'기록 저장',exact:true}).click();await page.getByText('합성 업무 기록 저장 실패',{exact:true}).waitFor();
          const saved=await page.evaluate(()=>(window as any).cf117.lastSave);
          assert.equal(saved.status,kind==='WF-03'?'DRAFTED':'IN_PROGRESS');assert.equal(saved.minutesFields.meetingEndTime,'11:45');assert.equal(saved.minutesFields.clientParticipants,'거래처 참석자');
          if(kind==='WF-03')assert.deepEqual(saved.participantUnits,['내부 참석자']);else {assert.equal(saved.minutesFields.participants,'내부 참석자');assert.equal(saved.minutesFields.meetingStartTime,'10:15');}
          mkdirSync('output/playwright',{recursive:true});
          await page.locator('.minutes-fields').screenshot({path:`output/playwright/cf145-${kind}-desktop.png`});
          await page.setViewportSize({width:390,height:844});
          const boxes=await page.locator('.minutes-fields input').evaluateAll(inputs=>inputs.map(i=>({left:i.getBoundingClientRect().left,right:i.getBoundingClientRect().right,width:i.getBoundingClientRect().width})));
          assert.ok(boxes.every(b=>b.width>0&&b.left>=0&&b.right<=390),'minutes fields fit mobile viewport');
          const mobile=await page.locator('[aria-label="작성자 정보"] input').evaluateAll(inputs=>inputs.map(i=>i.getBoundingClientRect().x));assert.equal(new Set(mobile).size,1);
          await page.locator('.minutes-fields').screenshot({path:`output/playwright/cf145-${kind}-mobile.png`});
          assert.equal(await page.getByLabel('종료 시간',{exact:true}).inputValue(),'11:45');
        } finally {await page.close();}
      });
      await t.test(`${kind}: initial schedule failure leaves the form/importer usable and schedule-only retry preserves a new record`, async () => {
        const page = await browser.newPage({ timezoneId: 'UTC' });
        try {
          const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
          await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
          await page.goto(`${origin}/cf117-workflow-schedule.html?kind=${kind}&schedule-failure=1&empty=1`);
          await page.waitForFunction(() => (window as any).cf117?.workflowGets === 1 && (window as any).cf117?.scheduleGets === 1);
          const importer = page.getByLabel('자동정리할 원본 파일');
          await importer.waitFor({ timeout: 3000 });
          assert.equal(await importer.isDisabled(), false, 'a failed schedule dependency must not hide or disable document importing');
          const date = page.getByLabel(kind === 'WF-03' ? '회의 일시' : '조사 일자', { exact: true });
          const chosenDate = kind === 'WF-03' ? '2026-09-21T14:30' : '2026-09-21';
          await date.fill(chosenDate);
          await page.locator('textarea.is-tall').fill('일정 재조회 중 보존할 미저장 원문');
          assert.equal(await page.locator('textarea.is-tall').isEditable(), true);
          const retry = page.getByRole('button', { name: /일정.*(?:다시|재시도)/u });
          assert.equal(await retry.count(), 1, 'a schedule-only retry is offered separately from full record reload');
          await page.evaluate(() => { (window as any).cf117.scheduleFailure = false; });
          await retry.click();
          await page.waitForFunction(() => (window as any).cf117.scheduleGets === 2 && document.querySelector('.shared-stage-schedule')?.textContent?.includes('합성 PM'));
          assert.equal(await page.evaluate(() => (window as any).cf117.workflowGets), 1, 'schedule retry does not reload the workflow record');
          assert.equal(await date.inputValue(), chosenDate, 'schedule dates do not replace the operator-selected meeting/survey date');
          assert.equal(await page.locator('textarea.is-tall').inputValue(), '일정 재조회 중 보존할 미저장 원문');
          assert.equal(await importer.isDisabled(), false);
          assert.deepEqual(errors, []);
        } finally { await page.close(); }
      });
      await t.test(`${kind}: canceling a whole-record reload retains dirty inputs and import locks reload`, async () => {
        const page = await browser.newPage({ timezoneId: 'UTC' });
        try {
          const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
          await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
          await page.goto(`${origin}/cf117-workflow-schedule.html?kind=${kind}`);
          const date = page.getByLabel(kind === 'WF-03' ? '회의 일시' : '조사 일자', { exact: true });
          await date.waitFor();
          const chosenDate = kind === 'WF-03' ? '2026-09-22T15:45' : '2026-09-22';
          await date.fill(chosenDate);
          await page.getByLabel(kind === 'WF-03' ? /^회의명·안건/u : /^조사 범위/u).fill('아직 저장하지 않은 업무 범위');
          await page.locator('textarea.is-tall').fill('재조회 취소 시 보존할 미저장 원문');
          await page.getByRole('button', { name: '기록 저장', exact: true }).click();
          await page.getByText('합성 업무 기록 저장 실패', { exact: true }).waitFor();
          const reload = page.getByRole('button', { name: '다시 불러오기', exact: true });
          const confirmations: string[] = [];
          page.once('dialog', dialog => { confirmations.push(dialog.message()); void dialog.dismiss(); });
          await reload.click();
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          assert.equal(confirmations.length, 1, 'discarding dirty inputs requires explicit confirmation');
          assert.equal(await page.evaluate(() => (window as any).cf117.workflowGets), 1, 'cancel must not request fresh server data');
          assert.equal(await date.inputValue(), chosenDate);
          assert.equal(await page.locator('textarea.is-tall').inputValue(), '재조회 취소 시 보존할 미저장 원문');
          await page.getByLabel('자동정리할 원본 파일').setInputFiles({ name: 'cf117.txt', mimeType: 'text/plain', buffer: Buffer.from('합성 파일 원문') });
          await page.waitForFunction(() => (window as any).cf117.ai === 1);
          assert.equal(await reload.isDisabled(), true, 'reload cannot unmount the importer while its request is in progress');
          await page.evaluate(() => (window as any).cf117.release());
          await page.getByText('합성 지연 AI 종료', { exact: true }).waitFor();
          assert.equal(await date.inputValue(), chosenDate);
          assert.equal(await page.locator('textarea.is-tall').inputValue(), '재조회 취소 시 보존할 미저장 원문');
          assert.deepEqual(errors, []);
        } finally { await page.close(); }
      });
    }
  } finally { await browser.close(); await server.close(); }
});
