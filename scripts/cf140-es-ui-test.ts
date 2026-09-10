import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Page, type Route } from 'playwright-core';
import * as XLSX from 'xlsx';
import { newEsInput, calculateEs, validateEsInput, type EsInput } from '../packages/document-engine/src/es-calculation';
import { fillMissingEsSources } from '../apps/web/src/es/es-auto-sources';
import { esPercent } from '../apps/web/src/es/es-display';

const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
function fixture(): EsInput {
  const input = newEsInput(); input.title = 'CF140 로컬 합성 검수'; input.baseDate = '2024-01-01'; input.adjustmentDate = '2024-03-01'; input.contractAmount = '1000000';
  input.contract!.contractDate = '2023-12-20'; input.contract!.employmentGrade = '3'; input.contract!.retirementTrade = '건축';
  input.costs[11] = '2500'; input.costs[18] = '97500';
  for (const [period, date, wage] of [[input.base, input.baseDate, '100'], [input.current.period, input.adjustmentDate, '200'], [input.previous.period, '2024-02-29', '199']] as const) {
    period.date = date; period.wage = wage; period.materials = ['100', '100', '100', '100'];
    for (const key of Object.keys(period.rates) as (keyof typeof period.rates)[]) period.rates[key] = '1';
  }
  for (const context of [input.current, input.previous]) for (const pair of [context.machinery, ...context.standards]) Object.assign(pair, { commonCount: '1', baseAverage: '100', comparisonAverage: '100' });
  assert.equal(calculateEs(input).current!.k, '0.025'); return input;
}
function costWorkbook(): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['원가계산서'], ['', '', '', '당초(A)', '변경(B)'], ['', '', '', '금액', '금액'],
    ['', '', '직접노무비', 10000, 20000], ['', '', '간접노무비', 1000, 2000], ['', '', '산재보험료', 300, 400],
    ['', '', '직접재료비', 100000, 200000], ['', '', '총공사비', 2000000, 3000000],
  ]);
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, '총괄원가계산서');
  return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
}
type Context = {
  page: Page; writes: string[]; sources: string[]; external: string[]; pdfCalls: string[];
  saved: () => EsInput; holdPublic: () => { started: Promise<void>; release: () => void };
};
async function withStudio(run: (context: Context) => Promise<void>) {
  const { createServer } = await import('../apps/web/node_modules/vite/dist/node/index.js');
  const server = await createServer({ root: resolve('apps/web'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', plugins: [{
    name: 'cf140-ui-harness', enforce: 'pre', resolveId(id: string) { if (id === '/cf140-ui.js') return '\0cf140-ui'; },
    load(id: string) { if (id === '\0cf140-ui') return `import React from 'react'; import {createRoot} from 'react-dom/client'; import {EsStudio} from '/src/es/EsStudio.tsx'; function Harness(){const [id,setId]=React.useState('cf140-local');return React.createElement(React.Fragment,null,React.createElement('button',{onClick:()=>setId('cf140-other')},'합성 다른 문서 열기'),React.createElement(EsStudio,{mode:'editor',search:'?documentId='+id,onNavigate:()=>{}}));} createRoot(document.getElementById('root')).render(React.createElement(Harness));`; },
  }] } as any);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); const address = server.httpServer!.address(); assert.ok(address && typeof address === 'object'); const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ executablePath, headless: true }); const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } }); page.setDefaultTimeout(8000);
    const errors: string[] = [], writes: string[] = [], sources: string[] = [], external: string[] = [], pdfCalls: string[] = [];
    let stored = fixture(), revision = 1, held: { started: () => void; wait: Promise<void> } | undefined;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async (route: Route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { external.push(url.origin); await route.abort(); return; }
      const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/cf140-ui') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="/cf140-ui.js"></script></body></html>' });
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/es/import/contract') {
        if (request.method() === 'GET') return reply({ configured: true, externalAiAllowed: true });
        pdfCalls.push(request.method()); assert.equal(request.method(), 'POST');
        assert.match(request.postData() ?? '', /name="consent"[\s\S]*true/);
        return reply({ preview: { contractAmount: { value: '4500000', page: 2, quote: '합성 변경 계약금액 4,500,000원 VAT 포함', vat: 'INCLUDED', basis: 'AMENDED' }, baseDate: null, contractDate: { value: '2024-01-03', page: 1, quote: '합성 당초 계약일 2024년 1월 3일', basis: 'ORIGINAL' }, warnings: ['합성 응답: 실제 AI 호출 없음'] } });
      }
      if (url.pathname.startsWith('/api/es/sources/')) {
        sources.push(url.pathname + url.search); assert.equal(request.method(), 'GET');
        if (url.pathname.endsWith('/public')) {
          if (held) { const gate = held; held = undefined; gate.started(); await gate.wait; }
          return reply({ items: [...new Set(url.searchParams.getAll('date'))].flatMap(date => [
            { date, field: 'wage', value: '268486', effectiveDate: '2024-01-01', source: '합성 CAK 자료', condition: '일반공사 원/일' },
            { date, field: 'injury', value: '3.56', effectiveDate: '2024-01-01', source: '합성 PPS 자료', condition: '노무비 대비 %' },
          ]), issues: [] });
        }
        return reply(url.pathname.endsWith('/pairs') ? { items: [], issues: [] } : { items: [], warnings: ['합성 일부 미조회'] });
      }
      if (url.pathname === '/api/cases') return reply({ cases: [] });
      if (url.pathname === '/api/es/documents/cf140-local' && request.method() === 'PUT') {
        writes.push('save'); stored = validateEsInput(request.postDataJSON().input); revision++;
      } else if (request.method() !== 'GET') { writes.push(request.method() + ' ' + url.pathname); return reply({}, 405); }
      const other = url.pathname === '/api/es/documents/cf140-other', input = other ? fixture() : stored;
      if (other) { input.title = 'CF140 별도 합성 문서'; input.base.wage = '654321'; }
      return reply({ document: { id: other ? 'cf140-other' : 'cf140-local', title: input.title, revision, caseId: null, updatedAt: '2026-09-10T00:00:00Z' }, input, inputHash: 'synthetic', run: { id: 'run-synthetic', revision, inputHash: 'synthetic', input, result: calculateEs(input) } });
    });
    await page.addInitScript('window.__CLAIM_API_ORIGIN__=window.location.origin;'); await page.goto(origin + '/cf140-ui'); await page.getByText('저장됨 · v1', { exact: true }).waitFor();
    await run({ page, writes, sources, external, pdfCalls, saved: () => structuredClone(stored), holdPublic: () => {
      let started!: () => void, release!: () => void; const began = new Promise<void>(resolve => { started = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
      held = { started, wait }; return { started: began, release };
    } });
    assert.deepEqual(errors, [], 'real React runtime errors'); assert.deepEqual(external, [], 'all nonlocal provider traffic forbidden');
  } finally { await browser?.close(); await server.close(); }
}

test('CF140 percent display is exact and automatic fill preserves reviewed values and partial pairs', () => {
  assert.equal(esPercent('0.025'), '2.5%'); assert.equal(esPercent('0.0001234567890123'), '0.01234567890123%'); assert.equal(esPercent('0'), '0%'); assert.equal(esPercent(''), '—');
  const input = fixture(), candidate = structuredClone(input); input.base.rates.injury = '0'; input.current.period.wage = '';
  candidate.base.wage = '268486'; candidate.base.rates.injury = '3.56'; candidate.current.period.wage = '268486';
  const before = JSON.stringify(input), next = fillMissingEsSources(input, candidate, [input.base.date + ':wage', input.base.date + ':injury', input.current.period.date + ':wage']);
  assert.equal(next.base.wage, '100'); assert.equal(next.base.rates.injury, '0'); assert.equal(next.current.period.wage, '268486'); assert.equal(JSON.stringify(input), before);
  input.current.machinery.baseAverage = ''; input.current.machinery.comparisonAverage = ''; input.current.machinery.commonCount = ''; input.current.machinery.baseSum = '777';
  assert.deepEqual(fillMissingEsSources(input, candidate, [input.current.period.date + ':pair0']).current.machinery, input.current.machinery, 'sum-only manual pair cannot be replaced');
});

test('CF140 React: XLSX exclusive choice, checked-only application, PDF consent and no automatic save', { skip: !executablePath, timeout: 60000 }, () => withStudio(async ({ page, writes, pdfCalls, sources, saved }) => {
  const initial = saved();
  assert.equal((await page.locator('.es-summary-footer > span').first().innerText()).replace(/\s+/g, ' '), '현재 K (%) 2.5%');
  await page.getByRole('button', { name: /5 계산검토/ }).click();
  const laborRow = page.locator('.es-calculation-table tbody tr').filter({ has: page.getByRole('button', { name: /직접노무비/ }) });
  assert.deepEqual(await laborRow.locator('td').allTextContents(), ['2,500', '2.5%', '100', '200', '2', '5%']);
  assert.equal(await page.locator('.es-inspector dl > div').nth(1).locator('dd').innerText(), '2.5%');
  await page.getByRole('button', { name: '계약서·원가 가져오기', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '계약서·원가계산서에서 가져오기' });
  await dialog.getByLabel('원본 파일 (20MB 이하)').setInputFiles({ name: 'cf140-synthetic.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: costWorkbook() });
  await dialog.getByRole('button', { name: '파일 읽기 · 적용 전 확인' }).click();
  const select = dialog.getByLabel('가져올 원가 열'); await select.waitFor();
  assert.equal(await select.inputValue(), ''); assert.equal(await dialog.getByRole('button', { name: '확인한 항목만 입력에 적용' }).isEnabled(), false);
  assert.equal((await select.locator('option').allTextContents()).length, 3);
  await select.selectOption('0:D'); await dialog.getByRole('button', { name: '취소 · 기존 유지', exact: true }).click();
  assert.deepEqual(saved(), initial); assert.deepEqual(writes, []); await page.getByRole('button', { name: /2 비목·적용대가/ }).click();
  assert.equal(await page.getByLabel('직접노무비 금액 (원)', { exact: true }).inputValue(), '2,500');
  await page.getByRole('button', { name: '계약서·원가 가져오기', exact: true }).click();
  await dialog.getByLabel('원본 파일 (20MB 이하)').setInputFiles({ name: 'cf140-synthetic.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: costWorkbook() });
  await dialog.getByRole('button', { name: '파일 읽기 · 적용 전 확인' }).click(); await select.waitFor();
  await select.selectOption('0:E'); await dialog.getByLabel('간접노무비 적용', { exact: true }).uncheck(); await dialog.getByLabel('산재보험료 적용', { exact: true }).uncheck();
  assert.equal(await dialog.getByLabel(/총계약금액도 교체/).isChecked(), false); assert.match(await dialog.innerText(), /직접재료비/); assert.deepEqual(writes, []); assert.deepEqual(saved(), initial);
  await dialog.getByRole('button', { name: '확인한 항목만 입력에 적용' }).click(); await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /2 비목·적용대가/ }).click();
  assert.equal(await page.getByLabel('직접노무비 금액 (원)', { exact: true }).inputValue(), '20,000'); assert.equal(await page.getByLabel('간접노무비 금액 (원)', { exact: true }).inputValue(), '0');
  assert.equal(await page.getByLabel('공산품 금액 (원)', { exact: true }).inputValue(), '97,500'); assert.deepEqual(writes, []); assert.deepEqual(saved(), initial);
  await page.getByRole('button', { name: '계약서·원가 가져오기', exact: true }).click();
  await dialog.getByLabel('원본 파일 (20MB 이하)').setInputFiles({ name: 'cf140-synthetic.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% synthetic API mock only\n%%EOF') });
  const read = dialog.getByRole('button', { name: '파일 읽기 · 적용 전 확인' }); assert.equal(await read.isEnabled(), false); assert.deepEqual(pdfCalls, []);
  await dialog.getByLabel(/계약 PDF를 조직 공용 Gemini로 전송/).check(); await read.click(); await dialog.getByText('합성 응답: 실제 AI 호출 없음', { exact: true }).waitFor();
  assert.deepEqual(pdfCalls, ['POST']); assert.equal(await dialog.getByLabel('입찰 기준일 적용', { exact: true }).isEnabled(), false);
  mkdirSync('output/playwright/cf140', { recursive: true });
  await page.screenshot({ path: resolve('output/playwright/cf140/import-review-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: resolve('output/playwright/cf140/import-review-mobile.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.ok(await dialog.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1; }));
  await page.setViewportSize({ width: 1400, height: 1100 });
  assert.equal(await dialog.getByLabel('총계약금액 (원) 적용', { exact: true }).isChecked(), false); assert.equal(await dialog.getByRole('button', { name: '확인한 항목만 입력에 적용' }).isEnabled(), false);
  await dialog.getByLabel('총계약금액 (원) 적용', { exact: true }).check(); await dialog.getByRole('button', { name: '확인한 항목만 입력에 적용' }).click();
  await page.getByRole('button', { name: /1 기본입력/ }).click();
  assert.equal(await page.getByLabel('총계약금액 (원)', { exact: false }).inputValue(), '4,500,000');
  assert.equal(await page.getByLabel(/^계약일수동 입력/).inputValue(), initial.contract!.contractDate); assert.equal(await page.getByLabel(/입찰 기준일 \(초회\)/).inputValue(), initial.baseDate);
  assert.deepEqual(writes, []); assert.deepEqual(sources, []); assert.deepEqual(saved(), initial);
  await page.getByRole('button', { name: '저장', exact: true }).click(); await page.getByText('저장됨 · v2', { exact: true }).waitFor();
  assert.deepEqual(writes, ['save']); assert.equal(saved().costs[11], '20000'); assert.equal(saved().costs[18], '97500'); assert.equal(saved().contractAmount, '4500000'); assert.equal(saved().contract!.vatMode, 'VAT 포함');
}));

test('CF140 React: date debounce fills only verified blanks and preserves manual changes made before lookup', { skip: !executablePath, timeout: 45000 }, () => withStudio(async ({ page, writes, sources, saved }) => {
  const before = saved(), response = page.waitForResponse(r => r.url().includes('/api/es/sources/public?'));
  await page.getByLabel(/^조정기준일수동 입력/).fill('2026-07-04');
  await page.waitForTimeout(200); assert.equal(sources.length, 0);
  await page.getByLabel(/^조정기준일수동 입력/).fill('2026-07-05');
  await page.getByRole('button', { name: /3 지수·요율/ }).click();
  await page.getByLabel('현재일 노임 (원)', { exact: true }).fill('777777');
  await page.getByLabel('현재일 노임 (원)', { exact: true }).press('Tab');
  await response; await page.waitForFunction(() => document.querySelector('.es-save-state')?.textContent === '저장하지 않은 변경');
  assert.equal(sources.filter(v => v.includes('/public?')).length, 1); assert.ok(sources.every(v => v.includes('2026-07-05') && !v.includes('2026-07-03')));
  assert.equal(await page.getByLabel('현재일 노임 (원)', { exact: true }).inputValue(), '777,777'); assert.equal(await page.getByLabel('기준일 노임 (원)', { exact: true }).inputValue(), '100');
  assert.equal(await page.getByLabel('현재일 산재 요율 (%)', { exact: true }).inputValue(), '3.56'); assert.equal(await page.getByLabel('직전일 노임 (원)', { exact: true }).inputValue(), '268,486');
  await page.getByText(/기준일·조건 변경에 따라 공식 자료를 조회했습니다/).waitFor();
  assert.equal(await page.locator('dialog[open]').count(), 0); assert.deepEqual(writes, []); assert.deepEqual(saved(), before);
}));

test('CF140 React: late public response cannot change a different loaded document', { skip: !executablePath, timeout: 45000 }, () => withStudio(async ({ page, holdPublic, sources, writes, saved }) => {
  const before = saved(), gate = holdPublic();
  await page.getByLabel(/^조정기준일수동 입력/).fill('2026-07-04'); await gate.started;
  await page.getByRole('button', { name: '합성 다른 문서 열기', exact: true }).click(); await page.getByText('CF140 별도 합성 문서', { exact: true }).waitFor();
  gate.release(); await page.getByText('저장됨 · v1', { exact: true }).waitFor();
  await page.getByRole('button', { name: /3 지수·요율/ }).click();
  assert.equal(await page.getByLabel('기준일 노임 (원)', { exact: true }).inputValue(), '654,321'); assert.equal(await page.getByLabel('현재일 노임 (원)', { exact: true }).inputValue(), '200');
  assert.equal(await page.getByLabel('현재일 적용일', { exact: true }).inputValue(), '2024-03-01');
  assert.equal(await page.getByRole('button', { name: '조회 결과·근거 확인', exact: true }).count(), 0); assert.equal(sources.filter(v => v.includes('/public?')).length, 1); assert.deepEqual(writes, []); assert.deepEqual(saved(), before);
}));
