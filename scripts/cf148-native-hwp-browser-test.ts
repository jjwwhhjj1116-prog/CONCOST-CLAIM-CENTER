import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import test from 'node:test';

test('reviewed browser DOM downloads native HWP using the pinned same-origin runtime',async t=>{
  assert.match(readFileSync('apps/web/src/theme-system.css','utf8'),/@font-face\s*\{[^}]*font-family:'HY헤드라인M'[^}]*local\('HYHeadLine-Medium'\)/u,'Resolve the existing HY font alias without redistributing font bytes');
  const {createServer}=await import('../apps/web/qa/vite-server.js');
  const server=await createServer({root:resolve('apps/web'),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});
  await server.listen();
  const origin='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port;
  const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>p&&existsSync(p));
  const browser=await chromium.launch({executablePath,headless:true});
  const engineDir=process.env.CF148_ENGINE_DIR??'pinned-runtime/pkg';
  const wasm=readFileSync(resolve(engineDir,'rhwp_bg.wasm')),binding=readFileSync(resolve(engineDir,'rhwp.js'));
  const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
  assert.equal(sha(wasm),process.env.CF148_ENGINE_SHA??'bcc40a79bcd9be813cb231c6d8a0376b803ab8a6c189a09bcccabb8a249f3c44','Verify the exact deployed engine, not a historical test copy');
  const manifest={wasm:sha(wasm),files:[{path:'assets/rhwp_bg-test.wasm',sha256:sha(wasm)},{path:'native/rhwp-ad01e939079e.js',sha256:sha(binding)}]};
  try{
    const page=await browser.newPage();
    const requests:string[]=[];
    await page.route('**/*',route=>{
      const u=new URL(route.request().url());requests.push(u.origin+u.pathname);
      if(u.origin!==origin)return route.abort();
      if(u.pathname==='/native-qa.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><script type="module">import "/src/theme-system.css";</script></head><body></body></html>'});
      if(u.pathname==='/rhwp/build-manifest.json')return route.fulfill({json:manifest});
      if(u.pathname==='/rhwp/assets/rhwp_bg-test.wasm')return route.fulfill({body:wasm,contentType:'application/wasm'});
      if(u.pathname==='/rhwp/native/rhwp-ad01e939079e.js')return route.fulfill({body:binding,contentType:'text/javascript'});
      return route.continue();
    });
    await page.goto(origin+'/native-qa.html');await page.waitForFunction(()=>document.styleSheets.length>0);
    await page.evaluate('globalThis.__name = value => value');
    for(const name of ['letterSpacing','normalLine','inlineBreaks','photoWhitespace','sourcePage','collapsedPhotoMargins','mergedFooter','cover','toc'])await t.test(name,async()=>{
      await page.evaluate(()=>document.querySelectorAll('#native-source').forEach(node=>node.remove()));
      const download=page.waitForEvent('download');
      const result=await page.evaluate(async name=>{
        const {downloadFinalDocument}=await import('/src/documents/final-document-export.ts' as string);
        const canvas=document.createElement('canvas');canvas.width=120;canvas.height=72;canvas.getContext('2d')!.fillRect(0,0,120,72);
        const src=canvas.toDataURL(),root=document.createElement('div');root.className='proposal-final-document';
        const photo=`<p style="text-align:center">
<img src="${src}" width="120" height="72">
</p>`;
        const contents:Record<string,string>={
          letterSpacing:'<section data-export-page style="width:794px;height:1123px;padding:40px"><p><span style="font-size:20px;letter-spacing:2px">양수 자간</span><span style="font-size:20px;letter-spacing:-2px">음수 자간</span></p></section>',
          normalLine:'<section data-export-page style="width:794px;height:1123px;padding:40px"><p style="font-size:20px;line-height:normal;min-height:0">단일 줄 검수</p></section>',
          inlineBreaks:'<section data-export-page style="width:794px;height:1123px;padding:40px"><p style="line-height:40px"><span>첫째 줄<br><br>넷째 아닌 셋째 줄<br></span></p></section>',
          photoWhitespace:`<section data-export-page style="width:794px;height:1123px;padding:40px">${photo}</section>`,
          sourcePage:`<section data-export-page style="width:794px;height:1123px;padding:40px"><p><img data-report-source-page="true" src="${src}" width="120" height="72"></p></section>`,
          collapsedPhotoMargins:`<section data-export-page style="width:794px;height:1123px;padding:40px"><p style="margin:0 0 16px;min-height:28.8px;text-align:center"><img style="display:block;margin:18px auto 24px" src="${src}" width="120" height="72"></p></section>`,
          mergedFooter:`<section data-export-page style="position:relative;width:794px;height:1123px;padding:40px"><p>원문 123,456원</p><table style="width:600px"><tr><td rowspan="2">병합</td><td>120</td></tr><tr><td>${photo}</td></tr></table><footer class="report-page-number" style="position:absolute;bottom:20px">- 1 -</footer></section>`,
          cover:`<section class="proposal-final-cover" data-export-page><div class="proposal-cover-frame" aria-hidden="true"></div><div class="proposal-cover-heading"><p>합성 검수 프로젝트</p><div><h2>기술용역 제안</h2><strong>용역 제안서</strong></div></div><time>2026. 09. 15</time><footer><img class="proposal-template-logo" src="${src}" alt="회사 로고"><div><b>검수 회사</b><span>주소 원문</span><span>전화 원문</span><small>제출처 원문</small></div></footer></section>`,
          toc:'<section class="proposal-final-toc" data-export-page data-page-number="2"><h3>목 차</h3><ol><li><b>04</b><span>전문가 현황</span><i>03</i></li></ol></section>'
        };
        root.innerHTML=contents[name];root.style.cssText='background:#fff;color:#17263a';root.querySelectorAll<HTMLElement>('[data-export-page]').forEach(p=>p.style.boxSizing='border-box');document.body.append(root);
        await Promise.all([...root.querySelectorAll('img')].map(i=>i.decode()));
        root.id='native-source';
        if(name==='letterSpacing'){
          const {collectNativeHwpPages}=await import('/src/documents/native-hwp-pages.ts' as string);
          const [collected]=await collectNativeHwpPages(root,'portrait');
          if(!collected.html.includes('letter-spacing:2px')||!collected.html.includes('letter-spacing:-2px'))throw Error('자간 전달 누락');
        }
        if(name==='collapsedPhotoMargins'){
          const {collectNativeHwpPages}=await import('/src/documents/native-hwp-pages.ts' as string);
          const [collected]=await collectNativeHwpPages(root,'portrait');
          const top=root.querySelector('img')!.getBoundingClientRect().top-root.getBoundingClientRect().top;
          if(Math.abs(collected.margins.top-top)>.1)throw Error('첫 사진 위 여백 누락');
        }
        if(name==='normalLine'){
          const {collectNativeHwpPages}=await import('/src/documents/native-hwp-pages.ts' as string);
          const [collected]=await collectNativeHwpPages(root,'portrait');
          const height=root.querySelector('p')!.getBoundingClientRect().height;
          if(!collected.html.includes(`line-height:${height}px`))throw Error('normal 줄 높이 실측 누락');
        }
        if(name==='inlineBreaks'){
          const {collectNativeHwpPages}=await import('/src/documents/native-hwp-pages.ts' as string);
          const [collected]=await collectNativeHwpPages(root,'portrait');
          const css=getComputedStyle(root.querySelector('p')!);
          const leading=(parseFloat(css.lineHeight)-parseFloat(css.fontSize))/2;
          if(Math.abs(collected.margins.top-(40+parseFloat(css.marginTop)+leading))>.1||!collected.html.includes(`margin-bottom:${parseFloat(css.marginBottom)-leading}px`))throw Error('첫 줄 반행간 또는 문단 진행 높이 불일치');
        }
        if(name==='toc'){
          const {collectNativeHwpPages}=await import('/src/documents/native-hwp-pages.ts' as string);
          const [collected]=await collectNativeHwpPages(root,'portrait');
          const row=root.querySelector('li')!,title=row.querySelector('span')!;
          const geometry=collected.tableGeometry![0];
          const expected=title.getBoundingClientRect().left-row.getBoundingClientRect().left;
          if(Math.abs(geometry.cells[0].width+geometry.cells[1].padding.left-expected)>0.1)throw Error('목차 열 간격 누락');
        }
        const progress:string[]=[];
        const exported=await downloadFinalDocument({root,format:'hwp',fileName:'native-'+name,orientation:'portrait',onProgress:(message:string)=>progress.push(message)});
        if(name==='sourcePage' && (!progress.some(message=>message.includes('문장·표 개별 편집 불가')) || progress.some(message=>message.includes('편집 가능한 HWP'))))throw Error('원본 페이지 이미지를 편집 가능한 문장·표로 안내함');
        return exported;
      },name).catch(error=>{download.catch(()=>{});throw error;});
      const artifact=await download;
      assert.equal(result.pageCount,1);assert.ok(result.byteSize>512);assert.equal(artifact.suggestedFilename(),'native-'+name+'.hwp');
      const path=await artifact.path();assert.ok(path);assert.equal(sha(readFileSync(path)),result.sha256);
      if(process.env.CF148_HWP_ARTIFACTS==='1'){
        mkdirSync('output/cf148/native-browser',{recursive:true});writeFileSync('output/cf148/native-browser/'+artifact.suggestedFilename(),readFileSync(path));
        await page.locator('#native-source').screenshot({path:`output/cf148/native-browser/${name}-source.png`});
        await page.evaluate(async bytes=>{
          const {loadNativeHwpEngine}=await import('/src/documents/native-hwp-runtime.ts' as string);
          const Engine=await loadNativeHwpEngine(),doc=new Engine(Uint8Array.from(bytes));
          try{document.querySelector('#native-source')!.innerHTML=doc.renderPageSvg(0);}finally{doc.free();}
        },[...readFileSync(path)]);
        await page.locator('#native-source').screenshot({path:`output/cf148/native-browser/${name}-hwp.png`});
      }
      await page.evaluate(()=>document.querySelector('#native-source')?.remove());
    });
    assert.ok(requests.includes(origin+'/rhwp/native/rhwp-ad01e939079e.js'));
    assert.ok(requests.every(url=>url.startsWith(origin+'/')),'No source document is sent to another service');
  }finally{await browser.close();await server.close();}
});
