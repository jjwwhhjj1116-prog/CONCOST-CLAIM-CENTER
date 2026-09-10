import type { EsInput } from '../../../../packages/document-engine/src/es-calculation';
import { ES_RATE_KEYS } from '../../../../packages/document-engine/src/es-calculation';

export const esSourceSelectors = (input: EsInput) => JSON.stringify([input.baseDate, input.adjustmentDate, input.contract?.employmentGrade ?? '', input.contract?.retirementTrade ?? '']);

/** Only verified missing fields; explicit zero/manual values are never replaced. */
export function fillMissingEsSources(input: EsInput, candidate: EsInput, automatic: string[]): EsInput {
  if (esSourceSelectors(input) !== esSourceSelectors(candidate)) return input;
  const next = structuredClone(input);
  for (const key of ['base', 'current', 'previous'] as const) {
    const target = key === 'base' ? next.base : next[key].period;
    const source = key === 'base' ? candidate.base : candidate[key].period;
    if (target.date !== source.date) continue;
    const filled: string[] = [];
    for (const field of ['wage', ...ES_RATE_KEYS, 'material0', 'material1', 'material2', 'material3']) {
      if (!automatic.includes(target.date + ':' + field)) continue;
      const object = field.startsWith('material') ? target.materials : field === 'wage' ? target : target.rates;
      const from = field.startsWith('material') ? source.materials : field === 'wage' ? source : source.rates;
      const prop = field.startsWith('material') ? field.slice(8) : field;
      const to = object as unknown as Record<string, string>, values = from as unknown as Record<string, string>;
      if (to[prop] === '' && values[prop] !== '') { to[prop] = values[prop]; filled.push(field); }
    }
    if (filled.length) target.source = `${target.source} / 빈 항목 자동조회 적용 (${filled.join(', ')}): ${source.source}`.slice(-2000);
    if (key === 'base') continue;
    for (const [i, pair] of [next[key].machinery, ...next[key].standards].entries()) {
      if (!automatic.includes(target.date + ':pair' + i)) continue;
      // A partially edited pair needs review; never splice two different publications.
      if ([pair.baseAverage, pair.comparisonAverage, pair.commonCount, pair.baseSum, pair.comparisonSum, pair.baseLabel, pair.comparisonLabel, pair.source].some(Boolean)) continue;
      Object.assign(pair, structuredClone(i === 0 ? candidate[key].machinery : candidate[key].standards[i - 1]));
    }
  }
  return next;
}
