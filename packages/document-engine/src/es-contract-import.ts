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
function vatSupported(value: EsContractVat, quote: string): boolean {
  const compact = quote.replace(/\s/gu, '');
  const label = '(?:부가가치세|부가세|VAT)(?:는|를|가|이|의)?[:：]?';
  if (value === 'UNSPECIFIED') return true;
  if (/(?:포함|제외|별도|미포함)(?:(?:하|되)지|여부|인지|(?:이|가|는)?(?:아니|아님))|미확인|불명확|미정/iu.test(compact)) return false;
  const included = new RegExp(label + '포함', 'iu').test(compact);
  const excluded = new RegExp(label + '(?:제외|별도|미포함)', 'iu').test(compact);
  return value === 'INCLUDED' ? included && !excluded : excluded && !included;
}
function unitPriceQuote(quote: string): boolean {
  return /단가|평\s*당|(?:㎡|m[²2]|제곱미터|\))\s*당|(?:원|KRW)\s*[/／]\s*(?:평|㎡|m[²2]|제곱미터)|승한\s*금액|곱한\s*금액/iu.test(quote);
}
function amountSupported(value: string, quote: string): boolean {
  // Match the currency beside this exact amount, not a distant '원' in another sentence.
  // No unit conversion: a quoted thousands/millions or foreign-currency amount needs manual review.
  if (!/계약|도급/u.test(quote) || unitPriceQuote(quote) || /(?:단위|금액)\s*[:：]?\s*[(（]?\s*[십백천만억조]+\s*원|[0-9][0-9,.\s]*[십백천만억조]+\s*원|USD|EUR|JPY|CNY|달러|유로|위안|엔화|[$€¥]/iu.test(quote)) return false;
  const compact = quote.replace(/\d[\d,]*/gu, token => /^\d{1,3}(?:,\d{3})+$/u.test(token) ? token.replace(/,/gu, '') : token);
  if (new RegExp(`[-−+]\\s*(?:(?:₩|￦|KRW)\\s*)?${value}(?![0-9])`, 'iu').test(compact)) return false;
  return new RegExp(`(?:^|[^0-9,.−+-])(?:(?:₩|￦|KRW)\\s*${value}(?![0-9,eE]|\\.[0-9])|${value}\\s*(?:원|KRW))`, 'iu').test(compact);
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
    if (!amountSupported(item.value, item.quote)) return invalid();
    if (item.vat !== 'INCLUDED' && item.vat !== 'EXCLUDED' && item.vat !== 'UNSPECIFIED') return invalid();
    if (!vatSupported(item.vat, item.quote)) return invalid();
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
    if (!/계약\s*(?:일(?:자)?|체결\s*(?:일|[년연]월일))|체결\s*일자/u.test(item.quote)) return invalid();
    contractDate = { value: item.value, page: item.page, quote: item.quote, basis: basis(item.basis, item.quote) };
  }
  warnings.push('AI 추출 후보입니다. 원본 페이지·인용문과 금액·날짜를 대조한 뒤 선택 적용하세요.');
  return { contractAmount, baseDate, contractDate, warnings: [...new Set([...warnings, ...modelWarnings])].slice(0, 12) };
}

/** Normalize model notation, never fabricate missing evidence or let one bad field discard the rest.
 * The browser still uses the strict validator above on the resulting canonical preview. */
export function normalizeEsContractModelResult(value: unknown): EsContractImportPreview {
  const input = object(value, ['contractAmount', 'baseDate', 'contractDate', 'warnings']);
  if (!Array.isArray(input.warnings) || input.warnings.length > 12) return invalid();
  const warnings: string[] = [];
  const result: EsContractImportPreview = { contractAmount: null, baseDate: null, contractDate: null, warnings: [] };
  const labels = { contractAmount: '총계약금액', baseDate: '입찰 기준일', contractDate: '계약일' };
  for (const field of ['contractAmount', 'baseDate', 'contractDate'] as const) {
    if (input[field] === null) continue;
    try {
      const extra = field === 'contractAmount' ? ['vat', 'basis'] : field === 'contractDate' ? ['basis'] : [];
      const item = evidence(input[field], extra);
      if (field === 'contractAmount' && unitPriceQuote(item.quote)) {
        warnings.push('총계약금액: 원문에 단가 또는 면적을 곱하는 산식이 있어 총액으로 적용하지 않았습니다. 원가계산서의 총공사비나 확정 총계약금액을 확인하세요.');
        continue;
      }
      if (field === 'contractAmount' && /^[1-9]\d{0,2}(?:,\d{3})+$/u.test(item.value)) item.value = item.value.replace(/,/gu, '');
      if (field !== 'contractAmount') {
        const match = /^(\d{4})\s*(?:[-./]|년)\s*(\d{1,2})\s*(?:[-./]|월)\s*(\d{1,2})\s*(?:일|\.)?$/u.exec(item.value);
        if (match) item.value = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
      }
      if ('basis' in item && ['ORIGINAL', 'AMENDED'].includes(String(item.basis))) {
        try { basis(item.basis, item.quote); } catch { item.basis = 'UNSPECIFIED'; }
      }
      if ('vat' in item && ['INCLUDED', 'EXCLUDED'].includes(String(item.vat)) && !vatSupported(item.vat as EsContractVat, item.quote)) item.vat = 'UNSPECIFIED';
      const checked = validateEsContractImport({ contractAmount: null, baseDate: null, contractDate: null, warnings: [], [field]: item });
      Object.assign(result, { [field]: checked[field] });
    } catch {
      warnings.push(`${labels[field]}: 금액·날짜와 원문 인용·페이지 근거가 일치하지 않아 이 항목만 제외했습니다. 원본을 확인해 직접 입력하세요. 다른 확인 가능한 항목은 아래에 표시합니다.`);
    }
  }
  // Keep deterministic exclusion reasons ahead of model prose; never return rejected raw values.
  result.warnings = [...warnings, ...input.warnings.map(item => cleanText(item, 300))].slice(0, 12);
  return validateEsContractImport(result);
}
