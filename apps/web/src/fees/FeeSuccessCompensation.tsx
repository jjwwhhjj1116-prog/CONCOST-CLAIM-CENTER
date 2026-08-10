import React, { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '../api';

interface FeeCompensationProps {
  roles: string[];
  initialCaseId?: string;
  onNavigate?: (view: string, caseId?: string) => void;
}

interface CaseOption {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
}

interface FeeSummary {
  contractAmount: string;
  baseAmount: string;
  feeRateBps: number;
  hasSuccessFee: boolean;
  isTaxInclusive: boolean;
  confirmedFee: string;
  estimatedFee: string;
  totalPaid: string;
  unpaidBalance: string;
  status: string;
}

interface FeeCalculation {
  id: string;
  calcType: 'ESTIMATED' | 'FINAL';
  contractAmount: string;
  baseAmount: string;
  feeRateBps: number;
  isTaxInclusive: boolean;
  calculatedFee: string;
  taxAmount: string;
  totalClaimFee: string;
  formulaVersion: string;
  createdAt: string;
  actor: { name: string; email: string };
}

interface FeePayment {
  id: string;
  paymentType: string;
  amount: string;
  paymentDate: string;
  invoiceStatus: string;
  invoiceNumber?: string;
  note?: string;
  createdAt: string;
  actor: { name: string; email: string };
}

interface FeeAudit {
  id: string;
  action: string;
  unpaidBalance: string;
  detailsJson: string;
  createdAt: string;
  actor: { name: string; email: string };
}

export const FeeSuccessCompensation: React.FC<FeeCompensationProps> = ({ roles, initialCaseId, onNavigate }) => {
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>(initialCaseId || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Fee state
  const [summary, setSummary] = useState<FeeSummary | null>(null);
  const [calculations, setCalculations] = useState<FeeCalculation[]>([]);
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [audits, setAudits] = useState<FeeAudit[]>([]);

  // Calculation Form
  const [contractAmount, setContractAmount] = useState<string>('100000000');
  const [baseAmount, setBaseAmount] = useState<string>('500000000');
  const [feeRatePercent, setFeeRatePercent] = useState<string>('5.0');
  const [isTaxInclusive, setIsTaxInclusive] = useState<boolean>(false);
  const [hasSuccessFee, setHasSuccessFee] = useState<boolean>(true);

  // Payment Form
  const [paymentAmount, setPaymentAmount] = useState<string>('10000000');
  const [paymentType, setPaymentType] = useState<'PARTIAL' | 'FULL' | 'ADJUSTMENT'>('PARTIAL');
  const [invoiceStatus, setInvoiceStatus] = useState<'NOT_ISSUED' | 'ISSUED' | 'EXEMPT'>('ISSUED');
  const [invoiceNumber, setInvoiceNumber] = useState<string>('INV-2026-001');
  const [paymentNote, setPaymentNote] = useState<string>('1차 부분 수납 완료');

  // Close Confirmation Modal
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [unpaidToClose, setUnpaidToClose] = useState<string>('0');

  const canWrite = roles.some((r) => ['admin', 'pm', 'director', 'ceo'].includes(r));
  const canFinalize = roles.some((r) => ['admin', 'director', 'ceo'].includes(r));

  // Load Cases
  useEffect(() => {
    apiRequest<{ cases: CaseOption[] }>('/api/cases')
      .then((res) => {
        setCases(res.cases || []);
        if (!selectedCaseId && res.cases && res.cases.length > 0) {
          setSelectedCaseId(res.cases[0].id);
        }
      })
      .catch((err) => setError(err.message));
  }, []);

  // Load Fee Data for selected case
  const loadFeeData = useCallback(async () => {
    if (!selectedCaseId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{
        summary: FeeSummary;
        calculations: FeeCalculation[];
        payments: FeePayment[];
        audits: FeeAudit[];
        config: any;
      }>(`/api/cases/${encodeURIComponent(selectedCaseId)}/fee-compensation`);

      setSummary(data.summary);
      setCalculations(data.calculations);
      setPayments(data.payments);
      setAudits(data.audits);

      if (data.config) {
        setContractAmount(data.config.contractAmount || '0');
        setBaseAmount(data.config.baseAmount || '0');
        setFeeRatePercent(((data.config.feeRateBps || 0) / 100).toFixed(2));
        setIsTaxInclusive(data.config.isTaxInclusive);
        setHasSuccessFee(data.config.hasSuccessFee);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '비용/성공보수 데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [selectedCaseId]);

  useEffect(() => {
    loadFeeData();
  }, [loadFeeData]);

  // Format currency
  const formatKrw = (valStr?: string | bigint | number) => {
    if (valStr === undefined || valStr === null) return '0원';
    const num = typeof valStr === 'bigint' ? Number(valStr) : Number(valStr);
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(num);
  };

  // Calculate Handler
  const handleCalculate = async (calcType: 'ESTIMATED' | 'FINAL') => {
    if (!selectedCaseId) return;
    setNotice(null);
    setError(null);

    const bps = Math.round(parseFloat(feeRatePercent || '0') * 100);
    try {
      const res = await apiRequest<{ calculation: FeeCalculation; idempotentReplay: boolean }>(
        `/api/cases/${encodeURIComponent(selectedCaseId)}/fee-compensation/calculate`,
        {
          method: 'POST',
          body: JSON.stringify({
            contractAmount,
            baseAmount,
            feeRateBps: bps,
            hasSuccessFee,
            isTaxInclusive,
            calcType,
            idempotencyKey: `CALC-${selectedCaseId}-${calcType}-${Date.now()}`
          })
        }
      );
      setNotice(
        calcType === 'FINAL'
          ? `최종 성공보수가 확정되었습니다! (청구 총액: ${formatKrw(res.calculation.totalClaimFee)})`
          : `예상 성공보수가 계산되었습니다. (청구 총액: ${formatKrw(res.calculation.totalClaimFee)})`
      );
      await loadFeeData();
    } catch (err) {
      setError(err instanceof Error ? err.message : '성공보수 계산에 실패했습니다.');
    }
  };

  // Add Payment Handler
  const handleAddPayment = async () => {
    if (!selectedCaseId) return;
    setNotice(null);
    setError(null);
    try {
      const res = await apiRequest<{ payment: FeePayment }>(
        `/api/cases/${encodeURIComponent(selectedCaseId)}/fee-compensation/payments`,
        {
          method: 'POST',
          body: JSON.stringify({
            amount: paymentAmount,
            paymentType,
            invoiceStatus,
            invoiceNumber,
            note: paymentNote,
            idempotencyKey: `PAY-${selectedCaseId}-${Date.now()}`
          })
        }
      );
      setNotice(`수납 내역이 추가되었습니다. (입금액: ${formatKrw(res.payment.amount)})`);
      await loadFeeData();
    } catch (err) {
      setError(err instanceof Error ? err.message : '수납 내역 등록에 실패했습니다.');
    }
  };

  // Close Case with Unpaid Check
  const handleAttemptCloseCase = async (force = false) => {
    if (!selectedCaseId) return;
    setNotice(null);
    setError(null);
    try {
      await apiRequest(`/api/cases/${encodeURIComponent(selectedCaseId)}/close-with-unpaid-check`, {
        method: 'POST',
        body: JSON.stringify({ forceClose: force })
      });
      setShowCloseModal(false);
      setNotice(force ? '미수금이 존재하는 상태로 사건이 종결 처리되었습니다.' : '사건이 정상적으로 종결되었습니다.');
      await loadFeeData();
    } catch (err: any) {
      if (err?.details?.requiresConfirmation) {
        setUnpaidToClose(err.details.unpaidBalance || '0');
        setShowCloseModal(true);
      } else {
        setError(err.message || '사건 종결 처리에 실패했습니다.');
      }
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1440px', margin: '0 auto', fontFamily: 'sans-serif', color: '#1f2937' }}>
      {/* Header & Case Selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 4px 0', color: '#111827' }}>FEE-01 손해사정 비용 & 성공보수 정산 관리</h1>
          <p style={{ margin: 0, fontSize: '14px', color: '#6b7280' }}>
            계약금액, 성공보수 요율 산정, 부가세 정산, 수납 내역 및 미수금 관리 수직 흐름
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {onNavigate && (
            <button
              onClick={() => onNavigate('/reports')}
              style={{ padding: '8px 12px', backgroundColor: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
            >
              ← 목록으로
            </button>
          )}
          <label htmlFor="case-select-dropdown" style={{ fontSize: '14px', fontWeight: 600 }}>대상 사건:</label>
          <select
            id="case-select-dropdown"
            value={selectedCaseId}
            onChange={(e) => setSelectedCaseId(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '14px', minWidth: '280px' }}
          >
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                [{c.caseNumber}] {c.title} ({c.status})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div style={{ padding: '12px 16px', backgroundColor: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', borderRadius: '6px', marginBottom: '16px' }}>
          ⚠️ <strong>오류:</strong> {error}
        </div>
      )}
      {notice && (
        <div style={{ padding: '12px 16px', backgroundColor: '#f0fdf4', border: '1px solid #86efac', color: '#166534', borderRadius: '6px', marginBottom: '16px' }}>
          ✅ <strong>알림:</strong> {notice}
        </div>
      )}

      {loading && <div style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>데이터 로딩 중...</div>}

      {summary && (
        <>
          {/* Top KPI Cards (1440px / 1024px Grid) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>계약 금액</div>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#1f2937' }}>{formatKrw(summary.contractAmount)}</div>
            </div>

            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>기준 금액 (착수/사정액)</div>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#1f2937' }}>{formatKrw(summary.baseAmount)}</div>
            </div>

            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>적용 요율</div>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#2563eb' }}>{(summary.feeRateBps / 100).toFixed(2)}%</div>
            </div>

            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>확정/예상 청구보수</div>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: summary.confirmedFee !== '0' ? '#059669' : '#d97706' }}>
                {summary.confirmedFee !== '0' ? formatKrw(summary.confirmedFee) : formatKrw(summary.estimatedFee)}
              </div>
              <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', backgroundColor: summary.status === 'CONFIRMED' ? '#d1fae5' : '#fef3c7', color: summary.status === 'CONFIRMED' ? '#065f46' : '#92400e' }}>
                {summary.status === 'CONFIRMED' ? '최종 확정됨' : '초안/예상 상태'}
              </span>
            </div>

            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>누적 입금액</div>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#059669' }}>{formatKrw(summary.totalPaid)}</div>
            </div>

            <div style={{ backgroundColor: summary.unpaidBalance !== '0' ? '#fff1f2' : '#f0fdf4', border: `1px solid ${summary.unpaidBalance !== '0' ? '#fecdd3' : '#bbf7d0'}`, borderRadius: '8px', padding: '16px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: '12px', color: summary.unpaidBalance !== '0' ? '#9f1239' : '#166534', marginBottom: '4px' }}>미수 잔액</div>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: summary.unpaidBalance !== '0' ? '#e11d48' : '#16a34a' }}>
                {formatKrw(summary.unpaidBalance)}
              </div>
              {summary.unpaidBalance !== '0' && <span style={{ fontSize: '11px', color: '#be123c', fontWeight: 600 }}>⚠️ 미수금 청구 필요</span>}
            </div>
          </div>

          {/* Body Section: Calculation Form & Payment Form Side by Side */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px', marginBottom: '32px' }}>
            {/* Success Fee Calculation Box */}
            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 'bold', color: '#111827', borderBottom: '1px solid #f3f4f6', paddingBottom: '8px' }}>
                1. 성공보수 요율 산정 및 확정
              </h3>

              <div style={{ display: 'grid', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>계약 금액 (원):</label>
                  <input
                    type="number"
                    value={contractAmount}
                    onChange={(e) => setContractAmount(e.target.value)}
                    disabled={!canWrite}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '14px', boxSizing: 'border-box' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>기준 금액 (착수/사정액 원):</label>
                  <input
                    type="number"
                    value={baseAmount}
                    onChange={(e) => setBaseAmount(e.target.value)}
                    disabled={!canWrite}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '14px', boxSizing: 'border-box' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>성공보수 요율 (%):</label>
                  <input
                    type="number"
                    step="0.01"
                    value={feeRatePercent}
                    onChange={(e) => setFeeRatePercent(e.target.value)}
                    disabled={!canWrite}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '14px', boxSizing: 'border-box' }}
                  />
                  <span style={{ fontSize: '12px', color: '#6b7280' }}>
                    변환: {Math.round(parseFloat(feeRatePercent || '0') * 100)} basis points (bps)
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="checkbox"
                      checked={hasSuccessFee}
                      onChange={(e) => setHasSuccessFee(e.target.checked)}
                      disabled={!canWrite}
                    />
                    성공보수 적용
                  </label>

                  <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="checkbox"
                      checked={isTaxInclusive}
                      onChange={(e) => setIsTaxInclusive(e.target.checked)}
                      disabled={!canWrite}
                    />
                    부가세 포함 가격
                  </label>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button
                    onClick={() => handleCalculate('ESTIMATED')}
                    disabled={!canWrite}
                    style={{ flex: 1, padding: '10px 14px', backgroundColor: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: canWrite ? 'pointer' : 'not-allowed', opacity: canWrite ? 1 : 0.6 }}
                  >
                    예상 보수 계산 (PM/Admin)
                  </button>

                  <button
                    onClick={() => handleCalculate('FINAL')}
                    disabled={!canFinalize}
                    style={{ flex: 1, padding: '10px 14px', backgroundColor: '#059669', color: '#ffffff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: canFinalize ? 'pointer' : 'not-allowed', opacity: canFinalize ? 1 : 0.6 }}
                  >
                    최종 보수 승인 확정 (CEO/Director)
                  </button>
                </div>
              </div>
            </div>

            {/* Payment Record Box */}
            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 'bold', color: '#111827', borderBottom: '1px solid #f3f4f6', paddingBottom: '8px' }}>
                2. 입금 수납 및 세금계산서 관리
              </h3>

              <div style={{ display: 'grid', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>입금 금액 (원):</label>
                  <input
                    type="number"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    disabled={!canWrite}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '14px', boxSizing: 'border-box' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>수납 구분:</label>
                    <select
                      value={paymentType}
                      onChange={(e) => setPaymentType(e.target.value as any)}
                      disabled={!canWrite}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '14px' }}
                    >
                      <option value="PARTIAL">부분 입금</option>
                      <option value="FULL">완납</option>
                      <option value="ADJUSTMENT">정정/환불 (-)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>세금계산서 상태:</label>
                    <select
                      value={invoiceStatus}
                      onChange={(e) => setInvoiceStatus(e.target.value as any)}
                      disabled={!canWrite}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '14px' }}
                    >
                      <option value="NOT_ISSUED">미발행</option>
                      <option value="ISSUED">발행 완료</option>
                      <option value="EXEMPT">면세/해당없음</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>세금계산서 승인/식별번호:</label>
                  <input
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    disabled={!canWrite}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '14px', boxSizing: 'border-box' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>적요/비고:</label>
                  <input
                    type="text"
                    value={paymentNote}
                    onChange={(e) => setPaymentNote(e.target.value)}
                    disabled={!canWrite}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '14px', boxSizing: 'border-box' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button
                    onClick={handleAddPayment}
                    disabled={!canWrite}
                    style={{ flex: 1, padding: '10px 14px', backgroundColor: '#4f46e5', color: '#ffffff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: canWrite ? 'pointer' : 'not-allowed', opacity: canWrite ? 1 : 0.6 }}
                  >
                    수납 내역 추가
                  </button>

                  <button
                    onClick={() => handleAttemptCloseCase(false)}
                    disabled={!canWrite}
                    style={{ padding: '10px 14px', backgroundColor: '#dc2626', color: '#ffffff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: canWrite ? 'pointer' : 'not-allowed', opacity: canWrite ? 1 : 0.6 }}
                  >
                    사건 종결 처리 시도
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* History Tables (Append-Only Ledgers) */}
          <div style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: '24px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 'bold', color: '#111827' }}>
              3. 성공보수 계산 및 수납 타임라인 (Append-Only)
            </h3>

            {/* Calculations Table */}
            <div style={{ marginBottom: '24px', overflowX: 'auto' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 8px 0', color: '#374151' }}>가. 보수 계산/승인 이력</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={{ padding: '8px 12px' }}>일시</th>
                    <th style={{ padding: '8px 12px' }}>유형</th>
                    <th style={{ padding: '8px 12px' }}>기준금액</th>
                    <th style={{ padding: '8px 12px' }}>요율</th>
                    <th style={{ padding: '8px 12px' }}>공급가액</th>
                    <th style={{ padding: '8px 12px' }}>부가세</th>
                    <th style={{ padding: '8px 12px' }}>총청구액</th>
                    <th style={{ padding: '8px 12px' }}>처리자</th>
                  </tr>
                </thead>
                <tbody>
                  {calculations.length === 0 ? (
                    <tr><td colSpan={8} style={{ padding: '12px', textAlign: 'center', color: '#9ca3af' }}>계산 이력이 없습니다.</td></tr>
                  ) : (
                    calculations.map((c) => (
                      <tr key={c.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '8px 12px' }}>{new Date(c.createdAt).toLocaleString('ko-KR')}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, backgroundColor: c.calcType === 'FINAL' ? '#d1fae5' : '#fef3c7', color: c.calcType === 'FINAL' ? '#065f46' : '#92400e' }}>
                            {c.calcType}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px' }}>{formatKrw(c.baseAmount)}</td>
                        <td style={{ padding: '8px 12px' }}>{(c.feeRateBps / 100).toFixed(2)}%</td>
                        <td style={{ padding: '8px 12px' }}>{formatKrw(c.calculatedFee)}</td>
                        <td style={{ padding: '8px 12px' }}>{formatKrw(c.taxAmount)}</td>
                        <td style={{ padding: '8px 12px', fontWeight: 'bold' }}>{formatKrw(c.totalClaimFee)}</td>
                        <td style={{ padding: '8px 12px' }}>{c.actor?.name || '시스템'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Payments Table */}
            <div style={{ overflowX: 'auto' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 8px 0', color: '#374151' }}>나. 수납 및 계산서 발행 내역</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={{ padding: '8px 12px' }}>수납일시</th>
                    <th style={{ padding: '8px 12px' }}>구분</th>
                    <th style={{ padding: '8px 12px' }}>입금액</th>
                    <th style={{ padding: '8px 12px' }}>계산서 상태</th>
                    <th style={{ padding: '8px 12px' }}>승인번호</th>
                    <th style={{ padding: '8px 12px' }}>적요</th>
                    <th style={{ padding: '8px 12px' }}>처리자</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.length === 0 ? (
                    <tr><td colSpan={7} style={{ padding: '12px', textAlign: 'center', color: '#9ca3af' }}>수납 내역이 없습니다.</td></tr>
                  ) : (
                    payments.map((p) => (
                      <tr key={p.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '8px 12px' }}>{new Date(p.paymentDate).toLocaleDateString('ko-KR')}</td>
                        <td style={{ padding: '8px 12px' }}>{p.paymentType}</td>
                        <td style={{ padding: '8px 12px', fontWeight: 'bold', color: '#059669' }}>{formatKrw(p.amount)}</td>
                        <td style={{ padding: '8px 12px' }}>{p.invoiceStatus}</td>
                        <td style={{ padding: '8px 12px' }}>{p.invoiceNumber || '-'}</td>
                        <td style={{ padding: '8px 12px' }}>{p.note || '-'}</td>
                        <td style={{ padding: '8px 12px' }}>{p.actor?.name || '시스템'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Audits Table */}
            <div style={{ marginTop: '24px', overflowX: 'auto' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 8px 0', color: '#374151' }}>다. 비용 감사 및 종결 로그</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={{ padding: '8px 12px' }}>일시</th>
                    <th style={{ padding: '8px 12px' }}>행위 (Action)</th>
                    <th style={{ padding: '8px 12px' }}>당시 미수잔액</th>
                    <th style={{ padding: '8px 12px' }}>상세 정보</th>
                    <th style={{ padding: '8px 12px' }}>행위자</th>
                  </tr>
                </thead>
                <tbody>
                  {audits.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: '12px', textAlign: 'center', color: '#9ca3af' }}>감사 기록이 없습니다.</td></tr>
                  ) : (
                    audits.map((a) => (
                      <tr key={a.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '8px 12px' }}>{new Date(a.createdAt).toLocaleString('ko-KR')}</td>
                        <td style={{ padding: '8px 12px', fontWeight: 600 }}>{a.action}</td>
                        <td style={{ padding: '8px 12px' }}>{formatKrw(a.unpaidBalance)}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: '12px' }}>{a.detailsJson}</td>
                        <td style={{ padding: '8px 12px' }}>{a.actor?.name || '시스템'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Unpaid Balance Confirmation Modal */}
      {showCloseModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', padding: '24px', maxWidth: '480px', width: '100%', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', fontWeight: 'bold', color: '#991b1b' }}>
              ⚠️ 미수금 존재 사건 종결 경고
            </h3>
            <p style={{ fontSize: '14px', color: '#374151', lineHeight: 1.5, marginBottom: '16px' }}>
              해당 사건에 <strong>{formatKrw(unpaidToClose)}</strong>의 미수 잔액이 남아있습니다.
              미수 상태에서 사건을 강제 종결하시겠습니까? (감사 로그에 기록됩니다)
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => setShowCloseModal(false)}
                style={{ padding: '8px 16px', backgroundColor: '#e5e7eb', color: '#374151', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
              >
                취소
              </button>
              <button
                onClick={() => handleAttemptCloseCase(true)}
                style={{ padding: '8px 16px', backgroundColor: '#dc2626', color: '#ffffff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
              >
                미수 강제 종결 진행
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
