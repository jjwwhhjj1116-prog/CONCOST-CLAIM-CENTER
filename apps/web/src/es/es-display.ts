import { esDecimal } from '../../../../packages/document-engine/src/es-decimal';

/** Presentation only: persisted coefficients remain exact fractions. */
export function esPercent(value: string | undefined, missing = '—'): string {
  if (value === undefined || value === '') return missing;
  try { return esDecimal(value).mul(esDecimal(100)).toString() + '%'; }
  catch { return missing; }
}
