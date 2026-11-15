import { requireNativeModule } from 'expo-modules-core';

interface LnbookTranslateModule {
  getSupportedLanguages(): string[];
  getDownloadedModels(): Promise<string[]>;
  downloadModel(language: string, wifiOnly: boolean): Promise<boolean>;
  deleteModel(language: string): Promise<boolean>;
  translate(source: string, target: string, texts: string[]): Promise<string[]>;
}

/**
 * On-device translation. `translate` rejects with the code ERR_MODEL_MISSING (and the
 * missing languages as message) when a language model is not on the phone.
 */
export const nativeTranslate = requireNativeModule<LnbookTranslateModule>('LnbookTranslate');
