import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../ThemeProvider';
import { RADIUS, SPACING } from '../typography';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text';

export function Button({
  label,
  onPress,
  variant = 'filled',
  icon,
  disabled,
  danger,
  compact,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  danger?: boolean;
  compact?: boolean;
}) {
  const { colors } = useTheme();

  const background =
    variant === 'filled'
      ? danger
        ? colors.error
        : colors.primary
      : variant === 'tonal'
        ? colors.primaryContainer
        : 'transparent';
  const foreground =
    variant === 'filled'
      ? danger
        ? colors.onError
        : colors.onPrimary
      : variant === 'tonal'
        ? colors.onPrimaryContainer
        : danger
          ? colors.error
          : colors.primary;

  return (
    <View style={[styles.wrapper, disabled && styles.disabled]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: Boolean(disabled) }}
        disabled={disabled}
        onPress={onPress}
        android_ripple={{ color: colors.ripple }}
        style={[
          styles.button,
          compact && styles.compact,
          { backgroundColor: background },
          variant === 'outlined' && { borderWidth: 1, borderColor: colors.border },
        ]}
      >
        {icon ? <Icon name={icon} size={18} color={foreground} /> : null}
        <AppText variant="label" color={foreground} numberOfLines={1}>
          {label}
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { borderRadius: RADIUS.pill, overflow: 'hidden', alignSelf: 'center' },
  disabled: { opacity: 0.45 },
  button: {
    minHeight: 44,
    paddingHorizontal: SPACING.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    borderRadius: RADIUS.pill,
  },
  compact: { minHeight: 36, paddingHorizontal: SPACING.lg },
});
