import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { SPACING } from '../typography';
import { AppText } from './AppText';
import { IconButton } from './IconButton';

export function AppBar({
  title,
  subtitle,
  onBack,
  actions,
  large,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  actions?: ReactNode;
  /** Large title, used by the root screen of each tab. */
  large?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.bar, large && styles.large]}>
      {onBack ? <IconButton icon="arrow-left" label={t('common.back')} onPress={onBack} /> : null}
      <View style={[styles.titles, !onBack && styles.noBack]}>
        <AppText
          variant={large ? 'headline' : 'title'}
          numberOfLines={1}
          accessibilityRole="header"
        >
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" secondary numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.xs,
  },
  large: { minHeight: 64 },
  titles: { flex: 1, paddingHorizontal: SPACING.xs },
  noBack: { paddingLeft: SPACING.lg },
  actions: { flexDirection: 'row', alignItems: 'center' },
});
