import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './en.json';
import fr from './fr.json';

export const SUPPORTED_LANGUAGES = ['fr', 'en'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const FALLBACK_LANGUAGE: AppLanguage = 'fr';

/** 'system' = the phone language when it is supported, French otherwise. */
export function resolveLanguage(
  setting: 'system' | AppLanguage,
  deviceLanguages: readonly (string | null | undefined)[],
): AppLanguage {
  if (setting !== 'system') {
    return setting;
  }
  for (const code of deviceLanguages) {
    const short = code?.toLowerCase().split(/[-_]/)[0];
    const match = SUPPORTED_LANGUAGES.find((language) => language === short);
    if (match) {
      return match;
    }
  }
  return FALLBACK_LANGUAGE;
}

export function deviceLanguages(): string[] {
  try {
    return getLocales().map((locale) => locale.languageTag);
  } catch {
    return [];
  }
}

export function initI18n(setting: 'system' | AppLanguage): void {
  const language = resolveLanguage(setting, deviceLanguages());
  if (i18n.isInitialized) {
    void i18n.changeLanguage(language);
    return;
  }
  void i18n.use(initReactI18next).init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng: language,
    fallbackLng: FALLBACK_LANGUAGE,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export function changeLanguage(setting: 'system' | AppLanguage): void {
  void i18n.changeLanguage(resolveLanguage(setting, deviceLanguages()));
}

export default i18n;
