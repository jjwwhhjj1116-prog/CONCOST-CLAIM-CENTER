import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('Report editing preserves IDs, navigates chapters, edits front matter and fits long table columns', async () => {
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  let saved = 'null', saveRequests = 0;
  const presentationPath = resolve('packages/document-engine/src/report-presentation.ts').replace(/\\/g,'/');
  const server = await createServer({ root:resolve('apps/web'), ...(process.env.CF149_CACHE_ROOT ? {cacheDir:process.env.CF149_CACHE_ROOT} : {}), server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{
    name:'report-editing-fixture',
    configureServer(server){server.middlewares.use(async(req,res,next)=>{
      if(/^\/page-\d+\.svg$/u.test(req.url??'')){res.setHeader('Content-Type','image/svg+xml');res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123"><rect width="794" height="1123" fill="white"/><text x="80" y="180">${req.url}</text></svg>`);return;}
      if(req.url==='/draft'){
        if(req.method==='PUT'){saveRequests++;const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));saved=Buffer.concat(chunks).toString();}
        res.setHeader('Content-Type','application/json');res.end(saved);return;
      }
      if(req.url!=='/editing.html')return next();
      res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<html><body><div id="root"></div><script type="module" src="/editing-entry.js"></script></body></html>'));
    });},
    resolveId:id=>id==='/editing-entry.js'?'\0editing-entry':undefined,
    load:id=>id==='\0editing-entry'?`
      import React,{useState,useRef,useEffect} from 'react';import{createRoot}from'react-dom/client';
      import{StructuredDocumentEditor,parseStructuredDocumentMarkdown,renderStructuredDocumentHtml}from'/src/documents/StructuredDocumentEditor.tsx';
      import{ReportFrontMatterEditor}from'/src/documents/ReportFrontMatterEditor.tsx';
      import{ReportFinalDocumentPreview}from'/src/routes/PreviewReportStudio.tsx';
      import{joinReportPresentation,splitReportPresentation}from'/@fs/${presentationPath}';
      import{reportNativeBodySha256,readBoundReportNativeSource,reportNativeChapterPage,updateReportNativeChapterPage}from'/src/documents/report-native-source.ts';
      import'/src/documents/StructuredDocumentEditor.css';import'/src/documents/DocumentReviewWorkspace.css';
      const original='<!-- AI-CHAPTER:CH-01:START -->\\n## CH-01 개요\\n# 개요\\n'+Array(25).fill('검토 원문 보존.').join('\\n\\n')+'\\n<!-- AI-CHAPTER:CH-01:END -->\\n<!-- AI-CHAPTER:CH-02:START -->\\n## CH-02 산정\\n# 산정\\n<table data-document-defaults-version="2"><colgroup><col style="width:10%"><col style="width:80%"><col style="width:10%"></colgroup><tr><th>번호</th><th>내용</th><th>판단상태</th></tr><tr><td>1</td><td>근거 확인</td><td>UNREVIEWABLE 자료확인전까지검토할수없음</td></tr></table>\\n<!-- AI-CHAPTER:CH-02:END -->';
      function App(){const ref=useRef(null);const[documentKey,setDocumentKey]=useState('cf149-1');const[title,setTitle]=useState('시험 보고서');const[content,setContent]=useState(original);const[json,setJson]=useState(parseStructuredDocumentMarkdown(original));const[front,setFront]=useState({enabled:true,date:'2026.9',author:'작성자'});const[ready,setReady]=useState(false);const changes=useRef(0);
        globalThis.cf149Editing={use:async(next,bound=false)=>{const native={caseId:'40000000-0000-4000-8000-000000000010',evidenceId:'40000000-0000-4000-8000-000000000012',downloadUrl:'/api/cases/evidence/40000000-0000-4000-8000-000000000012/download',name:'synthetic-native-reference.hwp',sha256:'0'.repeat(64),byteSize:5};const doc={...parseStructuredDocumentMarkdown(next),attrs:{reportNativeSource:native}};if(bound){native.bindingVersion=1;native.originalSource={...native,evidenceId:'40000000-0000-4000-8000-000000000013',downloadUrl:'/api/cases/evidence/40000000-0000-4000-8000-000000000013/download',name:'synthetic-first-original.hwp',sha256:'1'.repeat(64)};native.bodySha256=await reportNativeBodySha256(joinReportPresentation(doc,{enabled:false,text:null},{enabled:false}));}setContent(next);setJson(doc);setFront({enabled:false});},get:()=>({json,changes:changes.current}),actual:()=>ref.current.getJSON(),insertTemporary:()=>ref.current.insertHtml('<p>CF180 임시 검수 문단</p>'),binding:async(actual=true)=>{const doc=joinReportPresentation(actual?ref.current.getJSON():json,{enabled:false,text:null},front);try{await readBoundReportNativeSource(doc,'40000000-0000-4000-8000-000000000010');return{valid:true,document:doc};}catch(error){return{valid:false,error:error.message,document:doc};}}};
        useEffect(()=>{fetch('/draft').then(r=>r.json()).then(saved=>{if(saved){setTitle(saved.title);setContent(saved.content);const p=splitReportPresentation(saved.json);setJson(p.body);setFront(p.frontMatter);}setReady(true);});},[]);
        globalThis.cf149Editing.useOrdinary=(next)=>{setContent(next);setJson(parseStructuredDocumentMarkdown(next));};
        globalThis.cf149Editing.jump=(code,title)=>ref.current.goToChapter(code,title);
        globalThis.cf149Editing.replaceSourceIdentity=async()=>{const doc=structuredClone(json);Object.assign(doc.attrs.reportNativeSource,{evidenceId:'40000000-0000-4000-8000-000000000014',downloadUrl:'/api/cases/evidence/40000000-0000-4000-8000-000000000014/download',sha256:'2'.repeat(64)});doc.attrs.reportNativeSource.bodySha256=await reportNativeBodySha256(joinReportPresentation(doc,{enabled:false,text:null},front));setJson(doc);};
        const sourceChapters=[{id:'PROMPT-TYPE-01-CH-01',title:'대상·개요'},{id:'PROMPT-TYPE-01-CH-02',title:'감정자료 목록'}];
        const confirmSourceChapter=async(id,page)=>{const body=ref.current.getJSON();await readBoundReportNativeSource(joinReportPresentation(body,{enabled:false,text:null},front),'40000000-0000-4000-8000-000000000010');const next=updateReportNativeChapterPage(body,'40000000-0000-4000-8000-000000000010',id,page,sourceChapters.map(x=>x.id));setJson(next);const response=await fetch('/draft',{method:'PUT',body:JSON.stringify({title,content,json:joinReportPresentation(next,{enabled:false,text:null},front)})});return response.ok;};
        globalThis.cf149Editing.jumpSourceChapter=async(id)=>{const body=ref.current.getJSON(),joined=joinReportPresentation(body,{enabled:false,text:null},front);const source=await readBoundReportNativeSource(joined,'40000000-0000-4000-8000-000000000010');const page=reportNativeChapterPage(body,source.caseId,id,sourceChapters.map(x=>x.id));return page!==null&&ref.current.goToSourcePage(page,source);};
        globalThis.cf149Editing.jumpExpectedSource=(page,source)=>ref.current.goToSourcePage(page,source);
        globalThis.cf149Editing.remount=(key)=>setDocumentKey(key);
        if(!ready)return null;
        return React.createElement(React.Fragment,null,
          React.createElement('button',{onClick:()=>ref.current.goToChapter('CH-02')},'산정으로 이동'),
          React.createElement('button',{onClick:()=>{globalThis.cf187Jump=ref.current.goToChapter('CH-02','공사비 산정');}},'제목으로 산정 이동'),
          React.createElement('button',{onClick:async()=>{await fetch('/draft',{method:'PUT',body:JSON.stringify({title,content,json:joinReportPresentation(json,{enabled:false,text:null},front)})});document.querySelector('#saved').textContent='저장 완료';}},'저장'),React.createElement('span',{id:'saved'}),
          React.createElement(StructuredDocumentEditor,{ref,documentKey,reportMode:true,label:'시험 보고서 편집',value:content,editorJson:json,sourceChapterLinks:{chapters:sourceChapters,disabled:false,onConfirm:confirmSourceChapter},onChange:(text,doc)=>{changes.current++;setContent(text);setJson(doc);},
            beforeContent:React.createElement(ReportFrontMatterEditor,{title,caseTitle:'사건명',html:renderStructuredDocumentHtml(json),value:front,disabled:false,onTitle:setTitle,onChange:setFront,onEditNative:()=>{globalThis.cf149NativeOpened=(globalThis.cf149NativeOpened??0)+1;}}),
            previewContent:React.createElement(ReportFinalDocumentPreview,{title,caseTitle:'사건명',caseNumber:'QA',content,editorJson:joinReportPresentation(json,{enabled:false,text:null},front)})}));
      }createRoot(document.getElementById('root')).render(React.createElement(App));
    `:undefined
  }]});
  await server.listen();
  const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);assert.ok(executablePath);
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(10000);
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const origin='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port;
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await page.goto(origin+'/editing.html');
    await page.locator('.tiptap').waitFor();
    assert.doesNotMatch(await page.locator('.tiptap').innerText(),/CH-0[12]/);
    assert.equal(await page.locator('.tiptap .report-chapter-heading').last().getAttribute('data-report-chapter-number'),'2. ');
    assert.equal(await page.getByLabel('표지 제목 편집',{exact:true}).getAttribute('maxlength'),'300');
    await page.getByLabel('표지 제목 편집',{exact:true}).fill('수정 표지');
    await page.getByLabel('표지 부제 편집',{exact:true}).fill('수정 부제');
    await page.getByLabel('표지 작성자 편집',{exact:true}).fill('수정 작성자');
    await page.getByLabel('표지 작성일 편집',{exact:true}).fill('2026.09.28');
    await page.getByLabel('목차 표제 편집',{exact:true}).fill('수정 목차');
    await page.getByLabel('목차 항목 2. 산정',{exact:true}).fill('2. 산정 검토 결과');
    await page.getByRole('button',{name:'산정으로 이동',exact:true}).click();
    const position=await page.locator('.tiptap .report-chapter-heading').last().evaluate(el=>{
      const heading=el.getBoundingClientRect(),side=el.closest('.document-review-pages__side')!.getBoundingClientRect();return heading.top>=side.top&&heading.top<side.bottom;
    });assert.equal(position,true,'Selected chapter must be inside the editor viewport');
    const table=page.locator('.tiptap table');
    const tableWidth=await table.evaluate(el=>el.getBoundingClientRect().width);
    const tableText=await table.innerText();
    const before=await table.locator('tr').last().locator('td').last().evaluate(el=>el.getBoundingClientRect().width);
    await table.locator('tr').last().locator('td').last().click();
    await page.getByRole('button',{name:'선택 표 열너비를 내용에 맞게 조정',exact:true}).click();
    const after=await table.locator('tr').last().locator('td').last().evaluate(el=>el.getBoundingClientRect().width);
    assert.ok(after>before*1.5,'Long status column should receive usable width');
    assert.ok(Math.abs(await table.evaluate(el=>el.getBoundingClientRect().width)-tableWidth)<2);
    assert.equal(await table.innerText(),tableText);
    await page.getByRole('button',{name:'저장',exact:true}).click();await page.getByText('저장 완료',{exact:true}).waitFor();
    assert.match(saved,/AI-CHAPTER:CH-02:START/);assert.match(saved,/UNREVIEWABLE/);assert.match(saved,/수정 부제/);
    await page.reload();await page.locator('.tiptap').waitFor();
    assert.equal(await page.getByLabel('표지 제목 편집',{exact:true}).inputValue(),'수정 표지');
    assert.equal(await page.getByLabel('목차 항목 2. 산정',{exact:true}).inputValue(),'2. 산정 검토 결과');
    const output=page.locator('[aria-label="확정 보고서 전체 미리보기"]');
    await output.locator('[data-export-page]').getByText('2. 산정 검토 결과',{exact:true}).waitFor();
    assert.match(await output.innerText(),/수정 표지/);assert.match(await output.innerText(),/수정 작성자/);
    assert.match(await output.innerText(),/수정 부제/);assert.match(await output.innerText(),/수정 목차/);
    assert.equal(await page.getByLabel('표지 작성일 편집',{exact:true}).inputValue(),'2026.09.28');
    assert.ok(await output.locator('.report-toc-page').allTextContents().then(values=>values.length>0&&values.every(v=>/^\d+$/.test(v))));
    const restored=await page.locator('.tiptap table tr').last().locator('td').last().evaluate(el=>el.getBoundingClientRect().width);assert.ok(Math.abs(restored-after)<2);
    const normalPadding=await page.locator('.tiptap').evaluate(el=>getComputedStyle(el).padding);
    const pageHtml=Array.from({length:17},(_,i)=>`<img src="${origin}/page-${i+1}.svg" alt="원본 ${i+1}쪽" data-report-source-page="true">`).join('\n\n');
    const nativeDocument='<!-- MANUAL-WHOLE-DOCUMENT:START -->\n\n'+pageHtml+'\n\n<!-- MANUAL-WHOLE-DOCUMENT:END -->';
    const expectedPages=Array.from({length:17},(_,i)=>[`${origin}/page-${i+1}.svg`,`원본 ${i+1}쪽`]);
    await page.evaluate(value=>(globalThis as any).cf149Editing.use(value,true),nativeDocument);
    await page.locator('[data-export-page]').nth(16).waitFor();
    const nativeBefore=await page.evaluate(()=>(globalThis as any).cf149Editing.get());
    const actualNativeBefore=await page.evaluate(()=>(globalThis as any).cf149Editing.actual());
    assert.equal(await page.evaluate(()=>(globalThis as any).cf149Editing.jump('CH-02','공사비 산정')),false,'Source-page images must not acquire guessed chapter mappings');
    assert.deepEqual(actualNativeBefore,nativeBefore.json,'The real Tiptap document must match the imported body, not silently append invisible paragraphs');
    assert.equal((await page.evaluate(()=>(globalThis as any).cf149Editing.binding())).valid,true,'The original native binding must also validate against actual ref.getJSON()');
    const sourcePageNavigation=page.getByRole('combobox',{name:'원형 보고서 쪽 이동',exact:true});
    assert.equal(await sourcePageNavigation.count(),1,'Whole-document source pages need an explicit page navigator without guessed chapter mapping');
    const nativeEditButton=page.getByRole('button',{name:'표지·목차·표를 HWP 편집기에서 수정',exact:true});
    assert.equal(await nativeEditButton.count(),1,'Imported native pages need an explicit cover/TOC editing action in the editing pane');
    assert.equal(await page.getByLabel('표지 제목 편집',{exact:true}).count(),0,'Do not inject a duplicate generated cover into an imported original');
    await nativeEditButton.click();
    assert.equal(await page.evaluate(()=>(globalThis as any).cf149NativeOpened),1);
    assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.get()),nativeBefore,'Opening the native editor must not rewrite the report body');
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:1000});
      // Responsive scale updates on animation frames. Wait for the unchanged
      // parity criterion instead of sampling an intermediate resize frame.
      await page.waitForFunction(()=>{
        const edited=document.querySelector('.tiptap img')?.getBoundingClientRect();
        const preview=document.querySelector('[data-export-page] img')?.getBoundingClientRect();
        const pane=document.querySelector('.document-review-pages__side') as HTMLElement|null;
        return edited&&preview&&pane&&edited.width<=pane.clientWidth+1&&Math.abs(edited.width-preview.width)<1&&Math.abs(edited.height-preview.height)<1;
      });
      // Measure both panes in one browser task; separate evaluations can straddle
      // the same resize frame and incorrectly compare old and new scale values.
      const {geometry,printed}=await page.evaluate(()=>{
        const el=document.querySelector('.tiptap img') as HTMLImageElement;
        const output=document.querySelector('[data-export-page] img') as HTMLImageElement;
        return {
          geometry:{width:el.clientWidth,height:el.clientHeight,padding:getComputedStyle(el.closest('.tiptap')!).padding,margin:getComputedStyle(el).margin,rectWidth:el.getBoundingClientRect().width,rectHeight:el.getBoundingClientRect().height},
          printed:{width:output.clientWidth,height:output.clientHeight,rectWidth:output.getBoundingClientRect().width,rectHeight:output.getBoundingClientRect().height},
        };
      });
      assert.deepEqual([geometry.width,geometry.height],[794,1123],'Native page editor must match the full-page preview, without added paper margins');
      assert.equal(geometry.padding,'0px');assert.equal(geometry.margin,'0px');
      assert.ok(Math.abs(geometry.rectWidth-printed.rectWidth)<1,JSON.stringify({viewport:width,geometry,printed}));assert.ok(Math.abs(geometry.rectHeight-printed.rectHeight)<1,JSON.stringify({viewport:width,geometry,printed}));
      assert.deepEqual(await page.locator('.tiptap img').evaluateAll(images=>images.map(img=>[img.getAttribute('src'),img.getAttribute('alt')])),expectedPages);
      assert.deepEqual(await page.locator('[data-export-page] img').evaluateAll(images=>images.map(img=>[img.getAttribute('src'),img.getAttribute('alt')])),expectedPages);
      assert.deepEqual(await page.locator('.tiptap img').evaluateAll(images=>images.map(img=>[img.clientWidth,img.clientHeight])),Array(17).fill([794,1123]));
      assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.get()),nativeBefore,'Resizing must not mutate the saved native source or generate document changes');
      assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.actual()),actualNativeBefore,'Resizing must not change the actual editor model');
      await sourcePageNavigation.scrollIntoViewIfNeeded();
      const outerScroll=await page.evaluate(()=>window.scrollY);
      for(const destination of [1,9,17]){
        await sourcePageNavigation.selectOption(String(destination));
        await page.waitForFunction(pageNumber=>[...document.querySelectorAll<HTMLElement>('.document-review-pages__side')].every(pane=>{
          const image=pane.querySelectorAll<HTMLImageElement>(pane.classList.contains('document-review-pages__output')?'[data-export-page] img[data-report-source-page="true"]':'img[data-report-source-page="true"]')[pageNumber-1];
          if(!image)return false;
          const imageRect=image.getBoundingClientRect(),paneRect=pane.getBoundingClientRect();
          const padding=Number.parseFloat(getComputedStyle(pane).paddingTop);
          const top=imageRect.top-paneRect.top-pane.clientTop;
          const aligned=Math.abs(top-padding)<2;
          const clampedAtEnd=Math.abs(pane.scrollTop-(pane.scrollHeight-pane.clientHeight))<2&&top>=padding&&imageRect.bottom<=paneRect.bottom-padding+2;
          return aligned||clampedAtEnd;
        }),destination).catch(async error=>{
          console.error(JSON.stringify({width,destination,panes:await page.locator('.document-review-pages__side').evaluateAll((panes,pageNumber)=>panes.map(pane=>{const images=pane.querySelectorAll(pane.classList.contains('document-review-pages__output')?'[data-export-page] img[data-report-source-page="true"]':'img[data-report-source-page="true"]');const image=images[pageNumber-1];return{images:images.length,top:image?image.getBoundingClientRect().top-pane.getBoundingClientRect().top:null,padding:getComputedStyle(pane).paddingTop,scrollTop:pane.scrollTop,scrollHeight:pane.scrollHeight,clientHeight:pane.clientHeight};}),destination)}));
          throw error;
        });
        assert.equal(await page.evaluate(()=>window.scrollY),outerScroll,'Navigation scrolls only the two panes, not the whole browser page');
        assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.get()),nativeBefore,'Page navigation must not edit or auto-save the manuscript');
        assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.actual()),actualNativeBefore);
        assert.equal((await page.evaluate(()=>(globalThis as any).cf149Editing.binding())).valid,true);
      }
    }
    const navigationScrollBefore=await page.locator('.document-review-pages__side').evaluateAll(panes=>panes.map(pane=>pane.scrollTop));
    await page.locator('[data-export-page] img').first().evaluate(image=>image.removeAttribute('data-report-source-page'));
    await sourcePageNavigation.selectOption('1');
    await page.getByText('쪽 미리보기를 준비 중입니다. 잠시 후 다시 이동해 주세요.',{exact:true}).waitFor();
    assert.deepEqual(await page.locator('.document-review-pages__side').evaluateAll(panes=>panes.map(pane=>pane.scrollTop)),navigationScrollBefore,'Incomplete preview must not move only one pane');
    assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.actual()),actualNativeBefore);
    await page.locator('[data-export-page] img').first().evaluate(image=>image.setAttribute('data-report-source-page','true'));
    await sourcePageNavigation.selectOption('1');
    await sourcePageNavigation.focus();await page.keyboard.press('End');
    await page.waitForFunction(()=>document.querySelector<HTMLSelectElement>('[aria-label="원형 보고서 쪽 이동"]')?.value==='17');
    await page.getByRole('button',{name:'선택한 원형 쪽으로 이동',exact:true}).press('Enter');
    assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.get()),nativeBefore,'Keyboard navigation is read-only too');
    await page.setViewportSize({width:1600,height:1000});
    await page.getByRole('button',{name:'본문 미리보기',exact:true}).click();
    assert.deepEqual(await page.locator('.report-edit-canvas>.structured-editor__preview img').first().evaluate(el=>[el.clientWidth,el.clientHeight]),[794,1123]);
    await sourcePageNavigation.selectOption('9');
    assert.equal(await sourcePageNavigation.inputValue(),'9');
    assert.equal(await page.locator('.document-review-pages__source-nav [role="status"]').innerText(),'편집·출력 미리보기를 원본 9쪽으로 이동했습니다.');
    assert.ok(await page.locator('.document-review-pages__side').evaluateAll(panes=>panes.every(pane=>pane.scrollTop>0)),'Read-only body preview also supports paired source-page navigation');
    assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.get()),nativeBefore);
    await page.getByRole('button',{name:'본문 미리보기',exact:true}).click();
    await page.evaluate(()=>(globalThis as any).cf149Editing.insertTemporary());
    await page.getByText('CF180 임시 검수 문단',{exact:true}).first().waitFor();
    assert.equal((await page.evaluate(()=>(globalThis as any).cf149Editing.binding())).valid,false,'A real added paragraph must invalidate the original binding');
    await page.getByRole('button',{name:'실행 취소',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.tiptap')?.textContent?.includes('CF180 임시 검수 문단'));
    assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.actual()),actualNativeBefore,'Undo must restore the exact imported model and first-original metadata');
    assert.equal((await page.evaluate(()=>(globalThis as any).cf149Editing.binding())).valid,true,'Undo must restore the existing proof, not regenerate it');
    const savedNative=page.waitForResponse(response=>response.url()===origin+'/draft'&&response.request().method()==='PUT');
    await page.getByRole('button',{name:'저장',exact:true}).click();await savedNative;
    assert.equal(JSON.parse(saved).json.attrs.reportNativeSource?.name,'synthetic-native-reference.hwp');
    await page.reload();await page.locator('.tiptap img').nth(16).waitFor();await page.locator('[data-export-page]').nth(16).waitFor();
    await page.waitForFunction(()=>{const image=document.querySelector('.structured-editor.has-source-pages .tiptap img') as HTMLImageElement|null;return image?.clientWidth===794&&image.clientHeight===1123;});
    assert.deepEqual(await page.locator('.tiptap img').first().evaluate(el=>[el.clientWidth,el.clientHeight]),[794,1123]);
    assert.deepEqual(await page.locator('.tiptap img').evaluateAll(images=>images.map(img=>[img.getAttribute('src'),img.getAttribute('alt')])),expectedPages);
    assert.deepEqual(await page.locator('[data-export-page] img').evaluateAll(images=>images.map(img=>[img.getAttribute('src'),img.getAttribute('alt')])),expectedPages);
    assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.get().json.attrs.reportNativeSource),nativeBefore.json.attrs.reportNativeSource);
    assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.actual()),actualNativeBefore,'Actual model survives onChange → save → reload');
    assert.equal((await page.evaluate(()=>(globalThis as any).cf149Editing.binding())).valid,true,'Saved native binding remains valid after reload');
    await page.evaluate(()=>(globalThis as any).cf149Editing.useOrdinary('<p>일반 문서 교체 검사</p>'));
    await page.locator('.tiptap').getByText('일반 문서 교체 검사',{exact:true}).waitFor();
    assert.equal((await page.evaluate(()=>(globalThis as any).cf149Editing.actual())).attrs.reportNativeSource,null,'Replacing the whole body clears the stale native pointer');
    await page.getByRole('button',{name:'실행 취소',exact:true}).click();
    await page.locator('.tiptap img').nth(16).waitFor();
    assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.actual()),actualNativeBefore,'Undo of whole-body replacement restores its body and source in one event');
    assert.equal((await page.evaluate(()=>(globalThis as any).cf149Editing.binding())).valid,true);
    await sourcePageNavigation.selectOption('9');
    await page.waitForFunction(()=>document.querySelector<HTMLSelectElement>('[aria-label="원형 보고서 쪽 이동"]')?.value==='9');
    await page.evaluate(()=>(globalThis as any).cf149Editing.replaceSourceIdentity());
    await page.waitForFunction(()=>(globalThis as any).cf149Editing.actual()?.attrs.reportNativeSource.evidenceId==='40000000-0000-4000-8000-000000000014');
    assert.equal(await sourcePageNavigation.inputValue(),'1','A different native source with the same 17 pages must not retain the previous source-page selection');
    const links=page.locator('.document-review-pages__source-links');
    assert.equal(await links.count(),1,JSON.stringify(await page.evaluate(()=>({source:(globalThis as any).cf149Editing.actual()?.attrs.reportNativeSource,navigation:document.querySelector('.document-review-pages__source-nav')?.textContent,errors:document.querySelector('.structured-editor')?.textContent?.slice(0,200)}))));
    await links.locator('summary').click();
    const mapChapter=links.getByRole('combobox',{name:'연결할 목차 항목',exact:true}),mapPage=links.getByRole('combobox',{name:'연결할 원본 물리 쪽',exact:true});
    assert.equal(await mapChapter.inputValue(),'');assert.equal(await mapPage.inputValue(),'');
    const mapBefore=await page.evaluate(()=>(globalThis as any).cf149Editing.actual()),savesBeforeMap=saveRequests;
    await mapChapter.selectOption('PROMPT-TYPE-01-CH-01');await mapPage.selectOption('9');
    assert.equal(await links.getByRole('button',{name:'연결 확인·보고서 저장',exact:true}).isDisabled(),true);
    assert.equal(saveRequests,savesBeforeMap,'Choosing a tentative chapter/page must not silently save');
    assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.actual()),mapBefore);
    await links.getByRole('button',{name:'쪽 보기',exact:true}).click();
    assert.equal(await sourcePageNavigation.inputValue(),'9');
    const mapSaved=page.waitForResponse(response=>response.url()===origin+'/draft'&&response.request().method()==='PUT');
    await links.getByRole('button',{name:'연결 확인·보고서 저장',exact:true}).click();await mapSaved;
    await links.getByRole('status').getByText(/탐색 연결을 원본 9쪽으로 저장했습니다/u).waitFor();
    assert.equal(saveRequests,savesBeforeMap+1);
    const mapAfter=await page.evaluate(()=>(globalThis as any).cf149Editing.actual());
    assert.deepEqual(mapAfter.content,mapBefore.content);
    const beforeSource={...mapBefore.attrs.reportNativeSource},afterSource={...mapAfter.attrs.reportNativeSource};delete afterSource.confirmedChapterPages;
    assert.deepEqual(afterSource,beforeSource,'Confirming navigation must preserve native file and first-original references and proof');
    assert.equal((await page.evaluate(()=>(globalThis as any).cf149Editing.binding())).valid,true);
    await sourcePageNavigation.selectOption('1');
    const scrollBeforeBlocked=await page.locator('.document-review-pages__side').evaluateAll(panes=>panes.map(p=>p.scrollTop));
    const outputFirst=page.locator('.document-review-pages__output [data-export-page] img[data-report-source-page="true"]').first();
    const firstUrl=await outputFirst.getAttribute('src');
    await outputFirst.evaluate((el,url)=>el.setAttribute('src',url!),origin+'/page-2.svg');
    assert.equal(await page.evaluate(()=>(globalThis as any).cf149Editing.jumpSourceChapter('PROMPT-TYPE-01-CH-01')),false,'An old/mismatched output URL must be rejected even with all 17 output pages');
    assert.equal(await sourcePageNavigation.inputValue(),'1');
    assert.deepEqual(await page.locator('.document-review-pages__side').evaluateAll(panes=>panes.map(p=>p.scrollTop)),scrollBeforeBlocked);
    await outputFirst.evaluate((el,url)=>el.setAttribute('src',url!),firstUrl);
    const outputNinth=page.locator('.document-review-pages__output [data-export-page] img[data-report-source-page="true"]').nth(8);
    await outputNinth.evaluate(el=>Object.defineProperty(el,'complete',{value:false,configurable:true}));
    assert.equal(await page.evaluate(()=>(globalThis as any).cf149Editing.jumpSourceChapter('PROMPT-TYPE-01-CH-01')),false,'An unready target cannot move only one pane');
    assert.deepEqual(await page.locator('.document-review-pages__side').evaluateAll(panes=>panes.map(p=>p.scrollTop)),scrollBeforeBlocked);
    await outputNinth.evaluate(el=>{delete (el as any).complete;});
    assert.equal(await page.evaluate(source=>(globalThis as any).cf149Editing.jumpExpectedSource(9,source),nativeBefore.json.attrs.reportNativeSource),false,'A stale source fingerprint cannot navigate the current editor');
    assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.actual()),mapAfter);
    assert.equal(saveRequests,savesBeforeMap+1,'Blocked moves must not create saves');
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:1000});
      await sourcePageNavigation.selectOption('1');
      const beforeJump=await page.evaluate(()=>(globalThis as any).cf149Editing.get());
      assert.equal(await page.evaluate(()=>(globalThis as any).cf149Editing.jumpSourceChapter('PROMPT-TYPE-01-CH-01')),true);
      assert.equal(await sourcePageNavigation.inputValue(),'9');
      assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.actual()),mapAfter);
      assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.get()),beforeJump,'Confirmed chapter navigation cannot create a save/change');
      assert.equal(saveRequests,savesBeforeMap+1);
    }
    await page.reload();await page.locator('.tiptap img').nth(16).waitFor();
    assert.equal(await page.evaluate(()=>(globalThis as any).cf149Editing.actual()?.attrs.reportNativeSource.confirmedChapterPages.entries[0].page),9,'Explicit saved navigation must survive React re-entry');
    assert.equal((await page.evaluate(()=>(globalThis as any).cf149Editing.binding())).valid,true);
    assert.equal(await links.count(),1,JSON.stringify(await page.evaluate(()=>({source:(globalThis as any).cf149Editing.actual()?.attrs.reportNativeSource,navigation:document.querySelector('.document-review-pages__source-nav')?.textContent,native:document.querySelector('.structured-editor')?.className}))));
    await links.locator('summary').click();await mapChapter.selectOption('PROMPT-TYPE-01-CH-01');
    const mapCleared=page.waitForResponse(response=>response.url()===origin+'/draft'&&response.request().method()==='PUT');
    await links.getByRole('button',{name:'선택 연결 해제·보고서 저장',exact:true}).click();await mapCleared;
    await page.waitForFunction(()=>!(globalThis as any).cf149Editing.actual()?.attrs.reportNativeSource.confirmedChapterPages);
    assert.equal(await page.evaluate(()=>(globalThis as any).cf149Editing.jumpSourceChapter('PROMPT-TYPE-01-CH-01')),false);
    assert.equal((await page.evaluate(()=>(globalThis as any).cf149Editing.binding())).valid,true);
    for(const mixed of ['<p>일반 본문</p>'+pageHtml,pageHtml+'<table><tr><td></td></tr></table>',pageHtml.replaceAll(' data-report-source-page="true"','')]){
      await page.evaluate(value=>(globalThis as any).cf149Editing.use(value),mixed);
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('.tiptap')!).padding!=='0px');
      assert.equal(await page.locator('.tiptap').evaluate(el=>getComputedStyle(el).padding),normalPadding,'Text, empty tables and ordinary attached photos retain document margins');
      assert.equal(await sourcePageNavigation.count(),0,'Ordinary text, tables and photos must not expose a source-page navigator');
      assert.equal((await page.evaluate(()=>(globalThis as any).cf149Editing.actual())).content.at(-1).type,'paragraph','Ordinary tables and photos retain their trailing input paragraph');
    }
    const explicitBlank=nativeDocument.replace('<!-- MANUAL-WHOLE-DOCUMENT:END -->','<p></p>\n<!-- MANUAL-WHOLE-DOCUMENT:END -->');
    await page.evaluate(value=>(globalThis as any).cf149Editing.use(value),explicitBlank);
    await page.waitForFunction(()=>(globalThis as any).cf149Editing.actual()?.content.at(-1).attrs?.marker==='MANUAL-WHOLE-DOCUMENT:END');
    assert.equal((await page.evaluate(()=>(globalThis as any).cf149Editing.actual())).content.filter((node:any)=>node.type==='paragraph').length,1,'User-authored empty paragraphs must not be removed');
    await page.evaluate(()=>(globalThis as any).cf149Editing.useOrdinary('<p>일반 서식 실행 취소 검사</p>'));
    await page.locator('.tiptap').getByText('일반 서식 실행 취소 검사',{exact:true}).waitFor();
    const ordinaryBefore=await page.evaluate(()=>(globalThis as any).cf149Editing.actual());
    await page.locator('.tiptap').click();await page.keyboard.press('Control+a');
    await page.getByRole('button',{name:'굵게',exact:true}).click();
    await page.locator('.tiptap strong').getByText('일반 서식 실행 취소 검사',{exact:true}).waitFor();
    await page.getByRole('button',{name:'실행 취소',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.tiptap strong'));
    assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.actual()),ordinaryBefore,'Ordinary formatting Undo restores the same ordinary body, not the previous imported source');
    await page.evaluate(value=>{(globalThis as any).cf149Editing.use(value);(globalThis as any).cf149Editing.remount('cf149-2');},nativeDocument);
    await page.waitForFunction(()=>{const images=document.querySelectorAll('.structured-editor.has-source-pages .tiptap img');return images.length===17&&(images[0] as HTMLImageElement).clientWidth===794;});
    await page.evaluate(()=>{(globalThis as any).cf149Editing.useOrdinary('<p>다른 문서 여백 검사</p>');(globalThis as any).cf149Editing.remount('cf149-3');});
    await page.locator('.tiptap').getByText('다른 문서 여백 검사',{exact:true}).waitFor();
    await page.waitForFunction(()=>!document.querySelector('.structured-editor.has-source-pages'));
    assert.equal(await page.locator('.tiptap').evaluate(el=>getComputedStyle(el).padding),normalPadding,'Changing the document key uses the new model, not a previous editor snapshot');
    assert.equal(await page.locator('.tiptap img').count(),0);
    assert.equal((await page.evaluate(()=>(globalThis as any).cf149Editing.actual())).attrs.reportNativeSource,null);
    for (const { html, expected } of [
      { html: '<table><tr><th colspan="2">설명</th><th>금액</th></tr><tr><td>첫 설명</td><td>둘째 설명</td><td>미산정</td></tr></table>', expected: [['center','center'],['center','center','right']] },
      { html: '<table><tr><th rowspan="2">구분</th><th colspan="2">금액</th></tr><tr><td>미산정A</td><td>미산정B</td></tr><tr><td>항목</td><td>미산정C</td><td>미산정D</td></tr></table>', expected: [['center','center'],['right','right'],['center','right','right']] },
      { html: '<table data-document-defaults-version="2"><tr><th colspan="2">설명</th><th>금액</th></tr><tr><td data-cell-horizontal-align="left">첫 설명</td><td data-cell-horizontal-align="right">둘째 설명</td><td data-cell-horizontal-align="center">미산정</td></tr></table>', expected: [['center','center'],['left','right','center']] }
    ]) {
      await page.evaluate(value=>(globalThis as any).cf149Editing.useOrdinary(value), html);
      await page.locator('.tiptap table').getByText('미산정' + (expected.length === 3 ? 'D' : ''), { exact: true }).waitFor();
      assert.deepEqual(await page.locator('.tiptap table tr').evaluateAll(rows=>rows.map(row=>[...row.querySelectorAll(':scope > th, :scope > td')].map(cell=>(cell as HTMLElement).dataset.cellHorizontalAlign))), expected, 'HTML import and actual editor must align logical columns, not DOM cell indices');
      const actual = await page.evaluate(()=>(globalThis as any).cf149Editing.actual());
      const bodyTable = actual.content.find((node:any)=>node.type==='table');
      assert.deepEqual(bodyTable.content.map((row:any)=>row.content.map((cell:any)=>cell.attrs.horizontalAlignment)), expected);
      assert.match(JSON.stringify(actual), /미산정/u, 'Alignment must not rewrite table values');
      const savedTable = page.waitForResponse(response=>response.url()===origin+'/draft'&&response.request().method()==='PUT');
      await page.getByRole('button',{name:'저장',exact:true}).click(); await savedTable;
      await page.reload(); await page.locator('.tiptap table').waitFor();
      assert.deepEqual(await page.locator('.tiptap table tr').evaluateAll(rows=>rows.map(row=>[...row.querySelectorAll(':scope > th, :scope > td')].map(cell=>(cell as HTMLElement).dataset.cellHorizontalAlign))), expected, 'Saved merged-table alignment must survive actual React re-entry');
      const printedTables = page.locator('[aria-label="확정 보고서 전체 미리보기"] [data-export-page] table');
      await printedTables.getByText('미산정' + (expected.length === 3 ? 'D' : ''), { exact: true }).waitFor();
      assert.equal(await printedTables.count(), 1, 'A small merged table must print once; exclude the non-export measurement tree');
      assert.deepEqual(await printedTables.locator('tr').evaluateAll(rows=>rows.map(row=>[...row.querySelectorAll(':scope > th, :scope > td')].map(cell=>(cell as HTMLElement).dataset.cellHorizontalAlign))), expected, 'Print preview must keep the same merged-table alignment');
    }
    for (const width of [1440,390]) {
      await page.setViewportSize({width,height:1000});
      await page.evaluate(()=>(globalThis as any).cf149Editing.useOrdinary('# 앞부분\n\n'+Array(25).fill('보존할 본문과 금액 123,456원.').join('\n\n')+'\n\n# 공사비 산정\n\n근거 문장 보존.'));
      await page.locator('.tiptap h1').getByText('공사비 산정',{exact:true}).waitFor();
      const beforeJump=await page.evaluate(()=>(globalThis as any).cf149Editing.get());
      const beforeJson=await page.evaluate(()=>(globalThis as any).cf149Editing.actual());
      await page.getByRole('button',{name:'제목으로 산정 이동',exact:true}).focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(()=>(globalThis as any).cf187Jump),true,'A unique exact title without CH code must support keyboard chapter navigation');
      await page.waitForFunction(()=>{
        const editor=document.querySelector('.tiptap'),heading=editor?.querySelector('h1:last-of-type'),pane=editor?.closest('.document-review-pages__side');
        const anchor=window.getSelection()?.anchorNode?.parentElement?.closest('h1');
        return heading&&pane&&anchor===heading&&document.activeElement===editor&&heading.getBoundingClientRect().top>=pane.getBoundingClientRect().top&&heading.getBoundingClientRect().top<pane.getBoundingClientRect().bottom;
      });
      assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.actual()),beforeJson,'Moving to a title cannot rewrite the manuscript');
      assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.get()),beforeJump,'Moving to a title cannot emit a save/change');
    }
    for (const html of [
      '<h1>공사비 산정</h1><p>첫 본문</p><h1>공사비 산정</h1><p>둘째 본문</p>',
      '<h1>공사비 산정 검토</h1><p>부분 일치 제목은 제외</p>',
      '<p>공사비 산정</p><table><tr><td><h1>공사비 산정</h1></td></tr></table>'
    ]) {
      await page.evaluate(value=>(globalThis as any).cf149Editing.useOrdinary(value),html);
      await page.waitForFunction(value=>document.querySelector('.tiptap')?.textContent===value,html.includes('첫 본문')?'공사비 산정첫 본문공사비 산정둘째 본문':html.includes('부분 일치')?'공사비 산정 검토부분 일치 제목은 제외':'공사비 산정공사비 산정');
      const beforeJump=await page.evaluate(()=>(globalThis as any).cf149Editing.get());
      const beforeJson=await page.evaluate(()=>(globalThis as any).cf149Editing.actual());
      assert.equal(await page.evaluate(()=>(globalThis as any).cf149Editing.jump('CH-02','공사비 산정')),false,'Ambiguous, partial, paragraph-only and table-only titles must not guess a chapter');
      assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.actual()),beforeJson);
      assert.deepEqual(await page.evaluate(()=>(globalThis as any).cf149Editing.get()),beforeJump);
    }
    await page.evaluate(()=>(globalThis as any).cf149Editing.useOrdinary('<h1>공사비 산정</h1><h1>CH-02 계약 분석</h1><p>코드로 식별한 본문</p><h1>공사비 산정</h1>'));
    await page.waitForFunction(()=>[...document.querySelectorAll('.tiptap h1')].some(heading=>heading.textContent==='CH-02 계약 분석'));
    assert.equal(await page.evaluate(()=>(globalThis as any).cf149Editing.jump('CH-02','공사비 산정')),true,'An explicit chapter code takes priority over ambiguous title candidates');
    await page.waitForFunction(()=>window.getSelection()?.anchorNode?.parentElement?.closest('h1')?.textContent==='CH-02 계약 분석');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await server.close();}
});
