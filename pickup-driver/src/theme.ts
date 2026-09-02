/**
 * Theme tokens extracted from the Pick Up Design System Stitch project.
 * Source: tailwind.config in `.stitch/designs/*.html`
 *
 * ALL color, spacing, typography, and border-radius values used in components
 * MUST reference these tokens. Raw hex/rgba strings in StyleSheet are prohibited.
 */

// ─── Color Tokens ────────────────────────────────────────────────────────────

export const colors = {
  // Core brand
  primary: '#03071D',
  primaryContainer: '#151A31',
  onPrimary: '#FFFFFF',
  onPrimaryContainer: '#7E829E',
  primaryFixed: '#DDE1FF',
  primaryFixedDim: '#C0C5E3',
  onPrimaryFixed: '#151A31',
  onPrimaryFixedVariant: '#40465E',

  // Secondary
  secondary: '#525E79',
  secondaryContainer: '#D4DFFF',
  onSecondary: '#FFFFFF',
  onSecondaryContainer: '#57637E',
  secondaryFixed: '#D8E2FF',
  secondaryFixedDim: '#BAC6E6',
  onSecondaryFixed: '#0E1B33',
  onSecondaryFixedVariant: '#3B4760',

  // Tertiary
  tertiary: '#000000',
  tertiaryContainer: '#231A09',
  onTertiary: '#FFFFFF',
  onTertiaryContainer: '#91826A',
  tertiaryFixed: '#F3E0C5',
  tertiaryFixedDim: '#D6C4AA',
  onTertiaryFixed: '#231A09',
  onTertiaryFixedVariant: '#514531',

  // Error
  error: '#BA1A1A',
  errorContainer: '#FFDAD6',
  onError: '#FFFFFF',
  onErrorContainer: '#93000A',

  // Surface / Background
  surface: '#FFFFFF',
  surfaceBright: '#F7F9FC',
  surfaceDim: '#D8DADD',
  surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#F2F4F7',
  surfaceContainer: '#ECEEF1',
  surfaceContainerHigh: '#E6E8EB',
  surfaceContainerHighest: '#E0E3E6',
  surfaceVariant: '#E0E3E6',
  surfaceTint: '#585D77',
  background: '#F7F9FC',

  // On-Surface
  onSurface: '#191C1E',
  onSurfaceVariant: '#46464D',
  onBackground: '#191C1E',

  // Outline
  outline: '#77767E',
  outlineVariant: '#C7C5CE',
  outlineHairline: '#E2E8F0',

  // Inverse
  inverseSurface: '#2D3133',
  inverseOnSurface: '#EFF1F4',
  inversePrimary: '#C0C5E3',

  // Status / Semantic
  statusGreen: '#2D6A4F',
  statusRed: '#BA1A1A',
  successContainer: '#D4F5E0',
  onSuccessContainer: '#1B4332',

  // Utility
  transparent: 'transparent',
  white: '#FFFFFF',
  black: '#000000',
} as const;

// ─── Spacing Tokens ──────────────────────────────────────────────────────────

export const spacing = {
  unit: 4,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,

  // Named design-system tokens
  gutterSm: 12,
  stackGapSm: 8,
  stackGapMd: 16,
  marginMobile: 16,
  rowHeightStandard: 56,
  rowHeightSm: 40,
  containerPadding: 16,
} as const;

// ─── Border Radius Tokens ────────────────────────────────────────────────────

export const borderRadius = {
  none: 0,
  xs: 2,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
  full: 9999,
} as const;

// ─── Typography Tokens ───────────────────────────────────────────────────────

export const fontFamily = {
  default: 'Inter',
} as const;

export const typography = {
  headlineLg: {
    fontFamily: fontFamily.default,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
  },
  headlineMd: {
    fontFamily: fontFamily.default,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '600' as const,
    letterSpacing: -0.4,
  },
  headlineSm: {
    fontFamily: fontFamily.default,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600' as const,
    letterSpacing: -0.16,
  },
  bodyLg: {
    fontFamily: fontFamily.default,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400' as const,
    letterSpacing: 0,
  },
  bodyMd: {
    fontFamily: fontFamily.default,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400' as const,
    letterSpacing: 0,
  },
  labelSm: {
    fontFamily: fontFamily.default,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500' as const,
    letterSpacing: 0,
  },
  labelCaps: {
    fontFamily: fontFamily.default,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600' as const,
    letterSpacing: 0.55,
    textTransform: 'uppercase' as const,
  },
  dataMono: {
    fontFamily: fontFamily.default,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500' as const,
    letterSpacing: -0.14,
  },
} as const;

// ─── Shadow Tokens ───────────────────────────────────────────────────────────

import { Platform } from 'react-native';

export const shadows = {
  ghost: Platform.select({
    ios: {
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.04,
      shadowRadius: 20,
    },
    android: {
      elevation: 2,
    },
  }),
  ghostShadow: Platform.select({
    ios: {
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 20,
    },
    android: {
      elevation: 3,
    },
  }),
  card: Platform.select({
    ios: {
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
    },
    android: {
      elevation: 4,
    },
  }),
  elevated: Platform.select({
    ios: {
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 16,
    },
    android: {
      elevation: 8,
    },
  }),
  sm: Platform.select({
    ios: {
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 6,
    },
    android: {
      elevation: 2,
    },
  }),
  md: Platform.select({
    ios: {
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
    },
    android: {
      elevation: 4,
    },
  }),
} as const;
