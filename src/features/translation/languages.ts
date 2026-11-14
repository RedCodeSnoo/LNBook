/**
 * Languages known to the app. Adding a translation language = adding it to
 * TRANSLATION_LANGUAGES; nothing else assumes English or French.
 */
export interface LanguageInfo {
  code: string;
  /** Name of the language in that language. */
  name: string;
  flag: string;
}

export const LANGUAGES: Record<string, LanguageInfo> = {
  en: { code: 'en', name: 'English', flag: '🇬🇧' },
  fr: { code: 'fr', name: 'Français', flag: '🇫🇷' },
  es: { code: 'es', name: 'Español', flag: '🇪🇸' },
  de: { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  it: { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  pt: { code: 'pt', name: 'Português', flag: '🇵🇹' },
  ru: { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  ja: { code: 'ja', name: '日本語', flag: '🇯🇵' },
  zh: { code: 'zh', name: '中文', flag: '🇨🇳' },
  ko: { code: 'ko', name: '한국어', flag: '🇰🇷' },
  id: { code: 'id', name: 'Indonesia', flag: '🇮🇩' },
  tr: { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
  ar: { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  vi: { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
  th: { code: 'th', name: 'ไทย', flag: '🇹🇭' },
  pl: { code: 'pl', name: 'Polski', flag: '🇵🇱' },
  uk: { code: 'uk', name: 'Українська', flag: '🇺🇦' },
};

/** Languages a novel can be translated from and to. */
export const TRANSLATION_LANGUAGES = ['en', 'fr'] as const;

/** Names used by the LNReader plugins ("English", "French", "‎Français"…) to language codes. */
const PLUGIN_LANGUAGE_NAMES: Record<string, string> = {
  english: 'en',
  french: 'fr',
  français: 'fr',
  francais: 'fr',
  spanish: 'es',
  español: 'es',
  german: 'de',
  deutsch: 'de',
  italian: 'it',
  portuguese: 'pt',
  português: 'pt',
  russian: 'ru',
  русский: 'ru',
  japanese: 'ja',
  日本語: 'ja',
  chinese: 'zh',
  中文: 'zh',
  korean: 'ko',
  한국어: 'ko',
  indonesian: 'id',
  'bahasa indonesia': 'id',
  turkish: 'tr',
  türkçe: 'tr',
  arabic: 'ar',
  العربية: 'ar',
  vietnamese: 'vi',
  'tiếng việt': 'vi',
  thai: 'th',
  ไทย: 'th',
  polish: 'pl',
  polski: 'pl',
  ukrainian: 'uk',
  українська: 'uk',
};

export function languageInfo(code: string | null | undefined): LanguageInfo | null {
  if (!code) {
    return null;
  }
  const short = code.toLowerCase().split(/[-_]/)[0];
  return LANGUAGES[short] ?? { code: short, name: short.toUpperCase(), flag: '🏳️' };
}

/** Language code of a plugin language name, or null when unknown. */
export function languageCodeFromName(name: string | null | undefined): string | null {
  if (!name) {
    return null;
  }
  const cleaned = name.replace(/[‎‏]/g, '').trim().toLowerCase();
  if (LANGUAGES[cleaned]) {
    return cleaned;
  }
  return PLUGIN_LANGUAGE_NAMES[cleaned] ?? null;
}
