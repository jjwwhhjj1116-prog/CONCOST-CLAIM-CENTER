import assert from 'node:assert/strict';
import test from 'node:test';
import { esSourceLinks } from '../apps/web/src/es/EsSourceLinks';

test('CF142 public agency links preserve exact documents and Korean law parentheses', () => {
  const pps = 'https://www.pps.go.kr/kor/bbs/view.do?bbsSn=0001213031&key=00038';
  const law = 'https://www.law.go.kr/법령/국민건강보험법시행령/(20200101)/제44조';
  const links = esSourceLinks(`공표 ${pps}; / (${law}) / ${pps} / https://ecos.bok.or.kr/`);
  assert.equal(links.length, 3); assert.equal(links[0].href, pps);
  assert.equal(decodeURI(links[1].href), law); assert.equal(links[2].label, '한국은행 ECOS 통계 조회');
  assert.equal(esSourceLinks('https://pps.go.kr/kor/bbs/list.do?key=00038')[0].label, '조달청 공표 목록');
});

test('CF142 unsafe, credentialed or spoofed source URLs never become links', () => {
  assert.deepEqual(esSourceLinks('https://constructor/a https://__proto__/a'), []);
  for (const value of ['javascript:alert(1)', 'http://www.pps.go.kr/a', 'https://www.pps.go.kr.evil.example/a', 'https://www.pps.go.kr@evil.example/a', 'https://u:p@www.pps.go.kr/a', 'https://www.pps.go.kr:8080/a', 'https://www.law.go.kr/DRF/lawService.do?OC=PRIVATE', 'https://ecos.bok.or.kr/api/StatisticSearch/PRIVATE/json/', 'https://www.pps.go.kr/a?token=PRIVATE']) assert.deepEqual(esSourceLinks(value), []);
});

test('CF142 preserves both period pair download links, never fabricates a missing source', () => {
  const text = 'https://www.cak.or.kr/download.do?uuid=base.pdf / https://www.cak.or.kr/download.do?uuid=current.pdf';
  assert.equal(esSourceLinks(text).length, 2); assert.deepEqual(esSourceLinks('기존 Excel · 출처 미확인'), []);
});
