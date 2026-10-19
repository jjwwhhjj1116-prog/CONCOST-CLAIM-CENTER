import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {createServer} from '../apps/web/qa/vite-server.js';
const sha=(b:any)=>createHash('sha256').update(b).digest('hex');
async function main(){
 const out=mkdtempSync(resolve('tmp/cf230-empty-hwp-cell-'));
 const before=process.env.CF230_EMPTY_BEFORE_SOURCE,path='apps/web/src/documents/hwp-structured-import.ts',sourceHash=sha(readFileSync(path));
 const old=before?readFileSync(before,'utf8'):undefined;
 const server=await createServer({root:resolve('apps/web'),cacheDir:resolve(out,'cache'),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{name:'old-positioned-only',enforce:'pre',transform(code,id){if(before&&id.replaceAll('\\','/').split('?')[0].endsWith('/src/documents/hwp-structured-import.ts'))return old;}},{name:'zip',resolveId:id=>id==='/qa-zip'?'\0qa-zip':undefined,load:id=>id==='\0qa-zip'?"export {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';":undefined}]});
 await server.listen();const origin='http://127.0.0.1:'+(server.httpServer!.address() as any).port;
 const executablePath=[process.env.CHROME_PATH,...[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)']].filter(Boolean).map(p=>resolve(p!,'Google/Chrome/Application/chrome.exe'))].find(p=>p&&existsSync(p));
 const browser=await chromium.launch({executablePath,headless:true});
 const wasm=readFileSync('pinned-runtime/pkg/rhwp_bg.wasm'),binding=readFileSync('pinned-runtime/pkg/rhwp.js');
 assert.equal(sha(wasm),'bcc40a79bcd9be813cb231c6d8a0376b803ab8a6c189a09bcccabb8a249f3c44');
 try{
 const page=await browser.newPage();await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
 if(u.pathname==='/qa')return route.fulfill({contentType:'text/html',body:'<html><head><script type="module">import "/src/theme-system.css";import "/src/documents/StructuredDocumentEditor.css";import "/src/documents/DocumentReviewWorkspace.css";import "/src/documents/hwp-import.css";</script></head><body></body></html>'});
 if(u.pathname==='/rhwp/build-manifest.json')return route.fulfill({json:{wasm:sha(wasm),files:[{path:'assets/rhwp_bg-test.wasm',sha256:sha(wasm)},{path:'native/rhwp-ad01e939079e.js',sha256:sha(binding)}]}});
 if(u.pathname==='/rhwp/assets/rhwp_bg-test.wasm')return route.fulfill({body:wasm,contentType:'application/wasm'});
 if(u.pathname==='/rhwp/native/rhwp-ad01e939079e.js')return route.fulfill({body:binding,contentType:'text/javascript'});return route.continue();});
 await page.goto(origin+'/qa');await page.waitForFunction(()=>document.styleSheets.length>0);await page.evaluate('globalThis.__name=v=>v');
 const seed=await page.evaluate(async()=>{
  const{loadNativeHwpEngine}=await import('/src/documents/native-hwp-runtime.ts' as string);const{BLANK_HWPX_BASE64}=await import('/src/documents/hwpx-blank-template.ts' as string);const{unzipSync,zipSync,strFromU8,strToU8}=await import('/qa-zip' as string);const Engine=await loadNativeHwpEngine();
  const doc=new Engine(Uint8Array.from(atob(BLANK_HWPX_BASE64),c=>c.charCodeAt(0)));let bytes;
  try{const pasted=JSON.parse(doc.pasteHtml(0,0,0,'<table style="width:500px;border-collapse:collapse"><tr><td style="width:500px;height:60px;padding:4px"><p style="font-family:\uD568\uCD08\uB86C\uBC14\uD0D5;font-size:20pt;color:#111111"><span style="font-family:\uD568\uCD08\uB86C\uBC14\uD0D5;font-size:20pt">\uD55C</span></p></td></tr></table><p style="color:#111111;font-family:Arial"><span style="font-family:Arial">UNCHANGED BODY</span></p>'));if(!pasted.ok)throw Error('paste failed');bytes=doc.exportHwpx();}finally{doc.free();}
  const zip=unzipSync(bytes),xml=new DOMParser().parseFromString(strFromU8(zip['Contents/section0.xml']),'application/xml');const ts=[...xml.getElementsByTagNameNS('*','t')].filter(t=>t.textContent==='\uD55C');if(ts.length!==1)throw Error('single seed target required');const charPr=ts[0].parentElement!.getAttribute('charPrIDRef');
  // A trailing TAB with the empty cell's font must not replace the true empty
  // caret as the font probe target or inherit the preceding Arial text style.
  const tabRun=ts[0].parentElement!.cloneNode(true) as Element;tabRun.getElementsByTagNameNS('*','t')[0].textContent='\t';const preserved=[...xml.getElementsByTagNameNS('*','t')].find(t=>t.textContent==='UNCHANGED BODY');if(!preserved)throw Error('preserved paragraph absent');preserved.parentElement!.parentElement!.append(tabRun);
  ts[0].textContent='';zip['Contents/section0.xml']=strToU8(new XMLSerializer().serializeToString(xml));const empty=new Engine(zipSync(zip));try{return{bytes:[...empty.exportHwp()],pages:empty.pageCount(),charPr};}finally{empty.free();}
 });writeFileSync(resolve(out,'empty-original.hwp'),Buffer.from(seed.bytes));assert.equal(seed.pages,1);
 await page.evaluate(async(bytes:number[])=>{
 const{readReportHwp}=await import('/src/documents/hwp-structured-import.ts' as string);const{renderStructuredDocumentHtml}=await import('/src/documents/StructuredDocumentEditor.tsx' as string);const parsed=await readReportHwp(new File([new Uint8Array(bytes)],'CF230-empty-synthetic.hwp'));(window as any).seed=parsed.document;
 const wrapper=document.createElement('div');wrapper.className='structured-editor';const root=document.createElement('article');root.id='report';root.className='structured-editor__preview';root.contentEditable='true';root.style.cssText='padding:0;margin:0;width:794px;max-width:none;color:#111111';root.innerHTML=renderStructuredDocumentHtml(parsed.document);wrapper.append(root);document.body.append(wrapper);for(const p of root.querySelectorAll('[data-hwp-import-page]'))p.setAttribute('data-export-page','');await document.fonts.ready;const{alignImportedHwpPages}=await import('/src/documents/hwp-import-alignment.ts' as string);alignImportedHwpPages(root);for(const cell of root.querySelectorAll<HTMLElement>('td'))cell.style.color='#111111';
 },seed.bytes);
 const target=page.locator('#report td p').first();assert.equal(await target.innerText(),'');await target.click();await page.keyboard.insertText('CF230');
 const capture=async()=>page.evaluate(()=>{const root=document.getElementById('report')!,paper=root.querySelector('[data-hwp-import-page]')!,p=root.querySelector('td p')!,b=paper.getBoundingClientRect(),glyphs:any[]=[];const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){for(let i=0;i<n.textContent!.length;i++){const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+1);const q=r.getBoundingClientRect();glyphs.push({char:n.textContent![i],x:q.x-b.x,y:q.y-b.y,w:q.width,h:q.height});}}const probe=document.createElement('span');probe.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline';p.append(probe);const baseline=probe.getBoundingClientRect().top-b.top;probe.remove();return{baseline,glyphs,font:getComputedStyle(p).fontFamily,fontSize:getComputedStyle(p).fontSize,text:root.textContent,pages:root.querySelectorAll('[data-hwp-import-page]').length,tables:root.querySelectorAll('table').length,html:root.innerHTML};});
 const source=await capture();assert.equal(source.glyphs.map((g:any)=>g.char).join(''),'CF230');writeFileSync(resolve(out,'source.json'),JSON.stringify(source,null,2));
 const download=page.waitForEvent('download');download.catch(()=>{});await page.evaluate(async()=>{const{downloadFinalDocument}=await import('/src/documents/final-document-export.ts' as string);const root=document.getElementById('report')!;root.contentEditable='false';await downloadFinalDocument({root,format:'hwp',fileName:'CF230-empty-edited',orientation:'portrait'});});const bytes=readFileSync((await(await download).path())!);writeFileSync(resolve(out,'actual.hwp'),bytes);
 await page.evaluate(async(bytes:number[])=>{const{readReportHwp}=await import('/src/documents/hwp-structured-import.ts' as string);const{renderStructuredDocumentHtml}=await import('/src/documents/StructuredDocumentEditor.tsx' as string);const{loadNativeHwpEngine}=await import('/src/documents/native-hwp-runtime.ts' as string);const Engine=await loadNativeHwpEngine();const native=new Engine(new Uint8Array(bytes));try{(window as any).nativeProof={layout:JSON.parse(native.getPageTextLayout(0)),svg:native.renderPageSvgWithProfile(0,'print')};}finally{native.free();}const parsed=await readReportHwp(new File([new Uint8Array(bytes)],'CF230-reopened.hwp'));const root=document.getElementById('report')!;root.innerHTML=renderStructuredDocumentHtml(parsed.document);for(const p of root.querySelectorAll('[data-hwp-import-page]'))p.setAttribute('data-export-page','');await document.fonts.ready;const{alignImportedHwpPages}=await import('/src/documents/hwp-import-alignment.ts' as string);alignImportedHwpPages(root);for(const cell of root.querySelectorAll<HTMLElement>('td'))cell.style.color='#111111';},[...bytes]);const after=await capture();writeFileSync(resolve(out,'native-proof.json'),JSON.stringify(await page.evaluate(()=>(window as any).nativeProof),null,2));
 const max=(key:string)=>Math.max(...source.glyphs.map((g:any,i:number)=>Math.abs(g[key]-(after.glyphs[i]?.[key]??1e9))));const result={out,before:Boolean(before),sourceHash,oldHash:old?sha(old):null,seedCharPr:seed.charPr,source,after,maxX:max('x'),maxY:max('y'),maxW:max('w'),maxH:max('h')};writeFileSync(resolve(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({out,before:result.before,maxX:result.maxX,maxY:result.maxY,maxW:result.maxW,maxH:result.maxH,fontSame:source.font===after.font}));
 assert.equal(after.pages,1);assert.equal(after.tables,1);assert.equal(after.text,source.text);assert.equal(after.font,source.font);assert.ok(result.maxX<=.50001);assert.ok(result.maxY<=.05);assert.equal(result.maxH,0);assert.equal(sha(readFileSync(path)),sourceHash);
 }finally{await browser.close();await server.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});




