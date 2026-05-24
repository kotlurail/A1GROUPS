import { Platform, StyleSheet } from 'react-native';

// ─── Brand Palette ───────────────────────────────────────────────────────────
export const C = {
  primary:   '#6C63FF',
  primary15: '#6C63FF26',
  primary25: '#6C63FF40',
  success:   '#10B981',
  success15: '#10B98126',
  warning:   '#F59E0B',
  warning15: '#F59E0B26',
  danger:    '#EF4444',
  danger15:  '#EF444426',
  info:      '#3B82F6',
  info15:    '#3B82F626',
  income:    '#10B981',
  expense:   '#EF4444',
};

// ─── Light Theme ─────────────────────────────────────────────────────────────
export const LT = {
  bg:      '#F4F6FB',
  card:    '#FFFFFF',
  text:    '#111827',
  textMid: '#374151',
  sub:     '#6B7280',
  border:  '#E5E7EB',
  divider: '#F3F4F6',
  input:   '#F9FAFB',
  nav:     '#FFFFFF',
  header:  '#FFFFFF',
};

// ─── Dark Theme ──────────────────────────────────────────────────────────────
export const DK = {
  bg:      '#0D1117',
  card:    '#161B22',
  text:    '#E6EDF3',
  textMid: '#C9D1D9',
  sub:     '#8B949E',
  border:  '#30363D',
  divider: '#21262D',
  input:   '#0D1117',
  nav:     '#161B22',
  header:  '#161B22',
};

export const t = (isDark: boolean) => (isDark ? DK : LT);

// ─── Typography ──────────────────────────────────────────────────────────────
export const TYPE = {
  hero:    { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.5 },
  title:   { fontSize: 22, fontWeight: '800' as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: '700' as const, letterSpacing: -0.2 },
  body:    { fontSize: 14, fontWeight: '400' as const },
  bodyMd:  { fontSize: 14, fontWeight: '600' as const },
  label:   { fontSize: 12, fontWeight: '600' as const, letterSpacing: 0.3 },
  caption: { fontSize: 11, fontWeight: '500' as const, letterSpacing: 0.2 },
  micro:   { fontSize: 10, fontWeight: '600' as const, letterSpacing: 0.5 },
};

// ─── Radius ───────────────────────────────────────────────────────────────────
export const R = { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, full: 9999 };

// ─── Spacing ─────────────────────────────────────────────────────────────────
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40 };

// ─── Shadows ─────────────────────────────────────────────────────────────────
export const SHADOW = {
  xs: Platform.select({
    ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4 },
    android: { elevation: 1 },
    default: {},
  }),
  sm: Platform.select({
    ios:     { shadowColor: '#6C63FF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
    android: { elevation: 3 },
    default: {},
  }),
  md: Platform.select({
    ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.07, shadowRadius: 16 },
    android: { elevation: 5 },
    default: {},
  }),
  card: Platform.select({
    ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10 },
    android: { elevation: 2 },
    default: {},
  }),
};

// ─── Shared component styles (returned fresh so StyleSheet can process them) ──
export const sharedStyles = (isDark: boolean) => {
  const th = t(isDark);
  return {
    // Page
    safe:   { flex: 1, backgroundColor: th.bg },
    screen: { flex: 1, backgroundColor: th.bg },

    // Header bar
    headerBar: {
      flexDirection: 'row' as const, alignItems: 'center' as const,
      paddingHorizontal: S.lg, paddingVertical: S.md,
      backgroundColor: th.header, borderBottomWidth: 1, borderBottomColor: th.border,
      ...SHADOW.xs,
    },

    // Cards
    card: {
      backgroundColor: th.card, borderRadius: R.lg, padding: S.lg,
      borderWidth: 1, borderColor: th.border, ...SHADOW.card,
    },
    cardSm: {
      backgroundColor: th.card, borderRadius: R.md, padding: S.md,
      borderWidth: 1, borderColor: th.border, ...SHADOW.xs,
    },

    // Inputs
    input: {
      backgroundColor: th.input, borderWidth: 1, borderColor: th.border,
      borderRadius: R.sm, paddingHorizontal: S.md, paddingVertical: 11,
      color: th.text, fontSize: 14,
    },

    // Select trigger
    trigger: {
      flexDirection: 'row' as const, alignItems: 'center' as const,
      backgroundColor: th.input, borderWidth: 1, borderColor: th.border,
      borderRadius: R.sm, paddingHorizontal: S.md, paddingVertical: 11,
    },

    // Buttons
    btnPrimary: {
      backgroundColor: C.primary, borderRadius: R.sm,
      paddingVertical: 13, alignItems: 'center' as const, justifyContent: 'center' as const,
    },
    btnOutline: {
      borderWidth: 1.5, borderColor: C.primary, borderRadius: R.sm,
      paddingVertical: 12, alignItems: 'center' as const, justifyContent: 'center' as const,
    },
    btnDanger: {
      borderWidth: 1.5, borderColor: C.danger, borderRadius: R.sm,
      paddingVertical: 12, alignItems: 'center' as const, justifyContent: 'center' as const,
    },

    // Labels
    label: { fontSize: 12, fontWeight: '600' as const, color: th.sub, marginBottom: 5, letterSpacing: 0.2 },

    // Section heading
    sectionHead: {
      fontSize: 13, fontWeight: '700' as const, color: th.sub,
      letterSpacing: 0.8, textTransform: 'uppercase' as const,
      marginBottom: S.sm, marginTop: S.lg,
    },

    // Divider
    divider: { height: 1, backgroundColor: th.divider, marginVertical: S.sm },

    // Badge
    badge: (color: string) => ({
      paddingHorizontal: 9, paddingVertical: 3, borderRadius: R.full,
      backgroundColor: color + '20',
    }),
  };
};
