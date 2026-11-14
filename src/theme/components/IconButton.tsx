import { Pressable, StyleSheet } from 'react-native';

import type { ThemeColor } from '../palette';

import { useTheme } from '../ThemeProvider';
import { Icon, type IconName } from './Icon';

export function IconButton({
  icon,
  label,
  onPress,
  onLongPress,
  color,
  size = 24,
  disabled,
}: {
  icon: IconName;
  /** Accessibility label (always required: the button has no visible text). */
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  color?: ThemeColor;
  size?: number;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={6}
      android_ripple={{ color: theme.colors.ripple, borderless: true, radius: 22 }}
      style={styles.button}
    >
      <Icon name={icon} size={size} color={disabled ? theme.colors.textDisabled : color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
