import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input, Select, Table, Timeline } from '@claim-studio/ui';
import { ApiError, apiRequest } from '../api';
import { CLAIM_TYPES } from '../routes/Router';

interface CaseCategory { major: string; middle: string; minor: string }
interface Party { id: string; name: string; role: string; contact?: string | null }
interface Schedule {
  id: string; title: string; type: string; date: string; location?: string | null;
  dDayInfo?: { dDayStr: string; isOverdue: boolean; isToday: boolean; diffDays: number };
}
interface Activity {
  id: string; title: string; description?: string | null; createdAt: string;
  actor?: { id: string; name: string };
}
interface CaseRecord {
  id: string; caseNumber: string; title: string; description?: string | null; claimType: string;
  status: string; version: number; category?: CaseCategory | null; parties: Party[]; schedules: Schedule[];
  activityTimeline?: Activity[];
}
interface Kpi { totalCases: number; inProgressCount: number; reviewingDocsCount: number; todayTasksCount: number; delayedCount: number }

interface DocumentVersion {
  id: string; versionNumber: number; displayName: string; fileSize: number;
  mimeType: string; sha256: string; isFinal: boolean; uploadedBy?: { name: string }; createdAt?: string;
}
interface CaseDocument {
  id: string; title: string; category?: string; source: string; currentVersionId?: string;
  versions: DocumentVersion[]; createdAt: string;
}

interface MeetingActionItem {
  id: string; title: string; assignee?: { name: string }; schedule?: { title: string; date: string }; dueDate?: string; status: string;
}
interface MeetingRecord {
  id: string; title: string; meetingDate: string; location?: string; attendees?: string;
  rawText?: string; summary?: string; decisions?: string; status: 'DRAFT' | 'FINAL'; version: number;
  createdBy?: { name: string }; actionItems: MeetingActionItem[]; createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  INQUIRY: '문의', PROPOSAL: '제안', ESTIMATE: '견적', CONTRACT: '계약', MATERIAL_RECEIVED: '자료접수',
  ANALYSIS: '분석', REPORT_DRAFTING: '보고서 작성', SUBMITTED: '제출', LITIGATION: '소송 진행',
  JUDGEMENT: '판결', SUCCESS_FEE: '성공보수 정산', CLOSED: '종결'
};
const STATUS_SEQUENCE = Object.keys(STATUS_LABELS);

function ErrorBox({ error }: { error: string }): React.ReactElement {
  return <div className="error-box" role="alert">{error}</div>;
}

function DashboardPage(): React.ReactElement {
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void apiRequest<Kpi>('/api/dashboard/kpi').then(setKpi).catch((reason: unknown) => setError(String(reason))); }, []);
  if (error) return <ErrorBox error={error} />;
  if (!kpi) return <p role="status">대시보드 데이터를 불러오는 중입니다.</p>;
  const cards = [
    ['오늘 해야 할 일', kpi.todayTasksCount], ['지연된 일', kpi.delayedCount], ['진행 중 사건', kpi.inProgressCount],
    ['검토할 문서', kpi.reviewingDocsCount], ['전체 접근 사건', kpi.totalCases]
  ];
  return <div className="kpi-grid" aria-label="사건관리 핵심 지표">{cards.map(([label, value]) => (
    <Card key={label} title={String(label)}><strong className="kpi-value" data-kpi={label}>{value}</strong></Card>
  ))}</div>;
}

function CaseListPage({ onNavigate }: { onNavigate: (path: string) => void }): React.ReactElement {
  const [query, setQuery] = useState('');
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async (q = query) => {
    setLoading(true); setError('');
    try {
      const result = await apiRequest<{ cases: CaseRecord[]; total: number }>(`/api/cases?limit=100&q=${encodeURIComponent(q)}`);
      setCases(result.cases); setTotal(result.total);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }, [query]);
  useEffect(() => { void load(''); }, []);

  const columns = useMemo(() => [
    { key: 'caseNumber', header: '사건번호' },
    { key: 'title', header: '사건명', render: (row: CaseRecord) => <span className="text-ellipsis table-title" title={row.title}>{row.title}</span> },
    { key: 'claimType', header: '유형' },
    { key: 'status', header: '상태', render: (row: CaseRecord) => STATUS_LABELS[row.status] ?? row.status },
    { key: 'action', header: '작업', render: (row: CaseRecord) => <Button size="sm" onClick={() => onNavigate(`/cases/detail?caseId=${encodeURIComponent(row.id)}`)}>상세 보기</Button> }
  ], [onNavigate]);

  return <div className="content-stack">
    <Card title={`접근 가능한 사건 ${total}건`}>
      <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void load(); }}>
        <Input label="사건명·사건번호·관계자 통합 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
        <Button type="submit">검색</Button>
        <Button type="button" variant="secondary" onClick={() => onNavigate('/cases/new')}>새 사건 등록</Button>
      </form>
    </Card>
    {error && <ErrorBox error={error} />}
    {loading ? <p role="status">사건 목록을 불러오는 중입니다.</p> : cases.length ? <Table columns={columns} data={cases} keyField="id" /> : <p className="empty-box">조건에 맞는 사건이 없습니다.</p>}
  </div>;
}

function CaseCreatePage({ onNavigate }: { onNavigate: (path: string) => void }): React.ReactElement {
  const [title, setTitle] = useState('');
  const [claimType, setClaimType] = useState('TYPE-01');
  const [description, setDescription] = useState('');
  const [major, setMajor] = useState('건설');
  const [middle, setMiddle] = useState('일반');
  const [minor, setMinor] = useState('기타');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const result = await apiRequest<{ case: CaseRecord }>('/api/cases', {
        method: 'POST', body: JSON.stringify({ title, claimType, description, category: { major, middle, minor } })
      });
      onNavigate(`/cases/detail?caseId=${encodeURIComponent(result.case.id)}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  return <Card title="6대 유형 사건 등록"><form className="form-stack" onSubmit={(event) => void submit(event)}>
    <Input label="사건명" value={title} maxLength={500} required onChange={(event) => setTitle(event.target.value)} />
    <Select label="6대 고정 클레임 유형" value={claimType} options={[...CLAIM_TYPES]} onChange={(event) => setClaimType(event.target.value)} />
    <Input label="대분류" value={major} required onChange={(event) => setMajor(event.target.value)} />
    <Input label="중분류" value={middle} required onChange={(event) => setMiddle(event.target.value)} />
    <Input label="소분류" value={minor} required onChange={(event) => setMinor(event.target.value)} />
    <Input label="사건 설명" value={description} onChange={(event) => setDescription(event.target.value)} />
    {error && <ErrorBox error={error} />}
    <Button type="submit" isLoading={saving}>사건 저장</Button>
  </form></Card>;
}

function MaterialsPage(): React.ReactElement {
  const caseId = new URLSearchParams(window.location.search).get('caseId') ?? 'CASE-SYN-001';
  const [documents, setDocuments] = useState<CaseDocument[]>([]);
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('RECEIVED');
  const [category, setCategory] = useState('EVIDENCE');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await apiRequest<{ documents: CaseDocument[] }>(`/api/cases/${encodeURIComponent(caseId)}/documents`);
      setDocuments(res.documents);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setError('업로드할 파일을 선택하세요.'); return; }
    setUploading(true); setError('');
    try {
      const arrayBuf = await file.arrayBuffer();
      const base64 = Buffer.from(arrayBuf).toString('base64');
      await apiRequest(`/api/cases/${encodeURIComponent(caseId)}/documents`, {
        method: 'POST',
        body: JSON.stringify({
          title, source, category, filename: file.name, fileBase64: base64, mimeType: file.type || 'application/octet-stream'
        })
      });
      setTitle(''); setFile(null); await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setUploading(false); }
  };

  const handleFinalize = async (docId: string, versionId: string) => {
    setError('');
    try {
      await apiRequest(`/api/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(docId)}/finalize`, {
        method: 'POST', body: JSON.stringify({ versionId })
      });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  return <div className="content-stack">
    <Card title="신규 자료/문서 업로드 (v01)">
      <form className="form-stack" onSubmit={(e) => void handleUpload(e)}>
        <Input label="문서 제목" value={title} required onChange={(e) => setTitle(e.target.value)} />
        <Select label="출처 구분" value={source} onChange={(e) => setSource(e.target.value)} options={[
          { value: 'RECEIVED', label: '수신' }, { value: 'AUTHORED', label: '작성' }, { value: 'SUBMITTED', label: '제출' }
        ]} />
        <Select label="문서 카테고리" value={category} onChange={(e) => setCategory(e.target.value)} options={[
          { value: 'PROPOSAL', label: '제안서' }, { value: 'EVIDENCE', label: '증거자료' }, { value: 'CONTRACT', label: '계약서' }, { value: 'ETC', label: '기타' }
        ]} />
        <Input label="첨부 파일 선택" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {error && <ErrorBox error={error} />}
        <Button type="submit" isLoading={uploading}>문서 업로드</Button>
      </form>
    </Card>

    <Card title={`사건 문서 및 버전 이력 (${documents.length}건)`}>
      {documents.length === 0 ? <p className="empty-box">등록된 문서가 없습니다.</p> : (
        <ul className="doc-list">{documents.map((doc) => (
          <li key={doc.id} className="doc-item">
            <div>
              <strong>{doc.title}</strong> ({doc.source} · {doc.category})
              <ul className="version-sublist">
                {doc.versions.map((ver) => (
                  <li key={ver.id}>
                    {ver.displayName} (v{String(ver.versionNumber).padStart(2, '0')})
                    {ver.isFinal && <span className="badge badge-final"> [최종본]</span>}
                    <Button size="sm" variant="secondary" onClick={() => void handleFinalize(doc.id, ver.id)}>최종본 지정</Button>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}</ul>
      )}
    </Card>
  </div>;
}

function MeetingsPage(): React.ReactElement {
  const caseId = new URLSearchParams(window.location.search).get('caseId') ?? 'CASE-SYN-001';
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [title, setTitle] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [location, setLocation] = useState('');
  const [attendees, setAttendees] = useState('');
  const [rawText, setRawText] = useState('');
  const [summary, setSummary] = useState('');
  const [decisions, setDecisions] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await apiRequest<{ meetings: MeetingRecord[] }>(`/api/cases/${encodeURIComponent(caseId)}/meetings`);
      setMeetings(res.meetings);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await apiRequest(`/api/cases/${encodeURIComponent(caseId)}/meetings`, {
        method: 'POST',
        body: JSON.stringify({
          title, meetingDate: new Date(meetingDate).toISOString(), location, attendees, rawText, summary, decisions
        })
      });
      setTitle(''); setMeetingDate(''); setLocation(''); setAttendees(''); setRawText(''); setSummary(''); setDecisions('');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSaving(false); }
  };

  const handleFinalize = async (meetingId: string) => {
    setError('');
    try {
      await apiRequest(`/api/cases/${encodeURIComponent(caseId)}/meetings/${encodeURIComponent(meetingId)}/finalize`, {
        method: 'POST', body: JSON.stringify({})
      });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  return <div className="content-stack">
    <Card title="신규 회의록 등록 (Draft)">
      <form className="form-stack" onSubmit={(e) => void handleCreate(e)}>
        <Input label="회의 제목" value={title} required onChange={(e) => setTitle(e.target.value)} />
        <Input label="회의 일시" type="datetime-local" value={meetingDate} required onChange={(e) => setMeetingDate(e.target.value)} />
        <Input label="장소" value={location} onChange={(e) => setLocation(e.target.value)} />
        <Input label="참석자" value={attendees} onChange={(e) => setAttendees(e.target.value)} />
        <Input label="회의 원문 텍스트" value={rawText} onChange={(e) => setRawText(e.target.value)} />
        <Input label="핵심 요약" value={summary} onChange={(e) => setSummary(e.target.value)} />
        <Input label="의결 사항" value={decisions} onChange={(e) => setDecisions(e.target.value)} />
        {error && <ErrorBox error={error} />}
        <Button type="submit" isLoading={saving}>회의록 등록</Button>
      </form>
    </Card>

    <Card title={`회의록 목록 (${meetings.length}건)`}>
      {meetings.length === 0 ? <p className="empty-box">등록된 회의록이 없습니다.</p> : (
        <ul className="meeting-list">{meetings.map((m) => (
          <li key={m.id} className="meeting-item">
            <div>
              <strong>{m.title}</strong> ({new Date(m.meetingDate).toLocaleString('ko-KR')}) - <span className={`badge status-${m.status}`}>{m.status}</span>
              <p className="muted">요약: {m.summary || '없음'} · 결정: {m.decisions || '없음'}</p>
              {m.status === 'DRAFT' && <Button size="sm" onClick={() => void handleFinalize(m.id)}>회의록 확정 (FINAL)</Button>}
            </div>
          </li>
        ))}</ul>
      )}
    </Card>
  </div>;
}

function CaseDetailPage({ section, onNavigate }: { section: 'overview' | 'parties' | 'schedules'; onNavigate: (path: string) => void }): React.ReactElement {
  const caseId = new URLSearchParams(window.location.search).get('caseId') ?? 'CASE-SYN-001';
  const [record, setRecord] = useState<CaseRecord | null>(null);
  const [error, setError] = useState('');
  const [partyName, setPartyName] = useState('');
  const [scheduleTitle, setScheduleTitle] = useState('');
  const [scheduleType, setScheduleType] = useState('COURT');
  const [scheduleDate, setScheduleDate] = useState('');
  const load = useCallback(async () => {
    setError('');
    try { setRecord((await apiRequest<{ case: CaseRecord }>(`/api/cases/${encodeURIComponent(caseId)}`)).case); }
    catch (reason) { setError(reason instanceof ApiError && reason.status === 403 ? '403 사건 접근 권한이 없습니다.' : reason instanceof Error ? reason.message : String(reason)); }
  }, [caseId]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <ErrorBox error={error} />;
  if (!record) return <p role="status">사건 상세를 불러오는 중입니다.</p>;

  const addParty = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    try {
      await apiRequest(`/api/cases/${encodeURIComponent(caseId)}/parties`, { method: 'POST', body: JSON.stringify({ name: partyName, role: 'OTHER' }) });
      setPartyName(''); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const addSchedule = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    try {
      await apiRequest(`/api/cases/${encodeURIComponent(caseId)}/schedules`, {
        method: 'POST', body: JSON.stringify({ title: scheduleTitle, type: scheduleType, date: new Date(scheduleDate).toISOString() })
      });
      setScheduleTitle(''); setScheduleDate(''); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const advanceStatus = async () => {
    const index = STATUS_SEQUENCE.indexOf(record.status);
    const toStatus = STATUS_SEQUENCE[index + 1];
    if (!toStatus) return;
    try {
      await apiRequest(`/api/cases/${encodeURIComponent(caseId)}/status`, {
        method: 'POST', body: JSON.stringify({ toStatus, reason: 'UI workflow transition', version: record.version })
      });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  return <div className="content-stack">
    <Card title={`${record.caseNumber} · ${record.title}`}>
      <p><strong>유형:</strong> {record.claimType} · <strong>상태:</strong> {STATUS_LABELS[record.status] ?? record.status} · <strong>버전:</strong> {record.version}</p>
      <p><strong>분류:</strong> {record.category ? `${record.category.major} > ${record.category.middle} > ${record.category.minor}` : '미분류'}</p>
      <div className="action-row">
        <Button size="sm" variant={section === 'overview' ? 'primary' : 'secondary'} onClick={() => onNavigate(`/cases/detail?caseId=${caseId}`)}>개요</Button>
        <Button size="sm" variant={section === 'schedules' ? 'primary' : 'secondary'} onClick={() => onNavigate(`/cases/schedule?caseId=${caseId}`)}>일정</Button>
        <Button size="sm" variant={section === 'parties' ? 'primary' : 'secondary'} onClick={() => onNavigate(`/cases/parties?caseId=${caseId}`)}>관계자</Button>
        <Button size="sm" variant="secondary" onClick={() => onNavigate(`/cases/files?caseId=${caseId}`)}>자료실</Button>
        <Button size="sm" variant="secondary" onClick={() => onNavigate(`/meetings?caseId=${caseId}`)}>회의록</Button>
      </div>
    </Card>
    {error && <ErrorBox error={error} />}
    {section === 'overview' && <>
      <Card title="사건 생애주기"><Button onClick={() => void advanceStatus()} disabled={record.status === 'CLOSED'}>다음 단계로 이동</Button></Card>
      <Card title="활동 타임라인"><Timeline items={(record.activityTimeline ?? []).map((item) => ({ id: item.id, title: item.title, timestamp: new Date(item.createdAt).toLocaleString('ko-KR'), description: item.description ?? undefined }))} /></Card>
    </>}
    {section === 'parties' && <Card title={`관계자 ${record.parties.length}명`}>
      <ul>{record.parties.map((party) => <li key={party.id}>{party.name} · {party.role} · {party.contact ?? '연락처 없음'}</li>)}</ul>
      <form className="inline-form" onSubmit={(event) => void addParty(event)}><Input label="새 관계자 이름" value={partyName} required onChange={(event) => setPartyName(event.target.value)} /><Button type="submit">관계자 추가</Button></form>
    </Card>}
    {section === 'schedules' && <Card title={`기일 ${record.schedules.length}건`}>
      <ul>{record.schedules.slice(0, 20).map((schedule) => <li key={schedule.id}>{schedule.dDayInfo?.dDayStr ?? ''} · {schedule.type} · {schedule.title}</li>)}</ul>
      {record.schedules.length > 20 && <p className="muted">최근 20건을 표시합니다. 전체 {record.schedules.length}건</p>}
      <form className="inline-form" onSubmit={(event) => void addSchedule(event)}>
        <Input label="새 기일 제목" value={scheduleTitle} required onChange={(event) => setScheduleTitle(event.target.value)} />
        <Select label="기일 유형" value={scheduleType} onChange={(event) => setScheduleType(event.target.value)} options={[{ value: 'COURT', label: '법원' }, { value: 'CLIENT', label: '고객' }, { value: 'INTERNAL', label: '내부' }]} />
        <Input label="기일 일시" type="datetime-local" value={scheduleDate} required onChange={(event) => setScheduleDate(event.target.value)} />
        <Button type="submit">기일 추가</Button>
      </form>
    </Card>}
  </div>;
}

export function CaseManagement({ routeId, onNavigate }: { routeId: string; onNavigate: (path: string) => void }): React.ReactElement {
  if (routeId === 'DASH-01') return <DashboardPage />;
  if (routeId === 'CASE-01') return <CaseListPage onNavigate={onNavigate} />;
  if (routeId === 'CASE-02') return <CaseCreatePage onNavigate={onNavigate} />;
  if (routeId === 'CASE-03') return <CaseDetailPage section="overview" onNavigate={onNavigate} />;
  if (routeId === 'CASE-04') return <CaseDetailPage section="schedules" onNavigate={onNavigate} />;
  if (routeId === 'CASE-05') return <CaseDetailPage section="parties" onNavigate={onNavigate} />;
  if (routeId === 'CASE-06') return <MaterialsPage />;
  if (routeId === 'MEET-01') return <MeetingsPage />;
  return <CaseDetailPage section="parties" onNavigate={onNavigate} />;
}
