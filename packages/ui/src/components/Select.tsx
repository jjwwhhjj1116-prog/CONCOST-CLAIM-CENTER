import React from 'react';
import { borderRadius, color, typography } from '../tokens';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SelectOption[];
  searchable?: boolean;
  searchPlaceholder?: string;
}

export const Select: React.FC<SelectProps> = ({ label, options, id, className = '', required, searchable = false, searchPlaceholder, ...props }) => {
  const fallbackId = React.useId();
  const [query, setQuery] = React.useState('');
  const selectId = id || (label ? `select-${label.replace(/\s+/g, '-').toLowerCase()}` : fallbackId);
  const needle = query.trim().toLocaleLowerCase('ko-KR');
  const selectedValue = String(props.value ?? props.defaultValue ?? '');
  const filteredOptions = !searchable || !needle
    ? options
    : options.filter((option) => option.label.toLocaleLowerCase('ko-KR').includes(needle) || option.value.toLocaleLowerCase('ko-KR').includes(needle));
  const selectedOption = options.find((option) => option.value === selectedValue);
  const searching = searchable && Boolean(needle);
  const selectionOutsideResults = searching && !filteredOptions.some((option) => option.value === selectedValue);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
      {label && (
        <label htmlFor={selectId} style={{ fontSize: typography.fontSize.sm, color: `var(--text-secondary, ${color.text.secondary})`, fontWeight: 650 }}>
          {label}{required && <span className="ui-required-mark" aria-hidden="true"> *</span>}
        </label>
      )}
      {searchable && (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder ?? `${label ?? '항목'} 검색`}
          aria-label={`${label ?? '항목'} 검색`}
          disabled={props.disabled}
          style={{
            minHeight: '40px',
            padding: '8px 12px',
            background: `var(--field-bg, ${color.background.primary})`,
            border: `1px solid var(--border-strong, ${color.glass.border})`,
            borderRadius: borderRadius.md,
            color: `var(--text-primary, ${color.text.primary})`,
            fontSize: typography.fontSize.sm,
            outlineOffset: '2px',
            boxSizing: 'border-box',
            width: '100%'
          }}
        />
      )}
      <select
        id={selectId}
        className={`${className} ${required ? 'ui-field--required' : ''}`.trim()}
        required={required}
        aria-required={required || undefined}
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
        size={searching ? Math.min(6, Math.max(2, filteredOptions.length)) : props.size}
        aria-describedby={searching ? `${selectId}-search-status` : props['aria-describedby']}
      >
        {selectionOutsideResults && <option value={selectedValue} hidden>{selectedOption?.label ?? ''}</option>}
        {filteredOptions.map((opt) => (
          <option key={opt.value} value={opt.value} style={{ background: `var(--field-bg, ${color.background.primary})`, color: `var(--text-primary, ${color.text.primary})` }}>
            {opt.label}
          </option>
        ))}
        {searching && filteredOptions.length === 0 && <option disabled>검색 결과가 없습니다</option>}
      </select>
      {searching && <small id={`${selectId}-search-status`} role="status" style={{ color: `var(--text-secondary, ${color.text.secondary})` }}>
        검색 결과 {filteredOptions.length}건 · {selectedOption ? `현재 선택: ${selectedOption.label}. ` : ''}결과를 선택해야 적용됩니다.
      </small>}
    </div>
  );
};
