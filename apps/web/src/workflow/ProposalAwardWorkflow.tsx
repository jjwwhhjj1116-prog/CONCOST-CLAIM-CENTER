import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../api';
import { StatusFeedbackState } from '../layout/StatusFeedbackState';
import type { UserRole } from '../routes/Router';

type AwardStatus = 'PENDING' | 'WON' | 'LOST';
type VerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'CONFLICT';

interface CaseOption {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
  version: number;
}

interface ProposalLink {
  id: string;
  caseId: string;
  caseNumber: string;
  caseTitle: string;
  caseStatus: string;
  caseVersion: number;
  proposalNumber: string;
  proposalTitle: string;
  revisionLabel: string;
  clientName: string;
  sentAt: string;
  responseDueOn: string | null;
  proposedAmountKrw: number | null;
  documentUrl: string | null;
  documentSha256: string | null;
  verificationStatus: VerificationStatus;
  awardStatus: AwardStatus;
  awardDecidedAt: string | null;
  awardDecidedByName: string | null;
  contractAmountKrw: number | null;
  projectStartOn: string | null;
  projectEndOn: string | null;
  version: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  isPerformanceProject: boolean;
  reportEvidenceEligible: boolean;
}

interface AwardDecision {
  id: string;
  decision: AwardStatus;
  decisionNote: string;
  decidedAt: string;
  contractAmountKrw: number | null;
  projectStartOn: string | null;
  projectEndOn: string | null;
  expectedLinkVersion: number;
  createdAt: string;
  decidedByName: string;
}

interface LinkForm {
  caseId: string;
  proposalNumber: string;
  proposalTitle: string;
  revisionLabel: string;
  clientName: string;
  sentAt: string;
  responseDueOn: string;
  proposedAmountKrw: string;
  documentUrl: string;
  documentSha256: string;
  verificationStatus: VerificationStatus;
}

interface DecisionForm {
  decision: 'WON' | 'LOST';
  decisionNote: string;
  decidedAt: string;
  contractAmountKrw: string;
  projectStartOn: string;
  projectEndOn: string;
  responsiblePmId: string;
}

interface PmOption { id: string; displayName: string; email: string; }

const MUTATION_ROLES: readonly UserRole[] = ['admin', 'ceo', 'director', 'pm'];
const awardLabel: Record<AwardStatus, string> = { PENDING: '회신 대기', WON: '수주 확정', LOST: '미수주' };
const verificationLabel: Record<VerificationStatus, string> = { UNVERIFIED: '원문 미확인', VERIFIED: '원문 검증', CONFLICT: '자료 충돌' };

function localDateTime(value = new Date()): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function blankLink(caseId = ''): LinkForm {
  return {
    caseId, proposalNumber: '', proposalTitle: '', revisionLabel: 'V1', clientName: '', sentAt: localDateTime(),
    responseDueOn: '', proposedAmountKrw: '', documentUrl: '', documentSha256: '', verificationStatus: 'UNVERIFIED'
  };
}

function blankDecision(): DecisionForm {
  return { decision: 'WON', decisionNote: '', decidedAt: localDateTime(), contractAmountKrw: '', projectStartOn: '', projectEndOn: '', responsiblePmId: '' };
}

function stableKey(store: Map<string, string>, prefix: string, payload: unknown): { fingerprint: string; key: string } {
  const fingerprint = `${prefix}:${JSON.stringify(payload)}`;
  const existing = store.get(fingerprint);
  if (existing) return { fingerprint, key: existing };
  const key = `${prefix}:${crypto.randomUUID()}`;
  store.set(fingerprint, key);
  return { fingerprint, key };
}

function money(value: number | null): string {
  return value === null ? '미입력' : `${new Intl.NumberFormat('ko-KR').format(value)}원`;
}

function dateLabel(value: string | null, withTime = false): string {
  if (!value) return '미정';
  return new Intl.DateTimeFormat('ko-KR', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(value));
}

function errorMessage(reason: unknown): string {
  if (reason instanceof ApiError && reason.status === 409) return '다른 화면에서 프로젝트 또는 제안서가 변경되었습니다. 최신 데이터를 다시 불러오세요.';
  if (reason instanceof ApiError && reason.status === 403) return '이 프로젝트의 제안서·수주 정보를 변경할 권한이 없습니다.';
  return reason instanceof Error ? reason.message : '요청을 처리하지 못했습니다.';
}

export function ProposalAwardWorkflow({ routeId, roles, onNavigate }: { routeId: 'WF-01' | 'WF-02'; roles: UserRole[]; onNavigate: (path: string) => void }): React.ReactElement {
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [proposals, setProposals] = useState<ProposalLink[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState<ProposalLink | null>(null);
  const [decisions, setDecisions] = useState<AwardDecision[]>([]);
  const [linkForm, setLinkForm] = useState<LinkForm>(blankLink());
  const [decisionForm, setDecisionForm] = useState<DecisionForm>(blankDecision());
  const [pmOptions, setPmOptions] = useState<PmOption[]>([]);
  const [showLinkForm, setShowLinkForm] = useState(routeId === 'WF-01');
  const [query, setQuery] = useState('');
  const [awardFilter, setAwardFilter] = useState<AwardStatus | ''>(routeId === 'WF-02' ? 'PENDING' : '');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const keysRef = useRef(new Map<string, string>());
  const detailEpoch = useRef(0);
  const canMutate = roles.some((role) => MUTATION_ROLES.includes(role));

  const loadCases = useCallback(async () => {
    const result = await apiRequest<{ cases: CaseOption[] }>('/api/cases?limit=100&q=');
    setCases(result.cases);
    setLinkForm((current) => current.caseId ? current : { ...current, caseId: result.cases[0]?.id ?? '' });
  }, []);

  const loadProposals = useCallback(async (preferredId?: string) => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (query.trim()) params.set('q', query.trim());
      if (awardFilter) params.set('awardStatus', awardFilter);
      const result = await apiRequest<{ proposals: ProposalLink[] }>(`/api/proposal-workflow?${params}`);
      setProposals(result.proposals);
      const preferred = preferredId || selectedId;
      setSelectedId(result.proposals.some((item) => item.id === preferred) ? preferred : (result.proposals[0]?.id ?? ''));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setLoading(false); }
  }, [awardFilter, query, selectedId]);

  useEffect(() => {
    void Promise.all([loadCases(), loadProposals()]).catch((reason) => setError(errorMessage(reason)));
  }, []);

  useEffect(() => {
    if (!selectedId) { setSelected(null); setDecisions([]); return; }
    const epoch = ++detailEpoch.current;
    void apiRequest<{ proposal: ProposalLink; decisions: AwardDecision[] }>(`/api/proposal-workflow/links/${encodeURIComponent(selectedId)}`)
      .then((result) => {
        if (epoch !== detailEpoch.current) return;
        setSelected(result.proposal); setDecisions(result.decisions); setDecisionForm(blankDecision());
      })
      .catch((reason) => { if (epoch === detailEpoch.current) setError(errorMessage(reason)); });
  }, [selectedId]);

  useEffect(() => {
    if (!selected?.caseId || selected.awardStatus !== 'PENDING') { setPmOptions([]); return; }
    let active = true;
    void apiRequest<{ users: PmOption[] }>(`/api/project-workflow/pm-options?caseId=${encodeURIComponent(selected.caseId)}`)
      .then((result) => {
        if (!active) return;
        setPmOptions(result.users);
        setDecisionForm((current) => ({ ...current, responsiblePmId: current.responsiblePmId || result.users[0]?.id || '' }));
      })
      .catch(() => { if (active) setPmOptions([]); });
    return () => { active = false; };
  }, [selected?.caseId, selected?.awardStatus]);

  const summary = useMemo(() => ({
    total: proposals.length,
    pending: proposals.filter((item) => item.awardStatus === 'PENDING').length,
    won: proposals.filter((item) => item.awardStatus === 'WON').length,
    evidence: proposals.filter((item) => item.reportEvidenceEligible).length
  }), [proposals]);

  const submitLink = async () => {
    const activeCase = cases.find((item) => item.id === linkForm.caseId);
    if (!activeCase) { setError('연동할 프로젝트를 선택하세요.'); return; }
    setBusy('link'); setError(''); setNotice('');
    const payload = {
      caseId: linkForm.caseId,
      proposalNumber: linkForm.proposalNumber.trim(), proposalTitle: linkForm.proposalTitle.trim(), revisionLabel: linkForm.revisionLabel.trim(),
      clientName: linkForm.clientName.trim(), sentAt: new Date(linkForm.sentAt).toISOString(), responseDueOn: linkForm.responseDueOn || null,
      proposedAmountKrw: linkForm.proposedAmountKrw ? Number(linkForm.proposedAmountKrw) : null,
      documentUrl: linkForm.documentUrl.trim() || null, documentSha256: linkForm.documentSha256.trim() || null,
      verificationStatus: linkForm.verificationStatus, expectedCaseVersion: activeCase.version
    };
    const stable = stableKey(keysRef.current, `proposal-link-${activeCase.id}`, payload);
    try {
      const result = await apiRequest<{ proposal: ProposalLink }>('/api/proposal-workflow/links', { method: 'POST', headers: { 'Idempotency-Key': stable.key }, body: JSON.stringify(payload) });
      keysRef.current.delete(stable.fingerprint);
      setLinkForm(blankLink(activeCase.id)); setShowLinkForm(false); setNotice('발송한 제안서의 버전과 원문 근거를 프로젝트에 고정했습니다.');
      await loadCases(); await loadProposals(result.proposal.id); setSelectedId(result.proposal.id);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(''); }
  };

  const submitDecision = async () => {
    if (!selected || selected.awardStatus !== 'PENDING') return;
    setBusy('decision'); setError(''); setNotice('');
    const payload = {
      decision: decisionForm.decision, decisionNote: decisionForm.decisionNote.trim(), decidedAt: new Date(decisionForm.decidedAt).toISOString(),
      contractAmountKrw: decisionForm.decision === 'WON' ? Number(decisionForm.contractAmountKrw) : null,
      projectStartOn: decisionForm.decision === 'WON' ? decisionForm.projectStartOn : null,
      projectEndOn: decisionForm.decision === 'WON' ? decisionForm.projectEndOn : null,
      responsiblePmId: decisionForm.decision === 'WON' ? decisionForm.responsiblePmId : null,
      expectedLinkVersion: selected.version, expectedCaseVersion: selected.caseVersion
    };
    const stable = stableKey(keysRef.current, `award-${selected.id}`, payload);
    try {
      const result = await apiRequest<{ proposal: ProposalLink }>(`/api/proposal-workflow/links/${encodeURIComponent(selected.id)}/decision`, { method: 'POST', headers: { 'Idempotency-Key': stable.key }, body: JSON.stringify(payload) });
      keysRef.current.delete(stable.fingerprint); setNotice(result.proposal.awardStatus === 'WON' ? '수주를 확정했습니다. 이 프로젝트만 실제 수행 워크플로우로 전환됩니다.' : '미수주 결정을 이력에 고정했습니다.');
      await loadCases(); await loadProposals(result.proposal.id); setSelected(result.proposal); setDecisionForm(blankDecision());
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(''); }
  };

  if (loading && proposals.length === 0 && cases.length === 0) return <StatusFeedbackState type="loading" message="D1에서 발송 제안서와 수주 결정을 불러오고 있습니다." />;

  return (
    <section className="route-view proposal-flow" aria-labelledby="proposal-flow-title">
      <header className="proposal-flow-hero">
        <div>
          <span>BUSINESS DEVELOPMENT · D1 LIVE WORKFLOW</span>
          <h2 id="proposal-flow-title">{routeId === 'WF-01' ? '작성된 제안서를 프로젝트에 연결합니다.' : '수주 여부를 확정하고 수행 프로젝트로 전환합니다.'}</h2>
          <p>제안서 작성 화면과 수행 프로젝트를 분리합니다. 발송 버전과 원문 해시를 고정하고, 수주가 확인된 프로젝트만 착수회의 이후 단계로 넘어갑니다.</p>
        </div>
        <div className="proposal-flow-actions">
          <button type="button" className="is-secondary" onClick={() => onNavigate('/proposals/editor')}>제안서 작성 열기</button>
          {canMutate && <button type="button" onClick={() => setShowLinkForm(true)}>+ 발송 제안서 연동</button>}
        </div>
      </header>

      <div className="proposal-flow-rule"><strong>수행 프로젝트 전환 규칙</strong><span>회신 대기 중에는 착수하지 않습니다. <b>수주 확정</b>을 기록한 경우에만 프로젝트 상태가 계약 단계로 전환됩니다.</span></div>

      <div className="proposal-flow-kpis" aria-label="제안서·수주 요약">
        <article><span>LINKED</span><strong>{summary.total}</strong><small>연동 제안서</small></article>
        <article><span>AWAITING</span><strong>{summary.pending}</strong><small>회신 대기</small></article>
        <article><span>WON</span><strong>{summary.won}</strong><small>수행 프로젝트</small></article>
        <article><span>VERIFIED</span><strong>{summary.evidence}</strong><small>보고서 근거 가능</small></article>
      </div>

      <form className="proposal-flow-search" onSubmit={(event) => { event.preventDefault(); void loadProposals(); }}>
        <label><span>통합 검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제안번호, 거래처, 프로젝트" /></label>
        <label><span>수주 상태</span><select value={awardFilter} onChange={(event) => setAwardFilter(event.target.value as AwardStatus | '')}><option value="">전체</option><option value="PENDING">회신 대기</option><option value="WON">수주 확정</option><option value="LOST">미수주</option></select></label>
        <button type="submit">검색</button>
      </form>

      {error && <div className="proposal-flow-error" role="alert"><span>{error}</span><button type="button" onClick={() => void Promise.all([loadCases(), loadProposals()])}>최신 데이터 다시 불러오기</button></div>}
      {notice && <div className="proposal-flow-notice" role="status">{notice}</div>}

      <div className="proposal-flow-layout">
        <aside className="proposal-flow-list" aria-label="연동 제안서 목록">
          <header><strong>발송 제안서</strong><span>{proposals.length}건</span></header>
          {proposals.length === 0 ? <div className="proposal-flow-empty"><strong>연동된 제안서가 없습니다.</strong><span>제안서 작성 후 발송본을 프로젝트에 연결하세요.</span></div> : proposals.map((item) => (
            <button type="button" key={item.id} className={selectedId === item.id ? 'is-active' : ''} onClick={() => { setShowLinkForm(false); setSelectedId(item.id); setNotice(''); }}>
              <span className={`proposal-award is-${item.awardStatus.toLowerCase()}`}>{awardLabel[item.awardStatus]}</span>
              <strong>{item.proposalNumber} · {item.revisionLabel}</strong>
              <span title={item.proposalTitle}>{item.proposalTitle}</span>
              <small>{item.clientName} · {item.caseNumber}</small>
              <small>회신기한 {item.responseDueOn || '미정'}</small>
            </button>
          ))}
        </aside>

        <main className="proposal-flow-detail">
          {showLinkForm ? (
            <section className="proposal-flow-panel">
              <div className="proposal-flow-heading"><div><span>STEP 1 · PROPOSAL SNAPSHOT</span><h3>발송 제안서 연동</h3></div><small>작성본을 복제하지 않고 발송 버전과 원문 근거만 고정합니다.</small></div>
              <div className="proposal-flow-form">
                <label className="span-2"><span>연동 프로젝트</span><select value={linkForm.caseId} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, caseId: event.target.value }))}>{cases.map((item) => <option key={item.id} value={item.id}>{item.caseNumber} · {item.title} · {item.status}</option>)}</select></label>
                <label><span>제안번호</span><input value={linkForm.proposalNumber} maxLength={100} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, proposalNumber: event.target.value }))} placeholder="PROP-2026-001" /></label>
                <label><span>발송 버전</span><input value={linkForm.revisionLabel} maxLength={80} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, revisionLabel: event.target.value }))} placeholder="V1" /></label>
                <label className="span-2"><span>제안서 제목</span><input value={linkForm.proposalTitle} maxLength={500} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, proposalTitle: event.target.value }))} /></label>
                <label><span>거래처</span><input value={linkForm.clientName} maxLength={300} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, clientName: event.target.value }))} /></label>
                <label><span>제안 금액(원)</span><input type="number" min="0" value={linkForm.proposedAmountKrw} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, proposedAmountKrw: event.target.value }))} /></label>
                <label><span>발송 일시</span><input type="datetime-local" value={linkForm.sentAt} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, sentAt: event.target.value }))} /></label>
                <label><span>회신 기한</span><input type="date" value={linkForm.responseDueOn} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, responseDueOn: event.target.value }))} /></label>
                <label className="span-2"><span>발송본 HTTPS URL</span><input type="url" value={linkForm.documentUrl} maxLength={1200} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, documentUrl: event.target.value }))} placeholder="https://..." /></label>
                <label className="span-2"><span>발송본 SHA-256</span><input value={linkForm.documentSha256} maxLength={64} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, documentSha256: event.target.value }))} placeholder="64자리 SHA-256" /></label>
                <label><span>원문 검증</span><select value={linkForm.verificationStatus} disabled={!canMutate || busy === 'link'} onChange={(event) => setLinkForm((current) => ({ ...current, verificationStatus: event.target.value as VerificationStatus }))}><option value="UNVERIFIED">원문 미확인</option><option value="VERIFIED">URL·SHA 검증</option><option value="CONFLICT">자료 충돌</option></select></label>
              </div>
              <div className="proposal-flow-submit"><button type="button" className="is-secondary" onClick={() => setShowLinkForm(false)}>취소</button><button type="button" disabled={!canMutate || busy === 'link'} onClick={() => void submitLink()}>{busy === 'link' ? '저장 중…' : '발송 제안서 연동'}</button></div>
            </section>
          ) : selected ? (
            <>
              <section className="proposal-flow-head">
                <div><span>{selected.caseNumber} · {selected.clientName}</span><h3>{selected.proposalTitle}</h3><p>{selected.proposalNumber} · {selected.revisionLabel}</p></div>
                <div><span className={`proposal-award is-${selected.awardStatus.toLowerCase()}`}>{awardLabel[selected.awardStatus]}</span><small>{verificationLabel[selected.verificationStatus]}</small></div>
              </section>
              <section className="proposal-flow-panel proposal-snapshot">
                <div className="proposal-flow-heading"><div><span>IMMUTABLE SENT SNAPSHOT</span><h3>발송본 정보</h3></div><small>새 버전은 기존 기록을 덮지 않고 별도 연동합니다.</small></div>
                <dl><div><dt>발송 일시</dt><dd>{dateLabel(selected.sentAt, true)}</dd></div><div><dt>회신 기한</dt><dd>{selected.responseDueOn || '미정'}</dd></div><div><dt>제안 금액</dt><dd>{money(selected.proposedAmountKrw)}</dd></div><div><dt>프로젝트 상태</dt><dd>{selected.caseStatus} · v{selected.caseVersion}</dd></div><div><dt>원문 검증</dt><dd>{verificationLabel[selected.verificationStatus]}</dd></div><div><dt>연동 담당</dt><dd>{selected.createdByName}</dd></div></dl>
                {selected.documentUrl ? <a href={selected.documentUrl} target="_blank" rel="noreferrer">발송 원문 열기 ↗</a> : <p className="proposal-flow-muted">원문 URL이 없어 보고서 확정 근거로는 사용할 수 없습니다.</p>}
                {selected.documentSha256 && <code>{selected.documentSha256}</code>}
              </section>

              {selected.awardStatus === 'PENDING' ? (
                <section className="proposal-flow-panel">
                  <div className="proposal-flow-heading"><div><span>STEP 2 · PROJECT INTAKE</span><h3>프로젝트 접수 확정·취소</h3></div><small>접수 확정 시 담당 PM과 프로젝트 워크 일정 관리가 함께 생성됩니다.</small></div>
                  <div className="proposal-decision-switch" role="group" aria-label="프로젝트 접수 여부"><button type="button" className={decisionForm.decision === 'WON' ? 'is-selected' : ''} onClick={() => setDecisionForm((current) => ({ ...current, decision: 'WON' }))}>프로젝트 접수 확정</button><button type="button" className={decisionForm.decision === 'LOST' ? 'is-selected is-lost' : ''} onClick={() => setDecisionForm((current) => ({ ...current, decision: 'LOST' }))}>접수 취소</button></div>
                  <div className="proposal-flow-form">
                    <label><span>결정 일시</span><input type="datetime-local" value={decisionForm.decidedAt} disabled={!canMutate || busy === 'decision'} onChange={(event) => setDecisionForm((current) => ({ ...current, decidedAt: event.target.value }))} /></label>
                    {decisionForm.decision === 'WON' && <><label><span>담당 PM</span><select value={decisionForm.responsiblePmId} disabled={!canMutate || busy === 'decision'} onChange={(event) => setDecisionForm((current) => ({ ...current, responsiblePmId: event.target.value }))}><option value="">담당 PM 선택</option>{pmOptions.map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.email}</option>)}</select></label><label><span>계약 금액(원)</span><input type="number" min="1" value={decisionForm.contractAmountKrw} disabled={!canMutate || busy === 'decision'} onChange={(event) => setDecisionForm((current) => ({ ...current, contractAmountKrw: event.target.value }))} /></label><label><span>프로젝트 시작일</span><input type="date" value={decisionForm.projectStartOn} disabled={!canMutate || busy === 'decision'} onChange={(event) => setDecisionForm((current) => ({ ...current, projectStartOn: event.target.value }))} /></label><label><span>프로젝트 종료 예정일</span><input type="date" value={decisionForm.projectEndOn} disabled={!canMutate || busy === 'decision'} onChange={(event) => setDecisionForm((current) => ({ ...current, projectEndOn: event.target.value }))} /></label></>}
                    <label className="span-2"><span>결정 근거·거래처 회신</span><textarea value={decisionForm.decisionNote} maxLength={5000} disabled={!canMutate || busy === 'decision'} onChange={(event) => setDecisionForm((current) => ({ ...current, decisionNote: event.target.value }))} placeholder="거래처 회신 내용, 계약 확인 근거, 미수주 사유를 기록하세요." /></label>
                  </div>
                  <div className="proposal-flow-submit"><span>{decisionForm.decision === 'WON' ? '확정 즉시 프로젝트 워크와 일정 관리가 열립니다.' : '제안 이력은 보존되지만 수행 프로젝트로 전환되지 않습니다.'}</span><button type="button" disabled={!canMutate || busy === 'decision' || (decisionForm.decision === 'WON' && !decisionForm.responsiblePmId)} onClick={() => void submitDecision()}>{busy === 'decision' ? '확정 중…' : decisionForm.decision === 'WON' ? '접수 확정·프로젝트 워크 생성' : '접수 취소 저장'}</button></div>
                </section>
              ) : (
                <section className={`proposal-flow-panel proposal-result is-${selected.awardStatus.toLowerCase()}`}><span>FINAL INTAKE RESULT</span><h3>{awardLabel[selected.awardStatus]}</h3><p>{selected.awardStatus === 'WON' ? `${money(selected.contractAmountKrw)} · ${selected.projectStartOn} ~ ${selected.projectEndOn}` : '수행 프로젝트 전환 없음'}</p><small>{selected.awardDecidedByName} · {dateLabel(selected.awardDecidedAt, true)}</small>{selected.awardStatus === 'WON' && <button type="button" onClick={() => onNavigate(`/projects/schedule?projectId=${encodeURIComponent(`project-${selected.caseId}`)}`)}>프로젝트 일정 입력·수정 →</button>}</section>
              )}

              {decisions.length > 0 && <section className="proposal-flow-panel"><div className="proposal-flow-heading"><div><span>AUDIT TRAIL</span><h3>수주 결정 이력</h3></div></div><ol className="proposal-decision-history">{decisions.map((item) => <li key={item.id}><span className={`proposal-award is-${item.decision.toLowerCase()}`}>{awardLabel[item.decision]}</span><div><strong>{item.decisionNote}</strong><small>{item.decidedByName} · {dateLabel(item.decidedAt, true)}</small></div></li>)}</ol></section>}
            </>
          ) : <div className="proposal-flow-welcome"><span>PROPOSAL → AWARD → PROJECT</span><h3>발송 제안서를 선택하세요.</h3><p>제안서 작성과 수주 결정을 분리해 실제 수행 프로젝트만 다음 단계에 배정합니다.</p></div>}
        </main>
      </div>
    </section>
  );
}
