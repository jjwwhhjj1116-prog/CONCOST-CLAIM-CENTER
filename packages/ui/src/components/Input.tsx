import React from 'react';
import { borderRadius, color, typography } from '../tokens';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, className = '', id, ...props }) => {
  const inputId = id || (label ? `input-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
      {label && (
        <label htmlFor={inputId} style={{ fontSize: typography.fontSize.sm, color: color.text.secondary, fontWeight: 500 }}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={className}
        style={{
          padding: '10px 12px',
          background: color.background.primary,
          border: `1px solid ${error ? color.status.danger : color.glass.border}`,
          borderRadius: borderRadius.md,
          color: color.text.primary,
          fontSize: typography.fontSize.sm,
          outlineOffset: '2px',
          boxSizing: 'border-box',
          width: '100%'
        }}
        {...props}
      />
      {error && <span role="alert" style={{ fontSize: typography.fontSize.xs, color: color.status.danger }}>{error}</span>}
    </div>
  );
};
