import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { getDb } from '../../db/client';
import { invalidate } from '../../db/invalidation';
import type { Novel } from '../../db/schema';
import { deviceFiles } from '../../services/deviceFileStore';
import { formatDuration } from '../../services/format';
import {
  AppText,
  BottomSheet,
  Button,
  Chip,
  Icon,
  TextField,
  showToast,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import { normalizeText } from '../library/libraryView';
import {
  averageWordsPerChapter,
  clampSpeed,
  DEFAULT_SPEED_WPM,
  estimateProgress,
  formatWordCount,
} from '../stats/progressEstimate';
import {
  applyProgress,
  chaptersToEstimate,
  listProgressChapters,
  loadChaptersWithRealTime,
  loadChapterWords,
  readProgressInputs,
  type ProgressChapter,
} from '../stats/progressRepository';
import { readingSpeed } from '../stats/statistics';
import { loadSessions } from '../stats/statsRepository';
import { languageInfo, targetLanguages } from '../translation/languages';
import { formatChapterNumber } from './chapterNumber';

const MAX_RESULTS = 60;

const chapterLabel = (chapter: ProgressChapter) =>
  `${formatChapterNumber(chapter.number ?? chapter.position + 1)} · ${chapter.title}`;

/** Chapters matching a number or words of the title (number first). */
function searchChapters(list: ProgressChapter[], query: string): ProgressChapter[] {
  const needle = normalizeText(query.trim());
  if (needle === '') {
    return [];
  }
  const numeric = /^\d+([.,]\d+)?$/.test(needle) ? needle.replace(',', '.') : null;
  const byNumber: ProgressChapter[] = [];
  const byTitle: ProgressChapter[] = [];
  for (const chapter of list) {
    const number = formatChapterNumber(chapter.number ?? chapter.position + 1);
    if (numeric !== null && number === numeric) {
      byNumber.unshift(chapter);
    } else if (numeric !== null && number.startsWith(numeric)) {
      byNumber.push(chapter);
    } else if (normalizeText(chapter.title).includes(needle)) {
      byTitle.push(chapter);
    }
  }
  return [...byNumber, ...byTitle].slice(0, MAX_RESULTS);
}

/**
 * "Set my progress": chapters read elsewhere are marked as read, and their reading time
 * is estimated from their words and a reading speed.
 */
export function ProgressSheet({ novel, onClose }: { novel: Novel; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const db = getDb();

  // Read once when the sheet opens.
  const [chapters] = useState(() => listProgressChapters(db, novel.id));
  const [saved] = useState(() => readProgressInputs(db, novel.id));
  const [withRealTime] = useState(() => loadChaptersWithRealTime(db, novel.id));
  const [averageSpeed] = useState(() => readingSpeed(loadSessions(db)) ?? DEFAULT_SPEED_WPM);

  const initialChapter = (() => {
    const ids = new Set(chapters.map((chapter) => chapter.id));
    if (saved?.lastChapterId && ids.has(saved.lastChapterId)) {
      return saved.lastChapterId;
    }
    if (novel.lastReadChapterId && ids.has(novel.lastReadChapterId)) {
      return novel.lastReadChapterId;
    }
    const lastRead = [...chapters].reverse().find((chapter) => chapter.isRead);
    return (lastRead ?? chapters[0])?.id ?? null;
  })();
  const [chapterId, setChapterId] = useState<number | null>(initialChapter);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [speedText, setSpeedText] = useState(String(saved?.speedWpm ?? averageSpeed));
  const languages: (string | null)[] = [null, ...targetLanguages(novel.originalLang)];
  const [lang, setLang] = useState<string | null>(
    saved && languages.includes(saved.lang) ? saved.lang : null,
  );

  const words = useMemo(
    () => loadChapterWords(db, deviceFiles, novel.id, lang),
    [db, novel.id, lang],
  );
  const averageWords = useMemo(() => averageWordsPerChapter([...words.values()]), [words]);
  const [wordsText, setWordsText] = useState<string | null>(
    saved?.wordsPerChapter ? String(saved.wordsPerChapter) : null,
  );
  const wordsPerChapter = Number.parseInt(wordsText ?? '', 10) || averageWords;
  const speed = clampSpeed(Number.parseInt(speedText, 10) || DEFAULT_SPEED_WPM);

  const selected = chapters.find((chapter) => chapter.id === chapterId) ?? null;
  const estimate = useMemo(
    () =>
      estimateProgress(
        chapterId === null ? [] : chaptersToEstimate(chapters, chapterId, words, withRealTime),
        speed,
        wordsPerChapter,
      ),
    [chapters, chapterId, words, withRealTime, speed, wordsPerChapter],
  );
  const results = useMemo(() => searchChapters(chapters, query), [chapters, query]);

  const languageLabel = (code: string | null) => {
    const info = languageInfo(code ?? novel.originalLang);
    const name = info?.name ?? t('progress.original');
    return code === null
      ? t('progress.originalLanguage', { language: name })
      : `${info?.flag ?? ''} ${name}`.trim();
  };

  const confirm = () => {
    if (chapterId === null) {
      return;
    }
    applyProgress(db, {
      novelId: novel.id,
      lastChapterId: chapterId,
      entries: estimate.entries,
      inputs: {
        lastChapterId: chapterId,
        speedWpm: speed,
        wordsPerChapter:
          estimate.usingAverage > 0 ? wordsPerChapter : (saved?.wordsPerChapter ?? null),
        lang,
      },
    });
    invalidate('chapters', 'novel', 'library', 'stats');
    showToast(t('progress.saved', { count: estimate.chapters }));
    onClose();
  };

  return (
    <BottomSheet visible onClose={onClose} title={t('progress.title')}>
      <View style={styles.body}>
        <AppText variant="label" secondary>
          {t('progress.lastChapter')}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityHint={t('progress.changeChapter')}
          testID="progress-chapter"
          onPress={() => setPicking(!picking)}
          android_ripple={{ color: colors.ripple }}
          style={[styles.picker, { backgroundColor: colors.surfaceVariant }]}
        >
          <AppText style={styles.flex} numberOfLines={2}>
            {selected ? chapterLabel(selected) : t('progress.noChapter')}
          </AppText>
          <Icon name={picking ? 'chevron-up' : 'magnify'} size={20} color={colors.textSecondary} />
        </Pressable>
        {picking ? (
          <View style={styles.search}>
            <TextField
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder={t('reader.chapterSearch')}
              accessibilityLabel={t('reader.chapterSearch')}
            />
            {results.map((chapter) => (
              <Pressable
                key={chapter.id}
                accessibilityRole="button"
                onPress={() => {
                  setChapterId(chapter.id);
                  setPicking(false);
                  setQuery('');
                }}
                android_ripple={{ color: colors.ripple }}
                style={styles.result}
              >
                <AppText numberOfLines={1}>{chapterLabel(chapter)}</AppText>
              </Pressable>
            ))}
            {query.trim() !== '' && results.length === 0 ? (
              <AppText variant="label" secondary>
                {t('progress.noMatch')}
              </AppText>
            ) : null}
          </View>
        ) : null}
        <AppText variant="caption" secondary>
          {t('progress.chapterHint')}
        </AppText>

        <TextField
          label={t('progress.speed')}
          value={speedText}
          onChangeText={(text) => setSpeedText(text.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          maxLength={4}
        />
        <AppText variant="caption" secondary>
          {t('progress.speedHint', { count: averageSpeed })}
        </AppText>

        {estimate.usingAverage > 0 ? (
          <>
            <TextField
              label={t('progress.wordsPerChapter')}
              value={wordsText ?? String(averageWords)}
              onChangeText={(text) => setWordsText(text.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              maxLength={6}
            />
            <AppText variant="caption" secondary>
              {t('progress.usedFor', { count: estimate.usingAverage, total: estimate.chapters })}
            </AppText>
          </>
        ) : null}

        <AppText variant="label" secondary>
          {t('progress.language')}
        </AppText>
        <View style={styles.chips}>
          {languages.map((code) => (
            <Chip
              key={code ?? 'original'}
              label={languageLabel(code)}
              selected={lang === code}
              onPress={() => setLang(code)}
            />
          ))}
        </View>

        <View
          accessibilityLiveRegion="polite"
          style={[styles.preview, { backgroundColor: colors.primaryContainer }]}
        >
          <AppText variant="bodyStrong" color={colors.onPrimaryContainer}>
            {t('progress.preview', {
              count: estimate.chapters,
              words: formatWordCount(estimate.words, i18n.language),
              time: formatDuration(estimate.estimatedMs, t),
            })}
          </AppText>
          {estimate.keptReal > 0 ? (
            <AppText variant="caption" color={colors.onPrimaryContainer}>
              {t('progress.keptReal', { count: estimate.keptReal })}
            </AppText>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Button label={t('common.cancel')} variant="text" onPress={onClose} />
          <Button
            label={t('progress.confirm')}
            icon="check"
            disabled={chapterId === null || speedText === ''}
            onPress={confirm}
          />
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: SPACING.lg, gap: SPACING.sm },
  flex: { flex: 1 },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    minHeight: 48,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
  },
  search: { gap: 2 },
  result: { minHeight: 40, justifyContent: 'center', paddingHorizontal: SPACING.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  preview: { padding: SPACING.md, borderRadius: RADIUS.md, gap: 2, marginTop: SPACING.xs },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.sm },
});
