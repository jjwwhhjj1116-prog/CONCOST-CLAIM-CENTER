import { useEffect, useRef, useState } from 'react';
import { Button, Dialog } from '@claim-studio/ui';
import { apiDownload, apiRequest } from '../api';
import { createReportEvidenceUploader } from '../evidence/report-evidence-upload';
import { readSpreadsheetExcerpt } from '../proposals/proposal-excel';
import { reportSourceSha256 } from './report-native-source';

interface Evidence { id: string; originalName: string; category: string; mimeType: string; downloadUrl: string; byteSize?: number; sha256?: string; displayName?: string; versionNumber?: number; isLatest?: boolean }
type Excerpt = Awaited<ReturnType<typeof readSpreadsheetExcerpt>>;
const escape = (value: string) => value.replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
export function reportEvidenceHtml(files: Evidence[], issue: string, captions: Record<string, string>, layout: number, locator: string, startNumber = 1, excerpts: Record<string, Excerpt> = {}): string {
  if (![1, 2].includes(layout) || !Number.isSafeInteger(startNumber) || startNumber < 1 || startNumber + files.length > 1_000_000) throw new Error('사진 배치와 첨부 시작번호를 확인해 주세요.');
  const photos = files.filter(file => file.mimeType.startsWith('image/'));
  const documents = files.filter(file => !file.mimeType.startsWith('image/'));
  const chunks = [`<h2>${escape(issue || '첨부자료')}</h2>`];
  if (photos.length) {
    const rows: string[] = [];
    for (let index = 0; index < photos.length; index += layout) {
      const cells = photos.slice(index, index + layout).map((file, offset) => `<td><p><strong>첨부자료 ${startNumber + index + offset}</strong></p><img data-report-photo="true" src="${escape(file.downloadUrl)}" alt="${escape(captions[file.id] || file.originalName)}" width="${layout === 2 ? 260 : 560}" height="${layout === 2 ? 180 : 330}" style="object-fit:contain"><p>${escape(captions[file.id] || file.originalName)}</p></td>`);
      if (cells.length < layout) cells.push('<td><p></p></td>');
      rows.push(`<tr>${cells.join('')}</tr>`);
    }
    chunks.push(`<table style="width:100%;table-layout:fixed"><tbody>${rows.join('')}</tbody></table>`);
  }
  for (const file of documents) {
    const excerpt = excerpts[file.id], reference = excerpt ? `${excerpt.sheetName}!${excerpt.range}` : locator;
    chunks.push(`<p><strong>${escape(file.displayName || file.originalName)}</strong> · <a href="${escape(file.downloadUrl)}">첨부 원본</a>${reference ? ` · ${escape(reference)}` : ''}</p><p>${escape(captions[file.id] || '내용 확인 후 쟁점과의 관련성을 작성하세요.')}</p>`);
    if (excerpt) chunks.push(`<table style="width:100%;table-layout:fixed"><tbody>${excerpt.rows.map(row => `<tr>${row.map(value => `<td><p>${escape(value).replace(/\r\n?|\n/gu, '<br>')}</p></td>`).join('')}</tr>`).join('')}</tbody></table>`);
  }
  return chunks.join('\n');
}

export function ReportEvidenceInsert({ caseId, onClose, onInsert, uploader, disabled = false }: { caseId: string; onClose: () => void; onInsert: (html: string) => boolean; uploader?: ReturnType<typeof createReportEvidenceUploader>; disabled?: boolean }) {
  const [localUploader] = useState(createReportEvidenceUploader);
  const uploads = uploader ?? localUploader;
  const [files, setFiles] = useState<Evidence[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [issue, setIssue] = useState(''), [locator, setLocator] = useState(''), [layout, setLayout] = useState(2), [startNumber, setStartNumber] = useState('1');
  const [captions, setCaptions] = useState<Record<string, string>>({}), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [ranges, setRanges] = useState<Record<string, string>>({}), [sheets, setSheets] = useState<Record<string, string>>({}), [excerpts, setExcerpts] = useState<Record<string, Excerpt>>({});
  const lifetime = useRef<symbol | null>(null), lifetimeSignal = useRef<AbortSignal | undefined>(undefined), inFlight = useRef(false), disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  useEffect(() => { const token = Symbol(), controller = new AbortController(); lifetime.current = token; lifetimeSignal.current = controller.signal; return () => { if (lifetime.current === token) lifetime.current = null; controller.abort(); }; }, [caseId]);
  useEffect(() => {
    const controller = new AbortController(); let active = true; setLoading(true); setError('');
    apiRequest<{ files: Evidence[] }>(`/api/cases/${encodeURIComponent(caseId)}/evidence`, { signal: controller.signal }).then(result => {
      if (!active) return;
      if (!Array.isArray(result.files) || result.files.some(file => !file || typeof file.id !== 'string' || !file.id || typeof file.originalName !== 'string' || typeof file.mimeType !== 'string' || file.downloadUrl !== `/api/cases/evidence/${encodeURIComponent(file.id)}/download`)) throw new Error('자료 목록 응답이 올바르지 않습니다. 목록을 다시 불러와 주세요.');
      setFiles(current => [...new Map([...current, ...result.files].map(file => [file.id, file])).values()]);
    }).catch(reason => { if (active) setError(String(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [caseId, retry]);
  const upload = async (newFiles: File[]) => {
    if (inFlight.current || disabledRef.current || uploads.isBlocked(caseId)) return;
    const token = lifetime.current, isCurrent = () => token !== null && lifetime.current === token && !disabledRef.current;
    inFlight.current = true;
    setBusy(true); setError('');
    try {
      for (const file of newFiles) {
        const category = file.type.startsWith('image/') ? 'SITE_PHOTO' : 'REPORT_REFERENCE';
        const result = await uploads.upload(caseId, file, isCurrent, category, lifetimeSignal.current);
        if (!isCurrent()) return;
        const saved = { ...result, mimeType: result.mimeType || file.type, category: result.category || category }; setFiles(current => [...current.filter(item => item.id !== saved.id), saved]); setSelected(current => [...new Set([...current, saved.id])]);
      }
    } catch (reason) { if (lifetime.current === token) setError(`${String(reason)} · 앞서 저장이 확인된 파일은 자료실에 보관됐으며 본문에는 아직 삽입하지 않았습니다.`); }
    finally { inFlight.current = false; if (lifetime.current === token) setBusy(false); }
  };
  const readExcerpt = async (file: Evidence) => {
    if (inFlight.current || disabledRef.current) return;
    const token = lifetime.current; inFlight.current = true; setBusy(true); setError('');
    try {
      if (!/^[0-9a-f]{64}$/iu.test(file.sha256 ?? '') || !Number.isSafeInteger(file.byteSize) || !file.byteSize || file.byteSize > 15_000_000) throw new Error('원본 파일의 해시·크기를 확인하지 못했습니다. 자료 목록을 다시 불러와 주세요.');
      const { blob } = await apiDownload(file.downloadUrl);
      const bytes = await blob.arrayBuffer();
      if (bytes.byteLength !== file.byteSize || await reportSourceSha256(bytes) !== file.sha256) throw new Error('다운로드한 원본의 해시·크기가 자료실 기록과 다릅니다. 표를 반영하지 않았습니다.');
      const excerpt = await readSpreadsheetExcerpt(new File([bytes], file.originalName), ranges[file.id] ?? '', sheets[file.id] ?? '');
      if (lifetime.current === token && !disabledRef.current) setExcerpts(current => ({ ...current, [file.id]: excerpt }));
    } catch (reason) { if (lifetime.current === token) setError(String(reason)); }
    finally { inFlight.current = false; if (lifetime.current === token) setBusy(false); }
  };
  const locked = busy || disabled, blocked = uploads.isBlocked(caseId);
  const selectedFiles = selected.flatMap(id => files.find(file => file.id === id) ?? []);
  return <Dialog isOpen title="쟁점·사진·산출 근거 넣기" onClose={() => { if (!busy) onClose(); }}>
    <div className="report-evidence-insert">
      <p>현재 커서 위치에 넣습니다. 사진은 선택 순서대로 설명과 함께 배치합니다. XLSX는 시트·셀 범위를 표로 발췌할 수 있습니다. 다른 문서는 원본 링크·근거 위치만 넣으며, 링크만으로 법원 제출본에 원본 내용이 포함되지는 않습니다.</p>
      <label>쟁점·첨부 제목<input disabled={locked} value={issue} onChange={event => setIssue(event.target.value)} placeholder="예: 현장 층고와 계약도면의 차이"/></label>
      <div className="action-row"><label>사진 배치<select disabled={locked} value={layout} onChange={event => setLayout(Number(event.target.value))}><option value={2}>2열 사진대지</option><option value={1}>1열 크게</option></select></label><label>첨부 시작번호<input type="number" min="1" max="999999" disabled={locked} value={startNumber} onChange={event => setStartNumber(event.target.value)}/></label><label>페이지·시트·셀<input disabled={locked} value={locator} onChange={event => setLocator(event.target.value)} placeholder="예: 구조내역 시트 D25:D32"/></label></div>
      <label>PC에서 사진·근거자료 추가<input type="file" multiple disabled={locked || blocked} onChange={event => { void upload([...event.target.files ?? []]); event.target.value = ''; }}/></label>
      {blocked && <p role="alert" className="error-box">저장 결과가 불명확한 자료가 있습니다. 재업로드하지 말고 관리자에게 저장 기록 확인을 요청해 주세요. 이미 확인된 자료는 선택해 넣을 수 있습니다.</p>}
      {error && <p role="alert" className="error-box">{error}</p>}
      <div className="action-row"><span role="status">{busy ? '자료 처리 중…' : loading ? '자료 목록 불러오는 중…' : files.length ? `자료 ${files.length}개 · 선택 ${selected.length}개` : '등록된 자료가 없습니다. PC에서 추가해 주세요.'}</span><Button variant="secondary" disabled={locked || loading} onClick={() => setRetry(value => value + 1)}>자료 목록 다시 불러오기</Button></div>
      <div className="report-evidence-list">{files.map(file => <div key={file.id}><label><input type="checkbox" disabled={locked} checked={selected.includes(file.id)} onChange={event => setSelected(current => event.target.checked ? [...new Set([...current, file.id])] : current.filter(id => id !== file.id))}/>{file.displayName || file.originalName}{file.versionNumber ? ` · v${file.versionNumber} ${file.isLatest === false ? '이전본' : '최신본'}` : ''}</label>{selected.includes(file.id) && <>
        <input disabled={locked} aria-label={`${file.originalName} 설명`} value={captions[file.id] ?? ''} onChange={event => setCaptions(current => ({ ...current, [file.id]: event.target.value }))} placeholder="촬영 위치·확인 내용·쟁점과의 관련성"/>
        {/\.xlsx$/iu.test(file.originalName) && <div className="report-evidence-excerpt"><label>시트 이름<input disabled={locked} value={sheets[file.id] ?? ''} placeholder="비우면 첫 번째 시트" onChange={event => { setSheets(current => ({ ...current, [file.id]: event.target.value })); setExcerpts(current => { const next = { ...current }; delete next[file.id]; return next; }); }}/></label><label>발췌 셀 범위<input disabled={locked} value={ranges[file.id] ?? ''} placeholder="예: A25:D32" onChange={event => { setRanges(current => ({ ...current, [file.id]: event.target.value })); setExcerpts(current => { const next = { ...current }; delete next[file.id]; return next; }); }}/></label><Button variant="secondary" disabled={locked} onClick={() => void readExcerpt(file)}>셀 범위를 표로 발췌</Button><small>15MB 이하·최대 50열/300행. 저장된 셀 값만 읽습니다. 수식 재계산·숫자 표시형식·셀 병합·그림은 복제하지 않습니다. Excel 원본과 대조하세요.</small>{excerpts[file.id] && <div role="status"><p>{excerpts[file.id].sheetName}!{excerpts[file.id].range} · {excerpts[file.id].rows.length}행</p><table><tbody>{excerpts[file.id].rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={columnIndex}>{value}</td>)}</tr>)}</tbody></table></div>}</div>}
      </>}</div>)}</div>
      <Button disabled={locked || !selectedFiles.length} onClick={() => { try { if (onInsert(reportEvidenceHtml(selectedFiles, issue, captions, layout, locator, Number(startNumber), excerpts))) onClose(); else setError('본문 편집기가 준비되지 않았거나 저장·작성 중입니다. 작업이 끝난 뒤 다시 넣어 주세요.'); } catch (reason) { setError(String(reason)); } }}>{busy ? '자료 처리 중…' : '선택 자료를 현재 위치에 넣기'}</Button>
    </div>
  </Dialog>;
}
