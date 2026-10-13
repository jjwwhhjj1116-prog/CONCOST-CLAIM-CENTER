import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';

test('CF217 report PDF stays pixel-identical when UI height changes at native Chrome zoom',async()=>{
  const base=resolve('tmp/cf217-qa');mkdirSync(base,{recursive:true});const output=mkdtempSync(join(base,'pdf-flow-'));
  const deps=process.env.CF212_BUNDLED_DEPENDENCIES;
  assert.ok(deps,'Set CF212_BUNDLED_DEPENDENCIES to the bundled dependency runtime directory');
  const before=process.env.CF217_BEFORE_METRICS==='1';
  const decorations=[['Math.round(text.bounds.top + baseline - _this.options.y) + _this.options.y','Math.round(text.bounds.top + baseline)'],['Math.round(text.bounds.top - _this.options.y) + _this.options.y','Math.round(text.bounds.top)'],['Math.ceil(text.bounds.top + middle - _this.options.y) + _this.options.y','Math.ceil(text.bounds.top + middle)']];
  const packageRoot=resolve('apps/web/node_modules/html2canvas');
  assert.equal(JSON.parse(readFileSync(join(packageRoot,'package.json'),'utf8')).version,'1.4.1');
  const patchPattern=/^[ \t]*container\.style\.position = 'absolute';\r?\n[ \t]*container\.style\.top = '0';\r?\n[ \t]*container\.style\.left = '0';\r?\n/gm;
  const sourcePath=realpathSync(join(packageRoot,'dist/html2canvas.esm.js')).replaceAll('\\','/');
  const installed=readFileSync(sourcePath,'utf8'),sourceHash=createHash('sha256').update(installed).digest('hex');
  assert.equal(sourceHash,'c3b0b8b257996d79b5e362d2aee2411ff74fd23e984e9900f5ba005ea4753d64');
  assert.equal([...installed.matchAll(patchPattern)].length,0,'Installed package remains untouched');
  const {createServer}=await import('../apps/web/qa/vite-server.js');
  const entry=`import '/src/theme-system.css';import '/src/proposals/ProposalFinalization.css';import '/src/documents/StructuredDocumentEditor.css';import '/src/documents/DocumentReviewWorkspace.css';import {downloadFinalDocument} from '/src/documents/final-document-export.ts';
  document.body.style.cssText='margin:0;background:white';
  const q=new URLSearchParams(location.search);document.body.style.zoom=q.get('zoom')||'1';const root=document.getElementById('root');root.dataset.exportDocumentKind='REPORT';root.className='report-final-document';root.style.cssText='padding:0;margin:0;position:absolute;left:'+q.get('x')+'px;top:'+q.get('y')+'px;width:794px';
  {root.style.position='relative';root.style.top='0';const spacer=document.createElement('div');spacer.style.height=q.get('y')+'px';spacer.dataset.cf217Spacer='true';root.before(spacer);}
  root.innerHTML='<article data-export-page data-export-page-policy="fit" data-page-number="1" style="box-sizing:border-box;width:794px;height:1123px;min-height:1123px;margin:0;padding:76px;background:white;color:#182536;font-family:Batang,serif;font-size:16px;line-height:1.85"><h2 style="font-size:20px;line-height:32px;letter-spacing:-.36px">CF217 보고서 원점 검수</h2><p>동일한 본문과 <strong>123.45</strong> 숫자, <s>취소선</s>, <u>밑줄</u>, <span style="text-decoration:overline">윗줄</span>을 실제 PDF로 출력합니다.</p><ol><li>첫 번째 순서 보존</li><li>두 번째 순서 보존</li></ol><table style="border-collapse:collapse;width:100%"><tbody><tr><td style="border:1px solid #123;padding:10px">줄바꿈<br>보존</td><td style="border:1px solid #123;padding:10px">246.9</td></tr><tr><td style="border:1px solid #123;padding:10px"></td><td style="border:1px solid #123;padding:10px">0</td></tr></tbody></table><img alt="합성 사진" style="display:block;width:260px;height:130px;margin-top:24px;object-fit:contain"><svg xmlns="http://www.w3.org/2000/svg" width="180" height="60"><rect x="2" y="2" width="176" height="56" fill="#4097aa"/></svg></article>';
  const c=document.createElement('canvas');c.width=160;c.height=80;const ctx=c.getContext('2d');ctx.fillStyle='#148abb';ctx.fillRect(0,0,160,80);ctx.fillStyle='#ef9b32';ctx.fillRect(20,10,60,50);const img=root.querySelector('img');img.src=c.toDataURL('image/png');
  await img.decode();await document.fonts.ready;window.cf217Ready=true;window.cf217Export=()=>downloadFinalDocument({root,format:'pdf',fileName:'CF217-origin',orientation:'portrait',purpose:'ADMIN_QA'});`;
  const server=await createServer({root:resolve('apps/web'),cacheDir:join(output,'cache'),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{
    name:'cf217-report-flow-fixture',enforce:'pre',
    configureServer(s){s.middlewares.use(async(req,res,next)=>{if(!(req.url||'').startsWith('/cf217-flow.html'))return next();const html=readFileSync('apps/web/index.html','utf8').replace('<script src="/runtime-config.js"></script>','').replace('src="/src/main.tsx"','src="/cf217-entry.js"');res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url!,html));});},
    resolveId(id){return id==='/cf217-entry.js'?id:undefined;},
    load(id){if(id==='/cf217-entry.js')return entry;}
  },{name:'cf217-before-metrics-only',enforce:'post',transform(code,id){if(!before||id.split('?')[0].replaceAll('\\','/')!==sourcePath)return null;assert.equal([...code.matchAll(patchPattern)].length,1,'Production transform must run first');let restored=code.replace(patchPattern,'');for(const [patched,original] of decorations){assert.equal(restored.split(patched).length,2);restored=restored.replace(patched,original);}return restored;}}]});
  await server.listen();const origin='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port;
  try {
  const served=await server.transformRequest('/@fs/'+sourcePath).catch((e:any)=>{if(e.pluginCode){const code=e.pluginCode as string;let at=0;while(at<code.length&&code[at]===installed[at])at++;console.log(JSON.stringify({transformMismatch:{sourceHash,receivedHash:createHash('sha256').update(code).digest('hex'),installedBytes:installed.length,receivedBytes:code.length,firstDifference:at,installed:installed.slice(at,at+160),received:code.slice(at,at+160)}}));}throw e;});assert.ok(served);const measured=served.code;for(const [patched] of decorations)assert.equal(measured.split(patched).length,before?1:2);assert.equal([...measured.matchAll(patchPattern)].length,before?0:1);
  const start=measured.indexOf('FontMetrics.prototype.parseMetrics = function (fontFamily, fontSize) {'),end=measured.indexOf('FontMetrics.prototype.getMetrics',start);assert.ok(start>0&&end>start);
  const probeFunction=measured.slice(start,end).replace('FontMetrics.prototype.parseMetrics = function (fontFamily, fontSize) {','function(fontFamily,fontSize){').trim().replace(/;$/u,'').replace('container.removeChild(span);','var parentIsContainer=img.offsetParent===container&&span.offsetParent===container; var containerTop=container.offsetTop; container.removeChild(span);').replace('return { baseline: baseline, middle: middle };','return { baseline:baseline,middle:middle,parentIsContainer:parentIsContainer,containerTop:containerTop };');
  // Observe the installed measurement function; the full downloaded PDF is the acceptance oracle.
  const probe=`(()=>{const SMALL_IMAGE='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',SAMPLE_TEXT='Hidden Text';const measure=(${probeFunction});return [14,16,20,28,34].map(size=>({fontSize:size,...measure.call({_document:document},'Batang, serif',size+'px')}));})()`;
  const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p=>p&&existsSync(p));assert.ok(executablePath);
  const receipts:any[]=[];
    for(const [i,position] of [[.25,.25],[.734375,67.984375]].entries()){
      const profile=mkdtempSync(join(output,'chrome-profile-'));mkdirSync(join(profile,'Default'));
      writeFileSync(join(profile,'Default/Preferences'),JSON.stringify({partition:{default_zoom_level:{x:Math.log(2/3)/Math.log(1.2)}}}));
      const context=await chromium.launchPersistentContext(profile,{executablePath,headless:true,viewport:null,args:['--window-size=1440,1000']});
      try{
        const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
        await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
        await page.goto(origin+`/cf217-flow.html?x=${position[0]}&y=${position[1]}`);await page.waitForFunction('window.cf217Ready===true');
        const metrics=await page.evaluate(probe);
        const evidence=await page.evaluate(()=>{const root=document.getElementById('root')!,sheet=root.firstElementChild as HTMLElement,b=sheet.getBoundingClientRect();return {html:sheet.outerHTML,styles:[sheet,...sheet.querySelectorAll('*')].map(n=>{const c=getComputedStyle(n);return ['font-family','font-size','font-weight','line-height','letter-spacing','color','text-decoration-line'].map(k=>c.getPropertyValue(k));}),box:{x:b.x,y:b.y,width:b.width,height:b.height},bodyHeight:document.body.getBoundingClientRect().height,fontStatus:document.fonts.status,dpr:devicePixelRatio,zoom:getComputedStyle(document.body).zoom};});
        assert.equal(evidence.dpr,0.6666666865348816);assert.equal(evidence.zoom,'1');assert.equal(evidence.fontStatus,'loaded');assert.equal(evidence.box.width,793.9921875);assert.equal(evidence.box.height,1122.984375);
        const download=page.waitForEvent('download');const result=await page.evaluate<{pageCount:number}>('window.cf217Export()');await(await download).saveAs(join(output,`flow-${i}.pdf`));assert.equal(result.pageCount,1);assert.deepEqual(errors,[]);receipts.push({...evidence,metrics});
      }finally{await context.close();}
      execFileSync(join(deps,'native/poppler/Library/bin/pdftoppm.exe'),['-png','-r','120',join(output,`flow-${i}.pdf`),join(output,`flow-${i}`)],{windowsHide:true});
    }
    assert.equal(receipts[0].html,receipts[1].html);assert.deepEqual(receipts[0].styles,receipts[1].styles);assert.notEqual(receipts[0].bodyHeight,receipts[1].bodyHeight);
    if(!before){assert.deepEqual(receipts[0].metrics,receipts[1].metrics);for(const metric of receipts[0].metrics){assert.equal(metric.containerTop,0);assert.equal(metric.parentIsContainer,true);}}
    const py=`from PIL import Image,ImageChops\nimport sys,json\na=Image.open(sys.argv[1]).convert('RGBA');b=Image.open(sys.argv[2]).convert('RGBA');assert a.size==b.size==(993,1404)\nx=ImageChops.difference(a,b);bands=x.split();m=bands[0]\nfor band in bands[1:]:m=ImageChops.lighter(m,band)\nprint(json.dumps({'size':a.size,'changedPixelCount':sum(m.histogram()[1:]),'bbox':m.getbbox(),'rgbaExact':a.tobytes()==b.tobytes()}))`;
    const pixels=JSON.parse(execFileSync(join(deps,'python/python.exe'),['-B','-c',py,join(output,'flow-0-1.png'),join(output,'flow-1-1.png')],{encoding:'utf8',windowsHide:true}));
    writeFileSync(join(output,'result.json'),JSON.stringify({before,sourceHash,receipts,pixels},null,2));console.log(JSON.stringify({before,output,metrics:receipts.map(r=>r.metrics),bodyHeights:receipts.map(r=>r.bodyHeight),pixels}));
    assert.equal(pixels.rgbaExact,true,'Changing surrounding UI height must not move report text, decorations, tables or pictures');
  }finally{await server.close();}
});


test('CF217 actual Vite boundary rejects a one-character html2canvas source change',async()=>{
  const base=resolve('tmp/cf217-qa');mkdirSync(base,{recursive:true});const output=mkdtempSync(join(base,'pdf-source-guard-'));
  const sourcePath=realpathSync('apps/web/node_modules/html2canvas/dist/html2canvas.esm.js').replaceAll('\\','/');
  const source=readFileSync(sourcePath,'utf8'),at=source.indexOf('html2canvas');assert.ok(at>0);
  const altered=source.slice(0,at)+'H'+source.slice(at+1);assert.equal(source.length,altered.length);
  const {createServer}=await import('../apps/web/qa/vite-server.js');
  const server=await createServer({root:resolve('apps/web'),cacheDir:join(output,'cache'),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'silent',plugins:[{name:'cf217-corrupt-source-before-product-transform',enforce:'pre',load(id){if(id.split('?')[0].replaceAll('\\','/')===sourcePath)return altered;}}]});
  await server.listen();
  try{const origin='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port;const response=await fetch(origin+'/@fs/'+sourcePath);const text=await response.text();assert.equal(response.status,500);assert.ok(text.includes('PDF 측정 패치의 원본이 달라졌습니다'));assert.equal(readFileSync(sourcePath,'utf8'),source);writeFileSync(join(output,'result.json'),JSON.stringify({status:500,guardRejected:true,installedUnchanged:true}));console.log(JSON.stringify({sourceGuard:'PASS',output}));}finally{await server.close();}
});
