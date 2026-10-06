import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('Report editing preserves IDs, navigates chapters, edits front matter and fits long table columns', async () => {
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  let saved = 'null';
  const presentationPath = resolve('packages/document-engine/src/report-presentation.ts').replace(/\\/g,'/');
  const server = await createServer({ root:resolve('apps/web'), server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{
    name:'report-editing-fixture',
    configureServer(server){server.middlewares.use(async(req,res,next)=>{
      if(/^\/page-\d+\.svg$/u.test(req.url??'')){res.setHeader('Content-Type','image/svg+xml');res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123"><rect width="794" height="1123" fill="white"/><text x="80" y="180">${req.url}</text></svg>`);return;}
      if(req.url==='/draft'){
        if(req.method==='PUT'){const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));saved=Buffer.concat(chunks).toString();}
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
      import{reportNativeBodySha256,readBoundReportNativeSource}from'/src/documents/report-native-source.ts';
      import'/src/documents/StructuredDocumentEditor.css';import'/src/documents/DocumentReviewWorkspace.css';
      const original='<!-- AI-CHAPTER:CH-01:START -->\\n## CH-01 개요\\n# 개요\\n'+Array(25).fill('검토 원문 보존.').join('\\n\\n')+'\\n<!-- AI-CHAPTER:CH-01:END -->\\n<!-- AI-CHAPTER:CH-02:START -->\\n## CH-02 산정\\n# 산정\\n<table data-document-defaults-version="2"><colgroup><col style="width:10%"><col style="width:80%"><col style="width:10%"></colgroup><tr><th>번호</th><th>내용</th><th>판단상태</th></tr><tr><td>1</td><td>근거 확인</td><td>UNREVIEWABLE 자료확인전까지검토할수없음</td></tr></table>\\n<!-- AI-CHAPTER:CH-02:END -->';
      function App(){const ref=useRef(null);const[documentKey,setDocumentKey]=useState('cf149-1');const[title,setTitle]=useState('시험 보고서');const[content,setContent]=useState(original);const[json,setJson]=useState(parseStructuredDocumentMarkdown(original));const[front,setFront]=useState({enabled:true,date:'2026.9',author:'작성자'});const[ready,setReady]=useState(false);const changes=useRef(0);
        globalThis.cf149Editing={use:async(next,bound=false)=>{const native={caseId:'40000000-0000-4000-8000-000000000010',evidenceId:'40000000-0000-4000-8000-000000000012',downloadUrl:'/api/cases/evidence/40000000-0000-4000-8000-000000000012/download',name:'synthetic-native-reference.hwp',sha256:'0'.repeat(64),byteSize:5};const doc={...parseStructuredDocumentMarkdown(next),attrs:{reportNativeSource:native}};if(bound){native.bindingVersion=1;native.originalSource={...native,evidenceId:'40000000-0000-4000-8000-000000000013',downloadUrl:'/api/cases/evidence/40000000-0000-4000-8000-000000000013/download',name:'synthetic-first-original.hwp',sha256:'1'.repeat(64)};native.bodySha256=await reportNativeBodySha256(joinReportPresentation(doc,{enabled:false,text:null},{enabled:false}));}setContent(next);setJson(doc);setFront({enabled:false});},get:()=>({json,changes:changes.current}),actual:()=>ref.current.getJSON(),insertTemporary:()=>ref.current.insertHtml('<p>CF180 임시 검수 문단</p>'),binding:async(actual=true)=>{const doc=joinReportPresentation(actual?ref.current.getJSON():json,{enabled:false,text:null},front);try{await readBoundReportNativeSource(doc,'40000000-0000-4000-8000-000000000010');return{valid:true,document:doc};}catch(error){return{valid:false,error:error.message,document:doc};}}};
        useEffect(()=>{fetch('/draft').then(r=>r.json()).then(saved=>{if(saved){setTitle(saved.title);setContent(saved.content);const p=splitReportPresentation(saved.json);setJson(p.body);setFront(p.frontMatter);}setReady(true);});},[]);
        globalThis.cf149Editing.useOrdinary=(next)=>{setContent(next);setJson(parseStructuredDocumentMarkdown(next));};
        globalThis.cf149Editing.remount=(key)=>setDocumentKey(key);
        if(!ready)return null;
        return React.createElement(React.Fragment,null,
          React.createElement('button',{onClick:()=>ref.current.goToChapter('CH-02')},'산정으로 이동'),
          React.createElement('button',{onClick:async()=>{await fetch('/draft',{method:'PUT',body:JSON.stringify({title,content,json:joinReportPresentation(json,{enabled:false,text:null},front)})});document.querySelector('#saved').textContent='저장 완료';}},'저장'),React.createElement('span',{id:'saved'}),
          React.createElement(StructuredDocumentEditor,{ref,documentKey,reportMode:true,label:'시험 보고서 편집',value:content,editorJson:json,onChange:(text,doc)=>{changes.current++;setContent(text);setJson(doc);},
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
    assert.deepEqual(actualNativeBefore,nativeBefore.json,'The real Tiptap document must match the imported body, not silently append invisible paragraphs');
    assert.equal((await page.evaluate(()=>(globalThis as any).cf149Editing.binding())).valid,true,'The original native binding must also validate against actual ref.getJSON()');
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
    }
    await page.setViewportSize({width:1600,height:1000});
    await page.getByRole('button',{name:'본문 미리보기',exact:true}).click();
    assert.deepEqual(await page.locator('.report-edit-canvas>.structured-editor__preview img').first().evaluate(el=>[el.clientWidth,el.clientHeight]),[794,1123]);
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
    for(const mixed of ['<p>일반 본문</p>'+pageHtml,pageHtml+'<table><tr><td></td></tr></table>',pageHtml.replaceAll(' data-report-source-page="true"','')]){
      await page.evaluate(value=>(globalThis as any).cf149Editing.use(value),mixed);
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('.tiptap')!).padding!=='0px');
      assert.equal(await page.locator('.tiptap').evaluate(el=>getComputedStyle(el).padding),normalPadding,'Text, empty tables and ordinary attached photos retain document margins');
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
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await server.close();}
});
