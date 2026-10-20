import { useEffect, useState } from 'react';
import { Button } from '@claim-studio/ui';
import { apiRequest } from '../api';

export function ApprovalDeliveryEmail({notification,admin=false}:{notification:{id:string;emailStatus:string;canSendEmail?:boolean};admin?:boolean}):React.ReactElement {
  type EmailState={status:string;retryable:boolean;recipientName:string;recipientEmail:string};
  const [result,setResult]=useState<(EmailState&{note:string})|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const canSend=Boolean(notification.canSendEmail||admin),path=`/api/notifications/${encodeURIComponent(notification.id)}/email`;
  useEffect(()=>{let active=true;if(canSend)void apiRequest<{email:EmailState;note:string}>(path).then(response=>{if(active)setResult({...response.email,note:response.note});}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'이메일 상태를 확인하지 못했습니다.');});return()=>{active=false;};},[path,canSend]);
  const status=result?.status??notification.emailStatus;
  const label=status==='SENT'?'메일 서버 접수 완료 · 수신함 도착은 미확인':status==='CONFIG_REQUIRED'?'메일 발송 서버 연결 필요':status==='RECIPIENT_REQUIRED'?'등록된 수신주소 확인 필요':status==='FAILED'?'발송 실패 또는 결과 확인 필요':'발송 대기';
  const send=async()=>{
    setBusy(true);setError('');
    try{const response=await apiRequest<{email:EmailState;note:string}>(path,{method:'POST',body:'{}'});setResult({...response.email,note:response.note});}
    catch(reason){setError(reason instanceof Error?reason.message:'승인 이메일 발송을 요청하지 못했습니다.');}
    finally{setBusy(false);}
  };
  return <section className="notice-box" aria-label="결재 승인 이메일">
    <strong>결재 승인 이메일</strong><p role="status">{label}</p>
    {result&&<p>수신 담당자: {result.recipientName} · {result.recipientEmail||'이메일 미등록'}</p>}
    {result?.note&&<p>{result.note}</p>}
    {canSend&&status!=='SENT'&&<Button variant="secondary" disabled={busy||!result||result.retryable===false} onClick={()=>void send()}>{busy?'발송 확인 중…':'담당자에게 승인 이메일 보내기'}</Button>}
    {error&&<p className="error-box" role="alert">{error}</p>}
  </section>;
}
