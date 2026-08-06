import React, { useState } from 'react';
import { Button, Card, ComponentCatalog, Dialog, Input, Select, StateView, StatusBadge } from '@claim-studio/ui';
import { CaseManagement } from '../case-management/CaseManagement';

export const USER_ROLES = ['ceo', 'director', 'pm', 'staff', 'reviewer', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const CLAIM_TYPES = [
  { value: 'TYPE-01', label: 'TYPE-01: 현장조사 및 수량산출 클레임' },
  { value: 'TYPE-02', label: 'TYPE-02: 분석 보고서 작성 클레임' },
  { value: 'TYPE-03', label: 'TYPE-03: 일반적인 클레임' },
  { value: 'TYPE-04', label: 'TYPE-04: 재건축·재개발 공사비 협상' },
  { value: 'TYPE-05', label: 'TYPE-05: 사감정보고서 (TEMPLATE_NOT_FOUND)' },
  { value: 'TYPE-06', label: 'TYPE-06: 물가변동' }
] as const;

export interface RouteConfig {
  id: string;
  path: string;
  name: string;
  allowedRoles?: readonly UserRole[];
}

const ADMIN_ONLY: readonly UserRole[] = ['admin'];
const AUDIT_ROLES: readonly UserRole[] = ['ceo', 'director', 'admin'];
const FINANCE_ROLES: readonly UserRole[] = ['ceo', 'director', 'pm'];
const CASE_CREATE_ROLES: readonly UserRole[] = ['ceo', 'director', 'pm', 'admin'];

export const ROUTES: RouteConfig[] = [
  { id: 'AUTH-01', path: '/login', name: '로그인' },
  { id: 'DASH-01', path: '/dashboard', name: '메인 대시보드' },
  { id: 'CASE-01', path: '/cases', name: '사건 목록' },
  { id: 'CASE-02', path: '/cases/new', name: '새 사건 등록', allowedRoles: CASE_CREATE_ROLES },
  { id: 'CASE-03', path: '/cases/detail', name: '사건 상세-개요' },
  { id: 'CASE-04', path: '/cases/schedule', name: '사건 상세-일정' },
  { id: 'CASE-05', path: '/cases/parties', name: '사건 상세-관계자' },
  { id: 'CASE-06', path: '/cases/files', name: '사건 상세-자료실' },
  { id: 'MEET-01', path: '/meetings', name: '회의록' },
  { id: 'PROP-01', path: '/proposals/templates', name: '제안서 템플릿 선택' },
  { id: 'PROP-02', path: '/proposals/editor', name: '제안서 단계형 작성기' },
  { id: 'REPO-01', path: '/reports', name: '보고서 목록' },
  { id: 'REPO-02', path: '/reports/studio', name: '보고서 스튜디오' },
  { id: 'APPR-01', path: '/approval', name: '검토·승인함' },
  { id: 'FEE-01', path: '/success-fee', name: '성공보수', allowedRoles: FINANCE_ROLES },
  { id: 'TPL-01', path: '/templates', name: '템플릿 관리' },
  { id: 'AI-01', path: '/ai-config', name: 'AI 공급자 설정', allowedRoles: ADMIN_ONLY },
  { id: 'USER-01', path: '/users', name: '사용자·권한', allowedRoles: ADMIN_ONLY },
  { id: 'AUD-01', path: '/audit-logs', name: '감사로그', allowedRoles: AUDIT_ROLES },
  { id: 'RESP-01', path: '/tablet-responsive', name: '태블릿·컴포넌트 카탈로그' }
];

export const routeByPath = (path: string): RouteConfig | undefined => ROUTES.find((route) => route.path === path);
export const canAccessRoute = (route: RouteConfig, roles: UserRole | readonly UserRole[]): boolean => {
  const activeRoles = Array.isArray(roles) ? roles : [roles];
  return !route.allowedRoles || activeRoles.some((role) => route.allowedRoles?.includes(role));
};
export const isSafeReturnTo = (path: string): boolean => path.startsWith('/') && !path.startsWith('//') && Boolean(routeByPath(path));

export const reviewerCapabilities = {
  uploadEvidence: true,
  editReportBody: false,
  approveSection: true,
  mergeFinalDocument: false
} as const;

export interface RouterProps {
  currentPath: string;
  roles: UserRole[];
  onNavigate: (path: string) => void;
}

const ForbiddenRoute: React.FC<{ route: RouteConfig; onNavigate: (path: string) => void }> = ({ route, onNavigate }) => (
  <section className="route-message" aria-labelledby="forbidden-title">
    <h2 id="forbidden-title">403 Forbidden</h2>
    <p>{route.name} 화면에 접근할 권한이 없습니다. 서버/API 권한은 P04에서 별도로 강제됩니다.</p>
    <Button onClick={() => onNavigate('/dashboard')}>대시보드로 이동</Button>
  </section>
);

const ReportStudioActions: React.FC<{ roles: UserRole[] }> = ({ roles }) => {
  const [showEditForbidden, setShowEditForbidden] = useState(false);
  const reviewer = roles.includes('reviewer');
  return (
    <Card title="Reviewer RBAC 행동 계약">
      <p className="muted">Reviewer는 스튜디오를 열람할 수 있지만 본문 편집과 최종 병합은 할 수 없습니다.</p>
      <label htmlFor="report-body">보고서 초안 본문</label>
      <textarea
        id="report-body"
        className="report-editor"
        defaultValue="합성 테스트 사건의 보고서 초안입니다. 실제 고객정보를 포함하지 않습니다."
        readOnly={reviewer}
        aria-readonly={reviewer}
        onClick={() => reviewer && setShowEditForbidden(true)}
      />
      <div className="action-row" aria-label="보고서 권한별 작업">
        <Button>검토자료 업로드</Button>
        <Button variant="secondary" disabled={reviewer}>본문 저장</Button>
        <Button variant="secondary">장 1차 승인</Button>
        <Button variant="danger" disabled={reviewer}>최종 DOCX/PDF 병합</Button>
      </div>
      <Dialog isOpen={showEditForbidden} title="403 본문 편집 권한 없음" onClose={() => setShowEditForbidden(false)}>
        Reviewer는 댓글과 수정 요청만 작성할 수 있습니다. 본문 변경은 저장되지 않습니다.
      </Dialog>
    </Card>
  );
};

export const RouterView: React.FC<RouterProps> = ({ currentPath, roles, onNavigate }) => {
  const [uiState, setUiState] = useState<'normal' | 'loading' | 'empty' | 'error' | 'forbidden'>('normal');
  const currentRoute = routeByPath(currentPath);

  if (!currentRoute) {
    return (
      <section className="route-message" aria-labelledby="not-found-title">
        <h2 id="not-found-title">404 Not Found</h2>
        <p>요청한 경로({currentPath})를 찾을 수 없습니다.</p>
        <Button onClick={() => onNavigate('/dashboard')}>대시보드로 이동</Button>
      </section>
    );
  }
  if (!canAccessRoute(currentRoute, roles)) return <ForbiddenRoute route={currentRoute} onNavigate={onNavigate} />;
  if (currentRoute.id === 'RESP-01') return <ComponentCatalog />;

  if (['DASH-01', 'CASE-01', 'CASE-02', 'CASE-03', 'CASE-04', 'CASE-05'].includes(currentRoute.id)) {
    return <section className="route-view" aria-labelledby="route-title"><div className="route-heading"><h2 id="route-title">{currentRoute.name} <small>({currentRoute.id})</small></h2></div><CaseManagement routeId={currentRoute.id} onNavigate={onNavigate} /></section>;
  }

  return (
    <section className="route-view" aria-labelledby="route-title">
      <div className="route-heading">
        <h2 id="route-title">{currentRoute.name} <small>({currentRoute.id})</small></h2>
        <div className="state-controls" aria-label="화면 상태 미리보기">
          {(['normal', 'loading', 'empty', 'error', 'forbidden'] as const).map((state) => (
            <Button key={state} size="sm" variant="secondary" onClick={() => setUiState(state)}>{state === 'forbidden' ? '403' : state}</Button>
          ))}
        </div>
      </div>

      <StateView state={uiState} onRetry={() => setUiState('normal')}>
        <div className="content-stack">
          <Card title={`화면 계약: ${currentRoute.id}`}>
            <div className="form-stack">
              <Select label="6대 고정 클레임 유형 선택" options={[...CLAIM_TYPES]} />
              <Input label="사건·문서 검색" placeholder="검색어를 입력하세요" />
              <div className="action-row"><StatusBadge status="approved" /><StatusBadge status="ai_draft" /><StatusBadge status="review" /></div>
              <p className="muted">현재 서버 역할: <strong>{roles.join(', ').toUpperCase()}</strong> · 화면과 API가 동일한 서버 세션 권한을 사용합니다.</p>
            </div>
          </Card>
          {currentRoute.id === 'REPO-02' && <ReportStudioActions roles={roles} />}
        </div>
      </StateView>
    </section>
  );
};
