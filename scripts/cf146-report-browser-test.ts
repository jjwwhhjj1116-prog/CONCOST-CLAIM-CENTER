import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('CF146 real report renderer: portrait, TOC, photo tables and imported page round trips', async t => {
  const studioUrl = process.env.CF146_STUDIO_URL;
  const dialogSource = process.env.CF146_DIALOG_SOURCE;
  if (dialogSource) {
    assert.ok(existsSync(dialogSource));
    const studio = new URL(studioUrl!);
    assert.ok(studio.protocol === 'http:' && ['127.0.0.1','localhost'].includes(studio.hostname));
    const studioResponse = await fetch(studio);
    assert.ok(studioResponse.ok, 'Local HWP studio is unavailable');
    assert.ok(/<title>\s*rhwp-studio\s*<\/title>/iu.test(await studioResponse.text()), 'CF146_STUDIO_URL must point to the HWP studio, not the app root');
  }
  // Isolated in-memory storage, never the project's real upload/draft API.
  const pageImages = new Map<string, Buffer>();
  let savedDraft = '';
  let nativeBytes: Buffer | undefined;
  let failNativeUpload = false;
  let failDraftSave = false;
  const runtimeRoot = resolve('apps/web/dist/rhwp');
  const runtimeManifest = dialogSource ? JSON.parse(readFileSync(resolve(runtimeRoot, 'build-manifest.json'), 'utf8')) : null;
  const runtimeFiles = new Set<string>(['build-manifest.json', ...(runtimeManifest?.files ?? []).map((file: {path:string}) => file.path)]);
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const server = await createServer({ root: fileURLToPath(new URL('../apps/web', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
    name: 'cf146-render',
    transform(code, id) {
      if (dialogSource && id.replaceAll('\\','/').endsWith('/RhwpEditorDialog.tsx')) return code.replaceAll('assertReportNativePagesMatch(before, snapshot.pages);', 'globalThis.cf149LayoutSnapshot = {before,after:snapshot.pages}; assertReportNativePagesMatch(before, snapshot.pages);');
    },
    configureServer(server) { server.middlewares.use(async (req,res,next) => {
      if(req.url === '/cf146-native') {
        if(req.method === 'PUT') {
          if(failNativeUpload){await new Promise(resolve=>setTimeout(resolve,200));res.statusCode=503;res.end('Native upload rejected');return;}
          const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));nativeBytes=Buffer.concat(chunks);res.end('ok');return;
        }
        res.setHeader('Content-Type','application/vnd.hancom.hwpx');res.end(nativeBytes);return;
      }
      if(req.url?.startsWith('/cf146-page/') || req.url === '/cf146-draft') {
        if(req.method === 'PUT') {
          if(req.url === '/cf146-draft' && failDraftSave){res.statusCode=503;res.end('Draft save rejected');return;}
          const chunks:Buffer[]=[]; for await(const chunk of req) chunks.push(Buffer.from(chunk));
          if(req.url === '/cf146-draft') savedDraft=Buffer.concat(chunks).toString('utf8');
          else pageImages.set(req.url,Buffer.concat(chunks));
          res.end('ok'); return;
        }
        res.setHeader('Content-Type',req.url === '/cf146-draft'?'application/json':'image/jpeg');
        res.end(req.url === '/cf146-draft' ? savedDraft || 'null' : pageImages.get(req.url)); return;
      }
      if(req.url === '/cf146-photo.svg') { res.setHeader('Content-Type','image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="270"><rect width="400" height="270" fill="#ddd"/><rect x="35" y="35" width="180" height="200" fill="#617c89"/><text x="230" y="150" fill="black" font-size="24">PHOTO</text></svg>'); return; }
      if(req.url !== '/cf146.html') return next();
      res.setHeader('Content-Type','text/html');
      res.end(await server.transformIndexHtml(req.url,'<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/cf146-entry.js"></script></body></html>'));
    }); },
    resolveId: id => id === '/cf146-entry.js' ? '\0cf146-entry' : undefined,
    load: id => id === '\0cf146-entry' ? `
      import React, {useState,useEffect} from 'react'; import {createRoot} from 'react-dom/client';
      import {Editor} from '@tiptap/core'; import StarterKit from '@tiptap/starter-kit';
      globalThis.cf146Editor = {Editor, StarterKit};
      import {RhwpEditorDialog} from '/src/documents/RhwpEditorDialog.tsx';
      import {hwpSvgPageForUpload} from '/src/documents/hwp-page-image.ts';
      import {reportSourceSha256} from '/src/documents/report-native-source.ts';
      import {joinReportPresentation,splitReportPresentation} from '/@fs/${fileURLToPath(new URL('../packages/document-engine/src/report-presentation.ts',import.meta.url)).replace(/\\/g,'/')}';
      import {ReportFinalDocumentPreview,reportDraftMethod} from '/src/routes/PreviewReportStudio.tsx';
      import {reportEvidenceHtml} from '/src/documents/ReportEvidenceInsert.tsx';
      import {parseStructuredDocumentMarkdown,renderStructuredDocumentHtml,editorHtmlToMarkdown} from '/src/documents/StructuredDocumentEditor.tsx';
      import '/src/preview-theme.css'; import '/src/theme-system.css'; import '/src/documents/StructuredDocumentEditor.css'; import '/src/documents/DocumentReviewWorkspace.css';
      globalThis.__CLAIM_CENTER_RHWP_STUDIO_URL__=${JSON.stringify(studioUrl)};
      const photo = location.origin+'/cf146-photo.svg';
      const files=Array.from({length:6},(_,i)=>({id:String(i),originalName:'현장사진 '+(i+1),category:'SITE_PHOTO',mimeType:'image/svg+xml',downloadUrl:photo}));
      const photos=reportEvidenceHtml(files,'현장조사 사진대지',Object.fromEntries(files.map((f,i)=>[f.id,'현장 확인 위치 '+(i+1)])),2,'');
      const html='<h1>CH-01 감정의 목적 및 기준</h1><h2>감정의 목적 및 기준</h2><p>계약서 원문과 현장조사 자료를 대조합니다. 확정 금액 12,345원.</p><table><tbody><tr><td rowspan="2">구조</td><td>120</td></tr><tr><td>145</td></tr></tbody></table><h1>CH-02 첨부자료</h1>'+photos;
      function App(){const [doc,setDoc]=useState(parseStructuredDocumentMarkdown(html)); const [open,setOpen]=useState(false);const [sourceFile,setSourceFile]=useState(null);const [applyProgress,setApplyProgress]=useState('');
        useEffect(()=>{fetch('/cf146-draft').then(r=>r.json()).then(saved=>{if(saved){const parts=splitReportPresentation(saved);setDoc(joinReportPresentation(parts.body,parts.header,parts.frontMatter));}});},[]);
        async function applyPages(pages,native,original){
          if(!native)throw Error('Native snapshot missing');
          if(!original)throw Error('Original source missing');
          globalThis.cf146Original={name:original.name,sha256:await reportSourceSha256(await original.arrayBuffer())};
          setApplyProgress('로컬 HWP 편집본 저장 진행');
          const nativeResponse=await fetch('/cf146-native',{method:'PUT',body:native});if(!nativeResponse.ok)throw Error('Local native upload failed');
          const nativeReference={caseId:'test-case',evidenceId:'test-id',downloadUrl:'/api/cases/evidence/test-id/download',name:native.name,byteSize:native.size,sha256:await reportSourceSha256(await native.arrayBuffer())};
          const attempt=crypto.randomUUID();
          const images=[];
          for(let i=0;i<pages.length;i++){
            const file=await hwpSvgPageForUpload(pages[i],'page.jpg'); const src='/cf146-page/'+attempt+'/'+i;
            const response=await fetch(src,{method:'PUT',body:file});if(!response.ok)throw Error('Local test storage failed');
            const image=document.createElement('img');image.src=location.origin+src;image.alt='HWP 원본 '+(i+1)+'쪽';image.dataset.reportSourcePage='true';images.push(image.outerHTML);
          }
          const body=parseStructuredDocumentMarkdown('<!-- MANUAL-WHOLE-DOCUMENT:START -->\\n\\n'+images.join('\\n\\n')+'\\n\\n<!-- MANUAL-WHOLE-DOCUMENT:END -->');
          const saved=joinReportPresentation(body,{enabled:false,text:null},{enabled:false,date:'',author:''});
          saved.attrs.reportNativeSource=nativeReference;
          const response=await fetch('/cf146-draft',{method:'PUT',body:JSON.stringify(saved)});if(!response.ok)throw Error('Local test save failed');
          setDoc(saved);setOpen(false);
        }
        globalThis.cf146={setDoc,parse:parseStructuredDocumentMarkdown,render:renderStructuredDocumentHtml,markdown:editorHtmlToMarkdown,photo,photos,reportDraftMethod};
        return React.createElement(React.Fragment,null,React.createElement('button',{onClick:()=>setOpen(true)},'로컬 HWP 연결 검수'),React.createElement('button',{onClick:async()=>{const blob=await(await fetch('/cf146-native')).blob();setSourceFile(new File([blob],doc.attrs.reportNativeSource.name));setOpen(true);}},'저장된 편집본 재열기'),React.createElement(RhwpEditorDialog,{isOpen:open,sourceFile,preserveAppliedSource:true,suggestedName:'local-test',documentLabel:'로컬 검수',onClose:()=>setOpen(false),onApplyPages:applyPages,applyLabel:'로컬 저장 검수',applyProgress}),React.createElement(ReportFinalDocumentPreview,{caseNumber:'PRIVATE-ID',caseTitle:'합성 검수 프로젝트',title:'감정 보고서',content:'',editorJson:doc}));
      }
      createRoot(document.getElementById('root')).render(React.createElement(App));
    ` : undefined
  }] });
  await server.listen();
  const origin='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port;
  const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>p&&existsSync(p));
  assert.ok(executablePath);
  const browser=await chromium.launch({executablePath,headless:true});
  const output=process.env.CF146_OUTPUT_DIR ? resolve(process.env.CF146_OUTPUT_DIR)+sep : fileURLToPath(new URL('../output/cf146/',import.meta.url)); mkdirSync(output,{recursive:true});
  try {
    const page=await browser.newPage({viewport:{width:1100,height:1300}});
    const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(dialogSource && url.origin===origin && url.pathname.startsWith('/rhwp/') && runtimeFiles.has(url.pathname.slice(6))){const path=url.pathname.slice(6);return route.fulfill({body:readFileSync(resolve(runtimeRoot,path)),contentType:path.endsWith('.wasm')?'application/wasm':path.endsWith('.json')?'application/json':'text/javascript'});}
      if(url.origin===origin || dialogSource && request.method()==='GET' && url.origin===new URL(studioUrl!).origin)return route.continue();
      return route.abort();
    });
    await page.goto(origin+'/cf146.html');
    await page.waitForFunction(()=>document.querySelectorAll('[data-export-page]').length>=4 && !document.querySelector('[data-page-fit-overflow="true"]'),{},{timeout:25000});
    await t.test('changed pages, text or photographs stop native snapshot application', async () => {
      const results=await page.evaluate(async()=>{
        const {assertReportNativePagesMatch}=await import('/src/documents/report-native-source.ts' as string);
        const page='<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123"><text>원문123</text><image href="data:image/png;base64,AA=="/></svg>';
        assertReportNativePagesMatch([page],[page]);
        return [[],[page.replace('원문123','원문124')],[page.replace('AA==','BB==')],[page.replace('794','790')]].map(changed=>{try{assertReportNativePagesMatch([page],changed);return false;}catch{return true;}});
      });
      assert.deepEqual(results,[true,true,true,true]);
    });
    await t.test('native layout verification rejects geometry, font, borders and whitespace loss', async () => {
      const result = await page.evaluate(async () => {
        const {assertReportNativePagesMatch} = await import('/src/documents/report-native-source.ts' as string);
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123"><g transform="translate(1 2)"><text x="10" y="20" font-family="바탕" font-size="12" letter-spacing="1">계약 금액<tspan x="10" dy="15">다음 줄</tspan></text><rect x="1" y="2" width="200" height="100" stroke="black"/><image href="data:image/png;base64,AA==" width="20" height="30"/></g></svg>';
        assertReportNativePagesMatch([svg], [svg.replace('width="794" height="1123"', 'height="1123" width="794"')]);
        return [['x="10"','x="11"'],['y="20"','y="21"'],['translate(1 2)','translate(2 2)'],['바탕','돋움'],['font-size="12"','font-size="13"'],['letter-spacing="1"','letter-spacing="2"'],['width="20"','width="21"'],['stroke="black"','stroke="white"'],['dy="15"','dy="30"'],['계약 금액','계약금액']].map(([from,to]) => {try{assertReportNativePagesMatch([svg],[svg.replace(from,to)]);return false;}catch{return true;}});
      });
      assert.equal(result.length,10);assert.ok(result.every(Boolean));
    });
    await t.test('native source survives real editor edits and revision JSON but not whole replacement', async () => {
      const result = await page.evaluate(async () => {
        const { Editor, StarterKit } = (globalThis as any).cf146Editor;
        const { DocumentPresentationAttributes } = await import('/src/documents/StructuredDocumentEditor.tsx' as string);
        const { readReportNativeSource, readReportOriginalSource, reportSourceSha256, syncReportNativeSource } = await import('/src/documents/report-native-source.ts' as string);
        const bytes = new TextEncoder().encode('edited HWP snapshot');
        const source = { caseId: 'test-case', evidenceId: 'test-id', name: '수정.hwpx', downloadUrl: '/api/cases/evidence/test-id/download', byteSize: bytes.byteLength, sha256: await reportSourceSha256(bytes.buffer) };
        const originalDoc = {attrs:{reportNativeSource:{...source, originalSource:source}}};
        if(readReportOriginalSource(originalDoc,'test-case')?.sha256 !== source.sha256 || readReportOriginalSource(originalDoc,'another-case') !== null) throw Error('Original source scope lost');
        const editor = new Editor({ extensions: [StarterKit, DocumentPresentationAttributes], content: { type: 'doc', attrs: { reportNativeSource: source }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '기존 본문' }] }] } });
        try {
          editor.commands.insertContent('수정');
          const saved = JSON.parse(JSON.stringify(editor.getJSON()));
          const preserved = readReportNativeSource(saved, 'test-case');
          const wrongCase = readReportNativeSource(saved, 'another-case');
          const forged = readReportNativeSource({attrs:{reportNativeSource:{...source,downloadUrl:'https://example.com/file'}}}, 'test-case');
          syncReportNativeSource(editor, null);
          editor.commands.setContent('<p>다른 전체 문서</p>');
          return { preserved, source, wrongCase, forged, replaced: readReportNativeSource(editor.getJSON(), 'test-case') };
        } finally { editor.destroy(); }
      });
      assert.deepEqual(result.preserved, result.source);
      assert.equal(result.wrongCase, null); assert.equal(result.forged, null); assert.equal(result.replaced, null);
    });
    await t.test('explicit AI formatting repair preserves evidence and survives storage round trip',async()=>{
      const result=await page.evaluate(async()=>{
        const {repairReportAiFormatting}=await import('/src/reports/report-format-repair.ts' as string);
        const {parseStructuredDocumentMarkdown:parse,renderStructuredDocumentHtml:render,editorHtmlToMarkdown:markdown}=await import('/src/documents/StructuredDocumentEditor.tsx' as string);
        const manual={type:'codeBlock',attrs:{language:'markdown'},content:[{type:'text',text:'# 수동 원문'}]};
        const literal={type:'codeBlock',attrs:{language:'markdown'},content:[{type:'text',text:'# 인용\n\n<span>원문</span>\n<!-- AI-CHAPTER:CH-02:START -->'}]};
        const python={type:'codeBlock',attrs:{language:'python'},content:[{type:'text',text:'# python 원문'}]};
        const images=Array.from({length:6},(_,i)=>({type:'image',attrs:{src:location.origin+'/cf146-photo.svg',alt:'원본 사진 '+i,width:120,height:80}}));
        const source={type:'doc',content:[manual,...images,{type:'aiChapterMarker',attrs:{marker:'AI-CHAPTER:CH-01:START'}},{type:'codeBlock',attrs:{language:'markdown'},content:[{type:'text',text:'# 검토 결과\n\n금액 **123,456원**\n\n|항목|수량|\n|---|---|\n|원문|25|'}]},literal,python,{type:'aiChapterMarker',attrs:{marker:'AI-CHAPTER:CH-01:END'}}]};
        const original=JSON.stringify(source),first=repairReportAiFormatting(source,parse);
        const repeated=repairReportAiFormatting(first.document,parse);
        const stored={editorJson:first.document,content:markdown(render(first.document))};
        const response=await fetch('/cf146-draft',{method:'PUT',body:JSON.stringify(stored)});if(!response.ok)throw Error('test save failed');
        const reopened=await(await fetch('/cf146-draft')).json();
        const dom=document.createElement('div');dom.innerHTML=render(reopened.editorJson);
        // Clear the isolated fixture so following reload tests start clean.
        await fetch('/cf146-draft',{method:'PUT',body:'null'});
        return {repaired:first.repaired,skipped:first.skipped,repeated:repeated.repaired,unchanged:original===JSON.stringify(source),preserved:[manual,literal,python,...images].every(n=>first.document.content.includes(n)),same:JSON.stringify(stored)===JSON.stringify(reopened),tables:dom.querySelectorAll('table').length,photos:dom.querySelectorAll('img').length,text:dom.textContent,markers:dom.querySelectorAll('[data-ai-chapter-marker]').length};
      });
      assert.equal(result.repaired,1);assert.equal(result.skipped,1);assert.equal(result.repeated,0);
      assert.ok(result.unchanged&&result.preserved&&result.same);assert.equal(result.tables,1);assert.equal(result.photos,6);assert.equal(result.markers,2);assert.match(result.text!,/123,456원/);assert.match(result.text!,/<span>원문<\/span>/);
    });
    await t.test('automatic chapter breaks do not duplicate explicit manual breaks',async()=>{
      const results=await page.evaluate(async()=>{
        const {prepareReportPrint}=await import('/src/documents/report-print-structure.ts' as string);
        const {paginateReport}=await import('/src/documents/report-pagination.ts' as string) as typeof import('../apps/web/src/documents/report-pagination');
        return [1,2].map(count=>{
          const root=document.createElement('div');root.style.cssText='width:600px;height:900px';
          root.innerHTML='<h1>CH-01 첫 장</h1><p>본문 1</p>'+'<div data-document-page-break="true"></div>'.repeat(count)+'\n<!-- 경계 -->\n<div data-ai-chapter-marker="AI-CHAPTER:CH-02:START"></div><h1>CH-02 둘째 장</h1><p>본문 2</p>';
          document.body.append(root);
          try{prepareReportPrint(root);const result=paginateReport(root,900);return {breaks:root.querySelectorAll('[data-document-page-break]').length,pages:result.pages.length};}finally{root.remove();}
        });
      });
      assert.deepEqual(results,[{breaks:1,pages:2},{breaks:2,pages:3}]);
    });
    await t.test('reopening imported whole documents preserves manual authoring even with AI connected',async()=>{
      const methods=await page.evaluate(()=>{
        const resolve=(globalThis as any).cf146.reportDraftMethod;
        return [resolve('<!-- MANUAL-WHOLE-DOCUMENT:START -->원본<!-- MANUAL-WHOLE-DOCUMENT:END -->',true),resolve('<!-- MANUAL-CHAPTER:CH-01:START -->본문',true),resolve('AI 본문',true),resolve('본문',false),resolve('<!-- MANUAL-WHOLE-DOCUMENT:START -->',true)];
      });
      assert.deepEqual(methods,['MANUAL','MANUAL','AI','MANUAL','AI']);
    });
    await t.test('cover then actual TOC and portrait body preserve numbers, merged cells and six captions',async()=>{
      const result=await page.evaluate(()=>{
        const sheets=[...document.querySelectorAll<HTMLElement>('[data-export-page]')];
        const bodies=[...document.querySelectorAll<HTMLElement>('[data-report-body-page]')];
        const toc=[...document.querySelectorAll<HTMLElement>('.report-paginated-sheet .report-toc-entry')].map(row=>({title:row.firstElementChild!.textContent,page:row.lastElementChild!.textContent}));
        return {sizes:sheets.map(p=>[p.offsetWidth,p.offsetHeight]),text:bodies.map(p=>p.innerText).join('\n'),photos:bodies.reduce((n,p)=>n+p.querySelectorAll('img').length,0),captions:bodies.flatMap(p=>[...p.querySelectorAll('td p')].map(n=>n.textContent)),rowspan:bodies.flatMap(p=>[...p.querySelectorAll('[rowspan="2"]')]).length,toc,headings:bodies.flatMap(p=>[...p.querySelectorAll('h1,h2,h3')].map(h=>({title:h.textContent,page:p.dataset.reportBodyPage})))};
      });
      assert.ok(result.sizes.every(size=>size[0]===794 && size[1]===1123),JSON.stringify(result));
      assert.doesNotMatch(result.text,/CH-0|PRIVATE-ID|CONCOST CLAIM/);
      assert.match(result.text,/12,345원/); assert.equal(result.photos,6); assert.equal(result.rowspan,1);
      for(let i=1;i<=6;i++)assert.equal(result.captions.filter(c=>c==='현장 확인 위치 '+i).length,1);
      for(const row of result.toc)assert.ok(result.headings.some(h=>h.title===row.title && h.page===row.page),JSON.stringify(row));
      writeFileSync(output+'render-results.json',JSON.stringify(result,null,2));
      const sheets=page.locator('[data-export-page]');
      for(let i=0;i<await sheets.count();i++) await sheets.nth(i).screenshot({path:output+'page-'+(i+1)+'.png'});
    });
    if (process.env.CF146_EXPORT_QA === '1') await t.test('real download path preserves editable DOCX text merged tables and six images; HWPX independently preserves page images',async()=>{
      await page.evaluate('globalThis.__name = (value) => value'); // tsx named-function helper used by serialized test callbacks.
      const pageSnapshots:number[][]=[];
      for(const sheet of await page.locator('[data-export-page]').all())pageSnapshots.push([...await sheet.screenshot()]);
      const result = await page.evaluate(async(snapshots)=>{
        const path='/src/documents/final-document-export.ts';
        const {downloadFinalDocument,createHwpx}=await import(path);
        const {unzipSync}=await import('/node_modules/.vite/deps/fflate.js' as string) as typeof import('../apps/web/node_modules/fflate');
        const files:Record<string,number[]>={}; const pending:Promise<void>[]=[];
        const original=HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click=function(){const name=this.download;pending.push(fetch(this.href).then(r=>r.arrayBuffer()).then(b=>{files[name]=[...new Uint8Array(b)];}));};
        try{
          const root=document.querySelector<HTMLElement>('.report-final-document')!;
          const pdf=await downloadFinalDocument({root,format:'pdf',fileName:'cf146-report',orientation:'landscape'});
          const docx=await downloadFinalDocument({root,format:'docx',fileName:'cf146-report',orientation:'landscape'});
          await Promise.all(pending);
          const archive=unzipSync(new Uint8Array(files['cf146-report.docx']));
          const parse=(bytes:Uint8Array)=>new DOMParser().parseFromString(new TextDecoder().decode(bytes),'application/xml');
          const documentXml=parse(archive['word/document.xml']);
          const rels=parse(archive['word/_rels/document.xml.rels']);
          const nodes=(root:Document|Element,name:string)=>[...root.getElementsByTagNameNS('*',name)];
          const text=nodes(documentXml,'t').map(node=>node.textContent).join('');
          const drawings=nodes(documentXml,'drawing');
          const imageParagraphSpacing=nodes(documentXml,'p').filter(p=>nodes(p,'drawing').length).map(p=>{const spacing=nodes(p,'spacing')[0],ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';return {before:spacing?.getAttributeNS(ns,'before'),after:spacing?.getAttributeNS(ns,'after'),rule:spacing?.getAttributeNS(ns,'lineRule')};});
          const imageSizes=[];
          for(const blip of nodes(documentXml,'blip')){
            const id=blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','embed');
            const relationship=nodes(rels,'Relationship').find(node=>node.getAttribute('Id')===id);
            const target=relationship?.getAttribute('Target');
            if(!target)throw Error('DOCX image relationship is missing: '+id);
            const path=new URL(target,'https://fixture.invalid/word/document.xml').pathname.slice(1);
            const bytes=archive[path];if(!bytes?.length)throw Error('DOCX image bytes are missing: '+path);
            const bitmap=await createImageBitmap(new Blob([Uint8Array.from(bytes).buffer]));imageSizes.push([bitmap.width,bitmap.height]);bitmap.close();
          }
          const captions=Array.from({length:6},(_,i)=>{const caption='현장 확인 위치 '+(i+1);const cells=nodes(documentXml,'tc').filter(cell=>nodes(cell,'t').map(n=>n.textContent).join('').includes(caption));return {caption,cells:cells.length,drawings:cells.reduce((n,cell)=>n+nodes(cell,'drawing').length,0)};});
          const merges=nodes(documentXml,'vMerge').map(node=>node.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','val')??'continue');
          const footerTexts=nodes(documentXml,'footerReference').map(node=>{
            const id=node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
            const target=nodes(rels,'Relationship').find(relation=>relation.getAttribute('Id')===id)?.getAttribute('Target');
            if(!target)throw Error('DOCX footer relationship missing');
            const path=new URL(target,'https://fixture.invalid/word/document.xml').pathname.slice(1);
            return nodes(parse(archive[path]),'t').map(text=>text.textContent).join('').trim();
          });
          const expectedFooterTexts=[...root.querySelectorAll<HTMLElement>('[data-export-page]')].map(sheet=>sheet.querySelector(':scope > .report-page-number')?.textContent?.trim()??'');
          const tocRows=nodes(documentXml,'p').filter(node=>nodes(node,'tab').some(tab=>tab.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','leader')==='dot')).map(node=>nodes(node,'t').map(text=>text.textContent).join(''));
          const expectedTocRows=[...root.querySelectorAll('[data-export-page] .report-toc-entry')].map(node=>(node.firstElementChild?.textContent??'')+(node.querySelector('.report-toc-page')?.textContent??''));
          const coverBefore=Number(nodes(nodes(documentXml,'p')[0],'spacing')[0]?.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','before'));
          const firstTocParagraph=nodes(documentXml,'p').find(node=>nodes(node,'tab').some(tab=>tab.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','leader')==='dot'));
          const firstTocBefore=Number(firstTocParagraph&&nodes(firstTocParagraph,'spacing')[0]?.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','before'));
          const firstToc=root.querySelector<HTMLElement>('[data-export-page] .report-toc-entry')!;
          const expectedFirstTocBefore=Math.round((parseFloat(getComputedStyle(firstToc).marginTop)+parseFloat(getComputedStyle(firstToc.parentElement!.previousElementSibling!).marginBottom))*15);
          // HWPX page-image coverage is independent of the now-editable DOCX media.
          const pages=[];
          for(const bytes of snapshots){const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d')!.drawImage(bitmap,0,0);bitmap.close();const blob=await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!),'image/jpeg',.9));pages.push({bytes:new Uint8Array(await blob.arrayBuffer()),width:canvas.width,height:canvas.height});}
          files['cf146-report.hwpx']=[...createHwpx(pages,'합성 검수','portrait')];
          const hwpx=unzipSync(new Uint8Array(files['cf146-report.hwpx']));
          const hwpxSection=parse(hwpx['Contents/section0.xml']);
          return {files,pdf,docx,firstTocBefore,expectedFirstTocBefore,imageParagraphSpacing,xml:new TextDecoder().decode(archive['word/document.xml']),text,tableCount:nodes(documentXml,'tbl').length,drawingCount:drawings.length,imageSizes,captions,merges,footerTexts,expectedFooterTexts,tocRows,expectedTocRows,coverBefore,hwpxPictures:nodes(hwpxSection,'pic').length,hwpxSection:new TextDecoder().decode(hwpx['Contents/section0.xml'])};
        }finally{HTMLAnchorElement.prototype.click=original;}
      },pageSnapshots);
      for(const [name,bytes] of Object.entries(result.files))writeFileSync(output+name,new Uint8Array(bytes));
      assert.equal(result.pdf.pageCount,4);assert.equal(result.docx.pageCount,4);
      assert.match(result.xml,/w:w="11906"[^>]*w:h="16838"/);
      assert.match(result.text,/계약서 원문과 현장조사 자료를 대조합니다\. 확정 금액 12,345원\./);
      assert.doesNotMatch(result.text,/CH-01|CH-02|PRIVATE-ID/);
      assert.deepEqual(result.footerTexts,result.expectedFooterTexts);
      assert.equal(result.footerTexts.length,4);
      assert.deepEqual(result.tocRows,result.expectedTocRows);
      assert.equal(result.firstTocBefore,result.expectedFirstTocBefore,'TOC flow-root must preserve the title-to-first-entry gap');
      assert.ok(result.tocRows.length>=2);
      assert.ok(result.coverBefore>=1800,'Cover title must retain its 120px top spacing');
      for(const footer of result.footerTexts.filter(Boolean))assert.ok(!result.text.includes(footer),'Page number must be in DOCX footer, not flowing body');
      assert.ok(result.tableCount>=2);assert.ok(result.merges.includes('restart'));assert.ok(result.merges.includes('continue'));
      assert.equal(result.drawingCount,6);assert.equal(result.imageSizes.length,6);
      assert.deepEqual(result.imageParagraphSpacing,Array.from({length:6},()=>({before:'270',after:'270',rule:'atLeast'})),'Block photo margins must survive without clipping its line');
      assert.ok(result.imageSizes.every(([width,height])=>width>0&&height>0&&Math.abs(width/height-400/270)<.02),'DOCX drawings must be individual source photographs, not full-page screenshots');
      for(const caption of result.captions){assert.equal(caption.cells,1,caption.caption);assert.equal(caption.drawings,1,caption.caption);}
      assert.equal(result.hwpxPictures,4);assert.match(result.hwpxSection,/<hp:pagePr[^>]*landscape="WIDELY"[^>]*width="59520"[^>]*height="84180"/);
    });
    await t.test('editable DOCX uses absolute line spacing and native heading navigation',async()=>{
      await page.evaluate('globalThis.__name = (value) => value');
      const result=await page.evaluate(async()=>{
        const {createEditableDocx}=await import('/src/documents/editable-docx-export.ts' as string) as typeof import('../apps/web/src/documents/editable-docx-export');
        const {unzipSync}=await import('/node_modules/.vite/deps/fflate.js' as string) as typeof import('../apps/web/node_modules/fflate');
        const root=document.createElement('section');root.dataset.exportPage='';root.style.cssText='width:794px;padding:80px';
        root.innerHTML=Array.from({length:6},(_,i)=>`<h${i+1} style="font-size:24px;line-height:38.4px;margin:12px 0 20px">제목${i+1}</h${i+1}>`).join('')+'<p style="line-height:24px">본문</p>';
        document.body.append(root);
        try{const zip=unzipSync(await createEditableDocx(root,'portrait'));const doc=new DOMParser().parseFromString(new TextDecoder().decode(zip['word/document.xml']),'application/xml');const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';return [...doc.getElementsByTagNameNS(ns,'p')].map(p=>{const spacing=p.getElementsByTagNameNS(ns,'spacing')[0];return {level:p.getElementsByTagNameNS(ns,'outlineLvl')[0]?.getAttributeNS(ns,'val')??null,line:spacing?.getAttributeNS(ns,'line'),rule:spacing?.getAttributeNS(ns,'lineRule'),before:spacing?.getAttributeNS(ns,'before'),after:spacing?.getAttributeNS(ns,'after')};});}finally{root.remove();}
      });
      assert.deepEqual(result.map(p=>p.level),['0','1','2','3','4','5',null]);
      assert.ok(result.every(p=>p.rule==='exact'));
      for(const p of result.slice(0,6)){assert.equal(p.line,'576');assert.equal(p.before,'180');assert.equal(p.after,'300');}
    });
    await t.test('editable DOCX preserves reversed explicit roman and continuation list markers',async()=>{
      await page.evaluate('globalThis.__name = (value) => value');
      const paragraphs=await page.evaluate(async()=>{
        const path='/src/documents/editable-docx-export.ts';const {createEditableDocx}=await import(path);
        const {unzipSync}=await import('/node_modules/.vite/deps/fflate.js' as string) as typeof import('../apps/web/node_modules/fflate');
        const root=document.createElement('section');root.dataset.exportPage='';root.style.cssText='width:794px;padding:80px';
        root.innerHTML='<ol reversed start="8" style="list-style-type:decimal"><li>첫항목</li><li value="4">지정항목</li><li>다음항목</li><li style="list-style-type:none">이어쓰기</li></ol><ol start="4" style="list-style-type:upper-roman"><li>로마숫자</li></ol><ol start="27" style="list-style-type:lower-alpha"><li>영문번호</li></ol>';
        document.body.append(root);
        try{const zip=unzipSync(await createEditableDocx(root,'portrait'));const doc=new DOMParser().parseFromString(new TextDecoder().decode(zip['word/document.xml']),'application/xml');return [...doc.getElementsByTagNameNS('*','p')].map(node=>[...node.getElementsByTagNameNS('*','t')].map(text=>text.textContent).join(''));}finally{root.remove();}
      });
      assert.deepEqual(paragraphs,['8. 첫항목','4. 지정항목','3. 다음항목','이어쓰기','IV. 로마숫자','aa. 영문번호']);
    });
    await t.test('photo table survives actual Markdown JSON HTML path with caption and size',async()=>{
      const result=await page.evaluate(()=>{
        const api=(globalThis as any).cf146;
        const json=api.parse(api.markdown(api.photos)); const html=api.render(json);
        const doc=new DOMParser().parseFromString(html,'text/html');
        return {images:doc.querySelectorAll('img').length,rows:doc.querySelectorAll('tr').length,text:doc.body.textContent,width:doc.querySelector('img')?.getAttribute('width')};
      });
      assert.equal(result.images,6); assert.equal(result.rows,3); assert.equal(result.width,'260'); assert.match(result.text!,/현장 확인 위치 6/);
    });
    await t.test('long preformatted evidence wraps within A4 without one-line pages or text loss',async()=>{
      const expected=('긴 원문 근거와 계약 확인 123,456원 '+ 'SOURCE_'.repeat(24)+'\n').repeat(28)+'WRAP-END';
      await page.evaluate(text=>{
        const api=(globalThis as any).cf146;
        const json={type:'doc',content:[{type:'codeBlock',content:[{type:'text',text}]}],attrs:{reportFrontMatter:{enabled:false,date:'',author:''}}};
        api.setDoc(json);
      },expected);
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-report-body-page] article')).some(e=>e.textContent?.includes('WRAP-END')));
      const result=await page.locator('[data-report-body-page] article').evaluateAll(pages=>({text:pages.map(p=>p.textContent).join(''),pages:pages.length,overflow:pages.some(p=>p.scrollWidth>p.clientWidth+1)}));
      assert.equal(result.text,expected);
      assert.equal(result.overflow,false);
      assert.ok(result.pages<=12,`Long source was fragmented into ${result.pages} pages`);
    });
    await t.test('a tall unmerged table row continues across portrait pages without losing cells',async()=>{
      const result=await page.evaluate(async()=>{
        const {paginateReport}=await import('/src/documents/report-pagination.ts' as string) as typeof import('../apps/web/src/documents/report-pagination');
        const long=('긴 계약 원문과 적용 근거 123,456원. ').repeat(220);
        const root=document.createElement('div');root.style.cssText='position:absolute;left:-2000px;top:0;width:600px;font-size:14px;line-height:1.5';
        root.innerHTML='<table style="width:100%;table-layout:fixed;border-collapse:collapse"><colgroup><col style="width:70%"><col style="width:30%"></colgroup><thead><tr><th>원문</th><th>확인</th></tr></thead><tbody><tr><td style="border:1px solid;padding:6px;overflow-wrap:anywhere"></td><td style="border:1px solid;padding:6px">보조 근거</td></tr></tbody></table>';
        root.querySelector('tbody td')!.textContent=long;document.body.append(root);
        try{
          const layout=paginateReport(root,400);
          const probe=root.cloneNode(false) as HTMLElement;
          root.append(probe);
          const heights=layout.pages.map(html=>{probe.innerHTML=html;return {height:probe.scrollHeight,width:probe.scrollWidth};});
          const tables=layout.pages.map(html=>new DOMParser().parseFromString(html,'text/html').querySelector('table')!);
          return {overflow:layout.overflow,pages:layout.pages.length,heights,
            text:tables.map(table=>table.tBodies[0]?.rows[0]?.cells[0]?.textContent??'').join(''),
            shortText:tables.map(table=>table.tBodies[0]?.rows[0]?.cells[1]?.textContent??'').join(''),
            headers:tables.map(table=>table.tHead?.textContent),cols:tables.map(table=>table.querySelectorAll('col').length),expected:long};
        }finally{root.remove();}
      });
      assert.equal(result.overflow,false);assert.ok(result.pages>1);
      assert.equal(result.text,result.expected);assert.equal(result.shortText,'보조 근거');
      assert.ok(result.heights.every(page=>page.height<=401&&page.width<=601),JSON.stringify(result.heights));
      assert.ok(result.headers.every(header=>header==='원문확인'));assert.ok(result.cols.every(count=>count===2));
    });
    await t.test('the portrait preview paginates long table evidence without hiding export pages',async()=>{
      const expected=('긴 계약 원문과 적용 근거 123,456원. ').repeat(220);
      await page.evaluate(text=>{
        const api=(globalThis as any).cf146;
        const html='<table><thead><tr><th>원문</th><th>확인</th></tr></thead><tbody><tr><td>'+text+'</td><td>보조 근거</td></tr></tbody></table>';
        api.setDoc(api.parse(api.markdown(html)));
      },expected);
      await page.waitForFunction(()=>document.querySelectorAll('[data-report-body-page] table').length>1);
      const result=await page.locator('[data-report-body-page]').evaluateAll(pages=>({
        pages:pages.length,overflow:pages.some(page=>page.querySelector('[data-page-fit-overflow="true"]')||page.getAttribute('data-page-fit-overflow')==='true'),
        text:pages.map(page=>[...page.querySelectorAll('tbody tr td:first-child')].map(cell=>cell.textContent).join('')).join(''),
        shortText:pages.map(page=>[...page.querySelectorAll('tbody tr td:nth-child(2)')].map(cell=>cell.textContent).join('')).join('')
      }));
      assert.ok(result.pages>1);assert.equal(result.overflow,false);
      // The Markdown importer removes the final trailing space before pagination.
      assert.ok(result.text===expected.trimEnd(),JSON.stringify({actualLength:result.text.length,expectedLength:expected.trimEnd().length,pages:result.pages}));
      assert.equal(result.shortText,'보조 근거');
    });
    if (process.env.CF146_EXPORT_QA === '1') await t.test('long table downloads keep portrait PDF pages and editable DOCX cell text',async()=>{
      const result=await page.evaluate(async()=>{
        const {downloadFinalDocument}=await import('/src/documents/final-document-export.ts' as string) as typeof import('../apps/web/src/documents/final-document-export');
        const {unzipSync}=await import('/node_modules/.vite/deps/fflate.js' as string) as typeof import('../apps/web/node_modules/fflate');
        const files:Record<string,Uint8Array>={};const pending:Promise<void>[]=[];
        const original=HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click=function(){pending.push(fetch(this.href).then(response=>response.arrayBuffer()).then(bytes=>{files[this.download]=new Uint8Array(bytes);}));};
        try{
          const root=document.querySelector<HTMLElement>('.report-final-document')!;
          const pdf=await downloadFinalDocument({root,format:'pdf',fileName:'cf146-long-table'});
          const docx=await downloadFinalDocument({root,format:'docx',fileName:'cf146-long-table'});
          await Promise.all(pending);
          const archive=unzipSync(files['cf146-long-table.docx']);
          const xml=new DOMParser().parseFromString(new TextDecoder().decode(archive['word/document.xml']),'application/xml');
          const nodes=(element:Element|Document,name:string)=>[...element.getElementsByTagNameNS('*',name)];
          const cells=nodes(xml,'tr').map(row=>nodes(row,'tc')[0]).filter(Boolean);
          return {pdfPages:pdf.pageCount,docxPages:docx.pageCount,previewPages:root.querySelectorAll('[data-export-page]').length,
            pdfSignature:new TextDecoder().decode(files['cf146-long-table.pdf'].subarray(0,5)),
            text:cells.map(cell=>nodes(cell,'t').map(node=>node.textContent).join('')).filter(text=>text!=='원문').join('')};
        }finally{HTMLAnchorElement.prototype.click=original;}
      });
      assert.equal(result.pdfSignature,'%PDF-');assert.equal(result.pdfPages,result.previewPages);assert.equal(result.docxPages,result.previewPages);
      assert.equal(result.text,('긴 계약 원문과 적용 근거 123,456원. ').repeat(220).trimEnd());
    });
    await t.test('continued cells retain colspan and inline evidence formatting',async()=>{
      const result=await page.evaluate(async()=>{
        const {paginateReport}=await import('/src/documents/report-pagination.ts' as string) as typeof import('../apps/web/src/documents/report-pagination');
        const emphasis=('강조된 검토 근거. ').repeat(150);
        const root=document.createElement('div');root.style.cssText='position:absolute;left:-2000px;width:600px;font-size:14px;line-height:1.5';
        root.innerHTML='<table style="width:100%;table-layout:fixed"><colgroup><col style="width:30%"><col style="width:30%"><col style="width:40%"></colgroup><tbody><tr><td colspan="2"><strong></strong><a href="https://example.invalid/evidence">원문 링크</a></td><td>검증 완료</td></tr></tbody></table>';
        root.querySelector('strong')!.textContent=emphasis;document.body.append(root);
        try{const layout=paginateReport(root,400);const tables=layout.pages.map(html=>new DOMParser().parseFromString(html,'text/html').querySelector('table')!);
          return {overflow:layout.overflow,pages:tables.length,text:tables.map(table=>table.tBodies[0].rows[0].cells[0].textContent).join(''),expected:emphasis+'원문 링크',
            spans:tables.map(table=>table.tBodies[0].rows[0].cells[0].colSpan),links:tables.flatMap(table=>[...table.querySelectorAll('a')]).map(link=>link.getAttribute('href')),
            bold:tables.map(table=>table.querySelector('strong')?.textContent??'').join(''),short:tables.map(table=>table.tBodies[0].rows[0].cells[1].textContent).join('')};
        }finally{root.remove();}
      });
      assert.equal(result.overflow,false);assert.ok(result.pages>1);
      assert.equal(result.text,result.expected);assert.equal(result.bold,result.expected.replace('원문 링크',''));
      assert.ok(result.spans.every(span=>span===2));assert.deepEqual(result.links,['https://example.invalid/evidence']);assert.equal(result.short,'검증 완료');
    });
    await t.test('unsplittable table cells keep one intact source row and block export',async()=>{
      const result=await page.evaluate(async()=>{
        const {paginateReport}=await import('/src/documents/report-pagination.ts' as string) as typeof import('../apps/web/src/documents/report-pagination');
        const text=('긴 근거 문장. ').repeat(180);
        const root=document.createElement('div');root.style.cssText='position:absolute;left:-2000px;width:600px;font-size:14px;line-height:1.5';
        root.innerHTML='<table style="width:100%;table-layout:fixed"><tbody><tr><td></td><td><span style="display:block;min-height:420px">분할 불가 근거</span></td></tr></tbody></table>';
        root.querySelector('td')!.textContent=text;document.body.append(root);
        try{const layout=paginateReport(root,400);const parsed=layout.pages.map(html=>new DOMParser().parseFromString(html,'text/html'));
          return {overflow:layout.overflow,pages:layout.pages.length,text:parsed.map(doc=>doc.querySelector('tbody td')?.textContent??'').join(''),atomic:parsed.map(doc=>doc.querySelector('tbody td:nth-child(2)')?.textContent??'').join(''),expected:text};
        }finally{root.remove();}
      });
      assert.equal(result.overflow,true);assert.equal(result.pages,1);
      assert.equal(result.text,result.expected);assert.equal(result.atomic,'분할 불가 근거');
    });
    await t.test('a connected rowspan group is never split or silently truncated',async()=>{
      const result=await page.evaluate(async()=>{
        const {paginateReport}=await import('/src/documents/report-pagination.ts' as string) as typeof import('../apps/web/src/documents/report-pagination');
        const root=document.createElement('div');root.style.cssText='position:absolute;left:-2000px;width:600px;font-size:14px;line-height:1.5';
        root.innerHTML='<table style="width:100%;table-layout:fixed"><tbody><tr><td rowspan="2"></td><td>첫 항목</td></tr><tr><td>둘째 항목</td></tr></tbody></table>';
        root.querySelector('[rowspan]')!.textContent=('병합 셀 근거. ').repeat(180);document.body.append(root);
        try{const layout=paginateReport(root,400);const tables=layout.pages.map(html=>new DOMParser().parseFromString(html,'text/html').querySelector('table')!);
          return {overflow:layout.overflow,rows:tables.flatMap(table=>[...table.tBodies[0].rows]).length,span:tables[0].querySelector('[rowspan]')?.getAttribute('rowspan'),text:tables.map(table=>table.textContent).join('')};
        }finally{root.remove();}
      });
      assert.equal(result.overflow,true);assert.equal(result.rows,2);assert.equal(result.span,'2');
      assert.match(result.text,/첫 항목/);assert.match(result.text,/둘째 항목/);
    });
    await t.test('imported full pages retain page marker and suppress duplicate cover TOC and page numbers',async()=>{
      const result=await page.evaluate(()=>{
        const api=(globalThis as any).cf146;
        const source=[1,2].map(i=>'<p><img src="'+api.photo+'" data-report-source-page="true" alt="원본 '+i+'"></p>').join('');
        const json=api.parse(api.markdown(api.render(api.parse('<!-- MANUAL-WHOLE-DOCUMENT:START -->\n\n'+source+'\n\n<!-- MANUAL-WHOLE-DOCUMENT:END -->'))));
        json.attrs={reportFrontMatter:{enabled:false,date:'',author:''}};
        api.setDoc(json); return JSON.stringify(json);
      });
      assert.equal(result.split('"reportSourcePage":true').length-1,2);
      await page.waitForFunction(()=>document.querySelectorAll('.report-native-sheet').length===2 && !document.querySelector('[data-page-fit-overflow="true"]'));
      assert.equal(await page.locator('[data-export-page]').count(),2,await page.locator('.report-final-document').innerHTML());
      assert.equal(await page.locator('.report-page-number,.report-final-cover,.report-paginated-sheet.report-final-toc').count(),0);
      assert.deepEqual(await page.locator('[data-export-page] img').evaluateAll(images=>images.map(img=>(img as HTMLImageElement).alt)),['원본 1','원본 2']);
    });
    if(dialogSource) await t.test('actual HWP dialog applies pages through isolated save and reload',async()=>{
      await page.getByRole('button',{name:'로컬 HWP 연결 검수',exact:true}).click();
      await page.waitForFunction(() => document.querySelector('.rhwp-dialog__status')?.textContent?.includes('빈 HWP 생성 API') || document.querySelector('.rhwp-dialog__error'), {}, {timeout:90000});
      assert.match(await page.locator('.rhwp-dialog__status').innerText(),/빈 HWP 생성 API/u,await page.locator('.rhwp-dialog__error').allInnerTexts().then(errors=>errors.join('\n')));
      await page.locator('.rhwp-dialog input[type=file]').setInputFiles(dialogSource);
      await page.locator('.rhwp-dialog__status').filter({hasText:'페이지를 열었습니다'}).waitFor({timeout:90000});
      const count=Number((await page.locator('.rhwp-dialog__status').innerText()).match(/(\d+)페이지/)![1]);
      assert.ok(count > 0);
      if (process.env.CF146_DIALOG_EXPECTED) assert.equal(count,Number(process.env.CF146_DIALOG_EXPECTED));
      const frame=page.frameLocator('.rhwp-dialog iframe');
      await frame.locator('textarea[aria-label="문서 편집 입력"]').focus();
      await page.keyboard.type('CF148_EDIT_20260923',{delay:30});
      const format=/\.hwp$/iu.test(dialogSource)?'hwp':'hwpx';
      const nativePkg=resolve(process.env.CF149_NATIVE_PKG || 'tmp/cf146-engine-layout-verified/pkg');
      const nativeModule=await import(pathToFileURL(resolve(nativePkg,'rhwp.js')).href);
      await nativeModule.default({module_or_path:readFileSync(resolve(nativePkg,'rhwp_bg.wasm'))});
      await page.keyboard.press('Control+z');
      const undoDownloadPromise=page.waitForEvent('download',{timeout:90000});
      await page.getByRole('button',{name:format.toUpperCase()+' 다운로드만',exact:true}).click();
      const undoDownload=await undoDownloadPromise;
      await undoDownload.saveAs(output+'dialog-undo-private.'+format);
      const undone=new nativeModule.HwpDocument(readFileSync(output+'dialog-undo-private.'+format));
      try { assert.equal(undone.getPageText(0).includes('CF148_EDIT_20260923'),false,'Undo must change the native file'); }
      finally { undone.free(); }
      await frame.locator('textarea[aria-label="문서 편집 입력"]').focus();
      await page.keyboard.press('Control+y');
      const downloadPromise=page.waitForEvent('download');
      downloadPromise.catch(()=>{});
      await page.getByRole('button',{name:format.toUpperCase()+' 다운로드만',exact:true}).click();
      const download=await Promise.race([downloadPromise,page.locator('.rhwp-dialog__error').waitFor({state:'visible',timeout:90000}).then(async()=>{throw Error(await page.locator('.rhwp-dialog__error').innerText());})]).catch(async error=>{writeFileSync(output+'dialog-layout-failure-private.json',JSON.stringify(await page.evaluate(()=>(globalThis as any).cf149LayoutSnapshot)??null));throw error;});
      await download.saveAs(output+'dialog-export-private.'+format);
      assert.ok(download.suggestedFilename().endsWith('.'+format));
      await page.locator('.rhwp-dialog__status').filter({hasText:'웹 엔진에서 저장 전·후 페이지 일치는 확인'}).waitFor({timeout:90000});
      assert.match(await page.locator('.rhwp-dialog__status').innerText(),/PC 한컴.*아직 검증되지/u);
      const visibleDownload=new nativeModule.HwpDocument(readFileSync(output+'dialog-export-private.'+format));
      try {
        const rendered=Array.from({length:visibleDownload.pageCount()},(_,index)=>JSON.parse(visibleDownload.getPageTextLayout(index)).runs)
          .flat().some((run:{text?:string;x?:number;y?:number;w?:number;h?:number})=>run.text?.includes('CF148_EDIT_20260923') && [run.x,run.y,run.w,run.h].every(value=>typeof value==='number' && Number.isFinite(value)) && (run.w??0)>0 && (run.h??0)>0);
        assert.equal(rendered,true,'Keyboard edit must have a visible page layout position');
      } finally { visibleDownload.free(); }
      const beforeDraft=savedDraft;
      failNativeUpload=true;
      await page.getByRole('button',{name:'로컬 저장 검수',exact:true}).click();
      await page.locator('.rhwp-dialog__status').filter({hasText:'로컬 HWP 편집본 저장 진행'}).waitFor({timeout:180000});
      await page.getByRole('alert').filter({hasText:'Local native upload failed'}).waitFor({timeout:180000});
      assert.equal(savedDraft,beforeDraft);assert.equal(pageImages.size,0);assert.equal(nativeBytes,undefined);
      failNativeUpload=false;failDraftSave=true;
      await page.getByRole('button',{name:'로컬 저장 검수',exact:true}).click();
      await page.getByRole('alert').filter({hasText:'Local test save failed'}).waitFor({timeout:180000});
      assert.equal(savedDraft,beforeDraft);assert.ok(nativeBytes);
      failDraftSave=false;
      const original=await page.evaluate(()=>(globalThis as any).cf146Original);
      assert.equal(original.sha256,createHash('sha256').update(readFileSync(dialogSource)).digest('hex'));
      await page.getByRole('button',{name:'로컬 저장 검수',exact:true}).click();
      await page.locator('.rhwp-dialog').waitFor({state:'detached',timeout:180000});
      await page.reload();
      await page.waitForFunction(n=>document.querySelectorAll('.report-native-sheet').length===n,count,{timeout:30000});
      assert.equal(await page.locator('[data-export-page]').count(),count);
      assert.equal(await page.locator('.report-page-number,.report-final-cover,.report-final-toc').count(),0);
      assert.equal(pageImages.size,count*2);
      assert.equal(JSON.parse(savedDraft).attrs.reportNativeSource.sha256,createHash('sha256').update(nativeBytes!).digest('hex'));
      assert.ok(JSON.parse(savedDraft).attrs.reportNativeSource.name.endsWith('.'+format));
      assert.equal(Buffer.from(nativeBytes!).subarray(0,format==='hwp'?8:2).toString('hex'),format==='hwp'?'d0cf11e0a1b11ae1':'504b');
      const {unzipSync,strFromU8}=createRequire(new URL('../apps/web/package.json',import.meta.url))('fflate');
      const reopenedNative=new nativeModule.HwpDocument(nativeBytes!);
      const nativeXml=Object.entries(unzipSync(reopenedNative.exportHwpx())).filter(([name])=>/^Contents\/section.*\.xml$/u.test(name)).map(([,bytes])=>strFromU8(bytes)).join('');
      reopenedNative.free();
      assert.ok(nativeXml.includes('CF148_EDIT_20260923'),'actual keyboard edits must survive the stored native file');
      assert.equal((savedDraft.match(/"reportSourcePage":true/g)||[]).length,count);
      assert.deepEqual(await page.locator('[data-export-page] img').evaluateAll(images=>images.map(img=>(img as HTMLImageElement).alt)),Array.from({length:count},(_,i)=>'HWP 원본 '+(i+1)+'쪽'));
      await page.locator('[data-export-page]').nth(1).screenshot({path:output+'dialog-restored-page-2.png'});
      await page.getByRole('button',{name:'저장된 편집본 재열기',exact:true}).click();
      await page.locator('.rhwp-dialog__status').filter({hasText:`${count}페이지를 열었습니다`}).waitFor({timeout:90000});
      assert.equal(await page.getByRole('button',{name:'로컬 저장 검수',exact:true}).isEnabled(),true);
      writeFileSync(output+'dialog-roundtrip.json',JSON.stringify({pageCount:count,storedImages:pageImages.size,reloaded:true,hwpSelfReopenVerified:true,undoRedoVerified:true,scope:'Actual dialog HWP export self-reopen and report renderer, isolated memory storage; not production API or full visual HWP roundtrip'},null,2));
    });
    assert.deepEqual(errors,[]);
  } finally {await browser.close(); await server.close();}
});
