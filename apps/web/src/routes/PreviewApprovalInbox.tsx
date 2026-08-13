import { Button, Card, Select } from '@claim-studio/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest } from '../api';
import { StatusFeedbackState } from '../layout/StatusFeedbackState';
import type { UserRole } from './Router';

export interface PreviewReportReview {
  id: string;
  caseId: string;
  caseNumber: string;
  caseTitle: string;
  reportRevisionId: string;
  reportVersion: number;
  reportTitle: string;
  status: 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED';
  requestedBy: { id: string; name: string };
  requestNote: string | null;
  requestedAt: string;
  reviewedBy: { id: string; name: string | null } | null;
  decisionNote: string | null;
  reviewedAt: string | null;
}

const DECISION_ROLES: readonly UserRole[] = ['admin', 'ceo', 'director', 'reviewer'];

function statusLabel(status: PreviewReportReview['status']): string {
  if (status === 'APPROVED') return '승인 완료';
  if (status === 'CHANGES_REQUESTED') return '수정 요청';
  return '검토 대기';
}

export function PreviewApprovalInbox({ roles, onNavigate }: { roles: UserRole[]; onNavigate: (path: string) => void }): React.ReactElement {
  const [reviews, setReviews] = useState<PreviewReportReview[]>([]);
  const [filter, setFilter] = useState<'ALL' | PreviewReportReview['status']>('PENDING');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const canDecide = roles.some((role) => DECISION_ROLES.includes(role));

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await apiRequest<{ reviews: PreviewReportReview[] }>('/api/report-reviews');
      setReviews(result.reviews);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => filter === 'ALL' ? reviews : reviews.filter((review) => review.status === filter), [filter, reviews]);

  const decide = async (review: PreviewReportReview, decision: 'APPROVED' | 'CHANGES_REQUESTED') => {
    setBusyId(review.id); setError('');
    try {
      const result = await apiRequest<{ reviews: PreviewReportReview[] }>(`/api/report-reviews/${encodeURIComponent(review.id)}/decision`, {
        method: 'POST', body: JSON.stringify({ decision, note: notes[review.id]?.trim() ?? '', expectedStatus: 'PENDING' })
      });
      setReviews((current) => {
        const replacements = new Map(result.reviews.map((entry) => [entry.id, entry]));
        return current.map((entry) => replacements.get(entry.id) ?? entry);
      });
      setNotes((current) => ({ ...current, [review.id]: '' }));
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status === 403 ? '본인이 요청한 보고서는 직접 승인할 수 없습니다. 다른 검토자에게 결정을 요청하세요.' : reason instanceof Error ? reason.message : String(reason));
    } finally { setBusyId(''); }
  };

  if (loading) return <StatusFeedbackState type="loading" message="D1 검토·승인 대기열을 불러오고 있습니다." />;
  if (error && reviews.length === 0) return <StatusFeedbackState type="error" title="승인함을 불러오지 못했습니다" message={error} actionLabel="다시 시도" onAction={() => void load()} />;

  return (
    <div className="content-stack" aria-label="D1 보고서 검토 승인함">
      <Card title="REVIEW & APPROVAL · D1 AUDIT TRAIL">
        <div className="inline-form">
          <Select label="승인 상태" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} options={[
            { value: 'PENDING', label: '검토 대기' }, { value: 'APPROVED', label: '승인 완료' }, { value: 'CHANGES_REQUESTED', label: '수정 요청' }, { value: 'ALL', label: '전체 이력' }
          ]} />
          <div className="action-row"><span className="preview-pill">대기 {reviews.filter((review) => review.status === 'PENDING').length}건</span><Button variant="secondary" onClick={() => void load()}>새로고침</Button></div>
        </div>
        <p className="muted">승인은 제출된 정확한 보고서 버전에 고정됩니다. 요청자 본인의 자기 승인은 서버와 D1에서 모두 차단됩니다.</p>
        {error && <p className="error-box" role="alert">{error}</p>}
      </Card>

      {visible.length === 0 ? <StatusFeedbackState type="empty" title="해당 상태의 검토 요청이 없습니다" message="보고서 스튜디오에서 저장된 최신본을 검토 요청하면 여기에 표시됩니다." actionLabel="보고서 스튜디오" onAction={() => onNavigate('/reports/studio')} /> : visible.map((review) => (
        <Card key={review.id} title={`${review.caseNumber} · ${review.caseTitle}`}>
          <div className="form-stack">
            <div className="action-row"><span className="preview-pill">{statusLabel(review.status)}</span><strong>{review.reportTitle} · v{review.reportVersion}</strong></div>
            <p>{review.requestNote || '별도 검토 메모 없음'}</p>
            <p className="muted">요청 {new Date(review.requestedAt).toLocaleString('ko-KR')} · {review.requestedBy.name}{review.reviewedBy ? ` / 결정 ${review.reviewedBy.name}` : ''}</p>
            {review.decisionNote && <p className="notice-box"><strong>결정 의견</strong><br />{review.decisionNote}</p>}
            {review.status === 'PENDING' && canDecide && <>
              <label htmlFor={`decision-note-${review.id}`}>검토 의견</label>
              <textarea id={`decision-note-${review.id}`} className="report-editor report-editor--decision" value={notes[review.id] ?? ''} maxLength={4000} disabled={busyId === review.id} onChange={(event) => setNotes((current) => ({ ...current, [review.id]: event.target.value }))} placeholder="승인 근거 또는 수정할 내용을 입력하세요." />
              <div className="action-row">
                <Button onClick={() => void decide(review, 'APPROVED')} disabled={busyId === review.id}>{busyId === review.id ? '처리 중…' : '이 버전 승인'}</Button>
                <Button variant="danger" onClick={() => void decide(review, 'CHANGES_REQUESTED')} disabled={busyId === review.id || !(notes[review.id]?.trim())}>수정 요청</Button>
              </div>
            </>}
          </div>
        </Card>
      ))}
    </div>
  );
}
