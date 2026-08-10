import React, { useCallback, useEffect, useState } from 'react';
import { Button, Drawer, SkipLink } from '@claim-studio/ui';
import { ROUTES, canAccessRoute, type UserRole } from '../routes/Router';

const NAVIGATION_GROUPS = [
  { label: '홈', routeIds: ['DASH-01'] },
  { label: '사건 업무', routeIds: ['CASE-01', 'CASE-02', 'MEET-01'] },
  { label: '문서·보고서', routeIds: ['PROP-01', 'PROP-02', 'REPO-01', 'TPL-01', 'APPR-01'] },
  { label: '운영 관리', routeIds: ['FEE-01', 'AI-01', 'INTEG-01', 'USER-01', 'AUD-01', 'RESP-01'] }
] as const;

export interface AppShellProps {
  currentPath: string;
  roles: UserRole[];
  userName: string;
  onNavigate: (path: string) => void;
  onExpireSession: () => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  currentPath,
  roles,
  userName,
  onNavigate,
  onExpireSession,
  children
}) => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isTablet, setIsTablet] = useState(() => window.innerWidth <= 1024);
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), []);

  useEffect(() => {
    const handleResize = () => {
      const tablet = window.innerWidth <= 1024;
      setIsTablet(tablet);
      if (!tablet) setIsDrawerOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const go = (event: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    event.preventDefault();
    onNavigate(path);
    closeDrawer();
  };

  const navigation = (
    <nav className="navigation-list" aria-label="주요 화면">
      {NAVIGATION_GROUPS.map((group) => {
        const routes = group.routeIds
          .map((id) => ROUTES.find((route) => route.id === id))
          .filter((route) => route && canAccessRoute(route, roles));
        if (routes.length === 0) return null;
        return <section className="navigation-group" key={group.label} aria-label={group.label}>
          <h2>{group.label}</h2>
          {routes.map((route) => route && (
            <a
              key={route.id}
              href={route.path}
              onClick={(event) => go(event, route.path)}
              aria-current={currentPath === route.path ? 'page' : undefined}
              className="navigation-link"
            >
              <span className="text-ellipsis">{route.name}</span><small>{route.id}</small>
            </a>
          ))}
        </section>;
      })}
    </nav>
  );

  return (
    <div className="app-shell">
      <SkipLink targetId="main-content" />
      <header className="topbar">
        <div className="brand-group">
          {isTablet && <Button size="sm" variant="secondary" onClick={() => setIsDrawerOpen(true)} aria-label="메인 메뉴 드로어 열기">☰ 메뉴</Button>}
          <span className="brand-mark" aria-hidden="true">CC</span>
          <div className="brand-copy"><h1>클레임센터</h1><small>REPORT STUDIO</small></div>
        </div>
        <div className="session-tools">
          <span className="session-avatar" aria-hidden="true">{userName.slice(0, 1)}</span>
          <span className="session-identity" aria-label="현재 사용자 역할"><strong>{userName}</strong><small>{roles.join(', ').toUpperCase()}</small></span>
          <Button size="sm" variant="ghost" onClick={onExpireSession}>로그아웃</Button>
        </div>
      </header>

      <div className="shell-body">
        {!isTablet && <aside className="sidebar" aria-label="주요 내비게이션 사이드바">{navigation}</aside>}
        <Drawer isOpen={isDrawerOpen} onClose={closeDrawer} title="전체 내비게이션 메뉴">{navigation}</Drawer>
        <main id="main-content" className="main-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
};
