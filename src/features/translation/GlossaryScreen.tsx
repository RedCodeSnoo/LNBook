import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import {
  AppBar,
  AppText,
  Button,
  CheckItem,
  Chip,
  Dialog,
  EmptyState,
  Fab,
  IconButton,
  ListItem,
  Screen,
  TextField,
  showToast,
} from '../../theme/components';
import { SPACING } from '../../theme/typography';
import { getNovel } from '../novel/novelRepository';
import { defaultTargetLang, languageInfo, targetLanguages } from './languages';
import {
  activeTranslationLang,
  deleteGlossaryTerm,
  listGlossary,
  listTranslatedChapters,
  saveGlossaryTerm,
  type GlossaryTerm,
} from './translationRepository';
import { queueTranslations } from './translationService';

interface Draft {
  id?: number;
  source: string;
  target: string;
  keep: boolean;
}

/** Glossary of a novel: how its names and terms are translated, or kept as they are. */
export function GlossaryScreen({ navigation, route }: RootScreenProps<'glossary'>) {
  const { novelId, term } = route.params;
  const { t, i18n } = useTranslation();
  const novel = useQuery(() => getNovel(getDb(), novelId), ['novel'], [novelId]);
  const source = novel?.originalLang ?? null;
  const targets = targetLanguages(source);
  const [chosen, setChosen] = useState<string | null>(null);
  const target =
    chosen ??
    (novel ? activeTranslationLang(novel) : null) ??
    defaultTargetLang(source, i18n.language);
  const terms = useQuery(
    () => (source && target ? listGlossary(getDb(), novelId, source, target) : []),
    ['glossary'],
    [novelId, source, target],
  );
  // A term selected in the reader is proposed right away.
  const [draft, setDraft] = useState<Draft | null>(() =>
    term ? { source: term.trim(), target: '', keep: false } : null,
  );

  const edit = (item: GlossaryTerm) =>
    setDraft({
      id: item.id,
      source: item.source,
      target: item.target === item.source ? '' : item.target,
      keep: item.target === item.source,
    });

  const save = () => {
    if (!draft || !source || !target) {
      return;
    }
    saveGlossaryTerm(getDb(), {
      id: draft.id,
      novelId,
      sourceLang: source,
      targetLang: target,
      source: draft.source,
      target: draft.keep ? '' : draft.target,
    });
    invalidate('glossary');
    setDraft(null);
  };

  const retranslate = () => {
    if (!target) {
      return;
    }
    const ids = [...listTranslatedChapters(getDb(), novelId, target).keys()];
    const added = queueTranslations(ids, target, true);
    showToast(
      added > 0 ? t('translation.queued', { count: added }) : t('translation.nothingToRetranslate'),
    );
  };

  const name = (code: string | null) => languageInfo(code)?.name ?? '?';

  return (
    <Screen bottom>
      <AppBar title={t('translation.glossary')} onBack={navigation.goBack} />
      {!novel || !source || !target ? (
        <EmptyState
          icon="translate"
          title={t('translation.glossaryNoLanguageTitle')}
          message={t('translation.glossaryNoLanguageMessage')}
        />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.list}>
            <View style={styles.head}>
              <AppText variant="label" secondary>
                {t('translation.glossaryHint', { source: name(source), target: name(target) })}
              </AppText>
              {targets.length > 1 ? (
                <View style={styles.chips}>
                  {targets.map((code) => (
                    <Chip
                      key={code}
                      label={`${languageInfo(code)?.flag ?? ''} ${name(code)}`.trim()}
                      selected={code === target}
                      onPress={() => setChosen(code)}
                    />
                  ))}
                </View>
              ) : null}
            </View>
            {terms.length === 0 ? (
              <EmptyState
                icon="book-alphabet"
                title={t('translation.glossaryEmptyTitle')}
                message={t('translation.glossaryEmptyMessage')}
              />
            ) : (
              <>
                {terms.map((item) => (
                  <ListItem
                    key={item.id}
                    title={item.source}
                    subtitle={
                      item.target === item.source ? t('translation.keepTerm') : `→ ${item.target}`
                    }
                    onPress={() => edit(item)}
                    right={
                      <IconButton
                        icon="trash-can-outline"
                        label={t('translation.deleteTerm', { term: item.source })}
                        onPress={() => {
                          deleteGlossaryTerm(getDb(), item.id);
                          invalidate('glossary');
                        }}
                      />
                    }
                  />
                ))}
                <View style={styles.retranslate}>
                  <AppText variant="label" secondary>
                    {t('translation.glossaryRetranslateHint')}
                  </AppText>
                  <Button
                    compact
                    variant="tonal"
                    icon="refresh"
                    label={t('translation.retranslateAll')}
                    onPress={retranslate}
                  />
                </View>
              </>
            )}
          </ScrollView>
          <Fab
            icon="plus"
            label={t('translation.addTerm')}
            onPress={() => setDraft({ source: '', target: '', keep: false })}
          />
        </>
      )}

      <Dialog
        visible={draft !== null}
        title={draft?.id === undefined ? t('translation.addTerm') : t('translation.editTerm')}
        onClose={() => setDraft(null)}
        actions={[
          { label: t('common.cancel'), onPress: () => setDraft(null) },
          {
            label: t('common.save'),
            disabled: !draft || draft.source.trim() === '' || (!draft.keep && !draft.target.trim()),
            onPress: save,
          },
        ]}
      >
        {draft ? (
          <View style={styles.form}>
            <TextField
              label={t('translation.termSource', { language: name(source) })}
              value={draft.source}
              onChangeText={(value) => setDraft({ ...draft, source: value })}
              autoCapitalize="none"
            />
            {draft.keep ? null : (
              <TextField
                label={t('translation.termTarget', { language: name(target) })}
                value={draft.target}
                onChangeText={(value) => setDraft({ ...draft, target: value })}
                autoCapitalize="none"
                autoFocus={draft.source !== ''}
              />
            )}
            <View style={styles.check}>
              <CheckItem
                title={t('translation.keepTerm')}
                checked={draft.keep}
                onPress={() => setDraft({ ...draft, keep: !draft.keep })}
              />
            </View>
          </View>
        ) : null}
      </Dialog>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 96 },
  head: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm, gap: SPACING.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  retranslate: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    gap: SPACING.sm,
    alignItems: 'flex-start',
  },
  form: { gap: SPACING.md },
  check: { marginHorizontal: -SPACING.lg },
});
