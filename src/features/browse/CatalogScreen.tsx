import { FlashList } from '@shopify/flash-list';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import { pluginDeps } from '../../plugins/pluginHost';
import {
  catalogLanguages,
  fetchCatalog,
  hasUpdate,
  installPlugin,
  listInstalledPlugins,
  listRepositories,
  uninstallPlugin,
  type CatalogEntry,
  type CatalogResult,
} from '../../plugins/pluginManager';
import {
  AppBar,
  AppText,
  Button,
  Chip,
  EmptyState,
  IconButton,
  Screen,
  Skeleton,
  TextField,
  showToast,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { SPACING } from '../../theme/typography';
import { normalizeText } from '../library/libraryView';
import { setSetting, useSetting } from '../settings/settingsStore';
import { SourceIcon } from './SourceBits';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; catalog: CatalogResult };

/** Catalogue of source plugins: filter by language, search, install, update, uninstall. */
export function CatalogScreen({ navigation }: RootScreenProps<'catalog'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const installed = useQuery(() => listInstalledPlugins(getDb()), ['plugins']);
  const languages = useSetting('sourceLanguages');
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const urls = listRepositories(getDb()).map((repo) => repo.url);
    fetchCatalog(urls, pluginDeps().environment.fetch)
      .then((catalog) => {
        if (cancelled) {
          return;
        }
        setState(
          catalog.entries.length === 0 && catalog.failed.length > 0
            ? { status: 'error', message: catalog.failed[0].reason }
            : { status: 'ready', catalog },
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = () => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  };

  const installedById = useMemo(
    () => new Map(installed.map((plugin) => [plugin.id, plugin])),
    [installed],
  );
  const allLanguages = useMemo(
    () => (state.status === 'ready' ? catalogLanguages(state.catalog.entries) : []),
    [state],
  );
  const entries = useMemo(() => {
    if (state.status !== 'ready') {
      return [];
    }
    const needle = normalizeText(search);
    return state.catalog.entries
      .filter(
        (entry) =>
          (installedById.has(entry.id) || languages.includes(entry.lang)) &&
          (needle === '' || normalizeText(entry.name).includes(needle)),
      )
      .sort(
        (a, b) =>
          Number(installedById.has(b.id)) - Number(installedById.has(a.id)) ||
          a.name.localeCompare(b.name),
      );
  }, [state, search, languages, installedById]);

  const setBusyFor = (id: string, value: boolean) =>
    setBusy((current) => {
      const next = new Set(current);
      if (value) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });

  const install = useCallback(
    async (entry: CatalogEntry) => {
      setBusyFor(entry.id, true);
      try {
        await installPlugin(pluginDeps(), entry);
        invalidate('plugins');
        showToast(t('sources.installed', { name: entry.name }));
      } catch {
        showToast(t('sources.installFailed', { name: entry.name }));
      } finally {
        setBusyFor(entry.id, false);
      }
    },
    [t],
  );

  const renderItem = useCallback(
    ({ item }: { item: CatalogEntry }) => {
      const current = installedById.get(item.id);
      const update = current ? hasUpdate(current, item) : false;
      const working = busy.has(item.id);
      return (
        <View style={styles.row}>
          <SourceIcon uri={item.iconUrl} />
          <View style={styles.texts}>
            <AppText variant="subtitle" numberOfLines={1}>
              {item.name}
            </AppText>
            <AppText variant="caption" secondary numberOfLines={1}>
              {[item.lang, `v${current?.version ?? item.version}`].join(' · ')}
              {update ? ` → v${item.version}` : ''}
            </AppText>
            {update ? (
              <AppText variant="caption" color={colors.primary}>
                {t('sources.updateAvailable')}
              </AppText>
            ) : null}
          </View>
          {working ? (
            <Skeleton width={72} height={32} />
          ) : current ? (
            <>
              {update ? (
                <Button label={t('sources.update')} compact onPress={() => void install(item)} />
              ) : null}
              <IconButton
                icon="trash-can-outline"
                label={t('sources.uninstallNamed', { name: item.name })}
                onPress={() => {
                  uninstallPlugin(pluginDeps(), item.id);
                  invalidate('plugins');
                }}
              />
            </>
          ) : (
            <Button
              label={t('sources.install')}
              variant="tonal"
              compact
              onPress={() => void install(item)}
            />
          )}
        </View>
      );
    },
    [busy, colors.primary, install, installedById, t],
  );

  return (
    <Screen bottom>
      <AppBar
        title={t('sources.catalog')}
        onBack={navigation.goBack}
        actions={
          <IconButton
            icon="cog-outline"
            label={t('settings.sources')}
            onPress={() => navigation.navigate('settingsSources')}
          />
        }
      />
      {state.status === 'loading' ? (
        <View style={styles.loading}>
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <Skeleton key={index} height={44} />
          ))}
        </View>
      ) : state.status === 'error' ? (
        <EmptyState
          icon="cloud-alert-outline"
          title={t('sources.catalogError')}
          message={state.message}
        >
          <Button label={t('sources.retry')} icon="refresh" onPress={retry} />
        </EmptyState>
      ) : (
        <>
          <View style={styles.search}>
            <TextField
              value={search}
              onChangeText={setSearch}
              placeholder={t('sources.searchSource')}
              accessibilityLabel={t('sources.searchSource')}
            />
          </View>
          <View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
              keyboardShouldPersistTaps="handled"
            >
              {allLanguages.map((language) => (
                <Chip
                  key={language}
                  label={language}
                  selected={languages.includes(language)}
                  onPress={() =>
                    setSetting(
                      'sourceLanguages',
                      languages.includes(language)
                        ? languages.filter((item) => item !== language)
                        : [...languages, language],
                    )
                  }
                />
              ))}
            </ScrollView>
          </View>
          {state.catalog.failed.map((failure) => (
            <AppText key={failure.url} variant="caption" color={colors.error} style={styles.failed}>
              {t('sources.repoFailed', { url: failure.url })}
            </AppText>
          ))}
          <FlashList
            data={entries}
            renderItem={renderItem}
            extraData={busy}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <AppText secondary center style={styles.empty}>
                {t('sources.catalogEmpty')}
              </AppText>
            }
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { padding: SPACING.lg, gap: SPACING.md },
  search: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  chips: { gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  failed: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingLeft: SPACING.lg,
    paddingRight: SPACING.sm,
    minHeight: 64,
  },
  texts: { flex: 1 },
  empty: { padding: SPACING.xl },
});
