import assert from 'node:assert/strict';
import test from 'node:test';
import { PPS_HISTORY } from '../apps/cloudflare/src/es-pps-history-data';
import { fetchPpsHistory } from '../apps/cloudflare/src/es-pps-history';

test('CF143 unique, source-linked annual catalogue covers 2011 through 2022 with verified fields', () => {
  const seen = new Set<string>();
  for (const r of PPS_HISTORY) {
    const id = r.date + r.trade; assert.ok(!seen.has(id)); seen.add(id);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/); assert.match(r.sha256, /^[a-f0-9]{64}$/);
    assert.match(r.key, /^\d+$/); assert.match(r.sn, /^\d+$/); assert.match(r.notice, /^\d+$/);
    assert.ok(['건축', '토목'].includes(r.trade));
    if (Object.keys(r.rates).length) {
      assert.equal(Object.keys(r.rates).length, 12);
      for (const [value, evidence] of Object.values(r.rates)) { assert.ok(Number(value) > 0 && Number(value) < 100); assert.ok(evidence); }
    }
  }
  for (let year = 2011; year <= 2022; year++) for (const trade of ['건축', '토목'])
    assert.ok(PPS_HISTORY.some(r => r.date.startsWith(String(year)) && r.trade === trade), year + trade);
});
test('CF143 effective-date and grade-group boundaries retain actual historical rates', () => {
  const value = (date: string, field: string) => [...PPS_HISTORY].reverse().find(r => r.trade === '건축' && r.date <= date)!.rates[field][0];
  assert.equal(value('2011-06-09','health'),'1.59'); assert.equal(value('2011-06-10','health'),'1.7');
  assert.equal(value('2012-09-17','employment2'),value('2012-09-17','employment3'));
  assert.equal(value('2018-07-31','health'),'1.7'); assert.equal(value('2018-08-01','health'),'3.12');
  assert.equal(value('2021-06-30','employment7'),'0.87'); assert.equal(value('2021-07-01','employment7'),'1.01');
  assert.equal(value('2022-01-02','health'),'3.43'); assert.equal(value('2022-01-03','health'),'3.495');
});
test('CF143 damaged and unconfirmed intervals never silently extend older rates', async () => {
  for (const [date,trade] of [['2011-01-02','건축'],['2011-02-01','토목'],['2012-01-15','토목'],['2012-02-01','건축'],['2012-06-01','토목'],['2013-12-01','건축'],['2014-02-01','토목'],['2010-12-31','건축'],['2023-01-02','건축'],['2017-01-01','기타']]) {
    let loaded = false;
    const result = await fetchPpsHistory(date,trade,'7',async()=>{loaded=true;throw new Error('must not load');});
    assert.equal(result.items.length,0,date); assert.equal(result.issues.length,6,date); assert.equal(loaded,false,date);
    assert.ok(result.issues.every(i=>i.reason.includes('https://www.pps.go.kr/')));
  }
});
test('CF143 original identity, old health basis and employment grade are validated before returning candidates', async () => {
  const record=PPS_HISTORY.find(r=>r.date==='2017-02-15' && r.trade==='건축')!;
  const original=record.sha256, bytes=new TextEncoder().encode('synthetic source identity test only');
  record.sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  try {
    const result=await fetchPpsHistory('2017-06-01','건축','7',async()=>bytes);
    assert.equal(result.items.length,6); assert.equal(result.items.find(i=>i.field==='health')!.basis,'PPS_CONSTRUCTION_DIRECT_LABOR');
    assert.equal(result.items.find(i=>i.field==='employment')!.value,'0.87');
    const invalid=await fetchPpsHistory('2017-06-01','건축','8',async()=>bytes);
    assert.equal(invalid.items.length,5); assert.equal(invalid.issues[0].field,'employment');
    const changed=await fetchPpsHistory('2017-06-01','건축','7',async()=>new Uint8Array([1]));
    assert.equal(changed.items.length,0); assert.equal(changed.issues.length,6);
    await assert.rejects(fetchPpsHistory('2017-06-01','건축','7',async()=>{throw new Error('offline');}));
  } finally { record.sha256=original; }
});

test('CF143 January gap suppresses only changed fields, never backdates the next publication', async () => {
  for (const [date,recordDate,blocked] of [
    ['2017-01-01','2016-03-07',['injury']],
    ['2018-01-01','2017-02-15',['injury','care']],
    ['2019-01-01','2018-08-01',['injury','health','care']],
    ['2020-01-01','2019-06-28',['injury','health','care']],
    ['2021-01-01','2020-09-08',['injury','health','care']],
    ['2022-01-02','2021-07-01',['health','care']],
    ['2023-01-01','2022-04-25',['health','care']],
  ] as const) for (const trade of ['건축','토목']) {
    const record=PPS_HISTORY.find(r=>r.date===recordDate && r.trade===trade)!;
    const original=record.sha256, bytes=new TextEncoder().encode('synthetic January identity');
    record.sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
    try {
      const result=await fetchPpsHistory(date,trade,'7',async()=>bytes);
      assert.deepEqual(result.issues.map(i=>i.field).sort(),[...blocked].sort(),date+trade);
      assert.equal(result.items.length,6-blocked.length);
      assert.ok(result.issues.every(i=>i.reason.includes('전년도 요율 자동 연장 안 함')));
      assert.equal(result.items.find(i=>i.field==='retirement')!.value,'2.3');
    } finally { record.sha256=original; }
  }
});
