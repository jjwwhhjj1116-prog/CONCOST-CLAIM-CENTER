import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../api';

interface FeeCompensationProps {
  roles: string[];
  initialCaseId?: string;
  onNavigate?: (view: string, caseId?: string) => void;
}

interface CaseOption { id: string; caseNumber: string; title: string; status: string; }
interface FeeApprover { id: string; name: string; email: string; roles: string[]; assigned: boolean; }
interface FeeSummary {
  contractAmount: string; billingDate: string; baseAmount: string; feeRateBps: number; hasSuccessFee: boolean;
  isTaxInclusive: boolean; confirmedFee: string; estimatedFee: string; totalPaid: string;
  unpaidBalance: string; status: string; version: number; caseVersion: number; caseStatus: string;
  latestEstimateId: string | null; latestEstimateActorId: string | null;
}
interface FeeConfig { contractAmount: string; billingDate: string; baseAmount: string; feeRateBps: number; hasSuccessFee: boolean; isTaxInclusive: boolean; }
interface FeeCalculation {
  id: string; calcType: 'ESTIMATED' | 'FINAL'; contractAmount: string; hasSuccessFee: boolean; billingDate: string; baseAmount: string;
  feeRateBps: number; isTaxInclusive: boolean; calculatedFee: string; taxAmount: string;
  totalClaimFee: string; formulaVersion: string; feeConfigVersion: number; sourceCalculationId?: string; createdAt: string;
  actor: { id: string; name: string; email: string };
}
interface FeePayment {
  id: string; paymentType: 'PARTIAL' | 'FULL' | 'ADJUSTMENT'; amount: string; paymentDate: string;
  invoiceStatus: string; invoiceNumber?: string; note?: string; createdAt: string;
  actor: { name: string; email: string };
}
interface FeeAudit {
  id: string; action: string; unpaidBalance: string; detailsJson: string; createdAt: string;
  actor: { name: string; email: string };
}
interface FeePayload {
  summary: FeeSummary; config: FeeConfig | null; calculations: FeeCalculation[];
  payments: FeePayment[]; audits: FeeAudit[];
}

const moneyFormatter = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });
const formatKrw = (value: string | bigint = '0') => {
  try { return moneyFormatter.format(typeof value === 'bigint' ? value : BigInt(value)); }
  catch { return '금액 오류'; }
};
const bpsLabel = (bps: number) => `${Math.trunc(bps / 100)}.${String(Math.abs(bps % 100)).padStart(2, '0')}%`;
const percentToBps = (value: string): number | null => {
  const match = value.trim().match(/^(\d{1,3})(?:\.(\d{0,2}))?$/);
  if (!match) return null;
  const parsed = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isInteger(parsed) && parsed <= 10_000 ? parsed : null;
};
export function koreaDateInputValue(value = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
const today = () => koreaDateInputValue();

export const FeeSuccessCompensation: React.FC<FeeCompensationProps> = ({ roles, initialCaseId, onNavigate }) => {
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [caseQuery, setCaseQuery] = useState('');
  const [caseSearchBusy, setCaseSearchBusy] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState(initialCaseId ?? '');
  const [loadedCaseId, setLoadedCaseId] = useState('');
  const [approvers, setApprovers] = useState<FeeApprover[]>([]);
  const [approverQuery, setApproverQuery] = useState('');
  const [selectedApproverId, setSelectedApproverId] = useState('');
  const [approverError, setApproverError] = useState('');
  const [data, setData] = useState<FeePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [contractAmount, setContractAmount] = useState('');
  const [baseAmount, setBaseAmount] = useState('');
  const [feeRatePercent, setFeeRatePercent] = useState('');
  const [hasSuccessFee, setHasSuccessFee] = useState(true);
  const [isTaxInclusive, setIsTaxInclusive] = useState(false);
  const [billingDate, setBillingDate] = useState(today());
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentType, setPaymentType] = useState<'PARTIAL' | 'FULL' | 'ADJUSTMENT'>('PARTIAL');
  const [paymentDate, setPaymentDate] = useState(today());
  const [invoiceStatus, setInvoiceStatus] = useState<'NOT_ISSUED' | 'ISSUED' | 'EXEMPT'>('NOT_ISSUED');
  const [invoiceIssuedAt, setInvoiceIssuedAt] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [showCloseModal, setShowCloseModal] = useState(false);
  const closeCancelRef = useRef<HTMLButtonElement>(null);
  const idempotencyKeysRef = useRef(new Map<string, { fingerprint: string; key: string }>());
  const caseSearchSequenceRef = useRef(0);
  const feeLoadSequenceRef = useRef(0);
  const approverLoadSequenceRef = useRef(0);
  const selectedCaseIdRef = useRef(initialCaseId ?? '');
  const approverQueryRef = useRef('');

  const canWrite = roles.some((role) => ['pm', 'director', 'ceo'].includes(role.toLowerCase()));
  const canFinalize = roles.some((role) => ['director', 'ceo'].includes(role.toLowerCase()));
  const summary = data?.summary;
  const locked = summary?.status === 'CONFIRMED';
  const caseClosed = summary?.caseStatus === 'CLOSED';
  const bps = percentToBps(feeRatePercent);
  const preview = useMemo(() => {
    if (!hasSuccessFee) return { calculatedFee: 0n, taxAmount: 0n, totalClaimFee: 0n };
    if (bps === null || !/^(0|[1-9]\d*)$/.test(baseAmount)) return null;
    const fee = (BigInt(baseAmount) * BigInt(bps) + 5_000n) / 10_000n;
    if (isTaxInclusive) {
      const calculatedFee = (fee * 10n + 5n) / 11n;
      return { calculatedFee, taxAmount: fee - calculatedFee, totalClaimFee: fee };
    }
    const taxAmount = (fee + 5n) / 10n;
    return { calculatedFee: fee, taxAmount, totalClaimFee: fee + taxAmount };
  }, [baseAmount, bps, hasSuccessFee, isTaxInclusive]);

  const stableRequestKey = useCallback((action: string, payload: Record<string, unknown>) => {
    const fingerprint = `${selectedCaseId}:${JSON.stringify(payload)}`;
    const cached = idempotencyKeysRef.current.get(action);
    if (cached?.fingerprint === fingerprint) return cached.key;
    const key = `${action}:${selectedCaseId}:${crypto.randomUUID()}`;
    idempotencyKeysRef.current.set(action, { fingerprint, key });
    return key;
  }, [selectedCaseId]);

  const resetMessages = () => { setError(''); setNotice(''); };
  const syncForm = (payload: FeePayload) => {
    const config = payload.config;
    setContractAmount(config ? config.contractAmount : '');
    setBaseAmount(config ? config.baseAmount : '');
    setFeeRatePercent(config ? bpsLabel(config.feeRateBps).replace('%', '') : '');
    setHasSuccessFee(config?.hasSuccessFee ?? true);
    setIsTaxInclusive(config?.isTaxInclusive ?? false);
    setBillingDate(config?.billingDate?.slice(0, 10) ?? today());
  };

  const selectCase = useCallback((nextCaseId: string) => {
    if (selectedCaseIdRef.current === nextCaseId) return;
    selectedCaseIdRef.current = nextCaseId;
    feeLoadSequenceRef.current += 1;
    approverLoadSequenceRef.current += 1;
    approverQueryRef.current = '';
    setSelectedCaseId(nextCaseId);
    setLoadedCaseId('');
    setData(null);
    setApprovers([]);
    setApproverQuery('');
    setSelectedApproverId('');
    setContractAmount('');
    setBaseAmount('');
    setFeeRatePercent('');
    setHasSuccessFee(true);
    setIsTaxInclusive(false);
    setBillingDate(today());
    setPaymentAmount('');
    setPaymentType('PARTIAL');
    setPaymentDate(today());
    setInvoiceStatus('NOT_ISSUED');
    setInvoiceIssuedAt('');
    setInvoiceNumber('');
    setPaymentNote('');
    setShowCloseModal(false);
    setError('');
    setNotice('');
    setApproverError('');
  }, []);

  useEffect(() => {
    const sequence = ++caseSearchSequenceRef.current;
    const timer = window.setTimeout(() => {
      setCaseSearchBusy(true);
      const query = new URLSearchParams({ assignedOnly: 'true', limit: '100' });
      if (caseQuery.trim()) query.set('q', caseQuery.trim());
      void apiRequest<{ cases: CaseOption[] }>(`/api/cases?${query.toString()}`).then((response) => {
        if (sequence !== caseSearchSequenceRef.current) return;
        const available = response.cases ?? [];
        setCases((previous) => {
          const selected = previous.find((item) => item.id === selectedCaseIdRef.current);
          return selected && !available.some((item) => item.id === selected.id) ? [selected, ...available] : available;
        });
        if (!selectedCaseIdRef.current && available[0]) selectCase(available[0].id);
      }).catch((reason) => {
        if (sequence === caseSearchSequenceRef.current) setError(reason instanceof Error ? reason.message : String(reason));
      }).finally(() => {
        if (sequence === caseSearchSequenceRef.current) setCaseSearchBusy(false);
      });
    }, caseQuery ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [caseQuery, selectCase]);

  const loadApprovers = useCallback(async () => {
    const requestCaseId = selectedCaseId;
    const requestQuery = approverQuery.trim();
    if (requestCaseId !== selectedCaseIdRef.current || requestQuery !== approverQueryRef.current.trim()) return;
    const sequence = ++approverLoadSequenceRef.current;
    if (!requestCaseId || !canWrite) {
      setApprovers([]);
      setSelectedApproverId('');
      return;
    }
    setApproverError('');
    setApprovers([]);
    setSelectedApproverId('');
    try {
      const query = new URLSearchParams();
      if (requestQuery) query.set('q', requestQuery);
      const queryString = query.toString();
      const response = await apiRequest<{ approvers: FeeApprover[] }>(`/api/cases/${encodeURIComponent(requestCaseId)}/fee-approvers${queryString ? `?${queryString}` : ''}`);
      if (sequence !== approverLoadSequenceRef.current || selectedCaseIdRef.current !== requestCaseId || approverQueryRef.current.trim() !== requestQuery) return;
      const available = response.approvers ?? [];
      setApprovers(available);
      setSelectedApproverId((current) => {
        if (available.some((item) => item.id === current)) return current;
        return available.find((item) => !item.assigned)?.id ?? available[0]?.id ?? '';
      });
    } catch (reason) {
      if (sequence !== approverLoadSequenceRef.current || selectedCaseIdRef.current !== requestCaseId || approverQueryRef.current.trim() !== requestQuery) return;
      setApprovers([]);
      setSelectedApproverId('');
      setApproverError(reason instanceof Error ? reason.message : '승인자 후보를 불러오지 못했습니다.');
    }
  }, [approverQuery, canWrite, selectedCaseId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadApprovers(); }, approverQuery ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [approverQuery, loadApprovers]);

  const loadFeeData = useCallback(async (sync = true) => {
    const requestCaseId = selectedCaseId;
    if (requestCaseId !== selectedCaseIdRef.current) return;
    const sequence = ++feeLoadSequenceRef.current;
    if (!requestCaseId) { setData(null); setLoadedCaseId(''); setLoading(false); return; }
    setLoading(true); setError('');
    setData(null); setLoadedCaseId('');
    try {
      const payload = await apiRequest<FeePayload>(`/api/cases/${encodeURIComponent(requestCaseId)}/fee-compensation`);
      if (sequence !== feeLoadSequenceRef.current || selectedCaseIdRef.current !== requestCaseId) return;
      setData(payload);
      setLoadedCaseId(requestCaseId);
      if (sync) syncForm(payload);
    } catch (reason) {
      if (sequence !== feeLoadSequenceRef.current || selectedCaseIdRef.current !== requestCaseId) return;
      setData(null);
      setLoadedCaseId('');
      setError(reason instanceof Error ? reason.message : '성공보수 데이터를 불러오지 못했습니다.');
    } finally {
      if (sequence === feeLoadSequenceRef.current && selectedCaseIdRef.current === requestCaseId) setLoading(false);
    }
  }, [selectedCaseId]);

  useEffect(() => { void loadFeeData(true); }, [loadFeeData]);
  useEffect(() => {
    if (!showCloseModal) return;
    closeCancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowCloseModal(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showCloseModal]);

  const runAction = async (name: string, action: () => Promise<void>) => {
    resetMessages(); setBusyAction(name);
    try { await action(); }
    catch (reason: unknown) {
      const err = reason as Error & { payload?: { requiresConfirmation?: boolean } };
      if (err.payload?.requiresConfirmation) setShowCloseModal(true);
      else setError(err.message || '요청 처리에 실패했습니다.');
    } finally { setBusyAction(''); }
  };

  const calculateEstimate = () => runAction('estimate', async () => {
    if (loadedCaseId !== selectedCaseId) throw new Error('선택한 사건의 최신 정산 데이터를 먼저 불러오세요.');
    if (!summary || !contractAmount || !baseAmount || !billingDate || (hasSuccessFee && bps === null)) throw new Error('계약금액·기준금액·청구일과 0~100.00% 요율을 정확히 입력하세요.');
    const payload = { contractAmount, baseAmount, feeRateBps: hasSuccessFee ? bps! : 0, hasSuccessFee, isTaxInclusive: hasSuccessFee && isTaxInclusive, billingDate, calcType: 'ESTIMATED', expectedVersion: summary.version };
    const response = await apiRequest<{ calculation: FeeCalculation }>(`/api/cases/${encodeURIComponent(selectedCaseId)}/fee-compensation/calculate`, {
      method: 'POST', body: JSON.stringify({ ...payload, idempotencyKey: stableRequestKey('fee-estimate', payload) })
    });
    setNotice(`예상 성공보수 ${formatKrw(response.calculation.totalClaimFee)}가 새 이력으로 저장되었습니다.`);
    await loadFeeData(true);
  });

  const finalizeEstimate = () => runAction('finalize', async () => {
    if (loadedCaseId !== selectedCaseId) throw new Error('선택한 사건의 최신 정산 데이터를 먼저 불러오세요.');
    if (!summary?.latestEstimateId) throw new Error('먼저 최신 예상 보수를 계산해야 합니다.');
    const payload = { calculationId: summary.latestEstimateId, expectedVersion: summary.version };
    const response = await apiRequest<{ calculation: FeeCalculation }>(`/api/cases/${encodeURIComponent(selectedCaseId)}/fee-compensation/finalize`, {
      method: 'POST', body: JSON.stringify({ ...payload, idempotencyKey: stableRequestKey('fee-finalize', payload) })
    });
    setNotice(`독립 승인으로 최종 성공보수 ${formatKrw(response.calculation.totalClaimFee)}가 확정되었습니다.`);
    await loadFeeData(true);
  });

  const addPayment = () => runAction('payment', async () => {
    if (loadedCaseId !== selectedCaseId) throw new Error('선택한 사건의 최신 정산 데이터를 먼저 불러오세요.');
    if (!summary || !paymentAmount) throw new Error('입금 또는 조정 금액을 입력하세요.');
    const payload = { amount: paymentAmount, paymentType, paymentDate, invoiceStatus, invoiceIssuedAt: invoiceStatus === 'ISSUED' ? invoiceIssuedAt : undefined, invoiceNumber: invoiceStatus === 'ISSUED' ? invoiceNumber : undefined, note: paymentNote, expectedVersion: summary.version };
    const response = await apiRequest<{ payment: FeePayment }>(`/api/cases/${encodeURIComponent(selectedCaseId)}/fee-compensation/payments`, {
      method: 'POST', body: JSON.stringify({ ...payload, idempotencyKey: stableRequestKey('fee-payment', payload) })
    });
    setPaymentAmount(''); setPaymentNote('');
    setNotice(`${paymentType === 'ADJUSTMENT' ? '수납 조정' : '입금'} ${formatKrw(response.payment.amount)}이 변경 불가 이력으로 기록되었습니다.`);
    await loadFeeData(false);
  });

  const selectedApprover = approvers.find((item) => item.id === selectedApproverId);
  const assignApprover = () => runAction('approver', async () => {
    if (loadedCaseId !== selectedCaseId) throw new Error('선택한 사건의 최신 정산 데이터를 먼저 불러오세요.');
    if (!selectedApproverId || !summary) throw new Error('배정할 Director 또는 CEO를 선택하세요.');
    const response = await apiRequest<{ assignment: { name: string }; idempotentReplay: boolean }>(`/api/cases/${encodeURIComponent(selectedCaseId)}/fee-approvers`, {
      method: 'POST', body: JSON.stringify({ userId: selectedApproverId, expectedCaseVersion: summary.caseVersion })
    });
    setNotice(response.idempotentReplay
      ? `${response.assignment.name} 승인자는 이미 이 사건에 배정되어 있습니다.`
      : `${response.assignment.name} 승인자를 사건에 공동 배정했습니다.`);
    await loadApprovers();
    await loadFeeData(false);
  });

  const closeCase = (forceClose: boolean) => runAction('close', async () => {
    if (loadedCaseId !== selectedCaseId) throw new Error('선택한 사건의 최신 정산 데이터를 먼저 불러오세요.');
    if (!summary) return;
    await apiRequest(`/api/cases/${encodeURIComponent(selectedCaseId)}/close-with-unpaid-check`, { method: 'POST', body: JSON.stringify({ forceClose, caseVersion: summary.caseVersion, feeVersion: summary.version }) });
    setShowCloseModal(false); setNotice(forceClose ? '권한자의 명시적 확인으로 미수 사건을 종결했습니다.' : '정산 완료 사건을 종결했습니다.');
    await loadFeeData(false);
  });

  return <div className="fee-page" data-testid="fee-page" data-loaded-case-id={loadedCaseId}>
    <header className="fee-hero">
      <div>
        <span className="fee-eyebrow">FEE-01 · SETTLEMENT CONTROL</span>
        <h1>비용·성공보수 정산</h1>
        <p>예상 계산 → 독립 승인 → 수납 → 미수 확인까지 한 화면에서 관리합니다.</p>
      </div>
      <button type="button" className="fee-button fee-button--ghost" onClick={() => onNavigate?.('/reports')}>보고서 목록</button>
    </header>

    <section className="fee-case-picker" aria-label="정산 대상 사건 선택">
      <label htmlFor="fee-case-search">사건 검색</label>
      <input id="fee-case-search" type="search" value={caseQuery} onChange={(event) => setCaseQuery(event.target.value)} placeholder="사건번호·사건명·당사자 검색" autoComplete="off" disabled={busyAction !== '' || showCloseModal} />
      <label htmlFor="fee-case-select">정산 대상 사건</label>
      <select id="fee-case-select" value={selectedCaseId} onChange={(event) => selectCase(event.target.value)} disabled={busyAction !== '' || showCloseModal}>
        {cases.map((item) => <option key={item.id} value={item.id}>[{item.caseNumber}] {item.title} · {item.status}</option>)}
      </select>
      {caseSearchBusy && <span className="fee-search-status" role="status">검색 중…</span>}
      {loadedCaseId === selectedCaseId && summary && <span className={`fee-status fee-status--${summary.status.toLowerCase()}`}>{summary.status === 'CONFIRMED' ? '확정됨' : '승인 대기'}</span>}
    </section>

    {loadedCaseId === selectedCaseId && summary && canWrite && !locked && !caseClosed && <section className="fee-approver-panel" aria-labelledby="fee-approver-title">
      <div>
        <span className="fee-eyebrow">INDEPENDENT APPROVAL</span>
        <h2 id="fee-approver-title">독립 승인자 공동 배정</h2>
        <p>작성자와 다른 동일 조직 Director/CEO가 사건에 배정되어야 최종 승인할 수 있습니다.</p>
      </div>
      <label>승인자 검색<input aria-label="승인자 검색" type="search" value={approverQuery} onChange={(event) => { approverQueryRef.current = event.target.value; setApproverQuery(event.target.value); }} placeholder="이름 또는 이메일" autoComplete="off" /></label>
      <label>독립 승인자<select aria-label="독립 승인자" value={selectedApproverId} onChange={(event) => setSelectedApproverId(event.target.value)}>
        {!approvers.length && <option value="">배정 가능한 승인자 없음</option>}
        {approvers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.roles.join('/').toUpperCase()}{item.assigned ? ' · 배정됨' : ''}</option>)}
      </select></label>
      <button type="button" className="fee-button fee-button--approve" disabled={!selectedApproverId || selectedApprover?.assigned || busyAction !== ''} onClick={() => void assignApprover()}>{busyAction === 'approver' ? '배정 중…' : '승인자 공동 배정'}</button>
      {approverError && <span className="fee-approver-error" role="alert">{approverError}</span>}
    </section>}

    {error && <div className="fee-alert fee-alert--error" role="alert"><strong>처리하지 못했습니다.</strong><span>{error}</span><button type="button" onClick={() => void loadFeeData(true)}>최신 데이터 다시 불러오기</button></div>}
    {notice && <div className="fee-alert fee-alert--success" role="status"><strong>완료</strong><span>{notice}</span></div>}
    {loading && <div className="fee-state" role="status">정산 데이터를 불러오는 중입니다…</div>}
    {!loading && !data && !error && <div className="fee-state">조회할 수 있는 사건이 없습니다.</div>}

    {loadedCaseId === selectedCaseId && summary && data && <>
      {caseClosed && <div className="fee-lock" role="status">종결된 사건입니다. 정산 이력은 읽기 전용이며 계산·승인·수납·승인자 배정은 서버에서도 차단됩니다.</div>}
      <section className="fee-kpis" aria-label="정산 핵심 지표">
        {[
          ['계약 금액', summary.contractAmount], ['기준 금액', summary.baseAmount], ['적용 요율', bpsLabel(summary.feeRateBps)],
          [summary.status === 'CONFIRMED' ? '확정 성공보수' : '예상 성공보수', summary.status === 'CONFIRMED' ? summary.confirmedFee : summary.estimatedFee],
          ['누적 입금', summary.totalPaid], ['미수 잔액', summary.unpaidBalance]
        ].map(([label, value], index) => <article key={label} className={`fee-kpi ${index === 5 && value !== '0' ? 'fee-kpi--warning' : ''}`}>
          <span>{label}</span><strong>{index === 2 ? value : formatKrw(value)}</strong>
          {index === 5 && value !== '0' && <small>종결 전 확인 필요</small>}
        </article>)}
      </section>

      <div className="fee-workflow">
        <section className="fee-panel" aria-labelledby="fee-calc-title">
          <div className="fee-panel-heading"><span>1</span><div><h2 id="fee-calc-title">성공보수 예상 계산</h2><p>KRW 정수·bps·원 단위 half-up</p></div></div>
          {locked && <p className="fee-lock">최종 확정된 조건은 수정할 수 없습니다. 정정은 별도 조정 이력으로 남깁니다.</p>}
          <div className="fee-form-grid">
            <label>계약 금액 (원)<input aria-label="계약 금액 (원)" inputMode="numeric" pattern="[0-9]*" value={contractAmount} onChange={(event) => setContractAmount(event.target.value)} disabled={!canWrite || locked || caseClosed} placeholder="예: 100000000" /></label>
            <label>기준 금액 (원)<input aria-label="기준 금액 (원)" inputMode="numeric" pattern="[0-9]*" value={baseAmount} onChange={(event) => setBaseAmount(event.target.value)} disabled={!canWrite || locked || caseClosed} placeholder="예: 500000000" /></label>
            <label>요율 (%)<input aria-label="성공보수 요율 (%)" inputMode="decimal" value={feeRatePercent} onChange={(event) => setFeeRatePercent(event.target.value)} disabled={!canWrite || locked || caseClosed || !hasSuccessFee} placeholder="0.00 ~ 100.00" /><small>{bps === null ? '소수 둘째 자리까지 입력' : `${bps.toLocaleString('ko-KR')} bps`}</small></label>
            <label>청구일<input aria-label="청구일" type="date" value={billingDate} onChange={(event) => setBillingDate(event.target.value)} disabled={!canWrite || locked || caseClosed} /></label>
            <div className="fee-checks"><label><input type="checkbox" checked={hasSuccessFee} onChange={(event) => { setHasSuccessFee(event.target.checked); if (!event.target.checked) setIsTaxInclusive(false); }} disabled={!canWrite || locked || caseClosed} /> 성공보수 적용</label><label><input type="checkbox" checked={isTaxInclusive} onChange={(event) => setIsTaxInclusive(event.target.checked)} disabled={!canWrite || locked || caseClosed || !hasSuccessFee} /> 부가세 포함 금액</label></div>
          </div>
          <div className="fee-preview"><span>현재 입력 예상 청구액</span><strong>{preview === null ? '입력 확인 필요' : formatKrw(preview.totalClaimFee)}</strong>{preview && <small>공급가 {formatKrw(preview.calculatedFee)} · 부가세 {formatKrw(preview.taxAmount)}</small>}<small>부가세 {isTaxInclusive ? '포함 역산' : '별도 10%'} · 원 단위 반올림</small></div>
          <div className="fee-actions">
            <button type="button" className="fee-button fee-button--primary" disabled={!canWrite || locked || caseClosed || busyAction !== ''} onClick={() => void calculateEstimate()}>{busyAction === 'estimate' ? '저장 중…' : '예상 보수 새 이력 저장'}</button>
            <button type="button" className="fee-button fee-button--approve" disabled={!canFinalize || locked || caseClosed || !summary.latestEstimateId || busyAction !== ''} onClick={() => void finalizeEstimate()}>{busyAction === 'finalize' ? '승인 중…' : '최신 예상 보수 독립 승인'}</button>
          </div>
          {!canFinalize && summary.latestEstimateId && !locked && <p className="fee-help">Director/CEO가 작성자와 분리된 계정으로 최종 승인해야 합니다.</p>}
        </section>

        <section className="fee-panel" aria-labelledby="fee-payment-title">
          <div className="fee-panel-heading"><span>2</span><div><h2 id="fee-payment-title">수납·세금계산서</h2><p>확정 금액 범위 내 append-only 기록</p></div></div>
          {!locked && <p className="fee-lock">성공보수 최종 승인 후 수납을 기록할 수 있습니다.</p>}
          <div className="fee-form-grid">
            <label>금액 (원)<input aria-label="수납 금액 (원)" inputMode="numeric" pattern="[0-9]*" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} disabled={!canWrite || !locked || caseClosed} placeholder="1원 이상" /></label>
            <label>수납일<input aria-label="수납일" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} disabled={!canWrite || !locked || caseClosed} /></label>
            <label>기록 유형<select aria-label="수납 기록 유형" value={paymentType} onChange={(event) => setPaymentType(event.target.value as typeof paymentType)} disabled={!canWrite || !locked || caseClosed}><option value="PARTIAL">부분 입금</option><option value="FULL">완납</option><option value="ADJUSTMENT">입금 취소·조정</option></select><small>조정은 양수 금액으로 기존 입금을 차감합니다.</small></label>
            <label>세금계산서<select aria-label="세금계산서 상태" value={invoiceStatus} onChange={(event) => setInvoiceStatus(event.target.value as typeof invoiceStatus)} disabled={!canWrite || !locked || caseClosed}><option value="NOT_ISSUED">미발행</option><option value="ISSUED">발행 완료</option><option value="EXEMPT">면세·해당없음</option></select></label>
            {invoiceStatus === 'ISSUED' && <><label>발행일<input aria-label="세금계산서 발행일" type="date" value={invoiceIssuedAt} onChange={(event) => setInvoiceIssuedAt(event.target.value)} disabled={!canWrite || !locked || caseClosed} /></label><label>승인번호<input aria-label="세금계산서 승인번호" value={invoiceNumber} maxLength={120} onChange={(event) => setInvoiceNumber(event.target.value)} disabled={!canWrite || !locked || caseClosed} /></label></>}
            <label className="fee-field-wide">적요<input aria-label="수납 적요" value={paymentNote} maxLength={1000} onChange={(event) => setPaymentNote(event.target.value)} disabled={!canWrite || !locked || caseClosed} placeholder="합성 식별정보만 입력" /></label>
          </div>
          <div className="fee-actions"><button type="button" className="fee-button fee-button--primary" disabled={!canWrite || !locked || caseClosed || busyAction !== ''} onClick={() => void addPayment()}>{busyAction === 'payment' ? '기록 중…' : '수납 이력 기록'}</button><button type="button" className="fee-button fee-button--danger" disabled={!canWrite || summary.caseStatus !== 'SUCCESS_FEE' || busyAction !== ''} onClick={() => void closeCase(false)}>사건 종결 확인</button></div>
          {summary.caseStatus !== 'SUCCESS_FEE' && <p className="fee-help">현재 사건 단계: {summary.caseStatus}. SUCCESS_FEE 단계에서만 종결할 수 있습니다.</p>}
        </section>
      </div>

      <section className="fee-history" aria-labelledby="fee-history-title">
        <div className="fee-history-heading"><div><span className="fee-eyebrow">APPEND-ONLY LEDGER</span><h2 id="fee-history-title">계산·승인·수납 이력</h2></div><span>{data.calculations.length + data.payments.length + data.audits.length}건</span></div>
        <details open><summary>계산·승인 이력 ({data.calculations.length})</summary><div className="fee-table-scroll"><table><thead><tr><th>등록일시</th><th>청구일</th><th>구분</th><th>기준금액</th><th>요율</th><th>공급가</th><th>부가세</th><th>총액</th><th>처리자</th></tr></thead><tbody>{data.calculations.length ? data.calculations.map((item) => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString('ko-KR')}</td><td>{new Date(item.billingDate).toLocaleDateString('ko-KR')}</td><td><span className={`fee-status fee-status--${item.calcType.toLowerCase()}`}>{item.calcType === 'FINAL' ? '최종 승인' : '예상'}</span></td><td>{formatKrw(item.baseAmount)}</td><td>{bpsLabel(item.feeRateBps)}</td><td>{formatKrw(item.calculatedFee)}</td><td>{formatKrw(item.taxAmount)}</td><td><strong>{formatKrw(item.totalClaimFee)}</strong></td><td>{item.actor.name}</td></tr>) : <tr><td colSpan={9} className="fee-empty-cell">계산 이력이 없습니다.</td></tr>}</tbody></table></div></details>
        <details open><summary>수납·조정 이력 ({data.payments.length})</summary><div className="fee-table-scroll"><table><thead><tr><th>수납일</th><th>구분</th><th>금액</th><th>계산서</th><th>승인번호</th><th>적요</th><th>처리자</th></tr></thead><tbody>{data.payments.length ? data.payments.map((item) => <tr key={item.id}><td>{new Date(item.paymentDate).toLocaleDateString('ko-KR')}</td><td>{item.paymentType}</td><td className={item.paymentType === 'ADJUSTMENT' ? 'fee-negative' : ''}>{item.paymentType === 'ADJUSTMENT' ? '−' : ''}{formatKrw(item.amount)}</td><td>{item.invoiceStatus}</td><td>{item.invoiceNumber || '—'}</td><td>{item.note || '—'}</td><td>{item.actor.name}</td></tr>) : <tr><td colSpan={7} className="fee-empty-cell">수납 이력이 없습니다.</td></tr>}</tbody></table></div></details>
        <details><summary>감사·종결 로그 ({data.audits.length})</summary><div className="fee-table-scroll"><table><thead><tr><th>일시</th><th>행위</th><th>당시 미수</th><th>처리자</th></tr></thead><tbody>{data.audits.map((item) => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString('ko-KR')}</td><td>{item.action}</td><td>{formatKrw(item.unpaidBalance)}</td><td>{item.actor.name}</td></tr>)}</tbody></table></div></details>
      </section>
    </>}

    {showCloseModal && <div className="fee-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCloseModal(false); }}><section className="fee-modal" role="dialog" aria-modal="true" aria-labelledby="fee-close-title"><span className="fee-modal-icon" aria-hidden="true">!</span><h2 id="fee-close-title">미수금이 남아 있습니다</h2><p>현재 미수 잔액은 <strong>{formatKrw(summary?.unpaidBalance)}</strong>입니다. 권한자의 강제 종결은 감사 로그에 영구 기록됩니다.</p><div className="fee-actions"><button ref={closeCancelRef} type="button" className="fee-button fee-button--ghost-dark" onClick={() => setShowCloseModal(false)}>계속 정산</button>{canFinalize && <button type="button" className="fee-button fee-button--danger" onClick={() => void closeCase(true)}>미수 상태로 강제 종결</button>}</div>{!canFinalize && <p className="fee-help">Director/CEO만 강제 종결할 수 있습니다.</p>}</section></div>}
  </div>;
};
