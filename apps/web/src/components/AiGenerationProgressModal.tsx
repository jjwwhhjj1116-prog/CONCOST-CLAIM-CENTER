import { useEffect, useRef, useState } from 'react';

export type AiGenerationStatus = 'running' | 'complete' | 'error';

interface AiGenerationProgressModalProps {
  isOpen: boolean;
  status: AiGenerationStatus;
  title: string;
  description: string;
  stages: readonly string[];
  completeMessage: string;
  errorMessage?: string;
  confirmLabel?: string;
  timeoutHintSeconds?: number;
  onConfirm: () => void;
  onClose: () => void;
}

export function AiGenerationProgressModal({
  isOpen,
  status,
  title,
  description,
  stages,
  completeMessage,
  errorMessage,
  confirmLabel = '확인하고 다음 단계로',
  timeoutHintSeconds = 180,
  onConfirm,
  onClose
}: AiGenerationProgressModalProps): React.ReactElement | null {
  const [progress, setProgress] = useState(8);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const actionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (status === 'complete') {
      setProgress(100);
      window.setTimeout(() => actionRef.current?.focus(), 40);
      return;
    }
    if (status === 'error') {
      window.setTimeout(() => actionRef.current?.focus(), 40);
      return;
    }
    setProgress(8);
    setElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
      setProgress((current) => Math.min(98, current + (current < 72 ? 4 : current < 90 ? 2 : 1)));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [isOpen, status, title]);

  useEffect(() => {
    if (!isOpen || status === 'running') return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isOpen, onClose, status]);

  if (!isOpen) return null;
  const stageIndex = Math.min(stages.length - 1, Math.floor((Math.min(progress, 99) / 100) * stages.length));
  const statusLabel = status === 'running' ? '작성 중' : status === 'complete' ? '작성 완료' : '확인 필요';

  return <div className="ai-generation-overlay" role="presentation">
    <section className={`ai-generation-modal is-${status}`} role="dialog" aria-modal="true" aria-labelledby="ai-generation-title" aria-describedby="ai-generation-description">
      <div className="ai-generation-modal__signal" aria-hidden="true">
        {status === 'complete' ? <span>✓</span> : status === 'error' ? <span>!</span> : <i />}
      </div>
      <span className="ai-generation-modal__eyebrow">GEMINI · CLAIM CENTER STUDIO</span>
      <h2 id="ai-generation-title">{title}</h2>
      <p id="ai-generation-description">{status === 'complete' ? completeMessage : status === 'error' ? errorMessage ?? 'AI 작성 결과를 저장하지 못했습니다.' : description}</p>
      <div className="ai-generation-modal__meter" role="progressbar" aria-label={statusLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={status === 'error' ? progress : status === 'complete' ? 100 : progress} aria-valuetext={status === 'running' ? `${progress}% · ${elapsedSeconds}초 경과` : statusLabel}>
        <span><i style={{ width: `${status === 'complete' ? 100 : progress}%` }} /></span>
        <strong>{status === 'error' ? '중단' : `${status === 'complete' ? 100 : progress}%${status === 'running' ? ` · ${elapsedSeconds}초` : ''}`}</strong>
      </div>
      <ol className="ai-generation-modal__stages" aria-label="AI 작성 처리 단계">
        {stages.map((stage, index) => <li key={stage} className={status === 'complete' || index < stageIndex ? 'is-complete' : index === stageIndex && status === 'running' ? 'is-current' : ''}>
          <b>{status === 'complete' || index < stageIndex ? '✓' : index + 1}</b><span>{stage}</span>
        </li>)}
      </ol>
      <div className="ai-generation-modal__actions">
        {status === 'complete' && <button ref={actionRef} type="button" className="ai-generation-modal__confirm" onClick={onConfirm}>✓ {confirmLabel}</button>}
        {status === 'error' && <button ref={actionRef} type="button" className="ai-generation-modal__close" onClick={onClose}>닫고 입력 확인</button>}
        {status === 'running' && <small>{progress >= 90 ? `Gemini 최종 응답과 보안 검증을 기다리고 있습니다. ${timeoutHintSeconds}초를 넘기면 원인을 표시하고 자동 중단합니다.` : '창을 닫지 않아도 완료되면 자동으로 ✓ 표시가 나타납니다.'}</small>}
      </div>
    </section>
  </div>;
}
