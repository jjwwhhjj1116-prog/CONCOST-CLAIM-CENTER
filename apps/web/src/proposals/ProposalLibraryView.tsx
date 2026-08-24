import { useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest } from '../api';
import { sentProposalArchiveWorkbook, type SentProposalExcelRow } from './proposal-excel';

type AwardStatus = 'PENDING' | 'WON' | 'LOST';
type VerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'CONFLICT';

interface SentProposal extends SentProposalExcelRow {
  id: string;
  caseId: string;
  caseStatus: string;
  caseVersion: number;
  awardDecidedAt: string | null;
  contractAmountKrw: number | null;
  projectStartOn: string | null;
  projectEndOn: string | null;
  version: number;
  updatedAt: string;
  awardStatus: AwardStatus;
  verificationStatus: VerificationStatus;
  listHidden: boolean;
  catalogVersion: number;
  driveArchiveUrl: string | null;
  driveArchivedAt: string | null;
}

interface ProjectGroup {
  caseId: string;
  caseNumber: string;
  caseTitle: string;
  proposals: SentProposal[];
}

const awardLabels: Record<AwardStatus, string> = { PENDING: '회신 대기', WON: '수주 확정', LOST: '미수주' };
const verificationLabels: Record<VerificationStatus, string> = { UNVERIFIED: '원문 미확인', VERIFIED: '원문 검증', CONFLICT: '자료 충돌' };

function dateLabel(value: string | null, withTime = false): string {
  if (!value) return '미정';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date);
}

function errorLabel(reason: unknown): string {
  if (reason instanceof ApiError && reason.status === 403) return '배정받은 프로젝트의 제안서만 볼 수 있습니다.';
  return reason instanceof Error ? reason.message : '연동 제안서 DB를 불러오지 못했습니다.';
}

function downloadWorkbook(proposals: SentProposal[]): void {
  const bytes = sentProposalArchiveWorkbook(proposals);
  const workbookBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(workbookBuffer).set(bytes);
  const blob = new Blob([workbookBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `클레임센터_연동제안서_DB_${new Date().toISOString().slice(0, 10)}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ProposalLibraryView({ mode, onNavigate }: { mode: 'projects' | 'database'; onNavigate: (path: string) => void }): React.ReactElement {
  const [proposals, setProposals] = useState<SentProposal[]>([]);
  const [query, setQuery] = useState('');
  const [awardStatus, setAwardStatus] = useState<AwardStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const params = new URLSearchParams({ limit: '200', mode });
    if (query.trim()) params.set('q', query.trim());
    if (awardStatus) params.set('awardStatus', awardStatus);
    const timeout = window.setTimeout(() => {
      void apiRequest<{ proposals: SentProposal[] }>(`/api/proposal-catalog?${params.toString()}`)
        .then((result) => { if (active) setProposals([...result.proposals].sort((left, right) => right.sentAt.localeCompare(left.sentAt))); })
        .catch((reason) => { if (active) setError(errorLabel(reason)); })
        .finally(() => { if (active) setLoading(false); });
    }, query ? 250 : 0);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [awardStatus, mode, query]);

  const catalogAction = async (proposal: SentProposal, action: 'HIDE_FROM_LIST'|'RESTORE_TO_LIST'|'ARCHIVE_TO_DRIVE'|'ADMIN_DELETE') => {
    if (action === 'ADMIN_DELETE' && !window.confirm(`${proposal.proposalNumber} 제안서를 관리자 DB 화면에서 삭제 처리할까요? 감사 이력은 남습니다.`)) return;
    setBusy(`${proposal.id}:${action}`); setError(''); setNotice('');
    try {
      await apiRequest(`/api/proposal-catalog/${proposal.id}`, { method:'POST', body:JSON.stringify({ action,expectedVersion:proposal.catalogVersion }) });
      setNotice(action === 'HIDE_FROM_LIST' ? '일반 제안서 목록에서 숨겼습니다. 관리자 DB에는 남습니다.' : action === 'RESTORE_TO_LIST' ? '일반 목록에 복원했습니다.' : action === 'ARCHIVE_TO_DRIVE' ? '제안서 감사본을 회사 Google Drive에 보관했습니다.' : '관리자 DB에서 삭제 처리했습니다.');
      setProposals((current)=>current.filter((row)=>row.id!==proposal.id));
    } catch (reason) { setError(errorLabel(reason)); }
    finally { setBusy(''); }
  };

  const projects = useMemo<ProjectGroup[]>(() => {
    const grouped = new Map<string, ProjectGroup>();
    for (const proposal of proposals) {
      const current = grouped.get(proposal.caseId) ?? { caseId: proposal.caseId, caseNumber: proposal.caseNumber, caseTitle: proposal.caseTitle, proposals: [] };
      current.proposals.push(proposal);
      grouped.set(proposal.caseId, current);
    }
    for (const project of grouped.values()) project.proposals.sort((left, right) => right.sentAt.localeCompare(left.sentAt));
    return [...grouped.values()].sort((left, right) => right.proposals[0].sentAt.localeCompare(left.proposals[0].sentAt));
  }, [proposals]);

  const summary = useMemo(() => ({
    projects: projects.length,
    proposals: proposals.length,
    pending: proposals.filter((proposal) => proposal.awardStatus === 'PENDING').length,
    verified: proposals.filter((proposal) => proposal.verificationStatus === 'VERIFIED').length
  }), [projects.length, proposals]);

  return (
    <section className="proposal-library" aria-labelledby="proposal-library-title">
      <header className="proposal-library__hero">
        <div>
          <span>{mode === 'projects' ? 'LINKED PROPOSALS · PROJECT VIEW' : 'IMMUTABLE LINKED PROPOSAL LEDGER'}</span>
          <h2 id="proposal-library-title">{mode === 'projects' ? '프로젝트별 제안서 목록' : '제안서 DB관리'}</h2>
          <p>{mode === 'projects'
            ? '프로젝트에 연동된 제안서를 모아 제안서 버전·회신·수주 상태를 한눈에 확인합니다.'
            : '연동 당시의 제안서 번호·버전·원문 주소·SHA-256을 개별 행으로 보존한 관리자용 원장입니다. 확정본은 물리 삭제하지 않습니다.'}</p>
        </div>
        <div className="proposal-library__actions">
          <button type="button" onClick={() => onNavigate('/proposals/editor')}>제안서 작성·Excel 가져오기</button>
          <button type="button" className="is-secondary" disabled={proposals.length === 0} onClick={() => downloadWorkbook(proposals)}>목록 Excel 내보내기</button>
        </div>
      </header>

      <div className="proposal-library__summary" aria-label="연동 제안서 요약">
        <article><span>연동 프로젝트</span><strong>{summary.projects}</strong><small>프로젝트별 묶음</small></article>
        <article><span>확정본 DB</span><strong>{summary.proposals}</strong><small>버전별 개별 보관</small></article>
        <article><span>회신 대기</span><strong>{summary.pending}</strong><small>후속 확인 필요</small></article>
        <article><span>원문 검증</span><strong>{summary.verified}</strong><small>URL·SHA 고정</small></article>
      </div>

      <div className="proposal-library__filters">
        <label>통합 검색<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="프로젝트·제안서 번호·제목·클라이언트" /></label>
        <label>수주 상태<select value={awardStatus} onChange={(event) => setAwardStatus(event.target.value as AwardStatus | '')}><option value="">전체</option><option value="PENDING">회신 대기</option><option value="WON">수주 확정</option><option value="LOST">미수주</option></select></label>
      </div>

      {error && <div className="proposal-library__message is-error" role="alert">{error}</div>}
      {notice && <div className="proposal-library__message" role="status">{notice}</div>}
      {loading && <div className="proposal-library__message" role="status">D1 연동 제안서 원장을 불러오고 있습니다.</div>}
      {!loading && !error && proposals.length === 0 && <div className="proposal-library__empty"><strong>아직 연동된 제안서가 없습니다.</strong><span>제안서 작성 후 프로젝트 접수 화면에서 확정본을 연동하면 이곳에 자동으로 나타납니다.</span><button type="button" onClick={() => onNavigate('/proposals/editor')}>첫 제안서 작성하기</button></div>}

      {!loading && !error && mode === 'projects' && projects.length > 0 && (
        <div className="proposal-project-list">
          {projects.map((project) => {
            const latest = project.proposals[0];
            return <article key={project.caseId} className="proposal-project-card">
              <header>
                <div><span>{project.caseNumber}</span><h3>{project.caseTitle}</h3><small>최근 연동 {dateLabel(latest.sentAt, true)}</small></div>
                <div><b>{project.proposals.length}건</b><em className={`status-${latest.awardStatus.toLowerCase()}`}>{awardLabels[latest.awardStatus]}</em></div>
              </header>
              <div className="proposal-project-card__rows">
                {project.proposals.map((proposal) => <div key={proposal.id}>
                  <div><strong>{proposal.proposalTitle}</strong><span>{proposal.proposalNumber} · {proposal.revisionLabel}</span></div>
                  <div><span>{proposal.clientName}</span><small>{dateLabel(proposal.sentAt, true)}</small></div>
                  <em className={`status-${proposal.verificationStatus.toLowerCase()}`}>{verificationLabels[proposal.verificationStatus]}</em>
                  {proposal.documentUrl ? <a href={proposal.documentUrl} target="_blank" rel="noreferrer">확정 원문 열기</a> : <span className="is-muted">원문 미연결</span>}
                </div>)}
              </div>
              <footer><button type="button" onClick={() => onNavigate(`/proposals/editor?caseId=${encodeURIComponent(project.caseId)}`)}>이 프로젝트 제안서 작성</button><button type="button" className="is-secondary" onClick={() => onNavigate('/workflow/award')}>접수·수주 상태 확인</button><button type="button" className="is-secondary" disabled={Boolean(busy)} onClick={()=>void catalogAction(latest,'HIDE_FROM_LIST')}>목록에서 숨기기</button></footer>
            </article>;
          })}
        </div>
      )}

      {!loading && !error && mode === 'database' && proposals.length > 0 && (
        <div className="proposal-db-card">
          <div className="proposal-db-card__note"><strong>D1 확정본 원장</strong><span>행 삭제·연동 스냅샷 덮어쓰기를 금지하고, 수주 결정만 별도 감사 이력으로 추가합니다.</span></div>
          <div className="proposal-db-table" role="region" aria-label="연동 제안서 데이터베이스 원장" tabIndex={0}>
            <table><thead><tr><th>프로젝트</th><th>연동 제안서</th><th>버전·확정일</th><th>검증·수주</th><th>원문 무결성</th><th>등록·관리</th></tr></thead>
              <tbody>{proposals.map((proposal) => <tr key={proposal.id}>
                <td><strong>{proposal.caseNumber}</strong><span>{proposal.caseTitle}</span></td>
                <td><strong>{proposal.proposalTitle}</strong><span>{proposal.proposalNumber}</span><small>{proposal.clientName}</small></td>
                <td><strong>{proposal.revisionLabel}</strong><span>{dateLabel(proposal.sentAt, true)}</span></td>
                <td><em className={`status-${proposal.verificationStatus.toLowerCase()}`}>{verificationLabels[proposal.verificationStatus]}</em><em className={`status-${proposal.awardStatus.toLowerCase()}`}>{awardLabels[proposal.awardStatus]}</em></td>
                <td><code title={proposal.documentSha256 ?? ''}>{proposal.documentSha256 ? `${proposal.documentSha256.slice(0, 12)}…` : 'SHA 미등록'}</code>{proposal.documentUrl ? <a href={proposal.documentUrl} target="_blank" rel="noreferrer">원문</a> : null}</td>
                <td><strong>{proposal.createdByName}</strong><span>{dateLabel(proposal.createdAt, true)}</span><small>ID {proposal.id.slice(0, 8)}</small><div className="action-row"><button type="button" disabled={Boolean(busy)||!proposal.listHidden} onClick={()=>void catalogAction(proposal,'RESTORE_TO_LIST')}>목록 복원</button><button type="button" disabled={Boolean(busy)} onClick={()=>void catalogAction(proposal,'ARCHIVE_TO_DRIVE')}>Drive 보관</button>{proposal.driveArchiveUrl&&<a href={proposal.driveArchiveUrl} target="_blank" rel="noreferrer">보관본</a>}<button type="button" disabled={Boolean(busy)} onClick={()=>void catalogAction(proposal,'ADMIN_DELETE')}>삭제</button></div></td>
              </tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
