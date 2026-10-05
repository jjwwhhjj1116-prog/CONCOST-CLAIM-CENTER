import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { chromium } from 'playwright-core';

// Private local QA only: no studio API writes, remote Drive uploads or provider calls.
test('CF162 real whole HWP pages survive the production DOCX PDF HWP download path', async t => {
  const sourcePath = process.env.CF162_HWP_SOURCE;
  assert.ok(sourcePath && existsSync(sourcePath), 'Set CF162_HWP_SOURCE to a protected HWP copy');
  const source = readFileSync(sourcePath);
  const engineDir = process.env.CF148_ENGINE_DIR;
  assert.ok(engineDir);
  const wasm = readFileSync(resolve(engineDir, 'rhwp_bg.wasm'));
  const binding = readFileSync(resolve(engineDir, 'rhwp.js'));
  const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha(wasm), process.env.CF148_ENGINE_SHA, 'Pin the deployed engine');
  const manifest = { wasm: sha(wasm), files: [{ path: 'assets/rhwp_bg-test.wasm', sha256: sha(wasm) }, { path: 'native/rhwp-ad01e939079e.js', sha256: sha(binding) }] };
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const server = await createServer({ root: resolve('apps/web'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', plugins: [{
    name: 'whole-hwp-export',
    resolveId: id => id === '/whole-entry.js' ? '\0whole-entry' : undefined,
    load: id => id === '\0whole-entry' ? String.raw`
      import React from 'react';import{createRoot}from'react-dom/client';
      import{ReportFinalDocumentPreview}from'/src/routes/PreviewReportStudio.tsx';
      import{parseStructuredDocumentMarkdown}from'/src/documents/StructuredDocumentEditor.tsx';
      import{loadNativeHwpEngine}from'/src/documents/native-hwp-runtime.ts';
      import{captureReportNativeSource}from'/src/documents/report-native-source.ts';
      import{hwpSvgPageForUpload}from'/src/documents/hwp-page-image.ts';
      import'/src/theme-system.css';
      const Engine=await loadNativeHwpEngine();
      const snapshot=captureReportNativeSource(new Uint8Array(await(await fetch('/source.hwp')).arrayBuffer()),'source.hwp',Engine);
      {
        const images=[];globalThis.cf162SourceHashes=[];globalThis.cf162LocalImages=[];
        for(let i=0;i<snapshot.pages.length;i++){
          const file=await hwpSvgPageForUpload(snapshot.pages[i],'page-'+(i+1)+'.jpg');
          const bytes=await file.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);
          globalThis.cf162SourceHashes.push([...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join(''));
          globalThis.cf162LocalImages.push([...new Uint8Array(bytes)]);
          const url='/page-'+(i+1)+'.jpg';
          images.push('<p><img data-report-source-page="true" src="'+url+'" alt="HWP 원본 '+(i+1)+'쪽" width="794" height="1123"></p>');
        }
        const content='<!-- MANUAL-WHOLE-DOCUMENT:START -->\n\n'+images.join('\n\n')+'\n\n<!-- MANUAL-WHOLE-DOCUMENT:END -->';
        const json=parseStructuredDocumentMarkdown(content);json.attrs={reportFrontMatter:{enabled:false}};
        createRoot(document.getElementById('root')).render(React.createElement(ReportFinalDocumentPreview,{caseNumber:'PRIVATE-QA',caseTitle:'원형 검수',title:'원형 검수',content,editorJson:json}));
      }
    ` : undefined
  }] });
  await server.listen();
  const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
  assert.ok(executablePath);
  const out = resolve('tmp/cf162-whole-output'); mkdirSync(out, { recursive: true });
  mkdirSync(resolve(out, 'downloads'), { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: true, downloadsPath: resolve(out, 'downloads') });
  const results: Record<string, unknown> = { sourceSha256: sha(source), engineSha256: sha(wasm), scope: 'Protected local source; actual render/download implementation; no live approval or Hancom validation' };
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 }, acceptDownloads: true });
    page.setDefaultTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/whole.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/whole-entry.js"></script></body></html>' });
      if (url.pathname === '/source.hwp') return route.fulfill({ body: source });
      const image = url.pathname.match(/^\/page-(\d+)\.jpg$/u);
      if (image) return route.fulfill({ contentType: 'image/jpeg', body: Buffer.from(await page.evaluate(index => (globalThis as any).cf162LocalImages[index], Number(image[1]) - 1)) });
      if (url.pathname === '/rhwp/build-manifest.json') return route.fulfill({ json: manifest });
      if (url.pathname === '/rhwp/assets/rhwp_bg-test.wasm') return route.fulfill({ body: wasm, contentType: 'application/wasm' });
      if (url.pathname === '/rhwp/native/rhwp-ad01e939079e.js') return route.fulfill({ body: binding, contentType: 'text/javascript' });
      return route.continue();
    });
    await page.goto(origin + '/whole.html');
    try {
      await page.waitForFunction(() => document.querySelectorAll('[data-export-page]').length === 17 && [...document.querySelectorAll<HTMLElement>('[data-export-page]')].every(page => page.dataset.pageFitOverflow === 'false') && [...document.images].every(image => image.complete && image.naturalWidth > 0), undefined, { timeout: 20_000 });
    } catch (error) {
      const state = await page.evaluate(() => ({ pages: [...document.querySelectorAll<HTMLElement>('[data-export-page]')].map(page => ({ ready: page.dataset.pageFitOverflow, width: page.offsetWidth, height: page.offsetHeight })), images: [...document.images].map(image => ({ loaded: image.complete, naturalWidth: image.naturalWidth, protocol: image.src.split(':')[0] })), alerts: document.querySelectorAll('[role="alert"]').length }));
      throw new Error(JSON.stringify({ error: String(error), errors, state }));
    }
    await page.evaluate('globalThis.__name = value => value');
    assert.equal(await page.locator('.report-final-cover,.report-final-toc').count(), 0);
    results.nativeDom = await page.evaluate(() => {
      const sheet=document.querySelector<HTMLElement>('.report-native-sheet')!;
      return [sheet,...sheet.querySelectorAll('*')].map(node=>{
        const css=getComputedStyle(node),box=node.getBoundingClientRect();
        return {tag:node.tagName,classes:node.className,sourcePage:node.getAttribute('data-report-source-page'),box:[box.left,box.top,box.width,box.height],styles:Object.fromEntries(['transform','rotate','scale','translate','filter','backdrop-filter','clip-path','mask-image','background-image','box-shadow','opacity','mix-blend-mode','background-color','border-radius','outline-width','outline-style','object-fit','object-position'].map(key=>[key,css.getPropertyValue(key)]))};
      });
    });
    console.log('Native capture geometry', JSON.stringify(results.nativeDom));
    let imageRequests = 0;
    page.on('request', request => { if (/\/page-\d+\.jpg$/u.test(new URL(request.url()).pathname)) imageRequests++; });
    for (const format of (['docx', 'pdf', 'hwp'] as const).filter(format=>!process.env.CF162_FORMATS||process.env.CF162_FORMATS.split(',').includes(format))) await t.test(format, async () => {
      const started = Date.now(), beforeImages = imageRequests;
      const download = page.waitForEvent('download', { timeout: 120_000, predicate: download => download.suggestedFilename() === 'whole-report.' + format });
      download.catch(() => {});
      const metadata = await page.evaluate(async format => {
        const { downloadFinalDocument } = await import('/src/documents/final-document-export.ts' as string);
        return downloadFinalDocument({ root: document.querySelector<HTMLElement>('.report-final-document')!, format, fileName: 'whole-report', orientation: 'landscape' });
      }, format);
      const artifact = await download;
      await artifact.saveAs(resolve(out, 'whole-report.' + format));
      const bytes = readFileSync(resolve(out, 'whole-report.' + format));
      assert.equal(metadata.pageCount, 17); assert.equal(metadata.sha256, sha(bytes)); assert.equal(metadata.byteSize, bytes.length);
      results[format] = metadata;
      results[format + 'DurationMs'] = Date.now() - started;
      if (format === 'docx') {
        const report = await page.evaluate(async file => {
            const { unzipSync } = await import('/node_modules/.vite/deps/fflate.js' as string) as typeof import('../apps/web/node_modules/fflate');
          const zip = unzipSync(Uint8Array.from(file));
          const parse = (bytes: Uint8Array) => new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
          const xml = parse(zip['word/document.xml']), rels = parse(zip['word/_rels/document.xml.rels']);
          const nodes = (name: string) => [...xml.getElementsByTagNameNS('*', name)];
          const hashes = [];
          for (const blip of nodes('blip')) {
            const id = blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed');
            const target = [...rels.documentElement.children].find(node => node.getAttribute('Id') === id)?.getAttribute('Target');
            if (!target) throw Error('Missing DOCX image relationship');
            const bytes = zip[new URL(target, 'https://fixture.invalid/word/document.xml').pathname.slice(1)];
            const digest = await crypto.subtle.digest('SHA-256', bytes);
            hashes.push([...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join(''));
          }
          return { hashes, expected: (globalThis as any).cf162SourceHashes, sizes: nodes('pgSz').map(node => [node.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w'), node.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'h')]), drawings: nodes('drawing').length };
        }, [...bytes]);
        assert.equal(report.drawings, 17); assert.deepEqual(report.hashes, report.expected, 'All 17 original page images must keep exact bytes and order');
        assert.deepEqual(report.sizes, Array.from({ length: 17 }, () => ['11906', '16838']));
        results.docxImagesExact = true;
      }
      if (format === 'hwp') {
        const reopened = await page.evaluate(async file => {
          const { loadNativeHwpEngine } = await import('/src/documents/native-hwp-runtime.ts' as string);
          const { unzipSync } = await import('/node_modules/.vite/deps/fflate.js' as string) as typeof import('../apps/web/node_modules/fflate');
          const Engine = await loadNativeHwpEngine(), doc = new Engine(Uint8Array.from(file));
          try {
            const zip = unzipSync(doc.exportHwpx());
            const sections = Object.entries(zip).filter(([name]) => /^Contents\/section\d+\.xml$/u.test(name)).map(([, bytes]) => new TextDecoder().decode(bytes));
            return { count: doc.pageCount(), paper: sections.map(xml => xml.match(/<hp:pagePr\b[^>]*>/u)?.[0]), pictures: sections.map(xml => [...xml.matchAll(/<hp:pic\b/gu)].length) };
          } finally { doc.free(); }
        }, [...bytes]);
        assert.equal(reopened.count, 17); assert.equal(reopened.pictures.reduce((sum, n) => sum + n, 0), 17);
        // Native pages preserve the reviewed 794 x 1123 CSS-pixel geometry at
        // 75 HWPUNIT/px, not the separate legacy raster-HWPX paper constants.
        for (const paper of reopened.paper) assert.match(paper!, /landscape="WIDELY"[^>]*width="59550"[^>]*height="84225"/u);
        results.hwpReopen = reopened;
      }
      if (format === 'pdf') {
        results.pdfImageRequests = imageRequests - beforeImages;
        assert.equal(imageRequests - beforeImages, 0, 'Native PDF must reuse the loaded images, not clone/refetch the whole document');
        assert.ok(Date.now() - started < 30_000, '17 native pages should finish within the download timeout');
      }
    });
    assert.deepEqual(errors, []);
  } finally { writeFileSync(resolve(out, 'results.json'), JSON.stringify(results, null, 2)); await browser.close(); await server.close(); }
});
