import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {createServer} from '../apps/web/qa/vite-server.js';
const sha=(b:any)=>createHash('sha256').update(b).digest('hex');
async function main(){
 const out=mkdtempSync(resolve('tmp/cf230-hwp-amount-'));
 const before=process.env.CF230_BEFORE_SOURCE,path='apps/web/src/documents/positioned-hwp-export.ts',sourceHash=sha(readFileSync(path));
 const old=before?readFileSync(before,'utf8'):undefined;
 const server=await createServer({root:resolve('apps/web'),cacheDir:resolve(out,'cache'),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{name:'old-positioned-only',enforce:'pre',transform(code,id){if(before&&id.replaceAll('\\','/').split('?')[0].endsWith('/src/documents/positioned-hwp-export.ts'))return old;}},{name:'zip',resolveId:id=>id==='/qa-zip'?'\0qa-zip':undefined,load:id=>id==='\0qa-zip'?"export {unzipSync,strFromU8} from 'fflate';":undefined}]});
 await server.listen();const origin='http://127.0.0.1:'+(server.httpServer!.address() as any).port;
 const executablePath=[process.env.CHROME_PATH,...[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)']].filter(Boolean).map(p=>resolve(p!,'Google/Chrome/Application/chrome.exe'))].find(p=>p&&existsSync(p));
 const browser=await chromium.launch({executablePath,headless:true});
 const wasm=readFileSync('pinned-runtime/pkg/rhwp_bg.wasm'),binding=readFileSync('pinned-runtime/pkg/rhwp.js');
 assert.equal(sha(wasm),'bcc40a79bcd9be813cb231c6d8a0376b803ab8a6c189a09bcccabb8a249f3c44');
 try{
 const page=await browser.newPage();await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
 if(u.pathname==='/qa')return route.fulfill({contentType:'text/html',body:'<html><head><script type="module">import "/src/theme-system.css";import "/src/documents/DocumentReviewWorkspace.css";</script></head><body></body></html>'});
 if(u.pathname==='/rhwp/build-manifest.json')return route.fulfill({json:{wasm:sha(wasm),files:[{path:'assets/rhwp_bg-test.wasm',sha256:sha(wasm)},{path:'native/rhwp-ad01e939079e.js',sha256:sha(binding)}]}});
 if(u.pathname==='/rhwp/assets/rhwp_bg-test.wasm')return route.fulfill({body:wasm,contentType:'application/wasm'});
 if(u.pathname==='/rhwp/native/rhwp-ad01e939079e.js')return route.fulfill({body:binding,contentType:'text/javascript'});return route.continue();});
 await page.goto(origin+'/qa');await page.waitForFunction(()=>document.styleSheets.length>0);await page.evaluate('globalThis.__name=v=>v');
 const source=await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=32;canvas.height=24;canvas.getContext('2d')!.fillRect(2,2,18,16);
  const root=document.createElement('div');root.id='report';root.className='report-final-document';const mark=JSON.stringify({fontFamily:'굴림체',fontSize:14.666667,nativeFontFamily:'굴림체'});
  root.innerHTML=`<section data-export-page data-hwp-import-page="1" data-hwp-width="794" data-hwp-height="1123" style="position:relative;width:794px;height:1123px;color:#111;font:16px/24px Arial"><div data-hwp-text-box="1" style="position:absolute;left:60px;top:60px;width:600px;height:40px"><p style="margin:0">CF230 ORIGINAL BODY</p></div><table style="position:absolute;left:60px;top:200px;width:320px;table-layout:fixed;border-collapse:collapse"><colgroup><col style="width:160px"><col style="width:160px"></colgroup><tr><td style="padding:2px"><p style="margin:0">246.9</p></td><td style="padding:2px"><p id="amount" style="margin:0;text-align:right;font:14.666667px/20px 굴림체;white-space:pre"><span data-hwp-text-style='${mark}'>123,456,789</span><span data-hwp-text-style='${mark}' data-hwp-advance='[7.333333]' style="letter-spacing:0"> </span></p></td></tr></table><img src="${canvas.toDataURL()}" width="32" height="24" style="position:absolute;left:60px;top:400px"></section>`;
  document.body.append(root);for(const cell of root.querySelectorAll('td'))cell.setAttribute('data-hwp-layout',JSON.stringify({nativeWidth:160,paddingLeft:2,paddingRight:2,paddingTop:2,paddingBottom:2}));await document.fonts.load('14.666667px 굴림체');await document.fonts.ready;await root.querySelector('img')!.decode();
  const {collectNativeHwpPages}=await import('/src/documents/native-hwp-pages.ts' as string);const pages=await collectNativeHwpPages(root,'portrait');
  const paper=root.querySelector('section')!.getBoundingClientRect(),node=root.querySelector('#amount span')!.firstChild!,targets=[];
  for(let i=0;i<node.textContent!.length;i++){const r=document.createRange();r.setStart(node,i);r.setEnd(node,i+1);targets.push({text:node.textContent![i],x:r.getBoundingClientRect().left-paper.left});}
  const photo=Uint8Array.from(atob(canvas.toDataURL().split(',')[1]),c=>c.charCodeAt(0));
  (window as any).targets=targets;return{targets,pages,photo:[...photo],html:root.innerHTML};
 });
 writeFileSync(resolve(out,'source.json'),JSON.stringify(source,null,2));
 const download=page.waitForEvent('download');download.catch(()=>{});
 await page.evaluate(async()=>{const{downloadFinalDocument}=await import('/src/documents/final-document-export.ts' as string);await downloadFinalDocument({root:document.getElementById('report')!,format:'hwp',fileName:'CF230-synthetic',orientation:'portrait'});});
 const bytes=readFileSync((await (await download).path())!);writeFileSync(resolve(out,'actual.hwp'),bytes);
 const result=await page.evaluate(async(bytes:number[])=>{
  const{loadNativeHwpEngine}=await import('/src/documents/native-hwp-runtime.ts' as string);const{resolveNativeHwpGlyphs}=await import('/src/documents/native-hwp-glyphs.ts' as string);const{unzipSync,strFromU8}=await import('/qa-zip' as string);
  const Engine=await loadNativeHwpEngine(),doc=new Engine(new Uint8Array(bytes));try{
   const runs=JSON.parse(doc.getPageTextLayout(0)).runs,svgText=doc.renderPageSvgWithProfile(0,'print'),svg=new DOMParser().parseFromString(svgText,'image/svg+xml');const mapped=resolveNativeHwpGlyphs(runs,svg,(s:string)=>{throw Error(s)});
   const candidates=runs.filter((r:any)=>r.cellPath?.at(-1)?.cellIndex===1),glyphs=candidates.flatMap((r:any)=>(mapped.get(r)||[]).map(({glyph}:any)=>({text:glyph.textContent,x:Number(glyph.getAttribute('x'))}))).filter((g:any)=>g.text.trim());
   const targets=(window as any).targets;if(glyphs.map((g:any)=>g.text).join('')!==targets.map((g:any)=>g.text).join(''))throw Error('Amount glyph order changed');
   const dx=glyphs.map((g:any,i:number)=>g.x-targets[i].x),zip=unzipSync(doc.exportHwpx()),xml=new DOMParser().parseFromString(strFromU8(zip['Contents/section0.xml']),'application/xml');
   const text=[...xml.getElementsByTagNameNS('*','t')].map(e=>e.textContent).join(''),photos=Object.keys(zip).filter(n=>n.startsWith('BinData/')).map(n=>[...zip[n]]);
   return{pages:doc.pageCount(),text,tableCount:xml.getElementsByTagNameNS('*','tbl').length,imageCount:xml.getElementsByTagNameNS('*','pic').length,photos,glyphs,dx,maxX:Math.max(...dx.map(Math.abs)),svg:svgText};
  }finally{doc.free();}
 },[...bytes]);
 writeFileSync(resolve(out,'print.svg'),result.svg);writeFileSync(resolve(out,'result.json'),JSON.stringify({before:Boolean(before),sourceHash,oldHash:old?sha(old):undefined,...result,svg:undefined},null,2));
 console.log(JSON.stringify({out,before:Boolean(before),maxX:result.maxX,dx:result.dx,pages:result.pages}));
 assert.equal(result.pages,1);assert.equal(result.tableCount,1);assert.equal(result.imageCount,1);assert.equal(result.text,'CF230 ORIGINAL BODY246.9123,456,789 ');assert.equal(sha(Buffer.from(result.photos[0])),sha(Buffer.from(source.photo)));assert.ok(result.maxX<=.5,'Each actual native glyph start must remain within 0.5px of reviewed DOM');assert.equal(sha(readFileSync(path)),sourceHash);
 }finally{await browser.close();await server.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
