import React from 'react';
import { borderRadius, color, typography } from '../tokens';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SelectOption[];
}

export const Select: React.FC<SelectProps> = ({ label, options, id, ...props }) => {
  const selectId = id || (label ? `select-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
      {label && (
        <label htmlFor={selectId} style={{ fontSize: typography.fontSize.sm, color: `var(--text-secondary, ${color.text.secondary})`, fontWeight: 650 }}>
          {label}
        </label>
      )}
      <select
        id={selectId}
        style={{
          padding: '10px 12px',
          background: `var(--field-bg, ${color.background.primary})`,
          border: `1px solid var(--border-strong, ${color.glass.border})`,
          borderRadius: borderRadius.md,
          color: `var(--text-primary, ${color.text.primary})`,
          fontSize: typography.fontSize.sm,
          outlineOffset: '2px',
          boxSizing: 'border-box',
          width: '100%'
        }}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} style={{ background: `var(--field-bg, ${color.background.primary})`, color: `var(--text-primary, ${color.text.primary})` }}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};
