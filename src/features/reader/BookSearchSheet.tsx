import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { getDb } from '../../db/client';
import { deviceFiles } from '../../services/deviceFileStore';
import { AppText, BottomSheet, Skeleton, TextField } from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { SPACING } from '../../theme/typography';
import type { SearchHit } from './blocks';
import type { Anchor } from './readerHtml';
import { searchBook, type BookSearchResult } from './readerRepository';
import type { ReplacementRule } from './textReplacement';

const LIMIT = 200;

type Row =
  | { type: 'chapter'; key: string; title: string; count: number }
  | { type: 'hit'; key: string; chapterId: number; hit: SearchHit };

function toRows(results: BookSearchResult[]): Row[] {
  return results.flatMap((result) => [
    {
      type: 'chapter' as const,
      key: `c${result.chapter.id}`,
      title: result.chapter.title,
      count: result.hits.length,
    },
    ...result.hits.map((hit, index) => ({
      type: 'hit' as const,
      key: `h${result.chapter.id}-${index}`,
      chapterId: result.chapter.id,
      hit,
    })),
  ]);
}

interface Props {
  visible: boolean;
  onClose: () => void;
  novelId: number;
  initialQuery: string;
  rules: ReplacementRule[];
  onOpen: (chapterId: number, anchor: Anchor) => void;
}

/** Search in every downloaded chapter of the book, with the context of each result. */
export function BookSearchSheet(props: Props) {
  const { t } = useTranslation();
  return (
    <BottomSheet
      visible={props.visible}
      onClose={props.onClose}
      title={t('reader.searchBook')}
      scroll={false}
    >
      {props.visible ? <SearchContent key={props.initialQuery} {...props} /> : null}
    </BottomSheet>
  );
}

function SearchContent({ novelId, initialQuery, rules, onOpen }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [query, setQuery] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery.trim());
  const [found, setFound] = useState<{ query: string; rows: Row[]; total: number } | null>(null);
  const rows = found && found.query === submitted ? found.rows : null;
  const total = found?.total ?? 0;

  useEffect(() => {
    if (submitted === '') {
      return undefined;
    }
    // Reading the whole book takes a moment: let the placeholder appear first.
    const timer = setTimeout(() => {
      const results = searchBook(getDb(), deviceFiles, novelId, submitted, rules, LIMIT);
      setFound({
        query: submitted,
        rows: toRows(results),
        total: results.reduce((sum, result) => sum + result.hits.length, 0),
      });
    }, 30);
    return () => clearTimeout(timer);
  }, [submitted, novelId, rules]);

  return (
    <>
      <View style={styles.field}>
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder={t('reader.searchPlaceholder')}
          accessibilityLabel={t('reader.searchPlaceholder')}
          returnKeyType="search"
          autoFocus={initialQuery === ''}
          onSubmitEditing={() => setSubmitted(query.trim())}
        />
      </View>
      {submitted === '' ? null : rows === null ? (
        <View style={styles.loading}>
          <Skeleton height={18} />
          <Skeleton height={18} />
          <Skeleton height={18} />
        </View>
      ) : rows.length === 0 ? (
        <AppText secondary style={styles.message}>
          {t('reader.searchNoResult')}
        </AppText>
      ) : (
        <>
          <AppText variant="label" secondary style={styles.message}>
            {total >= LIMIT
              ? t('reader.searchResultsLimited', { count: LIMIT })
              : t('reader.searchResults', { count: total })}
          </AppText>
          <FlatList
            data={rows}
            keyExtractor={(row) => row.key}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            renderItem={({ item }) =>
              item.type === 'chapter' ? (
                <AppText
                  variant="label"
                  color={colors.primary}
                  style={styles.chapter}
                  numberOfLines={1}
                  accessibilityRole="header"
                >
                  {item.title}
                </AppText>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  android_ripple={{ color: colors.ripple }}
                  style={styles.hit}
                  onPress={() => onOpen(item.chapterId, item.hit.anchor)}
                >
                  <AppText numberOfLines={3}>
                    {item.hit.before.length === 40 ? '…' : ''}
                    {item.hit.before}
                    <AppText variant="bodyStrong" color={colors.primary}>
                      {item.hit.match}
                    </AppText>
                    {item.hit.after}
                    {item.hit.after.length === 60 ? '…' : ''}
                  </AppText>
                </Pressable>
              )
            }
          />
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  field: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  loading: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, gap: SPACING.md },
  message: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  list: { flexGrow: 0 },
  chapter: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.xs },
  hit: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
});
