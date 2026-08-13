import { Button, Card } from '@claim-studio/ui';
import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../api';
import { StatusFeedbackState } from '../layout/StatusFeedbackState';

interface WorkspaceUser {
  id: string;
  loginId: string;
  displayName: string;
  email: string;
  roles: string[];
  active: boolean;
  assignedCaseCount: number;
}

export function PreviewAdminUsers(): React.ReactElement {
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await apiRequest<{ users: WorkspaceUser[] }>('/api/admin/users');
      setUsers(result.users);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <StatusFeedbackState type="loading" message="사용자와 사건 배정 현황을 불러오고 있습니다." />;
  if (error) return <StatusFeedbackState type="error" title="사용자 목록을 불러오지 못했습니다" message={error} actionLabel="다시 시도" onAction={() => void load()} />;

  return (
    <section className="route-view admin-users" aria-labelledby="admin-users-title">
      <div className="workspace-hero">
        <div>
          <span className="workspace-eyebrow">ADMIN WORKSPACE</span>
          <h2 id="admin-users-title">사용자와 권한</h2>
          <p>회원 명단으로 등록된 계정과 역할, 접근 가능한 사건 수를 관리자만 확인할 수 있습니다. 비밀번호와 인증 정보는 화면에 표시하지 않습니다.</p>
        </div>
        <div className="admin-user-total"><strong>{users.filter((user) => user.active).length}</strong><span>ACTIVE USERS</span></div>
      </div>

      <Card title={`등록 계정 ${users.length}명`}>
        <div className="admin-user-list">
          {users.map((user) => (
            <article key={user.id}>
              <span className="admin-user-avatar" aria-hidden="true">{user.displayName.slice(0, 1)}</span>
              <div><strong>{user.displayName}</strong><small>{user.loginId} · {user.email}</small></div>
              <div className="admin-role-list">{user.roles.map((role) => <span key={role}>{role.toUpperCase()}</span>)}</div>
              <div className="admin-user-cases"><strong>{user.assignedCaseCount}</strong><small>배정 사건</small></div>
              <span className={user.active ? 'admin-user-status is-active' : 'admin-user-status'}>{user.active ? '활성' : '비활성'}</span>
            </article>
          ))}
        </div>
        <div className="admin-user-footer"><span>계정 추가·비밀번호 변경은 원본 회원 명단 확인 후 별도 관리자 절차로 처리합니다.</span><Button variant="secondary" onClick={() => void load()}>새로고침</Button></div>
      </Card>
    </section>
  );
}
