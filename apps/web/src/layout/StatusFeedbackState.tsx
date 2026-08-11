import React from 'react';

export type StatusFeedbackType = 'loading' | 'empty' | 'error' | 'forbidden' | 'conflict' | 'offline';

export interface StatusFeedbackStateProps {
  type: StatusFeedbackType;
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}

const DEFAULTS: Record<StatusFeedbackType, { title: string; message: string; icon: string }> = {
  loading: {
    title: '데이터를 불러오는 중입니다',
    message: '잠시만 기다려 주세요. 안전하게 동기화하고 있습니다.',
    icon: ''
  },
  empty: {
    title: '표시할 데이터가 없습니다',
    message: '아직 등록된 항목이 없거나 검색 조건과 일치하는 결과가 없습니다.',
    icon: '—'
  },
  error: {
    title: '요청을 처리하지 못했습니다',
    message: '일시적인 오류가 발생했습니다. 최신 데이터를 다시 불러와 주세요.',
    icon: '!'
  },
  forbidden: {
    title: '접근 권한이 없습니다 (403)',
    message: '이 화면 또는 사건에 접근하려면 담당 배정이나 추가 권한이 필요합니다.',
    icon: '403'
  },
  conflict: {
    title: '동시 수정 충돌이 발생했습니다 (409)',
    message: '다른 사용자가 먼저 변경했습니다. 최신 버전을 불러온 뒤 다시 시도해 주세요.',
    icon: '↻'
  },
  offline: {
    title: '서버에 연결할 수 없습니다',
    message: '네트워크 연결을 확인한 뒤 다시 시도해 주세요. 입력 중인 내용은 유지됩니다.',
    icon: '⌁'
  }
};

export const StatusFeedbackState: React.FC<StatusFeedbackStateProps> = ({
  type,
  title,
  message,
  actionLabel,
  onAction,
  compact = false
}) => {
  const config = DEFAULTS[type];
  const isPassive = type === 'loading' || type === 'empty';
  return (
    <section
      className={`status-feedback-container ${type} ${compact ? 'compact' : ''}`}
      data-status-type={type}
      role={isPassive ? 'status' : 'alert'}
      aria-live={isPassive ? 'polite' : 'assertive'}
      aria-busy={type === 'loading'}
    >
      <span className={`status-feedback-icon ${type === 'loading' ? 'status-feedback-spinner' : ''}`} aria-hidden="true">
        {config.icon}
      </span>
      <div className="status-feedback-content">
        <h3 className="status-feedback-title">{title ?? config.title}</h3>
        <p className="status-feedback-message">{message ?? config.message}</p>
        {onAction && actionLabel ? (
          <button type="button" className="status-feedback-action-btn" onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
    </section>
  );
};
