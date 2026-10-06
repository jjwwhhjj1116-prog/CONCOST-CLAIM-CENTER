// Private, local QA only. Originals and customer manuscripts are never written.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, sep, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { matchReferenceSources } from './cf183-template-source-gate.mjs';

async function main() {
  const sourceRoot = process.env.CF183_SOURCE_ROOT, outputRoot = process.env.CF185_OUTPUT_ROOT, pdfRenderer = process.env.CF185_PDFTOPPM;
  assert.ok(sourceRoot && outputRoot && pdfRenderer, 'Explicit source, private output and Poppler paths are required.');
  const output = resolve(outputRoot);
  assert.equal(existsSync(output), false, 'Never overwrite an earlier visual QA run.');
  const fromOriginals = relative(realpathSync(sourceRoot), join(realpathSync(dirname(output)), basename(output)));
  assert.ok(isAbsolute(fromOriginals) || fromOriginals === '..' || fromOriginals.startsWith('..' + sep), 'QA output must not be inside the originals.');
  const inventory = JSON.parse(readFileSync('docs/templates/reference-inventory.json', 'utf8'));
  const sources = matchReferenceSources(sourceRoot, inventory);
  const wasm = readFileSync('pinned-runtime/pkg/rhwp_bg.wasm');
  const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha(wasm), 'bcc40a79bcd9be813cb231c6d8a0376b803ab8a6c189a09bcccabb8a249f3c44');
  const engine = await import(pathToFileURL(resolve('pinned-runtime/pkg/rhwp.js')).href);
  await engine.default({ module_or_path: wasm });
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const server = await createServer({ root: fileURLToPath(new URL('../apps/web', import.meta.url)),
    ...(process.env.CF185_CACHE_ROOT ? { cacheDir: process.env.CF185_CACHE_ROOT } : {}),
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
      name: 'cf185-native-raster',
      configureServer(server) { server.middlewares.use(async (req, res, next) => {
        if (req.url !== '/cf185-native.html') { next(); return; }
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(req.url, '<!doctype html><html><body><script type="module">import {hwpSvgPageForUpload} from "/src/documents/hwp-page-image.ts"; globalThis.cf185Raster=hwpSvgPageForUpload;</script></body></html>'));
      }); }
    }] });
  await server.listen();
  const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(value => value && existsSync(value));
  assert.ok(executablePath);
  const browser = await chromium.launch({ executablePath, headless: true });
  const results: unknown[] = [];
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin + '/cf185-native.html');
    await page.waitForFunction(() => Boolean((globalThis as any).cf185Raster));
    mkdirSync(output);
    for (const pair of [
      { native: 'TPL-REF-017', pdf: 'TPL-REF-018', pages: [1, 6, 9, 24, 47] },
      { native: 'TPL-REF-025', pdf: 'TPL-REF-026', pages: [1, 4, 6, 45] }
    ]) {
      const native = sources.find((file: any) => file.fileId === pair.native), pdf = sources.find((file: any) => file.fileId === pair.pdf);
      assert.ok(native && pdf);
      const doc = new engine.HwpDocument(readFileSync(native.source));
      try {
        for (const number of pair.pages) {
          assert.ok(number > 0 && number <= doc.pageCount());
          const svg = doc.renderPageSvgWithProfile(number - 1, 'print');
          const raster = await page.evaluate(async value => {
            const file: File = await (globalThis as any).cf185Raster(value, 'qa-page.jpg');
            const bitmap = await createImageBitmap(file);
            const result = { width: bitmap.width, height: bitmap.height, bytes: [...new Uint8Array(await file.arrayBuffer())] };
            bitmap.close(); return result;
          }, svg);
          writeFileSync(join(output, pair.native + '-page-' + number + '.jpg'), new Uint8Array(raster.bytes));
          execFileSync(pdfRenderer, ['-f', String(number), '-singlefile', '-r', '96', '-png', pdf.source, join(output, pair.pdf + '-page-' + number)], { windowsHide: true, timeout: 30000 });
          results.push({ native: pair.native, pdf: pair.pdf, page: number, width: raster.width, height: raster.height, svgSha256: sha(Buffer.from(svg)), scope: 'Representative private render, requires visual inspection; not all-page fidelity PASS' });
          console.log(JSON.stringify({ native: pair.native, pdf: pair.pdf, page: number, rendered: true }));
        }
      } finally { doc.free(); }
      assert.equal(sha(readFileSync(native.source)), native.sha256);
      assert.equal(sha(readFileSync(pdf.source)), pdf.sha256);
    }
    assert.deepEqual(errors, []);
    writeFileSync(join(output, 'results.json'), JSON.stringify({ originalsUnchanged: true, errors, results }, null, 2));
  } finally { await browser.close(); await server.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
