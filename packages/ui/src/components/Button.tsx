import React from 'react';
import { borderRadius, color, spacing, typography } from '../tokens';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyle: React.CSSProperties = {
    fontFamily: typography.fontFamily.primary,
    fontWeight: 600,
    borderRadius: borderRadius.md,
    border: 'none',
    cursor: disabled || isLoading ? 'not-allowed' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'all 0.15s ease-in-out',
    outlineOffset: '2px'
  };

  const variantStyles: Record<string, React.CSSProperties> = {
    primary: { background: `var(--action-primary, ${color.primary.main})`, color: `var(--action-primary-text, ${color.text.primary})` },
    secondary: { background: `var(--action-secondary, ${color.background.tertiary})`, color: `var(--text-primary, ${color.text.primary})`, border: `1px solid var(--border-strong, ${color.glass.border})` },
    danger: { background: `var(--action-danger, ${color.status.danger})`, color: `var(--action-primary-text, ${color.text.primary})` },
    ghost: { background: 'transparent', color: `var(--text-secondary, ${color.text.secondary})` }
  };

  const sizeStyles: Record<string, React.CSSProperties> = {
    sm: { padding: `${spacing.xs} ${spacing.sm}`, fontSize: typography.fontSize.xs },
    md: { padding: `${spacing.sm} ${spacing.md}`, fontSize: typography.fontSize.sm },
    lg: { padding: `${spacing.md} ${spacing.lg}`, fontSize: typography.fontSize.lg }
  };

  return (
    <button
      className={`ui-button ui-button--${variant} ui-button--${size} ${className}`.trim()}
      style={{
        ...baseStyle,
        ...variantStyles[variant],
        ...sizeStyles[size],
        opacity: disabled || isLoading ? 0.6 : 1
      }}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? <span className="spinner">⌛</span> : children}
    </button>
  );
};
