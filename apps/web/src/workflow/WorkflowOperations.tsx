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

type SharedStageCode = 'KICKOFF' | 'SITE_SURVEY' | 'TAKEOFF_COST';

interface SharedScheduleStage {
  stageCode: SharedStageCode | 'PROPOSAL' | 'AWARD' | 'REPORT_WRITING';
  startDate: string | null;
  endDate: string | null;
  scheduleStatus: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'DELAYED';
  scheduleNote: string;
  scheduleVersion: number;
  scheduleExplicit: boolean;
}

interface SharedScheduleProject {
  id: string;
  caseId: string;
  responsiblePm: { id: string; name: string } | null;
  canManageSchedule: boolean;
  stages: SharedScheduleStage[];
}

interface WorkflowAiImport {
  meetingAt: string | null;
  surveyDate: string | null;
  location: string;
  agenda: string;
  participants: string[];
  leadUnit: string;
  sourceNotes: string;
  summary: string;
  timeline: Array<{ order: number; title: string; detail: string }>;
  missingFields: string[];
}

const stageRoute: Record<WorkflowRouteId, 3 | 4 | 5> = { 'WF-03': 3, 'WF-04': 4, 'WF-05': 5 };
const sharedStageCode: Record<WorkflowRouteId, SharedStageCode> = { 'WF-03': 'KICKOFF', 'WF-04': 'SITE_SURVEY', 'WF-05': 'TAKEOFF_COST' };
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
  if (error instanceof ApiError && error.status === 409) return error.message || '다른 사용자가 먼저 변경했습니다. 입력값은 유지되며 최신 데이터를 확인한 뒤 다시 저장할 수 있습니다.';
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
  const initialParams = new URLSearchParams(window.location.search);
  const initialProjectId = initialParams.get('projectId') ?? '';
  const initialCaseId = initialParams.get('caseId') ?? (initialProjectId.startsWith('project-') ? initialProjectId.slice('project-'.length) : '');
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState(initialCaseId);
  const selectedCaseRef = useRef(selectedCaseId);
  const [data, setData] = useState<WorkflowPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const [scheduleProject, setScheduleProject] = useState<SharedScheduleProject | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState({ startDate: '', endDate: '', status: 'PLANNED', noteText: '', version: 0, explicit: false });
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

  const syncSharedSchedule = (projects: SharedScheduleProject[]) => {
    const project = projects.find((entry) => entry.caseId === selectedCaseRef.current) ?? null;
    const item = project?.stages.find((entry) => entry.stageCode === sharedStageCode[routeId]);
    setScheduleProject(project);
    setScheduleDraft({
      startDate: item?.startDate ?? '',
      endDate: item?.endDate ?? '',
      status: item?.scheduleStatus ?? 'PLANNED',
      noteText: item?.scheduleNote ?? '',
      version: item?.scheduleVersion ?? 0,
      explicit: item?.scheduleExplicit ?? false
    });
    if (!item?.startDate || !item.endDate) return;
    if (routeId === 'WF-03') setKickoff((current) => ({ ...current, meetingAt: `${item.startDate}T${current.meetingAt.split('T')[1] ?? '10:00'}` }));
    if (routeId === 'WF-04') setSurvey((current) => ({ ...current, surveyDate: item.startDate ?? current.surveyDate }));
    if (routeId === 'WF-05') setAllocation((current) => ({ ...current, startDate: item.startDate ?? current.startDate, endDate: item.endDate ?? current.endDate }));
  };

  const loadWorkflow = async (caseId: string, sync = true) => {
    const requestCaseId = caseId;
    if (!requestCaseId || requestCaseId !== selectedCaseRef.current) return;
    setLoading(true);
    setFailure('');
    try {
      const [payload, schedule] = await Promise.all([
        apiRequest<WorkflowPayload>(`/api/cases/${encodeURIComponent(requestCaseId)}/workflow`),
        apiRequest<{ projects: SharedScheduleProject[] }>('/api/project-workflow/schedule')
      ]);
      if (requestCaseId !== selectedCaseRef.current) return;
      setData(payload);
      if (sync) syncForms(payload);
      syncSharedSchedule(schedule.projects);
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

  const persistSharedSchedule = async (dates?: { startDate: string; endDate: string }) => {
    if (!scheduleProject) throw new Error('수주 확정된 프로젝트만 기준 일정을 저장할 수 있습니다. 프로젝트 접수에서 먼저 수주 확정해 주세요.');
    if (!scheduleProject.responsiblePm) throw new Error('프로젝트 일정표에서 담당 PM을 먼저 지정해 주세요.');
    if (!scheduleProject.canManageSchedule) throw new Error('기준 일정은 담당 PM 또는 관리자가 직접 저장할 수 있습니다.');
    const startDate = dates?.startDate ?? scheduleDraft.startDate;
    const endDate = dates?.endDate ?? scheduleDraft.endDate;
    if (!startDate || !endDate) throw new Error('시작일과 종료일을 모두 입력해 주세요.');
    if (endDate < startDate) throw new Error('종료일은 시작일보다 빠를 수 없습니다.');
    const result = await apiRequest<{ schedule: { startDate: string; endDate: string; status: string; noteText: string; version: number } }>(
      `/api/project-workflow/projects/${encodeURIComponent(selectedCaseId)}/stages/${sharedStageCode[routeId]}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          startDate,
          endDate,
          status: scheduleDraft.status,
          noteText: scheduleDraft.noteText,
          expectedVersion: scheduleDraft.version
        })
      }
    );
    setScheduleDraft((current) => ({ ...current, startDate: result.schedule.startDate, endDate: result.schedule.endDate, status: result.schedule.status, noteText: result.schedule.noteText, version: result.schedule.version, explicit: true }));
  };

  const saveSharedSchedule = async () => {
    if (!selectedCaseId || busy) return;
    setBusy('기준 일정 저장'); setFailure(''); setNotice('');
    try {
      await persistSharedSchedule();
      setNotice(`${stage.name} 기준 일정 저장 완료 · 프로젝트 일정표와 이 화면에 같은 날짜가 반영되었습니다.`);
    } catch (error) { setFailure(messageFrom(error)); }
    finally { setBusy(''); }
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
      const schedule = await apiRequest<{ projects: SharedScheduleProject[] }>('/api/project-workflow/schedule');
      syncSharedSchedule(schedule.projects);
      setNotice(`${label} 완료 · D1에 저장되었습니다.`);
    } catch (error) {
      setFailure(messageFrom(error));
    } finally {
      if (selectedCaseId === selectedCaseRef.current) setBusy('');
    }
  };

  const saveKickoff = () => mutate('착수회의·기준 일정 저장', async () => {
    const meetingDate = kickoff.meetingAt.slice(0,10);
    await persistSharedSchedule({ startDate: meetingDate, endDate: scheduleDraft.endDate && scheduleDraft.endDate >= meetingDate ? scheduleDraft.endDate : meetingDate });
    return apiRequest<WorkflowPayload>(`/api/cases/${encodeURIComponent(selectedCaseId)}/workflow/kickoff`, {
      method: 'PUT',
      body: JSON.stringify({
        ...kickoff,
        meetingAt: new Date(kickoff.meetingAt).toISOString(),
        participantUnits: kickoff.participantUnits.split(',').map((entry) => entry.trim()).filter(Boolean)
      })
    });
  });

  const generateSummary = () => mutate('Gemini 회의록·타임라인 정리', () => apiRequest<WorkflowPayload>(`/api/cases/${encodeURIComponent(selectedCaseId)}/workflow/kickoff-summary`, {
    method: 'POST', body: JSON.stringify({ expectedVersion: kickoff.expectedVersion })
  }));

  const confirmKickoff = () => mutate('회의록 최종본 확정', () => apiRequest<WorkflowPayload>(`/api/cases/${encodeURIComponent(selectedCaseId)}/workflow/kickoff`, {
    method: 'PUT',
    body: JSON.stringify({
      ...kickoff,
      meetingAt: new Date(kickoff.meetingAt).toISOString(),
      participantUnits: kickoff.participantUnits.split(',').map((entry) => entry.trim()).filter(Boolean),
      status: 'CONFIRMED'
    })
  }));

  const saveSurvey = () => mutate('현장조사·기준 일정 저장', async () => {
    await persistSharedSchedule({ startDate: survey.surveyDate, endDate: scheduleDraft.endDate && scheduleDraft.endDate >= survey.surveyDate ? scheduleDraft.endDate : survey.surveyDate });
    return apiRequest<WorkflowPayload>(`/api/cases/${encodeURIComponent(selectedCaseId)}/workflow/site-survey`, {
      method: 'PUT', body: JSON.stringify(survey)
    });
  });

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
    return mutate('팀 투입·기준 일정 저장', async () => {
      await persistSharedSchedule({ startDate: allocation.startDate, endDate: allocation.endDate });
      return apiRequest<WorkflowPayload>(`/api/cases/${encodeURIComponent(selectedCaseId)}/workflow/allocations`, {
        method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload)
      });
    });
  };

  return (
    <section className="workflow-operations" aria-labelledby="workflow-operations-title">
      <header className="workflow-operations-hero" style={{ '--stage-color': stage.color } as React.CSSProperties}>
        <div><span>PROJECT DELIVERY · STEP {stageId}</span><h2 id="workflow-operations-title">{stage.name}</h2><p>{stage.description}</p></div>
        <div className="workflow-save-state"><strong>D1 LIVE WORKSPACE</strong><span>입력값·변경 이력 자동 보존</span></div>
      </header>

      <nav className="workflow-stepper" aria-label="프로젝트 6단계">
        {WORKFLOW_STAGES.map((entry) => <button key={entry.id} className={entry.id === stageId ? 'is-active' : ''} style={{ '--step-color': entry.color } as React.CSSProperties} onClick={() => onNavigate(entry.path)}><span>{String(entry.id).padStart(2, '0')}</span><strong>{entry.name}</strong></button>)}
      </nav>

      <div className="workflow-project-selector">
        <label htmlFor="workflow-case">현재 프로젝트</label>
        <select id="workflow-case" value={selectedCaseId} disabled={Boolean(busy)} onChange={(event) => selectCase(event.target.value)}>
          {cases.map((entry) => <option key={entry.id} value={entry.id}>{entry.caseNumber} · {entry.title}</option>)}
        </select>
        {data && <span>{data.case.claimType} · {data.case.status}</span>}
      </div>

      {!loading && data && <section className="shared-stage-schedule" aria-labelledby="shared-stage-schedule-title">
        <header><div><span>PROJECT CALENDAR · SINGLE SOURCE</span><h3 id="shared-stage-schedule-title">{stage.name} 기준 일정</h3><p>여기서 저장한 날짜와 프로젝트 일정표 팝업의 날짜는 같은 D1 일정입니다. 어느 화면에서 수정해도 양쪽에 즉시 반영됩니다.</p></div><em>{scheduleDraft.explicit ? `저장됨 · v${scheduleDraft.version}` : '일정 미입력'}</em></header>
        {scheduleProject ? <>
          <div className="shared-stage-schedule-fields">
            <label>시작일<input type="date" value={scheduleDraft.startDate} disabled={Boolean(busy) || !scheduleProject.canManageSchedule} onChange={(event) => setScheduleDraft((current) => ({ ...current, startDate:event.target.value }))} /></label>
            <label>종료일<input type="date" min={scheduleDraft.startDate} value={scheduleDraft.endDate} disabled={Boolean(busy) || !scheduleProject.canManageSchedule} onChange={(event) => setScheduleDraft((current) => ({ ...current, endDate:event.target.value }))} /></label>
            <label>상태<select value={scheduleDraft.status} disabled={Boolean(busy) || !scheduleProject.canManageSchedule} onChange={(event) => setScheduleDraft((current) => ({ ...current, status:event.target.value }))}><option value="PLANNED">예정</option><option value="IN_PROGRESS">진행 중</option><option value="COMPLETED">완료</option><option value="DELAYED">지연</option></select></label>
            <label className="is-note">일정 메모<input value={scheduleDraft.noteText} maxLength={5000} disabled={Boolean(busy) || !scheduleProject.canManageSchedule} onChange={(event) => setScheduleDraft((current) => ({ ...current, noteText:event.target.value }))} placeholder="현장·담당팀·마감 특이사항" /></label>
          </div>
          <div className="shared-stage-schedule-actions"><div><strong>담당 PM</strong><span>{scheduleProject.responsiblePm?.name ?? '미지정 · 프로젝트 일정표에서 먼저 지정'}</span></div><Button variant="secondary" onClick={() => onNavigate(`/projects/schedule?projectId=${encodeURIComponent(scheduleProject.id)}`)}>전체 일정표에서 확인·수정</Button>{scheduleProject.canManageSchedule && <Button className="shared-schedule-save-button" onClick={() => void saveSharedSchedule()} disabled={Boolean(busy) || !scheduleDraft.startDate || !scheduleDraft.endDate}>{busy === '기준 일정 저장' ? '저장 중…' : scheduleDraft.explicit ? '일정 수정 저장' : '일정 저장'}</Button>}</div>
        </> : <div className="shared-stage-schedule-empty"><strong>아직 수행 프로젝트가 아닙니다.</strong><span>프로젝트 접수에서 제안서를 연동하고 수주 확정하면 일정 저장 기능이 열립니다.</span><Button variant="secondary" onClick={() => onNavigate(`/workflow/award?caseId=${encodeURIComponent(selectedCaseId)}`)}>프로젝트 접수 확인</Button></div>}
      </section>}

      {loading && <div className="workflow-feedback">프로젝트 업무 데이터를 불러오는 중입니다.</div>}
      {failure && <div className="workflow-feedback is-error" role="alert"><strong>처리하지 못했습니다.</strong><span>{failure}</span><Button size="sm" variant="secondary" onClick={() => void loadWorkflow(selectedCaseId)}>다시 불러오기</Button></div>}
      {notice && <div className="workflow-feedback is-success" role="status">{notice}</div>}

      {!loading && data && stageId === 3 && <KickoffEditor caseId={selectedCaseId} form={kickoff} setForm={setKickoff} record={data.kickoff} disabled={!canEdit || Boolean(busy)} onSave={saveKickoff} onGenerate={generateSummary} onConfirm={confirmKickoff} busy={busy} onNavigate={onNavigate} />}
      {!loading && data && stageId === 4 && <SurveyEditor caseId={selectedCaseId} form={survey} setForm={setSurvey} surveys={data.siteSurveys} drive={data.googleDrive} disabled={!canEdit || Boolean(busy)} onSave={saveSurvey} busy={busy} onNavigate={onNavigate} />}
      {!loading && data && stageId === 5 && <AllocationEditor caseId={selectedCaseId} form={allocation} setForm={setAllocation} allocations={data.allocations} disabled={!canEdit || Boolean(busy)} onSave={saveAllocation} busy={busy} onNavigate={onNavigate} />}
    </section>
  );
};

const WORKFLOW_IMPORT_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.hwp,.hwpx,.txt,.csv,.png,.jpg,.jpeg,.webp,.mp3,.m4a,.wav,.ogg,.webm';
const evidenceCategoryFor = (kind: 'KICKOFF' | 'SITE_SURVEY', file: File) => {
  if (kind === 'KICKOFF') return file.type.startsWith('audio/') ? 'MEETING_RECORDING' : 'MEETING_MINUTES';
  if (file.type.startsWith('audio/')) return 'SITE_RECORDING';
  if (file.type.startsWith('image/')) return 'SITE_PHOTO';
  return 'SITE_DOCUMENT';
};

function downloadWorkflowTemplate(kind: 'KICKOFF' | 'SITE_SURVEY'): void {
  if (kind === 'KICKOFF') {
    const anchor = document.createElement('a');
    anchor.href = '/templates/CONCOST_%ED%9A%8C%EC%9D%98%EB%A1%9D_%EC%96%91%EC%8B%9D.xlsx';
    anchor.download = 'CONCOST_회의록_양식.xlsx';
    anchor.click();
    return;
  }
  const rows = [['조사 일자','YYYY-MM-DD'],['현장 위치',''],['조사 책임팀',''],['조사 범위',''],['관찰 내용',''],['사진·도면 번호',''],['추가 확인사항','']];
  const csv = `\uFEFF항목,내용\r\n${rows.map((row) => row.map((cell) => `"${cell.replaceAll('"','""')}"`).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = '현장조사_현장작성_양식.csv'; anchor.click(); URL.revokeObjectURL(url);
}

const WorkflowAiImporter: React.FC<{
  caseId: string;
  kind: 'KICKOFF' | 'SITE_SURVEY';
  disabled: boolean;
  onImported: (value: WorkflowAiImport) => void;
}> = ({ caseId, kind, disabled, onImported }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dataClass,setDataClass] = useState<'GENERAL'|'INTERNAL'|'CONFIDENTIAL'|'RESTRICTED'>('INTERNAL');
  const [dragging,setDragging] = useState(false);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [error,setError] = useState('');

  const processFile = async (file?: File) => {
    if (!file || disabled || busy) return;
    setBusy(true); setError(''); setMessage('회사 Google Drive에 원본을 먼저 저장하고 있습니다.');
    try {
      const evidence = new FormData(); evidence.set('file',file); evidence.set('category',evidenceCategoryFor(kind,file));
      const stored = await fetch(`/api/cases/${encodeURIComponent(caseId)}/evidence`, { method:'POST',headers:{'Idempotency-Key':`workflow-source-${crypto.randomUUID()}`},body:evidence });
      const storedPayload = await stored.json().catch(() => ({})) as { error?: string };
      if (!stored.ok) throw new Error(storedPayload.error ?? '원본을 회사 Google Drive에 저장하지 못했습니다.');
      setMessage('원본 저장 완료 · Gemini가 양식의 항목을 근거대로 정리하고 있습니다.');
      const form = new FormData(); form.set('file',file); form.set('workflowKind',kind); form.set('dataClass',dataClass);
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/workflow/ai-import`, { method:'POST',body:form });
      const payload = await response.json().catch(() => ({})) as { import?: WorkflowAiImport; error?: string; code?: string; security?: { redactionCount:number; rawProviderPayloadStored:boolean } };
      if (!response.ok || !payload.import) throw new Error(payload.error ?? 'AI 문서 정리를 완료하지 못했습니다.');
      onImported(payload.import);
      setMessage(`자동 입력 완료 · 원본은 Drive에 보존되고 AI 원문 응답은 저장하지 않았습니다.${payload.security?.redactionCount ? ` 개인정보 ${payload.security.redactionCount}건 마스킹` : ''} 비어 있는 항목은 사람이 확인해 주세요.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '파일을 처리하지 못했습니다.'); }
    finally { setBusy(false); if(inputRef.current) inputRef.current.value=''; }
  };

  return <section className={`workflow-ai-importer${dragging?' is-dragging':''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void processFile(event.dataTransfer.files[0]); }}>
    <header><div><span>EXCEL·문서·녹음 → DRIVE → GEMINI</span><h4>{kind === 'KICKOFF' ? '회의록 자동 입력' : '현장조사 기록 자동 입력'}</h4><p>{kind === 'KICKOFF' ? '회사 표준 회의록 XLSX를 작성해 다시 가져오거나, 회의록·사진·녹음을 올리면 Gemini가 항목과 후속업무를 자동으로 채웁니다.' : '현장에서 작성한 조사 양식, 사진 또는 녹음을 끌어 놓으면 원본을 Drive에 저장한 뒤 화면 항목을 자동으로 채웁니다.'}</p></div><Button className="workflow-template-button" size="sm" variant="secondary" onClick={() => downloadWorkflowTemplate(kind)}>{kind === 'KICKOFF' ? '회사 회의록 XLSX 내보내기' : '현장조사 CSV 내보내기'}</Button></header>
    <div className="workflow-ai-import-controls"><label>자료 보안등급<select value={dataClass} disabled={busy} onChange={(event) => setDataClass(event.target.value as typeof dataClass)}><option value="GENERAL">일반·외부전송 가능</option><option value="INTERNAL">회사 내부</option><option value="CONFIDENTIAL">기밀</option><option value="RESTRICTED">제한자료</option></select></label><input ref={inputRef} type="file" accept={WORKFLOW_IMPORT_ACCEPT} disabled={disabled||busy} onChange={(event) => void processFile(event.target.files?.[0])}/><Button onClick={() => inputRef.current?.click()} disabled={disabled||busy}>{busy?'저장·정리 중…':'가져오기·자동 작성'}</Button></div>
    <small>내부·기밀 자료는 관리자가 유료 Gemini의 비학습 조건을 확인하고 보안 전송을 승인한 경우에만 전송됩니다. 승인 전에는 Drive 저장만 완료되고 AI 전송은 차단됩니다.</small>
    {message && <p className="notice-box" role="status">{message}</p>}{error && <p className="error-box" role="alert">{error}</p>}
  </section>;
};

const KickoffEditor: React.FC<{
  caseId: string;
  form: { meetingAt: string; location: string; agenda: string; participantUnits: string; rawNotes: string; status: string; expectedVersion: number };
  setForm: React.Dispatch<React.SetStateAction<{ meetingAt: string; location: string; agenda: string; participantUnits: string; rawNotes: string; status: string; expectedVersion: number }>>;
  record: KickoffRecord | null;
  disabled: boolean;
  busy: string;
  onSave: () => void;
  onGenerate: () => void;
  onConfirm: () => void;
  onNavigate: (path: string) => void;
}> = ({ caseId, form, setForm, record, disabled, busy, onSave, onGenerate, onConfirm, onNavigate }) => {
  const [importedDraft, setImportedDraft] = useState<WorkflowAiImport | null>(null);
  const displayedSummary = record?.summaryText || importedDraft?.summary || '';
  const displayedTimeline = record?.summaryText ? record.timeline : importedDraft?.timeline ?? [];
  const outputState = record?.status === 'CONFIRMED' ? '최종 확정본' : record?.summaryText ? 'Gemini 정리본 · 검수 필요' : importedDraft ? '자동작성 결과 · 저장 전' : 'EMPTY';
  return (
  <div className="workflow-editor-grid">
    <article className="workflow-editor-card">
      <header><div><span>KICKOFF INTAKE</span><h3>착수회의 기록</h3></div><em>v{form.expectedVersion}</em></header>
      <WorkflowAiImporter caseId={caseId} kind="KICKOFF" disabled={disabled} onImported={(value) => { setImportedDraft(value); setForm((current) => ({ ...current, meetingAt:value.meetingAt?localDateTime(value.meetingAt):current.meetingAt,location:value.location,agenda:value.agenda,participantUnits:value.participants.join(', '),rawNotes:value.sourceNotes,status:'DRAFTED' })); }}/>
      <div className="workflow-form-grid">
        <label>회의 일시<input type="datetime-local" value={form.meetingAt} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, meetingAt: event.target.value }))} /></label>
        <label>회의 상태<select value={form.status} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option value="PLANNED">진행 예정</option><option value="COMPLETED">진행 완료</option><option value="DRAFTED">회의록 초안</option><option value="CONFIRMED">확정</option></select></label>
        <label className="is-wide">장소<input value={form.location} maxLength={300} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} placeholder="본사 회의실 또는 온라인 링크" /></label>
        <label className="is-wide">회의 안건<textarea value={form.agenda} maxLength={12000} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, agenda: event.target.value }))} placeholder="업무 범위, 현장 일정, 산출 기준, 고객 요청" /></label>
        <label className="is-wide">참석 팀·담당자<input value={form.participantUnits} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, participantUnits: event.target.value }))} placeholder="쉼표로 구분" /></label>
        <label className="is-wide">회의 메모·녹취 텍스트<textarea className="is-tall" value={form.rawNotes} maxLength={50000} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, rawNotes: event.target.value }))} placeholder="녹음 전사문 또는 회의 중 메모를 입력하세요." /></label>
      </div>
      <div className="workflow-actions"><Button disabled={disabled || !form.agenda.trim()} onClick={onSave}>{busy === '착수회의·기준 일정 저장' ? '일정과 회의 저장 중…' : '착수회의·일정 저장'}</Button><Button variant="secondary" disabled={disabled || !record?.rawNotes.trim()} onClick={onGenerate}>{busy === 'Gemini 회의록·타임라인 정리' ? 'Gemini 정리 중…' : 'Gemini로 회의록·타임라인 정리'}</Button></div>
      <p className="workflow-honest-note">관리자 설정의 조직 공용 Gemini 키를 사용합니다. 키가 없는 테스트 환경에서는 원문을 보존한 로컬 구조화 초안만 만들며, 모든 결과는 담당자가 원문과 대조해 확정해야 합니다.</p>
    </article>
    <article className="workflow-editor-card is-output">
      <header><div><span>GEMINI MINUTES · HUMAN REVIEW</span><h3>회의록 최종본 · 결정사항 · 후속업무</h3></div><em>{outputState}</em></header>
      <p className="workflow-output-guide">이 영역은 단순 메모가 아닙니다. Gemini가 회사 회의록 양식과 원문을 정리한 결과를 보여주며, 담당자가 원문과 대조한 뒤 아래 버튼으로 최종 확정합니다.</p>
      {displayedSummary ? <><pre className="workflow-summary-text">{displayedSummary}</pre><ol className="workflow-timeline">{displayedTimeline.map((item) => <li key={`${item.order}-${item.detail}`}><span>{item.order}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div></li>)}</ol>{record?.summaryText && record.status !== 'CONFIRMED' && <Button className="workflow-confirm-button" disabled={disabled} onClick={onConfirm}>{busy === '회의록 최종본 확정' ? '확정 중…' : '원문 대조 완료 · 최종본 확정'}</Button>}</> : <div className="workflow-empty"><strong>아직 정리된 회의록이 없습니다.</strong><p>회사 양식을 가져오거나 회의 메모를 저장한 뒤 Gemini 정리를 실행하세요.</p></div>}
    </article>
    <article className="workflow-editor-card workflow-evidence-card">
      <header><div><span>KICKOFF EVIDENCE</span><h3>착수회의 제공자료·회의록·녹음</h3></div><em>회사 Drive 자동 분류</em></header>
      <p className="workflow-evidence-intro">발주처가 제공한 원본, 회의록과 녹음파일을 현재 프로젝트에 바로 연결합니다. 다른 분류는 자료실 전체 보기에서 선택할 수 있습니다.</p>
      <CaseEvidencePanel caseId={caseId} defaultCategory="KICKOFF_MATERIAL" allowedCategories={['KICKOFF_MATERIAL', 'MEETING_MINUTES', 'MEETING_RECORDING']} compact onNavigate={onNavigate} />
    </article>
  </div>
  );
};

const SurveyEditor: React.FC<{
  caseId: string;
  form: { surveyDate: string; location: string; scopeText: string; leadUnit: string; status: string; expectedVersion: number };
  setForm: React.Dispatch<React.SetStateAction<{ surveyDate: string; location: string; scopeText: string; leadUnit: string; status: string; expectedVersion: number }>>;
  surveys: SurveyRecord[];
  drive: WorkflowPayload['googleDrive'];
  disabled: boolean;
  busy: string;
  onSave: () => void;
  onNavigate: (path: string) => void;
}> = ({ caseId, form, setForm, surveys, drive, disabled, busy, onSave, onNavigate }) => (
  <div className="workflow-editor-grid">
    <article className="workflow-editor-card">
      <header><div><span>SITE SURVEY PLAN</span><h3>현장조사 계획·원본 분류</h3></div><em>v{form.expectedVersion}</em></header>
      <WorkflowAiImporter caseId={caseId} kind="SITE_SURVEY" disabled={disabled} onImported={(value) => setForm((current) => ({ ...current,surveyDate:value.surveyDate??current.surveyDate,location:value.location,scopeText:value.agenda||value.sourceNotes,leadUnit:value.leadUnit||current.leadUnit,status:'IN_PROGRESS',expectedVersion:current.expectedVersion }))}/>
      <div className="workflow-form-grid">
        <label>조사 일자<input type="date" value={form.surveyDate} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, surveyDate: event.target.value }))} /></label>
        <label>진행 상태<select value={form.status} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option value="PLANNED">예정</option><option value="IN_PROGRESS">진행 중</option><option value="COMPLETED">완료</option></select></label>
        <label className="is-wide">현장 위치<input value={form.location} maxLength={300} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} /></label>
        <label className="is-wide">조사 범위<textarea value={form.scopeText} maxLength={12000} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, scopeText: event.target.value }))} placeholder="동·층·부위, 하자·기시공·미시공 구분, 조사 제외 범위" /></label>
        <label className="is-wide">조사 책임 팀<input value={form.leadUnit} maxLength={120} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, leadUnit: event.target.value }))} /></label>
      </div>
      <Button disabled={disabled || !form.scopeText.trim()} onClick={onSave}>{busy === '현장조사·기준 일정 저장' ? '일정과 계획 저장 중…' : '현장조사·일정 저장'}</Button>
      <p className="workflow-honest-note">조사 계획은 D1에 보존되고, 아래 원본 자료는 회사 Google Drive의 프로젝트/현장조사/월 폴더에 저장됩니다. 연결 상태: {drive.connected ? '연결됨' : '설정 확인 필요'}.</p>
    </article>
    <article className="workflow-editor-card is-output">
      <header><div><span>FOLDER LEDGER</span><h3>조사일자별 폴더 계획</h3></div><em>{surveys.length}건</em></header>
      {surveys.length ? <div className="survey-list">{surveys.map((item) => <section key={item.id}><div><strong>{item.surveyDate} · {item.leadUnit}</strong><span>{item.location || '위치 미입력'} · {item.status}</span></div><code>{item.folderPath}</code><small>사진 {item.photoCount} · 녹음 {item.audioCount} · 문서 {item.documentCount}</small></section>)}</div> : <div className="workflow-empty"><strong>저장된 현장조사 계획이 없습니다.</strong><p>조사 일자와 범위를 먼저 등록하세요.</p></div>}
    </article>
    <article className="workflow-editor-card workflow-evidence-card">
      <header><div><span>SITE EVIDENCE</span><h3>현장 사진·녹음·도면 업로드</h3></div><em>프로젝트 자료실 자동 연동</em></header>
      <p className="workflow-evidence-intro">현장 사진을 기본으로 열었습니다. 녹음과 기타 조사자료는 상단 분류 탭을 바꿔 올리세요.</p>
      <CaseEvidencePanel caseId={caseId} defaultCategory="SITE_PHOTO" allowedCategories={['SITE_PHOTO', 'SITE_RECORDING', 'SITE_DOCUMENT']} compact onNavigate={onNavigate} />
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
      <Button disabled={disabled || !form.scopeText.trim() || !form.basisText.trim() || form.endDate < form.startDate} onClick={onSave}>{busy === '팀 투입·기준 일정 저장' ? '일정과 투입 저장 중…' : '투입 일정 저장·프로젝트 일정표 반영'}</Button>
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
      <CaseEvidencePanel caseId={caseId} compact defaultCategory="TAKEOFF_SOURCE" allowedCategories={['TAKEOFF_SOURCE', 'COST_BREAKDOWN']} onNavigate={onNavigate} />
    </article>
  </div>
);
