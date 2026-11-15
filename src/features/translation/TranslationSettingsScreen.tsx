import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import {
  AppBar,
  AppText,
  Button,
  IconButton,
  ListItem,
  RadioItem,
  Screen,
  SectionHeader,
  Stepper,
  SwitchItem,
  TextField,
  showToast,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { SPACING } from '../../theme/typography';
import { setSetting, useSetting } from '../settings/settingsStore';
import type { DeepLUsage } from './deepl';
import { languageInfo, TRANSLATION_LANGUAGES } from './languages';
import {
  deleteModel,
  downloadModel,
  getDeeplKey,
  getDeeplUsage,
  listDownloadedModels,
  setDeeplKey,
  useTranslationState,
} from './translationService';

/** Shows the end of a key only, so that it cannot be read over the shoulder. */
const maskKey = (key: string) => `••••${key.slice(-6)}`;

/** Settings → Translation: engine, DeepL key and quota, offline models, reading options. */
export function TranslationSettingsScreen({ navigation }: RootScreenProps<'settingsTranslation'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const engine = useSetting('translationEngine');
  const ahead = useSetting('translateAhead');
  const bilingual = useSetting('bilingualReading');
  const hasKey = useTranslationState((state) => state.hasDeeplKey);

  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [usage, setUsage] = useState<DeepLUsage | 'loading' | 'failed' | null>(null);
  const [models, setModels] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refreshUsage = useCallback(() => {
    setUsage('loading');
    getDeeplUsage()
      .then((value) => setUsage(value))
      .catch(() => setUsage('failed'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getDeeplKey().then((key) => {
      if (cancelled) {
        return;
      }
      setSavedKey(key);
      if (key) {
        refreshUsage();
      }
    });
    void listDownloadedModels().then((list) => !cancelled && setModels(list));
    return () => {
      cancelled = true;
    };
  }, [refreshUsage]);

  const saveKey = () => {
    const cleaned = keyInput.trim();
    if (cleaned === '') {
      return;
    }
    void setDeeplKey(cleaned).then(() => {
      setSavedKey(cleaned);
      setKeyInput('');
      refreshUsage();
    });
  };

  const removeKey = () => {
    void setDeeplKey('').then(() => {
      setSavedKey(null);
      setUsage(null);
      if (engine === 'deepl') {
        setSetting('translationEngine', 'mlkit');
      }
    });
  };

  const changeModel = (code: string, present: boolean) => {
    setBusy(code);
    void (present ? deleteModel(code) : downloadModel(code))
      .then(() => listDownloadedModels())
      .then((list) => setModels(list))
      .catch(() => showToast(t('translation.modelFailed')))
      .finally(() => setBusy(null));
  };

  const modelCodes = [
    ...TRANSLATION_LANGUAGES,
    ...(models ?? []).filter(
      (code) => !(TRANSLATION_LANGUAGES as readonly string[]).includes(code),
    ),
  ];

  return (
    <Screen bottom>
      <AppBar title={t('settings.translation')} onBack={navigation.goBack} />
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <SectionHeader title={t('translation.engine')} />
        <RadioItem
          title={t('translation.engineMlkit')}
          subtitle={t('translation.engineMlkitHint')}
          checked={engine === 'mlkit' || !hasKey}
          onPress={() => setSetting('translationEngine', 'mlkit')}
        />
        <RadioItem
          title={t('translation.engineDeepl')}
          subtitle={hasKey ? t('translation.engineDeeplHint') : t('translation.engineDeeplNoKey')}
          disabled={!hasKey}
          checked={engine === 'deepl' && hasKey}
          onPress={() => setSetting('translationEngine', 'deepl')}
        />

        <SectionHeader title={t('translation.deeplKey')} />
        {savedKey ? (
          <>
            <ListItem
              icon="key-outline"
              title={maskKey(savedKey)}
              subtitle={
                usage === 'loading'
                  ? t('translation.usageLoading')
                  : usage === 'failed' || usage === null
                    ? t('translation.usageFailed')
                    : t('translation.usage', {
                        used: usage.used.toLocaleString(),
                        limit: usage.limit.toLocaleString(),
                      })
              }
              onPress={refreshUsage}
              right={
                <IconButton
                  icon="trash-can-outline"
                  label={t('translation.removeKey')}
                  onPress={removeKey}
                />
              }
            />
          </>
        ) : (
          <View style={styles.key}>
            <AppText variant="label" secondary>
              {t('translation.deeplKeyHint')}
            </AppText>
            <TextField
              value={keyInput}
              onChangeText={setKeyInput}
              placeholder={t('translation.deeplKeyPlaceholder')}
              accessibilityLabel={t('translation.deeplKey')}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              onSubmitEditing={saveKey}
            />
            <View style={styles.keyButton}>
              <Button
                compact
                label={t('common.save')}
                disabled={keyInput.trim() === ''}
                onPress={saveKey}
              />
            </View>
          </View>
        )}

        <SectionHeader title={t('translation.models')} />
        <AppText variant="label" secondary style={styles.hint}>
          {t('translation.modelsHint')}
        </AppText>
        {modelCodes.map((code) => {
          const info = languageInfo(code);
          const builtIn = code === 'en';
          const present = builtIn || (models ?? []).includes(code);
          return (
            <ListItem
              key={code}
              title={`${info?.flag ?? ''} ${info?.name ?? code}`.trim()}
              subtitle={
                busy === code
                  ? t('translation.modelWorking')
                  : builtIn
                    ? t('translation.modelBuiltIn')
                    : present
                      ? t('translation.modelPresent')
                      : t('translation.modelAbsent')
              }
              right={
                builtIn || models === null ? undefined : (
                  <IconButton
                    icon={present ? 'trash-can-outline' : 'download-outline'}
                    label={
                      present
                        ? t('translation.deleteModel', { language: info?.name ?? code })
                        : t('translation.downloadModelOf', { language: info?.name ?? code })
                    }
                    color={present ? undefined : colors.primary}
                    disabled={busy !== null}
                    onPress={() => changeModel(code, present)}
                  />
                )
              }
            />
          );
        })}

        <SectionHeader title={t('translation.reading')} />
        <Stepper
          label={t('translation.ahead')}
          value={ahead}
          min={0}
          max={10}
          step={1}
          onChange={(value) => setSetting('translateAhead', value)}
        />
        <SwitchItem
          title={t('translation.bilingual')}
          subtitle={t('translation.bilingualHint')}
          value={bilingual}
          onValueChange={(value) => setSetting('bilingualReading', value)}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: SPACING.xxl },
  hint: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xs },
  key: { paddingHorizontal: SPACING.lg, gap: SPACING.sm },
  keyButton: { alignItems: 'flex-start' },
});
