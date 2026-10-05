import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('Native PDF optimization excludes authored text, tables and visual effects', async t => {
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const server = await createServer({ root: resolve('apps/web'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
  await server.listen();
  const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
  assert.ok(executablePath);
  const downloadsPath = resolve('tmp/cf162-native-pdf-downloads'); mkdirSync(downloadsPath, { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: true, downloadsPath });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 }, acceptDownloads: true });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/native.html') return route.fulfill({ contentType: 'text/html', body: '<html><meta charset="utf-8"><body></body></html>' });
      return route.continue();
    });
    await page.goto(origin + '/native.html'); await page.evaluate('globalThis.__name = value => value');
    const cases = [
      ['contain', true], ['fill', true], ['emptyBR', true], ['previewScale', true],
      ['flip', false], ['filter', false], ['opacity', false], ['border', false],
      ['pseudo', false], ['text', false], ['table', false], ['secondImage', false],
    ] as const;
    for (const [name, direct] of cases) await t.test(name, async () => {
      const result = await page.evaluate(async name => {
        document.body.replaceChildren();
        const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 400;
        const context = canvas.getContext('2d')!; context.fillStyle = '#ff0000'; context.fillRect(0, 0, 150, 400); context.fillStyle = '#0000ff'; context.fillRect(150, 0, 150, 400);
        const src = canvas.toDataURL();
        const root = document.createElement('div'); root.dataset.exportDocumentKind = 'REPORT';
        root.innerHTML = '<section class="report-native-sheet" data-export-page data-export-page-policy="fit" data-page-fit-overflow="false" style="position:relative;width:794px;height:1123px;overflow:hidden;background:white"><article><img data-report-source-page="true" style="display:block;width:794px;height:1123px;object-fit:contain" src="' + src + '"></article></section>';
        document.body.append(root); const sheet = root.firstElementChild as HTMLElement, image = sheet.querySelector('img')!;
        if (name === 'fill') image.style.objectFit = 'fill';
        if (name === 'emptyBR') sheet.insertAdjacentHTML('beforeend', '<p style="display:none"><br></p>');
        if (name === 'previewScale') root.style.transform = 'scale(.6)';
        if (name === 'flip') image.style.transform = 'scaleX(-1)';
        if (name === 'filter') image.style.filter = 'grayscale(1)';
        if (name === 'opacity') image.style.opacity = '.5';
        if (name === 'border') image.style.borderBottom = '2px solid red';
        if (name === 'pseudo') { const css = document.createElement('style'); css.textContent = '.report-native-sheet::after{content:"印";position:absolute;top:10px;left:10px}'; root.append(css); }
        if (name === 'text') sheet.insertAdjacentHTML('beforeend', '<p style="position:absolute;top:10px;left:10px">추가 주석 123,456원</p>');
        if (name === 'table') sheet.insertAdjacentHTML('beforeend', '<table style="position:absolute;top:10px;left:10px"><tr><td>추가 표</td></tr></table>');
        if (name === 'secondImage') sheet.insertAdjacentHTML('beforeend', '<img src="' + src + '" style="position:absolute;top:10px;left:10px;width:40px;height:40px">');
        await Promise.all([...root.querySelectorAll('img')].map(image => image.decode()));
        let clones = 0;
        const observer = new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLIFrameElement) clones++; });
        observer.observe(document.body, { childList: true });
        try {
          const { downloadFinalDocument } = await import('/src/documents/final-document-export.ts' as string);
          const output = await downloadFinalDocument({ root, format: 'pdf', fileName: 'guard-' + name });
          return { clones, pages: output.pageCount, bytes: output.byteSize };
        } finally { observer.disconnect(); }
      }, name);
      assert.equal(result.pages, 1); assert.ok(result.bytes > 512);
      if (direct) assert.equal(result.clones, 0, 'Plain source pages must avoid document clones');
      else assert.ok(result.clones > 0, 'Mixed or styled pages must retain the existing capture path');
    });
  } finally { await browser.close(); await server.close(); }
});
