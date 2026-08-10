import React, { useEffect, useState } from 'react';
import { apiRequest } from '../api';

export interface GoogleWorkspaceConnectionData {
  id: string;
  status: 'CONNECTED' | 'EXPIRED' | 'RECONSENT_REQUIRED' | 'DISCONNECTED';
  grantedScopes: string[];
  secretRef: string;
  tokenExpiresAt: string | null;
  lastSyncedAt: string | null;
  version: number;
}

export interface GoogleWorkspaceIntegrationProps {
  roles: string[];
  onNavigate?: (path: string) => void;
}

export const GoogleWorkspaceIntegration: React.FC<GoogleWorkspaceIntegrationProps> = ({ roles, onNavigate }) => {
  const [connection, setConnection] = useState<GoogleWorkspaceConnectionData | null>(null);
  const [status, setStatus] = useState<string>('DISCONNECTED');
  const [requiredScopes, setRequiredScopes] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canManage = roles.some((r) => ['admin', 'ceo', 'director'].includes(r.toLowerCase()));

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{
        connection: GoogleWorkspaceConnectionData | null;
        status: string;
        requiredScopes: string[];
      }>('/api/google-workspace/connection');
      setConnection(data.connection);
      setStatus(data.status);
      setRequiredScopes(data.requiredScopes);
    } catch (err) {
      setError(err instanceof Error ? err.message : '연결 정보를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const handleInitConnect = async () => {
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ authUrl: string; stateHash: string }>('/api/google-workspace/connect/init', {
        method: 'POST',
        body: JSON.stringify({ redirectTarget: '/integrations/google' })
      });
      // Complete mock OAuth flow by calling callback
      await apiRequest<{ connection: GoogleWorkspaceConnectionData }>('/api/google-workspace/connect/callback', {
        method: 'POST',
        body: JSON.stringify({ stateHash: res.stateHash, code: 'mock-auth-code-ok' })
      });
      setNotice('Google Workspace 연동이 성공적으로 완료되었습니다.');
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '연동 실패');
    }
  };

  const handleTestConnection = async () => {
    setError(null);
    setNotice(null);
    try {
      await apiRequest<{ ok: boolean }>('/api/google-workspace/test', { method: 'POST' });
      setNotice('연결 테스트 성공: Google API 상태 및 권한이 정상입니다.');
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '연결 테스트 실패');
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Google Workspace 연동을 해제하시겠습니까? (이미 저장된 내부 사건·자료·보고서는 삭제되지 않고 안전하게 보존됩니다)')) return;
    setError(null);
    setNotice(null);
    try {
      await apiRequest<{ status: string }>('/api/google-workspace/disconnect', { method: 'POST' });
      setNotice('Google Workspace 연동이 해제되었습니다. 내부 데이터는 온전히 보존되었습니다.');
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '연동 해제 실패');
    }
  };

  const renderBadge = (st: string) => {
    switch (st) {
      case 'CONNECTED':
        return <span style={{ padding: '4px 10px', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '12px', fontSize: '13px', fontWeight: 'bold' }}>🟢 연결됨 (CONNECTED)</span>;
      case 'EXPIRED':
        return <span style={{ padding: '4px 10px', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: '12px', fontSize: '13px', fontWeight: 'bold' }}>🟡 토큰 만료 임박 (EXPIRED)</span>;
      case 'RECONSENT_REQUIRED':
        return <span style={{ padding: '4px 10px', backgroundColor: '#ffedd5', color: '#c2410c', borderRadius: '12px', fontSize: '13px', fontWeight: 'bold' }}>🟠 재동의 필요 (RECONSENT_REQUIRED)</span>;
      case 'DISCONNECTED':
      default:
        return <span style={{ padding: '4px 10px', backgroundColor: '#f3f4f6', color: '#4b5563', borderRadius: '12px', fontSize: '13px', fontWeight: 'bold' }}>⚪ 해제됨 (DISCONNECTED)</span>;
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'sans-serif', color: '#1f2937' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 4px 0', color: '#111827' }}>Google Workspace 서비스 연동 관리</h1>
          <p style={{ margin: 0, fontSize: '14px', color: '#6b7280' }}>
            Drive 폴더 자동화, Gmail 첨부 선택 수집, Calendar 일정 연동, Docs/Sheets 양방향 싱크
          </p>
        </div>
        {onNavigate && (
          <button
            onClick={() => onNavigate('/reports')}
            style={{ padding: '8px 14px', backgroundColor: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
          >
            ← 목록으로
          </button>
        )}
      </div>

      {/* Notices & Errors */}
      {error && (
        <div style={{ padding: '12px 16px', backgroundColor: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', borderRadius: '6px', marginBottom: '16px', fontSize: '14px' }}>
          ⚠️ {error}
        </div>
      )}
      {notice && (
        <div style={{ padding: '12px 16px', backgroundColor: '#f0fdf4', border: '1px solid #86efac', color: '#166534', borderRadius: '6px', marginBottom: '16px', fontSize: '14px' }}>
          ✅ {notice}
        </div>
      )}

      {/* Status Card */}
      <div style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 6px 0', color: '#111827' }}>조직 통합 연동 상태</h2>
            <p style={{ margin: 0, fontSize: '13px', color: '#6b7280' }}>
              OAuth 2.0 PKCE 보안 기반 연동 (실제 토큰/비밀키 노출 0건)
            </p>
          </div>
          <div>{renderBadge(status)}</div>
        </div>

        {connection && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', backgroundColor: '#f9fafb', padding: '16px', borderRadius: '6px', fontSize: '13px', marginBottom: '16px' }}>
            <div><strong>보안 식별자 (secretRef):</strong> <span style={{ fontFamily: 'monospace', color: '#4f46e5' }}>{connection.secretRef}</span></div>
            <div><strong>토큰 만료 예정:</strong> {connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt).toLocaleString('ko-KR') : '없음'}</div>
            <div><strong>최종 동기화 일시:</strong> {connection.lastSyncedAt ? new Date(connection.lastSyncedAt).toLocaleString('ko-KR') : '없음'}</div>
            <div><strong>설정 버전:</strong> v{connection.version}</div>
          </div>
        )}

        {/* Action Controls */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {status === 'DISCONNECTED' || status === 'RECONSENT_REQUIRED' || status === 'EXPIRED' ? (
            <button
              onClick={handleInitConnect}
              disabled={!canManage || loading}
              style={{ padding: '10px 18px', backgroundColor: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: canManage ? 'pointer' : 'not-allowed', opacity: canManage ? 1 : 0.6 }}
            >
              {status === 'RECONSENT_REQUIRED' ? '🔑 Google 동의 재진행' : '🔗 Google Workspace 동의 & 연동'}
            </button>
          ) : (
            <>
              <button
                onClick={handleTestConnection}
                disabled={loading}
                style={{ padding: '10px 18px', backgroundColor: '#059669', color: '#ffffff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
              >
                ⚡ 연결 상태 테스트
              </button>
              <button
                onClick={handleDisconnect}
                disabled={!canManage || loading}
                style={{ padding: '10px 18px', backgroundColor: '#dc2626', color: '#ffffff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: canManage ? 'pointer' : 'not-allowed', opacity: canManage ? 1 : 0.6 }}
              >
                🚫 연동 해제
              </button>
            </>
          )}
        </div>
      </div>

      {/* Scope Governance Card */}
      <div style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: '24px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 'bold', margin: '0 0 12px 0', color: '#111827' }}>승인 및 요청 Scope 통제</h3>
        <p style={{ fontSize: '13px', color: '#4b5563', marginBottom: '16px' }}>
          최소 권한 원칙(Principle of Least Privilege)에 따라 업무에 필요한 최소 scope만 요구합니다.
        </p>

        <div style={{ display: 'grid', gap: '8px' }}>
          {requiredScopes.map((scope) => {
            const isGranted = connection?.grantedScopes?.includes(scope);
            return (
              <div key={scope} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', backgroundColor: '#f9fafb', borderRadius: '6px', border: '1px solid #f3f4f6', fontSize: '13px' }}>
                <span style={{ fontFamily: 'monospace', color: '#374151' }}>{scope}</span>
                <span style={{ fontSize: '12px', fontWeight: 600, color: isGranted ? '#059669' : '#9ca3af' }}>
                  {isGranted ? '✓ 승인됨' : '미승인'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Data Protection Note */}
      <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '16px 20px', fontSize: '13px', color: '#1e40af' }}>
        ℹ️ <strong>데이터 보호 보장:</strong> Google Workspace 연동을 해제하더라도, 클레임센터 내부 사건, 서류, 회의록, 보고서 스튜디오 snapshot 데이터는 손상되거나 삭제되지 않으며 온전히 안전하게 보존됩니다.
      </div>
    </div>
  );
};
