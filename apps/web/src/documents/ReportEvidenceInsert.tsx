import { useEffect, useState } from 'react';
import { Button, Dialog } from '@claim-studio/ui';
import { apiRequest } from '../api';
import { fetchEvidenceUpload } from '../evidence/upload-evidence';

interface Evidence { id: string; originalName: string; category: string; mimeType: string; downloadUrl: string }
const escape = (value: string) => value.replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
export function reportEvidenceHtml(files: Evidence[], issue: string, captions: Record<string, string>, layout: number, locator: string): string {
  const photos = files.filter(file => file.mimeType.startsWith('image/'));
  const documents = files.filter(file => !file.mimeType.startsWith('image/'));
  const chunks = [`<h2>${escape(issue || '첨부자료')}</h2>`];
  if (photos.length) {
    const rows: string[] = [];
    for (let index = 0; index < photos.length; index += layout) {
      const cells = photos.slice(index, index + layout).map((file, offset) => `<td><p><strong>첨부자료 ${index + offset + 1}</strong></p><img data-report-photo="true" src="${escape(file.downloadUrl)}" alt="${escape(captions[file.id] || file.originalName)}" width="${layout === 2 ? 260 : 560}" height="${layout === 2 ? 180 : 330}" style="object-fit:contain"><p>${escape(captions[file.id] || file.originalName)}</p></td>`);
      if (cells.length < layout) cells.push('<td><p></p></td>');
      rows.push(`<tr>${cells.join('')}</tr>`);
    }
    chunks.push(`<table style="width:100%;table-layout:fixed"><tbody>${rows.join('')}</tbody></table>`);
  }
  for (const file of documents) chunks.push(`<p><strong>${escape(file.originalName)}</strong> · <a href="${escape(file.downloadUrl)}">첨부 원본</a>${locator ? ` · ${escape(locator)}` : ''}</p><p>${escape(captions[file.id] || '내용 확인 후 쟁점과의 관련성을 작성하세요.')}</p>`);
  return chunks.join('\n');
}

export function ReportEvidenceInsert({ caseId, onClose, onInsert }: { caseId: string; onClose: () => void; onInsert: (html: string) => boolean }) {
  const [files, setFiles] = useState<Evidence[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [issue, setIssue] = useState(''), [locator, setLocator] = useState(''), [layout, setLayout] = useState(2);
  const [captions, setCaptions] = useState<Record<string, string>>({}), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; apiRequest<{ files: Evidence[] }>(`/api/cases/${encodeURIComponent(caseId)}/evidence`).then(result => { if (active) setFiles(current => [...new Map([...result.files, ...current].map(file => [file.id, file])).values()]); }).catch(reason => { if (active) setError(String(reason)); }); return () => { active = false; }; }, [caseId]);
  const upload = async (uploads: File[]) => {
    setBusy(true); setError('');
    try {
      for (const file of uploads) {
        const form = new FormData(); form.set('file', file); form.set('category', file.type.startsWith('image/') ? 'SITE_PHOTO' : 'REPORT_REFERENCE');
        const response = await fetchEvidenceUpload(`/api/cases/${encodeURIComponent(caseId)}/evidence`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: form }, { reuseExact: true });
        const result = await response.json() as { file?: Evidence; error?: string };
        if (!response.ok || !result.file) throw new Error(result.error ?? '첨부 저장 실패');
        const saved = { ...result.file, mimeType: result.file.mimeType || file.type, category: result.file.category || String(form.get('category')) }; setFiles(current => [...current.filter(item => item.id !== saved.id), saved]); setSelected(current => [...new Set([...current, saved.id])]);
      }
    } catch (reason) { setError(`${String(reason)} · 성공한 파일은 자료실에 보관됐으며 본문에는 아직 삽입하지 않았습니다.`); }
    finally { setBusy(false); }
  };
  return <Dialog isOpen title="쟁점·사진·산출 근거 넣기" onClose={() => { if (!busy) onClose(); }}>
    <div className="report-evidence-insert">
      <p>현재 커서 위치에 넣습니다. 사진은 설명과 함께 1열·2열로 배치하고, 산출·내역 문서는 원본 링크와 페이지·셀 근거를 넣습니다. 파일 등록만으로 내용이 검증되지는 않습니다.</p>
      <label>쟁점·첨부 제목<input value={issue} onChange={event => setIssue(event.target.value)} placeholder="예: 현장 층고와 계약도면의 차이"/></label>
      <div className="action-row"><label>사진 배치<select value={layout} onChange={event => setLayout(Number(event.target.value))}><option value={2}>2열 사진대지</option><option value={1}>1열 크게</option></select></label><label>페이지·시트·셀<input value={locator} onChange={event => setLocator(event.target.value)} placeholder="예: 구조내역 시트 D25:D32"/></label></div>
      <label>PC에서 사진·근거자료 추가<input type="file" multiple disabled={busy} onChange={event => { void upload([...event.target.files ?? []]); event.target.value = ''; }}/></label>
      {error && <p role="alert" className="error-box">{error}</p>}
      <div className="report-evidence-list">{files.map(file => <div key={file.id}><label><input type="checkbox" disabled={busy} checked={selected.includes(file.id)} onChange={event => setSelected(current => event.target.checked ? [...current, file.id] : current.filter(id => id !== file.id))}/>{file.originalName}</label>{selected.includes(file.id) && <input aria-label={`${file.originalName} 설명`} value={captions[file.id] ?? ''} onChange={event => setCaptions(current => ({ ...current, [file.id]: event.target.value }))} placeholder="촬영 위치·확인 내용·쟁점과의 관련성"/>}</div>)}</div>
      <Button disabled={busy || !files.some(file => selected.includes(file.id))} onClick={() => { if (onInsert(reportEvidenceHtml(files.filter(file => selected.includes(file.id)), issue, captions, layout, locator))) onClose(); else setError('본문 편집기가 준비되지 않았거나 저장·작성 중입니다. 작업이 끝난 뒤 다시 넣어 주세요.'); }}>{busy ? '자료실에 보관 중…' : '선택 자료를 현재 위치에 넣기'}</Button>
    </div>
  </Dialog>;
}
