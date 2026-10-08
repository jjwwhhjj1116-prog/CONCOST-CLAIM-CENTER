import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('CF207 real proposal pages preserve caption/photo grouping and authored boundaries', async t => {
  const cacheDir = resolve(process.env.CF207_CACHE_DIR || join(tmpdir(), 'cf207-proposal-heading-cache'));
  mkdirSync(cacheDir, { recursive: true });
  const legacy = process.env.CF207_LEGACY_HEADING === '1';
  let legacyApplied = false;
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const server = await createServer({
    root: fileURLToPath(new URL('../apps/web', import.meta.url)), cacheDir,
    server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error',
    plugins: [{
      name: 'cf207-caption-regression', enforce: 'pre',
      transform(code, id) {
        if (!legacy || !id.replaceAll('\\', '/').endsWith('/ProposalView.tsx')) return;
        const first = '// Keep an image caption heading with its first picture on a fresh sheet.';
        const last = '// Existing list/photo grouping';
        const start = code.indexOf(first), end = code.indexOf(last, start);
        assert.ok(start >= 0 && end > start, 'The exact CF207 product block must exist before legacy fault injection');
        legacyApplied = true;
        return code.slice(0, start) + code.slice(end);
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith('/cf207.html')) return next();
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root" class="proposal-final-document"></div><script type="module" src="/cf207.js"></script></body></html>'));
        });
      },
      resolveId: id => id === '/cf207.js' ? '\0cf207' : undefined,
      load: id => id === '\0cf207' ? `
        import React from 'react'; import {createRoot} from 'react-dom/client';
        import {ProposalFinalChapterPages} from '/src/proposals/ProposalView.tsx';
        import {downloadFinalDocument} from '/src/documents/final-document-export.ts';
        import '/src/theme-system.css'; import '/src/documents/DocumentReviewWorkspace.css';
        const mode=new URLSearchParams(location.search).get('mode');
        const canvas=document.createElement('canvas');canvas.width=600;canvas.height=300;
        const context=canvas.getContext('2d');context.fillStyle='#2473a4';context.fillRect(0,0,600,300);
        context.fillStyle='#edc45b';context.fillRect(300,0,300,300);
        const src=canvas.toDataURL('image/png'),heading='업무 영역 · 246.90 검수';
        const image='<img src="'+src+'" alt="CF207 합성 사진" width="400" height="200" data-image-align="right" style="width:400px;height:200px;max-height:none;object-fit:contain;margin:18px 0 24px auto">';
        const prefix='<p style="height:800px;margin:0;line-height:20px">원문 앞 단락 123,456원</p>';
        const caption='<h3>'+heading+'</h3>';
        let body=prefix+caption+'<p>'+image+'</p>',editorJson=null;
        if(mode==='wrapped-fresh')body=caption+'<p>'+image+'</p>';
        if(mode==='explicit-break')body='<p>명시적 쪽나누기 원문</p>'+caption+'<div data-document-page-break="true"></div><p>'+image+'</p>';
        if(mode==='oversized')body=caption+'<p>'+image.replace('height="200"','height="1000"').replace('height:200px','height:1000px')+'</p>';
        if(mode==='direct'||mode==='direct-fresh'){
          const before=mode==='direct'?[{type:'paragraph',content:[{type:'text',text:'원문 앞 단락 123,456원'}]},...[240,240,240,64].map(heightPx=>({type:'documentSpacer',attrs:{heightPx}}))]:[];
          editorJson={type:'doc',content:[...before,{type:'heading',attrs:{level:3},content:[{type:'text',text:heading}]},{type:'image',attrs:{src,alt:'CF207 합성 사진',width:400,height:200,alignment:'right'}}]};
          body='JSON 우선 원문';
        }
        const item={number:6,title:'회사 공통 업무',kind:'FIXED',body,editorJson};
        window.cf207={src,heading,item,original:JSON.stringify(item),calls:[]};
        window.cf207Export=()=>downloadFinalDocument({root:document.getElementById('root'),format:'pdf',fileName:'CF207_LOCAL_ONLY',orientation:'portrait'});
        createRoot(document.getElementById('root')).render(React.createElement(ProposalFinalChapterPages,{item,startPage:7,onPageCount:(chapter,count)=>{window.cf207.calls.push({chapter,count});}}));
      ` : undefined,
    }],
  });
  await server.listen();
  const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
  assert.ok(executablePath, 'Use the installed Chrome without downloading a browser');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const mode of ['wrapped', 'direct', 'wrapped-fresh', 'direct-fresh', 'explicit-break', 'oversized']) await t.test(mode, async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors: string[] = [], denied: string[] = [];
      let downloads = 0;
      page.on('pageerror', error => errors.push(error.message));
      page.on('download', () => downloads++);
      await page.addInitScript('globalThis.__name = value => value');
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin || url.pathname.startsWith('/api/')) { denied.push(url.origin + url.pathname); return route.abort(); }
        return route.continue();
      });
      try {
        await page.goto(origin + '/cf207.html?mode=' + mode, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => (window as any).cf207 && document.querySelector('.proposal-final-pagination-source img'));
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all([...document.querySelectorAll<HTMLImageElement>('.proposal-final-pagination-source img')].map(image => image.decode()));
          window.dispatchEvent(new Event('final-document:refit'));
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        });
        if (mode !== 'oversized') await page.waitForFunction(() => [...document.querySelectorAll('[data-export-page]')].every(page => page.getAttribute('data-page-fit-overflow') === 'false'));
        const observed = await page.evaluate(() => {
          const fixture = (window as any).cf207;
          const source = document.querySelector<HTMLElement>('.proposal-final-pagination-source .proposal-rich-content')!;
          const pages = [...document.querySelectorAll<HTMLElement>('[data-export-page]')];
          const image = source.querySelector<HTMLImageElement>('img')!;
          const snapshot = (photo: HTMLImageElement) => {
            const css = getComputedStyle(photo), rect = photo.getBoundingClientRect();
            return { src: photo.getAttribute('src'), alt: photo.alt, width: photo.getAttribute('width'), height: photo.getAttribute('height'), alignment: photo.getAttribute('data-image-align'), cssWidth: css.width, cssHeight: css.height, objectFit: css.objectFit, ratio: rect.width / rect.height };
          };
          return {
            sourceHtml: source.innerHTML, sourceText: source.textContent, sourceStyle: image.getAttribute('style'), sourceImage: snapshot(image),
            sourceDirect: image.parentElement === source, unchangedItem: JSON.stringify(fixture.item) === fixture.original,
            sourceHeight: image.getBoundingClientRect().height,
            headingPage: pages.findIndex(page => [...page.querySelectorAll('.proposal-rich-content h3')].some(h => h.textContent === fixture.heading)),
            imagePage: pages.findIndex(page => page.querySelector('.proposal-rich-content img')),
            numbers: pages.map(page => Number(page.dataset.pageNumber)),
            chapters: pages.map(page => Number(page.dataset.chapterNumber)),
            flags: pages.map(page => page.dataset.pageFitOverflow),
            text: pages.map(page => page.querySelector('.proposal-rich-content')?.textContent ?? '').join(''),
            images: pages.flatMap(page => [...page.querySelectorAll<HTMLImageElement>('.proposal-rich-content img')].map(snapshot)),
            call: fixture.calls.at(-1),
          };
        });
        assert.equal(observed.unchangedItem, true, 'Pagination must not alter the authored item');
        assert.equal(observed.sourceDirect, mode.startsWith('direct'), 'Exercise both direct and paragraph-wrapped image siblings');
        if (mode === 'oversized') {
          assert.equal(observed.sourceHeight, 1000, 'The oversized photograph must actually exceed the 913px body, not be scaled by CSS');
          assert.ok(observed.flags.every(flag => flag === 'true'));
          const message = await page.evaluate(async () => { try { await (window as any).cf207Export(); return 'UNEXPECTED_DOWNLOAD'; } catch (error) { return (error as Error).message; } });
          assert.match(message, /A4 영역을 넘었습니다/u, 'The shared real exporter must keep its overflow guard');
          assert.equal(downloads, 0);
        } else {
          const count = mode.endsWith('fresh') ? 1 : 2;
          assert.deepEqual(observed.numbers, Array.from({ length: count }, (_, index) => 7 + index));
          assert.deepEqual(observed.chapters, Array(count).fill(6));
          assert.deepEqual(observed.flags, Array(count).fill('false'));
          assert.deepEqual(observed.call, { chapter: 6, count });
          assert.equal(observed.text.replace(/\s/gu, ''), observed.sourceText!.replace(/\s/gu, ''), 'All authored text and money must survive without duplication');
          assert.equal(observed.images.length, 1, 'The original photograph must occur exactly once');
          assert.deepEqual(observed.images[0], observed.sourceImage, 'Source, dimensions, alignment and photo ratio must match the reviewed source');
          if (mode === 'explicit-break') {
            assert.equal(observed.headingPage, 0); assert.equal(observed.imagePage, 1, 'Do not group across an authored page break');
          } else {
            assert.equal(observed.headingPage, observed.imagePage, 'The caption heading must remain on the same page as its first photograph');
            assert.equal(observed.imagePage, count - 1);
          }
        }
        const sourceAfter = await page.locator('.proposal-final-pagination-source .proposal-rich-content').innerHTML();
        assert.equal(sourceAfter, observed.sourceHtml, 'Rendered pagination/export must leave the source DOM and authored styles untouched');
        assert.deepEqual(errors, []); assert.deepEqual(denied, []);
      } catch (error) {
        const layout = await page.evaluate(() => ({ flags: [...document.querySelectorAll('[data-export-page]')].map(page => page.getAttribute('data-page-fit-overflow')), children: [...document.querySelector('.proposal-final-pagination-source .proposal-rich-content')?.children ?? []].map(node => ({ tag: node.tagName, height: node.getBoundingClientRect().height })) })).catch(() => null);
        process.stdout.write(`${mode}: ${String(error)}\n${JSON.stringify({ errors, denied, layout })}\n`);
        throw error;
      } finally { await page.close(); }
    });
    if (legacy) assert.equal(legacyApplied, true, 'The legacy run must remove the new product block in memory');
  } finally { await browser.close(); await server.close(); }
});
