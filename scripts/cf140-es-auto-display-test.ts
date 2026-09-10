import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newEsInput, calculateEs } from '../packages/document-engine/src/es-calculation';
import { syncEsSourceDates } from '../packages/document-engine/src/es-source-history';
import { fillMissingEsSources } from '../apps/web/src/es/es-auto-sources';
import { esPercent } from '../apps/web/src/es/es-display';
import { handleServerSettingsRequest } from '../apps/api/src/settings/server-settings-adapter';

test('CF140 percentages are exact presentation only, including zero, negative and missing', () => {
  for (const [raw, shown] of [['0.025','2.5%'],['0','0%'],['-0.0311','-3.11%'],['0.5073','50.73%'],['0.52921536','52.921536%'],['','—']] as const) assert.equal(esPercent(raw), shown);
  assert.equal(esPercent(undefined, '계산 대기'), '계산 대기');
  const input = newEsInput(), before = JSON.stringify(input), result = JSON.stringify(calculateEs(input));
  esPercent('0.025'); assert.equal(JSON.stringify(input), before); assert.equal(JSON.stringify(calculateEs(input)), result);
});
function sourceInput() { const input = newEsInput(); input.baseDate = '2023-11-15'; input.adjustmentDate = '2026-07-04'; input.contract!.employmentGrade = '7'; input.contract!.retirementTrade = '건축'; return syncEsSourceDates(input); }
test('CF140 official missing wage/injury fill without overwriting reviewed rates, explicit zero, costs or partial pairs', () => {
  const input = sourceInput(); input.base.wage = '250000'; input.current.period.rates.health = '0'; input.costs[11] = '987654321'; input.previous.machinery.baseAverage = '123';
  const candidate = structuredClone(input); candidate.base.wage = '999999'; candidate.current.period.wage = '268486'; candidate.current.period.rates.injury = '3.56'; candidate.current.period.rates.health = '3.595'; candidate.current.period.rates.safety = '2'; candidate.costs[11] = '1'; candidate.current.period.materials[0] = '125.67';
  for (const c of [candidate.current, candidate.previous]) Object.assign(c.machinery, { commonCount:'2',baseAverage:'100',comparisonAverage:'110' });
  const before = JSON.stringify(input);
  const result = fillMissingEsSources(input, candidate, ['2023-11-15:wage','2026-07-04:wage','2026-07-04:injury','2026-07-04:health','2026-07-04:material0','2026-07-04:pair0','2026-07-03:pair0']);
  assert.equal(result.base.wage, '250000'); assert.equal(result.current.period.wage, '268486'); assert.equal(result.current.period.rates.injury, '3.56'); assert.equal(result.current.period.rates.health, '0'); assert.equal(result.current.period.rates.safety, ''); assert.equal(result.costs[11], '987654321'); assert.equal(result.current.period.materials[0], '125.67'); assert.equal(result.current.machinery.commonCount, '2'); assert.equal(result.previous.machinery.baseAverage, '123'); assert.equal(JSON.stringify(input), before);
});
test('CF140 changed selectors or mismatched period reject stale source values', () => {
  const input = sourceInput(), candidate = structuredClone(input); candidate.current.period.wage = '268486'; candidate.adjustmentDate = '2026-09-01';
  assert.equal(fillMissingEsSources(input, candidate, ['2026-07-04:wage']), input);
  candidate.adjustmentDate = input.adjustmentDate; candidate.current.period.date = '2026-09-01';
  assert.equal(fillMissingEsSources(input, candidate, ['2026-07-04:wage']).current.period.wage, '');
});
test('CF140 Node server explicitly reports unsupported PDF extraction without consuming file or touching DB', async () => {
  for (const method of ['GET', 'POST']) {
    let body = '', status = 0;
    const response = { setHeader() {}, set statusCode(value:number) { status=value; }, end(value:string) { body=value; } };
    const handled = await handleServerSettingsRequest({ pathname:'/api/es/import/contract', method, request: {} as any, response: response as any, db: new Proxy({}, {get(){throw new Error('DB must not be accessed');}}) as any, context:{user:{id:'synthetic',organizationId:'org',name:'Test',email:'test@example.invalid'},roles:['staff'],tokenHash:'synthetic'},masterKey:null });
    assert.equal(handled,true); assert.equal(status, method==='GET'?200:503); const payload=JSON.parse(body); if(method==='GET') { assert.equal(payload.configured,false);assert.equal(payload.externalAiAllowed,false); } else assert.match(payload.error,/아직 지원하지/);
  }
});
