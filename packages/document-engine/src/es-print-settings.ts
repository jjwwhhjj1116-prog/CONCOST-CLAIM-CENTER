/** Presentation only: never changes a calculation, template cell or business warning. */
export interface EsPageBand {
  mode: 'original' | 'custom' | 'hidden';
  text: string;
  align: 'left' | 'center' | 'right';
}
export interface EsPrintSettings { header: EsPageBand; footer: EsPageBand }
export const newEsPrintSettings = (): EsPrintSettings => ({
  header: { mode: 'original', text: '', align: 'left' },
  footer: { mode: 'original', text: '{page} / {pages}', align: 'center' }
});
export function validateEsPrintSettings(value: unknown): EsPrintSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('머리글·바닥글 설정 형식이 올바르지 않습니다.');
  const band = (value: unknown): EsPageBand => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('머리글·바닥글 항목이 없습니다.');
    const b = value as Record<string, unknown>;
    if (typeof b.mode !== 'string' || !['original','custom','hidden'].includes(b.mode) || typeof b.align !== 'string' || !['left','center','right'].includes(b.align) || typeof b.text !== 'string' || b.text.length > 80 || /[\u0000-\u001f\u007f\u2028\u2029\ufffe\uffff]/.test(b.text)) throw new Error('머리글·바닥글은 줄바꿈 없이 80자 이내로 입력하세요.');
    return { mode: b.mode as EsPageBand['mode'], text: b.text, align: b.align as EsPageBand['align'] };
  };
  const v = value as Record<string, unknown>;
  return { header: band(v.header), footer: band(v.footer) };
}
export const esBandText = (text: string, page: number, pages: number) => text.replace(/\{page\}|\{pages\}/g, token => String(token === '{page}' ? page : pages));
/** Escape Excel formatting commands in literal text, then expand only our two tokens. */
export const esBandExcel = (band: EsPageBand) => '&' + ({left:'L',center:'C',right:'R'}[band.align]) + '&"맑은 고딕,Regular"&9 ' + band.text.replace(/&/g, '&&').replace(/\{page\}/g, '&P').replace(/\{pages\}/g, '&N');
export const esPrintMargins = (settings?: EsPrintSettings) => ({ left:12, right:12, top:settings?.header.mode === 'custom' ? 24 : 12, bottom:settings?.footer.mode === 'custom' ? 24 : 16 });
