import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input } from '@claim-studio/ui';
import { AppShell } from './layout/AppShell';
import { isSafeReturnTo, RouterView, UserRole } from './routes/Router';

const currentBrowserPath = () => window.location.pathname;

export const App: React.FC = () => {
  const [currentPath, setCurrentPath] = useState(currentBrowserPath);
  const [userRole, setUserRole] = useState<UserRole>('pm');
  const [authenticated, setAuthenticated] = useState(() => currentBrowserPath() !== '/login');

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

  const expireSession = () => {
    const returnTo = isSafeReturnTo(currentPath) && currentPath !== '/login' ? currentPath : '/dashboard';
    setAuthenticated(false);
    navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  };

  const login = () => {
    const requested = new URLSearchParams(window.location.search).get('returnTo') ?? '/dashboard';
    const destination = isSafeReturnTo(requested) && requested !== '/login' ? requested : '/dashboard';
    setAuthenticated(true);
    navigate(destination, true);
  };

  if (!authenticated || currentPath === '/login') {
    return (
      <main className="login-page" id="main-content">
        <Card title="클레임센터 보고서 스튜디오 로그인">
          <div className="form-stack">
            <p className="muted">P03 합성 세션 화면입니다. 실제 인증과 세션 검증은 P04에서 연결합니다.</p>
            <Input label="이메일" type="email" defaultValue="pm@example.invalid" />
            <Input label="비밀번호" type="password" defaultValue="synthetic-only" />
            <Button onClick={login}>테스트 세션으로 로그인</Button>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <AppShell
      currentPath={currentPath}
      userRole={userRole}
      onNavigate={navigate}
      onRoleChange={setUserRole}
      onExpireSession={expireSession}
    >
      <RouterView currentPath={currentPath} userRole={userRole} onNavigate={navigate} />
    </AppShell>
  );
};

export default App;
