import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('CF145 real print UI defaults to every month and preserves range through language, colour and both print actions',async()=>{
  const {createServer}=await import('../apps/web/qa/vite-server.js');
  const server=await createServer({root:fileURLToPath(new URL('../apps/web',import.meta.url)),server:{host:'127.0.0.1',port:0},logLevel:'error'});
  await server.listen();const origin=`http://127.0.0.1:${(server.httpServer!.address() as {port:number}).port}`;
  const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find(p=>p&&existsSync(p));assert.ok(executablePath);
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await page.goto(origin+'/qa/cf102-workflows.html?view=print');
    const sheets=page.locator('.schedule-print-sheet');await sheets.first().waitFor();
    assert.equal(await sheets.count(),2);
    assert.match(await sheets.nth(0).innerText(),/2026년 9월/);assert.match(await sheets.nth(1).innerText(),/2026년 10월/);
    assert.equal(await page.getByRole('button',{name:'전체 일정',exact:true}).getAttribute('aria-pressed'),'true');
    await page.getByRole('button',{name:'한 달',exact:true}).click();assert.equal(await sheets.count(),1);
    await page.getByLabel('출력 월',{exact:true}).fill('2026-11');assert.match(await sheets.first().innerText(),/2026년 11월/);
    await page.getByRole('button',{name:'전체 일정',exact:true}).click();assert.equal(await sheets.count(),2);
    await page.getByRole('button',{name:'흑백',exact:true}).click();await page.getByRole('button',{name:'Tiếng Việt',exact:true}).click();
    assert.equal(await sheets.count(),2);assert.ok(page.url().includes('scope=all'));
    await page.evaluate(()=>{(window as any).printPages=[];window.print=()=>{(window as any).printPages.push(document.querySelectorAll('.schedule-print-sheet').length);};});
    await page.getByRole('button',{name:'Lưu PDF',exact:true}).click();await page.waitForFunction(()=>(window as any).printPages.length===1);
    await page.getByRole('button',{name:'In',exact:true}).click();await page.waitForFunction(()=>(window as any).printPages.length===2);
    assert.deepEqual(await page.evaluate(()=>(window as any).printPages),[2,2]);
    await page.emulateMedia({media:'print'});assert.equal(await page.locator('.schedule-print-toolbar').isVisible(),false);
    const sizes=await sheets.evaluateAll(els=>els.map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,overflow:el.scrollHeight>el.clientHeight+1})));
    assert.ok(sizes.every(s=>s.width>1120&&s.width<1125&&s.height>790&&s.height<797&&!s.overflow));
    await page.emulateMedia({media:'screen'});await page.getByRole('button',{name:'Màu',exact:true}).click();
    mkdirSync('output/playwright',{recursive:true});await page.screenshot({path:'output/playwright/cf145-print-all.png',fullPage:true});
  } finally {await browser.close();await server.close();}
});
