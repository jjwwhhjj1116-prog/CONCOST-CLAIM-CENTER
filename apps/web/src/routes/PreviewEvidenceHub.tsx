import { Button, Card, Select } from '@claim-studio/ui';
import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../api';
import { CaseEvidencePanel } from '../evidence/CaseEvidencePanel';

interface CaseSummary { id: string; caseNumber: string; title: string; claimType: string; status: string }

export function PreviewEvidenceHub({ roles, onNavigate }: { userName: string; roles: string[]; onNavigate: (path: string) => void }): React.ReactElement {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState(new URLSearchParams(window.location.search).get('caseId') ?? '');
  const [error, setError] = useState('');

  useEffect(() => {
    void apiRequest<{ cases: CaseSummary[] }>('/api/cases?limit=100&q=').then((result) => {
      setCases(result.cases);
      setSelectedCaseId((current) => result.cases.some((entry) => entry.id === current) ? current : result.cases[0]?.id ?? '');
    }).catch((reason) => setError(reason instanceof Error ? reason.message : '프로젝트를 불러오지 못했습니다.'));
  }, []);

  const selected = cases.find((entry) => entry.id === selectedCaseId) ?? null;
  return <section className="route-view preview-evidence-hub" aria-labelledby="preview-evidence-title">
    <div className="workspace-hero preview-evidence-hero">
      <div><span className="workspace-eyebrow">PROJECT EVIDENCE LIBRARY · D1 PREVIEW</span><h2 id="preview-evidence-title">산출자료와 내역자료를<br />프로젝트별로 모읍니다.</h2><p>물량산출 화면에서 올린 파일이 이 자료실에 즉시 나타납니다. 파일명·업로드 시간·사용자를 함께 기록하고 다운로드 때 SHA-256 무결성을 다시 확인합니다.</p></div>
      <div className="preview-drive-card"><span>STORAGE ROADMAP</span><strong>D1 임시 보존 활성</strong><small>Cloudflare 검증 단계 · 최대 10MB · 향후 회사 Google Drive 프로젝트 폴더로 이관</small>{roles.includes('admin') && <button type="button" onClick={() => onNavigate('/integrations/google')}>Google Drive 향후 연결 설정</button>}</div>
    </div>
    <Card title="프로젝트 자료실 선택">
      <div className="inline-form"><Select label="프로젝트" value={selectedCaseId} onChange={(event) => setSelectedCaseId(event.target.value)} options={cases.map((entry) => ({ value: entry.id, label: `${entry.caseNumber} · ${entry.title}` }))} />{selected && <span className="preview-pill">{selected.claimType} · {selected.status}</span>}</div>
      {error && <p className="error-box" role="alert">{error}</p>}
    </Card>
    {selectedCaseId ? <CaseEvidencePanel caseId={selectedCaseId} onNavigate={onNavigate} /> : <p className="empty-box">자료를 연결할 프로젝트가 없습니다. 먼저 프로젝트 의뢰를 등록하세요.</p>}
  </section>;
}

interface GoogleDriveStatus {
  connected: boolean;
  configured: boolean;
  status: 'CONNECTED' | 'DISCONNECTED';
  accountEmail: string | null;
  allowedDomain: string | null;
}

export function PreviewGoogleDriveSetup({ onNavigate }: { onNavigate: (path: string) => void }): React.ReactElement {
  const [status, setStatus] = useState<GoogleDriveStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/google/status', { headers: { Accept: 'application/json' } });
      const payload = await response.json() as GoogleDriveStatus & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Google Drive 상태를 확인하지 못했습니다.');
      setStatus(payload); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Google Drive 상태를 확인하지 못했습니다.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const connect = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/google/oauth/start', { method: 'POST', headers: { Accept: 'application/json' } });
      const payload = await response.json() as { authorizationUrl?: string; error?: string };
      if (!response.ok || !payload.authorizationUrl) throw new Error(payload.error ?? 'Google OAuth를 시작하지 못했습니다.');
      const target = new URL(payload.authorizationUrl);
      if (target.origin !== 'https://accounts.google.com') throw new Error('허용되지 않은 Google 승인 주소입니다.');
      window.location.assign(target.toString());
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Google OAuth를 시작하지 못했습니다.'); setBusy(false); }
  };

  const disconnect = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/google/oauth/disconnect', { method: 'POST', headers: { Accept: 'application/json' } });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Google Drive 연결을 해제하지 못했습니다.');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Google Drive 연결을 해제하지 못했습니다.'); }
    finally { setBusy(false); }
  };

  return <section className="route-view preview-drive-setup" aria-labelledby="preview-drive-title">
    <div><span className="workspace-eyebrow">COMPANY GOOGLE DRIVE ACCOUNT</span><h2 id="preview-drive-title">회사 Google Drive 연결·계정 교체</h2><p>Admin이 클레임 전용 회사 계정을 연결합니다. 연결된 계정은 아래에서 확인하고 언제든 다른 회사 계정으로 교체하거나 연결을 해제할 수 있습니다.</p></div>
    <div className="preview-drive-status" role="status"><span className={status?.connected ? 'is-connected' : ''}>{status?.connected ? 'CONNECTED' : 'DISCONNECTED'}</span><strong>{status?.connected ? `현재 회사 Drive 계정 · ${status.accountEmail ?? '계정 확인 필요'}` : status?.configured ? '회사 Google 계정 연결 대기' : 'Cloudflare Google OAuth Secret 설정 필요'}</strong></div>
    <div className="preview-drive-steps"><article><span>01</span><strong>D1 임시 자료실</strong><p>지금 업로드한 산출·내역 파일은 프로젝트별 D1 청크로 보존됩니다.</p></article><article><span>02</span><strong>회사 계정 선택</strong><p>관리자가 회사 Google 계정으로 연결하며 계정은 나중에 변경할 수 있습니다.</p></article><article><span>03</span><strong>프로젝트 폴더 이관</strong><p>확정된 Drive에 프로젝트/업무단계/날짜 폴더로 이관합니다.</p></article></div>
    {error && <p className="error-box" role="alert">{error}</p>}
    <div className="preview-drive-actions"><div><button type="button" disabled={busy || !status?.configured} onClick={() => void connect()}>{busy ? '처리 중…' : status?.connected ? '연결 계정 변경' : '회사 Google 계정 연결'}</button>{status?.connected && <button type="button" disabled={busy} onClick={() => void disconnect()}>연결 해제</button>}<Button variant="secondary" onClick={() => onNavigate('/cases/files')}>현재 자료실 보기</Button></div><span>원본 저장소 · 회사 Google Drive · R2 미사용</span></div>
  </section>;
}
