import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { TtsEngineInfo, TtsVoice } from '../../../modules/lnbook-system';
import type { RootScreenProps } from '../../app/navigation';
import {
  AppBar,
  AppText,
  BottomSheet,
  IconButton,
  ListItem,
  RadioItem,
  Screen,
  SectionHeader,
  Stepper,
  SwitchItem,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { SPACING } from '../../theme/typography';
import { setSetting, useSetting } from '../settings/settingsStore';
import { languageInfo } from '../translation/languages';
import {
  listEngines,
  loadVoices,
  openSystemVoiceSettings,
  openVoiceInstaller,
  speakSample,
} from './ttsService';
import { voiceLabel, voiceLanguages, voicesForLanguage } from './voices';

/** Languages listed first: the ones the app translates. */
const FIRST = ['fr', 'en'];

/** Settings → Voice: engine, one voice per language, speed, tone, pauses. */
export function VoiceSettingsScreen({ navigation }: RootScreenProps<'settingsVoice'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const engine = useSetting('ttsEngine');
  const chosen = useSetting('ttsVoices');
  const rate = useSetting('ttsRate');
  const pitch = useSetting('ttsPitch');
  const pauseMs = useSetting('ttsPauseMs');
  const autoNext = useSetting('ttsAutoNext');
  const [engines, setEngines] = useState<TtsEngineInfo[]>([]);
  const [voices, setVoices] = useState<TtsVoice[] | null>(null);
  const [language, setLanguage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listEngines()
      .then((list) => !cancelled && setEngines(list))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadVoices(true).then((list) => !cancelled && setVoices(list));
    return () => {
      cancelled = true;
    };
  }, [engine]);

  const languages = useMemo(() => {
    const available = voiceLanguages(voices ?? []);
    return [
      ...FIRST.filter((code) => available.includes(code)),
      ...available.filter((code) => !FIRST.includes(code)),
    ];
  }, [voices]);
  const languageVoices = language ? voicesForLanguage(voices ?? [], language) : [];
  const sample = (code: string) => t('tts.sample', { lng: code === 'fr' ? 'fr' : 'en' });

  return (
    <Screen bottom>
      <AppBar title={t('settings.voice')} onBack={navigation.goBack} />
      <ScrollView contentContainerStyle={styles.list}>
        {engines.length > 1 ? (
          <>
            <SectionHeader title={t('tts.engine')} />
            <RadioItem
              title={t('tts.engineDefault')}
              checked={engine === ''}
              onPress={() => setSetting('ttsEngine', '')}
            />
            {engines.map((item) => (
              <RadioItem
                key={item.name}
                title={item.label}
                subtitle={item.name}
                checked={engine === item.name}
                onPress={() => setSetting('ttsEngine', item.name)}
              />
            ))}
          </>
        ) : null}

        <SectionHeader title={t('tts.reading')} />
        <View style={styles.steppers}>
          <Stepper
            label={t('tts.rate')}
            value={rate}
            min={0.5}
            max={3}
            step={0.1}
            format={(value) => `${value.toFixed(1)}×`}
            onChange={(value) => setSetting('ttsRate', value)}
          />
          <Stepper
            label={t('tts.pitch')}
            value={pitch}
            min={0.5}
            max={2}
            step={0.1}
            format={(value) => value.toFixed(1)}
            onChange={(value) => setSetting('ttsPitch', value)}
          />
          <Stepper
            label={t('tts.paragraphPause')}
            value={pauseMs}
            min={0}
            max={2000}
            step={50}
            format={(value) => `${(value / 1000).toFixed(2)} s`}
            onChange={(value) => setSetting('ttsPauseMs', value)}
          />
        </View>
        <SwitchItem
          icon="skip-next-outline"
          title={t('tts.autoNext')}
          subtitle={t('tts.autoNextHint')}
          value={autoNext}
          onValueChange={(value) => setSetting('ttsAutoNext', value)}
        />
        <SectionHeader title={t('tts.voices')} />
        {voices === null ? (
          <AppText secondary style={styles.hint}>
            {t('tts.loadingVoices')}
          </AppText>
        ) : languages.length === 0 ? (
          <AppText secondary style={styles.hint}>
            {t('tts.noVoice')}
          </AppText>
        ) : (
          languages.map((code) => {
            const info = languageInfo(code);
            const current = (voices ?? []).find((voice) => voice.id === chosen[code]);
            return (
              <ListItem
                key={code}
                title={`${info?.flag ?? ''} ${info?.name ?? code}`.trim()}
                subtitle={current ? voiceLabel(current) : t('tts.voiceDefault')}
                onPress={() => setLanguage(code)}
                right={
                  <IconButton
                    icon="volume-high"
                    label={t('tts.listen')}
                    onPress={() => speakSample(sample(code), chosen[code] ?? null, code)}
                  />
                }
              />
            );
          })
        )}
        <ListItem
          icon="download-outline"
          title={t('tts.installVoices')}
          subtitle={t('tts.installVoicesHint')}
          onPress={() => {
            openVoiceInstaller();
          }}
        />
        <ListItem
          icon="cog-outline"
          title={t('tts.systemSettings')}
          onPress={() => {
            openSystemVoiceSettings();
          }}
        />
      </ScrollView>

      <BottomSheet
        visible={language !== null}
        title={language ? (languageInfo(language)?.name ?? language) : ''}
        onClose={() => setLanguage(null)}
      >
        {language ? (
          <>
            <RadioItem
              title={t('tts.voiceDefault')}
              checked={!chosen[language]}
              onPress={() => {
                const next = { ...chosen };
                delete next[language];
                setSetting('ttsVoices', next);
              }}
            />
            {languageVoices.map((voice) => (
              <View key={voice.id} style={styles.voiceRow}>
                <View style={styles.flex}>
                  <RadioItem
                    title={voiceLabel(voice)}
                    subtitle={[
                      voice.network ? t('tts.voiceOnline') : t('tts.voiceOffline'),
                      voice.installed ? null : t('tts.voiceNotInstalled'),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    checked={chosen[language] === voice.id}
                    onPress={() => setSetting('ttsVoices', { ...chosen, [language]: voice.id })}
                  />
                </View>
                <IconButton
                  icon="volume-high"
                  label={t('tts.listen')}
                  color={colors.primary}
                  onPress={() => speakSample(sample(language), voice.id, language)}
                />
              </View>
            ))}
          </>
        ) : null}
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: SPACING.xl },
  hint: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  steppers: { paddingHorizontal: SPACING.lg },
  voiceRow: { flexDirection: 'row', alignItems: 'center', paddingRight: SPACING.sm },
  flex: { flex: 1 },
});
