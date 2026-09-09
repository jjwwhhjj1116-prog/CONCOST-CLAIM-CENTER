import { Button, Card } from '@claim-studio/ui';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../api';
import './PreviewLawApiSettings.css';

interface Settings { configured: boolean; version: number; masterKeyReady: boolean }
export function PreviewEcosApiSettings(): React.ReactElement {
  const [settings, setSettings] = useState<Settings | null>(null), [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState('load'), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const pending = useRef(false), mounted = useRef(false);
  const action = async (kind: 'load' | 'save' | 'test') => {
    if (pending.current || (kind !== 'load' && !settings) || (kind === 'test' && apiKey.trim())) return;
    if (kind === 'save' && !/^[A-Za-z0-9]{16,100}$/.test(apiKey.trim())) { setError('한국은행 ECOS에서 발급받은 영문·숫자 인증키를 입력하세요.'); return; }
    pending.current = true; setBusy(kind); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ settings: Settings; count?: number; month?: string }>('/api/settings/ecos' + (kind === 'test' ? '/test' : ''), kind === 'load' ? {} : {
        method: kind === 'save' ? 'PUT' : 'POST', timeoutMs: 30_000,
        body: JSON.stringify({ expectedVersion: settings!.version, ...(kind === 'save' ? { apiKey: apiKey.trim() } : {}) })
      });
      if (!mounted.current) return;
      setSettings(result.settings);
      if (kind === 'save') { setApiKey(''); setNotice('ECOS 인증키를 암호화 저장했습니다. 연결 확인 후 ES에서 요율정보 가져오기를 누르세요.'); }
      if (kind === 'test') setNotice(`연결 정상 · ${result.month} 재료지수 ${result.count}종 검증 완료. ES 기준일에 맞춰 조회할 수 있습니다.`);
    } catch (reason) { if (mounted.current) setError(reason instanceof ApiError && reason.status === 409 ? '다른 화면에서 설정이 변경되었습니다. 입력값은 유지했습니다. 설정 다시 불러오기 후 저장하세요.' : reason instanceof Error ? reason.message : '처리하지 못했습니다. 다시 시도하세요.'); }
    finally { pending.current = false; if (mounted.current) setBusy(''); }
  };
  useEffect(() => { mounted.current = true; void action('load'); return () => { mounted.current = false; }; }, []);
  return <Card title="한국은행 ECOS · ES 재료지수 연결" className="law-api-settings">
    <p>ECOS 인증키를 저장하면 <strong>ES 요율정보 가져오기</strong>에서 기준일·조정일별 재료지수 4종을 조회합니다.</p>
    <p className="law-api-settings-status">{busy === 'load' ? '저장 상태 확인 중…' : settings?.configured ? `ECOS 인증키 암호화 저장됨 · v${settings.version}` : 'ECOS 미연결 · 발급받은 인증키를 저장하세요.'}</p>
    <form onSubmit={e => { e.preventDefault(); void action('save'); }}>
      <label htmlFor="ecos-api-key">한국은행 ECOS API 인증키</label>
      <input id="ecos-api-key" type="password" autoComplete="new-password" spellCheck={false} maxLength={100} value={apiKey}
        disabled={Boolean(busy) || !settings?.masterKeyReady} aria-describedby="ecos-key-help"
        placeholder={settings?.configured ? '교체할 때만 새 인증키 입력' : 'ECOS에서 발급받은 인증키 입력'} onChange={e => { setApiKey(e.target.value); setError(''); setNotice(''); }} />
      <small id="ecos-key-help">관리자만 저장·교체할 수 있으며 저장 후 원문은 표시하지 않습니다. 현재 접속한 서버에만 적용됩니다.</small>
      <div className="action-row"><Button type="submit" disabled={Boolean(busy) || !settings?.masterKeyReady || !apiKey.trim()}>{busy === 'save' ? '저장 중…' : 'ECOS 인증키 저장'}</Button>
        <Button type="button" variant="secondary" disabled={Boolean(busy) || !settings?.configured || Boolean(apiKey.trim())} onClick={() => void action('test')}>{busy === 'test' ? '한국은행 응답 확인 중…' : 'ECOS 연결 확인'}</Button>
        <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => void action('load')}>설정 다시 불러오기</Button></div>
      {apiKey.trim() && <p>입력 중인 키는 아직 적용되지 않았습니다. 먼저 저장하세요.</p>}
      {settings && !settings.masterKeyReady && <p role="alert">서버 암호화 설정이 준비되지 않아 저장할 수 없습니다.</p>}
      {notice && <p className="notice-box" role="status">{notice}</p>}{error && <p className="error-box" role="alert">{error}</p>}
    </form>
    <details className="credential-issue-guide"><summary>조회 범위·사용 순서</summary><ol><li>한국은행 ECOS 인증키를 저장하고 연결을 확인합니다.</li><li>ES 산출서에서 기준일·조정일을 입력합니다.</li><li>ES 요율정보 가져오기 → 결과 비교 → 확인·입력에 적용 → 저장·계산 순서로 진행합니다.</li></ol>
      <p>연결 항목: 광산품·공산품·전력/가스/수도/폐기물·농림수산품 생산자물가지수(2020=100). 원본의 자료월 선택 규칙을 따르며 미공표 월을 최신 월로 대신하지 않습니다.</p>
      <p>노임·기계경비·표준시장단가·보험 요율 전체를 제공하는 키가 아닙니다. 건강보험은 기존 국가법령 연결, 나머지는 원본 Excel 이력·수동 입력을 유지합니다.</p>
      <a href="https://ecos.bok.or.kr/api/" target="_blank" rel="noreferrer">한국은행 ECOS Open API ↗</a></details>
  </Card>;
}
