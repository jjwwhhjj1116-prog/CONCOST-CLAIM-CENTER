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
  return <CaseDetailPage section="parties" onNavigate={onNavigate} />;
}
