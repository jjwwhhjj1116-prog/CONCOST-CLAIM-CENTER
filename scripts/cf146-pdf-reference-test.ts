import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';

async function main() {
  const root = process.env.CF146_SOURCE_ROOT;
  assert.ok(root, 'CF146_SOURCE_ROOT is required; originals are read-only.');
  const files = readdirSync(root, { recursive: true }).map(String).filter(name => /^(07|09)\./u.test(name) && /\.pdf$/iu.test(name)).sort();
  assert.equal(files.length, 2);
  const originals = files.map(name => readFileSync(join(root, name)));
  const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const server = await createServer({ root: fileURLToPath(new URL('../apps/web', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
    name: 'cf146-pdf-readonly',
    configureServer(server) { server.middlewares.use(async (req, res, next) => {
      const index = /^\/source\/(\d+)$/u.exec(req.url ?? '');
      if (index && originals[Number(index[1])]) { res.setHeader('Content-Type', 'application/pdf'); res.end(originals[Number(index[1])]); return; }
      if (req.url !== '/cf146-pdf.html') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml(req.url, '<!doctype html><html><body><script type="module">import {openPdfPageImages} from "/src/documents/pdf-page-image.ts"; window.openPages=openPdfPageImages;</script></body></html>'));
    }); }
  }] });
  await server.listen();
  const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
  const browser = await chromium.launch({ executablePath, headless: true });
  const output = fileURLToPath(new URL('../tmp/cf146-pdf-direct/', import.meta.url)); mkdirSync(output, { recursive: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = []; const warnings: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (/warn|error/u.test(m.type())) warnings.push(m.text()); });
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin + '/cf146-pdf.html'); await page.waitForFunction(() => Boolean((window as any).openPages));
    const results = [];
    for (let index = 0; index < files.length; index++) {
      const count = await page.evaluate(async i => {
        const api = window as any;
        api.pdfPages = await api.openPages(new Uint8Array(await (await fetch('/source/' + i)).arrayBuffer()));
        return api.pdfPages.count;
      }, index);
      assert.equal(count, index === 0 ? 29 : 39);
      const pages = [];
      for (let number = 0; number < count; number++) {
        const result = await page.evaluate(async n => {
          const file = await (window as any).pdfPages.readPage(n);
          const bitmap = await createImageBitmap(file);
          const result = { width: bitmap.width, height: bitmap.height, bytes: [...new Uint8Array(await file.arrayBuffer())] };
          bitmap.close(); return result;
        }, number);
        assert.equal(result.width, 1588); assert.ok(result.height > 2200 && result.height < 2300);
        writeFileSync(join(output, `${index === 0 ? '07' : '09'}-page-${number + 1}.jpg`), new Uint8Array(result.bytes));
        pages.push({ number: number + 1, width: result.width, height: result.height });
      }
      await page.evaluate(() => (window as any).pdfPages.close());
      assert.equal(hash(readFileSync(join(root, files[index]))), hash(originals[index]));
      results.push({ category: index === 0 ? '07' : '09', count, pages, originalUnchanged: true });
      process.stdout.write(JSON.stringify({ category: results.at(-1)!.category, count, originalUnchanged: true }) + '\n');
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, [], 'PDF renderer warnings require investigation, not silent success');
    writeFileSync(join(output, 'results.json'), JSON.stringify({ results, errors, warnings, scope: 'PDF direct render only; not HWP fidelity or live save' }, null, 2));
  } finally { await browser.close(); await server.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
