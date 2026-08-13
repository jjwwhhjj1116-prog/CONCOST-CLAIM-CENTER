import { Button, Card, Select, StatusBadge } from '@claim-studio/ui';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest } from '../api';
import { StatusFeedbackState } from '../layout/StatusFeedbackState';

interface AiSettings {
  providerKind: 'OPENAI'; modelCode: string; reasoningEffort: string; version: number;
  updatedAt: string; updatedByName: string; apiKeyConfigured: boolean;
}
interface ChapterPrompt {
  id: string; chapterCode: string; title: string; agentCode: string; rolePrompt: string;
  instructionPrompt: string; ordinal: number; version: number; updatedAt: string; updatedBy: string;
}
interface PromptSet {
  claimType: string; name: string; status: string; systemPrompt: string; chapters: ChapterPrompt[];
}
interface AdminPromptPayload { settings: AiSettings; promptSets: PromptSet[] }

export function PreviewAiAdmin(): React.ReactElement {
  const [payload, setPayload] = useState<AdminPromptPayload | null>(null);
  const [selectedType, setSelectedType] = useState('TYPE-01');
  const [selectedChapter, setSelectedChapter] = useState('');
  const [modelCode, setModelCode] = useState('gpt-5.6');
  const [reasoningEffort, setReasoningEffort] = useState('medium');
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
      setPayload(next); setModelCode(next.settings.modelCode); setReasoningEffort(next.settings.reasoningEffort);
      const type = next.promptSets.some((entry) => entry.claimType === selectedType) ? selectedType : next.promptSets[0]?.claimType ?? '';
      setSelectedType(type);
      setSelectedChapter((current) => next.promptSets.find((entry) => entry.claimType === type)?.chapters.some((chapter) => chapter.id === current) ? current : next.promptSets.find((entry) => entry.claimType === type)?.chapters[0]?.id ?? '');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);
  const promptSet = useMemo(() => payload?.promptSets.find((entry) => entry.claimType === selectedType) ?? null, [payload, selectedType]);
  const chapter = useMemo(() => promptSet?.chapters.find((entry) => entry.id === selectedChapter) ?? null, [promptSet, selectedChapter]);

  useEffect(() => {
    if (!chapter) { setRolePrompt(''); setInstructionPrompt(''); return; }
    setRolePrompt(chapter.rolePrompt); setInstructionPrompt(chapter.instructionPrompt);
  }, [chapter?.id, chapter?.version]);

  const changeType = (value: string) => {
    const next = payload?.promptSets.find((entry) => entry.claimType === value);
    setSelectedType(value); setSelectedChapter(next?.chapters[0]?.id ?? ''); setNotice(''); setError('');
  };

  const saveSettings = async () => {
    if (!payload) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ settings: AiSettings }>('/api/admin/report-prompts/settings', { method: 'PUT', body: JSON.stringify({ modelCode, reasoningEffort, expectedVersion: payload.settings.version }) });
      setPayload({ ...payload, settings: result.settings });
      setNotice('AI 모델 설정을 저장했습니다. API Key 원문은 Cloudflare Secret에서만 관리됩니다.');
    } catch (reason) { setError(reason instanceof ApiError && reason.status === 409 ? '다른 관리자가 설정을 변경했습니다. 새로고침 후 다시 시도하세요.' : reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };

  const savePrompt = async () => {
    if (!payload || !chapter) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ prompt: { rolePrompt: string; instructionPrompt: string; version: number; updatedAt: string } }>(`/api/admin/report-prompts/${selectedType}/${chapter.chapterCode}`, { method: 'PUT', body: JSON.stringify({ rolePrompt, instructionPrompt, expectedVersion: chapter.version }) });
      setPayload({ ...payload, promptSets: payload.promptSets.map((set) => set.claimType !== selectedType ? set : { ...set, chapters: set.chapters.map((item) => item.id !== chapter.id ? item : { ...item, ...result.prompt, updatedBy: '현재 관리자' }) }) });
      setNotice(`${chapter.chapterCode} 프롬프트 v${result.prompt.version}을 저장했습니다. 작성자 화면에는 원문이 노출되지 않습니다.`);
    } catch (reason) { setError(reason instanceof ApiError && reason.status === 409 ? '다른 관리자가 프롬프트를 변경했습니다. 새로고침 후 다시 시도하세요.' : reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };

  if (loading) return <StatusFeedbackState type="loading" message="관리자 전용 보고서 프롬프트를 불러오고 있습니다." />;
  if (!payload) return <StatusFeedbackState type="error" title="AI 설정을 불러오지 못했습니다" message={error || 'D1 마이그레이션 상태를 확인해 주세요.'} actionLabel="다시 시도" onAction={() => void load()} />;

  return <div className="content-stack report-ai-admin" aria-label="관리자 전용 보고서 AI 설정">
    <Card title="REPORT AI · SERVER-ONLY CONFIGURATION">
      <div className="report-ai-admin__header"><div><p className="eyebrow">ADMIN CONTROL PLANE</p><h2>보고서 모델과 챕터 프롬프트</h2><p className="muted">작성자는 사건 자료만 입력합니다. 모델 선택·프롬프트 원문·API Key는 관리자와 서버만 다룹니다.</p></div><StatusBadge status={payload.settings.apiKeyConfigured ? 'approved' : 'review'} /></div>
      <div className={payload.settings.apiKeyConfigured ? 'notice-box' : 'error-box'} role="status">{payload.settings.apiKeyConfigured ? 'OPENAI_API_KEY 서버 Secret 연결됨 · 브라우저/D1 노출 없음' : 'OPENAI_API_KEY 미연결 · 프롬프트와 모델 설정은 완료됐지만 실제 자동 작성은 비활성화됩니다.'}</div>
      <div className="report-ai-admin__settings">
        <Select label="보고서 생성 모델" value={modelCode} onChange={(event) => setModelCode(event.target.value)} options={[{ value: 'gpt-5.6', label: 'GPT-5.6 · 최신 최고 성능 기본값' }, { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol · 최고 성능 고정' }, { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra · 성능/비용 균형' }, { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna · 대량 초안용' }]} />
        <Select label="추론 강도" value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value)} options={['low','medium','high','xhigh','max'].map((value) => ({ value, label: value.toUpperCase() }))} />
        <Button onClick={() => void saveSettings()} disabled={saving || (modelCode === payload.settings.modelCode && reasoningEffort === payload.settings.reasoningEffort)}>{saving ? '저장 중…' : '모델 설정 저장'}</Button>
      </div>
      <p className="muted">현재 v{payload.settings.version} · {payload.settings.updatedByName} · {new Date(payload.settings.updatedAt).toLocaleString('ko-KR')}</p>
    </Card>
    <Card title="TYPE별 챕터 프롬프트 편집">
      <div className="report-ai-admin__settings"><Select label="보고서 유형" value={selectedType} onChange={(event) => changeType(event.target.value)} options={payload.promptSets.map((entry) => ({ value: entry.claimType, label: `${entry.claimType} · ${entry.name}` }))} /><Select label="챕터" value={selectedChapter} disabled={!promptSet?.chapters.length} onChange={(event) => setSelectedChapter(event.target.value)} options={(promptSet?.chapters ?? []).map((entry) => ({ value: entry.id, label: `${entry.chapterCode} · ${entry.title}` }))} /></div>
      {promptSet?.status === 'TEMPLATE_NOT_FOUND' ? <div className="error-box">TYPE-05는 승인된 전용 템플릿이 없어 자동 생성을 시작하지 않습니다. 다른 유형 프롬프트로 대체하지 않습니다.</div> : chapter ? <div className="form-stack report-ai-admin__editor">
        <div className="notice-box"><strong>{chapter.agentCode} · {chapter.chapterCode} {chapter.title}</strong><br />프롬프트 v{chapter.version} · 마지막 변경 {new Date(chapter.updatedAt).toLocaleString('ko-KR')} · {chapter.updatedBy}</div>
        <label htmlFor="chapter-role-prompt">챕터 작성자 역할</label><textarea id="chapter-role-prompt" value={rolePrompt} maxLength={5000} onChange={(event) => setRolePrompt(event.target.value)} />
        <label htmlFor="chapter-instruction-prompt">챕터 작성 지시</label><textarea id="chapter-instruction-prompt" value={instructionPrompt} maxLength={10000} onChange={(event) => setInstructionPrompt(event.target.value)} />
        <div className="action-row"><Button onClick={() => void savePrompt()} disabled={saving || rolePrompt.trim().length < 20 || instructionPrompt.trim().length < 20}>{saving ? '저장 중…' : '새 프롬프트 버전 저장'}</Button><span className="muted">변경 이력은 D1에 append-only로 보존됩니다.</span></div>
      </div> : <p className="empty-box">편집할 챕터가 없습니다.</p>}
      {notice && <p className="notice-box" role="status">{notice}</p>}{error && <p className="error-box" role="alert">{error}</p>}
    </Card>
  </div>;
}
