import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import test from 'node:test';

test('CF229 edited text, table, photo paragraph, tab and breaks roundtrip through HWP and DOCX',async t=>{
  assert.match(readFileSync('apps/web/src/theme-system.css','utf8'),/@font-face\s*\{[^}]*font-family:'HY헤드라인M'[^}]*local\('HYHeadLine-Medium'\)/u,'Resolve the existing HY font alias without redistributing font bytes');
  const {createServer}=await import('../apps/web/qa/vite-server.js');
  const server=await createServer({root:resolve('apps/web'),...(process.env.CF149_CACHE_ROOT?{cacheDir:process.env.CF149_CACHE_ROOT}:{}),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{name:'cf206-native-archive',resolveId:id=>id==='/cf206-zip.js'?'\0cf206-zip':undefined,load:id=>id==='\0cf206-zip'?"export {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';":undefined}]});
  await server.listen();
  const origin='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port;
  const executablePath=[process.env.CHROME_PATH,...[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)']].filter(Boolean).map(p=>resolve(p!,'Google/Chrome/Application/chrome.exe'))].find(p=>p&&existsSync(p));
  const browser=await chromium.launch({executablePath,headless:true});
  const engineDir=process.env.CF148_ENGINE_DIR??'pinned-runtime/pkg';
  const wasm=readFileSync(resolve(engineDir,'rhwp_bg.wasm')),binding=readFileSync(resolve(engineDir,'rhwp.js'));
  const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
  console.log('CF205 collector read-point SHA',sha(readFileSync('apps/web/src/documents/native-hwp-pages.ts')),'native exporter SHA',sha(readFileSync('apps/web/src/documents/editable-hwp-export.ts')));
  assert.equal(sha(wasm),process.env.CF148_ENGINE_SHA??'bcc40a79bcd9be813cb231c6d8a0376b803ab8a6c189a09bcccabb8a249f3c44','Verify the exact deployed engine, not a historical test copy');
  const manifest={wasm:sha(wasm),files:[{path:'assets/rhwp_bg-test.wasm',sha256:sha(wasm)},{path:'native/rhwp-ad01e939079e.js',sha256:sha(binding)}]};
  try{
    const page=await browser.newPage();
    const requests:string[]=[];
    await page.route('**/*',route=>{
      const u=new URL(route.request().url());requests.push(u.origin+u.pathname);
      if(u.origin!==origin)return route.abort();
      if(u.pathname==='/native-qa.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><script type="module">import "/src/theme-system.css";import "/src/documents/DocumentReviewWorkspace.css";</script></head><body></body></html>'});
      if(u.pathname==='/rhwp/build-manifest.json')return route.fulfill({json:manifest});
      if(u.pathname==='/rhwp/assets/rhwp_bg-test.wasm')return route.fulfill({body:wasm,contentType:'application/wasm'});
      if(u.pathname==='/rhwp/native/rhwp-ad01e939079e.js')return route.fulfill({body:binding,contentType:'text/javascript'});
      return route.continue();
    });
    await page.goto(origin+'/native-qa.html');await page.waitForFunction(()=>document.styleSheets.length>0);
    await page.evaluate('globalThis.__name = value => value');

    await page.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=32;canvas.height=24;canvas.getContext('2d')!.fillRect(0,0,32,24);
      const root=document.createElement('div');root.id='portable';root.className='report-final-document';
      root.innerHTML=`<section data-export-page data-hwp-import-page="1" data-hwp-width="794" data-hwp-height="1123" style="position:relative;width:794px;height:1123px;font:16px/24px Arial"><div data-hwp-text-box="1" style="position:absolute;left:60px;top:60px;width:600px;height:90px"><p style="margin:0">ORIGINAL<span data-hwp-tab="40" style="display:inline-block;width:40px"></span>123.45<br data-hwp-soft-break="1">VISUAL<br>SECOND</p></div><table style="position:absolute;left:60px;top:180px;width:300px;table-layout:fixed;border-collapse:collapse"><colgroup><col style="width:150px"><col style="width:150px"></colgroup><tbody><tr><td style="padding:0"><p style="margin:0">0</p></td><td style="padding:0"><p style="margin:0">246.9</p></td></tr></tbody></table><p style="position:absolute;left:60px;top:300px;margin:0"><img src="${canvas.toDataURL()}" width="32" height="24"></p></section>`;
      document.body.append(root);root.querySelector('p')!.firstChild!.textContent='EDITED';
      const tab=root.querySelector('[data-hwp-tab]')!;
      tab.setAttribute('data-hwp-tab','8.5');(tab as HTMLElement).style.width='8.5px';
      tab.insertAdjacentHTML('afterend','<span data-hwp-tab="26.7" style="display:inline-block;width:26.7px"></span>MIDDLE<span data-hwp-tab="10.7" style="display:inline-block;width:10.7px"></span><span data-hwp-tab="26.7" style="display:inline-block;width:26.7px"></span>');
      await document.fonts.ready;await root.querySelector('img')!.decode();
    });
    for(const format of ['hwp','docx'])await t.test(format,async()=>{
      const download=page.waitForEvent('download');
      await page.evaluate(async format=>{const{downloadFinalDocument}=await import('/src/documents/final-document-export.ts' as string);await downloadFinalDocument({root:document.getElementById('portable')!,format:format as 'hwp'|'docx',fileName:'portable-positioned',orientation:'portrait'});},format);
      const file=await download,path=await file.path();assert.ok(path);const bytes=readFileSync(path!);
      const result=await page.evaluate(async({format,bytes})=>{
        const file=new File([new Uint8Array(bytes)],'portable.'+format);
        if(format==='hwp'){
          const{loadNativeHwpEngine}=await import('/src/documents/native-hwp-runtime.ts' as string);const Engine=await loadNativeHwpEngine();const native=new Engine(new Uint8Array(bytes));let semanticBreaks=0;const tabUnits:number[]=[];try{const{unzipSync,strFromU8}=await import('/cf206-zip.js' as string);const zip=unzipSync(native.exportHwpx());for(const path of Object.keys(zip).filter(p=>/^Contents\/section\d+\.xml$/.test(p))){const xml=new DOMParser().parseFromString(strFromU8(zip[path]),'application/xml');semanticBreaks+=xml.getElementsByTagNameNS('*','lineBreak').length;tabUnits.push(...[...xml.getElementsByTagNameNS('*','tab')].map(t=>Number(t.getAttribute('width'))));}}finally{native.free();}if(semanticBreaks!==1)throw Error('Soft visual break became an authored native lineBreak: '+semanticBreaks);if(JSON.stringify(tabUnits)!==JSON.stringify([638,2003,803,2003]))throw Error('Native TAB widths changed: '+JSON.stringify(tabUnits));
const{readReportHwp}=await import('/src/documents/hwp-structured-import.ts' as string);const r=await readReportHwp(file);const nodes:any[]=[];const queue=[r.document];while(queue.length){const n=queue.shift();nodes.push(n);queue.unshift(...(n.content||[]));}
          return{pages:r.pageCount,text:nodes.map(n=>n.text||'').join(''),tables:nodes.filter(n=>n.type==='table').length,images:r.images.length,tabWidths:nodes.filter(n=>n.type==='hwpImportedTab').map(n=>n.attrs.width),breaks:nodes.filter(n=>n.type==='hardBreak').length,semanticBreaks,softBreaks:nodes.filter(n=>n.type==='hardBreak'&&n.attrs?.hwpSoftBreak).length,authoredBreaks:nodes.filter(n=>n.type==='hardBreak'&&!n.attrs?.hwpSoftBreak).length};
        }
        const{readReportDocx}=await import('/src/proposals/proposal-excel.ts' as string);const r=await readReportDocx(file);const d=new DOMParser().parseFromString(r.reportContent,'text/html');
        const{unzipSync,zipSync,strFromU8,strToU8}=await import('/cf206-zip.js' as string),zip=unzipSync(new Uint8Array(bytes));
        zip['word/document.xml']=strToU8(strFromU8(zip['word/document.xml']).replace('EDITED','CHANGED'));
        let staleRejected=false;try{await readReportDocx(new File([zipSync(zip)],'changed.docx'));}catch(error){staleRejected=String(error).includes('실제 본문·사진');}
        if(!staleRejected)throw Error('Changed native Word content restored a stale web snapshot');
        const layoutPart='customXml/claim-center-layout.xml',original=unzipSync(new Uint8Array(bytes));
        for(const changed of ['text','geometry']){
          const layout=new DOMParser().parseFromString(strFromU8(original[layoutPart]),'application/xml'),payload=JSON.parse(layout.documentElement.textContent!);
          payload.pages[0]=changed==='text'?payload.pages[0].replace('EDITED','CHANGED'):payload.pages[0].replace('width="32"','width="320"');
          layout.documentElement.textContent=JSON.stringify(payload);
          let rejected=false;try{await readReportDocx(new File([zipSync({...original,[layoutPart]:strToU8(new XMLSerializer().serializeToString(layout))})],'changed-layout.docx'));}catch(error){rejected=String(error).includes('실제 본문·사진');}
          if(!rejected)throw Error('Changed web '+changed+' metadata bypassed native Word binding');
        }
        return{pages:d.querySelectorAll('[data-hwp-import-page]').length,text:d.body.textContent,tables:d.querySelectorAll('table').length,images:r.images.length,tabWidths:[...d.querySelectorAll('[data-hwp-tab]')].map(t=>Number(t.getAttribute('data-hwp-tab'))),breaks:d.querySelectorAll('br').length,softBreaks:d.querySelectorAll('br[data-hwp-soft-break]').length,authoredBreaks:d.querySelectorAll('br:not([data-hwp-soft-break])').length};
      },{format,bytes:[...bytes]});
      console.log(format,JSON.stringify(result));assert.equal(result.pages,1);assert.equal(result.tables,1);assert.equal(result.images,1);assert.equal(result.tabWidths.length,4);assert.ok(result.tabWidths.every((width:number,i:number)=>Math.abs(width-[8.5,26.7,10.7,26.7][i])<=.100001));assert.ok(result.text?.includes('EDITED'));assert.ok(!result.text?.includes('ORIGINAL'));assert.ok(result.text?.includes('123.45'));assert.ok(result.text?.includes('246.9'));assert.ok(result.text?.includes('SECOND'));assert.equal(result.softBreaks,1);assert.equal(result.authoredBreaks,1);assert.equal(result.breaks,2);
    });
    assert.ok(requests.every(url=>new URL(url).origin===origin));
  }finally{await browser.close();await server.close();}
});
