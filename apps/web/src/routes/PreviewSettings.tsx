import { Button, Card, StatusBadge } from '@claim-studio/ui';
import { useEffect, useState } from 'react';
import { ApiError, apiRequest } from '../api';
import { StatusFeedbackState } from '../layout/StatusFeedbackState';
import { PreviewGoogleDriveSetup } from './PreviewEvidenceHub';
import type { UserRole } from './Router';

type ProviderKind = 'OPENAI' | 'ANTHROPIC' | 'GEMINI';
type CredentialScope = 'USER' | 'ORGANIZATION';
interface CredentialState { configured: boolean; storage: 'ENCRYPTED_D1' | 'CLOUDFLARE_SECRET' | 'NONE'; version: number; updatedAt: string | null; fingerprint: string | null }
interface ProviderState { providerKind: ProviderKind; label: string; personal: CredentialState; organization: CredentialState }
interface SettingsPayload { personalPriority: boolean; masterKeyReady: boolean; canManageOrganization: boolean; providers: ProviderState[] }

const PROVIDER_COPY: Record<ProviderKind, { short: string; use: string; placeholder: string }> = {
  OPENAI: { short: 'ChatGPT', use: '목차 기획과 구조 설계', placeholder: 'OpenAI API Key' },
  ANTHROPIC: { short: 'Claude', use: '장문 보고서 본문 작성', placeholder: 'Anthropic API Key' },
  GEMINI: { short: 'Gemini', use: '글쓰기 도우미·문장 개선·사실 확인', placeholder: 'Google AI Studio API Key' }
};

export function PreviewSettings({ roles, onNavigate }: { roles: UserRole[]; onNavigate: (path: string) => void }): React.ReactElement {
  const [payload, setPayload] = useState<SettingsPayload | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true); setError('');
    try { setPayload(await apiRequest<SettingsPayload>('/api/settings/ai-credentials')); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const stateFor = (provider: ProviderState, scope: CredentialScope) => scope === 'USER' ? provider.personal : provider.organization;
  const inputKey = (provider: ProviderKind, scope: CredentialScope) => `${scope}:${provider}`;
  const save = async (provider: ProviderState, scope: CredentialScope) => {
    const state = stateFor(provider, scope); const key = keys[inputKey(provider.providerKind, scope)]?.trim() ?? '';
    if (!key) return;
    setBusy(inputKey(provider.providerKind, scope)); setError(''); setNotice('');
    try {
      const next = await apiRequest<SettingsPayload>(`/api/settings/ai-credentials/${provider.providerKind}`, { method: 'PUT', body: JSON.stringify({ scope, apiKey: key, expectedVersion: state.version }) });
      setPayload(next); setKeys((current) => ({ ...current, [inputKey(provider.providerKind, scope)]: '' }));
      setNotice(`${scope === 'USER' ? '내' : '조직 공용'} ${PROVIDER_COPY[provider.providerKind].short} 키를 암호화해 저장했습니다. 원문은 다시 표시되지 않습니다.`);
    } catch (reason) { setError(reason instanceof ApiError && reason.status === 409 ? '다른 화면에서 설정이 변경되었습니다. 새로고침 후 다시 저장해 주세요.' : reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  };
  const disable = async (provider: ProviderState, scope: CredentialScope) => {
    const state = stateFor(provider, scope); setBusy(inputKey(provider.providerKind, scope)); setError(''); setNotice('');
    try {
      setPayload(await apiRequest<SettingsPayload>(`/api/settings/ai-credentials/${provider.providerKind}`, { method: 'DELETE', body: JSON.stringify({ scope, expectedVersion: state.version }) }));
      setNotice(`${scope === 'USER' ? '개인' : '조직 공용'} ${PROVIDER_COPY[provider.providerKind].short} 키를 비활성화하고 저장 암호문을 덮어썼습니다.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  };
  const test = async (provider: ProviderState, scope: CredentialScope) => {
    setBusy(`test:${inputKey(provider.providerKind, scope)}`); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ source: string; checkedAt: string }>(`/api/settings/ai-credentials/${provider.providerKind}/test`, { method: 'POST', body: JSON.stringify({ scope }) });
      setNotice(`${PROVIDER_COPY[provider.providerKind].short} 연결 확인 완료 · ${result.source} · ${new Date(result.checkedAt).toLocaleString('ko-KR')}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  };

  if (loading) return <StatusFeedbackState type="loading" message="암호화된 내 AI 설정을 불러오고 있습니다." />;
  if (!payload) return <StatusFeedbackState type="error" title="설정을 불러오지 못했습니다" message={error || '잠시 후 다시 시도해 주세요.'} actionLabel="다시 시도" onAction={() => void load()} />;

  const renderScope = (scope: CredentialScope, title: string, detail: string) => <Card title={title} className="credential-settings-card">
    <header className="credential-settings-card__intro"><div><p>{detail}</p><small>{scope === 'USER' ? '개인키가 있으면 조직 공용키보다 먼저 사용합니다.' : '개인키가 없는 사용자에게만 공용키가 사용됩니다.'}</small></div><StatusBadge status={scope === 'USER' ? 'review' : 'approved'} /></header>
    <div className="credential-provider-grid">{payload.providers.map((provider) => {
      const state = stateFor(provider, scope); const field = inputKey(provider.providerKind, scope); const isBusy = busy === field || busy === `test:${field}`;
      return <section key={provider.providerKind} data-provider={provider.providerKind} data-configured={state.configured}>
        <header><span>{PROVIDER_COPY[provider.providerKind].short.slice(0, 2).toUpperCase()}</span><div><h3>{provider.label}</h3><p>{PROVIDER_COPY[provider.providerKind].use}</p></div><strong>{state.configured ? '연결됨' : '키 필요'}</strong></header>
        <div className="credential-state"><span>{state.storage === 'ENCRYPTED_D1' ? 'AES-256-GCM 암호화 저장' : state.storage === 'CLOUDFLARE_SECRET' ? 'Cloudflare 서버 Secret' : '저장된 키 없음'}</span>{state.fingerprint && <small>키 지문 {state.fingerprint}… · v{state.version}</small>}</div>
        <label htmlFor={`${field}-key`}>{state.configured ? '새 키로 교체' : 'API Key 입력'}</label>
        <input id={`${field}-key`} type="password" value={keys[field] ?? ''} autoComplete="new-password" spellCheck={false} placeholder={PROVIDER_COPY[provider.providerKind].placeholder} onChange={(event) => setKeys((current) => ({ ...current, [field]: event.target.value }))} />
        <div className="action-row"><Button onClick={() => void save(provider, scope)} disabled={isBusy || !(keys[field]?.trim())}>{isBusy ? '처리 중…' : state.configured ? '키 교체' : '암호화 저장'}</Button>{state.configured && <Button variant="secondary" onClick={() => void test(provider, scope)} disabled={isBusy}>연결 확인</Button>}{state.storage === 'ENCRYPTED_D1' && <Button variant="ghost" onClick={() => void disable(provider, scope)} disabled={isBusy}>비활성화</Button>}</div>
      </section>;
    })}</div>
  </Card>;

  return <div className="content-stack preview-settings" aria-label="개인 및 관리자 설정">
    <section className="preview-settings-hero"><div><span>SECURE WORKSPACE SETTINGS</span><h2>내 AI 도우미와 조직 연결을<br />한곳에서 관리합니다.</h2><p>키 원문은 저장 직후 사라지고, 브라우저·API 응답·D1에는 다시 표시되지 않습니다.</p></div><div><strong>{payload.masterKeyReady ? '암호화 저장 준비됨' : '서버 암호화키 필요'}</strong><small>개인 Gemini 키는 글쓰기와 문장 개선에서 자동 우선 사용</small></div></section>
    {!payload.masterKeyReady && <p className="error-box" role="alert">Cloudflare 암호화 Secret이 아직 준비되지 않아 새 키를 저장할 수 없습니다.</p>}
    {renderScope('USER', '내 AI 설정', '내 계정에서만 사용하는 개인 API 키입니다. 다른 사용자와 관리자에게도 원문이 보이지 않습니다.')}
    {payload.canManageOrganization && renderScope('ORGANIZATION', '관리자 · 조직 공용 AI 설정', '회사 공용으로 사용할 API 키입니다. Admin만 교체하거나 비활성화할 수 있습니다.')}
    {roles.includes('admin') && <Card title="관리자 연결 센터"><div className="settings-admin-links"><button type="button" onClick={() => onNavigate('/ai-config')}><strong>챕터 프롬프트·모델</strong><small>목차·본문·사실확인 모델과 역할 프롬프트 설정</small></button><button type="button" onClick={() => onNavigate('/integrations/google')}><strong>Google Drive</strong><small>회사 계정 OAuth 연결·재연결·해제</small></button><button type="button" onClick={() => onNavigate('/users')}><strong>사용자·권한</strong><small>회원 계정과 역할 관리</small></button></div></Card>}
    {roles.includes('admin') && <PreviewGoogleDriveSetup onNavigate={onNavigate} />}
    <p className="notice-box"><strong>실행 우선순위</strong> 내 키 → 조직 공용 암호화 키 → Cloudflare 서버 Secret. 내 키를 비활성화하면 자동으로 조직 공용 설정을 사용합니다.</p>
    {notice && <p className="notice-box" role="status">{notice}</p>}{error && <p className="error-box" role="alert">{error}</p>}
  </div>;
}
