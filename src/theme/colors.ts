export const colors = {
  primary: '#1f7a4d', // field green
  primaryDark: '#125536',
  primaryLight: '#e3f3ea',
  primarySoft: '#bfe3cf',
  secondary: '#1667c4', // water blue
  secondaryLight: '#e6f0fc',
  sun: '#e59a0b', // sunlight and warmth
  sunLight: '#fff3d9',
  soil: '#8a5a33',
  soilLight: '#f5ebe1',
  background: '#f2f6f3',
  surface: '#ffffff',
  surfaceAlt: '#f7faf8',
  text: '#13211a',
  textMuted: '#5a6b61',
  textFaint: '#8a9a90',
  border: '#dde6e0',
  warning: '#8a5a00',
  warningBg: '#fff4d6',
  danger: '#b3261e',
  dangerBg: '#fde7e5',
  infoBg: '#e6f0fc',
  white: '#ffffff',
  overlay: 'rgba(8, 20, 14, 0.45)',
};

/** Colours for the five suitability classes, from best to worst. */
export const suitabilityColors = {
  high: '#1f7a4d',
  moderate: '#5f9e2f',
  marginal: '#d28a0c',
  low: '#c4521c',
  unsuitable: '#b3261e',
  unknown: '#8a9a90',
} as const;

/** Minimum touch target, per Android accessibility guidance (48 dp). */
export const TOUCH_TARGET = 48;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 };

export const shadow = {
  card: { boxShadow: '0 1px 2px rgba(16, 40, 24, 0.06), 0 4px 14px rgba(16, 40, 24, 0.06)' },
  float: { boxShadow: '0 2px 6px rgba(8, 20, 14, 0.18), 0 8px 24px rgba(8, 20, 14, 0.14)' },
} as const;

export const type = {
  title: { fontSize: 19, fontWeight: '700' as const, color: colors.text, letterSpacing: -0.2 },
  heading: { fontSize: 15, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 14, lineHeight: 20, color: colors.text },
  small: { fontSize: 12, lineHeight: 17, color: colors.textMuted },
  label: { fontSize: 11, fontWeight: '700' as const, color: colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' as const },
  number: { fontSize: 24, fontWeight: '700' as const, color: colors.text, letterSpacing: -0.4 },
};
