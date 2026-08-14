import React, { useCallback, useEffect, useState } from 'react';
import { Button, Drawer, SkipLink } from '@claim-studio/ui';
import { ROUTES, canAccessRoute, type UserRole } from '../routes/Router';

const NAVIGATION_GROUPS: readonly {
  label: string;
  eyebrow: string;
  icon: 'home' | 'proposal' | 'work' | 'library' | 'court' | 'quality' | 'admin';
  routeIds: readonly string[];
  allowedRoles?: readonly UserRole[];
}[] = [
  { label: 'CLAIM CENTER HOME', eyebrow: 'HOME', icon: 'home', routeIds: ['DASH-01'] },
  { label: '프로젝트 제안 및 수주', eyebrow: 'PROPOSAL & AWARD', icon: 'proposal', routeIds: ['CASE-02', 'PROP-02', 'WF-02'] },
  { label: '프로젝트 워크', eyebrow: 'PROJECT WORK', icon: 'work', routeIds: ['PROJ-01', 'WF-03', 'WF-04', 'WF-05', 'REPO-02'] },
  { label: '클레임센터 자료실', eyebrow: 'EVIDENCE LIBRARY', icon: 'library', routeIds: ['CASE-06'] },
  { label: '법원 자료', eyebrow: 'COURT & LITIGATION', icon: 'court', routeIds: ['POST-01'] },
  { label: '검토·납품·품질관리', eyebrow: 'QUALITY & DELIVERY', icon: 'quality', routeIds: ['APPR-01', 'REPO-01', 'OUTCOME-01'] },
  { label: '관리자 설정', eyebrow: 'ADMIN ONLY', icon: 'admin', routeIds: ['TPL-01', 'AI-01', 'INTEG-01', 'USER-01', 'AUD-01'], allowedRoles: ['admin'] }
];

const NavigationGroupIcon: React.FC<{ name: (typeof NAVIGATION_GROUPS)[number]['icon'] }> = ({ name }) => {
  const paths: Record<typeof name, React.ReactNode> = {
    home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v10h13V10M9 20v-6h6v6" /></>,
    proposal: <><path d="M5 3h10l4 4v14H5z" /><path d="M15 3v5h4M8 12h8M8 16h5" /><path d="m7 7 1 1 2-2" /></>,
    work: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M8 5V3h8v2M3 11h18M9 11v2h6v-2" /></>,
    library: <><path d="M4 5.5 12 3l8 2.5V19l-8 2-8-2z" /><path d="M12 3v18M4 9l8 2 8-2M4 14l8 2 8-2" /></>,
    court: <><path d="M3 9h18M5 9v9m4-9v9m6-9v9m4-9v9M2 21h20M12 3l9 4H3z" /></>,
    quality: <><path d="M12 3 5 6v5c0 4.7 2.8 8.2 7 10 4.2-1.8 7-5.3 7-10V6z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    admin: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0M18 4l1-1m-1 9 1 1M6 4 5 3M6 12l-1 1" /></>
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
};

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
          <header>
            <span className="navigation-group-icon"><NavigationGroupIcon name={group.icon} /></span>
            <div><span>{group.eyebrow}</span><h2>{group.label}</h2></div>
          </header>
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
