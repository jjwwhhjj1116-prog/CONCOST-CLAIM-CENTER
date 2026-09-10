import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zipSync, strToU8 } from '../apps/web/node_modules/fflate';
import { fetchEsPublicSources, parseCakWages, parsePpsRates } from '../apps/cloudflare/src/es-public-sources';
import { extractHwpxTables, extractIntakeSource, extractPublicXlsxText } from '../apps/cloudflare/src/intake-source';
import { applyEsPublicSources, type EsPublicSourceItem } from '../packages/document-engine/src/es-source-candidates';
import { newEsInput } from '../packages/document-engine/src/es-calculation';
import { syncEsSourceDates } from '../packages/document-engine/src/es-source-history';
import { handleServerSettingsRequest, type ServerSettingsAdapterOptions } from '../apps/api/src/settings/server-settings-adapter';

// Generated structural fixtures, not copies of customer workbooks or official documents.
const pps = `[sheet1]\nA1: 2026년 건축 원가계산 간접공사비(제비율) 적용기준
A10: [건강보험료]
B10: [연금보험료]
C10: [노인장기요양보험료]
D10: [산재보험료]
E10: [퇴직공제부금비]
A14: (직노) x 3.595
B14: (직노) x 4.75
C14: (건강보험료) x 13.14
D14: (노) x 3.56
E14: (직노) x 2.3
A20: [고용보험료]
A23: (노) x 율
A24: 공사배정규모(추정금액)
B24: 요율
A27: [3등급] 합성 범위
B27: 1.1299999999999999
[sheet2]\nA1: [건강보험료]\nA5: (직노) x 99`;
const wageRows = [['공표일 (조사기준)', '전체직종', '일반공사 직 종'], ...Array.from({ length: 12 }, (_, i) => [`${2015 + i}. 1. 1 (이전연도 9월)`, '900,000', `${200 + i},001`])];
const escapeXml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const wageBytes = zipSync({ 'Contents/section0.xml': strToU8(`<hp:tbl>${wageRows.map(row => `<hp:tr>${row.map(cell => `<hp:tc><hp:t>${escapeXml(cell)}</hp:t></hp:tc>`).join('')}</hp:tr>`).join('')}</hp:tbl>`) });
function ppsBytes(text = pps) {
  const cells = [...text.split('[sheet2]')[0].matchAll(/^([A-Z]+\d+): (.+)$/gm)];
  return zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData><row>${cells.map(m => `<c r="${m[1]}" t="inlineStr"><is><t>${escapeXml(m[2])}</t></is></c>`).join('')}</row></sheetData></worksheet>`) });
}
const publicMock = (fail: 'pps' | 'cak' | '' = '') => (async (request: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(request));
  assert.equal(init?.redirect, 'manual'); assert.ok(init?.signal);
  assert.ok(['www.pps.go.kr', 'www.cak.or.kr'].includes(url.hostname));
  assert.equal(url.searchParams.has('OC'), false);
  if (url.hostname.includes(fail) && fail) throw new Error('secret-provider-body-must-not-escape');
  const date = url.searchParams.get('key') === '202403150002' ? '2024. 03. 15' : '2026. 04. 13';
  return new Response(url.hostname.includes('cak') ? wageBytes : ppsBytes(pps.replace('A10:', `B2: ※ 적용시기 : ${date}\nA10:`)));
}) as typeof fetch;

test('CF136 PPS identifies rate labels and exact denominators, not note numbers or the second sheet', () => {
  const rates = parsePpsRates(pps, '건축', '3등급');
  assert.deepEqual(Object.fromEntries(Object.entries(rates).map(([key, r]) => [key, r.value])), { health: '3.595', pension: '4.75', care: '13.14', injury: '3.56', retirement: '2.3', employment: '1.13' });
  assert.match(rates.care!.condition, /건강보험료 대비/);
  assert.equal(parsePpsRates(pps.replace('(건강보험료) x 13.14', '(보수) x 0.9448'), '건축', '3등급').care, undefined);
  assert.equal(parsePpsRates(pps + '\n', '건축', '알수없음').employment, undefined);
  assert.equal(parsePpsRates(pps.replace('1.1299999999999999', '#REF!'), '건축', '3등급').employment, undefined);
  assert.equal(parsePpsRates(pps.replace('1.1299999999999999', '1.134'), '건축', '3등급').employment, undefined);
  assert.equal(parsePpsRates(pps.replace('(노) x 율', '(재) x 율'), '건축', '3등급').employment, undefined);
});
test('CF136 HWPX reader keeps table cells, ignores alternate occupation rows and selects general construction', async () => {
  const tables = await extractHwpxTables(wageBytes);
  assert.equal(parseCakWages(tables)[0].value, '211001');
  const duplicate = structuredClone(wageRows); duplicate.push(duplicate[1]);
  assert.throws(() => parseCakWages([duplicate]));
  assert.throws(() => parseCakWages([wageRows, wageRows]));
  assert.throws(() => parseCakWages([[['공표일', '전체직종']]]));
});
test('CF136 official dates pick historical files and deduplicate downloads per selected version', async () => {
  const urls: string[] = [], mock = publicMock();
  const result = await fetchEsPublicSources(['2024-06-15', '2026-05-01', '2026-04-30'], '건축', '3등급', (async (u, init) => { urls.push(String(u)); return mock(u, init); }) as typeof fetch);
  assert.equal(result.items.length, 21); assert.equal(result.issues.length, 3);
  assert.equal(urls.length, 3); assert.ok(urls.some(u => u.includes('202403150002'))); assert.ok(urls.some(u => u.includes('202604070010')));
  assert.equal(result.items.find(i => i.date === '2024-06-15' && i.field === 'wage')?.effectiveDate, '2024-01-01');
  assert.equal(result.items.find(i => i.field === 'employment')?.value, '1.13');
});
test('CF136 one failed provider preserves the other provider and emits only fixed error text', async () => {
  const ppsDown = await fetchEsPublicSources(['2026-05-01'], '건축', '3등급', publicMock('pps'));
  assert.deepEqual(ppsDown.items.map(i => i.field), ['wage']);
  const cakDown = await fetchEsPublicSources(['2026-05-01'], '건축', '3등급', publicMock('cak'));
  assert.equal(cakDown.items.length, 6); assert.equal(JSON.stringify(cakDown).includes('secret-provider'), false);
});
test('CF136 missing trade/grade and unsupported dates do not manufacture rates or future values', async () => {
  const unknown = await fetchEsPublicSources(['2026-05-01'], '기타', '3등급', publicMock());
  assert.equal(unknown.items.length, 1); assert.match(unknown.issues[0].reason, /공종/);
  const noGrade = await fetchEsPublicSources(['2026-05-01'], '건축', '', publicMock());
  assert.equal(noGrade.items.some(i => i.field === 'employment'), false);
  const future = await fetchEsPublicSources(['2027-01-01'], '건축', '3등급', publicMock());
  assert.equal(future.items.length, 0);
  await assert.rejects(fetchEsPublicSources(['2026-02-30'], '건축', '3등급', publicMock()), /INVALID_DATE/);
});
test('CF136 automatic candidate priority is atomic, preserves failures including zero, and never mutates the editor', () => {
  const initial = newEsInput(); initial.baseDate = '2024-06-15'; initial.adjustmentDate = '2026-05-01';
  const input = syncEsSourceDates(initial); input.base.wage = '999'; input.base.rates.safety = '0'; input.current.period.rates.health = '4';
  const saved = JSON.stringify(input);
  const item: EsPublicSourceItem = { date: input.base.date, field: 'wage', value: '258359', effectiveDate: '2024-01-01', source: '합성 공개 출처', condition: '원/일' };
  const next = applyEsPublicSources(input, [item]);
  assert.equal(next.base.wage, '258359'); assert.equal(next.base.rates.safety, '0'); assert.equal(next.current.period.rates.health, '4'); assert.equal(JSON.stringify(input), saved);
  for (const bad of [{ ...item, value: '-1' }, { ...item, effectiveDate: '2025-01-01' }, { ...item, date: '2020-01-01' }, { ...item, field: 'safety' as const }]) assert.throws(() => applyEsPublicSources(input, [item, bad]));
  assert.throws(() => applyEsPublicSources(input, [item, item]));
  assert.throws(() => applyEsPublicSources(input, [{ ...item, effectiveDate: '2024-02-30' }]));
  assert.throws(() => applyEsPublicSources(input, [{ ...item, source: '' }]));
  assert.throws(() => applyEsPublicSources(input, [{ ...item, condition: '' }]));
  assert.equal(JSON.stringify(input), saved);
  input.base.date = '2020-01-01'; assert.throws(() => applyEsPublicSources(input, [item]));
});
test('CF136 public first-sheet reader handles empty PPS formatting without weakening upload limits', async () => {
  const bytes = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'xl/worksheets/sheet1.xml': strToU8(`<worksheet>${'<c r="Z1"/>'.repeat(20_001)}<c r="A1" t="inlineStr"><is><t>공개표</t></is></c></worksheet>`) });
  assert.match(await extractPublicXlsxText(bytes), /A1: 공개표/);
  await assert.rejects(extractIntakeSource('upload.xlsx', '', bytes), /20,000/);
});
test('CF136 public download permits only the original official resource through bounded redirects', async () => {
  const mock = publicMock();
  const allowed = await fetchEsPublicSources(['2026-05-01'], '건축', '3등급', (async (u, init) => { const url = new URL(String(u)); if (!url.searchParams.has('ok')) { url.searchParams.set('ok', '1'); return new Response(null, { status: 302, headers: { location: url.href } }); } return mock(u, init); }) as typeof fetch);
  assert.equal(allowed.items.length, 7);
  const calls: string[] = [];
  const blocked = await fetchEsPublicSources(['2026-05-01'], '건축', '3등급', (async u => { calls.push(String(u)); return new Response(null, { status: 302, headers: { location: 'https://evil.invalid/file' } }); }) as typeof fetch);
  assert.equal(blocked.items.length, 0); assert.equal(calls.length, 2); assert.ok(calls.every(u => !u.includes('evil')));
});
test('CF136 Node public source route enforces role/method/date without reading a key or writing DB', async () => {
  for (const [roles, method, date, status] of [[['staff'], 'GET', '2026-05-01', 200], [['viewer'], 'GET', '2026-05-01', 403], [['admin'], 'POST', '2026-05-01', 405], [['admin'], 'GET', 'bad-date', 400]] as const) {
    let body = ''; const response = { statusCode: 0, setHeader() {}, end(text: string) { body = text; } };
    const handled = await handleServerSettingsRequest({ pathname: '/api/es/sources/public', method, request: { url: `/api/es/sources/public?date=${date}&trade=${encodeURIComponent('건축')}&grade=3` }, response, context: { user: { id: 'synthetic', organizationId: 'synthetic' }, roles: [...roles] }, db: new Proxy({}, { get() { throw new Error('DB access forbidden'); } }), masterKey: null, fetcher: publicMock() } as unknown as ServerSettingsAdapterOptions);
    assert.equal(handled, true); assert.equal(response.statusCode, status, body);
    if (status === 200) assert.equal(JSON.parse(body).items.length, 7);
  }
});
