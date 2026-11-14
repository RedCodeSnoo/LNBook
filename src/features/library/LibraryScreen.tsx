import { FlashList } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { TabScreenProps } from '../../app/navigation';
import { useBackHandler } from '../../app/useBackHandler';
import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import { deviceFiles } from '../../services/deviceFileStore';
import {
  AppBar,
  Button,
  Chip,
  ConfirmDialog,
  EmptyState,
  Fab,
  IconButton,
  Screen,
  SegmentedTabs,
  TextField,
  showToast,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { SPACING } from '../../theme/typography';
import { findResumeChapter } from '../novel/chapterList';
import { listChapters } from '../novel/novelRepository';
import { useSetting } from '../settings/settingsStore';
import { CategoryPickerDialog } from './CategoryPickerDialog';
import { pickAndImport } from './importFlow';
import {
  listCategories,
  listLibraryNovels,
  markNovelsRead,
  removeNovelsFromLibrary,
  type LibraryNovel,
} from './libraryRepository';
import { LibraryOptionsSheet } from './LibraryOptionsSheet';
import {
  applyLibraryView,
  countActiveFilters,
  NO_FILTERS,
  sourceKey,
  type LibraryFilters,
  type LibrarySort,
} from './libraryView';
import { NovelCard } from './NovelCard';

type LibraryTab = 'online' | 'local';

export function LibraryScreen({ navigation }: TabScreenProps<'library'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();

  // Opens on Online when there is something to read there, on Local otherwise.
  const [tab, setTab] = useState<LibraryTab>(() =>
    listLibraryNovels(getDb()).some((novel) => !novel.isLocal) ? 'online' : 'local',
  );
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [filters, setFilters] = useState<LibraryFilters>(NO_FILTERS);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [selection, setSelection] = useState<number[]>([]);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pickingCategories, setPickingCategories] = useState(false);

  const sort = useSetting('librarySort') as LibrarySort;
  const ascending = useSetting('librarySortAscending');
  const display = useSetting('libraryDisplay');
  const columnSetting = useSetting('libraryColumns');
  const showUnread = useSetting('showUnreadBadge');
  const showDownload = useSetting('showDownloadBadge');
  const showLanguage = useSetting('showLanguageBadge');
  const showProgress = useSetting('showProgressBar');

  const all = useQuery(() => listLibraryNovels(getDb()), ['library']);
  const categories = useQuery(() => listCategories(getDb()), ['categories']);

  const activeCategory = categories.some((category) => category.id === categoryId)
    ? categoryId
    : null;
  const novels = useMemo(
    () =>
      applyLibraryView(all, { tab, categoryId: activeCategory, sort, ascending, filters, search }),
    [all, tab, activeCategory, sort, ascending, filters, search],
  );
  const tabIsEmpty = useMemo(
    () => !all.some((novel) => (tab === 'local' ? novel.isLocal : !novel.isLocal)),
    [all, tab],
  );

  const sources = useMemo(() => {
    const names = new Map<string, string>();
    for (const novel of all) {
      const key = sourceKey(novel);
      names.set(key, key === 'file' ? t('library.sourceFile') : key);
    }
    return [...names].map(([key, name]) => ({ key, name }));
  }, [all, t]);
  const languages = useMemo(
    () => [
      ...new Set(all.map((novel) => novel.originalLang).filter((code): code is string => !!code)),
    ],
    [all],
  );

  const badges = useMemo(
    () => ({
      unread: showUnread,
      download: showDownload,
      language: showLanguage,
      progress: showProgress,
    }),
    [showUnread, showDownload, showLanguage, showProgress],
  );

  // More columns in landscape, keeping roughly the same card width.
  const columns =
    display === 'list'
      ? 1
      : width > height
        ? Math.round((columnSetting * width) / height)
        : columnSetting;

  const selectionMode = selection.length > 0;
  const clearSelection = useCallback(() => setSelection([]), []);
  const closeSearch = useCallback(() => {
    setSearching(false);
    setSearch('');
  }, []);
  useBackHandler(selectionMode || searching, selectionMode ? clearSelection : closeSearch);

  const toggleSelected = useCallback((novel: LibraryNovel) => {
    setSelection((current) =>
      current.includes(novel.id) ? current.filter((id) => id !== novel.id) : [...current, novel.id],
    );
  }, []);

  const openNovel = useCallback(
    (novel: LibraryNovel) => navigation.navigate('novel', { novelId: novel.id }),
    [navigation],
  );
  const onPress = selectionMode ? toggleSelected : openNovel;
  const onLongPress = useCallback(
    (novel: LibraryNovel) => {
      void Haptics.selectionAsync();
      toggleSelected(novel);
    },
    [toggleSelected],
  );
  const onContinue = useCallback(
    (novel: LibraryNovel) => {
      const resume = findResumeChapter(listChapters(getDb(), novel.id), novel.lastReadChapterId);
      if (resume) {
        navigation.navigate('reader', { chapterId: resume.chapter.id });
      }
    },
    [navigation],
  );

  const markRead = (read: boolean) => {
    markNovelsRead(getDb(), selection, read);
    invalidate('library', 'chapters', 'novel');
    clearSelection();
  };
  const remove = () => {
    const count = selection.length;
    removeNovelsFromLibrary(getDb(), deviceFiles, selection);
    invalidate('library', 'chapters', 'novel', 'history');
    setConfirmRemove(false);
    clearSelection();
    showToast(t('library.removed', { count }));
  };

  const filterCount = countActiveFilters(filters);
  const selectedCategories = useMemo(() => {
    const selected = all.filter((novel) => selection.includes(novel.id));
    if (selected.length === 0) {
      return [];
    }
    // Pre-check the categories shared by every selected novel.
    return selected[0].categoryIds.filter((id) =>
      selected.every((novel) => novel.categoryIds.includes(id)),
    );
  }, [all, selection]);

  const empty = tabIsEmpty ? (
    tab === 'online' ? (
      <EmptyState
        icon="earth"
        title={t('library.emptyOnlineTitle')}
        message={t('library.emptyOnlineMessage')}
      >
        <Button
          label={t('library.browseSources')}
          icon="compass-outline"
          onPress={() => navigation.navigate('browse')}
        />
      </EmptyState>
    ) : (
      <EmptyState
        icon="bookshelf"
        title={t('library.emptyLocalTitle')}
        message={t('library.emptyLocalMessage')}
      >
        <Button
          label={t('library.importFile')}
          icon="file-import-outline"
          onPress={() => void pickAndImport()}
        />
        <Button
          label={t('library.browseSources')}
          variant="text"
          icon="compass-outline"
          onPress={() => navigation.navigate('browse')}
        />
      </EmptyState>
    )
  ) : (
    <EmptyState
      icon="filter-off-outline"
      title={t('library.noResultTitle')}
      message={t('library.noResultMessage')}
    >
      {filterCount > 0 || search !== '' ? (
        <Button
          label={t('library.clearFilters')}
          variant="tonal"
          onPress={() => {
            setFilters(NO_FILTERS);
            setSearch('');
          }}
        />
      ) : null}
    </EmptyState>
  );

  return (
    <Screen>
      {selectionMode ? (
        <AppBar
          title={t('library.selected', { count: selection.length })}
          onBack={clearSelection}
          actions={
            <IconButton
              icon="select-all"
              label={t('library.selectAll')}
              onPress={() => setSelection(novels.map((novel) => novel.id))}
            />
          }
        />
      ) : searching ? (
        <View style={styles.searchBar}>
          <IconButton icon="arrow-left" label={t('common.back')} onPress={closeSearch} />
          <View style={styles.searchField}>
            <TextField
              autoFocus
              value={search}
              onChangeText={setSearch}
              placeholder={t('library.searchPlaceholder')}
              returnKeyType="search"
              accessibilityLabel={t('library.searchPlaceholder')}
            />
          </View>
          {search !== '' ? (
            <IconButton
              icon="close"
              label={t('library.clearSearch')}
              onPress={() => setSearch('')}
            />
          ) : null}
        </View>
      ) : (
        <AppBar
          title={t('tabs.library')}
          large
          actions={
            <>
              <IconButton
                icon="magnify"
                label={t('common.search')}
                onPress={() => setSearching(true)}
              />
              <IconButton
                icon={filterCount > 0 ? 'filter' : 'filter-outline'}
                label={t('library.options')}
                color={filterCount > 0 ? colors.primary : undefined}
                onPress={() => setOptionsOpen(true)}
              />
            </>
          }
        />
      )}

      <SegmentedTabs<LibraryTab>
        value={tab}
        onChange={(value) => {
          setTab(value);
          clearSelection();
        }}
        options={[
          { value: 'online', label: t('library.online') },
          { value: 'local', label: t('library.local') },
        ]}
      />

      {categories.length > 0 && !tabIsEmpty ? (
        <View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categories}
          >
            <Chip
              label={t('library.allCategories')}
              selected={activeCategory === null}
              onPress={() => setCategoryId(null)}
            />
            {categories.map((category) => (
              <Chip
                key={category.id}
                label={category.name}
                selected={activeCategory === category.id}
                onPress={() => setCategoryId(category.id)}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {novels.length === 0 ? (
        empty
      ) : (
        <FlashList
          key={`${display}-${columns}`}
          data={novels}
          numColumns={columns}
          keyExtractor={(novel) => String(novel.id)}
          extraData={selection}
          contentContainerStyle={display === 'list' ? styles.list : styles.grid}
          renderItem={({ item }) => (
            <NovelCard
              novel={item}
              display={display}
              badges={badges}
              selected={selection.includes(item.id)}
              selectionMode={selectionMode}
              onPress={onPress}
              onLongPress={onLongPress}
              onContinue={onContinue}
            />
          )}
        />
      )}

      {selectionMode ? (
        <View
          style={[
            styles.actions,
            { backgroundColor: colors.surface, borderTopColor: colors.border },
          ]}
        >
          <IconButton
            icon="label-outline"
            label={t('library.changeCategories')}
            onPress={() => setPickingCategories(true)}
          />
          <IconButton
            icon="check-all"
            label={t('library.markRead')}
            onPress={() => markRead(true)}
          />
          <IconButton
            icon="check"
            label={t('library.markUnread')}
            onPress={() => markRead(false)}
          />
          <IconButton
            icon="delete-outline"
            label={t('library.remove')}
            color={colors.error}
            onPress={() => setConfirmRemove(true)}
          />
        </View>
      ) : tab === 'local' && !tabIsEmpty ? (
        <Fab
          icon="file-import-outline"
          label={t('library.import')}
          onPress={() => void pickAndImport()}
        />
      ) : null}

      <LibraryOptionsSheet
        visible={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        filters={filters}
        onFiltersChange={setFilters}
        sources={sources}
        languages={languages}
      />
      <ConfirmDialog
        visible={confirmRemove}
        title={t('library.removeTitle')}
        message={t('library.removeMessage', { count: selection.length })}
        confirmLabel={t('library.remove')}
        danger
        onConfirm={remove}
        onClose={() => setConfirmRemove(false)}
      />
      {pickingCategories ? (
        <CategoryPickerDialog
          novelIds={selection}
          initial={selectedCategories}
          onClose={() => {
            setPickingCategories(false);
            clearSelection();
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.xs,
  },
  searchField: { flex: 1 },
  categories: { gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  grid: { paddingHorizontal: SPACING.sm, paddingBottom: 96 },
  list: { paddingBottom: 96 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: SPACING.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
