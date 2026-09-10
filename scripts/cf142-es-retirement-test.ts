import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, strToU8 } from '../apps/web/node_modules/fflate';
import { fetchEsPublicSources, parsePps2020Retirement } from '../apps/cloudflare/src/es-public-sources';

const text = '[sheet1]\nAL2: 2020년 토목 원가계산 제비율 적용기준\nB2: 적용시기 : 2020.9.8\nB103: [퇴직공제부금비]\nB107: (직노) x 2.3\nC103: [건강보험료]\nC107: (직노) x 3.335';
const bytes = (source = text) => zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'xl/worksheets/sheet1.xml': strToU8(`<worksheet>${[...source.matchAll(/^([A-Z]+\d+): (.+)$/gm)].map(m => `<c r="${m[1]}" t="inlineStr"><is><t>${m[2]}</t></is></c>`).join('')}</worksheet>`) });
const mock = (calls: string[], source = text) => (async (u: RequestInfo | URL) => { const url = String(u); calls.push(url); return url.includes('sn=1') ? new Response(bytes(source)) : new Response('unverified document', { status: url.includes('cak') ? 503 : 200 }); }) as typeof fetch;

test('CF142 historical retirement requires correct trade, effective date, denominator and verified value', async () => {
  assert.equal((await parsePps2020Retirement(text, '토목')).value, '2.3');
  for (const altered of [text.replace('(직노)', '(노)'), text.replace('x 2.3', 'x 2.4'), text.replace('2020.9.8', '2020.7.1'), text + '\nB104: [퇴직공제부금비]']) await assert.rejects(parsePps2020Retirement(altered, '토목'));
  await assert.rejects(parsePps2020Retirement(text, '기타'));
  await assert.rejects(parsePps2020Retirement(text, '건축'));
  await assert.rejects(parsePps2020Retirement(text, '건축', new Uint8Array([1, 2, 3])));
});

test('CF142 bounded historical dates only return retirement, share downloads and retain linked issues', async () => {
  const calls: string[] = [];
  const result = await fetchEsPublicSources(['2020-09-08', '2020-12-15', '2020-12-31'], '토목', '7', mock(calls));
  assert.equal(result.items.length, 3); assert.ok(result.items.every(i => i.field === 'retirement' && i.value === '2.3'));
  assert.equal(calls.filter(u => u.includes('pps')).length, 1);
  assert.ok(result.items.every(i => i.condition.includes('법적 효력 종료일 아님')));
  assert.ok(result.issues.filter(i => i.field === 'health').every(i => i.reason.includes('https://www.pps.go.kr/')));
  const outsideCalls: string[] = [];
  const outside = await fetchEsPublicSources(['2020-09-07', '2021-01-01'], '토목', '7', mock(outsideCalls));
  assert.equal(outside.items.length, 0); assert.equal(outsideCalls.some(u => u.includes('pps')), false);
});

test('CF142 changed architecture original and failed extraction never substitute civil rates', async () => {
  const calls: string[] = [];
  const arch = await fetchEsPublicSources(['2020-12-15'], '건축', '7', mock(calls));
  assert.equal(arch.items.length, 0);
  assert.match(arch.issues.find(i => i.field === 'retirement')!.reason, /PPS_PUBLICATION_MISMATCH.*https:\/\/www.pps.go.kr/);
  const wrong = await fetchEsPublicSources(['2020-12-15'], '토목', '7', mock([], text.replace('(직노)', '(노)')));
  assert.equal(wrong.items.length, 0);
  const unknown = await fetchEsPublicSources(['2020-12-15'], '기타', '7', mock([]));
  assert.equal(unknown.items.length, 0);
});
