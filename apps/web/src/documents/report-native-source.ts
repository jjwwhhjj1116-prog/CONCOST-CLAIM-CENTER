import type { Editor, JSONContent } from '@tiptap/core';
import type { NativeHwpEngine } from './editable-hwp-export';

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
  return { caseId: value.caseId, evidenceId: value.evidenceId, name: value.name, downloadUrl: value.downloadUrl, byteSize: value.byteSize, sha256: value.sha256 };
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
/** Tiptap setContent replaces children, not root attributes. Clear stale links on replacement. */
export function syncReportNativeSource(editor: Editor, document: JSONContent | null | undefined): void {
  editor.view.dispatch(editor.state.tr.setDocAttribute('reportNativeSource', document?.attrs?.reportNativeSource ?? null).setMeta('preventUpdate', true));
}
