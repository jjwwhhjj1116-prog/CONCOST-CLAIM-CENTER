import { Button, Dialog } from '@claim-studio/ui';
import { useEffect, useRef, useState } from 'react';
import { RECOVERY_RETENTION_DAYS, type RecoveryMetadata } from './local-document-recovery';
import './LocalRecoveryMenu.css';

export function LocalRecoveryMenu({ scopeKey, candidates, disabled, error, onRefresh, onRestore, onDownload, onDiscard, restoreLabel = '이 로컬 작업 복구' }: {
  scopeKey: string; candidates: RecoveryMetadata[]; disabled?: boolean; error?: string | null;
  onRefresh: () => Promise<unknown>; onRestore?: (id: string) => Promise<unknown>;
  onDownload?: (id: string) => Promise<unknown>; onDiscard?: (id: string) => Promise<unknown>;
  restoreLabel?: string;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [discardId, setDiscardId] = useState<string | null>(null);
  const refreshRef = useRef(onRefresh); refreshRef.current = onRefresh;
  useEffect(() => {
    setOpen(false); setDiscardId(null);
    const timer = window.setInterval(() => { void refreshRef.current().catch(() => undefined); }, 60000);
    return () => window.clearInterval(timer);
  }, [scopeKey]);
  useEffect(() => { if (!candidates.length) { setOpen(false); setDiscardId(null); } }, [candidates.length]);
  const run = async (action: () => Promise<unknown>) => { if (busy || disabled) return; setBusy(true); try { await action(); } finally { setBusy(false); } };
  const bytes = (value: number) => value >= 1048576 ? `${(value / 1048576).toFixed(2)} MB` : value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${value} B`;
  const total = candidates.reduce((size, item) => size + (item.byteSize ?? 0), 0);
  return <>
    {candidates.length > 0 && <Button variant="secondary" data-native-recovery-trigger={candidates[0].workspaceId.startsWith('report-native:') ? scopeKey : undefined} disabled={disabled || busy} onClick={() => { setOpen(true); void refreshRef.current().catch(() => undefined); }}>{candidates[0].workspaceId.startsWith('report-native:') ? 'HWP 작업본 복구' : '이전 작업 복구'} ({candidates.length})</Button>}
    <Dialog isOpen={open} title="이전 작업 복구" onClose={() => { if (!busy) { setOpen(false); setDiscardId(null); } }} hideDefaultAction trapFocus>
      <div className="local-recovery-menu">
        <p>현재 원고는 복구를 선택할 때만 바뀝니다. 파일로 보관하는 것과 서버 저장은 별도입니다.</p>
        <p className="local-recovery-policy">임시 복구본은 마지막 보관 후 {RECOVERY_RETENTION_DAYS}일간 유지하며, 만료본은 사이트 사용 중 자동 정리합니다. 기존 복구본에는 정책 적용일부터 {RECOVERY_RETENTION_DAYS}일을 보장합니다.</p>
        <p>복구본 크기 합계 약 <b>{bytes(total)}</b>{candidates.some(item => item.byteSize === undefined) && ' · 일부 항목은 크기를 확인하지 못했습니다.'}</p>
        {error && <p role="alert">{error}</p>}
        <ul className="local-recovery-list">{candidates.map(candidate => <li key={candidate.snapshotId}>
          <strong>{candidate.documentName ?? (candidate.workspaceId.startsWith('report-native:') ? 'HWP 작업본' : candidate.workspaceId.startsWith('proposal:') ? '제안서 작업본' : '보고서 작업본')}{candidate.documentVersion !== undefined && ` · v${candidate.documentVersion}`}</strong>
          <p>보관 {new Date(candidate.writtenAt).toLocaleString('ko-KR')} · {candidate.byteSize === undefined ? '크기 확인 중' : `약 ${bytes(candidate.byteSize)}`}</p>
          <p>만료 {candidate.expiresAt ? new Date(candidate.expiresAt).toLocaleString('ko-KR') : '보관 기한 확인 중'}</p>
          <div className="local-recovery-actions">
            {onRestore && <Button variant="secondary" data-native-recovery-id={candidate.workspaceId.startsWith('report-native:') ? candidate.snapshotId : undefined} disabled={disabled || busy} onClick={() => void run(() => onRestore(candidate.snapshotId))}>{restoreLabel}</Button>}
            {onDownload && <Button variant="secondary" disabled={disabled || busy} onClick={() => void run(() => onDownload(candidate.snapshotId))}>복구본 파일로 보관</Button>}
            {onDiscard && <Button variant="secondary" disabled={disabled || busy} onClick={() => setDiscardId(candidate.snapshotId)}>이 복구본 삭제</Button>}
          </div>
          {discardId === candidate.snapshotId && onDiscard && <div className="local-recovery-delete"><p>이 임시 복구본만 삭제할까요? 현재 원고와 서버 저장본은 유지됩니다.</p><div className="local-recovery-actions"><Button variant="secondary" disabled={busy} onClick={() => setDiscardId(null)}>취소</Button><Button variant="danger" disabled={disabled || busy} onClick={() => void run(async () => { await onDiscard(candidate.snapshotId); setDiscardId(null); })}>이 복구본 삭제 확인</Button></div></div>}
        </li>)}</ul>
        <div className="dialog-actions"><Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>닫기</Button></div>
      </div>
    </Dialog>
  </>;
}
