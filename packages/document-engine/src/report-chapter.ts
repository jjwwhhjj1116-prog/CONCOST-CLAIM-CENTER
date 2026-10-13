export interface ReportNode { type?: string; text?: string; attrs?: Record<string, any>; content?: ReportNode[] }

const chapterMarker = (node: ReportNode, code: string, edge: string) => node.type === 'aiChapterMarker' && ['AI', 'MANUAL'].some(kind => node.attrs?.marker === `${kind}-CHAPTER:${code}:${edge}`);
const nodeText = (node: ReportNode): string => node.text ?? (node.content ?? []).map(nodeText).join('');
const normalizedTitle = (value: string) => value.replace(/^(?:CH-\d+\s*|\d+[.、)]\s*)/u, '').trim();

/** Explicit markers win. Imported ordinary text can use one unambiguous H2 title. */
export function reportChapterRange(document: ReportNode, code: string, title?: string): { start: number; end: number; marked: boolean } | null {
  if (document.attrs?.reportNativeSource) return null;
  const nodes = document.content ?? [];
  const starts = nodes.flatMap((node, index) => chapterMarker(node, code, 'START') ? [index] : []);
  const ends = nodes.flatMap((node, index) => chapterMarker(node, code, 'END') ? [index] : []);
  if (starts.length || ends.length) {
    if (starts.length !== 1 || ends.length !== 1 || ends[0] <= starts[0] || nodes.slice(starts[0] + 1, ends[0]).some(node => node.type === 'aiChapterMarker')) throw new Error('챕터 구분이 중복되거나 잘못되었습니다. 현재 본문을 보존했습니다.');
    return { start: starts[0], end: ends[0] + 1, marked: true };
  }
  if (!title?.trim()) return null;
  const headings = nodes.flatMap((node, index) => node.type === 'heading' && node.attrs?.level === 2 && normalizedTitle(nodeText(node)) === normalizedTitle(title) ? [index] : []);
  if (headings.length !== 1) return null;
  const start = headings[0];
  const next = nodes.findIndex((node, index) => index > start && ((node.type === 'heading' && Number(node.attrs?.level) <= 2) || node.type === 'aiChapterMarker'));
  return { start, end: next < 0 ? nodes.length : next, marked: false };
}

/** Drafts show the actual heading/body, not internal chapter codes. */
export function extractReportChapter<T extends ReportNode>(document: T, code: string, title?: string): T | null {
  const range = reportChapterRange(document, code, title);
  if (!range) return null;
  return { ...document, attrs: undefined, content: document.content!.slice(range.start + (range.marked ? 1 : 0), range.end - (range.marked ? 1 : 0)) };
}

/** Replace just the requested chapter, retaining all unrelated structured nodes. */
export function mergeGeneratedChapter<T extends ReportNode>(document: T, chapterCode: string, generated: ReportNode, title?: string): T {
  const nodes = document.content ?? [];
  const marker = (node: ReportNode, edge: string) => node.type === 'aiChapterMarker' && ['AI', 'MANUAL'].some(kind => node.attrs?.marker === `${kind}-CHAPTER:${chapterCode}:${edge}`);
  const collectMarkers = (items: ReportNode[]): ReportNode[] => items.flatMap(node => [...(node.type === 'aiChapterMarker' ? [node] : []), ...collectMarkers(node.content ?? [])]);
  const generatedMarkers = collectMarkers(generated.content ?? []);
  if (generatedMarkers.length !== 2 || !marker(generatedMarkers[0], 'START') || !marker(generatedMarkers[1], 'END') || generated.content?.[0] !== generatedMarkers[0] || generated.content?.at(-1) !== generatedMarkers[1]) throw new Error('원고에 잘못된 챕터 구분이 포함돼 반영하지 않았습니다. 다시 확인해 주세요.');
  if (document.attrs?.reportNativeSource) throw new Error('원형 HWP는 전체 원본 편집에서 수정해야 합니다. 챕터 원고를 임의로 덧붙이지 않았습니다.');
  const range = reportChapterRange(document, chapterCode, title);
  if (range) {
    const replacement = [...(generated.content ?? [])];
    // The assignee does not silently rename a heading in the current full report.
    const heading = nodes[range.start + (range.marked ? 1 : 0)];
    if (heading?.type === 'heading' && replacement[1]?.type === 'heading') replacement[1] = heading;
    return { ...document, content: [...nodes.slice(0, range.start), ...replacement, ...nodes.slice(range.end)] };
  }
  const start = nodes.findIndex(node => marker(node, 'START'));
  if (start < 0) {
    if (nodes.some(node => node.type === 'aiChapterMarker' && /WHOLE/u.test(String(node.attrs?.marker)))) throw new Error('가져온 전체 보고서에서 해당 챕터 범위를 확인하지 못했습니다. 본문 제목을 목차와 일치시킨 뒤 다시 반영해 주세요.');
    if (nodes.some(node => marker(node, 'END'))) throw new Error('챕터 시작 표시가 누락됐습니다. 본문 구분을 확인해 주세요.');
    const nextChapter = nodes.findIndex(node => node.type === 'aiChapterMarker' && /^(?:AI|MANUAL)-CHAPTER:CH-\d+:START$/u.test(node.attrs?.marker ?? '') && String(node.attrs?.marker).split(':')[1].localeCompare(chapterCode, undefined, { numeric: true }) > 0);
    const at = nextChapter < 0 ? nodes.length : nextChapter;
    return { ...document, content: [...nodes.slice(0, at), ...(generated.content ?? []), ...nodes.slice(at)] };
  }
  const end = nodes.findIndex((node, index) => index > start && marker(node, 'END'));
  if (end < 0 || nodes.filter(node => marker(node, 'START')).length !== 1 || nodes.filter(node => marker(node, 'END')).length !== 1 || nodes.slice(start + 1, end).some(node => node.type === 'aiChapterMarker')) throw new Error('챕터 구분이 중복되거나 잘못되었습니다. 현재 본문을 보존했습니다. 목차와 본문 구분을 확인해 주세요.');
  return { ...document, content: [...nodes.slice(0, start), ...(generated.content ?? []), ...nodes.slice(end + 1)] };
}
