import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import test from 'node:test';

test('CF229 two edited native body paragraphs retain independent reviewed baselines',async t=>{
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


    await page.evaluate(async(emoji:boolean)=>{
      const c=document.createElement('canvas');c.width=32;c.height=24;c.getContext('2d')!.fillRect(0,0,32,24);
      const root=document.createElement('div');root.id='portable';root.className='report-final-document';const mark=JSON.stringify({fontFamily:'Arial',fontSize:16});
      const para=(label:string,y:number)=>`<div data-hwp-text-box="1" style="position:absolute;left:60px;top:${y}px;width:600px;height:80px"><p data-label="${label}" style="margin:0;font:16px/24px Arial;text-align:justify"><span data-hwp-text-style='${mark}' data-hwp-advance='[10]' style="letter-spacing:0">${label} OLD </span><span data-hwp-text-style='${mark}'>NEW ${emoji?'😀':''}ASCII</span><span data-hwp-tab="12" style="display:inline-block;width:12px"></span><span data-hwp-text-style='${mark}' data-hwp-advance='[10]'>TAIL LONG ORIGINAL END</span><br data-hwp-soft-break="1"><span data-hwp-text-style='${mark}'>SHORT NEW</span></p></div>`;
      root.innerHTML=`<section data-export-page data-hwp-import-page="1" data-hwp-width="794" data-hwp-height="1123" style="position:relative;width:794px;height:1123px;color:#000;font:16px/24px Arial">${para('ALPHA',100)}${para('BETA',300)}<table style="position:absolute;left:60px;top:500px;width:300px;table-layout:fixed"><tr><td><p style="margin:0">246.9</p></td></tr></table><img style="position:absolute;left:60px;top:600px" src="${c.toDataURL()}" width="32" height="24"></section>`;document.body.append(root);await document.fonts.ready;await root.querySelector('img')!.decode();
      const{collectNativeHwpPages}=await import('/src/documents/native-hwp-pages.ts' as string);const pages=await collectNativeHwpPages(root,'portrait');const targets:any[]=[];const paper=root.querySelector('section')!.getBoundingClientRect();
      for(const [index,p]of [...root.querySelectorAll('p[data-label]')].entries()){
        const line=pages[0].positioned[index].lines[0];const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT),chars:any[]=[];let firstY:number|undefined;
        while(walker.nextNode()){const n=walker.currentNode;let at=0;for(const ch of Array.from(n.textContent||'')){const r=document.createRange();r.setStart(n,at);r.setEnd(n,at+ch.length);const b=r.getBoundingClientRect();firstY??=b.top;if(!/\s/u.test(ch))chars.push({text:ch,x:b.left-paper.left,baseline:line.anchor.baseline+Math.round((b.top-firstY)/24)*24});at+=ch.length;}}
        targets.push({label:p.getAttribute('data-label'),line,chars});
      }(window as any).bodyTargets=targets;
    },!!process.env.CF229_EMOJI);
    const download=page.waitForEvent('download');download.catch(()=>{});await page.evaluate(async()=>{const{downloadFinalDocument}=await import('/src/documents/final-document-export.ts' as string);await downloadFinalDocument({root:document.getElementById('portable')!,format:'hwp',fileName:'two-body',orientation:'portrait'});});const downloaded=await download,bytes=readFileSync((await downloaded.path())!);
    const result=await page.evaluate(async(bytes:number[])=>{
      const{loadNativeHwpEngine}=await import('/src/documents/native-hwp-runtime.ts' as string);const{resolveNativeHwpGlyphs}=await import('/src/documents/native-hwp-glyphs.ts' as string);const{readReportHwp}=await import('/src/documents/hwp-structured-import.ts' as string);const Engine=await loadNativeHwpEngine(),doc=new Engine(new Uint8Array(bytes));try{
        const runs=JSON.parse(doc.getPageTextLayout(0)).runs,svg=new DOMParser().parseFromString(doc.renderPageSvgWithProfile(0,'print'),'image/svg+xml');const mapped=resolveNativeHwpGlyphs(runs,svg,(why:string)=>{throw Error(why)});const groups=new Map();for(const r of runs.filter((r:any)=>!r.cellPath)){const a=groups.get(r.paraIdx)||[];a.push(r);groups.set(r.paraIdx,a);}
        const checks=(window as any).bodyTargets.map((target:any)=>{const group=[...groups.values()].find((a:any)=>a.map((r:any)=>r.text).join('').startsWith(target.label));if(!group)throw Error('BODY paragraph missing');const glyphs=group.flatMap((r:any)=>(mapped.get(r)||[]).map(({glyph}:any)=>({text:glyph.textContent,x:Number(glyph.getAttribute('x')),baseline:Number(glyph.getAttribute('y'))})));if(glyphs.map((g:any)=>g.text).join('')!==target.chars.map((g:any)=>g.text).join(''))throw Error('Glyph order mismatch');const delta=glyphs.map((g:any,i:number)=>({dx:g.x-target.chars[i].x,dy:g.baseline-target.chars[i].baseline}));return{label:target.label,paraIdx:group[0].paraIdx,source:target.line,glyphs,delta,maxX:Math.max(...delta.map((d:any)=>Math.abs(d.dx))),maxY:Math.max(...delta.map((d:any)=>Math.abs(d.dy)))};});const controls=JSON.parse(doc.getPageControlLayout(0)).controls;const reopened=await readReportHwp(new File([new Uint8Array(bytes)],'two-body.hwp'));return{pages:doc.pageCount(),reopenedPages:reopened.pageCount,checks,controls:controls.filter((c:any)=>['table','image'].includes(c.type)).map((c:any)=>({type:c.type,x:c.x,y:c.y,w:c.w,h:c.h}))};
      }finally{doc.free();}
    },[...bytes]);
    console.log(JSON.stringify({pages:result.pages,checks:result.checks.map((c:any)=>({label:c.label,maxX:c.maxX,maxY:c.maxY,paraIdx:c.paraIdx})),controls:result.controls}));assert.equal(result.pages,1);assert.equal(result.reopenedPages,1);for(const c of result.checks){assert.ok(c.maxY<.25,'BODY baseline '+c.label);/* X metrics are recorded only: this synthetic fixture has no native advance provenance. */}assert.ok(result.controls.some((c:any)=>c.type==='image'&&Math.abs(c.y-600)<.2));assert.ok(result.controls.some((c:any)=>c.type==='table'&&Math.abs(c.y-502)<.2));
  }finally{await browser.close();await server.close();}
});
