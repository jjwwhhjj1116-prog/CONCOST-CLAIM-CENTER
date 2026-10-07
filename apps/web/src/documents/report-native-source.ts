import type { Editor, JSONContent } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import type { NativeHwpDocument, NativeHwpEngine } from './editable-hwp-export';

/** Only reject a clearly broken container before SDK document replacement.
 * Recognize the pinned parser's legacy HWP3 prefix too; not a fidelity proof. */
export function assertReportNativeImportContainer(buffer:ArrayBuffer,name:string):void{
  const bytes=new Uint8Array(buffer),starts=(signature:readonly number[])=>signature.every((value,index)=>bytes[index]===value);
  const hwp=/\.hwp$/iu.test(name),hwpx=/\.hwpx$/iu.test(name);
  const validHwp=(bytes.length>512&&starts([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]))||(bytes.length>=30&&starts([...new TextEncoder().encode('HWP Document File')]));
  if((hwp&&!validHwp)||(hwpx&&!starts([0x50,0x4b,0x03,0x04])))throw new Error('선택한 파일의 한글 문서 형식이나 크기가 올바르지 않습니다. 한글에서 정상 저장한 HWP/HWPX 원본을 다시 선택해 주세요.');
}

/** Check real HWPUNIT dimensions, not only the A-series aspect ratio of a preview. */
export function assertReportNativeA4Portrait(document: NativeHwpDocument): void {
  const sections = document.getSectionCount?.();
  const unknown = '원형 한글의 실제 용지 크기를 확인하지 못했습니다. 기존 보고서와 원본 파일은 유지됩니다.';
  if (!Number.isSafeInteger(sections) || !sections || sections < 1 || !document.getPageDef) throw new Error(unknown);
  for (let section = 0; section < sections; section++) {
    let paper: { width: number; height: number; landscape: boolean };
    try { paper = JSON.parse(document.getPageDef(section)); }
    catch { throw new Error(unknown); }
    // 75 HWPUNIT per 96-DPI pixel; allow the existing one-pixel A4 rounding.
    if (!paper || paper.landscape !== false || !Number.isFinite(paper.width) || !Number.isFinite(paper.height)
      || Math.abs(paper.width - 794 * 75) > 75 || Math.abs(paper.height - 1123 * 75) > 75) {
      throw new Error(`원형 한글 ${section + 1}구역의 실제 용지가 A4 세로가 아니어서 처리를 중단했습니다. 한글에서 용지를 A4 세로(210 × 297mm)로 확인한 뒤 다시 적용하세요. 기존 보고서와 원본 파일은 유지됩니다.`);
    }
  }
}

export function captureReportNativeSource(bytes: Uint8Array, name: string, Engine: NativeHwpEngine): { pages: string[]; file: File } {
  const snapshot = new Engine(bytes);
  try {
    const count = snapshot.pageCount();
    if (!Number.isSafeInteger(count) || count < 1) throw new Error('수정 원본을 다시 열어 확인하지 못했습니다. 기존 보고서는 유지됩니다.');
    const pages = Array.from({ length: count }, (_, page) => snapshot.renderPageSvgWithProfile ? snapshot.renderPageSvgWithProfile(page, 'print') : snapshot.renderPageSvg(page));
    if (pages.some(page => !page.includes('<svg'))) throw new Error('수정 원본의 페이지 생성에 실패했습니다. 기존 보고서는 유지됩니다.');
    const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
    return { pages, file: new File([copy.buffer], name, { type: /\.hwp$/iu.test(name) ? 'application/x-hwp' : 'application/vnd.hancom.hwpx' }) };
  } finally { snapshot.free(); }
}

export interface ReportNativeSource {
  caseId: string; evidenceId: string; name: string; downloadUrl: string; byteSize: number; sha256: string;
  bodySha256?: string;
  bindingVersion?: 1;
  originalSource?: Omit<ReportNativeSource, 'originalSource'>;
  confirmedChapterPages?: ReportNativeChapterPages;
}
export interface ReportNativeChapterPages {
  version: 1; caseId: string; evidenceId: string; sha256: string; byteSize: number; bodySha256: string; pageCount: number;
  entries: Array<{ chapterId: string; page: number }>;
}
/** Only a whole imported page-image document qualifies; ordinary photos are not pages. */
export function reportSourcePageCount(source: JSONContent | null | undefined): number {
  let pages = 0;
  const visit = (node: JSONContent): boolean => {
    if (node.type === 'image') { if (node.attrs?.reportSourcePage !== true) return false; pages++; return true; }
    if (node.type === 'doc' || node.type === 'paragraph') return (node.content ?? []).every(visit);
    if (node.type === 'text') return !node.text?.trim();
    return ['aiChapterMarker', 'documentPageBreak', 'hardBreak'].includes(node.type ?? '');
  };
  return source && visit(source) ? pages : 0;
}
export function reportSourcePageUrls(source: JSONContent | null | undefined): string[] {
  if (!source || !reportSourcePageCount(source)) return [];
  const urls: string[] = [];
  const visit = (node: JSONContent) => { if (node.type === 'image') urls.push(String(node.attrs?.src ?? '')); else node.content?.forEach(visit); };
  visit(source); return urls;
}
export function reportSourceNavigationKey(source: JSONContent | null | undefined, documentKey?: string): string {
  const native = source?.attrs?.reportNativeSource as ReportNativeSource | undefined;
  // Navigation metadata itself must not reset the view or change the editor/Yjs room key.
  return JSON.stringify([documentKey, native?.caseId, native?.evidenceId, native?.name, native?.downloadUrl, native?.byteSize, native?.sha256, native?.bodySha256, source?.content]);
}
function readNativeChapterPages(value: unknown, source: ReportNativeSource, pageCount: number): ReportNativeChapterPages | null {
  if (!value || typeof value !== 'object' || !pageCount || source.bindingVersion !== 1 || !source.bodySha256) return null;
  const map = value as Partial<ReportNativeChapterPages>;
  if (map.version !== 1 || map.caseId !== source.caseId || map.evidenceId !== source.evidenceId || map.sha256 !== source.sha256
    || map.byteSize !== source.byteSize || map.bodySha256 !== source.bodySha256 || map.pageCount !== pageCount || !Array.isArray(map.entries)) return null;
  const ids = new Set<string>();
  const entries: ReportNativeChapterPages['entries'] = [];
  for (const entry of map.entries) {
    if (!entry || typeof entry.chapterId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/u.test(entry.chapterId) || ids.has(entry.chapterId)
      || !Number.isSafeInteger(entry.page) || entry.page < 1 || entry.page > pageCount) return null;
    ids.add(entry.chapterId); entries.push({ chapterId: entry.chapterId, page: entry.page });
  }
  return { version: 1, caseId: source.caseId, evidenceId: source.evidenceId, sha256: source.sha256, byteSize: source.byteSize, bodySha256: source.bodySha256, pageCount, entries };
}
export function assertReportNativePagesMatch(before: string[], after: string[]): void {
  const signature = (svg: string) => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('HWP 페이지 검증에 실패했습니다.');
    // Compare the whole rendered structure, not just text/image counts. Attribute
    // order is immaterial; glyph spacing, positions, fonts and borders are not.
    const structure = (node: Node): unknown => {
      if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      const element = node as Element;
      return [element.namespaceURI, element.localName,
        [...element.attributes].map(attr => [attr.namespaceURI, attr.name, attr.value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        [...element.childNodes].filter(child => child.nodeType === Node.ELEMENT_NODE || Boolean(child.textContent?.trim()) || element.closest('text,tspan,textPath,style')).map(structure)];
    };
    return JSON.stringify(structure(doc.documentElement));
  };
  if (!before.length || before.length !== after.length) throw new Error('HWP 저장 전후 쪽수가 달라 적용하지 않았습니다. 편집 내용은 유지됩니다.');
  before.forEach((page, index) => {
    if (signature(page) !== signature(after[index])) throw new Error(`HWP ${index + 1}쪽의 글자·글꼴·표·사진 배치가 저장 후 달라 적용하지 않았습니다. 편집 내용은 유지됩니다.`);
  });
}
function readSourceReference(value: ReportNativeSource | undefined, caseId: string): ReportNativeSource | null {
  if (!value || value.caseId !== caseId || typeof value.evidenceId !== 'string' || !value.evidenceId || typeof value.name !== 'string' || typeof value.sha256 !== 'string' || value.downloadUrl !== `/api/cases/evidence/${encodeURIComponent(value.evidenceId)}/download`
    || !/\.hwpx?$/iu.test(value.name) || !/^[a-f0-9]{64}$/u.test(value.sha256) || !Number.isSafeInteger(value.byteSize) || value.byteSize <= 0) return null;
  return { caseId: value.caseId, evidenceId: value.evidenceId, name: value.name, downloadUrl: value.downloadUrl, byteSize: value.byteSize, sha256: value.sha256,
    ...(value.bindingVersion === 1 && /^[a-f0-9]{64}$/u.test(value.bodySha256 ?? '') ? { bodySha256: value.bodySha256, bindingVersion: 1 as const } : {}) };
}
export function readReportNativeSource(document: JSONContent | null | undefined, caseId: string): ReportNativeSource | null {
  const value = document?.attrs?.reportNativeSource as ReportNativeSource | undefined;
  const source = readSourceReference(value, caseId);
  if (!source) return null;
  const original = readSourceReference(value?.originalSource, caseId);
  const confirmed = readNativeChapterPages(value?.confirmedChapterPages, source, reportSourcePageCount(document));
  return { ...source, ...(original ? { originalSource: original } : {}), ...(confirmed ? { confirmedChapterPages: confirmed } : {}) };
}
/** Caller must verify the current joined document with readBoundReportNativeSource first. */
export function updateReportNativeChapterPage(document: JSONContent, caseId: string, chapterId: string, page: number | null, chapterIds: readonly string[]): JSONContent {
  const source = readReportNativeSource(document, caseId), pageCount = reportSourcePageCount(document);
  if (!source?.bodySha256 || source.bindingVersion !== 1 || !pageCount || !chapterIds.includes(chapterId) || !/^[A-Za-z0-9_-]{1,100}$/u.test(chapterId)
    || (page !== null && (!Number.isSafeInteger(page) || page < 1 || page > pageCount))) throw new Error('현재 원형·목차 항목·원본 쪽을 확인하지 못했습니다. 기존 연결은 유지됩니다.');
  const entries = (source.confirmedChapterPages?.entries ?? []).filter(entry => entry.chapterId !== chapterId && chapterIds.includes(entry.chapterId));
  if (page !== null) entries.push({ chapterId, page });
  const nextSource = { ...document.attrs!.reportNativeSource } as ReportNativeSource;
  delete nextSource.confirmedChapterPages;
  if (entries.length) nextSource.confirmedChapterPages = { version: 1, caseId, evidenceId: source.evidenceId, sha256: source.sha256, byteSize: source.byteSize, bodySha256: source.bodySha256, pageCount, entries };
  return { ...document, attrs: { ...document.attrs, reportNativeSource: nextSource } };
}
export function reportNativeChapterPage(document: JSONContent | null | undefined, caseId: string, chapterId: string, chapterIds: readonly string[]): number | null {
  if (!chapterIds.includes(chapterId)) return null;
  return readReportNativeSource(document, caseId)?.confirmedChapterPages?.entries.find(entry => entry.chapterId === chapterId)?.page ?? null;
}
export function readReportOriginalSource(document: JSONContent | null | undefined, caseId: string): ReportNativeSource | null {
  const original = readReportNativeSource(document, caseId)?.originalSource;
  return original ? readReportNativeSource({ attrs: { reportNativeSource: original } }, caseId) : null;
}
export async function reportSourceSha256(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}
/** Bind the imported render input, including presentation settings, to its native file.
 * Object key order is immaterial; content/page order and layout values are not. */
export async function reportNativeBodySha256(document: JSONContent | null | undefined): Promise<string> {
  if (!document) throw new Error('원형 본문의 연결 정보를 확인하지 못했습니다.');
  const { reportNativeSource: rawSource, ...attrs } = document.attrs ?? {};
  const source = rawSource as ReportNativeSource | undefined;
  if (source) attrs.reportNativeSource = { caseId: source.caseId, evidenceId: source.evidenceId, name: source.name, downloadUrl: source.downloadUrl, byteSize: source.byteSize, sha256: source.sha256 };
  const body = { ...document, ...(Object.keys(attrs).length ? { attrs } : {}) };
  if (!Object.keys(attrs).length) delete body.attrs;
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)])) : value;
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(body)));
  return reportSourceSha256(bytes.buffer as ArrayBuffer);
}
export async function readBoundReportNativeSource(document: JSONContent | null, caseId: string): Promise<ReportNativeSource> {
  const source = readReportNativeSource(document, caseId);
  if (!source || !document || !source.bodySha256 || source.bodySha256 !== await reportNativeBodySha256(document)) {
    throw new Error('보고서 본문과 원형 HWP의 연결 검증이 일치하지 않습니다. 변경한 원형을 다시 적용하고 저장한 뒤 출력하세요. 제출·납품용은 별도 검토·확정이 필요합니다. 기존 파일은 유지됩니다.');
  }
  return source;
}
/** Tiptap setContent replaces children, not root attributes. Clear stale links on replacement. */
export function syncReportNativeSource(editor: Editor, document: JSONContent | null | undefined, content?: JSONContent | string, emitUpdate = true): void {
  const source = document?.attrs?.reportNativeSource ?? null;
  if (content === undefined) {
    editor.view.dispatch(editor.state.tr.setDocAttribute('reportNativeSource', source).setMeta('preventUpdate', true).setMeta('addToHistory', false));
    return;
  }
  // Keep the replacement body and its source reference in one undo event.
  // Neither the preceding manuscript nor the next edit may merge into it.
  editor.chain().command(({ tr }) => { closeHistory(tr); tr.setDocAttribute('reportNativeSource', source); return true; })
    .setContent(content, { emitUpdate }).run();
  editor.view.dispatch(closeHistory(editor.state.tr));
}
