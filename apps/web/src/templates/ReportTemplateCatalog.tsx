import React, { useEffect, useState } from 'react';
import { Button, Card, Dialog, Input, Select, StateView, StatusBadge } from '@claim-studio/ui';
import { apiRequest, ApiError } from '../api';

export interface ReportTemplateCatalogProps {
  routeId: string;
  roles: string[];
  onNavigate?: (path: string) => void;
}

interface TypeMapping {
  id: string;
  typeId: string;
  kind: 'PRIMARY' | 'SECONDARY';
}

interface TemplateVersion {
  id: string;
  templateId: string;
  versionNumber: number;
  name: string;
  companyForm: string;
  tocStructureJson: string;
  requiredSectionsJson: string;
  requiredEvidenceRulesJson: string;
  blockSchemasJson: string;
  referenceFileIdsJson: string;
  status: 'DRAFT' | 'HUMAN_APPROVED' | 'ACTIVE' | 'ARCHIVED';
  createdById: string;
  approvedById?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  typeMappings: TypeMapping[];
  createdBy?: { id: string; name: string; email: string };
  approvedBy?: { id: string; name: string; email: string } | null;
}

interface ReportTemplateItem {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  status: string;
  version: number;
  versions: TemplateVersion[];
}

interface BlockDef {
  id: string;
  code: string;
  name: string;
  description?: string;
  schemaJson: string;
}

interface CaseOption {
  id: string;
  caseNumber: string;
  title: string;
  claimType: string;
}

export const ReportTemplateCatalog: React.FC<ReportTemplateCatalogProps> = ({ roles, onNavigate }) => {
  const [selectedType, setSelectedType] = useState<string>('TYPE-01');
  const [templates, setTemplates] = useState<ReportTemplateItem[]>([]);
  const [activeCounts, setActiveCounts] = useState<Record<string, number>>({});
  const [availability, setAvailability] = useState<string>('AVAILABLE');
  const [blocks, setBlocks] = useState<BlockDef[]>([]);
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<ReportTemplateItem | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<TemplateVersion | null>(null);

  const [state, setState] = useState<'normal' | 'loading' | 'empty' | 'error' | 'forbidden'>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInstanceModal, setShowInstanceModal] = useState(false);
  const [targetCaseId, setTargetCaseId] = useState<string>('');

  // New Template Form
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newCompanyForm, setNewCompanyForm] = useState('');
  const [newPrimaryType, setNewPrimaryType] = useState('TYPE-01');
  const [newSecondaryType, setNewSecondaryType] = useState('');
  const [newTocText, setNewTocText] = useState('검토 개요, 계약 현황, 사실관계, 사진 분석, 산출근거, 의견, 결론');

  const isAdmin = roles.includes('admin');
  const isApprover = roles.some((r) => ['ceo', 'director'].includes(r));

  const fetchCatalogData = async (typeFilter: string) => {
    setState('loading');
    setErrorMsg('');
    try {
      const [tplData, blockData, caseData] = await Promise.all([
        apiRequest<{ templates: ReportTemplateItem[]; activeCounts: Record<string, number>; availability: string }>(
          `/api/report-templates?claimType=${typeFilter}`
        ),
        apiRequest<{ blocks: BlockDef[] }>('/api/block-definitions'),
        apiRequest<{ cases: CaseOption[] }>('/api/cases')
      ]);

      setTemplates(tplData.templates);
      setActiveCounts(tplData.activeCounts || {});
      setAvailability(tplData.availability);
      setBlocks(blockData.blocks);
      setCases(caseData.cases.filter((c) => c.claimType === typeFilter));

      if (tplData.templates.length > 0) {
        setSelectedTemplate(tplData.templates[0]);
        setSelectedVersion(tplData.templates[0].versions[0] || null);
        setState('normal');
      } else {
        setSelectedTemplate(null);
        setSelectedVersion(null);
        setState('empty');
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setState('forbidden');
      } else {
        setState('error');
        setErrorMsg(err instanceof Error ? err.message : '불러오기 실패');
      }
    }
  };

  useEffect(() => {
    void fetchCatalogData(selectedType);
  }, [selectedType]);

  const handleApprove = async (tplId: string, versionId: string) => {
    try {
      await apiRequest(`/api/report-templates/${tplId}/versions/${versionId}/approve`, { method: 'POST' });
      await fetchCatalogData(selectedType);
    } catch (err) {
      alert(err instanceof Error ? err.message : '승인 실패');
    }
  };

  const handleActivate = async (tplId: string, versionId: string) => {
    try {
      await apiRequest(`/api/report-templates/${tplId}/versions/${versionId}/activate`, { method: 'POST' });
      await fetchCatalogData(selectedType);
    } catch (err) {
      alert(err instanceof Error ? err.message : '활성화 실패');
    }
  };

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const tocArray = newTocText.split(',').map((s) => s.trim()).filter(Boolean);
      await apiRequest('/api/report-templates', {
        method: 'POST',
        body: JSON.stringify({
          code: newCode,
          name: newName,
          companyForm: newCompanyForm,
          primaryType: newPrimaryType,
          secondaryTypes: newSecondaryType ? [newSecondaryType] : [],
          tocStructure: tocArray,
          requiredSections: tocArray.slice(0, 3),
          requiredEvidenceRules: ['계약서 복사본', '현장 사진'],
          blockSchemas: { default: 'standard' }
        })
      });
      setShowCreateModal(false);
      await fetchCatalogData(selectedType);
    } catch (err) {
      alert(err instanceof Error ? err.message : '생성 실패');
    }
  };

  const handleCreateReportInstance = async () => {
    if (!targetCaseId || !selectedVersion) return;
    try {
      const result = await apiRequest<{ instance: { id: string } }>(`/api/cases/${targetCaseId}/report-instances`, {
        method: 'POST',
        body: JSON.stringify({ templateVersionId: selectedVersion.id })
      });
      setShowInstanceModal(false);
      alert(`사건 보고서 인스턴스가 성공적으로 생성되었습니다. (ID: ${result.instance.id})`);
      if (onNavigate) onNavigate('/cases/detail');
    } catch (err) {
      alert(err instanceof Error ? err.message : '보고서 인스턴스 생성 실패');
    }
  };

  const claimTypeTabs = [
    { typeId: 'TYPE-01', label: 'TYPE-01: 현장조사/수량산출' },
    { typeId: 'TYPE-02', label: 'TYPE-02: 분석 보고서' },
    { typeId: 'TYPE-03', label: 'TYPE-03: 일반 클레임' },
    { typeId: 'TYPE-04', label: 'TYPE-04: 공사비 협상' },
    { typeId: 'TYPE-05', label: 'TYPE-05: 사감정보고서 (미확보)' },
    { typeId: 'TYPE-06', label: 'TYPE-06: 물가변동' }
  ];

  return (
    <div className="report-template-catalog" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* 클레임 유형 필터 탭 */}
      <div className="type-tabs" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }} aria-label="클레임 유형 선택">
        {claimTypeTabs.map((tab) => {
          const isActive = selectedType === tab.typeId;
          const activeCount = activeCounts[tab.typeId] ?? 0;
          return (
            <Button
              key={tab.typeId}
              variant={isActive ? 'primary' : 'secondary'}
              onClick={() => setSelectedType(tab.typeId)}
            >
              {tab.label}
              <span style={{ marginLeft: '0.5rem', opacity: 0.8, fontSize: '0.8em' }}>
                (ACTIVE: {activeCount})
              </span>
            </Button>
          );
        })}
      </div>

      {/* 상태 조절 / 필터 배지 */}
      <div className="action-row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <strong>현재 유형: {selectedType}</strong>
          <StatusBadge status={availability === 'AVAILABLE' ? 'approved' : 'review'} />
          <span className="muted">
            {availability === 'AVAILABLE' ? '사건 적용 가능 ACTIVE 템플릿 존재' : 'TEMPLATE_NOT_FOUND (활성 템플릿 미확보)'}
          </span>
        </div>
        {isAdmin && selectedType !== 'TYPE-05' && (
          <Button onClick={() => { setNewPrimaryType(selectedType); setShowCreateModal(true); }}>
            + 새 템플릿 초안 작성 (Admin)
          </Button>
        )}
      </div>

      <StateView state={state} onRetry={() => void fetchCatalogData(selectedType)}>
        {selectedType === 'TYPE-05' ? (
          <Card title="TYPE-05 사감정보고서 템플릿 미확보 안내">
            <div style={{ padding: '1rem', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: '4px' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#92400E' }}>⚠️ TEMPLATE_NOT_FOUND State</h4>
              <p style={{ margin: 0, color: '#78350F' }}>
                TYPE-05(사감정보고서)는 현재 회사 표준 템플릿이 확보되지 않은 유형입니다.
                자동 추천이나 다른 유형 템플릿 우회 배정이 금지되어 있으며, 템플릿 추가 검토 요청 절차를 거쳐야 합니다.
              </p>
            </div>
          </Card>
        ) : state === 'error' ? (
          <Card title="오류 발생">
            <p style={{ color: '#DC2626' }}>{errorMsg || '템플릿 목록을 불러오는 중 오류가 발생했습니다.'}</p>
          </Card>
        ) : templates.length === 0 ? (
          <Card title="등록된 템플릿 없음">
            <p className="muted">
              선택한 유형({selectedType})에 등록된 템플릿이 없습니다. Admin 사용자가 DRAFT 템플릿을 생성할 수 있습니다.
            </p>
          </Card>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1rem' }}>
            {/* 템플릿 목록 사이드바 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <h3>템플릿 목록 ({templates.length})</h3>
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  onClick={() => {
                    setSelectedTemplate(tpl);
                    setSelectedVersion(tpl.versions[0] || null);
                  }}
                  style={{
                    cursor: 'pointer',
                    borderRadius: '8px',
                    border: selectedTemplate?.id === tpl.id ? '2px solid #2563EB' : '1px solid #E5E7EB'
                  }}
                >
                  <Card title={tpl.name}>
                    <p className="muted" style={{ margin: '0.2rem 0' }}>코드: {tpl.code}</p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                      {tpl.versions.map((ver) => (
                        <span
                          key={ver.id}
                          style={{
                            fontSize: '0.75rem',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: ver.status === 'ACTIVE' ? '#D1FAE5' : ver.status === 'HUMAN_APPROVED' ? '#DBEAFE' : '#F3F4F6',
                            color: ver.status === 'ACTIVE' ? '#065F46' : ver.status === 'HUMAN_APPROVED' ? '#1E40AF' : '#374151'
                          }}
                        >
                          v{ver.versionNumber} ({ver.status})
                        </span>
                      ))}
                    </div>
                  </Card>
                </div>
              ))}
            </div>

            {/* 템플릿 및 버전 상세 정보 */}
            {selectedTemplate && selectedVersion && (
              <Card title={`${selectedTemplate.name} (v${selectedVersion.versionNumber})`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <StatusBadge status={selectedVersion.status === 'ACTIVE' ? 'approved' : selectedVersion.status === 'HUMAN_APPROVED' ? 'review' : 'ai_draft'} />
                      <strong style={{ marginLeft: '0.5rem' }}>상태: {selectedVersion.status}</strong>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {isApprover && selectedVersion.status === 'DRAFT' && (
                        <Button
                          variant="secondary"
                          onClick={() => void handleApprove(selectedTemplate.id, selectedVersion.id)}
                        >
                          사람 승인 (HUMAN_APPROVED)
                        </Button>
                      )}
                      {isApprover && selectedVersion.status === 'HUMAN_APPROVED' && (
                        <Button
                          onClick={() => void handleActivate(selectedTemplate.id, selectedVersion.id)}
                        >
                          ACTIVE 상태 전환
                        </Button>
                      )}
                      {selectedVersion.status === 'ACTIVE' && cases.length > 0 && (
                        <Button onClick={() => setShowInstanceModal(true)}>
                          사건에 템플릿 Snapshot 배정
                        </Button>
                      )}
                    </div>
                  </div>

                  <div style={{ background: '#F9FAFB', padding: '0.75rem', borderRadius: '4px' }}>
                    <p style={{ margin: '0 0 0.4rem 0' }}><strong>회사 양식:</strong> {selectedVersion.companyForm}</p>
                    <p style={{ margin: '0 0 0.4rem 0' }}>
                      <strong>유형 매핑:</strong> Primary ({selectedVersion.typeMappings.find((m) => m.kind === 'PRIMARY')?.typeId || 'N/A'})
                      {selectedVersion.typeMappings.filter((m) => m.kind === 'SECONDARY').length > 0 && (
                        <> / Secondary ({selectedVersion.typeMappings.filter((m) => m.kind === 'SECONDARY').map((m) => m.typeId).join(', ')})</>
                      )}
                    </p>
                    <p style={{ margin: 0 }}>
                      <strong>작성자:</strong> {selectedVersion.createdBy?.name || selectedVersion.createdById} |{' '}
                      <strong>승인자:</strong> {selectedVersion.approvedBy?.name || selectedVersion.approvedById || '미승인'}
                    </p>
                  </div>

                  {/* 목차 논리 구조 미리보기 */}
                  <div>
                    <h4>목차 논리 구조 (TOC Structure)</h4>
                    <ol style={{ paddingLeft: '1.2rem', margin: '0.5rem 0' }}>
                      {JSON.parse(selectedVersion.tocStructureJson || '[]').map((section: string, idx: number) => (
                        <li key={idx} style={{ margin: '0.2rem 0' }}>
                          <strong>{section}</strong> (필수 작성 장)
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* 표준 블록 카탈로그 8종 연동 */}
                  <div>
                    <h4>표준 블록 카탈로그 8종 수용 현황</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginTop: '0.5rem' }}>
                      {blocks.map((blk) => (
                        <div
                          key={blk.code}
                          style={{
                            padding: '0.5rem',
                            border: '1px solid #E5E7EB',
                            borderRadius: '4px',
                            background: '#FFFFFF',
                            fontSize: '0.85rem'
                          }}
                        >
                          <strong>{blk.name}</strong> ({blk.code})
                          <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.75rem', color: '#6B7280' }}>
                            {blk.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            )}
          </div>
        )}
      </StateView>

      {/* Admin 템플릿 생성 모달 */}
      <Dialog isOpen={showCreateModal} title="새 보고서 템플릿 DRAFT 생성 (Admin)" onClose={() => setShowCreateModal(false)}>
        <form onSubmit={(e) => void handleCreateTemplate(e)} className="form-stack">
          <Input label="템플릿 코드" value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="RPT-TPL-TYPE01-001" required />
          <Input label="템플릿 이름" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="현장조사 및 수량산출 표준 템플릿" required />
          <Input label="회사 표준 양식 설명" value={newCompanyForm} onChange={(e) => setNewCompanyForm(e.target.value)} placeholder="TF팀 2026 수량산출 양식 v1" required />
          <Select
            label="Primary 클레임 유형"
            value={newPrimaryType}
            options={claimTypeTabs.filter((t) => t.typeId !== 'TYPE-05').map((t) => ({ value: t.typeId, label: t.label }))}
            onChange={(e) => setNewPrimaryType(e.target.value)}
          />
          <Input label="Secondary 클레임 유형 (선택)" value={newSecondaryType} onChange={(e) => setNewSecondaryType(e.target.value)} placeholder="TYPE-02" />
          <Input label="목차 구조 (쉼표 구분)" value={newTocText} onChange={(e) => setNewTocText(e.target.value)} required />
          <div className="action-row" style={{ marginTop: '1rem' }}>
            <Button type="submit">초안 생성 저장</Button>
            <Button variant="secondary" type="button" onClick={() => setShowCreateModal(false)}>취소</Button>
          </div>
        </form>
      </Dialog>

      {/* 사건에 템플릿 snapshot 배정 모달 */}
      <Dialog isOpen={showInstanceModal} title="사건 보고서 인스턴스 생성 (Snapshot 배정)" onClose={() => setShowInstanceModal(false)}>
        <div className="form-stack">
          <p>
            선택된 ACTIVE 템플릿 버전(<strong>{selectedTemplate?.name} v{selectedVersion?.versionNumber}</strong>)의
            회사양식, 목차, 블록 스키마를 해당 사건에 immutable snapshot으로 복사합니다.
          </p>
          <Select
            label="대상 사건 선택"
            value={targetCaseId}
            options={cases.map((c) => ({ value: c.id, label: `${c.caseNumber} - ${c.title}` }))}
            onChange={(e) => setTargetCaseId(e.target.value)}
          />
          <div className="action-row" style={{ marginTop: '1rem' }}>
            <Button onClick={() => void handleCreateReportInstance()} disabled={!targetCaseId}>
              인스턴스 생성 및 Snapshot 저장
            </Button>
            <Button variant="secondary" onClick={() => setShowInstanceModal(false)}>취소</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
