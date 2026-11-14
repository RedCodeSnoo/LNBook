/** Display settings of the reader (section "Réglages d'affichage"). */

export type ReaderMode = 'scroll' | 'paged';
export type PageAnimation = 'slide' | 'none';
export type TextAlign = 'left' | 'justify' | 'center';
export type TapZones = 'leftPrevious' | 'leftNext' | 'off';
export type ReaderOrientation = 'auto' | 'portrait' | 'landscape';

export interface ReaderTheme {
  id: string;
  /** Translation key suffix for built-in themes, plain name for custom ones. */
  name: string;
  background: string;
  text: string;
  custom?: boolean;
}

export const READER_THEMES: ReaderTheme[] = [
  { id: 'light', name: 'light', background: '#FFFFFF', text: '#1A1B20' },
  { id: 'dark', name: 'dark', background: '#1E1F24', text: '#D8D9DE' },
  { id: 'night', name: 'night', background: '#000000', text: '#B4B6BC' },
  { id: 'sepia', name: 'sepia', background: '#F4ECD8', text: '#5B4636' },
  { id: 'paper', name: 'paper', background: '#FAF7F0', text: '#2B2A27' },
  { id: 'softGray', name: 'softGray', background: '#E4E5E7', text: '#2A2C30' },
];

export interface ReaderFont {
  id: string;
  /** Name shown in the list. */
  name: string;
  /** CSS font-family value. */
  family: string;
  /** Files embedded in the app (assets/reader-fonts); empty for the system font. */
  files: { file: string; weight: number; italic: boolean }[];
}

const variants = (prefix: string, bold: 600 | 700, extension = 'ttf') => [
  { file: `${prefix}-Regular.${extension}`, weight: 400, italic: false },
  { file: `${prefix}-Italic.${extension}`, weight: 400, italic: true },
  { file: `${prefix}-Bold.${extension}`, weight: bold, italic: false },
];

export const READER_FONTS: ReaderFont[] = [
  { id: 'system', name: 'system', family: 'sans-serif', files: [] },
  { id: 'literata', name: 'Literata', family: 'Literata', files: variants('Literata', 700) },
  {
    id: 'merriweather',
    name: 'Merriweather',
    family: 'Merriweather',
    files: variants('Merriweather', 700),
  },
  { id: 'lora', name: 'Lora', family: 'Lora', files: variants('Lora', 700) },
  {
    id: 'atkinson',
    name: 'Atkinson Hyperlegible',
    family: 'Atkinson Hyperlegible',
    files: variants('AtkinsonHyperlegible', 700),
  },
  {
    id: 'opendyslexic',
    name: 'OpenDyslexic',
    family: 'OpenDyslexic',
    files: variants('OpenDyslexic', 700, 'woff2'),
  },
];

export interface CustomFont {
  id: string;
  name: string;
  /** Path of the TTF/OTF file in the app storage (relative). */
  path: string;
}

export interface ReaderSettings {
  mode: ReaderMode;
  pageAnimation: PageAnimation;
  tapZones: TapZones;
  themeId: string;
  customThemes: ReaderTheme[];
  fontId: string;
  customFonts: CustomFont[];
  /** px, 12–40. */
  fontSize: number;
  /** 1.0–2.5. */
  lineHeight: number;
  /** em between paragraphs, 0–2. */
  paragraphSpacing: number;
  /** em of first-line indent, 0–3. */
  textIndent: number;
  /** px, left and right. */
  marginHorizontal: number;
  /** px, top and bottom. */
  marginVertical: number;
  textAlign: TextAlign;
  semiBold: boolean;
  /** 0–1, or null to follow the system brightness. */
  brightness: number | null;
  /** Warm light filter strength, 0–0.6. */
  warmth: number;
  keepScreenOn: boolean;
  hideStatusBar: boolean;
  orientation: ReaderOrientation;
  /** px per second for automatic scrolling. */
  autoScrollSpeed: number;
  showProgress: boolean;
  showClock: boolean;
  showBattery: boolean;
  /** Page turning (or one screen of scrolling) with the volume buttons. Off by default. */
  volumeKeys: boolean;
  /** A chapter is marked as read once this share of it has been reached (0.5–1). */
  readThreshold: number;
  /** Underline saved quotes in the text. */
  showQuotes: boolean;
  /** Show the original paragraph followed by its translation. */
  bilingual: boolean;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  mode: 'scroll',
  pageAnimation: 'slide',
  tapZones: 'leftPrevious',
  themeId: 'paper',
  customThemes: [],
  fontId: 'literata',
  customFonts: [],
  fontSize: 18,
  lineHeight: 1.6,
  paragraphSpacing: 0.8,
  textIndent: 0,
  marginHorizontal: 20,
  marginVertical: 24,
  textAlign: 'left',
  semiBold: false,
  brightness: null,
  warmth: 0,
  keepScreenOn: true,
  hideStatusBar: true,
  orientation: 'auto',
  autoScrollSpeed: 40,
  showProgress: true,
  showClock: false,
  showBattery: false,
  volumeKeys: false,
  readThreshold: 0.95,
  showQuotes: true,
  bilingual: false,
};

export const READER_LIMITS = {
  fontSize: { min: 12, max: 40, step: 1 },
  lineHeight: { min: 1, max: 2.5, step: 0.1 },
  paragraphSpacing: { min: 0, max: 2, step: 0.1 },
  textIndent: { min: 0, max: 3, step: 0.5 },
  marginHorizontal: { min: 0, max: 64, step: 2 },
  marginVertical: { min: 0, max: 96, step: 4 },
  warmth: { min: 0, max: 0.6, step: 0.05 },
  autoScrollSpeed: { min: 10, max: 200, step: 5 },
  readThreshold: { min: 0.5, max: 1, step: 0.05 },
} as const;

/** Settings that only make sense globally (devices, lists), never per novel. */
const GLOBAL_ONLY: (keyof ReaderSettings)[] = ['customThemes', 'customFonts'];

/** Completes stored settings with the defaults (new settings appear over time). */
export function normalizeReaderSettings(value: unknown): ReaderSettings {
  const stored = value && typeof value === 'object' ? (value as Partial<ReaderSettings>) : {};
  const result = { ...DEFAULT_READER_SETTINGS } as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_READER_SETTINGS) as (keyof ReaderSettings)[]) {
    const candidate = stored[key];
    const fallback = DEFAULT_READER_SETTINGS[key];
    if (candidate === undefined) {
      continue;
    }
    if (key === 'brightness') {
      result[key] = typeof candidate === 'number' ? candidate : null;
    } else if (
      Array.isArray(fallback) ? Array.isArray(candidate) : typeof candidate === typeof fallback
    ) {
      result[key] = candidate;
    }
  }
  return result as unknown as ReaderSettings;
}

/** Settings used for a novel: the global ones, overridden by the novel specific ones. */
export function resolveReaderSettings(
  global: ReaderSettings,
  novelOverrides: string | null | undefined,
): { settings: ReaderSettings; perNovel: boolean } {
  if (!novelOverrides) {
    return { settings: global, perNovel: false };
  }
  try {
    const overrides = JSON.parse(novelOverrides) as Partial<ReaderSettings>;
    const merged = normalizeReaderSettings({ ...global, ...overrides });
    for (const key of GLOBAL_ONLY) {
      (merged as unknown as Record<string, unknown>)[key] = global[key];
    }
    return { settings: merged, perNovel: true };
  } catch {
    return { settings: global, perNovel: false };
  }
}

export function findTheme(settings: ReaderSettings): ReaderTheme {
  return (
    [...READER_THEMES, ...settings.customThemes].find((theme) => theme.id === settings.themeId) ??
    READER_THEMES[0]
  );
}

export function findFont(settings: ReaderSettings): ReaderFont | CustomFont {
  return (
    READER_FONTS.find((font) => font.id === settings.fontId) ??
    settings.customFonts.find((font) => font.id === settings.fontId) ??
    READER_FONTS[0]
  );
}
