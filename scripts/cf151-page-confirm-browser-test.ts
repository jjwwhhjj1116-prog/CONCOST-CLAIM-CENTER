import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

test('whole-page confirmation preserves cancel, keyboard, abort and duplicate safety', async () => {
  const {createServer}=await import('../apps/web/qa/vite-server.js');
  const server=await createServer({root:resolve('apps/web'),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{name:'confirm-test',configureServer(s){s.middlewares.use(async(req,res,next)=>{
    if(req.url!=='/confirm-test')return next();
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await s.transformIndexHtml(req.url,'<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><button id="open">가져오기</button><script type="module">import{confirmReportPages,confirmAppAction}from"/src/documents/confirm-report-pages.ts";window.confirmPages=confirmReportPages;window.confirmAction=confirmAppAction;</script></body></html>'));
  });}}]});
  await server.listen();
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage();const errors:string[]=[];let nativeDialogs=0;
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{nativeDialogs++;void d.dismiss();});
    await page.goto('http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port+'/confirm-test');
    await page.waitForFunction(()=>typeof (window as any).confirmPages==='function');
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:900});
      for(const action of ['cancel','confirm','escape','abort','popstate','enter']){
        await page.getByRole('button',{name:'가져오기',exact:true}).focus();
        await page.evaluate(()=>{const w=window as any;w.result=undefined;w.controller=new AbortController();void w.confirmPages(17,'HWP',w.controller.signal).then((r:boolean)=>w.result=r);});
        assert.equal(await page.locator('dialog').count(),1);
        assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'취소 · 기존 원고 유지');
        assert.equal(await page.evaluate(()=>{const r=document.querySelector('dialog')!.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),true);
        assert.equal(await page.evaluate(()=>(window as any).confirmPages(1,'PDF',new AbortController().signal)),false);
        if(action==='confirm')await page.getByRole('button',{name:'17쪽 전체 적용',exact:true}).click();
        else if(action==='cancel')await page.getByRole('button',{name:'취소 · 기존 원고 유지',exact:true}).click();
        else if(action==='escape')await page.keyboard.press('Escape');
        else if(action==='enter')await page.keyboard.press('Enter');
        else if(action==='abort')await page.evaluate(()=>(window as any).controller.abort());
        else await page.evaluate(()=>window.dispatchEvent(new PopStateEvent('popstate')));
        await page.waitForFunction(()=>(window as any).result!==undefined);
        assert.equal(await page.evaluate(()=>(window as any).result),action==='confirm');
        assert.equal(await page.locator('dialog').count(),0);
        assert.equal(await page.evaluate(()=>document.activeElement?.id),'open');
      }
    }
    for(const decision of ['수주 확정','접수 취소']){
      for(const accept of [false,true]){
        await page.evaluate(({decision})=>{const w=window as any;w.result=undefined;void w.confirmAction(decision,'합성 시험 사건만 처리합니다.','확인 · '+decision,new AbortController().signal).then((r:boolean)=>w.result=r);},{decision});
        assert.equal(await page.getByRole('dialog',{name:decision,exact:true}).count(),1);
        assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'취소 · 기존 상태 유지');
        await page.getByRole('button',{name:accept?'확인 · '+decision:'취소 · 기존 상태 유지',exact:true}).click();
        await page.waitForFunction(()=>(window as any).result!==undefined);
        assert.equal(await page.evaluate(()=>(window as any).result),accept);
      }
    }
    assert.equal(nativeDialogs,0);assert.deepEqual(errors,[]);
  }finally{await browser.close();await server.close();}
});
