import assert from 'node:assert/strict';
import { test } from 'node:test';
import { esFormatNumber } from '../apps/web/src/es/EsMoneyInput';
import { esElapsedDays } from '../packages/document-engine/src/es-source-history';
import { newEsInput, calculateEs } from '../packages/document-engine/src/es-calculation';
import { esTemplateGrids, esTemplateValues } from '../packages/document-engine/src/es-template';

test('CF127 won formatting adds thousands separators without unit scaling or floating-point conversion', () => {
  for (const [raw, expected] of [['2224344990', '2,224,344,990'], ['876000', '876,000'], ['69177000', '69,177,000'], ['0', '0'], ['-1234567.89', '-1,234,567.89'], ['123456789012345678901234567890', '123,456,789,012,345,678,901,234,567,890'], ['0.0311', '0.0311'], ['', ''], ['—', '—'], ['2025-01-01', '2025-01-01']]) assert.equal(esFormatNumber(raw), expected);
});
test('CF127 elapsed days use contract date minus one day, not bid date; absent contract is unresolved', () => {
  const input = newEsInput(); input.baseDate = '2023-11-15'; input.adjustmentDate = '2025-01-01'; input.contract!.contractDate = '2023-12-15';
  assert.equal(esElapsedDays(input), '382');
  const grid = esTemplateGrids.find(g => Object.values(g.fields).some(v => v.startsWith('display.elapsedDays')))!;
  const address = Object.entries(grid.fields).find(([, v]) => v.startsWith('display.elapsedDays'))![0];
  assert.equal(esTemplateValues(input, calculateEs(input), grid)[address], '382');
  input.contract!.contractDate = ''; assert.equal(esElapsedDays(input), '');
});
test('CF127 source bid percentage becomes numeric fraction in the original percent-format output cell', () => {
  const input = newEsInput(); input.contract!.bidRate = '87.745';
  const grid = esTemplateGrids.find(g => g.name === '1')!;
  assert.equal(esTemplateValues(input, calculateEs(input), grid).J6, '0.87745');
});
