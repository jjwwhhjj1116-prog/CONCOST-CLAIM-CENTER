import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@claim-studio/ui';
import { ApiError, apiRequest } from '../api';
import { CaseEvidencePanel } from '../evidence/CaseEvidencePanel';
import { WORKFLOW_STAGES, WORKFORCE_UNITS } from './workflow-model';

type WorkflowRouteId = 'WF-03' | 'WF-04' | 'WF-05';

interface CaseSummary {
  id: string;
  caseNumber: string;
  title: string;
  claimType: string;
  status: string;
  version: number;
}

interface KickoffRecord {
  meetingAt: string;
  location: string | null;
  agenda: string;
  participantUnits: string[];
  rawNotes: string;
  summaryText: string;
  timeline: Array<{ order: number; title: string; detail: string }>;
  status: string;
  version: number;
  updatedAt: string;
  updatedByName: string;
}

interface SurveyRecord {
  id: string;
  surveyDate: string;
  location: string | null;
  scopeText: string;
  leadUnit: string;
  folderPath: string;
  photoCount: number;
  audioCount: number;
  documentCount: number;
  status: string;
  version: number;
}

interface AllocationRecord {
  id: string;
  unitKey: string;
  unitLabel: string;
  office: 'CONCOST' | 'VIETQS';
  schedulingMode: 'PERSON' | 'TEAM';
  discipline: string;
  scopeText: string;
  basisText: string;
  startDate: string;
  endDate: string;
  createdAt: string;
  createdByName: string;
}

interface WorkflowPayload {
  case: CaseSummary;
  kickoff: KickoffRecord | null;
  siteSurveys: SurveyRecord[];
  allocations: AllocationRecord[];
  events: Array<{ id: string; eventType: string; createdAt: string; actorName: string }>;
  googleDrive: { connected: boolean; deferredByUser: boolean; uploadEnabled: boolean };
}

const stageRoute: Record<WorkflowRouteId, 3 | 4 | 5> = { 'WF-03': 3, 'WF-04': 4, 'WF-05': 5 };
const WORKFORCE_OPTIONS = WORKFORCE_UNITS
  .filter((unit) => unit.discipline !== '클레임')
  .map((unit, index) => ({
    ...unit,
    key: `${unit.organization.toLowerCase()}-${String(index + 1).padStart(2, '0')}`,
    disciplineCode: unit.discipline === '마감' ? 'FINISH' : unit.discipline === '구조' ? 'STRUCTURE' : 'CIVIL_LANDSCAPE'
  }));

function kstToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function localDateTime(value?: string): string {
  if (!value) return `${kstToday()}T10:00`;
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}T${read('hour')}:${read('minute')}`;
}

function messageFrom(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) return '다른 화면에서 먼저 변경했습니다. 최신 데이터를 다시 불러온 뒤 시도해 주세요.';
  if (error instanceof ApiError && error.status === 403) return '이 프로젝트를 수정할 권한이 없습니다.';
  return error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
}

export const WorkflowOperations: React.FC<{
  routeId: WorkflowRouteId;
  roles: readonly string[];
  onNavigate: (path: string) => void;
}> = ({ routeId, roles, onNavigate }) => {
  const stageId = stageRoute[routeId];
  const stage = WORKFLOW_STAGES.find((entry) => entry.id === stageId)!;
  const canEdit = roles.some((role) => ['admin', 'ceo', 'director', 'pm', 'staff'].includes(role));
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState(new URLSearchParams(window.location.search).get('caseId') ?? '');
  const selectedCaseRef = useRef(selectedCaseId);
  const [data, setData] = useState<WorkflowPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const allocationKeys = useRef(new Map<string, string>());

  const [kickoff, setKickoff] = useState({
    meetingAt: `${kstToday()}T10:00`, location: '', agenda: '', participantUnits: '', rawNotes: '', status: 'PLANNED', expectedVersion: 0
  });
  const [survey, setSurvey] = useState({
    surveyDate: kstToday(), location: '', scopeText: '', leadUnit: '현장조사팀', status: 'PLANNED', expectedVersion: 0
  });
  const [allocation, setAllocation] = useState({
    unitKey: WORKFORCE_OPTIONS[0]?.key ?? '', scopeText: '', basisText: '설계도서·현장실측', startDate: kstToday(), endDate: kstToday()
  });

  const selectedUnit = useMemo(() => WORKFORCE_OPTIONS.find((unit) => unit.key === allocation.unitKey) ?? WORKFORCE_OPTIONS[0], [allocation.unitKey]);

  const syncForms = (payload: WorkflowPayload) => {
    if (payload.kickoff) setKickoff({
      meetingAt: localDateTime(payload.kickoff.meetingAt),
      location: payload.kickoff.location ?? '',
      agenda: payload.kickoff.agenda,
      participantUnits: payload.kickoff.participantUnits.join(', '),
      rawNotes: payload.kickoff.rawNotes,
      status: payload.kickoff.status,
      expectedVersion: payload.kickoff.version
    });
    else setKickoff({ meetingAt: `${kstToday()}T10:00`, location: '', agenda: '', participantUnits: '', rawNotes: '', status: 'PLANNED', expectedVersion: 0 });
    const latestSurvey = payload.siteSurveys[0];
    if (latestSurvey) setSurvey({
      surveyDate: latestSurvey.surveyDate, location: latestSurvey.location ?? '', scopeText: latestSurvey.scopeText,
      leadUnit: latestSurvey.leadUnit, status: latestSurvey.status, expectedVersion: latestSurvey.version
    });
    else setSurvey({ surveyDate: kstToday(), location: '', scopeText: '', leadUnit: '현장조사팀', status: 'PLANNED', expectedVersion: 0 });
  };

  const loadWorkflow = async (caseId: string, sync = true) => {
    const requestCaseId = caseId;
    if (!requestCaseId || requestCaseId !== selectedCaseRef.current) return;
    setLoading(true);
    setFailure('');
    try {
      const payload = await apiRequest<WorkflowPayload>(`/api/cases/${encodeURIComponent(requestCaseId)}/workflow`);
      if (requestCaseId !== selectedCaseRef.current) return;
      setData(payload);
      if (sync) syncForms(payload);
    } catch (error) {
      if (requestCaseId === selectedCaseRef.current) setFailure(messageFrom(error));
    } finally {
      if (requestCaseId === selectedCaseRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    apiRequest<{ cases: CaseSummary[] }>('/api/cases?limit=100').then((response) => {
      if (!active) return;
      setCases(response.cases);
      const requested = selectedCaseRef.current;
      const first = response.cases.find((entry) => entry.id === requested)?.id ?? response.cases[0]?.id ?? '';
      selectedCaseRef.current = first;
      setSelectedCaseId(first);
      if (first) void loadWorkflow(first);
      else setLoading(false);
    }).catch((error) => {
      if (active) { setFailure(messageFrom(error)); setLoading(false); }
    });
    return () => { active = false; };
  }, []);

  const selectCase = (caseId: string) => {
    if (busy) return;
    selectedCaseRef.current = caseId;
    setSelectedCaseId(caseId);
    setData(null);
    setNotice('');
    setFailure('');
    void loadWorkflow(caseId);
  };

  const mutate = async (label: string, work: () => Promise<WorkflowPayload>) => {
    if (!selectedCaseId || selectedCaseId !== selectedCaseRef.current || !canEdit) return;
    setBusy(label);
    setFailure('');
    setNotice('');
    try {
      const payload = await work();
      if (selectedCaseId !== selectedCaseRef.current) return;
      setData(payload);
      syncForms(payload);
      setNotice(`${label} 완료 · D1에 저장되었습니다.`);
    } catch (error) {
      setFailure(messageFrom(error));
    } finally {
      if (selectedCaseId === selectedCaseRef.current) setBusy('');
    }
  };

  const saveKickoff = () => mutate('착수회의 저장', () => apiRequest<WorkflowPayload>(`/api/cases/${encodeURIComponent(selectedCaseId)}/workflow/kickoff`, {
    method: 'PUT',
    body: JSON.stringify({
      ...kickoff,
      meetingAt: new Date(kickoff.meetingAt).toISOString(),
      participantUnits: kickoff.participantUnits.split(',').map((entry) => entry.trim()).filter(Boolean)
    })
  }));

  const generateSummary = () => mutate('회의록·타임라인 초안 생성', () => apiRequest<WorkflowPayload>(`/api/cases/${encodeURIComponent(selectedCaseId)}/workflow/kickoff-summary`, {
    method: 'POST', body: JSON.stringify({ expectedVersion: kickoff.expectedVersion })
  }));

  const saveSurvey = () => mutate('현장조사 계획 저장', () => apiRequest<WorkflowPayload>(`/api/cases/${encodeURIComponent(selectedCaseId)}/workflow/site-survey`, {
    method: 'PUT', body: JSON.stringify(survey)
  }));

  const saveAllocation = () => {
    if (!selectedUnit) return;
    const payload = {
      unitKey: selectedUnit.key, unitLabel: selectedUnit.unit, office: selectedUnit.organization,
      schedulingMode: selectedUnit.schedulingMode, discipline: selectedUnit.disciplineCode,
      scopeText: allocation.scopeText, basisText: allocation.basisText, startDate: allocation.startDate, endDate: allocation.endDate
    };
    const fingerprint = JSON.stringify(payload);
    const key = allocationKeys.current.get(fingerprint) ?? `workflow-${crypto.randomUUID()}`;
    allocationKeys.current.set(fingerprint, key);
    return mutate('팀 투입 일정 저장', () => apiRequest<WorkflowPayload>(`/api/cases/${encodeURIComponent(selectedCaseId)}/workflow/allocations`, {
      method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload)
    }));
  };

  return (
    <section className="workflow-operations" aria-labelledby="workflow-operations-title">
      <header className="workflow-operations-hero" style={{ '--stage-color': stage.color } as React.CSSProperties}>
        <div><span>PROJECT DELIVERY · STEP {stageId}</span><h2 id="workflow-operations-title">{stage.name}</h2><p>{stage.description}</p></div>
        <div className="workflow-save-state"><strong>D1 LIVE WORKSPACE</strong><span>입력값·변경 이력 자동 보존</span></div>
      </header>

      <nav className="workflow-stepper" aria-label="프로젝트 6단계">
        {WORKFLOW_STAGES.map((entry) => <button key={entry.id} className={entry.id === stageId ? 'is-active' : ''} onClick={() => onNavigate(entry.path)}><span>{entry.id}</span>{entry.name}</button>)}
      </nav>

      <div className="workflow-project-selector">
        <label htmlFor="workflow-case">현재 프로젝트</label>
        <select id="workflow-case" value={selectedCaseId} disabled={Boolean(busy)} onChange={(event) => selectCase(event.target.value)}>
          {cases.map((entry) => <option key={entry.id} value={entry.id}>{entry.caseNumber} · {entry.title}</option>)}
        </select>
        {data && <span>{data.case.claimType} · {data.case.status}</span>}
      </div>

      {loading && <div className="workflow-feedback">프로젝트 업무 데이터를 불러오는 중입니다.</div>}
      {failure && <div className="workflow-feedback is-error" role="alert"><strong>처리하지 못했습니다.</strong><span>{failure}</span><Button size="sm" variant="secondary" onClick={() => void loadWorkflow(selectedCaseId)}>다시 불러오기</Button></div>}
      {notice && <div className="workflow-feedback is-success" role="status">{notice}</div>}

      {!loading && data && stageId === 3 && <KickoffEditor form={kickoff} setForm={setKickoff} record={data.kickoff} disabled={!canEdit || Boolean(busy)} onSave={saveKickoff} onGenerate={generateSummary} busy={busy} />}
      {!loading && data && stageId === 4 && <SurveyEditor form={survey} setForm={setSurvey} surveys={data.siteSurveys} drive={data.googleDrive} disabled={!canEdit || Boolean(busy)} onSave={saveSurvey} busy={busy} />}
      {!loading && data && stageId === 5 && <AllocationEditor caseId={selectedCaseId} form={allocation} setForm={setAllocation} allocations={data.allocations} disabled={!canEdit || Boolean(busy)} onSave={saveAllocation} busy={busy} onNavigate={onNavigate} />}
    </section>
  );
};

const KickoffEditor: React.FC<{
  form: { meetingAt: string; location: string; agenda: string; participantUnits: string; rawNotes: string; status: string; expectedVersion: number };
  setForm: React.Dispatch<React.SetStateAction<{ meetingAt: string; location: string; agenda: string; participantUnits: string; rawNotes: string; status: string; expectedVersion: number }>>;
  record: KickoffRecord | null;
  disabled: boolean;
  busy: string;
  onSave: () => void;
  onGenerate: () => void;
}> = ({ form, setForm, record, disabled, busy, onSave, onGenerate }) => (
  <div className="workflow-editor-grid">
    <article className="workflow-editor-card">
      <header><div><span>KICKOFF INTAKE</span><h3>착수회의 기록</h3></div><em>v{form.expectedVersion}</em></header>
      <div className="workflow-form-grid">
        <label>회의 일시<input type="datetime-local" value={form.meetingAt} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, meetingAt: event.target.value }))} /></label>
        <label>회의 상태<select value={form.status} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option value="PLANNED">진행 예정</option><option value="COMPLETED">진행 완료</option><option value="DRAFTED">회의록 초안</option><option value="CONFIRMED">확정</option></select></label>
        <label className="is-wide">장소<input value={form.location} maxLength={300} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} placeholder="본사 회의실 또는 온라인 링크" /></label>
        <label className="is-wide">회의 안건<textarea value={form.agenda} maxLength={12000} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, agenda: event.target.value }))} placeholder="업무 범위, 현장 일정, 산출 기준, 고객 요청" /></label>
        <label className="is-wide">참석 팀·담당자<input value={form.participantUnits} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, participantUnits: event.target.value }))} placeholder="쉼표로 구분" /></label>
        <label className="is-wide">회의 메모·녹취 텍스트<textarea className="is-tall" value={form.rawNotes} maxLength={50000} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, rawNotes: event.target.value }))} placeholder="녹음 전사문 또는 회의 중 메모를 입력하세요." /></label>
      </div>
      <div className="workflow-actions"><Button disabled={disabled || !form.agenda.trim()} onClick={onSave}>{busy === '착수회의 저장' ? '저장 중…' : '착수회의 저장'}</Button><Button variant="secondary" disabled={disabled || !record?.rawNotes.trim()} onClick={onGenerate}>{busy === '회의록·타임라인 초안 생성' ? '생성 중…' : '회의록·타임라인 초안'}</Button></div>
      <p className="workflow-honest-note">현재는 외부 AI 전송 없이 D1의 회의 메모를 구조화하는 초안입니다. AI 공급자 연결 후 근거 인용형 회의록으로 교체됩니다.</p>
    </article>
    <article className="workflow-editor-card is-output">
      <header><div><span>MINUTES & TIMELINE</span><h3>회의록·후속 업무 초안</h3></div><em>{record?.status ?? 'EMPTY'}</em></header>
      {record?.summaryText ? <><pre className="workflow-summary-text">{record.summaryText}</pre><ol className="workflow-timeline">{record.timeline.map((item) => <li key={`${item.order}-${item.detail}`}><span>{item.order}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div></li>)}</ol></> : <div className="workflow-empty"><strong>아직 생성된 초안이 없습니다.</strong><p>회의 메모를 저장한 뒤 초안을 생성하세요.</p></div>}
    </article>
  </div>
);

const SurveyEditor: React.FC<{
  form: { surveyDate: string; location: string; scopeText: string; leadUnit: string; status: string; expectedVersion: number };
  setForm: React.Dispatch<React.SetStateAction<{ surveyDate: string; location: string; scopeText: string; leadUnit: string; status: string; expectedVersion: number }>>;
  surveys: SurveyRecord[];
  drive: WorkflowPayload['googleDrive'];
  disabled: boolean;
  busy: string;
  onSave: () => void;
}> = ({ form, setForm, surveys, drive, disabled, busy, onSave }) => (
  <div className="workflow-editor-grid">
    <article className="workflow-editor-card">
      <header><div><span>SITE SURVEY PLAN</span><h3>현장조사 계획·원본 분류</h3></div><em>v{form.expectedVersion}</em></header>
      <div className="workflow-form-grid">
        <label>조사 일자<input type="date" value={form.surveyDate} disabled={disabled || form.expectedVersion > 0} onChange={(event) => setForm((current) => ({ ...current, surveyDate: event.target.value, expectedVersion: 0 }))} /></label>
        <label>진행 상태<select value={form.status} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option value="PLANNED">예정</option><option value="IN_PROGRESS">진행 중</option><option value="COMPLETED">완료</option></select></label>
        <label className="is-wide">현장 위치<input value={form.location} maxLength={300} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} /></label>
        <label className="is-wide">조사 범위<textarea value={form.scopeText} maxLength={12000} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, scopeText: event.target.value }))} placeholder="동·층·부위, 하자·기시공·미시공 구분, 조사 제외 범위" /></label>
        <label className="is-wide">조사 책임 팀<input value={form.leadUnit} maxLength={120} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, leadUnit: event.target.value }))} /></label>
      </div>
      <Button disabled={disabled || !form.scopeText.trim()} onClick={onSave}>{busy === '현장조사 계획 저장' ? '저장 중…' : '현장조사 계획 저장'}</Button>
      <div className="workflow-dropzone is-disabled" aria-disabled="true"><strong>사진·녹음·도면 드래그 앤 드롭</strong><span>{drive.deferredByUser ? 'Google Drive 연결을 보류하여 파일 전송은 비활성화했습니다.' : 'Google Drive 연결 후 활성화됩니다.'}</span><small>계획과 폴더명은 지금 D1에 저장되며 원본 업로드는 Drive 연결 단계에서 이어집니다.</small></div>
    </article>
    <article className="workflow-editor-card is-output">
      <header><div><span>FOLDER LEDGER</span><h3>조사일자별 폴더 계획</h3></div><em>{surveys.length}건</em></header>
      {surveys.length ? <div className="survey-list">{surveys.map((item) => <section key={item.id}><div><strong>{item.surveyDate} · {item.leadUnit}</strong><span>{item.location || '위치 미입력'} · {item.status}</span></div><code>{item.folderPath}</code><small>사진 {item.photoCount} · 녹음 {item.audioCount} · 문서 {item.documentCount}</small></section>)}</div> : <div className="workflow-empty"><strong>저장된 현장조사 계획이 없습니다.</strong><p>조사 일자와 범위를 먼저 등록하세요.</p></div>}
    </article>
  </div>
);

const AllocationEditor: React.FC<{
  caseId: string;
  form: { unitKey: string; scopeText: string; basisText: string; startDate: string; endDate: string };
  setForm: React.Dispatch<React.SetStateAction<{ unitKey: string; scopeText: string; basisText: string; startDate: string; endDate: string }>>;
  allocations: AllocationRecord[];
  disabled: boolean;
  busy: string;
  onSave: () => void;
  onNavigate: (path: string) => void;
}> = ({ caseId, form, setForm, allocations, disabled, busy, onSave, onNavigate }) => (
  <div className="workflow-editor-grid">
    <article className="workflow-editor-card">
      <header><div><span>TAKEOFF & RESOURCE PLAN</span><h3>산출 범위·팀 투입 일정</h3></div><em>한국 개인 · 베트남 팀</em></header>
      <div className="workflow-form-grid">
        <label className="is-wide">투입 조직<select value={form.unitKey} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, unitKey: event.target.value }))}>{WORKFORCE_OPTIONS.map((unit) => <option key={unit.key} value={unit.key}>{unit.organization} · {unit.unit} · {unit.size}명 · {unit.schedulingMode === 'TEAM' ? '팀 일정' : '인원 일정'}</option>)}</select></label>
        <label className="is-wide">산출 범위<textarea value={form.scopeText} maxLength={12000} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, scopeText: event.target.value }))} placeholder="도면·동·공종·산출 제외 범위를 구체적으로 입력" /></label>
        <label className="is-wide">산출 기준<textarea value={form.basisText} maxLength={12000} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, basisText: event.target.value }))} placeholder="설계도서, 현장실측, 계약내역, 감정 기준" /></label>
        <label>시작일<input type="date" value={form.startDate} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} /></label>
        <label>종료일<input type="date" value={form.endDate} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} /></label>
      </div>
      <Button disabled={disabled || !form.scopeText.trim() || !form.basisText.trim() || form.endDate < form.startDate} onClick={onSave}>{busy === '팀 투입 일정 저장' ? '저장 중…' : '프로젝트 일정표에 반영'}</Button>
    </article>
    <article className="workflow-editor-card is-output">
      <header><div><span>ALLOCATION LEDGER</span><h3>프로젝트 투입 현황</h3></div><em>{allocations.length}건</em></header>
      {allocations.length ? <div className="allocation-list">{allocations.map((item) => <section key={item.id}><div className={`allocation-office is-${item.office.toLowerCase()}`}>{item.office}</div><div><strong>{item.unitLabel}</strong><span>{item.schedulingMode === 'TEAM' ? '팀 단위 일정' : '인원 단위 일정'} · {item.startDate} → {item.endDate}</span><p>{item.scopeText}</p><small>{item.basisText} · {item.createdByName}</small></div></section>)}</div> : <div className="workflow-empty"><strong>아직 투입 일정이 없습니다.</strong><p>범위와 기준을 확정한 뒤 팀 일정을 추가하세요.</p></div>}
    </article>
    <article className="workflow-editor-card workflow-evidence-card">
      <header>
        <div><span>PROJECT EVIDENCE INTAKE</span><h3>산출자료·내역자료 업로드</h3></div>
        <em>프로젝트 자료실 자동 연동</em>
      </header>
      <p className="workflow-evidence-intro">도면, 산출서, 내역서 등 원본을 구분해 올리면 현재 프로젝트의 자료실에 즉시 저장됩니다. 업로드 사용자와 일시는 자동 기록됩니다.</p>
      <CaseEvidencePanel caseId={caseId} compact onNavigate={onNavigate} />
    </article>
  </div>
);
