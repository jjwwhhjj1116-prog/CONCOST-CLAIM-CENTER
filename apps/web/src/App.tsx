import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@claim-studio/ui';
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
  const [showPassword, setShowPassword] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
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
    event.preventDefault(); setLoginError(''); setIsLoggingIn(true);
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
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (checkingSession) return <main className="login-loading"><span className="login-spinner" aria-hidden="true" /><p role="status">보안 세션을 확인하는 중입니다.</p></main>;

  if (!session || currentPath === '/login') {
    return (
      <main className="login-page" id="main-content">
        <section className="login-visual" aria-labelledby="login-visual-title">
          <div className="login-visual-brand"><span>CS</span><strong>CONCOST · CLAIM INTELLIGENCE</strong></div>
          <div className="login-visual-copy">
            <span>CLAIM EVIDENCE · WORKFLOW · REPORT</span>
            <h1 id="login-visual-title">복잡한 클레임을<br />명확한 근거와<br />하나의 흐름으로.</h1>
            <p>프로젝트 접수부터 현장조사, 물량산출, 보고서 작성과 납품 이후 관리까지 연결하는 클레임 전문 워크스페이스입니다.</p>
            <div className="login-capabilities" aria-label="핵심 기능">
              <span>Evidence</span><span>Workflow</span><span>AI Authoring</span><span>Approval</span>
            </div>
          </div>
          <footer><span>CLAIM CENTER STUDIO</span><small>CONCOST GROUP · PROFESSIONAL WORKSPACE</small></footer>
        </section>

        <section className="login-panel" aria-labelledby="login-title">
          <div className="login-panel-inner">
            <header className="login-wordmark">
              <span className="login-wordmark-symbol" aria-hidden="true">CS</span>
              <div><strong>클레임센터 스튜디오</strong><small>CLAIM CENTER STUDIO</small></div>
            </header>

            <div className="login-heading">
              <span>SECURE MEMBER ACCESS</span>
              <h2 id="login-title">시스템 로그인</h2>
              <p>승인된 클레임센터 계정으로 로그인해 주세요.</p>
            </div>

            <div className="login-security-chip"><span aria-hidden="true">◇</span><strong>Organization & role protected</strong></div>

            <form className="login-form" onSubmit={(event) => void login(event)}>
              <label htmlFor="login-id">아이디</label>
              <div className="login-input-shell">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4zM4 7l8 6 8-6" /></svg>
                <input id="login-id" name="username" type="text" value={loginId} autoComplete="username" placeholder="아이디 입력" required autoFocus onChange={(event) => setLoginId(event.target.value)} />
              </div>

              <label htmlFor="login-password">비밀번호</label>
              <div className="login-input-shell">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V8a5 5 0 0 1 10 0v2M5 10h14v10H5zM12 14v2" /></svg>
                <input id="login-password" name="password" type={showPassword ? 'text' : 'password'} value={password} autoComplete="current-password" placeholder="비밀번호 입력" required onChange={(event) => setPassword(event.target.value)} />
                <button type="button" className="login-password-toggle" aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'} aria-pressed={showPassword} onClick={() => setShowPassword((current) => !current)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5z" /><circle cx="12" cy="12" r="2.4" /></svg>
                </button>
              </div>

              {loginError && <p role="alert" className="login-error">로그인 정보를 확인해 주세요. <small>{loginError}</small></p>}
              <Button type="submit" disabled={isLoggingIn || !loginId.trim() || !password}>
                <span>{isLoggingIn ? '보안 세션 연결 중…' : '로그인'}</span><span aria-hidden="true">→</span>
              </Button>
            </form>

            <div className="login-help"><span>계정 관련 문의는 클레임센터 관리자에게 요청해 주세요.</span><strong>AUTHORIZED USERS ONLY</strong></div>
          </div>
        </section>
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
