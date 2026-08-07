import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card } from '@claim-studio/ui';
import { ApiError, apiRequest } from '../api';
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
  sourceSha256: string;
  sourceVersion: number;
  targetParagraphIndex: number;
  quoteText: string;
  anchorPosition: string;
  documentVersion?: { displayName: string; versionNumber: number } | null;
  meeting?: { title: string; version: number } | null;
}

interface Revision {
  id: string;
  authorId: string;
  revisionNumber: number;
  title: string;
  content: string;
  validationStatus: 'VALID' | 'WARNING' | 'INVALID';
  validationErrorsJson: string;
  sha256: string;
  createdAt: string;
  author: { id: string; name: string; email: string };
  evidenceLinks: EvidenceLink[];
}

interface CommentRow {
  id: string;
  revisionId?: string | null;
  commentType: 'COMMENT' | 'REVISION_REQUEST';
  content: string;
  isResolved: boolean;
  createdAt: string;
  author: { id: string; name: string };
  resolvedBy?: { id: string; name: string } | null;
}

interface ApprovalEvent {
  id: string;
  eventNumber: number;
  approvedRevisionId: string;
  status: 'APPROVED' | 'UNLOCKED';
  comment?: string | null;
  createdAt: string;
  approver: { id: string; name: string };
}

interface ReportSection {
  id: string;
  sectionNumber: number;
  title: string;
  status: 'DRAFT' | 'IN_REVIEW' | 'REJECTED' | 'APPROVED';
  version: number;
  isRequired: boolean;
  revisions: Revision[];
  comments: CommentRow[];
  approvals: ApprovalEvent[];
}

interface ReportDetail {
  id: string;
  caseId: string;
  reportInstanceId: string;
  title: string;
  version: number;
  reportInstance: { id: string; snapshotSha256: string; templateCodeSnapshot: string; templateVersionNumberSnapshot: number };
  case: {
    id: string;
    title: string;
    caseNumber: string;
    claimType: string;
    documents: Array<{
      id: string;
      title: string;
      versions: Array<{ id: string; versionNumber: number; displayName: string; sha256: string; fileSize: number; mimeType: string; isFinal: boolean }>;
    }>;
    meetings: Array<{ id: string; title: string; status: string; version: number; rawTextSha256?: string | null }>;
  };
  sections: ReportSection[];
  mergeSnapshots: Array<{ id: string; snapshotVersion: number; snapshotSha256: string; createdAt: string; createdBy: { name: string } }>;
}

interface DraftState {
  content: string;
  baseVersion: number;
  dirty: boolean;
  state: 'idle' | 'saving' | 'saved' | 'conflict' | 'error';
  lastSavedAt?: string;
}

interface PendingEvidence {
  sourceType: 'DOCUMENT' | 'MEETING';
  sourceId: string;
  targetParagraphIndex: number;
  quoteText: string;
  anchorPosition: string;
}

interface ConflictState {
  currentVersion: number;
  latestRevision?: Revision | null;
}

const statusLabel: Record<ReportSection['status'], string> = {
  DRAFT: '초안', IN_REVIEW: '검토 중', REJECTED: '수정 요청', APPROVED: '승인 잠금'
};

function latestContent(section: ReportSection): string {
  return section.revisions[0]?.content ?? '';
}

function parsedValidationErrors(revision?: Revision): Array<{ code: string; paragraphIndex: number; message: string }> {
  if (!revision) return [];
  try {
    const parsed = JSON.parse(revision.validationErrorsJson) as unknown;
    return Array.isArray(parsed) ? parsed as Array<{ code: string; paragraphIndex: number; message: string }> : [];
  } catch {
    return [{ code: 'CORRUPT_VALIDATION', paragraphIndex: 0, message: '검증 결과를 읽을 수 없습니다.' }];
  }
}

export const ReportStudio: React.FC<ReportStudioProps> = ({ reportId, roles, onNavigate }) => {
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [pendingEvidence, setPendingEvidence] = useState<Record<string, PendingEvidence[]>>({});
  const [conflicts, setConflicts] = useState<Record<string, ConflictState | undefined>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<'outline' | 'editor' | 'review'>('editor');
  const [commentType, setCommentType] = useState<'COMMENT' | 'REVISION_REQUEST'>('COMMENT');
  const [commentContent, setCommentContent] = useState('');
  const [approvalComment, setApprovalComment] = useState('');
  const [sourceType, setSourceType] = useState<'DOCUMENT' | 'MEETING'>('MEETING');
  const [sourceId, setSourceId] = useState('');
  const [targetParagraphIndex, setTargetParagraphIndex] = useState(0);
  const [quoteText, setQuoteText] = useState('');
  const [anchorPosition, setAnchorPosition] = useState('');

  // P10 AI Gateway States
  const [aiPolicy, setAiPolicy] = useState<{ externalAiAllowed: boolean; maxTokensPerRequest: number; maxCostMicrosPerRequest: number } | null>(null);
  const [aiModels, setAiModels] = useState<{ providerId: string; providerKind: string; name: string; modelCode: string }[]>([]);
  const [selectedAiModel, setSelectedAiModel] = useState<string>('fake-claim-v1');
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [aiRequestId, setAiRequestId] = useState<string | null>(null);
  const [aiResultMsg, setAiResultMsg] = useState<string | null>(null);

  // P11 Grounded AI Authoring State
  const [selectedSources, setSelectedSources] = useState<Array<{ sourceType: 'MATERIAL' | 'MEETING'; sourceId: string; sourceVersionId: string; allowedAnchors: number[] }>>([]);
  const [activeSelection, setActiveSelection] = useState<{ id: string; manifestSha256: string; items: any[] } | null>(null);
  const [showCostModal, setShowCostModal] = useState<boolean>(false);
  const [, setSuggestions] = useState<any[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState<any | null>(null);
  const [authoringInstruction, setAuthoringInstruction] = useState('선택한 근거만 사용하여 이 장의 사실관계 검토 초안을 작성하세요.');

  const canEdit = roles.some((role) => ['admin', 'pm', 'staff'].includes(role));
  const canApprove = roles.some((role) => ['admin', 'director', 'reviewer'].includes(role));
  const canMerge = roles.some((role) => ['admin', 'director', 'pm'].includes(role));

  const loadSuggestions = useCallback(async (secId: string) => {
    if (!reportId) return;
    try {
      const res = await apiRequest<{ suggestions: any[] }>(`/api/reports/${encodeURIComponent(reportId)}/sections/${encodeURIComponent(secId)}/ai/suggestions`);
      setSuggestions(res.suggestions);
      if (res.suggestions.length > 0) {
        setActiveSuggestion(res.suggestions[0]);
        setAiStatus(res.suggestions[0].status === 'PROCESSING' ? 'loading' : res.suggestions[0].status === 'GENERATED' ? 'success' : 'error');
      } else {
        setActiveSuggestion(null);
      }
    } catch {
      // Ignore load error
    }
  }, [reportId]);

  const lockGroundingSelection = async () => {
    if (!reportId || !activeSection || selectedSources.length === 0) {
      setNotice('최소 하나 이상의 근거 자료를 선택해야 합니다.');
      return;
    }
    const selectedModel = aiModels.find((model) => `${model.providerId}::${model.modelCode}` === selectedAiModel);
    if (!selectedModel) {
      setNotice('사건 정책에서 허용된 AI 공급자와 모델을 먼저 선택해야 합니다.');
      return;
    }
    try {
      const res = await apiRequest<{ selection: { id: string; manifestSha256: string; items: any[] } }>(
        `/api/reports/${encodeURIComponent(reportId)}/sections/${encodeURIComponent(activeSection.id)}/grounding/selections`,
        {
          method: 'POST',
          body: JSON.stringify({
            providerId: selectedModel.providerId,
            modelCode: selectedModel.modelCode,
            instruction: authoringInstruction,
            sources: selectedSources
          })
        }
      );
      setActiveSelection(res.selection);
      setShowCostModal(true);
      setNotice(`근거 Manifest 고정 완료 (hash: ${res.selection.manifestSha256.slice(0, 10)})`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '근거 Manifest 고정에 실패했습니다.');
    }
  };

  const generateGroundedSuggestion = async () => {
    if (!reportId || !activeSection || !activeSelection) return;
    setShowCostModal(false);
    setAiStatus('loading');
    setAiResultMsg(null);
    try {
      const res = await apiRequest<{ suggestion: any }>(
        `/api/reports/${encodeURIComponent(reportId)}/sections/${encodeURIComponent(activeSection.id)}/ai/suggestions`,
        {
          method: 'POST',
          body: JSON.stringify({
            selectionId: activeSelection.id,
            instruction: authoringInstruction,
            idempotencyKey: `P11-STUDIO-${activeSelection.id}`,
            waitForCompletion: false
          })
        }
      );
      setAiStatus(res.suggestion.status === 'PROCESSING' ? 'loading' : res.suggestion.status === 'GENERATED' ? 'success' : 'error');
      setActiveSuggestion(res.suggestion);
      await loadSuggestions(activeSection.id);
      setNotice(res.suggestion.status === 'PROCESSING' ? 'AI 근거 초안 생성 요청이 시작되었습니다.' : res.suggestion.status === 'GENERATED' ? 'AI 근거 초안 생성 완료' : 'AI 인용 검증 실패');
    } catch (err) {
      setAiStatus('error');
      setNotice(err instanceof Error ? err.message : 'AI 초안 생성 실패');
    }
  };

  const applySuggestionToContent = async (suggestionId: string) => {
    if (!reportId || !activeSection) return;
    try {
      const res = await apiRequest<{ revision: any; suggestion: any; sectionVersion: number }>(
        `/api/reports/${encodeURIComponent(reportId)}/sections/${encodeURIComponent(activeSection.id)}/ai/suggestions/${encodeURIComponent(suggestionId)}/apply`,
        {
          method: 'POST',
          body: JSON.stringify({ expectedVersion: activeSection.version, idempotencyKey: `P11-APPLY-${suggestionId}-${activeSection.version}` })
        }
      );
      setDrafts((current) => ({
        ...current,
        [activeSection.id]: {
          content: res.revision.content,
          baseVersion: res.sectionVersion,
          dirty: false,
          state: 'saved'
        }
      }));
      updateSection(activeSection.id, (sec) => ({
        ...sec,
        version: res.sectionVersion,
        revisions: [res.revision, ...sec.revisions]
      }));
      await loadSuggestions(activeSection.id);
      setNotice('AI 초안이 본문에 새 DRAFT 개정본으로 적용되었습니다.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '본문 적용 실패');
    }
  };

  const cancelGroundedSuggestion = async (suggestionId: string) => {
    if (!reportId || !activeSection) return;
    try {
      await apiRequest(`/api/reports/${encodeURIComponent(reportId)}/sections/${encodeURIComponent(activeSection.id)}/ai/suggestions/${encodeURIComponent(suggestionId)}/cancel`, { method: 'POST' });
      setAiStatus('error');
      await loadSuggestions(activeSection.id);
      setNotice('AI 근거 초안 생성 요청이 취소되었습니다.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '초안 생성 취소 실패');
    }
  };

  const discardSuggestion = async (suggestionId: string) => {
    if (!reportId || !activeSection) return;
    try {
      await apiRequest(`/api/reports/${encodeURIComponent(reportId)}/sections/${encodeURIComponent(activeSection.id)}/ai/suggestions/${encodeURIComponent(suggestionId)}`, {
        method: 'DELETE'
      });
      await loadSuggestions(activeSection.id);
      setNotice('AI 초안이 폐기되었습니다.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '초안 폐기 실패');
    }
  };

  const fetchAiData = useCallback(async (caseId: string) => {
    try {
      const polRes = await apiRequest<{ policy: { externalAiAllowed: boolean; maxTokensPerRequest: number; maxCostMicrosPerRequest: number } }>(`/api/ai/cases/${caseId}/policy`);
      setAiPolicy(polRes.policy);
      const modRes = await apiRequest<{ models: { providerId: string; providerKind: string; name: string; modelCode: string }[] }>(`/api/ai/models?caseId=${encodeURIComponent(caseId)}`);
      setAiModels(modRes.models);
      if (modRes.models.length > 0) {
        setSelectedAiModel(`${modRes.models[0].providerId}::${modRes.models[0].modelCode}`);
      }
    } catch {
      // Ignore AI metadata load failures
    }
  }, []);

  const toggleExternalAiPolicy = async (allowed: boolean) => {
    if (!report?.case.id) return;
    try {
      const res = await apiRequest<{ policy: { externalAiAllowed: boolean; maxTokensPerRequest: number; maxCostMicrosPerRequest: number } }>(`/api/ai/cases/${report.case.id}/policy`, {
        method: 'POST',
        body: JSON.stringify({ externalAiAllowed: allowed })
      });
      setAiPolicy(res.policy);
    } catch (err) {
      setAiResultMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const testAiGeneration = async () => {
    if (!report?.case.id || aiModels.length === 0) return;
    const model = aiModels.find((m) => `${m.providerId}::${m.modelCode}` === selectedAiModel) || aiModels[0];
    setAiStatus('loading');
    setAiResultMsg(null);
    setAiRequestId(null);
    try {
      const res = await apiRequest<{ result: { requestId: string; status: string; actualCostMicros?: number; totalTokens?: number; resultText?: string; redactedErrorMessage?: string } }>('/api/ai/requests', {
        method: 'POST',
        body: JSON.stringify({
          caseId: report.case.id,
          providerConfigId: model.providerId,
          modelCode: model.modelCode,
          prompt: model.providerKind === 'LOCAL_FAKE' ? 'P10 Report Studio transport diagnostic TRIGGER_SLOW_SUCCESS' : 'P10 Report Studio transport diagnostic',
          idempotencyKey: `IDEMP-STUDIO-${Date.now()}`,
          waitForCompletion: false
        })
      });
      setAiRequestId(res.result.requestId);
      if (res.result.status === 'PROCESSING') {
        for (let poll = 0; poll < 80; poll += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 100));
          const current = await apiRequest<{ result: { requestId: string; status: string; actualCostMicros: number; totalTokens: number; resultText?: string; redactedErrorMessage?: string } }>(`/api/ai/requests/${encodeURIComponent(res.result.requestId)}`);
          if (current.result.status === 'PROCESSING') continue;
          if (current.result.status === 'COMPLETED') {
            setAiStatus('success');
            setAiResultMsg(`[Gateway 진단 성공] 토큰: ${current.result.totalTokens}, 비용: $${(current.result.actualCostMicros / 1000000).toFixed(4)} USD — ${current.result.resultText}`);
          } else {
            setAiStatus('error');
            setAiResultMsg(`[Gateway 요청 ${current.result.status}] ${current.result.redactedErrorMessage || '오류 발생'}`);
          }
          return;
        }
        throw new Error('AI Gateway 상태 확인 시간이 초과되었습니다.');
      } else if (res.result.status === 'COMPLETED') {
        setAiStatus('success');
        setAiResultMsg(`[Gateway 진단 성공] 토큰: ${res.result.totalTokens ?? 0}, 비용: $${((res.result.actualCostMicros ?? 0) / 1000000).toFixed(4)} USD — ${res.result.resultText}`);
      } else {
        setAiStatus('error');
        setAiResultMsg(`[Gateway 요청 ${res.result.status}] ${res.result.redactedErrorMessage || '오류 발생'}`);
      }
    } catch (err) {
      setAiStatus('error');
      setAiResultMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const cancelAiRequest = async () => {
    if (!aiRequestId) return;
    try {
      await apiRequest(`/api/ai/requests/${aiRequestId}/cancel`, { method: 'POST' });
      setAiStatus('error');
      setAiResultMsg('AI Gateway 실행 중 요청이 취소되었습니다.');
    } catch (err) {
      setAiResultMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const loadStudio = useCallback(async () => {
    if (!reportId) {
      setError('사건에서 생성된 ReportInstance 경로로 스튜디오를 열어야 합니다.');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const response = await apiRequest<{ report: ReportDetail }>(`/api/reports/${encodeURIComponent(reportId)}/studio`);
      setReport(response.report);
      setSelectedSectionId((current) => current && response.report.sections.some((section) => section.id === current)
        ? current
        : response.report.sections[0]?.id ?? null);
      setDrafts((current) => Object.fromEntries(response.report.sections.map((section) => {
        const existing = current[section.id];
        return [section.id, existing?.dirty || existing?.state === 'conflict'
          ? existing
          : { content: latestContent(section), baseVersion: section.version, dirty: false, state: 'idle' as const }];
      })));
      setError(null);
      void fetchAiData(response.report.caseId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '보고서 스튜디오를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => { void loadStudio(); }, [loadStudio]);

  const activeSection = useMemo(
    () => report?.sections.find((section) => section.id === selectedSectionId) ?? null,
    [report, selectedSectionId]
  );
  const activeDraft = activeSection ? drafts[activeSection.id] : undefined;
  const activeEvidence = activeSection ? pendingEvidence[activeSection.id] ?? [] : [];
  const activeConflict = activeSection ? conflicts[activeSection.id] : undefined;
  const activeRevision = activeSection?.revisions[0];
  const validationErrors = parsedValidationErrors(activeRevision);

  useEffect(() => {
    setSelectedSources([]);
    setActiveSelection(null);
    if (selectedSectionId) void loadSuggestions(selectedSectionId);
  }, [selectedSectionId, loadSuggestions]);

  useEffect(() => {
    if (!activeSection || activeSuggestion?.status !== 'PROCESSING') return;
    const timer = window.setInterval(() => { void loadSuggestions(activeSection.id); }, 200);
    return () => window.clearInterval(timer);
  }, [activeSection, activeSuggestion?.status, loadSuggestions]);

  const updateSection = useCallback((sectionId: string, updater: (section: ReportSection) => ReportSection) => {
    setReport((current) => current ? { ...current, sections: current.sections.map((section) => section.id === sectionId ? updater(section) : section) } : current);
  }, []);

  const saveSection = useCallback(async (mode: 'AUTO' | 'MANUAL', targetSectionId?: string) => {
    if (!reportId || !report) return;
    const sectionId = targetSectionId ?? selectedSectionId;
    const section = report.sections.find((entry) => entry.id === sectionId);
    const draft = sectionId ? drafts[sectionId] : undefined;
    if (!section || !draft || !canEdit || section.status === 'APPROVED' || !draft.dirty || draft.state === 'saving' || draft.state === 'conflict') return;
    setDrafts((current) => ({ ...current, [section.id]: { ...current[section.id], state: 'saving' } }));
    try {
      const response = await apiRequest<{ revision: Revision; sectionVersion: number }>(
        `/api/reports/${encodeURIComponent(reportId)}/sections/${encodeURIComponent(section.id)}/revisions`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: section.title,
            content: draft.content,
            structuredDataJson: '{}',
            expectedVersion: draft.baseVersion,
            saveMode: mode,
            evidenceLinks: pendingEvidence[section.id] ?? []
          })
        }
      );
      const savedAt = new Date().toISOString();
      setDrafts((current) => ({
        ...current,
        [section.id]: { content: draft.content, baseVersion: response.sectionVersion, dirty: false, state: 'saved', lastSavedAt: savedAt }
      }));
      setPendingEvidence((current) => ({ ...current, [section.id]: [] }));
      setConflicts((current) => ({ ...current, [section.id]: undefined }));
      updateSection(section.id, (current) => ({
        ...current,
        status: 'DRAFT',
        version: response.sectionVersion,
        revisions: [response.revision, ...current.revisions]
      }));
      setNotice(mode === 'AUTO' ? '자동저장으로 새 개정본을 생성했습니다.' : '수동저장으로 새 개정본을 생성했습니다.');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409 && typeof caught.payload.currentVersion === 'number') {
        setConflicts((current) => ({
          ...current,
          [section.id]: {
            currentVersion: caught.payload.currentVersion as number,
            latestRevision: (caught.payload.latestRevision as Revision | null | undefined) ?? null
          }
        }));
        setDrafts((current) => ({ ...current, [section.id]: { ...current[section.id], state: 'conflict' } }));
      } else {
        setDrafts((current) => ({ ...current, [section.id]: { ...current[section.id], state: 'error' } }));
        setNotice(caught instanceof Error ? caught.message : '저장에 실패했습니다.');
      }
    }
  }, [canEdit, drafts, pendingEvidence, report, reportId, selectedSectionId, updateSection]);

  useEffect(() => {
    if (!activeSection || !activeDraft?.dirty || activeDraft.state !== 'idle' || !canEdit || activeSection.status === 'APPROVED') return;
    const timer = window.setTimeout(() => { void saveSection('AUTO', activeSection.id); }, 1200);
    return () => window.clearTimeout(timer);
  }, [activeDraft?.content, activeDraft?.dirty, activeDraft?.state, activeSection, canEdit, saveSection]);

  const selectSection = (sectionId: string) => {
    setSelectedSectionId(sectionId);
    setMobilePane('editor');
    setNotice(null);
  };

  const addEvidence = () => {
    if (!activeSection || !sourceId || !quoteText.trim() || !anchorPosition.trim()) {
      setNotice('근거 자료, 인용문, 원문 위치를 모두 입력해 주세요.');
      return;
    }
    const paragraphCount = (activeDraft?.content ?? '').split(/\r?\n\s*\r?\n/).map((value) => value.trim()).filter(Boolean).length;
    if (targetParagraphIndex < 0 || targetParagraphIndex >= paragraphCount) {
      setNotice('연결할 보고서 문단 번호가 현재 본문 범위를 벗어났습니다.');
      return;
    }
    const next: PendingEvidence = { sourceType, sourceId, targetParagraphIndex, quoteText: quoteText.trim(), anchorPosition: anchorPosition.trim() };
    setPendingEvidence((current) => ({ ...current, [activeSection.id]: [...(current[activeSection.id] ?? []), next] }));
    setSourceId('');
    setQuoteText('');
    setAnchorPosition('');
    setDrafts((current) => ({ ...current, [activeSection.id]: { ...current[activeSection.id], dirty: true, state: 'idle' } }));
  };

  const postComment = async () => {
    if (!reportId || !activeSection || !commentContent.trim()) return;
    try {
      const response = await apiRequest<{ comment: CommentRow; sectionVersion: number }>(
        `/api/reports/${encodeURIComponent(reportId)}/sections/${encodeURIComponent(activeSection.id)}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({
            commentType,
            content: commentContent,
            revisionId: activeRevision?.id ?? null,
            ...(commentType === 'REVISION_REQUEST' ? { expectedVersion: activeSection.version } : {})
          })
        }
      );
      updateSection(activeSection.id, (section) => ({
        ...section,
        comments: [response.comment, ...section.comments],
        status: commentType === 'REVISION_REQUEST' ? 'REJECTED' : section.status,
        version: commentType === 'REVISION_REQUEST' ? response.sectionVersion : section.version
      }));
      if (commentType === 'REVISION_REQUEST') {
        setDrafts((current) => ({ ...current, [activeSection.id]: { ...current[activeSection.id], baseVersion: response.sectionVersion } }));
      }
      setCommentContent('');
      setNotice(commentType === 'REVISION_REQUEST' ? '수정 요청을 기록했습니다.' : '댓글을 기록했습니다.');
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : '댓글 등록에 실패했습니다.');
    }
  };

  const resolveComment = async (commentId: string) => {
    if (!reportId || !activeSection) return;
    try {
      await apiRequest(`/api/reports/${encodeURIComponent(reportId)}/sections/${encodeURIComponent(activeSection.id)}/comments/${encodeURIComponent(commentId)}/resolve`, {
        method: 'PATCH', body: '{}'
      });
      updateSection(activeSection.id, (section) => ({
        ...section,
        comments: section.comments.map((comment) => comment.id === commentId ? { ...comment, isResolved: true } : comment)
      }));
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : '댓글 해결 처리에 실패했습니다.'); }
  };

  const approveSection = async () => {
    if (!reportId || !activeSection || !activeRevision) return;
    try {
      const response = await apiRequest<{ approval: ApprovalEvent; sectionVersion: number }>(
        `/api/reports/${encodeURIComponent(reportId)}/sections/${encodeURIComponent(activeSection.id)}/approve`,
        { method: 'POST', body: JSON.stringify({ revisionId: activeRevision.id, expectedVersion: activeSection.version, comment: approvalComment }) }
      );
      updateSection(activeSection.id, (section) => ({
        ...section, status: 'APPROVED', version: response.sectionVersion, approvals: [response.approval, ...section.approvals]
      }));
      setDrafts((current) => ({ ...current, [activeSection.id]: { ...current[activeSection.id], baseVersion: response.sectionVersion, dirty: false } }));
      setApprovalComment('');
      setNotice('최신 VALID 개정본을 승인하고 잠갔습니다.');
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : '승인에 실패했습니다.'); }
  };

  const unlockSection = async () => {
    if (!reportId || !activeSection || !approvalComment.trim()) {
      setNotice('잠금 해제 사유를 입력해 주세요.');
      return;
    }
    try {
      const response = await apiRequest<{ unlock: ApprovalEvent; sectionVersion: number }>(
        `/api/reports/${encodeURIComponent(reportId)}/sections/${encodeURIComponent(activeSection.id)}/unlock`,
        { method: 'POST', body: JSON.stringify({ expectedVersion: activeSection.version, comment: approvalComment }) }
      );
      updateSection(activeSection.id, (section) => ({
        ...section, status: 'DRAFT', version: response.sectionVersion, approvals: [response.unlock, ...section.approvals]
      }));
      setDrafts((current) => ({ ...current, [activeSection.id]: { ...current[activeSection.id], baseVersion: response.sectionVersion } }));
      setApprovalComment('');
      setNotice('승인 이력을 보존한 채 새 개정 작성을 허용했습니다.');
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : '잠금 해제에 실패했습니다.'); }
  };

  const mergeReport = async () => {
    if (!reportId || !report) return;
    try {
      const response = await apiRequest<{ snapshot: ReportDetail['mergeSnapshots'][number]; reportVersion: number }>(
        `/api/reports/${encodeURIComponent(reportId)}/merge`,
        { method: 'POST', body: JSON.stringify({ expectedReportVersion: report.version }) }
      );
      setReport((current) => current ? { ...current, version: response.reportVersion, mergeSnapshots: [response.snapshot, ...current.mergeSnapshots] } : current);
      setNotice('승인된 최신 개정본만으로 결정적 병합 스냅샷을 생성했습니다. DOCX/PDF 출력은 P12 범위입니다.');
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : '병합 스냅샷 생성에 실패했습니다.'); }
  };

  if (!reportId) {
    return <Card title="보고서 스튜디오 진입 필요"><p>사건의 ACTIVE 템플릿으로 ReportInstance를 먼저 만든 뒤 동적 경로로 진입하세요.</p><Button onClick={() => onNavigate('/templates')}>템플릿 관리로 이동</Button></Card>;
  }
  if (loading) return <div className="p09-state" role="status" aria-live="polite">보고서 스냅샷과 개정 이력을 불러오는 중…</div>;
  if (error || !report) return <div className="p09-state p09-error" role="alert"><p>{error ?? '보고서를 찾을 수 없습니다.'}</p><Button onClick={() => void loadStudio()}>다시 시도</Button></div>;
  if (!activeSection || !activeDraft) return <div className="p09-state">보고서 장이 없습니다. P08 템플릿 계약을 확인하세요.</div>;

  const documentOptions = report.case.documents.flatMap((document) => document.versions.map((version) => ({
    id: version.id, label: `${document.title} · v${version.versionNumber} · ${version.sha256.slice(0, 10)}`
  })));
  const meetingOptions = report.case.meetings.filter((meeting) => meeting.status === 'FINAL' && meeting.rawTextSha256).map((meeting) => ({
    id: meeting.id, label: `${meeting.title} · FINAL v${meeting.version}`
  }));
  const sourceOptions = sourceType === 'DOCUMENT' ? documentOptions : meetingOptions;

  return (
    <div className="p09-studio" data-report-id={report.id}>
      <header className="p09-header">
        <div>
          <p className="p09-eyebrow">{report.case.caseNumber} · {report.case.claimType} · P08 snapshot {report.reportInstance.snapshotSha256.slice(0, 12)}</p>
          <h3>{report.title}</h3>
        </div>
        <div className="p09-header-actions">
          <span className={`p09-save-state p09-${activeDraft.state}`} role="status" aria-live="polite">
            {activeDraft.state === 'saving' ? '저장 중…' : activeDraft.state === 'saved' ? `저장됨 ${activeDraft.lastSavedAt ? new Date(activeDraft.lastSavedAt).toLocaleTimeString() : ''}` : activeDraft.state === 'conflict' ? '동시 편집 충돌' : activeDraft.dirty ? '저장 대기' : '변경 없음'}
          </span>
          <Button disabled={!canEdit || activeSection.status === 'APPROVED' || !activeDraft.dirty} onClick={() => void saveSection('MANUAL')}>지금 저장</Button>
        </div>
      </header>

      <div className="p09-pane-tabs" role="tablist" aria-label="1024px 보고서 패널 선택">
        {([['outline', '목차·근거'], ['editor', '본문 편집'], ['review', '검토·승인']] as const).map(([pane, label]) => (
          <button key={pane} role="tab" aria-selected={mobilePane === pane} onClick={() => setMobilePane(pane)}>{label}</button>
        ))}
      </div>
      {notice && <div className="p09-notice" role="status"><span>{notice}</span><button aria-label="알림 닫기" onClick={() => setNotice(null)}>×</button></div>}

      <div className="p09-studio-grid">
        <aside className={`p09-pane p09-outline ${mobilePane === 'outline' ? 'is-active' : ''}`} aria-label="보고서 목차와 사건 근거">
          <section>
            <h4>보고서 목차 <small>{report.sections.length}장</small></h4>
            <div className="p09-section-list">
              {report.sections.map((section) => (
                <button key={section.id} className={section.id === activeSection.id ? 'is-selected' : ''} onClick={() => selectSection(section.id)}>
                  <span>{section.sectionNumber}. {section.title}</span>
                  <span className={`p09-status p09-status-${section.status.toLowerCase()}`}>{statusLabel[section.status]}</span>
                </button>
              ))}
            </div>
          </section>
          <section>
            <h4>문단 근거 연결</h4>
            <label>근거 유형<select value={sourceType} onChange={(event) => { setSourceType(event.target.value as 'DOCUMENT' | 'MEETING'); setSourceId(''); }}><option value="MEETING">최종 회의록</option><option value="DOCUMENT">문서 버전</option></select></label>
            <label>근거 자료<select value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">선택</option>{sourceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
            <label>보고서 문단 번호(0부터)<input type="number" min={0} value={targetParagraphIndex} onChange={(event) => setTargetParagraphIndex(Number(event.target.value))} /></label>
            <label>원문 인용<textarea rows={3} value={quoteText} onChange={(event) => setQuoteText(event.target.value)} /></label>
            <label>원문 위치<input value={anchorPosition} placeholder="page:3 또는 transcript:paragraph-2" onChange={(event) => setAnchorPosition(event.target.value)} /></label>
            <Button disabled={!canEdit || activeSection.status === 'APPROVED'} variant="secondary" onClick={addEvidence}>이 개정본에 근거 추가</Button>
            <ul className="p09-evidence-list">
              {activeEvidence.map((evidence, index) => <li key={`${evidence.sourceType}-${evidence.sourceId}-${index}`}>문단 {evidence.targetParagraphIndex + 1} · {evidence.sourceType} · {evidence.anchorPosition}<button aria-label="대기 근거 제거" onClick={() => setPendingEvidence((current) => ({ ...current, [activeSection.id]: (current[activeSection.id] ?? []).filter((_, itemIndex) => itemIndex !== index) }))}>×</button></li>)}
              {activeEvidence.length === 0 && <li className="p09-muted">새 근거 연결 없음</li>}
            </ul>
          </section>

          {/* P11 Grounded AI Authoring Panel */}
          <section className="p11-grounding-section">
            <h4>근거 기반 AI 작성 <small>{selectedSources.length}개 선택됨</small></h4>
            <div className="p11-source-checkboxes">
              <p className="p09-editor-label">사건 자료 선택 (선택된 자료만 AI 전송)</p>
              {report.case.documents.map((doc) => {
                const latestVer = doc.versions[0];
                if (!latestVer) return null;
                const isChecked = selectedSources.some((s) => s.sourceType === 'MATERIAL' && s.sourceId === doc.id);
                return (
                  <label key={doc.id} className="p11-source-item">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedSources((curr) => [...curr, { sourceType: 'MATERIAL', sourceId: doc.id, sourceVersionId: latestVer.id, allowedAnchors: [0] }]);
                        } else {
                          setSelectedSources((curr) => curr.filter((s) => !(s.sourceType === 'MATERIAL' && s.sourceId === doc.id)));
                        }
                      }}
                    />
                    <span>[문서] {doc.title} (v{latestVer.versionNumber} · {latestVer.sha256.slice(0, 8)})</span>
                  </label>
                );
              })}
              {report.case.meetings.filter((meeting) => meeting.status === 'FINAL' && meeting.rawTextSha256).map((mtg) => {
                const isChecked = selectedSources.some((s) => s.sourceType === 'MEETING' && s.sourceId === mtg.id);
                return (
                  <label key={mtg.id} className="p11-source-item">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedSources((curr) => [...curr, { sourceType: 'MEETING', sourceId: mtg.id, sourceVersionId: `${mtg.id}:v${mtg.version}`, allowedAnchors: [0] }]);
                        } else {
                          setSelectedSources((curr) => curr.filter((s) => !(s.sourceType === 'MEETING' && s.sourceId === mtg.id)));
                        }
                      }}
                    />
                    <span>[회의록] {mtg.title} ({mtg.status} v{mtg.version})</span>
                  </label>
                );
              })}
            </div>

            <label htmlFor="p11-authoring-instruction">작성 지시</label>
            <textarea id="p11-authoring-instruction" rows={3} maxLength={4000} value={authoringInstruction} onChange={(event) => {
              setAuthoringInstruction(event.target.value);
              setActiveSelection(null);
            }} />
            {!aiPolicy?.externalAiAllowed && <p className="p11-cit-alert" role="alert">이 사건은 외부 AI 전송이 허용되지 않았습니다.</p>}

            <div className="p11-grounding-actions">
              <Button disabled={!canEdit || !aiPolicy?.externalAiAllowed || aiModels.length === 0 || selectedSources.length === 0 || !authoringInstruction.trim()} onClick={lockGroundingSelection}>
                1. 근거 Manifest 고정
              </Button>
            </div>

            {activeSelection && (
              <div className="p11-selection-status" role="status">
                <p>✓ Manifest 고정됨: <code>{activeSelection.manifestSha256.slice(0, 12)}</code> ({activeSelection.items.length}개 항목)</p>
                <Button disabled={!canEdit || aiStatus === 'loading'} variant="secondary" onClick={() => generateGroundedSuggestion()}>
                  2. AI 초안 생성 시작
                </Button>
              </div>
            )}

            {/* Suggestions & Citations List */}
            {activeSuggestion && (
              <div className="p11-suggestion-card">
                <div className="p11-suggestion-header">
                  <h5>AI 생성 초안 <span className={`p11-tag p11-tag-${activeSuggestion.status.toLowerCase()}`}>{activeSuggestion.status}</span></h5>
                  <small>{new Date(activeSuggestion.createdAt).toLocaleTimeString()}</small>
                </div>
                <div className="p11-suggestion-summary">
                  <p>{activeSuggestion.summaryText}</p>
                </div>
                <div className="p11-citations-list">
                  <h6>인용 검증 내역 ({activeSuggestion.citations.length}건)</h6>
                  {activeSuggestion.citations.map((cit: any, idx: number) => (
                    <div key={cit.id || idx} className={`p11-citation-item p11-cit-${cit.status.toLowerCase()}`}>
                      <span className="p11-cit-badge">{cit.status}</span>
                      <p className="p11-cit-claim">"{cit.claimText}"</p>
                      <p className="p11-cit-anchor">↳ 근거: {cit.sourceType} ({cit.sourceId}) · 앵커 #{cit.anchorIndex} "{cit.anchorText}"</p>
                      {cit.status === 'CONFLICT' && <p className="p11-cit-alert">⚠ 상충 소스 발견: {cit.conflictSourceId}</p>}
                      {cit.status === 'UNGROUNDED' && <p className="p11-cit-alert">⚠ 근거 없음: [확인 필요]</p>}
                    </div>
                  ))}
                </div>

                <div className="p11-suggestion-actions">
                  <p className="p11-apply-notice"><small>※ 본문에 적용 시 기존 승인본은 변경되지 않으며, 새 미승인 DRAFT revision으로 등록됩니다.</small></p>
                  <Button
                    disabled={!canEdit || activeSection.status === 'APPROVED' || activeSuggestion.status !== 'GENERATED'}
                    onClick={() => applySuggestionToContent(activeSuggestion.id)}
                  >
                    본문에 적용 (새 Revision 생성)
                  </Button>
                  <Button
                    disabled={!canEdit || ['PROCESSING', 'APPLIED', 'DISCARDED'].includes(activeSuggestion.status)}
                    variant="secondary"
                    onClick={() => discardSuggestion(activeSuggestion.id)}
                  >
                    초안 폐기
                  </Button>
                  {activeSuggestion.status === 'PROCESSING' && (
                    <Button variant="secondary" onClick={() => cancelGroundedSuggestion(activeSuggestion.id)}>생성 요청 취소</Button>
                  )}
                </div>
              </div>
            )}
          </section>
        </aside>

        {/* Cost & Scope Confirmation Modal */}
        {showCostModal && activeSelection && (
          <div className="p09-modal-overlay" role="dialog" aria-labelledby="p11-modal-title" aria-modal="true">
            <div className="p09-modal-card">
              <h4 id="p11-modal-title">외부 전송 범위 및 예상 비용 확인</h4>
              <p>선택하신 근거 자료만 AI Gateway를 통해 전송됩니다.</p>
              <ul>
                <li><strong>선택 자료 수:</strong> {activeSelection.items.length}개</li>
                <li><strong>Manifest Hash:</strong> <code>{activeSelection.manifestSha256}</code></li>
                <li><strong>선택 모델:</strong> {selectedAiModel}</li>
                <li><strong>최대 예상 비용:</strong> ${((aiPolicy?.maxCostMicrosPerRequest ?? 0) / 1_000_000).toFixed(4)} USD ({aiPolicy?.maxCostMicrosPerRequest ?? 0} micros)</li>
              </ul>
              <div className="p09-modal-actions">
                <Button onClick={() => generateGroundedSuggestion()}>전송 및 AI 초안 생성 시작</Button>
                <Button variant="secondary" onClick={() => setShowCostModal(false)}>취소</Button>
              </div>
            </div>
          </div>
        )}

        <main className={`p09-pane p09-editor ${mobilePane === 'editor' ? 'is-active' : ''}`} aria-label="구조화 보고서 본문 편집기">
          <div className="p09-section-heading">
            <div><p>제{activeSection.sectionNumber}장 · row version {activeSection.version}</p><h4>{activeSection.title}</h4></div>
            <span className={`p09-status p09-status-${activeSection.status.toLowerCase()}`}>{statusLabel[activeSection.status]}</span>
          </div>
          <label className="p09-editor-label" htmlFor="p09-report-content">본문 · 빈 줄로 문단 구분</label>
          <textarea
            id="p09-report-content"
            className="p09-body-editor"
            value={activeDraft.content}
            readOnly={!canEdit || activeSection.status === 'APPROVED'}
            aria-readonly={!canEdit || activeSection.status === 'APPROVED'}
            onChange={(event) => setDrafts((current) => ({
              ...current,
              [activeSection.id]: { ...current[activeSection.id], content: event.target.value, dirty: true, state: 'idle' }
            }))}
          />
          {!canEdit && <p className="p09-muted">현재 역할은 본문을 편집할 수 없습니다. 댓글·수정 요청·승인 기능만 사용할 수 있습니다.</p>}
          {activeSection.status === 'APPROVED' && <div className="p09-lock" role="status">승인된 장은 잠겨 있습니다. 승인권자의 명시적 잠금 해제 후 새 개정본을 작성할 수 있습니다.</div>}

          {activeConflict && <section className="p09-conflict" role="alert" aria-labelledby="p09-conflict-title">
            <h4 id="p09-conflict-title">동시 편집 충돌 — 로컬 초안을 보존했습니다</h4>
            <div className="p09-compare">
              <div><strong>서버 최신 v{activeConflict.currentVersion}</strong><pre>{activeConflict.latestRevision?.content ?? '(서버 개정 없음)'}</pre></div>
              <div><strong>내 로컬 초안</strong><pre>{activeDraft.content}</pre></div>
            </div>
            <div className="p09-action-row">
              <Button variant="secondary" onClick={() => {
                setDrafts((current) => ({ ...current, [activeSection.id]: { ...current[activeSection.id], content: activeConflict.latestRevision?.content ?? '', baseVersion: activeConflict.currentVersion, dirty: false, state: 'idle' } }));
                setConflicts((current) => ({ ...current, [activeSection.id]: undefined }));
              }}>서버 최신본 불러오기</Button>
              <Button onClick={() => {
                setDrafts((current) => ({ ...current, [activeSection.id]: { ...current[activeSection.id], baseVersion: activeConflict.currentVersion, dirty: true, state: 'idle' } }));
                setConflicts((current) => ({ ...current, [activeSection.id]: undefined }));
              }}>로컬 초안으로 새 개정 생성</Button>
            </div>
          </section>}

          <details className="p09-history">
            <summary>개정 이력과 버전 비교 ({activeSection.revisions.length})</summary>
            {activeSection.revisions.map((revision, index) => (
              <article key={revision.id}>
                <header><strong>v{revision.revisionNumber} · {revision.author.name}</strong><span>{new Date(revision.createdAt).toLocaleString()}</span></header>
                <pre>{revision.content}</pre>
                <small>SHA-256 {revision.sha256} · {revision.validationStatus} · 근거 {revision.evidenceLinks.length}개{index === 0 ? ' · 최신' : ''}</small>
              </article>
            ))}
            {activeSection.revisions.length === 0 && <p className="p09-muted">아직 저장된 개정본이 없습니다.</p>}
          </details>
        </main>

        <aside className={`p09-pane p09-review ${mobilePane === 'review' ? 'is-active' : ''}`} aria-label="검증 댓글 승인 패널">
          <section>
            <h4>검증 결과</h4>
            <div className={`p09-validation p09-validation-${(activeRevision?.validationStatus ?? 'INVALID').toLowerCase()}`}>
              최신 개정: {activeRevision?.validationStatus ?? '미저장'}
            </div>
            {validationErrors.map((item) => <p key={`${item.code}-${item.paragraphIndex}`} className="p09-validation-item">문단 {item.paragraphIndex + 1}: {item.message}</p>)}
          </section>
          <section>
            <h4>댓글·수정 요청</h4>
            <label>유형<select value={commentType} onChange={(event) => setCommentType(event.target.value as 'COMMENT' | 'REVISION_REQUEST')}><option value="COMMENT">댓글</option><option value="REVISION_REQUEST">수정 요청</option></select></label>
            <label>내용<textarea rows={3} value={commentContent} onChange={(event) => setCommentContent(event.target.value)} /></label>
            <Button variant="secondary" onClick={() => void postComment()}>기록</Button>
            <div className="p09-comments">
              {activeSection.comments.map((comment) => <article key={comment.id} className={comment.commentType === 'REVISION_REQUEST' ? 'is-request' : ''}>
                <header><strong>{comment.author.name} · {comment.commentType}</strong><span>{new Date(comment.createdAt).toLocaleString()}</span></header>
                <p>{comment.content}</p>
                {comment.isResolved ? <small>해결됨 {comment.resolvedBy?.name ? `· ${comment.resolvedBy.name}` : ''}</small> : <button onClick={() => void resolveComment(comment.id)}>해결 처리</button>}
              </article>)}
              {activeSection.comments.length === 0 && <p className="p09-muted">댓글이 없습니다.</p>}
            </div>
          </section>
          <section>
            <h4>승인 잠금</h4>
            <label>승인 또는 잠금 해제 의견<textarea rows={3} value={approvalComment} onChange={(event) => setApprovalComment(event.target.value)} /></label>
            {canApprove && activeSection.status !== 'APPROVED' && <Button disabled={!activeRevision || activeRevision.validationStatus !== 'VALID'} onClick={() => void approveSection()}>최신 VALID 개정 승인</Button>}
            {canApprove && activeSection.status === 'APPROVED' && <Button variant="secondary" onClick={() => void unlockSection()}>사유 기록 후 잠금 해제</Button>}
            {!canApprove && <p className="p09-muted">Reviewer·Director·Admin만 승인 및 잠금 해제를 할 수 있습니다.</p>}
            <ol className="p09-event-list">{activeSection.approvals.map((event) => <li key={event.id}>#{event.eventNumber} {event.status} · {event.approver.name}</li>)}</ol>
          </section>
          <section>
            <h4>결정적 병합 스냅샷</h4>
            <p className="p09-muted">모든 장의 최신 VALID 개정이 승인된 경우에만 생성합니다. DOCX/PDF는 P12에서 출력합니다.</p>
            {canMerge ? <Button onClick={() => void mergeReport()}>승인본 병합 스냅샷 생성</Button> : <p className="p09-muted">현재 역할은 병합할 수 없습니다.</p>}
            <ul className="p09-snapshots">{report.mergeSnapshots.map((snapshot) => <li key={snapshot.id}>v{snapshot.snapshotVersion} · {snapshot.snapshotSha256.slice(0, 12)} · {snapshot.createdBy.name}</li>)}</ul>
          </section>
          <section className="p10-ai-gateway-section">
            <h4>P10 AI Gateway 연동</h4>
            {aiPolicy ? (
              <div style={{ fontSize: '0.8125rem', color: '#334155' }}>
                <div>사건 외부 전송 보안: <strong style={{ color: aiPolicy.externalAiAllowed ? '#166534' : '#991b1b' }}>{aiPolicy.externalAiAllowed ? '외부 전송 허용 (TRUE)' : '외부 전송 차단 (FALSE)'}</strong></div>
                {roles.some((r) => ['admin', 'pm', 'director', 'ceo'].includes(r)) && (
                  <button
                    type="button"
                    onClick={() => void toggleExternalAiPolicy(!aiPolicy.externalAiAllowed)}
                    style={{ marginTop: '4px', fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', cursor: 'pointer' }}
                  >
                    {aiPolicy.externalAiAllowed ? '외부 전송 차단' : '외부 전송 허용'}
                  </button>
                )}
              </div>
            ) : <p className="p09-muted">사건 AI 정책 로딩 중...</p>}

            {aiModels.length > 0 && (
              <div style={{ marginTop: '8px' }}>
                <label htmlFor="p10-ai-model" style={{ fontSize: '0.75rem' }}>사용 가능 AI 모델</label>
                <select
                  id="p10-ai-model"
                  value={selectedAiModel}
                  onChange={(e) => setSelectedAiModel(e.target.value)}
                  style={{ width: '100%', fontSize: '0.8125rem', padding: '4px' }}
                >
                  {aiModels.map((m) => (
                    <option key={`${m.providerId}-${m.modelCode}`} value={`${m.providerId}::${m.modelCode}`}>
                      {m.name} ({m.modelCode})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ marginTop: '8px' }}>
              <Button
                size="sm"
                variant="secondary"
                disabled={aiStatus === 'loading' || !aiPolicy?.externalAiAllowed}
                onClick={() => void testAiGeneration()}
              >
                {aiStatus === 'loading' ? 'AI Gateway 진단 실행 중...' : 'AI Gateway 연결 진단 시작'}
              </Button>
              {aiRequestId && aiStatus === 'loading' && (
                <button
                  type="button"
                  onClick={() => void cancelAiRequest()}
                  style={{ marginLeft: '6px', fontSize: '0.75rem', color: '#991b1b', background: '#fee2e2', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }}
                >
                  실행 중 요청 취소
                </button>
              )}
            </div>

            {aiResultMsg && (
              <div style={{ marginTop: '8px', padding: '8px', background: aiStatus === 'error' ? '#fef2f2' : '#f0fdf4', border: `1px solid ${aiStatus === 'error' ? '#fecaca' : '#bbf7d0'}`, borderRadius: '4px', fontSize: '0.75rem', color: aiStatus === 'error' ? '#991b1b' : '#166534' }}>
                {aiResultMsg}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
};
