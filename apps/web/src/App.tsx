import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input } from '@claim-studio/ui';
import { apiRequest } from './api';
import { AppShell } from './layout/AppShell';
import { isSafeReturnTo, RouterView, type UserRole } from './routes/Router';

interface SessionUser {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  roles: UserRole[];
  previewMode?: boolean;
}

const isSessionUser = (value: unknown): value is SessionUser => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SessionUser>;
  return typeof candidate.id === 'string'
    && typeof candidate.email === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.organizationId === 'string'
    && Array.isArray(candidate.roles);
};


const currentBrowserPath = () => window.location.pathname;

export const App: React.FC = () => {
  const [currentPath, setCurrentPath] = useState(currentBrowserPath);
  const [session, setSession] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [previewMode, setPreviewMode] = useState(false);

  const navigate = useCallback((path: string, replace = false) => {
    const url = new URL(path, window.location.origin);
    if (replace) window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    else window.history.pushState(null, '', `${url.pathname}${url.search}`);
    setCurrentPath(url.pathname);
  }, []);
  useEffect(() => {
    const restoreFromHistory = () => setCurrentPath(currentBrowserPath());
    window.addEventListener('popstate', restoreFromHistory);
    return () => window.removeEventListener('popstate', restoreFromHistory);
  }, []);

  useEffect(() => {
    void apiRequest<SessionUser>('/auth/session')
      .then((user) => {
        const restored = isSessionUser(user) ? user : null;
        setSession(restored);
        setPreviewMode(restored?.previewMode === true);
      })
      .catch(() => setSession(null))
      .finally(() => setCheckingSession(false));
  }, []);

  const expireSession = async () => {
    try { await apiRequest('/auth/logout', { method: 'POST' }); } catch { /* Session may already be invalid. */ }
    const returnTo = isSafeReturnTo(currentPath) && currentPath !== '/login' ? currentPath : '/dashboard';
    setSession(null);
    setPreviewMode(false);
    navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  };

  const login = async (event: React.FormEvent) => {
    event.preventDefault(); setLoginError('');
    try {
      await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ loginId, password }) });
      const user = await apiRequest<SessionUser>('/auth/session');
      if (!isSessionUser(user)) throw new Error('Invalid session response');
      setSession(user);
      setPreviewMode(user.previewMode === true);
      const requested = new URLSearchParams(window.location.search).get('returnTo') ?? '/dashboard';
      navigate(isSafeReturnTo(requested) && requested !== '/login' ? requested : '/dashboard', true);
    } catch (reason) {
      setLoginError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  if (checkingSession) return <main className="login-page"><p role="status">세션을 확인하는 중입니다.</p></main>;

  if (!session || currentPath === '/login') {
    return (
      <main className="login-page" id="main-content">
        <Card title="클레임센터 스튜디오">
          <form className="form-stack" onSubmit={(event) => void login(event)}>
            <span className="workspace-eyebrow">SECURE MEMBER ACCESS</span>
            <h1>CLAIM CENTER<br />STUDIO</h1>
            <p className="muted">서버 세션과 조직·역할 권한으로 로그인합니다.</p>
            <Input label="아이디" type="text" value={loginId} autoComplete="username" onChange={(event) => setLoginId(event.target.value)} />
            <Input label="비밀번호" type="password" value={password} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} />
            {loginError && <p role="alert" className="error-box">{loginError}</p>}
            <Button type="submit">로그인</Button>
          </form>
        </Card>
      </main>
    );
  }

  return (
    <AppShell currentPath={currentPath} roles={session.roles} userName={session.name} previewMode={previewMode} onNavigate={navigate} onExpireSession={() => void expireSession()}>
      <RouterView currentPath={currentPath} roles={session.roles} userName={session.name} previewMode={previewMode} onNavigate={navigate} />
    </AppShell>
  );
};

export default App;
