import React, { useState, useEffect } from 'react';
import { Button, Drawer, SkipLink, Select } from '@claim-studio/ui';
import { ROUTES, UserRole } from '../routes/Router';

export interface AppShellProps {
  currentPath: string;
  userRole: UserRole;
  onNavigate: (path: string) => void;
  onRoleChange: (role: UserRole) => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  currentPath,
  userRole,
  onNavigate,
  onRoleChange,
  children
}) => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isTablet, setIsTablet] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsTablet(window.innerWidth <= 1024);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const roleOptions: { value: UserRole; label: string }[] = [
    { value: 'pm', label: 'PM/대표변호사 (모든 권한)' },
    { value: 'reviewer', label: 'Reviewer (업로드O, 편집X, 승인O, 병합X)' },
    { value: 'worker', label: '실무 담당자' },
    { value: 'admin', label: '시스템 관리자' }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'hsl(222, 47%, 11%)' }}>
      <SkipLink targetId="main-content" />

      {/* 상단바 */}
      <header
        style={{
          height: '60px',
          background: 'rgba(15, 23, 42, 0.95)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {isTablet && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setIsDrawerOpen(true)}
              aria-label="메인 메뉴 드로어 열기"
            >
              ☰ 메뉴
            </Button>
          )}
          <h1 style={{ margin: 0, fontSize: '18px', color: '#f8fafc' }}>🏢 클레임센터 보고서 스튜디오</h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', maxWidth: '300px' }}>
          <Select
            label=""
            value={userRole}
            onChange={(e) => onRoleChange(e.target.value as UserRole)}
            options={roleOptions}
            aria-label="사용자 역할 선택"
          />
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1 }}>
        {/* 데스크톱 260px 사이드바 */}
        {!isTablet && (
          <aside
            style={{
              width: '260px',
              background: 'rgba(15, 23, 42, 0.8)',
              borderRight: '1px solid rgba(255, 255, 255, 0.1)',
              padding: '16px'
            }}
            aria-label="주요 내비게이션 사이드바"
          >
            <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {ROUTES.map((route) => (
                <button
                  key={route.id}
                  onClick={() => onNavigate(route.path)}
                  style={{
                    display: 'flex',
                    justify: 'space-between',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    background: currentPath === route.path ? 'hsl(217, 91%, 60%)' : 'transparent',
                    color: currentPath === route.path ? '#ffffff' : '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '13px',
                    textAlign: 'left'
                  }}
                >
                  <span className="text-ellipsis">{route.name}</span>
                  <span style={{ fontSize: '11px', opacity: 0.7 }}>{route.id}</span>
                </button>
              ))}
            </nav>
          </aside>
        )}

        {/* 1024px 태블릿 전용 복구 슬라이드 오버 Drawer */}
        <Drawer isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} title="전체 내비게이션 메뉴">
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {ROUTES.map((route) => (
              <Button
                key={route.id}
                variant={currentPath === route.path ? 'primary' : 'ghost'}
                onClick={() => {
                  onNavigate(route.path);
                  setIsDrawerOpen(false);
                }}
              >
                {route.name} ({route.id})
              </Button>
            ))}
          </nav>
        </Drawer>

        {/* 본문 라우트 Outlet 영역 */}
        <main id="main-content" style={{ flex: 1, overflowY: 'auto' }} role="main">
          {children}
        </main>
      </div>
    </div>
  );
};
