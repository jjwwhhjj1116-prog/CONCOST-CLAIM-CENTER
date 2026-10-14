import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright-core';

test('CF220 real DOCX export collapses only empty zero-height paragraphs in report and proposal', async () => {
  const base = resolve('tmp/cf220-qa'); mkdirSync(base, { recursive: true });
  const proof = mkdtempSync(join(base, 'docx-empty-'));
  const before = process.env.CF220_BEFORE_EMPTY_PARAGRAPH === '1';
  const patch = /  if \(!spacing && !marker && !children\.length && collapsedParagraph\(element\)\) \{\r?\n    return new Paragraph\(\{ children: \[\], spacing: \{ before: 0, after: 0, line: 1, lineRule: LineRuleType\.EXACT \} \}\);\r?\n  \}/u;
  const omit = "    if (node.tagName === 'P' && !node.closest('td,th') && collapsedParagraph(node) && !(await runs([...node.childNodes], node)).length) continue;";
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const server = await createServer({ root: resolve('apps/web'), cacheDir: join(proof, 'cache'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', plugins: [{
    name: 'cf220-empty-paragraph-fixture', enforce: 'pre',
    configureServer(s) { s.middlewares.use(async (req, res, next) => { if (req.url !== '/empty.html') return next(); res.setHeader('Content-Type', 'text/html'); res.end(await s.transformIndexHtml(req.url, '<html><head><style>p{margin:16px 0}</style></head><body><script type="module" src="/empty-entry.js"></script></body></html>')); }); },
    resolveId: id => id === '/empty-entry.js' ? id : undefined,
    load: id => id === '/empty-entry.js' ? `import {createEditableDocx} from '/src/documents/editable-docx-export.ts';import {unzipSync,strFromU8} from 'fflate';
      window.runEmpty=async kind=>{const root=document.createElement('div');root.dataset.exportDocumentKind=kind;document.body.append(root);
      root.innerHTML='<article data-export-page style="width:794px;min-height:1123px;padding:40px;font:16px/24px Arial"><p style="margin:0">START</p><p id="collapsed" style="margin:0"></p><p id="break" style="margin:0"><br></p><p id="height" style="margin:0;height:24px"></p><p id="spacing" style="margin:12px 0 18px;height:24px"></p><p id="image" style="margin:0"><img width="4" height="2" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAF0lEQVR4nGN8Vqtj8KqNAQyY4CwGBgYAWcQE0+6Bp0sAAAAASUVORK5CYII="></p><ul style="margin:0"><li id="marker" style="height:0;margin:0"></li></ul><p id="defaultMargin"></p><p id="physicalMargin" style="margin:12px 0 18px"></p><p id="logicalMargin" style="margin-block-start:10px;margin-block-end:14px"></p><p style="margin:0">END</p><table><tr><td><p id="cellBlank" style="margin:0"></p></td><td>KEEP CELL</td></tr></table></article>';
      await root.querySelector('img').decode();const geometry=Object.fromEntries([...root.querySelectorAll('[id]')].map(e=>[e.id,e.getBoundingClientRect().height]));const html=root.innerHTML;
      const bytes=await createEditableDocx(root,'portrait');const zip=unzipSync(bytes);const xml=strFromU8(zip['word/document.xml']);const d=new DOMParser().parseFromString(xml,'application/xml'),ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';const body=d.getElementsByTagNameNS(ns,'body')[0];
      const paragraphs=[...body.children].filter(e=>e.localName==='p').map(p=>{const s=p.getElementsByTagNameNS(ns,'spacing')[0];return {text:[...p.getElementsByTagNameNS(ns,'t')].map(t=>t.textContent).join(''),spacing:s?Object.fromEntries([...s.attributes].map(a=>[a.localName,a.value])):{},breaks:p.getElementsByTagNameNS(ns,'br').length,drawings:p.getElementsByTagNameNS(ns,'drawing').length};});
      const cells=[...body.getElementsByTagNameNS(ns,'tc')].map(c=>{const p=c.getElementsByTagNameNS(ns,'p')[0],s=p.getElementsByTagNameNS(ns,'spacing')[0];return {text:c.textContent,spacing:s?Object.fromEntries([...s.attributes].map(a=>[a.localName,a.value])):{}};});const unchanged=root.innerHTML===html;root.remove();return {geometry,paragraphs,cells,unchanged,xml,bytes:Array.from(bytes)};};window.ready=true;` : undefined,
    transform(code, id) { if (!before || !id.endsWith('/editable-docx-export.ts')) return null; assert.ok(patch.test(code), 'Exact production patch is required for the negative'); assert.equal(code.split(omit).length, 2, 'Exactly one body omission guard'); return code.replace(patch, '').replace(omit, ''); }
  }] });
  await server.listen();
  const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => p && existsSync(p)); assert.ok(executablePath);
  const browser = await chromium.launch({ executablePath, headless: true });
  const results: unknown[] = [];
  try {
    const page = await browser.newPage(); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', r => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
    await page.goto(origin + '/empty.html'); await page.waitForFunction('window.ready===true');
    for (const kind of ['REPORT', 'PROPOSAL']) {
      const result = await page.evaluate(kind => (window as any).runEmpty(kind), kind);
      writeFileSync(join(proof, kind + '.docx'), Buffer.from(result.bytes)); delete result.bytes;
      results.push({ kind, ...result });
    }
    writeFileSync(join(proof, 'result.json'), JSON.stringify({ before, errors, results }, null, 2)); console.log(JSON.stringify({ proof, before }));
    assert.deepEqual(errors, []);
    for (const row of results as any[]) {
      assert.equal(row.unchanged, true); assert.equal(row.geometry.collapsed, 0); assert.equal(row.geometry.marker, 0);
      const p = row.paragraphs; assert.equal(p.length, 10, 'Nine authored body paragraphs plus required terminal table paragraph; no collapsed body/default-margin paragraphs');
      assert.equal(p[0].text, 'START'); assert.equal(p[8].text, 'END');
      assert.equal(p[1].breaks, 1); assert.notEqual(p[1].spacing.line, '1');
      assert.equal(p[2].spacing.line, '360'); assert.equal(p[3].spacing.before, '180'); assert.equal(p[3].spacing.after, '270');
      assert.equal(p[4].drawings, 1); assert.equal(p[4].spacing.lineRule, 'atLeast'); assert.notEqual(p[4].spacing.line, '1');
      assert.ok(p[5].text.trim()); assert.notEqual(p[5].spacing.line, '1');
      assert.equal(row.geometry.defaultMargin, 0); assert.equal(row.geometry.physicalMargin, 0); assert.equal(row.geometry.logicalMargin, 0); assert.equal(row.geometry.cellBlank, 0);
      assert.equal(p[6].spacing.before, '180'); assert.equal(p[6].spacing.after, '270');
      assert.equal(p[7].spacing.before, '150'); assert.equal(p[7].spacing.after, '210');
      assert.equal(row.cells.length, 2); assert.equal(row.cells[1].text, 'KEEP CELL');
      assert.deepEqual(row.cells[0].spacing, { before: '0', after: '0', line: '1', lineRule: 'exact' });
    }
  } finally { await browser.close(); await server.close(); }
});
