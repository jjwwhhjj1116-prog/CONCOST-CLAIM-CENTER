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
    primary: { background: color.primary.main, color: color.text.primary },
    secondary: { background: color.background.tertiary, color: color.text.primary, border: `1px solid ${color.glass.border}` },
    danger: { background: color.status.danger, color: color.text.primary },
    ghost: { background: 'transparent', color: color.text.secondary }
  };

  const sizeStyles: Record<string, React.CSSProperties> = {
    sm: { padding: `${spacing.xs} ${spacing.sm}`, fontSize: typography.fontSize.xs },
    md: { padding: `${spacing.sm} ${spacing.md}`, fontSize: typography.fontSize.sm },
    lg: { padding: `${spacing.md} ${spacing.lg}`, fontSize: typography.fontSize.lg }
  };

  return (
    <button
      className={className}
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
