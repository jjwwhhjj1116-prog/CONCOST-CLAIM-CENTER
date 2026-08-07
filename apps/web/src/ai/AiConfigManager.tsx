import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';

export interface AiProviderConfig {
  id: string;
  providerKind: string;
  name: string;
  baseUrl: string;
  secretRef: string;
  status: string;
  allowedModelsJson: string;
  timeoutMs: number;
  maxRetries: number;
  dailyBudgetMicros: number;
  hasSecretConfigured?: boolean;
}

export interface AiUsageSummary {
  totalCostMicros: number;
  totalCostUsd: string;
  totalTokens: number;
}

export const AiConfigManager: React.FC<{ roles: string[] }> = ({ roles }) => {
  const [providers, setProviders] = useState<AiProviderConfig[]>([]);
  const [summary, setSummary] = useState<AiUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; message: string } | null>(null);

  // Form State
  const [providerKind, setProviderKind] = useState('LOCAL_FAKE');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://localhost/fake-ai');
  const [secretRef, setSecretRef] = useState('ENV_LOCAL_FAKE_KEY');
  const [allowedModels, setAllowedModels] = useState('fake-claim-v1, fake-analysis-v2');
  const [dailyBudgetUSD, setDailyBudgetUSD] = useState('100.00');
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const isAdmin = roles.includes('admin');

  const fetchProvidersAndUsage = async () => {
    setLoading(true);
    setError(null);
    try {
      if (isAdmin) {
        const provData = await apiRequest<{ providers: AiProviderConfig[] }>('/api/ai/providers');
        setProviders(provData.providers);
      }
      const usageData = await apiRequest<{ summary: AiUsageSummary }>('/api/ai/usage');
      setSummary(usageData.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchProvidersAndUsage();
  }, []);

  const handleTestConnection = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>(`/api/ai/providers/${id}/test`, {
        method: 'POST'
      });
      setTestResult({ id, ok: res.ok, message: res.message });
    } catch (err) {
      setTestResult({ id, ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTestingId(null);
    }
  };

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setActionMsg(null);
    setError(null);

    const parsedBudgetUSD = parseFloat(dailyBudgetUSD) || 100;
    const dailyBudgetMicros = Math.round(parsedBudgetUSD * 1000000);
    const modelsArr = allowedModels.split(',').map((s) => s.trim()).filter(Boolean);

    try {
      await apiRequest('/api/ai/providers', {
        method: 'POST',
        body: JSON.stringify({
          providerKind,
          name: name || 'AI Gateway Provider',
          baseUrl,
          secretRef,
          allowedModels: modelsArr,
          dailyBudgetMicros
        })
      });
      setActionMsg('공급자 설정이 성공적으로 저장되었습니다.');
      setName('');
      void fetchProvidersAndUsage();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!isAdmin) {
    return (
      <div style={{ padding: '24px', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#1e293b' }}>AI Gateway 사용량 현황</h2>
        {summary && (
          <div style={{ marginTop: '16px', display: 'flex', gap: '24px' }}>
            <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '6px', flex: 1 }}>
              <div style={{ fontSize: '0.875rem', color: '#64748b' }}>누적 사용 토큰</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>{summary.totalTokens.toLocaleString()} tokens</div>
            </div>
            <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '6px', flex: 1 }}>
              <div style={{ fontSize: '0.875rem', color: '#64748b' }}>누적 비용 (USD)</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#2563eb' }}>${summary.totalCostUsd} USD</div>
            </div>
          </div>
        )}
        <p style={{ marginTop: '16px', color: '#64748b', fontSize: '0.875rem' }}>
          * 공급자 연결 설정 및 예산 관리는 Admin 전용 권한입니다.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#1e293b', margin: 0 }}>P10 AI Gateway 관리자 설정</h2>
          <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '4px 0 0 0' }}>
            조직별 AI 공급자 연결, SSRF 보안 검증, 일일 예산 통제 및 핑 테스트
          </p>
        </div>
        {summary && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>조직 누적 비용</div>
            <div style={{ fontSize: '1.125rem', fontWeight: 700, color: '#2563eb' }}>${summary.totalCostUsd} USD ({summary.totalTokens} tokens)</div>
          </div>
        )}
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: '6px', marginBottom: '16px', fontSize: '0.875rem' }}>
          ⚠️ {error}
        </div>
      )}

      {actionMsg && (
        <div style={{ padding: '12px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', borderRadius: '6px', marginBottom: '16px', fontSize: '0.875rem' }}>
          ✅ {actionMsg}
        </div>
      )}

      {/* 등록된 공급자 목록 */}
      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#334155', marginBottom: '12px' }}>등록된 AI 공급자 목록</h3>
      {loading ? (
        <p style={{ color: '#64748b' }}>조회 중...</p>
      ) : providers.length === 0 ? (
        <p style={{ color: '#64748b', fontSize: '0.875rem' }}>등록된 공급자가 없습니다.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '32px' }}>
          {providers.map((p) => (
            <div key={p.id} style={{ padding: '16px', border: '1px solid #cbd5e1', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>{p.name}</span>
                  <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px', background: p.status === 'ACTIVE' ? '#dcfce7' : '#fee2e2', color: p.status === 'ACTIVE' ? '#166534' : '#991b1b' }}>
                    {p.status}
                  </span>
                  <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px', background: '#e2e8f0', color: '#475569' }}>
                    {p.providerKind}
                  </span>
                </div>
                <div style={{ fontSize: '0.8125rem', color: '#64748b', marginTop: '6px' }}>
                  Base URL: <code>{p.baseUrl}</code> | Secret Ref: <code>{p.secretRef}</code> (설정여부: {p.hasSecretConfigured ? 'OK' : '미설정'})
                </div>
                <div style={{ fontSize: '0.8125rem', color: '#64748b', marginTop: '4px' }}>
                  허용 모델: {JSON.parse(p.allowedModelsJson || '[]').join(', ')} | 일일 예산: ${(p.dailyBudgetMicros / 1000000).toFixed(2)} USD
                </div>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => handleTestConnection(p.id)}
                  disabled={testingId === p.id}
                  style={{ padding: '8px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '0.875rem', cursor: 'pointer' }}
                >
                  {testingId === p.id ? '테스트 중...' : '연결 핑 테스트'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {testResult && (
        <div style={{ padding: '12px 16px', background: testResult.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${testResult.ok ? '#bbf7d0' : '#fecaca'}`, color: testResult.ok ? '#166534' : '#991b1b', borderRadius: '6px', marginBottom: '24px', fontSize: '0.875rem' }}>
          <strong>연결 테스트 결과 [{testResult.id}]:</strong> {testResult.ok ? '성공 (200 OK)' : '실패'} — {testResult.message}
        </div>
      )}

      {/* 신규 공급자 추가 폼 */}
      <div style={{ padding: '20px', background: '#f1f5f9', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#1e293b', marginTop: 0, marginBottom: '16px' }}>신규 AI 공급자 등록 / 수정</h3>
        <form onSubmit={handleSaveProvider} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#334155', marginBottom: '4px' }}>공급자 종류 (Provider Kind)</label>
            <select
              value={providerKind}
              onChange={(e) => setProviderKind(e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
            >
              <option value="LOCAL_FAKE">LOCAL_FAKE (Local Synthetic Engine)</option>
              <option value="OPENAI">OPENAI (Real Provider Secret Ref)</option>
              <option value="ANTHROPIC">ANTHROPIC (Real Provider Secret Ref)</option>
              <option value="GEMINI">GEMINI (Real Provider Secret Ref)</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#334155', marginBottom: '4px' }}>공급자 이명 (Name)</label>
            <input
              type="text"
              value={name}
              placeholder="예: Local Synthetic Fake AI Engine"
              onChange={(e) => setName(e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#334155', marginBottom: '4px' }}>Base Endpoint URL (HTTPS / SSRF 검증)</label>
            <input
              type="text"
              value={baseUrl}
              placeholder="https://api.openai.com/v1 또는 https://localhost/fake-ai"
              onChange={(e) => setBaseUrl(e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#334155', marginBottom: '4px' }}>Secret Reference Name (원문 Key 저장 절대 금지)</label>
            <input
              type="text"
              value={secretRef}
              placeholder="ENV_OPENAI_API_KEY 또는 ENV_LOCAL_FAKE_KEY"
              onChange={(e) => setSecretRef(e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#334155', marginBottom: '4px' }}>허용 모델 목록 (쉼표 구문)</label>
            <input
              type="text"
              value={allowedModels}
              placeholder="fake-claim-v1, fake-analysis-v2"
              onChange={(e) => setAllowedModels(e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#334155', marginBottom: '4px' }}>조직 일일 예산 한도 (USD)</label>
            <input
              type="number"
              step="0.01"
              value={dailyBudgetUSD}
              onChange={(e) => setDailyBudgetUSD(e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              required
            />
          </div>

          <div style={{ gridColumn: 'span 2', textAlign: 'right', marginTop: '8px' }}>
            <button
              type="submit"
              style={{ padding: '10px 20px', background: '#059669', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 600, cursor: 'pointer' }}
            >
              공급자 설정 저장
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
