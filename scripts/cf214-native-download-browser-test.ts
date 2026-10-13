import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createNativeHwp } from '../apps/web/src/documents/editable-hwp-export';
import { readQaNativeEngine } from './cf183-template-source-gate.mjs';

test('CF214 actual SDK download requests never acknowledge persistent save', async t => {
  const approved=readQaNativeEngine(), module=await import(pathToFileURL(resolve(approved.root,'rhwp.js')).href);
  await module.default({module_or_path:approved.wasm});const Engine=module.HwpDocument;
  const bytes=createNativeHwp([{html:'<p>CF214 synthetic draft</p>',text:'CF214 synthetic draft',tables:0,tableCells:[],images:0,width:794,height:1123,margins:{top:40,right:40,bottom:40,left:40}}],Engine);
  const runtime=resolve('pinned-runtime/rhwp'),manifest=JSON.parse(readFileSync(resolve(runtime,'build-manifest.json'),'utf8'));
  for(const file of manifest.files)assert.equal(createHash('sha256').update(readFileSync(resolve(runtime,file.path))).digest('hex'),file.sha256);
  const files=new Set(['index.html','build-manifest.json',...manifest.files.map((file:any)=>file.path)]);
  const {createServer}=await import('../apps/web/qa/vite-server.js');
  const server=await createServer({root:resolve('apps/web'),...(process.env.CF149_CACHE_ROOT?{cacheDir:process.env.CF149_CACHE_ROOT}:{}),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{
    name:'cf214-download-probe',enforce:'pre',
    transform(code,id){
      if(!id.replaceAll('\\','/').endsWith('/RhwpEditorDialog.tsx'))return;
      assert.ok(code.includes('editorRef.current = editor;'));
      // Observe the real SDK method; do not replace its save/dirty behavior.
      return code.replace('editorRef.current = editor;',`editorRef.current = editor;
        window.cf214.editor=editor;
        const notify=editor.notifySaved.bind(editor);
        editor.notifySaved=async(...args)=>{window.cf214.notifications++;return notify(...args);};`);
    },
    configureServer(server){server.middlewares.use(async(req,res,next)=>{
      const pathname=(req.url??'').split('?')[0];
      if(pathname.startsWith('/rhwp/')){const name=pathname.slice(6)||'index.html';if(!files.has(name)){res.statusCode=404;res.end();return;}const file=resolve(runtime,name);assert.ok(file.startsWith(runtime+sep));res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.html')?'text/html':name.endsWith('.json')?'application/json':name.endsWith('.wasm')?'application/wasm':name.endsWith('.css')?'text/css':'application/octet-stream');res.end(readFileSync(file));return;}
      if(pathname==='/original.hwp'){res.end(bytes);return;}
      if(pathname!=='/download-qa.html')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url!,'<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/download-entry.js"></script></body></html>'));
    });},
    resolveId:id=>id==='/download-entry.js'?'\0download-entry':undefined,
    load:id=>id==='\0download-entry'?`
      import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';import{RhwpEditorDialog}from'/src/documents/RhwpEditorDialog.tsx';import'/src/documents/RhwpEditorDialog.css';
      window.__CLAIM_CENTER_RHWP_STUDIO_URL__=location.origin+'/rhwp/';window.cf214={notifications:0,clicks:0,applies:0,closes:0,mode:'normal'};
      const click=HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click=function(){if(this.download){window.cf214.clicks++;if(window.cf214.mode==='cancel')return;if(window.cf214.mode==='throw')throw Error('CF214 synthetic download failure');}return click.call(this);};
      function App(){const[file,setFile]=useState(null);useEffect(()=>{fetch('/original.hwp').then(r=>r.arrayBuffer()).then(b=>setFile(new File([b],'CF214.hwp')));},[]);
        return file?React.createElement(RhwpEditorDialog,{isOpen:true,sourceFile:file,suggestedName:'CF214',documentLabel:'CF214 synthetic',onClose:()=>window.cf214.closes++,onApplyContent:()=>window.cf214.applies++}):null;
      }createRoot(document.getElementById('root')).render(React.createElement(App));
    `:undefined
  }]});await server.listen();
  const origin='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port;
  const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);assert.ok(executablePath);
  const browser=await chromium.launch({executablePath,headless:true});
  try{for(const mode of ['cancel','throw','normal'])await t.test(mode,async()=>{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];
    page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    const ready=()=>Boolean(document.querySelector<HTMLButtonElement>('.rhwp-action-hwp')&&!document.querySelector<HTMLButtonElement>('.rhwp-action-hwp')!.disabled);
    try{
      await page.goto(origin+'/download-qa.html');await page.waitForFunction(ready);
      await page.evaluate(value=>{(window as any).cf214.mode=value;},mode);
      for(const format of ['hwp','hwpx']){
        const downloaded=mode==='normal'?page.waitForEvent('download'):null;
        await page.getByRole('button',{name:format.toUpperCase()+' 다운로드만',exact:true}).click();
        if(downloaded){const file=await downloaded,path=await file.path();assert.ok(path);const doc=new Engine(new Uint8Array(readFileSync(path)));try{assert.equal(doc.pageCount(),1);assert.match(doc.getTextRange(0,0,0,doc.getParagraphLength(0,0)),/CF214 synthetic draft/);}finally{doc.free();}}
        if(mode==='throw')await page.getByRole('alert').filter({hasText:'CF214 synthetic download failure'}).waitFor();
        else await page.waitForFunction(()=>document.querySelector('.rhwp-dialog__status')?.textContent?.includes('다운로드를'));
        await page.waitForFunction(ready);
        assert.equal(await page.evaluate(()=>(window as any).cf214.notifications),0,'A download request is not a persistent-save ACK');
        if(mode!=='throw')assert.match(await page.locator('.rhwp-dialog__status').innerText(),/다운로드를 요청했습니다/);
      }
      assert.equal(await page.evaluate(()=>(window as any).cf214.clicks),2);
      await page.getByRole('button',{name:'HWP 편집기 닫기',exact:true}).click();await page.getByRole('alertdialog').waitFor();
      assert.equal(await page.evaluate(()=>(window as any).cf214.closes),0);
      await page.getByRole('button',{name:'계속 편집',exact:true}).click();
      // Actual native input after the unacknowledged download remains exportable.
      const source=new Engine(bytes);let cursor:any,width:number,height:number;
      try{cursor=JSON.parse(source.getCursorRect(0,0,2));({width,height}=JSON.parse(source.getPageInfo(0)));}finally{source.free();}
      const frame=page.frameLocator('.rhwp-dialog iframe'),canvas=frame.locator('#scroll-content .document-page-canvas').first();await canvas.waitFor();const box=await canvas.boundingBox();assert.ok(box);
      await canvas.click({position:{x:(cursor.x+1)*box.width/width!,y:(cursor.y+cursor.height/2)*box.height/height!}});await page.keyboard.press('End');await page.keyboard.type(' LATE');
      const edited=await page.evaluate(async()=>Array.from(await (window as any).cf214.editor.exportHwp()) as number[]);
      const doc=new Engine(Uint8Array.from(edited));try{assert.match(doc.getTextRange(0,0,0,doc.getParagraphLength(0,0)),/CF214 synthetic draft LATE/);}finally{doc.free();}
      await page.getByRole('button',{name:'현재 HWP 내용을 선택 챕터에 적용',exact:true}).click();await page.waitForFunction(()=>(window as any).cf214.applies===1);await page.waitForFunction(ready);
      assert.equal(await page.evaluate(()=>(window as any).cf214.notifications),0,'Page application must not imply server save');assert.deepEqual(errors,[]);
    }finally{await page.close();}
  });}finally{await browser.close();await server.close();}
});
