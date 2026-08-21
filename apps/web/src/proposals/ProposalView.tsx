import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Card, Dialog, Input, Select, StatusBadge, type StatusType } from '@claim-studio/ui';
import { apiRequest, apiDownloadPost, ApiError } from '../api';
import { proposalWorkbook, readProposalWorkbook } from './proposal-excel';

export interface ProposalViewProps {
  routeId: string;
  roles: readonly string[];
  onNavigate: (path: string) => void;
}

interface CaseItem {
  id: string;
  caseNumber: string;
  title: string;
  claimType: string;
  status: string;
}

interface ProposalTemplate {
  id: string;
  name: string;
  claimType: string;
  description: string;
  bodyTemplate: string;
  placeholdersJson: string;
}

interface ProposalVersion {
  id: string;
  versionNumber: number;
  bodyText: string;
  structuredInputsJson: string;
  generationMode: string;
  providerId: string | null;
  modelId: string | null;
  inputSha256: string;
  generatedAt: string | null;
  sourceDocumentVersionIdsJson: string | null;
  missingFieldsJson: string;
  sha256: string;
  isApproved: boolean;
  createdAt: string;
  createdBy?: { id: string; name: string };
}

interface ProposalReview {
  id: string;
  action: string;
  comment: string | null;
  createdAt: string;
  reviewer: { id: string; name: string };
}

interface Proposal {
  id: string;
  caseId: string;
  templateId: string;
  title: string;
  status: string;
  currentVersionId: string | null;
  approvedVersionId: string | null;
  outputDocumentId: string | null;
  version: number;
  template?: ProposalTemplate;
  versions?: ProposalVersion[];
  reviews?: ProposalReview[];
}

function readStringArray(value: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

function proposalStatusBadge(status: string): StatusType {
  const normalized = status.toLowerCase();
  return ['draft', 'in_review', 'approved', 'rejected'].includes(normalized)
    ? normalized as StatusType
    : 'unwritten';
}

export const ProposalView: React.FC<ProposalViewProps> = ({ routeId, roles, onNavigate }) => {
  const requestedCaseId = new URLSearchParams(window.location.search).get('caseId') ?? '';
  const fromIntake = new URLSearchParams(window.location.search).get('from') === 'intake';
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>(requestedCaseId);
  const [templates, setTemplates] = useState<ProposalTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [activeProposal, setActiveProposal] = useState<Proposal | null>(null);

  // Form Stepper State (Step 1..4)
  const [step, setStep] = useState<number>(1);
  const [background, setBackground] = useState<string>('');
  const [objective, setObjective] = useState<string>('');
  const [method, setMethod] = useState<string>('');
  const [expectedOutcome, setExpectedOutcome] = useState<string>('');
  const [exclusions, setExclusions] = useState<string>('');
  const [sourceDocumentVersionIds, setSourceDocumentVersionIds] = useState<string>('');
  const [providerId, setProviderId] = useState<string>('GEMINI');
  const [modelId, setModelId] = useState<string>('gemini-3.7-flash');

  const [reviewComment, setReviewComment] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const canEdit = roles.some((role) => ['ceo', 'director', 'pm', 'admin'].includes(role));
  const canApprove = roles.some((role) => ['reviewer', 'director', 'ceo', 'admin'].includes(role));

  // Load cases
  useEffect(() => {
    apiRequest<{ cases: CaseItem[] }>('/api/cases')
      .then((res) => {
        setCases(res.cases || []);
        if (res.cases && res.cases.length > 0) {
          setSelectedCaseId((current) => {
            const preferred = current || requestedCaseId;
            return res.cases.some((item) => item.id === preferred) ? preferred : res.cases[0].id;
          });
        }
      })
      .catch((err: Error) => setErrorMessage(err.message));
  }, []);

  // Load templates and proposals when selectedCaseId changes
  const loadCaseData = useCallback(async (cId: string) => {
    if (!cId) return;
    try {
      const c = cases.find((item) => item.id === cId);
      const claimTypeQuery = c ? `?claimType=${c.claimType}` : '';
      const [tplRes, propRes] = await Promise.all([
        apiRequest<{ templates: ProposalTemplate[] }>(`/api/proposal-templates${claimTypeQuery}`),
        apiRequest<{ proposals: Proposal[] }>(`/api/cases/${cId}/proposals`)
      ]);
      setTemplates(tplRes.templates || []);
      if (tplRes.templates && tplRes.templates.length > 0) {
        setSelectedTemplateId(tplRes.templates[0].id);
      }
      setProposals(propRes.proposals || []);
      if (propRes.proposals && propRes.proposals.length > 0) {
        loadProposalDetail(cId, propRes.proposals[0].id);
      } else {
        setActiveProposal(null);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) setErrorMessage(err.message);
      else setErrorMessage('데이터 로드 실패');
    }
  }, [cases]);

  useEffect(() => {
    if (selectedCaseId) {
      void loadCaseData(selectedCaseId);
    }
  }, [selectedCaseId, loadCaseData]);

  const loadProposalDetail = async (cId: string, pId: string) => {
    try {
      const res = await apiRequest<{ proposal: Proposal }>(`/api/cases/${cId}/proposals/${pId}`);
      setActiveProposal(res.proposal);
      const latestVer = res.proposal.versions?.[0];
      if (latestVer) {
        try {
          const parsed = JSON.parse(latestVer.structuredInputsJson) as Record<string, string>;
          setBackground(parsed.background || '');
          setObjective(parsed.objective || '');
          setMethod(parsed.method || '');
          setExpectedOutcome(parsed.expectedOutcome || '');
          setExclusions(parsed.exclusions || '');
          setSourceDocumentVersionIds(readStringArray(latestVer.sourceDocumentVersionIdsJson).join(', '));
        } catch {
          // ignore json parse error
        }
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) setErrorMessage(err.message);
    }
  };

  // Create new proposal (PROP-01 Action)
  const handleCreateProposal = async () => {
    if (!selectedCaseId || !selectedTemplateId) {
      setErrorMessage('사건과 템플릿을 선택하세요');
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await apiRequest<{ proposal: Proposal; versionId: string }>(`/api/cases/${selectedCaseId}/proposals`, {
        method: 'POST',
        body: JSON.stringify({ templateId: selectedTemplateId })
      });
      setSuccessMessage('신규 제안서가 성공적으로 생성되었습니다.');
      await loadCaseData(selectedCaseId);
      loadProposalDetail(selectedCaseId, res.proposal.id);
      onNavigate(`/proposals/editor?caseId=${encodeURIComponent(selectedCaseId)}`);
    } catch (err: unknown) {
      if (err instanceof ApiError) setErrorMessage(err.message);
      else setErrorMessage('제안서 생성 중 오류 발생');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Save / Add new Version (PROP-02 Action: Manual or AI)
  const handleSaveVersion = async (generationMode: 'MANUAL' | 'AI') => {
    if (!selectedCaseId || !activeProposal) return;
    if (![background, objective, method, expectedOutcome, exclusions].every((value) => value.trim())) {
      setErrorMessage('의뢰 배경, 수행 목적, 수행 방법, 예상 성과물, 제외사항은 모두 필수입니다. 해당 없음은 “없음”으로 입력하세요.');
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await apiRequest(`/api/cases/${selectedCaseId}/proposals/${activeProposal.id}/versions`, {
        method: 'POST',
        body: JSON.stringify({
          background,
          objective,
          method,
          expectedOutcome,
          exclusions,
          generationMode,
          ...(generationMode === 'AI' ? { providerId, modelId } : {}),
          sourceDocumentVersionIds: sourceDocumentVersionIds.split(',').map((id) => id.trim()).filter(Boolean),
          version: activeProposal.version
        })
      });
      setSuccessMessage(`제안서 버전이 (${generationMode === 'AI' ? 'AI 초안' : '수동'}) 성공적으로 저장되었습니다.`);
      await loadProposalDetail(selectedCaseId, activeProposal.id);
    } catch (err: unknown) {
      if (err instanceof ApiError) setErrorMessage(err.message);
      else setErrorMessage('버전 저장 실패');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Workflow Action (REQUEST_REVIEW, APPROVE, REJECT)
  const handleWorkflowAction = async (action: 'REQUEST_REVIEW' | 'APPROVE' | 'REJECT') => {
    if (!selectedCaseId || !activeProposal) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await apiRequest<{ message: string; status: string }>(`/api/cases/${selectedCaseId}/proposals/${activeProposal.id}/reviews`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          comment: reviewComment,
          versionId: activeProposal.currentVersionId,
          version: activeProposal.version
        })
      });
      setSuccessMessage(`상태가 변경되었습니다: ${res.status}`);
      setReviewComment('');
      await loadProposalDetail(selectedCaseId, activeProposal.id);
    } catch (err: unknown) {
      if (err instanceof ApiError) setErrorMessage(err.message);
      else setErrorMessage('검토/승인 작업 실패');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Render & Download Document
  const handleRenderDownload = async (format: 'docx' | 'pdf') => {
    if (!selectedCaseId || !activeProposal) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const { blob, filename } = await apiDownloadPost(`/api/cases/${selectedCaseId}/proposals/${activeProposal.id}/render`, {
        format,
        versionId: activeProposal.approvedVersionId,
        version: activeProposal.version
      });
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
      setSuccessMessage(`[${format.toUpperCase()}] 출력 문서가 성공적으로 내려받아졌습니다: ${filename}`);
      await loadProposalDetail(selectedCaseId, activeProposal.id);
    } catch (err: unknown) {
      if (err instanceof ApiError) setErrorMessage(err.message);
      else setErrorMessage('문서 출력/다운로드 실패');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExcelExport = () => {
    if (!activeProposal || !selectedCase) return;
    const bytes = proposalWorkbook(
      { background, objective, method, expectedOutcome, exclusions },
      `${selectedCase.caseNumber} · ${selectedCase.title}`,
      templates.find((template) => template.id === activeProposal.templateId)?.name ?? activeProposal.title
    );
    const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${selectedCase.caseNumber.replace(/[^0-9A-Za-z가-힣_-]/gu, '_')}_클라이언트_제안서_작성양식.xlsx`;
    anchor.click();
    URL.revokeObjectURL(url);
    setSuccessMessage('클라이언트 제안서 Excel 양식을 내보냈습니다. C열만 수정한 뒤 다시 가져오세요.');
  };

  const handleExcelImport = async (file: File | undefined) => {
    if (!file) return;
    setIsSubmitting(true); setErrorMessage(null); setSuccessMessage(null);
    try {
      const values = await readProposalWorkbook(file);
      setBackground(values.background); setObjective(values.objective); setMethod(values.method);
      setExpectedOutcome(values.expectedOutcome); setExclusions(values.exclusions); setStep(1);
      setSuccessMessage('Excel 작성 내용을 불러왔습니다. 화면에서 확인한 뒤 “수동 버전 저장”으로 D1에 저장하세요.');
    } catch (reason) {
      setErrorMessage(reason instanceof Error ? reason.message : 'Excel 제안서 양식을 읽지 못했습니다.');
    } finally {
      setIsSubmitting(false);
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  };

  const currentVer = activeProposal?.versions?.[0];
  const selectedCase = cases.find((item) => item.id === selectedCaseId);

  return (
    <div className="proposal-view-container">
      {errorMessage && (
        <Dialog isOpen={Boolean(errorMessage)} title="오류" onClose={() => setErrorMessage(null)}>
          <p className="error-text" style={{ color: 'var(--color-danger, #d93025)' }}>{errorMessage}</p>
        </Dialog>
      )}

      {successMessage && (
        <Card title="알림">
          <p style={{ color: 'var(--color-success, #1e8e3e)' }}>{successMessage}</p>
        </Card>
      )}

      {/* Case Selector Header */}
      <Card title="현재 프로젝트 · 제안서 작성 연결">
        <div className="form-stack">
          <Select
            label="사건 선택"
            value={selectedCaseId}
            onChange={(e) => setSelectedCaseId(e.target.value)}
            options={cases.map((c) => ({ value: c.id, label: `[${c.caseNumber}] ${c.title} (${c.claimType})` }))}
          />

          {selectedCase && <section className="proposal-intake-context" aria-label="현재 선택된 프로젝트">
            <div><span>{fromIntake ? '방금 저장한 프로젝트 의뢰' : '현재 선택 프로젝트'}</span><strong>{selectedCase.caseNumber} · {selectedCase.title}</strong><small>{selectedCase.claimType} · {selectedCase.status}</small></div>
            <p><b>다음 할 일</b> 유형에 맞는 템플릿을 선택해 제안서를 만들고, 의뢰 배경부터 순서대로 작성하세요.</p>
          </section>}

          {proposals.length > 0 && (
            <Select
              label="기존 제안서 선택"
              value={activeProposal?.id || ''}
              onChange={(e) => loadProposalDetail(selectedCaseId, e.target.value)}
              options={proposals.map((p) => ({ value: p.id, label: `${p.title} (상태: ${p.status}, v${p.version})` }))}
            />
          )}
        </div>
      </Card>

      {/* PROP-01: Template Selection Section */}
      {(routeId === 'PROP-01' || (!activeProposal && selectedCaseId)) && (
        <Card title={routeId === 'PROP-01' ? '제안서 템플릿 선택' : '제안서 작성 1단계 · 유형별 템플릿 선택'}>
          <p className="muted">현재 프로젝트 유형에 맞는 표준 기술제안서 템플릿을 선택하세요. 생성하면 의뢰 배경 작성부터 바로 시작합니다.</p>
          <div className="form-stack" style={{ marginTop: '1rem' }}>
            <Select
              label="적용 템플릿 선택"
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              options={templates.map((t) => ({ value: t.id, label: `${t.name} [${t.claimType}]` }))}
            />

            {templates.find((t) => t.id === selectedTemplateId) && (
              <div className="template-preview" style={{ padding: '0.75rem', background: '#f8f9fa', borderRadius: '4px', border: '1px solid #dadce0' }}>
                <h4>{templates.find((t) => t.id === selectedTemplateId)?.name}</h4>
                <p>{templates.find((t) => t.id === selectedTemplateId)?.description}</p>
                <pre style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', maxHeight: '150px', overflowY: 'auto' }}>
                  {templates.find((t) => t.id === selectedTemplateId)?.bodyTemplate}
                </pre>
              </div>
            )}

            <div className="action-row">
              <Button onClick={handleCreateProposal} disabled={isSubmitting || !selectedTemplateId || !canEdit}>
                선택한 템플릿으로 제안서 생성
              </Button>
              {routeId === 'PROP-01' && <Button variant="secondary" onClick={() => onNavigate(`/proposals/editor?caseId=${encodeURIComponent(selectedCaseId)}`)}>
                제안서 단계형 작성기로 이동
              </Button>}
            </div>
          </div>
        </Card>
      )}

      {/* PROP-02: Stepper Writer & Review/Approval Section */}
      {activeProposal && (
        <Card title={`단계형 제안서 작성기 [${activeProposal.title}]`} className="proposal-step-card">
          <div data-active-step={step}>
              <div className="proposal-status-header" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                <span>현재 상태:</span>
                <StatusBadge status={proposalStatusBadge(activeProposal.status)} />
                <span className="muted">| 버전: v{currentVer?.versionNumber || 1}</span>
                {currentVer?.generationMode === 'AI' && <StatusBadge status="ai_draft" />}
              </div>

              <section className="proposal-excel-workflow" aria-label="클라이언트 제안서 Excel 작성">
                <div><strong>Excel로 클라이언트별 내용만 수정</strong><span>승인 템플릿 구조와 항목 코드는 고정하고 C열의 내용만 현장에서 수정합니다.</span></div>
                <div className="action-row">
                  <Button variant="secondary" onClick={handleExcelExport}>Excel 양식 내보내기</Button>
                  <input ref={excelInputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(event) => void handleExcelImport(event.target.files?.[0])} />
                  <Button variant="secondary" onClick={() => excelInputRef.current?.click()} disabled={isSubmitting || !canEdit}>작성 Excel 가져오기</Button>
                </div>
              </section>

              {/* Wizard Stepper Tabs */}
              <div className="stepper-nav" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                <Button className="proposal-step-button" size="sm" variant={step === 1 ? 'primary' : 'secondary'} onClick={() => setStep(1)}><b>01</b><span>의뢰 배경</span></Button>
                <Button className="proposal-step-button" size="sm" variant={step === 2 ? 'primary' : 'secondary'} onClick={() => setStep(2)}><b>02</b><span>수행 방법</span></Button>
                <Button className="proposal-step-button" size="sm" variant={step === 3 ? 'primary' : 'secondary'} onClick={() => setStep(3)}><b>03</b><span>성과물·제외</span></Button>
                <Button className="proposal-step-button" size="sm" variant={step === 4 ? 'primary' : 'secondary'} onClick={() => setStep(4)}><b>04</b><span>미리보기·승인</span></Button>
              </div>

              {step === 1 && (
                <div className="step-content form-stack">
                  <Input label="1-1. 의뢰 배경 (BACKGROUND)" value={background} onChange={(e) => setBackground(e.target.value)} placeholder="클레임 의뢰 및 기술검토 배경 입력" />
                  <Input label="1-2. 수행 목적 (OBJECTIVE)" value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="분석 및 과업 목적 입력" />
                  <Button variant="secondary" onClick={() => setStep(2)}>다음 단계 (수행 방법) →</Button>
                </div>
              )}

              {step === 2 && (
                <div className="step-content form-stack">
                  <Input label="2. 수행 방법 및 산출 범위 (METHOD)" value={method} onChange={(e) => setMethod(e.target.value)} placeholder="현장실측, 수량산출, 계약서 검증 등 방법론 입력" />
                  <div className="action-row">
                    <Button variant="secondary" onClick={() => setStep(1)}>← 이전</Button>
                    <Button variant="secondary" onClick={() => setStep(3)}>다음 단계 (성과물) →</Button>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="step-content form-stack">
                  <Input label="3-1. 예상 성과물 (EXPECTED_OUTCOME)" value={expectedOutcome} onChange={(e) => setExpectedOutcome(e.target.value)} placeholder="제출 문서 및 기한 입력" />
                  <Input label="3-2. 제외 사항 (EXCLUSIONS)" value={exclusions} onChange={(e) => setExclusions(e.target.value)} placeholder="과업 범위 제외 조건 입력" />
                  <Input
                    label="3-3. 근거 DocumentVersion ID 목록 (쉼표 구분, 선택)"
                    value={sourceDocumentVersionIds}
                    onChange={(e) => setSourceDocumentVersionIds(e.target.value)}
                    placeholder="DOCVER-..."
                  />
                  <div className="action-row">
                    <Button variant="secondary" onClick={() => setStep(2)}>← 이전</Button>
                    <Button variant="secondary" onClick={() => setStep(4)}>다음 단계 (미리보기 & 승인) →</Button>
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="step-content form-stack">
                  <h4>Step 4: 작성 내용 미리보기 & 승인 워크플로우</h4>
                  <div className="body-preview" style={{ padding: '1rem', background: '#f1f3f4', borderRadius: '4px', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                    {currentVer?.bodyText || '생성된 본문 텍스트가 없습니다.'}
                  </div>

                  {currentVer?.generationMode === 'AI' && (
                    <div className="provenance-box" style={{ fontSize: '0.8rem', color: '#5f6368', padding: '0.5rem', background: '#e8f0fe', borderRadius: '4px' }}>
                      <strong>AI_DRAFT Provenance:</strong> Provider: {currentVer.providerId} | Model: {currentVer.modelId} | Input SHA-256: {currentVer.inputSha256.slice(0, 16)}... | 생성: {currentVer.generatedAt}
                    </div>
                  )}

                  <div className="action-row" style={{ marginTop: '1rem' }}>
                    <Select label="AI 공급자" value={providerId} onChange={(event) => setProviderId(event.target.value)} options={[{ value: 'GEMINI', label: 'Google · Gemini (서버 보안 연결)' }]} />
                    <Select label="AI 모델" value={modelId} onChange={(event) => setModelId(event.target.value)} options={[{ value: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash · 관리자 조직 키' }]} />
                    <Button variant="secondary" onClick={() => handleSaveVersion('MANUAL')} disabled={isSubmitting || !canEdit}>
                      수동 버전 저장
                    </Button>
                    <Button onClick={() => handleSaveVersion('AI')} disabled={isSubmitting || !canEdit}>
                      🤖 Gemini 제안서 초안 생성
                    </Button>
                  </div>

                  <hr style={{ margin: '1.5rem 0' }} />

                  <h4>검토 및 승인 제어</h4>
                  <Input label="검토/반려 사유" value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} placeholder="승인 또는 반려 시 의견 작성" />

                  <div className="action-row" style={{ marginTop: '0.5rem' }}>
                    <Button variant="secondary" onClick={() => handleWorkflowAction('REQUEST_REVIEW')} disabled={isSubmitting || !canEdit || activeProposal.status !== 'DRAFT'}>
                      검토 요청 (IN_REVIEW)
                    </Button>
                    <Button onClick={() => handleWorkflowAction('APPROVE')} disabled={isSubmitting || !canApprove || activeProposal.status !== 'IN_REVIEW'}>
                      제안서 승인 (APPROVE)
                    </Button>
                    <Button variant="danger" onClick={() => handleWorkflowAction('REJECT')} disabled={isSubmitting || !canApprove || activeProposal.status !== 'IN_REVIEW'}>
                      반려 (REJECT)
                    </Button>
                  </div>

                  <hr style={{ margin: '1.5rem 0' }} />

                  <h4>실제 문서 출력 (APPROVED 상태 전용)</h4>
                  {activeProposal.status !== 'APPROVED' && (
                    <p style={{ color: 'var(--color-danger, #d93025)', fontSize: '0.9rem' }}>
                      ⚠️ 제안서가 APPROVED 승인 상태일 때만 최종 DOCX/PDF 출력이 가능합니다. (현재: {activeProposal.status})
                    </p>
                  )}
                  <div className="action-row">
                    <Button onClick={() => handleRenderDownload('docx')} disabled={isSubmitting || activeProposal.status !== 'APPROVED'}>
                      📄 DOCX 출력 다운로드
                    </Button>
                    <Button onClick={() => handleRenderDownload('pdf')} disabled={isSubmitting || activeProposal.status !== 'APPROVED'}>
                      📕 PDF 출력 다운로드
                    </Button>
                  </div>

                  <h4>버전·근거·승인 이력</h4>
                  <ul aria-label="제안서 버전 이력">
                    {(activeProposal.versions ?? []).map((version) => (
                      <li key={version.id}>
                        v{String(version.versionNumber).padStart(2, '0')} · {version.generationMode}{version.isApproved ? ' · 승인본' : ''}
                        {' · '}SHA-256 {version.sha256.slice(0, 16)}… · 근거 {readStringArray(version.sourceDocumentVersionIdsJson).length}건
                      </li>
                    ))}
                  </ul>
                  <ul aria-label="제안서 검토 이력">
                    {(activeProposal.reviews ?? []).map((review) => (
                      <li key={review.id}>{review.action} · {review.reviewer.name} · {review.comment || '의견 없음'}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
        </Card>
      )}
    </div>
  );
};
