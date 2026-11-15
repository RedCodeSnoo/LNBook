import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import i18n from '../../i18n';
import { formatDayLabel, formatTime } from '../../services/format';
import { AppText, Button } from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { SPACING } from '../../theme/typography';
import { checkForAppUpdateByHand, installedVersion, useAppUpdate } from './appUpdateService';
import { checkStatusKey } from './releaseCheck';

/**
 * "Check for updates" with the result written under it: "You have the latest version"
 * or "Version X available". `onChecked` also runs other checks (new chapters).
 */
export function AppUpdateCheck({ onChecked }: { onChecked?: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const checking = useAppUpdate((state) => state.checking);
  const outcome = useAppUpdate((state) => state.lastOutcome);
  const lastCheckAt = useAppUpdate((state) => state.lastCheckAt);
  const release = useAppUpdate((state) => state.release);
  const status = checkStatusKey(checking, outcome, release?.version ?? null);

  return (
    <View style={styles.box}>
      <Button
        label={t('appUpdate.checkNow')}
        icon="update"
        variant="tonal"
        disabled={checking}
        onPress={() => {
          void checkForAppUpdateByHand();
          onChecked?.();
        }}
      />
      <View style={styles.texts}>
        {status ? (
          <AppText
            variant="label"
            accessibilityLiveRegion="polite"
            color={
              status.key === 'appUpdate.available'
                ? colors.primary
                : status.key === 'appUpdate.checkFailed'
                  ? colors.error
                  : undefined
            }
          >
            {t(status.key, { version: status.version })}
          </AppText>
        ) : null}
        <AppText variant="caption" secondary>
          {[
            t('appUpdate.installed', { version: installedVersion() }),
            lastCheckAt
              ? t('appUpdate.lastCheck', {
                  day: formatDayLabel(lastCheckAt, i18n.language, {
                    today: t('history.today'),
                    yesterday: t('history.yesterday'),
                  }),
                  time: formatTime(lastCheckAt),
                })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  texts: { flex: 1, gap: 2 },
});
