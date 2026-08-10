import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input } from '@claim-studio/ui';
import { apiRequest } from '../api';

type ReviewStatus = 'PENDING' | 'CHANGES_REQUESTED' | 'RESUBMITTED' | 'APPROVED';

interface ApprovalInboxItem {
  id: string;
  eventNumber: number;
  status: ReviewStatus;
  comment: string | null;
  createdAt: string;
  requestedBy: { id: string; name: string; email: string };
  assignedReviewer: { id: string; name: string; email: string } | null;
  case: { id: string; caseNumber: string; title: string; claimType: string };
  report: {
    id: string;
    title: string;
    version: number;
    sectionCount: number;
    requiredSectionCount: number;
    approvedSectionCount: number;
  };
}

interface ApprovalInboxResponse {
  summary: Record<ReviewStatus, number> & { total: number };
  reviewRequests: ApprovalInboxItem[];
}

const labels: Record<ReviewStatus, string> = {
  PENDING: '검토 대기',
  CHANGES_REQUESTED: '수정 요청',
  RESUBMITTED: '재검토 대기',
  APPROVED: '승인 완료'
};

const emptySummary: ApprovalInboxResponse['summary'] = {
  total: 0,
  PENDING: 0,
  CHANGES_REQUESTED: 0,
  RESUBMITTED: 0,
  APPROVED: 0
};

export function ApprovalInbox({ onNavigate }: { onNavigate: (path: string) => void }): React.ReactElement {
  const [items, setItems] = useState<ApprovalInboxItem[]>([]);
  const [summary, setSummary] = useState(emptySummary);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'' | ReviewStatus>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (nextQuery = query, nextStatus = status) => {
    setLoading(true);
    setError('');
    try {
      const search = new URLSearchParams();
      if (nextQuery.trim()) search.set('q', nextQuery.trim());
      if (nextStatus) search.set('status', nextStatus);
      const result = await apiRequest<ApprovalInboxResponse>(`/api/review-requests?${search.toString()}`);
      setItems(result.reviewRequests);
      setSummary(result.summary);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [query, status]);

  useEffect(() => { void load('', ''); }, []);

  const filteredLabel = useMemo(() => status ? labels[status] : '전체 최신 요청', [status]);

  return (
    <div className="approval-inbox-page">
      <section className="workspace-hero">
        <div>
          <span className="workspace-eyebrow">REVIEW &amp; APPROVAL</span>
          <h3>검토·승인 작업함</h3>
          <p>보고서별 최신 요청만 모아 수정 요청, 재검토, 장 승인 진행률을 확인하고 해당 스튜디오로 바로 이동합니다.</p>
        </div>
        <Button onClick={() => void load()}>새로고침</Button>
      </section>

      <div className="report-summary-grid" aria-label="검토 요청 상태 요약">
        <div><span>전체 최신 요청</span><strong>{summary.total}</strong></div>
        <div><span>검토·재검토 대기</span><strong>{summary.PENDING + summary.RESUBMITTED}</strong></div>
        <div><span>수정 요청</span><strong>{summary.CHANGES_REQUESTED}</strong></div>
        <div><span>승인 완료</span><strong>{summary.APPROVED}</strong></div>
      </div>

      <Card title="작업함 검색·필터">
        <form className="approval-filter" onSubmit={(event) => { event.preventDefault(); void load(); }}>
          <Input label="보고서·사건·요청자 검색" value={query} placeholder="검색어를 입력하세요" onChange={(event) => setQuery(event.target.value)} />
          <label>상태
            <select value={status} onChange={(event) => setStatus(event.target.value as '' | ReviewStatus)}>
              <option value="">전체 최신 요청</option>
              {(Object.keys(labels) as ReviewStatus[]).map((value) => <option key={value} value={value}>{labels[value]}</option>)}
            </select>
          </label>
          <Button type="submit">조회</Button>
          {(query || status) && <Button type="button" variant="secondary" onClick={() => { setQuery(''); setStatus(''); void load('', ''); }}>초기화</Button>}
        </form>
      </Card>

      <div className="approval-result-heading"><strong>{filteredLabel}</strong><span>{items.length}건</span></div>
      {error && <div className="error-box" role="alert">{error}</div>}
      {loading ? <div className="report-list-loading" role="status">검토 작업함을 불러오는 중입니다.</div> : items.length === 0 ? (
        <section className="report-empty-state"><strong>현재 조건에 맞는 검토 요청이 없습니다.</strong><p>보고서 스튜디오에서 검토 요청을 보내면 이곳에 표시됩니다.</p></section>
      ) : (
        <div className="approval-grid">
          {items.map((item) => {
            const progress = Math.round((item.report.approvedSectionCount / Math.max(1, item.report.sectionCount)) * 100);
            return (
              <article className="approval-card" key={item.id}>
                <header>
                  <div><span>{item.case.caseNumber} · {item.case.claimType}</span><h4>{item.report.title}</h4><p>{item.case.title}</p></div>
                  <strong className={`approval-status approval-status--${item.status.toLowerCase()}`}>{labels[item.status]}</strong>
                </header>
                <dl>
                  <div><dt>요청자</dt><dd>{item.requestedBy.name}</dd></div>
                  <div><dt>담당 검토자</dt><dd>{item.assignedReviewer?.name ?? '조직 검토자 미지정'}</dd></div>
                  <div><dt>요청 일시</dt><dd>{new Date(item.createdAt).toLocaleString('ko-KR')}</dd></div>
                  <div><dt>이벤트</dt><dd>#{item.eventNumber}</dd></div>
                </dl>
                {item.comment && <blockquote>{item.comment}</blockquote>}
                <div className="report-progress-label"><span>장 승인 진행률</span><strong>{item.report.approvedSectionCount}/{item.report.sectionCount} · {progress}%</strong></div>
                <div className="report-progress" aria-label={`장 승인 진행률 ${progress}%`}><span style={{ width: `${progress}%` }} /></div>
                <footer><span>보고서 v{item.report.version}</span><Button onClick={() => onNavigate(`/cases/${encodeURIComponent(item.case.id)}/reports/${encodeURIComponent(item.report.id)}/studio`)}>보고서 검토 열기</Button></footer>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
