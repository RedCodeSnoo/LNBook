import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppBar, AppText, EmptyState, Icon, Screen } from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import { useSetting } from '../settings/settingsStore';

export function HistoryScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const incognito = useSetting('incognito');

  return (
    <Screen>
      <AppBar title={t('tabs.history')} large />
      {incognito ? (
        <View style={[styles.banner, { backgroundColor: colors.surfaceVariant }]}>
          <Icon name="incognito" size={20} color={colors.textSecondary} />
          <AppText variant="label" secondary style={styles.bannerText}>
            {t('history.incognitoBanner')}
          </AppText>
        </View>
      ) : null}
      <EmptyState
        icon="history"
        title={t('history.emptyTitle')}
        message={t('history.emptyMessage')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginHorizontal: SPACING.lg,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
  },
  bannerText: { flex: 1 },
});
