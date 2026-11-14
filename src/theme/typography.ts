import type { TextStyle } from 'react-native';

/** Inter is embedded at build time by the expo-font config plugin (see app.config.ts). */
export const FONTS = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export type TextVariant =
  'display' | 'headline' | 'title' | 'subtitle' | 'body' | 'bodyStrong' | 'label' | 'caption';

export const TEXT_VARIANTS: Record<
  TextVariant,
  TextStyle & { fontSize: number; lineHeight: number }
> = {
  display: { fontFamily: FONTS.bold, fontSize: 28, lineHeight: 36 },
  headline: { fontFamily: FONTS.semiBold, fontSize: 22, lineHeight: 28 },
  title: { fontFamily: FONTS.semiBold, fontSize: 18, lineHeight: 24 },
  subtitle: { fontFamily: FONTS.medium, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: FONTS.regular, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: FONTS.semiBold, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: FONTS.medium, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: FONTS.regular, fontSize: 12, lineHeight: 16 },
};

export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 28, pill: 999 } as const;
export const DURATION = { short: 150, medium: 250 } as const;
