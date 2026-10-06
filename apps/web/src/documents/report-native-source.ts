import type { Editor, JSONContent } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import type { NativeHwpDocument, NativeHwpEngine } from './editable-hwp-export';

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
  return original ? { ...source, originalSource: original } : source;
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
    editor.view.dispatch(editor.state.tr.setDocAttribute('reportNativeSource', source).setMeta('preventUpdate', true));
    return;
  }
  // Keep the replacement body and its source reference in one undo event.
  // Neither the preceding manuscript nor the next edit may merge into it.
  editor.chain().command(({ tr }) => { closeHistory(tr); tr.setDocAttribute('reportNativeSource', source); return true; })
    .setContent(content, { emitUpdate }).run();
  editor.view.dispatch(closeHistory(editor.state.tr));
}
