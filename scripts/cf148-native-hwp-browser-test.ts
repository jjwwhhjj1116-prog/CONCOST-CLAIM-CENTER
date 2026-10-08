import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import test from 'node:test';
import type {NativeHwpPage} from '../apps/web/src/documents/editable-hwp-export';

test('reviewed browser DOM downloads native HWP using the pinned same-origin runtime',async t=>{
  assert.match(readFileSync('apps/web/src/theme-system.css','utf8'),/@font-face\s*\{[^}]*font-family:'HY헤드라인M'[^}]*local\('HYHeadLine-Medium'\)/u,'Resolve the existing HY font alias without redistributing font bytes');
  const {createServer}=await import('../apps/web/qa/vite-server.js');
  const server=await createServer({root:resolve('apps/web'),...(process.env.CF149_CACHE_ROOT?{cacheDir:process.env.CF149_CACHE_ROOT}:{}),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{name:'cf206-native-archive',resolveId:id=>id==='/cf206-zip.js'?'\0cf206-zip':undefined,load:id=>id==='\0cf206-zip'?"export {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';":undefined}]});
  await server.listen();
  const origin='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port;
  const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>p&&existsSync(p));
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
    for(const name of ['letterSpacing','normalLine','inlineBreaks','photoWhitespace','sourcePage','collapsedPhotoMargins','mergedFooter','cover','toc','denseH2ParagraphMargins','collapsedBlankParagraphs','reportToc10Rows'])await t.test(name,async()=>{
      await page.evaluate(()=>document.querySelectorAll('#native-source').forEach(node=>node.remove()));
      const download=page.waitForEvent('download');
      const result=await page.evaluate(async name=>{
        const {downloadFinalDocument}=await import('/src/documents/final-document-export.ts' as string);
        const canvas=document.createElement('canvas');canvas.width=120;canvas.height=72;canvas.getContext('2d')!.fillRect(0,0,120,72);
        const src=canvas.toDataURL(),root=document.createElement('div');root.className=name==='reportToc10Rows'?'report-final-document':'proposal-final-document';
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
          toc:'<section class="proposal-final-toc" data-export-page data-page-number="2"><h3>목 차</h3><ol><li><b>04</b><span>전문가 현황</span><i>03</i></li></ol></section>',
          denseH2ParagraphMargins:'<section data-export-page data-export-page-policy="fit" style="width:794px;height:1123px;padding:96px 80px 76px;font:16px/29.6px Arial"><article style="display:flow-root">'+Array.from({length:8},(_,i)=>`<h2 style="font:20px/32px Arial;margin:28px 0 16px"><strong>CF205 제목 ${i+1}</strong></h2><p style="font:16px/29.6px Arial;margin:16px 0">CF205 본문 ${i+1} <em>금액 123,456원</em>.</p>`).join('')+'</article></section>',
          collapsedBlankParagraphs:'<style>#native-source .cf205-collapse h2{font:20px/32px Arial;margin:28px 0 16px}#native-source .cf205-collapse p{font:16px/29.6px Arial;margin:16px 0}#native-source .cf205-collapse p:empty{height:0;min-height:0}</style><section data-export-page data-export-page-policy="fit" style="width:794px;height:1123px;padding:96px 80px 76px;font:16px/29.6px Arial"><article class="cf205-collapse" style="display:flow-root">'+Array.from({length:6},(_,i)=>`<h2><strong>CF205 짧은 제목 ${i+1}</strong></h2><p>CF205 본문 ${i+1} 첫째 줄 123,456원.<br>둘째 줄 <em>246.90 보존</em>.</p><p></p>`).join('')+'<p></p><p></p></article></section>',
          reportToc10Rows:'<section class="report-final-body report-final-toc report-paginated-sheet" data-export-page data-export-page-policy="fit" data-page-number="2"><h2>목 차</h2><article class="report-toc-content">'+Array.from({length:10},(_,i)=>`<div class="report-toc-entry report-toc-level-2"><span>${i===0?'CF206 담당자 수정한 첫 목차':i===4?'5. 실무 검수':i===9?'10. 원문':`CF206 원본 목차 ${i+1}: 프로젝트 및 계약상 권리 검수`}</span><span class="report-toc-leader"></span><span class="report-toc-page">${i<6?1:2}</span></div>`).join('')+'</article><footer class="report-page-number">- 목차 1 -</footer></section>'
        };
        root.innerHTML=contents[name];root.style.cssText='background:#fff;color:#17263a';root.querySelectorAll<HTMLElement>('[data-export-page]').forEach(p=>p.style.boxSizing='border-box');document.body.append(root);
        await Promise.all([...root.querySelectorAll('img')].map(i=>i.decode()));
        root.id='native-source';
        const before=root.innerHTML;
        let metrics:any;
        if(name==='reportToc10Rows'){
          await document.fonts.ready;
          const {collectNativeHwpPages}=await import('/src/documents/native-hwp-pages.ts' as string);
          const [collected]=await collectNativeHwpPages(root,'portrait');
          const rows=[...root.querySelectorAll<HTMLElement>('.report-toc-entry')];
          metrics={sourceUnchanged:root.innerHTML===before,tables:collected.tables,cells:collected.tableCells?.map((table:NonNullable<NativeHwpPage['tableCells']>[number])=>table.length),geometry:collected.tableGeometry,rules:collected.rules,
            titles:rows.map(row=>row.firstElementChild!.textContent),numbers:rows.map(row=>row.lastElementChild!.textContent),
            boxes:rows.map(row=>{const box=row.getBoundingClientRect();return{width:box.width,height:box.height,offsetWidth:row.offsetWidth,offsetHeight:row.offsetHeight,spans:[...row.children].map(node=>{const child=node.getBoundingClientRect();return{width:child.width,left:child.left-box.left,top:child.top-box.top,bottom:box.bottom-child.bottom};})};})};
        }
        if(name==='denseH2ParagraphMargins'||name==='collapsedBlankParagraphs'){
          await document.fonts.ready;
          const {collectNativeHwpPages}=await import('/src/documents/native-hwp-pages.ts' as string);
          const section=root.querySelector<HTMLElement>('[data-export-page]')!,article=section.querySelector<HTMLElement>('article')!;
          const nodes=[...article.children] as HTMLElement[],visible=nodes.filter(node=>node.getBoundingClientRect().height>0.1);
          const [collected]=await collectNativeHwpPages(root,'portrait');
          const parsed=new DOMParser().parseFromString(collected.html,'text/html');
          metrics={available:section.clientHeight-96-76,articleHeight:article.getBoundingClientRect().height,heights:nodes.map(node=>node.getBoundingClientRect().height),gaps:visible.slice(1).map((node,i)=>node.getBoundingClientRect().top-visible[i].getBoundingClientRect().bottom),zeroParagraphs:nodes.filter(node=>node.tagName==='P'&&!node.childNodes.length&&!node.attributes.length&&node.offsetHeight===0).length,nativeParagraphs:parsed.querySelectorAll('p').length,spacing:[...parsed.querySelectorAll<HTMLElement>('p')].map(node=>({top:parseFloat(node.style.marginTop)||0,bottom:parseFloat(node.style.marginBottom)||0,line:parseFloat(node.style.lineHeight)||0})),sourceUnchanged:root.innerHTML===before};
          if(metrics.available!==951||metrics.articleHeight>951||!metrics.sourceUnchanged)throw Error('CF205 synthetic source geometry failed: '+JSON.stringify(metrics));
        }
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
        let exported;
        try{exported=await downloadFinalDocument({root,format:'hwp',fileName:'native-'+name,orientation:'portrait',onProgress:(message:string)=>progress.push(message)});}
        catch(error){throw Error(String(error)+(metrics?` ${name==='reportToc10Rows'?'CF206':'CF205'} measured DOM/collector: `+JSON.stringify(metrics):''));}
        if(name==='sourcePage' && (!progress.some(message=>message.includes('문장·표 개별 편집 불가')) || progress.some(message=>message.includes('편집 가능한 HWP'))))throw Error('원본 페이지 이미지를 편집 가능한 문장·표로 안내함');
        return {...exported,...(metrics?{metrics,sourceUnchanged:root.innerHTML===before}:{})};
      },name).catch(error=>{download.catch(()=>{});throw error;});
      const artifact=await download;
      assert.equal(result.pageCount,1);assert.ok(result.byteSize>512);assert.equal(artifact.suggestedFilename(),'native-'+name+'.hwp');
      const path=await artifact.path();assert.ok(path);assert.equal(sha(readFileSync(path)),result.sha256);
      if(name==='reportToc10Rows'){
        assert.equal(result.sourceUnchanged,true);assert.equal(result.metrics.sourceUnchanged,true);assert.equal(result.metrics.tables,10);
        assert.deepEqual(result.metrics.cells,Array(10).fill(3));assert.deepEqual(result.metrics.numbers,[...Array(6).fill('1'),...Array(4).fill('2')]);
        assert.equal(result.metrics.titles[0],'CF206 담당자 수정한 첫 목차');
        const reopened=await page.evaluate(async bytes=>{
          const {loadNativeHwpEngine}=await import('/src/documents/native-hwp-runtime.ts' as string);const {collectNativeHwpPages}=await import('/src/documents/native-hwp-pages.ts' as string);const {verifyNativeHwpContent}=await import('/src/documents/editable-hwp-export.ts' as string);
          const {unzipSync,zipSync,strFromU8,strToU8}=await import('/cf206-zip.js' as string);
          const source=document.querySelector<HTMLElement>('#native-source')!,before=source.innerHTML,pages=await collectNativeHwpPages(source,'portrait'),Engine=await loadNativeHwpEngine(),doc=new Engine(Uint8Array.from(bytes));
          try{
            const archive=doc.exportHwpx();verifyNativeHwpContent(archive,pages);
            const zip=unzipSync(archive),xml=strFromU8(zip['Contents/section0.xml']);
            if(!xml.includes('style="DOT"'))throw Error('CF206 native DOT definition missing');
            let overwrittenDotBlocked=false;
            try{verifyNativeHwpContent(zipSync({...zip,'Contents/section0.xml':strToU8(xml.replace('style="DOT"','style="SOLID"'))}),pages);}catch(error){if(!String(error).includes('목차 점선의 모양'))throw error;overwrittenDotBlocked=true;}
            const altered=structuredClone(pages),firstGeometry=altered[0].tableGeometry![0];
            if(!Number.isFinite(firstGeometry.advance))throw Error('CF206 measured TOC row advance missing');
            firstGeometry.advance!+=1;
            let alteredAdvanceBlocked=false;
            try{verifyNativeHwpContent(archive,altered);}catch(error){if(!String(error).includes('목차 행 간격'))throw error;alteredAdvanceBlocked=true;}
            const section=new DOMParser().parseFromString(xml,'application/xml');let carrier=section.getElementsByTagName('hp:tbl')[0]?.parentElement;
            while(carrier&&carrier.localName!=='p')carrier=carrier.parentElement;
            const header=strFromU8(zip['Contents/header.xml']),definition=[...header.matchAll(/<hh:paraPr\b[^>]*>[\s\S]*?<\/hh:paraPr>/gu)].find(match=>new DOMParser().parseFromString(match[0],'text/html').body.firstElementChild?.getAttribute('id')===carrier?.getAttribute('paraPrIDRef'))?.[0];
            const casePart=definition?.match(/<hp:case\b[^>]*>[\s\S]*?<\/hp:case>/u)?.[0];
            if(!definition||!casePart||!/<hc:next\b[^>]*\/>/u.test(casePart))throw Error('CF206 serialized TOC carrier case next missing');
            const missingNextHeader=header.replace(definition,definition.replace(casePart,casePart.replace(/<hc:next\b[^>]*\/>/u,'')));
            let missingCaseNextBlocked=false;
            try{verifyNativeHwpContent(zipSync({...zip,'Contents/header.xml':strToU8(missingNextHeader)}),pages);}catch(error){if(!String(error).includes('목차 행 간격'))throw error;missingCaseNextBlocked=true;}
            verifyNativeHwpContent(archive,pages);
            return{pages:doc.pageCount(),sourceUnchanged:source.innerHTML===before,svg:doc.renderPageSvg(0),overwrittenDotBlocked,alteredAdvanceBlocked,missingCaseNextBlocked};
          }finally{doc.free();}
        },[...readFileSync(path)]);
        assert.equal(reopened.pages,1);assert.equal(reopened.sourceUnchanged,true);
        assert.equal(reopened.overwrittenDotBlocked,true);
        assert.equal(reopened.alteredAdvanceBlocked,true);
        assert.equal(reopened.missingCaseNextBlocked,true);
        const rendered=await page.evaluate(async svg=>{
          const source=document.querySelector<HTMLElement>('#native-source [data-export-page]')!,box=source.getBoundingClientRect();
          const target=[...source.querySelectorAll<HTMLElement>('.report-toc-entry')].map(row=>{
            const spans=[row.firstElementChild!,row.lastElementChild!];return spans.map(span=>{const walk=document.createTreeWalker(span,NodeFilter.SHOW_TEXT);walk.nextNode();const range=document.createRange();range.setStart(walk.currentNode,0);range.setEnd(walk.currentNode,1);const rect=range.getBoundingClientRect();return{text:span.textContent!,x:rect.x-box.x,y:rect.y-box.y};});
          });
          const probe=document.createElement('div');probe.style.cssText='position:absolute;left:-5000px;top:0;width:794px;height:1123px';probe.innerHTML=svg;document.body.append(probe);
          try{
            await document.fonts.ready;const paper=probe.querySelector('svg')!,paperBox=paper.getBoundingClientRect(),rows=new Map<number,{text:string;nodes:SVGTextContentElement[]}>();
            for(const node of paper.querySelectorAll<SVGTextContentElement>('text')){if(!node.getNumberOfChars())continue;const start=node.getStartPositionOfChar(0),point=new DOMPoint(start.x,start.y).matrixTransform(node.getScreenCTM()!),key=Math.round((point.y-paperBox.y)*10),prior=rows.get(key);if(prior){prior.text+=node.textContent??'';prior.nodes.push(node);}else rows.set(key,{text:node.textContent??'',nodes:[node]});}
            const glyphs=target.map(([title,page],i)=>{
              const matches=[...rows.values()].filter(row=>row.text.replace(/\s+/gu,'').startsWith(title.text.replace(/\s+/gu,'')));if(matches.length!==1)throw Error('CF206 native title glyph ambiguous '+i+' '+JSON.stringify([...rows.values()].map(row=>row.text)));
              const nodes=matches[0].nodes,number=nodes.filter(node=>node.textContent?.trim()===page.text).at(-1);if(!number)throw Error('CF206 native page-number glyph missing '+i);
              return [nodes[0],number].map((node,index)=>{const dom=index?page:title,rect=node.getExtentOfChar(0),point=new DOMPoint(rect.x,rect.y).matrixTransform(node.getScreenCTM()!);return{row:i+1,kind:index?'page':'title',text:dom.text,domX:dom.x,domY:dom.y,svgX:point.x-paperBox.x,svgY:point.y-paperBox.y};});
            }).flat();
            const dots=[...paper.querySelectorAll<SVGGraphicsElement>('[stroke-dasharray]')].map(node=>{const rect=node.getBBox(),point=new DOMPoint(rect.x,rect.y).matrixTransform(node.getScreenCTM()!);return{x:point.x-paperBox.x,y:point.y-paperBox.y,width:rect.width,height:rect.height,dash:node.getAttribute('stroke-dasharray'),stroke:parseFloat(getComputedStyle(node).strokeWidth),color:getComputedStyle(node).stroke};}).sort((a,b)=>a.y-b.y);
            return{glyphs,dots};
          }finally{probe.remove();}
        },reopened.svg);
        const progression=rendered.glyphs.map(glyph=>{const first=rendered.glyphs.find(node=>node.kind===glyph.kind)!;return{row:glyph.row,kind:glyph.kind,deltaY:(glyph.svgY-first.svgY)-(glyph.domY-first.domY),deltaX:glyph.svgX-glyph.domX};});
        console.log('CF206 report TOC actual save/reopen',JSON.stringify({metrics:result.metrics,rendered,progression,maxProgressionY:Math.max(...progression.map(node=>Math.abs(node.deltaY))),maxAbsoluteY:Math.max(...rendered.glyphs.map(node=>Math.abs(node.svgY-node.domY))),overwrittenDotBlocked:reopened.overwrittenDotBlocked,alteredAdvanceBlocked:reopened.alteredAdvanceBlocked,missingCaseNextBlocked:reopened.missingCaseNextBlocked,coordinateScope:'Same-pixel DOM Range / reopened SVG glyph progression at the existing 0.1px bound; absolute cross-font offset is reported, not a new visual-fidelity PASS'}));
        assert.equal(rendered.dots.length,10);assert.ok(rendered.dots.every(dot=>dot.dash==='2 2'&&Math.abs(dot.stroke-1)<.1));
        for(let i=0;i<10;i++){const dot=rendered.dots[i],expected=result.metrics.rules[i];assert.ok(Math.abs(dot.x-expected.left)<=.1&&Math.abs(dot.y-expected.top)<=.1&&Math.abs(dot.width-expected.width)<=.1,'CF206 actual dotted line geometry must match the reviewed span');}
        assert.ok(progression.every(node=>Math.abs(node.deltaY)<=.1),'CF206 native title/page rows must retain reviewed progression');
      }
      if(name==='denseH2ParagraphMargins'||name==='collapsedBlankParagraphs'){
        assert.equal(result.sourceUnchanged,true);assert.equal(result.metrics.nativeParagraphs,name==='denseH2ParagraphMargins'?16:12);
        assert.equal(result.metrics.zeroParagraphs,name==='denseH2ParagraphMargins'?0:8);
        assert.ok(result.metrics.gaps.every((gap:number,i:number)=>Math.abs(gap-(i%2===0?16:28))<.1),JSON.stringify(result.metrics.gaps));
        const reopened=await page.evaluate(async bytes=>{const {loadNativeHwpEngine}=await import('/src/documents/native-hwp-runtime.ts' as string);const {verifyNativeHwpContent}=await import('/src/documents/editable-hwp-export.ts' as string);const {collectNativeHwpPages}=await import('/src/documents/native-hwp-pages.ts' as string);const source=document.querySelector<HTMLElement>('#native-source')!,before=source.innerHTML,pages=await collectNativeHwpPages(source,'portrait');const Engine=await loadNativeHwpEngine(),doc=new Engine(Uint8Array.from(bytes));try{verifyNativeHwpContent(doc.exportHwpx(),pages);return{count:doc.pageCount(),sourceUnchanged:source.innerHTML===before,svg:doc.renderPageSvg(0)};}finally{doc.free();}},[...readFileSync(path)]);
        assert.equal(reopened.count,1);assert.equal(reopened.sourceUnchanged,true);assert.match(reopened.svg,/<svg\b/u);
        const glyphs=await page.evaluate(async svg=>{
          const source=document.querySelector<HTMLElement>('#native-source [data-export-page]')!,paperBox=source.getBoundingClientRect();
          const targets=[...source.querySelectorAll<HTMLElement>('article > h2,article > p')].filter(node=>node.textContent?.trim()).map(node=>{
            const walk=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let text:Node|null=null;
            while(walk.nextNode())if(walk.currentNode.textContent?.trim()){text=walk.currentNode;break;}
            if(!text)throw Error('CF205 source first glyph missing');
            const range=document.createRange();range.setStart(text,0);range.setEnd(text,1);
            return{tag:node.tagName,text:text.textContent!.trim(),domY:range.getBoundingClientRect().top-paperBox.top};
          });
          const probe=document.createElement('div');probe.style.cssText='position:absolute;left:-5000px;top:0;width:794px;height:1123px';probe.innerHTML=svg;document.body.append(probe);
          try {
            await document.fonts.ready;
            const paper=probe.querySelector('svg')!,box=paper.getBoundingClientRect();
            const rows=new Map<number,{text:string;node:SVGTextContentElement}>();
            for(const node of paper.querySelectorAll<SVGTextContentElement>('text')){
              if(!node.getNumberOfChars())continue;
              const start=node.getStartPositionOfChar(0),position=new DOMPoint(start.x,start.y).matrixTransform(node.getScreenCTM()!);
              const key=Math.round((position.y-box.top)*10),row=rows.get(key);
              if(row)row.text+=node.textContent??'';else rows.set(key,{text:node.textContent??'',node});
            }
            return targets.map(target=>{
              const matches=[...rows.values()].filter(row=>row.text.replace(/\s+/gu,'').startsWith(target.text.replace(/\s+/gu,'')));
              if(matches.length!==1)throw Error('CF205 native first glyph ambiguous: '+target.text+' ('+matches.length+') '+JSON.stringify([...rows.values()].slice(0,4).map(row=>row.text)));
              const node=matches[0].node,glyph=node.getExtentOfChar(0),matrix=node.getScreenCTM()!;
              const y=new DOMPoint(glyph.x,glyph.y).matrixTransform(matrix).y-box.top;
              return{...target,svgY:y,delta:y-target.domY,font:getComputedStyle(node).fontFamily,fontSize:getComputedStyle(node).fontSize};
            });
          } finally {probe.remove();}
        },reopened.svg);
        assert.equal(glyphs.length,name==='denseH2ParagraphMargins'?16:12);
        assert.ok(glyphs.every(glyph=>Number.isFinite(glyph.domY)&&Number.isFinite(glyph.svgY)));
        const progression=glyphs.map(glyph=>{const first=glyphs.find(node=>node.tag===glyph.tag)!;return{tag:glyph.tag,text:glyph.text,dom: glyph.domY-first.domY,svg:glyph.svgY-first.svgY,delta:(glyph.svgY-first.svgY)-(glyph.domY-first.domY)};});
        assert.ok(progression.every(node=>Math.abs(node.delta)<=0.1),'Repeated H2/P progression must retain the existing 0.1px DOM geometry bound');
        console.log('CF205 actual save/reopen measurement',name,JSON.stringify({metrics:result.metrics,pageCount:reopened.count,glyphs,progression,maxProgressionError:Math.max(...progression.map(node=>Math.abs(node.delta))),coordinateScope:'Raw same-pixel DOM Range / reopened SVG glyph comparison; not a new cross-font visual tolerance PASS'}));
      }
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
    await t.test('CF205 visible or explicitly authored blank paragraphs remain represented in native collection',async()=>{
      const results=await page.evaluate(async()=>{
        const {collectNativeHwpPages}=await import('/src/documents/native-hwp-pages.ts' as string);
        return await Promise.all([
          {name:'height',blank:'<p style="height:24px;min-height:0"></p>'},
          {name:'minHeight',blank:'<p></p>',rule:'p:nth-child(2){min-height:24px}'},
          {name:'br',blank:'<p><br></p>'},
          {name:'spacer',blank:'<p><span data-document-spacer="24" style="display:block;height:24px"></span></p>'},
          {name:'authoredZero',blank:'<p data-review-blank="true" style="height:0;min-height:0"></p>'}
        ].map(async({name,blank,rule})=>{
          const root=document.createElement('div');root.id='cf205-blank-'+name;root.innerHTML='<style>#'+root.id+' p{font:16px/29.6px Arial;margin:16px 0}'+(rule?'#'+root.id+' '+rule:'')+'</style><section data-export-page style="box-sizing:border-box;width:794px;height:1123px;padding:40px"><article style="display:flow-root"><p>CF205 before 0</p>'+blank+'<p>CF205 after 246.90</p></article></section>';document.body.append(root);
          const before=root.innerHTML,height=root.querySelector<HTMLElement>('p:nth-child(2)')!.offsetHeight;
          try{const [page]=await collectNativeHwpPages(root,'portrait');return{name,height,paragraphs:new DOMParser().parseFromString(page.html,'text/html').querySelectorAll('p').length,text:page.text,unchanged:root.innerHTML===before};}
          finally{root.remove();}
        }));
      });
      for(const result of results){assert.equal(result.paragraphs,3,result.name);assert.equal(result.unchanged,true,result.name);assert.ok(result.text.includes('CF205 before 0')&&result.text.includes('CF205 after 246.90'));if(result.name!=='authoredZero')assert.ok(result.height>0,result.name);}
    });
    assert.ok(requests.includes(origin+'/rhwp/native/rhwp-ad01e939079e.js'));
    assert.ok(requests.every(url=>url.startsWith(origin+'/')),'No source document is sent to another service');
  }finally{await browser.close();await server.close();}
});
