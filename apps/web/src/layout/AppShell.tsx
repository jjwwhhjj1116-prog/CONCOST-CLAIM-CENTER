import React, { useCallback, useEffect, useState } from 'react';
import { Button, Drawer, SkipLink } from '@claim-studio/ui';
import { ROUTES, type UserRole } from '../routes/Router';

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
      {ROUTES.filter((route) => route.id !== 'AUTH-01').map((route) => (
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
    </nav>
  );

  return (
    <div className="app-shell">
      <SkipLink targetId="main-content" />
      <header className="topbar">
        <div className="brand-group">
          {isTablet && <Button size="sm" variant="secondary" onClick={() => setIsDrawerOpen(true)} aria-label="메인 메뉴 드로어 열기">☰ 메뉴</Button>}
          <h1>클레임센터 보고서 스튜디오</h1>
        </div>
        <div className="session-tools">
          <span aria-label="현재 사용자 역할">{userName} · {roles.join(', ').toUpperCase()}</span>
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
