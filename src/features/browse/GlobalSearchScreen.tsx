import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { useQuery } from '../../db/invalidation';
import type { Plugin } from '../../db/schema';
import { PluginError, runPluginCall, toPluginError } from '../../plugins/pluginErrors';
import { getSource } from '../../plugins/pluginHost';
import { listInstalledPlugins, sortSources } from '../../plugins/pluginManager';
import type { NovelItem } from '../../plugins/types';
import {
  AppText,
  Button,
  EmptyState,
  IconButton,
  Screen,
  Skeleton,
  TextField,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { SPACING } from '../../theme/typography';
import { ResultCard, sourceErrorMessage, SourceIcon } from './SourceBits';
import { ensureSourceNovel, listLibraryPaths } from './sourceNovels';

/** Sources searched at the same time. */
const CONCURRENCY = 4;

type SourceResult =
  | { status: 'waiting' }
  | { status: 'loading' }
  | { status: 'done'; items: NovelItem[] }
  | { status: 'error'; error: PluginError };

/** Runs `task` on every item, at most `limit` at a time. */
export async function runLimited<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** One term searched in every installed source, results grouped by source. */
export function GlobalSearchScreen({ navigation, route }: RootScreenProps<'globalSearch'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const installed = useQuery(() => listInstalledPlugins(getDb()), ['plugins']);
  const libraryPaths = useQuery(
    () => new Map(installed.map((source) => [source.id, listLibraryPaths(getDb(), source.id)])),
    ['library', 'plugins'],
  );
  const [input, setInput] = useState(route.params.term ?? '');
  const [term, setTerm] = useState(route.params.term ?? '');
  const [results, setResults] = useState<{ term: string; bySource: Record<string, SourceResult> }>({
    term: '',
    bySource: {},
  });
  const running = useRef('');

  const search = useCallback(
    (wanted: string) => {
      const sources = sortSources(installed);
      running.current = wanted;
      setTerm(wanted);
      setResults({
        term: wanted,
        bySource: Object.fromEntries(sources.map((source) => [source.id, { status: 'waiting' }])),
      });
      const update = (id: string, result: SourceResult) => {
        if (running.current === wanted) {
          setResults((current) => ({
            term: wanted,
            bySource: { ...current.bySource, [id]: result },
          }));
        }
      };
      void runLimited(sources, CONCURRENCY, async (source) => {
        if (running.current !== wanted) {
          return;
        }
        update(source.id, { status: 'loading' });
        try {
          const plugin = getSource(source.id);
          const items = await runPluginCall(() => plugin.searchNovels(wanted, 1));
          update(source.id, { status: 'done', items: (items ?? []).filter((item) => item?.path) });
        } catch (error) {
          update(source.id, { status: 'error', error: toPluginError(error) });
        }
      });
    },
    [installed],
  );

  // A term given by another screen is searched right away.
  const initialTerm = route.params.term;
  useEffect(() => {
    if (initialTerm) {
      const timer = setTimeout(() => search(initialTerm), 0);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTerm]);

  useEffect(
    () => () => {
      running.current = '';
    },
    [],
  );

  const open = (source: Plugin, item: NovelItem) => {
    const novelId = ensureSourceNovel(getDb(), { id: source.id, lang: source.lang }, item);
    navigation.navigate('novel', { novelId });
  };

  const sources = sortSources(installed);
  const active = results.term === term && term !== '' ? results.bySource : null;

  return (
    <Screen bottom>
      <View style={styles.searchBar}>
        <IconButton icon="arrow-left" label={t('common.back')} onPress={navigation.goBack} />
        <View style={styles.searchField}>
          <TextField
            autoFocus={!route.params.term}
            value={input}
            onChangeText={setInput}
            placeholder={t('sources.globalSearch')}
            accessibilityLabel={t('sources.globalSearch')}
            returnKeyType="search"
            onSubmitEditing={() => input.trim() !== '' && search(input.trim())}
          />
        </View>
      </View>
      {!active ? (
        <EmptyState
          icon="magnify"
          title={t('sources.globalSearchHint', { count: sources.length })}
        />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
          {sources.map((source) => {
            const result: SourceResult = active[source.id] ?? { status: 'waiting' };
            return (
              <View key={source.id} style={styles.section}>
                <View style={styles.header}>
                  <SourceIcon uri={source.iconUrl} size={24} />
                  <AppText variant="subtitle" style={styles.name} numberOfLines={1}>
                    {source.name}
                  </AppText>
                  {result.status === 'done' && result.items.length > 0 ? (
                    <Button
                      label={t('sources.seeAll')}
                      variant="text"
                      compact
                      onPress={() =>
                        navigation.navigate('source', { pluginId: source.id, search: term })
                      }
                    />
                  ) : null}
                </View>
                {result.status === 'waiting' || result.status === 'loading' ? (
                  <View style={styles.row}>
                    <Skeleton width={96} height={144} />
                    <Skeleton width={96} height={144} />
                    <Skeleton width={96} height={144} />
                  </View>
                ) : result.status === 'error' ? (
                  <AppText variant="label" color={colors.error} style={styles.message}>
                    {sourceErrorMessage(result.error, t)}
                  </AppText>
                ) : result.items.length === 0 ? (
                  <AppText variant="label" secondary style={styles.message}>
                    {t('sources.noResult')}
                  </AppText>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.results}
                  >
                    {result.items.slice(0, 20).map((item) => (
                      <ResultCard
                        key={item.path}
                        item={item}
                        width={108}
                        inLibrary={libraryPaths.get(source.id)?.has(item.path) ?? false}
                        onPress={(chosen) => open(source, chosen)}
                      />
                    ))}
                  </ScrollView>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
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
  list: { paddingBottom: SPACING.xl },
  section: { paddingTop: SPACING.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    minHeight: 40,
  },
  name: { flex: 1 },
  row: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.lg },
  results: { paddingHorizontal: SPACING.md },
  message: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
});
