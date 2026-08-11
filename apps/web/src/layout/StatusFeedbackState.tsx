import React from 'react';
import './StatusFeedbackState.css';

export interface StatusFeedbackStateProps {
  type: 'loading' | 'empty' | 'error' | 'forbidden' | 'conflict' | 'offline';
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}

export const StatusFeedbackState: React.FC<StatusFeedbackStateProps> = ({
  type,
  title,
  message,
  actionLabel,
  onAction,
  compact = false
}) => {
  const defaults = {
    loading: {
      title: '데이터를 불러오는 중입니다...',
      message: '잠시만 기다려 주세요. 안전하게 동기화하고 있습니다.',
      icon: '⏳'
    },
    empty: {
      title: '조회된 데이터가 없습니다',
      message: '등록된 항목이 없거나 조건에 일치하는 데이터가 없습니다.',
      icon: '📁'
    },
    error: {
      title: '오류가 발생했습니다',
      message: '요청을 처리하는 중 문제가 발생했습니다. 다시 시도해 주세요.',
      icon: '⚠️'
    },
    forbidden: {
      title: '접근 권한이 제한되었습니다 (403)',
      message: '해당 사건 또는 작업에 접근할 수 있는 승인된 역할이 아닙니다.',
      icon: '🔒'
    },
    conflict: {
      title: '동시 수정 충돌이 발생했습니다 (409)',
      message: '다른 사용자에 의해 최신 버전이 변경되었습니다. 데이터를 새로고침 후 다시 시도하세요.',
      icon: '🔄'
    },
    offline: {
      title: '네트워크 연결 상태 확인 필요',
      message: '서버와 통신이 원활하지 않습니다. 저장되지 않은 데이터는 보존됩니다.',
      icon: '📡'
    }
  };

  const config = defaults[type];
  const displayTitle = title ?? config.title;
  const displayMessage = message ?? config.message;

  return (
    <div className={`status-feedback-container ${type} ${compact ? 'compact' : ''}`} role="region" aria-live="polite">
      <div className="status-feedback-icon" aria-hidden="true">{config.icon}</div>
      <div className="status-feedback-content">
        <h3 className="status-feedback-title">{displayTitle}</h3>
        <p className="status-feedback-message">{displayMessage}</p>
        {onAction && actionLabel && (
          <button type="button" className="status-feedback-action-btn" onClick={onAction}>
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
};
