import { Button, Card, Select } from '@claim-studio/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReportFinalDocumentPreview } from './PreviewReportStudio';
import { DocumentPreviewPane } from '../documents/DocumentPreviewPane';
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
  canDecide?: boolean;
  requestNote: string | null;
  requestedAt: string;
  reviewedBy: { id: string; name: string | null } | null;
  decisionNote: string | null;
  reviewedAt: string | null;
  deliveryNotification: { id: string; emailStatus: 'PENDING' | 'SENT' | 'FAILED' | 'CONFIG_REQUIRED' } | null;
}

const REVIEW_ROLES: readonly UserRole[] = ['admin', 'ceo', 'director', 'reviewer'];
const FINAL_APPROVAL_ROLES: readonly UserRole[] = ['ceo', 'director'];
interface ReviewDocument { reviewId: string; revisionId: string; caseNumber: string; caseTitle: string; title: string; content: string; editorJson: import('@tiptap/core').JSONContent | null; version: number }

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
  const [previewId, setPreviewId] = useState('');
  const [document, setDocument] = useState<ReviewDocument | null>(null);
  const [documentError, setDocumentError] = useState('');
  const [documentLoading, setDocumentLoading] = useState(false);
  const [confirmedRevision, setConfirmedRevision] = useState('');
  const [previewReady, setPreviewReady] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewSequence = useRef(0);
  useEffect(() => () => { previewSequence.current++; }, []);
  useEffect(() => {
    const root = previewRef.current;
    if (!document || !root) return;
    let ready = false, active = true;
    const check = () => {
      if (!active) return;
      const images = [...root.querySelectorAll('img')];
      const pages = [...root.querySelectorAll<HTMLElement>('[data-export-page]')];
      ready = images.every(image => image.complete && image.naturalWidth > 0) && pages.length > 0 && pages.every(page => page.dataset.pageFitOverflow !== 'true');
      setPreviewReady(ready);
      if (!ready) setConfirmedRevision('');
      if (images.some(image => image.complete && image.naturalWidth === 0)) setDocumentError('사진을 불러오지 못했습니다. 연결을 확인하고 제출 본문을 다시 조회하세요.');
    };
    const observer = new MutationObserver(check);
    observer.observe(root, { subtree: true, childList: true, attributes: true });
    root.addEventListener('load', check, true); root.addEventListener('error', check, true); check();
    const timeout = window.setTimeout(() => {
      if (active && !ready) setDocumentError('사진 로딩 또는 페이지 배치를 확인하지 못했습니다. 연결·표 크기를 확인하고 제출 본문을 다시 조회하세요.');
    }, 15_000);
    return () => { active = false; observer.disconnect(); window.clearTimeout(timeout); root.removeEventListener('load', check, true); root.removeEventListener('error', check, true); };
  }, [document]);
  const openDocument = async (review: PreviewReportReview) => {
    const sequence = ++previewSequence.current;
    setPreviewId(review.id); setDocument(null); setDocumentError(''); setConfirmedRevision(''); setPreviewReady(false); setDocumentLoading(true);
    try {
      const result = await apiRequest<{ document: ReviewDocument }>(`/api/report-reviews/${encodeURIComponent(review.id)}/document`);
      if (sequence !== previewSequence.current) return;
      if (result.document?.reviewId !== review.id || result.document.revisionId !== review.reportRevisionId || result.document.version !== review.reportVersion) throw new Error('제출 버전이 일치하지 않습니다. 다시 조회해 주세요.');
      setDocument(result.document);
    } catch (reason) { if (sequence === previewSequence.current) setDocumentError(reason instanceof Error ? reason.message : '제출 본문을 불러오지 못했습니다.'); }
    finally { if (sequence === previewSequence.current) setDocumentLoading(false); }
  };
  const canReview = roles.some((role) => REVIEW_ROLES.includes(role));
  const canFinalApprove = roles.some((role) => FINAL_APPROVAL_ROLES.includes(role));
  const resetPreview = useCallback(() => {
    previewSequence.current++; setPreviewId(''); setDocument(null); setDocumentError('');
    setConfirmedRevision(''); setPreviewReady(false); setDocumentLoading(false);
  }, []);

  const load = useCallback(async () => {
    resetPreview();
    setLoading(true); setError('');
    try {
      const result = await apiRequest<{ reviews: PreviewReportReview[] }>('/api/report-reviews');
      setReviews(result.reviews);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }, [resetPreview]);

  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => filter === 'ALL' ? reviews : reviews.filter((review) => review.status === filter), [filter, reviews]);

  const decide = async (review: PreviewReportReview, decision: 'APPROVED' | 'CHANGES_REQUESTED') => {
    if (busyId || review.canDecide === false || (decision === 'APPROVED' && (!previewReady || confirmedRevision !== review.reportRevisionId || documentError || document?.reviewId !== review.id))) return;
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
      setError(reason instanceof ApiError && reason.payload.code === 'SELF_APPROVAL_FORBIDDEN' ? '본인이 작성·저장하거나 검토 요청한 버전은 직접 결정할 수 없습니다. 다른 검토자에게 요청하세요.' : reason instanceof Error ? reason.message : String(reason));
    } finally { setBusyId(''); }
  };

  if (loading) return <StatusFeedbackState type="loading" message="검토·승인 대기열을 불러오고 있습니다." />;
  if (error && reviews.length === 0) return <StatusFeedbackState type="error" title="승인함을 불러오지 못했습니다" message={error} actionLabel="다시 시도" onAction={() => void load()} />;

  return (
    <div className="content-stack" style={{ gridTemplateColumns: 'minmax(0, 1fr)', overflowWrap: 'anywhere' }} aria-label="보고서 검토 승인함">
      <Card title="REVIEW & APPROVAL · APPROVAL HISTORY">
        <div className="inline-form">
          <Select label="승인 상태" value={filter} onChange={(event) => { resetPreview(); setFilter(event.target.value as typeof filter); }} options={[
            { value: 'PENDING', label: '검토 대기' }, { value: 'APPROVED', label: '승인 완료' }, { value: 'CHANGES_REQUESTED', label: '수정 요청' }, { value: 'ALL', label: '전체 이력' }
          ]} />
          <div className="action-row"><span className="preview-pill">대기 {reviews.filter((review) => review.status === 'PENDING').length}건</span><Button variant="secondary" onClick={() => void load()}>새로고침</Button></div>
        </div>
        <p className="muted">승인은 제출된 정확한 보고서 버전에 고정됩니다. 수정 요청은 검토자도 할 수 있지만 최종 승인은 CEO·DIRECTOR 역할(현동명 대표 또는 이원희 부사장)만 할 수 있으며 자기 승인은 시스템에서 차단됩니다.</p>
        {error && <p className="error-box" role="alert">{error}</p>}
      </Card>

      {visible.length === 0 ? <StatusFeedbackState type="empty" title="해당 상태의 검토 요청이 없습니다" message="보고서 스튜디오에서 저장된 최신본을 검토 요청하면 여기에 표시됩니다." actionLabel="보고서 스튜디오" onAction={() => onNavigate('/reports/studio')} /> : visible.map((review) => (
        <Card key={review.id} title={`${review.caseNumber} · ${review.caseTitle}`}>
          <div className="form-stack" style={{ gridTemplateColumns: 'minmax(0, 1fr)', minWidth: 0 }}>
            <div className="action-row"><span className="preview-pill">{statusLabel(review.status)}</span><strong>{review.reportTitle} · v{review.reportVersion}</strong></div>
            <p>{review.requestNote || '별도 검토 메모 없음'}</p>
            <Button variant="secondary" disabled={Boolean(busyId)} onClick={() => void openDocument(review)}>제출 본문·표·사진 보기 · v{review.reportVersion}</Button>
            {previewId === review.id && <section aria-label={`제출 보고서 v${review.reportVersion} 검토`}>
              {documentLoading && <p role="status">제출 당시 본문과 서식을 불러오는 중입니다.</p>}
              {documentError && <p role="alert">{documentError}<Button variant="secondary" onClick={() => void openDocument(review)}>제출 본문 다시 조회</Button></p>}
              {document && <><p>현재 편집본이 아닌 제출된 v{document.version}입니다. 본문·표·사진을 대조한 뒤 승인 여부를 판단하세요.</p>
                <div ref={previewRef} onErrorCapture={() => { setPreviewReady(false); setConfirmedRevision(''); setDocumentError('사진을 불러오지 못했습니다. 연결을 확인하고 제출 본문을 다시 조회하세요.'); }}>
                  <DocumentPreviewPane title="제출 버전 읽기 전용 미리보기"><ReportFinalDocumentPreview {...document}/></DocumentPreviewPane>
                </div>
                {!documentError && <><label><input type="checkbox" disabled={!previewReady || review.canDecide === false} checked={confirmedRevision === review.reportRevisionId} onChange={event => setConfirmedRevision(event.target.checked && previewReady ? review.reportRevisionId : '')}/>제출된 이 버전의 본문·표·사진을 확인했습니다.</label>{!previewReady && <p role="status">사진 로딩과 페이지 배치를 확인하고 있습니다.</p>}</>}
              </>}
            </section>}
            <p className="muted">요청 {new Date(review.requestedAt).toLocaleString('ko-KR')} · {review.requestedBy.name}{review.reviewedBy ? ` / 결정 ${review.reviewedBy.name}` : ''}</p>
            {review.decisionNote && <p className="notice-box"><strong>결정 의견</strong><br />{review.decisionNote}</p>}
            {review.status === 'APPROVED' && review.deliveryNotification && <p className="notice-box"><strong>프로젝트 PM 납품 알림 생성 완료</strong><br />개인 알림은 즉시 저장되었습니다. 이메일 상태: {review.deliveryNotification.emailStatus === 'SENT' ? '발송 완료' : review.deliveryNotification.emailStatus === 'CONFIG_REQUIRED' ? '메일 발송 브리지 설정 필요' : review.deliveryNotification.emailStatus === 'FAILED' ? '발송 실패 · 관리자 재처리 필요' : '발송 대기'}</p>}
            {review.status === 'PENDING' && canReview && <>
              <label htmlFor={`decision-note-${review.id}`}>검토 의견</label>
              <textarea id={`decision-note-${review.id}`} className="report-editor report-editor--decision" value={notes[review.id] ?? ''} maxLength={4000} disabled={busyId === review.id} onChange={(event) => setNotes((current) => ({ ...current, [review.id]: event.target.value }))} placeholder="승인 근거 또는 수정할 내용을 입력하세요." />
              <div className="action-row">
                {canFinalApprove && <Button onClick={() => void decide(review, 'APPROVED')} disabled={Boolean(busyId) || review.canDecide === false || !previewReady || confirmedRevision !== review.reportRevisionId || Boolean(documentError)}>{busyId === review.id ? '처리 중…' : '이 버전 승인 · 최종 결재 후 PM 납품 알림'}</Button>}
                {canFinalApprove && confirmedRevision !== review.reportRevisionId && <span className="muted">제출 본문을 열고 확인한 뒤 승인할 수 있습니다.</span>}
                <Button variant="danger" onClick={() => void decide(review, 'CHANGES_REQUESTED')} disabled={Boolean(busyId) || review.canDecide === false || !(notes[review.id]?.trim())}>수정 요청</Button>
              </div>
              {review.canDecide === false && <p className="muted">본인이 작성·저장하거나 검토 요청한 버전입니다. 다른 검토자에게 결정을 요청하세요.</p>}
              {!canFinalApprove && <p className="muted">최종 승인은 현동명 대표 또는 이원희 부사장 계정에서 진행합니다.</p>}
            </>}
          </div>
        </Card>
      ))}
    </div>
  );
}
