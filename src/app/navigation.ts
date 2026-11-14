import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type TabParamList = {
  library: undefined;
  updates: undefined;
  history: undefined;
  browse: undefined;
  more: undefined;
};

export type RootStackParamList = {
  tabs: NavigatorScreenParams<TabParamList> | undefined;
  settings: undefined;
  settingsGeneral: undefined;
  settingsAppearance: undefined;
  about: undefined;
  novel: { novelId: number };
  novelEdit: { novelId: number };
  /** Single entry point to read a chapter, optionally at a precise place. */
  reader: { chapterId: number; anchor?: string };
  categories: undefined;
  chapterEdit: { chapterId: number };
  /** Text replacement rules: global ones, plus those of a novel when given. */
  replacements: { novelId?: number; chapterId?: number };
  settingsReader: undefined;
  quoteFolders: undefined;
  catalog: undefined;
  source: { pluginId: string; search?: string };
  globalSearch: { term?: string };
  /** Web view of a site, sharing its cookies with the plugin of the source. */
  webview: { url: string; pluginId?: string; title?: string };
  pluginSettings: { pluginId: string };
  settingsSources: undefined;
  downloads: undefined;
  storage: undefined;
  settingsDownloads: undefined;
  settingsUpdates: undefined;
  settingsLibrary: undefined;
  backup: undefined;
  settingsVoice: undefined;
  /** Screen of a feature that is not available yet. */
  placeholder: { titleKey: string; icon: string };
};

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

export type TabScreenProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;

declare global {
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
