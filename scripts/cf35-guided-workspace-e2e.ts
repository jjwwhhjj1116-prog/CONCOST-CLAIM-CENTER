import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { WORKSPACE_TUTORIAL_STEPS } from '../apps/web/src/layout/workspace-help-content';

const root = path.resolve(__dirname, '..');
const distRoot = path.join(root, 'apps', 'web', 'dist');

function browserExecutable(): string {
  const candidates = [process.env.CHROME_PATH ?? '', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) throw new Error('Chrome/Edge executable not found. Set CHROME_PATH for CF35 browser E2E.');
  return found;
}

function staticServer(origin: string): Server {
  const types: Record<string,string> = { '.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml' };
  return createServer((request,response)=>{
    const pathname=decodeURIComponent(new URL(request.url??'/',origin).pathname);
    const requested=pathname==='/'?'index.html':pathname.replace(/^\/+/, '');
    const candidate=path.resolve(distRoot,requested);
    const safe=candidate.startsWith(path.resolve(distRoot)+path.sep);
    const filePath=safe&&fs.existsSync(candidate)&&fs.statSync(candidate).isFile()?candidate:path.join(distRoot,'index.html');
    response.writeHead(200,{'Cache-Control':'no-store','Content-Type':types[path.extname(filePath)]??'application/octet-stream'});
    fs.createReadStream(filePath).pipe(response);
  });
}

async function listen(server:Server):Promise<number>{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return (server.address()as{port:number}).port;}

async function assertCoachFitsViewport(page: import('playwright-core').Page):Promise<void>{
  const metrics=await page.getByRole('complementary',{name:'처음 사용하는 분을 위한 클레임센터 업무 순서'}).evaluate((panel)=>{
    const rect=panel.getBoundingClientRect();
    const style=getComputedStyle(panel);
    return {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,clientWidth:panel.clientWidth,scrollWidth:panel.scrollWidth,viewportWidth:window.innerWidth,viewportHeight:window.innerHeight,documentOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,backdropFilter:style.backdropFilter};
  });
  assert.ok(metrics.left>=8,`coach starts outside viewport: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.top>=8,`coach starts above viewport: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.right<=metrics.viewportWidth-8,`coach ends outside viewport: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.bottom<=metrics.viewportHeight-8,`coach ends below viewport: ${JSON.stringify(metrics)}`);
  if(metrics.viewportWidth>760)assert.ok(metrics.width<=640,`desktop coach exceeds the game-guide maximum: ${JSON.stringify(metrics)}`);
  else assert.ok(metrics.width<=metrics.viewportWidth-16,`mobile coach must fit the viewport: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.scrollWidth<=metrics.clientWidth+1,`coach content overflows horizontally: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.documentOverflow<=1,`document overflows horizontally: ${JSON.stringify(metrics)}`);
  assert.ok(!metrics.backdropFilter||metrics.backdropFilter==='none',`coach must not blur the page: ${JSON.stringify(metrics)}`);
}

async function main():Promise<void>{
  if(!fs.existsSync(path.join(distRoot,'index.html')))throw new Error('Run cf:build before CF35 E2E.');
  const server=staticServer('http://127.0.0.1');
  const port=await listen(server);
  const origin=`http://127.0.0.1:${port}`;
  let browser:Browser|undefined;
  let tutorialVersion:string|null=null;
  let completionAction:'COMPLETED'|'SKIPPED'|null=null;
  let stateVersion=0;
  let completionWrites=0;
  try{
    browser=await chromium.launch({executablePath:browserExecutable(),headless:true});
    const context=await browser.newContext({viewport:{width:1440,height:900}});
    const page=await context.newPage();
    await page.route('**/auth/session',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'00000000-0000-4000-8000-000000000002',email:'guide@example.invalid',name:'신규 사용자',organizationId:'concost',roles:['staff'],previewMode:true})}));
    await page.route('**/api/settings/tutorial',async route=>{
      if(route.request().method()==='PUT'){
        const body=route.request().postDataJSON()as{tutorialVersion:string;expectedVersion:number;action:'COMPLETED'|'SKIPPED'};
        assert.equal(body.expectedVersion,stateVersion);
        tutorialVersion=body.tutorialVersion;completionAction=body.action;stateVersion+=1;completionWrites+=1;
      }
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tutorial:{completedTutorialVersion:tutorialVersion,completedAt:tutorialVersion?new Date().toISOString():null,completionAction,version:stateVersion,updatedAt:tutorialVersion?new Date().toISOString():null},currentTutorialVersion:'CF79_V1',phase:'CF79_RENEWED_TUTORIAL'})});
    });
    await page.route('**/api/preview/draft',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({draft:{title:'가이드 검증 초안',content:'검증용 합성 메모',updatedAt:null}})}));
    await page.route('**/api/cases?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({cases:[],total:0,page:1,limit:100})}));
    await page.route('**/api/dashboard/kpi',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      totalCases:12,inProgressCount:7,reviewingDocsCount:3,todayTasksCount:4,delayedCount:1,
      recentCases:[{id:'case-1',caseNumber:'CC-2026-00001',title:'모바일 화면 검증 프로젝트',claimType:'TYPE-03',status:'REPORT_DRAFTING',updatedAt:new Date().toISOString()}],
      upcomingSchedules:[{id:'schedule-1',title:'착수회의',type:'KICKOFF',date:new Date().toISOString(),case:{id:'case-1',caseNumber:'CC-2026-00001',title:'모바일 화면 검증 프로젝트'},dDayInfo:{dDayStr:'D-1',isOverdue:false,isToday:false,diffDays:1}}],
      projectScheduleReminders:[{id:'reminder-1',caseId:'case-1',caseNumber:'CC-2026-00001',caseTitle:'모바일 화면 검증 프로젝트',stageCode:'REPORT',stageLabel:'보고서 작성',startDate:'2026-08-25',endDate:'2026-08-31',status:'PLANNED',noteText:'태블릿과 모바일 알림 긴 문장 표시 검증',responsiblePmName:'이경훈',overdue:false,dDayInfo:{dDayStr:'D-6'}}],
      projectNotifications:[{id:'notice-1',caseId:'case-1',caseNumber:'CC-2026-00001',notificationType:'SCHEDULE_CHANGED',title:'현장조사 일정 변경',message:'담당 PM 확인이 필요한 일정 변경 요청입니다.',createdAt:new Date().toISOString()}]
    })}));

    await page.goto(`${origin}/`,{waitUntil:'domcontentloaded'});
    await page.waitForURL(`${origin}/dashboard`);
    assert.equal(await page.getByText(/페이지를 찾을 수 없습니다 \(404\)/u).count(),0);
    const coach=page.getByRole('complementary',{name:'처음 사용하는 분을 위한 클레임센터 업무 순서'});
    await coach.waitFor({state:'visible',timeout:10_000});
    await assertCoachFitsViewport(page);
    assert.equal(await page.locator('.modal-backdrop').count(),0,'first-run guide must not use a blocking or blurred backdrop');
    for(let index=0;index<WORKSPACE_TUTORIAL_STEPS.length;index+=1){
      const expected=WORKSPACE_TUTORIAL_STEPS[index];
      assert.match(await coach.innerText(),new RegExp(expected.title.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&'),'u'));
      await coach.getByRole('button',{name:`${expected.pathLabel} · 안내 시작`,exact:true}).click();
      await page.waitForURL((url)=>url.pathname===expected.path,{timeout:10_000});
      assert.match(await coach.innerText(),/직접 눌러 보세요/u);
      await page.locator('.workspace-tutorial-target').first().waitFor({state:'visible',timeout:10_000});
      assert.equal(await page.locator('.workspace-tutorial-target').count(),1,`${expected.path} must focus one game tutorial target at a time`);
      assert.equal(await page.locator('.workspace-tutorial-shade').count(),4,`${expected.path} needs a four-sided spotlight`);
      assert.equal(await page.locator('.modal-backdrop').count(),0,`${expected.path} must remain visible and interactive`);
      for(let point=0;point<expected.tasks.length;point+=1){
        const focus=page.locator('.workspace-tutorial-focus-source').first();
        await focus.waitFor({state:'visible',timeout:10_000});
        await focus.evaluate((element)=>(element as HTMLElement).click());
        await page.waitForTimeout(260);
      }
      assert.match(await coach.innerText(),/핵심 기능 확인 완료/u);
      if(index<WORKSPACE_TUTORIAL_STEPS.length-1)await coach.getByRole('button',{name:'다음 설명 →'}).click();
    }
    await coach.getByRole('button',{name:'튜토리얼 완료'}).click();
    await coach.waitFor({state:'hidden'});
    assert.equal(completionWrites,1);
    assert.equal(completionAction,'COMPLETED');
    console.log(`  1/5 game-style first-run tutorial spotlights one live control at a time across all ${WORKSPACE_TUTORIAL_STEPS.length} workflow screens and persists completion PASS`);

    await page.goto(`${origin}/dashboard`,{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'현재 화면 도움말 열기'}).click();
    const help=page.getByRole('dialog',{name:'도움말 · HOME'});
    await help.waitFor({state:'visible'});
    for(const label of ['먼저 준비할 것','이 화면에서 하는 일','완료되면 남는 것','실수 방지'])assert.match(await help.innerText(),new RegExp(label));
    await help.getByRole('button',{name:'현재 화면에서 계속하기'}).click();
    console.log('  2/5 category help exposes input, action, output and caution guidance PASS');

    await page.goto(`${origin}/reports/studio`,{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'현재 화면 도움말 열기'}).click();
    const reportHelp=page.getByRole('dialog',{name:'도움말 · 프로젝트 워크'});
    await reportHelp.waitFor({state:'visible'});
    const reportText=await reportHelp.innerText();
    for(const label of ['프로젝트·완제품 템플릿 열람','목차 AI 생성·직접 편집','챕터별 근거 기반 AI 초안','Tiptap 사람 편집','검토·승인 후 HWP·DOCX·PDF 출력'])assert.match(reportText,new RegExp(label));
    console.log('  3/5 report help keeps the exact five-step authoring order PASS');

    await page.reload({waitUntil:'domcontentloaded'});
    assert.equal(await page.getByRole('complementary',{name:'처음 사용하는 분을 위한 클레임센터 업무 순서'}).count(),0);
    await page.setViewportSize({width:640,height:900});
    await page.getByRole('button',{name:'현재 화면 도움말 열기'}).click();
    await page.getByRole('button',{name:'전체 튜토리얼 다시 보기'}).click();
    await page.getByRole('complementary',{name:'처음 사용하는 분을 위한 클레임센터 업무 순서'}).waitFor({state:'visible'});
    await assertCoachFitsViewport(page);
    await page.setViewportSize({width:1024,height:900});
    await assertCoachFitsViewport(page);
    await page.setViewportSize({width:1440,height:900});
    await assertCoachFitsViewport(page);
    console.log('  4/5 completed tutorial stays closed and reopened non-modal coach fits 640/1024/1440px without clipping PASS');

    await coach.getByRole('button',{name:'가이드 건너뛰기'}).click();
    await page.goto(`${origin}/dashboard`,{waitUntil:'domcontentloaded'});
    await page.locator('.dashboard-page').waitFor({state:'visible'});
    for(const viewport of [{width:390,height:844,columns:1},{width:768,height:1024,columns:2},{width:1024,height:900,columns:2}]){
      await page.setViewportSize({width:viewport.width,height:viewport.height});
      await page.waitForTimeout(180);
      const responsive=await page.evaluate(()=>({
        documentOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        sidebarCount:document.querySelectorAll('.sidebar').length,
        menuVisible:document.querySelector<HTMLButtonElement>('button[aria-label="메인 메뉴 드로어 열기"]')?.offsetParent!==null,
        kpiColumns:getComputedStyle(document.querySelector('.dashboard-kpi-grid')!).gridTemplateColumns.split(' ').filter(Boolean).length,
        dashboardColumns:getComputedStyle(document.querySelector('.dashboard-columns')!).gridTemplateColumns.split(' ').filter(Boolean).length,
        heroRight:document.querySelector('.dashboard-hero')!.getBoundingClientRect().right,
        viewportWidth:window.innerWidth
      }));
      assert.ok(responsive.documentOverflow<=1,`${viewport.width}px dashboard overflows horizontally: ${JSON.stringify(responsive)}`);
      assert.equal(responsive.sidebarCount,0,`${viewport.width}px must use the drawer instead of a fixed sidebar`);
      assert.equal(responsive.menuVisible,true,`${viewport.width}px must expose the menu drawer button`);
      assert.equal(responsive.kpiColumns,viewport.columns,`${viewport.width}px KPI column count mismatch`);
      assert.equal(responsive.dashboardColumns,viewport.width<=760?1:2,`${viewport.width}px dashboard work column count mismatch`);
      assert.ok(responsive.heroRight<=responsive.viewportWidth+1,`${viewport.width}px hero is clipped`);
    }
    console.log('  5/5 dashboard fits 390px mobile and 768/1024px tablet layouts with drawer navigation PASS');
    await context.close();
    console.log('✅ CF35 guided workspace browser E2E PASS (5 flows)');
  }finally{
    await browser?.close();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
}

void main().catch((error)=>{console.error(error);process.exitCode=1;});
