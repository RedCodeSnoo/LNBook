import { Platform, PlatformColor, type OpaqueColorValue } from 'react-native';

/** A colour usable in styles: a string, or a system colour (Material You). */
export type ThemeColor = string | OpaqueColorValue;

export type AppThemeName = 'light' | 'dark' | 'amoled';
export type AppThemeSetting = 'system' | AppThemeName;

export const ACCENT_NAMES = [
  'indigo',
  'blue',
  'teal',
  'green',
  'amber',
  'orange',
  'rose',
  'violet',
] as const;
export type AccentName = (typeof ACCENT_NAMES)[number];
export type AccentSetting = AccentName | 'dynamic';

interface AccentShades {
  /** Accent on a light background (contrast >= 4.5 with white). */
  light: string;
  lightContainer: string;
  onLightContainer: string;
  /** Accent on a dark background (contrast >= 4.5 with #121212). */
  dark: string;
  darkContainer: string;
  onDarkContainer: string;
}

export const ACCENTS: Record<AccentName, AccentShades> = {
  indigo: {
    light: '#4F5BD5',
    lightContainer: '#E3E5FF',
    onLightContainer: '#1F2A8A',
    dark: '#AEB6FF',
    darkContainer: '#2F3A8F',
    onDarkContainer: '#E3E5FF',
  },
  blue: {
    light: '#1A6FD6',
    lightContainer: '#DCEBFF',
    onLightContainer: '#0B3F80',
    dark: '#9CC7FF',
    darkContainer: '#134B8C',
    onDarkContainer: '#DCEBFF',
  },
  teal: {
    light: '#0B7A75',
    lightContainer: '#D3F1EE',
    onLightContainer: '#04433F',
    dark: '#7FD6CF',
    darkContainer: '#0A524E',
    onDarkContainer: '#D3F1EE',
  },
  green: {
    light: '#2E7D32',
    lightContainer: '#DDF2DE',
    onLightContainer: '#17471A',
    dark: '#9ADB9D',
    darkContainer: '#1F5522',
    onDarkContainer: '#DDF2DE',
  },
  amber: {
    light: '#8F6200',
    lightContainer: '#FFEBC2',
    onLightContainer: '#4D3500',
    dark: '#F2C566',
    darkContainer: '#664600',
    onDarkContainer: '#FFEBC2',
  },
  orange: {
    light: '#B5521A',
    lightContainer: '#FFE3D3',
    onLightContainer: '#662B08',
    dark: '#FFB690',
    darkContainer: '#7A3510',
    onDarkContainer: '#FFE3D3',
  },
  rose: {
    light: '#C2325F',
    lightContainer: '#FFDDE7',
    onLightContainer: '#701232',
    dark: '#FFB1C8',
    darkContainer: '#84203F',
    onDarkContainer: '#FFDDE7',
  },
  violet: {
    light: '#7B45C9',
    lightContainer: '#EEE1FF',
    onLightContainer: '#42207A',
    dark: '#D3B6FF',
    darkContainer: '#57309A',
    onDarkContainer: '#EEE1FF',
  },
};

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceVariant: string;
  text: string;
  textSecondary: string;
  textDisabled: string;
  border: string;
  primary: ThemeColor;
  onPrimary: ThemeColor;
  primaryContainer: ThemeColor;
  onPrimaryContainer: ThemeColor;
  error: string;
  onError: string;
  success: string;
  warning: string;
  overlay: string;
  skeleton: string;
  ripple: string;
}

export interface Theme {
  name: AppThemeName;
  dark: boolean;
  colors: ThemeColors;
}

const BASE: Record<
  AppThemeName,
  Omit<ThemeColors, 'primary' | 'onPrimary' | 'primaryContainer' | 'onPrimaryContainer'>
> = {
  light: {
    background: '#FAFAFC',
    surface: '#FFFFFF',
    surfaceVariant: '#EFEFF4',
    text: '#1A1B20',
    textSecondary: '#5A5C66',
    textDisabled: '#9A9CA6',
    border: '#E1E2E8',
    error: '#B3261E',
    onError: '#FFFFFF',
    success: '#2E7D32',
    warning: '#8F6200',
    overlay: 'rgba(0,0,0,0.45)',
    skeleton: '#E6E7EC',
    ripple: 'rgba(0,0,0,0.08)',
  },
  dark: {
    background: '#121316',
    surface: '#1B1C21',
    surfaceVariant: '#26272E',
    text: '#ECECF1',
    textSecondary: '#B0B2BD',
    textDisabled: '#70727C',
    border: '#32343C',
    error: '#F2B8B5',
    onError: '#601410',
    success: '#9ADB9D',
    warning: '#F2C566',
    overlay: 'rgba(0,0,0,0.6)',
    skeleton: '#2A2B32',
    ripple: 'rgba(255,255,255,0.1)',
  },
  amoled: {
    background: '#000000',
    surface: '#0C0C0E',
    surfaceVariant: '#18191D',
    text: '#E6E6EB',
    textSecondary: '#A8AAB5',
    textDisabled: '#686A74',
    border: '#24252B',
    error: '#F2B8B5',
    onError: '#601410',
    success: '#9ADB9D',
    warning: '#F2C566',
    overlay: 'rgba(0,0,0,0.7)',
    skeleton: '#1C1D22',
    ripple: 'rgba(255,255,255,0.1)',
  },
};

/** Material You colours exist from Android 12 (API 31). */
export const supportsDynamicColors = Platform.OS === 'android' && Number(Platform.Version) >= 31;

function accentColors(
  dark: boolean,
  accent: AccentSetting,
): Pick<ThemeColors, 'primary' | 'onPrimary' | 'primaryContainer' | 'onPrimaryContainer'> {
  if (accent === 'dynamic' && supportsDynamicColors) {
    return dark
      ? {
          primary: PlatformColor('@android:color/system_accent1_200'),
          onPrimary: PlatformColor('@android:color/system_accent1_800'),
          primaryContainer: PlatformColor('@android:color/system_accent1_700'),
          onPrimaryContainer: PlatformColor('@android:color/system_accent1_100'),
        }
      : {
          primary: PlatformColor('@android:color/system_accent1_600'),
          onPrimary: PlatformColor('@android:color/system_accent1_0'),
          primaryContainer: PlatformColor('@android:color/system_accent1_100'),
          onPrimaryContainer: PlatformColor('@android:color/system_accent1_900'),
        };
  }
  const shades = ACCENTS[accent === 'dynamic' ? 'indigo' : accent];
  return dark
    ? {
        primary: shades.dark,
        onPrimary: '#14151A',
        primaryContainer: shades.darkContainer,
        onPrimaryContainer: shades.onDarkContainer,
      }
    : {
        primary: shades.light,
        onPrimary: '#FFFFFF',
        primaryContainer: shades.lightContainer,
        onPrimaryContainer: shades.onLightContainer,
      };
}

export function buildTheme(name: AppThemeName, accent: AccentSetting): Theme {
  const dark = name !== 'light';
  return { name, dark, colors: { ...BASE[name], ...accentColors(dark, accent) } };
}

export function resolveThemeName(
  setting: AppThemeSetting,
  systemScheme: 'light' | 'dark' | null | undefined,
): AppThemeName {
  if (setting === 'system') {
    return systemScheme === 'dark' ? 'dark' : 'light';
  }
  return setting;
}

export const BASE_COLORS = BASE;
