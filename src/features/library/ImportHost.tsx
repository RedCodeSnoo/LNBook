import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { TextEncoding } from '../../epub/encoding';
import {
  AppText,
  Button,
  Dialog,
  SegmentedTabs,
  Skeleton,
  TextField,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import { closeImportSummary, redecodeTxt, useImportStore, type ImportStep } from './importFlow';

type TxtStep = Extract<ImportStep, { kind: 'txt' }>;

function TxtPreviewDialog({ step }: { step: TxtStep }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [title, setTitle] = useState(step.title);
  const [preview, setPreview] = useState(step.preview);
  const chapters = preview.chapters.filter((chapter) => chapter.text !== '');

  return (
    <Dialog
      visible
      title={t('import.txtTitle')}
      onClose={() => step.resolve(null)}
      actions={[
        { label: t('common.cancel'), onPress: () => step.resolve(null) },
        {
          label: t('import.importAction'),
          disabled: chapters.length === 0,
          onPress: () => step.resolve({ preview, title: title.trim() || step.title }),
        },
      ]}
    >
      <View style={styles.txt}>
        <TextField label={t('novel.fieldTitle')} value={title} onChangeText={setTitle} />
        <AppText variant="label" secondary>
          {t('import.encoding')}
        </AppText>
        <View style={styles.encoding}>
          <SegmentedTabs<TextEncoding>
            value={preview.encoding}
            onChange={(encoding) => setPreview(redecodeTxt(step.data, step.title, encoding))}
            options={[
              { value: 'utf-8', label: 'UTF-8' },
              { value: 'windows-1252', label: 'Windows-1252' },
            ]}
          />
        </View>
        <AppText variant="label" secondary>
          {t('import.chaptersFound', { count: chapters.length })}
        </AppText>
        {chapters.slice(0, 30).map((chapter, index) => (
          <View
            key={`${index}-${chapter.title}`}
            style={[styles.chapter, { backgroundColor: colors.surfaceVariant }]}
          >
            <AppText variant="bodyStrong" numberOfLines={1}>
              {/^\d+$/.test(chapter.title)
                ? t('novel.chapterNumber', { number: chapter.title })
                : chapter.title}
            </AppText>
            <AppText variant="caption" secondary numberOfLines={2}>
              {chapter.text.slice(0, 160)}
            </AppText>
          </View>
        ))}
        {chapters.length > 30 ? (
          <AppText variant="caption" secondary>
            {t('import.moreChapters', { count: chapters.length - 30 })}
          </AppText>
        ) : null}
      </View>
    </Dialog>
  );
}

/** Renders the dialogs of the import flow. Mounted once at the root of the app. */
export function ImportHost() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const step = useImportStore((state) => state.step);

  if (step.kind === 'idle') {
    return null;
  }

  if (step.kind === 'working') {
    return (
      <Dialog visible title={t('import.working')} onClose={() => undefined}>
        <View style={styles.working}>
          <AppText numberOfLines={2}>{step.name}</AppText>
          {step.total > 1 ? (
            <AppText variant="label" secondary>
              {t('import.progress', { current: step.index + 1, total: step.total })}
            </AppText>
          ) : null}
          <Skeleton height={6} radius={3} />
        </View>
      </Dialog>
    );
  }

  if (step.kind === 'txt') {
    return <TxtPreviewDialog key={step.name} step={step} />;
  }

  if (step.kind === 'duplicate') {
    return (
      <Dialog
        visible
        title={t('import.duplicateTitle')}
        message={t('import.duplicateMessage', { title: step.title })}
        onClose={() => step.resolve('skip')}
      >
        <View style={styles.choices}>
          <Button label={t('import.replace')} onPress={() => step.resolve('replace')} />
          <Button
            label={t('import.keepBoth')}
            variant="tonal"
            onPress={() => step.resolve('keepBoth')}
          />
          <Button label={t('import.skip')} variant="text" onPress={() => step.resolve('skip')} />
        </View>
      </Dialog>
    );
  }

  return (
    <Dialog
      visible
      title={t('import.summaryTitle')}
      onClose={closeImportSummary}
      actions={[{ label: t('common.ok'), onPress: closeImportSummary }]}
    >
      <View style={styles.working}>
        {step.imported.length > 0 ? (
          <AppText>{t('import.importedCount', { count: step.imported.length })}</AppText>
        ) : null}
        {step.failed.map((failure) => (
          <View
            key={failure.name}
            style={[styles.chapter, { backgroundColor: colors.surfaceVariant }]}
          >
            <AppText variant="bodyStrong" numberOfLines={2}>
              {failure.name}
            </AppText>
            <AppText variant="label" color={colors.error}>
              {failure.reason}
            </AppText>
          </View>
        ))}
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  txt: { gap: SPACING.sm },
  encoding: { marginHorizontal: -SPACING.lg },
  chapter: { padding: SPACING.md, borderRadius: RADIUS.md, gap: 2 },
  working: { gap: SPACING.md },
  choices: { gap: SPACING.sm, alignItems: 'stretch' },
});
