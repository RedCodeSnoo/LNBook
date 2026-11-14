import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../ThemeProvider';
import { RADIUS, SPACING } from '../typography';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

/** Floating action button, placed at the bottom right of a screen. */
export function Fab({
  icon,
  label,
  onPress,
  bottom = SPACING.lg,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  bottom?: number;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.wrapper, { bottom }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        android_ripple={{ color: colors.ripple }}
        style={[styles.fab, { backgroundColor: colors.primaryContainer }]}
      >
        <Icon name={icon} color={colors.onPrimaryContainer} />
        <AppText variant="label" color={colors.onPrimaryContainer}>
          {label}
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    right: SPACING.lg,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    elevation: 4,
  },
  fab: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.lg,
  },
});
