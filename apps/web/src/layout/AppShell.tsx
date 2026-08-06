import React, { useCallback, useEffect, useState } from 'react';
import { Button, Drawer, Select, SkipLink } from '@claim-studio/ui';
import { ROUTES, UserRole } from '../routes/Router';

export interface AppShellProps {
  currentPath: string;
  userRole: UserRole;
  onNavigate: (path: string) => void;
  onRoleChange: (role: UserRole) => void;
  onExpireSession: () => void;
  children: React.ReactNode;
}

const roleOptions: Array<{ value: UserRole; label: string }> = [
  { value: 'ceo', label: '대표 (CEO)' },
  { value: 'director', label: '본부장/센터장' },
  { value: 'pm', label: 'PM (Project Manager)' },
  { value: 'staff', label: '실무자 (Staff)' },
  { value: 'reviewer', label: '검토자 (Reviewer)' },
  { value: 'admin', label: '시스템 관리자' }
];

export const AppShell: React.FC<AppShellProps> = ({
  currentPath,
  userRole,
  onNavigate,
  onRoleChange,
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
          <Select
            value={userRole}
            onChange={(event) => onRoleChange(event.target.value as UserRole)}
            options={roleOptions}
            aria-label="사용자 역할 선택"
          />
          <Button size="sm" variant="ghost" onClick={onExpireSession}>세션 만료 테스트</Button>
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
