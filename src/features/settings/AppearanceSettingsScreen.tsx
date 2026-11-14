import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import {
  AppBar,
  AppText,
  Button,
  Icon,
  RadioItem,
  Screen,
  SectionHeader,
  SwitchItem,
} from '../../theme/components';
import {
  ACCENT_NAMES,
  ACCENTS,
  supportsDynamicColors,
  type AccentName,
  type AppThemeSetting,
} from '../../theme/palette';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import { setSetting, useSetting } from './settingsStore';

const THEMES: { value: AppThemeSetting; labelKey: string }[] = [
  { value: 'system', labelKey: 'settings.themeSystem' },
  { value: 'light', labelKey: 'settings.themeLight' },
  { value: 'dark', labelKey: 'settings.themeDark' },
  { value: 'amoled', labelKey: 'settings.themeAmoled' },
];

const SCALES: { value: number; labelKey: string }[] = [
  { value: 0.9, labelKey: 'settings.uiScaleSmall' },
  { value: 1, labelKey: 'settings.uiScaleNormal' },
  { value: 1.15, labelKey: 'settings.uiScaleLarge' },
  { value: 1.3, labelKey: 'settings.uiScaleExtraLarge' },
];

export function AppearanceSettingsScreen({ navigation }: RootScreenProps<'settingsAppearance'>) {
  const { t } = useTranslation();
  const theme = useTheme();
  const appTheme = useSetting('appTheme');
  const accent = useSetting('accent');
  const uiScale = useSetting('uiScale');
  const lastAccent: AccentName = accent === 'dynamic' ? 'indigo' : accent;

  return (
    <Screen bottom>
      <AppBar title={t('settings.appearance')} onBack={navigation.goBack} />
      <ScrollView>
        <View
          style={[
            styles.preview,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}
        >
          <AppText variant="label" secondary>
            {t('settings.preview')}
          </AppText>
          <AppText variant="title">LNBook</AppText>
          <AppText secondary>{t('settings.previewText')}</AppText>
          <View style={styles.previewActions}>
            <Button label={t('common.ok')} compact />
            <Button label={t('common.cancel')} variant="tonal" compact />
          </View>
        </View>

        <SectionHeader title={t('settings.theme')} />
        {THEMES.map((option) => (
          <RadioItem
            key={option.value}
            title={t(option.labelKey)}
            checked={appTheme === option.value}
            onPress={() => setSetting('appTheme', option.value)}
          />
        ))}

        <SectionHeader title={t('settings.accent')} />
        <View style={styles.swatches}>
          {ACCENT_NAMES.map((name) => {
            const color = theme.dark ? ACCENTS[name].dark : ACCENTS[name].light;
            const selected = accent === name;
            return (
              <Pressable
                key={name}
                accessibilityRole="radio"
                accessibilityLabel={t(`settings.accentNames.${name}`)}
                accessibilityState={{ selected }}
                onPress={() => setSetting('accent', name)}
                style={[
                  styles.swatch,
                  { backgroundColor: color },
                  selected && { borderColor: theme.colors.text },
                ]}
              >
                {selected ? (
                  <Icon name="check" size={22} color={theme.dark ? '#14151A' : '#FFFFFF'} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
        {supportsDynamicColors ? (
          <SwitchItem
            icon="wallpaper"
            title={t('settings.accentDynamic')}
            subtitle={t('settings.accentDynamicHint')}
            value={accent === 'dynamic'}
            onValueChange={(value) => setSetting('accent', value ? 'dynamic' : lastAccent)}
          />
        ) : null}

        <SectionHeader title={t('settings.uiScale')} />
        {SCALES.map((option) => (
          <RadioItem
            key={option.value}
            title={t(option.labelKey)}
            checked={Math.abs(uiScale - option.value) < 0.01}
            onPress={() => setSetting('uiScale', option.value)}
          />
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: {
    margin: SPACING.lg,
    padding: SPACING.lg,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: SPACING.xs,
  },
  previewActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  swatch: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
  },
});
