import { FlashList, type FlashListRef } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { useBackHandler } from '../../app/useBackHandler';
import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import type { Chapter, Volume } from '../../db/schema';
import { deviceFiles } from '../../services/deviceFileStore';
import {
  AppBar,
  AppText,
  BottomSheet,
  CheckItem,
  ConfirmDialog,
  Dialog,
  EmptyState,
  IconButton,
  ListItem,
  Menu,
  Screen,
  SegmentedTabs,
  TextField,
  showToast,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { SPACING } from '../../theme/typography';
import { CategoryPickerDialog } from '../library/CategoryPickerDialog';
import { getNovelCategoryIds, removeNovelsFromLibrary } from '../library/libraryRepository';
import {
  buildChapterList,
  findResumeChapter,
  NO_CHAPTER_FILTERS,
  type ChapterFilters,
  type ChapterListItem,
} from './chapterList';
import { ChapterRow, VolumeHeader } from './ChapterRow';
import { NovelHeader, type HeaderAction } from './NovelHeader';
import {
  createManualVolume,
  deleteVolume,
  getNovel,
  listChapters,
  listVolumes,
  markPreviousChaptersRead,
  mergeVolumes,
  moveChaptersToVolume,
  renameVolume,
  setChaptersRead,
} from './novelRepository';

type NovelTab = 'chapters' | 'favorites' | 'quotes';

type Prompt =
  | { kind: 'none' }
  | { kind: 'goTo' }
  | { kind: 'newVolume' }
  | { kind: 'moveToVolume' }
  | { kind: 'renameVolume'; volume: Volume }
  | { kind: 'volumeActions'; volume: Volume }
  | { kind: 'categories' }
  | { kind: 'remove' };

export function NovelScreen({ navigation, route }: RootScreenProps<'novel'>) {
  const { novelId } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const listRef = useRef<FlashListRef<ChapterListItem>>(null);

  const novel = useQuery(() => getNovel(getDb(), novelId), ['novel', 'library'], [novelId]);
  const chapters = useQuery(() => listChapters(getDb(), novelId), ['chapters'], [novelId]);
  const volumes = useQuery(() => listVolumes(getDb(), novelId), ['chapters'], [novelId]);

  const [tab, setTab] = useState<NovelTab>('chapters');
  const [ascending, setAscending] = useState(true);
  const [filters, setFilters] = useState<ChapterFilters>(NO_CHAPTER_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const [selection, setSelection] = useState<number[]>([]);
  const [prompt, setPrompt] = useState<Prompt>({ kind: 'none' });
  const [input, setInput] = useState('');

  const items = useMemo(
    () =>
      tab === 'favorites'
        ? chapters
            .filter((chapter) => chapter.isFavorite)
            .map((chapter): ChapterListItem => ({
              type: 'chapter',
              key: `c${chapter.id}`,
              chapter,
            }))
        : tab === 'chapters'
          ? buildChapterList(chapters, volumes, { ascending, filters, search, collapsed })
          : [],
    [tab, chapters, volumes, ascending, filters, search, collapsed],
  );
  const readCount = useMemo(() => chapters.filter((chapter) => chapter.isRead).length, [chapters]);
  const resume = useMemo(
    () => findResumeChapter(chapters, novel?.lastReadChapterId ?? null),
    [chapters, novel?.lastReadChapterId],
  );

  const selectionMode = selection.length > 0;
  const clearSelection = useCallback(() => setSelection([]), []);
  const closeSearch = useCallback(() => {
    setSearching(false);
    setSearch('');
  }, []);
  useBackHandler(selectionMode || searching, selectionMode ? clearSelection : closeSearch);

  const closePrompt = () => {
    setPrompt({ kind: 'none' });
    setInput('');
  };
  const refresh = () => invalidate('chapters', 'library', 'novel');

  const openChapter = useCallback(
    (chapter: Chapter) => navigation.navigate('reader', { chapterId: chapter.id }),
    [navigation],
  );
  const toggleSelected = useCallback((chapter: Chapter) => {
    setSelection((current) =>
      current.includes(chapter.id)
        ? current.filter((id) => id !== chapter.id)
        : [...current, chapter.id],
    );
  }, []);
  const onLongPress = useCallback(
    (chapter: Chapter) => {
      void Haptics.selectionAsync();
      toggleSelected(chapter);
    },
    [toggleSelected],
  );
  const toggleVolume = useCallback((volume: Volume) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(volume.id)) {
        next.add(volume.id);
      }
      return next;
    });
  }, []);
  const onVolumeLongPress = useCallback(
    (volume: Volume) => setPrompt({ kind: 'volumeActions', volume }),
    [],
  );

  if (!novel) {
    return (
      <Screen bottom>
        <AppBar title="" onBack={navigation.goBack} />
        <EmptyState icon="book-off-outline" title={t('novel.notFound')} />
      </Screen>
    );
  }

  const goToChapter = () => {
    const wanted = Number(input.replace(',', '.'));
    closePrompt();
    if (!Number.isFinite(wanted)) {
      return;
    }
    const target =
      chapters.find((chapter) => chapter.number === wanted) ??
      chapters.find((chapter) => chapter.position + 1 === Math.round(wanted));
    if (!target) {
      showToast(t('novel.chapterNotFound'));
      return;
    }
    // Make sure the chapter is visible: clear what could hide it.
    const nextCollapsed = new Set(collapsed);
    if (target.volumeId !== null) {
      nextCollapsed.delete(target.volumeId);
    }
    setCollapsed(nextCollapsed);
    setFilters(NO_CHAPTER_FILTERS);
    setSearch('');
    setTab('chapters');
    const list = buildChapterList(chapters, volumes, {
      ascending,
      filters: NO_CHAPTER_FILTERS,
      search: '',
      collapsed: nextCollapsed,
    });
    const index = list.findIndex(
      (item) => item.type === 'chapter' && item.chapter.id === target.id,
    );
    if (index >= 0) {
      setTimeout(() => {
        void listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.3 });
      }, 80);
    }
  };

  const actions: HeaderAction[] = [
    {
      key: 'library',
      icon: novel.inLibrary ? 'heart' : 'heart-outline',
      label: novel.inLibrary ? t('novel.inLibrary') : t('novel.addToLibrary'),
      active: novel.inLibrary,
      onPress: () => setPrompt({ kind: 'remove' }),
    },
    {
      key: 'categories',
      icon: 'label-outline',
      label: t('novel.categories'),
      onPress: () => setPrompt({ kind: 'categories' }),
    },
    {
      key: 'edit',
      icon: 'pencil-outline',
      label: t('novel.edit'),
      onPress: () => navigation.navigate('novelEdit', { novelId }),
    },
  ];

  const filterCount = Object.values(filters).filter(Boolean).length;
  const single =
    selection.length === 1 ? chapters.find((chapter) => chapter.id === selection[0]) : undefined;

  const header = (
    <View>
      <NovelHeader
        novel={novel}
        chapterCount={chapters.length}
        readCount={readCount}
        resume={resume}
        actions={actions}
        onContinue={() => resume && openChapter(resume.chapter)}
      />
      <SegmentedTabs<NovelTab>
        value={tab}
        onChange={(value) => {
          setTab(value);
          clearSelection();
        }}
        options={[
          { value: 'chapters', label: t('novel.tabChapters') },
          { value: 'favorites', label: t('novel.tabFavorites') },
          { value: 'quotes', label: t('novel.tabQuotes') },
        ]}
      />
      {tab === 'chapters' ? (
        searching ? (
          <View style={styles.toolbar}>
            <View style={styles.search}>
              <TextField
                autoFocus
                value={search}
                onChangeText={setSearch}
                placeholder={t('novel.searchChapters')}
                accessibilityLabel={t('novel.searchChapters')}
              />
            </View>
            <IconButton icon="close" label={t('common.close')} onPress={closeSearch} />
          </View>
        ) : (
          <View style={styles.toolbar}>
            <AppText variant="label" secondary style={styles.count}>
              {t('novel.chapterCount', { count: chapters.length })}
            </AppText>
            <IconButton
              icon="magnify"
              label={t('novel.searchChapters')}
              onPress={() => setSearching(true)}
            />
            <IconButton
              icon="numeric"
              label={t('novel.goToChapter')}
              onPress={() => setPrompt({ kind: 'goTo' })}
            />
            <IconButton
              icon={filterCount > 0 ? 'filter' : 'filter-outline'}
              label={t('novel.filters')}
              color={filterCount > 0 ? colors.primary : undefined}
              onPress={() => setFiltersOpen(true)}
            />
            <IconButton
              icon={ascending ? 'sort-ascending' : 'sort-descending'}
              label={ascending ? t('novel.sortDescending') : t('novel.sortAscending')}
              onPress={() => setAscending((value) => !value)}
            />
          </View>
        )
      ) : null}
    </View>
  );

  const emptyList =
    tab === 'quotes' ? (
      <EmptyState
        icon="format-quote-close"
        title={t('novel.noQuotesTitle')}
        message={t('novel.noQuotesMessage')}
      />
    ) : tab === 'favorites' ? (
      <EmptyState
        icon="star-outline"
        title={t('novel.noFavoritesTitle')}
        message={t('novel.noFavoritesMessage')}
      />
    ) : (
      <EmptyState icon="book-open-blank-variant" title={t('novel.noChaptersTitle')} />
    );

  return (
    <Screen bottom>
      {selectionMode ? (
        <AppBar
          title={t('library.selected', { count: selection.length })}
          onBack={clearSelection}
          actions={
            <IconButton
              icon="select-all"
              label={t('library.selectAll')}
              onPress={() =>
                setSelection(
                  items.flatMap((item) => (item.type === 'chapter' ? [item.chapter.id] : [])),
                )
              }
            />
          }
        />
      ) : (
        <AppBar
          title={novel.title}
          onBack={navigation.goBack}
          actions={
            <Menu
              label={t('novel.menu')}
              items={[
                {
                  label: t('novel.edit'),
                  icon: 'pencil-outline',
                  onPress: () => navigation.navigate('novelEdit', { novelId }),
                },
                {
                  label: t('novel.expandAll'),
                  icon: 'unfold-more-horizontal',
                  disabled: volumes.length === 0,
                  onPress: () => setCollapsed(new Set()),
                },
                {
                  label: t('novel.collapseAll'),
                  icon: 'unfold-less-horizontal',
                  disabled: volumes.length === 0,
                  onPress: () => setCollapsed(new Set(volumes.map((volume) => volume.id))),
                },
              ]}
            />
          }
        />
      )}

      <FlashList
        ref={listRef}
        data={items}
        extraData={selection}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.type}
        ListHeaderComponent={header}
        ListEmptyComponent={emptyList}
        contentContainerStyle={styles.list}
        renderItem={({ item }) =>
          item.type === 'volume' ? (
            <VolumeHeader
              volume={item.volume}
              chapterCount={item.chapterCount}
              readCount={item.readCount}
              collapsed={item.collapsed}
              onPress={toggleVolume}
              onLongPress={onVolumeLongPress}
            />
          ) : (
            <ChapterRow
              chapter={item.chapter}
              selected={selection.includes(item.chapter.id)}
              onPress={selectionMode ? toggleSelected : openChapter}
              onLongPress={onLongPress}
            />
          )
        }
      />

      {selectionMode ? (
        <View
          style={[
            styles.actions,
            { backgroundColor: colors.surface, borderTopColor: colors.border },
          ]}
        >
          <IconButton
            icon="check-all"
            label={t('library.markRead')}
            onPress={() => {
              setChaptersRead(getDb(), selection, true);
              refresh();
              clearSelection();
            }}
          />
          <IconButton
            icon="check"
            label={t('library.markUnread')}
            onPress={() => {
              setChaptersRead(getDb(), selection, false);
              refresh();
              clearSelection();
            }}
          />
          <IconButton
            icon="arrow-collapse-up"
            label={t('novel.markPreviousRead')}
            disabled={!single}
            onPress={() => {
              if (single) {
                markPreviousChaptersRead(getDb(), single.id);
                refresh();
                clearSelection();
              }
            }}
          />
          <IconButton
            icon="folder-plus-outline"
            label={t('novel.createVolume')}
            onPress={() => setPrompt({ kind: 'newVolume' })}
          />
          <IconButton
            icon="folder-move-outline"
            label={t('novel.moveToVolume')}
            onPress={() => setPrompt({ kind: 'moveToVolume' })}
          />
        </View>
      ) : null}

      <BottomSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={t('novel.filters')}
      >
        {(['unread', 'downloaded', 'favorite'] as const).map((key) => (
          <CheckItem
            key={key}
            title={t(`novel.filterBy.${key}`)}
            checked={filters[key]}
            onPress={() => setFilters({ ...filters, [key]: !filters[key] })}
          />
        ))}
      </BottomSheet>

      <Dialog
        visible={prompt.kind === 'goTo'}
        title={t('novel.goToChapter')}
        onClose={closePrompt}
        actions={[
          { label: t('common.cancel'), onPress: closePrompt },
          { label: t('common.ok'), onPress: goToChapter },
        ]}
      >
        <TextField
          autoFocus
          keyboardType="numeric"
          value={input}
          onChangeText={setInput}
          placeholder={t('novel.chapterNumberPlaceholder')}
          onSubmitEditing={goToChapter}
        />
      </Dialog>

      <Dialog
        visible={prompt.kind === 'newVolume' || prompt.kind === 'renameVolume'}
        title={prompt.kind === 'renameVolume' ? t('novel.renameVolume') : t('novel.createVolume')}
        onClose={closePrompt}
        actions={[
          { label: t('common.cancel'), onPress: closePrompt },
          {
            label: t('common.save'),
            disabled: input.trim() === '',
            onPress: () => {
              if (prompt.kind === 'renameVolume') {
                renameVolume(getDb(), prompt.volume.id, input);
              } else {
                createManualVolume(getDb(), novelId, input, selection);
                clearSelection();
              }
              refresh();
              closePrompt();
            },
          },
        ]}
      >
        <TextField
          autoFocus
          value={input}
          onChangeText={setInput}
          placeholder={t('novel.volumeNamePlaceholder')}
        />
      </Dialog>

      <Dialog
        visible={prompt.kind === 'moveToVolume'}
        title={t('novel.moveToVolume')}
        onClose={closePrompt}
      >
        <View>
          {volumes.map((volume) => (
            <ListItem
              key={volume.id}
              icon="folder-outline"
              title={volume.title}
              onPress={() => {
                moveChaptersToVolume(getDb(), novelId, selection, volume.id);
                refresh();
                clearSelection();
                closePrompt();
              }}
            />
          ))}
          <ListItem
            icon="folder-off-outline"
            title={t('novel.noVolume')}
            onPress={() => {
              moveChaptersToVolume(getDb(), novelId, selection, null);
              refresh();
              clearSelection();
              closePrompt();
            }}
          />
        </View>
      </Dialog>

      {prompt.kind === 'volumeActions' ? (
        <BottomSheet visible onClose={closePrompt} title={prompt.volume.title}>
          <ListItem
            icon="pencil-outline"
            title={t('novel.renameVolume')}
            onPress={() => {
              setInput(prompt.volume.title);
              setPrompt({ kind: 'renameVolume', volume: prompt.volume });
            }}
          />
          <ListItem
            icon="call-merge"
            title={t('novel.mergeWithPrevious')}
            disabled={volumes.findIndex((volume) => volume.id === prompt.volume.id) <= 0}
            onPress={() => {
              const index = volumes.findIndex((volume) => volume.id === prompt.volume.id);
              mergeVolumes(getDb(), novelId, [volumes[index - 1].id, prompt.volume.id]);
              refresh();
              closePrompt();
            }}
          />
          <ListItem
            icon="folder-remove-outline"
            title={t('novel.deleteVolume')}
            subtitle={t('novel.deleteVolumeHint')}
            onPress={() => {
              deleteVolume(getDb(), prompt.volume.id);
              refresh();
              closePrompt();
            }}
          />
        </BottomSheet>
      ) : null}

      {prompt.kind === 'categories' ? (
        <CategoryPickerDialog
          novelIds={[novelId]}
          initial={getNovelCategoryIds(getDb(), novelId)}
          onClose={closePrompt}
        />
      ) : null}

      <ConfirmDialog
        visible={prompt.kind === 'remove'}
        title={t('library.removeTitle')}
        message={t('library.removeMessage', { count: 1 })}
        confirmLabel={t('library.remove')}
        danger
        onClose={closePrompt}
        onConfirm={() => {
          closePrompt();
          removeNovelsFromLibrary(getDb(), deviceFiles, [novelId]);
          invalidate('library', 'novel', 'chapters', 'history');
          navigation.goBack();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: SPACING.xxl },
  toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.sm },
  count: { flex: 1, paddingLeft: SPACING.sm },
  search: { flex: 1, paddingLeft: SPACING.sm },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: SPACING.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
