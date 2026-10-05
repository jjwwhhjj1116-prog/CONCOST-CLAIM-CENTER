import type { JSONContent } from '@tiptap/core';

/** Explicit repair only. Never normalize reviewed prose on load or export. */
export function repairReportAiFormatting(document: JSONContent, parse: (raw: string) => JSONContent) {
  let insideAi = false, repaired = 0, skipped = 0;
  const content = (document.content ?? []).flatMap(node => {
    if (node.type === 'aiChapterMarker') insideAi = /^AI-CHAPTER:.*:START$/u.test(String(node.attrs?.marker ?? ''));
    if (!insideAi || node.type !== 'codeBlock') return [node];
    const raw = (node.content ?? []).map(item => item.text ?? '').join('');
    const language = String(node.attrs?.language ?? '').toLowerCase();
    if (!['markdown', 'md', ''].includes(language) || (!language && !/^#{1,6}\s/mu.test(raw))) return [node];
    // HTML and editor control comments are literal evidence inside a code block.
    // Parsing them as Markdown could hide text or introduce chapter boundaries.
    if (/<(?:!--|\/?[A-Za-z][\w:-]*(?:\s|\/?[>]))|AI-CHAPTER:|MANUAL-(?:CHAPTER|WHOLE-DOCUMENT):|DOCUMENT-(?:PAGE-BREAK|SPACER)/iu.test(raw)) {
      skipped++; return [node];
    }
    const parsed = parse(raw).content;
    if (!parsed?.length) { skipped++; return [node]; }
    repaired++; return parsed;
  });
  return { document: repaired ? { ...document, content } : document, repaired, skipped };
}
