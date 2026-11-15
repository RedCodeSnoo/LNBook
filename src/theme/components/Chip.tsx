import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../ThemeProvider';
import { RADIUS, SPACING } from '../typography';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

/** Small selectable pill, used for categories, filters and folders. */
export function Chip({
  label,
  selected,
  onPress,
  onLongPress,
  icon,
  dotColor,
  accessibilityHint,
}: {
  label: string;
  /** Small coloured dot before the label (quote folders). */
  dotColor?: string;
  accessibilityHint?: string;
  selected?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  icon?: IconName;
}) {
  const { colors } = useTheme();
  const foreground = selected ? colors.onPrimaryContainer : colors.textSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primaryContainer : 'transparent',
          borderColor: selected ? 'transparent' : colors.border,
        },
      ]}
    >
      {icon ? <Icon name={icon} size={16} color={foreground} /> : null}
      {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
      <AppText variant="label" color={foreground} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
