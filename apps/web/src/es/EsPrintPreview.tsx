import { useEffect, useRef, useState } from 'react';
import { buildEsSheets, parseEsPages, type EsOutputSheet } from '../../../../packages/document-engine/src/es-output';
import type { EsInput, EsResult } from '../../../../packages/document-engine/src/es-calculation';
import { apiRequest } from '../api';
import { paginateEsTemplate } from './es-template-print';

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function readyWithin<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} 준비가 지연되고 있습니다. 다시 시도하세요.`)), 15000);
    promise.then(value => { window.clearTimeout(timer); resolve(value); }, error => { window.clearTimeout(timer); reject(error); });
  });
}
const PRINT_CSS = `
@page { size:A4 portrait; margin:0; }
* { box-sizing:border-box; }
body { margin:0; background:#e9edf2; font-family:"Malgun Gothic","맑은 고딕",sans-serif; color:#111; }
.es-paper { width:210mm; height:297mm; margin:8mm auto; padding:18mm; background:white; position:relative; break-after:page; overflow:hidden; font-family:"Malgun Gothic","맑은 고딕",sans-serif; color:#111; }
.es-paper:last-child { break-after:auto; }
.es-paper h1 { font-size:17pt; line-height:1.5; margin:0 0 5mm; overflow-wrap:anywhere; }
.es-paper header { margin-bottom:5mm; }
.es-paper header p { margin:0 0 3mm; font-size:9pt; overflow-wrap:anywhere; }
.es-paper table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:9pt; line-height:1.5; }
.es-paper td,.es-paper th { border:1px solid #69717a; padding:2mm 1.5mm; overflow-wrap:anywhere; white-space:pre-wrap; text-align:left; vertical-align:top; }
.es-paper th { background:#e9eef3; font-weight:700; }
.es-paper footer { position:absolute; bottom:8mm; left:18mm; right:18mm; font-size:8pt; text-align:center; border-top:1px solid #aeb7c0; padding-top:2mm; }
.es-paper .es-draft { color:#913900; font-size:9pt; font-weight:700; }
.es-original td { border:0; }
@media screen { body { zoom:var(--es-preview-scale,1); } }
@media print { body { background:white; } .es-paper { margin:0; box-shadow:none; } }
`;
const printDocument = (html: string) => '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><title>ES 산출서 · 검토용 초안</title><style>'+PRINT_CSS+'</style></head><body>'+html+'</body></html>';
function tableHeader(sheet: EsOutputSheet) { return '<thead><tr>' + sheet.columns.map(c => '<th>' + escape(c) + '</th>').join('') + '</tr></thead>'; }
function tableRow(row: string[]) { return '<tr>' + row.map(c => '<td>' + escape(c) + '</td>').join('') + '</tr>'; }
function header(sheet: EsOutputSheet, title: string) { return `<header><p class="es-draft">초안 · LEGACY_REPLAY · 원본 출력배치 대조 미완료</p><h1>${escape(sheet.name)} · ${escape(sheet.title)}</h1><p>${escape(title)}</p></header>`; }
function paginate(sheets: EsOutputSheet[], title: string, measure: HTMLElement): string[] {
  const output: string[] = [];
  for (const sheet of sheets) {
    if (sheet.grid && sheet.values) { output.push(...paginateEsTemplate(sheet.grid, sheet.values, measure)); continue; }
    measure.innerHTML = '<style>' + PRINT_CSS.replace(/body\s*\{/g, '.es-measure {').replace(/\*\s*\{/g, '.es-paper * {') + '</style><section class="es-paper" style="margin:0;height:auto">' + header(sheet, title) + '<table>' + tableHeader(sheet) + '<tbody>' + sheet.rows.map(tableRow).join('') + '</tbody></table></section>';
    const page = measure.querySelector<HTMLElement>('.es-paper')!;
    // A4 body is 261mm; reserve 8mm below the table for the original bundle footer.
    const available = 253 * 96 / 25.4 - page.querySelector('header')!.getBoundingClientRect().height - 5 * 96 / 25.4;
    const headHeight = page.querySelector('thead')!.getBoundingClientRect().height;
    if (headHeight >= available) throw new Error('제목이 너무 길어 출력 공간이 없습니다. 제목을 줄여 주세요.');
    let used = headHeight, chunk: string[] = [];
    const flush = () => { output.push('<section class="es-paper">' + header(sheet, title) + '<table>' + tableHeader(sheet) + '<tbody>' + chunk.join('') + '</tbody></table>__ES_FOOTER__</section>'); chunk = []; used = headHeight; };
    for (const [i, row] of [...page.querySelectorAll('tbody tr')].entries()) {
      const height = row.getBoundingClientRect().height;
      if (height + headHeight > available) throw new Error(`${sheet.name}: 한 행이 A4 한 페이지를 넘습니다. 긴 출처·메모를 줄여 주세요.`);
      if (chunk.length && used + height > available) flush();
      chunk.push(tableRow(sheet.rows[i])); used += height;
    }
    if (chunk.length || !sheet.rows.length) flush();
  }
  return output;
}
export function EsPrintPreview({ documentId, run, selection }: { documentId: string; run: { id: string; revision: number; input: EsInput; result: EsResult }; selection: string[] }) {
  const [pages, setPages] = useState<string[]>([]), [range, setRange] = useState(''), [confirmed, setConfirmed] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(true), [printing, setPrinting] = useState(false);
  const [notice, setNotice] = useState(''), [reload, setReload] = useState(0);
  const measure = useRef<HTMLDivElement>(null), frame = useRef<HTMLIFrameElement | null>(null), preview = useRef<HTMLIFrameElement>(null);
  const printAttempt = useRef(0);
  const key = run.id + ':' + selection.join('|');
  useEffect(() => {
    let active = true; setPages([]); setRange(''); setConfirmed(''); setError(''); setBusy(true);
    const measuringFrame = document.createElement('iframe');
    measuringFrame.title = '인쇄 규격 측정';
    measuringFrame.style.cssText = 'width:210mm;height:297mm;border:0';
    const loaded = new Promise<void>(resolve => { measuringFrame.onload = () => resolve(); });
    measuringFrame.srcdoc = printDocument(''); measure.current?.appendChild(measuringFrame);
    void readyWithin(loaded, '인쇄 레이아웃').then(() => readyWithin(measuringFrame.contentDocument!.fonts.ready, '글꼴')).then(() => {
      if (!active) return;
      // Measure with exactly the print stylesheet, not the application form CSS.
      const generated = paginate(buildEsSheets(run.input, run.result, selection), run.input.title, measuringFrame.contentDocument!.body);
      measuringFrame.remove(); setPages(generated);
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : '미리보기를 만들지 못했습니다.'); }).finally(() => { measuringFrame.remove(); if (active) setBusy(false); });
    return () => { active = false; measuringFrame.remove(); };
  }, [key, reload]);
  useEffect(() => () => { printAttempt.current++; frame.current?.remove(); }, []);
  let selectedPages: number[] = [];
  try { if (pages.length) selectedPages = parseEsPages(range, pages.length); } catch { /* Shown on confirmation; no implicit print fallback. */ }
  const decorate = (html: string, index: number, partial = false) => html.replace('__ES_PAGE_NUMBER__', String(index + 1)).replace('__ES_FOOTER__', `<footer>v${run.revision} · ${index + 1} / ${pages.length}${partial ? ' · 발췌본' : ''} · 검토용 초안</footer>`);
  const fitPreview = () => {
    const iframe = preview.current;
    if (iframe) iframe.contentDocument?.documentElement?.style.setProperty('--es-preview-scale', String(Math.min(1, Math.max(.1,(iframe.clientWidth-24)/(210*96/25.4)))));
  };
  useEffect(() => {
    if (!preview.current) return;
    const observer = new ResizeObserver(fitPreview); observer.observe(preview.current); return () => observer.disconnect();
  }, []);
  const print = async () => {
    if (printing || confirmed !== key + ':' + range || !selectedPages.length) return;
    setPrinting(true); setError(''); setNotice('');
    const attempt = ++printAttempt.current;
    const checkActive = () => { if (attempt !== printAttempt.current) throw new Error('인쇄 준비가 취소되었습니다.'); };
    let outputId = '';
    try {
      const output = await apiRequest<{ output: { id: string } }>(`/api/es/documents/${documentId}/outputs`, { method: 'POST', body: JSON.stringify({ runId: run.id, selection, format: 'PRINT', pageRange: range, pageCount: pages.length }) });
      outputId = output.output.id;
      checkActive();
      const iframe = document.createElement('iframe'); iframe.title = 'ES 인쇄 문서'; iframe.style.cssText = 'position:fixed;left:-12000px;top:0;width:210mm;height:297mm;border:0'; frame.current = iframe;
      const loaded = new Promise<void>((resolve, reject) => { iframe.onload = () => resolve(); iframe.onerror = () => reject(new Error('인쇄 문서를 열지 못했습니다.')); });
      iframe.srcdoc = printDocument(selectedPages.map(n => decorate(pages[n - 1], n - 1, selectedPages.length !== pages.length)).join(''));
      document.body.appendChild(iframe); await readyWithin(loaded, '인쇄 문서'); checkActive();
      const win = iframe.contentWindow; if (!win) throw new Error('인쇄 창이 준비되지 않았습니다.');
      await readyWithin(iframe.contentDocument!.fonts.ready, '인쇄 글꼴'); checkActive();
      await apiRequest(`/api/es/documents/${documentId}/outputs`, { method: 'PATCH', body: JSON.stringify({ outputId, status: 'RENDERED' }) });
      checkActive();
      win.addEventListener('afterprint', () => { if (attempt === printAttempt.current) { setPrinting(false); setNotice('인쇄 대화상자가 닫혔습니다. 실제 인쇄 성공 여부는 프린터에서 확인하세요.'); } iframe.remove(); if (frame.current === iframe) frame.current = null;
        void apiRequest(`/api/es/documents/${documentId}/outputs`, { method: 'PATCH', body: JSON.stringify({ outputId, status: 'DIALOG_CLOSED' }) }).catch(() => setNotice('대화상자는 닫혔지만 종료 이력 기록에 실패했습니다. 실제 인쇄 여부를 확인하세요.'));
      }, { once: true });
      win.focus(); win.print();
      setNotice('브라우저 인쇄 대화상자에서 프린터 또는 PDF 저장을 선택하세요. 취소해도 입력과 선택은 유지됩니다.');
    } catch (e) { if (attempt === printAttempt.current) { setError(e instanceof Error ? e.message : '인쇄 준비 실패'); setPrinting(false); frame.current?.remove(); frame.current = null; }
      if (outputId) void apiRequest(`/api/es/documents/${documentId}/outputs`, { method: 'PATCH', body: JSON.stringify({ outputId, status: 'FAILED' }) }).catch(() => undefined);
    }
  };
  return <section className="es-print-preview"><h2>인쇄 미리보기</h2><p>A4 · 원본 Excel 여백·배율·서식 적용 · 검토용 초안(LEGACY_REPLAY). 화면은 폭에 맞춰 축소되며 인쇄는 A4 규격을 유지합니다.</p><p>인쇄창에서 용지 A4, 배율 100%, 여백 없음, 브라우저 머리글·바닥글 해제를 확인하세요. 시트 선택이 바뀌면 페이지 지정을 다시 확인해야 합니다.</p>
    <div ref={measure} style={{ position: 'absolute', left: '-12000px', top: 0, visibility: 'hidden', width: '210mm' }} aria-hidden="true" />
    {error && <p role="alert" className="es-error">{error}</p>}
    {busy ? <p role="status">글꼴·표 높이를 확인하는 중…</p> : <div className="es-actions"><label className="es-field">페이지 지정 · 총 {pages.length}페이지<input value={range} placeholder="전체: 빈칸 / 지정: 1,3,5-8" onChange={e => { setRange(e.target.value); setConfirmed(''); }} /></label>
      <button disabled={!pages.length} onClick={() => { try { parseEsPages(range, pages.length); setConfirmed(key + ':' + range); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '페이지 확인 필요'); } }}>페이지 확인</button>
      <button className="es-primary" disabled={printing || confirmed !== key + ':' + range || !selectedPages.length} onClick={() => void print()}>프린터 인쇄 / PDF 저장</button>
      <button disabled={printing} onClick={() => setReload(v => v + 1)}>미리보기 다시 생성</button>
    </div>}
    {notice && <p role="status">{notice}</p>}
    {printing && <button onClick={() => { printAttempt.current++; frame.current?.remove(); frame.current = null; setPrinting(false); setNotice('인쇄 준비 상태를 해제했습니다. 문서는 변경되지 않았습니다.'); }}>대화상자 종료 후 상태 해제</button>}
    <iframe ref={preview} className="es-pages" title="ES A4 인쇄 미리보기" style={{ width:'100%', height:'min(750px,75vh)', display:'block' }} onLoad={fitPreview} srcDoc={printDocument(pages.map((html,i) => decorate(html,i)).join(''))} />
  </section>;
}
