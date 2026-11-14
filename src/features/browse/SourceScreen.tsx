import { FlashList } from '@shopify/flash-list';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { useBackHandler } from '../../app/useBackHandler';
import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import { PluginError, runPluginCall, toPluginError } from '../../plugins/pluginErrors';
import { getSource } from '../../plugins/pluginHost';
import { getInstalledPlugin, touchPlugin } from '../../plugins/pluginManager';
import type { FilterValues, NovelItem, SourcePlugin } from '../../plugins/types';
import {
  AppBar,
  AppText,
  EmptyState,
  IconButton,
  Screen,
  SegmentedTabs,
  Skeleton,
  TextField,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { SPACING } from '../../theme/typography';
import { defaultFilterValues, FiltersSheet } from './FiltersSheet';
import { ResultCard, SourceErrorView } from './SourceBits';
import { ensureSourceNovel, listLibraryPaths } from './sourceNovels';

type Mode = 'popular' | 'latest';

interface Results {
  /** Identifies the request: mode, search term and filters. */
  key: string;
  items: NovelItem[];
  page: number;
  /** No more pages. */
  done: boolean;
  loading: boolean;
  error: PluginError | null;
}

const EMPTY: Results = { key: '', items: [], page: 0, done: false, loading: false, error: null };

/** A source: popular novels, latest releases, filters and search, with endless paging. */
export function SourceScreen({ navigation, route }: RootScreenProps<'source'>) {
  const { pluginId } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const installed = useQuery(() => getInstalledPlugin(getDb(), pluginId), ['plugins'], [pluginId]);
  const libraryPaths = useQuery(() => listLibraryPaths(getDb(), pluginId), ['library'], [pluginId]);

  const [loaded] = useState<{ plugin: SourcePlugin | null; error: PluginError | null }>(() => {
    try {
      return { plugin: getSource(pluginId), error: null };
    } catch (error) {
      return { plugin: null, error: toPluginError(error) };
    }
  });
  const plugin = loaded.plugin;

  const [mode, setMode] = useState<Mode>('popular');
  const [searching, setSearching] = useState(Boolean(route.params.search));
  const [input, setInput] = useState(route.params.search ?? '');
  const [term, setTerm] = useState(route.params.search ?? '');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<FilterValues>(() => defaultFilterValues(plugin?.filters));
  const [results, setResults] = useState<Results>(EMPTY);

  const requestKey = useMemo(
    () => (term !== '' ? `search:${term}` : `${mode}:${JSON.stringify(filters)}`),
    [term, mode, filters],
  );
  const current = results.key === requestKey ? results : { ...EMPTY, key: requestKey };

  // The latest request wins: late answers of an older request are ignored.
  const latestKey = useRef(requestKey);
  useEffect(() => {
    latestKey.current = requestKey;
  }, [requestKey]);

  const loadPage = useCallback(
    async (key: string, page: number, previous: NovelItem[]) => {
      if (!plugin) {
        return;
      }
      setResults({ key, items: previous, page: page - 1, done: false, loading: true, error: null });
      try {
        const found = await runPluginCall(() =>
          term !== ''
            ? plugin.searchNovels(term, page)
            : plugin.popularNovels(page, { showLatestNovels: mode === 'latest', filters }),
        );
        if (latestKey.current !== key) {
          return;
        }
        const known = new Set(previous.map((item) => item.path));
        const fresh = (found ?? []).filter((item) => item?.path && !known.has(item.path));
        setResults({
          key,
          items: [...previous, ...fresh],
          page,
          // A page without anything new means the end (some sites repeat the last page).
          done: fresh.length === 0,
          loading: false,
          error: null,
        });
      } catch (error) {
        if (latestKey.current === key) {
          setResults({
            key,
            items: previous,
            page: page - 1,
            done: false,
            loading: false,
            error: toPluginError(error),
          });
        }
      }
    },
    [plugin, term, mode, filters],
  );

  useEffect(() => {
    if (plugin) {
      touchPlugin(getDb(), pluginId);
      invalidate('plugins');
    }
  }, [plugin, pluginId]);

  useEffect(() => {
    const timer = setTimeout(() => void loadPage(requestKey, 1, []), 0);
    return () => clearTimeout(timer);
    // A new request key always starts from the first page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const loadMore = () => {
    if (!current.loading && !current.done && !current.error && current.items.length > 0) {
      void loadPage(requestKey, current.page + 1, current.items);
    }
  };
  const retry = () => void loadPage(requestKey, current.page + 1, current.items);

  const closeSearch = useCallback(() => {
    setSearching(false);
    setInput('');
    setTerm('');
  }, []);
  useBackHandler(searching, closeSearch);

  const openNovel = useCallback(
    (item: NovelItem) => {
      const novelId = ensureSourceNovel(getDb(), { id: pluginId, lang: installed?.lang }, item);
      navigation.navigate('novel', { novelId });
    },
    [installed?.lang, navigation, pluginId],
  );

  const columns = Math.max(3, Math.floor(width / 120));
  const cardWidth = (width - SPACING.sm * 2) / columns;
  const title = installed?.name ?? plugin?.name ?? pluginId;
  const site = installed?.site || plugin?.site;

  if (!plugin) {
    return (
      <Screen bottom>
        <AppBar title={title} onBack={navigation.goBack} />
        {loaded.error ? <SourceErrorView error={loaded.error} onRetry={navigation.goBack} /> : null}
      </Screen>
    );
  }

  return (
    <Screen bottom>
      {searching ? (
        <View style={styles.searchBar}>
          <IconButton icon="arrow-left" label={t('common.close')} onPress={closeSearch} />
          <View style={styles.searchField}>
            <TextField
              autoFocus={!route.params.search}
              value={input}
              onChangeText={setInput}
              placeholder={t('sources.searchIn', { name: title })}
              accessibilityLabel={t('sources.searchIn', { name: title })}
              returnKeyType="search"
              onSubmitEditing={() => setTerm(input.trim())}
            />
          </View>
        </View>
      ) : (
        <AppBar
          title={title}
          onBack={navigation.goBack}
          actions={
            <>
              <IconButton
                icon="magnify"
                label={t('common.search')}
                onPress={() => setSearching(true)}
              />
              {plugin.filters && Object.keys(plugin.filters).length > 0 ? (
                <IconButton
                  icon="filter-variant"
                  label={t('sources.filters')}
                  onPress={() => setFiltersOpen(true)}
                />
              ) : null}
              {site ? (
                <IconButton
                  icon="web"
                  label={t('sources.openWebView')}
                  onPress={() => navigation.navigate('webview', { url: site, pluginId })}
                />
              ) : null}
            </>
          }
        />
      )}
      {!searching ? (
        <SegmentedTabs<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'popular', label: t('sources.popular') },
            { value: 'latest', label: t('sources.latest') },
          ]}
        />
      ) : null}

      {searching && term === '' ? (
        <EmptyState icon="magnify" title={t('sources.searchHint')} />
      ) : current.items.length === 0 && current.error ? (
        <SourceErrorView error={current.error} onRetry={retry} webUrl={site} pluginId={pluginId} />
      ) : current.items.length === 0 && !current.loading && current.page > 0 ? (
        <EmptyState icon="book-search-outline" title={t('sources.noResult')} />
      ) : current.items.length === 0 ? (
        <View style={styles.skeletons}>
          {Array.from({ length: columns * 3 }, (_, index) => (
            <Skeleton key={index} width={cardWidth - SPACING.sm} height={(cardWidth - 8) * 1.5} />
          ))}
        </View>
      ) : (
        <FlashList
          key={columns}
          data={current.items}
          numColumns={columns}
          extraData={libraryPaths}
          keyExtractor={(item) => item.path}
          contentContainerStyle={styles.grid}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          renderItem={({ item }) => (
            <ResultCard
              item={item}
              inLibrary={libraryPaths.has(item.path)}
              width={cardWidth}
              onPress={openNovel}
            />
          )}
          ListFooterComponent={
            current.error ? (
              <SourceErrorView
                compact
                error={current.error}
                onRetry={retry}
                webUrl={site}
                pluginId={pluginId}
              />
            ) : current.loading ? (
              <View style={styles.footer}>
                <Skeleton height={6} radius={3} />
              </View>
            ) : current.done ? (
              <AppText variant="caption" color={colors.textDisabled} center style={styles.footer}>
                {t('sources.endOfList')}
              </AppText>
            ) : null
          }
        />
      )}

      {plugin.filters ? (
        <FiltersSheet
          visible={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          filters={plugin.filters}
          values={filters}
          onApply={setFilters}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.xs,
  },
  searchField: { flex: 1, paddingRight: SPACING.md },
  grid: { paddingHorizontal: SPACING.sm, paddingBottom: SPACING.xl },
  skeletons: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, padding: SPACING.md },
  footer: { padding: SPACING.lg },
});
