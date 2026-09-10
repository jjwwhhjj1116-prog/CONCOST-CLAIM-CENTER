/** Untrusted AI candidates only: applying them requires a separate human confirmation. */
export type EsContractBasis = 'ORIGINAL' | 'AMENDED' | 'UNSPECIFIED';
export type EsContractVat = 'INCLUDED' | 'EXCLUDED' | 'UNSPECIFIED';
export interface EsContractDateCandidate { value: string; page: number; quote: string }
export interface EsContractAmountCandidate extends EsContractDateCandidate { vat: EsContractVat; basis: EsContractBasis }
export interface EsContractSignedDateCandidate extends EsContractDateCandidate { basis: EsContractBasis }
export interface EsContractImportPreview {
  contractAmount: EsContractAmountCandidate | null;
  baseDate: EsContractDateCandidate | null;
  contractDate: EsContractSignedDateCandidate | null;
  warnings: string[];
}
export const ES_CONTRACT_MAX_BYTES = 20_000_000;

function invalid(): never { throw new Error('ES_CONTRACT_INVALID_RESULT'); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) return invalid();
  return record;
}
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) return invalid();
  return value.trim();
}
function evidence(value: unknown, extra: string[]): Record<string, unknown> & EsContractDateCandidate {
  const record = object(value, ['value', 'page', 'quote', ...extra]);
  const result = { ...record, value: cleanText(record.value, 24), quote: cleanText(record.quote, 600), page: record.page as number };
  if (!Number.isInteger(result.page) || result.page < 1 || result.page > 2000 || result.quote.length < 4) return invalid();
  return result;
}
function basis(value: unknown, quote: string): EsContractBasis {
  if (value !== 'ORIGINAL' && value !== 'AMENDED' && value !== 'UNSPECIFIED') return invalid();
  if (value === 'ORIGINAL' && !/당초|최초|원\s*계약/u.test(quote)) return invalid();
  if (value === 'AMENDED' && !/변경|수정/u.test(quote)) return invalid();
  return value;
}
function date(record: EsContractDateCandidate): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(record.value)) return invalid();
  const parsed = new Date(record.value + 'T00:00:00Z');
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== record.value) return invalid();
  const [year, month, day] = record.value.split('-').map(Number);
  if (year < 1900 || year > 2199) return invalid();
  // The candidate must be visibly supported by its own quote, not another field.
  const pattern = new RegExp(`(?:^|[^0-9])${year}\\s*(?:[-./]|년)\\s*0?${month}\\s*(?:[-./]|월)\\s*0?${day}(?:일|[^0-9]|$)`, 'u');
  if (!pattern.test(record.quote)) return invalid();
}

export function validateEsContractImport(value: unknown): EsContractImportPreview {
  const input = object(value, ['contractAmount', 'baseDate', 'contractDate', 'warnings']);
  if (!Array.isArray(input.warnings) || input.warnings.length > 12) return invalid();
  const modelWarnings = input.warnings.map(item => cleanText(item, 300));
  const warnings: string[] = [];
  let contractAmount: EsContractAmountCandidate | null = null;
  if (input.contractAmount !== null) {
    const item = evidence(input.contractAmount, ['vat', 'basis']);
    if (!/^[1-9]\d{0,17}$/u.test(item.value)) return invalid();
    if (!new RegExp(`(?:^|[^0-9])${item.value}(?:[^0-9]|$)`, 'u').test(item.quote.replace(/[,\s]/gu, ''))) return invalid();
    if (!/계약|도급/u.test(item.quote) || !/원|KRW/u.test(item.quote)) return invalid();
    if (item.vat !== 'INCLUDED' && item.vat !== 'EXCLUDED' && item.vat !== 'UNSPECIFIED') return invalid();
    const compactQuote = item.quote.replace(/\s/gu, '');
    if (item.vat === 'INCLUDED' && !/(?:부가가치세|부가세|VAT)포함/iu.test(compactQuote)) return invalid();
    if (item.vat === 'EXCLUDED' && !/(?:부가가치세|부가세|VAT)(?:제외|별도|미포함)/iu.test(compactQuote)) return invalid();
    contractAmount = { value: item.value, page: item.page, quote: item.quote, vat: item.vat, basis: basis(item.basis, item.quote) };
    if (item.vat === 'UNSPECIFIED') warnings.push('계약금액의 부가세 포함 여부를 원문에서 확인하세요.');
    if (item.basis === 'UNSPECIFIED') warnings.push('계약금액이 당초 계약인지 변경 계약인지 확인하세요.');
    if (item.basis === 'AMENDED') warnings.push('변경 계약금액 후보입니다. ES에 사용할 총계약금액인지 확인하세요.');
  }
  let baseDate: EsContractDateCandidate | null = null;
  if (input.baseDate !== null) {
    const item = evidence(input.baseDate, []); date(item);
    if (!/입찰\s*(?:일(?:자)?|기준일|마감일)/u.test(item.quote)) return invalid();
    baseDate = { value: item.value, page: item.page, quote: item.quote };
  } else warnings.push('입찰 기준일을 확인하지 못했습니다. 계약일로 대체하지 않고 기존 값을 유지합니다.');
  let contractDate: EsContractSignedDateCandidate | null = null;
  if (input.contractDate !== null) {
    const item = evidence(input.contractDate, ['basis']); date(item);
    if (!/계약\s*(?:일(?:자)?|체결일)|체결\s*일자/u.test(item.quote)) return invalid();
    contractDate = { value: item.value, page: item.page, quote: item.quote, basis: basis(item.basis, item.quote) };
  }
  warnings.push('AI 추출 후보입니다. 원본 페이지·인용문과 금액·날짜를 대조한 뒤 선택 적용하세요.');
  return { contractAmount, baseDate, contractDate, warnings: [...new Set([...warnings, ...modelWarnings])].slice(0, 12) };
}
