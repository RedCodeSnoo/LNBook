import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import type { Novel, TranslationEngine } from '../../db/schema';
import { deviceFiles } from '../../services/deviceFileStore';
import {
  AppText,
  BottomSheet,
  Chip,
  ConfirmDialog,
  ListItem,
  showToast,
} from '../../theme/components';
import { SPACING } from '../../theme/typography';
import { useSetting } from '../settings/settingsStore';
import { defaultTargetLang, languageInfo, targetLanguages } from './languages';
import {
  deleteNovelTranslation,
  listTranslatedChapters,
  listTranslationTasks,
  setNovelEngine,
  setReadingLang,
} from './translationRepository';
import {
  cancelAllTranslations,
  downloadModel,
  missingModels,
  pauseAllTranslations,
  queueNovelTranslation,
  queueTranslations,
  resumeAllTranslations,
  useTranslationState,
} from './translationService';

const ENGINES: (TranslationEngine | null)[] = [null, 'mlkit', 'deepl'];

/** "Translate" on the page of a novel: language, engine, on demand or the whole novel. */
export function TranslationSheet({
  novel,
  chapterCount,
  initialLang,
  visible,
  onClose,
  onOpenGlossary,
}: {
  novel: Novel;
  chapterCount: number;
  /** Language shown first (a flag that was pressed). */
  initialLang?: string | null;
  visible: boolean;
  onClose: () => void;
  onOpenGlossary: () => void;
}) {
  const { t, i18n } = useTranslation();
  const globalEngine = useSetting('translationEngine');
  const hasKey = useTranslationState((state) => state.hasDeeplKey);
  const targets = targetLanguages(novel.originalLang);
  const [chosen, setChosen] = useState<string | null>(null);
  const lang = chosen ?? initialLang ?? defaultTargetLang(novel.originalLang, i18n.language);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [missing, setMissing] = useState<{ key: string; codes: string[] } | null>(null);
  const [modelBusy, setModelBusy] = useState(false);

  const translated = useQuery(
    () => (lang ? listTranslatedChapters(getDb(), novel.id, lang).size : 0),
    ['chapters', 'chapterContent', 'downloads'],
    [novel.id, lang],
  );
  const waiting = useQuery(
    () =>
      listTranslationTasks(getDb()).filter(
        (task) => task.novelId === novel.id && task.lang === lang,
      ),
    ['downloads'],
    [novel.id, lang],
  );
  const paused = waiting.some((task) => task.status === 'paused');
  const engine = novel.translationEngine ?? null;
  const effective = (engine ?? globalEngine) === 'deepl' && hasKey ? 'deepl' : 'mlkit';

  // Models the on-device engine still needs for this pair of languages.
  const modelKey = `${novel.originalLang ?? ''}>${lang ?? ''}`;
  useEffect(() => {
    if (!visible || !novel.originalLang || !lang || effective !== 'mlkit') {
      return undefined;
    }
    let cancelled = false;
    void missingModels(novel.originalLang, lang).then((codes) => {
      if (!cancelled) {
        setMissing({ key: modelKey, codes });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [visible, novel.originalLang, lang, effective, modelKey]);
  const missingCodes =
    effective === 'mlkit' && missing && missing.key === modelKey ? missing.codes : [];

  const name = (code: string | null) => languageInfo(code)?.name ?? code ?? '';
  const changed = () => invalidate('novel', 'library', 'chapters', 'chapterContent', 'downloads');

  const fetchModels = () => {
    setModelBusy(true);
    void (async () => {
      for (const code of missingCodes) {
        await downloadModel(code);
      }
    })()
      .then(() => setMissing({ key: modelKey, codes: [] }))
      .catch(() => showToast(t('translation.modelFailed')))
      .finally(() => setModelBusy(false));
  };

  const read = (target: string | null) => {
    setReadingLang(getDb(), novel.id, target);
    changed();
    onClose();
  };

  return (
    <>
      <BottomSheet visible={visible} onClose={onClose} title={t('translation.translate')}>
        {targets.length === 0 || !lang ? (
          <AppText secondary style={styles.hint}>
            {t('translation.noTarget')}
          </AppText>
        ) : (
          <>
            <View style={styles.chips}>
              {targets.map((code) => (
                <Chip
                  key={code}
                  label={`${languageInfo(code)?.flag ?? ''} ${name(code)}`.trim()}
                  selected={code === lang}
                  onPress={() => setChosen(code)}
                />
              ))}
            </View>
            <AppText variant="label" secondary style={styles.hint}>
              {[
                novel.originalLang
                  ? t('translation.fromTo', {
                      source: name(novel.originalLang),
                      target: name(lang),
                    })
                  : t('translation.sourceDetected'),
                t('translation.progress', { done: translated, total: chapterCount }),
                waiting.length > 0
                  ? t(paused ? 'translation.waitingPaused' : 'translation.waiting', {
                      count: waiting.length,
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </AppText>

            {missingCodes.length > 0 ? (
              <ListItem
                icon="download-outline"
                title={t('translation.downloadModel')}
                subtitle={
                  modelBusy
                    ? t('translation.modelDownloading')
                    : t('translation.modelNeeded', { languages: missingCodes.map(name).join(', ') })
                }
                disabled={modelBusy}
                onPress={fetchModels}
              />
            ) : null}
            <ListItem
              icon="book-open-page-variant-outline"
              title={t('translation.readIn', { language: name(lang) })}
              subtitle={t('translation.readInHint')}
              onPress={() => read(lang)}
            />
            <ListItem
              icon="translate"
              title={t('translation.wholeNovel')}
              subtitle={t('translation.wholeNovelHint')}
              disabled={translated >= chapterCount && waiting.length === 0}
              onPress={() => {
                const added = queueNovelTranslation(novel.id, lang);
                showToast(
                  added > 0
                    ? t('translation.queued', { count: added })
                    : t('translation.nothingToTranslate'),
                );
                read(lang);
              }}
            />
            {waiting.length > 0 ? (
              <>
                <ListItem
                  icon={paused ? 'play' : 'pause'}
                  title={paused ? t('translation.resume') : t('translation.pause')}
                  onPress={paused ? resumeAllTranslations : pauseAllTranslations}
                />
                <ListItem
                  icon="close-circle-outline"
                  title={t('translation.cancel')}
                  onPress={() => cancelAllTranslations(novel.id, lang)}
                />
              </>
            ) : null}
            {translated > 0 ? (
              <>
                <ListItem
                  icon="refresh"
                  title={t('translation.retranslateAll')}
                  subtitle={t('translation.retranslateAllHint')}
                  onPress={() => {
                    const ids = [...listTranslatedChapters(getDb(), novel.id, lang).keys()];
                    showToast(
                      t('translation.queued', { count: queueTranslations(ids, lang, true) }),
                    );
                    onClose();
                  }}
                />
                <ListItem
                  icon="trash-can-outline"
                  title={t('translation.deleteTranslation', { language: name(lang) })}
                  onPress={() => setConfirmDelete(true)}
                />
              </>
            ) : null}
            <ListItem
              icon="book-alphabet"
              title={t('translation.glossary')}
              subtitle={t('translation.glossaryShort')}
              onPress={() => {
                onClose();
                onOpenGlossary();
              }}
            />

            <AppText variant="label" secondary style={styles.section}>
              {t('translation.engineForNovel')}
            </AppText>
            <View style={styles.chips}>
              {ENGINES.map((value) => (
                <Chip
                  key={value ?? 'default'}
                  label={
                    value === null
                      ? t('translation.engineDefault')
                      : value === 'mlkit'
                        ? t('translation.engineMlkitShort')
                        : 'DeepL'
                  }
                  selected={engine === value}
                  onPress={() => {
                    if (value === 'deepl' && !hasKey) {
                      showToast(t('translation.engineDeeplNoKey'));
                      return;
                    }
                    setNovelEngine(getDb(), novel.id, value);
                    invalidate('novel');
                  }}
                />
              ))}
            </View>
          </>
        )}
      </BottomSheet>
      <ConfirmDialog
        visible={confirmDelete}
        title={t('translation.deleteTranslation', { language: name(lang) })}
        message={t('translation.deleteTranslationMessage')}
        confirmLabel={t('common.delete')}
        danger
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          if (lang) {
            deleteNovelTranslation(getDb(), deviceFiles, novel.id, lang);
            changed();
          }
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  hint: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  section: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.xs },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
});
