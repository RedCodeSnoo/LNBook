import { Image } from 'expo-image';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { clearCookies, resetApp } from '../../../modules/lnbook-system';
import type { RootScreenProps } from '../../app/navigation';
import { DEFAULT_USER_AGENT } from '../../plugins/libs/fetch';
import { errorLog } from '../../services/deviceErrorLog';
import {
  AppBar,
  Button,
  ConfirmDialog,
  ListItem,
  Screen,
  SectionHeader,
  TextField,
  showToast,
} from '../../theme/components';
import { SPACING } from '../../theme/typography';
import { installedVersion } from '../appUpdate/appUpdateService';
import { setSetting, useSetting } from './settingsStore';

/** Empties the cache directory of the app (shared files, files received from other apps). */
function clearCacheDirectory(): void {
  for (const entry of new Directory(Paths.cache).list()) {
    try {
      entry.delete();
    } catch {
      // A file in use stays until the next time.
    }
  }
}

/** Settings → Advanced: User-Agent, cookies, cache, error journal, reset. */
export function AdvancedSettingsScreen({ navigation }: RootScreenProps<'settingsAdvanced'>) {
  const { t } = useTranslation();
  const userAgent = useSetting('userAgent');
  const [agent, setAgent] = useState(userAgent);
  const [confirmReset, setConfirmReset] = useState(false);

  const saveAgent = (value: string) => {
    const cleaned = value.replace(/[\r\n]+/g, ' ').trim() || DEFAULT_USER_AGENT;
    setAgent(cleaned);
    setSetting('userAgent', cleaned);
    showToast(t('advanced.userAgentSaved'));
  };

  const exportLog = () => {
    errorLog.flush();
    if (errorLog.size === 0) {
      showToast(t('advanced.logEmpty'));
      return;
    }
    try {
      const file = new File(Paths.cache, 'lnbook-errors.txt');
      if (file.exists) {
        file.delete();
      }
      file.create();
      file.write(`LNBook ${installedVersion()}\n\n${errorLog.text()}\n`);
      void Sharing.shareAsync(file.uri, { mimeType: 'text/plain' }).catch(() => undefined);
    } catch {
      showToast(t('advanced.logFailed'));
    }
  };

  return (
    <Screen bottom>
      <AppBar title={t('settings.advanced')} onBack={navigation.goBack} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
        <SectionHeader title={t('advanced.userAgent')} />
        <View style={styles.agent}>
          <TextField
            value={agent}
            onChangeText={setAgent}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t('advanced.userAgent')}
          />
          <View style={styles.buttons}>
            <Button
              compact
              label={t('common.save')}
              disabled={agent.trim() === userAgent}
              onPress={() => saveAgent(agent)}
            />
            <Button
              compact
              variant="text"
              label={t('advanced.userAgentReset')}
              disabled={userAgent === DEFAULT_USER_AGENT}
              onPress={() => saveAgent(DEFAULT_USER_AGENT)}
            />
          </View>
        </View>

        <SectionHeader title={t('advanced.data')} />
        <ListItem
          icon="cookie-outline"
          title={t('advanced.clearCookies')}
          subtitle={t('advanced.clearCookiesHint')}
          onPress={() => {
            void clearCookies()
              .then(() => showToast(t('advanced.cookiesCleared')))
              .catch(() => showToast(t('advanced.failed')));
          }}
        />
        <ListItem
          icon="broom"
          title={t('advanced.clearCache')}
          subtitle={t('advanced.clearCacheHint')}
          onPress={() => {
            clearCacheDirectory();
            void Image.clearDiskCache()
              .catch(() => false)
              .then(() => showToast(t('advanced.cacheCleared')));
          }}
        />
        <ListItem
          icon="file-document-outline"
          title={t('advanced.exportLog')}
          subtitle={t('advanced.exportLogHint')}
          onPress={exportLog}
        />
        <ListItem
          icon="file-remove-outline"
          title={t('advanced.clearLog')}
          onPress={() => {
            errorLog.clear();
            showToast(t('advanced.logCleared'));
          }}
        />

        <SectionHeader title={t('advanced.danger')} />
        <ListItem
          icon="alert-outline"
          title={t('advanced.reset')}
          subtitle={t('advanced.resetHint')}
          onPress={() => setConfirmReset(true)}
        />
      </ScrollView>
      <ConfirmDialog
        visible={confirmReset}
        title={t('advanced.reset')}
        message={t('advanced.resetMessage')}
        confirmLabel={t('advanced.resetConfirm')}
        danger
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          if (!resetApp()) {
            showToast(t('advanced.failed'));
          }
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: SPACING.xxl },
  agent: { paddingHorizontal: SPACING.lg, gap: SPACING.sm },
  buttons: { flexDirection: 'row', gap: SPACING.xs },
});
