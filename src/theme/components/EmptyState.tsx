import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '../ThemeProvider';
import { SPACING } from '../typography';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

/** Illustrated empty state: a large icon, a title, a useful message and optional actions. */
export function EmptyState({
  icon,
  title,
  message,
  children,
}: {
  icon: IconName;
  title: string;
  message?: string;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.container}>
      <View style={[styles.halo, { backgroundColor: colors.surfaceVariant }]}>
        <View style={[styles.disc, { backgroundColor: colors.primaryContainer }]}>
          <Icon name={icon} size={44} color={colors.onPrimaryContainer} />
        </View>
      </View>
      <AppText variant="title" center>
        {title}
      </AppText>
      {message ? (
        <AppText secondary center style={styles.message}>
          {message}
        </AppText>
      ) : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xxl,
    gap: SPACING.sm,
  },
  halo: {
    width: 132,
    height: 132,
    borderRadius: 66,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  disc: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: { maxWidth: 320 },
  actions: { marginTop: SPACING.lg, gap: SPACING.sm, alignItems: 'center' },
});
