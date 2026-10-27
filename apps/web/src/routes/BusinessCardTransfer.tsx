import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Button, Dialog } from '@claim-studio/ui';
import { apiDownload, apiRequest } from '../api';
import { registerNavigationBlocker } from '../navigation-guard';
import './BusinessCardContacts.css';

type Transfer = { token: string; expiresAt: string };
type TransferStatus = { status: 'PENDING' | 'UPLOADED'; expiresAt: string };
const endpoint = '/api/business-cards/transfers';
const sessionEndpoint = `${endpoint}/session`;
const transferHeaders = (token: string) => ({ 'X-Card-Transfer-Token': token });

export async function optimizeBusinessCard(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('JPG, PNG 또는 WEBP 이미지만 등록할 수 있습니다.');
  if (file.size > 20_000_000) throw new Error('촬영 원본은 20MB 이하만 선택할 수 있습니다.');
  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    for (let attempt = 0; attempt < 4; attempt++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('이미지 처리 화면을 준비하지 못했습니다.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.88, 0.75, 0.6]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (blob && blob.size <= 900_000) {
          const name = file.name.replace(/\.[^.]+$/u, '').slice(0, 180) || 'business-card';
          return new File([blob], `${name}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
        }
      }
      scale *= 0.75;
    }
    throw new Error('사진을 전송 크기로 줄이지 못했습니다. 다른 사진을 선택해 주세요.');
  } finally { bitmap.close(); }
}

export function BusinessCardTransferPanel({ onReceive }: { onReceive: (front: File, back: File) => Promise<boolean> }): React.ReactElement {
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [paused, setPaused] = useState(false);
  const receiving = useRef(false);
  const receivedToken = useRef('');
  const onReceiveRef = useRef(onReceive);
  useEffect(() => { onReceiveRef.current = onReceive; }, [onReceive]);

  const start = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const created = await apiRequest<Transfer>(endpoint, { method: 'POST' });
      try {
        const url = `${window.location.origin}/#cardCapture=${encodeURIComponent(created.token)}`;
        setQr(await QRCode.toDataURL(url, { width: 220, margin: 2, errorCorrectionLevel: 'M' }));
        setTransfer(created); setPaused(false);
      } catch (reason) {
        await apiRequest(sessionEndpoint, { method: 'DELETE', headers: transferHeaders(created.token) }).catch(() => undefined);
        throw reason;
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '휴대폰 연결을 만들지 못했습니다.'); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!transfer) return;
    setBusy(true); setError('');
    try { await apiRequest(sessionEndpoint, { method: 'DELETE', headers: transferHeaders(transfer.token) }); setTransfer(null); setQr(''); setPaused(false); setNotice(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '연결을 닫지 못했습니다. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!transfer || paused) return;
    let active = true;
    const poll = async () => {
      if (receiving.current) return;
      receiving.current = true;
      try {
        const path = sessionEndpoint, headers = transferHeaders(transfer.token);
        const state = await apiRequest<TransferStatus>(path, { headers });
        if (!active || state.status !== 'UPLOADED') return;
        if (receivedToken.current !== transfer.token) {
          const [front, back] = await Promise.all([apiDownload(`${path}/photo?side=front`, headers), apiDownload(`${path}/photo?side=back`, headers)]);
          if (!active) return;
          const frontFile = new File([front.blob], 'business-card-front.jpg', { type: front.blob.type });
          const backFile = new File([back.blob], 'business-card-back.jpg', { type: back.blob.type });
          const accepted = await onReceiveRef.current(frontFile, backFile);
          if (!active) return;
          if (!accepted) { setPaused(true); setError(''); setNotice('기존 사진과 입력값을 유지했습니다. 전송된 사진은 연결이 유효한 동안 보관됩니다.'); return; }
          receivedToken.current = transfer.token;
        }
        await apiRequest(path, { method: 'DELETE', headers });
        if (active) { setTransfer(null); setQr(''); setError(''); setNotice('앞면과 뒷면이 PC에 도착했습니다. Gemini 인식 후 내용을 확인해 주세요.'); }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : '사진 수신에 실패했습니다.');
      } finally { receiving.current = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [transfer, paused]);

  return <div className="business-card-transfer">
    <h3>휴대폰으로 촬영해 PC에서 등록</h3>
    <p>QR을 스캔하고 PC와 같은 계정으로 로그인한 뒤 명함 앞면과 뒷면을 촬영해 보내세요. 전송을 위해 사진을 최적화하며 양면을 각각 보관합니다.</p>
    {!transfer ? <Button type="button" disabled={busy} onClick={() => void start()}>휴대폰 촬영 QR 만들기</Button> :
      <div className="business-card-qr"><img src={qr} width="220" height="220" alt="휴대폰 명함 촬영 페이지로 연결하는 QR 코드"/><div><strong>{paused?'기존 작업 유지 중':'휴대폰 사진을 기다리는 중…'}</strong><p>유효 시간: {new Date(transfer.expiresAt).toLocaleTimeString('ko-KR')}까지</p>{paused&&<Button type="button" disabled={busy} onClick={() => { setNotice(''); setPaused(false); }}>전송된 사진 다시 검토</Button>}<Button type="button" variant="secondary" disabled={busy} onClick={() => void cancel()}>연결 닫기·임시 사진 삭제</Button></div></div>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="error-box">{error} {transfer && '새 QR이 필요하면 기존 연결을 닫고 다시 만들어 주세요.'}</p>}
  </div>;
}

export function BusinessCardCapture({ token, actorName, onExit }: { token: string; actorName: string; onExit: () => void }): React.ReactElement {
  const [ready, setReady] = useState(false), [front, setFront] = useState<File | null>(null), [back, setBack] = useState<File | null>(null);
  const [frontUrl, setFrontUrl] = useState(''), [backUrl, setBackUrl] = useState('');
  const [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [exitAction, setExitAction] = useState<(() => void) | null>(null);
  const dirty = !sent && Boolean(front || back);
  useEffect(() => registerNavigationBlocker((navigation) => {
    if (!dirty && !busy) return false;
    if (busy) { setError('사진 처리가 끝난 뒤 이동해 주세요.'); return true; }
    setExitAction(() => () => { onExit(); navigation.proceed(); }); return true;
  }), [dirty, busy, onExit]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);
  useEffect(() => {
    let active = true;
    void apiRequest<TransferStatus>(sessionEndpoint, { headers: transferHeaders(token) }).then((result) => {
      if (!active) return;
      setReady(result.status === 'PENDING');
      if (result.status !== 'PENDING') setError('이미 사진을 보낸 연결입니다. PC를 확인해 주세요.');
    }).catch((reason) => { if (active) setError(`${reason instanceof Error ? reason.message : '연결을 확인하지 못했습니다.'} PC에서 새 QR을 만들어 다시 시도해 주세요.`); });
    return () => { active = false; };
  }, [token]);
  useEffect(() => () => { if (frontUrl) URL.revokeObjectURL(frontUrl); }, [frontUrl]);
  useEffect(() => () => { if (backUrl) URL.revokeObjectURL(backUrl); }, [backUrl]);
  const choose = async (side: 'front' | 'back', selected: File | null) => {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const file = await optimizeBusinessCard(selected), url = URL.createObjectURL(file);
      if (side === 'front') { setFront(file); setFrontUrl(url); } else { setBack(file); setBackUrl(url); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '사진을 처리하지 못했습니다.'); }
    finally { setBusy(false); }
  };
  const checkSendStatus = async () => {
    try {
      const state = await apiRequest<TransferStatus>(sessionEndpoint, { headers: transferHeaders(token) });
      if (state.status === 'UPLOADED') { setSent(true); setUncertain(false); setError(''); }
      else { setUncertain(false); setError('사진 전송이 완료되지 않았습니다. 다시 보내 주세요.'); }
    } catch {
      setUncertain(true);
      setError('전송 결과를 확인할 수 없습니다. PC에서 사진 도착 여부를 확인하거나 다시 확인해 주세요. 선택한 사진은 유지됩니다.');
    }
  };
  const send = async () => {
    if (!front || !back || uncertain) return;
    setBusy(true); setError('');
    try {
      const body = new FormData(); body.set('file', front); body.set('backFile', back);
      await apiRequest(`${sessionEndpoint}/upload`, { method: 'POST', headers: transferHeaders(token), body });
      setSent(true);
    } catch { await checkSendStatus(); }
    finally { setBusy(false); }
  };
  return <main className="business-card-capture"><section>
    <h1>명함 촬영 → PC로 보내기</h1>
    <p>로그인: {actorName} · PC와 같은 계정으로 로그인해야 합니다. 전송을 위해 사진을 최적화하고, PC에서 인식 결과를 확인한 뒤 앞면과 뒷면을 각각 보관합니다.</p>
    {sent ? <p className="success-box" role="status">앞면과 뒷면을 PC로 보냈습니다. PC에서 인식 결과를 확인해 주세요.</p> : <>
      {(['front', 'back'] as const).map((side) => <div className="business-card-capture-side" key={side}>
        <h2>{side === 'front' ? '명함 앞면' : '명함 뒷면'}</h2>
        {(side === 'front' ? frontUrl : backUrl) ? <img src={side === 'front' ? frontUrl : backUrl} alt={`명함 ${side === 'front' ? '앞면' : '뒷면'} 미리보기`}/> : <p>명함 {side === 'front' ? '앞면' : '뒷면'}이 잘 보이게 촬영해 주세요.</p>}
        <div className="business-card-capture-options">
          <label><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={!ready || busy} onChange={(event) => { void choose(side, event.target.files?.[0] ?? null); event.target.value = ''; }}/>카메라로 찍기</label>
          <label><input type="file" accept="image/jpeg,image/png,image/webp" disabled={!ready || busy} onChange={(event) => { void choose(side, event.target.files?.[0] ?? null); event.target.value = ''; }}/>기존 사진 선택</label>
        </div>
      </div>)}
      <Button type="button" disabled={!ready || !front || !back || busy || uncertain} onClick={() => void send()}>{busy ? '사진 준비·전송 중…' : '앞면·뒷면 PC로 보내기'}</Button>
      {uncertain && <Button type="button" variant="secondary" disabled={busy} onClick={() => { setBusy(true); void checkSendStatus().finally(() => setBusy(false)); }}>전송 상태 다시 확인</Button>}
    </>}
    {error && <p role="alert" className="error-box">{error}</p>}
    <p>사진은 전송을 위해 잠시 보관되고 PC에서 수신하거나 연결이 만료되면 사용할 수 없습니다.</p>
    <Button type="button" variant="secondary" disabled={busy} onClick={() => { if (dirty) setExitAction(() => onExit); else onExit(); }}>클레임센터로 돌아가기</Button>
    <Dialog isOpen={Boolean(exitAction)} title="명함 촬영을 나갈까요?" hideDefaultAction onClose={() => setExitAction(null)}><p>아직 PC로 보내지 않은 사진은 나가면 사라집니다.</p><div className="action-row"><Button type="button" variant="secondary" onClick={() => setExitAction(null)}>계속 촬영</Button><Button type="button" onClick={() => { const action = exitAction; setExitAction(null); action?.(); }}>나가기</Button></div></Dialog>
  </section></main>;
}
