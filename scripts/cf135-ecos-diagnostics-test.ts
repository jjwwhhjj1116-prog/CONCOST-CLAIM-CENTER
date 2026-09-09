import assert from 'node:assert/strict';
import test from 'node:test';
import { ES_ECOS_ITEMS, fetchEsEcosSources } from '../packages/document-engine/src/es-ecos';

const key = 'CF135SYNTHETICKEY012345';
test('CF135 ECOS errors retain safe diagnosis without echoing provider secrets or URLs', async () => {
  const cases: Array<[() => Response, RegExp]> = [
    [() => Response.json({ RESULT: { CODE: 'INFO-100', MESSAGE: key } }), /유효하지.*INFO-100/],
    [() => Response.json({ RESULT: { CODE: 'INFO-200', MESSAGE: key } }), /공표 자료 없음.*INFO-200/],
    [() => Response.json({ RESULT: { CODE: 'ERROR-602', MESSAGE: key } }), /과도 호출.*ERROR-602/],
    [() => Response.json({ RESULT: { CODE: 'ERROR-100', MESSAGE: key } }), /API 오류.*ERROR-100/],
    [() => Response.json({ RESULT: { CODE: 'INFO-300', MESSAGE: key } }), /API 오류.*INFO-300/],
    [() => Response.json({ RESULT: { CODE: key, MESSAGE: key } }), /RESPONSE_MISMATCH/],
    [() => new Response(key, { status: 403 }), /HTTP 403.*거부/],
    [() => new Response(key, { status: 429 }), /HTTP 429.*호출 제한/],
    [() => new Response(key, { status: 503 }), /HTTP 503/],
    [() => new Response(`<html>${key}</html>`), /INVALID_JSON/],
    [() => new Response(new ReadableStream({ start(controller) { controller.error(new DOMException(key, 'TimeoutError')); } })), /TIMEOUT/],
    [() => Response.json({ StatisticSearch: { list_total_count: 1, row: [null] } }), /RESPONSE_MISMATCH/],
    [() => { throw new DOMException(key, 'TimeoutError'); }, /TIMEOUT/],
    [() => { throw new Error('redirect to private ' + key); }, /NETWORK_REDIRECT/],
    [() => { throw new Error('TLS handshake ' + key); }, /NETWORK_TLS/],
    [() => { throw new Error('DNS lookup failed ' + key); }, /NETWORK_DNS/],
    [() => { throw new Error('Connection reset ' + key); }, /NETWORK_RESET/],
    [() => { throw new Error('https://ecos.bok.or.kr/api/' + key); }, /NETWORK/],
  ];
  for (const [reply, expected] of cases) {
    const result = await fetchEsEcosSources(key, ['2024-06-15'], async () => reply());
    assert.deepEqual(result.items, []);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], expected);
    assert.match(result.warnings[0], /2024-05/);
    assert.ok(!JSON.stringify(result).includes(key));
    assert.ok(!JSON.stringify(result).includes('https://'));
  }
});

test('CF135 follows only bounded official HTTPS ECOS statistic redirects and validates all four results', async () => {
  const calls: string[] = [];
  const result = await fetchEsEcosSources(key, ['2024-06-15'], async (input, init) => {
    const url = new URL(String(input)); calls.push(url.href);
    assert.equal(init?.redirect, 'manual'); assert.ok(init?.signal);
    if (!url.pathname.endsWith('/')) return new Response(null, { status: 301, headers: { Location: url.href + '/' } });
    const parts = url.pathname.split('/').filter(Boolean), code = parts[11];
    const item = ES_ECOS_ITEMS.find(([value]) => value === code)!;
    return Response.json({ StatisticSearch: { list_total_count: 1, row: [{ STAT_CODE: '404Y014', ITEM_CODE1: code, ITEM_NAME1: item[1], TIME: parts[9], UNIT_NAME: '2020=100', DATA_VALUE: '123.45' }] } });
  });
  assert.equal(calls.length, 8); assert.equal(result.items.length, 1); assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.items[0].materials, ['123.45', '123.45', '123.45', '123.45']);
});

test('CF135 never forwards keys to HTTP, other hosts, userinfo, non-statistic routes or unlimited redirects', async () => {
  for (const target of ['http://ecos.bok.or.kr/api/StatisticSearch/' + key + '/', 'https://external.invalid/' + key, 'https://ecos.bok.or.kr/login', 'https://ecos.bok.or.kr/api/StatisticSearch/OTHERKEY/', 'https://user@ecos.bok.or.kr/api/StatisticSearch/' + key + '/', 'LOOP']) {
    let calls = 0;
    const result = await fetchEsEcosSources(key, ['2024-06-15'], async input => {
      calls++; return new Response(null, { status: 302, headers: { Location: target === 'LOOP' ? String(input) : target } });
    });
    assert.deepEqual(result.items, []); assert.equal(calls, target === 'LOOP' ? 12 : 4);
    assert.match(result.warnings[0], target === 'LOOP' ? /REDIRECT_LIMIT/ : /REDIRECT_UNSAFE/);
    assert.ok(!JSON.stringify(result).includes(key));
  }
});
