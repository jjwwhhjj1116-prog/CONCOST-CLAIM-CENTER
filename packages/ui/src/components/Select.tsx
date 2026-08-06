import React from 'react';

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
        <label htmlFor={selectId} style={{ fontSize: '14px', color: '#94a3b8', fontWeight: 500 }}>
          {label}
        </label>
      )}
      <select
        id={selectId}
        style={{
          padding: '10px 12px',
          background: 'rgba(15, 23, 42, 0.8)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          borderRadius: '6px',
          color: '#f8fafc',
          fontSize: '14px',
          outlineOffset: '2px',
          boxSizing: 'border-box',
          width: '100%'
        }}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} style={{ background: '#0f172a', color: '#f8fafc' }}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};
