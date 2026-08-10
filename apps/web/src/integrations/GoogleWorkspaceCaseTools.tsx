import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../api';

type SupportedRoute = 'CASE-04' | 'CASE-06' | 'MEET-01';
type OperationKind = 'drive' | 'gmail' | 'calendar' | 'docs' | 'sheets';

interface CaseOption { id: string; caseNumber: string; title: string; version: number }
interface WorkspaceResource {
  id: string;
  kind?: string;
  entityType?: string;
  name?: string;
  title?: string;
  webViewLink?: string | null;
  provenance?: unknown;
  createdAt?: string;
}
interface WorkspaceHistory {
  id: string;
  operationKind: string;
  status: string;
  responseClass?: string | null;
  redactedError?: string | null;
  createdAt: string;
}
interface GmailAttachment {
  id?: string;
  attachmentId?: string;
  filename: string;
  messageId?: string;
  subject?: string;
  from?: string;
  size?: number;
}
interface MeetingOption {
  id: string;
  title: string;
  status?: string;
  version?: number;
  versionNumber?: number;
  updatedAt?: string;
}
interface SheetSource {
  id?: string;
  spreadsheetId: string;
  spreadsheetName?: string;
  sheetName: string;
  rangeA1?: string;
  allowedRange?: string;
  label?: string;
  displayName?: string;
}
interface DateCandidate {
  id: string;
  candidateHash: string;
  version: number;
  startDateTime: string;
  endDateTime: string;
  confidence: number;
  sourceType: string;
  sourceEntityId: string;
  originalLocation: string;
  excerpt: string;
  summary: string;
}
interface WorkspacePayload {
  caseVersion: number;
  connectionStatus: string;
  resources: WorkspaceResource[];
  history: WorkspaceHistory[];
  gmailAttachments: GmailAttachment[];
  gmailSourceStatus?: { responseClass: string; retryAfterSeconds: number | null } | null;
  meetings: MeetingOption[];
  sheetSources: SheetSource[];
  sheetSourceStatus?: { responseClass: string; retryAfterSeconds: number | null } | null;
  dateCandidates: DateCandidate[];
}

function sourceStatusMessage(status?: { responseClass: string; retryAfterSeconds: number | null } | null): string | null {
  if (!status || status.responseClass === 'SUCCESS' || status.responseClass === 'DUPLICATE_REPLAY') return null;
  if (status.responseClass === 'TOKEN_EXPIRED') return 'TOKEN_EXPIRED: Google 연결 토큰이 만료되었습니다. Admin 재동의가 필요합니다.';
  if (status.responseClass === 'RECONSENT_REQUIRED' || status.responseClass === 'BAD_SCOPE') return `${status.responseClass}: 승인 범위를 다시 확인하고 Admin 재동의를 진행하세요.`;
  if (status.responseClass === 'RATE_LIMIT_RETRY_AFTER') return `RATE_LIMIT: ${status.retryAfterSeconds ?? 0}초 후 목록을 다시 불러오세요.`;
  if (status.responseClass === 'TIMEOUT') return 'TIMEOUT: Google 목록 조회 시간이 초과되었습니다. 다시 불러오세요.';
  return 'SERVER_ERROR: Google 목록을 가져오지 못했습니다. 잠시 후 다시 시도하세요.';
}

interface UiFailure {
  message: string;
  retry: () => Promise<void>;
  operation?: OperationKind;
}

function attachmentId(item: GmailAttachment): string {
  return item.attachmentId ?? item.id ?? '';
}

function meetingVersion(item: MeetingOption): number {
  return item.versionNumber ?? item.version ?? 1;
}

function sheetRange(item: SheetSource): string {
  return item.rangeA1 ?? item.allowedRange ?? '';
}

function safeGoogleLink(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const allowed = url.protocol === 'https:' && (url.hostname === 'google.invalid' || url.hostname.endsWith('.google.invalid') || url.hostname === 'google.com' || url.hostname.endsWith('.google.com'));
    return allowed ? url.toString() : null;
  } catch {
    return null;
  }
}

function provenanceText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  try { return JSON.stringify(value); } catch { return null; }
}

function explainFailure(reason: unknown): string {
  if (!navigator.onLine) return 'OFFLINE: 네트워크 연결 후 같은 작업을 다시 시도하세요.';
  if (reason instanceof ApiError) {
    const responseClass = typeof reason.payload.responseClass === 'string' ? reason.payload.responseClass : '';
    if (responseClass === 'TIMEOUT') return 'TIMEOUT: Google 응답 시간이 초과되었습니다. 같은 작업을 안전하게 다시 시도할 수 있습니다.';
    if (responseClass === 'SERVER_ERROR') return '5XX: Google 서비스가 일시적으로 실패했습니다. 잠시 후 다시 시도하세요.';
    if (responseClass === 'BAD_SCOPE') return 'Google 승인 범위가 부족합니다. Admin 재동의가 필요합니다.';
    if (responseClass === 'TOKEN_EXPIRED') return 'Google 토큰이 만료되었습니다. Admin 재동의 후 다시 시도하세요.';
    if (responseClass === 'RECONSENT_REQUIRED') return 'Google 재동의가 필요합니다. Admin 연동 화면에서 갱신하세요.';
    if (responseClass === 'USER_CANCEL') return 'Google 작업이 사용자 요청으로 취소되었습니다.';
    if (responseClass === 'MALFORMED_PROVIDER_RESPONSE') return 'Google 응답 형식을 검증하지 못해 어떤 자료도 저장하지 않았습니다.';
    if (reason.status === 401) return '401 세션이 만료되었습니다. 다시 로그인하세요.';
    if (reason.status === 403) return '403 이 사건 또는 Google 작업에 대한 권한이 없습니다.';
    if (reason.status === 409) return '409 사건 버전이 변경되었습니다. 최신 상태로 갱신했습니다. 내용을 확인하고 다시 실행하세요.';
    if (reason.status === 429) {
      const retryAfter = typeof reason.payload.retryAfterSeconds === 'number' ? ` ${reason.payload.retryAfterSeconds}초 후` : ' 잠시 후';
      return `429 Google 요청 제한에 도달했습니다.${retryAfter} 새 요청으로 다시 시도하세요.`;
    }
    if (reason.status >= 500) return 'Google provider가 일시적으로 응답하지 않습니다. 재시도할 수 있습니다.';
  }
  return reason instanceof Error ? reason.message : 'Google Workspace 작업에 실패했습니다.';
}

function idempotencyKey(kind: OperationKind, caseId: string): string {
  const random = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `P14-UI-${kind.toUpperCase()}-${caseId}-${random}`;
}

export function GoogleWorkspaceCaseTools({ routeId, roles }: { routeId: SupportedRoute; roles: string[] }): React.ReactElement {
  const initialCaseId = new URLSearchParams(window.location.search).get('caseId') ?? '';
  const [caseQuery, setCaseQuery] = useState('');
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState(initialCaseId);
  const [resourceQuery, setResourceQuery] = useState('');
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeOperation, setActiveOperation] = useState<OperationKind | null>(null);
  const [failure, setFailure] = useState<UiFailure | null>(null);
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([]);
  const [selectedDateCandidate, setSelectedDateCandidate] = useState('');
  const [calendarConfirmed, setCalendarConfirmed] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState('');
  const [selectedSheet, setSelectedSheet] = useState('');
  const requestEpoch = useRef(0);
  const selectedCaseRef = useRef(selectedCaseId);
  const workspaceRef = useRef<WorkspacePayload | null>(workspace);
  const onlineRef = useRef(online);
  const operationKeys = useRef<Partial<Record<OperationKind, { fingerprint: string; key: string }>>>({});
  const canEvidenceMutate = roles.some((role) => ['admin', 'ceo', 'director', 'pm', 'staff', 'reviewer'].includes(role.toLowerCase()));
  const canCalendarMutate = roles.some((role) => ['admin', 'ceo', 'director', 'pm'].includes(role.toLowerCase()));

  useEffect(() => { workspaceRef.current = workspace; }, [workspace]);

  useEffect(() => {
    selectedCaseRef.current = selectedCaseId;
    requestEpoch.current += 1;
    operationKeys.current = {};
    workspaceRef.current = null;
    setWorkspace(null);
    setSelectedAttachments([]);
    setSelectedMeeting('');
    setSelectedSheet('');
    setSelectedDateCandidate('');
    setCalendarConfirmed(false);
    setResourceQuery('');
    setNotice('');
    setFailure(null);
  }, [selectedCaseId]);

  useEffect(() => {
    const markOnline = () => { onlineRef.current = true; setOnline(true); };
    const markOffline = () => { onlineRef.current = false; setOnline(false); };
    window.addEventListener('online', markOnline);
    window.addEventListener('offline', markOffline);
    return () => {
      window.removeEventListener('online', markOnline);
      window.removeEventListener('offline', markOffline);
    };
  }, []);

  const searchCases: () => Promise<void> = useCallback(async () => {
    setFailure(null);
    try {
      const result = await apiRequest<{ cases: CaseOption[] }>(`/api/cases?assignedOnly=true&limit=100&q=${encodeURIComponent(caseQuery)}`);
      setCases(result.cases);
      setSelectedCaseId((current) => current || result.cases[0]?.id || '');
    } catch (reason) {
      setFailure({ message: explainFailure(reason), retry: searchCases });
    }
  }, [caseQuery]);

  useEffect(() => { void searchCases(); }, []); // initial assigned-case inventory only

  const loadWorkspace: (query?: string) => Promise<void> = useCallback(async (query = resourceQuery) => {
    const caseId = selectedCaseRef.current;
    if (!caseId) return;
    const epoch = ++requestEpoch.current;
    setLoading(true);
    setFailure(null);
    try {
      const result = await apiRequest<WorkspacePayload>(`/api/cases/${encodeURIComponent(caseId)}/google/workspace?resourceQuery=${encodeURIComponent(query)}&resourceLimit=121`);
      if (epoch !== requestEpoch.current || caseId !== selectedCaseRef.current) return;
      const normalized: WorkspacePayload = {
        ...result,
        resources: result.resources ?? [],
        history: (result.history ?? []).slice(0, 100),
        gmailAttachments: result.gmailAttachments ?? [],
        meetings: result.meetings ?? [],
        sheetSources: result.sheetSources ?? [],
        dateCandidates: result.dateCandidates ?? []
      };
      workspaceRef.current = normalized;
      setWorkspace(normalized);
      setSelectedMeeting((current) => current || result.meetings?.find((item) => item.status === 'FINAL')?.id || '');
      setSelectedSheet((current) => current || (result.sheetSources?.[0] ? `${result.sheetSources[0].spreadsheetId}|${result.sheetSources[0].sheetName}|${sheetRange(result.sheetSources[0])}` : ''));
      setSelectedDateCandidate((current) => current || result.dateCandidates?.[0]?.id || '');
    } catch (reason) {
      if (epoch !== requestEpoch.current || caseId !== selectedCaseRef.current) return;
      setFailure({ message: explainFailure(reason), retry: () => loadWorkspace(query) });
    } finally {
      if (epoch === requestEpoch.current) setLoading(false);
    }
  }, [resourceQuery]);

  useEffect(() => { if (selectedCaseId) void loadWorkspace(''); }, [selectedCaseId]);

  const runOperation: (kind: OperationKind, endpoint: string, input: Record<string, unknown>, successMessage: string) => Promise<void> = async (kind, endpoint, input, successMessage) => {
    const caseId = selectedCaseRef.current;
    const current = workspaceRef.current;
    if (!caseId || !current) return;
    if (!onlineRef.current) {
      setFailure({ message: 'OFFLINE: 네트워크 연결 후 같은 작업을 다시 시도하세요.', retry: () => runOperation(kind, endpoint, input, successMessage), operation: kind });
      return;
    }
    const epoch = requestEpoch.current;
    const fingerprint = JSON.stringify({ caseId, kind, expectedCaseVersion: current.caseVersion, input });
    const previousKey = operationKeys.current[kind];
    const key = previousKey?.fingerprint === fingerprint ? previousKey.key : idempotencyKey(kind, caseId);
    operationKeys.current[kind] = { fingerprint, key };
    setActiveOperation(kind);
    setFailure(null);
    setNotice('');
    try {
      const result = await apiRequest<{ caseVersion: number }>(`/api/cases/${encodeURIComponent(caseId)}/google/${endpoint}`, {
        method: 'POST',
        body: JSON.stringify({ expectedCaseVersion: current.caseVersion, idempotencyKey: key, ...input })
      });
      if (epoch !== requestEpoch.current || caseId !== selectedCaseRef.current) return;
      delete operationKeys.current[kind];
      await loadWorkspace(resourceQuery);
      if (caseId === selectedCaseRef.current) setNotice(`${successMessage} · 사건 v${result.caseVersion}`);
    } catch (reason) {
      if (epoch !== requestEpoch.current || caseId !== selectedCaseRef.current) return;
      const message = explainFailure(reason);
      if (reason instanceof ApiError && reason.status === 409) await loadWorkspace(resourceQuery);
      if (reason instanceof ApiError && typeof reason.payload.responseClass === 'string') delete operationKeys.current[kind];
      setFailure({ message, retry: () => runOperation(kind, endpoint, input, successMessage), operation: kind });
    } finally {
      if (caseId === selectedCaseRef.current) setActiveOperation(null);
    }
  };

  const selectedMeetingRecord = useMemo(() => workspace?.meetings.find((item) => item.id === selectedMeeting), [selectedMeeting, workspace]);
  const exportableMeetings = useMemo(() => workspace?.meetings.filter((item) => item.status === 'FINAL') ?? [], [workspace]);
  const selectedSheetRecord = useMemo(() => workspace?.sheetSources.find((item) => `${item.spreadsheetId}|${item.sheetName}|${sheetRange(item)}` === selectedSheet), [selectedSheet, workspace]);
  const selectedDateCandidateRecord = useMemo(() => workspace?.dateCandidates.find((item) => item.id === selectedDateCandidate), [selectedDateCandidate, workspace]);
  const clearFailedOperation = (kind: OperationKind): void => {
    if (failure?.operation !== kind) return;
    delete operationKeys.current[kind];
    setFailure(null);
  };

  return (
    <section className="google-case-tools" aria-labelledby="google-case-tools-title" data-testid={`google-tools-${routeId.toLowerCase()}`}>
      <header className="google-card-heading">
        <div><p className="google-eyebrow">CASE WORKSPACE · {routeId}</p><h2 id="google-case-tools-title">Google Workspace 사건 작업</h2><p>배정된 사건과 사용자가 명시적으로 선택한 자료만 처리합니다.</p></div>
        {workspace && <span className={`google-status google-status--${workspace.connectionStatus.toLowerCase()}`}>{workspace.connectionStatus}</span>}
      </header>

      {!online && <div className="google-message google-message--error" role="alert">OFFLINE · 저장되지 않은 Google 작업은 실행되지 않습니다.</div>}
      {!canEvidenceMutate && <div className="google-message google-message--error" role="note">현재 역할은 Google 사건 자료 작업을 수행할 수 없습니다.</div>}
      {routeId === 'CASE-04' && canEvidenceMutate && !canCalendarMutate && <div className="google-message" role="note">Drive 자료 작업은 가능하지만 Calendar 기일 생성은 Admin·CEO·Director·PM만 수행할 수 있습니다.</div>}
      {failure && <div className="google-message google-message--error" role="alert"><span>{failure.message}</span><button type="button" onClick={() => void failure.retry()}>다시 시도</button></div>}
      {notice && <div className="google-message google-message--success" role="status" aria-live="polite">{notice}</div>}
      {(loading || activeOperation) && <p className="google-message" role="status" aria-live="polite">{activeOperation ? `${activeOperation.toUpperCase()} 작업을 안전하게 처리하는 중입니다.` : '사건 Google 작업 정보를 불러오는 중입니다.'}</p>}

      <div className="google-case-picker">
        <label><span>배정 사건 검색</span><input value={caseQuery} onChange={(event) => setCaseQuery(event.target.value)} placeholder="사건번호 또는 사건명" /></label>
        <button type="button" className="google-button google-button--quiet" disabled={Boolean(activeOperation)} onClick={() => void searchCases()}>검색</button>
        <label><span>작업할 사건</span><select disabled={Boolean(activeOperation)} data-testid="google-case-select" aria-label="Google 작업 사건 선택" value={selectedCaseId} onChange={(event) => setSelectedCaseId(event.target.value)}><option value="">배정 사건 선택</option>{cases.map((item) => <option key={item.id} value={item.id}>{item.caseNumber} · {item.title}</option>)}</select></label>
      </div>

      {selectedCaseId && workspace && workspace.connectionStatus !== 'CONNECTED' && <div className="google-empty" role="status">Google Workspace가 연결되지 않았습니다. Admin 연동 화면에서 연결 또는 재동의를 완료하세요.</div>}

      {selectedCaseId && workspace && workspace.connectionStatus === 'CONNECTED' && (
        <div className="google-tool-grid">
          <article className="google-tool-card">
            <h3>Drive 사건 폴더</h3><p>동일 사건 요청은 하나의 폴더로 수렴합니다.</p>
            <button type="button" className="google-button google-button--primary" disabled={!canEvidenceMutate || Boolean(activeOperation)} onClick={() => void runOperation('drive', 'drive-folder', {}, 'Drive 사건 폴더가 준비되었습니다')}>Drive 폴더 생성·열기</button>
          </article>

          {routeId === 'CASE-06' && <>
            <article className="google-tool-card google-tool-card--wide">
              <h3>Gmail 첨부 선택 가져오기</h3><p>체크한 첨부만 내부 P06 자료 snapshot으로 저장합니다.</p>
              {sourceStatusMessage(workspace.gmailSourceStatus) && <p className="google-message google-message--error" role="alert">{sourceStatusMessage(workspace.gmailSourceStatus)}</p>}
              {workspace.gmailAttachments.length === 0 ? <p className="google-empty">가져올 Gmail 첨부가 없습니다.</p> : <fieldset className="google-selection-list"><legend>가져올 첨부 선택</legend>{workspace.gmailAttachments.map((item) => { const id = attachmentId(item); return <label key={id}><input data-attachment-id={id} type="checkbox" checked={selectedAttachments.includes(id)} onChange={(event) => { clearFailedOperation('gmail'); setSelectedAttachments((current) => event.target.checked ? [...current, id] : current.filter((value) => value !== id)); }} /><span className="google-long-name" title={item.filename}>{item.filename}</span><small>{item.subject ?? '제목 없음'} · {item.from ?? '발신자 비공개'}</small></label>; })}</fieldset>}
              <button type="button" className="google-button google-button--primary" disabled={!canEvidenceMutate || Boolean(activeOperation) || selectedAttachments.length === 0} onClick={() => void runOperation('gmail', 'import-gmail', { attachmentIds: selectedAttachments }, `${selectedAttachments.length}개 Gmail 첨부를 가져왔습니다`)}>선택 첨부 가져오기 ({selectedAttachments.length})</button>
            </article>

            <article className="google-tool-card google-tool-card--wide">
              <h3>Sheets 범위 snapshot</h3><p>서버 allowlist가 제공한 파일·탭·범위만 선택할 수 있습니다.</p>
              {sourceStatusMessage(workspace.sheetSourceStatus) && <p className="google-message google-message--error" role="alert">{sourceStatusMessage(workspace.sheetSourceStatus)}</p>}
              <label><span>허용된 Sheets 범위</span><select aria-label="Google Sheets 허용 범위 선택" value={selectedSheet} onChange={(event) => { clearFailedOperation('sheets'); setSelectedSheet(event.target.value); }}><option value="">범위 선택</option>{workspace.sheetSources.map((item) => { const range = sheetRange(item); const value = `${item.spreadsheetId}|${item.sheetName}|${range}`; return <option key={value} value={value}>{item.label ?? item.displayName ?? item.spreadsheetName ?? item.spreadsheetId} · {item.sheetName}!{range}</option>; })}</select></label>
              {selectedSheetRecord && <p className="google-provenance">Provenance: {selectedSheetRecord.spreadsheetId} · {selectedSheetRecord.sheetName}!{sheetRange(selectedSheetRecord)}</p>}
              <button type="button" className="google-button google-button--primary" disabled={!canEvidenceMutate || Boolean(activeOperation) || !selectedSheetRecord || !sheetRange(selectedSheetRecord)} onClick={() => selectedSheetRecord && void runOperation('sheets', 'import-sheets', { spreadsheetId: selectedSheetRecord.spreadsheetId, sheetName: selectedSheetRecord.sheetName, rangeA1: sheetRange(selectedSheetRecord) }, 'Sheets 범위 snapshot을 저장했습니다')}>선택 범위 가져오기</button>
            </article>
          </>}

          {routeId === 'CASE-04' && <article className="google-tool-card google-tool-card--wide">
            <h3>사람 확인 Calendar 일정</h3><p>서버가 사건 내부 근거에서 고정한 날짜 후보만 선택할 수 있습니다.</p>
            <label><span>날짜 후보</span><select aria-label="Calendar 날짜 후보 선택" value={selectedDateCandidate} onChange={(event) => { clearFailedOperation('calendar'); setSelectedDateCandidate(event.target.value); setCalendarConfirmed(false); }}><option value="">후보 선택</option>{workspace.dateCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.summary} · 신뢰도 {Math.round(candidate.confidence * 100)}%</option>)}</select></label>
            {selectedDateCandidateRecord && <dl className="google-candidate-preview"><div><dt>시간</dt><dd>{new Date(selectedDateCandidateRecord.startDateTime).toLocaleString('ko-KR')} – {new Date(selectedDateCandidateRecord.endDateTime).toLocaleString('ko-KR')}</dd></div><div><dt>신뢰도</dt><dd>{Math.round(selectedDateCandidateRecord.confidence * 100)}%</dd></div><div><dt>출처</dt><dd>{selectedDateCandidateRecord.sourceType} · {selectedDateCandidateRecord.sourceEntityId} v{selectedDateCandidateRecord.version}</dd></div><div><dt>원문 위치</dt><dd>{selectedDateCandidateRecord.originalLocation}</dd></div><div><dt>근거 문장</dt><dd>{selectedDateCandidateRecord.excerpt}</dd></div><div><dt>후보 무결성</dt><dd>{selectedDateCandidateRecord.candidateHash.slice(0, 16)}…</dd></div></dl>}
            <label className="google-confirm"><input type="checkbox" checked={calendarConfirmed} onChange={(event) => { clearFailedOperation('calendar'); setCalendarConfirmed(event.target.checked); }} /><span>위 서버 고정 후보의 원문 위치와 날짜·시간을 사람이 확인했습니다.</span></label>
            <button type="button" className="google-button google-button--primary" disabled={!canCalendarMutate || Boolean(activeOperation) || !calendarConfirmed || !selectedDateCandidateRecord} onClick={() => selectedDateCandidateRecord && void runOperation('calendar', 'calendar-event', { dateCandidateId: selectedDateCandidateRecord.id, candidateHash: selectedDateCandidateRecord.candidateHash, humanConfirmed: true }, 'Calendar 일정을 생성했습니다')}>확인한 후보로 일정 생성</button>
          </article>}

          {routeId === 'MEET-01' && <article className="google-tool-card google-tool-card--wide">
            <h3>선택 회의록 버전 Docs 내보내기</h3><p>서버에서 조회한 해당 사건의 선택 버전만 내보냅니다.</p>
            <label><span>확정 회의록 버전</span><select aria-label="Google Docs 내보낼 회의록 선택" value={selectedMeeting} onChange={(event) => { clearFailedOperation('docs'); setSelectedMeeting(event.target.value); }}><option value="">회의록 선택</option>{exportableMeetings.map((item) => <option key={item.id} value={item.id}>{item.title} · FINAL v{meetingVersion(item)}</option>)}</select></label>
            <button type="button" className="google-button google-button--primary" disabled={!canEvidenceMutate || Boolean(activeOperation) || !selectedMeetingRecord} onClick={() => selectedMeetingRecord && void runOperation('docs', 'export-docs', { meetingId: selectedMeetingRecord.id, versionNumber: meetingVersion(selectedMeetingRecord) }, '선택한 회의록을 Google Docs로 내보냈습니다')}>선택 버전 Docs 내보내기</button>
          </article>}
        </div>
      )}

      {workspace && <div className="google-browser-grid">
        <section className="google-card" aria-labelledby="google-resource-title">
          <div className="google-card-heading"><div><h3 id="google-resource-title">연결 리소스 ({workspace.resources.length})</h3><p>검색 결과는 최대 121건을 스크롤로 표시합니다.</p></div></div>
          <div className="google-resource-search"><label><span>리소스 검색</span><input value={resourceQuery} onChange={(event) => setResourceQuery(event.target.value)} /></label><button type="button" className="google-button google-button--quiet" onClick={() => void loadWorkspace(resourceQuery)}>검색</button></div>
          {workspace.resources.length === 0 ? <p className="google-empty">연결된 리소스가 없습니다.</p> : <ul className="google-resource-list" data-testid="google-resource-list">{workspace.resources.map((resource) => { const link = safeGoogleLink(resource.webViewLink); const provenance = provenanceText(resource.provenance); return <li data-testid="google-resource-item" key={resource.id}><strong className="google-long-name" title={resource.name ?? resource.title}>{resource.name ?? resource.title ?? resource.id}</strong><span>{resource.kind ?? resource.entityType ?? 'RESOURCE'}</span>{link && <a href={link} target="_blank" rel="noreferrer noopener">Google에서 열기</a>}{provenance && <small>{provenance}</small>}</li>; })}</ul>}
        </section>
        <section className="google-card" aria-labelledby="google-case-history-title">
          <div className="google-card-heading"><div><h3 id="google-case-history-title">사건 동기화 이력 ({workspace.history.length})</h3><p>provider raw 오류나 토큰은 표시하지 않습니다.</p></div></div>
          {workspace.history.length === 0 ? <p className="google-empty">동기화 이력이 없습니다.</p> : <ol className="google-history" data-testid="google-history-list">{workspace.history.map((item) => <li data-testid="google-history-item" key={item.id}><strong>{item.operationKind}</strong><span>{item.status}{item.responseClass ? ` · ${item.responseClass}` : ''}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ko-KR')}</time>{item.redactedError && <small>{item.redactedError}</small>}</li>)}</ol>}
        </section>
      </div>}
    </section>
  );
}
