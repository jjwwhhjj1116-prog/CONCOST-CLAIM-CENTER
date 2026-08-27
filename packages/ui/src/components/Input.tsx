import React from 'react';
import { borderRadius, color, typography } from '../tokens';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, className = '', id, required, ...props }) => {
  const inputId = id || (label ? `input-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
      {label && (
        <label htmlFor={inputId} style={{ fontSize: typography.fontSize.sm, color: `var(--text-secondary, ${color.text.secondary})`, fontWeight: 650 }}>
          {label}{required && <span className="ui-required-mark" aria-hidden="true"> *</span>}
        </label>
      )}
      <input
        id={inputId}
        className={`${className} ${required ? 'ui-field--required' : ''}`.trim()}
        required={required}
        aria-required={required || undefined}
        aria-invalid={Boolean(error) || undefined}
        style={{
          padding: '10px 12px',
          background: `var(--field-bg, ${color.background.primary})`,
          border: `1px solid ${error ? color.status.danger : `var(--border-strong, ${color.glass.border})`}`,
          borderRadius: borderRadius.md,
          color: `var(--text-primary, ${color.text.primary})`,
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
