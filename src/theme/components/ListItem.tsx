import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { useTheme } from '../ThemeProvider';
import { SPACING } from '../typography';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export interface ListItemProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  right?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  selected?: boolean;
}

export function ListItem({
  title,
  subtitle,
  icon,
  right,
  onPress,
  onLongPress,
  disabled,
  selected,
}: ListItemProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{ disabled: Boolean(disabled), selected: Boolean(selected) }}
      disabled={disabled || (!onPress && !onLongPress)}
      onPress={onPress}
      onLongPress={onLongPress}
      android_ripple={{ color: colors.ripple }}
      style={[styles.row, disabled && styles.disabled]}
    >
      {icon ? (
        <View style={styles.icon}>
          <Icon name={icon} color={selected ? colors.primary : colors.textSecondary} />
        </View>
      ) : null}
      <View style={styles.texts}>
        <AppText variant="subtitle" color={selected ? colors.primary : undefined}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="label" secondary>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right}
    </Pressable>
  );
}

/** Row with a switch; the whole row toggles it. */
export function SwitchItem({
  value,
  onValueChange,
  ...rest
}: Omit<ListItemProps, 'right' | 'onPress'> & {
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <ListItem
      {...rest}
      onPress={() => onValueChange(!value)}
      right={
        <Switch
          value={value}
          onValueChange={onValueChange}
          thumbColor={value ? colors.primary : colors.textDisabled}
          trackColor={{ false: colors.surfaceVariant, true: colors.primaryContainer }}
          accessibilityLabel={rest.title}
        />
      }
    />
  );
}

/** Row with a radio mark, for single choice lists. */
export function RadioItem({
  checked,
  ...rest
}: Omit<ListItemProps, 'right' | 'selected'> & { checked: boolean }) {
  const { colors } = useTheme();
  return (
    <ListItem
      {...rest}
      right={
        <Icon
          name={checked ? 'radiobox-marked' : 'radiobox-blank'}
          color={checked ? colors.primary : colors.textSecondary}
        />
      }
    />
  );
}

export function SectionHeader({ title }: { title: string }) {
  const { colors } = useTheme();
  return (
    <AppText
      variant="label"
      color={colors.primary}
      style={styles.section}
      accessibilityRole="header"
    >
      {title}
    </AppText>
  );
}

export function Divider() {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
}

const styles = StyleSheet.create({
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    gap: SPACING.lg,
  },
  disabled: { opacity: 0.45 },
  icon: { width: 28, alignItems: 'center' },
  texts: { flex: 1, gap: 2 },
  section: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.sm,
  },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: SPACING.lg },
});
