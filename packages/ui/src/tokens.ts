import designTokens from '../../../docs/stitch/design-tokens.json';

/** The P02 JSON contract is the only design-token source used by application code. */
export const tokens = designTokens;
export const color = tokens.color;
export const typography = tokens.typography;
export const spacing = tokens.spacing;
export const borderRadius = tokens.borderRadius;

export const themeCssVariables: Record<string, string> = {
  '--color-bg-primary': color.background.primary,
  '--color-bg-secondary': color.background.secondary,
  '--color-bg-tertiary': color.background.tertiary,
  '--color-surface': color.glass.surface,
  '--color-border': color.glass.border,
  '--color-primary': color.primary.main,
  '--color-primary-hover': color.primary.hover,
  '--color-danger': color.status.danger,
  '--color-text-primary': color.text.primary,
  '--color-text-secondary': color.text.secondary,
  '--font-primary': typography.fontFamily.primary,
  '--space-sm': spacing.sm,
  '--space-md': spacing.md,
  '--space-lg': spacing.lg,
  '--radius-md': borderRadius.md
};
