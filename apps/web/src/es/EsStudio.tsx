import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest, triggerBrowserDownload } from '../api';
import { registerNavigationBlocker } from '../navigation-guard';
import { ES_COSTS, ES_RATE_KEYS, ES_CONTRACT_FIELDS, newEsContract, calculateEs, newEsInput, type EsInput, type EsResult } from '../../../../packages/document-engine/src/es-calculation';
import { ES_SHEETS } from '../../../../packages/document-engine/src/es-output';
import { exportEsReport, exportEsWorking, importEsWorkbook, type EsImportPreview } from './es-xlsx';
import { EsPrintPreview } from './EsPrintPreview';
import './EsStudio.css';

interface EsDocument { id: string; title: string; revision: number; caseId: string | null; updatedAt: string }
interface EsSaved { document: EsDocument; input: EsInput; inputHash: string; run?: EsRun | null }
interface EsRun { id: string; revision: number; inputHash: string; input: EsInput; result: EsResult }
interface Project { id: string; caseNumber: string; title: string }
const message = (error: unknown) => error instanceof Error ? error.message : '요청을 완료하지 못했습니다.';
const signature = (input: EsInput, caseId: string) => JSON.stringify({ input, caseId });
const RATE_LABELS = ['산재', '산업안전', '고용', '퇴직공제', '건강', '연금', '장기요양'];
const download = (bytes: Uint8Array, filename: string) => triggerBrowserDownload({ blob: new Blob([new Uint8Array(bytes).buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename });

/** Existing Claim Center visual language. Dense input ledger → saved revision → immutable draft output.
 * No customer fixtures, new identity, case creation or automatic approval is introduced here.
 */
export function EsStudio({ mode, search, onNavigate }: { mode: 'list' | 'editor'; search: string; onNavigate: (path: string) => void }) {
  const id = new URLSearchParams(search).get('documentId');
  const [input, setInput] = useState(newEsInput), [document, setDocument] = useState<EsDocument | null>(null);
  const [caseId, setCaseId] = useState(''), [projects, setProjects] = useState<Project[]>([]);
  const [documents, setDocuments] = useState<EsDocument[]>([]), [query, setQuery] = useState('');
  const [loading, setLoading] = useState(mode === 'list' || Boolean(id)), [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false), pending = useRef(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [savedSignature, setSavedSignature] = useState(() => signature(newEsInput(), ''));
  const [tab, setTab] = useState<'input' | 'costs' | 'sources' | 'deductions' | 'result' | 'output'>('input');
  const [importPreview, setImportPreview] = useState<EsImportPreview | null>(null);
  const [importOpen, setImportOpen] = useState(false), [importName, setImportName] = useState(''), [importError, setImportError] = useState('');
  const importDialog = useRef<HTMLDialogElement>(null), importPicker = useRef<HTMLInputElement>(null), importButton = useRef<HTMLButtonElement>(null), editorScroll = useRef<HTMLDivElement>(null);
  const importOpenRef = useRef(importOpen); importOpenRef.current = importOpen;
  const [run, setRun] = useState<EsRun | null>(null);
  const [selection, setSelection] = useState<string[]>(ES_SHEETS.map(s => s[0]));
  const currentSignature = signature(input, caseId), dirty = currentSignature !== savedSignature;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const result = useMemo(() => calculateEs(input), [input]);
  const history = useRef<EsInput[]>([]), future = useRef<EsInput[]>([]), modal = useRef<HTMLElement>(null);
  const mutate = (update: (next: EsInput) => void) => { const next = structuredClone(input); update(next); history.current = [...history.current.slice(-49), input]; future.current = []; setInput(next); };
  const undo = () => { const previous = history.current.pop(); if (previous) { future.current.push(input); setInput(previous); } };
  const redo = () => { const next = future.current.pop(); if (next) { history.current.push(input); setInput(next); } };
  useEffect(() => {
    if (mode !== 'editor') return;
    const root = window.document.getElementById('root'), previousInert = root?.inert ?? false, overflow = window.document.body.style.overflow;
    if (root) root.inert = true; window.document.body.style.overflow = 'hidden';
    modal.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (importDialog.current?.open) return; // Native dialog owns focus and Escape while the editor is inert.
      if (event.key === 'Escape') { event.preventDefault(); onNavigate('/es'); }
      if (event.key === 'Tab' && modal.current) {
        const focusable = [...modal.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(e => e.getClientRects().length);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (window.document.activeElement === first || window.document.activeElement === modal.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.document.addEventListener('keydown', keydown);
    return () => { if (root) root.inert = previousInert; window.document.body.style.overflow = overflow; window.document.removeEventListener('keydown', keydown); };
  }, [mode, onNavigate]);
  useEffect(() => {
    if (!importOpen) return;
    const dialog = importDialog.current;
    dialog?.showModal();
    return () => { dialog?.close(); importButton.current?.focus(); };
  }, [importOpen]);
  useEffect(() => {
    let active = true;
    if (mode === 'list') {
      void apiRequest<{ documents: EsDocument[] }>('/api/es/documents').then(payload => { if (active) setDocuments(payload.documents); }).catch(e => { if (active) { setError(message(e)); setLoadFailed(true); } }).finally(() => { if (active) setLoading(false); });
    } else {
      void apiRequest<{ cases: Project[] }>('/api/cases?limit=100&assignedOnly=true').then(payload => { if (active) setProjects(payload.cases); }).catch(() => { if (active) setNotice('프로젝트 목록을 불러오지 못했습니다. 연결 없이 작성할 수 있습니다.'); });
      if (id) void apiRequest<EsSaved>(`/api/es/documents/${encodeURIComponent(id)}`).then(payload => {
        if (!active) return; setDocument(payload.document); setInput(payload.input); setCaseId(payload.document.caseId ?? ''); setSavedSignature(signature(payload.input, payload.document.caseId ?? '')); setRun(payload.run ?? null);
      }).catch(e => { if (active) { setError(message(e)); setLoadFailed(true); } }).finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, [id, mode]);
  useEffect(() => {
    if (mode !== 'editor') return;
    const unregister = registerNavigationBlocker(navigation => {
      if (!dirtyRef.current && !pending.current && !importOpenRef.current) return false;
      if (!pending.current && window.confirm('아직 저장하지 않은 ES 입력이 있습니다. 변경 내용을 버리고 이동할까요?')) { dirtyRef.current = false; navigation.proceed(); }
      return true;
    });
    const before = (event: BeforeUnloadEvent) => { if (dirtyRef.current || pending.current || importOpenRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', before);
    return () => { unregister(); window.removeEventListener('beforeunload', before); };
  }, [mode]);
  const save = async (calculate = false, imported?: EsInput) => {
    if (pending.current || loading || loadFailed) return;
    pending.current = true; setBusy(true); setError(''); setNotice(''); setImportError('');
    try {
      const snapshot = structuredClone(imported ?? input), linked = caseId;
      const saved = await apiRequest<EsSaved>(`/api/es/documents${document ? '/' + document.id : ''}`, { method: document ? 'PUT' : 'POST', body: JSON.stringify({ input: snapshot, caseId: linked || null, ...(document ? { expectedRevision: document.revision } : {}) }) });
      setDocument(saved.document); setSavedSignature(signature(imported ? saved.input : snapshot, saved.document.caseId ?? '')); dirtyRef.current = false;
      if (imported) {
        history.current = [...history.current.slice(-49), input]; future.current = [];
        setInput(saved.input); setCaseId(saved.document.caseId ?? ''); setRun(null);
        setImportPreview(null); setImportOpen(false); setTab('input'); editorScroll.current?.scrollTo({ top: 0 });
      }
      if (!document) window.history.replaceState(null, '', `/es/editor?documentId=${encodeURIComponent(saved.document.id)}`);
      setNotice(`${imported ? 'Excel 가져오기 완료 · ' : ''}v${saved.document.revision} 저장 완료`);
      if (calculate) {
        const payload = await apiRequest<{ run: EsRun }>(`/api/es/documents/${saved.document.id}/runs`, { method: 'POST', body: JSON.stringify({ expectedRevision: saved.document.revision }) });
        setRun(payload.run); setTab('result');
      }
    } catch (e) { if (imported) setImportError(message(e)); else setError(message(e)); } finally { pending.current = false; setBusy(false); }
  };
  const importFile = async (file?: File) => {
    if (!file || pending.current || loading || loadFailed) return;
    pending.current = true; setBusy(true); setError(''); setImportError(''); setImportPreview(null); setImportName(file.name); setImportOpen(true);
    try {
      if (!/\.xlsx$/i.test(file.name)) throw new Error('.xlsx 파일을 선택하세요.');
      if (file.size > 25_000_000) throw new Error('25MB 이하의 파일만 지원합니다.');
      setImportPreview(await importEsWorkbook(new Uint8Array(await file.arrayBuffer())));
    } catch (e) { setImportError(message(e)); } finally { pending.current = false; setBusy(false); }
  };
  const workingExport = async () => { try { download(await exportEsWorking(input), 'ES_작업용.xlsx'); } catch (e) { setError(message(e)); } };
  const reportExport = async (all: boolean) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); let outputId = '';
    try {
      if (!run || dirty || !document || run.revision !== document.revision) throw new Error('저장·계산을 먼저 실행하세요.');
      const selected = all ? ES_SHEETS.map(s => s[0]) : selection;
      const payload = await apiRequest<{ output: { id: string } }>(`/api/es/documents/${document.id}/outputs`, { method: 'POST', body: JSON.stringify({ runId: run.id, selection: selected, format: 'REPORT_XLSX' }) }); outputId = payload.output.id;
      const bytes = exportEsReport(run.input, run.result, selected);
      await apiRequest(`/api/es/documents/${document.id}/outputs`, { method: 'PATCH', body: JSON.stringify({ outputId, status: 'RENDERED' }) });
      download(bytes, all ? 'ES_전체_초안.xlsx' : 'ES_선택_초안.xlsx');
    } catch (e) {
      setError(message(e));
      if (outputId && document) void apiRequest(`/api/es/documents/${document.id}/outputs`, { method: 'PATCH', body: JSON.stringify({ outputId, status: 'FAILED' }) }).catch(() => undefined);
    } finally { pending.current = false; setBusy(false); }
  };
  const field = (label: string, value: string, change: (value: string) => void, type = 'text', requirement: '' | '저장 필수' | '계산 필수' = '') => <label className="es-field"><span>{label}{requirement && <small className="es-field-requirement">{requirement}</small>}</span><input type={type} aria-required={requirement ? true : undefined} value={value} onChange={e => change(e.target.value)} /></label>;
  const contractFields = (keys: readonly (typeof ES_CONTRACT_FIELDS[number][0])[]) => keys.map(key => {
    const [, label, type] = ES_CONTRACT_FIELDS.find(([fieldKey]) => fieldKey === key)!;
    return <div key={key}>{field(label, input.contract?.[key] ?? '', v => mutate(n => { n.contract ??= newEsContract(); n.contract[key] = v; }), type === 'date' ? 'date' : 'text')}</div>;
  });
  if (mode === 'list') return <section className="es-studio"><header className="es-heading"><div><h1>ES 산출프로그램</h1><p>사건 등록 없이 산출서를 만들고, 필요할 때 프로젝트와 연결하세요.</p></div><button className="es-primary" onClick={() => onNavigate('/es/editor')}>＋ 새 산출서</button></header>
    <p className="es-access">작성자·관리자만 접근 · API 키 없이 수동 입력·Excel 가져오기</p>
    {error && <p role="alert" className="es-error">{error}</p>}
    <label className="es-field">산출서 검색<input value={query} onChange={e => setQuery(e.target.value)} placeholder="산출서 제목" /></label>
    {loading ? <p role="status">산출서를 불러오는 중입니다.</p> : <div className="es-table-wrap"><table><thead><tr><th>산출서</th><th>프로젝트</th><th>버전</th><th>최근 저장</th><th>작업</th></tr></thead><tbody>{documents.filter(d => d.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(d => <tr key={d.id}><td>{d.title}</td><td>{d.caseId ? '연결됨' : '독립 산출서'}</td><td>v{d.revision}</td><td>{new Date(d.updatedAt).toLocaleString('ko-KR')}</td><td><button onClick={() => onNavigate('/es/editor?documentId=' + encodeURIComponent(d.id))}>열기</button></td></tr>)}</tbody></table>{!documents.length && !loadFailed && <p className="es-empty">저장한 산출서가 없습니다. 새 산출서에서 시작하세요.</p>}</div>}</section>;
  return createPortal(<div className="es-modal-backdrop"><section ref={modal} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="es-editor-title" className="es-studio es-editor-workspace">
    <header className="es-heading"><div><h1 id="es-editor-title">ES 산출서 작성</h1><p>{input.title} · 초회 산출 · {caseId ? '프로젝트 연결' : '독립 산출서'}</p></div><button onClick={() => onNavigate('/es')} aria-label="작업창 닫기 · 산출서 목록">닫기 · 산출서 목록</button></header>
    <div className="es-toolbar"><span role="status">{busy ? '처리 중…' : dirty ? '저장하지 않은 변경' : document ? `저장됨 · v${document.revision}` : '새 산출서'}</span><button disabled={busy || !history.current.length} onClick={undo}>입력 취소</button><button disabled={busy || !future.current.length} onClick={redo}>재실행</button><button ref={importButton} disabled={busy || loading || loadFailed} onClick={() => importPicker.current?.click()}>Excel 가져오기</button><button disabled={busy} onClick={() => { setTab('output'); editorScroll.current?.scrollTo({ top: 0 }); }}>Excel 내보내기</button><button disabled={busy || loading || loadFailed} onClick={() => void save()}>저장</button><button className="es-primary" disabled={busy || loading || loadFailed} onClick={() => void save(true)}>저장·계산</button></div>
    <input ref={importPicker} hidden type="file" accept=".xlsx" aria-label="가져올 Excel 파일" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void importFile(file); }} />
    <div ref={editorScroll} className="es-editor-scroll">
    {error && <p className="es-error" role="alert">{error} {document && <button onClick={() => { if (window.confirm('현재 입력을 버리고 저장본을 다시 불러올까요?')) window.location.reload(); }}>저장본 다시 확인</button>}</p>}
    {notice && <p role="status" className="es-notice">{notice}</p>}
    {loading ? <p role="status">저장본을 불러오는 중입니다.</p> : loadFailed ? <p>원본을 불러오지 못해 덮어쓰기를 차단했습니다.</p> : <>
      <p className="es-warning">검수 중인 원본 호환 계산입니다. 신규비목·후속 차수·복수 선금은 미지원이며 공식 제출용으로 승인되지 않았습니다. 미확인 근거는 출력에 —로 표시합니다.</p>
      <nav className="es-tabs" aria-label="ES 작업 영역">{([['input', '기본입력'], ['costs', '비목·적용대가'], ['sources', '지수·요율'], ['deductions', '선금·공제'], ['result', '계산검토'], ['output', '출력물']] as const).map(([key, label]) => <button aria-current={tab === key ? 'page' : undefined} key={key} onClick={() => setTab(key)}>{label}</button>)}</nav>
      <fieldset disabled={busy} className="es-workspace">
      {tab === 'input' && <div className="es-basic-input">
        <p className="es-input-guide">기본입력의 연한 노란색은 필수 항목입니다. 제목은 저장에, 기준일·조정일·계약금액은 계산에 필요합니다. 나머지는 해당되는 계약·출력 정보를 선택 입력하세요.</p>
        <section aria-labelledby="es-project-heading"><h2 id="es-project-heading">1. 공사정보</h2><div className="es-basic-grid es-basic-grid--wide">
          {field('산출서 제목', input.title, v => mutate(n => { n.title = v; }), 'text', '저장 필수')}
          <label className="es-field">프로젝트 연결 (선택)<select value={caseId} onChange={e => setCaseId(e.target.value)} aria-describedby="es-project-help"><option value="">연결 없이 독립 산출서</option>{caseId && !projects.some(p => p.id === caseId) && <option value={caseId}>현재 연결 프로젝트 (목록 확인 필요)</option>}{projects.map(p => <option key={p.id} value={p.id}>{p.caseNumber} · {p.title}</option>)}</select></label>
          {field('발주자', input.client, v => mutate(n => { n.client = v; }))}{field('시공자', input.contractor, v => mutate(n => { n.contractor = v; }))}
        </div><p id="es-project-help" className="es-field-help">프로젝트 연결은 선택 사항입니다. 목록에서 선택한 뒤 저장하면 연결됩니다. 연결만으로 계약정보가 자동 입력되지는 않으며, 기존 입력은 유지됩니다.</p></section>
        <section aria-labelledby="es-dates-heading"><h2 id="es-dates-heading">2. 산출기준일</h2><div className="es-basic-grid">
          {field('입찰 기준일 (초회)', input.baseDate, v => mutate(n => { n.baseDate = v; }), 'date', '계산 필수')}{field('조정기준일', input.adjustmentDate, v => mutate(n => { n.adjustmentDate = v; }), 'date', '계산 필수')}
          {contractFields(['priorAdjustmentDate', 'reportDate'])}
        </div></section>
        <section aria-labelledby="es-contract-heading"><h2 id="es-contract-heading">3. 전체계약 · 공사기간</h2><div className="es-basic-grid">
          {field('계약금액 (원) · 비목 원가 합계와 구분', input.contractAmount, v => mutate(n => { n.contractAmount = v; }), 'text', '계산 필수')}
          {contractFields(['contractDate', 'startDate', 'endDate', 'firstContractDate', 'contractKind', 'bidRate', 'vatMode'])}
        </div></section>
        <section aria-labelledby="es-current-heading"><h2 id="es-current-heading">4. 금차계약 · 공사기간</h2><div className="es-basic-grid">
          {contractFields(['currentContractAmount', 'currentContractDate', 'currentStartDate', 'currentEndDate'])}
        </div></section>
        <section aria-labelledby="es-conditions-heading"><h2 id="es-conditions-heading">5. 적용조건 · 공정</h2><div className="es-basic-grid">
          {contractFields(['legalSystem', 'employmentGrade', 'retirementTrade', 'advanceDate', 'plannedProgress', 'actualProgress', 'technicalDepartment', 'technicalManager'])}
        </div></section>
        <p className="es-field-help">계수·등락비·조정금액은 입력한 자료로 자동 계산됩니다. 기본입력만으로 비목 금액·지수·요율이 채워지지는 않습니다. 해당 탭에서 입력하거나 Excel로 가져오세요. 자동조회 API는 현재 미연결입니다.</p>
      </div>}
      {tab === 'costs' && <><div className="es-section-title"><h2>비목 금액</h2><span>빈 값은 미입력, 0은 금액 없음 · 한 열의 금액을 여러 행에 붙여넣을 수 있습니다.</span></div>
      <div className="es-cost-grid">{ES_COSTS.map(([r, code, label], index) => <label className="es-cost" key={r}><span><b>{code}</b>{label}<small>원본 3!B{r}</small></span><input aria-label={label + ' 금액'} inputMode="decimal" value={input.costs[r]} onChange={e => mutate(n => { n.costs[r] = e.target.value; })} onPaste={e => {
        const text = e.clipboardData.getData('text'); if (!/[\n\t]/.test(text)) return; e.preventDefault();
        const values = text.trim().split(/\r?\n/).map(v => v.trim().replace(/,/g, ''));
        if (values.some(v => !/^\d+(\.\d+)?$/.test(v)) || values.length > ES_COSTS.length - index) { setError('금액 한 열만 선택해 붙여넣으세요. 남은 비목 행 수를 넘을 수 없습니다.'); return; }
        mutate(n => values.forEach((v, i) => { n.costs[ES_COSTS[index + i][0]] = v; }));
      }} /></label>)}</div></>}
      {tab === 'deductions' && <><h2>기성·직접지급·선금 공제</h2><div className="es-grid">{([['paidWorkExclusion', '기성 제외액'], ['alreadyExcludedDirect', '이미 기성에 포함한 직접지급액'], ['advanceContract', '선금 대상 계약금액'], ['advancePaid', '선금 지급액'], ['priorCompletion', '선금 대상 이전 기성액'], ['otherDeduction', '기타 공제액']] as const).map(([k, label]) => <div key={k}>{field(label, input[k], v => mutate(n => { n[k] = v; }))}</div>)}
      <label className="es-field">월별 직접지급액 (한 줄에 한 금액)<textarea value={input.directPaid.join('\n')} onChange={e => mutate(n => { n.directPaid = e.target.value === '' ? [] : e.target.value.split('\n'); })} /></label></div></>}
      {tab === 'sources' && <><p className="es-access">자동조회 API: 미연결 · 아래 원자료를 수동 입력하거나 원본 Excel에서 가져올 수 있습니다. 날짜 변경 후 각 자료의 적용일을 다시 확인하세요.</p>
        <div className="es-periods">{([['base', '기준일'], ['current', '현재일'], ['previous', '직전일']] as const).map(([key, label]) => { const p = key === 'base' ? input.base : input[key].period; const edit = (f: (p: EsInput['base']) => void) => mutate(n => f(key === 'base' ? n.base : n[key].period)); return <section key={key}><h2>{label} 원자료</h2>{field('원자료 적용일', p.date, v => edit(p => { p.date = v; }), 'date')}{field('노임 원자료', p.wage, v => edit(p => { p.wage = v; }))}
        {['광산품', '공산품', '전력·수도·가스·폐기물', '농림수산품'].map((label, i) => <div key={label}>{field(label, p.materials[i], v => edit(p => { p.materials[i] = v; }))}</div>)}
        {ES_RATE_KEYS.map((k, i) => <div key={k}>{field(RATE_LABELS[i] + ' 요율 (%)', p.rates[k], v => edit(p => { p.rates[k] = v; }))}</div>)}
        {field('출처·자료월·확인 메모', p.source, v => edit(p => { p.source = v; }))}</section>; })}</div>
        {(['current', 'previous'] as const).map(key => <section key={key}><h2>{key === 'current' ? '현재일' : '직전일'} 기계·표준시장단가 기간쌍</h2><p>공통품목의 정수 평균을 입력합니다. 발표 지수 결과를 평균 칸에 입력하지 마세요.</p><div className="es-table-wrap"><table><thead><tr><th>분야</th><th>기준 평균</th><th>비교 평균</th><th>공통품목 수</th><th>출처</th></tr></thead><tbody>{[input[key].machinery, ...input[key].standards].map((pair, i) => <tr key={i}><th>{pair.label}</th>{(['baseAverage', 'comparisonAverage', 'commonCount', 'source'] as const).map(k => <td key={k}><input aria-label={`${key} ${pair.label} ${k}`} value={pair[k]} onChange={e => mutate(n => { const p = i === 0 ? n[key].machinery : n[key].standards[i - 1]; p[k] = e.target.value; })} /></td>)}</tr>)}</tbody></table></div></section>)}
      </>}
      {tab === 'result' && <><h2>현재 입력 계산 검토</h2>{result.fatal.map(text => <p role="alert" className="es-error" key={text}>{text}</p>)}{result.warnings.map(text => <p className="es-warning" key={text}>{text}</p>)}
        {result.current && <><div className="es-result-strip"><span>현재 K <strong>{result.current.k}</strong></span><span>직전일 K <strong>{result.previous?.k ?? '계산 불가'}</strong></span><span>순조정금액 <strong>{result.amount?.net ?? '계산 불가'} 원</strong></span></div><div className="es-table-wrap"><table><thead><tr>{['비목', '금액', '계수', '기준지수', '비교지수', '등락비', '조정계수'].map(t => <th key={t}>{t}</th>)}</tr></thead><tbody>{result.current.rows.map(r => <tr key={r.row}><th>{r.code} · {r.label}</th>{[r.amount, r.weight, r.base, r.comparison, r.ratio, r.adjusted].map((v, i) => <td key={i}>{v}</td>)}</tr>)}</tbody></table></div></>}
      </>}
      {tab === 'output' && <><div className="es-section-title"><h2>Excel 내보내기</h2><button onClick={() => void workingExport()}>작업용 Excel 내보내기</button></div><p>작업용 파일은 입력·원자료·계산 수식과 17개 출력 시트를 포함합니다. 입력을 바꾸면 ES_계산 시트의 연결 수식이 계산됩니다. 17개 출력 시트는 내보낸 시점의 값이므로, Excel 수정 후 웹으로 다시 가져와 재계산·출력하세요. Excel 자체 재계산 및 실프린터 대조는 아직 미검수입니다.</p>
        <div className="es-section-title"><h2>출력 시트 선택</h2><button onClick={() => setSelection(ES_SHEETS.map(s => s[0]))}>전체 선택</button><button onClick={() => setSelection([])}>선택 해제</button></div>
        <div className="es-sheet-selection">{ES_SHEETS.map(([id, name, , label]) => <label key={id}><input type="checkbox" checked={selection.includes(id)} onChange={e => setSelection(s => e.target.checked ? [...s, id] : s.filter(v => v !== id))} /><b>{name}</b><span>{label}</span></label>)}</div>
        <p>제출 형식 Excel은 값 고정·인쇄영역만 내보냅니다. 페이지 지정은 인쇄에만 적용되며 Excel은 선택 시트 전체를 내보냅니다. 현재 출력은 검수용 초안입니다.</p>
        {!selection.length && <p className="es-warning">선택한 시트가 없습니다. 출력할 시트를 선택하세요.</p>}
        <div className="es-actions"><button disabled={!run || dirty || !selection.length || run.revision !== document?.revision} onClick={() => reportExport(true)}>전체 17시트 Excel</button><button disabled={!run || dirty || !selection.length || run.revision !== document?.revision} onClick={() => reportExport(false)}>선택 시트 Excel</button></div>
        {run && !dirty && run.revision === document?.revision ? <EsPrintPreview documentId={document.id} run={run} selection={selection} /> : <p className="es-empty">현재 입력을 저장·계산한 뒤 미리보기와 출력이 열립니다.</p>}
      </>}
      </fieldset>
    </>}
    </div><footer className="es-summary-footer"><span>현재 K <b>{result.current?.k ?? '—'}</b></span><span>직전일 K <b>{result.previous?.k ?? '—'}</b></span><span>적용대가 <b>{result.amount?.applicable ?? '—'}</b></span><span>선금 공제 <b>{result.amount?.advance ?? '—'}</b></span><span>최종 조정금액 <b>{result.status === 'INCOMPLETE' ? '계산 대기' : (result.amount?.net ?? '—')} 원</b></span></footer>
    {importOpen && <dialog ref={importDialog} className="es-import-dialog" aria-labelledby="es-import-title" aria-describedby="es-import-description" onCancel={e => { e.preventDefault(); if (!pending.current) { setImportOpen(false); setImportPreview(null); } }} onKeyDown={e => {
      if (e.key !== 'Tab') return;
      const focusable = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),summary')].filter(el => el.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!first) e.preventDefault();
      else if (e.shiftKey && (window.document.activeElement === first || window.document.activeElement === e.currentTarget)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && window.document.activeElement === last) { e.preventDefault(); first.focus(); }
    }}>
      <header><h2 id="es-import-title">가져오기 내용 확인</h2><p className="es-import-filename">{importName}</p></header>
      <div className="es-import-body">
        <p id="es-import-description">아래 내용으로 현재 산출서 입력을 교체해 저장할까요? 취소하면 기존 입력과 저장본은 그대로 유지됩니다.</p>
        {busy && <p role="status">{importPreview ? '가져온 내용을 저장하고 있습니다…' : 'Excel 파일을 읽고 있습니다…'}</p>}
        {importError && <div role="alert" className="es-error">{importError}<p>{importPreview ? '화면의 기존 입력은 유지했습니다. 연결 오류로 저장 여부가 불확실하면 목록에서 저장본을 확인한 뒤 다시 시도하세요.' : '가져오지 못했습니다. 원본 또는 ES 작업용 .xlsx 파일(25MB 이하)을 확인하고 다시 선택하세요.'}</p></div>}
        {importPreview && <>
          <div className="es-import-comparison"><table><thead><tr><th scope="col">항목</th><th scope="col">현재 입력</th><th scope="col">가져올 내용</th></tr></thead><tbody>
            {([['title', '산출서'], ['client', '발주자'], ['contractor', '시공자'], ['baseDate', '입찰 기준일'], ['adjustmentDate', '조정기준일'], ['contractAmount', '계약금액 (원)']] as const).map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td>{input[key] || '미입력'}</td><td>{importPreview.input[key] || '미입력'}</td></tr>)}
          </tbody></table></div>
          <p>비목 금액 변경: <strong>{ES_COSTS.filter(([r]) => input.costs[r] !== importPreview.input.costs[r]).length} / 28개</strong> · 프로젝트 연결은 유지합니다.</p>
          <p>계약정보·비목·지수/요율·선금/공제도 파일 값으로 교체합니다. 파일의 빈 값은 빈 값으로 반영됩니다.</p>
          <details><summary>세부 변경 내용 확인</summary><div className="es-import-comparison"><table><thead><tr><th scope="col">항목</th><th scope="col">현재 입력</th><th scope="col">가져올 내용</th></tr></thead><tbody>
            {ES_CONTRACT_FIELDS.map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td>{input.contract?.[key] || '미입력'}</td><td>{importPreview.input.contract?.[key] || '미입력'}</td></tr>)}
            {ES_COSTS.map(([r, code, label]) => <tr key={r}><th scope="row">{code} · {label}</th><td>{input.costs[r] || '미입력'}</td><td>{importPreview.input.costs[r] || '미입력'}</td></tr>)}
          </tbody></table></div></details>
          <details><summary>가져오기 검수 안내 ({importPreview.warnings.length}건)</summary>{importPreview.warnings.map(w => <p className="es-warning" key={w}>{w}</p>)}</details>
        </>}
      </div>
      <footer className="es-actions"><button autoFocus disabled={busy} onClick={() => { if (!pending.current) { setImportOpen(false); setImportPreview(null); } }}>취소 · 기존 입력 유지</button><button className="es-primary" disabled={busy || loading || loadFailed || !importPreview} onClick={() => { if (importPreview) void save(false, importPreview.input); }}>{busy && importPreview ? '저장 중…' : '가져온 내용으로 저장'}</button></footer>
    </dialog>}
  </section></div>, window.document.body);
}
