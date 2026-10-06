import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { matchReferenceSources } from './cf183-template-source-gate.mjs';

test('CF185 PDF import validates absolute portrait A4 dimensions before image conversion', async t => {
  const originals = process.env.CF183_SOURCE_ROOT ? matchReferenceSources(process.env.CF183_SOURCE_ROOT, JSON.parse(readFileSync('docs/templates/reference-inventory.json', 'utf8'))).filter((file: any) => file.extension === '.pdf') : [];
  const referencePages = originals.length ? JSON.parse(readFileSync('tmp/cf183-source-gate-20261006-r3/results.json', 'utf8')).results : [];
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const server = await createServer({ root: fileURLToPath(new URL('../apps/web', import.meta.url)),
    ...(process.env.CF185_CACHE_ROOT ? { cacheDir: process.env.CF185_CACHE_ROOT } : {}),
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
      name: 'cf185-pdf-paper',
      transform(code, id) {
        if (process.env.CF185_NEGATIVE !== '1' || !id.replaceAll('\\', '/').endsWith('/pdf-page-image.ts')) return;
        const changed = code.replace('height > width && Math.abs(width - 210 * 72 / 25.4) <= 3 && Math.abs(height - 297 * 72 / 25.4) <= 3', 'height > width && Math.abs(width / height - 210 / 297) < .025');
        assert.notEqual(changed, code, 'The negative control must actually restore the old aspect-only check.');
        return changed;
      },
      configureServer(server) { server.middlewares.use(async (req, res, next) => {
        const original = originals.find((file: any) => req.url === '/cf185-original/' + file.fileId);
        if (original) { res.setHeader('Content-Type', 'application/pdf'); res.end(readFileSync(original.source)); return; }
        if (req.url !== '/cf185.html') { next(); return; }
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(req.url, '<!doctype html><html><body><script type="module" src="/cf185-entry.js"></script></body></html>'));
      }); },
      resolveId: id => id === '/cf185-entry.js' ? '\0cf185-entry' : undefined,
      load: id => id === '\0cf185-entry' ? `
        import { jsPDF } from 'jspdf';
        import { openPdfPageImages } from '/src/documents/pdf-page-image.ts';
        globalThis.cf185 = { openPdfPageImages, makePdf: (sizes) => {
          const pdf = new jsPDF({ unit: 'pt', format: sizes[0], orientation: sizes[0][1] > sizes[0][0] ? 'portrait' : 'landscape' });
          sizes.slice(1).forEach(size => pdf.addPage(size, size[1] > size[0] ? 'portrait' : 'landscape'));
          return new Uint8Array(pdf.output('arraybuffer'));
        }};
      ` : undefined
    }] });
  await server.listen();
  const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(value => value && existsSync(value));
  assert.ok(executablePath, 'Use the installed browser; do not install a test browser.');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin + '/cf185.html');
    await page.waitForFunction(() => Boolean((globalThis as any).cf185));
    const a4 = [210 * 72 / 25.4, 297 * 72 / 25.4], a3 = [297 * 72 / 25.4, 420 * 72 / 25.4];
    for (const item of [
      { name: 'standard A4', sizes: [a4], valid: true },
      { name: 'existing Hancom PDF 593 x 840', sizes: [[593, 840]], valid: true },
      { name: 'existing Hancom PDF 595 x 841', sizes: [[595, 841]], valid: true },
      { name: 'A3 has the same aspect ratio but is not A4', sizes: [a3], valid: false },
      { name: 'A5 has the same aspect ratio but is not A4', sizes: [[148 * 72 / 25.4, 210 * 72 / 25.4]], valid: false },
      { name: 'landscape A4', sizes: [[a4[1], a4[0]]], valid: false },
      { name: 'second page is A3', sizes: [a4, a3], valid: false, page: 2 }
    ]) await t.test(item.name, async () => {
      const result = await page.evaluate(async sizes => {
        const api = (globalThis as any).cf185;
        const bytes = api.makePdf(sizes), before = bytes.slice();
        let pages: Awaited<ReturnType<typeof import('../apps/web/src/documents/pdf-page-image').openPdfPageImages>> | undefined;
        try {
          pages = await api.openPdfPageImages(bytes);
          const file = await pages!.readPage(0), bitmap = await createImageBitmap(file);
          const result = { accepted: true, count: pages!.count, width: bitmap.width, height: bitmap.height, message: '', unchanged: before.every((value: number, index: number) => bytes[index] === value) };
          bitmap.close(); return result;
        } catch (error) {
          return { accepted: false, count: 0, width: 0, height: 0, message: String(error), unchanged: before.every((value: number, index: number) => bytes[index] === value) };
        } finally { if (pages) await pages.close(); }
      }, item.sizes);
      assert.equal(result.accepted, item.valid, result.message || item.name);
      assert.equal(result.unchanged, true, 'Import must not rewrite original PDF bytes.');
      if (item.valid) { assert.equal(result.count, item.sizes.length); assert.equal(result.width, 1588); assert.ok(result.height > 2200 && result.height < 2300); }
      else assert.match(result.message, new RegExp('PDF ' + (item.page ?? 1) + '쪽.*A4 세로'));
    });
    if (originals.length) {
      assert.equal(originals.length, 15);
      for (const original of originals) await t.test(original.fileId + ' actual original preflight', async () => {
        const result = await page.evaluate(async id => {
          let pages: Awaited<ReturnType<typeof import('../apps/web/src/documents/pdf-page-image').openPdfPageImages>> | undefined;
          try {
            const bytes = new Uint8Array(await (await fetch('/cf185-original/' + id)).arrayBuffer());
            pages = await (globalThis as any).cf185.openPdfPageImages(bytes);
            return { accepted: true, count: pages!.count, message: '' };
          } catch (error) { return { accepted: false, count: 0, message: String(error) }; }
          finally { if (pages) await pages.close(); }
        }, original.fileId);
        if (original.fileId === 'TPL-REF-013') { assert.equal(result.accepted, false); assert.match(result.message, /PDF \d+쪽.*A4 세로/u); }
        else { assert.equal(result.accepted, true, result.message); assert.equal(result.count, referencePages.find((record: any) => record.id === original.fileId)?.pages); }
        assert.equal(createHash('sha256').update(readFileSync(original.source)).digest('hex'), original.sha256);
      });
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});
