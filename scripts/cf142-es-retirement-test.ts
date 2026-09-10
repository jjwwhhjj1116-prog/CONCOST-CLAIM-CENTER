import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchEsPublicSources } from '../apps/cloudflare/src/es-public-sources';
import { PPS_HISTORY } from '../apps/cloudflare/src/es-pps-history-data';

test('CF142 retirement coverage is retained by the full CF143 historical catalogue', () => {
  for (const trade of ['건축', '토목']) {
    const record = PPS_HISTORY.find(r => r.date === '2020-09-08' && r.trade === trade)!;
    assert.equal(record.rates.retirement[0], '2.3');
    assert.equal(Object.keys(record.rates).length, 12);
    assert.ok(PPS_HISTORY.some(r => r.date === '2021-01-06' && r.trade === trade));
  }
});
test('CF142 changed original remains blocked and three dates share one historical download', async () => {
  const calls: string[] = [];
  const result = await fetchEsPublicSources(['2020-09-08', '2020-12-15', '2020-12-31'], '건축', '7', (async (url: RequestInfo | URL) => {
    calls.push(String(url)); return new Response('changed original');
  }) as typeof fetch);
  assert.equal(result.items.length, 0);
  assert.equal(calls.filter(u => u.includes('pps.go.kr/common/fileDown')).length, 1);
  assert.equal(result.issues.filter(i => i.field === 'retirement').length, 3);
  assert.ok(result.issues.filter(i => i.field === 'retirement').every(i => i.reason.includes('원문 버전 변경') && i.reason.includes('https://www.pps.go.kr/')));
});
