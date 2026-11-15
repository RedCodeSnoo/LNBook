import { FlashList } from '@shopify/flash-list';
import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getDb } from '../../db/client';
import { useQuery } from '../../db/invalidation';
import type { Chapter, Volume } from '../../db/schema';
import { AppText, IconButton, TextField } from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { SPACING } from '../../theme/typography';
import { buildChapterList, NO_CHAPTER_FILTERS, type ChapterListItem } from '../novel/chapterList';
import { ChapterRow, VolumeHeader } from '../novel/ChapterRow';
import { listChapters, listVolumes } from '../novel/novelRepository';
import { listTranslatedChapters } from '../translation/translationRepository';

/** Side panel of the reader with every chapter of the novel (volumes included). */
export function ChapterDrawer({
  visible,
  onClose,
  novelId,
  novelTitle,
  currentChapterId,
  lang,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  novelId: number;
  novelTitle: string;
  currentChapterId: number;
  /** Language of the translation being read, when it is not the original. */
  lang?: string | null;
  onSelect: (chapter: Chapter) => void;
}) {
  const { colors } = useTheme();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.flex}>
        <Pressable
          style={[styles.backdrop, { backgroundColor: colors.overlay }]}
          onPress={onClose}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        {visible ? (
          <DrawerContent
            onClose={onClose}
            novelId={novelId}
            novelTitle={novelTitle}
            currentChapterId={currentChapterId}
            lang={lang}
            onSelect={onSelect}
          />
        ) : null}
      </View>
    </Modal>
  );
}

function DrawerContent({
  onClose,
  novelId,
  novelTitle,
  currentChapterId,
  lang,
  onSelect,
}: {
  onClose: () => void;
  novelId: number;
  novelTitle: string;
  currentChapterId: number;
  lang?: string | null;
  onSelect: (chapter: Chapter) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());

  const chapters = useQuery(() => listChapters(getDb(), novelId), ['chapters'], [novelId]);
  const volumes = useQuery(() => listVolumes(getDb(), novelId), ['chapters'], [novelId]);
  const translated = useQuery(
    () => (lang ? listTranslatedChapters(getDb(), novelId, lang) : null),
    ['chapterContent'],
    [novelId, lang],
  );
  const items = useMemo(
    () =>
      buildChapterList(chapters, volumes, {
        ascending: true,
        filters: NO_CHAPTER_FILTERS,
        search,
        collapsed,
      }),
    [chapters, volumes, search, collapsed],
  );
  // The current chapter is shown around the middle of the panel.
  const [initialIndex] = useState(() => {
    const index = items.findIndex(
      (item) => item.type === 'chapter' && item.chapter.id === currentChapterId,
    );
    return Math.max(0, index - 5);
  });

  const toggleVolume = useCallback((volume: Volume) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(volume.id)) {
        next.add(volume.id);
      }
      return next;
    });
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: ChapterListItem }) =>
      item.type === 'volume' ? (
        <VolumeHeader
          volume={item.volume}
          chapterCount={item.chapterCount}
          readCount={item.readCount}
          collapsed={item.collapsed}
          onPress={toggleVolume}
        />
      ) : (
        <ChapterRow
          chapter={item.chapter}
          selected={item.chapter.id === currentChapterId}
          current={item.chapter.id === currentChapterId}
          translated={translated?.has(item.chapter.id)}
          translatedTitle={translated?.get(item.chapter.id)}
          onPress={onSelect}
        />
      ),
    [currentChapterId, onSelect, toggleVolume, translated],
  );

  return (
    <View
      accessibilityViewIsModal
      style={[
        styles.panel,
        {
          backgroundColor: colors.surface,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingRight: insets.right,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.titles}>
          <AppText variant="title" numberOfLines={1} accessibilityRole="header">
            {t('reader.chapterList')}
          </AppText>
          <AppText variant="caption" secondary numberOfLines={1}>
            {novelTitle}
          </AppText>
        </View>
        <IconButton icon="close" label={t('common.close')} onPress={onClose} />
      </View>
      <View style={styles.search}>
        <TextField
          value={search}
          onChangeText={setSearch}
          placeholder={t('reader.chapterSearch')}
          accessibilityLabel={t('reader.chapterSearch')}
          returnKeyType="search"
        />
      </View>
      <FlashList
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.type}
        initialScrollIndex={search === '' && initialIndex > 0 ? initialIndex : undefined}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  panel: { width: '86%', maxWidth: 420, elevation: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: SPACING.lg,
    paddingRight: SPACING.xs,
    minHeight: 56,
  },
  titles: { flex: 1 },
  search: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
});
