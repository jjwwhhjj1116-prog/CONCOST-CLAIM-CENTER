import React from 'react';

export interface CardProps {
  title?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export const Card: React.FC<CardProps> = ({ title, children, style }) => {
  return (
    <div
      style={{
        background: 'hsla(217, 33%, 17%, 0.75)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '8px',
        padding: '20px',
        color: '#f8fafc',
        ...style
      }}
    >
      {title && <h4 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#38bdf8' }}>{title}</h4>}
      {children}
    </div>
  );
};
