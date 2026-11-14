import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import { DEFAULT_USER_AGENT } from '../../plugins/libs/fetch';
import {
  addRepository,
  DEFAULT_REPOSITORY,
  listInstalledPlugins,
  listRepositories,
  removeRepository,
} from '../../plugins/pluginManager';
import {
  AppBar,
  AppText,
  Button,
  Dialog,
  IconButton,
  ListItem,
  Screen,
  SectionHeader,
  TextField,
  showToast,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { SPACING } from '../../theme/typography';
import { setSetting, useSetting } from './settingsStore';

/** Settings → Sources: plugin repositories, settings of each plugin, User-Agent. */
export function SourcesSettingsScreen({ navigation }: RootScreenProps<'settingsSources'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const repositories = useQuery(() => listRepositories(getDb()), ['plugins']);
  const installed = useQuery(() => listInstalledPlugins(getDb()), ['plugins']);
  const userAgent = useSetting('userAgent');
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [agent, setAgent] = useState(userAgent);

  const add = () => {
    if (addRepository(getDb(), url)) {
      invalidate('plugins');
      setAdding(false);
      setUrl('');
    } else {
      showToast(t('sources.repoInvalid'));
    }
  };

  return (
    <Screen bottom>
      <AppBar title={t('settings.sources')} onBack={navigation.goBack} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
        <ListItem
          icon="puzzle-plus-outline"
          title={t('sources.catalog')}
          subtitle={t('sources.catalogHint')}
          onPress={() => navigation.navigate('catalog')}
        />

        <SectionHeader title={t('sources.repositories')} />
        {repositories.map((repository) => (
          <View key={repository.url} style={styles.row}>
            <View style={styles.texts}>
              <AppText variant="subtitle" numberOfLines={1}>
                {repository.name}
              </AppText>
              <AppText variant="caption" secondary numberOfLines={2}>
                {repository.url}
              </AppText>
            </View>
            {repository.url === DEFAULT_REPOSITORY.url ? null : (
              <IconButton
                icon="trash-can-outline"
                label={t('sources.repoRemove', { name: repository.name })}
                onPress={() => {
                  removeRepository(getDb(), repository.url);
                  invalidate('plugins');
                }}
              />
            )}
          </View>
        ))}
        <View style={styles.button}>
          <Button
            label={t('sources.repoAdd')}
            icon="plus"
            variant="tonal"
            onPress={() => setAdding(true)}
          />
        </View>

        {installed.some((plugin) => plugin.hasSettings) ? (
          <>
            <SectionHeader title={t('sources.pluginSettings')} />
            {installed
              .filter((plugin) => plugin.hasSettings)
              .map((plugin) => (
                <ListItem
                  key={plugin.id}
                  icon="cog-outline"
                  title={plugin.name}
                  subtitle={plugin.lang}
                  onPress={() => navigation.navigate('pluginSettings', { pluginId: plugin.id })}
                />
              ))}
          </>
        ) : null}

        <SectionHeader title={t('sources.userAgent')} />
        <View style={styles.field}>
          <TextField
            value={agent}
            onChangeText={setAgent}
            onEndEditing={() => setSetting('userAgent', agent.trim() || DEFAULT_USER_AGENT)}
            accessibilityLabel={t('sources.userAgent')}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />
          <AppText variant="caption" color={colors.textSecondary}>
            {t('sources.userAgentHint')}
          </AppText>
          <View style={styles.reset}>
            <Button
              label={t('sources.userAgentReset')}
              variant="text"
              compact
              onPress={() => {
                setAgent(DEFAULT_USER_AGENT);
                setSetting('userAgent', DEFAULT_USER_AGENT);
              }}
            />
          </View>
        </View>
      </ScrollView>

      <Dialog
        visible={adding}
        title={t('sources.repoAdd')}
        onClose={() => setAdding(false)}
        actions={[
          { label: t('common.cancel'), onPress: () => setAdding(false) },
          { label: t('common.save'), disabled: url.trim() === '', onPress: add },
        ]}
      >
        <TextField
          autoFocus
          value={url}
          onChangeText={setUrl}
          placeholder="https://…/plugins.json"
          accessibilityLabel={t('sources.repoUrl')}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onSubmitEditing={add}
        />
      </Dialog>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: SPACING.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: SPACING.lg,
    paddingRight: SPACING.xs,
    minHeight: 60,
  },
  texts: { flex: 1 },
  button: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, alignItems: 'flex-start' },
  field: { paddingHorizontal: SPACING.lg, gap: SPACING.xs },
  reset: { alignItems: 'flex-start' },
});
