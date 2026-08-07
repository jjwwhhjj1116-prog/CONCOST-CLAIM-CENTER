import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input, Select } from '@claim-studio/ui';
import { apiRequest, ApiError } from '../api';

export interface ReportTemplateCatalogProps {
  routeId: string;
  roles: string[];
  onNavigate?: (path: string) => void;
}

type Lifecycle = 'DRAFT' | 'HUMAN_APPROVED' | 'ACTIVE' | 'ARCHIVED';

interface TypeMapping {
  id: string;
  typeId: string;
  kind: 'PRIMARY' | 'SECONDARY';
}

interface TemplateSection {
  id: string;
  sectionNumber: number;
  title: string;
  isRequired: boolean;
  blockSchemaSnapshotJson: string;
}

interface TemplateReference {
  fileIdSnapshot: string;
  sha256Snapshot: string;
  fileSizeSnapshot: number;
}

interface TemplateVersion {
  id: string;
  versionNumber: number;
  rowVersion: number;
  name: string;
  companyForm: string;
  tocStructureJson: string;
  requiredSectionsJson: string;
  requiredEvidenceRulesJson: string;
  blockSchemasJson: string;
  contentSha256: string;
  status: Lifecycle;
  approvedAt?: string | null;
  activatedAt?: string | null;
  typeMappings: TypeMapping[];
  sections: TemplateSection[];
  references: TemplateReference[];
  createdBy?: { id: string; name: string };
  approvedBy?: { id: string; name: string } | null;
}

interface ReportTemplate {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  version: number;
  status: 'ACTIVE' | 'ARCHIVED';
  versions: TemplateVersion[];
}

interface BlockDefinition {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  version: number;
}

interface ReferenceInventory {
  fileId: string;
  sha256: string;
  fileSize: number;
  scanStatus: 'UNSCANNED' | 'SCANNED';
  approvalStatus: 'UNCLASSIFIED' | 'REVIEW_REQUIRED' | 'HUMAN_APPROVED';
  version: number;
}

interface CaseRecord {
  id: string;
  caseNumber: string;
  title: string;
  claimType: string;
  version: number;
}

const CLAIM_TYPES = [
  ['TYPE-01', '현장조사·수량산출'],
  ['TYPE-02', '분석 보고서'],
  ['TYPE-03', '일반 클레임'],
  ['TYPE-04', '재건축·재개발 공사비 협상'],
  ['TYPE-05', '사감정보고서'],
  ['TYPE-06', '물가변동']
] as const;

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

function lifecycleClass(status: Lifecycle | ReferenceInventory['approvalStatus']): string {
  return `p08-badge p08-badge--${status.toLowerCase().replace('_', '-')}`;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export const ReportTemplateCatalog: React.FC<ReportTemplateCatalogProps> = ({ routeId, roles, onNavigate }) => {
  const isAdmin = roles.includes('admin');
  const isApprover = roles.some((role) => role === 'ceo' || role === 'director');
  const canCreateInstance = roles.some((role) => ['admin', 'ceo', 'director', 'pm'].includes(role));

  const [selectedType, setSelectedType] = useState('TYPE-01');
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [activeCounts, setActiveCounts] = useState<Record<string, number>>({});
  const [availability, setAvailability] = useState('MIXED');
  const [blocks, setBlocks] = useState<BlockDefinition[]>([]);
  const [references, setReferences] = useState<ReferenceInventory[]>([]);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [code, setCode] = useState('RPT-TYPE01-001');
  const [name, setName] = useState('현장조사 표준 보고서');
  const [companyForm, setCompanyForm] = useState('컨코스트 표준 보고서 양식');
  const [primaryType, setPrimaryType] = useState('TYPE-01');
  const [secondaryTypesText, setSecondaryTypesText] = useState('');
  const [tocText, setTocText] = useState('검토 개요, 결론');
  const [requiredText, setRequiredText] = useState('검토 개요, 결론');
  const [evidenceText, setEvidenceText] = useState('계약서 사본 확인');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [catalog, blockResult, referenceResult, caseResult] = await Promise.all([
        apiRequest<{ templates: ReportTemplate[]; activeCounts: Record<string, number>; availability: string }>(
          `/api/report-templates?claimType=${encodeURIComponent(selectedType)}`
        ),
        apiRequest<{ blocks: BlockDefinition[] }>('/api/block-definitions'),
        apiRequest<{ inventory: ReferenceInventory[] }>('/api/reference-inventories'),
        apiRequest<{ cases: CaseRecord[] }>('/api/cases?limit=100')
      ]);
      setTemplates(catalog.templates);
      setActiveCounts(catalog.activeCounts);
      setAvailability(catalog.availability);
      setBlocks(blockResult.blocks);
      setReferences(referenceResult.inventory);
      setCases(caseResult.cases);
      const firstTemplate = catalog.templates[0];
      setSelectedTemplateId((current) => catalog.templates.some((item) => item.id === current) ? current : firstTemplate?.id ?? '');
      const availableVersions = firstTemplate?.versions ?? [];
      setSelectedVersionId((current) => availableVersions.some((item) => item.id === current) ? current : availableVersions[0]?.id ?? '');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [selectedType]);

  useEffect(() => { void load(); }, [load]);

  const selectedTemplate = templates.find((item) => item.id === selectedTemplateId) ?? templates[0];
  const selectedVersion = selectedTemplate?.versions.find((item) => item.id === selectedVersionId) ?? selectedTemplate?.versions[0];
  const primaryMapping = selectedVersion?.typeMappings.find((mapping) => mapping.kind === 'PRIMARY');
  const eligibleCases = useMemo(
    () => cases.filter((item) => item.claimType === primaryMapping?.typeId),
    [cases, primaryMapping?.typeId]
  );

  useEffect(() => {
    if (!eligibleCases.some((item) => item.id === selectedCaseId)) setSelectedCaseId(eligibleCases[0]?.id ?? '');
  }, [eligibleCases, selectedCaseId]);

  const handleApiError = (reason: unknown): void => {
    if (reason instanceof ApiError && reason.status === 409) {
      setError(`409 변경 충돌: ${reason.message}. 최신 데이터를 다시 불러왔습니다.`);
      void load();
      return;
    }
    if (reason instanceof ApiError && reason.status === 403) {
      setError(`403 권한 없음: ${reason.message}`);
      return;
    }
    setError(errorMessage(reason));
  };

  const draftPayload = (): Record<string, unknown> => {
    const toc = tocText.split(',').map((item) => item.trim()).filter(Boolean);
    const requiredSections = requiredText.split(',').map((item) => item.trim()).filter(Boolean);
    const requiredEvidenceRules = evidenceText.split(',').map((item) => item.trim()).filter(Boolean);
    const secondaryTypes = secondaryTypesText.split(',').map((item) => item.trim()).filter(Boolean);
    const blockSchemas = Object.fromEntries(toc.map((title, index) => [
      title,
      { blockCode: index === toc.length - 1 ? 'conclusion' : index === 0 ? 'executive-summary' : 'fact-relation', config: {} }
    ]));
    return {
      code,
      name,
      description: 'TPL-01에서 생성한 조직 표준 보고서 템플릿',
      companyForm,
      primaryType,
      secondaryTypes,
      tocStructure: toc,
      requiredSections,
      requiredEvidenceRules,
      blockSchemas,
      referenceFileIds: []
    };
  };

  const createTemplate = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusyAction('create');
    setError('');
    setNotice('');
    try {
      await apiRequest('/api/report-templates', {
        method: 'POST',
        body: JSON.stringify(draftPayload())
      });
      setSelectedType(primaryType);
      setNotice('DRAFT 템플릿을 만들었습니다. 작성자와 다른 CEO/Director가 승인해야 합니다.');
      await load();
    } catch (reason) {
      handleApiError(reason);
    } finally {
      setBusyAction('');
    }
  };

  const copySelectedVersionToEditor = (): void => {
    if (!selectedTemplate || !selectedVersion) return;
    setCode(selectedTemplate.code);
    setName(selectedVersion.name);
    setCompanyForm(selectedVersion.companyForm);
    setPrimaryType(primaryMapping?.typeId ?? 'TYPE-01');
    setSecondaryTypesText(selectedVersion.typeMappings.filter((item) => item.kind === 'SECONDARY').map((item) => item.typeId).join(', '));
    setTocText(parseStringArray(selectedVersion.tocStructureJson).join(', '));
    setRequiredText(parseStringArray(selectedVersion.requiredSectionsJson).join(', '));
    setEvidenceText(parseStringArray(selectedVersion.requiredEvidenceRulesJson).join(', '));
    setNotice('선택한 불변 버전을 편집 폼에 복사했습니다. 원본 버전은 바뀌지 않으며 저장 시 새 DRAFT 버전이 생성됩니다.');
  };

  const createVersion = async (): Promise<void> => {
    if (!selectedTemplate) return;
    setBusyAction('version');
    setError('');
    setNotice('');
    try {
      await apiRequest(`/api/report-templates/${encodeURIComponent(selectedTemplate.id)}/versions`, {
        method: 'POST',
        body: JSON.stringify({ ...draftPayload(), expectedTemplateVersion: selectedTemplate.version })
      });
      setNotice('기존 버전을 수정하지 않고 새 불변 DRAFT 버전을 만들었습니다. 별도 승인 후 활성화할 수 있습니다.');
      await load();
    } catch (reason) {
      handleApiError(reason);
    } finally {
      setBusyAction('');
    }
  };

  const changeLifecycle = async (action: 'approve' | 'activate' | 'archive'): Promise<void> => {
    if (!selectedTemplate || !selectedVersion) return;
    setBusyAction(action);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/api/report-templates/${encodeURIComponent(selectedTemplate.id)}/versions/${encodeURIComponent(selectedVersion.id)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ expectedRowVersion: selectedVersion.rowVersion })
      });
      setNotice(action === 'approve' ? '사람 승인이 기록되었습니다.' : action === 'activate' ? '해당 유형의 ACTIVE 버전을 전환했습니다.' : '버전을 보관 처리했습니다.');
      await load();
    } catch (reason) {
      handleApiError(reason);
    } finally {
      setBusyAction('');
    }
  };

  const approveReference = async (reference: ReferenceInventory): Promise<void> => {
    setBusyAction(reference.fileId);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/api/reference-inventories/${encodeURIComponent(reference.fileId)}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision: 'HUMAN_APPROVE', expectedVersion: reference.version })
      });
      setNotice(`${reference.fileId}의 사람 검토 승인을 기록했습니다.`);
      await load();
    } catch (reason) {
      handleApiError(reason);
    } finally {
      setBusyAction('');
    }
  };

  const createInstance = async (): Promise<void> => {
    if (!selectedVersion || !selectedCaseId) return;
    const target = cases.find((item) => item.id === selectedCaseId);
    if (!target) return;
    setBusyAction('instance');
    setError('');
    setNotice('');
    try {
      const result = await apiRequest<{ caseVersion: number; instance: { id: string; snapshotSha256: string }; report: { id: string } }>(
        `/api/cases/${encodeURIComponent(target.id)}/report-instances`,
        {
          method: 'POST',
          body: JSON.stringify({ templateVersionId: selectedVersion.id, expectedCaseVersion: target.version })
        }
      );
      setCases((current) => current.map((item) => item.id === target.id ? { ...item, version: result.caseVersion } : item));
      setNotice(`사건 보고서 snapshot을 생성했습니다: ${result.instance.id} / SHA-256 ${result.instance.snapshotSha256.slice(0, 12)}…`);
      onNavigate?.(`/cases/${encodeURIComponent(target.id)}/reports/${encodeURIComponent(result.report.id)}/studio`);
    } catch (reason) {
      handleApiError(reason);
    } finally {
      setBusyAction('');
    }
  };

  const chooseTemplate = (template: ReportTemplate): void => {
    setSelectedTemplateId(template.id);
    setSelectedVersionId(template.versions[0]?.id ?? '');
  };

  return (
    <div className="p08-catalog" data-route-id={routeId}>
      <div className="p08-toolbar">
        <div>
          <h3>보고서 템플릿·블록 카탈로그</h3>
          <p className="muted">정확히 6개 클레임 유형과 사람 승인된 불변 버전만 사건 보고서 snapshot으로 사용합니다.</p>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>새로고침</Button>
      </div>

      <div className="p08-type-tabs" role="tablist" aria-label="클레임 유형 필터">
        {CLAIM_TYPES.map(([typeId, label]) => (
          <button
            key={typeId}
            type="button"
            role="tab"
            aria-selected={selectedType === typeId}
            className={selectedType === typeId ? 'p08-type-tab is-selected' : 'p08-type-tab'}
            onClick={() => setSelectedType(typeId)}
          >
            <strong>{typeId}</strong>
            <span>{label}</span>
            <small>ACTIVE {activeCounts[typeId] ?? 0}</small>
          </button>
        ))}
      </div>

      {error && <div className="p08-alert p08-alert--error" role="alert">{error}</div>}
      {notice && <div className="p08-alert p08-alert--success" role="status">{notice}</div>}
      {loading && <div className="p08-skeleton" role="status" aria-live="polite">템플릿 카탈로그를 불러오는 중입니다…</div>}

      {!loading && selectedType === 'TYPE-05' && (
        <Card title="TYPE-05 · TEMPLATE_NOT_FOUND">
          <div className="p08-empty-state" role="status">
            <strong>사감정보고서 전용 템플릿이 아직 확보되지 않았습니다.</strong>
            <p>다른 유형의 템플릿을 자동 추천·대체·fallback하지 않습니다.</p>
            <p>검토 요청 경로: 템플릿 검토 대기열 → 원본 확보 → 사람 검토 → 별도 DRAFT 작성</p>
            <span className={lifecycleClass('REVIEW_REQUIRED')}>REVIEW_REQUIRED</span>
          </div>
        </Card>
      )}

      {!loading && selectedType !== 'TYPE-05' && availability === 'TEMPLATE_NOT_FOUND' && templates.length === 0 && (
        <div className="p08-empty-state" role="status">
          이 유형에 사용할 ACTIVE 템플릿이 없습니다. Admin이 DRAFT를 작성하고 CEO/Director가 승인·활성화해야 합니다.
        </div>
      )}

      {!loading && templates.length > 0 && (
        <div className="p08-layout">
          <aside className="p08-template-list" aria-label="템플릿 목록">
            {templates.map((template) => (
              <button
                type="button"
                key={template.id}
                className={selectedTemplate?.id === template.id ? 'p08-template-option is-selected' : 'p08-template-option'}
                onClick={() => chooseTemplate(template)}
              >
                <span className="text-ellipsis" title={template.name}>{template.name}</span>
                <small>{template.code} · 버전 {template.versions.length}개</small>
              </button>
            ))}
          </aside>

          {selectedTemplate && selectedVersion && (
            <main className="p08-template-detail" aria-labelledby="p08-template-title">
              <div className="p08-toolbar">
                <div>
                  <h4 id="p08-template-title">{selectedTemplate.name}</h4>
                  <p>{selectedTemplate.code} · v{selectedVersion.versionNumber} · row {selectedVersion.rowVersion}</p>
                </div>
                <span className={lifecycleClass(selectedVersion.status)}>{selectedVersion.status}</span>
              </div>

              <Select
                label="버전 선택"
                value={selectedVersion.id}
                options={selectedTemplate.versions.map((version) => ({
                  value: version.id,
                  label: `v${version.versionNumber} · ${version.status} · ${version.contentSha256.slice(0, 10)}…`
                }))}
                onChange={(event) => setSelectedVersionId(event.target.value)}
              />

              <dl className="p08-facts">
                <div><dt>Primary</dt><dd>{primaryMapping?.typeId ?? '없음'}</dd></div>
                <div><dt>Secondary</dt><dd>{selectedVersion.typeMappings.filter((item) => item.kind === 'SECONDARY').map((item) => item.typeId).join(', ') || '없음'}</dd></div>
                <div><dt>작성자</dt><dd>{selectedVersion.createdBy?.name ?? '확인 불가'}</dd></div>
                <div><dt>승인자</dt><dd>{selectedVersion.approvedBy?.name ?? '미승인'}</dd></div>
                <div><dt>Snapshot hash</dt><dd><code>{selectedVersion.contentSha256}</code></dd></div>
              </dl>

              <section aria-labelledby="p08-toc-title">
                <h5 id="p08-toc-title">목차·필수 장 미리보기</h5>
                <ol className="p08-toc">
                  {selectedVersion.sections.map((section) => (
                    <li key={section.id}>
                      <span>{section.sectionNumber}. {section.title}</span>
                      {section.isRequired && <strong>필수</strong>}
                    </li>
                  ))}
                </ol>
                <p><strong>필수 자료 규칙:</strong> {parseStringArray(selectedVersion.requiredEvidenceRulesJson).join(', ')}</p>
              </section>

              <section aria-labelledby="p08-ref-title">
                <h5 id="p08-ref-title">익명 reference provenance</h5>
                {selectedVersion.references.length === 0 ? <p className="muted">연결된 reference 없음</p> : (
                  <ul className="p08-reference-list">
                    {selectedVersion.references.map((reference) => (
                      <li key={reference.fileIdSnapshot}>
                        <strong>{reference.fileIdSnapshot}</strong>
                        <code>{reference.sha256Snapshot.slice(0, 16)}…</code>
                        <span>{reference.fileSizeSnapshot.toLocaleString()} bytes</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="action-row" aria-label="템플릿 생명주기 작업">
                {isApprover && selectedVersion.status === 'DRAFT' && (
                  <Button onClick={() => void changeLifecycle('approve')} isLoading={busyAction === 'approve'}>사람 승인</Button>
                )}
                {isApprover && selectedVersion.status === 'HUMAN_APPROVED' && (
                  <Button onClick={() => void changeLifecycle('activate')} isLoading={busyAction === 'activate'}>ACTIVE 전환</Button>
                )}
                {isApprover && selectedVersion.status === 'ACTIVE' && (
                  <Button variant="secondary" onClick={() => void changeLifecycle('archive')} isLoading={busyAction === 'archive'}>ARCHIVED 전환</Button>
                )}
              </div>

              {canCreateInstance && selectedVersion.status === 'ACTIVE' && (
                <section className="p08-instance-panel" aria-labelledby="p08-instance-title">
                  <h5 id="p08-instance-title">사건에 불변 보고서 snapshot 생성</h5>
                  {eligibleCases.length === 0 ? <p role="status">이 템플릿 Primary 유형과 일치하는 접근 가능 사건이 없습니다.</p> : (
                    <>
                      <Select
                        label="대상 사건"
                        value={selectedCaseId}
                        options={eligibleCases.map((item) => ({
                          value: item.id,
                          label: `${item.caseNumber} · ${item.title} · v${item.version}`
                        }))}
                        onChange={(event) => setSelectedCaseId(event.target.value)}
                      />
                      <Button onClick={() => void createInstance()} isLoading={busyAction === 'instance'}>ReportInstance 생성</Button>
                    </>
                  )}
                </section>
              )}
            </main>
          )}
        </div>
      )}

      {isAdmin && (
        <details className="p08-admin-panel">
          <summary>Admin · 새 DRAFT 템플릿 만들기</summary>
          <form className="form-stack" onSubmit={(event) => void createTemplate(event)}>
            <Input label="템플릿 코드" value={code} onChange={(event) => setCode(event.target.value)} required />
            <Input label="템플릿 이름" value={name} onChange={(event) => setName(event.target.value)} required />
            <Input label="회사 표준 양식 설명" value={companyForm} onChange={(event) => setCompanyForm(event.target.value)} required />
            <Select
              label="Primary 유형"
              value={primaryType}
              options={CLAIM_TYPES.filter(([typeId]) => typeId !== 'TYPE-05').map(([value, label]) => ({ value, label: `${value} · ${label}` }))}
              onChange={(event) => setPrimaryType(event.target.value)}
            />
            <Input label="Secondary 유형(쉼표 구분)" value={secondaryTypesText} onChange={(event) => setSecondaryTypesText(event.target.value)} placeholder="TYPE-02, TYPE-03" />
            <Input label="목차(쉼표 구분)" value={tocText} onChange={(event) => setTocText(event.target.value)} required />
            <Input label="필수 장(쉼표 구분)" value={requiredText} onChange={(event) => setRequiredText(event.target.value)} required />
            <Input label="필수 자료 규칙(쉼표 구분)" value={evidenceText} onChange={(event) => setEvidenceText(event.target.value)} required />
            <div className="action-row">
              <Button type="submit" isLoading={busyAction === 'create'}>새 템플릿 DRAFT 생성</Button>
              {selectedTemplate && selectedVersion && (
                <>
                  <Button type="button" variant="secondary" onClick={copySelectedVersionToEditor}>선택 버전을 편집 폼으로 복사</Button>
                  <Button type="button" onClick={() => void createVersion()} isLoading={busyAction === 'version'}>새 버전 DRAFT 생성</Button>
                </>
              )}
            </div>
          </form>
        </details>
      )}

      <details className="p08-reference-panel">
        <summary>Reference 검토 대기열 · {references.length}개</summary>
        <p className="muted">실제 경로·파일명·본문은 표시하지 않습니다. 익명 fileId, SHA-256, 크기, 스캔/승인 상태만 사용합니다.</p>
        <div className="p08-reference-grid">
          {references.map((reference) => (
            <article key={reference.fileId}>
              <div className="p08-toolbar">
                <strong>{reference.fileId}</strong>
                <span className={lifecycleClass(reference.approvalStatus)}>{reference.approvalStatus}</span>
              </div>
              <code>{reference.sha256.slice(0, 16)}…</code>
              <small>{reference.fileSize.toLocaleString()} bytes · {reference.scanStatus} · v{reference.version}</small>
              {isApprover && reference.scanStatus === 'SCANNED' && reference.approvalStatus !== 'HUMAN_APPROVED' && (
                <Button size="sm" onClick={() => void approveReference(reference)} isLoading={busyAction === reference.fileId}>사람 검토 승인</Button>
              )}
              {reference.scanStatus === 'UNSCANNED' && <small>UNSCANNED 파일은 승인할 수 없습니다.</small>}
            </article>
          ))}
        </div>
      </details>

      <section aria-labelledby="p08-block-title">
        <h4 id="p08-block-title">표준 블록 카탈로그 · {blocks.length}개</h4>
        <div className="p08-block-grid">
          {blocks.map((block) => (
            <Card key={block.id} title={block.name}>
              <code>{block.code} · v{block.version}</code>
              <p>{block.description}</p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
};
