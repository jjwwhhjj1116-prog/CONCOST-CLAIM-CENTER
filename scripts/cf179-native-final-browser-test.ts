import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createNativeHwp, verifyNativeHwpContent } from '../apps/web/src/documents/editable-hwp-export';

test('CF179 approved native output keeps actual HWP/HWPX bytes and rejects mismatches without raster fallback', async t => {
  const pkg = resolve('pinned-runtime/pkg');
  const wasm = readFileSync(resolve(pkg, 'rhwp_bg.wasm'));
  assert.equal(createHash('sha256').update(wasm).digest('hex'), 'bcc40a79bcd9be813cb231c6d8a0376b803ab8a6c189a09bcccabb8a249f3c44');
  const module = await import(pathToFileURL(resolve(pkg, 'rhwp.js')).href);
  await module.default({ module_or_path: wasm });
  const sourcePage = { html: '<p>원형 본문 보존</p><table><tr><td>검수 셀</td><td>123원</td></tr></table>', text: '원형 본문 보존검수 셀123원', tables: 1, images: 0, tableCells: [[{row:0,col:0,rowSpan:1,colSpan:1,text:'검수 셀'},{row:0,col:1,rowSpan:1,colSpan:1,text:'123원'}]], width: 794, height: 1123, margins: { top: 40, right: 40, bottom: 40, left: 40 } };
  const hwp = createNativeHwp([sourcePage], module.HwpDocument);
  const a3 = createNativeHwp([{ ...sourcePage, width:1123,height:1588 }], module.HwpDocument);
  const twoPages = createNativeHwp([sourcePage,sourcePage], module.HwpDocument);
  const opened = new module.HwpDocument(hwp);
  const hwpx = opened.exportHwpx(); opened.free();
  let mode = 'hwp', requests: string[] = [];
  const bytes = () => mode === 'hwpx' || mode === 'wrong-extension' ? hwpx : mode === 'a3' ? a3 : mode === 'page-count' ? twoPages : hwp;
  const metadata = () => ({ caseId: 'synthetic-case', evidenceId: 'native', name: mode === 'hwpx' ? 'approved.hwpx' : 'approved.hwp', downloadUrl: '/api/cases/evidence/native/download', byteSize: bytes().length, sha256: createHash('sha256').update(bytes()).digest('hex') });
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const runtimeRoot = resolve('apps/web/dist/rhwp');
  const server = await createServer({ root: resolve('apps/web'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', plugins: [{
    name: 'native-final-fixture',
    configureServer(s) { s.middlewares.use(async (req, res, next) => {
      const pathname = (req.url ?? '').split('?')[0];
      if (pathname.startsWith('/rhwp/')) {
        const file = resolve(runtimeRoot, pathname.slice('/rhwp/'.length));
        if (!file.startsWith(runtimeRoot + '\\') && !file.startsWith(runtimeRoot + '/')) { res.statusCode = 403; res.end(); return; }
        res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : file.endsWith('.js') ? 'text/javascript' : 'application/wasm');
        res.end(readFileSync(file)); return;
      }
      if (pathname === '/page.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123"><rect width="794" height="1123" fill="white"/><text x="40" y="100">원형 검수 페이지</text></svg>'); return; }
      if (pathname === '/api/cases/synthetic-case/evidence') {
        requests.push('evidence'); res.setHeader('Content-Type', 'application/json');
        const source = metadata(); res.end(JSON.stringify({ files: mode === 'missing-evidence' ? [] : [{ id: source.evidenceId, sha256: mode === 'wrong-evidence' ? 'f'.repeat(64) : source.sha256, byteSize: source.byteSize }] })); return;
      }
      if (pathname === '/api/cases/evidence/native/download') {
        requests.push('bytes');
        if (mode === 'network') { res.statusCode = 503; res.end('Synthetic unavailable'); return; }
        const value = Uint8Array.from(bytes());
        if (mode === 'hash') value[value.length - 1] ^= 1;
        res.setHeader('Content-Type', 'application/octet-stream'); res.end(mode === 'size' ? value.subarray(0, value.length - 1) : value); return;
      }
      if (pathname !== '/native-final.html') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await s.transformIndexHtml(req.url!, `<html><body><script>window.__CLAIM_API_ORIGIN__=window.location.origin;</script><div id="root" data-export-document-kind="REPORT"><article data-export-page style="width:794px;height:1123px"><img src="/page.svg" data-report-source-page="true" style="width:794px;height:1123px"></article></div><script type="module">
      import{downloadFinalDocument}from'/src/documents/final-document-export.ts';import{reportNativeBodySha256}from'/src/documents/report-native-source.ts';
      window.runNative=async(mode,source)=>{window.nativeProgress=[];window.current=true;const json={type:'doc',attrs:{reportNativeSource:{...source,bindingVersion:1},reportFrontMatter:{enabled:false,date:'',author:''},reportHeader:{enabled:false,text:null}},content:[{type:'image',attrs:{src:'/page.svg',reportSourcePage:true,width:794,height:1123}}]};json.attrs.reportNativeSource.bodySha256=await reportNativeBodySha256(json);
      if(mode==='missing-binding')delete json.attrs.reportNativeSource.bodySha256;if(mode.endsWith('stale-body'))json.content[0].attrs.width=700;if(mode==='other-case')source.caseId='another-case';if(mode==='changed-case')window.current=false;
      try{return{result:await downloadFinalDocument({root:document.getElementById('root'),format:'hwp',fileName:mode.startsWith('qa-')?'미승인_관리자검수용_v5':'확정_검수',purpose:mode.startsWith('qa-')?'ADMIN_QA':'FINAL',reportNativeSnapshot:{document:json,caseId:source.caseId,isCurrent:()=>window.current},onProgress:message=>window.nativeProgress.push(message)})};}catch(error){return{error:error.message};}};</script></body></html>`));
    }); }
  }] });
  await server.listen();
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  assert.ok(executablePath);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
    for (const scenario of ['hwp', 'hwpx', 'missing-binding', 'stale-body', 'other-case', 'changed-case', 'late-case', 'missing-evidence', 'wrong-evidence', 'hash', 'size', 'network', 'a3', 'page-count', 'wrong-extension', 'qa-hwp', 'qa-stale-body', 'qa-late-case']) await t.test(scenario, async () => {
      mode = scenario; requests = [];
      const page = await browser.newPage({ acceptDownloads: true });
      let downloads = 0; page.on('download', () => downloads++);
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      if(scenario.endsWith('late-case'))await page.route('**/api/cases/evidence/native/download',async route=>{await page.evaluate(()=>{(window as any).current=false;});await route.continue();});
      await page.goto(origin + '/native-final.html'); await page.waitForFunction(() => Boolean((window as any).runNative));
      const success = scenario === 'hwp' || scenario === 'hwpx' || scenario === 'qa-hwp';
      const download = success ? page.waitForEvent('download') : null;
      download?.catch(() => undefined);
      const result = await page.evaluate(({ mode, source }) => (window as any).runNative(mode, source), { mode, source: metadata() });
      if (success) {
        assert.equal(result.error, undefined);
        const file = await download!, stream = await file.createReadStream(); assert.ok(stream);
        const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        assert.deepEqual(Buffer.concat(chunks), Buffer.from(bytes()), 'The exported file must contain the exact native bytes, not page pictures');
        assert.equal(file.suggestedFilename(), scenario === 'qa-hwp' ? '미승인_관리자검수용_v5.hwp' : `확정_검수.${scenario}`);
        const reopened = new module.HwpDocument(Buffer.concat(chunks));
        try {
          assert.equal(reopened.pageCount(), 1); verifyNativeHwpContent(reopened.exportHwpx(), [sourcePage]);
          assert.equal(JSON.parse(reopened.insertText(0, 0, 0, '수정 ')).ok, true);
          const edited = new module.HwpDocument(reopened.exportHwp());
          try { verifyNativeHwpContent(edited.exportHwpx(), [{ ...sourcePage, text: '수정 ' + sourcePage.text }]); } finally { edited.free(); }
        } finally { reopened.free(); }
        assert.deepEqual(requests, ['evidence', 'bytes']);
      } else {
        assert.ok(result.error, scenario); assert.equal(downloads, 0);
        assert.deepEqual(requests, ['missing-binding','stale-body','qa-stale-body','other-case','changed-case'].includes(scenario) ? [] : ['missing-evidence','wrong-evidence'].includes(scenario) ? ['evidence'] : ['evidence','bytes'], 'The negative case must reach its intended verification boundary');
        assert.ok(!(await page.evaluate(() => (window as any).nativeProgress)).some((message: string) => message.includes('편집 가능한 HWP로 변환')), 'A failed native receipt must never fall back to raster conversion');
      }
      if (scenario.startsWith('qa-')) assert.ok(!(await page.evaluate(() => (window as any).nativeProgress)).some((message: string) => message.includes('확정 당시')), 'Admin QA must not claim a business approval snapshot');
      await page.close();
    });
  } finally { await browser.close(); await server.close(); }
});
