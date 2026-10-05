// Presentation metadata travels with the versioned editor JSON, not the body text.
// A metadata-only document has no content: callers must keep the Markdown fallback.
export interface ReportHeader { enabled: boolean; text: string | null }
export interface ReportFrontMatter { enabled: boolean; date: string; author: string; subtitle?: string; tocTitle?: string; tocTitles?: Record<string, string> }
function frontMatterValue(front?: Partial<ReportFrontMatter>): ReportFrontMatter {
  let titleCharacters = 0;
  const titles = front?.tocTitles && typeof front.tocTitles === 'object' && !Array.isArray(front.tocTitles) ? Object.fromEntries(Object.entries(front.tocTitles).filter(([key, value]) => {
    if (key.length > 1200 || typeof value !== 'string') return false;
    titleCharacters += key.length + Math.min(value.length, 1000);
    return titleCharacters <= 100000;
  }).slice(0, 200).map(([key, value]) => [key, value.slice(0, 1000)])) : undefined;
  return { enabled: front?.enabled !== false, date: typeof front?.date === 'string' ? front.date.slice(0, 80) : '', author: typeof front?.author === 'string' ? front.author.slice(0, 200) : '', ...(typeof front?.subtitle === 'string' ? { subtitle: front.subtitle.slice(0, 1000) } : {}), ...(typeof front?.tocTitle === 'string' ? { tocTitle: front.tocTitle.slice(0, 200) } : {}), ...(titles ? { tocTitles: titles } : {}) };
}
type EditorDocument = { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };

export function splitReportPresentation<T extends EditorDocument>(document: T | null | undefined): { body: T | null; header: ReportHeader; frontMatter: ReportFrontMatter } {
  const value = document?.attrs?.reportHeader as Partial<ReportHeader> | undefined;
  const header = { enabled: value?.enabled !== false, text: typeof value?.text === 'string' ? value.text.slice(0, 1000) : null };
  const front = document?.attrs?.reportFrontMatter as Partial<ReportFrontMatter> | undefined;
  const frontMatter = frontMatterValue(front);
  if (!document || !Array.isArray(document.content)) return { body: null, header, frontMatter };
  const { reportHeader: _header, reportFrontMatter: _front, ...attrs } = document.attrs ?? {};
  const body = { ...document };
  if (Object.keys(attrs).length) body.attrs = attrs;
  else delete body.attrs;
  return { body, header, frontMatter };
}

export function joinReportPresentation<T extends EditorDocument>(body: T | null, header: ReportHeader, frontMatter?: ReportFrontMatter) {
  if (header.enabled && header.text === null && !frontMatter) return body;
  return { ...(body ?? { type: 'doc' }), attrs: { ...body?.attrs, reportHeader: { enabled: header.enabled, text: header.text?.slice(0, 1000) ?? null }, ...(frontMatter ? { reportFrontMatter: frontMatterValue(frontMatter) } : {}) } };
}
