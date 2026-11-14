import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import type { TextReplacement } from '../../db/schema';
import { deviceFiles } from '../../services/deviceFileStore';
import {
  AppBar,
  AppText,
  Button,
  Dialog,
  EmptyState,
  Fab,
  ListItem,
  Screen,
  SectionHeader,
  SwitchItem,
  TextField,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import { getChapter } from '../novel/novelRepository';
import { extractBlockTexts } from './blocks';
import {
  deleteReplacementRule,
  listReplacementRules,
  readChapterHtml,
  saveReplacementRule,
} from './readerRepository';
import { applyRulesToText, compileRule, type ReplacementRule } from './textReplacement';

interface Draft extends ReplacementRule {
  id?: number;
  novelId: number | null;
  enabled: boolean;
}

const refresh = () => invalidate('replacements', 'chapterContent');

/** Text replacement rules: global ones and, inside a novel, the rules of that novel. */
export function ReplacementsScreen({ navigation, route }: RootScreenProps<'replacements'>) {
  const novelId = route.params.novelId ?? null;
  const chapterId = route.params.chapterId ?? null;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const rules = useQuery(() => listReplacementRules(getDb(), novelId), ['replacements'], [novelId]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sample, setSample] = useState('');

  // Text of the chapter being read, to try a rule before saving it.
  const chapterTexts = useMemo(() => {
    const chapter = chapterId === null ? null : getChapter(getDb(), chapterId);
    const html = chapter ? readChapterHtml(deviceFiles, chapter) : null;
    return html === null ? [] : extractBlockTexts(html);
  }, [chapterId]);

  const expression = draft ? compileRule(draft) : null;
  const preview = useMemo(() => {
    if (!draft || !expression) {
      return null;
    }
    let count = 0;
    let firstMatch: string | null = null;
    for (const text of chapterTexts) {
      const matches = text.match(expression);
      if (matches) {
        count += matches.length;
        firstMatch ??= text;
      }
    }
    const source = sample.trim() !== '' ? sample : (firstMatch ?? '');
    return { count, source, result: source === '' ? '' : applyRulesToText(source, [draft]) };
  }, [draft, expression, chapterTexts, sample]);

  const edit = (rule: TextReplacement) => {
    setSample('');
    setDraft({
      id: rule.id,
      novelId: rule.novelId,
      pattern: rule.pattern,
      replacement: rule.replacement,
      isRegex: rule.isRegex,
      enabled: rule.enabled,
    });
  };

  const create = () => {
    setSample('');
    setDraft({ novelId, pattern: '', replacement: '', isRegex: false, enabled: true });
  };

  const save = () => {
    if (draft && expression) {
      saveReplacementRule(getDb(), draft);
      refresh();
      setDraft(null);
    }
  };

  const groups = [
    { key: 'novel', title: t('reader.rulesNovel'), list: rules.filter((r) => r.novelId !== null) },
    {
      key: 'global',
      title: t('reader.rulesGlobal'),
      list: rules.filter((r) => r.novelId === null),
    },
  ].filter((group) => group.list.length > 0);

  return (
    <Screen bottom>
      <AppBar title={t('reader.replacements')} onBack={navigation.goBack} />
      {rules.length === 0 ? (
        <EmptyState
          icon="find-replace"
          title={t('reader.rulesEmptyTitle')}
          message={t('reader.rulesEmptyMessage')}
        >
          <Button label={t('reader.ruleAdd')} icon="plus" onPress={create} />
        </EmptyState>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {groups.map((group) => (
            <View key={group.key}>
              <SectionHeader title={group.title} />
              {group.list.map((rule) => (
                <ListItem
                  key={rule.id}
                  title={rule.pattern}
                  subtitle={
                    (rule.isRegex ? `${t('reader.ruleRegex')} · ` : '') +
                    (rule.replacement === ''
                      ? t('reader.ruleRemoves')
                      : t('reader.ruleReplacedBy', { text: rule.replacement }))
                  }
                  onPress={() => edit(rule)}
                  right={
                    <Switch
                      value={rule.enabled}
                      accessibilityLabel={t('reader.ruleEnabled')}
                      thumbColor={rule.enabled ? colors.primary : colors.textDisabled}
                      trackColor={{ false: colors.surfaceVariant, true: colors.primaryContainer }}
                      onValueChange={(enabled) => {
                        saveReplacementRule(getDb(), { ...rule, enabled });
                        refresh();
                      }}
                    />
                  }
                />
              ))}
            </View>
          ))}
        </ScrollView>
      )}
      {rules.length > 0 ? <Fab icon="plus" label={t('reader.ruleAdd')} onPress={create} /> : null}

      <Dialog
        visible={draft !== null}
        title={draft?.id === undefined ? t('reader.ruleAdd') : t('reader.ruleEdit')}
        onClose={() => setDraft(null)}
        actions={[
          ...(draft?.id !== undefined
            ? [
                {
                  label: t('common.delete'),
                  danger: true,
                  onPress: () => {
                    deleteReplacementRule(getDb(), draft.id as number);
                    refresh();
                    setDraft(null);
                  },
                },
              ]
            : []),
          { label: t('common.cancel'), onPress: () => setDraft(null) },
          { label: t('common.save'), disabled: !expression, onPress: save },
        ]}
      >
        {draft ? (
          <View style={styles.form}>
            <TextField
              label={t('reader.rulePattern')}
              value={draft.pattern}
              onChangeText={(pattern) => setDraft({ ...draft, pattern })}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextField
              label={t('reader.ruleReplacement')}
              value={draft.replacement}
              onChangeText={(replacement) => setDraft({ ...draft, replacement })}
              placeholder={t('reader.ruleReplacementHint')}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.switches}>
              <SwitchItem
                title={t('reader.ruleRegex')}
                value={draft.isRegex}
                onValueChange={(isRegex) => setDraft({ ...draft, isRegex })}
              />
              {novelId !== null ? (
                <SwitchItem
                  title={t('reader.ruleThisNovel')}
                  value={draft.novelId !== null}
                  onValueChange={(only) => setDraft({ ...draft, novelId: only ? novelId : null })}
                />
              ) : null}
            </View>
            {draft.pattern !== '' && !expression ? (
              <AppText variant="caption" color={colors.error}>
                {t('reader.ruleInvalid')}
              </AppText>
            ) : null}

            <AppText variant="label" secondary>
              {t('reader.rulePreview')}
            </AppText>
            <TextField
              value={sample}
              onChangeText={setSample}
              placeholder={t('reader.ruleSampleHint')}
              accessibilityLabel={t('reader.ruleSampleHint')}
              multiline
            />
            {preview ? (
              <>
                {chapterTexts.length > 0 ? (
                  <AppText variant="caption" secondary>
                    {t('reader.ruleMatches', { count: preview.count })}
                  </AppText>
                ) : null}
                {preview.source !== '' ? (
                  <View style={[styles.preview, { backgroundColor: colors.surfaceVariant }]}>
                    <AppText variant="caption" secondary numberOfLines={6}>
                      {preview.source}
                    </AppText>
                    <AppText numberOfLines={6}>
                      {preview.result === '' ? t('reader.rulePreviewEmpty') : preview.result}
                    </AppText>
                  </View>
                ) : null}
              </>
            ) : null}
          </View>
        ) : null}
      </Dialog>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 96 },
  form: { gap: SPACING.sm },
  switches: { marginHorizontal: -SPACING.lg },
  preview: { padding: SPACING.md, borderRadius: RADIUS.md, gap: SPACING.sm },
});
