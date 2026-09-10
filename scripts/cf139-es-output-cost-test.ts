import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { newEsInput, calculateEs, validateEsInput } from '../packages/document-engine/src/es-calculation';
import { esTemplateGrids, esTemplateStyles, esTemplateValues, esCellPosition } from '../packages/document-engine/src/es-template';
import { esPrintNumber } from '../apps/web/src/es/es-template-print';
import { esTemplateSheetXml } from '../apps/web/src/es/es-template-xlsx';
function fixture() {
  const i=newEsInput(); i.title='CF139 출력·비목 합성 검수'; i.baseDate='2024-01-01'; i.adjustmentDate='2024-03-01'; i.contractAmount='123456789012'; i.costs[11]='100000';
  i.advanceContract='3000000000'; i.advancePaid='1000000000'; i.contract!.plannedProgress='50'; i.contract!.actualProgress='0.5';
  for(const [p,date,wage] of [[i.base,i.baseDate,'100'],[i.current.period,i.adjustmentDate,'106'],[i.previous.period,'2024-02-29','105']] as const) {
    p.date=date; p.wage=wage; p.materials=['100','100','100','100']; for(const k of Object.keys(p.rates) as (keyof typeof p.rates)[]) p.rates[k]='1'; p.rates.injury='3.7';
  }
  i.current.period.rates.injury='3.56';
  for(const c of [i.current,i.previous]) for(const p of [c.machinery,...c.standards]) Object.assign(p,{commonCount:'1',baseAverage:'100',comparisonAverage:'101'});
  assert.equal(calculateEs(i).status,'LEGACY_REPLAY'); return i;
}
const grid=(name:string)=>esTemplateGrids.find(g=>g.name===name)!;
const style=(name:string,address:string)=>{const g=grid(name),[r,c]=esCellPosition(address);return esTemplateStyles[new Map(g.cellStyles).get(address)??g.rowStyles?.[r]??g.columns[c]?.style??0];};
const displayed=(name:string,address:string,i=fixture())=>esPrintNumber(esTemplateValues(i,calculateEs(i),grid(name))[address],style(name,address).numberFormat).trim();
test('CF139 percentage units appear once and exported fractions retain native numeric formatting',()=>{
  const i=fixture(), before=JSON.stringify(i), result=calculateEs(i);
  for(const [name,address,expected] of [['2','C16','6.00'],['2','C21','33.33'],['2.','C14','5'],['1','D14','6.00%'],['2.2(선금)','C10','33.33%'],['2.2(선금)','C16','6.00%'],['4','D165','3.70%'],['4','H165','3.56%'],['4.','D165','3.70%'],['1','J21','50.00%'],['1','J22','0.50%'],['2','C13','50.00'],['2','C14','0.50']]) assert.equal(displayed(name,address),expected,`${name}!${address}`);
  for(const g of esTemplateGrids) {
    const values=esTemplateValues(i,result,g), xml=esTemplateSheetXml(g,values);
    for(const [a,path] of Object.entries(g.fields)) if(values[a]!=='—' && (path.endsWith(':percent')||style(g.name,a).numberFormat.includes('%'))) {
      assert.match(values[a],/^-?\d+(\.\d+)?$/); const cell=xml.match(new RegExp(`<c r="${a}"[^>]*>[\\s\\S]*?<\\/c>`))![0]; assert.doesNotMatch(cell,/inlineStr/);
    }
  }
  assert.equal(JSON.stringify(i),before); assert.deepEqual(calculateEs(i),result);
  i.advanceContract='';assert.match(esTemplateValues(i,calculateEs(i),grid('2.2(선금)')).A21,/미입력/);
});
test('CF139 expense composition changes K; proportional cost and contract-only changes do not allocate costs',()=>{
  const i=fixture(), a=calculateEs(i); i.costs[11]='200000'; const b=calculateEs(i); assert.equal(b.current!.k,a.current!.k);
  i.costs[18]='200000'; const c=calculateEs(i); assert.equal(c.current!.k,'0.03'); assert.equal(c.current!.denominator,'400000'); assert.equal(c.amount!.applicable,a.amount!.applicable);
  const costs=structuredClone(i.costs); i.contractAmount='1000000000'; assert.deepEqual(validateEsInput(i).costs,costs); assert.equal(calculateEs(i).amount!.applicable,'1000000000'); assert.equal(calculateEs(i).current!.k,c.current!.k);
});
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
test('CF139 Chromium: all 17 sheets retain cells without text spill; actual cost editing, save and reopen', {skip:!executablePath,timeout:90000}, async()=>{
  const {createServer}=await import('../apps/web/node_modules/vite/dist/node/index.js');
  const server=await createServer({root:resolve('apps/web'),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{name:'cf139-harness',enforce:'pre',
    transform(code:string,id:string){if(id.replaceAll('\\','/').split('?')[0].endsWith('/es/EsPrintPreview.tsx'))return code+'\nexport {PRINT_CSS};';},
    resolveId(id:string){if(id==='/cf139-ui.js')return '\0cf139-ui';},
    load(id:string){if(id==='\0cf139-ui')return `import React from 'react';import {createRoot} from 'react-dom/client';import {EsStudio} from '/src/es/EsStudio.tsx';createRoot(document.getElementById('root')).render(React.createElement(EsStudio,{mode:'editor',search:'?documentId=cf139-local',onNavigate:()=>{}}));`;}
  }]} as any);
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try {
    await server.listen(); const addr=server.httpServer!.address(); assert.ok(addr&&typeof addr==='object'); const origin=`http://127.0.0.1:${addr.port}`;
    browser=await chromium.launch({executablePath,headless:true}); const page=await browser.newPage({viewport:{width:1200,height:1300}}); page.setDefaultTimeout(10000);
    const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{const u=new URL(route.request().url()); if(u.origin!==origin)return route.abort(); if(u.pathname==='/cf139-print')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><head><meta charset="UTF-8"></head><body></body></html>'});return route.continue();});
    await page.goto(origin+'/cf139-print'); const input=fixture();
    const grids=esTemplateGrids.map(g=>({grid:g,values:esTemplateValues(input,calculateEs(input),g)}));
    const measured=await page.evaluate(async(grids)=>{
      const rp='/src/es/es-template-print.ts',pp='/src/es/EsPrintPreview.tsx'; const {paginateEsTemplate}=await import(rp),{PRINT_CSS}=await import(pp);
      const css=document.createElement('style');css.textContent=PRINT_CSS;document.head.append(css);await document.fonts.ready;
      const m=document.createElement('div');document.body.append(m);const counts:Record<string,number>={};
      const pages=grids.flatMap(({grid,values})=>{const p=paginateEsTemplate(grid,values,m);counts[grid.name]=p.length;return p;});m.remove();document.body.innerHTML=pages.join('');
      const spills:string[]=[];const cells:string[]=[];
      for(const paper of document.querySelectorAll<HTMLElement>('.es-paper'))for(const td of paper.querySelectorAll<HTMLTableCellElement>('td[data-cell]')){
        cells.push(`${paper.dataset.sheet}!${td.dataset.cell}`);const span=td.firstElementChild!; if(!span.textContent?.trim())continue;
        const b=td.getBoundingClientRect(); const range=document.createRange();range.selectNodeContents(span);
        if([...range.getClientRects()].some(r=>r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1))spills.push(`${paper.dataset.sheet}!${td.dataset.cell}: ${span.textContent} cell=${JSON.stringify(b.toJSON())} text=${JSON.stringify([...range.getClientRects()].map(r=>r.toJSON()))}`);
      }
      return {counts,spills,cells,blank:[...document.querySelectorAll('.es-paper')].filter(p=>!p.textContent?.trim()).length};
    },grids);
    mkdirSync('output/playwright/cf139',{recursive:true});writeFileSync('output/playwright/cf139/layout.json',JSON.stringify(measured,null,2));
    assert.deepEqual(measured.spills,[]);assert.equal(measured.blank,0);assert.equal(Object.keys(measured.counts).length,17);
    for(const g of grids)for(const [a,v] of Object.entries(g.values))if(v.trim()&&!/^붙/.test(g.grid.name)&&!g.grid.merges.some(range=>{const[start,end]=range.split(':');const[r,c]=esCellPosition(a),[r1,c1]=esCellPosition(start),[r2,c2]=esCellPosition(end);return a!==start&&r>=r1&&r<=r2&&c>=c1&&c<=c2;}))assert.ok(measured.cells.includes(`${g.grid.name}!${a}`),`${g.grid.name}!${a} retained`);
    await page.pdf({path:resolve('output/playwright/cf139/synthetic-output-a4.pdf'),preferCSSPageSize:true,printBackground:true});
    for(const name of ['2','2.2(선금)'])await page.locator(`[data-sheet="${name}"]`).first().screenshot({path:resolve(`output/playwright/cf139/sheet-${name}.png`)});
    let stored=fixture(),revision=1; const writes:string[]=[];
    const doc=()=>({id:'cf139-local',title:stored.title,revision,caseId:null,updatedAt:'2026-09-10T00:00:00Z'});
    const run=()=>({id:`run-${revision}`,revision,inputHash:'local',input:stored,result:calculateEs(stored)});
    await page.route(origin+'/api/**',route=>{
      const req=route.request(),path=new URL(req.url()).pathname; let payload:any;
      if(req.method()==='PUT'&&path==='/api/es/documents/cf139-local'){stored=validateEsInput(req.postDataJSON().input);revision++;writes.push('save');payload={document:doc(),input:stored,inputHash:'local'};}
      else if(req.method()==='POST'&&path.endsWith('/runs')){writes.push('run');payload={run:run()};}
      else if(req.method()!=='GET')return route.fulfill({status:405,body:'{}'});
      else payload=path.startsWith('/api/cases')?{cases:[]}:{document:doc(),input:stored,inputHash:'local',run:run()};
      return route.fulfill({contentType:'application/json',body:JSON.stringify(payload)});
    });
    await page.route(origin+'/cf139-ui',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><head><meta charset="UTF-8"><style>body{font-family:"Malgun Gothic",sans-serif;margin:16px}</style></head><body><div id="root"></div><script type="module" src="/cf139-ui.js"></script></body></html>'}));
    await page.addInitScript('window.__CLAIM_API_ORIGIN__ = window.location.origin;');await page.goto(origin+'/cf139-ui');
    await page.getByText('저장됨 · v1',{exact:true}).waitFor();await page.getByRole('button',{name:/2 비목·적용대가/}).click();await page.getByLabel('직접노무비 금액 (원)',{exact:true}).fill('200000');await page.getByLabel('공산품 금액 (원)',{exact:true}).fill('200000');
    writeFileSync('output/playwright/cf139/input-state.json',JSON.stringify({body:await page.locator('body').innerText(),labor:await page.getByLabel('직접노무비 금액 (원)',{exact:true}).inputValue(),material:await page.getByLabel('공산품 금액 (원)',{exact:true}).inputValue()},null,2));
    await page.getByText('400,000',{exact:true}).waitFor();await page.getByText('금액 있는 비목 2 / 28개 · 0원 26개 · 미입력 0개',{exact:true}).waitFor();
    await page.getByRole('button',{name:'저장·계산',exact:true}).click();await page.getByText('저장됨 · v2',{exact:true}).waitFor();assert.deepEqual(writes,['save','run']);assert.equal(stored.costs[18],'200000');assert.equal(calculateEs(stored).current!.k,'0.03');
    await page.reload();await page.getByRole('button',{name:/2 비목·적용대가/}).click();assert.equal(await page.getByLabel('공산품 금액 (원)',{exact:true}).inputValue(),'200,000');
    await page.screenshot({path:resolve('output/playwright/cf139/costs-desktop.png')});await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve('output/playwright/cf139/costs-mobile.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    const money=page.getByLabel('공산품 금액 (원)',{exact:true});await money.fill('1234567');await money.press('Tab');await money.focus();await money.press('Home');await money.press('ArrowRight');await money.pressSequentially('99');assert.equal(await money.inputValue(),'199234567');assert.equal(await money.evaluate(el=>(el as HTMLInputElement).selectionStart),3);
    await money.press('ControlOrMeta+A');await money.pressSequentially('200000');await money.press('Tab');assert.equal(await money.inputValue(),'200,000');assert.deepEqual(errors,[]);
  }finally{await browser?.close();await server.close();}
});
