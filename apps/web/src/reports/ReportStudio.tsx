import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Dialog, Input, Select, StatusBadge } from '@claim-studio/ui';
import { apiRequest } from '../api';
import type { UserRole } from '../routes/Router';

export interface ReportStudioProps {
  reportId?: string;
  roles: UserRole[];
  onNavigate: (path: string) => void;
}

interface EvidenceLink {
  id: string;
  sourceType: 'DOCUMENT' | 'MEETING';
  sourceId: string;
  sourceDocumentVersionId?: string | null;
  sourceMeetingId?: string | null;
  sourceSha256: string;
  sourceVersion: number;
  quoteText?: string | null;
  anchorPosition?: string | null;
  documentVersion?: { id: string; displayName: string; sha256: string; versionNumber: number };
  meeting?: { id: string; title: string; status: string; version: number };
}

interface SectionRevision {
  id: string;
  sectionId: string;
  revisionNumber: number;
  title: string;
  content: string;
  structuredDataJson: string;
  validationStatus: string;
  sha256: string;
  createdAt: string;
  author: { id: string; name: string; email: string };
  evidenceLinks: EvidenceLink[];
}

interface SectionComment {
  id: string;
  sectionId: string;
  revisionId?: string | null;
  authorId: string;
  commentType: 'COMMENT' | 'REVISION_REQUEST';
  content: string;
  isResolved: boolean;
  resolvedAt?: string | null;
  createdAt: string;
  author: { id: string; name: string; email: string };
  resolvedBy?: { id: string; name: string } | null;
}

interface SectionApproval {
  id: string;
  sectionId: string;
  approvedRevisionId: string;
  approverId: string;
  status: 'APPROVED' | 'REJECTED' | 'UNLOCKED';
  comment?: string | null;
  createdAt: string;
  approver: { id: string; name: string; email: string };
}

interface ReportSection {
  id: string;
  reportId: string;
  sectionNumber: number;
  title: string;
  content: string;
  status: string;
  version: number;
  revisions: SectionRevision[];
  comments: SectionComment[];
  approvals: SectionApproval[];
}

interface CaseDocumentVersion {
  id: string;
  versionNumber: number;
  originalName: string;
  displayName: string;
  sha256: string;
  fileSize: number;
}

interface CaseDocument {
  id: string;
  title: string;
  category: string;
  versions: CaseDocumentVersion[];
}

interface CaseMeeting {
  id: string;
  title: string;
  meetingDate: string;
  rawText?: string | null;
  summary?: string | null;
  status: string;
  version: number;
}

interface ReportDetail {
  id: string;
  caseId: string;
  title: string;
  version: number;
  case: {
    id: string;
    title: string;
    caseNumber: string;
    claimType: string;
    documents: CaseDocument[];
    meetings: CaseMeeting[];
  };
  sections: ReportSection[];
  mergeSnapshots: Array<{
    id: string;
    snapshotVersion: number;
    mergedBodyText: string;
    createdAt: string;
    createdBy: { id: string; name: string };
  }>;
}

export const ReportStudio: React.FC<ReportStudioProps> = ({ reportId: propReportId, roles, onNavigate: _onNavigate }) => {
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active section editing state
  const [editedTitle, setEditedTitle] = useState('');
  const [editedContent, setEditedContent] = useState('');
  const [stagedEvidence, setStagedEvidence] = useState<EvidenceLink[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'conflict' | 'error'>('idle');
  const [conflictData, setConflictData] = useState<{ currentVersion: number; latestRevision?: SectionRevision } | null>(null);

  // Tab & Comments state
  const [leftTab, setLeftTab] = useState<'SECTIONS' | 'EVIDENCE'>('SECTIONS');
  const [newCommentContent, setNewCommentContent] = useState('');
  const [newCommentType, setNewCommentType] = useState<'COMMENT' | 'REVISION_REQUEST'>('COMMENT');
  const [approvalComment, setApprovalComment] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  // Quote-Anchor Staging
  const [selectedQuoteText, setSelectedQuoteText] = useState('');
  const [quoteSourceType, setQuoteSourceType] = useState<'DOCUMENT' | 'MEETING'>('DOCUMENT');
  const [quoteSourceId, setQuoteSourceId] = useState('');

  // Revisions Modal & Snapshot Modal
  const [showRevisionHistory, setShowRevisionHistory] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);

  const isReviewer = roles.includes('reviewer');

  const fetchStudio = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{ report: ReportDetail }>(`/reports/${id}/studio`);
      setReport(data.report);
      if (data.report.sections.length > 0 && !selectedSectionId) {
        const firstSec = data.report.sections[0];
        setSelectedSectionId(firstSec.id);
        setEditedTitle(firstSec.title);
        setEditedContent(firstSec.revisions[0]?.content || firstSec.content);
        setStagedEvidence(firstSec.revisions[0]?.evidenceLinks || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedSectionId]);

  useEffect(() => {
    // Default fallback or provided reportId
    const activeReportId = propReportId || 'RPT-001';
    void fetchStudio(activeReportId);
  }, [propReportId, fetchStudio]);

  const activeSection = report?.sections.find((s) => s.id === selectedSectionId);

  const handleSelectSection = (sec: ReportSection) => {
    setSelectedSectionId(sec.id);
    setEditedTitle(sec.title);
    setEditedContent(sec.revisions[0]?.content || sec.content);
    setStagedEvidence(sec.revisions[0]?.evidenceLinks || []);
    setSaveStatus('idle');
    setConflictData(null);
    setActionError(null);
  };

  const handleSaveRevision = async () => {
    if (!report || !activeSection) return;
    if (isReviewer) {
      setActionError('Reviewer는 본문을 수정할 수 없습니다 (403 Forbidden).');
      return;
    }
    if (activeSection.status === 'APPROVED') {
      setActionError('승인 완료(APPROVED)된 장은 직통 수정이 잠겨있습니다. 먼저 승인 해제(Unlock)를 요청하세요.');
      return;
    }

    setSaveStatus('saving');
    setActionError(null);
    try {
      const expectedVersion = activeSection.revisions.length;
      await apiRequest<{ revision: SectionRevision; sectionVersion: number }>(
        `/reports/${report.id}/sections/${activeSection.id}/revisions`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: editedTitle,
            content: editedContent,
            expectedVersion,
            evidenceLinks: stagedEvidence
          })
        }
      );
      setSaveStatus('saved');
      await fetchStudio(report.id);
    } catch (err: any) {
      if (err.status === 409 || (err.message && err.message.includes('Concurrency conflict'))) {
        setSaveStatus('conflict');
        setConflictData({
          currentVersion: err.currentVersion || activeSection.revisions.length,
          latestRevision: err.latestRevision || activeSection.revisions[0]
        });
      } else {
        setSaveStatus('error');
        setActionError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const handleAddEvidence = () => {
    if (!quoteSourceId) return;
    const newLink: EvidenceLink = {
      id: `STAGED-${Date.now()}`,
      sourceType: quoteSourceType,
      sourceId: quoteSourceId,
      sourceSha256: 'DYNAMIC_VERIFY',
      sourceVersion: 1,
      quoteText: selectedQuoteText ? selectedQuoteText : undefined,
      anchorPosition: `OFFSET-${Date.now()}`
    };
    setStagedEvidence([...stagedEvidence, newLink]);
    setSelectedQuoteText('');
  };

  const handleAddComment = async () => {
    if (!report || !activeSection || !newCommentContent.trim()) return;
    setActionError(null);
    try {
      await apiRequest(`/reports/${report.id}/sections/${activeSection.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          commentType: newCommentType,
          content: newCommentContent,
          revisionId: activeSection.revisions[0]?.id
        })
      });
      setNewCommentContent('');
      await fetchStudio(report.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleResolveComment = async (commentId: string) => {
    if (!report || !activeSection) return;
    try {
      await apiRequest(`/reports/${report.id}/sections/${activeSection.id}/comments/${commentId}/resolve`, {
        method: 'PATCH'
      });
      await fetchStudio(report.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleApproveSection = async () => {
    if (!report || !activeSection) return;
    setActionError(null);
    try {
      await apiRequest(`/reports/${report.id}/sections/${activeSection.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          revisionId: activeSection.revisions[0]?.id,
          comment: approvalComment
        })
      });
      setApprovalComment('');
      await fetchStudio(report.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleUnlockSection = async () => {
    if (!report || !activeSection) return;
    setActionError(null);
    try {
      await apiRequest(`/reports/${report.id}/sections/${activeSection.id}/unlock`, {
        method: 'POST',
        body: JSON.stringify({ comment: '수정 작업을 위한 승인 해제' })
      });
      await fetchStudio(report.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleMergeReport = async () => {
    if (!report) return;
    setActionError(null);
    try {
      await apiRequest(`/reports/${report.id}/merge`, { method: 'POST' });
      setShowMergeModal(true);
      await fetchStudio(report.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) {
    return <p role="status" className="muted">보고서 스튜디오 데이터를 불러오는 중입니다...</p>;
  }

  if (error || !report) {
    return (
      <Card title="보고서 스튜디오 에러">
        <p className="error-box" role="alert">{error || '보고서 정보를 찾을 수 없습니다.'}</p>
        <Button onClick={() => void fetchStudio(propReportId || 'RPT-001')}>다시 시도</Button>
      </Card>
    );
  }

  return (
    <div className="report-studio-container" style={{ display: 'grid', gridTemplateColumns: '340px 1fr 380px', gap: '1rem', minHeight: '80vh' }}>
      
      {/* 1단 패널: 목차 및 증빙 자료실 */}
      <aside className="studio-left-panel" style={{ borderRight: '1px solid #e0e0e0', paddingRight: '0.75rem' }}>
        <Card title={`사건: ${report.case.caseNumber}`}>
          <h4>{report.title} <small>v{report.version}</small></h4>
          <p className="muted">유형: {report.case.claimType}</p>
        </Card>

        <div className="tab-controls" style={{ display: 'flex', gap: '0.5rem', margin: '0.75rem 0' }}>
          <Button size="sm" variant={leftTab === 'SECTIONS' ? 'primary' : 'secondary'} onClick={() => setLeftTab('SECTIONS')}>장 목차</Button>
          <Button size="sm" variant={leftTab === 'EVIDENCE' ? 'primary' : 'secondary'} onClick={() => setLeftTab('EVIDENCE')}>증빙 자료실</Button>
        </div>

        {leftTab === 'SECTIONS' ? (
          <div className="section-tree-list">
            {report.sections.map((sec) => (
              <div
                key={sec.id}
                onClick={() => handleSelectSection(sec)}
                style={{
                  padding: '0.75rem',
                  marginBottom: '0.5rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  border: selectedSectionId === sec.id ? '2px solid #0052cc' : '1px solid #ddd',
                  backgroundColor: selectedSectionId === sec.id ? '#f0f5ff' : '#ffffff'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>제 {sec.sectionNumber} 장: {sec.title}</strong>
                  <StatusBadge status={sec.status === 'APPROVED' ? 'approved' : sec.status === 'REJECTED' ? 'review' : 'ai_draft'} />
                </div>
                <small className="muted">개정: {sec.revisions.length}회 | 댓글: {sec.comments.length}개</small>
              </div>
            ))}
          </div>
        ) : (
          <div className="evidence-vault">
            <h5>사건 첨부 문서</h5>
            {report.case.documents.map((doc) => (
              <div key={doc.id} style={{ fontSize: '0.85rem', padding: '0.4rem', borderBottom: '1px solid #eee' }}>
                <div>📄 {doc.title} <small>({doc.category})</small></div>
                {doc.versions.map((v) => (
                  <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', margin: '0.2rem 0' }}>
                    <small>v{v.versionNumber} - {v.displayName}</small>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setQuoteSourceType('DOCUMENT');
                        setQuoteSourceId(v.id);
                      }}
                    >
                      선택
                    </Button>
                  </div>
                ))}
              </div>
            ))}

            <h5 style={{ marginTop: '1rem' }}>회의록</h5>
            {report.case.meetings.map((m) => (
              <div key={m.id} style={{ fontSize: '0.85rem', padding: '0.4rem', borderBottom: '1px solid #eee' }}>
                <div>🗣️ {m.title} ({m.meetingDate})</div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setQuoteSourceType('MEETING');
                    setQuoteSourceId(m.id);
                  }}
                >
                  선택
                </Button>
              </div>
            ))}

            {quoteSourceId && (
              <div style={{ marginTop: '1rem', padding: '0.5rem', background: '#fafafa', borderRadius: '4px' }}>
                <small>선택된 증빙: {quoteSourceType} ({quoteSourceId})</small>
                <Input
                  label="인용-앵커 문구 (Option)"
                  placeholder="예: 3페이지 제2항 금액 1,200만원"
                  value={selectedQuoteText}
                  onChange={(e) => setSelectedQuoteText(e.target.value)}
                />
                <Button size="sm" onClick={handleAddEvidence}>현재 장에 근거 연결</Button>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* 2단 패널: 장 실시간 편집기 & Revision 관리 */}
      <main className="studio-center-panel">
        {activeSection ? (
          <Card title={`제 ${activeSection.sectionNumber} 장 본문 편집기 (${activeSection.status})`}>
            {actionError && <p role="alert" className="error-box" style={{ color: 'red' }}>{actionError}</p>}

            {saveStatus === 'conflict' && conflictData && (
              <div style={{ backgroundColor: '#fffbe6', border: '1px solid #ffe58f', padding: '0.75rem', marginBottom: '1rem', borderRadius: '6px' }}>
                <strong style={{ color: '#d48800' }}>⚠️ 409 동시성 충돌 발생!</strong>
                <p>다른 사용자가 이미 새 개정본(v{conflictData.currentVersion})을 저장했습니다.</p>
                <Button size="sm" onClick={() => setShowRevisionHistory(true)}>충돌 내역 비교하기</Button>
              </div>
            )}

            <div className="form-stack">
              <Input
                label="장 제목"
                value={editedTitle}
                readOnly={isReviewer || activeSection.status === 'APPROVED'}
                onChange={(e) => setEditedTitle(e.target.value)}
              />

              <label htmlFor="section-content-editor">장 본문 내용 (마크다운 지원)</label>
              <textarea
                id="section-content-editor"
                className="report-editor"
                rows={14}
                style={{ width: '100%', fontFamily: 'monospace', padding: '0.5rem' }}
                value={editedContent}
                readOnly={isReviewer || activeSection.status === 'APPROVED'}
                onChange={(e) => setEditedContent(e.target.value)}
              />

              {/* 연결된 증빙 리스트 */}
              <div className="staged-evidence-list">
                <h5>연결된 증빙 근거 ({stagedEvidence.length}개)</h5>
                {stagedEvidence.map((ev, idx) => (
                  <div key={ev.id || idx} style={{ fontSize: '0.8rem', background: '#f5f5f5', padding: '0.3rem 0.5rem', marginBottom: '0.2rem', borderRadius: '4px' }}>
                    📌 [{ev.sourceType}] ID: {ev.sourceId} | {ev.quoteText ? `"${ev.quoteText}"` : '전체 참조'}
                  </div>
                ))}
              </div>

              <div className="action-row" style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                <Button
                  onClick={() => void handleSaveRevision()}
                  disabled={isReviewer || activeSection.status === 'APPROVED' || saveStatus === 'saving'}
                >
                  {saveStatus === 'saving' ? '저장 중...' : '개정본 저장 (Append Revision)'}
                </Button>

                <Button variant="secondary" onClick={() => setShowRevisionHistory(true)}>
                  개정 이력 (v{activeSection.revisions.length})
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <p className="muted">좌측 목차에서 편집할 장을 선택하십시오.</p>
        )}
      </main>

      {/* 3단 패널: 댓글 / 수정요청 / 승인 / 통합 병합 */}
      <aside className="studio-right-panel" style={{ borderLeft: '1px solid #e0e0e0', paddingLeft: '0.75rem' }}>
        <Card title="검토·승인 & 댓글 타임라인">
          {activeSection ? (
            <div>
              <div className="approval-controls" style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #eee' }}>
                {activeSection.status === 'APPROVED' ? (
                  <div>
                    <StatusBadge status="approved" />
                    <p className="muted" style={{ fontSize: '0.85rem' }}>이 장은 최종 승인되었습니다.</p>
                    {!isReviewer && (
                      <Button size="sm" variant="secondary" onClick={() => void handleUnlockSection()}>
                        승인 해제 (Unlock for Edit)
                      </Button>
                    )}
                  </div>
                ) : (
                  <div>
                    <Input
                      label="승인/검토 코멘트"
                      placeholder="승인 또는 수정요청 시 사유 작성"
                      value={approvalComment}
                      onChange={(e) => setApprovalComment(e.target.value)}
                    />
                    <Button size="sm" onClick={() => void handleApproveSection()}>
                      장 승인 (Approve Section)
                    </Button>
                  </div>
                )}
              </div>

              {/* 댓글 작성 폼 */}
              <div className="comment-form" style={{ marginBottom: '1rem' }}>
                <Select
                  label="댓글 구분"
                  options={[
                    { value: 'COMMENT', label: '일반 의견 (COMMENT)' },
                    { value: 'REVISION_REQUEST', label: '수정 요청 (REVISION_REQUEST)' }
                  ]}
                  value={newCommentType}
                  onChange={(e) => setNewCommentType(e.target.value as any)}
                />
                <Input
                  label="의견 내용"
                  placeholder="댓글 입력..."
                  value={newCommentContent}
                  onChange={(e) => setNewCommentContent(e.target.value)}
                />
                <Button size="sm" variant="secondary" onClick={() => void handleAddComment()}>의견 등록</Button>
              </div>

              {/* 댓글 목록 */}
              <div className="comments-timeline" style={{ maxHeight: '350px', overflowY: 'auto' }}>
                {activeSection.comments.map((cmt) => (
                  <div
                    key={cmt.id}
                    style={{
                      padding: '0.5rem',
                      marginBottom: '0.5rem',
                      borderRadius: '6px',
                      background: cmt.commentType === 'REVISION_REQUEST' ? '#fff2f0' : '#fafafa',
                      border: cmt.commentType === 'REVISION_REQUEST' ? '1px solid #ffccc7' : '1px solid #eee'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                      <strong>{cmt.author.name} ({cmt.commentType})</strong>
                      <small>{new Date(cmt.createdAt).toLocaleTimeString()}</small>
                    </div>
                    <p style={{ margin: '0.3rem 0', fontSize: '0.85rem' }}>{cmt.content}</p>
                    {cmt.isResolved ? (
                      <small style={{ color: 'green' }}>✓ 해결됨 ({cmt.resolvedBy?.name})</small>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => void handleResolveComment(cmt.id)}>해결 완료 처리</Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="muted">장을 선택하면 댓글 및 승인 도구가 표시됩니다.</p>
          )}
        </Card>

        {/* 전체 보고서 병합 Snapshot 실행 */}
        <Card title="최종 보고서 병합">
          <p className="muted" style={{ fontSize: '0.85rem' }}>모든 장이 APPROVED 상태일 때 최종 Merge Snapshot을 생성합니다.</p>
          <Button disabled={isReviewer} variant="danger" onClick={() => void handleMergeReport()}>
            최종 DOCX/PDF 병합 Snapshot 생성
          </Button>

          {report.mergeSnapshots.length > 0 && (
            <div style={{ marginTop: '0.75rem', fontSize: '0.8rem' }}>
              <strong>생성된 병합 이력 ({report.mergeSnapshots.length}개):</strong>
              {report.mergeSnapshots.map((m) => (
                <div key={m.id}>- v{m.snapshotVersion} ({new Date(m.createdAt).toLocaleDateString()}) - {m.createdBy.name}</div>
              ))}
            </div>
          )}
        </Card>
      </aside>

      {/* Revision History Modal */}
      <Dialog isOpen={showRevisionHistory} title="개정 이력 및 버전을 비교합니다" onClose={() => setShowRevisionHistory(false)}>
        {activeSection && (
          <div>
            <h4>장: {activeSection.title} (총 {activeSection.revisions.length}개 개정본)</h4>
            {activeSection.revisions.map((rev) => (
              <div key={rev.id} style={{ border: '1px solid #ddd', padding: '0.5rem', margin: '0.5rem 0', borderRadius: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>Revision #{rev.revisionNumber} ({rev.author.name})</strong>
                  <small>{new Date(rev.createdAt).toLocaleString()}</small>
                </div>
                <pre style={{ background: '#f5f5f5', padding: '0.4rem', fontSize: '0.8rem', overflowX: 'auto' }}>{rev.content}</pre>
                <small className="muted">SHA-256: {rev.sha256.slice(0, 16)}...</small>
              </div>
            ))}
          </div>
        )}
      </Dialog>

      {/* Merge Success Modal */}
      <Dialog isOpen={showMergeModal} title="최종 보고서 병합 완료" onClose={() => setShowMergeModal(false)}>
        <p>승인된 모든 장이 손실 없이 하나로 결합되어 ReportMergeSnapshot에 저장되었습니다.</p>
      </Dialog>
    </div>
  );
};
