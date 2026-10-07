// Private, local QA only. Originals and customer manuscripts are never written.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { assertQaOutputOutsideSources, matchReferenceSources, readQaNativeEngine } from './cf183-template-source-gate.mjs';

async function main() {
  const sourceRoot = process.env.CF183_SOURCE_ROOT, outputRoot = process.env.CF185_OUTPUT_ROOT, pdfRenderer = process.env.CF185_PDFTOPPM;
  assert.ok(sourceRoot && outputRoot && pdfRenderer, 'Explicit source, private output and Poppler paths are required.');
  const output = resolve(outputRoot);
  assert.equal(existsSync(output), false, 'Never overwrite an earlier visual QA run.');
  assertQaOutputOutsideSources(sourceRoot, dirname(output), basename(output));
  const inventory = JSON.parse(readFileSync('docs/templates/reference-inventory.json', 'utf8'));
  const sources = matchReferenceSources(sourceRoot, inventory);
  const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const candidateRoot = process.env.CF186_ENGINE_ROOT;
  const { root: engineRoot, wasm, engineSha256, bindingSha256 } = readQaNativeEngine(candidateRoot,
    process.env.CF186_ENGINE_WASM_SHA256, process.env.CF186_ENGINE_BINDING_SHA256);
  const engine = await import(pathToFileURL(join(engineRoot, 'rhwp.js')).href);
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
          writeFileSync(join(output, pair.native + '-page-' + number + '.svg'), svg);
          const raster = await page.evaluate(async value => {
            const file: File = await (globalThis as any).cf185Raster(value, 'qa-page.jpg');
            const bitmap = await createImageBitmap(file);
            const result = { width: bitmap.width, height: bitmap.height, bytes: [...new Uint8Array(await file.arrayBuffer())] };
            bitmap.close(); return result;
          }, svg);
          writeFileSync(join(output, pair.native + '-page-' + number + '.jpg'), new Uint8Array(raster.bytes));
          execFileSync(pdfRenderer, ['-f', String(number), '-singlefile', '-r', '96', '-png', pdf.source, join(output, pair.pdf + '-page-' + number)], { windowsHide: true, timeout: 30000 });
          results.push({ native: pair.native, pdf: pair.pdf, page: number, pageCount: doc.pageCount(), width: raster.width, height: raster.height, svgSha256: sha(Buffer.from(svg)), scope: 'Representative private render, requires visual inspection; not all-page fidelity PASS' });
          console.log(JSON.stringify({ native: pair.native, pdf: pair.pdf, page: number, rendered: true }));
        }
      } finally { doc.free(); }
      assert.equal(sha(readFileSync(native.source)), native.sha256);
      assert.equal(sha(readFileSync(pdf.source)), pdf.sha256);
    }
    assert.deepEqual(errors, []);
    writeFileSync(join(output, 'results.json'), JSON.stringify({
      originalsUnchanged: true, errors,
      engine: { wasmSha256: engineSha256, bindingSha256,
        scope: candidateRoot ? 'Explicit diagnostic candidate, not approved runtime' : 'Approved pinned runtime' },
      results,
    }, null, 2));
  } finally { await browser.close(); await server.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
