import Slider from '@react-native-community/slider';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { deviceFiles } from '../../services/deviceFileStore';
import {
  AppText,
  BottomSheet,
  Button,
  Chip,
  Dialog,
  SectionHeader,
  SegmentedTabs,
  Stepper,
  SwitchItem,
  TextField,
  showToast,
} from '../../theme/components';
import { contrastRatio, parseHexColor } from '../../theme/contrast';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import {
  READER_FONTS,
  READER_LIMITS,
  READER_THEMES,
  type PageAnimation,
  type ReaderMode,
  type ReaderOrientation,
  type ReaderSettings,
  type ReaderTheme,
  type TapZones,
  type TextAlign,
} from './readerSettings';

type Section = 'text' | 'page' | 'screen';

function isHexColor(value: string): boolean {
  try {
    parseHexColor(value);
    return /^#/.test(value);
  } catch {
    return false;
  }
}

export interface ReaderSettingsFormProps {
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
  /** Novel specific settings switch (only inside the reader). */
  perNovel?: boolean;
  onPerNovelChange?: (enabled: boolean) => void;
  /** Automatic scrolling control (only inside the reader). */
  autoScrolling?: boolean;
  onToggleAutoScroll?: () => void;
}

/** Quick panel of the reader. */
export function ReaderSettingsSheet({
  visible,
  onClose,
  ...form
}: ReaderSettingsFormProps & { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { onToggleAutoScroll } = form;
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('reader.settings')}>
      <ReaderSettingsForm
        {...form}
        onToggleAutoScroll={
          onToggleAutoScroll
            ? () => {
                onToggleAutoScroll();
                onClose();
              }
            : undefined
        }
      />
    </BottomSheet>
  );
}

/** Every display setting of the reader; also used by Settings → Reader for the defaults. */
export function ReaderSettingsForm({
  settings,
  perNovel,
  onChange,
  onPerNovelChange,
  autoScrolling,
  onToggleAutoScroll,
}: ReaderSettingsFormProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [section, setSection] = useState<Section>('text');
  const [themeDialog, setThemeDialog] = useState(false);
  const [themeName, setThemeName] = useState('');
  const [themeBackground, setThemeBackground] = useState('#FFFFFF');
  const [themeText, setThemeText] = useState('#000000');

  const themes: ReaderTheme[] = [...READER_THEMES, ...settings.customThemes];
  const themeValid =
    isHexColor(themeBackground) &&
    isHexColor(themeText) &&
    contrastRatio(themeText, themeBackground) >= 3;

  const importFont = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['font/ttf', 'font/otf', 'application/x-font-ttf', 'application/octet-stream', '*/*'],
      copyToCacheDirectory: true,
    });
    if (result.canceled) {
      return;
    }
    const asset = result.assets[0];
    if (!/\.(ttf|otf)$/i.test(asset.name)) {
      showToast(t('reader.fontInvalid'));
      return;
    }
    try {
      const id = `font${Date.now()}`;
      const extension = asset.name.toLowerCase().endsWith('.otf') ? 'otf' : 'ttf';
      const path = `fonts/${id}.${extension}`;
      deviceFiles.writeBytes(path, await new File(asset.uri).bytes());
      const name = asset.name.replace(/\.(ttf|otf)$/i, '');
      onChange({ customFonts: [...settings.customFonts, { id, name, path }], fontId: id });
    } catch {
      showToast(t('reader.fontInvalid'));
    }
  };

  const removeFont = (id: string) => {
    const font = settings.customFonts.find((candidate) => candidate.id === id);
    if (font) {
      deviceFiles.delete(font.path);
    }
    onChange({
      customFonts: settings.customFonts.filter((candidate) => candidate.id !== id),
      ...(settings.fontId === id ? { fontId: 'literata' } : {}),
    });
  };

  return (
    <>
      <SegmentedTabs<Section>
        value={section}
        onChange={setSection}
        options={[
          { value: 'text', label: t('reader.sectionText') },
          { value: 'page', label: t('reader.sectionPage') },
          { value: 'screen', label: t('reader.sectionScreen') },
        ]}
      />

      {section === 'text' ? (
        <>
          <SectionHeader title={t('reader.theme')} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.themes}
          >
            {themes.map((theme) => {
              const selected = settings.themeId === theme.id;
              const name = theme.custom ? theme.name : t(`reader.themes.${theme.name}`);
              return (
                <Pressable
                  key={theme.id}
                  accessibilityRole="radio"
                  accessibilityLabel={name}
                  accessibilityState={{ selected }}
                  onPress={() => onChange({ themeId: theme.id })}
                  onLongPress={
                    theme.custom
                      ? () =>
                          onChange({
                            customThemes: settings.customThemes.filter(
                              (item) => item.id !== theme.id,
                            ),
                            ...(selected ? { themeId: 'paper' } : {}),
                          })
                      : undefined
                  }
                  style={[
                    styles.theme,
                    {
                      backgroundColor: theme.background,
                      borderColor: selected ? colors.primary : colors.border,
                      borderWidth: selected ? 3 : 1,
                    },
                  ]}
                >
                  <AppText variant="bodyStrong" color={theme.text}>
                    Aa
                  </AppText>
                  <AppText variant="caption" color={theme.text} numberOfLines={1}>
                    {name}
                  </AppText>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('reader.addTheme')}
              onPress={() => setThemeDialog(true)}
              style={[
                styles.theme,
                { borderColor: colors.border, borderWidth: 1, borderStyle: 'dashed' },
              ]}
            >
              <AppText variant="title" secondary>
                +
              </AppText>
            </Pressable>
          </ScrollView>
          {settings.customThemes.length > 0 ? (
            <AppText variant="caption" secondary style={styles.hint}>
              {t('reader.customThemeHint')}
            </AppText>
          ) : null}

          <SectionHeader title={t('reader.font')} />
          <View style={styles.chips}>
            {READER_FONTS.map((font) => (
              <Chip
                key={font.id}
                label={font.id === 'system' ? t('reader.systemFont') : font.name}
                selected={settings.fontId === font.id}
                onPress={() => onChange({ fontId: font.id })}
              />
            ))}
            {settings.customFonts.map((font) => (
              <Chip
                key={font.id}
                label={font.name}
                selected={settings.fontId === font.id}
                onPress={() => onChange({ fontId: font.id })}
                onLongPress={() => removeFont(font.id)}
              />
            ))}
            <Chip icon="plus" label={t('reader.importFont')} onPress={() => void importFont()} />
          </View>

          <Stepper
            label={t('reader.fontSize')}
            value={settings.fontSize}
            {...READER_LIMITS.fontSize}
            onChange={(fontSize) => onChange({ fontSize })}
          />
          <Stepper
            label={t('reader.lineHeight')}
            value={settings.lineHeight}
            {...READER_LIMITS.lineHeight}
            format={(value) => value.toFixed(1)}
            onChange={(lineHeight) => onChange({ lineHeight })}
          />
          <Stepper
            label={t('reader.paragraphSpacing')}
            value={settings.paragraphSpacing}
            {...READER_LIMITS.paragraphSpacing}
            format={(value) => value.toFixed(1)}
            onChange={(paragraphSpacing) => onChange({ paragraphSpacing })}
          />
          <Stepper
            label={t('reader.textIndent')}
            value={settings.textIndent}
            {...READER_LIMITS.textIndent}
            format={(value) => value.toFixed(1)}
            onChange={(textIndent) => onChange({ textIndent })}
          />
          <SectionHeader title={t('reader.alignment')} />
          <SegmentedTabs<TextAlign>
            value={settings.textAlign}
            onChange={(textAlign) => onChange({ textAlign })}
            options={[
              { value: 'left', label: t('reader.alignLeft') },
              { value: 'justify', label: t('reader.alignJustify') },
              { value: 'center', label: t('reader.alignCenter') },
            ]}
          />
          <SwitchItem
            title={t('reader.semiBold')}
            value={settings.semiBold}
            onValueChange={(semiBold) => onChange({ semiBold })}
          />
          <Stepper
            label={t('reader.marginHorizontal')}
            value={settings.marginHorizontal}
            {...READER_LIMITS.marginHorizontal}
            onChange={(marginHorizontal) => onChange({ marginHorizontal })}
          />
          <Stepper
            label={t('reader.marginVertical')}
            value={settings.marginVertical}
            {...READER_LIMITS.marginVertical}
            onChange={(marginVertical) => onChange({ marginVertical })}
          />
        </>
      ) : null}

      {section === 'page' ? (
        <>
          <SectionHeader title={t('reader.mode')} />
          <SegmentedTabs<ReaderMode>
            value={settings.mode}
            onChange={(mode) => onChange({ mode })}
            options={[
              { value: 'scroll', label: t('reader.modeScroll') },
              { value: 'paged', label: t('reader.modePaged') },
            ]}
          />
          {settings.mode === 'paged' ? (
            <>
              <SectionHeader title={t('reader.pageAnimation')} />
              <SegmentedTabs<PageAnimation>
                value={settings.pageAnimation}
                onChange={(pageAnimation) => onChange({ pageAnimation })}
                options={[
                  { value: 'slide', label: t('reader.animationSlide') },
                  { value: 'none', label: t('reader.animationNone') },
                ]}
              />
              <SectionHeader title={t('reader.tapZones')} />
              <SegmentedTabs<TapZones>
                value={settings.tapZones}
                onChange={(tapZones) => onChange({ tapZones })}
                options={[
                  { value: 'leftPrevious', label: t('reader.tapLeftPrevious') },
                  { value: 'leftNext', label: t('reader.tapLeftNext') },
                  { value: 'off', label: t('reader.tapOff') },
                ]}
              />
            </>
          ) : (
            <>
              <Stepper
                label={t('reader.autoScrollSpeed')}
                value={settings.autoScrollSpeed}
                {...READER_LIMITS.autoScrollSpeed}
                onChange={(autoScrollSpeed) => onChange({ autoScrollSpeed })}
              />
              {onToggleAutoScroll ? (
                <View style={styles.button}>
                  <Button
                    label={autoScrolling ? t('reader.autoScrollStop') : t('reader.autoScrollStart')}
                    icon={autoScrolling ? 'pause' : 'play'}
                    variant="tonal"
                    onPress={onToggleAutoScroll}
                  />
                </View>
              ) : null}
            </>
          )}
          <SwitchItem
            title={t('reader.volumeKeys')}
            subtitle={t('reader.volumeKeysHint')}
            value={settings.volumeKeys}
            onValueChange={(volumeKeys) => onChange({ volumeKeys })}
          />
          <SwitchItem
            title={t('reader.showQuotes')}
            value={settings.showQuotes}
            onValueChange={(showQuotes) => onChange({ showQuotes })}
          />
        </>
      ) : null}

      {section === 'screen' ? (
        <>
          <SwitchItem
            title={t('reader.systemBrightness')}
            value={settings.brightness === null}
            onValueChange={(system) => onChange({ brightness: system ? null : 0.5 })}
          />
          {settings.brightness !== null ? (
            <View style={styles.slider}>
              <AppText variant="label" secondary>
                {t('reader.brightness')}
              </AppText>
              <Slider
                accessibilityLabel={t('reader.brightness')}
                minimumValue={0.01}
                maximumValue={1}
                value={settings.brightness}
                onSlidingComplete={(brightness) => onChange({ brightness })}
                minimumTrackTintColor={colors.primary as string}
                thumbTintColor={colors.primary as string}
              />
            </View>
          ) : null}
          <View style={styles.slider}>
            <AppText variant="label" secondary>
              {t('reader.warmth')}
            </AppText>
            <Slider
              accessibilityLabel={t('reader.warmth')}
              minimumValue={READER_LIMITS.warmth.min}
              maximumValue={READER_LIMITS.warmth.max}
              value={settings.warmth}
              onSlidingComplete={(warmth) => onChange({ warmth: Math.round(warmth * 100) / 100 })}
              minimumTrackTintColor={colors.primary as string}
              thumbTintColor={colors.primary as string}
            />
          </View>
          <SwitchItem
            title={t('reader.keepScreenOn')}
            value={settings.keepScreenOn}
            onValueChange={(keepScreenOn) => onChange({ keepScreenOn })}
          />
          <SwitchItem
            title={t('reader.hideStatusBar')}
            value={settings.hideStatusBar}
            onValueChange={(hideStatusBar) => onChange({ hideStatusBar })}
          />
          <SectionHeader title={t('reader.orientation')} />
          <SegmentedTabs<ReaderOrientation>
            value={settings.orientation}
            onChange={(orientation) => onChange({ orientation })}
            options={[
              { value: 'auto', label: t('reader.orientationAuto') },
              { value: 'portrait', label: t('reader.orientationPortrait') },
              { value: 'landscape', label: t('reader.orientationLandscape') },
            ]}
          />
          <SectionHeader title={t('reader.footer')} />
          <AppText variant="caption" secondary style={styles.footerHint}>
            {t('reader.footerHint')}
          </AppText>
          <SwitchItem
            title={t('reader.showClock')}
            value={settings.showClock}
            onValueChange={(showClock) => onChange({ showClock })}
          />
          <SwitchItem
            title={t('reader.showBattery')}
            value={settings.showBattery}
            onValueChange={(showBattery) => onChange({ showBattery })}
          />
          <Stepper
            label={t('reader.readThreshold')}
            value={Math.round(settings.readThreshold * 100)}
            min={50}
            max={100}
            step={5}
            format={(value) => `${value} %`}
            onChange={(value) => onChange({ readThreshold: value / 100 })}
          />
        </>
      ) : null}

      {onPerNovelChange ? (
        <SwitchItem
          icon="book-cog-outline"
          title={t('reader.perNovel')}
          subtitle={t('reader.perNovelHint')}
          value={Boolean(perNovel)}
          onValueChange={onPerNovelChange}
        />
      ) : null}

      <Dialog
        visible={themeDialog}
        title={t('reader.addTheme')}
        onClose={() => setThemeDialog(false)}
        actions={[
          { label: t('common.cancel'), onPress: () => setThemeDialog(false) },
          {
            label: t('common.save'),
            disabled: !themeValid,
            onPress: () => {
              const id = `custom${Date.now()}`;
              onChange({
                customThemes: [
                  ...settings.customThemes,
                  {
                    id,
                    name: themeName.trim() || t('reader.customTheme'),
                    background: themeBackground,
                    text: themeText,
                    custom: true,
                  },
                ],
                themeId: id,
              });
              setThemeDialog(false);
              setThemeName('');
            },
          },
        ]}
      >
        <View style={styles.themeForm}>
          <TextField label={t('reader.themeName')} value={themeName} onChangeText={setThemeName} />
          <TextField
            label={t('reader.themeBackground')}
            value={themeBackground}
            onChangeText={setThemeBackground}
            autoCapitalize="characters"
            placeholder="#FFFFFF"
          />
          <TextField
            label={t('reader.themeText')}
            value={themeText}
            onChangeText={setThemeText}
            autoCapitalize="characters"
            placeholder="#000000"
          />
          {isHexColor(themeBackground) && isHexColor(themeText) ? (
            <View style={[styles.themePreview, { backgroundColor: themeBackground }]}>
              <AppText color={themeText}>{t('settings.previewText')}</AppText>
            </View>
          ) : null}
          {!themeValid ? (
            <AppText variant="caption" color={colors.error}>
              {t('reader.themeInvalid')}
            </AppText>
          ) : null}
        </View>
      </Dialog>
    </>
  );
}

const styles = StyleSheet.create({
  footerHint: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xs },
  themes: { gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  theme: {
    width: 76,
    height: 64,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  hint: { paddingHorizontal: SPACING.lg },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  slider: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  button: { paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg, alignItems: 'flex-start' },
  themeForm: { gap: SPACING.sm },
  themePreview: { padding: SPACING.md, borderRadius: RADIUS.md },
});
