import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { calculateEs, newEsInput } from '../packages/document-engine/src/es-calculation';
import { esTemplateGrids, esTemplateStyles, esTemplateValues, type EsTemplateGrid } from '../packages/document-engine/src/es-template';
import { paginateEsTemplate } from '../apps/web/src/es/es-template-print';

// Synthetic inputs only. Browser checks use the installed Chrome in a separate
// headless profile, localhost modules and the real print CSS; no native printing.
const titles = [
  '물가변동으로 인한 계약금액 조정에 대한 종합의견서',
  '물가변동으로 인한 계약금액조정내역 총괄표',
  '물가변동 조정율(지수조정율) 산출표',
  '물가변동에 적용한 각종지수의 산정표',
  '직하조정율'
];
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const noMeasurement = new Proxy({}, { get() { throw new Error('Divider unexpectedly required DOM measurement'); }, set() { throw new Error('Divider unexpectedly changed the measurement DOM'); } }) as HTMLElement;
for (const [i, title] of titles.entries()) test(`CF129 ${i + 1} divider preserves the exact source title and escaped input on one page`, () => {
  const grid = esTemplateGrids.find(g => g.name === `붙${i + 1}`)!;
  const input = newEsInput(); input.title = '합성 공사 <검수> & "제목"';
  const values = esTemplateValues(input, calculateEs(input), grid);
  assert.equal(values.B8, title);
  values.C10 = '추가 확인 <script>실행 금지</script> & "작은따옴표\'"';
  values.D47 = '합성 쪽 꼬리 <검수>';
  const before = structuredClone(values), pages = paginateEsTemplate(grid, values, noMeasurement);
  assert.equal(pages.length, 1);
  assert.ok(pages[0].includes(`data-sheet="붙${i + 1}"`));
  for (const text of [title, values.A1, values.C10, values.D47]) assert.ok(pages[0].includes(escape(text)), text);
  assert.equal(pages[0].split(title).length - 1, 1, 'Title is neither duplicated nor replaced');
  assert.ok(!pages[0].includes('<script>'));
  assert.deepEqual(values, before);
});

const executablePath = process.env.CF129_CHROME_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
test('CF129 real Chromium pagination retains content, physical label size and full-width centered dividers', { skip: !executablePath ? 'Installed Chrome unavailable; actual DOM pagination is NOT_RUN.' : false, timeout: 60000 }, async t => {
  const { createServer } = await import('../apps/web/node_modules/vite/dist/node/index.js');
  const server = await createServer({ root: resolve('apps/web'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', plugins: [{
    name: 'cf129-readonly-print-css', enforce: 'pre',
    transform(code: string, id: string) { if (id.replaceAll('\\', '/').split('?')[0].endsWith('/es/EsPrintPreview.tsx')) return code + '\nexport { PRINT_CSS };'; }
  }] } as unknown as Parameters<typeof createServer>[0]);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const external: string[] = [], pageErrors: string[] = [];
  try {
    await server.listen();
    const address = server.httpServer!.address(); assert.ok(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
      if (url.pathname === '/cf129-print-test') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><head><meta charset="UTF-8"></head><body></body></html>' });
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) throw new Error('Unexpected application API request');
      return route.continue();
    });
    await page.goto(origin + '/cf129-print-test');
    await page.evaluate(async () => {
      const rendererPath = '/src/es/es-template-print.ts', previewPath = '/src/es/EsPrintPreview.tsx';
      const [{ paginateEsTemplate }, { PRINT_CSS }] = await Promise.all([import(rendererPath), import(previewPath)]);
      const style = document.createElement('style'); style.textContent = PRINT_CSS; document.head.append(style);
      const measure = document.createElement('div'); measure.id = 'measure'; document.body.append(measure);
      (window as unknown as { cf129Paginate: typeof paginateEsTemplate }).cf129Paginate = paginateEsTemplate;
      await document.fonts.ready;
    });
    const regular = esTemplateStyles.findIndex(s => s.font.size === 12 && s.alignment?.shrinkToFit !== '1');
    const shrink = esTemplateStyles.findIndex(s => s.font.size === 12 && s.alignment?.shrinkToFit === '1');
    assert.ok(regular >= 0 && shrink >= 0);
    const grid = (rows: number, columns = 1, height = 24): EsTemplateGrid => ({ name: '합성 양식', printArea: `A1:${String.fromCharCode(64 + columns)}${rows}`, defaultRowHeight: height, rowHeights: {}, hiddenRows: [], columns: Object.fromEntries(Array.from({ length: columns }, (_, i) => [i + 1, { width: columns === 1 ? 100 : 8.43, style: regular }])), merges: [], cellStyles: [], margins: {}, pageSetup: {}, staticCells: {}, fields: {} });
    const render = (input: EsTemplateGrid, values: Record<string, string>) => page.evaluate(({ input, values }) => {
      const measure = document.getElementById('measure')!;
      const paginate = (window as unknown as { cf129Paginate: (g: EsTemplateGrid, v: Record<string, string>, m: HTMLElement) => string[] }).cf129Paginate;
      const pages = paginate(input, values, measure); measure.innerHTML = pages.join('');
      return { count: pages.length, html: pages, cells: Array.from(measure.querySelectorAll<HTMLTableCellElement>('td[data-cell]')).filter(cell => cell.textContent?.trim()).map(cell => {
        const span = cell.firstElementChild!, rect = span.getBoundingClientRect(), parent = cell.getBoundingClientRect();
        let effectivePt = parseFloat(getComputedStyle(span).fontSize) * .75;
        for (let node: Element | null = span; node; node = node.parentElement) effectivePt *= Number(getComputedStyle(node).zoom) || 1;
        return { address: cell.dataset.cell, text: cell.textContent, effectivePt, fontPx: parseFloat(getComputedStyle(span).fontSize), whiteSpace: getComputedStyle(cell).whiteSpace, left: rect.left - parent.left, right: parent.right - rect.right };
      }) };
    }, { input, values });

    await t.test('more than 30 blank fragments are removed while first and last meaningful cells survive exactly once', async () => {
      const input = grid(1100), values = { A1: '처음 근거', A1100: '마지막 근거' };
      const dense = await render(input, Object.fromEntries(Array.from({ length: 1100 }, (_, i) => [`A${i + 1}`, `합성 ${i + 1}`])));
      assert.ok(dense.count > 30, 'Fixture actually exercises many page fragments');
      const sparse = await render(input, values);
      assert.equal(sparse.count, 2);
      assert.deepEqual(sparse.cells.map(c => [c.address, c.text]), Object.entries(values));
      for (const html of sparse.html) assert.ok(html.includes(values.A1) || html.includes(values.A1100));
    });
    await t.test('a 40-row form compresses unused row heights to one page without reducing its 12pt font', async () => {
      const input = grid(40, 1, 25), values = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`A${i + 1}`, `합성 항목 ${i + 1}`]));
      const result = await render(input, values);
      assert.equal(result.count, 1); assert.equal(result.cells.length, 40);
      for (const cell of result.cells) assert.equal(cell.fontPx, 16, cell.address);
      assert.deepEqual(result.cells.map(c => [c.address, c.text]), Object.entries(values));
    });
    await t.test('long nonnumeric shrink labels wrap at a physical minimum of 7.5pt without horizontal clipping', async () => {
      const input = grid(20, 10, 24); input.cellStyles = [['A1', shrink]];
      const text = '고용보험 적용 등급 및 건설 공사 종류의 확인을 위한 비교 기준일';
      const result = await render(input, { A1: text });
      assert.equal(result.cells[0].text, text); assert.equal(result.cells[0].whiteSpace, 'normal');
      assert.ok(result.cells[0].effectivePt >= 7.49, JSON.stringify(result.cells[0]));
      assert.ok(result.cells[0].left >= -1 && result.cells[0].right >= -1, JSON.stringify(result.cells[0]));
    });
    await t.test('an oversized merged row rejects output instead of silently clipping content', async () => {
      const input = grid(2, 1, 1000); input.merges = ['A1:A2'];
      await assert.rejects(render(input, { A1: '삭제하면 안 되는 합성 본문\n'.repeat(200) }), /병합 행이 인쇄 한 페이지보다 큽니다/);
    });
    await t.test('all five original divider titles occupy a centered full-width 18pt content box', async () => {
      for (const [i, title] of titles.entries()) {
        const input = esTemplateGrids.find(g => g.name === `붙${i + 1}`)!;
        const result = await render(input, { A1: '합성 공사 제목', B7: `붙임 ${i + 1}`, B8: title });
        assert.equal(result.count, 1);
        const geometry = await page.locator('h1[data-cell="B8"]').evaluate(node => {
          const title = node.getBoundingClientRect(), paper = node.closest('.es-paper')!.getBoundingClientRect();
          const range = document.createRange(); range.selectNodeContents(node); const text = range.getBoundingClientRect();
          return { title: node.textContent, centerOffset: (title.left + title.right - paper.left - paper.right) / 2, width: title.width, paperWidth: paper.width, fontPx: parseFloat(getComputedStyle(node).fontSize), textInside: text.left >= paper.left && text.right <= paper.right && text.bottom <= paper.bottom };
        });
        assert.equal(geometry.title, title); assert.equal(geometry.fontPx, 24);
        assert.ok(Math.abs(geometry.centerOffset) < 1); assert.ok(geometry.width / geometry.paperWidth > .88);
        assert.ok(geometry.textInside);
      }
    });
    assert.deepEqual(external, []); assert.deepEqual(pageErrors, []);
  } finally { await browser?.close(); await server.close(); }
});
