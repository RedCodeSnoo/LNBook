import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { PluginStorage } from '../../plugins/libs/storage';
import { toPluginError } from '../../plugins/pluginErrors';
import { getSource, pluginDeps } from '../../plugins/pluginHost';
import { getInstalledPlugin } from '../../plugins/pluginManager';
import type { PluginSetting } from '../../plugins/types';
import {
  AppBar,
  CheckItem,
  EmptyState,
  RadioItem,
  Screen,
  SectionHeader,
  SwitchItem,
  TextField,
} from '../../theme/components';
import { SPACING } from '../../theme/typography';
import { sourceErrorMessage } from './SourceBits';

type Value = string | boolean | string[];

/**
 * Settings declared by a plugin (`pluginSettings`). Like in LNReader, each value is
 * stored in the storage of the plugin under the key of the setting.
 */
export function PluginSettingsScreen({ navigation, route }: RootScreenProps<'pluginSettings'>) {
  const { pluginId } = route.params;
  const { t } = useTranslation();
  const [loaded] = useState(() => {
    try {
      const plugin = getSource(pluginId);
      const storage = new PluginStorage(pluginDeps().environment.store, pluginId);
      const definitions = Object.entries(plugin.pluginSettings ?? {});
      const initial: Record<string, Value> = {};
      for (const [key, setting] of definitions) {
        const stored = storage.get(key) as Value | undefined;
        initial[key] = stored === undefined ? setting.value : stored;
      }
      return { definitions, storage, initial, error: null };
    } catch (error) {
      return { definitions: [], storage: null, initial: {}, error: toPluginError(error) };
    }
  });
  const [values, setValues] = useState<Record<string, Value>>(loaded.initial);
  const name = getInstalledPlugin(getDb(), pluginId)?.name ?? pluginId;

  const set = (key: string, value: Value) => {
    loaded.storage?.set(key, value);
    setValues((current) => ({ ...current, [key]: value }));
  };

  const render = (key: string, setting: PluginSetting) => {
    const value = values[key];
    switch (setting.type) {
      case 'Switch':
        return (
          <SwitchItem
            key={key}
            title={setting.label}
            value={Boolean(value)}
            onValueChange={(next) => set(key, next)}
          />
        );
      case 'Select':
        return (
          <View key={key}>
            <SectionHeader title={setting.label} />
            {setting.options.map((option) => (
              <RadioItem
                key={option.value}
                title={option.label}
                checked={value === option.value}
                onPress={() => set(key, option.value)}
              />
            ))}
          </View>
        );
      case 'CheckboxGroup': {
        const selected = Array.isArray(value) ? value : [];
        return (
          <View key={key}>
            <SectionHeader title={setting.label} />
            {setting.options.map((option) => (
              <CheckItem
                key={option.value}
                title={option.label}
                checked={selected.includes(option.value)}
                onPress={() =>
                  set(
                    key,
                    selected.includes(option.value)
                      ? selected.filter((item) => item !== option.value)
                      : [...selected, option.value],
                  )
                }
              />
            ))}
          </View>
        );
      }
      default:
        return (
          <View key={key} style={styles.field}>
            <TextField
              label={setting.label}
              value={typeof value === 'string' ? value : ''}
              onChangeText={(text) => set(key, text)}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        );
    }
  };

  return (
    <Screen bottom>
      <AppBar title={name} subtitle={t('sources.pluginSettings')} onBack={navigation.goBack} />
      {loaded.error ? (
        <EmptyState icon="cloud-alert-outline" title={sourceErrorMessage(loaded.error, t)} />
      ) : loaded.definitions.length === 0 ? (
        <EmptyState icon="cog-outline" title={t('sources.noPluginSettings')} />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
          {loaded.definitions.map(([key, setting]) => render(key, setting))}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: SPACING.xl },
  field: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md },
});
