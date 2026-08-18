import { Button, Card, Dialog, Input, Select } from '@claim-studio/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiDownload, apiRequest } from '../api';
import { StatusFeedbackState } from '../layout/StatusFeedbackState';
import { WORKFLOW_PROJECTS } from '../workflow/workflow-model';
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
interface OutlineItem { chapterId: string; chapterCode: string; promptVersion: number; planningNote: string }
interface OutlinePlan { persistenceAvailable: boolean; status: 'DRAFT' | 'CONFIRMED'; version: number; updatedAt: string | null; updatedBy: string | null; items: OutlineItem[] }
interface SourceGroup { code: 'PROJECT' | 'PROPOSAL' | 'KICKOFF' | 'SITE_SURVEY' | 'QUANTITY' | 'EVIDENCE' | 'LITIGATION'; label: string; status: 'READY' | 'PARTIAL' | 'EMPTY'; itemCount: number; detail: string; route: string }
interface ReportTemplatePreview { claimType: string; templateName: string; purposeText: string; version: number; finishedExample: string }
interface TemplateLibraryFile { id: string; originalName: string; fileExtension: string; byteSize: number; sha256: string; uploadedAt: string; uploadedByName: string; viewMode: 'INLINE' | 'DOWNLOAD'; contentUrl: string }
interface TemplateLibraryCategory { id: string; categoryCode: string; displayName: string; primaryClaimType: string; secondaryClaimTypes: string[]; matchesCurrentType: boolean; expectedSourceCount: number; uploadedSourceCount: number; analysisSummary: string; outline: string[]; analysisVersion: number; files: TemplateLibraryFile[] }
interface TypeGuidelineSummary { claimType: string; typeName: string; targetWork: string; tocBlueprint: string; version: number; sourceFileName: string; sourceSha256: string }
interface AuthoringConfig { claimType: string; available: boolean; unavailableReason: string | null; aiConnected: boolean; credentialSource: 'PERSONAL' | 'ORGANIZATION' | 'ENVIRONMENT' | 'NONE'; providerLabel: string; modelLabel: string; outlineAiConnected: boolean; outlineProviderLabel: string; outlineModelLabel: string; assistantConnected: boolean; assistantCredentialSource: 'PERSONAL' | 'NONE'; assistantProviderLabel: 'GEMINI'; assistantModelLabel: string; chapters: AuthoringChapter[]; typeGuideline: TypeGuidelineSummary | null; outlinePlan: OutlinePlan; sourceGroups: SourceGroup[]; templates: ReportTemplatePreview[]; templateLibrary: TemplateLibraryCategory[] }
type MemoryScope = 'GLOBAL' | 'REPORT_TYPE' | 'CLAIM_TYPE' | 'CHAPTER' | 'USER_FEEDBACK';
interface FinalOutput { id: string; format: 'DOCX' | 'PDF'; fileName: string; contentSha256: string; byteSize: number; createdAt: string }
interface Finalization {
  id: string; caseId: string; reviewId: string; reportVersion: number; reportTitle: string; finalizedAt: string;
  finalizedBy: { id: string; name: string }; approvedBy: string; approvedAt: string; outputs: FinalOutput[];
}

const EDIT_ROLES: readonly UserRole[] = ['admin', 'ceo', 'director', 'pm', 'staff'];
type ReportWizardStep = 1 | 2 | 3 | 4 | 5;
const REPORT_WIZARD_STEPS: readonly {
  id: ReportWizardStep;
  title: string;
  shortHelp: string;
  tasks: readonly string[];
  doneText: string;
}[] = [
  { id: 1, title: '프로젝트·템플릿 확인', shortHelp: '어떤 프로젝트의 보고서를 만들지 먼저 고릅니다.', tasks: ['프로젝트 이름 확인', '클레임 유형 확인', 'AI가 참고할 자료 준비도 확인'], doneText: '프로젝트와 승인 템플릿이 연결되면 완료' },
  { id: 2, title: '목차 기획', shortHelp: '보고서에 들어갈 챕터와 작성 방향을 먼저 정합니다.', tasks: ['챕터를 하나씩 눌러보기', '이번 사건에서 다룰 내용을 짧게 메모하기', '목차 기획 확정 누르기'], doneText: '목차 기획 확정 표시가 나오면 완료' },
  { id: 3, title: '챕터별 AI 작성', shortHelp: '한 번에 한 챕터씩 AI 초안을 만듭니다.', tasks: ['작성할 챕터 선택', '참고 자료가 맞는지 확인', '자동 작성 후 다음 챕터 반복'], doneText: '모든 챕터에 초안 있음이 표시되면 완료' },
  { id: 4, title: '사람 검토·수정', shortHelp: 'AI가 쓴 글의 숫자와 근거를 사람이 확인합니다.', tasks: ['본문을 처음부터 읽기', '틀린 숫자·표현·출처 고치기', 'D1 저장 완료 표시 확인'], doneText: '수정 내용이 최신 버전으로 저장되면 완료' },
  { id: 5, title: '검토·승인·출력', shortHelp: '검토자에게 보내고 승인된 파일을 내려받습니다.', tasks: ['검토 요청 메모 작성', '독립 검토자 승인 확인', 'DOCX 또는 PDF 생성'], doneText: '승인본 파일을 생성하면 보고서 작업 완료' }
] as const;
const CHAPTER_SOURCE_CODES: Record<string, SourceGroup['code'][]> = {
  'AGENT-01': ['PROJECT', 'PROPOSAL', 'KICKOFF'],
  'AGENT-02': ['PROJECT', 'PROPOSAL', 'LITIGATION'],
  'AGENT-03': ['PROJECT', 'SITE_SURVEY', 'EVIDENCE'],
  'AGENT-04': ['PROJECT', 'QUANTITY', 'EVIDENCE'],
  'AGENT-05': ['PROJECT', 'PROPOSAL', 'KICKOFF', 'SITE_SURVEY', 'QUANTITY', 'EVIDENCE', 'LITIGATION'],
  'AGENT-06': ['PROJECT', 'PROPOSAL', 'KICKOFF', 'SITE_SURVEY', 'QUANTITY', 'EVIDENCE', 'LITIGATION']
};

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
  const [improving, setImproving] = useState(false);
  const [improvementInstruction, setImprovementInstruction] = useState('사실과 수치는 유지하고 문장을 더 명확하고 전문적으로 다듬어 주세요.');
  const [memoryFeedback, setMemoryFeedback] = useState('');
  const [memoryScope, setMemoryScope] = useState<MemoryScope>('CHAPTER');
  const [memoryNotice, setMemoryNotice] = useState('');
  const [submittingMemory, setSubmittingMemory] = useState(false);
  const memoryRequestKey = useRef(crypto.randomUUID());
  const [savingOutline, setSavingOutline] = useState(false);
  const [generatingOutline, setGeneratingOutline] = useState(false);
  const [outlineStatus, setOutlineStatus] = useState<'DRAFT' | 'CONFIRMED'>('DRAFT');
  const [outlineVersion, setOutlineVersion] = useState(0);
  const [outlineNotes, setOutlineNotes] = useState<Record<string, string>>({});
  const [outlineDirty, setOutlineDirty] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [showTemplatePreview, setShowTemplatePreview] = useState(false);
  const [previewTemplateCategoryCode, setPreviewTemplateCategoryCode] = useState('');
  const [activeStep, setActiveStep] = useState<ReportWizardStep>(1);
  const loadSequence = useRef(0);
  const selectedCaseRef = useRef('');
  const titleRef = useRef('');
  const contentRef = useRef('');
  const editable = roles.some((role) => EDIT_ROLES.includes(role));
  const selectedCase = useMemo(() => cases.find((record) => record.id === selectedCaseId) ?? null, [cases, selectedCaseId]);
  const selectedWorkflowProject = useMemo(() => WORKFLOW_PROJECTS.find((project) => project.caseId === selectedCaseId) ?? null, [selectedCaseId]);
  const selectedChapter = useMemo(() => authoring?.chapters.find((chapter) => chapter.id === selectedChapterId) ?? null, [authoring, selectedChapterId]);
  const selectedTemplateCategory = useMemo(() => authoring?.templateLibrary.find((category) => category.categoryCode === previewTemplateCategoryCode) ?? authoring?.templateLibrary.find((category) => category.matchesCurrentType) ?? authoring?.templateLibrary[0] ?? null, [authoring, previewTemplateCategoryCode]);
  const selectedTemplatePreview = useMemo(() => authoring?.templates.find((template) => template.claimType === selectedTemplateCategory?.primaryClaimType) ?? authoring?.templates.find((template) => template.claimType === authoring.claimType) ?? null, [authoring, selectedTemplateCategory]);
  const selectedChapterSources = useMemo(() => {
    const codes = selectedChapter ? CHAPTER_SOURCE_CODES[selectedChapter.agentCode] ?? ['PROJECT'] : [];
    return authoring?.sourceGroups.filter((group) => codes.includes(group.code)) ?? [];
  }, [authoring, selectedChapter]);
  const authoredChapterCodes = useMemo(() => new Set(Array.from(content.matchAll(/<!-- AI-CHAPTER:([^:]+):START -->/gu), (match) => match[1])), [content]);

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
      setPreviewTemplateCategoryCode(authoringResult.templateLibrary.find((category) => category.matchesCurrentType)?.categoryCode ?? authoringResult.templateLibrary[0]?.categoryCode ?? '');
      setOutlineStatus(authoringResult.outlinePlan.status);
      setOutlineVersion(authoringResult.outlinePlan.version);
      setOutlineNotes(Object.fromEntries(authoringResult.outlinePlan.items.map((item) => [item.chapterId, item.planningNote])));
      setOutlineDirty(false);
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
    setSelectedCaseId(caseId); setLoadedCaseId(''); setTitle(''); setContent(''); setVersion(0); setRevisions([]); setReviews([]); setFinalizations([]); setAuthoring(null); setSelectedChapterId(''); setOutlineStatus('DRAFT'); setOutlineVersion(0); setOutlineNotes({}); setOutlineDirty(false); setReviewNote(''); setMemoryFeedback(''); setMemoryNotice(''); memoryRequestKey.current=crypto.randomUUID(); setSavedAt(null); setDirty(false); setError(''); setActiveStep(1);
    const project = WORKFLOW_PROJECTS.find((candidate) => candidate.caseId === caseId);
    const projectQuery = project ? `&projectId=${encodeURIComponent(project.id)}` : '';
    onNavigate(`/reports/studio?caseId=${encodeURIComponent(caseId)}${projectQuery}`);
  };

  const withProjectContext = (route: string) => {
    if (!selectedWorkflowProject) return route;
    const target = new URL(route, window.location.origin);
    target.searchParams.set('projectId', selectedWorkflowProject.id);
    target.searchParams.set('caseId', selectedWorkflowProject.caseId);
    return `${target.pathname}${target.search}`;
  };

  const saveOutline = async (status: 'DRAFT' | 'CONFIRMED') => {
    if (!editable || !authoring?.available || !authoring.outlinePlan.persistenceAvailable || savingOutline || loadedCaseId !== selectedCaseId) return;
    const requestCaseId = selectedCaseId;
    setSavingOutline(true); setError('');
    try {
      const result = await apiRequest<{ outlinePlan: OutlinePlan }>('/api/report-authoring/outline', {
        method: 'PUT',
        body: JSON.stringify({
          caseId: requestCaseId,
          status,
          expectedVersion: outlineVersion,
          items: authoring.chapters.map((chapter) => ({ chapterId: chapter.id, chapterCode: chapter.chapterCode, promptVersion: chapter.promptVersion, planningNote: outlineNotes[chapter.id]?.trim() ?? '' }))
        })
      });
      if (selectedCaseRef.current !== requestCaseId) return;
      setOutlineStatus(result.outlinePlan.status); setOutlineVersion(result.outlinePlan.version); setOutlineDirty(false);
      setAuthoring((current) => current ? { ...current, outlinePlan: result.outlinePlan } : current);
    } catch (reason) {
      if (selectedCaseRef.current === requestCaseId) setError(reason instanceof ApiError && reason.status === 409 ? '목차 또는 관리자 템플릿이 변경되었습니다. 최신본을 다시 불러와 목차를 확인해 주세요.' : reason instanceof Error ? reason.message : String(reason));
    } finally { if (selectedCaseRef.current === requestCaseId) setSavingOutline(false); }
  };

  const generateOutline = async () => {
    if (!editable || !authoring?.available || !authoring.outlineAiConnected || generatingOutline || savingOutline || loadedCaseId !== selectedCaseId) return;
    const requestCaseId = selectedCaseId;
    setGeneratingOutline(true); setError('');
    try {
      const result = await apiRequest<{ suggestions: Array<{ chapterId: string; chapterCode: string; planningNote: string }>; guidelineVersion: number }>('/api/report-authoring/outline/generate', { method: 'POST', body: JSON.stringify({ caseId: requestCaseId }) });
      if (selectedCaseRef.current !== requestCaseId) return;
      setOutlineNotes(Object.fromEntries(result.suggestions.map((item) => [item.chapterId, item.planningNote])));
      setOutlineDirty(true);
    } catch (reason) { if (selectedCaseRef.current === requestCaseId) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (selectedCaseRef.current === requestCaseId) setGeneratingOutline(false); }
  };

  const generateChapter = async () => {
    if (!editable || !authoring?.available || !authoring.aiConnected || outlineStatus !== 'CONFIRMED' || outlineDirty || !selectedChapterId || dirty || saving || generating || loadedCaseId !== selectedCaseId) return;
    const requestCaseId = selectedCaseId;
    setGenerating(true); setError('');
    try {
      const result = await apiRequest<{ chapter: { chapterCode: string; title: string; content: string; promptVersion: number; memory?: { engine: string; shortTermItems: number; approvedLongTermRules: number; personalRules: number; organizationRules: number } } }>('/api/report-authoring/generate', {
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
      if (result.chapter.memory) setMemoryNotice(`이번 초안 메모리 적용 · 단기 ${result.chapter.memory.shortTermItems}개 · 승인 장기 ${result.chapter.memory.approvedLongTermRules}개(개인 ${result.chapter.memory.personalRules} · 조직 ${result.chapter.memory.organizationRules})`);
    } catch (reason) {
      if (selectedCaseRef.current !== requestCaseId) return;
      const providerStatus = reason instanceof ApiError && typeof reason.payload.providerStatus === 'number' ? ` · 공급자 HTTP ${reason.payload.providerStatus}` : '';
      const providerReason = reason instanceof ApiError && typeof reason.payload.providerReason === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(reason.payload.providerReason)
        ? ` · Google 사유 ${reason.payload.providerReason}`
        : '';
      setError(`${reason instanceof Error ? reason.message : String(reason)}${providerStatus}${providerReason}`);
    }
    finally { if (selectedCaseRef.current === requestCaseId) setGenerating(false); }
  };

  const improveWriting = async () => {
    if (!editable || !authoring?.assistantConnected || !content.trim() || dirty || saving || improving || loadedCaseId !== selectedCaseId) return;
    const requestCaseId = selectedCaseId;
    setImproving(true); setError('');
    try {
      const result = await apiRequest<{ content: string; credentialSource: string; providerKind: string; modelCode: string }>('/api/report-authoring/improve', {
        method: 'POST', body: JSON.stringify({ caseId: requestCaseId, content, instruction: improvementInstruction.trim(), expectedDraftVersion: version })
      });
      if (selectedCaseRef.current !== requestCaseId) return;
      contentRef.current = result.content; setContent(result.content); setDirty(true);
    } catch (reason) { if (selectedCaseRef.current === requestCaseId) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (selectedCaseRef.current === requestCaseId) setImproving(false); }
  };

  const submitMemoryFeedback = async () => {
    if (!editable || !selectedChapter || !memoryFeedback.trim() || dirty || saving || submittingMemory || loadedCaseId !== selectedCaseId) return;
    const requestCaseId = selectedCaseId;
    setSubmittingMemory(true); setError(''); setMemoryNotice('');
    try {
      const result = await apiRequest<{ candidate: { ruleText: string; confidence: number }; replayed: boolean }>('/api/report-memory/feedback', {
        method: 'POST',
        headers: { 'Idempotency-Key': memoryRequestKey.current },
        body: JSON.stringify({ caseId: requestCaseId, chapterId: selectedChapter.id, feedback: memoryFeedback.trim(), scope: memoryScope })
      });
      if (selectedCaseRef.current !== requestCaseId) return;
      setMemoryNotice(`학습 후보 등록 완료 · 신뢰도 ${result.candidate.confidence}% · “${result.candidate.ruleText}” · 관리자 승인 후 다음 보고서부터 반영됩니다.`);
      setMemoryFeedback(''); memoryRequestKey.current=crypto.randomUUID();
    } catch (reason) { if (selectedCaseRef.current === requestCaseId) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (selectedCaseRef.current === requestCaseId) setSubmittingMemory(false); }
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

  const openTemplateSource = async (file: TemplateLibraryFile) => {
    setError('');
    if (file.viewMode === 'INLINE') {
      const opened = window.open(file.contentUrl, '_blank');
      if (opened) opened.opener = null;
      else setError('브라우저가 새 창을 차단했습니다. 팝업을 허용한 뒤 다시 열어 주세요.');
      return;
    }
    try {
      const result = await apiDownload(file.contentUrl);
      const objectUrl = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = result.filename || file.originalName; anchor.click(); URL.revokeObjectURL(objectUrl);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '원본 템플릿 다운로드에 실패했습니다.'); }
  };

  const projectStepComplete = Boolean(selectedCaseId && loadedCaseId === selectedCaseId && authoring?.available);
  const outlineStepComplete = projectStepComplete && outlineStatus === 'CONFIRMED' && !outlineDirty;
  const chapterStepComplete = Boolean(outlineStepComplete && authoring?.chapters.length && authoredChapterCodes.size === authoring.chapters.length);
  const editingStepComplete = Boolean(chapterStepComplete && version > 0 && content.trim() && !dirty && !saving);
  const outputStepComplete = Boolean(editingStepComplete && currentFinalization?.outputs.length);
  const stepComplete: Record<ReportWizardStep, boolean> = {
    1: projectStepComplete,
    2: outlineStepComplete,
    3: chapterStepComplete,
    4: editingStepComplete,
    5: outputStepComplete
  };
  const stepUnlocked: Record<ReportWizardStep, boolean> = {
    1: true,
    2: stepComplete[1],
    3: stepComplete[1] && stepComplete[2],
    4: stepComplete[1] && stepComplete[2] && stepComplete[3],
    5: stepComplete[1] && stepComplete[2] && stepComplete[3] && stepComplete[4]
  };
  const activeStepGuide = REPORT_WIZARD_STEPS.find((step) => step.id === activeStep) ?? REPORT_WIZARD_STEPS[0];
  const nextStep = activeStep < 5 ? (activeStep + 1) as ReportWizardStep : null;
  const previousStep = activeStep > 1 ? (activeStep - 1) as ReportWizardStep : null;
  const nextBlockedReason = activeStep === 1
    ? '프로젝트와 승인 템플릿을 확인하면 다음 단계가 열립니다.'
    : activeStep === 2
      ? '각 챕터의 작성 방향을 확인하고 목차 기획을 확정해 주세요.'
      : activeStep === 3
        ? '모든 챕터를 한 번씩 자동 작성하면 편집 단계가 열립니다.'
        : activeStep === 4
          ? '본문을 저장해 D1 저장 완료 표시를 확인해 주세요.'
          : '';

  if (!loading && cases.length === 0) return <StatusFeedbackState type="empty" title="보고서를 연결할 프로젝트가 없습니다" message="먼저 프로젝트 의뢰를 등록하면 프로젝트별 D1 보고서 저장 공간이 자동으로 준비됩니다." actionLabel="프로젝트 의뢰 등록" onAction={() => onNavigate('/cases/new')} />;

  return (
    <div className="content-stack report-authoring-studio" data-wizard-step={activeStep} aria-label="D1 보고서 자동 저장 스튜디오">
      <section className="report-authoring-hero" aria-labelledby="report-authoring-title">
        <div><span>CLAIM REPORT AUTHORING SYSTEM</span><h2 id="report-authoring-title">템플릿에서 목차를 설계하고,<br />챕터별 근거로 완성합니다.</h2><p>프로젝트 유형과 승인 템플릿을 기준으로 회의록·현장조사·물량산출·제안서 근거를 챕터별 AI 작성에 연결합니다.</p></div>
        <div className="report-authoring-hero__actions"><Button variant="secondary" onClick={() => setShowGuide((current) => !current)}>{showGuide ? '사용 가이드 닫기' : '처음 사용 가이드'}</Button><Button variant="secondary" disabled={!selectedTemplatePreview} onClick={() => setShowTemplatePreview(true)}>완제품 템플릿 열람</Button>{roles.includes('admin') && <Button onClick={() => onNavigate('/ai-config')}>챕터 프롬프트 설정</Button>}</div>
      </section>

      <nav className="report-wizard-navigation" aria-label="보고서 작성 5단계">
        <div className="report-wizard-navigation__heading">
          <span>REPORT WIZARD</span>
          <strong>지금은 {activeStep}단계입니다.</strong>
          <small>앞 단계가 끝나면 다음 단계 버튼이 열립니다.</small>
        </div>
        <ol>{REPORT_WIZARD_STEPS.map((step) => {
          const current = step.id === activeStep;
          const complete = stepComplete[step.id];
          const unlocked = stepUnlocked[step.id];
          return <li key={step.id}>
            <button type="button" className={current ? 'is-current' : complete ? 'is-complete' : ''} disabled={!unlocked} aria-current={current ? 'step' : undefined} onClick={() => setActiveStep(step.id)}>
              <b>{complete ? '✓' : step.id}</b>
              <span><strong>{step.title}</strong><small>{current ? '지금 진행 중' : complete ? '완료' : unlocked ? '열림' : '앞 단계 완료 후 열림'}</small></span>
            </button>
          </li>;
        })}</ol>
        <span className="report-wizard-navigation__progress"><i style={{ width: `${(activeStep / 5) * 100}%` }} /></span>
      </nav>

      {showGuide && <section className="report-active-guide" aria-labelledby="report-active-guide-title">
        <div className="report-active-guide__number" aria-hidden="true">{String(activeStep).padStart(2, '0')}</div>
        <div>
          <span>이번 단계에서 할 일</span>
          <h3 id="report-active-guide-title">{activeStepGuide.title}</h3>
          <p>{activeStepGuide.shortHelp}</p>
          <ul>{activeStepGuide.tasks.map((task) => <li key={task}>{task}</li>)}</ul>
        </div>
        <aside><strong>완료 기준</strong><p>{activeStepGuide.doneText}</p><small>모르는 내용은 임의로 쓰지 말고 담당자에게 확인하세요.</small></aside>
      </section>}

      <Card title="PROJECT & TEMPLATE · 1단계" className="report-step-card report-step-card--1">
        <div className="inline-form">
          <Select label="작성할 프로젝트" value={selectedCaseId} onChange={(event) => selectCase(event.target.value)} disabled={saving} options={cases.map((record) => ({ value: record.id, label: `${record.caseNumber} · ${record.title}` }))} />
          <div className="action-row" aria-live="polite">
            <span className="preview-pill">{error ? '저장 확인 필요' : saving ? 'D1 저장 중' : dirty ? '변경사항 있음' : version ? `D1 저장 완료 · v${version}` : '새 초안'}</span>
            <Button onClick={() => void saveNow()} disabled={!editable || !dirty || saving || loadedCaseId !== selectedCaseId}>{saving ? '저장 중…' : '지금 저장'}</Button>
            {error && <Button variant="secondary" onClick={() => selectedCaseId && void loadDraft(selectedCaseId)}>최신본 다시 불러오기</Button>}
          </div>
        </div>
        <div className="report-template-contract">
          <div><span>CLAIM TYPE</span><strong>{authoring?.claimType ?? selectedCase?.claimType ?? '불러오는 중'}</strong><small>프로젝트 의뢰에 등록된 6대 고정 유형</small></div>
          <div><span>APPROVED TEMPLATE</span><strong>{authoring?.available ? '유형별 템플릿 적용' : '템플릿 확인 필요'}</strong><small>{authoring?.available ? `${authoring.chapters.length}개 챕터 구성` : authoring?.unavailableReason ?? '구성을 불러오는 중'}</small></div>
          <div><span>AUTOSAVE</span><strong>D1 VERSION {version || 'NEW'}</strong><small>본문·목차 진행·수정 이력 자동 저장</small></div>
          {roles.includes('admin') && <Button variant="secondary" onClick={() => onNavigate('/ai-config')}>유형별 템플릿·프롬프트 관리</Button>}
        </div>
        <div className="report-template-viewer-control">
          <label htmlFor="report-template-preview-type"><span>원본 보고서 템플릿 선택·열람</span><select id="report-template-preview-type" value={previewTemplateCategoryCode} onChange={(event) => setPreviewTemplateCategoryCode(event.target.value)}>{authoring?.templateLibrary.map((category) => <option key={category.categoryCode} value={category.categoryCode}>{category.matchesCurrentType ? '● ' : ''}{category.categoryCode} · {category.displayName} · {category.uploadedSourceCount}/{category.expectedSourceCount}</option>)}</select></label>
          <Button aria-label="선택 템플릿 완제품 보기" disabled={!selectedTemplateCategory} onClick={() => setShowTemplatePreview(true)}>원본 완제품·분석 보기</Button>
          <small>● 표시는 현재 프로젝트 {authoring?.claimType ?? selectedCase?.claimType}에 연결된 원본 분류입니다. PDF는 웹에서 바로 열고 HWP·HWPX·XLSX는 원본으로 내려받습니다.</small>
        </div>
        <p className="muted">회사 원본 32개는 공개 웹 자산이 아니라 로그인으로 보호된 Google Drive에 저장됩니다. 관리자가 원본 폴더를 등록하면 처음 작성할 때와 초안 수정 중 언제든 열람할 수 있습니다.</p>
      </Card>

      {loading || loadedCaseId !== selectedCaseId ? <StatusFeedbackState type="loading" message="프로젝트별 보고서 최신본을 불러오고 있습니다." /> : <>
        <Card title="SOURCE READINESS · 워크플로우 1~5 근거 준비도" className="report-step-card report-step-card--source">
          <div className="report-source-readiness">
            <header><div><span>PROJECT EVIDENCE MAP</span><h3>AI가 참고할 프로젝트 자료를 먼저 확인하세요.</h3><p>제안서부터 착수회의·현장조사·물량산출·자료실·법원자료까지 현재 프로젝트에 연결된 기록만 표시합니다.</p></div><strong>{authoring?.sourceGroups.filter((group) => group.status === 'READY').length ?? 0}/{authoring?.sourceGroups.length ?? 0}<small>READY</small></strong></header>
            <div className="report-source-grid">{authoring?.sourceGroups.map((group) => <button key={group.code} type="button" data-source-state={group.status} onClick={() => onNavigate(withProjectContext(group.route))}><span aria-hidden="true">{group.status === 'READY' ? '✓' : group.status === 'PARTIAL' ? '!' : '+'}</span><div><strong>{group.label}</strong><small>{group.detail}</small></div><em>{group.status === 'READY' ? '준비됨' : group.status === 'PARTIAL' ? '일부 준비' : '자료 연결'}</em></button>)}</div>
            <p className="report-source-policy"><strong>근거 사용 원칙</strong> 파일명·업로더·업로드 시각·SHA-256은 파일 존재를 확인하는 정보입니다. PDF·HWP·도면의 본문을 아직 추출하지 않은 경우 AI가 내용을 추측하지 않고 <b>[확인 필요]</b>로 남깁니다.</p>
          </div>
        </Card>
        <Card title="TABLE OF CONTENTS · 2단계 목차 기획" className="report-step-card report-step-card--2">
          {!authoring?.available ? <div className="error-box">{authoring?.unavailableReason ?? '이 유형의 승인된 목차 템플릿이 없습니다.'}</div> : <div className="report-outline-planner">
            <header><div><span>{authoring.claimType} · APPROVED OUTLINE · PLAN v{outlineVersion || 'NEW'}</span><h3>보고서를 쓰기 전에 챕터별 작성 방향을 확정하세요.</h3><p>관리자가 승인한 목차는 빠뜨리거나 바꿀 수 없습니다. 각 챕터를 눌러 이번 프로젝트에서 다룰 쟁점과 검토 방향을 메모한 뒤 목차 기획을 확정합니다.</p></div><strong>{authoredChapterCodes.size}/{authoring.chapters.length}<small>작성된 챕터</small></strong></header>
            {authoring.typeGuideline && <details className="report-outline-guideline"><summary><span>관리자 승인 {authoring.claimType} 작성 지침 v{authoring.typeGuideline.version}</span><strong>표준 목차 블루프린트 보기</strong></summary><p>{authoring.typeGuideline.targetWork}</p><pre>{authoring.typeGuideline.tocBlueprint}</pre><small>{authoring.typeGuideline.sourceFileName} · SHA {authoring.typeGuideline.sourceSha256.slice(0, 16)}…</small></details>}
            <div className="notice-box"><strong>쉬운 시작:</strong> 아래 “AI로 목차 작성계획 만들기”를 누르면 현재 프로젝트 자료를 읽고 각 챕터에 무엇을 쓸지 자동으로 채웁니다. 내용을 확인한 뒤 “목차 기획 확정”을 누르세요.</div>
            <ol>{authoring.chapters.map((chapter) => { const authored = authoredChapterCodes.has(chapter.chapterCode); const active = chapter.id === selectedChapterId; return <li key={chapter.id}><button type="button" className={active ? 'is-active' : ''} onClick={() => setSelectedChapterId(chapter.id)} aria-pressed={active}><span>{String(chapter.ordinal).padStart(2, '0')}</span><div><strong>{chapter.chapterCode} · {chapter.title}</strong><small>{chapter.agentCode} · prompt v{chapter.promptVersion}</small></div><em className={authored ? 'is-complete' : ''}>{authored ? '초안 있음' : '작성 대기'}</em></button></li>; })}</ol>
            {selectedChapter && <div className="report-outline-note"><label htmlFor="report-outline-note"><span>{selectedChapter.chapterCode}</span> 이번 챕터 작성 방향</label><textarea id="report-outline-note" maxLength={2000} value={outlineNotes[selectedChapter.id] ?? ''} disabled={!editable || savingOutline} onChange={(event) => { setOutlineNotes((current) => ({ ...current, [selectedChapter.id]: event.target.value })); setOutlineDirty(true); }} placeholder="예: 현장조사 사진과 실측 수량의 차이를 표로 비교하고, 계약도면 기준과 실제 시공상태를 구분해 작성" /><small>{(outlineNotes[selectedChapter.id] ?? '').length}/2,000 · 빈 메모도 허용되지만 핵심 쟁점을 적으면 챕터 작성 지시에 함께 반영됩니다.</small></div>}
            <div className="report-outline-actions"><span className={`report-outline-status is-${outlineStatus.toLowerCase()}`}>{outlineStatus === 'CONFIRMED' && !outlineDirty ? '✓ 목차 기획 확정' : outlineDirty ? '목차 변경사항 있음' : '목차 기획 대기'}</span><Button variant="secondary" disabled={!editable || !authoring.outlineAiConnected || generatingOutline || savingOutline} onClick={() => void generateOutline()}>{generatingOutline ? '프로젝트 근거 분석 중…' : 'AI로 목차 작성계획 만들기'}</Button><Button variant="secondary" disabled={!editable || savingOutline || generatingOutline || !authoring.outlinePlan.persistenceAvailable || (!outlineDirty && outlineVersion > 0)} onClick={() => void saveOutline(outlineStatus === 'CONFIRMED' ? 'CONFIRMED' : 'DRAFT')}>{savingOutline ? '저장 중…' : '목차 메모 저장'}</Button><Button disabled={!editable || savingOutline || generatingOutline || !authoring.outlinePlan.persistenceAvailable || (outlineStatus === 'CONFIRMED' && !outlineDirty)} onClick={() => void saveOutline('CONFIRMED')}>{outlineStatus === 'CONFIRMED' ? '변경 목차 다시 확정' : '목차 기획 확정'}</Button></div>
            {!authoring.outlineAiConnected && <div className="error-box">관리자 설정에서 목차 기획용 {authoring.outlineProviderLabel} API 키를 연결하면 AI 목차 계획 버튼이 열립니다.</div>}
            {!authoring.outlinePlan.persistenceAvailable && <div className="error-box">목차 저장용 D1 마이그레이션이 아직 적용되지 않았습니다. 배포 상태를 확인해 주세요.</div>}
          </div>}
        </Card>
        <Card title="AI CHAPTER WORKFLOW · 3단계 챕터별 자동 작성" className="report-step-card report-step-card--3">
          {!authoring?.available ? <div className="error-box">{authoring?.unavailableReason ?? '이 유형의 승인된 챕터 프롬프트가 없습니다.'}</div> : <div className="form-stack">
            <div className="inline-form">
              <Select label="자동 작성할 챕터" value={selectedChapterId} onChange={(event) => setSelectedChapterId(event.target.value)} disabled={!editable || generating || saving} options={authoring.chapters.map((chapter) => ({ value: chapter.id, label: `${chapter.chapterCode} · ${chapter.title} · prompt v${chapter.promptVersion}` }))} />
              <Button onClick={() => void generateChapter()} disabled={!editable || !authoring.aiConnected || outlineStatus !== 'CONFIRMED' || outlineDirty || !selectedChapterId || dirty || saving || generating}>{generating ? '근거 분석·작성 중…' : '선택 챕터 자동 작성'}</Button>
            </div>
            {selectedChapter && <div className="report-chapter-source-pack"><header><div><span>CURRENT CHAPTER AGENT</span><h3>{selectedChapter.agentCode} · {selectedChapter.chapterCode} {selectedChapter.title}</h3></div><em>{selectedChapterSources.filter((source) => source.status === 'READY').length}/{selectedChapterSources.length} SOURCES READY</em></header><div>{selectedChapterSources.map((source) => <span key={source.code} data-source-state={source.status}>{source.status === 'READY' ? '✓' : source.status === 'PARTIAL' ? '!' : '○'} {source.label}</span>)}</div><p><strong>목차 기획 메모</strong> {outlineNotes[selectedChapter.id]?.trim() || '별도 메모 없음 · 승인된 기본 챕터 지시를 사용합니다.'}</p></div>}
            <p className="muted">프로젝트 유형 {authoring.claimType} · {authoring.providerLabel} / {authoring.modelLabel} · {authoring.credentialSource === 'PERSONAL' ? '내 개인 API 키 우선 사용' : authoring.credentialSource === 'ORGANIZATION' ? '조직 공용 암호화 키 사용' : authoring.credentialSource === 'ENVIRONMENT' ? 'Cloudflare 서버 Secret 사용' : '키 연결 필요'} · 프롬프트 원문은 관리자만 열람·수정할 수 있습니다.</p>
            {(outlineStatus !== 'CONFIRMED' || outlineDirty) && <div className="error-box">2단계에서 최신 목차 기획을 확정해야 챕터 자동 작성이 열립니다.</div>}
            {!authoring.aiConnected && <div className="error-box">설정의 개인 설정 또는 관리자 설정에서 {authoring.providerLabel} API 키를 연결해야 자동 작성 버튼이 열립니다.</div>}
            {(dirty || saving) && <p className="notice-box">현재 편집 내용을 먼저 저장하면 최신 보고서 버전을 기준으로 AI 챕터를 작성할 수 있습니다.</p>}
          </div>}
        </Card>
        <Card title={selectedCase ? `4단계 편집 · ${selectedCase.caseNumber} · ${selectedCase.title}` : '4단계 보고서 편집'} className="report-step-card report-step-card--4">
          <div className="form-stack">
            <Input label="보고서 제목" value={title} maxLength={300} readOnly={!editable} onChange={(event) => { titleRef.current = event.target.value; setTitle(event.target.value); setDirty(true); }} onBlur={() => void saveNow()} />
            <label htmlFor="preview-report-body">보고서 본문</label>
            <textarea id="preview-report-body" className="report-editor" value={content} maxLength={500000} readOnly={!editable} aria-readonly={!editable} onChange={(event) => { contentRef.current = event.target.value; setContent(event.target.value); setDirty(true); }} onBlur={() => void saveNow()} />
            {editable && <section className="report-writing-assistant" aria-label="Gemini 글쓰기 개선 도우미"><div><span>GEMINI WRITING ASSISTANT</span><strong>내 개인 Gemini 키로 현재 본문을 안전하게 다듬습니다.</strong><small>한 번 연결한 키는 다음 로그인에도 자동 사용됩니다. 무료 할당량 소진 안내가 나오면 설정에서 새 키로 교체하세요.</small></div><input aria-label="글쓰기 개선 요청" value={improvementInstruction} maxLength={2000} onChange={(event) => setImprovementInstruction(event.target.value)} /><div className="action-row"><Button variant="secondary" onClick={() => onNavigate('/settings')}>Gemini 설정 열기</Button><Button variant="secondary" disabled={!selectedTemplateCategory} onClick={() => setShowTemplatePreview(true)}>원본 템플릿 다시 보기</Button><Button onClick={() => void improveWriting()} disabled={!authoring?.assistantConnected || !content.trim() || dirty || saving || improving || improvementInstruction.trim().length < 3}>{improving ? 'Gemini 문장 개선 중…' : 'Gemini로 글 개선'}</Button></div>{!authoring?.assistantConnected && <small>설정에서 개인 Gemini API 키를 연결하면 글 개선 버튼이 열립니다.</small>}{dirty && <small>현재 변경 내용을 먼저 D1에 저장하면 개선 버튼이 열립니다.</small>}</section>}
            {editable && selectedChapter && <section className="report-memory-feedback" aria-label="AI 학습 피드백"><header><div><span>FEEDBACK → REVIEW → MEMORY</span><strong>다음 보고서에서 같은 실수를 반복하지 않게 알려주세요.</strong><small>현재 프로젝트 저장본은 단기기억으로, 승인된 개인·유형·챕터 규칙은 장기기억으로 구분합니다. 채팅 기록 전체를 저장하거나 다른 사건의 내용을 섞지 않습니다.</small></div><em>D1 HERMES COMPATIBLE</em></header><div className="report-memory-feedback__form"><label>적용 범위<select value={memoryScope} onChange={(event) => { setMemoryScope(event.target.value as MemoryScope); memoryRequestKey.current=crypto.randomUUID(); }}><option value="CHAPTER">현재 챕터</option><option value="CLAIM_TYPE">현재 클레임 유형</option><option value="REPORT_TYPE">현재 보고서 유형</option><option value="USER_FEEDBACK">내 반복 피드백</option><option value="GLOBAL">회사 전체</option></select></label><label>다음번에 개선할 점<input value={memoryFeedback} maxLength={2000} onChange={(event) => { setMemoryFeedback(event.target.value); memoryRequestKey.current=crypto.randomUUID(); }} placeholder="예: 책임소재를 너무 단정적으로 쓰지 말고 계약조항을 먼저 보여줘" /></label><Button onClick={() => void submitMemoryFeedback()} disabled={!memoryFeedback.trim() || memoryFeedback.trim().length < 3 || dirty || saving || submittingMemory}>{submittingMemory ? '분석·등록 중…' : '학습 후보 등록'}</Button></div>{dirty && <small>수정한 본문을 먼저 저장해야 AI 초안과 사람 수정본의 차이를 비교할 수 있습니다.</small>}{memoryNotice && <p className="notice-box">{memoryNotice}</p>}</section>}
            <p className="muted">{editable ? '입력 후 0.9초가 지나면 자동 저장됩니다.' : 'Reviewer 계정은 저장된 보고서를 읽을 수 있지만 본문은 수정할 수 없습니다.'} {savedAt ? `마지막 저장 ${new Date(savedAt).toLocaleString('ko-KR')}` : ''}</p>
            {error && <p className="error-box" role="alert">{error}</p>}
          </div>
        </Card>
        <Card title={`저장 이력 ${revisions.length}건`} className="report-step-card report-step-card--history">
          {revisions.length ? <ul className="dashboard-work-list">{revisions.map((revision) => <li key={revision.id}><span><strong>버전 {revision.version} · {revision.title}</strong><small>{new Date(revision.savedAt).toLocaleString('ko-KR')} · {revision.savedBy.name} · SHA {revision.contentSha256.slice(0, 12)}…</small></span></li>)}</ul> : <p className="empty-box">아직 저장된 버전이 없습니다. 첫 내용을 입력하면 자동 저장됩니다.</p>}
        </Card>
        <Card title="5단계 검토·승인 제출" className="report-step-card report-step-card--5">
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
        <Card title="FINAL OUTPUT · 승인본 확정 및 다운로드" className="report-step-card report-step-card--final">
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
      <footer className="report-wizard-footer" aria-label="보고서 단계 이동">
        <Button variant="secondary" disabled={!previousStep} onClick={() => previousStep && setActiveStep(previousStep)}>← 이전 단계</Button>
        <div>
          <strong>{activeStep} / 5 · {activeStepGuide.title}</strong>
          <small>{stepComplete[activeStep] ? `✓ ${activeStepGuide.doneText}` : nextBlockedReason || activeStepGuide.doneText}</small>
        </div>
        {nextStep
          ? <Button disabled={!stepComplete[activeStep]} onClick={() => setActiveStep(nextStep)}>이 단계 완료 · 다음 단계 →</Button>
          : <Button onClick={() => onNavigate('/approval')}>검토·승인함 열기 →</Button>}
      </footer>
      <Dialog isOpen={showTemplatePreview && Boolean(selectedTemplateCategory)} title={selectedTemplateCategory ? `${selectedTemplateCategory.categoryCode} · ${selectedTemplateCategory.displayName}` : '원본 보고서 템플릿'} onClose={() => setShowTemplatePreview(false)}>
        {selectedTemplateCategory && <div className="report-template-preview-dialog"><header><span>SOURCE-ANALYZED TEMPLATE · FINISHED REPORT REFERENCE · v{selectedTemplateCategory.analysisVersion}</span><p>{selectedTemplateCategory.analysisSummary}</p>{!selectedTemplateCategory.matchesCurrentType && <strong>참고 열람 전용 · 현재 프로젝트 유형은 {authoring?.claimType}, 이 원본의 주 유형은 {selectedTemplateCategory.primaryClaimType}입니다.</strong>}</header><section className="report-template-source-outline"><h3>원본에서 확인한 목차·작성 순서</h3><ol>{selectedTemplateCategory.outline.map((item) => <li key={item}>{item}</li>)}</ol></section><section className="report-template-source-files"><header><div><span>PRIVATE COMPANY GOOGLE DRIVE</span><h3>실제 원본 완제품 {selectedTemplateCategory.uploadedSourceCount}/{selectedTemplateCategory.expectedSourceCount}개</h3></div></header>{selectedTemplateCategory.files.length ? <ul>{selectedTemplateCategory.files.map((file) => <li key={file.id}><div><strong>{file.originalName}</strong><small>{file.fileExtension.toUpperCase()} · {(file.byteSize / 1024 / 1024).toFixed(1)} MB · {file.uploadedByName} · SHA {file.sha256.slice(0, 12)}…</small></div><Button variant="secondary" onClick={() => void openTemplateSource(file)}>{file.viewMode === 'INLINE' ? '원본 PDF 열기' : '원본 다운로드'}</Button></li>)}</ul> : <p className="empty-box">구조 분석과 챕터 프롬프트는 적용됐지만 Google Drive 원본 파일은 아직 등록되지 않았습니다. 관리자가 AI·템플릿 관리 화면에서 원본 폴더를 한 번 등록해야 합니다.</p>}</section>{selectedTemplatePreview && <details className="report-template-structure-fallback"><summary>웹용 구조 예시도 함께 보기</summary><pre>{selectedTemplatePreview.finishedExample}</pre></details>}</div>}
      </Dialog>
    </div>
  );
}
