import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../api';

type ConnectionStatus = 'CONNECTED' | 'EXPIRED' | 'RECONSENT_REQUIRED' | 'DISCONNECTED';
type GoogleProviderMode = 'FAKE' | 'REAL';

export interface GoogleWorkspaceConnectionData {
  id: string;
  status: ConnectionStatus;
  grantedScopes: string[];
  tokenExpiresAt: string | null;
  lastSyncedAt: string | null;
  version: number;
}

interface GoogleWorkspaceHistoryItem {
  id: string;
  operationKind: string;
  status: string;
  responseClass?: string | null;
  redactedError?: string | null;
  createdAt: string;
}

interface GoogleReconciliationItem {
  id: string;
  caseId: string;
  operationKind: string;
  status: 'RECONCILIATION_REQUIRED' | 'PENDING';
  createdAt: string;
  updatedAt: string;
  expectedUpdatedAt: string;
}

interface PendingFakeConsent {
  state: string;
  authorizationUrl: string;
  expiresAt: string;
  providerMode: 'FAKE';
}

export interface GoogleWorkspaceIntegrationProps {
  roles: string[];
  onNavigate?: (path: string) => void;
}

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  'https://www.googleapis.com/auth/drive.file': '이 앱이 만든 사건 폴더와 내보낸 문서만 관리',
  'https://www.googleapis.com/auth/gmail.readonly': '사용자가 고른 메일 첨부를 읽기 전용으로 조회',
  'https://www.googleapis.com/auth/calendar.events': '사람이 확인한 사건 일정만 생성',
  'https://www.googleapis.com/auth/documents': '선택한 회의록 버전을 Google Docs로 내보내기',
  'https://www.googleapis.com/auth/spreadsheets.readonly': '사용자가 고른 Sheets 범위만 읽기'
};

function friendlyError(reason: unknown): string {
  if (!navigator.onLine) return 'OFFLINE: 네트워크 연결을 확인한 뒤 다시 시도하세요.';
  if (reason instanceof ApiError) {
    const responseClass = typeof reason.payload.responseClass === 'string' ? reason.payload.responseClass : '';
    if (responseClass === 'TIMEOUT') return 'TIMEOUT: Google 응답 시간이 초과되었습니다. 연결 상태를 확인한 뒤 다시 시도하세요.';
    if (responseClass === 'SERVER_ERROR') return '5XX: Google 서비스가 일시적으로 실패했습니다. 잠시 후 다시 시도하세요.';
    if (responseClass === 'REVOKE_FAILURE') return '연동 해제 실패: Google 연결은 해제되지 않았습니다. 상태를 확인한 뒤 다시 시도하세요.';
    if (responseClass === 'BAD_SCOPE') return '승인 범위가 부족합니다. 필요한 최소 scope로 다시 동의하세요.';
    if (responseClass === 'TOKEN_EXPIRED') return 'Google 토큰이 만료되었습니다. 재동의를 진행하세요.';
    if (responseClass === 'RECONSENT_REQUIRED') return 'Google 정책에 따라 재동의가 필요합니다.';
    if (responseClass === 'USER_CANCEL') return 'Google 작업이 사용자 요청으로 취소되었습니다.';
    if (responseClass === 'MALFORMED_PROVIDER_RESPONSE') return 'Google 응답 형식을 검증하지 못했습니다. 원문 데이터는 저장되지 않았습니다.';
    if (reason.status === 401) return '401 인증이 만료되었습니다. 다시 로그인하세요.';
    if (reason.status === 403) return '403 이 작업을 수행할 권한이 없습니다.';
    if (reason.status === 409) return '409 다른 작업으로 상태가 변경되었습니다. 최신 상태를 불러온 뒤 다시 시도하세요.';
    if (reason.status === 429) return '429 요청이 많습니다. 잠시 후 같은 작업을 다시 시도하세요.';
    if (reason.status >= 500) return 'Google 연동 서비스가 일시적으로 응답하지 않습니다. 다시 시도하세요.';
  }
  return reason instanceof Error ? reason.message : 'Google Workspace 요청에 실패했습니다.';
}

function StatusBadge({ status, expiresSoon }: { status: ConnectionStatus; expiresSoon: boolean }): React.ReactElement {
  if (status === 'CONNECTED' && expiresSoon) {
    return <span className="google-status google-status--expiring-soon">만료 임박 (EXPIRING_SOON)</span>;
  }
  const labels: Record<ConnectionStatus, string> = {
    CONNECTED: '연결됨',
    EXPIRED: '토큰 만료',
    RECONSENT_REQUIRED: '재동의 필요',
    DISCONNECTED: '해제됨'
  };
  return <span className={`google-status google-status--${status.toLowerCase()}`}>{labels[status]} ({status})</span>;
}

export const GoogleWorkspaceIntegration: React.FC<GoogleWorkspaceIntegrationProps> = ({ roles, onNavigate }) => {
  const [connection, setConnection] = useState<GoogleWorkspaceConnectionData | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('DISCONNECTED');
  const [providerMode, setProviderMode] = useState<GoogleProviderMode | null>(null);
  const [requiredScopes, setRequiredScopes] = useState<string[]>([]);
  const [history, setHistory] = useState<GoogleWorkspaceHistoryItem[]>([]);
  const [reconciliationQueue, setReconciliationQueue] = useState<GoogleReconciliationItem[]>([]);
  const [verificationReferences, setVerificationReferences] = useState<Record<string, string>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [pendingConsent, setPendingConsent] = useState<PendingFakeConsent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const consentRef = useRef<HTMLDivElement>(null);
  const consentTriggerRef = useRef<HTMLButtonElement>(null);

  const canManage = roles.some((role) => role.toLowerCase() === 'admin');
  const expiresSoon = status === 'CONNECTED' && Boolean(connection?.tokenExpiresAt)
    && new Date(connection!.tokenExpiresAt!).getTime() <= Date.now() + 15 * 60 * 1000;

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, reconciliation] = await Promise.all([
        apiRequest<{
          connection: GoogleWorkspaceConnectionData | null;
          status: ConnectionStatus;
          providerMode: GoogleProviderMode;
          requiredScopes: string[];
          history: GoogleWorkspaceHistoryItem[];
        }>('/api/google-workspace/connection'),
        canManage
          ? apiRequest<{ operations: GoogleReconciliationItem[] }>('/api/google-workspace/reconciliation')
          : Promise.resolve({ operations: [] })
      ]);
      if (!mountedRef.current) return;
      setConnection(data.connection);
      setStatus(data.status);
      setProviderMode(data.providerMode);
      setRequiredScopes(data.requiredScopes);
      setHistory((data.history ?? []).slice(0, 100));
      setReconciliationQueue(reconciliation.operations ?? []);
    } catch (reason) {
      if (mountedRef.current) setError(friendlyError(reason));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    mountedRef.current = true;
    const currentUrl = new URL(window.location.href);
    const callbackState = currentUrl.searchParams.get('state');
    const callbackCode = currentUrl.searchParams.get('code');
    const callbackError = currentUrl.searchParams.get('error');
    if (callbackState || callbackCode || callbackError) {
      window.history.replaceState({}, document.title, currentUrl.pathname + currentUrl.hash);
    }
    const initialize = async () => {
      if (callbackError) {
        setError('Google 동의가 완료되지 않았습니다. 다시 연결을 시작하세요.');
      } else if (callbackState && callbackCode) {
        setLoading(true);
        try {
          await apiRequest('/api/google-workspace/connect/callback', {
            method: 'POST',
            body: JSON.stringify({ state: callbackState, code: callbackCode })
          });
          setNotice('Google Workspace 운영 연결이 완료되었습니다.');
        } catch (reason) {
          setError(friendlyError(reason));
        }
      }
      await loadStatus();
    };
    void initialize();
    return () => { mountedRef.current = false; };
  }, [loadStatus]);

  useEffect(() => { if (pendingConsent) consentRef.current?.focus(); }, [pendingConsent]);

  const closeFakeConsent = () => {
    setPendingConsent(null);
    window.requestAnimationFrame(() => consentTriggerRef.current?.focus());
  };

  const beginConsent = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiRequest<PendingFakeConsent | (Omit<PendingFakeConsent, 'providerMode'> & { providerMode: 'REAL' })>('/api/google-workspace/connect/init', {
        method: 'POST',
        body: JSON.stringify({ redirectTarget: '/integrations/google', expectedVersion: connection?.version ?? null })
      });
      if (result.providerMode === 'REAL') {
        const authorizationUrl = new URL(result.authorizationUrl);
        if (authorizationUrl.origin !== 'https://accounts.google.com') throw new Error('승인되지 않은 Google OAuth 주소입니다.');
        window.location.assign(authorizationUrl.toString());
        return;
      }
      setPendingConsent(result);
      setNotice('검수용 Fake provider가 동의 요청을 준비했습니다. 아래 확인 버튼으로만 완료됩니다.');
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setLoading(false);
    }
  };

  const completeFakeConsent = async () => {
    if (!pendingConsent) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest<{ connection: GoogleWorkspaceConnectionData }>('/api/google-workspace/connect/callback', {
        method: 'POST',
        body: JSON.stringify({ state: pendingConsent.state, code: 'FAKE_AUTHORIZATION_CODE' })
      });
      setPendingConsent(null);
      setNotice('Fake provider 연동이 완료되었습니다. 운영 Google 자격증명은 사용되지 않았습니다.');
      await loadStatus();
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      if (!connection) throw new Error('연결 정보가 없습니다. 상태를 다시 불러오세요.');
      await apiRequest<{ ok: boolean }>('/api/google-workspace/test', { method: 'POST', body: JSON.stringify({ expectedVersion: connection.version }) });
      setNotice('연결 테스트가 성공했습니다.');
      await loadStatus();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) await loadStatus();
      setError(friendlyError(reason));
    } finally {
      setLoading(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Google Workspace 연동을 해제하시겠습니까? 이미 저장된 내부 snapshot은 보존됩니다.')) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      if (!connection) throw new Error('연결 정보가 없습니다. 상태를 다시 불러오세요.');
      await apiRequest<{ status: ConnectionStatus }>('/api/google-workspace/disconnect', { method: 'POST', body: JSON.stringify({ expectedVersion: connection.version }) });
      setPendingConsent(null);
      setNotice('연동을 해제했습니다. 내부 사건·자료·회의록·보고서 snapshot은 보존됩니다.');
      await loadStatus();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) await loadStatus();
      setError(friendlyError(reason));
    } finally {
      setLoading(false);
    }
  };

  const resolveReconciliation = async (operation: GoogleReconciliationItem) => {
    const verificationReference = (verificationReferences[operation.id] ?? '').trim();
    if (verificationReference.length < 8) {
      setError('Google 관리 콘솔에서 외부 리소스가 없음을 확인한 검증 참조를 8자 이상 입력하세요.');
      return;
    }
    if (!window.confirm('Google 관리 콘솔에서 외부 리소스가 생성되지 않았음을 직접 확인했습니까? 확인 후에만 새 작업 키가 허용됩니다.')) return;
    setResolvingId(operation.id);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/google-workspace/reconciliation/${encodeURIComponent(operation.id)}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          resolution: 'CONFIRMED_NO_EXTERNAL_SIDE_EFFECT',
          confirmation: 'NO_EXTERNAL_RESOURCE_CONFIRMED',
          verificationReference,
          expectedUpdatedAt: operation.expectedUpdatedAt
        })
      });
      setVerificationReferences((current) => {
        const next = { ...current };
        delete next[operation.id];
        return next;
      });
      setNotice('외부 리소스 없음 확인이 감사 로그와 함께 저장되었습니다. 이제 새 작업 키로 다시 시도할 수 있습니다.');
      await loadStatus();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) await loadStatus();
      setError(friendlyError(reason));
    } finally {
      setResolvingId(null);
    }
  };

  const needsConsent = status === 'DISCONNECTED' || status === 'RECONSENT_REQUIRED' || status === 'EXPIRED';

  return (
    <div className="google-integration" data-testid="google-admin-integration">
      <header className="google-heading">
        <div>
          <p className="google-eyebrow">INTEGRATION GOVERNANCE</p>
          <h1>Google Workspace 서비스 연동 관리</h1>
          <p>Drive · Gmail · Calendar · Docs · Sheets 작업을 사용자 선택과 감사 이력으로 통제합니다.</p>
        </div>
        {onNavigate && <button type="button" className="google-button google-button--quiet" onClick={() => onNavigate('/reports')}>← 보고서 목록</button>}
      </header>

      <div className="google-fake-banner" role="note">
        {providerMode === 'REAL' ? (
          <>
            <strong>GOOGLE WORKSPACE REAL PROVIDER · 운영 연결</strong>
            <span>Google 승인 화면으로 이동하며 토큰 원문은 브라우저와 데이터베이스에 저장하지 않습니다.</span>
          </>
        ) : (
          <>
            <strong>DETERMINISTIC FAKE PROVIDER · 개발/검수 전용</strong>
            <span>현재 화면은 실제 Google 로그인·토큰·고객 데이터를 사용하지 않습니다.</span>
          </>
        )}
      </div>

      {loading && <p className="google-message" role="status" aria-live="polite">Google Workspace 상태를 처리하는 중입니다.</p>}
      {error && <div className="google-message google-message--error" role="alert"><span>{error}</span><button type="button" onClick={() => void loadStatus()}>상태 다시 불러오기</button></div>}
      {notice && <div className="google-message google-message--success" role="status" aria-live="polite">{notice}</div>}

      <section className="google-card" aria-labelledby="google-connection-title">
        <div className="google-card-heading">
          <div><h2 id="google-connection-title">조직 연동 상태</h2><p>OAuth state는 메모리에만 보관되고 한 번 사용한 뒤 폐기됩니다.</p></div>
          <StatusBadge status={status} expiresSoon={expiresSoon} />
        </div>

        {connection && (
          <dl className="google-metadata">
            <div><dt>토큰 만료 예정</dt><dd>{connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt).toLocaleString('ko-KR') : '없음'}</dd></div>
            <div><dt>최종 동기화</dt><dd>{connection.lastSyncedAt ? new Date(connection.lastSyncedAt).toLocaleString('ko-KR') : '이력 없음'}</dd></div>
            <div><dt>설정 버전</dt><dd>v{connection.version}</dd></div>
          </dl>
        )}

        <div className="google-actions">
          {needsConsent ? (
            <button ref={consentTriggerRef} type="button" className="google-button google-button--primary" disabled={!canManage || loading || Boolean(pendingConsent)} onClick={() => void beginConsent()}>
              {providerMode === 'REAL'
                ? status === 'RECONSENT_REQUIRED' || status === 'EXPIRED' ? 'Google Workspace 재동의 시작' : 'Google Workspace 연결 시작'
                : status === 'RECONSENT_REQUIRED' || status === 'EXPIRED' ? 'Fake provider 재동의 시작' : 'Fake provider 동의 시작'}
            </button>
          ) : (
            <>
              <button type="button" className="google-button google-button--success" disabled={loading} onClick={() => void testConnection()}>연결 상태 테스트</button>
              <button type="button" className="google-button google-button--danger" disabled={!canManage || loading} onClick={() => void disconnect()}>연동 해제</button>
            </>
          )}
        </div>

        {pendingConsent && (
          <div ref={consentRef} tabIndex={-1} className="google-consent" role="dialog" aria-modal="false" aria-labelledby="fake-consent-title" onKeyDown={(event) => { if (event.key === 'Escape') closeFakeConsent(); }}>
            <h3 id="fake-consent-title">Fake provider 동의 확인</h3>
            <p>만료: {new Date(pendingConsent.expiresAt).toLocaleString('ko-KR')}</p>
            <p>외부 Google 페이지로 이동하지 않으며 검수용 authorization 응답만 생성합니다.</p>
            <div className="google-actions">
              <button type="button" className="google-button google-button--primary" disabled={loading} onClick={() => void completeFakeConsent()}>Fake provider 동의 완료</button>
              <button type="button" className="google-button google-button--quiet" disabled={loading} onClick={closeFakeConsent}>취소</button>
            </div>
          </div>
        )}
      </section>

      <section className="google-card" aria-labelledby="google-scope-title">
        <div className="google-card-heading"><div><h2 id="google-scope-title">최소 승인 Scope</h2><p>선택한 업무에 필요한 읽기·생성 범위만 요청합니다.</p></div></div>
        {requiredScopes.length === 0 ? <p className="google-empty">요청할 scope가 없습니다.</p> : (
          <ul className="google-scope-list">
            {requiredScopes.map((scope) => <li key={scope}><div><code>{scope}</code><small>{SCOPE_DESCRIPTIONS[scope] ?? '관리자가 승인한 최소 범위'}</small></div><strong>{connection?.grantedScopes.includes(scope) ? '승인됨' : '미승인'}</strong></li>)}
          </ul>
        )}
      </section>

      <section className="google-card google-reconciliation" aria-labelledby="google-reconciliation-title" data-testid="google-reconciliation-panel">
        <div className="google-card-heading">
          <div>
            <h2 id="google-reconciliation-title">수동 재조정 대기열</h2>
            <p>응답 손실이나 로컬 저장 실패가 발생한 변경 작업은 자동 재시도하지 않습니다.</p>
          </div>
          <strong>{reconciliationQueue.length}건</strong>
        </div>
        <div className="google-reconciliation-warning" role="note">
          <strong>반드시 Google 관리 콘솔에서 외부 리소스가 없음을 직접 확인하세요.</strong>
          <span>외부 폴더·일정·문서가 존재하면 해제하지 말고 그대로 조사 상태를 유지해야 합니다. 검증 참조 원문은 저장하지 않고 SHA-256만 감사 로그에 남깁니다.</span>
        </div>
        {reconciliationQueue.length === 0 ? <p className="google-empty">재조정이 필요한 작업이 없습니다.</p> : (
          <ol className="google-reconciliation-list">
            {reconciliationQueue.map((operation) => {
              const inputId = `google-reconciliation-reference-${operation.id}`;
              const reference = verificationReferences[operation.id] ?? '';
              return (
                <li key={operation.id} data-testid="google-reconciliation-item">
                  <div className="google-reconciliation-meta">
                    <strong>{operation.operationKind}</strong>
                    <span>{operation.status}</span>
                    <code>{operation.caseId}</code>
                    <time dateTime={operation.updatedAt}>{new Date(operation.updatedAt).toLocaleString('ko-KR')}</time>
                  </div>
                  <label htmlFor={inputId}>외부 리소스 없음 검증 참조</label>
                  <input
                    id={inputId}
                    type="text"
                    value={reference}
                    maxLength={300}
                    autoComplete="off"
                    placeholder="예: Google Calendar 관리 콘솔 확인 #P14-20260810"
                    onChange={(event) => setVerificationReferences((current) => ({ ...current, [operation.id]: event.target.value }))}
                  />
                  <button
                    type="button"
                    className="google-button google-button--danger"
                    disabled={loading || resolvingId !== null || reference.trim().length < 8}
                    onClick={() => void resolveReconciliation(operation)}
                  >
                    {resolvingId === operation.id ? '감사 기록 저장 중…' : '외부 리소스 없음 확인 및 재시도 잠금 해제'}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="google-card" aria-labelledby="google-history-title">
        <div className="google-card-heading"><div><h2 id="google-history-title">최근 동기화 이력</h2><p>최대 100건의 redacted 작업 상태를 표시합니다.</p></div><button type="button" className="google-button google-button--quiet" disabled={loading} onClick={() => void loadStatus()}>새로고침</button></div>
        {history.length === 0 ? <p className="google-empty">아직 동기화 이력이 없습니다.</p> : (
          <ol className="google-history" aria-label="최근 Google 동기화 이력">{history.map((item) => <li key={item.id}><strong>{item.operationKind}</strong><span>{item.status}{item.responseClass ? ` · ${item.responseClass}` : ''}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ko-KR')}</time>{item.redactedError && <small>{item.redactedError}</small>}</li>)}</ol>
        )}
      </section>

      <div className="google-protection" role="note"><strong>내부 데이터 보존</strong><span>연동을 해제해도 이미 저장한 사건·자료·회의록·보고서 snapshot은 삭제되지 않습니다.</span></div>
    </div>
  );
};
