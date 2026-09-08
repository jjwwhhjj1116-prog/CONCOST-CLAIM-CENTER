/** Exact rational arithmetic; rounding is explicit at the source workbook's checkpoints. */
export class EsDecimal {
  readonly numerator: bigint;
  readonly denominator: bigint;
  constructor(numerator: bigint, denominator = 1n) {
    if (!denominator) throw new Error('0으로 나눌 수 없습니다.');
    const sign = denominator < 0n ? -1n : 1n;
    let a = numerator < 0n ? -numerator : numerator, b = denominator < 0n ? -denominator : denominator;
    while (b) { const rest = a % b; a = b; b = rest; }
    const divisor = a || 1n;
    this.numerator = numerator * sign / divisor; this.denominator = denominator * sign / divisor;
  }
  static parse(value: string): EsDecimal {
    if (!/^[+-]?\d{1,20}(?:\.\d{1,16})?$/.test(value)) throw new Error('숫자는 정수 20자리·소수 16자리 이내로 입력하세요.');
    const negative = value.startsWith('-'), [whole, fraction = ''] = value.replace(/^[+-]/, '').split('.');
    return new EsDecimal(BigInt(whole + fraction) * (negative ? -1n : 1n), 10n ** BigInt(fraction.length));
  }
  add(other: EsDecimal) { return new EsDecimal(this.numerator * other.denominator + other.numerator * this.denominator, this.denominator * other.denominator); }
  sub(other: EsDecimal) { return this.add(new EsDecimal(-other.numerator, other.denominator)); }
  mul(other: EsDecimal) { return new EsDecimal(this.numerator * other.numerator, this.denominator * other.denominator); }
  div(other: EsDecimal) { return new EsDecimal(this.numerator * other.denominator, this.denominator * other.numerator); }
  compare(other: EsDecimal) { const delta = this.numerator * other.denominator - other.numerator * this.denominator; return delta < 0n ? -1 : delta > 0n ? 1 : 0; }
  round(places: number, mode: 'ROUND' | 'ROUNDDOWN' = 'ROUNDDOWN'): EsDecimal {
    if (!Number.isInteger(places) || Math.abs(places) > 20) throw new Error('지원하지 않는 반올림 자릿수입니다.');
    const scale = 10n ** BigInt(Math.abs(places));
    const n = this.numerator * (places >= 0 ? scale : 1n), d = this.denominator * (places < 0 ? scale : 1n);
    let integer = n / d;
    const remainder = n % d;
    if (mode === 'ROUND' && (remainder < 0n ? -remainder : remainder) * 2n >= d) integer += n < 0n ? -1n : 1n;
    return new EsDecimal(integer * (places < 0 ? scale : 1n), places >= 0 ? scale : 1n);
  }
  toString(): string {
    const truncated = this.round(16); const negative = truncated.numerator < 0n;
    const scaled = (negative ? -truncated.numerator : truncated.numerator) * 10n ** 16n / truncated.denominator;
    const digits = scaled.toString().padStart(17, '0');
    const fraction = digits.slice(-16).replace(/0+$/, '');
    return `${negative ? '-' : ''}${digits.slice(0, -16)}${fraction ? '.' + fraction : ''}`;
  }
}
export const esDecimal = (value: string | number) => EsDecimal.parse(String(value));
export const esSum = (values: EsDecimal[]) => values.reduce((sum, value) => sum.add(value), esDecimal('0'));
