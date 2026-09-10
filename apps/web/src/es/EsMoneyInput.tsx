import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react';

/** Display only: no Number conversion, rounding, unit scaling or persisted separators. */
export function esFormatNumber(value: string): string {
  if (!/^-?\d+(?:\.\d*)?$/.test(value)) return value;
  const [integer, fraction] = value.split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : '.' + fraction);
}
export function EsMoneyInput({ value, onValueChange, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & { value: string; onValueChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const element = useRef<HTMLInputElement>(null);
  const selection = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    if (selection.current && element.current === document.activeElement) element.current?.setSelectionRange(...selection.current);
    selection.current = null;
  });
  // Focus must not rewrite the DOM value: it can collapse a replacement selection
  // and append new digits. Switch to raw editing only after the first input event.
  return <input {...props} ref={element} type="text" inputMode="decimal" className="es-money-input" value={editing ? value : esFormatNumber(value)} onBlur={e => { setEditing(false); props.onBlur?.(e); }} onChange={e => {
    const text = e.target.value;
    selection.current = [e.target.selectionStart ?? text.length, e.target.selectionEnd ?? text.length].map(pos => text.slice(0, pos).replaceAll(',', '').length) as [number, number];
    setEditing(true); onValueChange(text.replaceAll(',', ''));
  }} />;
}
