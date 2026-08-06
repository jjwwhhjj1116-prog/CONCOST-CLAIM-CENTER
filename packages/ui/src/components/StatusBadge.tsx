import React from 'react';

export type StatusType = 'approved' | 'ai_draft' | 'review' | 'request_changes' | 'unwritten';

export interface StatusBadgeProps {
  status: StatusType;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const config: Record<StatusType, { label: string; color: string; bg: string }> = {
    approved: { label: '🟢 승인', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.15)' },
    ai_draft: { label: '🟣 AI초안', color: '#c084fc', bg: 'rgba(192, 132, 252, 0.15)' },
    review: { label: '🔵 검토중', color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.15)' },
    request_changes: { label: '🟠 수정요청', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.15)' },
    unwritten: { label: '⚪ 미작성', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)' }
  };

  const current = config[status] || config.unwritten;

  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 600,
        color: current.color,
        background: current.bg,
        border: `1px solid ${current.color}40`,
        display: 'inline-block'
      }}
    >
      {current.label}
    </span>
  );
};
