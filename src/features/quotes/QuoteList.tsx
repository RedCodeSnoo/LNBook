import * as Clipboard from 'expo-clipboard';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { navigationRef } from '../../app/navigationRef';
import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import { formatDate } from '../../services/format';
import {
  AppText,
  BottomSheet,
  Chip,
  EmptyState,
  IconButton,
  ListItem,
  TextField,
  showToast,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import i18n from '../../i18n';
import { useSetting } from '../settings/settingsStore';
import { QuoteEditorSheet } from './QuoteEditorSheet';
import { exportQuotes, quoteLocation } from './quoteFormat';
import { QuoteImageSheet } from './QuoteImageSheet';
import {
  countByFolder,
  deleteQuote,
  listFolders,
  listQuotes,
  type QuoteSort,
  type QuoteView,
} from './quotesRepository';

type FolderFilter = number | 'none' | 'all';

/**
 * Quotes of one novel (or of every novel) with folder chips, search and sort.
 * Not virtualized: it lives inside the scrolling header of the novel page.
 */
export function QuoteList({
  novelId,
  showNovel = novelId === undefined,
}: {
  novelId?: number;
  /** Show the title of the novel on each quote (global view). */
  showNovel?: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const dateFormat = useSetting('dateFormat');
  const [folder, setFolder] = useState<FolderFilter>('all');
  const [sort, setSort] = useState<QuoteSort>('book');
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [actionsFor, setActionsFor] = useState<QuoteView | null>(null);
  const [editing, setEditing] = useState<QuoteView | null>(null);
  const [imageOf, setImageOf] = useState<QuoteView | null>(null);

  const all = useQuery(() => listQuotes(getDb(), { novelId, sort }), ['quotes'], [novelId, sort]);
  const folders = useQuery(() => listFolders(getDb()), ['quotes']);
  const counts = useMemo(() => countByFolder(all, folders), [all, folders]);
  // A folder that lost its last quote of this novel falls back to "All".
  const activeFolder: FolderFilter =
    typeof folder === 'number' && !counts.folders.some((entry) => entry.folder.id === folder)
      ? 'all'
      : folder;
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter((quote) => {
      if (activeFolder === 'none' && quote.folders.length > 0) {
        return false;
      }
      if (
        typeof activeFolder === 'number' &&
        !quote.folders.some((item) => item.id === activeFolder)
      ) {
        return false;
      }
      return (
        needle === '' ||
        quote.text.toLowerCase().includes(needle) ||
        (quote.note ?? '').toLowerCase().includes(needle)
      );
    });
  }, [all, activeFolder, search]);

  const open = (quote: QuoteView) => {
    if (quote.chapterId === null) {
      showToast(t('quotes.chapterDeleted'));
      return;
    }
    if (navigationRef.isReady()) {
      navigationRef.navigate('reader', {
        chapterId: quote.chapterId,
        anchor: quote.anchor ? JSON.stringify(quote.anchor) : undefined,
      });
    }
  };

  const exportShown = (format: 'md' | 'txt') => {
    void Share.share({ message: exportQuotes(shown, format, t) }).catch(() => undefined);
  };

  if (all.length === 0) {
    return (
      <EmptyState
        icon="format-quote-close"
        title={t('novel.noQuotesTitle')}
        message={t('novel.noQuotesMessage')}
      />
    );
  }

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        keyboardShouldPersistTaps="handled"
      >
        <Chip
          label={`${t('quotes.all')} ${counts.total}`}
          selected={activeFolder === 'all'}
          onPress={() => setFolder('all')}
        />
        {counts.none > 0 && counts.none < counts.total ? (
          <Chip
            label={`${t('quotes.noFolder')} ${counts.none}`}
            selected={activeFolder === 'none'}
            onPress={() => setFolder('none')}
          />
        ) : null}
        {counts.folders.map((entry) => (
          <Chip
            key={entry.folder.id}
            label={`${entry.folder.name} ${entry.count}`}
            selected={activeFolder === entry.folder.id}
            onPress={() => setFolder(entry.folder.id)}
          />
        ))}
        <Chip
          icon="folder-cog-outline"
          label={t('quotes.manageFolders')}
          onPress={() => navigationRef.isReady() && navigationRef.navigate('quoteFolders')}
        />
      </ScrollView>

      <View style={styles.toolbar}>
        {searching ? (
          <View style={styles.search}>
            <TextField
              autoFocus
              value={search}
              onChangeText={setSearch}
              placeholder={t('quotes.search')}
              accessibilityLabel={t('quotes.search')}
            />
          </View>
        ) : (
          <AppText variant="label" secondary style={styles.search}>
            {t('quotes.count', { count: shown.length })}
          </AppText>
        )}
        <IconButton
          icon={searching ? 'close' : 'magnify'}
          label={searching ? t('common.close') : t('quotes.search')}
          onPress={() => {
            setSearching(!searching);
            setSearch('');
          }}
        />
        <IconButton
          icon={sort === 'book' ? 'book-open-page-variant-outline' : 'clock-outline'}
          label={sort === 'book' ? t('quotes.sortByDate') : t('quotes.sortByBook')}
          onPress={() => setSort(sort === 'book' ? 'date' : 'book')}
        />
        <IconButton
          icon="export-variant"
          label={t('quotes.export')}
          onPress={() => exportShown('md')}
          onLongPress={() => exportShown('txt')}
        />
      </View>

      {shown.length === 0 ? (
        <AppText secondary center style={styles.empty}>
          {t('quotes.noMatch')}
        </AppText>
      ) : null}
      {shown.map((quote) => (
        <Pressable
          key={quote.id}
          accessibilityRole="button"
          accessibilityHint={t('quotes.openHint')}
          onPress={() => open(quote)}
          onLongPress={() => setActionsFor(quote)}
          android_ripple={{ color: colors.ripple }}
          style={[styles.card, { backgroundColor: colors.surfaceVariant }]}
        >
          <AppText>{quote.text}</AppText>
          <AppText variant="caption" secondary>
            {[
              showNovel ? quote.novelTitle : null,
              quoteLocation(quote, t),
              formatDate(quote.createdAt, dateFormat, i18n.language),
            ]
              .filter(Boolean)
              .join(' · ')}
          </AppText>
          {quote.note ? (
            <AppText variant="label" style={styles.noteText}>
              {quote.note}
            </AppText>
          ) : null}
          {quote.folders.length > 0 ? (
            <View style={styles.folders}>
              {quote.folders.map((item) => (
                <View key={item.id} style={[styles.pill, { borderColor: item.color }]}>
                  <View style={[styles.dot, { backgroundColor: item.color }]} />
                  <AppText variant="caption">{item.name}</AppText>
                </View>
              ))}
            </View>
          ) : null}
        </Pressable>
      ))}

      <BottomSheet visible={actionsFor !== null} onClose={() => setActionsFor(null)}>
        {actionsFor ? (
          <>
            <ListItem
              icon="pencil-outline"
              title={t('quotes.editAction')}
              onPress={() => {
                setEditing(actionsFor);
                setActionsFor(null);
              }}
            />
            <ListItem
              icon="content-copy"
              title={t('reader.copy')}
              onPress={() => {
                void Clipboard.setStringAsync(actionsFor.text);
                showToast(t('reader.copied'));
                setActionsFor(null);
              }}
            />
            <ListItem
              icon="share-variant-outline"
              title={t('reader.share')}
              onPress={() => {
                const quote = actionsFor;
                setActionsFor(null);
                void Share.share({
                  message: `« ${quote.text} »\n— ${quote.novelTitle}, ${quoteLocation(quote, t)}`,
                }).catch(() => undefined);
              }}
            />
            <ListItem
              icon="image-outline"
              title={t('quotes.shareImage')}
              onPress={() => {
                setImageOf(actionsFor);
                setActionsFor(null);
              }}
            />
            <ListItem
              icon="trash-can-outline"
              title={t('common.delete')}
              onPress={() => {
                deleteQuote(getDb(), actionsFor.id);
                invalidate('quotes');
                showToast(t('quotes.deleted'));
                setActionsFor(null);
              }}
            />
          </>
        ) : null}
      </BottomSheet>
      <QuoteImageSheet quote={imageOf} onClose={() => setImageOf(null)} />
      <QuoteEditorSheet
        visible={editing !== null}
        quote={editing}
        onClose={() => setEditing(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: SPACING.lg,
    paddingRight: SPACING.xs,
  },
  search: { flex: 1 },
  empty: { padding: SPACING.xl },
  card: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    gap: SPACING.xs,
  },
  noteText: { fontStyle: 'italic' },
  folders: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, paddingTop: 2 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
