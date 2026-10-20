/**
 * MultipleRide Driver — Design Tokens
 *
 * Extracted from the Stitch HTML Tailwind config.
 * All color, typography, spacing, and radius tokens for the app.
 *
 * RULE: No component may use hardcoded hex/rgba values.
 * Always reference tokens from this file.
 */

// ─── Colors (Material Design 3 palette) ────────────────────────────

export const colors = {
  // Primary
  primary: '#03071d',
  onPrimary: '#ffffff',
  primaryContainer: '#1a1f36',
  onPrimaryContainer: '#8286a2',
  primaryFixed: '#dde1ff',
  primaryFixedDim: '#c1c5e3',
  onPrimaryFixed: '#151a31',
  onPrimaryFixedVariant: '#41455f',
  inversePrimary: '#c1c5e3',

  // Secondary
  secondary: '#525e79',
  onSecondary: '#ffffff',
  secondaryContainer: '#d4dfff',
  onSecondaryContainer: '#56637e',
  secondaryFixed: '#d8e2ff',
  secondaryFixedDim: '#bac6e6',
  onSecondaryFixed: '#0e1b33',
  onSecondaryFixedVariant: '#3b4761',

  // Tertiary
  tertiary: '#0e0700',
  onTertiary: '#ffffff',
  tertiaryContainer: '#2b1e02',
  onTertiaryContainer: '#9a855e',
  tertiaryFixed: '#f9dfb2',
  tertiaryFixedDim: '#dcc398',
  onTertiaryFixed: '#261900',
  onTertiaryFixedVariant: '#554423',

  // Error
  error: '#ba1a1a',
  onError: '#ffffff',
  errorContainer: '#ffdad6',
  onErrorContainer: '#93000a',

  // Surface
  surface: '#f7f9fc',
  onSurface: '#191c1e',
  surfaceVariant: '#e0e3e6',
  onSurfaceVariant: '#46464d',
  surfaceBright: '#f7f9fc',
  surfaceDim: '#d8dadd',
  surfaceContainer: '#eceef1',
  surfaceContainerLow: '#f2f4f7',
  surfaceContainerHigh: '#e6e8eb',
  surfaceContainerHighest: '#e0e3e6',
  surfaceContainerLowest: '#ffffff',
  surfaceTint: '#585d77',

  // Inverse
  inverseSurface: '#2d3133',
  inverseOnSurface: '#eff1f4',

  // Outline
  outline: '#77767e',
  outlineVariant: '#c7c5ce',

  // Background (aliases surface in MD3)
  background: '#f7f9fc',
  onBackground: '#191c1e',

  // Semantic convenience aliases
  success: '#2e7d32',
  warning: '#f57c00',
  info: '#1976d2',

  // Transparent
  transparent: 'transparent',
} as const;

// ─── Typography ────────────────────────────────────────────────────

export const fontFamily = {
  inter: 'Inter',
} as const;

export const typography = {
  labelCaps: {
    fontFamily: fontFamily.inter,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600' as const,
    letterSpacing: 0.55, // 0.05em * 11px
    textTransform: 'uppercase' as const,
  },
  labelSm: {
    fontFamily: fontFamily.inter,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500' as const,
  },
  bodyMd: {
    fontFamily: fontFamily.inter,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400' as const,
  },
  dataMono: {
    fontFamily: fontFamily.inter,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500' as const,
    letterSpacing: -0.14, // -0.01em * 14px
  },
  bodyLg: {
    fontFamily: fontFamily.inter,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400' as const,
  },
  headlineSm: {
    fontFamily: fontFamily.inter,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600' as const,
    letterSpacing: -0.16, // -0.01em * 16px
  },
  headlineMd: {
    fontFamily: fontFamily.inter,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '600' as const,
    letterSpacing: -0.4, // -0.02em * 20px
  },
  // Additional sizes observed in designs
  headlineLg: {
    fontFamily: fontFamily.inter,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700' as const,
    letterSpacing: -0.48,
  },
  displaySm: {
    fontFamily: fontFamily.inter,
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700' as const,
    letterSpacing: -0.56,
  },
} as const;

// ─── Spacing ───────────────────────────────────────────────────────

export const spacing = {
  /** Base unit: 4px */
  unit: 4,
  /** 2 * unit = 8px */
  xs: 8,
  /** Gutter: 12px */
  gutter: 12,
  /** Small spacing: 12px */
  sm: 12,
  /** Container padding: 16px */
  containerPadding: 16,
  /** Standard spacing: 20px */
  md: 20,
  /** Large spacing: 24px */
  lg: 24,
  /** Extra large: 32px */
  xl: 32,
  /** 2XL: 40px */
  xxl: 40,
  /** Row height small: 40px */
  rowHeightSm: 40,
  /** Row height medium: 56px */
  rowHeightMd: 56,
} as const;

// ─── Border Radius ─────────────────────────────────────────────────

export const borderRadius = {
  /** Default: 2px */
  default: 2,
  /** Small: 4px */
  sm: 4,
  /** Medium: 8px */
  md: 8,
  /** Large: 12px */
  lg: 12,
  /** Extra large: 16px */
  xl: 16,
  /** Full round: 9999px */
  full: 9999,
} as const;

// ─── Shadows (Platform-specific) ──────────────────────────────────

import { Platform } from 'react-native';

export const shadows = {
  sm: Platform.select({
    ios: {
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 2,
    },
    android: {
      elevation: 1,
    },
  }),
  md: Platform.select({
    ios: {
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 4,
    },
    android: {
      elevation: 3,
    },
  }),
  lg: Platform.select({
    ios: {
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
    },
    android: {
      elevation: 6,
    },
  }),
} as const;

// ─── Icon Settings ─────────────────────────────────────────────────

export const iconDefaults = {
  size: 24,
  color: colors.onSurface,
} as const;
