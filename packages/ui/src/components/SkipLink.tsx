import React from 'react';

export interface SkipLinkProps {
  targetId?: string;
  label?: string;
}

export const SkipLink: React.FC<SkipLinkProps> = ({ targetId = 'main-content', label = '본문 영역으로 바로가기' }) => {
  return (
    <a
      href={`#${targetId}`}
      style={{
        position: 'absolute',
        top: '-100px',
        left: '16px',
        background: 'hsl(217, 91%, 60%)',
        color: '#ffffff',
        padding: '12px 20px',
        zIndex: 9999,
        borderRadius: '6px',
        fontWeight: 'bold',
        textDecoration: 'none',
        transition: 'top 0.2s'
      }}
      onFocus={(e) => (e.currentTarget.style.top = '16px')}
      onBlur={(e) => (e.currentTarget.style.top = '-100px')}
    >
      {label}
    </a>
  );
};
