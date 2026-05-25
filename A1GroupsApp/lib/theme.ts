import { Platform } from 'react-native';

// ─── Brand Palette ────────────────────────────────────────────────────────────
export const C = {
  primary:   '#7B61FF',
  primarySoft:'#EDE9FF',
  primary80: 'rgba(123,97,255,0.8)',
  primary20: 'rgba(123,97,255,0.2)',
  primary10: 'rgba(123,97,255,0.1)',
  primary06: 'rgba(123,97,255,0.06)',

  success:   '#00C9A7',
  success10: 'rgba(0,201,167,0.12)',
  warning:   '#FFB020',
  warning10: 'rgba(255,176,32,0.12)',
  danger:    '#FF4D4D',
  danger10:  'rgba(255,77,77,0.12)',
  info:      '#3B82F6',
  info10:    'rgba(59,130,246,0.12)',

  income:  '#00C9A7',
  expense: '#FF4D4D',

  navy:    '#1A1A2E',
  mid:     '#3D3D5C',
  muted:   '#6E6E8D',
  pale:    '#9B9BB4',
};

// ─── Light Theme ─────────────────────────────────────────────────────────────
export const LT = {
  bg:      '#EEF0FF',   // soft lavender
  card:    '#FFFFFF',
  cardAlt: '#F7F5FF',   // slightly tinted card
  text:    '#1A1A2E',
  textMid: '#3D3D5C',
  sub:     '#6E6E8D',
  border:  'rgba(123,97,255,0.12)',
  divider: 'rgba(123,97,255,0.08)',
  input:   '#F7F5FF',
  nav:     '#FFFFFF',
  header:  '#FFFFFF',
  tabBg:   '#FFFFFF',
};

// ─── Dark Theme ──────────────────────────────────────────────────────────────
export const DK = {
  bg:      '#12102B',
  card:    '#1E1B3A',
  cardAlt: '#161430',
  text:    '#F0EDFF',
  textMid: '#C8C3E8',
  sub:     '#9B98C0',
  border:  'rgba(123,97,255,0.2)',
  divider: 'rgba(123,97,255,0.1)',
  input:   '#12102B',
  nav:     '#1E1B3A',
  header:  '#1E1B3A',
  tabBg:   '#1E1B3A',
};

export const t = (isDark: boolean) => (isDark ? DK : LT);

// ─── Typography ──────────────────────────────────────────────────────────────
export const TYPE = {
  hero:    { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.5, color: C.navy },
  title:   { fontSize: 22, fontWeight: '800' as const, letterSpacing: -0.4, color: C.navy },
  heading: { fontSize: 17, fontWeight: '700' as const, letterSpacing: -0.2 },
  body:    { fontSize: 14, fontWeight: '400' as const },
  bodyMd:  { fontSize: 14, fontWeight: '600' as const },
  label:   { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
  micro:   { fontSize: 10, fontWeight: '700' as const, letterSpacing: 0.5 },
};

// ─── Radius ───────────────────────────────────────────────────────────────────
export const R = { xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 28, pill: 9999 };

// ─── Spacing ─────────────────────────────────────────────────────────────────
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 };

// ─── Purple-tinted shadows ────────────────────────────────────────────────────
export const SHADOW = {
  card: Platform.select({
    ios:     { shadowColor: '#7B61FF', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 16 },
    android: { elevation: 4 },
    default: {},
  }),
  sm: Platform.select({
    ios:     { shadowColor: '#7B61FF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8 },
    android: { elevation: 2 },
    default: {},
  }),
  lg: Platform.select({
    ios:     { shadowColor: '#7B61FF', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 24 },
    android: { elevation: 8 },
    default: {},
  }),
  btn: Platform.select({
    ios:     { shadowColor: '#7B61FF', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 14 },
    android: { elevation: 6 },
    default: {},
  }),
};
