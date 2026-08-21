import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';

export interface DialogProps {
  isOpen: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  hideDefaultAction?: boolean;
  size?: 'default' | 'wide';
}

export const Dialog: React.FC<DialogProps> = ({ isOpen, title, children, onClose, hideDefaultAction = false, size = 'default' }) => {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    panelRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`dialog-panel${size === 'wide' ? ' dialog-panel--wide' : ''}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        <div>{children}</div>
        {!hideDefaultAction && <div className="dialog-actions"><Button onClick={onClose}>확인</Button></div>}
      </div>
    </div>,
    document.body
  );
};
