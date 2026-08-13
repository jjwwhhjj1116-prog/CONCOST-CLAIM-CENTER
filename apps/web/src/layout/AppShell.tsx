import React, { useCallback, useEffect, useState } from 'react';
import { Button, Drawer, SkipLink } from '@claim-studio/ui';
import { ROUTES, canAccessRoute, type UserRole } from '../routes/Router';

const NAVIGATION_GROUPS: readonly {
  label: string;
  eyebrow: string;
  routeIds: readonly string[];
  allowedRoles?: readonly UserRole[];
}[] = [
  { label: '업무 홈', eyebrow: 'WORKSPACE', routeIds: ['DASH-01'] },
  { label: '사건 관리', eyebrow: 'CLAIMS', routeIds: ['CASE-01', 'CASE-02'] },
  { label: '자료와 보고서', eyebrow: 'DOCUMENTS', routeIds: ['CASE-06', 'REPO-02', 'APPR-01'] },
  { label: '관리자 설정', eyebrow: 'ADMIN ONLY', routeIds: ['USER-01', 'INTEG-01'], allowedRoles: ['admin'] }
];

export interface AppShellProps {
  currentPath: string;
  roles: UserRole[];
  userName: string;
  onNavigate: (path: string) => void;
  previewMode?: boolean;
  onExpireSession: () => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  currentPath,
  roles,
  userName,
  onNavigate,
  previewMode = false,
  onExpireSession,
  children
}) => {
  const safeUserName = typeof userName === 'string' && userName.trim() ? userName.trim() : 'User';
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
      {NAVIGATION_GROUPS.filter((group) => !group.allowedRoles || group.allowedRoles.some((role) => roles.includes(role))).map((group) => {
        const routes = group.routeIds
          .map((id) => ROUTES.find((route) => route.id === id))
          .filter((route) => route && canAccessRoute(route, roles));
        if (routes.length === 0) return null;
        return <section className="navigation-group" key={group.label} aria-label={group.label}>
          <header><span>{group.eyebrow}</span><h2>{group.label}</h2></header>
          {routes.map((route) => route && (
            <a
              key={route.id}
              href={route.path}
              onClick={(event) => go(event, route.path)}
              aria-current={currentPath === route.path ? 'page' : undefined}
              className="navigation-link"
            >
              <span className="navigation-dot" aria-hidden="true" />
              <span className="text-ellipsis">{route.name}</span>
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
          <span className="brand-mark" aria-hidden="true">CS</span>
          <div className="brand-copy"><h1>클레임센터 스튜디오</h1><small>CLAIM CENTER STUDIO</small></div>
        </div>
        <div className="session-tools">
          {previewMode && <span className="preview-chip" aria-label="D1 로그인·사건·초안 저장 활성">CLOUD WORKSPACE · 자동저장</span>}
          <span className="session-avatar" aria-hidden="true">{safeUserName.slice(0, 1)}</span>
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
