import { useState, type InputHTMLAttributes } from 'react';

/** Display only: no Number conversion, rounding, unit scaling or persisted separators. */
export function esFormatNumber(value: string): string {
  if (!/^-?\d+(?:\.\d*)?$/.test(value)) return value;
  const [integer, fraction] = value.split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : '.' + fraction);
}
export function EsMoneyInput({ value, onValueChange, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & { value: string; onValueChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  return <input {...props} type="text" inputMode="decimal" className="es-money-input" value={editing ? value : esFormatNumber(value)} onFocus={e => { setEditing(true); props.onFocus?.(e); }} onBlur={e => { setEditing(false); props.onBlur?.(e); }} onChange={e => onValueChange(e.target.value.replaceAll(',', ''))} />;
}
