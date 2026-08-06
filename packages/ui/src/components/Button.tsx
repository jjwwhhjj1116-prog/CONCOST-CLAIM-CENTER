import React from 'react';

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
    fontFamily: 'Inter, sans-serif',
    fontWeight: 600,
    borderRadius: '6px',
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
    primary: { background: 'hsl(217, 91%, 60%)', color: '#ffffff' },
    secondary: { background: 'hsl(217, 33%, 25%)', color: '#f8fafc', border: '1px solid rgba(255,255,255,0.2)' },
    danger: { background: 'hsl(346, 87%, 60%)', color: '#ffffff' },
    ghost: { background: 'transparent', color: '#94a3b8' }
  };

  const sizeStyles: Record<string, React.CSSProperties> = {
    sm: { padding: '6px 12px', fontSize: '12px' },
    md: { padding: '10px 16px', fontSize: '14px' },
    lg: { padding: '14px 24px', fontSize: '16px' }
  };

  return (
    <button
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
