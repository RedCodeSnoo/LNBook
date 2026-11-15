import { FlashList, type FlashListRef } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
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
  Chip,
  ConfirmDialog,
  Dialog,
  EmptyState,
  IconButton,
  ListItem,
  Menu,
  Screen,
  SegmentedTabs,
  Skeleton,
  TextField,
  showToast,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { SPACING } from '../../theme/typography';
import { SourceErrorView } from '../browse/SourceBits';
import { queueDownloads } from '../downloads/downloadService';
import { selectChapters, type DownloadSelection } from '../downloads/downloadsRepository';
import { deleteChapterDownloads } from '../downloads/storage';
import { defaultTargetLang, languageInfo } from '../translation/languages';
import {
  activeTranslationLang,
  listTranslatedChapters,
  listTranslatedLanguages,
  setReadingLang,
} from '../translation/translationRepository';
import { queueTranslations } from '../translation/translationService';
import { TranslationSheet } from '../translation/TranslationSheet';
import { setNovelUpdateOptions } from '../updates/updateChecker';
import { exportNovelToDevice } from './exportToDevice';
import { setNovelInLibrary } from '../browse/sourceNovels';
import { sourcePageUrl, useSourceNovel } from '../browse/useSourceNovel';
import { QuoteList } from '../quotes/QuoteList';
import { resetNovelProgress } from '../stats/sessionsRepository';
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
import { NovelHeader, type HeaderAction, type HeaderLanguage } from './NovelHeader';
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
  | { kind: 'remove' }
  | { kind: 'reset' }
  | { kind: 'download' }
  | { kind: 'downloadRange' }
  | { kind: 'export' }
  | { kind: 'exportRange' }
  | { kind: 'translate'; lang: string | null };

const NO_TRANSLATIONS: ReadonlyMap<number, string | null> = new Map();

export function NovelScreen({ navigation, route }: RootScreenProps<'novel'>) {
  const { novelId } = route.params;
  const { t, i18n } = useTranslation();
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
  const [keepTimes, setKeepTimes] = useState(true);
  const [exportLang, setExportLang] = useState<string | null>(null);
  const [exportRange, setExportRange] = useState<{ from: number; to: number } | null>(null);

  // Translations: languages available, and the chapters of the one being read.
  const translatedLangs = useQuery(
    () => listTranslatedLanguages(getDb(), novelId),
    ['chapters', 'chapterContent', 'novel'],
    [novelId],
  );
  const activeLang = novel ? activeTranslationLang(novel) : null;
  const shownLang = activeLang ?? translatedLangs[0]?.lang ?? null;
  const translatedChapters = useQuery(
    () => (shownLang ? listTranslatedChapters(getDb(), novelId, shownLang) : NO_TRANSLATIONS),
    ['chapters', 'chapterContent', 'novel'],
    [novelId, shownLang],
  );

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

  const source = useSourceNovel(novel, chapters.length);

  const download = (choice: DownloadSelection | number[]) => {
    const ids = Array.isArray(choice)
      ? choice
      : selectChapters(chapters, choice, novel?.lastReadChapterId ?? null);
    const added = queueDownloads(ids);
    showToast(added > 0 ? t('downloads.queued', { count: added }) : t('downloads.nothingToQueue'));
    setPrompt({ kind: 'none' });
    setInput('');
  };

  const exportEpub = (target: 'folder' | 'share') => {
    setPrompt({ kind: 'none' });
    showToast(t('novel.exporting'));
    void exportNovelToDevice(novelId, target, {
      lang: exportLang,
      from: exportRange?.from,
      to: exportRange?.to,
    }).then((outcome) => {
      if (outcome.status === 'saved' || outcome.status === 'shared') {
        showToast(
          outcome.missing > 0
            ? t('novel.exportedPartial', { count: outcome.missing })
            : t('novel.exported'),
        );
      } else if (outcome.status === 'empty') {
        showToast(t('novel.exportEmpty'));
      } else if (outcome.status === 'failed') {
        showToast(t('novel.exportFailed'));
      }
    });
  };

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
      onPress: () => {
        if (novel.inLibrary) {
          setPrompt({ kind: 'remove' });
        } else {
          setNovelInLibrary(getDb(), novelId, true);
          invalidate('library', 'novel');
          showToast(t('novel.addedToLibrary'));
        }
      },
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

  actions.push({
    key: 'translate',
    icon: 'translate',
    label: t('translation.translate'),
    active: activeLang !== null,
    onPress: () => setPrompt({ kind: 'translate', lang: activeLang }),
  });

  const languages: HeaderLanguage[] = [
    { code: novel.originalLang, original: true, count: chapters.length },
    ...translatedLangs.map((item) => ({ code: item.lang, original: false, count: item.count })),
    // A language chosen for reading appears as soon as it is chosen.
    ...(activeLang && !translatedLangs.some((item) => item.lang === activeLang)
      ? [{ code: activeLang, original: false, count: 0 }]
      : []),
  ];

  const filterCount = Object.values(filters).filter(Boolean).length;
  const single =
    selection.length === 1 ? chapters.find((chapter) => chapter.id === selection[0]) : undefined;

  const header = (
    <View>
      <NovelHeader
        novel={novel}
        languages={languages}
        activeLang={activeLang}
        onPickLanguage={(code) => {
          setReadingLang(getDb(), novelId, code);
          invalidate('novel', 'library');
        }}
        onLanguageOptions={(code) => setPrompt({ kind: 'translate', lang: code })}
        onAddLanguage={() => setPrompt({ kind: 'translate', lang: null })}
        chapterCount={chapters.length}
        readCount={readCount}
        resume={resume}
        actions={actions}
        onContinue={() => resume && openChapter(resume.chapter)}
        onOpenStats={() => navigation.navigate('novelStats', { novelId })}
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
      {tab === 'quotes' ? <QuoteList novelId={novelId} /> : null}
      {tab === 'chapters' && source.error ? (
        <SourceErrorView
          compact
          error={source.error}
          onRetry={() => void source.refresh()}
          webUrl={sourcePageUrl(novel) ?? undefined}
          pluginId={novel.pluginId ?? undefined}
        />
      ) : null}
      {tab === 'chapters' && source.refreshing && chapters.length === 0 ? (
        <View style={styles.loading} accessibilityLabel={t('novel.loadingChapters')}>
          {[0, 1, 2, 3, 4].map((line) => (
            <Skeleton key={line} height={40} />
          ))}
        </View>
      ) : null}
    </View>
  );

  const emptyList =
    tab === 'quotes' ? null : tab === 'favorites' ? (
      <EmptyState
        icon="star-outline"
        title={t('novel.noFavoritesTitle')}
        message={t('novel.noFavoritesMessage')}
      />
    ) : source.refreshing || source.error ? null : (
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
                  label: t('novel.exportEpub'),
                  icon: 'book-arrow-up-outline',
                  onPress: () => {
                    setExportLang(activeLang);
                    setExportRange(null);
                    setPrompt({ kind: 'export' });
                  },
                },
                {
                  label: t('translation.translate'),
                  icon: 'translate',
                  onPress: () => setPrompt({ kind: 'translate', lang: activeLang }),
                },
                {
                  label: t('translation.glossary'),
                  icon: 'book-alphabet',
                  onPress: () => navigation.navigate('glossary', { novelId }),
                },
                ...(source.online
                  ? [
                      {
                        label: t('downloads.download'),
                        icon: 'download-outline' as const,
                        onPress: () => setPrompt({ kind: 'download' }),
                      },
                      {
                        label: novel.notifyUpdates
                          ? t('updates.muteNovel')
                          : t('updates.unmuteNovel'),
                        icon: novel.notifyUpdates
                          ? ('bell-off-outline' as const)
                          : ('bell-outline' as const),
                        onPress: () => {
                          setNovelUpdateOptions(getDb(), [novelId], {
                            notifyUpdates: !novel.notifyUpdates,
                          });
                          invalidate('novel');
                        },
                      },
                      {
                        label: novel.autoDownload
                          ? t('updates.autoDownloadOff')
                          : t('updates.autoDownloadOn'),
                        icon: 'download-circle-outline' as const,
                        onPress: () => {
                          setNovelUpdateOptions(getDb(), [novelId], {
                            autoDownload: !novel.autoDownload,
                          });
                          invalidate('novel');
                          showToast(
                            novel.autoDownload
                              ? t('updates.autoDownloadDisabled')
                              : t('updates.autoDownloadEnabled'),
                          );
                        },
                      },
                      {
                        label: t('novel.refresh'),
                        icon: 'refresh' as const,
                        disabled: source.refreshing,
                        onPress: () =>
                          void source.refresh().then((added) => {
                            if (added !== null) {
                              showToast(t('novel.refreshed', { count: added }));
                            }
                          }),
                      },
                      {
                        label: t('sources.openWebView'),
                        icon: 'web' as const,
                        onPress: () => {
                          const url = sourcePageUrl(novel);
                          if (url) {
                            navigation.navigate('webview', {
                              url,
                              pluginId: novel.pluginId ?? undefined,
                              title: novel.title,
                            });
                          }
                        },
                      },
                      {
                        label: t('novel.shareLink'),
                        icon: 'share-variant-outline' as const,
                        onPress: () => {
                          const url = sourcePageUrl(novel);
                          if (url) {
                            void Share.share({ message: url }).catch(() => undefined);
                          }
                        },
                      },
                    ]
                  : []),
                {
                  label: t('reader.replacements'),
                  icon: 'find-replace',
                  onPress: () => navigation.navigate('replacements', { novelId }),
                },
                {
                  label: t('novel.resetProgress'),
                  icon: 'restart',
                  onPress: () => {
                    setKeepTimes(true);
                    setPrompt({ kind: 'reset' });
                  },
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
        extraData={[selection, translatedChapters, activeLang]}
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
              translated={translatedChapters.has(item.chapter.id)}
              translatedTitle={activeLang ? translatedChapters.get(item.chapter.id) : null}
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
          {source.online ? (
            <>
              <IconButton
                icon="download-outline"
                label={t('downloads.download')}
                onPress={() => {
                  download(selection);
                  clearSelection();
                }}
              />
              <IconButton
                icon="download-off-outline"
                label={t('downloads.removeSelected')}
                onPress={() => {
                  const removed = deleteChapterDownloads(getDb(), deviceFiles, selection);
                  showToast(t('downloads.removed', { count: removed }));
                  invalidate('chapters', 'library', 'downloads', 'chapterContent');
                  clearSelection();
                }}
              />
            </>
          ) : null}
          <IconButton
            icon="translate"
            label={t('translation.translateSelected')}
            onPress={() => {
              const target = activeLang ?? defaultTargetLang(novel.originalLang, i18n.language);
              if (!target) {
                showToast(t('translation.noTarget'));
                return;
              }
              const added = queueTranslations(selection, target);
              showToast(
                added > 0
                  ? t('translation.queued', { count: added })
                  : t('translation.nothingToTranslate'),
              );
              clearSelection();
            }}
          />
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
      <BottomSheet
        visible={prompt.kind === 'download'}
        title={t('downloads.download')}
        onClose={closePrompt}
      >
        <ListItem
          icon="download-multiple"
          title={t('downloads.all')}
          onPress={() => download({ kind: 'all' })}
        />
        <ListItem
          icon="eye-off-outline"
          title={t('downloads.unread')}
          onPress={() => download({ kind: 'unread' })}
        />
        <ListItem
          icon="numeric-10-box-outline"
          title={t('downloads.next', { count: 10 })}
          onPress={() => download({ kind: 'next', count: 10 })}
        />
        <ListItem
          icon="numeric-9-plus-box-outline"
          title={t('downloads.next', { count: 50 })}
          onPress={() => download({ kind: 'next', count: 50 })}
        />
        <ListItem
          icon="arrow-expand-horizontal"
          title={t('downloads.range')}
          onPress={() => {
            setInput(`1-${chapters.length}`);
            setPrompt({ kind: 'downloadRange' });
          }}
        />
      </BottomSheet>
      <Dialog
        visible={prompt.kind === 'downloadRange'}
        title={t('downloads.range')}
        message={t('downloads.rangeHint', { count: chapters.length })}
        onClose={closePrompt}
        actions={[
          { label: t('common.cancel'), onPress: closePrompt },
          {
            label: t('downloads.download'),
            disabled: !/^\s*\d+\s*[-–]\s*\d+\s*$/.test(input),
            onPress: () => {
              const [from, to] = input.split(/[-–]/).map((part) => Number(part.trim()));
              download({ kind: 'range', from, to });
            },
          },
        ]}
      >
        <TextField
          autoFocus
          value={input}
          onChangeText={setInput}
          placeholder="1-200"
          accessibilityLabel={t('downloads.range')}
          keyboardType="numbers-and-punctuation"
        />
      </Dialog>
      <BottomSheet
        visible={prompt.kind === 'export'}
        title={t('novel.exportEpub')}
        onClose={closePrompt}
      >
        {translatedLangs.length > 0 ? (
          <View style={styles.exportLangs}>
            {[null, ...translatedLangs.map((item) => item.lang)].map((code) => (
              <Chip
                key={code ?? 'original'}
                label={
                  code === null
                    ? t('translation.original')
                    : `${languageInfo(code)?.flag ?? ''} ${languageInfo(code)?.name ?? code}`.trim()
                }
                selected={exportLang === code}
                onPress={() => setExportLang(code)}
              />
            ))}
          </View>
        ) : null}
        <ListItem
          icon="arrow-expand-horizontal"
          title={t('novel.exportChapters')}
          subtitle={
            exportRange
              ? t('novel.exportRangeValue', { from: exportRange.from, to: exportRange.to })
              : t('novel.exportAllChapters', { count: chapters.length })
          }
          onPress={() => {
            setInput(`${exportRange?.from ?? 1}-${exportRange?.to ?? chapters.length}`);
            setPrompt({ kind: 'exportRange' });
          }}
        />
        <ListItem
          icon="folder-outline"
          title={t('novel.exportToFolder')}
          onPress={() => exportEpub('folder')}
        />
        <ListItem
          icon="share-variant-outline"
          title={t('novel.exportShare')}
          onPress={() => exportEpub('share')}
        />
      </BottomSheet>
      <Dialog
        visible={prompt.kind === 'exportRange'}
        title={t('novel.exportChapters')}
        message={t('downloads.rangeHint', { count: chapters.length })}
        onClose={() => setPrompt({ kind: 'export' })}
        actions={[
          {
            label: t('novel.exportEverything'),
            onPress: () => {
              setExportRange(null);
              setInput('');
              setPrompt({ kind: 'export' });
            },
          },
          {
            label: t('common.ok'),
            disabled: !/^\s*\d+\s*[-–]\s*\d+\s*$/.test(input),
            onPress: () => {
              const [first, last] = input.split(/[-–]/).map((part) => Number(part.trim()));
              const from = Math.max(1, Math.min(first, last));
              const to = Math.min(chapters.length, Math.max(first, last));
              setExportRange(from === 1 && to === chapters.length ? null : { from, to });
              setInput('');
              setPrompt({ kind: 'export' });
            },
          },
        ]}
      >
        <TextField
          autoFocus
          value={input}
          onChangeText={setInput}
          placeholder="1-200"
          accessibilityLabel={t('novel.exportChapters')}
          keyboardType="numbers-and-punctuation"
        />
      </Dialog>
      <TranslationSheet
        novel={novel}
        chapterCount={chapters.length}
        initialLang={prompt.kind === 'translate' ? prompt.lang : null}
        visible={prompt.kind === 'translate'}
        onClose={closePrompt}
        onOpenGlossary={() => navigation.navigate('glossary', { novelId })}
      />
      <ConfirmDialog
        visible={prompt.kind === 'reset'}
        title={t('novel.resetProgress')}
        message={t('novel.resetProgressMessage')}
        confirmLabel={t('novel.resetProgressConfirm')}
        danger
        onClose={closePrompt}
        onConfirm={() => {
          closePrompt();
          resetNovelProgress(getDb(), novelId, keepTimes);
          invalidate('chapters', 'library', 'novel', 'history', 'stats');
          showToast(t('novel.resetProgressDone'));
        }}
      >
        <View style={styles.dialogCheck}>
          <CheckItem
            title={t('novel.resetKeepTimes')}
            checked={keepTimes}
            onPress={() => setKeepTimes((value) => !value)}
          />
        </View>
      </ConfirmDialog>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: SPACING.xxl },
  loading: { padding: SPACING.lg, gap: SPACING.sm },
  dialogCheck: { marginHorizontal: -SPACING.lg },
  exportLangs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
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
