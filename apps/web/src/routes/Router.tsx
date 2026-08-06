import React, { useState } from 'react';
import { Button, Input, Select, StateView, StatusBadge, Card, Drawer } from '@claim-studio/ui';

export type UserRole = 'admin' | 'pm' | 'worker' | 'reviewer' | 'legal' | 'guest';

export interface RouteConfig {
  id: string;
  path: string;
  name: string;
  requiresEdit?: boolean;
}

export const ROUTES: RouteConfig[] = [
  { id: 'AUTH-01', path: '/login', name: '로그인' },
  { id: 'DASH-01', path: '/dashboard', name: '메인 대시보드' },
  { id: 'CASE-01', path: '/cases', name: '사건 목록' },
  { id: 'CASE-02', path: '/cases/new', name: '새 사건 등록' },
  { id: 'CASE-03', path: '/cases/detail', name: '사건 상세-개요' },
  { id: 'CASE-04', path: '/cases/schedule', name: '사건 상세-일정' },
  { id: 'CASE-05', path: '/cases/parties', name: '사건 상세-관계자' },
  { id: 'CASE-06', path: '/cases/files', name: '사건 상세-자료실' },
  { id: 'MEET-01', path: '/meetings', name: '회의록' },
  { id: 'PROP-01', path: '/proposals/templates', name: '제안서 템플릿 선택' },
  { id: 'PROP-02', path: '/proposals/editor', name: '제안서 단계형 작성기' },
  { id: 'REPO-01', path: '/reports', name: '보고서 목록' },
  { id: 'REPO-02', path: '/reports/studio', name: '보고서 스튜디오', requiresEdit: true },
  { id: 'APPR-01', path: '/approval', name: '검토·승인함' },
  { id: 'FEE-01', path: '/success-fee', name: '성공보수' },
  { id: 'TPL-01', path: '/templates', name: '템플릿 관리' },
  { id: 'AI-01', path: '/ai-config', name: 'AI 공급자 설정' },
  { id: 'USER-01', path: '/users', name: '사용자·권한' },
  { id: 'AUD-01', path: '/audit-logs', name: '감사로그' },
  { id: 'RESP-01', path: '/tablet-responsive', name: '태블릿 축약 화면' }
];

export interface RouterProps {
  currentPath: string;
  userRole: UserRole;
  onNavigate: (path: string) => void;
}

export const RouterView: React.FC<RouterProps> = ({ currentPath, userRole, onNavigate }) => {
  const [uiState, setUiState] = useState<'normal' | 'loading' | 'empty' | 'error' | 'forbidden'>('normal');

  const currentRoute = ROUTES.find((r) => r.path === currentPath);

  // 1. Unrecognized route: 404 Not Found
  if (!currentRoute) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h2>404 Not Found</h2>
        <p>요청하신 라우트({currentPath})를 찾을 수 없습니다.</p>
        <Button onClick={() => onNavigate('/dashboard')}>대시보드로 이동</Button>
      </div>
    );
  }

  // 2. Reviewer Direct Edit Guard: HTTP 403 Forbidden
  if (userRole === 'reviewer' && currentRoute.requiresEdit) {
    return (
      <div style={{ padding: '32px', background: 'rgba(15,23,42,0.95)', border: '1px solid hsl(346, 87%, 60%)', borderRadius: '8px', textAlign: 'center' }}>
        <h3 style={{ color: 'hsl(346, 87%, 60%)' }}>🔒 Reviewer 역할 권한 제한 (HTTP 403 Forbidden)</h3>
        <p style={{ color: '#94a3b8' }}>Reviewer 역할은 보고서 초안 본문 직접 편집 권한이 차단되어 있습니다. (댓글 및 1차 승인만 허용)</p>
        <Button onClick={() => onNavigate('/approval')}>검토·승인함으로 이동</Button>
      </div>
    );
  }

  const claimTypeOptions = [
    { value: 'TYPE-01', label: 'TYPE-01: 현장조사 및 수량산출 클레임' },
    { value: 'TYPE-02', label: 'TYPE-02: 분석 보고서 작성 클레임' },
    { value: 'TYPE-03', label: 'TYPE-03: 일반적인 클레임' },
    { value: 'TYPE-04', label: 'TYPE-04: 재건축·재개발 공사비 협상' },
    { value: 'TYPE-05', label: 'TYPE-05: 사감정보고서 (TEMPLATE_NOT_FOUND)' },
    { value: 'TYPE-06', label: 'TYPE-06: 물가변동' }
  ];

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2>{currentRoute.name} ({currentRoute.id})</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button size="sm" variant="secondary" onClick={() => setUiState('normal')}>Normal</Button>
          <Button size="sm" variant="secondary" onClick={() => setUiState('loading')}>Loading</Button>
          <Button size="sm" variant="secondary" onClick={() => setUiState('empty')}>Empty</Button>
          <Button size="sm" variant="secondary" onClick={() => setUiState('error')}>Error</Button>
          <Button size="sm" variant="secondary" onClick={() => setUiState('forbidden')}>403</Button>
        </div>
      </div>

      <StateView state={uiState} onRetry={() => setUiState('normal')}>
        <Card title={`Screen Contract: ${currentRoute.id}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '500px' }}>
            <Select label="6대 고정 클레임 유형 선택 (TYPE-01 ~ TYPE-06)" options={claimTypeOptions} />
            <Input label="사건/문서 검색" placeholder="검색어를 입력하세요..." />
            <div style={{ display: 'flex', gap: '8px' }}>
              <StatusBadge status="approved" />
              <StatusBadge status="ai_draft" />
              <StatusBadge status="review" />
            </div>
            <p style={{ fontSize: '14px', color: '#cbd5e1' }}>
              현재 사용자 역할: <strong style={{ color: '#38bdf8' }}>{userRole.toUpperCase()}</strong>  
              <br />
              (P04 서버/API 권한 경계 연결 대상 클라이언트 셸 렌더링 정상)
            </p>
          </div>
        </Card>
      </StateView>
    </div>
  );
};
