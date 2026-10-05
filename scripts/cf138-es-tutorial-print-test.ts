import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { newEsInput, calculateEs, validateEsInput } from '../packages/document-engine/src/es-calculation';
import { newEsPrintSettings, validateEsPrintSettings, esBandText, esBandExcel, esPrintMargins } from '../packages/document-engine/src/es-print-settings';
import { esTemplateGrids, esTemplateValues } from '../packages/document-engine/src/es-template';
import { esTemplateSheetXml } from '../apps/web/src/es/es-template-xlsx';
import { exportEsReport, exportEsWorking } from '../apps/web/src/es/es-xlsx';
import { ES_SHEETS } from '../packages/document-engine/src/es-output';
const requireWeb = createRequire(resolve('apps/web/package.json'));
const { unzipSync, strFromU8 } = requireWeb('fflate');
function fixture() {
  const input = newEsInput(); input.title = 'CF138 출력 안내 합성 검수'; input.baseDate='2024-01-01'; input.adjustmentDate='2024-03-01'; input.contractAmount='1000000'; input.costs[11]='100000';
  for (const [p,date] of [[input.base,input.baseDate],[input.current.period,input.adjustmentDate],[input.previous.period,'2024-02-29']] as const) { p.date=date; p.wage='100'; p.materials=['100','100','100','100']; for (const key of Object.keys(p.rates) as (keyof typeof p.rates)[]) p.rates[key]='1'; }
  for(const c of [input.current,input.previous]) for(const pair of [c.machinery,...c.standards]) Object.assign(pair,{commonCount:'1',baseAverage:'100',comparisonAverage:'101'});
  assert.equal(calculateEs(input).status,'LEGACY_REPLAY'); return input;
}
function configured() { const s=newEsPrintSettings(); s.header={mode:'custom',text:'CF138 공사 <검수> &P',align:'left'}; s.footer={mode:'custom',text:'검토용 초안 · {page} / {pages}',align:'center'}; return s; }
test('CF138 missing presentation preserves old input JSON; explicit empty and hidden remain distinct',()=>{
  const input=fixture(), normalized=validateEsInput(input); assert.ok(!('printSettings' in normalized));
  input.printSettings=newEsPrintSettings(); input.printSettings.header.mode='hidden'; input.printSettings.footer.mode='custom'; input.printSettings.footer.text='';
  assert.deepEqual(validateEsInput(input).printSettings,input.printSettings);
  assert.deepEqual(calculateEs(input),calculateEs(normalized));
});
test('CF138 settings whitelist types and bounded one-line text, never allow raw style or server fields',()=>{
  const good=configured(); assert.deepEqual(validateEsPrintSettings({...good,ownerId:'forged'}),good);
  for(const patch of [{mode:'<script>'},{mode:['custom']},{align:'center;display:none'},{text:'a'.repeat(81)},{text:'line\nbreak'},{text:'line\u2028break'},{text:'line\u2029break'},{text:null}]) assert.throws(()=>validateEsPrintSettings({...good,header:{...good.header,...patch}}));
  assert.throws(()=>validateEsPrintSettings([])); assert.throws(()=>validateEsPrintSettings({header:good.header}));
});
test('CF138 only supported page tokens expand and Excel literal ampersands cannot inject format commands',()=>{
  assert.equal(esBandText('{page}/{pages} &P {other}',3,42),'3/42 &P {other}');
  const band={mode:'custom' as const,align:'right' as const,text:'A &P &N <검수> {page}/{pages}'};
  assert.match(esBandExcel(band),/A &&P &&N <검수> &P\/&N$/);
  assert.deepEqual(esPrintMargins(),{left:12,right:12,top:12,bottom:16}); assert.deepEqual(esPrintMargins(configured()),{left:12,right:12,top:24,bottom:24});
});
test('CF138 all original cell data and merges stay identical, only print bands and margins change',()=>{
  const input=fixture(), result=calculateEs(input), settings=configured();
  for(const grid of esTemplateGrids) {
    const values=esTemplateValues(input,result,grid), original=esTemplateSheetXml(grid,values), custom=esTemplateSheetXml(grid,values,{},settings);
    assert.equal(custom.match(/<sheetData>[\s\S]*?<\/sheetData>/)?.[0],original.match(/<sheetData>[\s\S]*?<\/sheetData>/)?.[0]);
    assert.equal(custom.match(/<mergeCells[\s\S]*?<\/mergeCells>/)?.[0],original.match(/<mergeCells[\s\S]*?<\/mergeCells>/)?.[0]);
    assert.match(custom,/<oddHeader>.*CF138 공사 &lt;검수&gt; &amp;&amp;P<\/oddHeader>/); assert.match(custom,/<oddFooter>.*&amp;P \/ &amp;N<\/oddFooter>/);
    assert.equal(esTemplateSheetXml(grid,values,{},newEsPrintSettings()),original);
    const hidden=newEsPrintSettings(); hidden.header.mode='hidden'; hidden.footer.mode='hidden'; assert.doesNotMatch(esTemplateSheetXml(grid,values,{},hidden),/<oddHeader>|<oddFooter>/);
  }
});
test('CF138 work snapshot and all 17 work/submission sheets retain presentation without extra input rows',async()=>{
  const input=fixture(), plain=unzipSync(await exportEsWorking(input)); input.printSettings=configured();
  const work=unzipSync(await exportEsWorking(input)); assert.equal(strFromU8(work['xl/worksheets/sheet1.xml']),strFromU8(plain['xl/worksheets/sheet1.xml']));
  assert.match(strFromU8(work['xl/worksheets/sheet3.xml']),/printSettings/);
  const submission=unzipSync(exportEsReport(input,calculateEs(input),ES_SHEETS.map(s=>s[0])));
  for(let i=1;i<=17;i++) { assert.match(strFromU8(submission[`xl/worksheets/sheet${i}.xml`]),/<oddHeader>/); assert.match(strFromU8(work[`xl/worksheets/sheet${i+3}.xml`]),/<oddHeader>/); }
});
test('CF138 tutorial is independent of input/save and the permanent print editor is outside outputReady gate',()=>{
  const source=readFileSync('apps/web/src/es/EsStudio.tsx','utf8'), tutorial=readFileSync('apps/web/src/es/EsTutorial.tsx','utf8');
  assert.match(source,/단계별 튜토리얼 시작/); assert.match(source,/<EsTutorial step=\{stepIndex\} onStep=\{index => goTab\(ES_STEPS\[index\]\[0\]\)\}/);
  assert.doesNotMatch(tutorial,/apiRequest|localStorage|mutate\(|save\(|fetch\(/); assert.equal((tutorial.match(/title:'/g)??[]).length,6);
  assert.match(source,/<EsPrintSettingsEditor[^\n]+\/>\{run && !dirty/); assert.match(source,/delete n\.printSettings/);
});
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
test('CF138 real Chromium: work import roundtrip, 17-sheet reserved bands, hidden footer, page numbers and A4 PDF', {skip:!executablePath,timeout:90000},async()=>{
  const {createServer}=await import('../apps/web/qa/vite-server.js');
  const server=await createServer({root:resolve('apps/web'),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{name:'cf138-print-css',enforce:'pre',transform(code:string,id:string){if(id.replaceAll('\\','/').split('?')[0].endsWith('/es/EsPrintPreview.tsx')) return code+'\nexport { PRINT_CSS };';},
    resolveId(id:string){if(id==='/cf138-ui.js')return '\0cf138-ui';},
    load(id:string){if(id==='\0cf138-ui')return `import React,{useState} from 'react'; import {createRoot} from 'react-dom/client'; import {EsStudio} from '/src/es/EsStudio.tsx'; function TestApp(){const [path,navigate]=useState('/es');return React.createElement(EsStudio,{key:path.split('?')[0],mode:path.startsWith('/es/editor')?'editor':'list',search:path.includes('?')?'?'+path.split('?')[1]:'',onNavigate:navigate});} createRoot(document.getElementById('root')).render(React.createElement(TestApp));`;}
  }]} as any);
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try {
    await server.listen(); const addr=server.httpServer!.address(); assert.ok(addr&&typeof addr==='object'); const origin=`http://127.0.0.1:${addr.port}`;
    browser=await chromium.launch({executablePath,headless:true}); const page=await browser.newPage({viewport:{width:1100,height:1400}});
    const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{const u=new URL(route.request().url()); if(u.origin!==origin)return route.abort(); if(u.pathname==='/cf138')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><head><meta charset="UTF-8"></head><body></body></html>'}); return route.continue();});
    await page.goto(origin+'/cf138'); const input=fixture(); input.printSettings=configured();
    const result=await page.evaluate(async(input)=>{
      const xlsxPath='/src/es/es-xlsx.ts', printPath='/src/es/EsPrintPreview.tsx', renderPath='/src/es/es-template-print.ts';
      const [{exportEsWorking,importEsWorkbook},{PRINT_CSS,decorateEsPrintPage},{paginateEsTemplate}]=await Promise.all([import(xlsxPath),import(printPath),import(renderPath)]);
      const bytes=await exportEsWorking(input); const imported=await importEsWorkbook(bytes);
      return {input:imported.input,css:PRINT_CSS};
    },input);
    assert.deepEqual(result.input.printSettings,input.printSettings); assert.deepEqual(calculateEs(result.input),calculateEs(input));
    await page.addStyleTag({content:result.css});
    const grids=esTemplateGrids.map(grid=>({grid,values:esTemplateValues(input,calculateEs(input),grid)}));
    const measured=await page.evaluate(async({grids,settings})=>{
      const rp='/src/es/es-template-print.ts', pp='/src/es/EsPrintPreview.tsx'; const {paginateEsTemplate}=await import(rp) as typeof import('../apps/web/src/es/es-template-print'), {decorateEsPrintPage}=await import(pp) as typeof import('../apps/web/src/es/EsPrintPreview');
      await document.fonts.ready; const measure=document.createElement('div'); document.body.append(measure);
      const raw=grids.flatMap(({grid,values})=>paginateEsTemplate(grid,values,measure,settings));
      const html=raw.map((text,i)=>decorateEsPrintPage(text,i,raw.length,1,settings)).join(''); measure.remove(); document.body.innerHTML=html;
      const pages=[...document.querySelectorAll<HTMLElement>('.es-paper')]; const issues:string[]=[];
      pages.forEach((paper,i)=>{
        const rect=paper.getBoundingClientRect(), h=paper.querySelector<HTMLElement>('[data-es-print-band="header"]')!, f=paper.querySelector<HTMLElement>('[data-es-print-band="footer"]')!;
        if(!h||!f)issues.push(`missing ${i}`); else {
          const hr=h.getBoundingClientRect(),fr=f.getBoundingClientRect(); const body=paper.querySelector('table')??paper.querySelector('header[data-cell]');
          if(body){const br=body.getBoundingClientRect(); if(hr.bottom>br.top+.5||fr.top<br.bottom-.5)issues.push(`overlap ${i}`);}
          if(hr.top<rect.top||fr.bottom>rect.bottom||h.scrollHeight>h.clientHeight+1||f.scrollHeight>f.clientHeight+1)issues.push(`clip ${i}`);
          if(!f.textContent?.includes(`${i+1} / ${pages.length}`))issues.push(`page ${i}`);
        }
      });
      const hidden={...settings,header:{...settings.header,mode:'hidden' as const},footer:{...settings.footer,mode:'hidden' as const}};
      const temp=document.createElement('div'); const detail=grids.find(g=>g.grid.name==='3')!; const hiddenPages=paginateEsTemplate(detail.grid,detail.values,temp,hidden);
      return {count:pages.length,sheets:new Set(pages.map(p=>p.dataset.sheet)).size,issues,hiddenFooter:hiddenPages.some(p=>p.includes('__ES_PAGE_NUMBER__'))};
    },{grids,settings:input.printSettings});
    assert.deepEqual(measured.issues,[]); assert.equal(measured.sheets,17); assert.equal(measured.hiddenFooter,false); assert.ok(measured.count>=17);
    mkdirSync('output/playwright/cf138',{recursive:true}); await page.pdf({path:resolve('output/playwright/cf138/synthetic-bands-a4.pdf'),preferCSSPageSize:true,printBackground:true});
    // Actual React UI with a local, read-only synthetic API. No authenticated session or external writes.
    const writes:string[]=[];
    await page.route(origin+'/api/**',route=>{
      const req=route.request(), path=new URL(req.url()).pathname;
      if(req.method()!=='GET'){writes.push(req.method()+' '+path);return route.fulfill({status:405,body:'{}'});}
      const doc={id:'cf138-local',title:input.title,revision:1,caseId:null,updatedAt:'2026-09-10T00:00:00Z'};
      const payload=path==='/api/es/documents'?{documents:[doc]}:path.startsWith('/api/cases')?{cases:[]}:{document:doc,input,inputHash:'local-synthetic',run:{id:'local-run',revision:1,inputHash:'local-synthetic',input,result:calculateEs(input)}};
      return route.fulfill({contentType:'application/json',body:JSON.stringify(payload)});
    });
    await page.route(origin+'/cf138-ui',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><head><meta charset="UTF-8"><style>:root{--surface:#fff;--surface-muted:#f0f5fa;--text-primary:#172838;--text-secondary:#475d70}body{font-family:"Malgun Gothic",sans-serif;background:#f4f7fa;margin:20px}</style></head><body><div id="root"></div><script type="module" src="/cf138-ui.js"></script></body></html>'}));
    await page.addInitScript('window.__CLAIM_API_ORIGIN__ = window.location.origin;');
    page.setDefaultTimeout(8000);
    await page.goto(origin+'/cf138-ui'); await page.getByRole('button',{name:'단계별 튜토리얼 시작',exact:true}).click();
    for(let i=1;i<=6;i++) { await page.getByRole('heading',{name:new RegExp(`사용 안내 ${i} / 6`)}).waitFor(); if(i<6)await page.getByRole('button',{name:'다음 단계로 →',exact:true}).click(); }
    await page.getByRole('button',{name:'안내 마치기',exact:true}).click(); assert.equal(await page.getByLabel('ES 단계별 사용 안내').count(),0);
    await page.getByRole('button',{name:'작업 안내',exact:true}).click(); await page.getByRole('heading',{name:/사용 안내 6 \/ 6/}).waitFor(); await page.getByRole('button',{name:'안내 닫기',exact:true}).click();
    await page.getByRole('button',{name:'산출서 목록으로',exact:true}).click(); await page.getByRole('button',{name:'열기',exact:true}).click();
    await page.getByRole('heading',{name:'1 공사정보',exact:true}).waitFor();
    await page.screenshot({path:resolve('output/playwright/cf138/desktop-basic.png')});
    await page.getByRole('button',{name:/6 출력물/}).click(); await page.getByLabel('머리글 문구',{exact:true}).fill('CF138 수정 후에도 설정창 유지');
    assert.equal(await page.getByLabel('머리글 문구',{exact:true}).inputValue(),'CF138 수정 후에도 설정창 유지');
    await page.getByText('저장하지 않은 변경',{exact:true}).waitFor(); assert.ok(await page.getByRole('button',{name:'전체 17시트 Excel',exact:true}).isDisabled());
    await page.screenshot({path:resolve('output/playwright/cf138/desktop-print-edit.png')});
    await page.setViewportSize({width:390,height:844}); await page.screenshot({path:resolve('output/playwright/cf138/mobile-print-edit.png')});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
    assert.deepEqual(writes,[]);
    assert.deepEqual(errors,[]);
  } finally {await browser?.close(); await server.close();}
});
