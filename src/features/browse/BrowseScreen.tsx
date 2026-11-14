import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { TabScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import type { Plugin } from '../../db/schema';
import { pluginDeps } from '../../plugins/pluginHost';
import {
  listInstalledPlugins,
  setPluginPinned,
  sortSources,
  uninstallPlugin,
} from '../../plugins/pluginManager';
import {
  AppBar,
  AppText,
  BottomSheet,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  ListItem,
  Screen,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { SPACING } from '../../theme/typography';
import { SourceIcon } from './SourceBits';

export function BrowseScreen({ navigation }: TabScreenProps<'browse'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const installed = useQuery(() => listInstalledPlugins(getDb()), ['plugins']);
  const sources = sortSources(installed);
  const [actionsFor, setActionsFor] = useState<Plugin | null>(null);
  const [removing, setRemoving] = useState<Plugin | null>(null);

  const lastUsedId = sources.find((source) => !source.pinned && source.lastUsedAt)?.id;

  return (
    <Screen>
      <AppBar
        title={t('tabs.browse')}
        large
        actions={
          <>
            <IconButton
              icon="magnify"
              label={t('sources.globalSearch')}
              disabled={sources.length === 0}
              onPress={() => navigation.navigate('globalSearch', {})}
            />
            <IconButton
              icon="puzzle-plus-outline"
              label={t('sources.catalog')}
              onPress={() => navigation.navigate('catalog')}
            />
          </>
        }
      />
      {sources.length === 0 ? (
        <EmptyState
          icon="compass-outline"
          title={t('browse.emptyTitle')}
          message={t('browse.emptyMessage')}
        >
          <Button
            label={t('browse.openCatalog')}
            icon="puzzle-plus-outline"
            onPress={() => navigation.navigate('catalog')}
          />
        </EmptyState>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {sources.map((source) => (
            <View key={source.id} style={styles.row}>
              <View style={styles.item}>
                <ListItem
                  title={source.name}
                  subtitle={[
                    source.lang,
                    source.pinned ? t('sources.pinned') : null,
                    source.id === lastUsedId ? t('sources.lastUsed') : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  onPress={() => navigation.navigate('source', { pluginId: source.id })}
                  onLongPress={() => setActionsFor(source)}
                  right={<SourceIcon uri={source.iconUrl} />}
                />
              </View>
              <IconButton
                icon={source.pinned ? 'pin' : 'pin-outline'}
                label={
                  source.pinned
                    ? t('sources.unpin', { name: source.name })
                    : t('sources.pin', { name: source.name })
                }
                color={source.pinned ? colors.primary : undefined}
                onPress={() => {
                  setPluginPinned(getDb(), source.id, !source.pinned);
                  invalidate('plugins');
                }}
              />
            </View>
          ))}
          <AppText variant="caption" secondary center style={styles.hint}>
            {t('sources.listHint')}
          </AppText>
        </ScrollView>
      )}

      <BottomSheet
        visible={actionsFor !== null}
        title={actionsFor?.name}
        onClose={() => setActionsFor(null)}
      >
        {actionsFor ? (
          <>
            <ListItem
              icon="web"
              title={t('sources.openWebView')}
              disabled={!actionsFor.site}
              onPress={() => {
                const source = actionsFor;
                setActionsFor(null);
                navigation.navigate('webview', { url: source.site, pluginId: source.id });
              }}
            />
            {actionsFor.hasSettings ? (
              <ListItem
                icon="cog-outline"
                title={t('sources.pluginSettings')}
                onPress={() => {
                  const source = actionsFor;
                  setActionsFor(null);
                  navigation.navigate('pluginSettings', { pluginId: source.id });
                }}
              />
            ) : null}
            <ListItem
              icon="trash-can-outline"
              title={t('sources.uninstall')}
              onPress={() => {
                setRemoving(actionsFor);
                setActionsFor(null);
              }}
            />
          </>
        ) : null}
      </BottomSheet>
      <ConfirmDialog
        visible={removing !== null}
        title={t('sources.uninstallTitle', { name: removing?.name ?? '' })}
        message={t('sources.uninstallMessage')}
        confirmLabel={t('sources.uninstall')}
        danger
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) {
            uninstallPlugin(pluginDeps(), removing.id);
            invalidate('plugins');
          }
          setRemoving(null);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: SPACING.xl },
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: SPACING.xs },
  item: { flex: 1 },
  hint: { padding: SPACING.lg },
});
