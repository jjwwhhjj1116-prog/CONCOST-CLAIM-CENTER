import { Button, Card, StatusBadge } from '@claim-studio/ui';
import { useEffect, useState } from 'react';
import { ApiError, apiRequest } from '../api';
import { StatusFeedbackState } from '../layout/StatusFeedbackState';
import { PreviewGoogleDriveSetup } from './PreviewEvidenceHub';
import type { UserRole } from './Router';

type ProviderKind = 'OPENAI' | 'ANTHROPIC' | 'GEMINI';
type CredentialScope = 'USER' | 'ORGANIZATION';
type SettingsSection = 'PERSONAL' | 'ADMIN';

interface CredentialState {
  configured: boolean;
  storage: 'ENCRYPTED_D1' | 'CLOUDFLARE_SECRET' | 'NONE';
  version: number;
  updatedAt: string | null;
  fingerprint: string | null;
}
interface ProviderState { providerKind: ProviderKind; label: string; personal: CredentialState; organization: CredentialState }
interface SettingsPayload { personalPriority: boolean; masterKeyReady: boolean; canManageOrganization: boolean; providers: ProviderState[] }
interface WorkspacePolicy {
  organizationName: string;
  localAiMode: 'DISABLED' | 'PRIVATE_SERVER_BRIDGE';
  memoryProvider: 'NONE' | 'HERMES_AGENT';
  memoryApprovalMode: 'ADMIN_REVIEW' | 'DISABLED';
  shortTermMemoryEnabled: boolean;
  longTermMemoryEnabled: boolean;
  version: number;
  updatedAt: string | null;
}
interface WorkspaceRuntime { localAi: string; hermes: string; memoryLearning: string; supportedLocalProviders: string[] }
interface MemoryCandidate {
  id: string; memoryScope: string; scopeKey: string; problemText: string; ruleText: string; tags: string[];
  analyzerCode: string; confidence: number; status: 'PENDING' | 'ACTIVE' | 'REJECTED' | 'DISABLED';
  version: number; createdAt: string; reviewedAt: string | null; feedbackText: string; chapterCode: string;
  caseNumber: string; caseTitle: string; createdByName: string;
}

const PROVIDER_COPY: Record<ProviderKind, {
  short: string; use: string; placeholder: string; issueUrl: string; guideUrl: string; issueSteps: readonly string[];
}> = {
  OPENAI: {
    short: 'ChatGPT', use: '목차 기획과 구조 설계', placeholder: 'OpenAI API Key',
    issueUrl: 'https://platform.openai.com/api-keys', guideUrl: 'https://platform.openai.com/docs/quickstart/make-your-first-api-request',
    issueSteps: ['OpenAI Platform에 로그인합니다.', 'API Keys에서 Create new secret key를 누릅니다.', '발급 직후 한 번만 보이는 키를 복사해 아래에 저장합니다.']
  },
  ANTHROPIC: {
    short: 'Claude', use: '장문 보고서 본문 작성', placeholder: 'Anthropic API Key',
    issueUrl: 'https://console.anthropic.com/settings/keys', guideUrl: 'https://docs.anthropic.com/en/docs/get-started',
    issueSteps: ['Anthropic Console에 로그인합니다.', 'Settings · API Keys에서 새 키를 만듭니다.', '복사한 키를 아래 입력란에 붙여 넣고 암호화 저장합니다.']
  },
  GEMINI: {
    short: 'Gemini', use: '글쓰기 도우미·문장 개선·사실 확인', placeholder: 'Google AI Studio API Key',
    issueUrl: 'https://aistudio.google.com/apikey', guideUrl: 'https://ai.google.dev/gemini-api/docs/api-key',
    issueSteps: ['Google AI Studio에 회사 또는 개인 Google 계정으로 로그인합니다.', 'API 키 만들기를 누르고 사용할 Google Cloud 프로젝트를 고릅니다.', '발급 키를 복사해 아래에 저장한 뒤 연결 확인을 누릅니다.']
  }
};

export function PreviewSettings({ roles, onNavigate }: { roles: UserRole[]; onNavigate: (path: string) => void }): React.ReactElement {
  const isAdmin = roles.includes('admin');
  const requestedSection = new URLSearchParams(window.location.search).get('section');
  const [section, setSection] = useState<SettingsSection>(requestedSection === 'admin' && isAdmin ? 'ADMIN' : 'PERSONAL');
  const [payload, setPayload] = useState<SettingsPayload | null>(null);
  const [workspace, setWorkspace] = useState<WorkspacePolicy | null>(null);
  const [runtime, setRuntime] = useState<WorkspaceRuntime | null>(null);
  const [memoryCandidates, setMemoryCandidates] = useState<MemoryCandidate[]>([]);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setPayload(await apiRequest<SettingsPayload>('/api/settings/ai-credentials'));
      if (isAdmin) {
        const [admin, memory] = await Promise.all([
          apiRequest<{ settings: WorkspacePolicy; runtime: WorkspaceRuntime }>('/api/settings/admin-workspace'),
          apiRequest<{ candidates: MemoryCandidate[] }>('/api/admin/report-memory')
        ]);
        setWorkspace(admin.settings);
        setRuntime(admin.runtime);
        setMemoryCandidates(memory.candidates);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const changeSection = (next: SettingsSection) => {
    if (next === 'ADMIN' && !isAdmin) return;
    setSection(next);
    window.history.replaceState({}, '', next === 'ADMIN' ? '/settings?section=admin' : '/settings');
  };
  const stateFor = (provider: ProviderState, scope: CredentialScope) => scope === 'USER' ? provider.personal : provider.organization;
  const inputKey = (provider: ProviderKind, scope: CredentialScope) => `${scope}:${provider}`;

  const saveKey = async (provider: ProviderState, scope: CredentialScope) => {
    const state = stateFor(provider, scope);
    const field = inputKey(provider.providerKind, scope);
    const key = keys[field]?.trim() ?? '';
    if (!key) return;
    setBusy(field); setError(''); setNotice('');
    try {
      const next = await apiRequest<SettingsPayload>(`/api/settings/ai-credentials/${provider.providerKind}`, {
        method: 'PUT', body: JSON.stringify({ scope, apiKey: key, expectedVersion: state.version })
      });
      setPayload(next);
      setKeys((current) => ({ ...current, [field]: '' }));
      setNotice(`${scope === 'USER' ? '개인' : '조직 공용'} ${PROVIDER_COPY[provider.providerKind].short} 키를 암호화해 저장했습니다.`);
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status === 409
        ? '다른 화면에서 설정이 변경되었습니다. 새로고침 후 다시 저장해 주세요.'
        : reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(''); }
  };

  const disableKey = async (provider: ProviderState, scope: CredentialScope) => {
    const state = stateFor(provider, scope);
    const field = inputKey(provider.providerKind, scope);
    setBusy(field); setError(''); setNotice('');
    try {
      setPayload(await apiRequest<SettingsPayload>(`/api/settings/ai-credentials/${provider.providerKind}`, {
        method: 'DELETE', body: JSON.stringify({ scope, expectedVersion: state.version })
      }));
      setNotice(`${PROVIDER_COPY[provider.providerKind].short} 키를 안전하게 비활성화했습니다.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  };

  const testKey = async (provider: ProviderState, scope: CredentialScope) => {
    const field = inputKey(provider.providerKind, scope);
    setBusy(`test:${field}`); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ source: string; checkedAt: string }>(`/api/settings/ai-credentials/${provider.providerKind}/test`, {
        method: 'POST', body: JSON.stringify({ scope })
      });
      setNotice(`${PROVIDER_COPY[provider.providerKind].short} 연결 확인 완료 · ${result.source} · ${new Date(result.checkedAt).toLocaleString('ko-KR')}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  };

  const saveWorkspace = async () => {
    if (!workspace) return;
    setBusy('workspace'); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ settings: WorkspacePolicy; runtime: WorkspaceRuntime }>('/api/settings/admin-workspace', {
        method: 'PUT', body: JSON.stringify({
          organizationName: workspace.organizationName,
          localAiMode: workspace.localAiMode,
          memoryProvider: workspace.memoryProvider,
          memoryApprovalMode: workspace.memoryApprovalMode,
          shortTermMemoryEnabled: workspace.shortTermMemoryEnabled,
          longTermMemoryEnabled: workspace.longTermMemoryEnabled,
          expectedVersion: workspace.version
        })
      });
      setWorkspace(result.settings); setRuntime(result.runtime); setNotice('관리자 워크스페이스 정책을 D1에 저장했습니다.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  };

  const decideMemory = async (candidate: MemoryCandidate, action: 'APPROVE' | 'REJECT' | 'DISABLE') => {
    setBusy(`memory:${candidate.id}`); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ candidates: MemoryCandidate[] }>(`/api/admin/report-memory/${candidate.id}`, {
        method: 'PUT', body: JSON.stringify({
          action, expectedVersion: candidate.version,
          note: action === 'APPROVE' ? '관리자 검토 후 다음 생성에 반영' : action === 'REJECT' ? '관리자 검토에서 반영 제외' : '관리자에 의해 비활성화'
        })
      });
      setMemoryCandidates(result.candidates);
      setNotice(action === 'APPROVE' ? 'Memory를 승인했습니다.' : action === 'DISABLE' ? '활성 Memory를 비활성화했습니다.' : '학습 후보를 반려했습니다.');
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status === 409 ? '다른 관리자가 먼저 처리했습니다. 다시 불러와 주세요.' : reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(''); }
  };

  if (loading) return <StatusFeedbackState type="loading" message="설정과 연결 상태를 불러오고 있습니다." />;
  if (!payload) return <StatusFeedbackState type="error" title="설정을 불러오지 못했습니다" message={error || '잠시 후 다시 시도해 주세요.'} actionLabel="다시 시도" onAction={() => void load()} />;

  const renderCredentials = (scope: CredentialScope, title: string, detail: string) => <Card title={title} className="credential-settings-card">
    <header className="credential-settings-card__intro">
      <div><p>{detail}</p><small>{scope === 'USER' ? '개인키가 있으면 조직 공용키보다 먼저 사용합니다.' : '개인키가 없는 사용자에게만 공용키가 사용됩니다.'}</small></div>
      <StatusBadge status={scope === 'USER' ? 'review' : 'approved'} />
    </header>
    <div className="credential-provider-grid">
      {payload.providers.map((provider) => {
        const state = stateFor(provider, scope);
        const field = inputKey(provider.providerKind, scope);
        const copy = PROVIDER_COPY[provider.providerKind];
        const isBusy = busy === field || busy === `test:${field}`;
        return <section key={provider.providerKind} data-provider={provider.providerKind} data-configured={state.configured}>
          <header><span>{copy.short.slice(0, 2).toUpperCase()}</span><div><h3>{provider.label}</h3><p>{copy.use}</p></div><strong>{state.configured ? '연결됨' : '키 필요'}</strong></header>
          <div className="credential-state"><span>{state.storage === 'ENCRYPTED_D1' ? 'AES-256-GCM 암호화 저장' : state.storage === 'CLOUDFLARE_SECRET' ? 'Cloudflare 서버 Secret' : '저장된 키 없음'}</span>{state.fingerprint && <small>키 지문 {state.fingerprint}… · v{state.version}</small>}</div>
          <label htmlFor={`${field}-key`}>{state.configured ? '새 키로 교체' : 'API Key 입력'}</label>
          <input id={`${field}-key`} type="password" value={keys[field] ?? ''} autoComplete="new-password" spellCheck={false} placeholder={copy.placeholder} onChange={(event) => setKeys((current) => ({ ...current, [field]: event.target.value }))} />
          {!keys[field]?.trim() && <small className="credential-input-help">키 원문은 저장 후 다시 표시되지 않습니다.</small>}
          <div className="credential-key-actions">
            <div className="action-row">
              <Button onClick={() => void saveKey(provider, scope)} disabled={isBusy || !keys[field]?.trim()}>{isBusy ? '처리 중…' : state.configured ? '키 교체' : '암호화 저장'}</Button>
              <a href={copy.issueUrl} target="_blank" rel="noreferrer">API KEY 발급 ↗</a>
              {state.configured && <Button variant="secondary" onClick={() => void testKey(provider, scope)} disabled={isBusy}>연결 확인</Button>}
              {state.storage === 'ENCRYPTED_D1' && <Button variant="ghost" onClick={() => void disableKey(provider, scope)} disabled={isBusy}>비활성화</Button>}
            </div>
            <details className="credential-issue-guide"><summary>API KEY 발급방법</summary><ol>{copy.issueSteps.map((step) => <li key={step}>{step}</li>)}</ol><a href={copy.guideUrl} target="_blank" rel="noreferrer">공식 발급 가이드 열기 ↗</a></details>
          </div>
        </section>;
      })}
    </div>
  </Card>;

  return <div className="content-stack preview-settings" aria-label="설정">
    <section className="preview-settings-hero"><div><span>WORKSPACE CONTROL CENTER</span><h2>설정</h2><p>개인 API 키와 관리자 전용 회사 Drive·공용 AI·Memory 정책을 한곳에서 관리합니다.</p></div><div><strong>{payload.masterKeyReady ? '암호화 저장 준비됨' : '서버 암호화키 필요'}</strong><small>키 원문은 브라우저와 API 응답에 다시 표시하지 않습니다.</small></div></section>
    <nav className="settings-section-tabs" aria-label="설정 종류">
      <button type="button" className={section === 'PERSONAL' ? 'is-active' : ''} aria-current={section === 'PERSONAL' ? 'page' : undefined} onClick={() => changeSection('PERSONAL')}><span>PERSONAL</span><strong>개인 설정</strong><small>내 AI API 키·로컬 AI 안내</small></button>
      {isAdmin && <button type="button" className={section === 'ADMIN' ? 'is-active' : ''} aria-current={section === 'ADMIN' ? 'page' : undefined} onClick={() => changeSection('ADMIN')}><span>ADMIN ONLY</span><strong>관리자 설정</strong><small>회사 Drive·공용 AI·Hermes·사용자</small></button>}
    </nav>
    <section className="settings-access-strip" aria-label="현재 계정 설정 권한"><div><span>현재 로그인 역할</span><strong>{roles.map((role) => role.toUpperCase()).join(' · ') || 'USER'}</strong></div><p>{section === 'PERSONAL' ? '현재 화면의 API 키는 내 계정에만 적용됩니다.' : '조직 전체에 적용되는 관리자 전용 화면입니다.'}</p></section>

    {section === 'PERSONAL' && <>
      {renderCredentials('USER', '개인 AI 연결 설정', '내 계정에서만 사용하는 개인 API 키입니다. 관리자도 원문을 볼 수 없습니다.')}
      <Card title="로컬 AI 설정 가이드"><div className="local-ai-guide"><div><span>01</span><strong>로컬 모델 실행</strong><p>Ollama, LM Studio 또는 OpenAI Compatible 서버에서 모델을 실행합니다.</p><code>http://localhost:11434</code></div><div><span>02</span><strong>회사 서버 Bridge</strong><p>Cloudflare는 개인 PC localhost에 접근할 수 없어 추후 공유 서버의 HTTPS Bridge가 필요합니다.</p><code>HTTPS · VPN · 접근제어 필수</code></div><div><span>03</span><strong>관리자 활성화</strong><p>관리자 설정에서 PRIVATE_SERVER_BRIDGE와 Hermes 정책을 승인합니다.</p><code>현재 직접 호출 비활성</code></div></div></Card>
    </>}

    {section === 'ADMIN' && isAdmin && workspace && <>
      <PreviewGoogleDriveSetup onNavigate={onNavigate} />
      {renderCredentials('ORGANIZATION', '조직 공용 AI 설정', '개인 키가 없는 직원에게 적용되는 회사 공용 암호화 키입니다.')}
      <Card title="조직·로컬 AI·Hermes Memory 정책"><div className="workspace-policy-grid">
        <label>조직 표시명<input value={workspace.organizationName} maxLength={80} onChange={(event) => setWorkspace({ ...workspace, organizationName: event.target.value })} /></label>
        <label>로컬 AI 정책<select value={workspace.localAiMode} onChange={(event) => setWorkspace({ ...workspace, localAiMode: event.target.value as WorkspacePolicy['localAiMode'] })}><option value="DISABLED">비활성</option><option value="PRIVATE_SERVER_BRIDGE">회사 전용 Server Bridge 준비</option></select></label>
        <label>Memory Agent<select value={workspace.memoryProvider} onChange={(event) => setWorkspace({ ...workspace, memoryProvider: event.target.value as WorkspacePolicy['memoryProvider'], shortTermMemoryEnabled: false, longTermMemoryEnabled: false })}><option value="NONE">연결 안 함</option><option value="HERMES_AGENT">Hermes Agent 호환 계층</option></select></label>
        <label>학습 반영 방식<select value={workspace.memoryApprovalMode} onChange={(event) => setWorkspace({ ...workspace, memoryApprovalMode: event.target.value as WorkspacePolicy['memoryApprovalMode'] })}><option value="ADMIN_REVIEW">관리자 승인 후 반영</option><option value="DISABLED">학습 비활성</option></select></label>
        <label className="settings-check"><input type="checkbox" disabled={workspace.memoryProvider !== 'HERMES_AGENT'} checked={workspace.shortTermMemoryEnabled} onChange={(event) => setWorkspace({ ...workspace, shortTermMemoryEnabled: event.target.checked })} />프로젝트 단기기억 정책</label>
        <label className="settings-check"><input type="checkbox" disabled={workspace.memoryProvider !== 'HERMES_AGENT'} checked={workspace.longTermMemoryEnabled} onChange={(event) => setWorkspace({ ...workspace, longTermMemoryEnabled: event.target.checked })} />회사 장기기억 후보 정책</label>
      </div><div className="settings-runtime-status"><div><span>LOCAL AI</span><strong>{runtime?.localAi ?? 'DISABLED'}</strong></div><div><span>HERMES LAYER</span><strong>{runtime?.hermes ?? 'DISABLED'}</strong></div><div><span>LEARNING LOOP</span><strong>{runtime?.memoryLearning ?? 'FOUNDATION_ONLY'}</strong></div></div><p className="settings-honest-note"><strong>실제 학습 경계</strong>사람 수정본과 AI 초안의 차이를 구조화한 뒤 관리자 승인 후에만 다음 생성에 반영합니다.</p><div className="action-row"><Button onClick={() => void saveWorkspace()} disabled={busy === 'workspace'}>{busy === 'workspace' ? '저장 중…' : '관리자 정책 저장'}</Button></div></Card>
      <Card title={`AI Memory 관리 · ${memoryCandidates.filter((item) => item.status === 'PENDING').length}개 승인 대기`}><div className="memory-candidate-list">{memoryCandidates.length ? memoryCandidates.map((candidate) => <article key={candidate.id} data-memory-status={candidate.status}><header><div><span>{candidate.memoryScope} · {candidate.scopeKey}</span><strong>{candidate.caseNumber} · {candidate.chapterCode}</strong><small>{candidate.caseTitle} · {candidate.createdByName} · 신뢰도 {candidate.confidence}%</small></div><em>{candidate.status}</em></header><p><b>사용자 피드백</b> {candidate.feedbackText}</p><p><b>구조화 규칙</b> {candidate.ruleText}</p><div className="action-row">{candidate.status === 'PENDING' && <><Button onClick={() => void decideMemory(candidate, 'APPROVE')} disabled={busy === `memory:${candidate.id}`}>승인·반영</Button><Button variant="secondary" onClick={() => void decideMemory(candidate, 'REJECT')} disabled={busy === `memory:${candidate.id}`}>반려</Button></>}{candidate.status === 'ACTIVE' && <Button variant="secondary" onClick={() => void decideMemory(candidate, 'DISABLE')} disabled={busy === `memory:${candidate.id}`}>비활성화</Button>}</div></article>) : <p className="empty-box">아직 학습 후보가 없습니다.</p>}</div></Card>
      <Card title="관리자 기능"><div className="settings-admin-links"><button type="button" onClick={() => onNavigate('/ai-config')}><strong>챕터 프롬프트·모델</strong><small>유형·챕터별 관리자 프롬프트와 모델 설정</small></button><button type="button" onClick={() => onNavigate('/integrations/google')}><strong>Google Drive 상세 설정</strong><small>회사 계정 연결·계정 교체·연결 해제</small></button><button type="button" onClick={() => onNavigate('/users')}><strong>사용자·권한</strong><small>회원 계정과 역할 관리</small></button></div></Card>
    </>}

    {notice && <p className="notice-box" role="status">{notice}</p>}
    {error && <p className="error-box" role="alert">{error}</p>}
  </div>;
}
