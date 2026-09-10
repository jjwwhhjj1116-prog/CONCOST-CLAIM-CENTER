import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest, triggerBrowserDownload } from '../api';
import { registerNavigationBlocker } from '../navigation-guard';
import { ES_COSTS, ES_RATE_KEYS, ES_CONTRACT_FIELDS, newEsContract, calculateEs, newEsInput, type EsInput, type EsResult } from '../../../../packages/document-engine/src/es-calculation';
import { ES_SHEETS } from '../../../../packages/document-engine/src/es-output';
import { exportEsReport, exportEsWorking, importEsWorkbook, type EsImportPreview } from './es-xlsx';
import { EsPrintPreview } from './EsPrintPreview';
import { EsTutorial } from './EsTutorial';
import { EsPrintSettingsEditor } from './EsPrintSettingsEditor';
import { resolveEsSources, syncEsSourceDates, esElapsedDays } from '../../../../packages/document-engine/src/es-source-history';
import { applyEsEcosSources, mergeEsSourceCandidates, type EsEcosItem } from '../../../../packages/document-engine/src/es-ecos';
import { applyEsPublicSources, esSourceValue, setEsSourceValue, type EsPublicSourceResult, type EsPublicSourceItem, type EsSourceField } from '../../../../packages/document-engine/src/es-source-candidates';
import { applyEsPairSources, ES_PAIR_LABELS, type EsPairSourceResult } from '../../../../packages/document-engine/src/es-pair-candidates';
import { EsMoneyInput, esFormatNumber } from './EsMoneyInput';
import { esDecimal } from '../../../../packages/document-engine/src/es-decimal';
import './EsStudio.css';
import { esPercent } from './es-display';
import { fillMissingEsSources } from './es-auto-sources';
import { EsDocumentImport } from './EsDocumentImport';

interface EsDocument { id: string; title: string; revision: number; caseId: string | null; updatedAt: string }
interface EsSaved { document: EsDocument; input: EsInput; inputHash: string; run?: EsRun | null }
interface EsRun { id: string; revision: number; inputHash: string; input: EsInput; result: EsResult }
interface Project { id: string; caseNumber: string; title: string }
const message = (error: unknown) => error instanceof Error ? error.message : '요청을 완료하지 못했습니다.';
const signature = (input: EsInput, caseId: string) => JSON.stringify({ input, caseId });
const RATE_LABELS = ['산재', '산업안전', '고용', '퇴직공제', '건강', '연금', '장기요양'];
type SourceField = EsSourceField | `material${number}`;
const SOURCE_FIELDS: [SourceField, string][] = [['wage', '노임 (원/일)'], ...['광산품', '공산품', '전력·수도·가스', '농림수산품'].map((label, i) => [`material${i}` as SourceField, label] as [SourceField, string]), ...ES_RATE_KEYS.map((key, i) => [key, RATE_LABELS[i] + ' (%)'] as [SourceField, string])];
const sourceValue = (period: EsInput['base'], field: SourceField) => field.startsWith('material') ? period.materials[Number(field.slice(8))] : esSourceValue(period, field as EsSourceField);
const changeSourceValue = (period: EsInput['base'], field: SourceField, value: string) => { if (field.startsWith('material')) period.materials[Number(field.slice(8))] = value; else setEsSourceValue(period, field as EsSourceField, value); };
interface SourcePreview { input: EsInput; warnings: string[]; details: Record<string, string>; automatic: string[]; edited: string[] }
const ES_STEPS = [
  ['input', '기본입력', '공사정보와 기준일', 'M3 21h18M5 21V3h14v18M9 7h2m2 0h2M9 11h2m2 0h2M10 21v-5h4v5'],
  ['costs', '비목·적용대가', '28개 비목 금액', 'M3 4h18v16H3zM3 9h18M9 9v11M15 9v11M3 14h18'],
  ['sources', '지수·요율', '기준일별 자료 비교', 'M4 3v17h17M7 15l4-5 4 3 5-8'],
  ['deductions', '선금·공제', '기성·선금 제외액', 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h4'],
  ['result', '계산검토', '비목별 계산 근거', 'M9 4h11v17H4V4h2M8 2h8v5H8zM8 14l3 3 6-7'],
  ['output', '출력물', '17시트·A4 인쇄', 'M7 8V3h10v5M7 17H4V8h16v9h-3M7 14h10v7H7zM16 11h1']
] as const;
type EsTab = typeof ES_STEPS[number][0];
function EsIcon({ path }: { path: string }) { return <svg className="es-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>; }
const ES_YELLOW_CONTRACT_CELLS = new Set(['E9', 'C11', 'E12', 'C17', 'C18', 'C19', 'C20', 'C23', 'C24', 'C25']);
const download = (bytes: Uint8Array, filename: string) => triggerBrowserDownload({ blob: new Blob([new Uint8Array(bytes).buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename });

/** Existing Claim Center visual language. Dense input ledger → saved revision → immutable draft output.
 * No customer fixtures, new identity, case creation or automatic approval is introduced here.
 */
export function EsStudio({ mode, search, onNavigate }: { mode: 'list' | 'editor'; search: string; onNavigate: (path: string) => void }) {
  const id = new URLSearchParams(search).get('documentId');
  const [input, setInput] = useState(newEsInput), [document, setDocument] = useState<EsDocument | null>(null);
  const [caseId, setCaseId] = useState(''), [projects, setProjects] = useState<Project[]>([]);
  const [documents, setDocuments] = useState<EsDocument[]>([]), [query, setQuery] = useState('');
  const [showDeleted, setShowDeleted] = useState(false), [listRefresh, setListRefresh] = useState(0);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const [loading, setLoading] = useState(mode === 'list' || Boolean(id)), [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false), pending = useRef(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [savedSignature, setSavedSignature] = useState(() => signature(newEsInput(), ''));
  const [tab, setTab] = useState<EsTab>('input');
  const [guideOpen, setGuideOpen] = useState(false), [costQuery, setCostQuery] = useState('');
  const [welcomeOpen, setWelcomeOpen] = useState(() => { try { return localStorage.getItem('es-tutorial-v1-dismissed') !== 'yes'; } catch { return true; } });
  const dismissWelcome = () => { setWelcomeOpen(false); try { localStorage.setItem('es-tutorial-v1-dismissed', 'yes'); } catch { /* Storage can be disabled. */ } };
  const [wideMode, setWideMode] = useState(false);
  const [selectedRow, setSelectedRow] = useState<number>(11), [reviewPeriod, setReviewPeriod] = useState<'current' | 'previous'>('current');
  const [importPreview, setImportPreview] = useState<EsImportPreview | null>(null);
  const [importOpen, setImportOpen] = useState(false), [importName, setImportName] = useState(''), [importError, setImportError] = useState('');
  const [sourcePreview, setSourcePreview] = useState<SourcePreview | null>(null);
  const [documentImportOpen, setDocumentImportOpen] = useState(false);
  const [autoSourceTrigger, setAutoSourceTrigger] = useState(0), handledAutoTrigger = useRef(0);
  const liveInput = useRef(input); liveInput.current = input;
  const sourceOwner = useRef(''); sourceOwner.current = `${mode}:${id ?? ''}`;
  useEffect(() => { sourceOwner.current = `${mode}:${id ?? ''}`; return () => { sourceOwner.current = 'unmounted'; }; }, [mode, id]);
  const [sourceOpen, setSourceOpen] = useState(false), sourceDialog = useRef<HTMLDialogElement>(null);
  const importDialog = useRef<HTMLDialogElement>(null), importPicker = useRef<HTMLInputElement>(null), importButton = useRef<HTMLButtonElement>(null), editorScroll = useRef<HTMLDivElement>(null);
  const importOpenRef = useRef(importOpen); importOpenRef.current = importOpen || sourceOpen || documentImportOpen;
  const [run, setRun] = useState<EsRun | null>(null);
  const [selection, setSelection] = useState<string[]>(ES_SHEETS.map(s => s[0]));
  const currentSignature = signature(input, caseId), dirty = currentSignature !== savedSignature;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const result = useMemo(() => calculateEs(input), [input]);
  useEffect(() => { if (error) editorScroll.current?.scrollTo({ top: 0 }); }, [error]);
  const history = useRef<EsInput[]>([]), future = useRef<EsInput[]>([]), workbench = useRef<HTMLElement>(null);
  const goTab = (next: EsTab) => { setTab(next); editorScroll.current?.scrollTo({ top: 0 }); };
  useEffect(() => { if (mode === 'editor' && new URLSearchParams(search).get('tutorial') === '1') setGuideOpen(true); }, [mode, search]);
  const revealMissingSource = () => {
    goTab('sources');
    window.requestAnimationFrame(() => {
      const missingInput = editorScroll.current?.querySelector<HTMLInputElement>('[data-es-pair-missing="true"]');
      missingInput?.focus(); missingInput?.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
  };
  // Returning from review must reveal the chosen row even after a prior filter.
  useEffect(() => { if (tab !== 'costs') setCostQuery(''); }, [tab]);
  const mutate = (update: (next: EsInput) => void) => { const next = structuredClone(input); update(next); history.current = [...history.current.slice(-49), input]; future.current = [];
    const selectorsChanged = next.baseDate !== input.baseDate || next.adjustmentDate !== input.adjustmentDate || next.contract?.employmentGrade !== input.contract?.employmentGrade || next.contract?.retirementTrade !== input.contract?.retirementTrade;
    setInput(selectorsChanged ? syncEsSourceDates(next, input) : next);
    if (selectorsChanged) { setSourcePreview(null); setAutoSourceTrigger(v => v + 1); }
  };
  const undo = () => { const previous = history.current.pop(); if (previous) { future.current.push(input); setInput(previous); setSourcePreview(null); handledAutoTrigger.current = autoSourceTrigger; } };
  const redo = () => { const next = future.current.pop(); if (next) { history.current.push(input); setInput(next); setSourcePreview(null); handledAutoTrigger.current = autoSourceTrigger; } };
  useEffect(() => {
    if (mode !== 'editor') return;
    workbench.current?.focus();
    const fit = () => { const el = workbench.current; if (el) el.style.setProperty('--es-available-height', `${Math.max(520, window.innerHeight - el.getBoundingClientRect().top - 8)}px`); };
    fit(); window.addEventListener('resize', fit);
    const observer = new ResizeObserver(fit);
    const shell = workbench.current?.closest('.app-shell');
    if (shell) for (const child of shell.children) if (!child.classList.contains('shell-body')) observer.observe(child);
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
  }, [mode]);
  useEffect(() => {
    if (!importOpen) return;
    const dialog = importDialog.current;
    dialog?.showModal();
    return () => { dialog?.close(); importButton.current?.focus(); };
  }, [importOpen]);
  useEffect(() => { if (!sourceOpen) return; sourceDialog.current?.showModal(); return () => sourceDialog.current?.close(); }, [sourceOpen]);
  useEffect(() => {
    let active = true;
    if (mode === 'list') {
      setLoading(true); setLoadFailed(false); setError('');
      void apiRequest<{ documents: EsDocument[] }>('/api/es/documents' + (showDeleted ? '/trash' : '')).then(payload => { if (active) setDocuments(payload.documents); }).catch(e => { if (active) { setError(message(e)); setLoadFailed(true); setDocuments([]); } }).finally(() => { if (active) setLoading(false); });
    } else {
      void apiRequest<{ cases: Project[] }>('/api/cases?limit=100&assignedOnly=true').then(payload => { if (active) setProjects(payload.cases); }).catch(() => { if (active) setNotice('프로젝트 목록을 불러오지 못했습니다. 연결 없이 작성할 수 있습니다.'); });
      if (id) void apiRequest<EsSaved>(`/api/es/documents/${encodeURIComponent(id)}`).then(payload => {
        if (!active) return; setDocument(payload.document); setInput(syncEsSourceDates(payload.input)); setCaseId(payload.document.caseId ?? ''); setSavedSignature(signature(payload.input, payload.document.caseId ?? '')); setRun(payload.run ?? null);
        const synced = syncEsSourceDates(payload.input);
        if ([synced.base, synced.current.period, synced.previous.period].some(p => p.wage === '' || p.rates.injury === '')) setAutoSourceTrigger(v => v + 1);
      }).catch(e => { if (active) { setError(message(e)); setLoadFailed(true); } }).finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, [id, mode, showDeleted, listRefresh]);
  const changeDeleted = async (item: EsDocument) => {
    if (pending.current || loading || loadFailed) return;
    const restore = showDeleted;
    const prompt = restore
      ? `“${item.title}” 산출서를 복구할까요?\n입력과 이력은 유지됩니다. 출력하려면 복구 후 저장·계산을 다시 실행하세요.`
      : `“${item.title}” 산출서를 삭제할까요?\n목록에서 제외되며 ‘삭제한 산출서’에서 복구할 수 있습니다. 연결 프로젝트와 기존 계산·출력 이력은 삭제하지 않습니다.`;
    if (!window.confirm(prompt)) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/api/es/documents/${encodeURIComponent(item.id)}${restore ? '/restore' : ''}`, { method: restore ? 'POST' : 'DELETE', body: JSON.stringify({ expectedRevision: item.revision }) });
      setDocuments(current => current.filter(d => d.id !== item.id));
      setNotice(restore ? `“${item.title}” 복구 완료. 산출서 목록에서 열고 저장·계산하세요.` : `“${item.title}” 삭제 완료. ‘삭제한 산출서’에서 복구할 수 있습니다.`);
      listHeading.current?.focus();
    } catch (e) { setError(message(e)); } finally { pending.current = false; setBusy(false); }
  };
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
      const snapshot = syncEsSourceDates(structuredClone(imported ?? input)), linked = caseId;
      const saved = await apiRequest<EsSaved>(`/api/es/documents${document ? '/' + document.id : ''}`, { method: document ? 'PUT' : 'POST', body: JSON.stringify({ input: snapshot, caseId: linked || null, ...(document ? { expectedRevision: document.revision } : {}) }) });
      setDocument(saved.document); dirtyRef.current = false;
      setInput(saved.input); setSavedSignature(signature(saved.input, saved.document.caseId ?? ''));
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
  const fetchSources = async (automatic = false) => {
    if (pending.current || loading || loadFailed) return;
    const owner = sourceOwner.current;
    setError('');
    let candidate: SourcePreview;
    try { const resolved = resolveEsSources(input); candidate = { input: mergeEsSourceCandidates(input, resolved.input), warnings: [], details: {}, automatic: [], edited: [] }; } catch (e) { setError(message(e)); return; }
    pending.current = true; setBusy(true); setSourcePreview(null); if (!automatic) setSourceOpen(true);
    try {
      const before = new Date(input.adjustmentDate + 'T00:00:00Z'); before.setUTCDate(before.getUTCDate() - 1);
      const dates = [input.baseDate, input.adjustmentDate, before.toISOString().slice(0, 10)];
      const query = new URLSearchParams(); dates.forEach(date => query.append('date', date));
      const ecos = apiRequest<{ items: EsEcosItem[]; warnings: string[] }>('/api/es/sources/ecos?' + query.toString(), { timeoutMs: 30_000 }).then(response => ({ response }), error => ({ error }));
      const publicQuery = new URLSearchParams(query); publicQuery.set('trade', input.contract?.retirementTrade ?? ''); publicQuery.set('grade', input.contract?.employmentGrade ?? '');
      const publicSources = apiRequest<EsPublicSourceResult>('/api/es/sources/public?' + publicQuery.toString(), { timeoutMs: 30_000 }).then(response => ({ response }), error => ({ error }));
      const pairs = apiRequest<EsPairSourceResult>('/api/es/sources/pairs?' + query.toString(), { timeoutMs: 60_000 }).then(response => ({ response }), error => ({ error }));
      const fallbackHealth = new Map([candidate.input.base, candidate.input.current.period, candidate.input.previous.period].map(p => [p.date, p.rates.health]));
      const health = apiRequest<{ items: { date: string; value: string; source: string; effectiveDate: string }[]; warnings: string[] }>('/api/es/sources/health?' + query.toString(), { timeoutMs: 35_000 }).then(response => ({ response }), error => ({ error }));
      const mark = (item: EsPublicSourceItem) => {
        const id = item.date + ':' + item.field; candidate.automatic.push(id); candidate.details[id] = `${item.source} · 공표/시행 ${item.effectiveDate} · ${item.condition}`;
      };
      const published = await publicSources;
      if ('response' in published) {
        try {
          candidate.input = applyEsPublicSources(candidate.input, published.response.items);
          published.response.issues.forEach(i => { candidate.details[i.date + ':' + i.field] = i.reason; });
          published.response.items.forEach(mark);
        } catch { candidate.warnings.push('공식 공표자료 응답 검증 실패 · 기존 값과 Excel 이력을 유지합니다.'); }
      } else candidate.warnings.push('조달청·대한건설협회 조회 실패: ' + message(published.error));
      try {
        const outcome = await health; if ('error' in outcome) throw outcome.error;
        const response = outcome.response;
        const items: EsPublicSourceItem[] = response.items.map(item => ({ ...item, field: 'health', condition: '일반 건설근로자 사업주 부담률 · 적용 대상 여부 확인' }));
        // Validate the whole provider response before exposing any item. PPS remains a fallback.
        const checked = applyEsPublicSources(candidate.input, items);
        for (const item of items) {
          const id = item.date + ':health', existing = [candidate.input.base, candidate.input.current.period, candidate.input.previous.period].find(p => p.date === item.date)!;
          if (candidate.automatic.includes(id)) {
            if (esDecimal(existing.rates.health).compare(esDecimal(item.value)) === 0) candidate.details[id] += ' · 국가법령 시행본 교차확인 일치';
            else { for (const p of [candidate.input.base, candidate.input.current.period, candidate.input.previous.period]) if (p.date === item.date) { p.rates.health = fallbackHealth.get(item.date) ?? ''; p.source = `${p.source} / 조달청·법령 불일치: 위 health 자동조회값 미적용, 기존/Excel health=${p.rates.health || '미입력'} 유지`.slice(-2000); } candidate.automatic = candidate.automatic.filter(key => key !== id); candidate.details[id] = '조달청·법령 요율 불일치 · 기존/Excel 값 유지 · 적용조건 확인 후 수동 입력'; }
          } else { for (const p of [candidate.input.base, candidate.input.current.period, candidate.input.previous.period]) if (p.date === item.date) { p.rates.health = item.value; p.source = [checked.base, checked.current.period, checked.previous.period].find(v => v.date === item.date)!.source; } mark(item); }
        }
        candidate.warnings.push(...response.warnings);
      } catch (e) { candidate.warnings.push('공식 건강보험 조회 미반영: ' + message(e)); }
      const ecosystem = await ecos;
      if ('response' in ecosystem) {
        try {
          candidate.input = applyEsEcosSources(candidate.input, ecosystem.response.items);
          candidate.warnings.push(...ecosystem.response.warnings);
          for (const item of ecosystem.response.items) if (dates.includes(item.date)) for (let i = 0; i < 4; i++) { const id = item.date + ':material' + i; candidate.automatic.push(id); candidate.details[id] = `한국은행 ECOS · 자료월 ${item.month} · 생산자물가지수 · 2020=100 · 현재 공표된 개정 수치`; }
          if (ecosystem.response.items.length) candidate.warnings.unshift(`ECOS 재료지수 조회 완료 · ${[...new Set(ecosystem.response.items.map(item => item.month))].join(', ')} · 월별 4종 · 2020=100. 과거 월 값도 현재 공표된 개정 수치입니다.`);
        } catch { candidate.warnings.push('ECOS 응답의 항목·자료월 검증에 실패했습니다. 기존 재료지수를 유지합니다.'); }
      } else candidate.warnings.push('ECOS 재료지수 미반영: ' + message(ecosystem.error));
      const pairOutcome = await pairs;
      if ('response' in pairOutcome) {
        try {
          if (!Array.isArray(pairOutcome.response.items) || !Array.isArray(pairOutcome.response.issues) || pairOutcome.response.issues.some(i => !i || !dates.slice(1).includes(i.date) || !Number.isInteger(i.index) || i.index < 0 || i.index > 5 || typeof i.reason !== 'string' || i.reason.length > 2000)) throw new Error('기간쌍 응답 형식 오류');
          const checked = applyEsPairSources(candidate.input, pairOutcome.response.items);
          for (const item of pairOutcome.response.items) { const id = item.date + ':pair' + item.index; candidate.automatic.push(id); candidate.details[id] = item.pair.source; }
          for (const issue of pairOutcome.response.issues) { candidate.details[issue.date + ':pair' + issue.index] = issue.reason; candidate.warnings.push(issue.reason); }
          candidate.input = checked;
        } catch { candidate.warnings.push('기계·표준시장단가 응답 검증 실패 · 기존/Excel 기간쌍을 유지합니다.'); }
      } else candidate.warnings.push('기계·표준시장단가 조회 실패: ' + message(pairOutcome.error));
      for (const c of [candidate.input.current, candidate.input.previous]) for (const [i, pair] of [c.machinery, ...c.standards].entries()) if (!pair.commonCount || !pair.baseAverage || !pair.comparisonAverage) candidate.warnings.push(`${c.period.date} ${ES_PAIR_LABELS[i]}: 공통 수·평균 미확인. 비목 금액과 별개의 원자료가 필요합니다. 적용 후 지수·요율에서 재조회 또는 수동 입력하세요.`);
      candidate.warnings.push('조달청 요율은 공표된 참고값입니다. 공사기간·추정금액·공종 등 적용조건을 확인하세요. 산업안전 C22는 기존 공통값을 유지합니다.');
      if (sourceOwner.current !== owner || JSON.stringify(liveInput.current) !== JSON.stringify(input)) return;
      setSourcePreview(candidate);
      if (automatic) {
        const filled = fillMissingEsSources(input, candidate.input, candidate.automatic);
        if (JSON.stringify(filled) !== JSON.stringify(input)) mutate(n => Object.assign(n, filled));
        setNotice('기준일·조건 변경에 따라 공식 자료를 조회했습니다. 확인된 빈 항목만 자동 입력했고 기존 입력은 유지했습니다. 조회 결과·근거에서 미확인 항목을 검토하세요.');
      }
    } finally { pending.current = false; setBusy(false); }
  };
  useEffect(() => {
    if (!autoSourceTrigger || handledAutoTrigger.current === autoSourceTrigger || busy || loading || loadFailed || documentImportOpen || mode !== 'editor') return;
    if (![input.baseDate, input.adjustmentDate].every(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)))) return;
    const timer = window.setTimeout(() => { handledAutoTrigger.current = autoSourceTrigger; void fetchSources(true); }, 900);
    return () => window.clearTimeout(timer);
  }, [autoSourceTrigger, busy, loading, loadFailed, documentImportOpen, mode, input]);
  const editSource = (key: 'base' | 'current' | 'previous', field: SourceField, value: string, keep = false) => setSourcePreview(previous => {
    if (!previous) return previous;
    const next = structuredClone(previous), period = key === 'base' ? next.input.base : next.input[key].period;
    // Original C22 is one shared safety condition, not three independently selected rates.
    for (const p of field === 'safety' ? [next.input.base, next.input.current.period, next.input.previous.period] : [period]) {
      changeSourceValue(p, field, value); const itemId = p.date + ':' + field;
      next.details[itemId] = keep ? '같은 적용일의 기존 입력 유지 · 자동조회값 미적용' : '직접 수정한 값 · 원자료와 단위를 확인하세요.';
      next.automatic = next.automatic.filter(v => v !== itemId); if (!next.edited.includes(itemId)) next.edited.push(itemId);
    }
    return next;
  });
  const sourceErrors = sourcePreview ? [sourcePreview.input.base, sourcePreview.input.current.period, sourcePreview.input.previous.period].flatMap(p => SOURCE_FIELDS.filter(([field]) => sourcePreview.edited.includes(p.date + ':' + field) && sourceValue(p, field) !== '' && !/^\d{1,18}(?:\.\d{1,12})?$/.test(sourceValue(p, field))).map(([, label]) => `${p.date} ${label}`)) : [];
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
  const field = (label: string, value: string, change: (value: string) => void, type = 'text', manualCell = '') => <label className="es-field"><span>{label}{manualCell && <small className="es-field-requirement">수동 입력 · {manualCell}</small>}</span>{label.includes('(원)') ? <EsMoneyInput data-es-manual={manualCell || undefined} value={value} onValueChange={change} /> : <input type={type} data-es-manual={manualCell || undefined} value={value} onChange={e => change(e.target.value)} />}</label>;
  const contractFields = (keys: readonly (typeof ES_CONTRACT_FIELDS[number][0])[]) => keys.map(key => {
    const [, label, type, coordinate] = ES_CONTRACT_FIELDS.find(([fieldKey]) => fieldKey === key)!;
    return <div key={key}>{field(label, input.contract?.[key] ?? '', v => mutate(n => { n.contract ??= newEsContract(); n.contract[key] = v;
      if (key === 'employmentGrade' || key === 'retirementTrade') for (const p of [n.base, n.current.period, n.previous.period]) p.rates[key === 'employmentGrade' ? 'employment' : 'retirement'] = '';
    }), type === 'date' ? 'date' : 'text', ES_YELLOW_CONTRACT_CELLS.has(coordinate) ? coordinate : '')}</div>;
  });
  if (mode === 'list') return <section className="es-studio es-document-list"><header className="es-heading"><div><h1 ref={listHeading} tabIndex={-1}>ES 산출프로그램</h1><p>사건 등록 없이 산출서를 만들고, 필요할 때 프로젝트와 연결하세요.</p></div><button disabled={busy} className="es-primary" onClick={() => onNavigate('/es/editor')}>＋ 새 산출서</button></header>
    <p className="es-access">작성자·관리자만 접근 · API 키 없이 수동 입력·Excel 가져오기</p>
    <div className="es-tutorial-entry"><div><h2>처음 사용하는 ES 산출프로그램</h2><p>기본입력부터 계산 근거 확인, A4 출력까지 6단계를 따라가세요.</p></div><button className="es-primary" onClick={() => { dismissWelcome(); onNavigate('/es/editor?tutorial=1'); }}>단계별 튜토리얼 시작</button></div>
    {welcomeOpen && <aside className="es-tutorial-intro"><p>기존 산출서는 목록에서 열고 <b>작업 안내</b>를 누르세요. 새 산출서에서는 Excel 가져오기 또는 직접 입력으로 시작합니다. 안내만 보는 동안 문서는 저장되지 않습니다.</p><button onClick={dismissWelcome}>알겠습니다 · 설명 접기</button></aside>}
    {error && <p role="alert" className="es-error">{error}</p>}
    {notice && <p role="status" className="es-notice">{notice}</p>}
    <div className="es-list-toolbar"><div role="group" aria-label="산출서 목록 구분"><button aria-pressed={!showDeleted} disabled={busy} onClick={() => { setShowDeleted(false); setQuery(''); setNotice(''); }}>산출서 목록</button><button aria-pressed={showDeleted} disabled={busy} onClick={() => { setShowDeleted(true); setQuery(''); setNotice(''); }}>삭제한 산출서</button></div><button disabled={busy || loading} onClick={() => setListRefresh(v => v + 1)}>목록 새로고침</button></div>
    {showDeleted && <p className="es-access">삭제한 산출서는 복구할 수 있습니다. 연결 프로젝트와 입력·계산·출력 이력은 보존됩니다.</p>}
    <label className="es-field">산출서 검색<input value={query} onChange={e => setQuery(e.target.value)} placeholder="산출서 제목" /></label>
    {busy && <p role="status">{showDeleted ? '산출서를 복구하는 중입니다.' : '산출서를 삭제하는 중입니다.'}</p>}
    {loading ? <p role="status">산출서를 불러오는 중입니다.</p> : <div className="es-table-wrap"><table><thead><tr><th>산출서</th><th>프로젝트</th><th>버전</th><th>{showDeleted ? '삭제일' : '최근 저장'}</th><th>작업</th></tr></thead><tbody>{documents.filter(d => d.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(d => <tr key={d.id}><td>{d.title}</td><td>{d.caseId ? '연결됨' : '독립 산출서'}</td><td>v{d.revision}</td><td>{new Date(d.updatedAt).toLocaleString('ko-KR')}</td><td><div className="es-list-actions">{!showDeleted && <button disabled={busy} onClick={() => onNavigate('/es/editor?documentId=' + encodeURIComponent(d.id))}>열기</button>}<button disabled={busy} className={showDeleted ? '' : 'es-delete-button'} aria-label={`${d.title} ${showDeleted ? '복구' : '삭제'}`} onClick={() => void changeDeleted(d)}>{showDeleted ? '복구' : '삭제'}</button></div></td></tr>)}</tbody></table>{!documents.length && !loadFailed && <p className="es-empty">{showDeleted ? '삭제한 산출서가 없습니다.' : '저장한 산출서가 없습니다. 새 산출서에서 시작하세요.'}</p>}{documents.length > 0 && !documents.some(d => d.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())) && <p className="es-empty">검색 결과가 없습니다. 검색어를 바꿔 보세요.</p>}</div>}</section>;
  const stepIndex = ES_STEPS.findIndex(step => step[0] === tab);
  const outputReady = Boolean(run && !dirty && run.revision === document?.revision);
  const selectedCost = ES_COSTS.find(([row]) => row === selectedRow)!;
  const selectedCalculation = result[reviewPeriod]?.rows.find(row => row.row === selectedRow);
  const filledCosts = ES_COSTS.filter(([row]) => input.costs[row] !== '').length;
  const positiveCosts = ES_COSTS.filter(([row]) => /^\d+(\.\d+)?$/.test(input.costs[row]) && esDecimal(input.costs[row]).compare(esDecimal(0)) > 0).length;
  const costTotal = ES_COSTS.every(([row]) => /^\d+(\.\d+)?$/.test(input.costs[row])) ? ES_COSTS.reduce((total, [row]) => total.add(esDecimal(input.costs[row])), esDecimal(0)).toString() : '';
  const costDetail = <aside className="es-inspector" aria-label="선택 비목 상세"><h2>{selectedCost[1]} · {selectedCost[2]}</h2><p>원본 3!B{selectedRow} · 선택한 비목의 입력과 계산값</p><dl><div><dt>입력 금액 (원)</dt><dd>{esFormatNumber(input.costs[selectedRow]) || '미입력'}</dd></div><div><dt>계수 (%)</dt><dd>{esPercent(selectedCalculation?.weight, '계산 대기')}</dd></div><div><dt>기준지수</dt><dd>{selectedCalculation?.base ?? '—'}</dd></div><div><dt>비교지수</dt><dd>{selectedCalculation?.comparison ?? '—'}</dd></div><div><dt>등락비</dt><dd>{selectedCalculation?.ratio ?? '—'}</dd></div><div><dt>조정계수 (%)</dt><dd>{esPercent(selectedCalculation?.adjusted)}</dd></div></dl><p>기준 {input.base.date || '미입력'}<br />비교 {input[reviewPeriod].period.date || '미입력'} ({reviewPeriod === 'current' ? '현재' : '직전'})</p><div className="es-actions"><button onClick={() => { goTab('costs'); window.requestAnimationFrame(() => window.document.getElementById(`es-cost-${selectedRow}`)?.focus()); }}>금액 수정</button><button onClick={() => goTab('sources')}>지수·요율 확인</button></div><details><summary>기간 원자료의 출처·메모</summary><p>기준: {input.base.source || '등록된 출처 없음'}</p><p>비교: {input[reviewPeriod].period.source || '등록된 출처 없음'}</p><p>기계·표준시장단가와 기타비목의 계산은 기간쌍·합성지수를 사용합니다. 해당 근거는 지수·요율에서 확인하세요.</p></details></aside>;
  return <section ref={workbench} tabIndex={-1} aria-labelledby="es-editor-title" data-es-workbench="CF130" data-wide={wideMode} className="es-studio es-editor-workspace" onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !importOpen && !sourceOpen && !documentImportOpen) { e.preventDefault(); void save(); } }}>
    <header className="es-heading"><div className="es-app-title"><EsIcon path={ES_STEPS[4][3]} /><div><h1 id="es-editor-title">ES 산출프로그램</h1><p>물가변동 산출 · 초회 · 검토용 초안</p></div></div><div className="es-actions"><button className="es-wide-toggle" aria-pressed={wideMode} onClick={() => setWideMode(v => !v)}>{wideMode ? '메뉴 다시 보기' : '작업영역 넓게'}</button><button aria-expanded={guideOpen} onClick={() => setGuideOpen(v => !v)}>작업 안내</button><button onClick={() => onNavigate('/es')} aria-label="산출서 목록으로">산출서 목록</button></div></header>
    <nav className="es-tabs" aria-label="ES 작업 영역">{ES_STEPS.map(([key, label, help, path], index) => <div className="es-step" key={key}><button aria-current={tab === key ? 'page' : undefined} onClick={() => goTab(key)}><EsIcon path={path} /><span><b><span className="es-step-number">{index + 1}</span> {label}</b><small>{help}</small></span></button>{index < 5 && <svg className="es-step-arrow" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 12h16m-6-6 6 6-6 6" /></svg>}</div>)}</nav>
    <div className="es-document-strip" aria-label="현재 산출서 정보"><div className="es-document-name"><small>현재 산출서 · {caseId ? '프로젝트 연결' : '독립 산출서'}</small><strong title={input.title}>{input.title || '공사명을 입력하세요'}</strong></div><div><small>입찰 기준일</small><b>{input.baseDate || '미입력'}</b></div><div><small>조정기준일</small><b>{input.adjustmentDate || '미입력'}</b></div><div><small>총계약금액 (원)</small><b>{esFormatNumber(input.contractAmount) || '미입력'}</b></div></div>
    <div className="es-toolbar"><span className={dirty ? 'es-save-state is-dirty' : 'es-save-state'} role="status">{busy ? '처리 중…' : dirty ? '저장하지 않은 변경' : document ? `저장됨 · v${document.revision}` : '새 산출서'}</span><button disabled={busy || !history.current.length} onClick={undo}>입력 취소</button><button disabled={busy || !future.current.length} onClick={redo}>재실행</button><button disabled={busy || loading || loadFailed} onClick={() => setDocumentImportOpen(true)}>계약서·원가 가져오기</button><button ref={importButton} disabled={busy || loading || loadFailed} onClick={() => importPicker.current?.click()}>Excel 가져오기</button><button disabled={busy} onClick={() => goTab('output')}>Excel 내보내기</button><button disabled={busy || loading || loadFailed} onClick={() => void save()}>저장</button><button className="es-primary" disabled={busy || loading || loadFailed} onClick={() => void save(true)}>저장·계산</button></div>
    <input ref={importPicker} hidden type="file" accept=".xlsx" aria-label="가져올 Excel 파일" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void importFile(file); }} />
    <div ref={editorScroll} className="es-editor-scroll">
      {sourcePreview && !sourceOpen && <p className="es-source-status">공식 자료 조회 완료 · 기존 수동값은 유지합니다. <button disabled={busy} onClick={() => { setSourcePreview(p => { if (!p) return p; const merged = mergeEsSourceCandidates(input, p.input); return { ...p, input: { ...input, base: merged.base, current: merged.current, previous: merged.previous } }; }); setSourceOpen(true); }}>조회 결과·근거 확인</button></p>}
    {error && <p className="es-error" role="alert">{error} {document && <button onClick={() => { if (window.confirm('현재 입력을 버리고 저장본을 다시 불러올까요?')) window.location.reload(); }}>저장본 다시 확인</button>}</p>}
    {notice && <p role="status" className="es-notice">{notice}</p>}
    {loading ? <p role="status">저장본을 불러오는 중입니다.</p> : loadFailed ? <p>원본을 불러오지 못해 덮어쓰기를 차단했습니다.</p> : <>
      {guideOpen && <EsTutorial step={stepIndex} onStep={index => goTab(ES_STEPS[index][0])} onClose={() => setGuideOpen(false)} />}
      <div className="es-stage-heading"><div><h2>{ES_STEPS[stepIndex][1]}</h2><p>{ES_STEPS[stepIndex][2]} · 입력값을 바꾸면 화면 계산에 즉시 반영됩니다.</p></div><span className="es-draft-label">검토용 초안 · 제출 전 검수 필요</span></div>
      <fieldset disabled={busy} className="es-workspace">
      {tab === 'input' && <div className="es-basic-input">
        <p className="es-input-guide">원본 기본입력과 같은 노란 19칸은 수동 입력입니다. 선금처럼 해당하지 않는 항목은 0 또는 빈 값으로 둘 수 있습니다. 흰색은 추가 계약정보, 오른쪽 표는 입력·원자료에서 계산하거나 선택한 값입니다.</p>
        <div className="es-source-actions"><strong>계약현황 기본입력</strong><button className="es-primary" onClick={() => void fetchSources()}>ES 요율정보 가져오기</button><button onClick={() => setTab('sources')}>원자료 직접 입력·확인</button></div>
        <div className="es-basic-ledger"><div>
        <section aria-labelledby="es-project-heading"><h2 id="es-project-heading" className="es-input-section-title"><span>1</span> 공사정보</h2><div className="es-basic-grid es-basic-grid--wide">
          {field('공사명 · 산출서 제목', input.title, v => mutate(n => { n.title = v; }), 'text', 'C8')}
          <label className="es-field">프로젝트 연결 (선택)<select value={caseId} onChange={e => setCaseId(e.target.value)} aria-describedby="es-project-help"><option value="">연결 없이 독립 산출서</option>{caseId && !projects.some(p => p.id === caseId) && <option value={caseId}>현재 연결 프로젝트 (목록 확인 필요)</option>}{projects.map(p => <option key={p.id} value={p.id}>{p.caseNumber} · {p.title}</option>)}</select></label>
          {field('수요기관 · 발주자', input.client, v => mutate(n => { n.client = v; }), 'text', 'C7')}{field('시공사', input.contractor, v => mutate(n => { n.contractor = v; }), 'text', 'C9')}
        </div><p id="es-project-help" className="es-field-help">프로젝트 연결은 선택 사항입니다. 목록에서 선택한 뒤 저장하면 연결됩니다. 연결만으로 계약정보가 자동 입력되지는 않으며, 기존 입력은 유지됩니다.</p></section>
        <section aria-labelledby="es-dates-heading"><h2 id="es-dates-heading" className="es-input-section-title"><span>2</span> 산출기준일</h2><div className="es-basic-grid">
          {field('입찰 기준일 (초회)', input.baseDate, v => mutate(n => { n.baseDate = v; }), 'date', 'C10')}{field('조정기준일', input.adjustmentDate, v => mutate(n => { n.adjustmentDate = v; }), 'date', 'C12')}
          {contractFields(['priorAdjustmentDate', 'reportDate'])}
        </div></section>
        <section aria-labelledby="es-contract-heading"><h2 id="es-contract-heading" className="es-input-section-title"><span>3</span> 전체계약 · 공사기간</h2><div className="es-basic-grid">
          {field('총계약금액 (원)', input.contractAmount, v => mutate(n => { n.contractAmount = v; }), 'text', 'C16')}
          {contractFields(['contractDate', 'startDate', 'endDate', 'firstContractDate', 'contractKind', 'bidRate', 'vatMode'])}
        </div></section>
        <section aria-labelledby="es-current-heading"><h2 id="es-current-heading" className="es-input-section-title"><span>4</span> 금차계약 · 공사기간</h2><div className="es-basic-grid">
          {contractFields(['currentContractAmount', 'currentContractDate', 'currentStartDate', 'currentEndDate'])}
        </div></section>
        <section aria-labelledby="es-conditions-heading"><h2 id="es-conditions-heading" className="es-input-section-title"><span>5</span> 적용조건 · 공정</h2><div className="es-basic-grid">
          {contractFields(['legalSystem', 'employmentGrade', 'retirementTrade', 'advanceDate', 'plannedProgress', 'actualProgress', 'technicalDepartment', 'technicalManager'])}
          {field('산업안전 요율 (%)', input.base.rates.safety, v => mutate(n => { n.base.rates.safety = v; n.current.period.rates.safety = v; n.previous.period.rates.safety = v; }), 'text', 'C22')}
          {field('선금 대상금액 (원)', input.advanceContract, v => mutate(n => { n.advanceContract = v; }), 'text', 'E10')}
          {field('선금 지급액 (원)', input.advancePaid, v => mutate(n => { n.advancePaid = v; }), 'text', 'E11')}
        </div></section>
        </div><aside className="es-derived-ledger" aria-label="자동 계산 및 기준일별 적용자료"><h2>자동 계산 · 적용자료</h2>
          <dl className="es-derived-summary"><div><dt>현재 조정률 K</dt><dd>{esPercent(result.current?.displayK, '계산 대기')}</dd></div><div><dt>직전 조정률 K</dt><dd>{esPercent(result.previous?.displayK, '계산 대기')}</dd></div><div><dt>경과일 (계약일~조정일−1)</dt><dd>{esElapsedDays(input) || '—'} 일</dd></div><div><dt>현재 원자료 이력</dt><dd>{input.sourceHistory ? `${input.sourceHistory.months.length}개월 · 요율 ${input.sourceHistory.rates.length}행` : '원본 Excel 가져오기 필요'}</dd></div></dl>
          <div className="es-table-wrap"><table><thead><tr><th>항목</th><th>기준일</th><th>직전일</th><th>조정일</th></tr></thead><tbody>
            <tr><th>적용일</th>{[input.base, input.previous.period, input.current.period].map((p, i) => <td key={i}>{p.date || '—'}</td>)}</tr>
            <tr><th>노임 (원)</th>{[input.base, input.previous.period, input.current.period].map((p, i) => <td key={i}>{esFormatNumber(p.wage) || '—'}</td>)}</tr>
            {['광산품', '공산품', '전력·수도·가스', '농림수산품'].map((label, i) => <tr key={label}><th>{label}</th>{[input.base, input.previous.period, input.current.period].map((p, j) => <td key={j}>{p.materials[i] || '—'}</td>)}</tr>)}
            {ES_RATE_KEYS.map((key, i) => <tr key={key}><th>{RATE_LABELS[i]} (%)</th>{[input.base, input.previous.period, input.current.period].map((p, j) => <td key={j}>{p.rates[key] || '—'}</td>)}</tr>)}
          </tbody></table></div>
          <p className="es-source-status" role="status">{input.sourceHistory ? '날짜·등급·공종 변경 시 가져온 이력에서 즉시 다시 선택합니다. 이력에 없는 값은 —로 표시합니다.' : '월별 원자료 이력이 없습니다. 날짜가 바뀌면 이전 자료를 재사용하지 않습니다. 원본 Excel을 다시 가져오거나 지수·요율에 해당 기간 값을 입력하세요.'} <b>ES 요율정보 가져오기</b>는 현재 입력한 날짜로 공식 노임·보험요율·재료지수·기계경비·표준시장단가를 조회합니다.</p>
          <p className="es-field-help">노임은 해당 월, 재료는 월말이면 해당 월·그 외에는 전월로 선택합니다. —는 0이 아니라 원자료 확인이 필요한 값입니다.</p>
          <p className="es-field-help">비목 금액과 기성 내역은 계약별 원자료입니다. 원본 Excel에서 가져오거나 비목·적용대가 / 선금·공제에 입력해야 합니다. 자료가 부족하면 자동 계산·출력을 완료로 처리하지 않습니다.</p>
        </aside></div>
      </div>}
      {tab === 'costs' && <><section aria-label="비목 원가와 적용대가 안내"><h2>비목 원가 입력 · 적용대가 확인</h2><p className="es-field-help">비목 금액은 계약 원가내역서의 금액입니다. 총계약금액이나 조회한 지수·요율로 자동 배분되지 않습니다. 입력한 비목 비중으로 K를 계산하고, 별도의 적용대가에 K를 곱합니다.</p><dl className="es-derived-summary"><div><dt>비목 원가 합계 (원) · 계수 산정 기준</dt><dd>{esFormatNumber(costTotal) || '미입력 확인 필요'}</dd></div><div><dt>적용대가 (원) · 총계약금액 − 제외액</dt><dd>{esFormatNumber(result.amount?.applicable ?? '—')}</dd></div></dl><div className="es-actions"><button disabled={busy || loading || loadFailed} onClick={() => setDocumentImportOpen(true)}>원가계산서에서 비목 가져오기</button><button onClick={() => goTab('deductions')}>기성·직접 지급 제외액 확인</button></div><p className="es-field-help">금액 변경은 계수·K에 즉시 반영됩니다. 모든 비목을 같은 비율로 바꾸면 비중이 같아 K는 유지됩니다. 출력에 반영하려면 저장·계산을 누르세요.</p></section><div className="es-source-actions"><label className="es-search">비목 찾기<input value={costQuery} onChange={e => setCostQuery(e.target.value)} placeholder="비목명 또는 코드" /></label><span>금액 있는 비목 {positiveCosts} / 28개 · 0원 {filledCosts - positiveCosts}개 · 미입력 {28 - filledCosts}개</span><button onClick={() => setCostQuery('')}>검색 초기화</button></div><p className="es-field-help">금액 한 열을 Excel에서 복사해 붙여넣으세요. 붙여넣기는 원본의 연속 비목 순서로 적용됩니다.</p>
      <div className="es-review-layout"><div className="es-table-wrap es-cost-table"><table><thead><tr><th>코드</th><th>비목</th><th>금액 (원)</th><th>원본 셀</th></tr></thead><tbody>{ES_COSTS.map(([r, code, label], index) => <tr hidden={!`${code} ${label}`.toLocaleLowerCase().includes(costQuery.toLocaleLowerCase())} className={selectedRow === r ? 'is-selected' : ''} key={r}><td>{code}</td><th scope="row"><button aria-pressed={selectedRow === r} onClick={() => setSelectedRow(r)}>{label}</button></th><td><EsMoneyInput id={`es-cost-${r}`} aria-label={label + ' 금액 (원)'} value={input.costs[r]} onFocus={() => setSelectedRow(r)} onValueChange={value => mutate(n => { n.costs[r] = value; })} onPaste={e => {
        const text = e.clipboardData.getData('text'); if (!/[\n\t]/.test(text)) return; e.preventDefault();
        const values = text.trim().split(/\r?\n/).map(v => v.trim().replace(/,/g, ''));
        if (values.some(v => !/^\d+(\.\d+)?$/.test(v)) || values.length > ES_COSTS.length - index) { setError('금액 한 열만 선택해 붙여넣으세요. 남은 비목 행 수를 넘을 수 없습니다.'); return; }
        mutate(n => values.forEach((v, i) => { n.costs[ES_COSTS[index + i][0]] = v; }));
      }} /></td><td>3!B{r}</td></tr>)}</tbody></table>{!ES_COSTS.some(([, code, label]) => `${code} ${label}`.toLocaleLowerCase().includes(costQuery.toLocaleLowerCase())) && <p className="es-empty">일치하는 비목이 없습니다. 검색어를 지우면 전체 비목을 볼 수 있습니다.</p>}</div>{costDetail}</div></>}
      {tab === 'deductions' && <><h2>기성·직접지급·선금 공제</h2><div className="es-grid">{([['paidWorkExclusion', '기성 제외액'], ['alreadyExcludedDirect', '이미 기성에 포함한 직접지급액'], ['advanceContract', '선금 대상 계약금액'], ['advancePaid', '선금 지급액'], ['priorCompletion', '선금 대상 이전 기성액'], ['otherDeduction', '기타 공제액']] as const).map(([k, label]) => <div key={k}>{field(label + ' (원)', input[k], v => mutate(n => { n[k] = v; }))}</div>)}
      <label className="es-field">월별 직접지급액 (원 · 한 줄에 한 금액)<textarea value={input.directPaid.map(esFormatNumber).join('\n')} onChange={e => mutate(n => { n.directPaid = e.target.value === '' ? [] : e.target.value.replaceAll(',', '').split('\n'); })} /></label></div></>}
      {tab === 'sources' && <><div className="es-source-actions"><button className="es-primary" onClick={() => void fetchSources()}>ES 요율정보 가져오기</button><span>조달청: 보험·부금 요율 · 대한건설협회: 노임 · ECOS: 재료지수 · 국가법령: 건강보험 대조</span></div><p className="es-access">자동조회 후 값을 직접 수정하거나 기존값을 유지할 수 있습니다. 조달청·대한건설협회 자료에는 추가 인증키가 필요 없습니다. 건강·연금은 사업주 부담률, 요양은 건강보험료 대비 비율입니다.</p>
        <div className="es-table-wrap es-source-matrix"><table><caption>기간별 원자료 · 같은 항목을 가로로 비교하고 수정하세요.</caption><thead><tr><th>항목 / 단위</th><th>입찰 기준일</th><th>직전일</th><th>현재 조정일</th></tr></thead><tbody>{['적용일', '노임 (원)', '광산품', '공산품', '전력·수도·가스·폐기물', '농림수산품', ...RATE_LABELS.map(label => label + ' 요율 (%)'), '출처·자료월·확인 메모'].map((label, row) => <tr key={label}><th scope="row">{label}</th>{(['base', 'previous', 'current'] as const).map(key => {
          const p = key === 'base' ? input.base : input[key].period;
          const value = row === 0 ? p.date : row === 1 ? p.wage : row < 6 ? p.materials[row - 2] : row < 13 ? p.rates[ES_RATE_KEYS[row - 6]] : p.source;
          const change = (v: string) => mutate(n => { const period = key === 'base' ? n.base : n[key].period; if (row === 0) period.date = v; else if (row === 1) period.wage = v; else if (row < 6) period.materials[row - 2] = v; else if (row < 13) period.rates[ES_RATE_KEYS[row - 6]] = v; else period.source = v; });
          const accessible = `${key === 'base' ? '기준일' : key === 'previous' ? '직전일' : '현재일'} ${label}`;
          return <td key={key}>{row === 1 ? <EsMoneyInput aria-label={accessible} value={value} onValueChange={change} /> : row === 13 ? <textarea aria-label={accessible} value={value} onChange={e => change(e.target.value)} /> : <input aria-label={accessible} type={row === 0 ? 'date' : 'text'} value={value} onChange={e => change(e.target.value)} />}</td>;
        })}</tr>)}</tbody></table></div>
        {(['current', 'previous'] as const).map(key => <section key={key}><h2>{key === 'current' ? '현재일' : '직전일'} 기계·표준시장단가 기간쌍</h2><p>기계경비는 공통 기종의 시간당 손료(원), 표준시장단가는 공통품목의 단가 평균(원)입니다. 비목 금액이나 등락지수를 넣는 칸이 아닙니다. 자동조회 후에도 직접 수정할 수 있습니다.</p><div className="es-table-wrap"><table><thead><tr><th>분야</th><th>기준 평균 (원)</th><th>비교 평균 (원)</th><th>공통품목 수</th><th>출처</th></tr></thead><tbody>{[input[key].machinery, ...input[key].standards].map((pair, i) => <tr key={i}><th>{pair.label}</th>{(['baseAverage', 'comparisonAverage', 'commonCount', 'source'] as const).map(k => <td key={k}>{k === 'source' ? <details><summary>출처·검토 메모</summary><textarea aria-label={`${key} ${pair.label} ${k}`} value={pair[k]} onChange={e => mutate(n => { const p = i === 0 ? n[key].machinery : n[key].standards[i - 1]; p[k] = e.target.value; })} /></details> : <EsMoneyInput data-es-pair-missing={pair[k] === '' ? 'true' : undefined} aria-label={`${key} ${pair.label} ${k}`} placeholder="자동조회 또는 직접 입력" value={pair[k]} onValueChange={value => mutate(n => { const p = i === 0 ? n[key].machinery : n[key].standards[i - 1]; p[k] = value; delete p.baseSum; delete p.comparisonSum; p.source = `${p.source} / 사용자 수동 수정 ${k}=${value || '미입력'}`.slice(-2000); })} />}</td>)}</tr>)}</tbody></table></div></section>)}
      </>}
      {tab === 'result' && <><div className="es-source-actions"><label className="es-search">비교 기간<select aria-label="계산 검토 기간" value={reviewPeriod} onChange={e => setReviewPeriod(e.target.value as 'current' | 'previous')}><option value="current">현재 조정일</option><option value="previous">직전일</option></select></label><span>{outputReady ? `v${document?.revision} 저장·계산본과 일치` : '화면 계산값 · 출력하려면 저장·계산하세요'}</span></div>{result.fatal.map(text => <div role="alert" className="es-error" key={text}>{text}<div className="es-actions"><button onClick={() => goTab('input')}>기본입력 확인</button><button onClick={() => goTab('costs')}>비목 금액 확인</button><button onClick={revealMissingSource}>원자료 확인</button><button className="es-primary" onClick={() => void fetchSources()}>ES 요율정보 가져오기</button></div></div>)}<details className="es-review-notes"><summary>계산 적용범위·검수 주의사항 ({result.warnings.length}건)</summary>{result.warnings.map(text => <p className="es-warning" key={text}>{text}</p>)}</details>
        {result[reviewPeriod] && <div className="es-review-layout"><div className="es-table-wrap es-calculation-table"><table><thead><tr>{['비목', '금액 (원)', '계수 (%)', '기준지수', '비교지수', '등락비', '조정계수 (%)'].map(t => <th key={t}>{t}</th>)}</tr></thead><tbody>{result[reviewPeriod]!.rows.map(r => <tr className={selectedRow === r.row ? 'is-selected' : ''} key={r.row}><th><button aria-pressed={selectedRow === r.row} onClick={() => setSelectedRow(r.row)}>{r.code} · {r.label}</button></th>{[r.amount, r.weight, r.base, r.comparison, r.ratio, r.adjusted].map((v, i) => <td key={i}>{i === 1 || i === 5 ? esPercent(v) : esFormatNumber(v)}</td>)}</tr>)}</tbody></table></div>{costDetail}</div>}
      </>}
      {tab === 'output' && <div className="es-output-layout"><aside className="es-output-selection"><div className="es-section-title"><h2>Excel 내보내기</h2><button onClick={() => void workingExport()}>작업용 Excel 내보내기</button></div><details><summary>작업용·제출 형식의 차이</summary><p>작업용 파일은 입력·원자료·계산 수식과 17개 출력 시트를 포함합니다. 입력을 바꾸면 ES_계산 시트의 연결 수식이 계산됩니다. 17개 출력 시트는 내보낸 시점의 값이므로, Excel 수정 후 웹으로 다시 가져와 재계산·출력하세요. Excel 자체 재계산 및 실프린터 대조는 아직 미검수입니다.</p></details>
        <div className="es-section-title"><h2>출력 시트 선택</h2><button onClick={() => setSelection(ES_SHEETS.map(s => s[0]))}>전체 선택</button><button onClick={() => setSelection([])}>선택 해제</button></div>
        <div className="es-sheet-selection">{ES_SHEETS.map(([id, name, , label]) => <label key={id}><input type="checkbox" checked={selection.includes(id)} onChange={e => setSelection(s => e.target.checked ? [...s, id] : s.filter(v => v !== id))} /><b>{name}</b><span>{label}</span></label>)}</div>
        <p className="es-field-help">제출 형식 Excel은 값 고정·선택 시트 전체를 내보냅니다. 페이지 지정은 인쇄에만 적용됩니다. 현재 출력은 검수용 초안입니다.</p>
        {!selection.length && <p className="es-warning">선택한 시트가 없습니다. 출력할 시트를 선택하세요.</p>}
        <div className="es-actions"><button disabled={!run || dirty || !selection.length || run.revision !== document?.revision} onClick={() => reportExport(true)}>전체 17시트 Excel</button><button disabled={!run || dirty || !selection.length || run.revision !== document?.revision} onClick={() => reportExport(false)}>선택 시트 Excel</button></div>
        </aside><div className="es-output-preview"><EsPrintSettingsEditor value={input.printSettings} onChange={value => mutate(n => { if (value) n.printSettings = value; else delete n.printSettings; })} />{run && !dirty && run.revision === document?.revision ? <EsPrintPreview documentId={document.id} run={run} selection={selection} /> : <div className="es-output-empty"><EsIcon path={ES_STEPS[5][3]} /><h2>출력할 저장·계산본이 필요합니다.</h2><p>현재 입력을 저장·계산한 뒤 미리보기와 출력이 열립니다.</p><button className="es-primary" disabled={busy || loading || loadFailed} onClick={() => void save(true)}>저장·계산</button><button onClick={() => goTab('result')}>부족한 입력 확인</button></div>}</div>
      </div>}
      </fieldset>
    </>}
    </div><footer className="es-summary-footer"><span>현재 K (%) <b>{esPercent(result.current?.k)}</b></span><span>직전일 K (%) <b>{esPercent(result.previous?.k)}</b></span><span>적용대가 (원)<b>{esFormatNumber(result.amount?.applicable ?? '—')}</b></span><span>선금 공제 (원)<b>{esFormatNumber(result.amount?.advance ?? '—')}</b></span><span className="es-net-amount">최종 조정금액 (원)<b>{result.status === 'INCOMPLETE' ? '계산 대기' : esFormatNumber(result.amount?.net ?? '—')}</b></span><div className="es-next-action"><small>{result.status === 'INCOMPLETE' ? '자료 확인 필요' : outputReady ? '저장·계산본 출력 가능' : '화면 계산 · 저장·계산 필요'}</small>{stepIndex < 5 ? <button onClick={() => goTab(ES_STEPS[stepIndex + 1][0])}>다음 · {ES_STEPS[stepIndex + 1][1]} →</button> : <button onClick={() => goTab('result')}>계산 검토로</button>}</div></footer>
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
            {([['title', '산출서'], ['client', '발주자'], ['contractor', '시공자'], ['baseDate', '입찰 기준일'], ['adjustmentDate', '조정기준일'], ['contractAmount', '계약금액 (원)']] as const).map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td>{(key === 'contractAmount' ? esFormatNumber(input[key]) : input[key]) || '미입력'}</td><td>{(key === 'contractAmount' ? esFormatNumber(importPreview.input[key]) : importPreview.input[key]) || '미입력'}</td></tr>)}
          </tbody></table></div>
          <p>비목 금액 변경: <strong>{ES_COSTS.filter(([r]) => input.costs[r] !== importPreview.input.costs[r]).length} / 28개</strong> · 프로젝트 연결은 유지합니다.</p>
          <p>계약정보·비목·지수/요율·선금/공제도 파일 값으로 교체합니다. 파일의 빈 값은 빈 값으로 반영됩니다.</p>
          <details><summary>세부 변경 내용 확인</summary><div className="es-import-comparison"><table><thead><tr><th scope="col">항목</th><th scope="col">현재 입력</th><th scope="col">가져올 내용</th></tr></thead><tbody>
            {ES_CONTRACT_FIELDS.map(([key, label, type]) => <tr key={key}><th scope="row">{label}</th><td>{(type === 'number' ? esFormatNumber(input.contract?.[key] ?? '') : input.contract?.[key]) || '미입력'}</td><td>{(type === 'number' ? esFormatNumber(importPreview.input.contract?.[key] ?? '') : importPreview.input.contract?.[key]) || '미입력'}</td></tr>)}
            {ES_COSTS.map(([r, code, label]) => <tr key={r}><th scope="row">{code} · {label} (원)</th><td>{esFormatNumber(input.costs[r]) || '미입력'}</td><td>{esFormatNumber(importPreview.input.costs[r]) || '미입력'}</td></tr>)}
          </tbody></table></div></details>
          <details><summary>가져오기 검수 안내 ({importPreview.warnings.length}건)</summary>{importPreview.warnings.map(w => <p className="es-warning" key={w}>{w}</p>)}</details>
        </>}
      </div>
      <footer className="es-actions"><button autoFocus disabled={busy} onClick={() => { if (!pending.current) { setImportOpen(false); setImportPreview(null); } }}>취소 · 기존 입력 유지</button><button className="es-primary" disabled={busy || loading || loadFailed || !importPreview} onClick={() => { if (importPreview) void save(false, importPreview.input); }}>{busy && importPreview ? '저장 중…' : '가져온 내용으로 저장'}</button></footer>
    </dialog>}
    {documentImportOpen && <EsDocumentImport input={input} onBusy={value => { pending.current = value; setBusy(value); }} onClose={() => setDocumentImportOpen(false)} onApply={next => { mutate(n => Object.assign(n, next)); setDocumentImportOpen(false); setNotice('선택한 원본 항목을 입력에 적용했습니다. 미분류 비목과 금액·날짜 근거를 확인한 뒤 저장·계산하세요.'); }} />}
    {sourceOpen && <dialog ref={sourceDialog} className="es-import-dialog es-source-dialog" aria-labelledby="es-source-title" onCancel={e => { e.preventDefault(); if (!pending.current) setSourceOpen(false); }}>
      <header><h2 id="es-source-title">ES 요율정보 가져오기 · 적용 전 확인</h2><p>① 공식 자료 자동조회 → ② 값·적용조건 확인 또는 수정 → ③ 입력에 적용</p><p>확인 전에는 기존 입력을 바꾸지 않습니다. 적용 후 저장·계산하세요.</p></header>
      <div className="es-import-body">{busy ? <p role="status">조달청 요율·표준시장단가 · 대한건설협회 노임·기계경비 · ECOS 재료지수 · 국가법령을 조회하고 있습니다…</p> : sourcePreview && <>
        <p role="status" className="es-notice">자동조회 {new Set(sourcePreview.automatic).size}항목 · 적용할 값은 아래에서 직접 수정할 수 있습니다. 조회되지 않은 값은 같은 적용일의 기존 입력 또는 Excel 이력을 유지합니다.</p>
        {[...new Set([sourcePreview.input.current.machinery, sourcePreview.input.previous.machinery].map(p => p.source.match(/규격 표기 변경 \d+종/)?.[0]).filter(Boolean))].map(text => <p className="es-warning" key={text}>{text} 검토 필요 — 기계경비는 분류번호 기준 자동 대조입니다. 아래 기간쌍의 ‘공표일·출처·규격 변경 확인’에서 양쪽 규격을 확인하세요.</p>)}
        {sourceErrors.length > 0 && <p role="alert" id="es-source-errors" className="es-error" tabIndex={-1}>숫자 형식을 확인하세요: {sourceErrors.join(', ')}</p>}
        <div className="es-import-comparison"><table><thead><tr><th>기간 · 항목</th><th>현재 입력</th><th>적용할 값 · 조회 상태</th></tr></thead>{(['base', 'current', 'previous'] as const).map((key, index) => {
          const current = key === 'base' ? input.base : input[key].period, proposed = key === 'base' ? sourcePreview.input.base : sourcePreview.input[key].period, label = ['기준', '현재', '직전'][index];
          return <tbody key={key}><tr className="es-source-date"><th>{label} · 적용일</th><td>{current.date || '미입력'}</td><td>{proposed.date}</td></tr>{SOURCE_FIELDS.map(([field, name]) => {
            const before = sourceValue(current, field), after = sourceValue(proposed, field), id = proposed.date + ':' + field, automatic = sourcePreview.automatic.includes(id), edited = sourcePreview.edited.includes(id);
            const invalid = edited && after !== '' && !/^\d{1,18}(?:\.\d{1,12})?$/.test(after);
            const detail = sourcePreview.details[id] || (after !== '' ? '같은 적용일의 기존 입력 또는 가져온 Excel 이력 · 공식 조회 완료를 뜻하지 않습니다.' : '자동조회 자료 미확인 · 공식 원자료를 확인하고 직접 입력하세요.');
            const link = detail.match(/https:\/\/(?:www\.pps\.go\.kr|www\.cak\.or\.kr|www\.law\.go\.kr)\/[^\s]+/)?.[0];
            return <tr key={field}><th scope="row">{label} · {name}</th><td>{esFormatNumber(before) || '미입력'}</td><td><span className="es-source-state">{automatic ? '자동조회 · 적용조건 확인' : edited ? '직접 선택·수정' : after !== '' ? '기존/Excel 값 유지' : '수동 입력 필요'}</span><EsMoneyInput aria-label={`${label} ${name} 적용할 값`} aria-invalid={invalid || undefined} aria-describedby={invalid ? 'es-source-errors' : undefined} placeholder="원자료 확인 후 입력" value={after} onValueChange={value => editSource(key, field, value)} /><div className="es-source-row-actions"><button disabled={current.date !== proposed.date} onClick={() => editSource(key, field, before, true)} aria-label={`${label} ${name} 기존값 유지`}>기존값 유지</button><details><summary>출처·조건</summary><p>{detail}</p>{link && <a href={link} target="_blank" rel="noreferrer">공식 원문 열기 ↗</a>}</details></div></td></tr>;
          })}</tbody>;
        })}</table></div>
        <details><summary>조회 안내·추가 검토 항목 ({sourcePreview.warnings.length})</summary>{sourcePreview.warnings.map((warning, i) => <p className="es-warning" key={i}>{warning}</p>)}</details>
        <h3>기계경비·표준시장단가 · 적용 전 비교</h3><p>기준 평균 → 비교 평균 (원) / 공통품목 수. 적용 후 ‘지수·요율’에서 수동 수정할 수 있습니다.</p>
        <div className="es-table-wrap"><table><thead><tr><th>기간·분야</th><th>현재 입력</th><th>조회 결과·공통 수</th></tr></thead><tbody>{(['current', 'previous'] as const).flatMap((key, j) => [sourcePreview.input[key].machinery, ...sourcePreview.input[key].standards].map((p, i) => {
          const before = i === 0 ? input[key].machinery : input[key].standards[i - 1], id = sourcePreview.input[key].period.date + ':pair' + i, automatic = sourcePreview.automatic.includes(id);
          return <tr key={key + i}><th>{j === 0 ? '현재' : '직전'} · {ES_PAIR_LABELS[i]}</th><td>{esFormatNumber(before.baseAverage) || '—'} → {esFormatNumber(before.comparisonAverage) || '—'}<br />공통 {esFormatNumber(before.commonCount) || '—'}개</td><td><span className="es-source-state">{automatic ? '공식자료 자동 대조 · 근거 검토' : p.commonCount ? '기존/Excel 값 유지' : '원자료 확인 필요'}</span>{esFormatNumber(p.baseAverage) || '—'} → {esFormatNumber(p.comparisonAverage) || '—'} / {esFormatNumber(p.commonCount) || '—'}개<details><summary>공표일·출처·규격 변경 확인</summary><p>{p.baseLabel || '—'} → {p.comparisonLabel || '—'}</p><p>{sourcePreview.details[id] || p.source || '연결된 자료 없음'}</p></details><button onClick={() => setSourcePreview(previous => { if (!previous) return previous; const next = structuredClone(previous), target = i === 0 ? next.input[key].machinery : next.input[key].standards[i - 1]; Object.assign(target, structuredClone(before)); next.automatic = next.automatic.filter(v => v !== id); next.details[id] = '기존 기간쌍 유지 · 자동조회값 미적용'; return next; })}>기존 기간쌍 유지</button></td></tr>;
        }))}</tbody></table></div>
        <details><summary>기간별 적용 근거</summary>{[sourcePreview.input.base, sourcePreview.input.current.period, sourcePreview.input.previous.period].map((p, i) => <p key={i}>{p.date} · {p.source || '출처 없음'}</p>)}</details>
        <p>동일 적용일의 기존 값은 조회 실패 시 유지합니다. 날짜가 바뀐 자료는 재사용하지 않으며 자료 없음 항목은 원자료를 확인한 뒤 저장·계산하세요.</p>
      </>}</div>
      <footer className="es-actions"><button autoFocus disabled={busy} onClick={() => setSourceOpen(false)}>취소 · 기존 유지</button><button className="es-primary" disabled={busy || !sourcePreview || sourceErrors.length > 0} onClick={() => { if (!sourcePreview || pending.current || sourceErrors.length) return; const selected = structuredClone(sourcePreview.input); for (const p of [selected.base, selected.current.period, selected.previous.period]) { const overrides = SOURCE_FIELDS.filter(([field]) => sourcePreview.edited.includes(p.date + ':' + field)).map(([field]) => `${field}=${sourceValue(p, field) || '미입력'}`); if (overrides.length) p.source = `${p.source} / 사용자 선택값(자동조회보다 우선): ${overrides.join(', ')}`.slice(-2000); } mutate(n => Object.assign(n, selected)); setSourceOpen(false); setSourcePreview(null); setNotice('조회·수정 결과를 입력에 적용했습니다. 검토 후 저장·계산하세요.'); }}>확인 · 입력에 적용</button></footer>
    </dialog>}
  </section>;
}
