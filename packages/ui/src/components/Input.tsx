import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, className = '', id, ...props }) => {
  const inputId = id || (label ? `input-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
      {label && (
        <label htmlFor={inputId} style={{ fontSize: '14px', color: '#94a3b8', fontWeight: 500 }}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        style={{
          padding: '10px 12px',
          background: 'rgba(15, 23, 42, 0.8)',
          border: error ? '1px solid hsl(346, 87%, 60%)' : '1px solid rgba(255, 255, 255, 0.2)',
          borderRadius: '6px',
          color: '#f8fafc',
          fontSize: '14px',
          outlineOffset: '2px',
          boxSizing: 'border-box',
          width: '100%'
        }}
        {...props}
      />
      {error && <span style={{ fontSize: '12px', color: 'hsl(346, 87%, 60%)' }}>{error}</span>}
    </div>
  );
};
