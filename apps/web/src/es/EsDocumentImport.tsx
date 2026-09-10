import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api';
import { newEsContract, type EsInput } from '../../../../packages/document-engine/src/es-calculation';
import type { EsCostImportPreview } from './es-cost-import';
import { esFormatNumber } from './EsMoneyInput';
import { validateEsContractImport, type EsContractImportPreview } from '../../../../packages/document-engine/src/es-contract-import';

type ContractPreview = EsContractImportPreview;
const labels = { contractAmount: '총계약금액 (원)', baseDate: '입찰 기준일', contractDate: '계약일' };
const describe = (value?: string) => ({ INCLUDED: 'VAT 포함', EXCLUDED: 'VAT 별도', ORIGINAL: '당초', AMENDED: '변경', UNSPECIFIED: '미확인' }[value ?? ''] ?? '');

/** Separate from the full ES workbook restore: only explicitly checked fields change. */
export function EsDocumentImport({ input, onApply, onClose, onBusy }: { input: EsInput; onApply: (next: EsInput) => void; onClose: () => void; onBusy: (busy: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), pending = useRef(false);
  const [file, setFile] = useState<File>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [consent, setConsent] = useState(false), [costs, setCosts] = useState<EsCostImportPreview>(), [contract, setContract] = useState<ContractPreview>();
  const [choiceId, setChoiceId] = useState(''), [rows, setRows] = useState<number[]>([]), [amount, setAmount] = useState(false);
  const [fields, setFields] = useState<string[]>([]);
  const choice = costs?.choices.find(c => c.id === choiceId);
  useEffect(() => { const before = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => { dialog.current?.close(); before?.focus(); }; }, []);
  const read = async () => {
    if (!file || pending.current) return;
    pending.current = true; setBusy(true); onBusy(true); setError(''); setCosts(undefined); setContract(undefined); setRows([]); setFields([]); setAmount(false); setChoiceId('');
    try {
      if (file.size > 20_000_000) throw new Error('20MB 이하 파일을 선택하세요. 계약서가 크면 필요한 페이지를 별도 PDF로 저장해 선택하세요.');
      if (/\.pdf$/i.test(file.name)) {
        if (!consent) throw new Error('PDF 외부 AI 전송에 동의한 뒤 읽기를 눌러 주세요.');
        const settings = await apiRequest<{ configured: boolean; externalAiAllowed: boolean }>('/api/es/import/contract');
        if (!settings.configured || !settings.externalAiAllowed) throw new Error('현재 서버의 조직 공용 Gemini 키와 유료·비학습 정책 승인이 필요합니다. 관리자 설정을 확인하세요. PDF는 전송하지 않았습니다.');
        const form = new FormData(); form.set('file', file); form.set('consent', 'true');
        const result = await apiRequest<{ preview: ContractPreview }>('/api/es/import/contract', { method: 'POST', body: form, timeoutMs: 75_000 });
        setContract(validateEsContractImport(result.preview));
      } else if (/\.xlsx?$/i.test(file.name)) {
        const { parseEsCostWorkbook } = await import('./es-cost-import');
        const preview = parseEsCostWorkbook(new Uint8Array(await file.arrayBuffer()), file.name);
        setCosts(preview);
        if (preview.choices.length === 1) { setChoiceId(preview.choices[0].id); setRows(preview.choices[0].costs.map(c => c.row)); }
      } else throw new Error('원가계산서 XLS/XLSX 또는 도급계약서 PDF를 선택하세요.');
    } catch (e) { setError(e instanceof Error ? e.message : '파일을 읽지 못했습니다. 원본 형식과 관리자 API 설정을 확인하세요.'); }
    finally { pending.current = false; setBusy(false); onBusy(false); }
  };
  const apply = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); onBusy(true); setError('');
    try {
    let next = structuredClone(input);
    if (choice) {
      const { applyEsCostChoice } = await import('./es-cost-import');
      next = applyEsCostChoice(input, choice, rows, amount);
    } else if (contract) {
      next.contract ??= newEsContract();
      for (const field of fields as (keyof typeof labels)[]) {
        const candidate = contract[field]; if (!candidate) continue;
        if (field === 'contractDate') next.contract.contractDate = candidate.value;
        else next[field] = candidate.value;
        if (field === 'contractAmount' && 'vat' in candidate && candidate.vat !== 'UNSPECIFIED') next.contract.vatMode = describe(candidate.vat);
      }
    }
    onApply(next);
    } catch (e) { setError(e instanceof Error ? e.message : '적용하지 못했습니다. 원본과 선택 항목을 확인하세요.'); }
    finally { pending.current = false; setBusy(false); onBusy(false); }
  };
  return <dialog ref={dialog} className="es-import-dialog es-document-import" aria-labelledby="es-document-import-title" onCancel={e => { e.preventDefault(); if (!pending.current) onClose(); }}>
    <header><h2 id="es-document-import-title">계약서·원가계산서에서 가져오기</h2><p>파일 읽기 → 당초·변경 선택 → 근거 확인 → 선택 항목 적용. 기존 산출서는 자동 저장하지 않습니다.</p></header>
    <div className="es-import-body">
      <label className="es-field">원본 파일 (20MB 이하)<input type="file" accept=".xls,.xlsx,.pdf" disabled={busy} onChange={e => { setFile(e.target.files?.[0]); setCosts(undefined); setContract(undefined); setConsent(false); setError(''); }} /></label>
      <p>Excel은 이 브라우저에서 셀의 숫자를 직접 읽습니다. 스캔 PDF는 조직 공용 Gemini가 인식하며, 원문 페이지와 반드시 대조해야 합니다.</p>
      {file && /\.pdf$/i.test(file.name) && <label className="es-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />계약 PDF를 조직 공용 Gemini로 전송하는 데 동의합니다. 유료·비학습 정책 승인이 필요하며 API 사용료가 발생할 수 있습니다. 서버에 원본 파일을 저장하지 않습니다.</label>}
      <button className="es-primary" disabled={!file || busy || (/\.pdf$/i.test(file.name) && !consent)} onClick={() => void read()}>{busy ? '원본을 읽고 있습니다…' : '파일 읽기 · 적용 전 확인'}</button>
      {error && <p role="alert" className="es-error">{error}</p>}
      {costs && <>
        <label className="es-field">가져올 원가 열<select value={choiceId} onChange={e => { const c = costs.choices.find(c => c.id === e.target.value); setChoiceId(e.target.value); setRows(c?.costs.map(r => r.row) ?? []); setAmount(false); }}><option value="">당초·변경과 총괄 시트를 선택하세요</option>{costs.choices.map(c => <option key={c.id} value={c.id}>{c.sheetName} · {c.columnLabel} ({c.column}열)</option>)}</select></label>
        {costs.warnings.map((w, i) => <p className="es-warning" key={i}>{w}</p>)}
        {choice && <>
          <div className="es-table-wrap"><table><thead><tr><th>적용</th><th>비목</th><th>현재 금액 (원)</th><th>원본 금액 (원)</th><th>근거 셀</th></tr></thead><tbody>{choice.costs.map(c => <tr key={c.row}><td><input type="checkbox" aria-label={`${c.label} 적용`} checked={rows.includes(c.row)} onChange={e => setRows(v => e.target.checked ? [...v, c.row] : v.filter(r => r !== c.row))} /></td><th>{c.label}</th><td>{esFormatNumber(input.costs[c.row])}</td><td>{esFormatNumber(c.amount)}</td><td>{c.cell} · {c.sourceLabel}{c.formula && ' (수식 저장값)'}</td></tr>)}</tbody></table></div>
          {choice.contractAmount && <label className="es-consent"><input type="checkbox" checked={amount} onChange={e => setAmount(e.target.checked)} />총계약금액도 교체: {esFormatNumber(input.contractAmount) || '미입력'} → {esFormatNumber(choice.contractAmount.amount)}원 · {choice.contractAmount.cell} {choice.contractAmount.label} (계약서 금액·VAT 포함 여부 대조)</label>}
          {choice.warnings.map((w, i) => <p className="es-warning" key={i}>{w}</p>)}
          <h3>자동 분류하지 않은 원가</h3><p>아래 원가를 임의 배분하거나 0으로 만들지 않습니다. 재료 상세내역 등으로 비목을 확인하세요. 선택하지 않은 기존 비목은 유지됩니다.</p>
          {choice.unmapped.map((c, i) => <p className="es-warning" key={i}>{c.cell} · {c.label}: {c.amount === null ? '값 미확인' : esFormatNumber(c.amount) + '원'} — {c.reason}</p>)}
        </>}
      </>}
      {contract && <><p className="es-warning">AI 인식은 확정값이 아닙니다. 계약 변경 차수·VAT·입찰 기준일을 원본과 대조한 항목만 선택하세요. 계약일을 입찰일로 대신 넣지 않습니다.</p><div className="es-table-wrap"><table><thead><tr><th>적용</th><th>항목</th><th>현재 값 → 인식 후보</th><th>원문 근거</th></tr></thead><tbody>{(Object.keys(labels) as (keyof typeof labels)[]).map(key => { const c = contract[key]; return <tr key={key}><td><input type="checkbox" disabled={!c} aria-label={`${labels[key]} 적용`} checked={fields.includes(key)} onChange={e => setFields(v => e.target.checked ? [...v, key] : v.filter(k => k !== key))} /></td><th>{labels[key]}</th><td>{key === 'contractAmount' ? esFormatNumber(input[key]) : key === 'contractDate' ? input.contract?.contractDate : input[key]} → {c ? (key === 'contractAmount' ? esFormatNumber(c.value) + '원' : c.value) : '근거 미확인 · 기존 유지'}<br />{describe(c && 'basis' in c ? c.basis : undefined)} {describe(c && 'vat' in c ? c.vat : undefined)}</td><td>{c && <>{c.page}쪽 · {c.quote}</>}</td></tr>; })}</tbody></table></div>{contract.warnings.map((w, i) => <p key={i} className="es-warning">{w}</p>)}</>}
    </div>
    <footer className="es-actions"><button disabled={busy} onClick={onClose}>취소 · 기존 유지</button><button className="es-primary" disabled={busy || (!choice && !contract) || !(rows.length || amount || fields.length)} onClick={() => void apply()}>확인한 항목만 입력에 적용</button></footer>
  </dialog>;
}
