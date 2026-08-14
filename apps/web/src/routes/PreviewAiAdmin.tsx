import { Button, Card, Select, StatusBadge } from '@claim-studio/ui';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest } from '../api';
import { StatusFeedbackState } from '../layout/StatusFeedbackState';

type ProviderKind = 'OPENAI' | 'ANTHROPIC' | 'GEMINI';
type TaskKind = 'OUTLINE_PLANNING' | 'CHAPTER_WRITING' | 'FACT_CHECK';
interface AiProvider { providerKind: ProviderKind; label: string; secretName: string; connected: boolean; models: Array<{ code: string; label: string }> }
interface AiRoute { taskKind: TaskKind; providerKind: ProviderKind; modelCode: string; reasoningEffort: string; version: number; updatedAt: string; updatedByName: string; connected: boolean }
interface AiConfig { providers: AiProvider[]; routes: AiRoute[] }
interface ChapterPrompt { id: string; chapterCode: string; title: string; agentCode: string; rolePrompt: string; instructionPrompt: string; ordinal: number; version: number; updatedAt: string; updatedBy: string }
interface PromptSet { claimType: string; name: string; status: string; systemPrompt: string; chapters: ChapterPrompt[] }
interface AdminPromptPayload { aiConfig: AiConfig; promptSets: PromptSet[] }

const TASK_LABELS: Record<TaskKind, { title: string; detail: string }> = {
  OUTLINE_PLANNING: { title: '목차 기획', detail: '보고서 구조와 챕터별 계획을 설계합니다.' },
  CHAPTER_WRITING: { title: '챕터 본문 작성', detail: '확정 목차와 사건 근거로 실제 보고서 문장을 작성합니다.' },
  FACT_CHECK: { title: '사실·근거 확인', detail: '수치·날짜·출처의 누락과 충돌을 점검합니다.' }
};

export function PreviewAiAdmin(): React.ReactElement {
  const [payload, setPayload] = useState<AdminPromptPayload | null>(null);
  const [routeDrafts, setRouteDrafts] = useState<Record<string, AiRoute>>({});
  const [selectedType, setSelectedType] = useState('TYPE-01');
  const [selectedChapter, setSelectedChapter] = useState('');
  const [rolePrompt, setRolePrompt] = useState('');
  const [instructionPrompt, setInstructionPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const next = await apiRequest<AdminPromptPayload>('/api/admin/report-prompts');
      setPayload(next); setRouteDrafts(Object.fromEntries(next.aiConfig.routes.map((route) => [route.taskKind, route])));
      const type = next.promptSets.some((entry) => entry.claimType === selectedType) ? selectedType : next.promptSets[0]?.claimType ?? '';
      setSelectedType(type);
      setSelectedChapter((current) => next.promptSets.find((entry) => entry.claimType === type)?.chapters.some((chapter) => chapter.id === current) ? current : next.promptSets.find((entry) => entry.claimType === type)?.chapters[0]?.id ?? '');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);
  const promptSet = useMemo(() => payload?.promptSets.find((entry) => entry.claimType === selectedType) ?? null, [payload, selectedType]);
  const chapter = useMemo(() => promptSet?.chapters.find((entry) => entry.id === selectedChapter) ?? null, [promptSet, selectedChapter]);
  useEffect(() => { setRolePrompt(chapter?.rolePrompt ?? ''); setInstructionPrompt(chapter?.instructionPrompt ?? ''); }, [chapter?.id, chapter?.version]);

  const provider = (kind: ProviderKind) => payload?.aiConfig.providers.find((item) => item.providerKind === kind);
  const changeRoute = (task: TaskKind, change: Partial<AiRoute>) => setRouteDrafts((current) => {
    const base = current[task]; if (!base) return current;
    const next = { ...base, ...change };
    if (change.providerKind) next.modelCode = provider(change.providerKind)?.models[0]?.code ?? '';
    return { ...current, [task]: next };
  });

  const saveRoute = async (task: TaskKind) => {
    const route = routeDrafts[task]; if (!payload || !route) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ settings: AiRoute; aiConfig: AiConfig }>('/api/admin/report-prompts/settings', { method: 'PUT', body: JSON.stringify({ taskKind: task, providerKind: route.providerKind, modelCode: route.modelCode, reasoningEffort: route.reasoningEffort, expectedVersion: route.version }) });
      setPayload({ ...payload, aiConfig: result.aiConfig });
      setRouteDrafts(Object.fromEntries(result.aiConfig.routes.map((item) => [item.taskKind, item])));
      setNotice(`${TASK_LABELS[task].title} 모델을 ${result.settings.providerKind} · ${result.settings.modelCode}로 저장했습니다.`);
    } catch (reason) { setError(reason instanceof ApiError && reason.status === 409 ? '다른 관리자가 설정을 변경했습니다. 새로고침 후 다시 시도하세요.' : reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };

  const changeType = (value: string) => { const next = payload?.promptSets.find((entry) => entry.claimType === value); setSelectedType(value); setSelectedChapter(next?.chapters[0]?.id ?? ''); setNotice(''); setError(''); };
  const savePrompt = async () => {
    if (!payload || !chapter) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ prompt: { rolePrompt: string; instructionPrompt: string; version: number; updatedAt: string } }>(`/api/admin/report-prompts/${selectedType}/${chapter.chapterCode}`, { method: 'PUT', body: JSON.stringify({ rolePrompt, instructionPrompt, expectedVersion: chapter.version }) });
      setPayload({ ...payload, promptSets: payload.promptSets.map((set) => set.claimType !== selectedType ? set : { ...set, chapters: set.chapters.map((item) => item.id !== chapter.id ? item : { ...item, ...result.prompt, updatedBy: '현재 관리자' }) }) });
      setNotice(`${chapter.chapterCode} 프롬프트 v${result.prompt.version}을 저장했습니다.`);
    } catch (reason) { setError(reason instanceof ApiError && reason.status === 409 ? '다른 관리자가 프롬프트를 변경했습니다. 새로고침 후 다시 시도하세요.' : reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };

  if (loading) return <StatusFeedbackState type="loading" message="관리자 전용 AI 라우팅과 프롬프트를 불러오고 있습니다." />;
  if (!payload) return <StatusFeedbackState type="error" title="AI 설정을 불러오지 못했습니다" message={error || 'D1 마이그레이션 상태를 확인해 주세요.'} actionLabel="다시 시도" onAction={() => void load()} />;
  const connectedCount = payload.aiConfig.providers.filter((item) => item.connected).length;

  return <div className="content-stack report-ai-admin" aria-label="관리자 전용 보고서 AI 설정">
    <Card title="REPORT AI · MULTI-MODEL ROUTER">
      <div className="report-ai-admin__header"><div><p className="eyebrow">ADMIN CONTROL PLANE</p><h2>업무별 AI 모델 라우팅</h2><p className="muted">목차 기획·본문 작성·사실확인을 각각 다른 공급자와 모델로 운영합니다. API Key 원문은 Cloudflare Secret에만 저장됩니다.</p></div><StatusBadge status={connectedCount ? 'approved' : 'review'} /></div>
      <div className="report-ai-admin__providers">{payload.aiConfig.providers.map((item) => <div key={item.providerKind} data-connected={item.connected}><strong>{item.label}</strong><span>{item.connected ? 'CONNECTED' : 'SECRET REQUIRED'}</span><small>{item.secretName} · 키 값 비공개</small></div>)}</div>
      <div className="report-ai-admin__routes">{(['OUTLINE_PLANNING','CHAPTER_WRITING','FACT_CHECK'] as TaskKind[]).map((task) => {
        const route = routeDrafts[task]; if (!route) return null;
        const selectedProvider = provider(route.providerKind);
        const canonical = payload.aiConfig.routes.find((item) => item.taskKind === task);
        const dirty = canonical?.providerKind !== route.providerKind || canonical?.modelCode !== route.modelCode || canonical?.reasoningEffort !== route.reasoningEffort;
        return <section key={task}><header><div><h3>{TASK_LABELS[task].title}</h3><p>{TASK_LABELS[task].detail}</p></div><span data-connected={Boolean(selectedProvider?.connected)}>{selectedProvider?.connected ? '사용 가능' : '키 연결 필요'}</span></header><div className="report-ai-admin__settings"><Select label="AI 공급자" value={route.providerKind} onChange={(event) => changeRoute(task, { providerKind: event.target.value as ProviderKind })} options={payload.aiConfig.providers.map((item) => ({ value: item.providerKind, label: item.label }))} /><Select label="모델" value={route.modelCode} onChange={(event) => changeRoute(task, { modelCode: event.target.value })} options={(selectedProvider?.models ?? []).map((item) => ({ value: item.code, label: item.label }))} /><Select label="추론 강도" value={route.reasoningEffort} onChange={(event) => changeRoute(task, { reasoningEffort: event.target.value })} options={['minimal','low','medium','high','xhigh','max'].map((value) => ({ value, label: value.toUpperCase() }))} /><Button onClick={() => void saveRoute(task)} disabled={saving || !dirty}>{saving ? '저장 중…' : '이 역할 저장'}</Button></div><small>v{route.version} · {route.updatedByName} · {new Date(route.updatedAt).toLocaleString('ko-KR')}</small></section>;
      })}</div>
      <div className="notice-box">현재 권장 구성: 목차는 ChatGPT, 본문은 Gemini로 먼저 검증하고 Claude API Key 연결 후 Claude Sonnet/Opus로 교체, 사실확인은 Gemini.</div>
    </Card>
    <Card title="TYPE별 챕터 프롬프트 편집">
      <div className="report-ai-admin__settings"><Select label="보고서 유형" value={selectedType} onChange={(event) => changeType(event.target.value)} options={payload.promptSets.map((entry) => ({ value: entry.claimType, label: `${entry.claimType} · ${entry.name}` }))} /><Select label="챕터" value={selectedChapter} disabled={!promptSet?.chapters.length} onChange={(event) => setSelectedChapter(event.target.value)} options={(promptSet?.chapters ?? []).map((entry) => ({ value: entry.id, label: `${entry.chapterCode} · ${entry.title}` }))} /></div>
      {promptSet?.status === 'TEMPLATE_NOT_FOUND' ? <div className="error-box">TYPE-05는 승인된 전용 템플릿이 없어 자동 생성을 시작하지 않습니다.</div> : chapter ? <div className="form-stack report-ai-admin__editor"><div className="notice-box"><strong>{chapter.agentCode} · {chapter.chapterCode} {chapter.title}</strong><br />프롬프트 v{chapter.version} · {chapter.updatedBy}</div><label htmlFor="chapter-role-prompt">챕터 작성자 역할</label><textarea id="chapter-role-prompt" value={rolePrompt} maxLength={5000} onChange={(event) => setRolePrompt(event.target.value)} /><label htmlFor="chapter-instruction-prompt">챕터 작성 지시</label><textarea id="chapter-instruction-prompt" value={instructionPrompt} maxLength={10000} onChange={(event) => setInstructionPrompt(event.target.value)} /><div className="action-row"><Button onClick={() => void savePrompt()} disabled={saving || rolePrompt.trim().length < 20 || instructionPrompt.trim().length < 20}>{saving ? '저장 중…' : '새 프롬프트 버전 저장'}</Button><span className="muted">변경 이력은 D1에 append-only로 보존됩니다.</span></div></div> : <p className="empty-box">편집할 챕터가 없습니다.</p>}
      {notice && <p className="notice-box" role="status">{notice}</p>}{error && <p className="error-box" role="alert">{error}</p>}
    </Card>
  </div>;
}
