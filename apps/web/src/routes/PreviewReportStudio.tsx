import { Button, Card, Input, Select } from '@claim-studio/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiDownload, apiRequest } from '../api';
import { StatusFeedbackState } from '../layout/StatusFeedbackState';
import type { UserRole } from './Router';
import type { PreviewReportReview } from './PreviewApprovalInbox';

interface CaseSummary { id: string; caseNumber: string; title: string; claimType: string; status: string }
interface ReportDraft {
  caseId: string; title: string; content: string; version: number; createdAt: string; updatedAt: string;
  updatedBy: { id: string; name: string };
}
interface ReportRevision {
  id: string; version: number; title: string; contentSha256: string; savedAt: string;
  savedBy: { id: string; name: string };
}
interface ReportPayload { draft: ReportDraft | null; revisions: ReportRevision[] }
interface AuthoringChapter { id: string; chapterCode: string; title: string; agentCode: string; ordinal: number; promptVersion: number }
interface AuthoringConfig { claimType: string; available: boolean; unavailableReason: string | null; aiConnected: boolean; modelLabel: string; chapters: AuthoringChapter[] }
interface FinalOutput { id: string; format: 'DOCX' | 'PDF'; fileName: string; contentSha256: string; byteSize: number; createdAt: string }
interface Finalization {
  id: string; caseId: string; reviewId: string; reportVersion: number; reportTitle: string; finalizedAt: string;
  finalizedBy: { id: string; name: string }; approvedBy: string; approvedAt: string; outputs: FinalOutput[];
}

const EDIT_ROLES: readonly UserRole[] = ['admin', 'ceo', 'director', 'pm', 'staff'];

export function PreviewReportStudio({ roles, onNavigate }: { roles: UserRole[]; onNavigate: (path: string) => void }): React.ReactElement {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [loadedCaseId, setLoadedCaseId] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [version, setVersion] = useState(0);
  const [revisions, setRevisions] = useState<ReportRevision[]>([]);
  const [reviews, setReviews] = useState<PreviewReportReview[]>([]);
  const [finalizations, setFinalizations] = useState<Finalization[]>([]);
  const [reviewNote, setReviewNote] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [authoring, setAuthoring] = useState<AuthoringConfig | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [generating, setGenerating] = useState(false);
  const loadSequence = useRef(0);
  const selectedCaseRef = useRef('');
  const titleRef = useRef('');
  const contentRef = useRef('');
  const editable = roles.some((role) => EDIT_ROLES.includes(role));
  const selectedCase = useMemo(() => cases.find((record) => record.id === selectedCaseId) ?? null, [cases, selectedCaseId]);

  const loadDraft = useCallback(async (caseId: string) => {
    const sequence = ++loadSequence.current;
    setLoading(true); setError(''); setLoadedCaseId(''); setDirty(false);
    try {
      const [result, reviewResult, finalizationResult, authoringResult] = await Promise.all([
        apiRequest<ReportPayload>(`/api/report-drafts?caseId=${encodeURIComponent(caseId)}`),
        apiRequest<{ reviews: PreviewReportReview[] }>(`/api/report-reviews?caseId=${encodeURIComponent(caseId)}`),
        apiRequest<{ finalizations: Finalization[] }>(`/api/report-finalizations?caseId=${encodeURIComponent(caseId)}`),
        apiRequest<AuthoringConfig>(`/api/report-authoring/config?caseId=${encodeURIComponent(caseId)}`)
      ]);
      if (sequence !== loadSequence.current || selectedCaseRef.current !== caseId) return;
      const caseRecord = cases.find((record) => record.id === caseId);
      const loadedTitle = result.draft?.title ?? `${caseRecord?.title ?? '사건'} 보고서`;
      const loadedContent = result.draft?.content ?? '';
      titleRef.current = loadedTitle;
      contentRef.current = loadedContent;
      setTitle(loadedTitle);
      setContent(loadedContent);
      setVersion(result.draft?.version ?? 0);
      setSavedAt(result.draft?.updatedAt ?? null);
      setRevisions(result.revisions);
      setReviews(reviewResult.reviews);
      setFinalizations(finalizationResult.finalizations);
      setAuthoring(authoringResult);
      setSelectedChapterId((current) => authoringResult.chapters.some((chapter) => chapter.id === current) ? current : authoringResult.chapters[0]?.id ?? '');
      setLoadedCaseId(caseId);
    } catch (reason) {
      if (sequence === loadSequence.current && selectedCaseRef.current === caseId) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (sequence === loadSequence.current && selectedCaseRef.current === caseId) setLoading(false);
    }
  }, [cases]);

  useEffect(() => {
    void (async () => {
      try {
        const result = await apiRequest<{ cases: CaseSummary[] }>('/api/cases?limit=100&q=');
        setCases(result.cases);
        const requestedCaseId = new URLSearchParams(window.location.search).get('caseId') ?? '';
        const first = result.cases.some((record) => record.id === requestedCaseId) ? requestedCaseId : result.cases[0]?.id ?? '';
        selectedCaseRef.current = first;
        setSelectedCaseId(first);
      } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false); }
    })();
  }, []);

  useEffect(() => { if (selectedCaseId) void loadDraft(selectedCaseId); else setLoading(false); }, [selectedCaseId, loadDraft]);

  const saveNow = useCallback(async () => {
    if (!editable || !dirty || saving || !selectedCaseId || loadedCaseId !== selectedCaseId || selectedCaseRef.current !== selectedCaseId) return;
    const requestCaseId = selectedCaseId;
    const requestTitle = title;
    const requestContent = content;
    const requestVersion = version;
    setSaving(true); setError('');
    try {
      const result = await apiRequest<ReportPayload>(`/api/report-drafts?caseId=${encodeURIComponent(requestCaseId)}`, {
        method: 'PUT', body: JSON.stringify({ title: requestTitle, content: requestContent, expectedVersion: requestVersion })
      });
      if (selectedCaseRef.current !== requestCaseId || !result.draft) return;
      setVersion(result.draft.version);
      setSavedAt(result.draft.updatedAt);
      setRevisions(result.revisions);
      setDirty(titleRef.current !== requestTitle || contentRef.current !== requestContent);
    } catch (reason) {
      if (selectedCaseRef.current !== requestCaseId) return;
      setError(reason instanceof ApiError && reason.status === 409 ? '다른 탭에서 보고서가 먼저 저장되었습니다. 최신본을 다시 불러온 뒤 계속 작성해 주세요.' : reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (selectedCaseRef.current === requestCaseId) setSaving(false);
    }
  }, [content, dirty, editable, loadedCaseId, saving, selectedCaseId, title, version]);

  useEffect(() => {
    if (!dirty || saving) return;
    const timer = window.setTimeout(() => { void saveNow(); }, 900);
    return () => window.clearTimeout(timer);
  }, [content, dirty, saveNow, saving, title]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || saving) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saving]);

  const selectCase = (caseId: string) => {
    loadSequence.current += 1;
    selectedCaseRef.current = caseId;
    titleRef.current = ''; contentRef.current = '';
    setSelectedCaseId(caseId); setLoadedCaseId(''); setTitle(''); setContent(''); setVersion(0); setRevisions([]); setReviews([]); setFinalizations([]); setAuthoring(null); setSelectedChapterId(''); setReviewNote(''); setSavedAt(null); setDirty(false); setError('');
  };

  const generateChapter = async () => {
    if (!editable || !authoring?.available || !authoring.aiConnected || !selectedChapterId || dirty || saving || generating || loadedCaseId !== selectedCaseId) return;
    const requestCaseId = selectedCaseId;
    setGenerating(true); setError('');
    try {
      const result = await apiRequest<{ chapter: { chapterCode: string; title: string; content: string; promptVersion: number } }>('/api/report-authoring/generate', {
        method: 'POST', body: JSON.stringify({ caseId: requestCaseId, chapterId: selectedChapterId, expectedDraftVersion: version })
      });
      if (selectedCaseRef.current !== requestCaseId) return;
      const start = `<!-- AI-CHAPTER:${result.chapter.chapterCode}:START -->`;
      const end = `<!-- AI-CHAPTER:${result.chapter.chapterCode}:END -->`;
      const block = `${start}\n## ${result.chapter.chapterCode} ${result.chapter.title}\n\n${result.chapter.content}\n${end}`;
      const escapedCode = result.chapter.chapterCode.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const existing = new RegExp(`<!-- AI-CHAPTER:${escapedCode}:START -->[\\s\\S]*?<!-- AI-CHAPTER:${escapedCode}:END -->`, 'u');
      const nextContent = existing.test(content) ? content.replace(existing, block) : `${content.trim()}${content.trim() ? '\n\n' : ''}${block}`;
      contentRef.current = nextContent; setContent(nextContent); setDirty(true);
    } catch (reason) { if (selectedCaseRef.current === requestCaseId) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (selectedCaseRef.current === requestCaseId) setGenerating(false); }
  };

  const currentReview = reviews.find((review) => review.reportVersion === version) ?? null;
  const currentFinalization = currentReview ? finalizations.find((entry) => entry.reviewId === currentReview.id) ?? null : null;
  const pendingReview = reviews.find((review) => review.status === 'PENDING') ?? null;
  const requestReview = async () => {
    if (!editable || !selectedCaseId || !version || dirty || saving || currentReview || pendingReview) return;
    const requestCaseId = selectedCaseId;
    setSubmittingReview(true); setError('');
    try {
      const result = await apiRequest<{ reviews: PreviewReportReview[] }>('/api/report-reviews', {
        method: 'POST',
        headers: { 'Idempotency-Key': `report-review:${requestCaseId}:v${version}` },
        body: JSON.stringify({ caseId: requestCaseId, expectedVersion: version, note: reviewNote.trim() })
      });
      if (selectedCaseRef.current === requestCaseId) { setReviews(result.reviews); setReviewNote(''); }
    } catch (reason) { if (selectedCaseRef.current === requestCaseId) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (selectedCaseRef.current === requestCaseId) setSubmittingReview(false); }
  };

  const finalizeApproved = async () => {
    if (!currentReview || currentReview.status !== 'APPROVED' || !selectedCaseId || currentFinalization) return;
    setSubmittingReview(true); setError('');
    try {
      const result = await apiRequest<{ finalizations: Finalization[] }>('/api/report-finalizations', {
        method: 'POST', headers: { 'Idempotency-Key': `report-finalize:${selectedCaseId}:v${version}` },
        body: JSON.stringify({ caseId: selectedCaseId, reviewId: currentReview.id })
      });
      setFinalizations(result.finalizations);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSubmittingReview(false); }
  };

  const generateOutput = async (format: 'DOCX' | 'PDF') => {
    if (!currentFinalization) return;
    setSubmittingReview(true); setError('');
    try {
      const result = await apiRequest<{ finalizations: Finalization[] }>(`/api/report-finalizations/${encodeURIComponent(currentFinalization.id)}/outputs`, { method: 'POST', body: JSON.stringify({ format }) });
      setFinalizations(result.finalizations);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSubmittingReview(false); }
  };

  const downloadOutput = async (output: FinalOutput) => {
    setError('');
    try {
      const result = await apiDownload(`/api/report-outputs/${encodeURIComponent(output.id)}/download`);
      const anchor = document.createElement('a');
      anchor.href = URL.createObjectURL(result.blob); anchor.download = result.filename; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(anchor.href), 1_000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  if (!loading && cases.length === 0) return <StatusFeedbackState type="empty" title="보고서를 연결할 사건이 없습니다" message="먼저 사건을 등록하면 사건별 D1 보고서 저장 공간이 자동으로 준비됩니다." actionLabel="새 사건 등록" onAction={() => onNavigate('/cases/new')} />;

  return (
    <div className="content-stack" aria-label="D1 보고서 자동 저장 스튜디오">
      <Card title="REPORT STUDIO · D1 AUTOSAVE">
        <div className="inline-form">
          <Select label="작성할 사건" value={selectedCaseId} onChange={(event) => selectCase(event.target.value)} disabled={saving} options={cases.map((record) => ({ value: record.id, label: `${record.caseNumber} · ${record.title}` }))} />
          <div className="action-row" aria-live="polite">
            <span className="preview-pill">{error ? '저장 확인 필요' : saving ? 'D1 저장 중' : dirty ? '변경사항 있음' : version ? `D1 저장 완료 · v${version}` : '새 초안'}</span>
            <Button onClick={() => void saveNow()} disabled={!editable || !dirty || saving || loadedCaseId !== selectedCaseId}>{saving ? '저장 중…' : '지금 저장'}</Button>
            {error && <Button variant="secondary" onClick={() => selectedCaseId && void loadDraft(selectedCaseId)}>최신본 다시 불러오기</Button>}
          </div>
        </div>
        <p className="muted">본문과 저장 이력은 Cloudflare D1에 보존됩니다. Google Drive 파일 연결은 현재 보류 중입니다.</p>
      </Card>

      {loading || loadedCaseId !== selectedCaseId ? <StatusFeedbackState type="loading" message="사건별 보고서 최신본을 불러오고 있습니다." /> : <>
        <Card title="AI CHAPTER WORKFLOW · 관리자 승인 프롬프트">
          {!authoring?.available ? <div className="error-box">{authoring?.unavailableReason ?? '이 유형의 승인된 챕터 프롬프트가 없습니다.'}</div> : <div className="form-stack">
            <div className="inline-form">
              <Select label="자동 작성할 챕터" value={selectedChapterId} onChange={(event) => setSelectedChapterId(event.target.value)} disabled={!editable || generating || saving} options={authoring.chapters.map((chapter) => ({ value: chapter.id, label: `${chapter.chapterCode} · ${chapter.title} · prompt v${chapter.promptVersion}` }))} />
              <Button onClick={() => void generateChapter()} disabled={!editable || !authoring.aiConnected || !selectedChapterId || dirty || saving || generating}>{generating ? '근거 분석·작성 중…' : '선택 챕터 자동 작성'}</Button>
            </div>
            <p className="muted">사건 유형 {authoring.claimType} · 모델 {authoring.modelLabel} · 프롬프트 원문은 관리자만 열람·수정할 수 있습니다. 작성된 내용은 DRAFT로 삽입된 뒤 D1 자동 저장과 사람 검토를 거칩니다.</p>
            {!authoring.aiConnected && <div className="error-box">관리자가 Cloudflare 서버 Secret에 OPENAI_API_KEY를 연결하기 전에는 자동 작성 버튼이 비활성화됩니다.</div>}
            {(dirty || saving) && <p className="notice-box">현재 편집 내용을 먼저 저장하면 최신 보고서 버전을 기준으로 AI 챕터를 작성할 수 있습니다.</p>}
          </div>}
        </Card>
        <Card title={selectedCase ? `${selectedCase.caseNumber} · ${selectedCase.title}` : '보고서 작성'}>
          <div className="form-stack">
            <Input label="보고서 제목" value={title} maxLength={300} readOnly={!editable} onChange={(event) => { titleRef.current = event.target.value; setTitle(event.target.value); setDirty(true); }} onBlur={() => void saveNow()} />
            <label htmlFor="preview-report-body">보고서 본문</label>
            <textarea id="preview-report-body" className="report-editor" value={content} maxLength={500000} readOnly={!editable} aria-readonly={!editable} onChange={(event) => { contentRef.current = event.target.value; setContent(event.target.value); setDirty(true); }} onBlur={() => void saveNow()} />
            <p className="muted">{editable ? '입력 후 0.9초가 지나면 자동 저장됩니다.' : 'Reviewer 계정은 저장된 보고서를 읽을 수 있지만 본문은 수정할 수 없습니다.'} {savedAt ? `마지막 저장 ${new Date(savedAt).toLocaleString('ko-KR')}` : ''}</p>
            {error && <p className="error-box" role="alert">{error}</p>}
          </div>
        </Card>
        <Card title={`저장 이력 ${revisions.length}건`}>
          {revisions.length ? <ul className="dashboard-work-list">{revisions.map((revision) => <li key={revision.id}><span><strong>버전 {revision.version} · {revision.title}</strong><small>{new Date(revision.savedAt).toLocaleString('ko-KR')} · {revision.savedBy.name} · SHA {revision.contentSha256.slice(0, 12)}…</small></span></li>)}</ul> : <p className="empty-box">아직 저장된 버전이 없습니다. 첫 내용을 입력하면 자동 저장됩니다.</p>}
        </Card>
        <Card title="검토·승인 제출">
          <div className="form-stack">
            <div className="action-row"><span className="preview-pill">{currentReview ? currentReview.status === 'PENDING' ? `v${version} 검토 대기` : currentReview.status === 'APPROVED' ? `v${version} 승인 완료` : `v${version} 수정 요청` : pendingReview ? `v${pendingReview.reportVersion} 검토 중 · 현재 v${version}` : version ? `v${version} 제출 가능` : '저장 후 제출 가능'}</span><Button variant="secondary" onClick={() => onNavigate('/approval')}>검토·승인함 보기</Button></div>
            {currentReview?.decisionNote && <p className="notice-box"><strong>검토 의견</strong><br />{currentReview.decisionNote}</p>}
            {!currentReview && editable && <>
              <label htmlFor="preview-review-note">검토 요청 메모</label>
              <textarea id="preview-review-note" className="report-editor report-editor--decision" value={reviewNote} maxLength={2000} onChange={(event) => setReviewNote(event.target.value)} placeholder="검토자가 확인할 쟁점이나 근거를 남기세요." />
              <div className="action-row"><Button onClick={() => void requestReview()} disabled={!version || dirty || saving || submittingReview || !!pendingReview || loadedCaseId !== selectedCaseId}>{submittingReview ? '제출 중…' : '저장된 최신본 검토 요청'}</Button>{dirty && <span className="muted">변경사항을 먼저 저장해야 합니다.</span>}{pendingReview && <span className="muted">기존 검토가 끝난 뒤 새 버전을 제출할 수 있습니다.</span>}</div>
            </>}
          </div>
        </Card>
        <Card title="FINAL OUTPUT · 승인본 확정 및 다운로드">
          {!currentReview || currentReview.status !== 'APPROVED' ? <p className="empty-box">독립 검토자가 현재 버전을 승인하면 최종 확정과 DOCX/PDF 출력이 열립니다.</p> : !currentFinalization ? <div className="form-stack">
            <p className="notice-box"><strong>승인 완료 · v{currentReview.reportVersion}</strong><br />승인자 {currentReview.reviewedBy?.name} · 이 정확한 버전만 최종 확정됩니다.</p>
            <div className="action-row"><Button onClick={() => void finalizeApproved()} disabled={submittingReview || dirty || saving}>승인본 최종 확정</Button><span className="muted">확정 기록은 D1에서 변경·삭제할 수 없습니다.</span></div>
          </div> : <div className="form-stack">
            <p className="notice-box"><strong>최종 확정 완료 · v{currentFinalization.reportVersion}</strong><br />{currentFinalization.finalizedBy.name} · {new Date(currentFinalization.finalizedAt).toLocaleString('ko-KR')} · 승인자 {currentFinalization.approvedBy}</p>
            <div className="action-row">
              {(['DOCX', 'PDF'] as const).map((format) => {
                const output = currentFinalization.outputs.find((entry) => entry.format === format);
                return output ? <Button key={format} variant="secondary" onClick={() => void downloadOutput(output)}>{format} 다운로드</Button> : <Button key={format} onClick={() => void generateOutput(format)} disabled={submittingReview}>{format} 생성</Button>;
              })}
            </div>
            {currentFinalization.outputs.map((output) => <p className="muted" key={output.id}>{output.format} · {(output.byteSize / 1024).toFixed(1)} KB · SHA {output.contentSha256.slice(0, 16)}…</p>)}
          </div>}
        </Card>
      </>}
    </div>
  );
}
